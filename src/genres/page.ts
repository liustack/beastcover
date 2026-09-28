// 各封面类型共用的页面：背景、图层（照片、面板、人物、标签）、按类型做好的标题。
// 类型只决定「画面从哪来、字怎么做、怎么排」，页面骨架和量字号的约定在这里统一。
import type { FamilyName, Rect } from '../platforms/index.ts';
import type { PictureSubject } from '../qc/index.ts';
import { chooseFont, type FontChoice, type FontProber, type FontRole } from '../render/fonts.ts';
import {
    type CoverLayout,
    escapeHtml,
    type Headline,
    placeSubject,
    probeMarkup,
} from '../render/layout.ts';
import type { PhotoLook } from '../render/photo-cover.ts';
import { coverDocument, headlineCss } from '../render/template.ts';
import {
    headlineLayers,
    headlineTypeCss,
    stripEmphasis,
    type TypeColors,
    type TypeSpec,
} from '../render/type.ts';
import type { SubjectLayer } from '../subject/index.ts';
import type { PhotoFocus } from '../subject/vision.ts';

/** 按角色取字体，同一个角色只探测一次；降级说明攒起来最后一起打印 */
export interface FontKit {
    choose(role: FontRole): FontChoice;
    notes(): string[];
}

export function fontKit(prober: FontProber): FontKit {
    const chosen = new Map<FontRole, FontChoice>();
    return {
        choose(role) {
            const existing = chosen.get(role);
            if (existing !== undefined) {
                return existing;
            }
            const choice = chooseFont(role, prober);
            chosen.set(role, choice);
            return choice;
        },
        notes() {
            return [...new Set([...chosen.values()].flatMap((choice) => choice.notes))];
        },
    };
}

/** 一张照片素材：本地路径、转正后的尺寸、主体在哪 */
export interface GenrePhoto {
    path: string;
    width: number;
    height: number;
    /** 主体在哪。画不了场景时的渐变底没有主体，就没有这一项 */
    focus?: PhotoFocus;
    /** 按族换一张：现画的场景横版画一张、竖版画一张，各族用自己朝向的那张 */
    byFamily?: Partial<Record<FamilyName, GenrePhoto>>;
}

/** 照片按主体构图放进一个框以后，主体在母版上的位置。没按主体构图（extend、没找到主体）就没有 */
export function photoSubject(
    name: string,
    focusBox: Rect | undefined,
    frame: Rect,
): PictureSubject[] {
    if (focusBox === undefined) {
        return [];
    }
    return [
        {
            name,
            box: {
                x: frame.x + focusBox.x * frame.width,
                y: frame.y + focusBox.y * frame.height,
                width: focusBox.width * frame.width,
                height: focusBox.height * frame.height,
            },
            frame,
        },
    ];
}

/** 人物的脸在母版上的位置：人可以被画面切掉，脸不行 */
// 脸高至少是封面短边的三分之一，信息流里才认得出表情（research.md 第 2.1 节）。
export const MIN_FACE_SHARE = 1 / 3;

export function faceSubject(
    layout: CoverLayout,
    subject: SubjectLayer,
    faceShare: number,
): PictureSubject[] {
    const face = subject.face;
    if (face === undefined) {
        return [];
    }
    const rect = placeSubject(layout, subject, faceShare);
    return [
        {
            name: 'the face',
            box: {
                x: rect.x + (face.x - face.width / 2) * rect.width,
                y: rect.y + (face.y - face.height / 2) * rect.height,
                width: face.width * rect.width,
                height: face.height * rect.height,
            },
            frame: { x: 0, y: 0, width: layout.width, height: layout.height },
            minShare: MIN_FACE_SHARE,
        },
    ];
}

/** 这个版式用哪张：有这一族专门画的就用它 */
export function photoForLayout(photo: GenrePhoto, layout: CoverLayout): GenrePhoto {
    const variant = layout.family === undefined ? undefined : photo.byFamily?.[layout.family];
    return variant ?? photo;
}

export interface Layers {
    css: string;
    html: string;
}

export const NO_LAYERS: Layers = { css: '', html: '' };

export function joinLayers(...layers: readonly Layers[]): Layers {
    return {
        css: layers.map((layer) => layer.css).join('\n'),
        html: layers.map((layer) => layer.html).join('\n'),
    };
}

/**
 * 一块照片区里平台真正看得清的那一截（和合成时的 clearArea 求交）。照片只铺这一截、按它构图，
 * 被裁掉或压在顶栏底栏下面的部分只留底色，主体就不会落进看不见的地方。
 */
export function seenPart(rect: Rect, layout: CoverLayout): Rect {
    const clear = layout.clearArea ?? { x: 0, y: 0, width: layout.width, height: layout.height };
    const x = Math.max(rect.x, clear.x);
    const y = Math.max(rect.y, clear.y);
    const right = Math.min(rect.x + rect.width, clear.x + clear.width);
    const bottom = Math.min(rect.y + rect.height, clear.y + clear.height);
    if (right <= x || bottom <= y) {
        throw new Error('A photo area has no visible part on the requested platforms.');
    }
    return { x, y, width: right - x, height: bottom - y };
}

export function rectCss(rect: Rect): string {
    return `left: ${rect.x}px; top: ${rect.y}px; width: ${rect.width}px; height: ${rect.height}px;`;
}

export interface GenrePageInput {
    layout: CoverLayout;
    headline: Headline;
    /** 带 *关键词* 标记的原文 */
    text: string;
    type: TypeSpec;
    colors: TypeColors;
    /** #canvas 的背景：纯色、渐变，或照片封面下垫的底色 */
    background: string;
    /** 量字号用：带探针，重资源（照片、人物）由调用方不传 */
    measure?: boolean;
    /** 标题下面的图层：照片、面板、渐变压暗 */
    under?: Layers;
    /** 标题上面的图层：人物、标签、徽章、箭头 */
    over?: Layers;
    /** 标题在文字区里的横向和纵向对齐 */
    align?: { x: 'start' | 'center' | 'end'; y: 'start' | 'center' | 'end' };
    /** 放在标题同一段里的小标签 HTML */
    prefix?: string;
    /** 跟在标题后面同一段里的一行 HTML：价签、署名 */
    suffix?: string;
}

/**
 * 倾斜的标题换行后会撑满文字区，旋转后的外框必然超出，只好退回单行小字。
 * 标题块的宽度先扣掉旋转会多占的那一截（最坏按整个文字区的高度算）。
 */
function tiltRoom(layout: CoverLayout, tilt: number | undefined): string {
    if (tilt === undefined || tilt === 0) {
        return '';
    }
    const sin = Math.sin((Math.abs(tilt) * Math.PI) / 180);
    const width = Math.floor(layout.textArea.width - layout.textArea.height * sin);
    return `
        .headline-stack {
            max-width: ${width}px;
        }`;
}

export function genrePage(input: GenrePageInput): string {
    const plain = stripEmphasis(input.text);
    const { layout, headline } = input;
    // 倾斜的标题贴着安全区边缘排时，一转角就伸出去，缩到多小都一样。倾斜的一律居中排。
    const align =
        input.type.tilt !== undefined && input.type.tilt !== 0
            ? { x: 'center' as const, y: input.align?.y ?? 'center' }
            : (input.align ?? { x: 'start', y: 'center' });
    const under = input.under ?? NO_LAYERS;
    const over = input.over ?? NO_LAYERS;
    const flex = { start: 'flex-start', center: 'center', end: 'flex-end' } as const;
    return coverDocument({
        layout,
        colors: { paper: input.colors.fill, ink: input.colors.stroke, accent: input.colors.accent },
        background: input.background,
        fontFamily: input.type.font.stack,
        css: `${headlineCss(layout, headline, plain)}

        .text-box {
            z-index: 1;
            align-items: ${flex[align.y]};
            justify-content: ${flex[align.x]};
            text-align: ${align.x === 'end' ? 'right' : align.x};
        }
${headlineTypeCss(input.type, input.colors)}
${tiltRoom(layout, input.type.tilt)}
${under.css}
${over.css}`,
        body: `${under.html}
        <section class="text-box" aria-label="Headline">
            ${headlineLayers(input.text, headline, input.type, input.prefix, input.suffix)}${input.measure ? probeMarkup(plain, headline) : ''}
        </section>
        ${over.html}`,
    });
}

/**
 * 痛点标签：放在标题同一段里，字号按标题的比例走（副标题不超过主标题的 1/2.5），
 * 跟着标题一起量字号，不会被挤出安全区。
 */
export function eyebrow(
    tag: string | undefined,
    colors: { background: string; ink: string },
): { prefix: string; css: string } {
    if (tag === undefined) {
        return { prefix: '', css: '' };
    }
    return {
        prefix: `<span class="eyebrow">${escapeHtml(tag)}</span>`,
        css: `
        .eyebrow {
            display: table;
            margin-bottom: 0.28em;
            padding: 0.2em 0.42em 0.22em;
            font-size: 0.34em;
            line-height: 1;
            letter-spacing: 0.02em;
            white-space: nowrap;
            -webkit-text-stroke: 0;
            background: ${colors.background};
            color: ${colors.ink};
        }
        .copy-layer .eyebrow {
            background: transparent;
            color: transparent;
            -webkit-text-stroke: 0;
        }`,
    };
}

/**
 * 跟在标题后面同一段里的一行：价签（实色块）或署名（没有底色的小字）。字号按标题的比例走，
 * 跟着标题一起量，不会被挤出安全区。
 */
export function tailLine(
    text: string | undefined,
    look: { ink: string; background?: string; sizeEm: number },
): { suffix: string; css: string } {
    if (text === undefined) {
        return { suffix: '', css: '' };
    }
    const block = look.background === undefined ? '' : `padding: 0.12em 0.38em 0.16em;`;
    return {
        suffix: `<span class="tail">${escapeHtml(text)}</span>`,
        css: `
        .tail {
            display: table;
            margin-top: 0.34em;
            ${block}
            font-size: ${look.sizeEm}em;
            line-height: 1.1;
            letter-spacing: 0.02em;
            white-space: nowrap;
            -webkit-text-stroke: 0;
            background: ${look.background ?? 'transparent'};
            color: ${look.ink};
        }
        .copy-layer .tail {
            background: transparent;
            color: transparent;
            -webkit-text-stroke: 0;
        }`,
    };
}

/** 照片调色：同一张封面上的几张照片统一过一遍，拼图和对比的几张才像一套 */
function lookFilter(look: PhotoLook): string {
    switch (look) {
        case 'natural':
            return 'none';
        case 'mono':
            return 'grayscale(1) contrast(1.15)';
        case 'punch':
            return 'saturate(1.35) contrast(1.12)';
        case 'duotone':
            return 'grayscale(1) contrast(1.2)';
    }
}

/**
 * 照片图层：每张按给定的框铺满，压在标题下面。duotone 在照片上再叠两层：
 * 先把暗部抬成底色的深色，再把亮部染成强调色。brightness 是每张单独的亮度系数，对比类用它把两半拉平。
 */
export function photoLayers(
    photos: readonly { dataUri: string; rect: Rect; brightness?: number }[],
    look: PhotoLook,
    tone: { deep: string; accent: string },
): Layers {
    const base = lookFilter(look);
    const html = photos
        .map((photo, index) => {
            const filter = [
                base === 'none' ? '' : base,
                photo.brightness === undefined || Math.abs(photo.brightness - 1) < 0.01
                    ? ''
                    : `brightness(${photo.brightness.toFixed(3)})`,
            ]
                .filter((part) => part !== '')
                .join(' ');
            const style = `${rectCss(photo.rect)}${filter === '' ? '' : ` filter: ${filter};`}`;
            const duotone =
                look === 'duotone'
                    ? `<div class="tone tone-deep" style="${rectCss(photo.rect)}"></div><div class="tone tone-accent" style="${rectCss(photo.rect)}"></div>`
                    : '';
            return `<img class="photo photo-${index}" style="${style}" src="${photo.dataUri}" alt="">${duotone}`;
        })
        .join('');
    return {
        css: `
        .photo {
            position: absolute;
            z-index: -3;
            object-fit: cover;
        }
        .tone {
            position: absolute;
            z-index: -2;
            pointer-events: none;
        }
        .tone-deep {
            background: ${tone.deep};
            mix-blend-mode: lighten;
        }
        .tone-accent {
            background: ${tone.accent};
            mix-blend-mode: multiply;
        }`,
        html,
    };
}

// 描边的字（outline、double）自己带着字边的对比，渐变只需压住字下面的细节，
// 取 research.md 背景压暗 15-35% 的上限。软投影的字靠渐变托住，用类型给的强度。
const OUTLINED_SCRIM = 0.35;

/**
 * 局部压暗：只压字所在的那一侧，从字外一截开始由透明渐变到深色。整张压暗的封面在信息流里
 * 一贯吃亏（1of10 30 万条），字的可读性靠这块渐变加字自己的描边。
 */
export function localScrim(
    layout: CoverLayout,
    side: 'bottom' | 'top' | 'left' | 'right',
    type: TypeSpec,
    softStrength = 0.58,
): Layers {
    const strength =
        type.style === 'outline' || type.style === 'double'
            ? Math.min(softStrength, OUTLINED_SCRIM)
            : softStrength;
    const area = layout.textArea;
    const reach = 0.7;
    let rect: Rect;
    let angle: number;
    switch (side) {
        case 'bottom': {
            const top = Math.max(0, Math.round(area.y - area.height * reach));
            rect = { x: 0, y: top, width: layout.width, height: layout.height - top };
            angle = 180;
            break;
        }
        case 'top': {
            const bottom = Math.min(layout.height, Math.round(area.y + area.height * (1 + reach)));
            rect = { x: 0, y: 0, width: layout.width, height: bottom };
            angle = 0;
            break;
        }
        case 'left': {
            const right = Math.min(layout.width, Math.round(area.x + area.width * (1 + reach)));
            rect = { x: 0, y: 0, width: right, height: layout.height };
            angle = 270;
            break;
        }
        case 'right': {
            const left = Math.max(0, Math.round(area.x - area.width * reach));
            rect = { x: left, y: 0, width: layout.width - left, height: layout.height };
            angle = 90;
            break;
        }
    }
    return {
        css: `
        .scrim {
            position: absolute;
            z-index: -1;
            ${rectCss(rect)}
            background: linear-gradient(${angle}deg, transparent 0%, rgba(0, 0, 0, ${(strength * 0.55).toFixed(3)}) 45%, rgba(0, 0, 0, ${strength}) 100%);
        }`,
        html: '<div class="scrim" aria-hidden="true"></div>',
    };
}

export interface ChipSpec {
    text: string;
    /** 锚点：标签上边的中点或左上角，母版坐标 */
    x: number;
    y: number;
    anchor: 'center' | 'start';
    fontPx: number;
    background: string;
    ink: string;
    /** 描边和硬投影的颜色，不给就不描 */
    edge?: string;
    tilt?: number;
    fontFamily: string;
}

/** 标签：价签、前后标记、赌注。实色块、小圆角，挂 qc-text，质检把它当字 */
export function chips(specs: readonly ChipSpec[]): Layers {
    const html = specs
        .map((spec) => {
            const shift = spec.anchor === 'center' ? 'translateX(-50%) ' : '';
            const tilt = spec.tilt ? `rotate(${spec.tilt}deg)` : '';
            const edge =
                spec.edge === undefined
                    ? ''
                    : `border: ${Math.max(3, Math.round(spec.fontPx * 0.07))}px solid ${spec.edge}; box-shadow: ${Math.round(spec.fontPx * 0.07)}px ${Math.round(spec.fontPx * 0.07)}px 0 ${spec.edge};`;
            const style = [
                `left: ${Math.round(spec.x)}px`,
                `top: ${Math.round(spec.y)}px`,
                `font-size: ${Math.round(spec.fontPx)}px`,
                `font-family: ${spec.fontFamily}`,
                `background: ${spec.background}`,
                `color: ${spec.ink}`,
                shift || tilt ? `transform: ${shift}${tilt}` : '',
                edge,
            ]
                .filter((part) => part !== '')
                .join('; ');
            return `<div class="chip qc-text" style="${escapeHtml(style)}">${escapeHtml(spec.text)}</div>`;
        })
        .join('');
    return {
        css: `
        .chip {
            position: absolute;
            z-index: 3;
            padding: 0.14em 0.36em 0.16em;
            border-radius: 0.06em;
            font-weight: 900;
            line-height: 1;
            letter-spacing: 0.01em;
            white-space: nowrap;
            transform-origin: 50% 50%;
        }`,
        html,
    };
}
