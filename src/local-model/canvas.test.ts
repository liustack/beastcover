import { describe, expect, it } from 'vitest';
import { DIMENSION_PRESET_NAMES, getDimensionPreset } from '../dimensions.ts';
import { getLocalModelCanvasPlan } from './index.ts';

describe('local-model canvas plans', () => {
    it('freezes the generate, crop, and output sizes per platform', () => {
        const rows = DIMENSION_PRESET_NAMES.map((preset) => {
            const plan = getLocalModelCanvasPlan(preset);
            return [
                preset,
                `${plan.generateWidth}x${plan.generateHeight}`,
                `${plan.cropWidth}x${plan.cropHeight}+${plan.cropLeft}+${plan.cropTop}`,
                `${plan.outputWidth}x${plan.outputHeight}`,
            ];
        });
        expect(rows).toEqual([
            ['youtube', '1536x1024', '1536x864+0+80', '1280x720'],
            ['bilibili', '1536x1024', '1536x961+0+31', '1146x717'],
            ['wechat', '1536x1024', '1536x654+0+185', '900x383'],
            ['x', '1536x1024', '1536x294+0+365', '1920x368'],
            ['xiaohongshu', '1024x1536', '1024x1365+0+85', '1080x1440'],
            ['instagram', '1024x1536', '1024x1365+0+85', '1080x1440'],
            ['instagram-reels', '1024x1536', '864x1536+80+0', '1080x1920'],
            ['douyin', '1024x1536', '864x1536+80+0', '1080x1920'],
            ['tiktok', '1024x1536', '864x1536+80+0', '1080x1920'],
        ]);
    });

    it('centres every crop and matches the production preset size and ratio', () => {
        for (const preset of DIMENSION_PRESET_NAMES) {
            const plan = getLocalModelCanvasPlan(preset);
            const production = getDimensionPreset(preset);
            expect(plan.preset, preset).toBe(preset);
            expect([plan.outputWidth, plan.outputHeight], preset).toEqual([
                production.width,
                production.height,
            ]);
            expect(
                Math.abs(plan.generateWidth - plan.cropWidth - 2 * plan.cropLeft),
                preset,
            ).toBeLessThanOrEqual(1);
            expect(
                Math.abs(plan.generateHeight - plan.cropHeight - 2 * plan.cropTop),
                preset,
            ).toBeLessThanOrEqual(1);
            const ratioDrift =
                plan.cropWidth / plan.cropHeight / (production.width / production.height) - 1;
            expect(Math.abs(ratioDrift), preset).toBeLessThan(0.005);
        }
    });

    it('asks the model to keep the subject inside the narrow wechat and x crops', () => {
        expect(getLocalModelCanvasPlan('wechat').subjectSuffix).toBe(
            '主体集中在画面正中，四周只放背景',
        );
        expect(getLocalModelCanvasPlan('x').subjectSuffix).toBe(
            '主体集中在画面中间的窄横带内，上下只放背景',
        );
        const withSuffix = DIMENSION_PRESET_NAMES.filter(
            (preset) => getLocalModelCanvasPlan(preset).subjectSuffix !== undefined,
        );
        expect(withSuffix).toEqual(['wechat', 'x']);
    });

    it('reuses the preset error from getDimensionPreset', () => {
        expect(() => getLocalModelCanvasPlan('nope' as never)).toThrow(/Unknown dimension preset/);
        expect(() => getLocalModelCanvasPlan('16:9' as never)).toThrowError(
            'Preset "16:9" is now "youtube".',
        );
    });

    it('returns a shallow copy so callers cannot mutate the table', () => {
        const plan = getLocalModelCanvasPlan('youtube');
        plan.cropTop = 0;
        plan.outputWidth = 1;
        expect(getLocalModelCanvasPlan('youtube').cropTop).toBe(80);
        expect(getLocalModelCanvasPlan('youtube').outputWidth).toBe(1280);
    });
});
