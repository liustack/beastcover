import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { createWorkspace, loadStylePack, mergedPalette } from '../workspace/index.ts';
import { renderHtml } from './index.ts';
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

describe('HTML renderer', () => {
    it('writes a PNG whose pixel dimensions include the requested scale', async () => {
        const directory = mkdtempSync(join(tmpdir(), 'beastcover-render-'));
        tempDirectories.push(directory);
        const outputPath = join(directory, 'nested', 'card.png');

        const result = await renderHtml({
            html: createRenderTemplate('A headline that gets the click'),
            outputPath,
            width: 320,
            height: 180,
            scale: 2,
        });

        expect(existsSync(outputPath)).toBe(true);
        const png = readFileSync(outputPath);
        expect(png.subarray(0, 8).toString('hex')).toBe('89504e470d0a1a0a');
        expect(png.readUInt32BE(16)).toBe(640);
        expect(png.readUInt32BE(20)).toBe(360);
        expect(result).toMatchObject({
            pngPath: outputPath,
            meta: {
                width: 320,
                height: 180,
                scale: 2,
                pixelWidth: 640,
                pixelHeight: 360,
            },
        });
    }, 30_000);

    it('blocks HTTP requests so render content stays local', async () => {
        let requests = 0;
        const server = createServer((_request, response) => {
            requests += 1;
            response.writeHead(204).end();
        });
        const port = await listen(server);
        const directory = mkdtempSync(join(tmpdir(), 'beastcover-local-render-'));
        tempDirectories.push(directory);

        try {
            await renderHtml({
                html: `<html><body><img src="http://127.0.0.1:${port}/remote.png"></body></html>`,
                outputPath: join(directory, 'local.png'),
                width: 160,
                height: 90,
                scale: 1,
            });
        } finally {
            await close(server);
        }

        expect(requests).toBe(0);
    }, 30_000);

    it('changes the rendered PNG when project palette css changes', async () => {
        const cwd = mkdtempSync(join(tmpdir(), 'beastcover-palette-render-'));
        tempDirectories.push(cwd);
        const created = createWorkspace(cwd, { name: 'demo', styleName: 'risograph_editorial' });
        const text = 'Palette css probe';
        const canvas = { width: 320, height: 180, scale: 1 as const };

        const beforePath = join(created.path, 'out', 'before.png');
        await renderHtml({
            html: createRenderTemplate(text, {
                palette: mergedPalette(loadStylePack(created.path)),
            }),
            outputPath: beforePath,
            ...canvas,
        });

        const packPath = join(created.path, 'project.json');
        const pack = JSON.parse(readFileSync(packPath, 'utf8')) as {
            palette: { paper: { prompt: string; css: string } };
        };
        pack.palette.paper.css = '#ff0000';
        writeFileSync(packPath, `${JSON.stringify(pack, null, 2)}\n`, 'utf8');

        const afterPath = join(created.path, 'out', 'after.png');
        await renderHtml({
            html: createRenderTemplate(text, {
                palette: mergedPalette(loadStylePack(created.path)),
            }),
            outputPath: afterPath,
            ...canvas,
        });

        const before = readFileSync(beforePath);
        const after = readFileSync(afterPath);
        expect(before.subarray(0, 8).toString('hex')).toBe('89504e470d0a1a0a');
        expect(after.subarray(0, 8).toString('hex')).toBe('89504e470d0a1a0a');
        expect(after.equals(before)).toBe(false);
    }, 30_000);
});
