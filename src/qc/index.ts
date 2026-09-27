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
