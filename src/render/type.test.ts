import { describe, expect, it } from 'vitest';
import {
    headlineLayers,
    headlineTypeCss,
    parseEmphasis,
    stripEmphasis,
    type TypeSpec,
    typeExtentEm,
} from './type.ts';

const HEAVY = {
    role: 'heavy' as const,
    cjk: 'Noto Sans CJK SC',
    latin: 'Impact',
    stack: '"Impact", "Noto Sans CJK SC", sans-serif',
    syntheticBold: 0,
    notes: [],
};

describe('emphasis markup', () => {
    it('reads *keyword* marks and strips them for plain text', () => {
        expect(parseEmphasis('3个错误*毁了*我')).toEqual([
            { text: '3个错误', emphasis: false },
            { text: '毁了', emphasis: true },
            { text: '我', emphasis: false },
        ]);
        expect(stripEmphasis('3个错误*毁了*我')).toBe('3个错误毁了我');
    });

    it('highlights figures when nothing is marked', () => {
        expect(parseEmphasis('离岩浆50米')).toEqual([
            { text: '离岩浆', emphasis: false },
            { text: '50', emphasis: true },
            { text: '米', emphasis: false },
        ]);
        expect(parseEmphasis('$1 vs $1M')).toEqual([
            { text: '$1', emphasis: true },
            { text: ' vs ', emphasis: false },
            { text: '$1M', emphasis: true },
        ]);
    });

    it('leaves a headline without figures or marks unhighlighted', () => {
        expect(parseEmphasis('我看傻了')).toEqual([{ text: '我看傻了', emphasis: false }]);
    });

    it('rejects an unclosed mark instead of guessing', () => {
        expect(() => parseEmphasis('3个*错误')).toThrowError(/unclosed \*/);
    });
});

describe('type extent', () => {
    it('grows with the outer stroke and the hard shadow, so effects stay in the safe area', () => {
        const outline: TypeSpec = { style: 'outline', font: HEAVY };
        const double: TypeSpec = { style: 'double', font: HEAVY };
        const ink: TypeSpec = { style: 'ink', font: HEAVY };
        expect(typeExtentEm(ink)).toBe(0);
        expect(typeExtentEm(outline)).toBeGreaterThan(0.1);
        expect(typeExtentEm(double)).toBeGreaterThan(typeExtentEm(outline));
    });
});

describe('headline layers', () => {
    it('stacks an outline under the fill with the same markup, so lines break the same way', () => {
        const html = headlineLayers(
            '离岩浆*50*米',
            { fontPx: 120, keepClauses: false },
            {
                style: 'outline',
                font: HEAVY,
            },
        );
        const layers = html.match(/class="(copy[^"]*)"/g) ?? [];
        expect(layers).toEqual(['class="copy-layer copy-outline"', 'class="copy"']);
        expect(html.match(/<span class="hl">50<\/span>/g)).toHaveLength(2);
        expect(html).not.toContain('*');
    });

    it('uses paint-order so the stroke grows outward and never eats the glyph', () => {
        const css = headlineTypeCss(
            { style: 'double', font: HEAVY, tilt: -4 },
            {
                fill: '#FFE600',
                stroke: '#0B0B0B',
                ring: '#FFFFFF',
                accent: '#FF2D2D',
            },
        );
        expect(css).toContain('paint-order: stroke fill');
        expect(css).toContain('font-family: "Impact", "Noto Sans CJK SC", sans-serif');
        expect(css).toContain('rotate(-4deg)');
        expect(css).toMatch(/drop-shadow\([^)]*0 #0B0B0B\)/);
    });

    it('adds a fill-colored stroke when the font is only synthetically bold', () => {
        const css = headlineTypeCss(
            { style: 'ink', font: { ...HEAVY, cjk: 'PingFang SC', syntheticBold: 0.035 } },
            { fill: '#111111', stroke: '#111111', ring: '#FFFFFF', accent: '#FF2D2D' },
        );
        expect(css).toContain('-webkit-text-stroke: 0.035em #111111');
    });
});
