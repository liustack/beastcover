import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import sharp from 'sharp';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { coverPalette, createWorkspace, loadStylePack } from '../workspace/index.ts';
import { type CoverRenderer, openRenderer, TextDoesNotFitError } from './index.ts';
import { customLayout, type Headline } from './layout.ts';
import { createRenderTemplate } from './template.ts';

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

describe('cover renderer', () => {
    it('returns a PNG whose pixel size includes the requested scale', async () => {
        const png = await renderer.screenshot({
            html: createRenderTemplate('A headline that gets the click', {
                layout: customLayout(320, 180),
                headline: headline(24),
            }),
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
            html: (px) =>
                createRenderTemplate('Every platform', {
                    layout,
                    headline: headline(px),
                    measure: true,
                }),
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
                html: (px) =>
                    createRenderTemplate('Every platform', {
                        layout,
                        headline: headline(px),
                        measure: true,
                    }),
                width: layout.width,
                height: layout.height,
                box: layout.textArea,
                minPx: fontPx + 1,
                maxPx: 400,
            })
            .catch((error: unknown) => error);
        expect(bigger).toBeInstanceOf(TextDoesNotFitError);
    }, 30_000);

    it('keeps the longest word unbroken when it measures the font size', async () => {
        const layout = customLayout(800, 800);
        const measure = (text: string) =>
            renderer.fitText({
                html: (px) =>
                    createRenderTemplate(text, { layout, headline: headline(px), measure: true }),
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

    it('changes the rendered PNG when project palette css changes', async () => {
        const cwd = mkdtempSync(join(tmpdir(), 'beastcover-palette-render-'));
        tempDirectories.push(cwd);
        const created = createWorkspace(cwd, { name: 'demo', styleName: 'risograph_editorial' });
        const layout = customLayout(320, 180);
        const shot = () =>
            renderer.screenshot({
                html: createRenderTemplate('Palette css probe', {
                    layout,
                    headline: headline(24),
                    palette: coverPalette(loadStylePack(created.path)),
                }),
                width: 320,
                height: 180,
                scale: 1,
            });

        const before = await shot();
        const packPath = join(created.path, 'project.json');
        const pack = JSON.parse(readFileSync(packPath, 'utf8')) as {
            palette: { paper: { prompt: string; css: string } };
        };
        pack.palette.paper.css = '#ff0000';
        writeFileSync(packPath, `${JSON.stringify(pack, null, 2)}\n`, 'utf8');
        const after = await shot();

        expect(after.equals(before)).toBe(false);
    }, 30_000);
});
