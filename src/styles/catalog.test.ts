import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { BUILT_IN_STYLES } from './catalog.ts';
import { listStyles, loadStyle } from './loader.ts';
import { parseCssColorValue } from './schema.ts';

const STYLE_ORDER = [
    'risograph_editorial',
    'luminous_impasto',
    'torn_paper_editorial_collage',
    'conceptual_colorfield',
] as const;

const PROMPT_SHA256 = {
    risograph_editorial: 'f1d0ccbe8e2e1fa6dda9ace42cf62e3ed3925357605ce81393d4f8635e009d3c',
    luminous_impasto: '8c537e86e624573c31a2cd6f42596a05d64d2628fcf86f6ddd6225301279a46f',
    torn_paper_editorial_collage:
        'cd0ff82fc80f2c9194017dd1bef6f75238909dbee34247e375aea7da440c221e',
    conceptual_colorfield: '3f46780bca40df10056e51c989568ec44432cc0345ad0dfcf4eef5d31c4c5911',
} as const;

function sha256(value: string): string {
    return createHash('sha256').update(value, 'utf8').digest('hex');
}

describe('built-in style catalog', () => {
    it('lists the four cover styles in catalog order', () => {
        expect(listStyles().map((style) => style.name)).toEqual([...STYLE_ORDER]);
        expect(BUILT_IN_STYLES).toHaveLength(4);
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

    it('records the fallback and scene constraints as catalog metadata', () => {
        expect(
            listStyles()
                .filter((style) => style.isFallback)
                .map((style) => style.name),
        ).toEqual(['risograph_editorial']);
        expect(
            listStyles()
                .filter((style) => style.requiresScene)
                .map((style) => style.name),
        ).toEqual(['luminous_impasto']);
    });

    it('gives every style a composition note for the workspace', () => {
        for (const style of listStyles()) {
            expect(style.composition.trim(), style.name).not.toBe('');
        }
    });
});
