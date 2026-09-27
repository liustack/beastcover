// 大字报：字就是主体。亮底配重黑字（小红书、公众号的干货和观点），暗底配白字黑描边（喧闹的海报）。
// 一个关键词荧光笔、实色块或换色；痛点标签放在标题同一段里，字号跟着标题走。
// 配方依据：research.md 第 5.1 节「大字报配方」、第 1 节字的处理。
import type { CoverTemplate } from '../compose/index.ts';
import type { CoverLayout, Headline } from '../render/layout.ts';
import type { TypeSpec } from '../render/type.ts';
import { eyebrow, type FontKit, genrePage } from './page.ts';
import { isLightScheme, SCHEMES, type SchemeName, schemeGradient } from './schemes.ts';

export interface BigTypeRequest {
    text: string;
    fonts: FontKit;
    scheme?: SchemeName;
    tag?: string;
}

export function bigTypeTemplate(request: BigTypeRequest): CoverTemplate {
    const schemeName = request.scheme ?? 'cream';
    const scheme = SCHEMES[schemeName];
    const light = isLightScheme(schemeName);
    const type: TypeSpec = light
        ? {
              style: 'ink',
              font: request.fonts.choose('heavy'),
              highlight: schemeName === 'lemon' ? 'block' : 'marker',
          }
        : { style: 'outline', font: request.fonts.choose('heavy'), highlight: 'color', tilt: -3 };
    const tag = eyebrow(
        request.tag,
        light
            ? { background: scheme.type.stroke, ink: scheme.base }
            : { background: scheme.type.accent, ink: scheme.type.stroke },
    );
    const page = (layout: CoverLayout, headline: Headline, measure: boolean) =>
        genrePage({
            layout,
            headline,
            text: request.text,
            type,
            colors: scheme.type,
            background: light ? scheme.base : schemeGradient(scheme),
            measure,
            prefix: tag.prefix,
            over: { css: tag.css, html: '' },
        });
    return {
        measureHtml: (layout, headline) => page(layout, headline, true),
        renderHtml: async (layout, headline) => page(layout, headline, false),
    };
}
