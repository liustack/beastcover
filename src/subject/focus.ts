// 照片主体在哪：macOS 上先找人脸，没有人脸找显著区域（Vision）。其他系统用 sharp 的注意力判断。
// 结果用来重新构图，让主体避开标题。
import sharp from 'sharp';
import type { PhotoFocus } from './vision.ts';

// sharp 注意力判断用的窗口：横竖各裁一次这么宽的条，裁下来的位置就是主体所在。
const ATTENTION_WINDOW = 0.35;

async function attentionOffset(
    imagePath: string,
    width: number,
    height: number,
    axis: 'x' | 'y',
): Promise<number> {
    const target =
        axis === 'x'
            ? { width: Math.max(1, Math.round(width * ATTENTION_WINDOW)), height }
            : { width, height: Math.max(1, Math.round(height * ATTENTION_WINDOW)) };
    const { info } = await sharp(imagePath)
        .rotate()
        .resize(target.width, target.height, {
            fit: 'cover',
            position: sharp.strategy.attention,
        })
        .toBuffer({ resolveWithObject: true });
    const offset = axis === 'x' ? info.cropOffsetLeft : info.cropOffsetTop;
    if (offset === undefined) {
        throw new Error(`sharp did not report a crop offset for ${imagePath}.`);
    }
    // sharp 报的是负的偏移量：裁剪窗口左上角在原图里的位置取反。
    const start = -offset;
    const size = axis === 'x' ? target.width : target.height;
    return (start + size / 2) / (axis === 'x' ? width : height);
}

export async function attentionFocus(imagePath: string): Promise<PhotoFocus> {
    const meta = await sharp(imagePath, { failOn: 'error' }).rotate().metadata();
    const oriented = (meta.orientation ?? 1) >= 5;
    const width = oriented ? meta.height : meta.width;
    const height = oriented ? meta.width : meta.height;
    if (width === undefined || height === undefined) {
        throw new Error(`Cannot read the image size of ${imagePath}.`);
    }
    return {
        x: await attentionOffset(imagePath, width, height, 'x'),
        y: await attentionOffset(imagePath, width, height, 'y'),
        width: ATTENTION_WINDOW,
        height: ATTENTION_WINDOW,
        source: 'attention',
    };
}

export interface FocusRuntime {
    /** macOS 上有 Vision 时提供；没有时只用 sharp */
    vision?: (imagePath: string) => Promise<PhotoFocus | undefined>;
}

export async function findPhotoFocus(
    imagePath: string,
    runtime: FocusRuntime,
): Promise<PhotoFocus> {
    const found = runtime.vision ? await runtime.vision(imagePath) : undefined;
    return found ?? attentionFocus(imagePath);
}
