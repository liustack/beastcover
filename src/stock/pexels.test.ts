import { describe, expect, it, vi } from 'vitest';
import { loadPexelsPhoto, PEXELS_PHOTO_URL, searchPexels } from './pexels.ts';

const noSleep = async () => undefined;

function json(body: unknown): Response {
    return new Response(JSON.stringify(body), { status: 200 });
}

const photo = {
    id: 42,
    width: 1600,
    height: 900,
    url: 'https://www.pexels.com/photo/42/',
    photographer: 'Bea',
    src: {
        original: 'https://images.pexels.com/photos/42/orig.jpeg',
        large2x: 'https://images.pexels.com/photos/42/large2x.jpeg',
        medium: 'https://images.pexels.com/photos/42/medium.jpeg',
    },
};

describe('pexels', () => {
    it('sends the api key as Authorization and maps hits', async () => {
        const fetchImpl = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
            expect(String(url)).toContain('query=office+desk');
            expect(String(url)).toContain('orientation=landscape');
            expect((init?.headers as Record<string, string> | undefined)?.Authorization).toBe(
                'key-1',
            );
            return json({ photos: [photo, { id: 'x', width: 900, height: 1600, src: {} }] });
        });

        const hits = await searchPexels(
            { query: 'office desk', orientation: 'landscape' },
            { apiKey: 'key-1', fetch: fetchImpl as typeof fetch, sleep: noSleep },
        );

        expect(hits).toEqual([
            {
                ref: 'pexels:42',
                provider: 'pexels',
                id: '42',
                width: 1600,
                height: 900,
                creator: 'Bea',
                license: 'Pexels License',
                attribution: 'Photo by Bea on Pexels',
                pageUrl: 'https://www.pexels.com/photo/42/',
                thumbnail: 'https://images.pexels.com/photos/42/medium.jpeg',
            },
        ]);
    });

    it('prefers the original download url and falls back to large2x', async () => {
        const fetchImpl = vi.fn(async (url: string | URL | Request) => {
            expect(String(url)).toBe(`${PEXELS_PHOTO_URL}42`);
            return json(photo);
        });
        const loaded = await loadPexelsPhoto('42', {
            apiKey: 'k',
            fetch: fetchImpl as typeof fetch,
            sleep: noSleep,
        });
        expect(loaded.downloadUrl).toBe('https://images.pexels.com/photos/42/orig.jpeg');

        const noOriginal = vi.fn(async () =>
            json({ ...photo, src: { large2x: photo.src.large2x } }),
        );
        const fallback = await loadPexelsPhoto('42', {
            apiKey: 'k',
            fetch: noOriginal as typeof fetch,
            sleep: noSleep,
        });
        expect(fallback.downloadUrl).toBe(photo.src.large2x);

        const missing = vi.fn(async () => json({ id: 42, width: 10, height: 10, src: {} }));
        await expect(
            loadPexelsPhoto('42', { apiKey: 'k', fetch: missing as typeof fetch, sleep: noSleep }),
        ).rejects.toThrowError('Pexels photo 42 has no download URL.');
    });
});
