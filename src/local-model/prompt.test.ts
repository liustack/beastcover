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
            styleName: 'memory_color_blocks',
        });
        const pack = loadStylePack(created.path);
        const style = loadStyle(pack.style);
        const subject = '一只背对的人';

        const result = buildStyleAndSubjectPrompt({
            style,
            subject,
            mergedPalette: mergedPalette(pack),
        });

        expect(style.subjectSlot).toBeUndefined();
        expect(result.startsWith(style.prompt)).toBe(true);
        expect(result).toBe(`${style.prompt}\n\n主体：${subject}`);
        expect(result).toContain('\n主体：一只背对的人');
        expect(result).toContain('配色是这个式子的身份');
        expect(colorParagraphs(result)).toHaveLength(1);
        expect(result.endsWith(`主体：${subject}`)).toBe(true);
    });

    it('does not replace the 配色 paragraph when only a css slot differs from the catalog', () => {
        const style = loadStyle('memory_color_blocks');
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
        expect(result).toContain(style.prompt);
        expect(result).toContain('配色是这个式子的身份');
        expect(colorParagraphs(result)).toHaveLength(1);
    });

    it('replaces the 配色 paragraph in place when a prompt slot is overridden, and does not append another', () => {
        const style = loadStyle('memory_color_blocks');
        const replacement = '配色：纸底 纯白，风景记忆 赤茶、锈红，人物轮廓 墨色，暖色点 暖黄点。';
        const subject = '一只背对的人';

        const result = buildStyleAndSubjectPrompt({
            style,
            subject,
            mergedPalette: withPromptOverride(style, 'landscape', '赤茶、锈红'),
        });

        expect(result).toContain(replacement);
        expect(result).not.toContain('配色是这个式子的身份');
        expect(result.split('配色：')).toHaveLength(2);
        expect(colorParagraphs(result)).toHaveLength(1);
        expect(result.split('\n\n').at(-1)?.trim()).toBe(`主体：${subject}`);
        expect(result.startsWith(style.prompt.split('\n\n')[0] ?? '')).toBe(true);
    });

    it('replaces a 配色 paragraph that is not last, leaving the following paragraph in place', () => {
        const style = loadStyle('freehand_doodle');
        const replacement = '配色：纸底 纯白，线条 浅灰墨色，填色 赭石。';

        const result = buildStyleAndSubjectPrompt({
            style,
            subject: '一个核心观点',
            mergedPalette: withPromptOverride(style, 'fill', '赭石'),
        });

        expect(result).toContain(replacement);
        expect(result).not.toContain('配色（本式推荐');
        const replacementIndex = result.indexOf(replacement);
        const backgroundIndex = result.indexOf('背景永远是纯白');
        expect(replacementIndex).toBeGreaterThan(-1);
        expect(backgroundIndex).toBeGreaterThan(replacementIndex + replacement.length);
        expect(result.endsWith('主体：一个核心观点')).toBe(true);
    });

    it('fails fast when a prompt override is required but the style has no 配色 paragraph', () => {
        const style = loadStyle('memory_color_blocks');
        const fake: StyleDefinition = {
            ...style,
            prompt: '色块记忆式极简编辑插图。\n\n大色块、软边界、极少线条。',
        };

        expect(() =>
            buildStyleAndSubjectPrompt({
                style: fake,
                subject: '一只背对的人',
                mergedPalette: withPromptOverride(style, 'landscape', '赤茶、锈红'),
            }),
        ).toThrowError(/配色|palette paragraph/);
    });

    it('formats landscape, portrait, and square size phrases without using scale', () => {
        expect(formatSizePhrase(1536, 1024)).toBe('Landscape 1536x1024');
        expect(formatSizePhrase(1242, 1656)).toBe('竖版 1242x1656');
        expect(formatSizePhrase(800, 1200)).toBe('竖版 800x1200');
        expect(formatSizePhrase(1200, 800)).toBe('Landscape 1200x800');
        expect(formatSizePhrase(1000, 1000)).toBe('Landscape 1000x1000');
    });

    it('builds a 3:2 envelope with save path, style body, 主体, generate size, and the generate-only closer', () => {
        const style = loadStyle('memory_color_blocks');
        const subject = '一只背对的人';
        const outputPath = '/tmp/beastcover-out.png';
        const envelope = buildEnvelopePrompt({
            style,
            subject,
            mergedPalette: paletteFromStyle(style),
            outputPath,
            preset: '3:2',
            provider: 'codex',
        });

        expect(envelope).toContain(
            `Use your image generation capability to create one image and save it to ${outputPath}`,
        );
        expect(envelope).toContain(style.prompt);
        expect(envelope).toContain(`主体：${subject}`);
        expect(envelope).not.toContain('构图集中在中带、上下留纸');
        expect(envelope).toContain('Landscape 1536x1024');
        expect(envelope).toContain('Generate the image file only, do not do anything else.');
        expect(envelope).not.toContain('3072');
        expect(envelope).not.toContain('2048');
    });

    it('puts 16:9 generate size in the envelope, not production pixels', () => {
        const style = loadStyle('memory_color_blocks');
        const envelope = buildEnvelopePrompt({
            style,
            subject: '一只背对的人',
            mergedPalette: paletteFromStyle(style),
            outputPath: '/tmp/beastcover-out.png',
            preset: '16:9',
            provider: 'codex',
        });

        expect(envelope).toContain('Landscape 1536x1024');
        expect(envelope).not.toContain('1600x900');
    });

    it('appends the 5:2 composition suffix to 主体 and keeps generate size', () => {
        const style = loadStyle('memory_color_blocks');
        const subject = '一只背对的人';
        const envelope = buildEnvelopePrompt({
            style,
            subject,
            mergedPalette: paletteFromStyle(style),
            outputPath: '/tmp/beastcover-out.png',
            preset: '5:2',
            provider: 'codex',
        });

        expect(envelope).toContain('Landscape 1536x1024');
        expect(envelope).toContain('构图集中在中带、上下留纸');
        expect(envelope).toContain(`主体：${subject}。构图集中在中带、上下留纸`);
        expect(envelope).not.toContain('1600x640');
    });

    it('puts 3:4 generate size in the envelope, not production pixels', () => {
        const style = loadStyle('memory_color_blocks');
        const envelope = buildEnvelopePrompt({
            style,
            subject: '一只背对的人',
            mergedPalette: paletteFromStyle(style),
            outputPath: '/tmp/beastcover-out.png',
            preset: '3:4',
            provider: 'codex',
        });

        expect(envelope).toContain('竖版 1024x1536');
        expect(envelope).not.toContain('1242x1656');
        expect(envelope).not.toContain('2484');
        expect(envelope).not.toContain('3312');
    });

    it('appends grok and claude reference paths after the envelope closer, not inside it', () => {
        const style = loadStyle('memory_color_blocks');
        const outputPath = '/tmp/beastcover-out.png';
        const refs = ['/tmp/cover-ref-a.png', '/tmp/cover-ref-b.jpg'];
        const closer = 'Generate the image file only, do not do anything else.';
        const merged = paletteFromStyle(style);

        for (const provider of ['grok', 'claude'] as const) {
            const envelope = buildEnvelopePrompt({
                style,
                subject: '一只背对的人',
                mergedPalette: merged,
                outputPath,
                preset: '3:2',
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
        const style = loadStyle('memory_color_blocks');
        const refs = ['/tmp/cover-ref-a.png', '/tmp/cover-ref-b.jpg'];
        const envelope = buildEnvelopePrompt({
            style,
            subject: '一只背对的人',
            mergedPalette: paletteFromStyle(style),
            outputPath: '/tmp/beastcover-out.png',
            preset: '3:2',
            provider: 'codex',
            referencePaths: refs,
        });

        expect(envelope).toContain('Generate the image file only, do not do anything else.');
        expect(envelope).not.toContain(refs[0]);
        expect(envelope).not.toContain(refs[1]);
    });

    it('fills the extreme_minimal_abstraction relationship slot in place and does not append 主体', () => {
        const style = loadStyle('extreme_minimal_abstraction');
        const subject = '一个人站在半开的门前，门外是清晨';
        const marker = '【填写原始主题中必须保留的关系】';

        const result = buildStyleAndSubjectPrompt({
            style,
            subject,
            mergedPalette: paletteFromStyle(style),
        });

        expect(result).toContain(subject);
        expect(result).not.toContain(marker);
        expect(result).not.toContain('【');
        expect(result).not.toContain('】');
        expect(result).not.toContain('主体：');
        expect(result).toBe(style.prompt.split(marker).join(subject));
    });

    it('keeps the catalog paragraph structure after filling the subject slot', () => {
        const style = loadStyle('extreme_minimal_abstraction');
        const subject = '一个人站在半开的门前，门外是清晨';
        const marker = '【填写原始主题中必须保留的关系】';
        const filled = style.prompt.split(marker).join(subject);

        const result = buildStyleAndSubjectPrompt({
            style,
            subject,
            mergedPalette: paletteFromStyle(style),
        });

        expect(result.split('\n\n')).toHaveLength(style.prompt.split('\n\n').length);
        expect(result).not.toBe(`${filled}\n\n主体：${subject}`);
        expect(result).toBe(filled);
    });

    it('builds a slotted 3:2 envelope with the subject in the style body and no 主体 clause', () => {
        const style = loadStyle('extreme_minimal_abstraction');
        const subject = '一个人站在半开的门前，门外是清晨';
        const outputPath = '/tmp/beastcover-out.png';
        const envelope = buildEnvelopePrompt({
            style,
            subject,
            mergedPalette: paletteFromStyle(style),
            outputPath,
            preset: '3:2',
            provider: 'codex',
        });

        expect(envelope).toContain(subject);
        expect(envelope).not.toContain('【填写原始主题中必须保留的关系】');
        expect(envelope).not.toContain('【');
        expect(envelope).not.toContain('】');
        expect(envelope).not.toContain('主体：');
        expect(envelope).toContain(
            `Use your image generation capability to create one image and save it to ${outputPath}`,
        );
        expect(envelope).toContain('Landscape 1536x1024');
        expect(envelope).toContain('Generate the image file only, do not do anything else.');
    });

    it('keeps the 5:2 composition suffix as its own clause when the subject is slotted', () => {
        const style = loadStyle('extreme_minimal_abstraction');
        const envelope = buildEnvelopePrompt({
            style,
            subject: '一个人站在半开的门前，门外是清晨',
            mergedPalette: paletteFromStyle(style),
            outputPath: '/tmp/beastcover-out.png',
            preset: '5:2',
            provider: 'codex',
        });

        expect(envelope).toContain('构图集中在中带、上下留纸');
        expect(envelope).not.toContain('主体：');
        expect(envelope).toContain('Landscape 1536x1024');
    });

    it('fails fast when a declared subject-slot marker is missing from the prompt', () => {
        const style = loadStyle('memory_color_blocks');
        const fake: StyleDefinition = {
            ...style,
            subjectSlot: { marker: '【填写原始主题中必须保留的关系】' },
        };

        expect(() =>
            buildStyleAndSubjectPrompt({
                style: fake,
                subject: '一个人站在半开的门前，门外是清晨',
                mergedPalette: paletteFromStyle(style),
            }),
        ).toThrowError(/not found|subject slot marker/i);
    });

    it('fails fast when a declared subject-slot marker appears more than once', () => {
        const style = loadStyle('memory_color_blocks');
        const marker = '【填写原始主题中必须保留的关系】';
        const fake: StyleDefinition = {
            ...style,
            prompt: `${marker}\n\n${style.prompt}\n\n${marker}`,
            subjectSlot: { marker },
        };

        expect(() =>
            buildStyleAndSubjectPrompt({
                style: fake,
                subject: '一个人站在半开的门前，门外是清晨',
                mergedPalette: paletteFromStyle(style),
            }),
        ).toThrowError(/exactly once|more than once|subject slot marker/i);
    });

    it('fails fast when a declared subject-slot marker is empty', () => {
        const style = loadStyle('memory_color_blocks');
        const fake: StyleDefinition = {
            ...style,
            subjectSlot: { marker: '' },
        };

        expect(() =>
            buildStyleAndSubjectPrompt({
                style: fake,
                subject: '一个人站在半开的门前，门外是清晨',
                mergedPalette: paletteFromStyle(style),
            }),
        ).toThrowError(/empty/i);
    });
});
