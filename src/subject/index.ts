// 人物或物体主体层：透明 PNG 直接用，普通照片在 macOS 上用系统抠图，结果按图片内容缓存。
// 不内置抠图模型，也不交给会重画人脸的生图模型。
import { createHash, randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import sharp from 'sharp';
import { type VisionCutoutRuntime, visionCutout } from './vision.ts';

export type SubjectMethod = 'transparent' | 'macos-vision';

export interface SubjectLayer {
    dataUri: string;
    width: number;
    height: number;
    method: SubjectMethod;
    /** 按脸裁到了头肩，下边是一道直切口，版式里要贴着画面底边放 */
    bust: boolean;
    /** 找到的脸在这张图里的位置。有脸时版式按脸定大小 */
    face?: FaceBox;
}

/** 人脸框，0 到 1，原点在左上角，x、y 是中心 */
export interface FaceBox {
    x: number;
    y: number;
    width: number;
    height: number;
}

export interface SubjectRuntime {
    /** 抠图结果缓存目录：有工作区时是 .beastcover/cache */
    cacheDir: string;
    cutout: (inputPath: string, outputPath: string) => Promise<void>;
    /** 在抠好的图里找脸，找不到返回 undefined。不提供时不按脸裁 */
    findFace?: (imagePath: string) => Promise<FaceBox | undefined>;
}

// 抠图的处理方式一变（比如开始按 EXIF 转正），这个数就加一，旧版本留下的缓存不再被复用。
const CUTOUT_CACHE_VERSION = 2;

// 透明像素至少占这么多，才算已经抠好的图。
const MIN_TRANSPARENT_SHARE = 0.02;
// 主体嵌进页面前的最长边，够 2 倍母版用，不让 data URI 无谓变大。
const MAX_SUBJECT_EDGE = 2400;
// 头肩裁切：保留到下巴往下 1.8 个脸高（大约胸口）。爆款缩略图里脸高中位数占画面 27%，
// 半身照整个塞进人物区时脸只有 15% 左右。
const BUST_BELOW_CHIN = 1.8;
// 下面要裁掉的不到这么多时就不裁，本来就是头肩照。
const MIN_BUST_CUT = 0.08;

/** 按脸把人物裁到头肩，只裁下边，左右不裁，免得胳膊上出现竖着的硬切口 */
async function bustCrop(
    trimmed: Buffer,
    findFace: SubjectRuntime['findFace'],
    workDir: string,
): Promise<{ bytes: Buffer; bust: boolean; face?: FaceBox }> {
    if (findFace === undefined) {
        return { bytes: trimmed, bust: false };
    }
    mkdirSync(workDir, { recursive: true });
    const probe = join(workDir, `face-${randomUUID()}.png`);
    let face: FaceBox | undefined;
    try {
        writeFileSync(probe, trimmed);
        face = await findFace(probe);
    } finally {
        rmSync(probe, { force: true });
    }
    const meta = await sharp(trimmed).metadata();
    if (face === undefined || meta.width === undefined || meta.height === undefined) {
        return { bytes: trimmed, bust: false };
    }
    const chin = (face.y + face.height / 2) * meta.height;
    const bottom = Math.round(
        Math.min(meta.height, chin + face.height * meta.height * BUST_BELOW_CHIN),
    );
    if (bottom > meta.height * (1 - MIN_BUST_CUT)) {
        return { bytes: trimmed, bust: false, face };
    }
    const cropped = await sharp(trimmed)
        .extract({ left: 0, top: 0, width: meta.width, height: bottom })
        .png()
        .toBuffer();
    // 裁掉下半身以后，两侧可能空出一截（伸开的手、拿着的东西），再去一次透明边，
    // 脸的位置跟着换算到新图里。
    const { data, info } = await sharp(cropped)
        .trim({ threshold: 1 })
        .png()
        .toBuffer({ resolveWithObject: true });
    const left = -(info.trimOffsetLeft ?? 0);
    const top = -(info.trimOffsetTop ?? 0);
    const moved: FaceBox = {
        x: (face.x * meta.width - left) / info.width,
        y: (face.y * meta.height - top) / info.height,
        width: (face.width * meta.width) / info.width,
        height: (face.height * meta.height) / info.height,
    };
    return { bytes: data, bust: true, face: moved };
}

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
    const cached = join(runtime.cacheDir, `subject-v${CUTOUT_CACHE_VERSION}-${hash}.png`);
    if (existsSync(cached)) {
        return cached;
    }
    mkdirSync(runtime.cacheDir, { recursive: true });
    // 每次调用写自己的临时文件，写完原子替换到缓存位置。同时抠同一张图时互不干扰，
    // 谁后写完谁覆盖，内容一样。
    const partial = `${cached}.${randomUUID()}.partial.png`;
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
    const shaped = await bustCrop(trimmed, runtime.findFace, runtime.cacheDir);
    const bytes = await sharp(shaped.bytes)
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
        bust: shaped.bust,
        ...(shaped.face === undefined ? {} : { face: shaped.face }),
    };
}

export function visionSubjectCutout(runtime: VisionCutoutRuntime) {
    return (inputPath: string, outputPath: string) => visionCutout(inputPath, outputPath, runtime);
}

export { NoSubjectFoundError, visionCutoutUnavailable } from './vision.ts';
