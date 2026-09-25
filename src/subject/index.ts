// 人物或物体主体层：透明 PNG 直接用，普通照片在 macOS 上用系统抠图，结果按图片内容缓存。
// 不内置抠图模型，也不交给会重画人脸的生图模型。
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import sharp from 'sharp';
import { type VisionCutoutRuntime, visionCutout } from './vision.ts';

export type SubjectMethod = 'transparent' | 'macos-vision';

export interface SubjectLayer {
    dataUri: string;
    width: number;
    height: number;
    method: SubjectMethod;
}

export interface SubjectRuntime {
    /** 抠图结果缓存目录：有工作区时是 .beastcover/cache */
    cacheDir: string;
    cutout: (inputPath: string, outputPath: string) => Promise<void>;
}

// 透明像素至少占这么多，才算已经抠好的图。
const MIN_TRANSPARENT_SHARE = 0.02;
// 主体嵌进页面前的最长边，够 2 倍母版用，不让 data URI 无谓变大。
const MAX_SUBJECT_EDGE = 2400;

async function transparentShare(imagePath: string): Promise<number> {
    const image = sharp(imagePath, { failOn: 'error' });
    const meta = await image.metadata();
    if (!meta.hasAlpha) {
        return 0;
    }
    const { data, info } = await image
        .extractChannel('alpha')
        .raw()
        .toBuffer({ resolveWithObject: true });
    let transparent = 0;
    for (let i = 0; i < data.length; i += 1) {
        if ((data[i] ?? 255) < 16) {
            transparent += 1;
        }
    }
    return transparent / (info.width * info.height);
}

async function cutoutCached(imagePath: string, runtime: SubjectRuntime): Promise<string> {
    const hash = createHash('sha256').update(readFileSync(imagePath)).digest('hex').slice(0, 16);
    const cached = join(runtime.cacheDir, `subject-${hash}.png`);
    if (existsSync(cached)) {
        return cached;
    }
    mkdirSync(runtime.cacheDir, { recursive: true });
    const partial = `${cached}.partial.png`;
    try {
        await runtime.cutout(imagePath, partial);
        renameSync(partial, cached);
    } finally {
        rmSync(partial, { force: true });
    }
    return cached;
}

export async function prepareSubject(
    imagePath: string,
    runtime: SubjectRuntime,
): Promise<SubjectLayer> {
    const method: SubjectMethod =
        (await transparentShare(imagePath)) >= MIN_TRANSPARENT_SHARE
            ? 'transparent'
            : 'macos-vision';
    const sourcePath =
        method === 'transparent' ? imagePath : await cutoutCached(imagePath, runtime);

    // 去掉四周的全透明边，主体才能贴着版位底边和侧边放。
    const trimmed = await sharp(sourcePath).rotate().trim({ threshold: 1 }).png().toBuffer();
    const bytes = await sharp(trimmed)
        .resize(MAX_SUBJECT_EDGE, MAX_SUBJECT_EDGE, { fit: 'inside', withoutEnlargement: true })
        .png()
        .toBuffer();
    const meta = await sharp(bytes).metadata();
    if (meta.width === undefined || meta.height === undefined) {
        throw new Error(`Cannot read the subject size from ${imagePath}.`);
    }
    return {
        dataUri: `data:image/png;base64,${bytes.toString('base64')}`,
        width: meta.width,
        height: meta.height,
        method,
    };
}

export function visionSubjectCutout(runtime: VisionCutoutRuntime) {
    return (inputPath: string, outputPath: string) => visionCutout(inputPath, outputPath, runtime);
}

export { NoSubjectFoundError, visionCutoutUnavailable } from './vision.ts';
