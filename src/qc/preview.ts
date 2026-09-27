// 信息流预览：每张成品缩到它在平台信息流里的实际宽度，排在深灰底上，给 agent 做一瞥测试。
// 机器查不出的问题（认不出的人、点子不成立、情绪读不出）要靠看这张图。
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import sharp, { type OverlayOptions } from 'sharp';
import { newRunDir } from '../paths.ts';
import { getPlatform, type PlatformName } from '../platforms/index.ts';

const GAP = 24;
const LABEL = 22;
const FEED_GREY = '#1f1f1f';

function label(text: string, width: number): Buffer {
    const safe = text.replaceAll('&', '&amp;').replaceAll('<', '&lt;');
    return Buffer.from(
        `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${LABEL}"><text x="0" y="16" font-family="Helvetica, Arial, sans-serif" font-size="14" fill="#bbbbbb">${safe}</text></svg>`,
    );
}

/** 生成预览图并返回路径。每张按 feedWidth 缩小，一行排开 */
export async function feedPreview(
    covers: ReadonlyArray<{ platform: PlatformName; outputPath: string }>,
): Promise<string> {
    const tiles = await Promise.all(
        covers.map(async (cover) => {
            const width = getPlatform(cover.platform).feedWidth;
            const image = await sharp(cover.outputPath).resize({ width }).png().toBuffer();
            const { height } = await sharp(image).metadata();
            return { platform: cover.platform, image, width, height: height ?? width };
        }),
    );
    const sheetWidth = tiles.reduce((sum, tile) => sum + tile.width + GAP, GAP);
    const sheetHeight = Math.max(...tiles.map((tile) => tile.height)) + LABEL + GAP * 2;
    let x = GAP;
    const layers: OverlayOptions[] = [];
    for (const tile of tiles) {
        layers.push({ input: label(tile.platform, tile.width), left: x, top: GAP / 2 });
        layers.push({ input: tile.image, left: x, top: GAP / 2 + LABEL });
        x += tile.width + GAP;
    }
    const png = await sharp({
        create: { width: sheetWidth, height: sheetHeight, channels: 3, background: FEED_GREY },
    })
        .composite(layers)
        .png()
        .toBuffer();
    const path = join(newRunDir(), 'feed-preview.png');
    writeFileSync(path, png);
    return path;
}
