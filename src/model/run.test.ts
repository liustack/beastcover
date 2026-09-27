import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import sharp from 'sharp';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { runModelApi } from './index.ts';

const tempDirectories: string[] = [];

afterEach(() => {
    for (const directory of tempDirectories.splice(0)) {
        rmSync(directory, { recursive: true, force: true });
    }
});

function tempDir(): string {
    const directory = mkdtempSync(join(tmpdir(), 'beastcover-model-run-'));
    tempDirectories.push(directory);
    return directory;
}

async function pngResponse(width: number, height: number, provider: 'openai' | 'gemini') {
    const png = await sharp({
        create: { width, height, channels: 3, background: { r: 200, g: 60, b: 40 } },
    })
        .png()
        .toBuffer();
    const body =
        provider === 'openai'
            ? { data: [{ b64_json: png.toString('base64') }] }
            : {
                  candidates: [
                      { content: { parts: [{ inlineData: { data: png.toString('base64') } }] } },
                  ],
              };
    return new Response(JSON.stringify(body), { status: 200 });
}

describe('model api run', () => {
    it('generates once per family and crops every platform from the saved image', async () => {
        const directory = tempDir();
        const generatedPath = join(directory, 'cache', 'cover-landscape.png');
        const fetcher = vi.fn(async () => pngResponse(1536, 1024, 'openai'));

        const { outputPaths } = await runModelApi({
            provider: 'openai',
            apiKey: 'k',
            model: 'gpt-image-2.5-flare',
            prompt: 'p',
            family: 'landscape',
            generatedPath,
            targets: [
                { preset: 'youtube', outputPath: join(directory, 'out-youtube.png') },
                { preset: 'github', outputPath: join(directory, 'out-github.png') },
            ],
            fetch: fetcher,
        });

        expect(fetcher).toHaveBeenCalledOnce();
        const generated = await sharp(generatedPath).metadata();
        expect([generated.width, generated.height]).toEqual([1536, 1024]);
        const youtube = await sharp(outputPaths[0]).metadata();
        expect([youtube.width, youtube.height]).toEqual([1280, 720]);
        const github = await sharp(outputPaths[1]).metadata();
        expect([github.width, github.height]).toEqual([1280, 640]);
    });

    it('normalizes a different native resolution to the family plan before cropping', async () => {
        const directory = tempDir();
        const generatedPath = join(directory, 'cache', 'cover-portrait.png');
        // Gemini 按 1K/2K 档返回，尺寸不等于生成计划。
        const fetcher = vi.fn(async () => pngResponse(1376, 2048, 'gemini'));

        const { outputPaths } = await runModelApi({
            provider: 'gemini',
            apiKey: 'k',
            model: 'gemini-3-pro-image-preview',
            prompt: 'p',
            family: 'portrait',
            generatedPath,
            targets: [{ preset: 'xiaohongshu', outputPath: join(directory, 'out-xhs.png') }],
            fetch: fetcher,
        });

        const generated = await sharp(generatedPath).metadata();
        expect([generated.width, generated.height]).toEqual([1024, 1536]);
        const cover = await sharp(outputPaths[0]).metadata();
        expect([cover.width, cover.height]).toEqual([1080, 1440]);
    });

    it('refuses targets from another family', async () => {
        const directory = tempDir();
        await expect(
            runModelApi({
                provider: 'openai',
                apiKey: 'k',
                model: 'm',
                prompt: 'p',
                family: 'landscape',
                generatedPath: join(directory, 'cover-landscape.png'),
                targets: [{ preset: 'douyin', outputPath: join(directory, 'out.png') }],
                fetch: vi.fn(),
            }),
        ).rejects.toThrowError('runModelApi crops one family per generation.');
    });
});
