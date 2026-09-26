import { chromium } from 'playwright';
import { describe, expect, it } from 'vitest';
import { FAMILY_NAMES } from '../platforms/index.ts';
import { coverPalette } from '../workspace/index.ts';
import { openRenderer } from './index.ts';
import { customLayout, familyLayout, withSubjectArea } from './layout.ts';
import { createPhotoCoverTemplate } from './photo-cover.ts';
import { createRenderTemplate, DEFAULT_RENDER_COLORS, resolveRenderColors } from './template.ts';

/** 一个没改过配色的项目会拿到的调色板 */
function paletteOf(style: string) {
    return coverPalette({ name: 'demo', style, palette: {}, composition: '' });
}

const BASE = { layout: customLayout(640, 360), headline: { fontPx: 48, keepClauses: false } };

describe('built-in render template', () => {
    it('treats the requested copy as text instead of executable HTML', () => {
        const html = createRenderTemplate(
            '<script>globalThis.pwned = true</script> & clarity',
            BASE,
        );

        expect(html).toContain(
            '&lt;script&gt;globalThis.pwned = true&lt;/script&gt; &amp; clarity',
        );
        expect(html).not.toContain('<script>globalThis.pwned = true</script>');
        expect(html).toContain('<main id="canvas">');
        expect(html).toContain('BeastCover');
        expect(html).toContain(`--cover-paper: ${DEFAULT_RENDER_COLORS.paper}`);
        expect(html).toContain(`--cover-accent: ${DEFAULT_RENDER_COLORS.accent}`);
    });

    it('applies CSS palette values and still embeds descriptive slot text', () => {
        const withHex = createRenderTemplate('Accent override', {
            ...BASE,
            palette: {
                paper: { prompt: '暖白', css: '#f4efe6', cover: 'paper' },
                accent: { prompt: '低饱和暖黄', css: '#ff4d00', cover: 'accent' },
            },
        });
        expect(withHex).toContain('--cover-accent: #ff4d00');
        expect(withHex).toContain('--cover-paper: #f4efe6');
        expect(withHex).not.toMatch(/--cover-paper:\s*暖白/);
        expect(withHex).toContain('暖白');
        expect(withHex).toContain('id="beastcover-palette"');
        expect(withHex).toContain('&quot;prompt&quot;:&quot;暖白&quot;');
        expect(withHex).toContain('&quot;css&quot;:&quot;#f4efe6&quot;');

        const descriptive = createRenderTemplate('Descriptive palette', {
            ...BASE,
            palette: {
                paper: { prompt: '纯白', css: '#ffffff', cover: 'paper' },
                fill: { prompt: '雾蓝加陶土色', css: '#8a9aaa' },
            },
        });
        expect(descriptive).toContain('--cover-paper: #ffffff');
        expect(descriptive).toContain(`--cover-accent: ${DEFAULT_RENDER_COLORS.accent}`);
        expect(descriptive).toContain('纯白');
        expect(descriptive).toContain('雾蓝加陶土色');
        expect(descriptive).not.toMatch(/--cover-(paper|ink|accent):\s*纯白/);
    });

    it('takes cover colors from the slot marked for each use, whatever the slot is called', () => {
        // 孔版的强调色槽叫 spot，油彩的叫 colors，按槽名猜会退回默认蓝。
        for (const [style, accent] of [
            ['risograph_editorial', '#ff48a5'],
            ['luminous_impasto', '#3a8fd4'],
            ['conceptual_colorfield', '#d4a574'],
            ['torn_paper_editorial_collage', '#c46a38'],
        ] as const) {
            const palette = paletteOf(style);
            expect(resolveRenderColors(palette).accent, style).toBe(accent);
        }
        expect(() =>
            resolveRenderColors({
                a: { prompt: '粉', css: '#ff48a5', cover: 'accent' },
                b: { prompt: '蓝', css: '#1746d1', cover: 'accent' },
            }),
        ).toThrowError('Palette slots "a", "b" are all marked as the cover accent.');
    });

    it('throws when a provided css value is not a CSS color', () => {
        expect(() =>
            createRenderTemplate('Bad css', {
                ...BASE,
                palette: { paper: { prompt: '暖白', css: '暖白' } },
            }),
        ).toThrowError('Invalid CSS color "暖白".');
    });

    it('prints only the headline, with no tool branding on the cover', () => {
        const html = createRenderTemplate('人接不住认知以外的流量', BASE);
        for (const label of [
            'Visual system',
            'visual language',
            'Local render',
            '<header',
            '<footer',
        ]) {
            expect(html, label).not.toContain(label);
        }
        expect(html.match(/BeastCover/g)).toEqual(['BeastCover']);
    });

    it('keeps the fitted headline inside the family text area for both templates', async () => {
        const texts = [
            '人接不住认知以外的流量',
            '人接不住认知以外的流量，也赚不到认知以外的钱',
            'Understanding the beast behind every click',
            '每个平台的封面都要放得下标题。'.repeat(8),
        ];
        const photo = { dataUri: 'data:image/jpeg;base64,AAAA', sourceWidth: 1, sourceHeight: 1 };
        type Options = Parameters<typeof createRenderTemplate>[1];
        const templates = {
            render: createRenderTemplate,
            photo: (text: string, options: Options) =>
                options.measure === true
                    ? createPhotoCoverTemplate(text, { ...options, measure: true })
                    : createPhotoCoverTemplate(text, { ...options, measure: false, photo }),
        };
        const renderer = await openRenderer();
        const browser = await chromium.launch({ headless: true });

        try {
            for (const familyName of FAMILY_NAMES) {
                const layout = familyLayout(familyName);
                const area = layout.textArea;
                const page = await browser.newPage({
                    viewport: { width: layout.width, height: layout.height },
                });
                for (const [name, template] of Object.entries(templates)) {
                    for (const text of texts) {
                        const label = `${familyName} ${name}: ${text.slice(0, 10)}`;
                        const fontPx = await renderer.fitText({
                            html: (px) =>
                                template(text, {
                                    layout,
                                    headline: { fontPx: px, keepClauses: false },
                                    measure: true,
                                }),
                            width: layout.width,
                            height: layout.height,
                            box: area,
                            minPx: 16,
                            maxPx: 400,
                        });
                        await page.setContent(
                            template(text, { layout, headline: { fontPx, keepClauses: false } }),
                        );
                        const copy = await page.locator('.copy').boundingBox();
                        expect(copy, label).not.toBeNull();
                        const box = copy ?? { x: 0, y: 0, width: 0, height: 0 };
                        expect(box.x, label).toBeGreaterThanOrEqual(area.x - 0.5);
                        expect(box.y, label).toBeGreaterThanOrEqual(area.y - 0.5);
                        expect(box.x + box.width, label).toBeLessThanOrEqual(
                            area.x + area.width + 0.5,
                        );
                        expect(box.y + box.height, label).toBeLessThanOrEqual(
                            area.y + area.height + 0.5,
                        );
                    }
                }
                await page.close();
            }
        } finally {
            await browser.close();
            await renderer.close();
        }
    }, 120_000);

    it('wraps each clause in an unbreakable span only when asked to keep clauses', () => {
        const text = '人接不住认知以外的流量，也赚不到认知以外的钱';
        const free = createRenderTemplate(text, BASE);
        expect(free).toContain(
            '<p class="copy">人接<span class="word">不住</span><span class="word">认知</span><span class="word">以外</span>的<span class="word">流量</span>，也赚<span class="word">不到</span><span class="word">认知</span><span class="word">以外</span>的钱</p>',
        );

        const clauses = createRenderTemplate(text, {
            ...BASE,
            headline: { fontPx: 48, keepClauses: true },
            measure: true,
        });
        expect(clauses).toContain(
            '<p class="copy"><span class="clause">人接<span class="word">不住</span><span class="word">认知</span><span class="word">以外</span>的<span class="word">流量</span>，</span><span class="clause">也赚<span class="word">不到</span><span class="word">认知</span><span class="word">以外</span>的钱</span></p>',
        );
        expect(clauses).toContain(
            '<span class="copy probe" aria-hidden="true">也赚不到认知以外的钱</span>',
        );
    });

    it('draws the subject above the headline with a white stroke inside its area', () => {
        const layout = withSubjectArea(familyLayout('landscape'));
        const subject = {
            dataUri: 'data:image/png;base64,AAAA',
            width: 10,
            height: 20,
            method: 'transparent' as const,
        };
        const html = createRenderTemplate('人物大字', { ...BASE, layout, subject });

        // 10x20 的主体按高度放满 1140，宽 570，在人物区（x 1056 起，672 宽）里水平居中。
        expect(html).toContain('left: 1107px;');
        expect(html).toContain('top: 60px;');
        expect(html).toContain('width: 570px;');
        expect(html).toContain('z-index: 2;');
        expect(html).toContain('drop-shadow(8px 0 0 #fff)');
        expect(html).toContain('<img class="subject" src="data:image/png;base64,AAAA"');
        expect(html.indexOf('class="subject"')).toBeGreaterThan(html.indexOf('class="text-box"'));

        const photo = createPhotoCoverTemplate('人物大字', {
            ...BASE,
            layout,
            subject,
            measure: true,
        });
        expect(photo).not.toContain('class="subject"');
    });

    it('refuses a subject on a layout without a subject area', () => {
        expect(() =>
            createRenderTemplate('人物大字', {
                ...BASE,
                subject: { dataUri: 'data:,', width: 1, height: 1, method: 'transparent' },
            }),
        ).toThrowError('A subject needs a layout with a subject area.');
    });
});
