// 前后对比：两张图分屏，接缝处一个大箭头，两边可以各带一个标签，标题压在一条遮罩带上。
// 横版和超宽左右分，竖版上下分。分屏线落在母版正中，各平台都从正中裁，所以两边都看得到。
import type { FamilyName, Rect } from '../platforms/index.ts';
import type { PaletteSlotValue } from '../styles/schema.ts';
import {
    type CoverLayout,
    escapeHtml,
    type Headline,
    headlineMarkup,
    probeMarkup,
} from './layout.ts';
import type { PhotoLayer } from './photo-cover.ts';
import {
    BOLD_SANS,
    contrastingText,
    coverDocument,
    headlineCss,
    resolveRenderColors,
    validatePaletteCss,
} from './template.ts';

export const MAX_LABEL_LENGTH = 8;

export interface ComparePanels {
    split: 'columns' | 'rows';
    first: Rect;
    second: Rect;
    /** 箭头圆心 */
    arrow: { x: number; y: number; size: number };
    /** 两个标签的左上角和字号 */
    labels: [{ x: number; y: number }, { x: number; y: number }];
    labelPx: number;
}

// 每族的标题带和标签位置都在族的安全区内，箭头在分屏线正中。
const COMPARE_LAYOUTS: Readonly<Record<FamilyName, { textArea: Rect; panels: ComparePanels }>> = {
    landscape: {
        textArea: { x: 192, y: 792, width: 1392, height: 216 },
        panels: {
            split: 'columns',
            first: { x: 0, y: 0, width: 960, height: 1200 },
            second: { x: 960, y: 0, width: 960, height: 1200 },
            arrow: { x: 960, y: 456, size: 180 },
            labels: [
                { x: 192, y: 132 },
                { x: 1008, y: 132 },
            ],
            labelPx: 56,
        },
    },
    portrait: {
        textArea: { x: 86, y: 384, width: 842, height: 288 },
        panels: {
            split: 'rows',
            first: { x: 0, y: 0, width: 1080, height: 960 },
            second: { x: 0, y: 960, width: 1080, height: 960 },
            arrow: { x: 540, y: 960, size: 170 },
            labels: [
                { x: 86, y: 800 },
                { x: 86, y: 1440 },
            ],
            labelPx: 52,
        },
    },
    ultrawide: {
        textArea: { x: 576, y: 472, width: 768, height: 192 },
        panels: {
            split: 'columns',
            first: { x: 0, y: 0, width: 960, height: 768 },
            second: { x: 960, y: 0, width: 960, height: 768 },
            arrow: { x: 960, y: 256, size: 208 },
            labels: [
                { x: 576, y: 72 },
                { x: 1000, y: 72 },
            ],
            labelPx: 60,
        },
    },
};

export function compareLayout(
    layout: CoverLayout | (CoverLayout & { panels: ComparePanels }),
): CoverLayout & { panels: ComparePanels } {
    // 已经分过屏的版式原样返回，重复调用不会把标题带再缩一次。
    if ('panels' in layout) {
        return layout;
    }
    if (layout.family !== undefined) {
        const preset = COMPARE_LAYOUTS[layout.family];
        return { ...layout, textArea: { ...preset.textArea }, panels: preset.panels };
    }
    // 自定义画布：宽的左右分、标题带在下，高的上下分、标题带在上。
    const area = layout.textArea;
    const short = Math.min(layout.width, layout.height);
    const labelPx = Math.round(short * 0.05);
    const size = Math.round(short * 0.15);
    if (layout.width >= layout.height) {
        const half = Math.round(layout.width / 2);
        const band = Math.round(area.height * 0.25);
        return {
            ...layout,
            textArea: {
                x: area.x,
                y: area.y + area.height - band,
                width: area.width,
                height: band,
            },
            panels: {
                split: 'columns',
                first: { x: 0, y: 0, width: half, height: layout.height },
                second: { x: half, y: 0, width: layout.width - half, height: layout.height },
                arrow: { x: half, y: Math.round(layout.height * 0.4), size },
                labels: [
                    { x: area.x, y: area.y },
                    { x: half + Math.round(area.x / 2), y: area.y },
                ],
                labelPx,
            },
        };
    }
    const half = Math.round(layout.height / 2);
    const band = Math.round(area.height * 0.25);
    return {
        ...layout,
        textArea: { x: area.x, y: area.y, width: area.width, height: band },
        panels: {
            split: 'rows',
            first: { x: 0, y: 0, width: layout.width, height: half },
            second: { x: 0, y: half, width: layout.width, height: layout.height - half },
            arrow: { x: Math.round(layout.width / 2), y: half, size },
            labels: [
                { x: area.x, y: half - labelPx * 2 },
                { x: area.x, y: half + size },
            ],
            labelPx,
        },
    };
}

export function parseLabels(value: string): [string, string] {
    const parts = value.split(',').map((part) => part.trim());
    if (parts.length !== 2 || parts.some((part) => part === '')) {
        throw new Error('--labels takes two labels separated by a comma, like "Before,After".');
    }
    for (const part of parts) {
        if (Array.from(part).length > MAX_LABEL_LENGTH) {
            throw new Error(`Each --labels entry must be ${MAX_LABEL_LENGTH} characters or fewer.`);
        }
    }
    return [parts[0] as string, parts[1] as string];
}

export interface CompareOptions {
    layout: CoverLayout & { panels: ComparePanels };
    headline: Headline;
    palette?: Record<string, PaletteSlotValue>;
    labels?: [string, string];
    /** 量字号时不需要两张图 */
    images?: [PhotoLayer, PhotoLayer];
    measure?: boolean;
}

function rectCss(rect: Rect): string {
    return `left: ${rect.x}px; top: ${rect.y}px; width: ${rect.width}px; height: ${rect.height}px;`;
}

export function createCompareTemplate(text: string, options: CompareOptions): string {
    const palette = options.palette ?? {};
    validatePaletteCss(palette);
    const colors = resolveRenderColors(palette);
    const { layout } = options;
    const { panels } = layout;
    if (options.measure !== true && options.images === undefined) {
        throw new Error('The compare template needs two images.');
    }
    const band = layout.textArea;
    // 遮罩带比标题区四周各宽出一截，从透明渐变到深色，保证白字压在任何图上都看得清。
    const scrimTop = panels.split === 'columns';
    const scrim: Rect = scrimTop
        ? {
              x: 0,
              y: Math.max(0, band.y - band.height),
              width: layout.width,
              height: layout.height - Math.max(0, band.y - band.height),
          }
        : { x: 0, y: 0, width: layout.width, height: band.y + band.height * 2 };
    const arrowRotate = panels.split === 'rows' ? 90 : 0;
    const images = options.images;
    const labels = options.labels;

    return coverDocument({
        layout,
        colors,
        background: 'var(--cover-ink)',
        fontFamily: BOLD_SANS,
        css: `${headlineCss(layout, options.headline, text)}

        .accent-bar {
            display: none;
        }

        .panel {
            position: absolute;
            z-index: -3;
            object-fit: cover;
        }

        .panel-a {
            ${rectCss(panels.first)}
        }

        .panel-b {
            ${rectCss(panels.second)}
        }

        /* 分屏线压在遮罩下面，标题带里不会有一条亮线穿过字。 */
        .seam {
            position: absolute;
            z-index: -2;
            background: var(--cover-paper);
            ${
                panels.split === 'columns'
                    ? `left: ${panels.second.x - 4}px; top: 0; width: 8px; height: ${layout.height}px;`
                    : `left: 0; top: ${panels.second.y - 4}px; width: ${layout.width}px; height: 8px;`
            }
        }

        .scrim {
            position: absolute;
            z-index: -1;
            ${rectCss(scrim)}
            background: linear-gradient(
                ${scrimTop ? '180deg' : '0deg'},
                transparent 0%,
                color-mix(in srgb, var(--cover-ink) 82%, transparent) 55%,
                color-mix(in srgb, var(--cover-ink) 88%, transparent) 100%
            );
        }

        .arrow {
            position: absolute;
            left: ${panels.arrow.x - panels.arrow.size / 2}px;
            top: ${panels.arrow.y - panels.arrow.size / 2}px;
            width: ${panels.arrow.size}px;
            height: ${panels.arrow.size}px;
            border-radius: 50%;
            background: var(--cover-accent);
            box-shadow: 0 0 0 ${Math.round(panels.arrow.size * 0.06)}px var(--cover-paper);
            display: flex;
            align-items: center;
            justify-content: center;
        }

        .arrow svg {
            width: 56%;
            height: 56%;
            transform: rotate(${arrowRotate}deg);
        }

        .arrow path {
            fill: none;
            stroke: ${contrastingText('var(--cover-accent)')};
            stroke-width: 3.2;
            stroke-linecap: round;
            stroke-linejoin: round;
        }

        .label {
            position: absolute;
            padding: ${Math.round(panels.labelPx * 0.22)}px ${Math.round(panels.labelPx * 0.45)}px;
            border-radius: ${Math.round(panels.labelPx * 0.2)}px;
            background: var(--cover-paper);
            color: var(--cover-ink);
            font-size: ${panels.labelPx}px;
            font-weight: 800;
            line-height: 1;
            white-space: nowrap;
        }

        .label-b {
            background: var(--cover-accent);
            color: ${contrastingText('var(--cover-accent)')};
        }

        .text-box {
            align-items: center;
        }

        .copy {
            color: #fff;
            font-weight: 800;
            letter-spacing: -0.02em;
            text-shadow: 0 2px 14px rgba(0, 0, 0, 0.45);
        }`,
        body: `        ${images ? `<img class="panel panel-a" src="${images[0].dataUri}" alt=""><img class="panel panel-b" src="${images[1].dataUri}" alt="">` : ''}
        <div class="seam" aria-hidden="true"></div>
        <div class="scrim" aria-hidden="true"></div>
        <div class="arrow" aria-hidden="true"><svg viewBox="0 0 24 24"><path d="M4 12h13M12 5l7 7-7 7"/></svg></div>
        ${labels ? `<div class="label label-a" style="left: ${panels.labels[0].x}px; top: ${panels.labels[0].y}px">${escapeHtml(labels[0])}</div><div class="label label-b" style="left: ${panels.labels[1].x}px; top: ${panels.labels[1].y}px">${escapeHtml(labels[1])}</div>` : ''}
        <section class="text-box" aria-label="Headline">
            <p class="copy">${headlineMarkup(text, options.headline)}</p>${options.measure ? probeMarkup(text, options.headline) : ''}
        </section>`,
    });
}
