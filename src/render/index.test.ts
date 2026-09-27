import { rmSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import sharp from 'sharp';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { genrePage } from '../genres/page.ts';
import { chooseFont, type FontChoice, proberFrom } from './fonts.ts';
import { type CoverRenderer, openRenderer, TextDoesNotFitError } from './index.ts';
import { type CoverLayout, customLayout, type Headline } from './layout.ts';

const tempDirectories: string[] = [];

function listen(server: Server): Promise<number> {
    return new Promise((resolvePort, reject) => {
        server.once('error', reject);
        server.listen(0, '127.0.0.1', () => {
            server.removeListener('error', reject);
            const address = server.address();
            if (!address || typeof address === 'string') {
                reject(new Error('Test server did not expose a TCP port.'));
                return;
            }
            resolvePort(address.port);
        });
    });
}

function close(server: Server): Promise<void> {
    return new Promise((resolveClose, reject) => {
        server.close((error) => (error ? reject(error) : resolveClose()));
    });
}

afterEach(() => {
    for (const directory of tempDirectories.splice(0)) {
        rmSync(directory, { recursive: true, force: true });
    }
});

let renderer: CoverRenderer;

beforeAll(async () => {
    renderer = await openRenderer();
});

afterAll(async () => {
    await renderer.close();
});

function headline(fontPx: number): Headline {
    return { fontPx, keepClauses: false };
}

const PLAIN_FONT: FontChoice = { role: 'heavy', stack: 'sans-serif', syntheticBold: 0, notes: [] };

/** 最朴素的封面页：浅底深字，不描边 */
function page(text: string, layout: CoverLayout, fontPx: number, measure = false): string {
    return genrePage({
        layout,
        headline: headline(fontPx),
        text,
        type: { style: 'ink', font: PLAIN_FONT },
        colors: { fill: '#111111', stroke: '#111111', ring: '#ffffff', accent: '#ffcc00' },
        background: '#f5eedc',
        measure,
    });
}

describe('cover renderer', () => {
    it('returns a PNG whose pixel size includes the requested scale', async () => {
        const png = await renderer.screenshot({
            html: page('A headline that gets the click', customLayout(320, 180), 24),
            width: 320,
            height: 180,
            scale: 2,
        });

        expect(png.subarray(0, 8).toString('hex')).toBe('89504e470d0a1a0a');
        const meta = await sharp(png).metadata();
        expect([meta.width, meta.height]).toEqual([640, 360]);
    }, 30_000);

    it('blocks HTTP requests so render content stays local', async () => {
        let requests = 0;
        const server = createServer((_request, response) => {
            requests += 1;
            response.writeHead(204).end();
        });
        const port = await listen(server);

        try {
            await renderer.screenshot({
                html: `<html><body><img src="http://127.0.0.1:${port}/remote.png"></body></html>`,
                width: 160,
                height: 90,
                scale: 1,
            });
            await renderer.fitText({
                html: (fontPx) =>
                    `<html><body><img src="http://127.0.0.1:${port}/fit.png"><p class="copy" style="margin:0;font-size:${fontPx}px">A</p></body></html>`,
                width: 160,
                height: 90,
                box: { x: 0, y: 0, width: 160, height: 90 },
                minPx: 8,
                maxPx: 12,
            });
        } finally {
            await close(server);
        }

        expect(requests).toBe(0);
    }, 30_000);

    it('finds the largest font size whose headline stays inside the box', async () => {
        const layout = customLayout(800, 400);
        const fontPx = await renderer.fitText({
            html: (px) => page('Every platform', layout, px, true),
            width: layout.width,
            height: layout.height,
            box: layout.textArea,
            minPx: 16,
            maxPx: 400,
        });

        expect(fontPx).toBeGreaterThan(16);
        expect(fontPx).toBeLessThan(400);
        const bigger = await renderer
            .fitText({
                html: (px) => page('Every platform', layout, px, true),
                width: layout.width,
                height: layout.height,
                box: layout.textArea,
                minPx: fontPx + 1,
                maxPx: 400,
            })
            .catch((error: unknown) => error);
        expect(bigger).toBeInstanceOf(TextDoesNotFitError);
    }, 30_000);

    it('counts the lines the headline wraps to and keeps within the limit', async () => {
        // 窄高的一栏：不限行数时九个字会折成很多行，限两行时字号小一些但只有两行。
        const html = (px: number) =>
            `<html><body style="margin:0"><p class="copy" style="position:absolute;left:0;top:0;width:240px;margin:0;font:900 ${px}px sans-serif;line-height:1.1">个习惯救了我的时间</p></body></html>`;
        const fitWithin = (maxLines?: number) =>
            renderer.fitText({
                html,
                width: 400,
                height: 800,
                box: { x: 0, y: 0, width: 240, height: 800 },
                minPx: 16,
                maxPx: 240,
                ...(maxLines === undefined ? {} : { maxLines }),
            });
        const free = await fitWithin();
        const two = await fitWithin(2);
        expect(two).toBeLessThan(free);
        // 两行放 9 个字，一行至少 5 个字：字号不超过栏宽的五分之一。
        expect(two).toBeLessThanOrEqual(240 / 5);
        expect(two).toBeGreaterThan(240 / 6);
    }, 30_000);

    it('keeps the longest word unbroken when it measures the font size', async () => {
        const layout = customLayout(800, 800);
        const measure = (text: string) =>
            renderer.fitText({
                html: (px) => page(text, layout, px, true),
                width: layout.width,
                height: layout.height,
                box: layout.textArea,
                minPx: 16,
                maxPx: 400,
            });

        // 同样的高度，长单词要整词放得进一行，字号只能更小。
        expect(await measure('Understanding it')).toBeLessThan(await measure('Get it'));
        // 中文紧挨着长单词时也一样。
        expect(await measure('试试Understanding')).toBeLessThan(await measure('试试Get'));
    }, 30_000);
});

describe('font probe', () => {
    let renderer: CoverRenderer;

    beforeAll(async () => {
        renderer = await openRenderer();
    });

    afterAll(async () => {
        await renderer.close();
    });

    it('reports every candidate, finds no phantom fonts, and feeds the chooser', async () => {
        const families = {
            cjk: ['BeastCover Missing CJK', 'PingFang SC'],
            latin: ['BeastCover Missing Latin', 'Arial'],
        };
        const results = await renderer.probeFonts('封面没人点 HOOK 3', families);
        expect(results.map((r) => `${r.script}:${r.family}`).sort()).toEqual(
            [
                'cjk:BeastCover Missing CJK',
                'cjk:PingFang SC',
                'latin:Arial',
                'latin:BeastCover Missing Latin',
            ].sort(),
        );
        for (const missing of results.filter((r) => r.family.startsWith('BeastCover Missing'))) {
            expect(missing, missing.family).toMatchObject({
                installed: false,
                covers: false,
                density: 0,
            });
        }
        if (process.platform === 'darwin') {
            const pingfang = results.find((r) => r.family === 'PingFang SC');
            expect(pingfang).toMatchObject({ installed: true, covers: true });
            expect(pingfang?.density).toBeGreaterThan(0.3);
        }
        const choice = chooseFont('heavy', proberFrom(results));
        expect(choice.stack.length).toBeGreaterThan(0);
    }, 30_000);
});
