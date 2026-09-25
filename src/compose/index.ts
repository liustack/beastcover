// 一稿多端：同族平台共用一张母版，量一次字号、渲染一次，再按各平台的裁切框裁出来。
// 跨族不裁，每族各排一次版。
import { mkdirSync, writeFileSync } from 'node:fs';
import { basename, dirname, extname, join, resolve } from 'node:path';
import sharp from 'sharp';
import {
    type FamilyName,
    getFamily,
    getPlatform,
    type Platform,
    type PlatformName,
    type Rect,
} from '../platforms/index.ts';
import { type CoverRenderer, TextDoesNotFitError } from '../render/index.ts';
import {
    type CoverLayout,
    customLayout,
    familyLayout,
    type Headline,
    headlineClauses,
} from '../render/layout.ts';
import { framePhoto, photoFocusTarget, visibleFraction } from '../render/photo-cover.ts';
import type { PhotoFocus } from '../subject/vision.ts';
import { guidesOverlay } from './guides.ts';

export interface CoverTemplate {
    /** 模板要改版式时提供，比如有人物时把标题让到一侧 */
    layoutFor?(layout: CoverLayout): CoverLayout;
    /** 量字号用的页面：同样的版式和字体，不带照片等重资源 */
    measureHtml(layout: CoverLayout, headline: Headline): string;
    /** 版式有 accentArea 时提供：只排第二段大字的量字号页面，大字放在 .copy 里 */
    measureAccentHtml?(layout: CoverLayout, fontPx: number): string;
    /** 真正截图的页面，pixelWidth/pixelHeight 是截图的设备像素，照片按它预处理 */
    renderHtml(
        layout: CoverLayout,
        headline: Headline,
        pixelWidth: number,
        pixelHeight: number,
    ): Promise<string>;
}

export interface CoverTarget {
    platform: PlatformName;
    outputPath: string;
}

export interface ComposedCover {
    platform: PlatformName;
    outputPath: string;
    pixelWidth: number;
    pixelHeight: number;
    /** 标题在该平台信息流缩略图里的字号 */
    feedHeadlinePx: number;
}

export const MIN_HEADLINE_PX = 16;
/** 缩略图里标题低于这个字号就很难认出来 */
export const MIN_FEED_HEADLINE_PX = 10;
// 母版至少按 2 倍渲染，裁切后缩到平台像素，公众号这类小幅放大也不会发虚。
const MIN_MASTER_SCALE = 2;

// 字号上限：一行字最多占区域高度的九成，宽度上最少放得下四个字。
// 高的区域由宽度那条限住，两三个字不会大得离谱。扁长的标题带由高度那条限住，一行字可以撑满。
function maxHeadlinePx(area: Rect): number {
    return Math.max(MIN_HEADLINE_PX, Math.round(Math.min(area.height * 0.9, area.width * 0.25)));
}

// 整句不拆时字号不小于自由换行的 70%，就按标点换行，否则优先保证字大。
const KEEP_CLAUSES_MIN_RATIO = 0.7;

async function fitFontPx(
    renderer: CoverRenderer,
    template: CoverTemplate,
    layout: CoverLayout,
    keepClauses: boolean,
): Promise<number | undefined> {
    try {
        return await renderer.fitText({
            html: (fontPx) => template.measureHtml(layout, { fontPx, keepClauses }),
            width: layout.width,
            height: layout.height,
            box: layout.textArea,
            minPx: MIN_HEADLINE_PX,
            maxPx: maxHeadlinePx(layout.textArea),
        });
    } catch (error) {
        if (error instanceof TextDoesNotFitError) {
            return undefined;
        }
        throw error;
    }
}

async function fitAccent(
    renderer: CoverRenderer,
    template: CoverTemplate,
    layout: CoverLayout,
    where: string,
): Promise<number | undefined> {
    const area = layout.accentArea;
    const measure = template.measureAccentHtml;
    if (area === undefined || measure === undefined) {
        return undefined;
    }
    try {
        return await renderer.fitText({
            html: (fontPx) => measure(layout, fontPx),
            width: layout.width,
            height: layout.height,
            box: area,
            minPx: MIN_HEADLINE_PX,
            // 大字行高常压到 1 以下，上限放宽到区域高度的 1.3 倍，交给测量决定。
            maxPx: Math.max(MIN_HEADLINE_PX, Math.round(area.height * 1.3)),
        });
    } catch (error) {
        if (error instanceof TextDoesNotFitError) {
            throw new Error(
                `The big figure is too long to fit ${where} even at ${MIN_HEADLINE_PX}px. Shorten it.`,
            );
        }
        throw error;
    }
}

async function fitHeadline(
    renderer: CoverRenderer,
    template: CoverTemplate,
    layout: CoverLayout,
    text: string,
    where: string,
): Promise<Headline> {
    const accentPx = await fitAccent(renderer, template, layout, where);
    const accent = accentPx === undefined ? {} : { accentPx };
    const free = await fitFontPx(renderer, template, layout, false);
    if (free === undefined) {
        throw new Error(
            `The headline is too long to fit ${where} even at ${MIN_HEADLINE_PX}px. Shorten it.`,
        );
    }
    if (headlineClauses(text).length > 1) {
        const clauses = await fitFontPx(renderer, template, layout, true);
        if (clauses !== undefined && clauses >= free * KEEP_CLAUSES_MIN_RATIO) {
            return { fontPx: clauses, keepClauses: true, ...accent };
        }
    }
    return { fontPx: free, keepClauses: false, ...accent };
}

function writePng(outputPath: string, bytes: Buffer): string {
    const path = resolve(outputPath);
    if (extname(path).toLowerCase() !== '.png') {
        throw new Error(`Cover output must use the .png extension: ${path}`);
    }
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, bytes);
    return path;
}

function scaleRect(rect: Rect, factor: number): Rect {
    return {
        x: Math.round(rect.x * factor),
        y: Math.round(rect.y * factor),
        width: Math.round(rect.width * factor),
        height: Math.round(rect.height * factor),
    };
}

function intersect(a: Rect, b: Rect): Rect {
    const x = Math.max(a.x, b.x);
    const y = Math.max(a.y, b.y);
    return {
        x,
        y,
        width: Math.min(a.x + a.width, b.x + b.width) - x,
        height: Math.min(a.y + a.height, b.y + b.height) - y,
    };
}

/** 本次要出的这一族平台都看得见的区域：它们裁切框的交集，母版坐标 */
export function familyVisibleArea(family: FamilyName, platforms: readonly PlatformName[]): Rect {
    const crops = platforms
        .map((name) => getPlatform(name))
        .filter((platform) => platform.family === family)
        .map((platform) => platform.crop);
    const first = crops[0];
    if (first === undefined) {
        throw new Error(`No ${family} platform was requested.`);
    }
    return crops.slice(1).reduce(intersect, { ...first });
}

// 横跨可见区域这么宽的遮挡才算顶栏或底栏（抖音右侧那一列按钮不算）。
const BAR_WIDTH_SHARE = 0.8;

/** 可见区域去掉请求平台顶部和底部的界面栏：抖音的顶栏和底栏、B 站底部的数据栏 */
export function familyClearArea(family: FamilyName, platforms: readonly PlatformName[]): Rect {
    const visible = familyVisibleArea(family, platforms);
    let top = visible.y;
    let bottom = visible.y + visible.height;
    for (const name of platforms) {
        const platform = getPlatform(name);
        if (platform.family !== family) {
            continue;
        }
        for (const covered of platform.covered) {
            if (covered.width < visible.width * BAR_WIDTH_SHARE) {
                continue;
            }
            const middle = covered.y + covered.height / 2;
            if (middle < visible.y + visible.height / 2) {
                top = Math.max(top, covered.y + covered.height);
            } else {
                bottom = Math.min(bottom, covered.y);
            }
        }
    }
    return { x: visible.x, y: top, width: visible.width, height: bottom - top };
}

/** 多个平台时每个文件名后面加平台名，只有一个平台时原样返回 */
export function coverOutputPaths(
    outputPath: string,
    platforms: readonly PlatformName[],
): CoverTarget[] {
    if (platforms.length === 1) {
        return [{ platform: platforms[0] as PlatformName, outputPath }];
    }
    const extension = extname(outputPath);
    const stem = basename(outputPath, extension);
    return platforms.map((platform) => ({
        platform,
        outputPath: join(dirname(outputPath), `${stem}-${platform}${extension}`),
    }));
}

export async function composeCovers(input: {
    renderer: CoverRenderer;
    template: CoverTemplate;
    text: string;
    targets: readonly CoverTarget[];
    scale: number;
    guides?: boolean;
}): Promise<ComposedCover[]> {
    const masterScale = Math.max(MIN_MASTER_SCALE, input.scale);
    const byFamily = new Map<FamilyName, { platform: Platform; outputPath: string }[]>();
    for (const target of input.targets) {
        const platform = getPlatform(target.platform);
        const members = byFamily.get(platform.family) ?? [];
        members.push({ platform, outputPath: target.outputPath });
        byFamily.set(platform.family, members);
    }

    const composed = new Map<PlatformName, ComposedCover>();
    for (const [familyName, members] of byFamily) {
        const family = getFamily(familyName);
        const base = familyLayout(familyName);
        const names = members.map((member) => member.platform.name);
        const layout = {
            ...(input.template.layoutFor?.(base) ?? base),
            visibleArea: familyVisibleArea(familyName, names),
            clearArea: familyClearArea(familyName, names),
        };
        const headline = await fitHeadline(
            input.renderer,
            input.template,
            layout,
            input.text,
            `the ${members.map((member) => member.platform.name).join(', ')} safe area`,
        );
        const master = await input.renderer.screenshot({
            html: await input.template.renderHtml(
                layout,
                headline,
                Math.round(family.masterWidth * masterScale),
                Math.round(family.masterHeight * masterScale),
            ),
            width: family.masterWidth,
            height: family.masterHeight,
            scale: masterScale,
        });

        for (const { platform, outputPath } of members) {
            const pixelWidth = Math.round(platform.width * input.scale);
            const pixelHeight = Math.round(platform.height * input.scale);
            const crop = scaleRect(platform.crop, masterScale);
            let image = sharp(master)
                .extract({ left: crop.x, top: crop.y, width: crop.width, height: crop.height })
                // 裁切框取整后和成品比例差不到 0.2%，fill 拉满不会看出变形。
                .resize(pixelWidth, pixelHeight, { fit: 'fill' });
            if (input.guides) {
                image = sharp(await image.png().toBuffer()).composite([
                    {
                        input: guidesOverlay(
                            platform,
                            {
                                textArea: layout.textArea,
                                focusArea: family.focusArea,
                                ...(layout.subjectArea ? { subjectArea: layout.subjectArea } : {}),
                                ...(layout.accentArea ? { accentArea: layout.accentArea } : {}),
                            },
                            pixelWidth,
                            pixelHeight,
                        ),
                        left: 0,
                        top: 0,
                    },
                ]);
            }
            composed.set(platform.name, {
                platform: platform.name,
                outputPath: writePng(outputPath, await image.png().toBuffer()),
                pixelWidth,
                pixelHeight,
                feedHeadlinePx: (headline.fontPx * platform.feedWidth) / platform.crop.width,
            });
        }
    }

    return input.targets.map((target) => composed.get(target.platform) as ComposedCover);
}

/** --width/--height 自定义画布：不属于任何族，直接按画布排版截图 */
export async function composeCustomCover(input: {
    renderer: CoverRenderer;
    template: CoverTemplate;
    text: string;
    width: number;
    height: number;
    scale: number;
    outputPath: string;
}): Promise<{ outputPath: string; pixelWidth: number; pixelHeight: number }> {
    const base = customLayout(input.width, input.height);
    const canvas = { x: 0, y: 0, width: input.width, height: input.height };
    const layout = {
        ...(input.template.layoutFor?.(base) ?? base),
        visibleArea: canvas,
        clearArea: canvas,
    };
    const headline = await fitHeadline(
        input.renderer,
        input.template,
        layout,
        input.text,
        `a ${input.width}x${input.height} canvas`,
    );
    const pixelWidth = Math.round(input.width * input.scale);
    const pixelHeight = Math.round(input.height * input.scale);
    const png = await input.renderer.screenshot({
        html: await input.template.renderHtml(layout, headline, pixelWidth, pixelHeight),
        width: input.width,
        height: input.height,
        scale: input.scale,
    });
    return { outputPath: writePng(input.outputPath, png), pixelWidth, pixelHeight };
}

export function thumbnailWarnings(covers: readonly ComposedCover[]): string[] {
    return covers
        .filter((cover) => cover.feedHeadlinePx < MIN_FEED_HEADLINE_PX)
        .map((cover) => {
            const platform = getPlatform(cover.platform);
            return `Thumbnail: the headline is ${cover.feedHeadlinePx.toFixed(1)}px at ${platform.name} feed size (${platform.feedWidth}px wide). A shorter headline reads bigger.`;
        });
}

// 照片放大到这个倍数以上就会明显发虚。
export const MAX_PHOTO_STRETCH = 1.5;

/**
 * 照片要放大多少倍，超过 MAX_PHOTO_STRETCH 的列出来。cover 是照片铺满母版再裁出平台，
 * extend 是清晰照片整个放进同族平台的共同可见区域（模糊背景放大多少不算）。
 */
export function photoStretchWarnings(
    photo: { width: number; height: number },
    platforms: readonly PlatformName[],
    scale: number,
    fit: 'cover' | 'extend' = 'cover',
): string[] {
    return platforms.flatMap((name) => {
        const platform = getPlatform(name);
        const family = getFamily(platform.family);
        const fill =
            fit === 'extend'
                ? (() => {
                      const area = familyVisibleArea(platform.family, platforms);
                      return Math.min(area.width / photo.width, area.height / photo.height);
                  })()
                : Math.max(family.masterWidth / photo.width, family.masterHeight / photo.height);
        const stretch = fill * (platform.width / platform.crop.width) * scale;
        return stretch > MAX_PHOTO_STRETCH
            ? [
                  `Photo: ${photo.width}x${photo.height} is stretched ${stretch.toFixed(1)}x on ${name}. A larger photo stays sharp.`,
              ]
            : [];
    });
}

/**
 * 按实际构图算：照片在每族母版里摆好以后，主体范围落不进哪些平台的裁切框，就提示改用 --fit extend。
 * 构图和出图用的是同一个 framePhoto，提示和成品不会对不上。
 */
export function focusCropWarnings(
    photo: { width: number; height: number },
    focus: PhotoFocus,
    platforms: readonly PlatformName[],
    hasSubject = false,
): string[] {
    const families = [...new Set(platforms.map((name) => getPlatform(name).family))];
    return families.flatMap((familyName) => {
        const family = getFamily(familyName);
        const canvas = { width: family.masterWidth, height: family.masterHeight };
        const members = platforms.filter((name) => getPlatform(name).family === familyName);
        const visible = familyVisibleArea(familyName, members);
        const layout = { ...familyLayout(familyName), visibleArea: visible };
        const framed = framePhoto({
            source: photo,
            canvas,
            focus,
            target: photoFocusTarget(layout, hasSubject),
            visible: visibleFraction(layout),
        });
        // 主体范围换到母版坐标。
        const kx = canvas.width / framed.width;
        const ky = canvas.height / framed.height;
        const box: Rect = {
            x: ((focus.x - focus.width / 2) * photo.width - framed.left) * kx,
            y: ((focus.y - focus.height / 2) * photo.height - framed.top) * ky,
            width: focus.width * photo.width * kx,
            height: focus.height * photo.height * ky,
        };
        const cut = members.filter((name) => {
            const crop = getPlatform(name).crop;
            return (
                box.x < crop.x - 1 ||
                box.y < crop.y - 1 ||
                box.x + box.width > crop.x + crop.width + 1 ||
                box.y + box.height > crop.y + crop.height + 1
            );
        });
        return cut.length === 0
            ? []
            : [
                  `Photo: the subject falls outside the ${cut.join(', ')} crop. Add --fit extend to keep the whole photo.`,
              ];
    });
}
