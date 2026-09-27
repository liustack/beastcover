// 标题的「字怎么做」：描边、双层描边、硬投影、软投影、关键词高亮、倾斜。
// 描边和合成加粗在同一层字上互相冲突，所以同一份标题排版叠几层：底层外描边加硬投影，
// 中层白内圈（双层描边），顶层填色。几层的排版完全一样，断行不会错位。
// 参数都按字号的比例（em）写，母版放大多少倍都成立。依据见
// .issues/2026-09-27-breakout-design/research.md 第 1 节和第 7.1 节。
import type { FontChoice } from './fonts.ts';
import { escapeHtml, type Headline, headlineClauses } from './layout.ts';

export type TypeStyle = 'outline' | 'double' | 'soft' | 'ink';
export type HighlightMode = 'color' | 'block' | 'marker';

export interface TypeSpec {
    style: TypeStyle;
    font: FontChoice;
    highlight?: HighlightMode;
    /** 整块标题的倾斜角度，负数向左上翘。安静的封面不斜 */
    tilt?: number;
}

export interface TypeColors {
    fill: string;
    /** 外描边和硬投影的颜色 */
    stroke: string;
    /** 双层描边的内圈 */
    ring: string;
    /** 关键词高亮色 */
    accent: string;
    /** 实色底块上的字色，默认用 stroke */
    accentInk?: string;
}

// 外描边 8% 字号（教程常见 5-10%），硬投影往右下 5%，模糊 0。
const OUTLINE_EM = 0.08;
const SHADOW_EM = 0.05;
// 双层描边：白内圈外扩约 8.5%，黑外圈总外扩约 14%（日本设计师示例折算）。
const RING_EM = 0.085;
const DOUBLE_OUTER_EM = 0.14;
// 软投影只往下偏一点，模糊比偏移大。
const SOFT_OFFSET_EM = 0.04;
const SOFT_BLUR_EM = 0.14;

export interface EmphasisSegment {
    text: string;
    emphasis: boolean;
}

// 没有 *标记* 时自动高亮的「数字」：可带货币符号、千分位、小数，以及常见的量词尾巴。
const FIGURE = /[$¥€£]?\d[\d,.]*(?:[%xX×kKmMbB]|万|亿|倍)?/gu;

/** 读出 *关键词* 标记。没有标记时把数字当关键词。未闭合的 * 直接报错 */
export function parseEmphasis(text: string): EmphasisSegment[] {
    const marks = text.split('*');
    if (marks.length > 1) {
        if (marks.length % 2 === 0) {
            throw new Error(`The headline has an unclosed * mark: ${text}`);
        }
        return marks
            .map((part, index) => ({ text: part, emphasis: index % 2 === 1 }))
            .filter((segment) => segment.text !== '');
    }
    const segments: EmphasisSegment[] = [];
    let cursor = 0;
    for (const match of text.matchAll(FIGURE)) {
        const start = match.index;
        if (start > cursor) {
            segments.push({ text: text.slice(cursor, start), emphasis: false });
        }
        segments.push({ text: match[0], emphasis: true });
        cursor = start + match[0].length;
    }
    if (cursor < text.length) {
        segments.push({ text: text.slice(cursor), emphasis: false });
    }
    return segments;
}

/** 去掉 *标记* 后的纯文本，量字号、数字数、写进封面都用它 */
export function stripEmphasis(text: string): string {
    return text.replaceAll('*', '');
}

/** 特效往字外伸出多少（em）：外描边加硬投影。量字号时作为内边距，特效也落在安全区里 */
export function typeExtentEm(spec: TypeSpec): number {
    const synthetic = spec.font.syntheticBold / 2;
    switch (spec.style) {
        case 'outline':
            return OUTLINE_EM + SHADOW_EM + synthetic;
        case 'double':
            return DOUBLE_OUTER_EM + SHADOW_EM + synthetic;
        case 'soft':
            return SOFT_OFFSET_EM + synthetic;
        case 'ink':
            return synthetic;
    }
}

const SEGMENTER = new Intl.Segmenter('zh', { granularity: 'word' });
const HAN_WORD = /^\p{Script=Han}{2,}$/u;

/** 一段文字按高亮切开，每段转义，高亮段包进 .hl */
function emphasisRuns(chars: readonly string[], mask: readonly boolean[], from: number): string {
    let html = '';
    let index = 0;
    while (index < chars.length) {
        const on = mask[from + index] === true;
        let end = index;
        while (end < chars.length && (mask[from + end] === true) === on) {
            end += 1;
        }
        const run = escapeHtml(chars.slice(index, end).join(''));
        html += on ? `<span class="hl">${run}</span>` : run;
        index = end;
    }
    return html;
}

/** 标题正文：中文词包进 .word 不拆，短句包进 .clause，关键词包进 .hl */
export function emphasisMarkup(text: string, headline: Headline): string {
    const segments = parseEmphasis(text);
    const plain = segments.map((segment) => segment.text).join('');
    const mask = segments.flatMap((segment) => Array.from(segment.text, () => segment.emphasis));
    const clauses = headline.keepClauses ? headlineClauses(plain) : [plain];
    const all = Array.from(plain);
    let offset = 0;
    let html = '';
    for (const clause of clauses) {
        const clauseChars = Array.from(clause);
        // 短句是 plain 去掉首尾空白后按标点切的，按字符找回它在 plain 里的起点。
        while (
            offset < all.length &&
            all.slice(offset, offset + clauseChars.length).join('') !== clause
        ) {
            offset += 1;
        }
        let inner = '';
        let cursor = offset;
        for (const { segment } of SEGMENTER.segment(clause)) {
            const chars = Array.from(segment);
            const runs = emphasisRuns(chars, mask, cursor);
            inner += HAN_WORD.test(segment) ? `<span class="word">${runs}</span>` : runs;
            cursor += chars.length;
        }
        html += headline.keepClauses ? `<span class="clause">${inner}</span>` : inner;
        offset += clauseChars.length;
    }
    return html;
}

const LAYERS: Readonly<Record<TypeStyle, readonly string[]>> = {
    outline: ['copy-outline'],
    double: ['copy-outline', 'copy-ring'],
    soft: [],
    ink: [],
};

/**
 * 叠好的标题：描边层在下（只给眼睛看，读屏跳过），填色层 .copy 在最上。
 * prefix 是放在标题同一段里的小标签（痛点标签），跟标题一起量字号，不会被挤出安全区。
 */
export function headlineLayers(
    text: string,
    headline: Headline,
    spec: TypeSpec,
    prefix = '',
): string {
    const markup = prefix + emphasisMarkup(text, headline);
    const under = LAYERS[spec.style]
        .map((layer) => `<p class="copy-layer ${layer}" aria-hidden="true">${markup}</p>`)
        .join('');
    return `<div class="headline-stack">${under}<p class="copy">${markup}</p></div>`;
}

function em(value: number): string {
    return `${Number(value.toFixed(4))}em`;
}

/** 标题的字体、字重、描边、投影、高亮样式，写在版式的 headlineCss 之后，覆盖它的字体设置 */
export function headlineTypeCss(spec: TypeSpec, colors: TypeColors): string {
    const { font } = spec;
    const extent = typeExtentEm(spec);
    const heavy =
        font.role === 'heavy' || font.role === 'condensed' || font.degradedFrom !== undefined;
    const spacing = spec.style === 'outline' || spec.style === 'double' ? 0.02 : -0.02;
    const accentInk = colors.accentInk ?? colors.stroke;
    const outer = spec.style === 'double' ? DOUBLE_OUTER_EM : OUTLINE_EM;
    // 描边往外扩、投影往下落，行距不拉开这么多，上一行的描边和投影就压到下一行的描边上。
    const outlined = spec.style === 'outline' || spec.style === 'double';
    const synthetic =
        font.syntheticBold > 0
            ? `-webkit-text-stroke: ${em(font.syntheticBold)} ${colors.fill};`
            : '';
    const highlight = (() => {
        switch (spec.highlight ?? 'color') {
            case 'color':
                return `.copy .hl { color: ${colors.accent}; }`;
            case 'block':
                return `.copy .hl {
            color: ${accentInk};
            background: ${colors.accent};
            padding: 0 0.12em;
            -webkit-box-decoration-break: clone;
            box-decoration-break: clone;
        }`;
            case 'marker':
                return `.copy .hl {
            background: linear-gradient(transparent 58%, ${colors.accent} 58%, ${colors.accent} 92%, transparent 92%);
            -webkit-box-decoration-break: clone;
            box-decoration-break: clone;
        }`;
        }
    })();
    const softShadow =
        spec.style === 'soft'
            ? `text-shadow: 0 ${em(SOFT_OFFSET_EM)} ${em(SOFT_BLUR_EM)} rgba(0, 0, 0, 0.6), 0 0 ${em(0.03)} rgba(0, 0, 0, 0.4);`
            : '';
    return `
        .headline-stack {
            position: relative;
            ${spec.tilt ? `transform: rotate(${spec.tilt}deg);` : ''}
        }

        .copy,
        .copy-layer {
            font-family: ${font.stack};
            font-weight: ${heavy ? 900 : 400};
            letter-spacing: ${em(spacing)};
            padding: ${em(extent)};
            ${outlined ? `line-height: ${Number((1 + outer + SHADOW_EM).toFixed(3))};` : ''}
        }

        .copy-layer {
            position: absolute;
            inset: 0;
            margin: 0;
            pointer-events: none;
        }

        .copy-outline {
            color: ${colors.stroke};
            -webkit-text-stroke: ${em(outer * 2)} ${colors.stroke};
            paint-order: stroke fill;
            filter: drop-shadow(${em(SHADOW_EM)} ${em(SHADOW_EM)} 0 ${colors.stroke});
        }

        .copy-ring {
            color: ${colors.ring};
            -webkit-text-stroke: ${em(RING_EM * 2)} ${colors.ring};
            paint-order: stroke fill;
        }

        .copy {
            color: ${colors.fill};
            ${synthetic}
            ${softShadow}
        }

        /* 量字号的探针也带 .copy，不能被拉回文档流，只给真正的标题加定位 */
        .copy:not(.probe) {
            position: relative;
        }

        ${highlight}`;
}
