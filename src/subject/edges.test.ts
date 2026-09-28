import sharp from 'sharp';
import { describe, expect, it } from 'vitest';
import { cleanCutoutEdges } from './edges.ts';

const SIZE = 60;

/** 中间 20..40 是不透明红块，外面一圈 3 像素半透明白边（白底渗进来的光边），再外面一圈很淡的像素 */
async function haloCutout(): Promise<Buffer> {
    const data = Buffer.alloc(SIZE * SIZE * 4);
    for (let y = 0; y < SIZE; y += 1) {
        for (let x = 0; x < SIZE; x += 1) {
            const i = (y * SIZE + x) * 4;
            const ring = Math.max(0, 20 - x, x - 39, 20 - y, y - 39);
            if (ring === 0) {
                data.set([200, 40, 40, 255], i);
            } else if (ring <= 3) {
                data.set([240, 235, 235, 150], i);
            } else if (ring === 4) {
                data.set([250, 250, 250, 20], i);
            }
        }
    }
    return sharp(data, { raw: { width: SIZE, height: SIZE, channels: 4 } })
        .png()
        .toBuffer();
}

async function pixels(png: Buffer): Promise<Buffer> {
    return sharp(png).ensureAlpha().raw().toBuffer();
}

function at(data: Buffer, x: number, y: number): number[] {
    const i = (y * SIZE + x) * 4;
    return [...data.subarray(i, i + 4)];
}

describe('cutout edge cleanup', () => {
    it('paints the soft edge in the colour of the subject, not the old background', async () => {
        const cleaned = await pixels(await cleanCutoutEdges(await haloCutout()));

        const [r, g, b, alpha] = at(cleaned, 18, 30);
        expect(alpha).toBeGreaterThan(0);
        expect(r).toBeGreaterThan(180);
        expect(g).toBeLessThan(70);
        expect(b).toBeLessThan(70);
    });

    it('drops the faintest outer pixels and keeps the edge soft', async () => {
        const cleaned = await pixels(await cleanCutoutEdges(await haloCutout()));

        expect(at(cleaned, 16, 30)[3]).toBe(0);
        const edge = at(cleaned, 18, 30)[3] ?? 0;
        expect(edge).toBeGreaterThan(0);
        expect(edge).toBeLessThan(255);
    });

    it('leaves the solid inside and the empty outside as they were', async () => {
        const cleaned = await pixels(await cleanCutoutEdges(await haloCutout()));

        expect(at(cleaned, 30, 30)).toEqual([200, 40, 40, 255]);
        expect(at(cleaned, 2, 2)[3]).toBe(0);
    });
});
