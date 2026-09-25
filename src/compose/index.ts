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
import { guidesOverlay } from './guides.ts';

export interface CoverTemplate {
    /** 模板要改版式时提供，比如有人物时把标题让到一侧 */
    layoutFor?(layout: CoverLayout): CoverLayout;
    /** 量字号用的页面：同样的版式和字体，不带照片等重资源 */
    measureHtml(layout: CoverLayout, headline: Headline): string;
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

function maxHeadlinePx(area: Rect): number {
    return Math.max(MIN_HEADLINE_PX, Math.round(Math.min(area.height * 0.45, area.width * 0.25)));
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

async function fitHeadline(
    renderer: CoverRenderer,
    template: CoverTemplate,
    layout: CoverLayout,
    text: string,
    where: string,
): Promise<Headline> {
    const free = await fitFontPx(renderer, template, layout, false);
    if (free === undefined) {
        throw new Error(
            `The headline is too long to fit ${where} even at ${MIN_HEADLINE_PX}px. Shorten it.`,
        );
    }
    if (headlineClauses(text).length > 1) {
        const clauses = await fitFontPx(renderer, template, layout, true);
        if (clauses !== undefined && clauses >= free * KEEP_CLAUSES_MIN_RATIO) {
            return { fontPx: clauses, keepClauses: true };
        }
    }
    return { fontPx: free, keepClauses: false };
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
        const layout = input.template.layoutFor?.(base) ?? base;
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
    const layout = input.template.layoutFor?.(base) ?? base;
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

/** 照片铺满母版再裁出每个平台时要放大多少倍，超过 MAX_PHOTO_STRETCH 的列出来 */
export function photoStretchWarnings(
    photo: { width: number; height: number },
    platforms: readonly PlatformName[],
    scale: number,
): string[] {
    return platforms.flatMap((name) => {
        const platform = getPlatform(name);
        const family = getFamily(platform.family);
        const cover = Math.max(
            family.masterWidth / photo.width,
            family.masterHeight / photo.height,
        );
        const stretch = cover * (platform.width / platform.crop.width) * scale;
        return stretch > MAX_PHOTO_STRETCH
            ? [
                  `Photo: ${photo.width}x${photo.height} is stretched ${stretch.toFixed(1)}x on ${name}. A larger photo stays sharp.`,
              ]
            : [];
    });
}
