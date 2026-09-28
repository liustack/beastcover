// 产品主角：一件抠好的东西占满一边，身后一圈柔光把它托起来，字在另一边，价格跟在标题后面。
// 测评、种草、带货通用：画面里只有这一件东西，一眼就知道这期讲什么。
// 依据：2026 年各家的缩略图统计里「极简主体物」都排在点击率最高的几种里，小红书的抠图种草，
// YouTube 的 Featured Products（research.md 第 5 节和第二轮调研）。
import type { CoverTemplate } from '../compose/index.ts';
import type { Rect } from '../platforms/index.ts';
import type { PictureSubject } from '../qc/index.ts';
import type { CoverLayout, Headline } from '../render/layout.ts';
import { subjectMarkup } from '../render/template.ts';
import type { TypeSpec } from '../render/type.ts';
import type { SubjectLayer } from '../subject/index.ts';
import { faceLayout } from './face.ts';
import {
    eyebrow,
    type FontKit,
    genrePage,
    joinLayers,
    type Layers,
    NO_LAYERS,
    rectCss,
    tailLine,
} from './page.ts';
import { isLightScheme, SCHEMES, type SchemeName, schemeGradient } from './schemes.ts';
import { type StyleName, styledType } from './styles.ts';

export interface ProductRequest {
    text: string;
    fonts: FontKit;
    /** 抠好的产品：透明 PNG，或者 macOS 上抠出来的 */
    subject: SubjectLayer;
    scheme?: SchemeName;
    tag?: string;
    /** 价格，跟在标题后面的价签里 */
    price?: string;
    style?: StyleName;
}

// 柔光比产品框大这么多，亮底上用白光，暗底上用强调色的淡光。
const GLOW_GROW = 0.35;
// 产品四周留出放图区短边的这么多。
const PRODUCT_MARGIN = 0.06;

/**
 * 产品的位置：整件按原比例放进放图区里平台看得清的那一截，四周留边，居中。人物是按脸放大、
 * 贴底站的，产品不行，切掉一截就不知道是什么东西了。
 */
export function productRect(layout: CoverLayout, subject: { width: number; height: number }): Rect {
    const area = layout.subjectArea;
    if (area === undefined) {
        throw new Error('A product needs a layout with a subject area.');
    }
    const canvas = { x: 0, y: 0, width: layout.width, height: layout.height };
    const view = layout.clearArea ?? layout.visibleArea ?? canvas;
    const x = Math.max(area.x, view.x);
    const y = Math.max(area.y, view.y);
    const room = {
        x,
        y,
        width: Math.min(area.x + area.width, view.x + view.width) - x,
        height: Math.min(area.y + area.height, view.y + view.height) - y,
    };
    const margin = Math.min(room.width, room.height) * PRODUCT_MARGIN;
    const scale = Math.min(
        (room.width - margin * 2) / subject.width,
        (room.height - margin * 2) / subject.height,
    );
    const width = Math.round(subject.width * scale);
    const height = Math.round(subject.height * scale);
    return {
        x: Math.round(room.x + (room.width - width) / 2),
        y: Math.round(room.y + (room.height - height) / 2),
        width,
        height,
    };
}

/** 产品身后的一圈柔光：椭圆渐变，中心在产品中心 */
function glowLayer(rect: Rect, color: string): Layers {
    const grow = Math.max(rect.width, rect.height) * GLOW_GROW;
    const box = {
        x: rect.x - grow,
        y: rect.y - grow,
        width: rect.width + grow * 2,
        height: rect.height + grow * 2,
    };
    return {
        css: `
        .glow {
            position: absolute;
            ${rectCss(box)}
            background: radial-gradient(closest-side, ${color}, transparent);
        }`,
        html: '<div class="glow" aria-hidden="true"></div>',
    };
}

export function productTemplate(request: ProductRequest): CoverTemplate {
    // 奶油底：主体物要干净的底，浅色底在信息流里也亮。
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
    const price = tailLine(request.price, {
        background: scheme.type.accent,
        ink: scheme.type.accentInk ?? scheme.type.stroke,
        sizeEm: 0.5,
    });
    const glowColor = light ? 'rgba(255, 255, 255, 0.85)' : `${scheme.type.accent}40`;
    const page = (layout: CoverLayout, headline: Headline, measure: boolean) => {
        const rect = productRect(layout, request.subject);
        const product = measure
            ? NO_LAYERS
            : subjectMarkup(layout, request.subject, { outline: 'none', rect });
        const glow = measure ? NO_LAYERS : glowLayer(rect, glowColor);
        const angle = layout.subjectArea && layout.subjectArea.y > layout.textArea.y ? 180 : 90;
        return genrePage({
            layout,
            headline,
            text: request.text,
            type,
            colors,
            background: light ? scheme.base : schemeGradient(scheme, angle),
            measure,
            prefix: tag.prefix,
            suffix: price.suffix,
            under: glow,
            over: joinLayers({ css: tag.css + price.css, html: '' }, product),
        });
    };
    return {
        layoutFor: faceLayout,
        measureHtml: (layout, headline) => page(layout, headline, true),
        renderHtml: async (layout, headline) => {
            const rect = productRect(layout, request.subject);
            // 产品整件都要露出来，不能压在平台的按钮底下。
            const subjects: PictureSubject[] = [
                {
                    name: 'the product',
                    box: rect,
                    frame: { x: 0, y: 0, width: layout.width, height: layout.height },
                },
            ];
            return { html: page(layout, headline, false), subjects };
        },
    };
}
