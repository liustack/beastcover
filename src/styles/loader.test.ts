import { describe, expect, it } from 'vitest';
import { listStyles, loadFallbackStyle, loadStyle } from './loader.ts';

const NAMES =
    'risograph_editorial, luminous_impasto, torn_paper_editorial_collage, conceptual_colorfield';

describe('style loader', () => {
    it('loads self-contained style records', () => {
        expect(listStyles().map((style) => style.name)).toEqual(NAMES.split(', '));

        const style = loadStyle('conceptual_colorfield');
        expect(style.prompt).toContain('色域铺满整幅画布，不留纸边。');
        expect(style.paletteSlots.map((slot) => slot.name)).toEqual([
            'background',
            'primary',
            'dark',
            'neutral',
            'accent',
        ]);
    });

    it('loads the unique fallback style by catalog metadata', () => {
        expect(loadFallbackStyle().name).toBe('risograph_editorial');
    });

    it('fails fast for an unknown style instead of choosing a fallback', () => {
        expect(() => loadStyle('unknown')).toThrowError(`Unknown style "unknown". Use ${NAMES}.`);
    });

    it('says a removed style is gone instead of treating it as a typo', () => {
        expect(() => loadStyle('memory_color_blocks')).toThrowError(
            `Style "memory_color_blocks" was removed because it does not hold up as a cover. Use ${NAMES}.`,
        );
    });
});
