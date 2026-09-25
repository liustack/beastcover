import { existsSync, mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import sharp from 'sharp';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { lookupCommandOnPath } from '../doctor.ts';
import {
    NoSubjectFoundError,
    prepareSubject,
    visionCutoutUnavailable,
    visionSubjectCutout,
} from './index.ts';

const tempDirectories: string[] = [];

afterEach(() => {
    for (const directory of tempDirectories.splice(0)) {
        rmSync(directory, { recursive: true, force: true });
    }
});

function tempDir(): string {
    const directory = mkdtempSync(join(tmpdir(), 'beastcover-subject-'));
    tempDirectories.push(directory);
    return directory;
}

/** 400x400 的图，中间 200x300 是不透明的红块，四周按 background 填 */
async function writeImage(
    path: string,
    background: { r: number; g: number; b: number; alpha: number },
): Promise<string> {
    await sharp({ create: { width: 400, height: 400, channels: 4, background } })
        .composite([
            {
                input: {
                    create: {
                        width: 200,
                        height: 300,
                        channels: 4,
                        background: { r: 200, g: 40, b: 40, alpha: 1 },
                    },
                },
                left: 100,
                top: 60,
            },
        ])
        .png()
        .toFile(path);
    return path;
}

async function writeCutout(_input: string, output: string): Promise<void> {
    await writeImage(output, { r: 0, g: 0, b: 0, alpha: 0 });
}

describe('subject layer', () => {
    it('uses a transparent PNG as is and trims its empty border', async () => {
        const directory = tempDir();
        const path = await writeImage(join(directory, 'cutout.png'), {
            r: 0,
            g: 0,
            b: 0,
            alpha: 0,
        });
        const cutout = vi.fn(writeCutout);

        const subject = await prepareSubject(path, { cacheDir: join(directory, 'cache'), cutout });

        expect(subject).toMatchObject({ method: 'transparent', width: 200, height: 300 });
        expect(subject.dataUri.startsWith('data:image/png;base64,')).toBe(true);
        expect(cutout).not.toHaveBeenCalled();
    });

    it('cuts out an opaque photo once and reuses the cached result', async () => {
        const directory = tempDir();
        const photo = await writeImage(join(directory, 'photo.png'), {
            r: 255,
            g: 255,
            b: 255,
            alpha: 1,
        });
        const jpeg = join(directory, 'photo.jpg');
        await sharp(photo).jpeg().toFile(jpeg);
        const cacheDir = join(directory, 'cache');
        const cutout = vi.fn(writeCutout);

        const first = await prepareSubject(jpeg, { cacheDir, cutout });
        const second = await prepareSubject(jpeg, { cacheDir, cutout });

        expect(first).toMatchObject({ method: 'macos-vision', width: 200, height: 300 });
        expect(second.dataUri).toBe(first.dataUri);
        expect(cutout).toHaveBeenCalledOnce();
        expect(readdirSync(cacheDir).filter((name) => name.startsWith('subject-'))).toHaveLength(1);
    });

    it('treats a PNG with an alpha channel but no real transparency as a photo', async () => {
        const directory = tempDir();
        const path = await writeImage(join(directory, 'opaque.png'), {
            r: 255,
            g: 255,
            b: 255,
            alpha: 1,
        });
        const cutout = vi.fn(writeCutout);

        const subject = await prepareSubject(path, { cacheDir: join(directory, 'cache'), cutout });

        expect(subject.method).toBe('macos-vision');
        expect(cutout).toHaveBeenCalledOnce();
    });

    it('leaves no cache file behind when the cutout fails', async () => {
        const directory = tempDir();
        const jpeg = join(directory, 'photo.jpg');
        await sharp({
            create: { width: 64, height: 64, channels: 3, background: { r: 1, g: 2, b: 3 } },
        })
            .jpeg()
            .toFile(jpeg);
        const cacheDir = join(directory, 'cache');

        await expect(
            prepareSubject(jpeg, {
                cacheDir,
                cutout: async () => {
                    throw new NoSubjectFoundError('No person or object stands out.');
                },
            }),
        ).rejects.toBeInstanceOf(NoSubjectFoundError);
        expect(readdirSync(cacheDir)).toEqual([]);
    });
});

describe('macOS Vision cutout', () => {
    it('explains why automatic cutout is unavailable', () => {
        const binDir = join(tempDir(), 'bin');
        expect(
            visionCutoutUnavailable({ platform: 'linux', binDir, lookupCommand: () => '/x' }),
        ).toBe('automatic cutout needs macOS 14 or newer');
        expect(
            visionCutoutUnavailable({
                platform: 'darwin',
                osRelease: '22.6.0',
                binDir,
                lookupCommand: () => '/swiftc',
            }),
        ).toBe('automatic cutout needs macOS 14 or newer');
        expect(
            visionCutoutUnavailable({
                platform: 'darwin',
                osRelease: '23.0.0',
                binDir,
                lookupCommand: () => undefined,
            }),
        ).toBe('automatic cutout needs the Swift compiler. Run xcode-select --install');
        expect(
            visionCutoutUnavailable({
                platform: 'darwin',
                osRelease: '24.3.0',
                binDir,
                lookupCommand: () => '/swiftc',
            }),
        ).toBeUndefined();
    });

    it('fails with the transparent PNG hint on a machine without the cutout', async () => {
        const directory = tempDir();
        const cutout = visionSubjectCutout({
            platform: 'linux',
            binDir: join(directory, 'bin'),
            lookupCommand: () => undefined,
        });
        await expect(cutout('/photos/me.jpg', join(directory, 'out.png'))).rejects.toThrowError(
            '/photos/me.jpg has no transparent background, and automatic cutout needs macOS 14 or newer.',
        );
    });

    const canRunVision =
        process.platform === 'darwin' && lookupCommandOnPath('swiftc') !== undefined;

    it.runIf(canRunVision)(
        'builds the tool once, cuts out a shape, and reports an empty image',
        async () => {
            const directory = tempDir();
            const binDir = join(directory, 'bin');
            const cutout = visionSubjectCutout({
                platform: 'darwin',
                binDir,
                lookupCommand: lookupCommandOnPath,
            });
            // 椭圆主体：Vision 把输出裁到主体边界，椭圆的四角才会是透明的。
            const photo = join(directory, 'shape.png');
            await sharp(
                Buffer.from(
                    '<svg xmlns="http://www.w3.org/2000/svg" width="600" height="600"><rect width="600" height="600" fill="#fff"/><ellipse cx="300" cy="300" rx="150" ry="180" fill="#c82828"/></svg>',
                ),
            )
                .png()
                .toFile(photo);
            const output = join(directory, 'shape-cutout.png');

            await cutout(photo, output);

            const { data, info } = await sharp(output)
                .ensureAlpha()
                .raw()
                .toBuffer({ resolveWithObject: true });
            expect(data[3]).toBe(0);
            const middle =
                (Math.floor(info.height / 2) * info.width + Math.floor(info.width / 2)) * 4;
            expect(data[middle + 3]).toBe(255);
            expect(
                readdirSync(binDir).filter((name) => name.startsWith('vision-tool-')),
            ).toHaveLength(1);

            const blank = join(directory, 'blank.png');
            await sharp({
                create: { width: 200, height: 200, channels: 3, background: '#ffffff' },
            })
                .png()
                .toFile(blank);
            await expect(cutout(blank, join(directory, 'blank-out.png'))).rejects.toBeInstanceOf(
                NoSubjectFoundError,
            );
            expect(existsSync(join(directory, 'blank-out.png'))).toBe(false);
        },
        240_000,
    );
});
