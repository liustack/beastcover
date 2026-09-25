// 数字钩子：一个超大数字加一句短话。数字和短话各占一块，各自量到能放下的最大字号。
import type { Rect } from '../platforms/index.ts';
import type { PaletteSlotValue } from '../styles/schema.ts';
import {
    type CoverLayout,
    escapeHtml,
    type Headline,
    headlineMarkup,
    probeMarkup,
} from './layout.ts';
import {
    BOLD_SANS,
    coverDocument,
    headlineCss,
    resolveRenderColors,
    validatePaletteCss,
} from './template.ts';

export const MAX_NUMBER_LENGTH = 6;

// 数字和短话之间留的空隙，占整个标题区短边的比例。
const GAP_SHARE = 0.04;
// 数字占标题区的比例：左右分时占宽度，上下分时占高度。
const NUMBER_WIDTH_SHARE = 0.44;
const NUMBER_HEIGHT_SHARE = 0.5;

/** 横版、超宽左右分，竖版上下分：数字放 accentArea，短话放 textArea */
export function numberLayout(layout: CoverLayout): CoverLayout {
    const area = layout.textArea;
    const gap = Math.round(Math.min(area.width, area.height) * GAP_SHARE);
    let accentArea: Rect;
    let textArea: Rect;
    if (area.width >= area.height) {
        const numberWidth = Math.round(area.width * NUMBER_WIDTH_SHARE);
        accentArea = { x: area.x, y: area.y, width: numberWidth, height: area.height };
        textArea = {
            x: area.x + numberWidth + gap,
            y: area.y,
            width: area.width - numberWidth - gap,
            height: area.height,
        };
    } else {
        const numberHeight = Math.round(area.height * NUMBER_HEIGHT_SHARE);
        accentArea = { x: area.x, y: area.y, width: area.width, height: numberHeight };
        textArea = {
            x: area.x,
            y: area.y + numberHeight + gap,
            width: area.width,
            height: area.height - numberHeight - gap,
        };
    }
    return { ...layout, accentArea, textArea };
}

export function validateNumber(value: string): string {
    const trimmed = value.trim();
    if (trimmed === '') {
        throw new Error('--number must not be empty.');
    }
    if (Array.from(trimmed).length > MAX_NUMBER_LENGTH) {
        throw new Error(
            `--number is longer than ${MAX_NUMBER_LENGTH} characters. Use a figure like 3, 90%, or 10x.`,
        );
    }
    return trimmed;
}

export interface NumberOptions {
    layout: CoverLayout;
    headline: Headline;
    figure: string;
    palette?: Record<string, PaletteSlotValue>;
    /** headline：量短话；figure：只排数字，量数字 */
    measure?: 'headline' | 'figure';
}

function accentAreaOf(layout: CoverLayout): Rect {
    if (layout.accentArea === undefined) {
        throw new Error('The number template needs a layout with an accent area.');
    }
    return layout.accentArea;
}

export function createNumberTemplate(text: string, options: NumberOptions): string {
    const palette = options.palette ?? {};
    validatePaletteCss(palette);
    const colors = resolveRenderColors(palette);
    const { layout } = options;
    const accent = accentAreaOf(layout);
    // 量短话时不排数字，量数字时用正在试的字号，正式渲染用量好的数字字号。
    const figurePx =
        options.measure === 'figure'
            ? options.headline.fontPx
            : options.measure === 'headline'
              ? undefined
              : options.headline.accentPx;
    if (figurePx === undefined && options.measure === undefined) {
        throw new Error('The number template needs a fitted figure size.');
    }
    const figureBox = `left: ${accent.x}px; top: ${accent.y}px; width: ${accent.width}px; height: ${accent.height}px;`;
    // 数字和短话左右并排时数字靠右贴近短话，上下排时数字靠左和短话对齐。
    const sideBySide = accent.y === layout.textArea.y;
    // 量数字时数字本身就是 .copy，量短话时数字换个类名，免得被当成标题。
    const figureClass = options.measure === 'figure' ? 'copy figure' : 'figure';
    const headlineHtml =
        options.measure === 'figure'
            ? ''
            : `
        <section class="text-box" aria-label="Headline">
            <p class="copy">${headlineMarkup(text, options.headline)}</p>${options.measure === 'headline' ? probeMarkup(text, options.headline) : ''}
        </section>`;

    return coverDocument({
        layout,
        colors,
        background: 'var(--cover-paper)',
        fontFamily: BOLD_SANS,
        css: `${headlineCss(layout, options.headline, text)}

        .accent-bar {
            display: none;
        }

        .text-box {
            align-items: center;
        }

        .copy {
            color: var(--cover-ink);
            font-weight: 800;
            letter-spacing: -0.02em;
        }

        .figure-box {
            position: absolute;
            ${figureBox}
            display: flex;
            align-items: center;
            justify-content: ${sideBySide ? 'flex-end' : 'flex-start'};
        }

        .figure {
            display: inline-block;
            margin: 0;
            color: var(--cover-accent);
            font-size: ${figurePx ?? 0}px;
            font-weight: 900;
            letter-spacing: -0.06em;
            line-height: 0.86;
            white-space: nowrap;
        }`,
        body: `${figurePx === undefined ? '' : `        <div class="figure-box"><p class="${figureClass}">${escapeHtml(options.figure)}</p></div>`}${headlineHtml}`,
    });
}
