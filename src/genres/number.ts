// 数字冲击：纯色或渐变底，一个反差色的超大数字，旁边一句短话。数字用窄粗体（西文数字最有冲击力），
// 黑色外描边加硬投影压在底上，短话白字黑描边。数字和短话各占一块，各自量到能放下的最大字号。
// 配方依据：research.md 第 5.3 节「数字冲击」、第 7.1 节描边和投影参数。
import type { CoverTemplate } from '../compose/index.ts';
import type { Rect } from '../platforms/index.ts';
import type { FontChoice } from '../render/fonts.ts';
import { type CoverLayout, escapeHtml, type Headline } from '../render/layout.ts';
import { coverDocument } from '../render/template.ts';
import type { TypeColors, TypeSpec } from '../render/type.ts';
import { eyebrow, type FontKit, genrePage, rectCss } from './page.ts';
import { isLightScheme, SCHEMES, type SchemeName, schemeGradient } from './schemes.ts';

export interface NumberRequest {
    text: string;
    figure: string;
    fonts: FontKit;
    scheme?: SchemeName;
    tag?: string;
}

// 数字的描边、硬投影和它们往外伸出的量（em），量字号时算进内边距。
const FIGURE_OUTLINE_EM = 0.06;
const FIGURE_SHADOW_EM = 0.06;

function accentAreaOf(layout: CoverLayout): Rect {
    if (layout.accentArea === undefined) {
        throw new Error('The number cover needs a layout with an accent area.');
    }
    return layout.accentArea;
}

// 数字和短话之间的空隙占标题区短边的比例，竖版数字占标题区高度的比例。
const GAP_SHARE = 0.04;
const PORTRAIT_FIGURE_SHARE = 0.52;
// 横排时数字块宽度的上下限（占标题区宽度）。
const FIGURE_WIDTH_SHARE: [number, number] = [0.24, 0.5];

/** 数字大约多宽，单位是字号：西文数字和符号约 0.6 个字宽，汉字 1 个，再加两侧描边的内边距 */
function figureWidthEm(figure: string): number {
    const glyphs = Array.from(figure).reduce(
        (sum, char) => sum + (/\p{Script=Han}/u.test(char) ? 1 : 0.6),
        0,
    );
    return glyphs + (FIGURE_OUTLINE_EM + FIGURE_SHADOW_EM) * 2;
}

/**
 * 横版、超宽左右分，竖版上下分：数字放 accentArea，短话放 textArea。横排时数字块按数字长短定宽：
 * 数字按高度放满时大约多宽就给多宽，一位数不会在左边空出一大块，剩下的都给短话。
 */
export function figureLayout(layout: CoverLayout, figure: string): CoverLayout {
    const area = layout.textArea;
    const gap = Math.round(Math.min(area.width, area.height) * GAP_SHARE);
    if (area.width >= area.height) {
        // 按高度放满时的字号：行高 0.9 加上下内边距。
        const em = area.height / (0.9 + (FIGURE_OUTLINE_EM + FIGURE_SHADOW_EM) * 2);
        const [low, high] = FIGURE_WIDTH_SHARE;
        const width = Math.round(
            Math.min(area.width * high, Math.max(area.width * low, figureWidthEm(figure) * em)),
        );
        return {
            ...layout,
            accentArea: { x: area.x, y: area.y, width, height: area.height },
            textArea: {
                x: area.x + width + gap,
                y: area.y,
                width: area.width - width - gap,
                height: area.height,
            },
        };
    }
    const height = Math.round(area.height * PORTRAIT_FIGURE_SHARE);
    return {
        ...layout,
        accentArea: { x: area.x, y: area.y, width: area.width, height },
        textArea: {
            x: area.x,
            y: area.y + height + gap,
            width: area.width,
            height: area.height - height - gap,
        },
    };
}

/** 数字块：描边层在下，填色层在上。measure 时填色层带 .copy，给量字号用 */
function figureMarkup(
    layout: CoverLayout,
    figure: string,
    fontPx: number,
    font: FontChoice,
    colors: TypeColors,
    light: boolean,
    measure: boolean,
): { css: string; html: string } {
    const area = accentAreaOf(layout);
    const sideBySide = area.y === layout.textArea.y;
    const extent = FIGURE_OUTLINE_EM + FIGURE_SHADOW_EM;
    const text = escapeHtml(figure);
    const edge = colors.stroke;
    return {
        css: `
        .figure-box {
            position: absolute;
            ${rectCss(area)}
            z-index: 1;
            display: flex;
            align-items: center;
            justify-content: ${sideBySide ? 'flex-end' : 'center'};
        }
        .figure-stack {
            position: relative;
        }
        .figure-face,
        .figure-edge {
            margin: 0;
            padding: ${extent}em;
            font-family: ${font.stack};
            font-size: ${fontPx}px;
            font-weight: 900;
            line-height: 0.9;
            letter-spacing: -0.01em;
            white-space: nowrap;
        }
        .figure-face {
            position: relative;
            color: ${light ? colors.stroke : colors.accent};
        }
        .figure-edge {
            position: absolute;
            inset: 0;
            color: ${edge};
            ${
                // 浅底上数字本身就是深色，同色描边只会把笔画里的空洞糊死，只留强调色的硬投影。
                light
                    ? `color: ${colors.accent}; transform: translate(${FIGURE_SHADOW_EM * 1.4}em, ${FIGURE_SHADOW_EM * 1.4}em);`
                    : `-webkit-text-stroke: ${FIGURE_OUTLINE_EM * 2}em ${edge}; paint-order: stroke fill; filter: drop-shadow(${FIGURE_SHADOW_EM}em ${FIGURE_SHADOW_EM}em 0 ${edge});`
            }
        }`,
        html: `<div class="figure-box"><div class="figure-stack"><p class="figure-edge qc-text" aria-hidden="true">${text}</p><p class="figure-face ${measure ? 'copy' : 'figure'}">${text}</p></div></div>`,
    };
}

export function numberGenreTemplate(request: NumberRequest): CoverTemplate {
    const schemeName = request.scheme ?? 'orange';
    const scheme = SCHEMES[schemeName];
    const light = isLightScheme(schemeName);
    const figureFont = request.fonts.choose('condensed');
    const type: TypeSpec = light
        ? { style: 'ink', font: request.fonts.choose('heavy'), highlight: 'marker' }
        : { style: 'outline', font: request.fonts.choose('heavy'), highlight: 'color' };
    const background = light ? scheme.base : schemeGradient(scheme);
    const tag = eyebrow(
        request.tag,
        light
            ? { background: scheme.type.stroke, ink: scheme.base }
            : { background: scheme.type.accent, ink: scheme.type.stroke },
    );
    const page = (layout: CoverLayout, headline: Headline, measure: boolean) => {
        const figurePx = headline.accentPx;
        const figure =
            figurePx === undefined
                ? { css: '', html: '' }
                : figureMarkup(
                      layout,
                      request.figure,
                      figurePx,
                      figureFont,
                      scheme.type,
                      light,
                      false,
                  );
        return genrePage({
            layout,
            headline,
            text: request.text,
            type,
            colors: scheme.type,
            background,
            measure,
            // 竖版数字在上、短话在下，都居中；横版短话贴着数字左对齐。
            align: {
                x:
                    layout.accentArea !== undefined && layout.accentArea.y < layout.textArea.y
                        ? 'center'
                        : 'start',
                y: 'center',
            },
            prefix: tag.prefix,
            over: { css: `${tag.css}${figure.css}`, html: figure.html },
        });
    };
    return {
        layoutFor: (layout) => figureLayout(layout, request.figure),
        // 只排数字的量字号页面：数字本身就是 .copy。
        measureAccentHtml: (layout, fontPx) => {
            const figure = figureMarkup(
                layout,
                request.figure,
                fontPx,
                figureFont,
                scheme.type,
                light,
                true,
            );
            return coverDocument({
                layout,
                colors: {
                    paper: scheme.type.fill,
                    ink: scheme.type.stroke,
                    accent: scheme.type.accent,
                },
                background,
                fontFamily: figureFont.stack,
                css: figure.css,
                body: figure.html,
            });
        },
        measureHtml: (layout, headline) =>
            page(layout, { fontPx: headline.fontPx, keepClauses: headline.keepClauses }, true),
        renderHtml: async (layout, headline) => {
            if (headline.accentPx === undefined) {
                throw new Error('The number cover needs a fitted figure size.');
            }
            return { html: page(layout, headline, false), subjects: [] };
        },
    };
}
