import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { chromium, type Page } from 'playwright';
import sharp from 'sharp';
import { afterEach, describe, expect, it } from 'vitest';
import { createPhotoCoverTemplate, preparePhotoLayer } from './photo-cover.ts';

const tempDirectories: string[] = [];

afterEach(() => {
    for (const directory of tempDirectories.splice(0)) {
        rmSync(directory, { recursive: true, force: true });
    }
});

async function writeTestPhoto(width: number, height: number): Promise<string> {
    const directory = mkdtempSync(join(tmpdir(), 'beastcover-photo-'));
    tempDirectories.push(directory);
    const path = join(directory, 'photo.png');
    const bytes = await sharp({
        create: { width, height, channels: 3, background: { r: 120, g: 90, b: 60 } },
    })
        .png()
        .toBuffer();
    writeFileSync(path, bytes);
    return path;
}

describe('photo cover', () => {
    it('covers the canvas at the requested pixel size and inlines a jpeg data uri', async () => {
        const source = await writeTestPhoto(400, 800);
        const layer = await preparePhotoLayer(source, 320, 180);

        expect(layer.sourceWidth).toBe(400);
        expect(layer.sourceHeight).toBe(800);
        expect(layer.dataUri.startsWith('data:image/jpeg;base64,')).toBe(true);
        const meta = await sharp(
            Buffer.from(layer.dataUri.slice('data:image/jpeg;base64,'.length), 'base64'),
        ).metadata();
        expect([meta.width, meta.height]).toEqual([320, 180]);
    });

    it('escapes text, inlines the photo, and applies palette colors', () => {
        const html = createPhotoCoverTemplate('<Dawn> & "sea"', {
            photo: { dataUri: 'data:image/jpeg;base64,AAAA', sourceWidth: 1, sourceHeight: 1 },
            palette: {
                paper: { prompt: '暖白', css: '#f4efe6' },
                accent: { prompt: '暖色', css: '#c9895a' },
            },
        });

        expect(html).toContain('&lt;Dawn&gt; &amp; &quot;sea&quot;');
        expect(html).toContain('src="data:image/jpeg;base64,AAAA"');
        expect(html).toContain('--cover-paper: #f4efe6');
        expect(html).toContain('--cover-accent: #c9895a');
        expect(html).toContain('data-density="short"');
        expect(html).not.toContain('<script');
    });

    it('puts only the headline on the cover, with no tool name or explanatory labels', () => {
        const html = createPhotoCoverTemplate('Dawn', {
            photo: { dataUri: 'data:image/jpeg;base64,AAAA', sourceWidth: 1, sourceHeight: 1 },
        });
        const body = html.slice(html.indexOf('<body>'));

        expect(body).toContain('>Dawn</p>');
        for (const label of ['BeastCover', 'Photo cover', 'Local render', 'visual language']) {
            expect(body).not.toContain(label);
        }
    });

    it('breaks Chinese headlines at punctuation instead of inside a word', async () => {
        const dataUri = `data:image/jpeg;base64,${(
            await sharp({
                create: { width: 16, height: 9, channels: 3, background: { r: 30, g: 30, b: 30 } },
            })
                .jpeg()
                .toBuffer()
        ).toString('base64')}`;
        const photo = { dataUri, sourceWidth: 16, sourceHeight: 9 };
        const browser = await chromium.launch({ headless: true });

        // 这段在浏览器里跑，按每个字的纵坐标把正文切成行。写成字符串，免得把 DOM 类型拉进 Node 工程。
        const LINES_SCRIPT = `(() => {
            const node = document.querySelector('.copy')?.firstChild;
            if (!node || node.nodeType !== Node.TEXT_NODE) {
                throw new Error('copy text node missing');
            }
            const text = node.textContent ?? '';
            const rows = [];
            const range = document.createRange();
            for (let i = 0; i < text.length; i += 1) {
                range.setStart(node, i);
                range.setEnd(node, i + 1);
                const top = Math.round(range.getBoundingClientRect().top);
                const last = rows.at(-1);
                if (last && Math.abs(last.top - top) < 4) {
                    last.text += text[i];
                } else {
                    rows.push({ top, text: text[i] });
                }
            }
            return rows.map((row) => row.text.trim()).filter((row) => row !== '');
        })()`;

        async function lines(page: Page): Promise<string[]> {
            return (await page.evaluate(LINES_SCRIPT)) as string[];
        }

        try {
            for (const viewport of [
                { width: 1600, height: 900 },
                { width: 1242, height: 1656 },
                { width: 1600, height: 640 },
            ]) {
                const page = await browser.newPage({ viewport });
                await page.setContent(
                    createPhotoCoverTemplate('人接不住认知以外的流量，也赚不到认知以外的钱', {
                        photo,
                    }),
                    { waitUntil: 'load' },
                );
                expect(await lines(page)).toEqual([
                    '人接不住认知以外的流量，',
                    '也赚不到认知以外的钱',
                ]);

                await page.setContent(
                    createPhotoCoverTemplate(
                        '没有标点的很长中文标题也要能在画布里自己换行'.repeat(2),
                        {
                            photo,
                        },
                    ),
                    { waitUntil: 'load' },
                );
                const copy = await page.locator('.copy').boundingBox();
                expect(copy).not.toBeNull();
                expect((copy?.x ?? 0) + (copy?.width ?? 0)).toBeLessThanOrEqual(viewport.width);
                expect((await lines(page)).length).toBeGreaterThan(1);
                await page.close();
            }
        } finally {
            await browser.close();
        }
    }, 30_000);
});
