import { chromium } from 'playwright';
import { describe, expect, it } from 'vitest';
import { FAMILY_NAMES } from '../platforms/index.ts';
import { openRenderer } from './index.ts';
import { customLayout, familyLayout } from './layout.ts';
import { createPhotoCoverTemplate } from './photo-cover.ts';
import { createRenderTemplate, DEFAULT_RENDER_COLORS } from './template.ts';

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
                paper: { prompt: '暖白', css: '#f4efe6' },
                accent: { prompt: '低饱和暖黄', css: '#ff4d00' },
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
                paper: { prompt: '纯白', css: '#ffffff' },
                fill: { prompt: '雾蓝加陶土色', css: '#8a9aaa' },
            },
        });
        expect(descriptive).toContain('--cover-paper: #ffffff');
        expect(descriptive).toContain(`--cover-accent: ${DEFAULT_RENDER_COLORS.accent}`);
        expect(descriptive).toContain('纯白');
        expect(descriptive).toContain('雾蓝加陶土色');
        expect(descriptive).not.toMatch(/--cover-(paper|ink|accent):\s*纯白/);
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
        expect(free).toContain(`<p class="copy">${text}</p>`);

        const clauses = createRenderTemplate(text, {
            ...BASE,
            headline: { fontPx: 48, keepClauses: true },
            measure: true,
        });
        expect(clauses).toContain(
            '<p class="copy"><span class="clause">人接不住认知以外的流量，</span><span class="clause">也赚不到认知以外的钱</span></p>',
        );
        expect(clauses).toContain(
            '<span class="copy probe" aria-hidden="true">也赚不到认知以外的钱</span>',
        );
    });
});
