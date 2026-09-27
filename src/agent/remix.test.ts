import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { loadStyle } from '../styles/loader.ts';
import { buildEnvelopePrompt } from './prompt.ts';
import { assertRedrawable, remixModeFor } from './remix.ts';

const tempDirectories: string[] = [];

afterEach(() => {
    for (const directory of tempDirectories.splice(0)) {
        rmSync(directory, { recursive: true, force: true });
    }
});

function imageWithSidecar(sidecar?: object): string {
    const directory = mkdtempSync(join(tmpdir(), 'beastcover-remix-'));
    tempDirectories.push(directory);
    const path = join(directory, 'photo.jpg');
    writeFileSync(path, 'jpg');
    if (sidecar !== undefined) {
        writeFileSync(`${path}.json`, JSON.stringify(sidecar));
    }
    return path;
}

describe('remix inputs', () => {
    it('restyles one image and places the person from the first into the second', () => {
        expect(remixModeFor(['/a.png'])).toBe('restyle');
        expect(remixModeFor(['/a.png', '/b.png'])).toBe('place');
        expect(() => remixModeFor(['/a', '/b', '/c'])).toThrowError(
            '--remix takes one image to redraw, or two: the person first, then the scene.',
        );
    });

    it('redraws your own images and cc0/pdm photos, and nothing else', () => {
        expect(() => assertRedrawable(imageWithSidecar())).not.toThrow();
        expect(() =>
            assertRedrawable(imageWithSidecar({ provider: 'openverse', license: 'cc0' })),
        ).not.toThrow();
        const pexels = imageWithSidecar({ provider: 'pexels', license: 'Pexels License' });
        expect(() => assertRedrawable(pexels)).toThrowError(
            `${pexels} came from pexels under "Pexels License". --remix only redraws your own images or cc0/pdm photos.`,
        );
        expect(() =>
            assertRedrawable(imageWithSidecar({ provider: 'openverse', license: 'by' })),
        ).toThrowError(/only redraws your own images or cc0\/pdm photos/);
    });

    it('adds the remix instruction to the subject line and leaves the style prompt untouched', () => {
        const style = loadStyle('risograph_editorial');
        const palette = Object.fromEntries(
            style.paletteSlots.map((slot) => [slot.name, { prompt: slot.prompt, css: slot.css }]),
        );
        const base = {
            style,
            subject: '一个人站在海边',
            mergedPalette: palette,
            generatedPath: '/tmp/out.png',
            family: 'landscape' as const,
            provider: 'codex' as const,
        };

        const restyle = buildEnvelopePrompt({ ...base, remix: 'restyle' });
        expect(restyle).toContain(style.prompt);
        expect(restyle).toContain(
            '主体：一个人站在海边。以参考图 1 为底稿重绘：保留构图、人物姿态和脸部特征，只换成上面的画风. Landscape 1536x1024',
        );
        const place = buildEnvelopePrompt({ ...base, family: 'portrait', remix: 'place' });
        expect(place).toContain(
            '主体：一个人站在海边。把参考图 1 里的人放进参考图 2 的场景：这个人的脸、发型和衣着保持不变，光线和色调跟着场景走。主体集中在画面中部',
        );
        expect(buildEnvelopePrompt(base)).not.toContain('参考图');
    });
});
