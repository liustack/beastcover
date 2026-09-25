import { chromium } from 'playwright';
import { describe, expect, it } from 'vitest';
import { listPlatforms } from '../platforms/index.ts';
import { createRenderTemplate, DEFAULT_RENDER_COLORS } from './template.ts';

describe('built-in render template', () => {
    it('treats the requested copy as text instead of executable HTML', () => {
        const html = createRenderTemplate('<script>globalThis.pwned = true</script> & clarity');

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
                palette: { paper: { prompt: '暖白', css: '暖白' } },
            }),
        ).toThrowError('Invalid CSS color "暖白".');
    });

    it('prints only the headline, with no tool branding on the cover', () => {
        const html = createRenderTemplate('人接不住认知以外的流量');
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

    it('keeps short and long copy inside every platform canvas', async () => {
        const texts = [
            '人接不住认知以外的流量',
            '同一篇内容要发到公众号、X、YouTube、小红书和抖音，每个平台的封面比例都不一样，标题要在每个画布里都放得下，不能被裁掉或者挤出画面。',
            '每个平台的封面都要放得下标题。'.repeat(20),
        ];
        const browser = await chromium.launch({ headless: true });

        try {
            for (const preset of listPlatforms()) {
                const page = await browser.newPage({
                    viewport: { width: preset.width, height: preset.height },
                });
                for (const text of texts) {
                    await page.setContent(createRenderTemplate(text), { waitUntil: 'load' });
                    const copy = await page.locator('.copy').boundingBox();
                    expect(copy, preset.name).not.toBeNull();
                    const box = copy ?? { x: 0, y: 0, width: 0, height: 0 };
                    const label = `${preset.name}: ${text.slice(0, 8)}`;
                    expect(box.y, label).toBeGreaterThanOrEqual(0);
                    expect(box.x, label).toBeGreaterThanOrEqual(0);
                    expect(box.y + box.height, label).toBeLessThanOrEqual(preset.height);
                    expect(box.x + box.width, label).toBeLessThanOrEqual(preset.width);
                }
                await page.close();
            }
        } finally {
            await browser.close();
        }
    }, 60_000);
});
