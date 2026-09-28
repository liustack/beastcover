// 出图后的质检：机器能查的先查掉，查出来的问题照写文件，但标红告诉调用方。
// 判定依据：.issues/2026-09-27-breakout-design/research.md（背景只放一个场景线索、
// 字要压在安静区、别压人脸和画面自带的字、暗图一贯落后）。
import sharp from 'sharp';
import type { PlatformName, Rect } from '../platforms/index.ts';
import type { ImageContents, UnitBox } from '../subject/vision.ts';

export type QcLevel = 'fail' | 'warn';

/** 质检对象：一个平台的成品，或 --width/--height 的自定义画布 */
export type QcTarget = PlatformName | 'canvas';

export interface QcFinding {
    level: QcLevel;
    platform: QcTarget;
    message: string;
}

// 标题盖住人体框、画面自带文字框、主体物框的面积比例超过这些值就算压住了。人脸一碰就算。
const PERSON_SHARE = 0.1;
const TEXT_SHARE = 0.2;
const OBJECT_SHARE = 0.1;
// 显著性模型会在大片纯色、网点底上「看见」物体。框里亮度的标准差低于这个值，是平的，不算物体。
const FLAT_OBJECT_STD = 12;
// 显著区域比画面的六成还大，那是背景本身，不是主体。
const BACKGROUND_SHARE = 0.6;
// 亮度均值（0-255）低于这个值算暗图。爆款缩略图中位数 113，暗图一贯落后。
const DARK_LUMA = 80;
// 标题下面的细碎程度（缩到四分之一后的拉普拉斯均值）。实测：天空 6.7、水面 11.4、
// 海报网点 8.6，碎石地 34.9、岸边建筑 32.7，压暗遮罩下的碎石地 24.8（那里坐着一个
// Vision 认不出的人）。字要压在安静区，超过这个值就提醒。
const BUSY_DETAIL = 20;

function toMaster(box: UnitBox, master: { width: number; height: number }): Rect {
    return {
        x: box.x * master.width,
        y: box.y * master.height,
        width: box.width * master.width,
        height: box.height * master.height,
    };
}

function intersect(a: Rect, b: Rect): Rect | undefined {
    const x = Math.max(a.x, b.x);
    const y = Math.max(a.y, b.y);
    const right = Math.min(a.x + a.width, b.x + b.width);
    const bottom = Math.min(a.y + a.height, b.y + b.height);
    return right > x && bottom > y ? { x, y, width: right - x, height: bottom - y } : undefined;
}

function area(rect: Rect): number {
    return rect.width * rect.height;
}

/** 字块掩膜：1 表示这里有字（含描边、投影，略微膨胀连成块），和母版同尺寸（1 倍） */
export interface TextMask {
    width: number;
    height: number;
    data: Uint8Array;
}

// 带字和不带字两张图同一像素的颜色差超过这个值，算字迹。
const INK_DIFF = 24;
// 字迹膨胀的半径，按短边比例：把一行字的笔画连成一块，不至于大到吞掉字外的东西。
const DILATE_SHARE = 0.01;

/**
 * 字迹不看元素的盒子（块级元素会撑满整个文字区，伸到人物身上），看像素：带字和不带字
 * 各渲一张，颜色不一样的地方就是字（描边、投影都算），再膨胀一点连成字块。
 */
export async function textMaskFrom(withText: Buffer, background: Buffer): Promise<TextMask> {
    const a = await sharp(withText).removeAlpha().raw().toBuffer({ resolveWithObject: true });
    const b = await sharp(background).removeAlpha().raw().toBuffer({ resolveWithObject: true });
    const { width, height, channels } = a.info;
    if (b.info.width !== width || b.info.height !== height) {
        throw new Error('The text and background renders differ in size.');
    }
    const ink = Buffer.alloc(width * height);
    for (let i = 0; i < width * height; i += 1) {
        let diff = 0;
        for (let c = 0; c < channels; c += 1) {
            const offset = i * channels + c;
            diff = Math.max(diff, Math.abs((a.data[offset] ?? 0) - (b.data[offset] ?? 0)));
        }
        ink[i] = diff > INK_DIFF ? 255 : 0;
    }
    const radius = Math.max(2, Math.min(width, height) * DILATE_SHARE);
    // 模糊再取很低的阈值，等于往外膨胀大约一个模糊半径。
    const dilated = await sharp(ink, { raw: { width, height, channels: 1 } })
        .blur(radius / 2)
        .threshold(8)
        .extractChannel(0)
        .raw()
        .toBuffer();
    const data = new Uint8Array(width * height);
    for (let i = 0; i < data.length; i += 1) {
        data[i] = (dilated[i] ?? 0) > 0 ? 1 : 0;
    }
    return { width, height, data };
}

// 纯色设计块（色带、色块、渐变底）上的局部细节几乎为 0，照片哪怕是天空也有噪点和明暗。
// 拉普拉斯绝对值放大 16 倍后做局部平均，低于这个值就是纯色块。
const FLAT_PANEL_DETAIL = 24;

/**
 * 只留压在照片上的字迹。显著性模型的主体框常常连着旁边的纯色色带一起框进来，
 * 压在色带上的字什么也挡不住，不该算压住主体。人脸、人、画面自带的字不走这一步。
 */
export async function textOnPicture(mask: TextMask, background: Buffer): Promise<TextMask> {
    const { width, height } = mask;
    const lap = await sharp(background)
        .removeAlpha()
        .greyscale()
        .resize(width, height, { fit: 'fill' })
        .convolve({ width: 3, height: 3, kernel: [0, 1, 0, 1, -4, 1, 0, 1, 0], offset: 128 })
        .extractChannel(0)
        .raw()
        .toBuffer();
    const edges = Buffer.alloc(width * height);
    for (let i = 0; i < edges.length; i += 1) {
        edges[i] = Math.min(255, Math.abs((lap[i] ?? 128) - 128) * 16);
    }
    const local = await sharp(edges, { raw: { width, height, channels: 1 } })
        .blur(2)
        .extractChannel(0)
        .raw()
        .toBuffer();
    const data = new Uint8Array(width * height);
    for (let i = 0; i < data.length; i += 1) {
        data[i] = mask.data[i] === 1 && (local[i] ?? 0) >= FLAT_PANEL_DETAIL ? 1 : 0;
    }
    return { width, height, data };
}

/** 测试和简单场景用：把几个矩形画成字块掩膜 */
export function maskFromRects(width: number, height: number, rects: readonly Rect[]): TextMask {
    const data = new Uint8Array(width * height);
    for (const rect of rects) {
        const x0 = Math.max(0, Math.floor(rect.x));
        const y0 = Math.max(0, Math.floor(rect.y));
        const x1 = Math.min(width, Math.ceil(rect.x + rect.width));
        const y1 = Math.min(height, Math.ceil(rect.y + rect.height));
        for (let y = y0; y < y1; y += 1) {
            data.fill(1, y * width + x0, y * width + x1);
        }
    }
    return { width, height, data };
}

/** 字块压在某个框上的面积占那个框（只算平台看得见的部分）的比例 */
function coveredShare(box: Rect, mask: TextMask, crop: Rect): number {
    const seen = intersect(box, crop);
    if (seen === undefined) {
        return 0;
    }
    const x0 = Math.max(0, Math.floor(seen.x));
    const y0 = Math.max(0, Math.floor(seen.y));
    const x1 = Math.min(mask.width, Math.ceil(seen.x + seen.width));
    const y1 = Math.min(mask.height, Math.ceil(seen.y + seen.height));
    if (x1 <= x0 || y1 <= y0) {
        return 0;
    }
    let covered = 0;
    for (let y = y0; y < y1; y += 1) {
        for (let x = x0; x < x1; x += 1) {
            covered += mask.data[y * mask.width + x] ?? 0;
        }
    }
    return covered / ((x1 - x0) * (y1 - y0));
}

// 人脸压上一成就算（给描边投影的毛边留余地）。
const FACE_SHARE = 0.01;

/**
 * 去掉显著性模型在平坦区域上的幻觉框：在不带字的背景上量框里亮度的标准差，太平的不算物体。
 * 框的坐标是 0 到 1。
 */
export async function realObjects(
    background: Buffer,
    objects: readonly UnitBox[],
): Promise<UnitBox[]> {
    const { width, height } = await sharp(background).metadata();
    if (width === undefined || height === undefined) {
        throw new Error('Cannot read the QC background size.');
    }
    const kept: UnitBox[] = [];
    for (const box of objects) {
        const left = Math.max(0, Math.floor(box.x * width));
        const top = Math.max(0, Math.floor(box.y * height));
        const right = Math.min(width, Math.ceil((box.x + box.width) * width));
        const bottom = Math.min(height, Math.ceil((box.y + box.height) * height));
        if (right - left < 4 || bottom - top < 4) {
            continue;
        }
        // stats() 统计的是输入图，先把裁切缩放的结果落成缓冲区再统计。
        const region = await sharp(background)
            .extract({ left, top, width: right - left, height: bottom - top })
            .greyscale()
            .resize({ width: Math.max(4, Math.round((right - left) / 4)) })
            .png()
            .toBuffer();
        const { channels } = await sharp(region).stats();
        if ((channels[0]?.stdev ?? 0) >= FLAT_OBJECT_STD) {
            kept.push(box);
        }
    }
    return kept;
}

/** 标题有没有压到画面里的人脸、人、自带的字、主体物。只看这个平台裁切框里的部分 */
export function checkOverlaps(input: {
    platform: QcTarget;
    crop: Rect;
    text: TextMask;
    /** 只压在照片上的字迹（textOnPicture），主体物只和它比。不给就用 text */
    pictureText?: TextMask;
    contents: ImageContents;
}): QcFinding[] {
    const { platform, crop, text, contents } = input;
    const pictureText = input.pictureText ?? text;
    const master = { width: text.width, height: text.height };
    const canvas = master.width * master.height;
    const hits = (
        boxes: readonly UnitBox[],
        threshold: number,
        mask: TextMask,
        skipLarge = false,
    ): boolean =>
        boxes.some((unit) => {
            const box = toMaster(unit, master);
            if (skipLarge && area(box) > canvas * BACKGROUND_SHARE) {
                return false;
            }
            return coveredShare(box, mask, crop) > threshold;
        });
    const findings: QcFinding[] = [];
    const fail = (message: string) => findings.push({ level: 'fail', platform, message });
    if (hits(contents.faces, FACE_SHARE, text)) {
        fail('the headline covers a face in the picture.');
    }
    if (hits(contents.people, PERSON_SHARE, text)) {
        fail('the headline covers a person in the picture.');
    }
    if (hits(contents.text, TEXT_SHARE, text)) {
        fail('the headline covers text that is already in the picture.');
    }
    if (hits(contents.objects, OBJECT_SHARE, pictureText, true)) {
        fail("the headline covers the picture's main subject.");
    }
    return findings;
}

/**
 * 字块下面（只算平台看得见的部分）的细碎程度。先缩到四分之一，网点这类细纹理就平掉了，
 * 剩下的是物体和纹理的边缘，再在字块覆盖的像素上取拉普拉斯均值。
 */
export async function detailUnder(background: Buffer, text: TextMask, crop: Rect): Promise<number> {
    const width = Math.max(8, Math.round(text.width / 4));
    const height = Math.max(8, Math.round(text.height / 4));
    const bg = await sharp(background)
        .greyscale()
        .resize(width, height, { fit: 'fill' })
        .raw()
        .toBuffer();
    const at = (x: number, y: number) =>
        text.data[
            Math.min(text.height - 1, y * 4) * text.width + Math.min(text.width - 1, x * 4)
        ] ?? 0;
    const x0 = Math.max(1, Math.ceil(crop.x / 4));
    const y0 = Math.max(1, Math.ceil(crop.y / 4));
    const x1 = Math.min(width - 1, Math.floor((crop.x + crop.width) / 4));
    const y1 = Math.min(height - 1, Math.floor((crop.y + crop.height) / 4));
    let sum = 0;
    let count = 0;
    for (let y = y0; y < y1; y += 1) {
        for (let x = x0; x < x1; x += 1) {
            if (at(x, y) === 0) {
                continue;
            }
            const i = y * width + x;
            const center = bg[i] ?? 0;
            const laplacian =
                4 * center -
                (bg[i - 1] ?? center) -
                (bg[i + 1] ?? center) -
                (bg[i - width] ?? center) -
                (bg[i + width] ?? center);
            sum += Math.abs(laplacian);
            count += 1;
        }
    }
    return count === 0 ? 0 : sum / count;
}

/** 字要压在安静区：压在细碎的地方既可能盖住东西，缩小以后也更难读 */
/** 画面里必须完整露出来的一样东西：照片的主体、人脸。母版坐标 */
export interface PictureSubject {
    /** 报错时的称呼，比如 the after photo's subject、the face */
    name: string;
    /** 主体的框，可以伸出画布 */
    box: Rect;
    /** 这张照片占的地方：面板、格子，或整张画布 */
    frame: Rect;
    /** 至少要占平台看得清的区域短边的这么多（人脸要够大），不够就提醒 */
    minShare?: number;
}

// 横跨裁切框这么宽的遮挡才算顶栏或底栏（抖音右侧那一列按钮不算）。
const BAR_WIDTH_SHARE = 0.8;
// 显著性框的边本来就松，每条边允许偏出主体大小的这么多。
const SUBJECT_TOLERANCE = 0.03;
// 时长角标、侧边按钮列这类不横跨整幅的界面，盖住主体框这么多就算挡住了。
const SUBJECT_COVERED_SHARE = 0.1;

/** 平台真正让人看清的区域：裁切框去掉横跨整幅的顶栏和底栏 */
export function clearCrop(crop: Rect, covered: readonly Rect[]): Rect {
    let top = crop.y;
    let bottom = crop.y + crop.height;
    for (const rect of covered) {
        if (rect.width < crop.width * BAR_WIDTH_SHARE) {
            continue;
        }
        if (rect.y + rect.height / 2 < crop.y + crop.height / 2) {
            top = Math.max(top, rect.y + rect.height);
        } else {
            bottom = Math.min(bottom, rect.y);
        }
    }
    return { x: crop.x, y: top, width: crop.width, height: bottom - top };
}

/**
 * 一条边上主体露得对不对：主体放得下这个窗口时，整个主体都要在窗口里；放不下时，
 * 窗口里只能是主体，不能一边露空一边切掉主体。
 */
function shownAlong(s0: number, s1: number, v0: number, v1: number): boolean {
    const tolerance = (s1 - s0) * SUBJECT_TOLERANCE;
    return s1 - s0 <= v1 - v0
        ? s0 >= v0 - tolerance && s1 <= v1 + tolerance
        : v0 >= s0 - tolerance && v1 <= s1 + tolerance;
}

/** 照片的主体和人脸有没有被这个平台裁掉，或者压在顶栏底栏下面 */
export function checkSubjects(
    target: QcTarget,
    subjects: readonly PictureSubject[],
    crop: Rect,
    covered: readonly Rect[],
): QcFinding[] {
    const clear = clearCrop(crop, covered);
    return subjects.flatMap((subject): QcFinding[] => {
        const window = intersect(subject.frame, clear);
        const { box } = subject;
        // 放得下的主体要整个露出来，不能压在角标、按钮列下面。比窗口还大的主体本来就只露一部分，
        // 顶栏底栏已经从窗口里扣掉了。
        const fits =
            window !== undefined && box.width <= window.width && box.height <= window.height;
        const underButtons =
            fits &&
            covered.some((rect) => {
                if (rect.width >= crop.width * BAR_WIDTH_SHARE) {
                    return false;
                }
                const hidden = intersect(box, rect);
                return hidden !== undefined && area(hidden) > area(box) * SUBJECT_COVERED_SHARE;
            });
        const shown =
            window !== undefined &&
            !underButtons &&
            shownAlong(box.x, box.x + box.width, window.x, window.x + window.width) &&
            shownAlong(box.y, box.y + box.height, window.y, window.y + window.height);
        if (!shown) {
            return [
                {
                    level: 'fail',
                    platform: target,
                    message: `${subject.name} is cut off or hidden under the app's buttons. Pick a photo with more room around its subject, or another type.`,
                },
            ];
        }
        const share = box.height / Math.min(clear.width, clear.height);
        return subject.minShare !== undefined && share < subject.minShare
            ? [
                  {
                      level: 'warn',
                      platform: target,
                      message: `${subject.name} is small (${Math.round(share * 100)}% of the cover's short side, ${Math.round(subject.minShare * 100)}% or more reads in the feed). Use a photo cropped closer, head and shoulders.`,
                  },
              ]
            : [];
    });
}

// 标题和紧挨着它的颜色（WCAG）：大字至少 3:1，建议 4.5:1（research.md 第 4.1 节）。
const CONTRAST_FAIL = 3;
const CONTRAST_WARN = 4.5;
// 这个裁切框里标题填色少于这么多像素，就当标题不在这一版里。
const MIN_GLYPH_PIXELS = 200;
// 字外面离笔画 1 到 3 像素的一圈，就是眼睛拿来跟字比的颜色：有描边是描边，有色块是色块，
// 什么都没有就是照片。1 像素以内是抗锯齿的混色，不算。
const RING_INNER = 1;
const RING_OUTER = 3;
// 按小格子分别量，一处看不清不会被别处的反差拉平。
const CONTRAST_CELL = 16;
// 一个格子里字和外圈都至少有这么多像素才量。
const MIN_CELL_PIXELS = 4;
// 报告最差那一成字的对比度：九成的字够了还不算够，剩下一成看不清照样读不出整句。
const WEAKEST_SHARE = 0.1;

/** WCAG 相对亮度，sRGB 0-255 */
function relativeLuminance(r: number, g: number, b: number): number {
    const linear = (value: number) => {
        const c = value / 255;
        return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
    };
    return 0.2126 * linear(r) + 0.7152 * linear(g) + 0.0722 * linear(b);
}

function contrastRatio(a: number, b: number): number {
    return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
}

/** 方形膨胀：离某个 1 不超过 radius 像素（切比雪夫距离）的都变成 1 */
function dilate(mask: Uint8Array, width: number, height: number, radius: number): Uint8Array {
    const across = new Uint8Array(mask.length);
    for (let y = 0; y < height; y += 1) {
        const row = y * width;
        for (let x = 0; x < width; x += 1) {
            const last = Math.min(width - 1, x + radius);
            for (let d = Math.max(0, x - radius); d <= last; d += 1) {
                if (mask[row + d] === 1) {
                    across[row + x] = 1;
                    break;
                }
            }
        }
    }
    const out = new Uint8Array(mask.length);
    for (let x = 0; x < width; x += 1) {
        for (let y = 0; y < height; y += 1) {
            const last = Math.min(height - 1, y + radius);
            for (let d = Math.max(0, y - radius); d <= last; d += 1) {
                if (across[d * width + x] === 1) {
                    out[y * width + x] = 1;
                    break;
                }
            }
        }
    }
    return out;
}

/** 方形腐蚀：只留四周 radius 像素内全是 1 的点 */
function erode(mask: Uint8Array, width: number, height: number, radius: number): Uint8Array {
    const outside = mask.map((value) => 1 - value);
    return dilate(outside, width, height, radius).map((value) => 1 - value);
}

/**
 * 标题读不读得出来。字在哪不靠和背景比色差（和背景一个颜色的字就找不到了），靠单独渲的
 * 一张：只画标题填色，字黑其余全白。按小格子拿成品里字的颜色比两道边，取反差大的那道：
 * 字外面紧挨着的一圈（白字黑描边就是描边），和整块字迹（字加描边、投影）外面的一圈
 * （黑字黑描边压奶油底，眼睛看的是这一道）。所有格子里取最差那一成：半截压暗处半截压亮处的，
 * 亮处那半截会被量出来。
 */
export async function checkContrast(input: {
    target: QcTarget;
    withText: Buffer;
    background: Buffer;
    /** 只画标题填色的一张（CoverRenderer.inspect 的 headline）：字黑，其余全白 */
    headline: Buffer;
    crop: Rect;
}): Promise<QcFinding[]> {
    const decode = (png: Buffer) =>
        sharp(png).removeAlpha().raw().toBuffer({ resolveWithObject: true });
    const text = await decode(input.withText);
    const back = await decode(input.background);
    const glyphs = await sharp(input.headline)
        .removeAlpha()
        .greyscale()
        .raw()
        .toBuffer({ resolveWithObject: true });
    const { width, height, channels } = text.info;
    for (const other of [back.info, glyphs.info]) {
        if (other.width !== width || other.height !== height) {
            throw new Error('The headline, text, and background renders differ in size.');
        }
    }
    const x0 = Math.max(0, Math.floor(input.crop.x));
    const y0 = Math.max(0, Math.floor(input.crop.y));
    const w = Math.min(width, Math.ceil(input.crop.x + input.crop.width)) - x0;
    const h = Math.min(height, Math.ceil(input.crop.y + input.crop.height)) - y0;
    if (w <= 0 || h <= 0) {
        return [];
    }
    const glyph = new Uint8Array(w * h);
    // 整块字迹：标题填色，加上带字和不带字两张图不一样的地方（描边、投影、色块）。
    const stack = new Uint8Array(w * h);
    let glyphPixels = 0;
    for (let y = 0; y < h; y += 1) {
        for (let x = 0; x < w; x += 1) {
            const j = y * w + x;
            if ((glyphs.data[(y0 + y) * width + x0 + x] ?? 255) < 128) {
                glyph[j] = 1;
                stack[j] = 1;
                glyphPixels += 1;
                continue;
            }
            const i = ((y0 + y) * width + x0 + x) * channels;
            for (let c = 0; c < 3; c += 1) {
                if (Math.abs((text.data[i + c] ?? 0) - (back.data[i + c] ?? 0)) > INK_DIFF) {
                    stack[j] = 1;
                    break;
                }
            }
        }
    }
    if (glyphPixels < MIN_GLYPH_PIXELS) {
        return [];
    }
    const fill = erode(glyph, w, h, 1);
    const ringOf = (mask: Uint8Array) => {
        const near = dilate(mask, w, h, RING_INNER);
        const far = dilate(mask, w, h, RING_OUTER);
        return far.map((value, j) => (value === 1 && near[j] === 0 ? 1 : 0));
    };
    const layers = [fill, ringOf(glyph), ringOf(stack)];
    const columns = Math.ceil(w / CONTRAST_CELL);
    const rows = Math.ceil(h / CONTRAST_CELL);
    // 每格每层两个数：亮度和、像素数。层依次是字、字外一圈、整块字迹外一圈。
    const cells = new Float64Array(columns * rows * layers.length * 2);
    for (let y = 0; y < h; y += 1) {
        for (let x = 0; x < w; x += 1) {
            const j = y * w + x;
            const cell = Math.floor(y / CONTRAST_CELL) * columns + Math.floor(x / CONTRAST_CELL);
            let luminance: number | undefined;
            for (let layer = 0; layer < layers.length; layer += 1) {
                if (layers[layer]?.[j] !== 1) {
                    continue;
                }
                if (luminance === undefined) {
                    const i = ((y0 + y) * width + x0 + x) * channels;
                    luminance = relativeLuminance(
                        text.data[i] ?? 0,
                        text.data[i + 1] ?? 0,
                        text.data[i + 2] ?? 0,
                    );
                }
                const slot = (cell * layers.length + layer) * 2;
                cells[slot] = (cells[slot] ?? 0) + luminance;
                cells[slot + 1] = (cells[slot + 1] ?? 0) + 1;
            }
        }
    }
    // 描边有宽度，外面那一圈常常落在隔壁格子里：两道边都按周围 3x3 格子合起来算。
    const pooled = (column: number, row: number, layer: number) => {
        let sum = 0;
        let count = 0;
        for (let dy = -1; dy <= 1; dy += 1) {
            for (let dx = -1; dx <= 1; dx += 1) {
                const c = column + dx;
                const r = row + dy;
                if (c < 0 || r < 0 || c >= columns || r >= rows) {
                    continue;
                }
                const slot = ((r * columns + c) * layers.length + layer) * 2;
                sum += cells[slot] ?? 0;
                count += cells[slot + 1] ?? 0;
            }
        }
        return count >= MIN_CELL_PIXELS ? sum / count : undefined;
    };
    const measured: { ratio: number; weight: number }[] = [];
    for (let row = 0; row < rows; row += 1) {
        for (let column = 0; column < columns; column += 1) {
            const slot = (row * columns + column) * layers.length * 2;
            const fillCount = cells[slot + 1] ?? 0;
            if (fillCount < MIN_CELL_PIXELS) {
                continue;
            }
            const letter = (cells[slot] ?? 0) / fillCount;
            const edges = [pooled(column, row, 1), pooled(column, row, 2)].filter(
                (value): value is number => value !== undefined,
            );
            if (edges.length === 0) {
                continue;
            }
            measured.push({
                ratio: Math.max(...edges.map((edge) => contrastRatio(letter, edge))),
                weight: fillCount,
            });
        }
    }
    if (measured.length === 0) {
        return [];
    }
    measured.sort((a, b) => a.ratio - b.ratio);
    const total = measured.reduce((sum, cell) => sum + cell.weight, 0);
    let seen = 0;
    let ratio = measured[0]?.ratio ?? 0;
    for (const cell of measured) {
        seen += cell.weight;
        ratio = cell.ratio;
        if (seen >= total * WEAKEST_SHARE) {
            break;
        }
    }
    const shown = `${ratio.toFixed(1)}:1`;
    if (ratio < CONTRAST_FAIL) {
        return [
            {
                level: 'fail',
                platform: input.target,
                message: `the headline blends into what is behind it (contrast ${shown} on its weakest part, at least 3:1 needed). Pick a darker or lighter part of the picture, another --scheme, or another type.`,
            },
        ];
    }
    if (ratio < CONTRAST_WARN) {
        return [
            {
                level: 'warn',
                platform: input.target,
                message: `the headline is weak against what is behind it (contrast ${shown} on its weakest part, 4.5:1 reads well). Pick a calmer part of the picture or another --scheme.`,
            },
        ];
    }
    return [];
}

// 彩度（Hasler-Süsstrunk）：爆款缩略图大多在 50 到 80，只有字的旧模板量出来 9 到 15。
// 低于这个值画面发灰，提醒一句。
const DULL_COLOURFULNESS = 25;
// 这个公式是在自然照片上拟合的，全图统计把白底上的一小块亮色摊薄了。网页截图上它只有
// r = 0.71，白底加几个亮按钮的页面被明显低估（Reinecke 等 2013）。人判断有没有颜色更看
// 艳度而不是颜色多少（Amati 等 2014），所以一块够艳、够大的强调色也算有颜色。
// 色度按同一对对立通道算：荧光黄、红、橙、荧光绿在 200 以上，肤色和青底在 100 到 130。
// 0.5% 在小红书双列的缩略图上约 15 点见方，一眼看得到，零星的几个艳点凑不够。
const VIVID_CHROMA = 160;
const ACCENT_SHARE = 0.005;

export interface Colourfulness {
    /** Hasler-Süsstrunk 的 M3 */
    score: number;
    /** 色度到 VIVID_CHROMA 的像素占全图的比例 */
    vividShare: number;
}

/** 成品的彩度，Hasler-Süsstrunk 公式，加上够艳的像素占多少，缩到 640 宽再算 */
export async function colourfulness(png: Buffer): Promise<Colourfulness> {
    const { data, info } = await sharp(png)
        .removeAlpha()
        .resize({ width: 640 })
        .raw()
        .toBuffer({ resolveWithObject: true });
    let n = 0;
    let sumRg = 0;
    let sumYb = 0;
    let sumRg2 = 0;
    let sumYb2 = 0;
    let vivid = 0;
    for (let i = 0; i < data.length; i += info.channels) {
        const r = data[i] ?? 0;
        const g = data[i + 1] ?? 0;
        const b = data[i + 2] ?? 0;
        const rg = r - g;
        const yb = 0.5 * (r + g) - b;
        sumRg += rg;
        sumYb += yb;
        sumRg2 += rg * rg;
        sumYb2 += yb * yb;
        if (Math.hypot(rg, yb) >= VIVID_CHROMA) {
            vivid += 1;
        }
        n += 1;
    }
    const meanRg = sumRg / n;
    const meanYb = sumYb / n;
    const spread = Math.sqrt(sumRg2 / n - meanRg * meanRg + (sumYb2 / n - meanYb * meanYb));
    return {
        score: spread + 0.3 * Math.sqrt(meanRg * meanRg + meanYb * meanYb),
        vividShare: vivid / n,
    };
}

export function checkColourfulness(target: QcTarget, measured: Colourfulness): QcFinding[] {
    return measured.score < DULL_COLOURFULNESS && measured.vividShare < ACCENT_SHARE
        ? [
              {
                  level: 'warn',
                  platform: target,
                  message: `the cover has almost no colour (colourfulness ${Math.round(measured.score)}, breakout thumbnails sit around 50 to 80, and no vivid accent). Add one strong colour: another --scheme, a coloured keyword or tag, --look punch, or a more colourful photo.`,
              },
          ]
        : [];
}

// 贴着成品四边查这么宽的一条（像素）。字块掩膜已经往外膨胀了约 1% 短边，
// 字离边还有十来个像素就会碰到这条带，那已经近到会被裁掉或贴边难看。
const EDGE_BAND = 2;

/** 字碰到成品的边：多半被裁掉了一截（标签太长、特效伸出安全区） */
export function checkEdges(target: QcTarget, text: TextMask, crop: Rect): QcFinding[] {
    const x0 = Math.max(0, Math.ceil(crop.x));
    const y0 = Math.max(0, Math.ceil(crop.y));
    const x1 = Math.min(text.width, Math.floor(crop.x + crop.width)) - 1;
    const y1 = Math.min(text.height, Math.floor(crop.y + crop.height)) - 1;
    const inked = (x: number, y: number) => text.data[y * text.width + x] === 1;
    let touches = false;
    for (let band = 0; band < EDGE_BAND && !touches; band += 1) {
        for (let x = x0; x <= x1 && !touches; x += 1) {
            touches = inked(x, y0 + band) || inked(x, y1 - band);
        }
        for (let y = y0; y <= y1 && !touches; y += 1) {
            touches = inked(x0 + band, y) || inked(x1 - band, y);
        }
    }
    return touches
        ? [
              {
                  level: 'fail',
                  platform: target,
                  message:
                      'words run into the edge of the cover and are likely cut off. Shorten the headline or the labels.',
              },
          ]
        : [];
}

export function checkQuietZone(platform: QcTarget, detail: number): QcFinding[] {
    return detail > BUSY_DETAIL
        ? [
              {
                  level: 'warn',
                  platform,
                  message:
                      'the headline sits on a busy part of the picture, where it can hide something and reads worse when small. Move it to a calm area, or darken and blur under it.',
              },
          ]
        : [];
}

/** 暗图在信息流里一贯落后 */
export function checkBrightness(platform: QcTarget, meanLuma: number): QcFinding[] {
    return meanLuma < DARK_LUMA
        ? [
              {
                  level: 'warn',
                  platform,
                  message: `the cover is dark (brightness ${Math.round(meanLuma)} of 255). Bright covers consistently win in feeds; brighten the background or pick a lighter photo.`,
              },
          ]
        : [];
}

const RED = '\u001b[31m';
const YELLOW = '\u001b[33m';
const RESET = '\u001b[0m';

/** 同一条问题出现在几个平台时合成一行，失败在前、警告在后，最后一行是结论 */
export function formatFindings(findings: readonly QcFinding[], color: boolean): string[] {
    if (findings.length === 0) {
        return ['QC: passed.'];
    }
    const groups = new Map<string, { level: QcLevel; message: string; platforms: string[] }>();
    for (const finding of findings) {
        const key = `${finding.level}\u0000${finding.message}`;
        const group = groups.get(key) ?? {
            level: finding.level,
            message: finding.message,
            platforms: [],
        };
        if (!group.platforms.includes(finding.platform)) {
            group.platforms.push(finding.platform);
        }
        groups.set(key, group);
    }
    const ordered = [...groups.values()].sort((a, b) =>
        a.level === b.level ? 0 : a.level === 'fail' ? -1 : 1,
    );
    const lines = ordered.map((group) => {
        const label = group.level === 'fail' ? 'QC FAIL' : 'QC WARN';
        const paint = group.level === 'fail' ? RED : YELLOW;
        const line = `${label} ${group.platforms.join(', ')}: ${group.message}`;
        return color ? `${paint}${line}${RESET}` : line;
    });
    const failures = ordered.filter((group) => group.level === 'fail').length;
    lines.push(
        failures > 0
            ? `QC: ${failures} problem${failures === 1 ? '' : 's'} ${failures === 1 ? 'fails' : 'fail'} the check. The files were written; fix the cover before you ship it.`
            : 'QC: no failures. Read the warnings before you ship.',
    );
    return lines;
}
