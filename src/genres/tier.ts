// 排行榜：S、A、B、C 几排彩色等级，每排一张照片，第一张放 S。「我排了所有 X」这类视频的固定样式，
// 等级的颜色和顺序照大家熟悉的来（TierMaker 那一套），改了就认不出。缩略图只露三四排，
// 看得出是排名就够。S 排放最有争议的那一个，看的人才想点进去争。
// 依据：第二轮调研里各家对排名类缩略图的建议。
import type { CoverTemplate, RenderedPage } from '../compose/index.ts';
import type { Rect } from '../platforms/index.ts';
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
    photoForLayout,
    photoLayers,
    photoSubject,
    rectCss,
    seenPart,
} from './page.ts';
import { isLightScheme, SCHEMES, type SchemeName, schemeGradient } from './schemes.ts';
import { type StyleName, styledType } from './styles.ts';

export const TIER_MIN = 3;
export const TIER_MAX = 4;

// 等级和颜色：大家熟悉的那套，顺序和颜色都不改。
const TIERS = [
    { letter: 'S', color: '#FF7F7F' },
    { letter: 'A', color: '#FFBF7F' },
    { letter: 'B', color: '#FFDF7F' },
    { letter: 'C', color: '#FFFF7F' },
] as const;
const TIER_INK = '#1A1A1A';

// 横版和超宽标题至少占文字区左边四成，竖版占上面三成，其余是榜单。
const TEXT_SHARE_WIDE = 0.4;
const TEXT_SHARE_TALL = 0.3;
// 标题和榜单之间、排和排之间的空隙，按短边算。
const GAP_SHARE = 0.03;
const ROW_GAP_SHARE = 0.012;
// 照片格最宽是排高的这么多倍，再宽主体就被压成一条缝。照片格后面留一小截空排。
const TILE_RATIO = 1.5;
const TAIL_RATIO = 0.8;

interface TierRow {
    row: Rect;
    label: Rect;
    tile: Rect;
}

interface TierGeometry {
    rows: TierRow[];
}

/** 一排的高度：排数和排间空隙定下来以后，榜单多高就能排多高 */
function rowHeightFor(boardHeight: number, count: number, rowGap: number): number {
    return Math.floor((boardHeight - rowGap * (count - 1)) / count);
}

/**
 * 这一族的安全文字区分成两块：标题一块，榜单一块（放进 subjectArea）。榜单只要等级方块、
 * 照片格和一小截空排（看得出后面还能再排）那么宽，剩下的宽度都给标题。
 */
function tierLayout(layout: CoverLayout, count: number): CoverLayout {
    const area = layout.textArea;
    const short = Math.min(layout.width, layout.height);
    const gap = Math.round(short * GAP_SHARE);
    const rowGap = Math.round(short * ROW_GAP_SHARE);
    const boardWidth = (rowHeight: number) =>
        Math.round(rowHeight * (1 + TILE_RATIO + TAIL_RATIO) + rowGap);
    if (layout.width >= layout.height) {
        const rowHeight = rowHeightFor(area.height, count, rowGap);
        const width = Math.min(
            boardWidth(rowHeight),
            Math.round(area.width * (1 - TEXT_SHARE_WIDE)) - gap,
        );
        return {
            ...layout,
            textArea: {
                x: area.x,
                y: area.y,
                width: area.width - width - gap,
                height: area.height,
            },
            subjectArea: { x: area.x + area.width - width, y: area.y, width, height: area.height },
        };
    }
    // 竖版的榜单可以往下伸到这次要出的平台都看得清的最低处（留一点边），不止文字区那么高：
    // 文字区要照顾抖音的底栏，只出小红书时底下还有一大截能用。
    const textHeight = Math.round(area.height * TEXT_SHARE_TALL);
    const clear = layout.clearArea ?? area;
    const bottom = Math.max(area.y + area.height, clear.y + clear.height - gap);
    const boardHeight = bottom - (area.y + textHeight + gap);
    const width = Math.min(area.width, boardWidth(rowHeightFor(boardHeight, count, rowGap)));
    return {
        ...layout,
        textArea: { x: area.x, y: area.y, width: area.width, height: textHeight },
        subjectArea: {
            x: Math.round(area.x + (area.width - width) / 2),
            y: area.y + textHeight + gap,
            width,
            height: boardHeight,
        },
    };
}

/** 榜单按照片张数分排：每排一个等级方块、一个照片格 */
function tierGeometry(layout: CoverLayout, count: number): TierGeometry {
    const board = layout.subjectArea;
    if (board === undefined) {
        throw new Error('A tier list needs the layout from tierLayout.');
    }
    const rowGap = Math.round(Math.min(layout.width, layout.height) * ROW_GAP_SHARE);
    const rowHeight = rowHeightFor(board.height, count, rowGap);
    const rows = Array.from({ length: count }, (_, index): TierRow => {
        const row = {
            x: board.x,
            y: board.y + index * (rowHeight + rowGap),
            width: board.width,
            height: rowHeight,
        };
        const label = { x: row.x, y: row.y, width: rowHeight, height: rowHeight };
        const tileX = label.x + label.width + rowGap;
        const tile = {
            x: tileX,
            y: row.y,
            width: Math.min(row.x + row.width - tileX, Math.round(rowHeight * TILE_RATIO)),
            height: rowHeight,
        };
        return { row, label, tile };
    });
    return { rows };
}

/** 每排的底条、等级色块和字母。只有字母挂 qc-text（质检把它当字），色块是榜单的一部分 */
function boardLayer(geometry: TierGeometry, strip: string, fontStack: string): Layers {
    const css = geometry.rows
        .map(
            ({ row, label }, index) => `
        .tier-row-${index} { position: absolute; ${rectCss(row)} background: ${strip}; }
        .tier-label-${index} {
            position: absolute;
            ${rectCss(label)}
            display: flex;
            align-items: center;
            justify-content: center;
            background: ${TIERS[index]?.color};
            color: ${TIER_INK};
            font-family: ${fontStack};
            font-weight: 900;
            font-size: ${Math.round(label.height * 0.6)}px;
            line-height: 1;
        }`,
        )
        .join('');
    const html = geometry.rows
        .map(
            (_, index) =>
                `<div class="tier-row-${index}" aria-hidden="true"></div><div class="tier-label-${index}" aria-hidden="true"><span class="qc-text">${TIERS[index]?.letter}</span></div>`,
        )
        .join('');
    return { css, html };
}

export interface TierRequest {
    text: string;
    fonts: FontKit;
    /** 按名次排：第一张放 S */
    photos: readonly GenrePhoto[];
    scheme?: SchemeName;
    look?: PhotoLook;
    style?: StyleName;
}

export function tierTemplate(request: TierRequest): CoverTemplate {
    const count = request.photos.length;
    if (count < TIER_MIN || count > TIER_MAX) {
        throw new Error(`A tier list takes ${TIER_MIN} to ${TIER_MAX} photos.`);
    }
    // 近黑底：排名视频的熟悉样子，等级的彩色在暗底上最跳。
    const schemeName = request.scheme ?? 'night';
    const scheme = SCHEMES[schemeName];
    const light = isLightScheme(schemeName);
    const heavy = request.fonts.choose('heavy');
    const bold: TypeSpec = light
        ? { style: 'ink', font: heavy, highlight: 'marker' }
        : { style: 'outline', font: heavy, highlight: 'color' };
    const { type, colors } = styledType(request.style ?? 'bold', {
        fonts: request.fonts,
        ground: { light, picture: false },
        colors: scheme.type,
        bold,
    });
    const strip = light ? 'rgba(0, 0, 0, 0.08)' : 'rgba(255, 255, 255, 0.08)';
    const labelFont = request.fonts.choose('condensed').stack;
    const background = light ? scheme.base : schemeGradient(scheme);
    const align = (layout: CoverLayout) =>
        layout.width >= layout.height
            ? ({ x: 'start', y: 'center' } as const)
            : ({ x: 'center', y: 'center' } as const);
    const page = async (
        layout: CoverLayout,
        headline: Headline,
        scale: number | undefined,
    ): Promise<RenderedPage> => {
        const geometry = tierGeometry(layout, count);
        let under = boardLayer(geometry, strip, labelFont);
        let subjects: PictureSubject[] = [];
        if (scale !== undefined) {
            const tiles = await Promise.all(
                geometry.rows.map(async ({ tile }, index) => {
                    const photo = photoForLayout(request.photos[index] as GenrePhoto, layout);
                    const seen = seenPart(tile, layout);
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
            subjects = tiles.flatMap((tile, index) =>
                photoSubject(
                    `the ${TIERS[index]?.letter} photo's subject`,
                    tile.focusBox,
                    tile.rect,
                ),
            );
            under = joinLayers(
                under,
                photoLayers(tiles, request.look ?? 'natural', {
                    deep: scheme.baseDeep,
                    accent: scheme.type.accent,
                }),
            );
        }
        return {
            html: genrePage({
                layout,
                headline,
                text: request.text,
                type,
                colors,
                background,
                measure: scale === undefined,
                align: align(layout),
                under,
            }),
            subjects,
        };
    };
    return {
        layoutFor: (layout) => tierLayout(layout, count),
        measureHtml: (layout, headline) =>
            genrePage({
                layout,
                headline,
                text: request.text,
                type,
                colors,
                background,
                measure: true,
                align: align(layout),
            }),
        renderHtml: (layout, headline, pixelWidth) =>
            page(layout, headline, pixelWidth / layout.width),
    };
}
