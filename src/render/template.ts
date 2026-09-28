// 封面页面的公共部分：页面骨架、标题的排版规则、人物层。各封面类型（src/genres/）在这上面搭。
import type { Rect } from '../platforms/index.ts';
import type { SubjectLayer } from '../subject/index.ts';
import {
    type CoverLayout,
    type Headline,
    lineHeightFor,
    placeSubject,
    textAreaCss,
} from './layout.ts';

/** 人物描边的粗细：clean 是干净分离，sticker 是贴纸感。按画布短边的比例 */
/** clean 细白边、sticker 粗白边（贴纸感），none 不描边（产品这类东西，白边会显得像贴纸） */
export type SubjectOutline = 'clean' | 'sticker' | 'none';

const OUTLINE_SHARE: Record<SubjectOutline, number> = { clean: 0.014, sticker: 0.024, none: 0 };

/**
 * 人物描边滤镜：把人物的透明度模糊后陡峭截断，得到一圈圆角外扩，填白就是白描边。
 * 四个方向叠 drop-shadow 在斜边上会出台阶，这个不会。浅底时白边会消失，外面再包一圈深色细边。
 * 单位是 CSS 像素，截图放大倍数自动跟着走。
 */
function outlineFilter(width: number, darkEdge: boolean): string {
    const blur = (w: number) => Math.max(1, Number((w * 0.55).toFixed(2)));
    const grow = (from: string, w: number, result: string) => `
            <feGaussianBlur in="${from}" stdDeviation="${blur(w)}" result="${result}-blur"/>
            <feComponentTransfer in="${result}-blur" result="${result}">
                <feFuncA type="linear" slope="14" intercept="-0.4"/>
            </feComponentTransfer>`;
    const ring = (alpha: string, color: string, result: string) => `
            <feFlood flood-color="${color}"/>
            <feComposite in2="${alpha}" operator="in" result="${result}"/>`;
    const dark = darkEdge ? width * 0.28 : 0;
    return `<svg width="0" height="0" style="position:absolute" aria-hidden="true">
        <filter id="subject-outline" x="-15%" y="-15%" width="130%" height="130%" color-interpolation-filters="sRGB">${grow('SourceAlpha', width, 'white-a')}${ring('white-a', '#ffffff', 'white')}${
            darkEdge
                ? `${grow('white-a', dark, 'dark-a')}${ring('dark-a', 'rgba(0,0,0,0.55)', 'dark')}`
                : ''
        }
            <feMerge>${darkEdge ? '<feMergeNode in="dark"/>' : ''}<feMergeNode in="white"/><feMergeNode in="SourceGraphic"/></feMerge>
        </filter>
    </svg>`;
}

/** 人物层：按 placeSubject 摆放（有脸按脸放大，高的贴底站，扁的放进无遮挡区），白描边加接地投影，压在标题上面 */
export function subjectMarkup(
    layout: CoverLayout,
    subject: SubjectLayer | undefined,
    options: {
        outline?: SubjectOutline;
        lightBackground?: boolean;
        faceShare?: number;
        /** 调用方自己算好的位置（产品要整件放在看得清的地方，不按人物的站法） */
        rect?: Rect;
    } = {},
): {
    css: string;
    html: string;
} {
    if (subject === undefined) {
        return { css: '', html: '' };
    }
    const rect = options.rect ?? placeSubject(layout, subject, options.faceShare);
    const short = Math.min(layout.width, layout.height);
    const outline = options.outline ?? 'clean';
    const width = Math.max(3, Math.round(short * OUTLINE_SHARE[outline]));
    const shadow = Math.round(short * 0.02);
    const drop = `drop-shadow(0 ${Math.round(shadow * 0.3)}px ${shadow}px rgba(0, 0, 0, 0.4))`;
    return {
        css: `
        .subject {
            position: absolute;
            left: ${rect.x}px;
            top: ${rect.y}px;
            width: ${rect.width}px;
            height: ${rect.height}px;
            z-index: 2;
            filter: ${outline === 'none' ? drop : `url(#subject-outline) ${drop}`};
        }`,
        html: `${outline === 'none' ? '' : outlineFilter(width, options.lightBackground === true)}<img class="subject" src="${subject.dataUri}" alt="" aria-hidden="true">`,
    };
}

/** 标题排版：区域定位、字号、断行规则和探针 */
export function headlineCss(layout: CoverLayout, headline: Headline, text: string): string {
    return `
        .text-box {
            position: absolute;
            ${textAreaCss(layout)}
            display: flex;
        }

        .copy,
        .copy-layer {
            margin: 0;
            font-size: ${headline.fontPx}px;
            font-weight: 600;
            letter-spacing: -0.04em;
            line-height: ${lineHeightFor(text)};
            text-wrap: balance;
            white-space: pre-wrap;
            /* 中文在词与词之间断行，balance 才能把几行排匀，不会只剩一个字挂在最后一行。
               西文单词和中文词都不拆开，量字号时的探针保证最长的词放得下。 */
            word-break: normal;
            overflow-wrap: anywhere;
        }

        .clause {
            display: inline-block;
        }

        .word {
            white-space: nowrap;
        }

        .probe {
            position: absolute;
            top: 0;
            left: 0;
            visibility: hidden;
            white-space: nowrap;
        }`;
}

/** 页面骨架：画布尺寸、颜色变量、背景，样式和内容由封面类型填 */
export function coverDocument(input: {
    layout: CoverLayout;
    colors: { paper: string; ink: string; accent: string };
    background: string;
    fontFamily: string;
    css: string;
    body: string;
}): string {
    const { layout, colors } = input;
    return `<!doctype html>
<html lang="en">
<head>
    <meta charset="utf-8">
    <title>BeastCover</title>
    <style>
        :root {
            color-scheme: light;
            font-family: ${input.fontFamily};
            --cover-paper: ${colors.paper};
            --cover-ink: ${colors.ink};
            --cover-accent: ${colors.accent};
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
            background: ${input.background};
        }

        #canvas {
            position: relative;
            width: ${layout.width}px;
            height: ${layout.height}px;
            isolation: isolate;
        }
${input.css}
    </style>
</head>
<body>
    <main id="canvas">
${input.body}
    </main>
</body>
</html>`;
}
