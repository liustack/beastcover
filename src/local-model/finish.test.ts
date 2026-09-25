import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import sharp from 'sharp';
import { afterEach, describe, expect, it } from 'vitest';
import { DIMENSION_PRESET_NAMES } from '../dimensions.ts';
import {
    cropLocalModelImage,
    finishLocalModelImage,
    getLocalModelCanvasPlan,
    type LocalModelCanvasPlan,
    resizeLocalModelImage,
} from './index.ts';

const tempDirectories: string[] = [];
const MID_GREEN = { r: 0, g: 255, b: 0 };

afterEach(() => {
    for (const directory of tempDirectories.splice(0)) {
        rmSync(directory, { recursive: true, force: true });
    }
});

function tempDir(prefix: string): string {
    const directory = mkdtempSync(join(tmpdir(), prefix));
    tempDirectories.push(directory);
    return directory;
}

async function writeBandedPng(path: string, plan: LocalModelCanvasPlan): Promise<void> {
    const width = plan.generateWidth;
    const height = plan.generateHeight;
    const topHeight = plan.cropTop;
    const midHeight = plan.cropHeight;
    const channels = 3;
    const raw = Buffer.alloc(width * height * channels);
    for (let y = 0; y < height; y++) {
        let r: number;
        let g: number;
        let b: number;
        if (y < topHeight) {
            r = 255;
            g = 0;
            b = 0;
        } else if (y < topHeight + midHeight) {
            r = 0;
            g = 255;
            b = 0;
        } else {
            r = 0;
            g = 0;
            b = 255;
        }
        for (let x = 0; x < width; x++) {
            const offset = (y * width + x) * channels;
            const outsideColumns = x < plan.cropLeft || x >= plan.cropLeft + plan.cropWidth;
            raw[offset] = outsideColumns ? 255 : r;
            raw[offset + 1] = outsideColumns ? 0 : g;
            raw[offset + 2] = outsideColumns ? 0 : b;
        }
    }
    await sharp(raw, { raw: { width, height, channels } }).png().toFile(path);
}

async function extractCropped(sourcePath: string, plan: LocalModelCanvasPlan): Promise<Buffer> {
    return sharp(sourcePath)
        .extract({
            left: plan.cropLeft,
            top: plan.cropTop,
            width: plan.cropWidth,
            height: plan.cropHeight,
        })
        .toBuffer();
}

async function assertSolidGreen(source: string | Buffer): Promise<void> {
    const { data, info } = await sharp(source).raw().toBuffer({ resolveWithObject: true });
    for (let i = 0; i < data.length; i += info.channels) {
        if (data[i] !== MID_GREEN.r || data[i + 1] !== MID_GREEN.g || data[i + 2] !== MID_GREEN.b) {
            throw new Error(
                `pixel ${i / info.channels} was ${data[i]},${data[i + 1]},${data[i + 2]} expected ${MID_GREEN.r},${MID_GREEN.g},${MID_GREEN.b}`,
            );
        }
    }
    expect(data.length).toBeGreaterThan(0);
}

describe('local-model finish', () => {
    for (const preset of DIMENSION_PRESET_NAMES) {
        it(`crops ${preset} to the centre box then resizes to production pixels`, async () => {
            const plan = getLocalModelCanvasPlan(preset);
            const sourcePath = join(tempDir('beastcover-finish-crop-'), 'source.png');
            await writeBandedPng(sourcePath, plan);

            const cropped = await cropLocalModelImage(sourcePath, plan);
            const cropMeta = await sharp(cropped).metadata();
            expect(cropMeta.width).toBe(plan.cropWidth);
            expect(cropMeta.height).toBe(plan.cropHeight);
            await assertSolidGreen(cropped);

            const extracted = await extractCropped(sourcePath, plan);
            const resized = await resizeLocalModelImage(extracted, plan);
            const resizeMeta = await sharp(resized).metadata();
            expect(resizeMeta.width).toBe(plan.outputWidth);
            expect(resizeMeta.height).toBe(plan.outputHeight);
            await assertSolidGreen(resized);
        });

        it(`finish ${preset} writes production pixels`, async () => {
            const plan = getLocalModelCanvasPlan(preset);
            const directory = tempDir('beastcover-finish-out-');
            const sourcePath = join(directory, 'source.png');
            const outputPath = join(directory, 'out.png');
            await writeBandedPng(sourcePath, plan);

            const result = await finishLocalModelImage({ sourcePath, outputPath, plan });
            expect(result).toEqual({
                cropWidth: plan.cropWidth,
                cropHeight: plan.cropHeight,
                outputWidth: plan.outputWidth,
                outputHeight: plan.outputHeight,
            });
            const meta = await sharp(outputPath).metadata();
            expect(meta.width).toBe(plan.outputWidth);
            expect(meta.height).toBe(plan.outputHeight);
            await assertSolidGreen(outputPath);
        });
    }

    it('rejects a source whose pixels are not the generate size', async () => {
        const plan = getLocalModelCanvasPlan('youtube');
        const directory = tempDir('beastcover-finish-size-');
        const sourcePath = join(directory, 'wrong.png');
        await sharp({
            create: {
                width: 100,
                height: 100,
                channels: 3,
                background: MID_GREEN,
            },
        })
            .png()
            .toFile(sourcePath);

        let cropThrown: unknown;
        try {
            await cropLocalModelImage(sourcePath, plan);
        } catch (error) {
            cropThrown = error;
        }
        const cropMessage = cropThrown instanceof Error ? cropThrown.message : String(cropThrown);
        expect(cropMessage).toContain('100x100');
        expect(cropMessage).toContain('1536x1024');

        let finishThrown: unknown;
        try {
            await finishLocalModelImage({
                sourcePath,
                outputPath: join(directory, 'out.png'),
                plan,
            });
        } catch (error) {
            finishThrown = error;
        }
        const finishMessage =
            finishThrown instanceof Error ? finishThrown.message : String(finishThrown);
        expect(finishMessage).toContain('100x100');
        expect(finishMessage).toContain('1536x1024');
    });

    it('rejects a source that is not an image', async () => {
        const plan = getLocalModelCanvasPlan('youtube');
        const directory = tempDir('beastcover-finish-not-image-');
        const sourcePath = join(directory, 'not-image.bin');
        writeFileSync(sourcePath, 'not-an-image');
        let thrown: unknown;
        try {
            await finishLocalModelImage({
                sourcePath,
                outputPath: join(directory, 'out.png'),
                plan,
            });
        } catch (error) {
            thrown = error;
        }
        const message = thrown instanceof Error ? thrown.message : String(thrown);
        expect(message).toMatch(/unsupported|invalid|corrupt|image|metadata|width|height/i);
    });
});
