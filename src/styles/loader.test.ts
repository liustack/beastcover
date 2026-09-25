import { describe, expect, it } from 'vitest';
import { listStyles, loadFallbackStyle, loadStyle } from './loader.ts';

describe('style loader', () => {
    it('loads self-contained style records with contrasting canvas strategies', () => {
        expect(listStyles().map((style) => style.name)).toEqual([
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
        ]);

        const paperStyle = loadStyle('minimal_watercolor');
        expect(paperStyle.canvas.strategy).toBe('paper-border');
        expect(paperStyle.prompt).toContain('极简水彩编辑插图。');
        expect(paperStyle.prompt).toContain('配色（本式推荐，可按当篇文章或产品主题替换）');
        expect(paperStyle.avoid).toContain('完整风景');
        expect(paperStyle.paletteSlots.map((slot) => slot.name)).toEqual([
            'paper',
            'primary',
            'secondary',
            'accent',
            'dark',
        ]);

        const fullBleedStyle = loadStyle('conceptual_colorfield');
        expect(fullBleedStyle.canvas.strategy).toBe('full-bleed');
        expect(fullBleedStyle.prompt).toContain('色域铺满整幅画布，不留纸边。');
    });

    it('loads the unique fallback style by catalog metadata', () => {
        expect(loadFallbackStyle().name).toBe('memory_color_blocks');
    });

    it('fails fast for an unknown style instead of choosing a fallback', () => {
        expect(() => loadStyle('unknown')).toThrowError(
            'Unknown style "unknown". Use minimal_watercolor, freehand_doodle, memory_color_blocks, single_line_sketch, extreme_minimal_abstraction, conceptual_colorfield, luminous_impasto, monet_editorial_impressionism, torn_paper_editorial_collage, risograph_editorial.',
        );
    });
});
