// 拼图：2 到 4 张同一趟、同一种调子的照片拼一格一格，标题压在一条实色带上。
// 竖版（小红书）色带横在中间，照片分在上下；横版和超宽标题占左边一块，照片在右边排格子。
// 几张照片统一过同一种调色，才像一套（research.md 第 5.1 节「拼图」）。
import type { CoverTemplate, RenderedPage } from '../compose/index.ts';
import type { FamilyName, Rect } from '../platforms/index.ts';
import type { PictureSubject } from '../qc/index.ts';
import type { CoverLayout, Headline } from '../render/layout.ts';
import { type PhotoLook, preparePhotoLayer } from '../render/photo-cover.ts';
import type { TypeSpec } from '../render/type.ts';
import {
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
import { type StyleName, styledType } from './styles.ts';

export const COLLAGE_MIN = 2;
export const COLLAGE_MAX = 4;

// 格子之间的缝，露出色带的颜色。
const GUTTER = 10;

interface CollageGeometry {
    /** 色带或色块 */
    band: Rect;
    textArea: Rect;
    /** 照片可以排的区域：竖版是色带上下两块，横版是右边一整块 */
    regions: Rect[];
}

const GEOMETRY: Readonly<Record<FamilyName, CollageGeometry>> = {
    portrait: {
        band: { x: 0, y: 790, width: 1080, height: 330 },
        textArea: { x: 86, y: 815, width: 842, height: 280 },
        regions: [
            { x: 0, y: 0, width: 1080, height: 790 },
            { x: 0, y: 1120, width: 1080, height: 800 },
        ],
    },
    landscape: {
        band: { x: 0, y: 0, width: 820, height: 1200 },
        textArea: { x: 192, y: 132, width: 580, height: 876 },
        regions: [{ x: 820, y: 0, width: 1100, height: 1200 }],
    },
    ultrawide: {
        band: { x: 0, y: 0, width: 780, height: 768 },
        textArea: { x: 154, y: 72, width: 580, height: 624 },
        regions: [{ x: 780, y: 0, width: 1140, height: 768 }],
    },
};

const MASTER: Readonly<Record<FamilyName, { width: number; height: number }>> = {
    landscape: { width: 1920, height: 1200 },
    portrait: { width: 1080, height: 1920 },
    ultrawide: { width: 1920, height: 768 },
};

function splitRect(rect: Rect, parts: number, direction: 'columns' | 'rows'): Rect[] {
    return Array.from({ length: parts }, (_, index) => {
        if (direction === 'columns') {
            const width = Math.round(rect.width / parts);
            const x = rect.x + width * index;
            return { ...rect, x, width: index === parts - 1 ? rect.x + rect.width - x : width };
        }
        const height = Math.round(rect.height / parts);
        const y = rect.y + height * index;
        return { ...rect, y, height: index === parts - 1 ? rect.y + rect.height - y : height };
    });
}

/** 按张数切格子。竖版：2 张上下各一，3 张上一下二，4 张上二下二；横版在右边一块里排 */
function cells(family: FamilyName, geometry: CollageGeometry, count: number): Rect[] {
    if (family === 'portrait') {
        const [top, bottom] = geometry.regions as [Rect, Rect];
        switch (count) {
            case 2:
                return [top, bottom];
            case 3:
                return [top, ...splitRect(bottom, 2, 'columns')];
            default:
                return [...splitRect(top, 2, 'columns'), ...splitRect(bottom, 2, 'columns')];
        }
    }
    const region = geometry.regions[0] as Rect;
    const wide = family === 'ultrawide';
    switch (count) {
        case 2:
            return splitRect(region, 2, wide ? 'columns' : 'rows');
        case 3: {
            if (wide) {
                return splitRect(region, 3, 'columns');
            }
            const [top, bottom] = splitRect(region, 2, 'rows') as [Rect, Rect];
            return [top, ...splitRect(bottom, 2, 'columns')];
        }
        default: {
            const [top, bottom] = splitRect(region, 2, 'rows') as [Rect, Rect];
            return [...splitRect(top, 2, 'columns'), ...splitRect(bottom, 2, 'columns')];
        }
    }
}

function familyOf(layout: CoverLayout): FamilyName {
    if (layout.family !== undefined) {
        return layout.family;
    }
    const ratio = layout.width / layout.height;
    return ratio >= 2 ? 'ultrawide' : ratio >= 1 ? 'landscape' : 'portrait';
}

function geometryFor(layout: CoverLayout): { family: FamilyName; geometry: CollageGeometry } {
    const family = familyOf(layout);
    const geometry = GEOMETRY[family];
    if (layout.family !== undefined) {
        return { family, geometry };
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
    return {
        family,
        geometry: {
            band: rect(geometry.band),
            textArea: rect(geometry.textArea),
            regions: geometry.regions.map(rect),
        },
    };
}

function inset(rect: Rect, by: number): Rect {
    return {
        x: rect.x + by,
        y: rect.y + by,
        width: rect.width - by * 2,
        height: rect.height - by * 2,
    };
}

export interface CollageRequest {
    text: string;
    fonts: FontKit;
    photos: readonly GenrePhoto[];
    scheme?: SchemeName;
    look?: PhotoLook;
    style?: StyleName;
}

export function collageTemplate(request: CollageRequest): CoverTemplate {
    const count = request.photos.length;
    if (count < COLLAGE_MIN || count > COLLAGE_MAX) {
        throw new Error(`A collage takes ${COLLAGE_MIN} to ${COLLAGE_MAX} photos.`);
    }
    const schemeName = request.scheme ?? 'lemon';
    const scheme = SCHEMES[schemeName];
    const light = isLightScheme(schemeName);
    const bold: TypeSpec = light
        ? { style: 'ink', font: request.fonts.choose('heavy'), highlight: 'block' }
        : { style: 'outline', font: request.fonts.choose('heavy'), highlight: 'color' };
    const { type, colors } = styledType(request.style ?? 'bold', {
        fonts: request.fonts,
        ground: { light, picture: false },
        colors: scheme.type,
        bold,
    });
    const band = (geometry: CollageGeometry): Layers => ({
        css: `
        .band {
            position: absolute;
            z-index: -1;
            ${rectCss(geometry.band)}
            background: ${scheme.base};
        }`,
        html: '<div class="band" aria-hidden="true"></div>',
    });
    const page = async (
        layout: CoverLayout,
        headline: Headline,
        scale: number | undefined,
    ): Promise<RenderedPage> => {
        const { family, geometry } = geometryFor(layout);
        let under = band(geometry);
        let subjects: PictureSubject[] = [];
        if (scale !== undefined) {
            const rects = cells(family, geometry, count).map((cell) => inset(cell, GUTTER / 2));
            const photos = await Promise.all(
                rects.map(async (rect, index) => {
                    const photo = request.photos[index] as GenrePhoto;
                    const seen = seenPart(rect, layout);
                    const layer = await preparePhotoLayer(
                        photo.path,
                        Math.round(seen.width * scale),
                        Math.round(seen.height * scale),
                        {
                            ...(photo.focus === undefined ? {} : { focus: photo.focus }),
                            target: { x: 0.5, y: 0.5 },
                        },
                    );
                    return { dataUri: layer.dataUri, rect: seen, focusBox: layer.focusBox };
                }),
            );
            subjects = photos.flatMap((photo, index) =>
                photoSubject(`photo ${index + 1}'s subject`, photo.focusBox, photo.rect),
            );
            under = joinLayers(
                photoLayers(photos, request.look ?? 'natural', {
                    deep: scheme.baseDeep,
                    accent: scheme.type.accent,
                }),
                under,
            );
        }
        return {
            html: genrePage({
                layout,
                headline,
                text: request.text,
                type,
                colors,
                background: scheme.base,
                measure: scale === undefined,
                align: { x: family === 'portrait' ? 'center' : 'start', y: 'center' },
                under,
            }),
            subjects,
        };
    };
    return {
        layoutFor: (layout) => ({
            ...layout,
            textArea: { ...geometryFor(layout).geometry.textArea },
        }),
        measureHtml: (layout, headline) =>
            genrePage({
                layout,
                headline,
                text: request.text,
                type,
                colors,
                background: scheme.base,
                measure: true,
                align: { x: familyOf(layout) === 'portrait' ? 'center' : 'start', y: 'center' },
            }),
        renderHtml: (layout, headline, pixelWidth) =>
            page(layout, headline, pixelWidth / layout.width),
    };
}
