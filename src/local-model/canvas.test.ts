import { describe, expect, it } from 'vitest';
import { getLocalModelCanvasPlan } from './index.ts';

describe('local-model canvas plans', () => {
    it('returns the frozen 3:2 generate, crop, and output sizes', () => {
        const plan = getLocalModelCanvasPlan('3:2');
        expect(plan.preset).toBe('3:2');
        expect(plan.generateWidth).toBe(1536);
        expect(plan.generateHeight).toBe(1024);
        expect(plan.cropWidth).toBe(1536);
        expect(plan.cropHeight).toBe(1024);
        expect(plan.cropLeft).toBe(0);
        expect(plan.cropTop).toBe(0);
        expect(plan.outputWidth).toBe(1536);
        expect(plan.outputHeight).toBe(1024);
        expect(plan.subjectSuffix).toBeUndefined();
    });

    it('returns the frozen 16:9 generate, crop, and output sizes', () => {
        const plan = getLocalModelCanvasPlan('16:9');
        expect(plan.preset).toBe('16:9');
        expect(plan.generateWidth).toBe(1536);
        expect(plan.generateHeight).toBe(1024);
        expect(plan.cropWidth).toBe(1536);
        expect(plan.cropHeight).toBe(864);
        expect(plan.cropLeft).toBe(0);
        expect(plan.cropTop).toBe(80);
        expect(plan.outputWidth).toBe(1600);
        expect(plan.outputHeight).toBe(900);
        expect(plan.subjectSuffix).toBeUndefined();
    });

    it('returns the frozen 5:2 generate, crop, output sizes, and subject suffix', () => {
        const plan = getLocalModelCanvasPlan('5:2');
        expect(plan.preset).toBe('5:2');
        expect(plan.generateWidth).toBe(1536);
        expect(plan.generateHeight).toBe(1024);
        expect(plan.cropWidth).toBe(1536);
        expect(plan.cropHeight).toBe(614);
        expect(plan.cropLeft).toBe(0);
        expect(plan.cropTop).toBe(205);
        expect(plan.outputWidth).toBe(1600);
        expect(plan.outputHeight).toBe(640);
        expect(plan.subjectSuffix).toBe('构图集中在中带、上下留纸');
    });

    it('returns the frozen 3:4 generate, crop, and output sizes', () => {
        const plan = getLocalModelCanvasPlan('3:4');
        expect(plan.preset).toBe('3:4');
        expect(plan.generateWidth).toBe(1024);
        expect(plan.generateHeight).toBe(1536);
        expect(plan.cropWidth).toBe(1024);
        expect(plan.cropHeight).toBe(1365);
        expect(plan.cropLeft).toBe(0);
        expect(plan.cropTop).toBe(85);
        expect(plan.outputWidth).toBe(1242);
        expect(plan.outputHeight).toBe(1656);
        expect(plan.subjectSuffix).toBeUndefined();
    });

    it('reuses the unknown preset error from getDimensionPreset', () => {
        expect(() => getLocalModelCanvasPlan('nope' as never)).toThrow(/Unknown dimension preset/);
    });

    it('returns a shallow copy so callers cannot mutate the table', () => {
        const plan = getLocalModelCanvasPlan('16:9');
        plan.cropTop = 0;
        plan.outputWidth = 1;
        expect(getLocalModelCanvasPlan('16:9').cropTop).toBe(80);
        expect(getLocalModelCanvasPlan('16:9').outputWidth).toBe(1600);
    });
});
