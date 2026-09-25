import { describe, expect, it } from 'vitest';
import { getPlatform, PLATFORM_NAMES } from '../platforms/index.ts';
import { getLocalModelCanvasPlan, getLocalModelGeneratePlan } from './index.ts';

describe('local-model canvas plans', () => {
    it('freezes the generate, crop, and output sizes per platform', () => {
        const rows = PLATFORM_NAMES.map((preset) => {
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
            ['x', '1536x1024', '1536x614+0+205', '1600x640'],
            ['xiaohongshu', '1024x1536', '1024x1365+0+85', '1080x1440'],
            ['instagram', '1024x1536', '1024x1365+0+85', '1080x1440'],
            ['instagram-reels', '1024x1536', '864x1536+80+0', '1080x1920'],
            ['douyin', '1024x1536', '864x1536+80+0', '1080x1920'],
            ['tiktok', '1024x1536', '864x1536+80+0', '1080x1920'],
            ['og', '1536x1024', '1536x806+0+109', '1200x630'],
            ['github', '1536x1024', '1536x768+0+128', '1280x640'],
        ]);
    });

    it('centres every crop and matches the production preset size and ratio', () => {
        for (const preset of PLATFORM_NAMES) {
            const plan = getLocalModelCanvasPlan(preset);
            const production = getPlatform(preset);
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

    it('generates once per family at the native size, with a composition hint for narrow crops', () => {
        expect(getLocalModelGeneratePlan('landscape')).toEqual({
            family: 'landscape',
            generateWidth: 1536,
            generateHeight: 1024,
        });
        expect(getLocalModelGeneratePlan('ultrawide')).toEqual({
            family: 'ultrawide',
            generateWidth: 1536,
            generateHeight: 1024,
            subjectSuffix: '主体集中在画面正中，上下边缘和左右两侧只放背景',
        });
        expect(getLocalModelGeneratePlan('portrait')).toEqual({
            family: 'portrait',
            generateWidth: 1024,
            generateHeight: 1536,
            subjectSuffix: '主体集中在画面中部，顶部和底部只放背景',
        });
    });

    it('crops each platform from the generate size of its own family', () => {
        for (const preset of PLATFORM_NAMES) {
            const plan = getLocalModelCanvasPlan(preset);
            const generate = getLocalModelGeneratePlan(plan.family);
            expect(plan.family, preset).toBe(getPlatform(preset).family);
            expect([plan.generateWidth, plan.generateHeight], preset).toEqual([
                generate.generateWidth,
                generate.generateHeight,
            ]);
        }
    });

    it('reuses the preset error from getPlatform', () => {
        expect(() => getLocalModelCanvasPlan('nope' as never)).toThrow(/Unknown platform preset/);
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
