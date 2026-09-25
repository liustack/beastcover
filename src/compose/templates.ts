// --template 的四种文字封面：text（默认）、poster 大字报、number 数字钩子、compare 前后对比。
// 这里把模板名和参数组装成 composeCovers 用的 CoverTemplate。
import { compareLayout, createCompareTemplate } from '../render/compare.ts';
import { type CoverLayout, withSubjectArea } from '../render/layout.ts';
import { createNumberTemplate, numberLayout } from '../render/number.ts';
import { preparePhotoLayer } from '../render/photo-cover.ts';
import { createPosterTemplate } from '../render/poster.ts';
import { createRenderTemplate } from '../render/template.ts';
import type { PaletteSlotValue } from '../styles/schema.ts';
import type { SubjectLayer } from '../subject/index.ts';
import type { CoverTemplate } from './index.ts';

export const TEMPLATE_NAMES = ['text', 'poster', 'number', 'compare'] as const;

export type TemplateName = (typeof TEMPLATE_NAMES)[number];

export function parseTemplateName(value: string): TemplateName {
    if (!TEMPLATE_NAMES.includes(value as TemplateName)) {
        throw new Error(`Unknown template "${value}". Use ${TEMPLATE_NAMES.join(', ')}.`);
    }
    return value as TemplateName;
}

export type TextTemplateRequest = {
    text: string;
    palette?: Record<string, PaletteSlotValue>;
} & (
    | { template: 'text'; subject?: SubjectLayer }
    | { template: 'poster'; subject?: SubjectLayer; tag?: string }
    | { template: 'number'; figure: string }
    | { template: 'compare'; before: string; after: string; labels?: [string, string] }
);

export function textCoverTemplate(request: TextTemplateRequest): CoverTemplate {
    const { text } = request;
    const palette = request.palette ? { palette: request.palette } : {};

    switch (request.template) {
        case 'text': {
            const subject = request.subject;
            return {
                ...(subject ? { layoutFor: withSubjectArea } : {}),
                measureHtml: (layout, headline) =>
                    createRenderTemplate(text, { layout, headline, measure: true, ...palette }),
                renderHtml: async (layout, headline) =>
                    createRenderTemplate(text, {
                        layout,
                        headline,
                        ...palette,
                        ...(subject ? { subject } : {}),
                    }),
            };
        }
        case 'poster': {
            const { subject, tag } = request;
            const extras = tag === undefined ? {} : { tag };
            return {
                ...(subject ? { layoutFor: withSubjectArea } : {}),
                measureHtml: (layout, headline) =>
                    createPosterTemplate(text, {
                        layout,
                        headline,
                        measure: true,
                        ...palette,
                        ...extras,
                    }),
                renderHtml: async (layout, headline) =>
                    createPosterTemplate(text, {
                        layout,
                        headline,
                        ...palette,
                        ...extras,
                        ...(subject ? { subject } : {}),
                    }),
            };
        }
        case 'number': {
            const { figure } = request;
            return {
                layoutFor: numberLayout,
                measureAccentHtml: (layout, fontPx) =>
                    createNumberTemplate(text, {
                        layout,
                        figure,
                        headline: { fontPx, keepClauses: false },
                        measure: 'figure',
                        ...palette,
                    }),
                measureHtml: (layout, headline) =>
                    createNumberTemplate(text, {
                        layout,
                        figure,
                        headline,
                        measure: 'headline',
                        ...palette,
                    }),
                renderHtml: async (layout, headline) =>
                    createNumberTemplate(text, { layout, figure, headline, ...palette }),
            };
        }
        case 'compare': {
            const { before, after } = request;
            const labels = request.labels ? { labels: request.labels } : {};
            const panelsOf = (layout: CoverLayout) => compareLayout(layout);
            return {
                layoutFor: panelsOf,
                measureHtml: (layout, headline) =>
                    createCompareTemplate(text, {
                        layout: panelsOf(layout),
                        headline,
                        measure: true,
                        ...palette,
                        ...labels,
                    }),
                renderHtml: async (layout, headline, pixelWidth) => {
                    const withPanels = panelsOf(layout);
                    const { first, second } = withPanels.panels;
                    const k = pixelWidth / layout.width;
                    const images = [
                        await preparePhotoLayer(
                            before,
                            Math.round(first.width * k),
                            Math.round(first.height * k),
                        ),
                        await preparePhotoLayer(
                            after,
                            Math.round(second.width * k),
                            Math.round(second.height * k),
                        ),
                    ] as const;
                    return createCompareTemplate(text, {
                        layout: withPanels,
                        headline,
                        images: [images[0], images[1]],
                        ...palette,
                        ...labels,
                    });
                },
            };
        }
    }
}
