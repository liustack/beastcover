import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { loadStyle } from '../styles/loader.ts';
import type { PaletteSlotValue, StyleDefinition } from '../styles/schema.ts';
import { createWorkspace, loadStylePack, mergedPalette } from '../workspace/index.ts';
import { buildEnvelopePrompt, buildStyleAndSubjectPrompt, formatSizePhrase } from './index.ts';

const tempDirectories: string[] = [];

afterEach(() => {
    for (const directory of tempDirectories.splice(0)) {
        rmSync(directory, { recursive: true, force: true });
    }
});

function tempDir(prefix: string): string {
    const directory = mkdtempSync(join(tmpdir(), prefix));
    tempDirectories.push(directory);
    return directory;
}

function paletteFromStyle(style: StyleDefinition): Record<string, PaletteSlotValue> {
    return Object.fromEntries(
        style.paletteSlots.map((slot) => [slot.name, { prompt: slot.prompt, css: slot.css }]),
    );
}

function withPromptOverride(
    style: StyleDefinition,
    slotName: string,
    prompt: string,
): Record<string, PaletteSlotValue> {
    const palette = paletteFromStyle(style);
    const slot = palette[slotName];
    if (!slot) {
        throw new Error(`Missing palette slot "${slotName}".`);
    }
    palette[slotName] = { ...slot, prompt };
    return palette;
}

function colorParagraphs(text: string): string[] {
    return text.split('\n\n').filter((paragraph) => paragraph.trim().startsWith('配色'));
}

describe('local-model prompt assembly', () => {
    it('keeps two segments: unchanged style prompt then 主体 when palette prompts match the catalog', () => {
        const cwd = tempDir('beastcover-prompt-default-');
        const created = createWorkspace(cwd, {
            name: 'demo',
            styleName: 'risograph_editorial',
        });
        const pack = loadStylePack(created.path);
        const style = loadStyle(pack.style);
        const subject = '一只背对的人';

        const result = buildStyleAndSubjectPrompt({
            style,
            subject,
            mergedPalette: mergedPalette(pack),
        });

        expect(result).toBe(`${style.prompt}\n\n主体：${subject}`);
        expect(result).toContain('颜色鲜亮，这是这一式的身份');
        expect(colorParagraphs(result)).toHaveLength(1);
    });

    it('does not replace the 配色 paragraph when only a css slot differs from the catalog', () => {
        const style = loadStyle('risograph_editorial');
        const merged = paletteFromStyle(style);
        const paper = merged.paper;
        if (!paper) {
            throw new Error('Missing paper slot.');
        }
        merged.paper = { ...paper, css: '#ff00aa' };
        const subject = '一只背对的人';

        const result = buildStyleAndSubjectPrompt({
            style,
            subject,
            mergedPalette: merged,
        });

        expect(result).toBe(`${style.prompt}\n\n主体：${subject}`);
        expect(colorParagraphs(result)).toHaveLength(1);
    });

    it('replaces the 配色 paragraph in place when a prompt slot is overridden, and does not append another', () => {
        const style = loadStyle('risograph_editorial');
        const replacement = '配色：纸底 亮白，专色 荧光橙加墨绿。';
        const subject = '一只背对的人';

        const result = buildStyleAndSubjectPrompt({
            style,
            subject,
            mergedPalette: withPromptOverride(style, 'spot', '荧光橙加墨绿'),
        });

        expect(result).toContain(replacement);
        expect(result).not.toContain('颜色鲜亮，这是这一式的身份');
        expect(result.split('配色：')).toHaveLength(2);
        expect(colorParagraphs(result)).toHaveLength(1);
        expect(result.split('\n\n').at(-1)?.trim()).toBe(`主体：${subject}`);
        expect(result.startsWith(style.prompt.split('\n\n')[0] ?? '')).toBe(true);
    });

    it('replaces a 配色 paragraph that is not last, leaving the following paragraph in place', () => {
        const style = loadStyle('risograph_editorial');
        const fake: StyleDefinition = {
            ...style,
            prompt: `孔版印刷。\n\n配色（本式推荐）：亮白纸底，荧光粉加靛蓝、或亮蓝加荧光橙、或青加荧光粉加黄。\n\n网点要粗。`,
        };
        const replacement = '配色：纸底 亮白，专色 赭石。';

        const result = buildStyleAndSubjectPrompt({
            style: fake,
            subject: '一个核心观点',
            mergedPalette: withPromptOverride(style, 'spot', '赭石'),
        });

        expect(result).toBe(`孔版印刷。\n\n${replacement}\n\n网点要粗。\n\n主体：一个核心观点`);
    });

    it('fails fast when a prompt override is required but the style has no 配色 paragraph', () => {
        const style = loadStyle('risograph_editorial');
        const fake: StyleDefinition = {
            ...style,
            prompt: '孔版印刷编辑插画。\n\n网点粗、看得见。',
        };

        expect(() =>
            buildStyleAndSubjectPrompt({
                style: fake,
                subject: '一只背对的人',
                mergedPalette: withPromptOverride(style, 'spot', '赭石'),
            }),
        ).toThrowError(/配色|palette paragraph/);
    });

    it('formats landscape, portrait, and square size phrases without using scale', () => {
        expect(formatSizePhrase(1536, 1024)).toBe('Landscape 1536x1024');
        expect(formatSizePhrase(1024, 1536)).toBe('竖版 1024x1536');
        expect(formatSizePhrase(1000, 1000)).toBe('Landscape 1000x1000');
    });

    it('builds a youtube envelope with save path, style body, 主体, generate size, and the generate-only closer', () => {
        const style = loadStyle('risograph_editorial');
        const subject = '一只背对的人';
        const outputPath = '/tmp/beastcover-out.png';
        const envelope = buildEnvelopePrompt({
            style,
            subject,
            mergedPalette: paletteFromStyle(style),
            generatedPath: outputPath,
            family: 'landscape',
            provider: 'codex',
        });

        expect(envelope).toBe(
            `Use your image generation capability to create one image and save it to ${outputPath}. ` +
                `${style.prompt}. 主体：${subject}. Landscape 1536x1024. ` +
                'Generate the image file only, do not do anything else.',
        );
        expect(envelope).not.toContain('1280x720');
    });

    it('appends the family composition hint to 主体 and keeps the native generate size', () => {
        const style = loadStyle('risograph_editorial');
        const subject = '一只背对的人';
        for (const [family, suffix, size] of [
            ['ultrawide', '主体集中在画面正中，上下边缘和左右两侧只放背景', 'Landscape 1536x1024'],
            ['portrait', '主体集中在画面中部，顶部和底部只放背景', '竖版 1024x1536'],
        ] as const) {
            const envelope = buildEnvelopePrompt({
                style,
                subject,
                mergedPalette: paletteFromStyle(style),
                generatedPath: '/tmp/beastcover-out.png',
                family,
                provider: 'codex',
            });
            expect(envelope, family).toContain(`主体：${subject}。${suffix}. ${size}`);
            expect(envelope, family).not.toContain('1080x');
        }
    });

    it('appends grok and claude reference paths after the envelope closer, not inside it', () => {
        const style = loadStyle('risograph_editorial');
        const outputPath = '/tmp/beastcover-out.png';
        const refs = ['/tmp/cover-ref-a.png', '/tmp/cover-ref-b.jpg'];
        const closer = 'Generate the image file only, do not do anything else.';
        const merged = paletteFromStyle(style);

        for (const provider of ['grok', 'claude'] as const) {
            const envelope = buildEnvelopePrompt({
                style,
                subject: '一只背对的人',
                mergedPalette: merged,
                generatedPath: outputPath,
                family: 'landscape',
                provider,
                referencePaths: refs,
            });
            const closerIndex = envelope.indexOf(closer);
            expect(closerIndex).toBeGreaterThan(-1);
            const before = envelope.slice(0, closerIndex);
            const after = envelope.slice(closerIndex + closer.length);
            expect(before).not.toContain(refs[0]);
            expect(before).not.toContain(refs[1]);
            expect(after).toContain(refs[0]);
            expect(after).toContain(refs[1]);
        }
    });

    it('does not append codex reference paths inside the envelope prompt', () => {
        const style = loadStyle('risograph_editorial');
        const refs = ['/tmp/cover-ref-a.png', '/tmp/cover-ref-b.jpg'];
        const envelope = buildEnvelopePrompt({
            style,
            subject: '一只背对的人',
            mergedPalette: paletteFromStyle(style),
            generatedPath: '/tmp/beastcover-out.png',
            family: 'landscape',
            provider: 'codex',
            referencePaths: refs,
        });

        expect(envelope).toContain('Generate the image file only, do not do anything else.');
        expect(envelope).not.toContain(refs[0]);
        expect(envelope).not.toContain(refs[1]);
    });
});
