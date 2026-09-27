// 两张图并排的两类封面。
// 档位对比：两半等大、等亮，各挂一块倾斜的价签，中缝一枚 VS 徽章。平局本身就是卖点（research.md 第 3.1 节）。
// 前后对比：左前右后（竖版上前下后），两半同亮度，各贴一个前后标签，中缝一支箭头。
// 两类的标题都放在单独的实色标题带里，不压在照片上：压在照片上的字总会挡到其中一半的主体。
import sharp from 'sharp';
import type { CoverTemplate } from '../compose/index.ts';
import type { FamilyName, Rect } from '../platforms/index.ts';
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
    rectCss,
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
        labels: [
            { x: 480, y: 380, anchor: 'center' },
            { x: 1440, y: 380, anchor: 'center' },
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
            { x: 480, y: 238, anchor: 'center' },
            { x: 1440, y: 238, anchor: 'center' },
        ],
        labelPx: 66,
    },
};

// 前后对比：横版和超宽同档位对比；竖版上下分，标题带就是中缝。
const BEFORE_AFTER: Readonly<Record<FamilyName, SplitGeometry>> = {
    landscape: { ...VERSUS.landscape, labelPx: 84 },
    portrait: {
        split: 'rows',
        band: { x: 0, y: 820, width: 1080, height: 300 },
        textArea: { x: 86, y: 850, width: 842, height: 240 },
        panels: [
            { x: 0, y: 0, width: 1080, height: 820 },
            { x: 0, y: 1120, width: 1080, height: 800 },
        ],
        labels: [
            { x: 86, y: 300, anchor: 'start' },
            { x: 86, y: 1160, anchor: 'start' },
        ],
        labelPx: 64,
    },
    ultrawide: { ...VERSUS.ultrawide, labelPx: 56 },
};

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

/** 自定义画布按最接近的族等比换算 */
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

/** 面板里平台看得见的那一截，换算成面板的 0 到 1 */
export function panelVisibility(panel: Rect, visibleArea: Rect): Rect {
    const x = Math.max(panel.x, visibleArea.x);
    const y = Math.max(panel.y, visibleArea.y);
    const right = Math.min(panel.x + panel.width, visibleArea.x + visibleArea.width);
    const bottom = Math.min(panel.y + panel.height, visibleArea.y + visibleArea.height);
    if (right <= x || bottom <= y) {
        throw new Error('A comparison panel has no visible part on the requested platforms.');
    }
    return {
        x: (x - panel.x) / panel.width,
        y: (y - panel.y) / panel.height,
        width: (right - x) / panel.width,
        height: (bottom - y) / panel.height,
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
): Promise<{ dataUri: string; rect: Rect; brightness: number }[]> {
    const visibleArea = layout.visibleArea ?? {
        x: 0,
        y: 0,
        width: layout.width,
        height: layout.height,
    };
    const prepared = await Promise.all(
        geometry.panels.map(async (panel, index) => {
            const photo = photos[index] as GenrePhoto;
            const seen = panelVisibility(panel, visibleArea);
            // 标签挂在面板上边时，主体往下让开标签那一截。
            const label = geometry.labels[index] as ChipAnchor;
            const labelBottom = label.y + geometry.labelPx * 1.6;
            const labelShare =
                label.y < panel.y + panel.height && labelBottom > panel.y
                    ? Math.min(0.4, Math.max(0, (labelBottom - panel.y) / panel.height))
                    : 0;
            const top = Math.max(seen.y, labelShare);
            const visible = { ...seen, y: top, height: seen.y + seen.height - top };
            const layer = await preparePhotoLayer(
                photo.path,
                Math.round(panel.width * scale),
                Math.round(panel.height * scale),
                {
                    focus: photo.focus,
                    target: { x: 0.5, y: visible.y + visible.height / 2 },
                    visible,
                },
            );
            const bytes = Buffer.from(
                layer.dataUri.slice(layer.dataUri.indexOf(',') + 1),
                'base64',
            );
            return { dataUri: layer.dataUri, rect: panel, luma: await meanLuma(bytes) };
        }),
    );
    const target = prepared.reduce((sum, p) => sum + p.luma, 0) / prepared.length;
    return prepared.map((p) => ({
        dataUri: p.dataUri,
        rect: p.rect,
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
    const table = kind === 'versus' ? VERSUS : BEFORE_AFTER;
    const type: TypeSpec = light
        ? { style: 'ink', font: request.fonts.choose('heavy'), highlight: 'block' }
        : { style: 'outline', font: request.fonts.choose('heavy'), highlight: 'color' };
    const labelFont =
        kind === 'versus' ? request.fonts.choose('condensed') : request.fonts.choose('heavy');
    const withGeometry = (layout: CoverLayout): CoverLayout => ({
        ...layout,
        textArea: { ...geometryFor(layout, table).textArea },
    });
    const labelLayer = (geometry: SplitGeometry): Layers => {
        if (request.labels === undefined) {
            return { css: '', html: '' };
        }
        const labels = request.labels;
        const specs = geometry.labels.map((anchor, index): ChipSpec => {
            const second = index === 1;
            return {
                text: labels[index] as string,
                x: anchor.x,
                y: anchor.y,
                anchor: anchor.anchor,
                fontPx: geometry.labelPx,
                background: kind === 'versus' || second ? scheme.type.accent : '#FFFFFF',
                ink: scheme.type.accentInk ?? '#111111',
                edge: '#111111',
                ...(kind === 'versus' ? { tilt: second ? 4 : -4 } : {}),
                fontFamily: labelFont.stack,
            };
        });
        return chips(specs);
    };
    const page = async (
        layout: CoverLayout,
        headline: Headline,
        scale: number | undefined,
    ): Promise<string> => {
        const geometry = geometryFor(layout, table);
        const band = bandLayer(geometry, scheme.base, '#FFFFFF');
        let over: Layers = { css: '', html: '' };
        let under: Layers = band;
        if (scale !== undefined) {
            const photos = await panelPhotos(layout, geometry, request.photos, scale);
            under = joinLayers(
                photoLayers(photos, request.look ?? 'natural', {
                    deep: scheme.baseDeep,
                    accent: scheme.type.accent,
                }),
                band,
            );
            over = joinLayers(
                labelLayer(geometry),
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
        return genrePage({
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
        });
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

/** 质检和测试用：每族的标题区 */
export function splitTextAreas(kind: 'versus' | 'before-after'): Record<FamilyName, Rect> {
    const table = kind === 'versus' ? VERSUS : BEFORE_AFTER;
    return {
        landscape: table.landscape.textArea,
        portrait: table.portrait.textArea,
        ultrawide: table.ultrawide.textArea,
    };
}
