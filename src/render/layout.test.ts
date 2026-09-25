import { describe, expect, it } from 'vitest';
import {
    FAMILY_NAMES,
    getFamily,
    getPlatform,
    PLATFORM_NAMES,
    type Rect,
} from '../platforms/index.ts';
import {
    customLayout,
    familyLayout,
    headlineClauses,
    unbreakableRuns,
    withSubjectArea,
} from './layout.ts';

function inside(inner: Rect, outer: Rect): boolean {
    return (
        inner.x >= outer.x &&
        inner.y >= outer.y &&
        inner.x + inner.width <= outer.x + outer.width &&
        inner.y + inner.height <= outer.y + outer.height
    );
}

function overlaps(a: Rect, b: Rect): boolean {
    return (
        a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height
    );
}

describe('subject layouts', () => {
    it('keeps the headline inside the family text area and clear of the subject', () => {
        for (const name of FAMILY_NAMES) {
            const family = getFamily(name);
            const layout = withSubjectArea(familyLayout(name));
            const subject = layout.subjectArea as Rect;
            expect(inside(layout.textArea, family.textArea), name).toBe(true);
            expect(overlaps(layout.textArea, subject), name).toBe(false);
            expect(
                inside(subject, {
                    x: 0,
                    y: 0,
                    width: family.masterWidth,
                    height: family.masterHeight,
                }),
                name,
            ).toBe(true);
            // 人物贴着母版底边站。
            expect(subject.y + subject.height, name).toBe(family.masterHeight);
        }
    });

    it('keeps the subject horizontally inside every crop of its family', () => {
        for (const preset of PLATFORM_NAMES) {
            const platform = getPlatform(preset);
            const subject = withSubjectArea(familyLayout(platform.family)).subjectArea as Rect;
            expect(subject.x, preset).toBeGreaterThanOrEqual(platform.crop.x);
            expect(subject.x + subject.width, preset).toBeLessThanOrEqual(
                platform.crop.x + platform.crop.width,
            );
        }
    });

    it('splits a custom canvas beside or below the headline without overlap', () => {
        for (const [width, height] of [
            [1600, 900],
            [900, 1600],
        ] as const) {
            const layout = withSubjectArea(customLayout(width, height));
            const subject = layout.subjectArea as Rect;
            expect(overlaps(layout.textArea, subject), `${width}x${height}`).toBe(false);
            expect(subject.y + subject.height).toBe(height);
            expect(subject.x + subject.width).toBeLessThanOrEqual(width);
        }
    });
});

describe('headline runs', () => {
    it('protects Latin words and splits clauses after punctuation', () => {
        expect(unbreakableRuns('人接不住 the beast 流量')).toEqual(['the', 'beast']);
        // 中文紧挨着英文、全角标点紧挨着英文，英文单词也要整个保护起来。
        expect(unbreakableRuns('试试Supercalifragilisticexpialidocious')).toEqual([
            'Supercalifragilisticexpialidocious',
        ]);
        expect(unbreakableRuns('用GPT-5写，Claude审')).toEqual(['GPT-5', 'Claude']);
        expect(unbreakableRuns("don't stop，别停")).toEqual(["don't", 'stop']);
        expect(headlineClauses('人接不住认知以外的流量，也赚不到认知以外的钱')).toEqual([
            '人接不住认知以外的流量，',
            '也赚不到认知以外的钱',
        ]);
        expect(headlineClauses('Wait, what?')).toEqual(['Wait,', 'what?']);
    });
});
