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
            'No installed CLI found for via "codex". Install codex.',
        );
        expect(() => findScenePainter({ via: 'openai', lookup: everything })).toThrow(
            'No API key for openai.',
        );
    });

    it('asks for a photo with no text in it and paints one picture per orientation', () => {
        const prompt = scenePrompt('a harbour at dawn');
        expect(prompt).toContain('a harbour at dawn');
        expect(prompt).toContain('No text');
        expect(sceneOrientation('landscape')).toBe('landscape');
        expect(sceneOrientation('ultrawide')).toBe('landscape');
        expect(sceneOrientation('portrait')).toBe('portrait');
        expect(() => parseScene('  ')).toThrow('--scene must not be empty.');
    });

    it('sends the scene to the model API and keeps only the raw picture', async () => {
        const runModelApi = vi.fn(async () => ({ outputPaths: [] }));
        const path = await paintScene(
            { kind: 'model', provider: 'openai', apiKey: 'k', model: 'm' },
            'a harbour at dawn',
            'portrait',
            tempDir(),
            { runModelApi, runAgent: vi.fn() },
        );
        expect(path.endsWith('scene-portrait.png')).toBe(true);
        expect(runModelApi).toHaveBeenCalledWith(
            expect.objectContaining({ family: 'portrait', targets: [], generatedPath: path }),
        );
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
