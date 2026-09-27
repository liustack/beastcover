import { describe, expect, it } from 'vitest';
import { chooseFont, FONT_ROLES, type FontProbe, fontCandidates } from './fonts.ts';

/** 造一份探测结果：没列出的字体都当没装 */
function probe(entries: Record<string, Partial<FontProbe>>): (family: string) => FontProbe {
    return (family) => ({
        family,
        installed: false,
        covers: false,
        density: 0,
        ...entries[family],
    });
}

describe('font roles', () => {
    it('lists candidates for every role, designer picks first and system fonts last', () => {
        for (const role of FONT_ROLES) {
            const list = fontCandidates(role);
            expect(list.cjk.length, role).toBeGreaterThan(0);
            expect(list.latin.length, role).toBeGreaterThan(0);
        }
        const heavy = fontCandidates('heavy');
        expect(heavy.cjk.indexOf('Source Han Sans SC')).toBeLessThan(
            heavy.cjk.indexOf('PingFang SC'),
        );
        expect(heavy.latin.indexOf('Anton')).toBeLessThan(heavy.latin.indexOf('Impact'));
    });
});

describe('choosing a heavy font', () => {
    it('takes the first installed candidate that covers the headline and is truly heavy', () => {
        const choice = chooseFont(
            'heavy',
            probe({
                'Source Han Sans SC': { installed: false },
                'Noto Sans CJK SC': { installed: true, covers: true, density: 0.475 },
                'PingFang SC': { installed: true, covers: true, density: 0.388 },
                Anton: { installed: false },
                Impact: { installed: true, covers: true, density: 0.318 },
            }),
        );
        expect(choice.stack.startsWith('"Impact", "Noto Sans CJK SC"')).toBe(true);
        expect(choice.syntheticBold).toBe(0);
        expect(choice.notes).toEqual([]);
    });

    it('skips a font that is installed but misses glyphs in the headline', () => {
        const choice = chooseFont(
            'heavy',
            probe({
                'Hiragino Sans': { installed: true, covers: false, density: 0.508 },
                'PingFang SC': { installed: true, covers: true, density: 0.388 },
            }),
        );
        expect(choice.cjk).toBe('PingFang SC');
    });

    it('falls back to the heaviest covering font with synthetic weight and says so', () => {
        const choice = chooseFont(
            'heavy',
            probe({
                'PingFang SC': { installed: true, covers: true, density: 0.388 },
                'Heiti SC': { installed: true, covers: true, density: 0.277 },
            }),
        );
        expect(choice.cjk).toBe('PingFang SC');
        expect(choice.syntheticBold).toBeGreaterThan(0);
        expect(choice.notes.join('\n')).toMatch(/Font: .*PingFang SC.*synthetic/);
        expect(choice.notes.join('\n')).toMatch(/Source Han Sans/);
    });

    it('still renders when no candidate is installed at all', () => {
        const choice = chooseFont('heavy', probe({}));
        expect(choice.stack.endsWith('sans-serif')).toBe(true);
        expect(choice.syntheticBold).toBeGreaterThan(0);
        expect(choice.notes.length).toBeGreaterThan(0);
    });
});

describe('choosing a display font', () => {
    it('degrades a missing brush font to the heavy font with a note', () => {
        const choice = chooseFont(
            'brush',
            probe({
                'Noto Sans CJK SC': { installed: true, covers: true, density: 0.475 },
            }),
        );
        expect(choice.cjk).toBe('Noto Sans CJK SC');
        expect(choice.degradedFrom).toBe('brush');
        expect(choice.notes.join('\n')).toMatch(/brush/);
    });

    it('uses an installed brush font without synthetic weight', () => {
        const choice = chooseFont(
            'brush',
            probe({ 'Ma Shan Zheng': { installed: true, covers: true, density: 0.22 } }),
        );
        expect(choice.cjk).toBe('Ma Shan Zheng');
        expect(choice.syntheticBold).toBe(0);
        expect(choice.degradedFrom).toBeUndefined();
    });
});
