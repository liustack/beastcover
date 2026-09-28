// 截图证据：一张截图（聊天记录、数据、推文、账单）做成一张略斜的卡片，整张都露出来，旁边是大字。
// 知识区、吃瓜、揭秘类用它：截图本身就是「我有证据」的承诺。截图不裁，裁了就不算证据。
// 依据：B 站知识区「大字加截图」、YouTube 的 receipts（第二轮调研）。
import sharp from 'sharp';
import type { CoverTemplate } from '../compose/index.ts';
import type { Rect } from '../platforms/index.ts';
import type { PictureSubject } from '../qc/index.ts';
import type { CoverLayout, Headline } from '../render/layout.ts';
import { PHOTO_JPEG_QUALITY } from '../render/photo-cover.ts';
import type { TypeSpec } from '../render/type.ts';
import { faceLayout } from './face.ts';
import {
    eyebrow,
    type FontKit,
    type GenrePhoto,
    genrePage,
    joinLayers,
    type Layers,
    NO_LAYERS,
    rectCss,
} from './page.ts';
import { isLightScheme, SCHEMES, type SchemeName, schemeGradient } from './schemes.ts';
import { type StyleName, styledType } from './styles.ts';

export interface ProofRequest {
    text: string;
    fonts: FontKit;
    /** 截图，整张放进卡片 */
    photo: GenrePhoto;
    scheme?: SchemeName;
    tag?: string;
    style?: StyleName;
}

// 卡片四周留出放图区短边的这么多，斜过来的角也不会碰到边。
const CARD_MARGIN = 0.08;
// 卡片白边和圆角，按画布短边算。
const CARD_BORDER = 0.012;
const CARD_RADIUS = 0.012;
const CARD_TILT = 3;

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

/** 卡片的位置：截图按原比例整张放进放图区里平台看得清的那一截，四周留边，居中 */
export function proofCard(layout: CoverLayout, photo: { width: number; height: number }): Rect {
    const area = layout.subjectArea;
    if (area === undefined) {
        throw new Error('A proof card needs a layout with a subject area.');
    }
    const canvas = { x: 0, y: 0, width: layout.width, height: layout.height };
    const room = intersect(area, layout.clearArea ?? layout.visibleArea ?? canvas);
    const margin = Math.min(room.width, room.height) * CARD_MARGIN;
    const inner = {
        x: room.x + margin,
        y: room.y + margin,
        width: room.width - margin * 2,
        height: room.height - margin * 2,
    };
    const scale = Math.min(inner.width / photo.width, inner.height / photo.height);
    const width = Math.round(photo.width * scale);
    const height = Math.round(photo.height * scale);
    return {
        x: Math.round(inner.x + (inner.width - width) / 2),
        y: Math.round(inner.y + (inner.height - height) / 2),
        width,
        height,
    };
}

async function cardLayer(
    layout: CoverLayout,
    photo: GenrePhoto,
    card: Rect,
    scale: number,
): Promise<Layers> {
    const short = Math.min(layout.width, layout.height);
    const border = Math.max(2, Math.round(short * CARD_BORDER));
    const bytes = await sharp(photo.path, { failOn: 'error' })
        .rotate()
        .resize(
            Math.max(1, Math.round((card.width - border * 2) * scale)),
            Math.max(1, Math.round((card.height - border * 2) * scale)),
            { fit: 'fill' },
        )
        .jpeg({ quality: PHOTO_JPEG_QUALITY, mozjpeg: true })
        .toBuffer();
    const shadow = Math.round(short * 0.03);
    return {
        css: `
        .proof-card {
            position: absolute;
            ${rectCss(card)}
            box-sizing: border-box;
            border: ${border}px solid #FFFFFF;
            border-radius: ${Math.round(short * CARD_RADIUS)}px;
            background: #FFFFFF;
            overflow: hidden;
            transform: rotate(${CARD_TILT}deg);
            box-shadow: 0 ${Math.round(shadow * 0.4)}px ${shadow}px rgba(0, 0, 0, 0.35);
        }
        .proof-card img {
            display: block;
            width: 100%;
            height: 100%;
        }`,
        html: `<div class="proof-card"><img src="data:image/jpeg;base64,${bytes.toString('base64')}" alt=""></div>`,
    };
}

export function proofTemplate(request: ProofRequest): CoverTemplate {
    // 奶油底：知识区的纸感，截图的白卡片压在上面也分得开（有投影）。
    const schemeName = request.scheme ?? 'cream';
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
    const tag = eyebrow(
        request.tag,
        light
            ? { background: scheme.type.stroke, ink: scheme.base }
            : { background: scheme.type.accent, ink: scheme.type.stroke },
    );
    const background = light ? scheme.base : schemeGradient(scheme);
    const page = (layout: CoverLayout, headline: Headline, card: Layers, measure: boolean) =>
        genrePage({
            layout,
            headline,
            text: request.text,
            type,
            colors,
            background,
            measure,
            prefix: tag.prefix,
            over: joinLayers({ css: tag.css, html: '' }, card),
        });
    return {
        layoutFor: faceLayout,
        measureHtml: (layout, headline) => page(layout, headline, NO_LAYERS, true),
        renderHtml: async (layout, headline, pixelWidth) => {
            const card = proofCard(layout, request.photo);
            // 截图整张都要露出来：卡片就是要核对的主体。
            const subjects: PictureSubject[] = [
                {
                    name: 'the screenshot',
                    box: card,
                    frame: { x: 0, y: 0, width: layout.width, height: layout.height },
                },
            ];
            const layer = await cardLayer(layout, request.photo, card, pixelWidth / layout.width);
            return { html: page(layout, headline, layer, false), subjects };
        },
    };
}
