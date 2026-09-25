import { chromium } from 'playwright';
import { describe, expect, it } from 'vitest';
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

    it('keeps paragraph copy above the footer on the shallow 5:2 canvas', async () => {
        const paragraphs = [
            '同一个项目里的封面、正文插图、社交平台变体和章节过渡图，应当共享同一套配色、字体与构图纪律。修改一个词时，版面保持稳定，整篇文章的视觉体系也不会散架。',
            '同一项目保持视觉一致。'.repeat(28),
        ];
        const browser = await chromium.launch({ headless: true });

        try {
            const page = await browser.newPage({ viewport: { width: 1600, height: 640 } });
            for (const text of paragraphs) {
                await page.setContent(createRenderTemplate(text), { waitUntil: 'load' });
                const copy = await page.locator('.copy').boundingBox();
                const footer = await page.locator('footer').boundingBox();

                expect(copy).not.toBeNull();
                expect(footer).not.toBeNull();
                expect((copy?.y ?? 0) + (copy?.height ?? 0)).toBeLessThanOrEqual(footer?.y ?? 0);
            }
        } finally {
            await browser.close();
        }
    }, 30_000);
});
