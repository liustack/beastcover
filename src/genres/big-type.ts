// 大字报：字就是主体。亮底配重黑字（小红书、公众号的干货和观点），暗底配白字黑描边（喧闹的海报）。
// 一个关键词荧光笔、实色块或换色；痛点标签放在标题同一段里，字号跟着标题走。
// memo 风格画成手机备忘录：浅蓝笔记纸、顶上一条「‹ 备忘录」，字靠左排在下面那一页的中间，关键词压黄色荧光笔。
// 配方依据：research.md 第 5.1 节「大字报配方」、第 1 节字的处理。
import type { CoverTemplate } from '../compose/index.ts';
import type { CoverLayout, Headline } from '../render/layout.ts';
import type { TypeColors, TypeSpec } from '../render/type.ts';
import { eyebrow, type FontKit, genrePage, type Layers, NO_LAYERS, rectCss } from './page.ts';
import { isLightScheme, SCHEMES, type SchemeName, schemeGradient } from './schemes.ts';
import { type StyleName, styledType } from './styles.ts';

export interface BigTypeRequest {
    text: string;
    fonts: FontKit;
    scheme?: SchemeName;
    tag?: string;
    style?: StyleName;
}

// 备忘录的颜色：浅蓝笔记纸、近黑的字、备忘录那种偏橙的黄做返回键，关键词压亮黄荧光笔，
// 标签是一张黄便签。纯白纸只有荧光笔一点颜色，缩进信息流里发灰，冷纸也把暖黄托出来
// （research.md 第 4.5 节亮度彩度要同高，第 5.1 节小红书备忘录风）。
const MEMO_PAPER = '#E3EEFA';
const MEMO_INK = '#1C1C1E';
const MEMO_CHROME = '#C98A00';
const MEMO_RULE = '#C5D5E8';
const MEMO_MARKER = '#FFD60A';
const MEMO_COLORS: TypeColors = {
    fill: MEMO_INK,
    stroke: MEMO_INK,
    ring: MEMO_PAPER,
    accent: MEMO_MARKER,
    accentInk: MEMO_INK,
};
// 顶栏高度占短边的比例，字号占顶栏高的比例。
const MEMO_BAR_SHARE = 0.085;
const MEMO_BAR_TEXT = 0.42;

function memoBarHeight(layout: CoverLayout): number {
    return Math.round(Math.min(layout.width, layout.height) * MEMO_BAR_SHARE);
}

/** 备忘录版式：顶栏占掉标题区最上面一条，字从顶栏下面开始 */
function memoLayout(layout: CoverLayout): CoverLayout {
    const bar = memoBarHeight(layout);
    const area = layout.textArea;
    return {
        ...layout,
        textArea: { ...area, y: area.y + bar * 1.4, height: area.height - bar * 1.4 },
    };
}

/** 顶栏：左边「‹ 备忘录」，右边「完成」，下面一条细分隔线 */
function memoBar(layout: CoverLayout, fontStack: string): Layers {
    const bar = memoBarHeight(layout);
    const area = layout.textArea;
    const rect = { x: area.x, y: area.y - bar * 1.4, width: area.width, height: bar };
    return {
        css: `
        .memo-bar {
            position: absolute;
            ${rectCss(rect)}
            display: flex;
            align-items: center;
            justify-content: space-between;
            border-bottom: ${Math.max(2, Math.round(bar * 0.04))}px solid ${MEMO_RULE};
            font-family: ${fontStack};
            font-weight: 500;
            font-size: ${Math.round(bar * MEMO_BAR_TEXT)}px;
            color: ${MEMO_CHROME};
        }
        .memo-back {
            display: flex;
            align-items: center;
            gap: 0.35em;
        }
        /* 返回箭头：一个只留左边和下边的方框转 45 度 */
        .memo-back::before {
            content: '';
            width: 0.5em;
            height: 0.5em;
            border-left: 0.14em solid currentColor;
            border-bottom: 0.14em solid currentColor;
            transform: rotate(45deg);
        }`,
        html: '<div class="memo-bar" aria-hidden="true"><span class="memo-back">备忘录</span><span>完成</span></div>',
    };
}

export function bigTypeTemplate(request: BigTypeRequest): CoverTemplate {
    const schemeName = request.scheme ?? 'cream';
    const scheme = SCHEMES[schemeName];
    const style = request.style ?? 'bold';
    const memo = style === 'memo';
    const light = memo || isLightScheme(schemeName);
    const heavy = request.fonts.choose('heavy');
    const bold: TypeSpec = memo
        ? { style: 'ink', font: heavy, highlight: 'marker' }
        : light
          ? { style: 'ink', font: heavy, highlight: schemeName === 'lemon' ? 'block' : 'marker' }
          : { style: 'outline', font: heavy, highlight: 'color', tilt: -3 };
    const { type, colors } = styledType(style, {
        fonts: request.fonts,
        ground: { light, picture: false },
        colors: memo ? MEMO_COLORS : scheme.type,
        bold,
    });
    const tag = eyebrow(
        request.tag,
        memo
            ? { background: MEMO_MARKER, ink: MEMO_INK }
            : light
              ? { background: scheme.type.stroke, ink: scheme.base }
              : { background: scheme.type.accent, ink: scheme.type.stroke },
    );
    const page = (layout: CoverLayout, headline: Headline, measure: boolean) =>
        genrePage({
            layout,
            headline,
            text: request.text,
            type,
            colors,
            background: memo ? MEMO_PAPER : light ? scheme.base : schemeGradient(scheme),
            measure,
            prefix: tag.prefix,
            ...(memo ? { align: { x: 'start', y: 'center' } as const } : {}),
            // 版式已经按 memoLayout 让出了顶栏，顶栏画在标题区上面让出来的那一条里。
            under: memo ? memoBar(layout, heavy.stack) : NO_LAYERS,
            over: { css: tag.css, html: '' },
        });
    return {
        ...(memo ? { layoutFor: memoLayout } : {}),
        measureHtml: (layout, headline) => page(layout, headline, true),
        renderHtml: async (layout, headline) => ({
            html: page(layout, headline, false),
            subjects: [],
        }),
    };
}
