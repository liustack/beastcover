// 抠图边缘清理：半透明的边上混着原图背景的颜色（白底照片抠出来一圈白光边），
// 换到新背景上就是毛边。把边上的颜色换成主体内部的颜色，再压掉最淡的一层，透明度的过渡保留。
import sharp from 'sharp';

// 这么不透明的像素算主体内部，颜色可信。
const SOLID_ALPHA = 240;
// 透明度低于这个的最外层直接去掉，其余按比例拉回 0 到 255，边还是软的。
const CHOKE_ALPHA = 40;
// 颜色从内部往外填多少圈，按短边比例。再往外的半透明像素（孤立的发丝）保留原色。
const REACH_SHARE = 0.006;
const MIN_REACH = 3;

export async function cleanCutoutEdges(png: Buffer): Promise<Buffer> {
    const { data, info } = await sharp(png)
        .ensureAlpha()
        .raw()
        .toBuffer({ resolveWithObject: true });
    const { width, height } = info;
    const pixels = width * height;

    const known = new Uint8Array(pixels);
    for (let p = 0; p < pixels; p += 1) {
        const alpha = data[p * 4 + 3] as number;
        if (alpha >= SOLID_ALPHA) {
            known[p] = 1;
        }
        data[p * 4 + 3] =
            alpha <= CHOKE_ALPHA
                ? 0
                : Math.round(((alpha - CHOKE_ALPHA) * 255) / (255 - CHOKE_ALPHA));
    }

    const reach = Math.max(MIN_REACH, Math.round(Math.min(width, height) * REACH_SHARE));
    for (let pass = 0; pass < reach; pass += 1) {
        const filled: number[] = [];
        for (let y = 0; y < height; y += 1) {
            for (let x = 0; x < width; x += 1) {
                const p = y * width + x;
                if (known[p] === 1 || data[p * 4 + 3] === 0) {
                    continue;
                }
                let r = 0;
                let g = 0;
                let b = 0;
                let count = 0;
                for (let dy = -1; dy <= 1; dy += 1) {
                    for (let dx = -1; dx <= 1; dx += 1) {
                        const nx = x + dx;
                        const ny = y + dy;
                        if (nx < 0 || ny < 0 || nx >= width || ny >= height) {
                            continue;
                        }
                        const q = ny * width + nx;
                        if (known[q] === 1) {
                            r += data[q * 4] as number;
                            g += data[q * 4 + 1] as number;
                            b += data[q * 4 + 2] as number;
                            count += 1;
                        }
                    }
                }
                if (count > 0) {
                    data[p * 4] = Math.round(r / count);
                    data[p * 4 + 1] = Math.round(g / count);
                    data[p * 4 + 2] = Math.round(b / count);
                    filled.push(p);
                }
            }
        }
        if (filled.length === 0) {
            break;
        }
        for (const p of filled) {
            known[p] = 1;
        }
    }

    return sharp(data, { raw: { width, height, channels: 4 } })
        .png()
        .toBuffer();
}
