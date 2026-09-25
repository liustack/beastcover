import { type PaletteSlotValue, parseCssColorValue } from '../styles/schema.ts';
import type { SubjectLayer } from '../subject/index.ts';
import {
    type CoverLayout,
    escapeHtml,
    type Headline,
    headlineMarkup,
    lineHeightFor,
    probeMarkup,
    textAreaCss,
} from './layout.ts';

export const DEFAULT_RENDER_COLORS = {
    paper: '#f1eee6',
    ink: '#161711',
    accent: '#1746d1',
} as const;

export interface RenderTemplateOptions {
    layout: CoverLayout;
    /** 标题字号和断行方式，由渲染器在标题区域里量出来 */
    headline: Headline;
    palette?: Record<string, PaletteSlotValue>;
    /** 量字号时加上探针 */
    measure?: boolean;
    /** 抠好的人物，版式里要有 subjectArea */
    subject?: SubjectLayer;
}

/** 人物层：贴着人物区底边居中，白描边加一层投影，压在标题上面 */
export function subjectMarkup(
    layout: CoverLayout,
    subject: SubjectLayer | undefined,
): {
    css: string;
    html: string;
} {
    if (subject === undefined) {
        return { css: '', html: '' };
    }
    const area = layout.subjectArea;
    if (area === undefined) {
        throw new Error('A subject needs a layout with a subject area.');
    }
    const stroke = Math.max(3, Math.round(Math.min(layout.width, layout.height) * 0.007));
    return {
        css: `
        .subject {
            position: absolute;
            left: ${area.x}px;
            top: ${area.y}px;
            width: ${area.width}px;
            height: ${area.height}px;
            z-index: 2;
            display: flex;
            align-items: flex-end;
            justify-content: center;
        }

        .subject img {
            /* 撑满人物区再按比例收回，小图也会放大到版位尺寸，贴着底边居中。 */
            width: 100%;
            height: 100%;
            object-fit: contain;
            object-position: 50% 100%;
            filter: drop-shadow(${stroke}px 0 0 #fff) drop-shadow(-${stroke}px 0 0 #fff)
                drop-shadow(0 ${stroke}px 0 #fff) drop-shadow(0 -${stroke}px 0 #fff)
                drop-shadow(0 ${stroke * 2}px ${stroke * 4}px rgba(0, 0, 0, 0.35));
        }`,
        html: `<div class="subject" aria-hidden="true"><img src="${subject.dataUri}" alt=""></div>`,
    };
}

// 色条贴在标题区域左边 24px 处，公众号从超宽母版裁切时也还在画面里。
const ACCENT_BAR_OFFSET = 36;

/** 两个模板共用的标题排版：区域定位、字号、断行规则和探针 */
export function headlineCss(layout: CoverLayout, headline: Headline, text: string): string {
    return `
        .text-box {
            position: absolute;
            ${textAreaCss(layout)}
            display: flex;
        }

        .copy {
            margin: 0;
            font-size: ${headline.fontPx}px;
            font-weight: 600;
            letter-spacing: -0.04em;
            line-height: ${lineHeightFor(text)};
            text-wrap: balance;
            white-space: pre-wrap;
            /* 中文按字正常断行，balance 才能把几行排匀，不会只剩一个字挂在最后一行。
               西文单词不拆开，量字号时的探针保证最长的单词放得下。 */
            word-break: normal;
            overflow-wrap: anywhere;
        }

        .clause {
            display: inline-block;
        }

        .probe {
            position: absolute;
            top: 0;
            left: 0;
            visibility: hidden;
            white-space: nowrap;
        }

        .accent-bar {
            position: absolute;
            left: ${Math.max(0, layout.textArea.x - ACCENT_BAR_OFFSET)}px;
            top: ${layout.textArea.y}px;
            width: 12px;
            height: ${layout.textArea.height}px;
            background: var(--cover-accent);
        }`;
}

function slotCss(palette: Record<string, PaletteSlotValue>, name: string): string | undefined {
    const slot = palette[name];
    if (slot === undefined) {
        return undefined;
    }
    if (typeof slot.css !== 'string') {
        throw new Error(`Palette slot "${name}" is missing a CSS color.`);
    }
    return parseCssColorValue(slot.css);
}

export function resolveRenderColors(palette: Record<string, PaletteSlotValue> = {}): {
    paper: string;
    ink: string;
    accent: string;
} {
    return {
        paper:
            slotCss(palette, 'paper') ??
            slotCss(palette, 'background') ??
            DEFAULT_RENDER_COLORS.paper,
        ink: slotCss(palette, 'dark') ?? DEFAULT_RENDER_COLORS.ink,
        accent:
            slotCss(palette, 'accent') ??
            slotCss(palette, 'primary') ??
            DEFAULT_RENDER_COLORS.accent,
    };
}

export function createRenderTemplate(text: string, options: RenderTemplateOptions): string {
    const palette = options.palette ?? {};
    for (const [name, slot] of Object.entries(palette)) {
        if (typeof slot.css !== 'string') {
            throw new Error(`Palette slot "${name}" is missing a CSS color.`);
        }
        parseCssColorValue(slot.css);
    }
    const colors = resolveRenderColors(palette);
    const paletteJson = escapeHtml(JSON.stringify(palette));
    const { layout } = options;
    const subject = subjectMarkup(layout, options.subject);

    return `<!doctype html>
<html lang="en">
<head>
    <meta charset="utf-8">
    <title>BeastCover</title>
    <style>
        :root {
            color-scheme: light;
            font-family: "Iowan Old Style", "Palatino Linotype", "Book Antiqua", Palatino, "Songti SC", serif;
            --cover-paper: ${colors.paper};
            --cover-ink: ${colors.ink};
            --cover-accent: ${colors.accent};
            background: var(--cover-paper);
            color: var(--cover-ink);
        }

        * {
            box-sizing: border-box;
        }

        html,
        body {
            width: ${layout.width}px;
            height: ${layout.height}px;
            margin: 0;
            overflow: hidden;
            background: var(--cover-paper);
        }

        #canvas {
            position: relative;
            width: ${layout.width}px;
            height: ${layout.height}px;
        }
${headlineCss(layout, options.headline, text)}

        .text-box {
            align-items: center;
        }
${subject.css}
    </style>
</head>
<body>
    <main id="canvas">
        <div class="accent-bar" aria-hidden="true"></div>
        <section class="text-box" aria-label="Headline">
            <p class="copy">${headlineMarkup(text, options.headline)}</p>${options.measure ? probeMarkup(text, options.headline) : ''}
        </section>
        ${subject.html}
    </main>
    <script type="application/json" id="beastcover-palette">${paletteJson}</script>
</body>
</html>`;
}
