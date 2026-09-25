import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { BUILT_IN_STYLES } from './catalog.ts';
import { listStyles, loadStyle } from './loader.ts';
import { parseCssColorValue } from './schema.ts';

const STYLE_ORDER = [
    'minimal_watercolor',
    'freehand_doodle',
    'memory_color_blocks',
    'single_line_sketch',
    'extreme_minimal_abstraction',
    'conceptual_colorfield',
    'luminous_impasto',
    'monet_editorial_impressionism',
    'torn_paper_editorial_collage',
    'risograph_editorial',
] as const;

const PROMPT_SHA256 = {
    minimal_watercolor: 'c039b8b77a324bac8a9fc2d2b8ac7880ec3854ccdd7b155eec601e6727520406',
    freehand_doodle: 'e328f6923da799f4a7a47142be902d8c068f01a68b5a2e6e4b1daeca258c1bbe',
    memory_color_blocks: '003fed6a3d3d0b555768f99952aba0bfa81ce92e294c59671413fb4463f7c460',
    single_line_sketch: 'a0b3759069b8f6ecedfae09e00ec11e86eca69113efaf665547e9464b521f6f0',
    extreme_minimal_abstraction: '158eb653b37dfb739e132314ac85555ac985ca5fdfc343729be6360d2c4385bd',
    conceptual_colorfield: '3f46780bca40df10056e51c989568ec44432cc0345ad0dfcf4eef5d31c4c5911',
    luminous_impasto: '8c537e86e624573c31a2cd6f42596a05d64d2628fcf86f6ddd6225301279a46f',
    monet_editorial_impressionism:
        '6256165a6e1e8ba0662ccca986eb6e54dfec97d82e8d02b968f15222d8df5015',
    torn_paper_editorial_collage:
        'cd0ff82fc80f2c9194017dd1bef6f75238909dbee34247e375aea7da440c221e',
    risograph_editorial: 'f1d0ccbe8e2e1fa6dda9ace42cf62e3ed3925357605ce81393d4f8635e009d3c',
} as const;

function sha256(value: string): string {
    return createHash('sha256').update(value, 'utf8').digest('hex');
}

describe('built-in style catalog', () => {
    it('lists the ten styles in catalog order', () => {
        expect(listStyles().map((style) => style.name)).toEqual([...STYLE_ORDER]);
        expect(BUILT_IN_STYLES).toHaveLength(10);
    });

    it('keeps each prompt byte-for-byte with the artwork source text', () => {
        for (const name of STYLE_ORDER) {
            const style = loadStyle(name);
            expect(sha256(style.prompt), name).toBe(PROMPT_SHA256[name]);
        }
    });

    it('keeps palette prompt values inside the unchanged prompt', () => {
        for (const style of listStyles()) {
            for (const slot of style.paletteSlots) {
                expect(style.prompt.includes(slot.prompt), `${style.name}.${slot.name}`).toBe(true);
            }
        }
    });

    it('gives every palette slot a CSS color for the renderer', () => {
        for (const style of listStyles()) {
            for (const slot of style.paletteSlots) {
                expect(parseCssColorValue(slot.css), `${style.name}.${slot.name}`).toBe(slot.css);
            }
        }
    });

    it('records fallback, tier, cover, and scene constraints as catalog metadata', () => {
        const fallback = listStyles().filter((style) => style.isFallback);
        expect(fallback.map((style) => style.name)).toEqual(['memory_color_blocks']);

        expect(
            listStyles()
                .filter((style) => style.tier === 'primary')
                .map((style) => style.name),
        ).toEqual(['minimal_watercolor', 'freehand_doodle', 'memory_color_blocks']);

        expect(
            listStyles()
                .filter((style) => style.coverOnly)
                .map((style) => style.name),
        ).toEqual(['luminous_impasto']);

        expect(
            listStyles()
                .filter((style) => style.requiresScene)
                .map((style) => style.name),
        ).toEqual(['luminous_impasto']);
    });

    it('uses paper-border and full-bleed exactly where the source specifies them', () => {
        // 纸感五式来自 artwork 原文。另外五式原文未写，2026-08-23 十式各出一张样图人审后定案：
        // luminous_impasto 与 monet 判对，torn_paper 与 risograph 判错，实测都是铺满不留纸边。
        const paper = [
            'minimal_watercolor',
            'freehand_doodle',
            'memory_color_blocks',
            'single_line_sketch',
            'extreme_minimal_abstraction',
        ];
        const fullBleed = [
            'conceptual_colorfield',
            'luminous_impasto',
            'monet_editorial_impressionism',
            'torn_paper_editorial_collage',
            'risograph_editorial',
        ];

        for (const name of paper) {
            expect(loadStyle(name).canvas.strategy, name).toBe('paper-border');
        }
        for (const name of fullBleed) {
            expect(loadStyle(name).canvas.strategy, name).toBe('full-bleed');
        }
        expect(paper.length + fullBleed.length).toBe(10);
    });

    it('declares a subject slot only on extreme_minimal_abstraction', () => {
        const slotted = listStyles().filter((style) => style.subjectSlot !== undefined);
        expect(slotted.map((style) => style.name)).toEqual(['extreme_minimal_abstraction']);

        const style = loadStyle('extreme_minimal_abstraction');
        const marker = '【填写原始主题中必须保留的关系】';
        expect(style.subjectSlot).toEqual({
            marker,
            hint: 'This style fills a relationship, not a subject. Keep that relationship as the same event in the article. Do not invent a separate abstract idea.',
        });
        expect(style.prompt.split(marker)).toHaveLength(2);
    });
});
