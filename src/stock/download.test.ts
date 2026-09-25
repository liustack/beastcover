import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
    downloadPhotoBytes,
    extensionForContentType,
    MAX_DOWNLOAD_BYTES,
    sidecarPath,
    writePhotoFiles,
} from './download.ts';
import type { PinnedFetchInit, PinnedTarget } from './ssrf.ts';
import type { StockPhoto } from './types.ts';

const tempDirectories: string[] = [];

afterEach(() => {
    for (const directory of tempDirectories.splice(0)) {
        rmSync(directory, { recursive: true, force: true });
    }
});

const publicLookup = async () => [{ address: '104.16.1.1', family: 4 }];

function imageResponse(bytes: Buffer, contentType: string): Response {
    return new Response(bytes, { status: 200, headers: { 'content-type': contentType } });
}

describe('stock download', () => {
    it('maps image content types to extensions and rejects the rest', () => {
        expect(extensionForContentType('image/jpeg')).toBe('.jpg');
        expect(extensionForContentType('image/png; charset=binary')).toBe('.png');
        expect(extensionForContentType('image/webp')).toBe('.webp');
        expect(() => extensionForContentType('text/html')).toThrowError(
            'Stock photo response is "text/html", expected image/jpeg, image/png, or image/webp.',
        );
        expect(() => extensionForContentType(null)).toThrowError('"unknown"');
    });

    it('requires https and a public pinned target, then enforces the byte limit', async () => {
        await expect(
            downloadPhotoBytes('http://images.example/a.jpg', { lookup: publicLookup }),
        ).rejects.toThrowError('Stock photo download URL must use https');

        const pinned = vi.fn(async (_url: URL, _pin: PinnedTarget, _init?: PinnedFetchInit) =>
            imageResponse(Buffer.from('abc'), 'image/jpeg'),
        );
        const result = await downloadPhotoBytes('https://images.example/a.jpg', {
            lookup: publicLookup,
            pinnedFetch: pinned,
        });
        expect(result).toEqual({ bytes: Buffer.from('abc'), extension: '.jpg' });
        expect(pinned.mock.calls[0]?.[1]).toEqual({
            hostname: 'images.example',
            address: '104.16.1.1',
            family: 4,
        });

        const huge = vi.fn(async () =>
            imageResponse(Buffer.alloc(MAX_DOWNLOAD_BYTES + 1), 'image/png'),
        );
        await expect(
            downloadPhotoBytes('https://images.example/a.png', {
                lookup: publicLookup,
                pinnedFetch: huge,
            }),
        ).rejects.toThrowError('larger than the');

        const empty = vi.fn(async () => imageResponse(Buffer.alloc(0), 'image/png'));
        await expect(
            downloadPhotoBytes('https://images.example/a.png', {
                lookup: publicLookup,
                pinnedFetch: empty,
            }),
        ).rejects.toThrowError('empty body');
    });

    it('writes the image beside a sidecar that records provenance', () => {
        const directory = mkdtempSync(join(tmpdir(), 'beastcover-stock-'));
        tempDirectories.push(directory);
        const photo: StockPhoto = {
            ref: 'pexels:42',
            provider: 'pexels',
            id: '42',
            width: 1600,
            height: 900,
            creator: 'Bea',
            license: 'Pexels License',
            attribution: 'Photo by Bea on Pexels',
            pageUrl: 'https://www.pexels.com/photo/42/',
            thumbnail: '',
            downloadUrl: 'https://images.pexels.com/photos/42/orig.jpeg',
        };

        const written = writePhotoFiles({
            photo,
            downloaded: { bytes: Buffer.from('img'), extension: '.jpg' },
            basePath: join(directory, 'refs', 'pexels-42'),
            now: new Date('2026-09-23T00:00:00.000Z'),
        });

        expect(written.imagePath).toBe(join(directory, 'refs', 'pexels-42.jpg'));
        expect(written.sidecar).toBe(sidecarPath(written.imagePath));
        expect(readFileSync(written.imagePath, 'utf8')).toBe('img');
        expect(JSON.parse(readFileSync(written.sidecar, 'utf8'))).toEqual({
            ref: 'pexels:42',
            provider: 'pexels',
            id: '42',
            creator: 'Bea',
            license: 'Pexels License',
            attribution: 'Photo by Bea on Pexels',
            pageUrl: 'https://www.pexels.com/photo/42/',
            downloadUrl: 'https://images.pexels.com/photos/42/orig.jpeg',
            width: 1600,
            height: 900,
            fetchedAt: '2026-09-23T00:00:00.000Z',
        });
    });
});
