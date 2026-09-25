import { describe, expect, it } from 'vitest';
import { getDimensionPreset, listDimensionPresets } from './dimensions.ts';

describe('dimension presets', () => {
    it('exposes the four artwork ratios at their production pixel sizes', () => {
        expect(listDimensionPresets()).toEqual([
            { name: '16:9', width: 1600, height: 900, use: 'article cover' },
            { name: '5:2', width: 1600, height: 640, use: 'social cover or section break' },
            { name: '3:2', width: 1536, height: 1024, use: 'article illustration' },
            { name: '3:4', width: 1242, height: 1656, use: 'vertical social cover' },
        ]);
        expect(getDimensionPreset('3:2')).toEqual({
            name: '3:2',
            width: 1536,
            height: 1024,
            use: 'article illustration',
        });
    });
});
