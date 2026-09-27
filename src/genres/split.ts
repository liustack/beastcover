// 两张图并排的两类封面。
// 档位对比：两半等大、等亮，各挂一块倾斜的价签，中缝一枚 VS 徽章。平局本身就是卖点（research.md 第 3.1 节）。
// 前后对比：左前右后（竖版上前下后），两半同亮度，各贴一个前后标签，中缝一支箭头。
// 两类的标题都放在单独的实色标题带里，不压在照片上：压在照片上的字总会挡到其中一半的主体。
import sharp from 'sharp';
import type { CoverTemplate, RenderedPage } from '../compose/index.ts';
import type { FamilyName, Rect } from '../platforms/index.ts';
import type { PictureSubject } from '../qc/index.ts';
import type { CoverLayout, Headline } from '../render/layout.ts';
import { type PhotoLook, preparePhotoLayer } from '../render/photo-cover.ts';
import type { TypeSpec } from '../render/type.ts';
import {
    type ChipSpec,
    chips,
    type FontKit,
    type GenrePhoto,
    genrePage,
    joinLayers,
    type Layers,
    photoLayers,
    photoSubject,
    rectCss,
    seenPart,
} from './page.ts';
import { isLightScheme, SCHEMES, type SchemeName } from './schemes.ts';

export const MAX_LABEL_LENGTH = 8;

export function parseLabels(value: string): [string, string] {
    const parts = value.split(',').map((part) => part.trim());
    if (parts.length !== 2 || parts.some((part) => part === '')) {
        throw new Error('--labels takes two labels separated by a comma, like "¥15,¥1500".');
    }
    for (const part of parts) {
        if (Array.from(part).length > MAX_LABEL_LENGTH) {
            throw new Error(`Each --labels entry must be ${MAX_LABEL_LENGTH} characters or fewer.`);
        }
    }
    return [parts[0] as string, parts[1] as string];
}

type Split = 'columns' | 'rows';

interface SplitGeometry {
    split: Split;
    /** 标题带（实色），和标题区 */
    band: Rect;
    textArea: Rect;
    panels: [Rect, Rect];
    /** 中缝徽章的圆心和直径；没有就不放 */
    badge?: { x: number; y: number; size: number };
    /** 两个标签的锚点 */
    labels: [ChipAnchor, ChipAnchor];
    labelPx: number;
}

interface ChipAnchor {
    x: number;
    y: number;
    anchor: 'center' | 'start';
}

// 母版坐标。标题区都在族的安全区里（src/genres/layout.test.ts 核对每个平台的裁切框和遮挡区）。
// 档位对比：标题带在上，两半左右分，价签挂在标题带下沿、骑在两半的上边。
const VERSUS: Readonly<Record<FamilyName, SplitGeometry>> = {
    landscape: {
        split: 'columns',
        band: { x: 0, y: 0, width: 1920, height: 430 },
        textArea: { x: 192, y: 132, width: 1536, height: 240 },
        panels: [
            { x: 0, y: 430, width: 960, height: 770 },
            { x: 960, y: 430, width: 960, height: 770 },
        ],
        badge: { x: 960, y: 800, size: 210 },
        // 价签倾斜 4 度，最宽时一端会翘起约 30px，锚点比标题区下沿低出这一截。
        labels: [
            { x: 480, y: 404, anchor: 'center' },
            { x: 1440, y: 404, anchor: 'center' },
        ],
        labelPx: 104,
    },
    portrait: {
        split: 'columns',
        band: { x: 0, y: 0, width: 1080, height: 760 },
        textArea: { x: 86, y: 384, width: 842, height: 290 },
        panels: [
            { x: 0, y: 760, width: 540, height: 1160 },
            { x: 540, y: 760, width: 540, height: 1160 },
        ],
        badge: { x: 540, y: 1180, size: 160 },
        labels: [
            { x: 270, y: 700, anchor: 'center' },
            { x: 800, y: 700, anchor: 'center' },
        ],
        labelPx: 84,
    },
    ultrawide: {
        split: 'columns',
        band: { x: 0, y: 0, width: 1920, height: 270 },
        textArea: { x: 154, y: 72, width: 1612, height: 150 },
        panels: [
            { x: 0, y: 270, width: 960, height: 498 },
            { x: 960, y: 270, width: 960, height: 498 },
        ],
        badge: { x: 960, y: 520, size: 150 },
        labels: [
            { x: 480, y: 254, anchor: 'center' },
            { x: 1440, y: 254, anchor: 'center' },
        ],
        labelPx: 66,
    },
};

// 前后对比排成左右两半时，和档位对比同一套几何，标签小一号、不倾斜。
const BEFORE_AFTER: Readonly<Record<FamilyName, SplitGeometry>> = {
    landscape: { ...VERSUS.landscape, labelPx: 84 },
    portrait: { ...VERSUS.portrait, labelPx: 64 },
    ultrawide: { ...VERSUS.ultrawide, labelPx: 56 },
};

// 竖版前后对比上下分时：标题带（也是中缝）占画布高度的比例，前后标签的字号占画布宽度的比例。
const ROWS_BAND_SHARE = 0.156;
const ROWS_LABEL_SHARE = 0.06;
// 横图（宽高比不小于这个值）才上下分：竖图塞进扁长条会被切掉大半。
const LANDSCAPE_PHOTO = 1.15;

/**
 * 竖版前后对比、两张都是横图时上下分：两半按平台真正看得见的那一截（可见区去掉顶栏底栏）来分，
 * 标题带落在那一截的正中，不把半张照片浪费在被裁掉或被挡住的地方。
 */
function rowsGeometry(layout: CoverLayout): SplitGeometry {
    const { width, height } = layout;
    const clear = layout.clearArea ?? { x: 0, y: 0, width, height };
    const band = Math.round(height * ROWS_BAND_SHARE);
    const bandTop = Math.round(clear.y + (clear.height - band) / 2);
    const bandBottom = bandTop + band;
    const badge = Math.round(band * 0.41);
    const labelPx = Math.round(width * ROWS_LABEL_SHARE);
    const padTop = Math.round(band * 0.083);
    return {
        split: 'rows',
        band: { x: 0, y: bandTop, width, height: band },
        // 标题横向沿用族的安全区，纵向在标题带里，下面让出箭头的上半个。
        textArea: {
            x: layout.textArea.x,
            y: bandTop + padTop,
            width: layout.textArea.width,
            height: band - padTop - Math.round(badge * 0.6),
        },
        // 两半就是看得清的那两截：照片按它们构图，被裁掉或被界面挡住的地方只留底色。
        panels: [
            { x: 0, y: clear.y, width, height: bandTop - clear.y },
            { x: 0, y: bandBottom, width, height: clear.y + clear.height - bandBottom },
        ],
        // 箭头骑在标题带下沿，朝下指向「后」。
        badge: { x: Math.round(width / 2), y: bandBottom, size: badge },
        labels: [
            { x: layout.textArea.x, y: clear.y + Math.round(labelPx * 0.9), anchor: 'start' },
            {
                x: layout.textArea.x,
                y: bandBottom + Math.round(badge / 2 + labelPx * 0.6),
                anchor: 'start',
            },
        ],
        labelPx,
    };
}

function familyOf(layout: CoverLayout): FamilyName {
    if (layout.family !== undefined) {
        return layout.family;
    }
    const ratio = layout.width / layout.height;
    return ratio >= 2 ? 'ultrawide' : ratio >= 1 ? 'landscape' : 'portrait';
}

const MASTER: Readonly<Record<FamilyName, { width: number; height: number }>> = {
    landscape: { width: 1920, height: 1200 },
    portrait: { width: 1080, height: 1920 },
    ultrawide: { width: 1920, height: 768 },
};

/**
 * 这张封面的分屏几何。竖版前后对比、两张都是横图时上下分，其余左右分。
 * 自定义画布按最接近的族等比换算。
 */
function splitGeometry(
    layout: CoverLayout,
    kind: 'versus' | 'before-after',
    photos: readonly [GenrePhoto, GenrePhoto],
): SplitGeometry {
    const landscapePhotos = photos.every((photo) => photo.width >= photo.height * LANDSCAPE_PHOTO);
    if (kind === 'before-after' && familyOf(layout) === 'portrait' && landscapePhotos) {
        return rowsGeometry(layout);
    }
    return geometryFor(layout, kind === 'versus' ? VERSUS : BEFORE_AFTER);
}

function geometryFor(layout: CoverLayout, table: Record<FamilyName, SplitGeometry>): SplitGeometry {
    const family = familyOf(layout);
    const geometry = table[family];
    if (layout.family !== undefined) {
        return geometry;
    }
    const master = MASTER[family];
    const sx = layout.width / master.width;
    const sy = layout.height / master.height;
    const rect = (r: Rect): Rect => ({
        x: Math.round(r.x * sx),
        y: Math.round(r.y * sy),
        width: Math.round(r.width * sx),
        height: Math.round(r.height * sy),
    });
    const s = Math.min(sx, sy);
    return {
        split: geometry.split,
        band: rect(geometry.band),
        textArea: rect(geometry.textArea),
        panels: [rect(geometry.panels[0]), rect(geometry.panels[1])],
        ...(geometry.badge === undefined
            ? {}
            : {
                  badge: {
                      x: Math.round(geometry.badge.x * sx),
                      y: Math.round(geometry.badge.y * sy),
                      size: Math.round(geometry.badge.size * s),
                  },
              }),
        labels: [
            { ...geometry.labels[0], x: geometry.labels[0].x * sx, y: geometry.labels[0].y * sy },
            { ...geometry.labels[1], x: geometry.labels[1].x * sx, y: geometry.labels[1].y * sy },
        ],
        labelPx: Math.round(geometry.labelPx * s),
    };
}

// 标签的字宽（em），宁宽勿窄：CJK、韩文、假名、全角符号一个字宽，emoji 更宽，其他非 ASCII 字母
// 按 0.8，ASCII 按粗体里的宽度（W、M 最宽）。窄粗体实际更窄，估宽只会让标签小一点，不会压住。
// 再加左右内边距 0.72em，描边和硬投影共 0.21em。高度按 1.6em 估（行高、内边距、描边、倾斜）。
const CHIP_PAD_EM = 0.93;
const CHIP_HEIGHT_EM = 1.6;
const EMOJI = /\p{Extended_Pictographic}/u;

function charWidthEm(char: string): number {
    const code = char.codePointAt(0) ?? 0;
    if (EMOJI.test(char)) {
        return 1.3;
    }
    if (code >= 0x1100) {
        return 1;
    }
    if (code > 0x7e) {
        return 0.8;
    }
    if ('WMmw@%'.includes(char)) {
        return 1;
    }
    if (/[A-Z0-9#$&¥]/.test(char)) {
        return 0.78;
    }
    if (/[a-z]/.test(char)) {
        return 0.66;
    }
    return 0.45;
}

export function chipWidthEm(text: string): number {
    return Array.from(text).reduce((sum, char) => sum + charWidthEm(char), 0) + CHIP_PAD_EM;
}

// 档位对比的价签左右各倾斜这么多度。
const LABEL_TILT = 4;

/** 标签在这个字号下大约占的框：居中的以锚点为中，靠左的从锚点起，倾斜翘起的两端也算上 */
function chipRect(anchor: ChipAnchor, text: string, fontPx: number, tilt: number): Rect {
    const width = chipWidthEm(text) * fontPx;
    const lift = (width / 2) * Math.sin((Math.abs(tilt) * Math.PI) / 180);
    return {
        x: anchor.anchor === 'center' ? anchor.x - width / 2 : anchor.x,
        y: anchor.y - lift,
        width,
        height: CHIP_HEIGHT_EM * fontPx + lift * 2,
    };
}

/**
 * 两个标签用同一个字号：各自放进自己面板里平台看得见的那一截，躲开平台界面（抖音右侧按钮列），
 * 取两者里小的，最大是版式给的字号。长标签缩小，不会互相压住或被裁掉。
 */
export function labelFontPx(
    geometry: SplitGeometry,
    layout: CoverLayout,
    labels: readonly [string, string],
): number {
    const visible = layout.visibleArea ?? {
        x: 0,
        y: 0,
        width: layout.width,
        height: layout.height,
    };
    const covered = layout.coveredAreas ?? [];
    const fits = geometry.labels.map((anchor, index) => {
        const panel = geometry.panels[index] as Rect;
        const top = anchor.y;
        const bottom = anchor.y + CHIP_HEIGHT_EM * geometry.labelPx;
        let left = Math.max(panel.x, visible.x);
        let right = Math.min(panel.x + panel.width, visible.x + visible.width);
        for (const rect of covered) {
            if (rect.y >= bottom || rect.y + rect.height <= top) {
                continue;
            }
            if (rect.x >= anchor.x) {
                right = Math.min(right, rect.x);
            } else if (rect.x + rect.width <= anchor.x) {
                left = Math.max(left, rect.x + rect.width);
            }
        }
        const room =
            anchor.anchor === 'center'
                ? 2 * Math.min(anchor.x - left, right - anchor.x)
                : right - anchor.x;
        // 留一成余量给倾斜和字形宽度的误差。
        return (room * 0.9) / chipWidthEm(labels[index] as string);
    });
    return Math.floor(Math.min(geometry.labelPx, ...fits));
}

/** 测试用：这张封面的分屏几何和标签框 */
export function splitLabelRects(
    kind: 'versus' | 'before-after',
    layout: CoverLayout,
    labels: readonly [string, string],
    photos: readonly [GenrePhoto, GenrePhoto],
): { rects: Rect[]; panels: readonly Rect[]; badge?: Rect; fontPx: number } {
    const geometry = splitGeometry(layout, kind, photos);
    const fontPx = labelFontPx(geometry, layout, labels);
    return {
        rects: geometry.labels.map((anchor, index) =>
            chipRect(anchor, labels[index] as string, fontPx, kind === 'versus' ? LABEL_TILT : 0),
        ),
        panels: geometry.panels,
        ...(geometry.badge === undefined
            ? {}
            : {
                  badge: {
                      x: geometry.badge.x - geometry.badge.size / 2,
                      y: geometry.badge.y - geometry.badge.size / 2,
                      width: geometry.badge.size,
                      height: geometry.badge.size,
                  },
              }),
        fontPx,
    };
}

// 两半亮度拉平时最多调这么多，再多照片就发灰或过曝了。
const BRIGHTNESS_RANGE: [number, number] = [0.8, 1.25];

async function meanLuma(jpeg: Buffer): Promise<number> {
    const { channels } = await sharp(jpeg).removeAlpha().stats();
    const [r, g, b] = channels.map((channel) => channel.mean) as [number, number, number];
    return 0.299 * r + 0.587 * g + 0.114 * b;
}

/**
 * 两张照片按各自面板构图，再把亮度拉到两者的平均：一半更亮等于替观众下了结论（research.md 第 3.5 节）。
 * 主体放进面板里平台看得见、又不被标签挡住的那一截。
 */
async function panelPhotos(
    layout: CoverLayout,
    geometry: SplitGeometry,
    photos: readonly [GenrePhoto, GenrePhoto],
    scale: number,
): Promise<{ dataUri: string; rect: Rect; brightness: number; focusBox?: Rect }[]> {
    const prepared = await Promise.all(
        geometry.panels.map(async (panel, index) => {
            const photo = photos[index] as GenrePhoto;
            const seen = seenPart(panel, layout);
            // 标签挂在这一截上边时，主体往下让开标签那一段。
            const label = geometry.labels[index] as ChipAnchor;
            const labelBottom = label.y + geometry.labelPx * 1.6;
            const labelShare =
                label.y < seen.y + seen.height && labelBottom > seen.y
                    ? Math.min(0.4, Math.max(0, (labelBottom - seen.y) / seen.height))
                    : 0;
            const layer = await preparePhotoLayer(
                photo.path,
                Math.round(seen.width * scale),
                Math.round(seen.height * scale),
                {
                    ...(photo.focus === undefined ? {} : { focus: photo.focus }),
                    target: { x: 0.5, y: labelShare + (1 - labelShare) / 2 },
                    visible: { x: 0, y: labelShare, width: 1, height: 1 - labelShare },
                },
            );
            const bytes = Buffer.from(
                layer.dataUri.slice(layer.dataUri.indexOf(',') + 1),
                'base64',
            );
            return {
                dataUri: layer.dataUri,
                rect: seen,
                luma: await meanLuma(bytes),
                ...(layer.focusBox === undefined ? {} : { focusBox: layer.focusBox }),
            };
        }),
    );
    const target = prepared.reduce((sum, p) => sum + p.luma, 0) / prepared.length;
    return prepared.map((p) => ({
        dataUri: p.dataUri,
        rect: p.rect,
        ...(p.focusBox === undefined ? {} : { focusBox: p.focusBox }),
        brightness: Math.min(
            BRIGHTNESS_RANGE[1],
            Math.max(BRIGHTNESS_RANGE[0], target / Math.max(1, p.luma)),
        ),
    }));
}

function bandLayer(geometry: SplitGeometry, color: string, seam: string): Layers {
    const [first, second] = geometry.panels;
    const seamRect: Rect =
        geometry.split === 'columns'
            ? { x: second.x - 5, y: first.y, width: 10, height: first.height }
            : { x: 0, y: second.y - 5, width: second.width, height: 10 };
    return {
        css: `
        .band {
            position: absolute;
            z-index: -1;
            ${rectCss(geometry.band)}
            background: ${color};
        }
        .seam {
            position: absolute;
            z-index: -1;
            ${rectCss(seamRect)}
            background: ${seam};
        }`,
        html: `<div class="band" aria-hidden="true"></div>${geometry.split === 'columns' ? '<div class="seam" aria-hidden="true"></div>' : ''}`,
    };
}

function badgeLayer(
    geometry: SplitGeometry,
    kind: 'vs' | 'arrow',
    colors: { face: string; ink: string; ring: string },
    font: string,
): Layers {
    const badge = geometry.badge;
    if (badge === undefined) {
        return { css: '', html: '' };
    }
    const inner =
        kind === 'vs'
            ? '<span class="badge-text">VS</span>'
            : `<svg viewBox="0 0 24 24"><path d="M4 12h13M12 5l7 7-7 7" transform="${geometry.split === 'rows' ? 'rotate(90 12 12)' : ''}"/></svg>`;
    return {
        css: `
        .badge {
            position: absolute;
            z-index: 2;
            left: ${badge.x - badge.size / 2}px;
            top: ${badge.y - badge.size / 2}px;
            width: ${badge.size}px;
            height: ${badge.size}px;
            border-radius: 50%;
            background: ${colors.face};
            box-shadow: 0 0 0 ${Math.round(badge.size * 0.06)}px ${colors.ring}, ${Math.round(badge.size * 0.04)}px ${Math.round(badge.size * 0.06)}px 0 ${Math.round(badge.size * 0.06)}px rgba(0, 0, 0, 0.55);
            display: flex;
            align-items: center;
            justify-content: center;
        }
        .badge-text {
            font-family: ${font};
            font-size: ${Math.round(badge.size * 0.46)}px;
            font-weight: 900;
            font-style: italic;
            line-height: 1;
            color: ${colors.ink};
        }
        .badge svg {
            width: 56%;
            height: 56%;
        }
        .badge path {
            fill: none;
            stroke: ${colors.ink};
            stroke-width: 3.4;
            stroke-linecap: round;
            stroke-linejoin: round;
        }`,
        // VS 是字，整枚徽章跟着字一起算，质检的底图里不留一个圆被当成主体。
        html: `<div class="badge${kind === 'vs' ? ' qc-text' : ''}" aria-hidden="true">${inner}</div>`,
    };
}

export interface SplitRequest {
    text: string;
    fonts: FontKit;
    photos: readonly [GenrePhoto, GenrePhoto];
    labels?: [string, string];
    scheme?: SchemeName;
    look?: PhotoLook;
}

function splitTemplate(request: SplitRequest, kind: 'versus' | 'before-after'): CoverTemplate {
    const schemeName = request.scheme ?? 'night';
    const scheme = SCHEMES[schemeName];
    const light = isLightScheme(schemeName);
    const type: TypeSpec = light
        ? { style: 'ink', font: request.fonts.choose('heavy'), highlight: 'block' }
        : { style: 'outline', font: request.fonts.choose('heavy'), highlight: 'color' };
    const labelFont =
        kind === 'versus' ? request.fonts.choose('condensed') : request.fonts.choose('heavy');
    const withGeometry = (layout: CoverLayout): CoverLayout => ({
        ...layout,
        textArea: { ...splitGeometry(layout, kind, request.photos).textArea },
    });
    const labelLayer = (geometry: SplitGeometry, layout: CoverLayout): Layers => {
        if (request.labels === undefined) {
            return { css: '', html: '' };
        }
        const labels = request.labels;
        const fontPx = labelFontPx(geometry, layout, labels);
        const specs = geometry.labels.map((anchor, index): ChipSpec => {
            const second = index === 1;
            return {
                text: labels[index] as string,
                x: anchor.x,
                y: anchor.y,
                anchor: anchor.anchor,
                fontPx,
                background: kind === 'versus' || second ? scheme.type.accent : '#FFFFFF',
                ink: scheme.type.accentInk ?? '#111111',
                edge: '#111111',
                ...(kind === 'versus' ? { tilt: second ? LABEL_TILT : -LABEL_TILT } : {}),
                fontFamily: labelFont.stack,
            };
        });
        return chips(specs);
    };
    const page = async (
        layout: CoverLayout,
        headline: Headline,
        scale: number | undefined,
    ): Promise<RenderedPage> => {
        const geometry = splitGeometry(layout, kind, request.photos);
        const band = bandLayer(geometry, scheme.base, '#FFFFFF');
        let over: Layers = { css: '', html: '' };
        let under: Layers = band;
        let subjects: PictureSubject[] = [];
        if (scale !== undefined) {
            const photos = await panelPhotos(layout, geometry, request.photos, scale);
            const names =
                kind === 'versus'
                    ? ["the first photo's subject", "the second photo's subject"]
                    : ["the before photo's subject", "the after photo's subject"];
            subjects = photos.flatMap((photo, index) =>
                photoSubject(names[index] as string, photo.focusBox, photo.rect),
            );
            under = joinLayers(
                photoLayers(photos, request.look ?? 'natural', {
                    deep: scheme.baseDeep,
                    accent: scheme.type.accent,
                }),
                band,
            );
            over = joinLayers(
                labelLayer(geometry, layout),
                badgeLayer(
                    geometry,
                    kind === 'versus' ? 'vs' : 'arrow',
                    {
                        face: scheme.type.accent,
                        ink: scheme.type.accentInk ?? '#111111',
                        ring: '#FFFFFF',
                    },
                    request.fonts.choose('condensed').stack,
                ),
            );
        }
        return {
            html: genrePage({
                layout,
                headline,
                text: request.text,
                type,
                colors: scheme.type,
                background: scheme.baseDeep,
                measure: scale === undefined,
                align: { x: 'center', y: 'center' },
                under,
                over,
            }),
            subjects,
        };
    };
    return {
        layoutFor: withGeometry,
        // 量字号的页面没有照片，同步拼好；band 只是底色，不影响量字。
        measureHtml: (layout, headline) =>
            genrePage({
                layout,
                headline,
                text: request.text,
                type,
                colors: scheme.type,
                background: scheme.base,
                measure: true,
                align: { x: 'center', y: 'center' },
            }),
        renderHtml: (layout, headline, pixelWidth) =>
            page(layout, headline, pixelWidth / layout.width),
    };
}

export function versusTemplate(request: SplitRequest): CoverTemplate {
    return splitTemplate(request, 'versus');
}

export function beforeAfterTemplate(request: SplitRequest): CoverTemplate {
    return splitTemplate(request, 'before-after');
}
