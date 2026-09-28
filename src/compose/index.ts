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
import {
    checkBrightness,
    checkColourfulness,
    checkContrast,
    checkEdges,
    checkOverlaps,
    checkQuietZone,
    checkSubjects,
    clearCrop,
    colourfulness,
    detailUnder,
    type PictureSubject,
    type QcFinding,
    type QcTarget,
    realObjects,
    type TextMask,
    textMaskFrom,
    textOnPicture,
} from '../qc/index.ts';
import { type CoverRenderer, TextDoesNotFitError } from '../render/index.ts';
import {
    type CoverLayout,
    customLayout,
    familyLayout,
    type Headline,
    headlineClauses,
    unbreakableRuns,
} from '../render/layout.ts';
import { calloutGeometry, calloutLayout, framedFocusBox } from '../render/photo-cover.ts';
import type { ImageContents, PhotoFocus } from '../subject/vision.ts';
import { guidesOverlay } from './guides.ts';

export interface CoverTemplate {
    /** 模板要改版式时提供，比如有人物时把标题让到一侧 */
    layoutFor?(layout: CoverLayout): CoverLayout;
    /**
     * 备选排法，比如标题从照片下半截挪到上半截。第一种排法质检不过时按顺序试，
     * 留问题最少的一种。renderHtml 要按版式里标题的位置决定压暗和构图
     */
    placements?: readonly ((layout: CoverLayout) => CoverLayout)[];
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
    ): Promise<RenderedPage>;
}

/** 截图用的页面，和画面里必须完整露出来的主体（照片主体、人脸），质检逐个平台核对 */
export interface RenderedPage {
    html: string;
    subjects: readonly PictureSubject[];
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
    /** 这张成品的质检结果，文件照写，问题标出来 */
    findings: QcFinding[];
    /** 第一种排法质检不过，换成了模板的备选排法 */
    moved: boolean;
}

/** 质检：画面分析找人脸、人、自带文字、主体物。本机没有 Vision 时 analyze 为 undefined，只跳过这一项 */
export interface QcRuntime {
    analyze?(background: Buffer): Promise<ImageContents>;
}

/** 成品的平均亮度（BT.601，0-255） */
async function meanLuma(png: Buffer): Promise<number> {
    const { channels } = await sharp(png).removeAlpha().stats();
    const [r, g, b] = channels.map((channel) => channel.mean) as [number, number, number];
    return 0.299 * r + 0.587 * g + 0.114 * b;
}

/** 质检要的材料：不带字的背景、字迹、只压在照片上的字迹、画面分析（本机能看才有） */
interface MasterInspection {
    background: Buffer;
    withText: Buffer;
    /** 只画标题填色的一张，量对比度用 */
    headline: Buffer;
    text: TextMask;
    pictureText: TextMask;
    contents?: ImageContents;
}

/** 带字和不带字各渲一张比出字迹，不带字的交给画面分析 */
async function inspectMaster(
    renderer: CoverRenderer,
    qc: QcRuntime,
    page: { html: string; width: number; height: number },
): Promise<MasterInspection> {
    const inspected = await renderer.inspect({ ...page, scale: 1 });
    const text = await textMaskFrom(inspected.withText, inspected.background);
    const inspection: MasterInspection = {
        background: inspected.background,
        withText: inspected.withText,
        headline: inspected.headline,
        text,
        pictureText: await textOnPicture(text, inspected.background),
    };
    if (qc.analyze !== undefined) {
        const contents = await qc.analyze(inspected.background);
        inspection.contents = {
            ...contents,
            objects: await realObjects(inspected.background, contents.objects),
        };
    }
    return inspection;
}

/** 按一张成品的裁切框比对：字压没压住人脸、人、自带的字、主体，字下面花不花，整张暗不暗 */
async function findingsFor(
    target: QcTarget,
    crop: Rect,
    covered: readonly Rect[],
    page: RenderedPage,
    qc: MasterInspection,
    png: Buffer,
): Promise<QcFinding[]> {
    return [
        ...(await checkContrast({
            target,
            withText: qc.withText,
            background: qc.background,
            headline: qc.headline,
            crop,
        })),
        ...checkSubjects(target, page.subjects, crop, covered),
        ...(qc.contents === undefined
            ? []
            : checkOverlaps({
                  platform: target,
                  crop,
                  text: qc.text,
                  pictureText: qc.pictureText,
                  contents: qc.contents,
              })),
        ...checkEdges(target, qc.text, crop),
        ...checkQuietZone(target, await detailUnder(qc.background, qc.text, crop)),
        ...checkBrightness(target, await meanLuma(png)),
        ...checkColourfulness(target, await colourfulness(png)),
    ];
}

/**
 * 模板给了备选排法时，质检不过（字压住人脸、人、主体，或压在花的地方）就换下一种，
 * 留问题最少的那一种。看不了画面（没有 Vision）时没法比，用第一种。
 */
async function bestPlacement<T extends { outputs: readonly { findings: readonly QcFinding[] }[] }>(
    template: CoverTemplate,
    qc: QcRuntime | undefined,
    attempt: (place: ((layout: CoverLayout) => CoverLayout) | undefined) => Promise<T>,
): Promise<{ chosen: T; moved: boolean }> {
    const places = [template.layoutFor, ...(template.placements ?? [])];
    let chosen = await attempt(places[0]);
    let moved = false;
    if (qc?.analyze !== undefined) {
        for (const place of places.slice(1)) {
            if (placementScore(chosen.outputs) === 0) {
                break;
            }
            const next = await attempt(place);
            if (placementScore(next.outputs) < placementScore(chosen.outputs)) {
                chosen = next;
                moved = true;
            }
        }
    }
    return { chosen, moved };
}

/** 一种排法的问题分：不过关的按十个提醒算。0 表示干净 */
function placementScore(outputs: readonly { findings: readonly QcFinding[] }[]): number {
    return outputs
        .flatMap((output) => output.findings)
        .reduce((sum, finding) => sum + (finding.level === 'fail' ? 10 : 1), 0);
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
// 标题最多三行，再多就得一截一截拼着读。
const MAX_HEADLINE_LINES = 3;
// 少折一行只要字号不小于三行时的 70%，就少折一行：一眼读完比大一号更要紧。
const FEWER_LINES_MIN_RATIO = 0.7;

async function fitFontPx(
    renderer: CoverRenderer,
    template: CoverTemplate,
    layout: CoverLayout,
    keepClauses: boolean,
    maxLines: number,
): Promise<number | undefined> {
    try {
        return await renderer.fitText({
            html: (fontPx) => template.measureHtml(layout, { fontPx, keepClauses }),
            width: layout.width,
            height: layout.height,
            box: layout.textArea,
            minPx: MIN_HEADLINE_PX,
            maxPx: maxHeadlinePx(layout.textArea),
            maxLines,
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
    const largest = await fitFontPx(renderer, template, layout, false, MAX_HEADLINE_LINES);
    if (largest === undefined) {
        throw new Error(
            `The headline is too long to fit ${where} in ${MAX_HEADLINE_LINES} lines even at ${MIN_HEADLINE_PX}px. Shorten it.`,
        );
    }
    // 从一行试起，第一个字号够大的行数就是它。
    let free = largest;
    for (let lines = 1; lines < MAX_HEADLINE_LINES; lines += 1) {
        const size = await fitFontPx(renderer, template, layout, false, lines);
        if (size !== undefined && size >= largest * FEWER_LINES_MIN_RATIO) {
            free = size;
            break;
        }
    }
    if (headlineClauses(text).length > 1) {
        const clauses = await fitFontPx(renderer, template, layout, true, MAX_HEADLINE_LINES);
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

/** 本次要出的这一族平台的界面遮挡区（时长角标、点赞栏、按钮列），母版坐标 */
export function familyCoveredAreas(
    family: FamilyName,
    platforms: readonly PlatformName[],
): readonly Rect[] {
    return platforms
        .map((name) => getPlatform(name))
        .filter((platform) => platform.family === family)
        .flatMap((platform) => platform.covered);
}

/** 可见区域去掉请求平台顶部和底部的界面栏：抖音的顶栏和底栏、B 站底部的数据栏 */
export function familyClearArea(family: FamilyName, platforms: readonly PlatformName[]): Rect {
    return clearCrop(familyVisibleArea(family, platforms), familyCoveredAreas(family, platforms));
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
    qc?: QcRuntime;
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
        // 模板改版式时已经知道可见区和遮挡区（圈注要按它们算主体落点），改完再盖一遍，模板丢不掉。
        const areas = {
            visibleArea: familyVisibleArea(familyName, names),
            clearArea: familyClearArea(familyName, names),
            coveredAreas: familyCoveredAreas(familyName, names),
        };
        const framed = { ...base, ...areas };
        const where = `the ${members.map((member) => member.platform.name).join(', ')} safe area`;

        // 按一种排法出这一族：量字号、渲母版、质检、裁出每个平台。文件先不写，挑好排法再写。
        const attempt = async (place: ((layout: CoverLayout) => CoverLayout) | undefined) => {
            const layout = { ...(place?.(framed) ?? framed), ...areas };
            const headline = await fitHeadline(
                input.renderer,
                input.template,
                layout,
                input.text,
                where,
            );
            const page = await input.template.renderHtml(
                layout,
                headline,
                Math.round(family.masterWidth * masterScale),
                Math.round(family.masterHeight * masterScale),
            );
            const master = await input.renderer.screenshot({
                html: page.html,
                width: family.masterWidth,
                height: family.masterHeight,
                scale: masterScale,
            });
            const qc =
                input.qc === undefined
                    ? undefined
                    : await inspectMaster(input.renderer, input.qc, {
                          html: page.html,
                          width: family.masterWidth,
                          height: family.masterHeight,
                      });
            const outputs: {
                platform: Platform;
                outputPath: string;
                png: Buffer;
                findings: QcFinding[];
            }[] = [];
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
                                    ...(layout.subjectArea
                                        ? { subjectArea: layout.subjectArea }
                                        : {}),
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
                const png = await image.png().toBuffer();
                const findings =
                    qc === undefined
                        ? []
                        : await findingsFor(
                              platform.name,
                              platform.crop,
                              platform.covered,
                              page,
                              qc,
                              png,
                          );
                outputs.push({ platform, outputPath, png, findings });
            }
            return { headline, outputs };
        };

        const { chosen, moved } = await bestPlacement(input.template, input.qc, attempt);
        for (const { platform, outputPath, png, findings } of chosen.outputs) {
            composed.set(platform.name, {
                platform: platform.name,
                outputPath: writePng(outputPath, png),
                pixelWidth: Math.round(platform.width * input.scale),
                pixelHeight: Math.round(platform.height * input.scale),
                feedHeadlinePx: (chosen.headline.fontPx * platform.feedWidth) / platform.crop.width,
                findings,
                moved,
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
    qc?: QcRuntime;
}): Promise<{
    outputPath: string;
    pixelWidth: number;
    pixelHeight: number;
    findings: QcFinding[];
    moved: boolean;
}> {
    const base = customLayout(input.width, input.height);
    const canvas = { x: 0, y: 0, width: input.width, height: input.height };
    const areas = { visibleArea: canvas, clearArea: canvas, coveredAreas: [] };
    const framed = { ...base, ...areas };
    const pixelWidth = Math.round(input.width * input.scale);
    const pixelHeight = Math.round(input.height * input.scale);
    const attempt = async (place: ((layout: CoverLayout) => CoverLayout) | undefined) => {
        const layout = { ...(place?.(framed) ?? framed), ...areas };
        const headline = await fitHeadline(
            input.renderer,
            input.template,
            layout,
            input.text,
            `a ${input.width}x${input.height} canvas`,
        );
        const page = await input.template.renderHtml(layout, headline, pixelWidth, pixelHeight);
        const html = page.html;
        const png = await input.renderer.screenshot({
            html,
            width: input.width,
            height: input.height,
            scale: input.scale,
        });
        const findings =
            input.qc === undefined
                ? []
                : await findingsFor(
                      'canvas',
                      canvas,
                      [],
                      page,
                      await inspectMaster(input.renderer, input.qc, {
                          html,
                          width: input.width,
                          height: input.height,
                      }),
                      png,
                  );
        return { png, findings, outputs: [{ findings }] };
    };
    const { chosen, moved } = await bestPlacement(input.template, input.qc, attempt);
    return {
        outputPath: writePng(input.outputPath, chosen.png),
        pixelWidth,
        pixelHeight,
        findings: chosen.findings,
        moved,
    };
}

export function thumbnailWarnings(covers: readonly ComposedCover[]): string[] {
    return covers
        .filter((cover) => cover.feedHeadlinePx < MIN_FEED_HEADLINE_PX)
        .map((cover) => {
            const platform = getPlatform(cover.platform);
            return `Thumbnail: the headline is ${cover.feedHeadlinePx.toFixed(1)}px at ${platform.name} feed size (${platform.feedWidth}px wide). A shorter headline reads bigger.`;
        });
}

// 视频封面上字的上限，超了只提醒不拦。
// YouTube：vidIQ 500 个爆款里有字的中位数 5 个词，1of10 30 万条里最好的是不到 10 个字符，中文按 8 个字折算。
// B 站：136 张热门、排行、每周必看封面里，封面字中位数 8 个字，64% 不超过 10 个字，原样照搬
// 视频标题的只有 20%。其他平台没有数据，不提醒。
const COVER_TEXT_LIMITS: Partial<
    Record<PlatformName, { words: number; han: number; label: string }>
> = {
    youtube: { words: 5, han: 8, label: 'YouTube thumbnail' },
    bilibili: { words: 5, han: 10, label: 'Bilibili cover' },
};

/** 标题放在视频封面上太长时提醒一句。中英混排时两种上限按比例折算 */
export function headlineLengthWarnings(text: string, platforms: readonly PlatformName[]): string[] {
    const han = (text.match(/\p{Script=Han}/gu) ?? []).length;
    const words = unbreakableRuns(text).length;
    return platforms.flatMap((name) => {
        const limit = COVER_TEXT_LIMITS[name];
        if (limit === undefined || han / limit.han + words / limit.words <= 1) {
            return [];
        }
        return [
            `Headline: this is long for a ${limit.label}. Breakout covers there carry about ${limit.words} words or ${limit.han} Chinese characters at most, often fewer. Keep a short hook on the cover with --hook and the full line in the video title.`,
        ];
    });
}

/**
 * YouTube 上只有字的封面提醒一句。90 张头部频道的历史爆款里没有一张纯文字缩略图，
 * 带图的封面字号本来就落在爆款的范围里，缺的是图，不是更小的字。
 */
export function textOnlyWarnings(platforms: readonly PlatformName[], hasImage: boolean): string[] {
    if (hasImage || !platforms.includes('youtube')) {
        return [];
    }
    return [
        'Cover: this YouTube thumbnail is text only. Breakout thumbnails nearly always show a subject: a face, a product, or a striking object. Add --subject or --photo.',
    ];
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
 * --callout 在开浏览器前先算一遍：照片在每族母版（或自定义画布）里摆好以后，红圈和箭头
 * 能不能避开标题、裁切边和平台界面。检查、出图用的是同一个 framePhoto 和 calloutGeometry，
 * 过了检查就一定画得出来，过不了就在写任何文件之前报错，不留半套成品。
 */
export function checkCallout(
    photo: { width: number; height: number },
    focus: PhotoFocus,
    platforms: readonly PlatformName[],
    canvas?: { width: number; height: number },
): void {
    const check = (base: CoverLayout, where: string) => {
        const layout = calloutLayout(base, photo, focus, where);
        calloutGeometry(layout, framedFocusBox(photo, focus, layout, false), where);
    };
    if (canvas !== undefined) {
        const area = { x: 0, y: 0, width: canvas.width, height: canvas.height };
        check(
            {
                ...customLayout(canvas.width, canvas.height),
                visibleArea: area,
                clearArea: area,
                coveredAreas: [],
            },
            `the ${canvas.width}x${canvas.height} canvas`,
        );
        return;
    }
    const families = [...new Set(platforms.map((name) => getPlatform(name).family))];
    for (const familyName of families) {
        const members = platforms.filter((name) => getPlatform(name).family === familyName);
        check(
            {
                ...familyLayout(familyName),
                visibleArea: familyVisibleArea(familyName, members),
                clearArea: familyClearArea(familyName, members),
                coveredAreas: familyCoveredAreas(familyName, members),
            },
            members.join(', '),
        );
    }
}

/**
 * 按实际构图算：照片在每族母版里摆好以后，主体范围落不进哪些平台的裁切框，就提示改用 --fit extend。
 * 构图和出图用的是同一个 framePhoto，提示和成品不会对不上。
 */
export function focusCropWarnings(
    photo: { width: number; height: number },
    focus: PhotoFocus,
    platforms: readonly PlatformName[],
    /** 照片是人物身后的场景：按类型自己的版式和放大上限构图 */
    scene?: { layoutFor: (layout: CoverLayout) => CoverLayout; maxZoom: number },
): string[] {
    const families = [...new Set(platforms.map((name) => getPlatform(name).family))];
    return families.flatMap((familyName) => {
        const members = platforms.filter((name) => getPlatform(name).family === familyName);
        const base = {
            ...familyLayout(familyName),
            visibleArea: familyVisibleArea(familyName, members),
            clearArea: familyClearArea(familyName, members),
        };
        const layout = scene === undefined ? base : scene.layoutFor(base);
        // 主体范围换到母版坐标。
        const fraction = framedFocusBox(photo, focus, layout, scene !== undefined, scene?.maxZoom);
        const box: Rect = {
            x: fraction.x * layout.width,
            y: fraction.y * layout.height,
            width: fraction.width * layout.width,
            height: fraction.height * layout.height,
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
