// --template 的四种文字封面：text（默认）、poster 大字报、number 数字钩子、compare 前后对比。
// 这里把模板名和参数组装成 composeCovers 用的 CoverTemplate。

import type { Rect } from '../platforms/index.ts';
import { compareLayout, createCompareTemplate } from '../render/compare.ts';
import { type CoverLayout, withSubjectArea } from '../render/layout.ts';
import { createNumberTemplate, numberLayout } from '../render/number.ts';
import { preparePanelLayer } from '../render/photo-cover.ts';
import { createPosterTemplate } from '../render/poster.ts';
import { createRenderTemplate } from '../render/template.ts';
import type { PaletteSlotValue } from '../styles/schema.ts';
import type { SubjectLayer } from '../subject/index.ts';
import type { PhotoFocus } from '../subject/vision.ts';
import type { CoverTemplate } from './index.ts';

/** 面板里平台看得见的那一截，换算成面板的 0 到 1 */
export function panelVisibility(panel: Rect, visibleArea: Rect): Rect {
    const x = Math.max(panel.x, visibleArea.x);
    const y = Math.max(panel.y, visibleArea.y);
    const right = Math.min(panel.x + panel.width, visibleArea.x + visibleArea.width);
    const bottom = Math.min(panel.y + panel.height, visibleArea.y + visibleArea.height);
    if (right <= x || bottom <= y) {
        throw new Error('A compare panel has no visible part on the requested platforms.');
    }
    return {
        x: (x - panel.x) / panel.width,
        y: (y - panel.y) / panel.height,
        width: (right - x) / panel.width,
        height: (bottom - y) / panel.height,
    };
}

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
    | {
          template: 'compare';
          before: string;
          after: string;
          labels?: [string, string];
          /** 找两张图的主体，好把它们放进平台看得见的那一截 */
          focusOf: (imagePath: string) => Promise<PhotoFocus>;
      }
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
                    const visibleArea = layout.visibleArea ?? {
                        x: 0,
                        y: 0,
                        width: layout.width,
                        height: layout.height,
                    };
                    // 每张图只在自己那一半里、又在平台看得见的那一截里露出主体。
                    const framed = async (path: string, panel: Rect) => {
                        const seen = panelVisibility(panel, visibleArea);
                        return preparePanelLayer(
                            path,
                            Math.round(panel.width * k),
                            Math.round(panel.height * k),
                            { focus: await request.focusOf(path), visible: seen },
                        );
                    };
                    const images = [
                        await framed(before, first),
                        await framed(after, second),
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

/** --hook 的短句：去掉首尾空白，不能为空。长短交给 Headline: 提醒 */
export function parseHook(value: string): string {
    const hook = value.trim();
    if (hook === '') {
        throw new Error('--hook must not be empty.');
    }
    return hook;
}
