import { describe, expect, it } from 'vitest';
import { isCssColorValue, parseCssColorValue } from './schema.ts';

describe('CSS color values', () => {
    it('accepts hex, rgb, hsl, and oklch prefixes', () => {
        expect(parseCssColorValue('#f4efe6')).toBe('#f4efe6');
        expect(parseCssColorValue(' #fff ')).toBe('#fff');
        expect(parseCssColorValue('rgb(255, 0, 0)')).toBe('rgb(255, 0, 0)');
        expect(parseCssColorValue('hsl(40 20% 90%)')).toBe('hsl(40 20% 90%)');
        expect(parseCssColorValue('oklch(0.8 0.05 80)')).toBe('oklch(0.8 0.05 80)');
        expect(isCssColorValue('#1746d1')).toBe(true);
    });

    it('throws for a non-CSS color instead of dropping it', () => {
        expect(() => parseCssColorValue('暖白')).toThrowError('Invalid CSS color "暖白".');
        expect(() => parseCssColorValue('')).toThrowError('Invalid CSS color "".');
        expect(isCssColorValue('暖白')).toBe(false);
    });
});
