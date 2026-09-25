// 大字报：纯色满版底加一层网点，标题撑满安全区，可选一个痛点标签压在标题上方。
import type { PaletteSlotValue } from '../styles/schema.ts';
import type { SubjectLayer } from '../subject/index.ts';
import {
    type CoverLayout,
    escapeHtml,
    type Headline,
    headlineMarkup,
    probeMarkup,
} from './layout.ts';
import {
    BOLD_SANS,
    contrastingText,
    coverDocument,
    headlineCss,
    resolveRenderColors,
    subjectMarkup,
    validatePaletteCss,
} from './template.ts';

export const MAX_TAG_LENGTH = 16;

export interface PosterOptions {
    layout: CoverLayout;
    headline: Headline;
    palette?: Record<string, PaletteSlotValue>;
    tag?: string;
    measure?: boolean;
    /** 抠好的人物，版式里要有 subjectArea */
    subject?: SubjectLayer;
}

export function validateTag(tag: string): string {
    const trimmed = tag.trim();
    if (trimmed === '') {
        throw new Error('--tag must not be empty.');
    }
    if (Array.from(trimmed).length > MAX_TAG_LENGTH) {
        throw new Error(
            `--tag is longer than ${MAX_TAG_LENGTH} characters. Keep it to a few words.`,
        );
    }
    return trimmed;
}

export function createPosterTemplate(text: string, options: PosterOptions): string {
    const palette = options.palette ?? {};
    validatePaletteCss(palette);
    const colors = resolveRenderColors(palette);
    const { layout } = options;
    const subject = subjectMarkup(layout, options.measure ? undefined : options.subject);
    // 标签放在标题段落里，字号按标题的比例走：标题量多大，标签就跟着多大，量字号时也算在内。
    const tagCss =
        options.tag === undefined
            ? ''
            : `
        .tag {
            display: table;
            margin-bottom: 0.3em;
            padding: 0.2em 0.45em;
            border-radius: 0.18em;
            background: ${contrastingText('var(--cover-accent)')};
            color: var(--cover-accent);
            font-size: 0.36em;
            font-weight: 800;
            letter-spacing: 0;
            line-height: 1;
            white-space: nowrap;
        }`;
    const dot = Math.max(3, Math.round(Math.min(layout.width, layout.height) * 0.004));

    return coverDocument({
        layout,
        colors,
        background: 'var(--cover-accent)',
        fontFamily: BOLD_SANS,
        css: `${headlineCss(layout, options.headline, text)}

        #canvas::before {
            position: absolute;
            inset: 0;
            z-index: -1;
            content: "";
            background-image: radial-gradient(
                color-mix(in srgb, ${contrastingText('var(--cover-accent)')} 12%, transparent) ${dot / 2}px,
                transparent ${dot / 2 + 0.5}px
            );
            background-size: ${dot * 3}px ${dot * 3}px;
        }

        .accent-bar {
            display: none;
        }

        .text-box {
            align-items: center;
        }

        .copy {
            color: ${contrastingText('var(--cover-accent)')};
            font-weight: 800;
            letter-spacing: -0.02em;
        }
${tagCss}
${subject.css}`,
        body: `        <section class="text-box" aria-label="Headline">
            <p class="copy">${options.tag !== undefined ? `<span class="tag">${escapeHtml(options.tag)}</span>` : ''}${headlineMarkup(text, options.headline)}</p>${options.measure ? probeMarkup(text, options.headline) : ''}
        </section>
        ${subject.html}`,
    });
}
