import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import sharp from 'sharp';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
    findScenePainter,
    gradientScene,
    paintScene,
    parseScene,
    sceneOrientation,
    scenePrompt,
} from './index.ts';

const directories: string[] = [];

afterEach(() => {
    for (const directory of directories.splice(0)) {
        rmSync(directory, { recursive: true, force: true });
    }
});

function tempDir(): string {
    const directory = mkdtempSync(join(tmpdir(), 'beastcover-scene-'));
    directories.push(directory);
    return directory;
}

const nothing = () => undefined;
const everything = (name: string) => `/fake/${name}`;

describe('scene painter', () => {
    it('prefers a configured image model, then an agent CLI, then nothing', () => {
        expect(
            findScenePainter({ model: { gemini: { apiKey: 'g' } }, lookup: everything }),
        ).toMatchObject({ kind: 'model', provider: 'gemini' });
        expect(findScenePainter({ lookup: everything })).toEqual({
            kind: 'agent',
            provider: 'codex',
            commandPath: '/fake/codex',
        });
        expect(
            findScenePainter({ lookup: (name) => (name === 'agy' ? '/bin/agy' : undefined) }),
        ).toEqual({
            kind: 'agent',
            provider: 'agy',
            commandPath: '/bin/agy',
        });
        expect(findScenePainter({ lookup: nothing })).toBeUndefined();
    });

    it('uses only the backend named with --via and fails when it is missing', () => {
        expect(
            findScenePainter({
                via: 'agy',
                model: { openai: { apiKey: 'o' } },
                lookup: everything,
            }),
        ).toMatchObject({ kind: 'agent', provider: 'agy' });
        expect(() => findScenePainter({ via: 'codex', lookup: nothing })).toThrow(
            'codex is not installed. Install it or pick another painter with --via.',
        );
        expect(() => findScenePainter({ via: 'openai', lookup: everything })).toThrow(
            'No API key for openai.',
        );
    });

    it('asks for a photo with no text in it and paints one picture per orientation', () => {
        const prompt = scenePrompt('a harbour at dawn');
        expect(prompt).toContain('a harbour at dawn');
        expect(prompt).toContain('No text');
        expect(prompt).toContain('lower third calm');
        // 分两半时标题在色带上，画面让主体占满。
        expect(scenePrompt('a messy desk', true)).toContain('fill the frame');
        expect(scenePrompt('a messy desk', true)).not.toContain('lower third');
        expect(sceneOrientation('landscape')).toBe('landscape');
        expect(sceneOrientation('ultrawide')).toBe('landscape');
        expect(sceneOrientation('portrait')).toBe('portrait');
        // 分两半的类型每一族的半边都是横的。
        expect(sceneOrientation('landscape', true)).toBe('landscape');
        expect(sceneOrientation('ultrawide', true)).toBe('landscape');
        expect(sceneOrientation('portrait', true)).toBe('landscape');
        expect(() => parseScene('  ')).toThrow('--scene must not be empty.');
    });

    it('sends the scene to the model API and saves the picture at the native size', async () => {
        // 模型回了一张别的尺寸（Gemini 按档位给图）：归一到竖版原生尺寸再存。
        const returned = await sharp({
            create: { width: 800, height: 1200, channels: 3, background: '#336699' },
        })
            .png()
            .toBuffer();
        const fetch = vi.fn(
            async (_url: string, _init: RequestInit) =>
                new Response(
                    JSON.stringify({ data: [{ b64_json: returned.toString('base64') }] }),
                    {
                        status: 200,
                    },
                ),
        );
        const path = await paintScene(
            { kind: 'model', provider: 'openai', apiKey: 'k', model: 'm' },
            { scene: 'a harbour at dawn', orientation: 'portrait', runDir: tempDir(), index: 0 },
            { fetch },
        );
        expect(path.endsWith('scene-portrait-1.png')).toBe(true);
        const body = JSON.parse(String(fetch.mock.calls[0]?.[1].body)) as {
            prompt: string;
            size: string;
        };
        expect(body.prompt).toContain('a harbour at dawn');
        expect(body.size).toBe('1024x1536');
        const meta = await sharp(path).metadata();
        expect([meta.width, meta.height]).toEqual([1024, 1536]);
    });

    it('asks the agent for one saved picture and checks it landed', async () => {
        const spawn = vi.fn(async (request: { args: readonly string[] }) => {
            const envelope = request.args[2] as string;
            const target = /save it to (\S+)\. /.exec(envelope)?.[1] as string;
            await sharp({
                create: { width: 1536, height: 1024, channels: 3, background: '#aa6633' },
            })
                .png()
                .toFile(target);
        });
        const path = await paintScene(
            { kind: 'agent', provider: 'codex', commandPath: '/fake/codex' },
            { scene: 'a harbour at dawn', orientation: 'landscape', runDir: tempDir(), index: 0 },
            { spawn },
        );
        expect(existsSync(path)).toBe(true);
        expect(spawn.mock.calls[0]?.[0].args[2]).toContain('Landscape 1536x1024');
    });

    it('edits the before picture into the after picture, keeping the place', async () => {
        const runDir = tempDir();
        const before = join(runDir, 'before.png');
        await sharp({
            create: { width: 1024, height: 1536, channels: 3, background: '#553322' },
        })
            .png()
            .toFile(before);
        const spawn = vi.fn(async (request: { args: readonly string[] }) => {
            const envelope = request.args[2] as string;
            const target = /save it to (\S+)\. /.exec(envelope)?.[1] as string;
            await sharp(before).toFile(target);
        });
        await paintScene(
            { kind: 'agent', provider: 'codex', commandPath: '/fake/codex' },
            {
                scene: 'the same desk, tidy',
                orientation: 'portrait',
                runDir,
                index: 1,
                reference: before,
            },
            { spawn },
        );
        const args = spawn.mock.calls[0]?.[0].args ?? [];
        // codex 的参考图挂在最后，提示词里说清楚是照着它改。
        expect(args.slice(-2)).toEqual(['--image', before]);
        expect(args[2]).toContain(`edit the reference image at ${before}`);
        expect(args[2]).toContain('Change only this: the same desk, tidy.');
        expect(args[2]).toContain('camera position');

        const returned = await sharp(before).png().toBuffer();
        const fetch = vi.fn(
            async (_url: string, _init: RequestInit) =>
                new Response(
                    JSON.stringify({ data: [{ b64_json: returned.toString('base64') }] }),
                    { status: 200 },
                ),
        );
        await paintScene(
            { kind: 'model', provider: 'openai', apiKey: 'k', model: 'm' },
            {
                scene: 'the same desk, tidy',
                orientation: 'portrait',
                runDir,
                index: 1,
                reference: before,
            },
            { fetch },
        );
        expect(fetch.mock.calls[0]?.[0]).toBe('https://api.openai.com/v1/images/edits');
        const form = fetch.mock.calls[0]?.[1].body as FormData;
        expect(form.get('prompt')).toContain('Change only this: the same desk, tidy.');
        expect(form.get('size')).toBe('1024x1536');
        expect((form.get('image') as Blob).type).toBe('image/png');
    });

    it('uses the configured model id, else the default', () => {
        expect(
            findScenePainter({
                via: 'gemini',
                model: { gemini: { apiKey: 'g', model: 'g-2' } },
                lookup: nothing,
            }),
        ).toMatchObject({ kind: 'model', provider: 'gemini', model: 'g-2' });
        expect(
            findScenePainter({
                via: 'openai',
                model: { openai: { apiKey: 'o' } },
                lookup: nothing,
            }),
        ).toMatchObject({ model: 'gpt-image-2.5-flare' });
    });

    it('falls back to a gradient picture of the scheme colours', async () => {
        const path = await gradientScene(
            { base: '#138A94', deep: '#0A5C63' },
            'landscape',
            tempDir(),
        );
        expect(existsSync(path)).toBe(true);
        const meta = await sharp(path).metadata();
        expect([meta.width, meta.height]).toEqual([1536, 1024]);
    });
});
