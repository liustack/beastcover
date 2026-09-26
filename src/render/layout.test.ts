import { describe, expect, it } from 'vitest';
import {
    FAMILY_NAMES,
    getFamily,
    getPlatform,
    PLATFORM_NAMES,
    type Rect,
} from '../platforms/index.ts';
import {
    chineseWords,
    customLayout,
    familyLayout,
    headlineClauses,
    headlineMarkup,
    placeSubject,
    subjectRect,
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

describe('subject placement', () => {
    const area = { x: 86, y: 864, width: 842, height: 1056 };
    // 小红书看得到 y 240 到 1680，抖音底部 380px 被界面挡住：无遮挡区到 1540 为止。
    const clear = { x: 0, y: 240, width: 1080, height: 1300 };

    it('stands a tall subject on the bottom edge of its area', () => {
        const rect = subjectRect(area, clear, 500, 1000);
        expect(rect.y + rect.height).toBe(area.y + area.height);
        expect(rect.height).toBe(area.height);
    });

    it('centres a wide subject in the part of its area nothing covers', () => {
        // 600x120 的扁物体：按宽度放满 842，高 168，放在 864 到 1540 之间的正中。
        const rect = subjectRect(area, clear, 600, 120);
        expect(rect.width).toBe(842);
        expect(rect.height).toBe(168);
        expect(rect.y).toBe(Math.round(864 + (1540 - 864 - 168) / 2));
        expect(rect.y + rect.height).toBeLessThanOrEqual(1540);
    });

    it('stands a head-and-shoulders crop on the bottom edge even when it is wide', () => {
        // 抖音底部 380px 被界面挡住。
        const clear = { x: 0, y: 0, width: 1080, height: 1540 };
        const wide = subjectRect(area, clear, 600, 120);
        const bust = subjectRect(area, clear, 600, 120, true);
        expect(wide.y + wide.height).toBeLessThan(area.y + area.height);
        expect(bust.y + bust.height).toBe(area.y + area.height);
    });

    it('falls back to the bottom edge when nothing is known about covered areas', () => {
        const rect = subjectRect(area, undefined, 600, 120);
        expect(rect.y + rect.height).toBe(area.y + area.height);
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
        // 带重音和附加符号的西文、希腊文、西里尔文也是整词。
        expect(unbreakableRuns('électroencéphalographiquement')).toEqual([
            'électroencéphalographiquement',
        ]);
        expect(unbreakableRuns('试试naïve和Straße')).toEqual(['naïve', 'Straße']);
        expect(unbreakableRuns('Привет мир，你好')).toEqual(['Привет', 'мир']);
        // 组合附加符号（e + U+0301）不能把单词切开。
        expect(unbreakableRuns('cafe\u0301 au lait')).toEqual(['cafe\u0301', 'au', 'lait']);
        expect(headlineClauses('人接不住认知以外的流量，也赚不到认知以外的钱')).toEqual([
            '人接不住认知以外的流量，',
            '也赚不到认知以外的钱',
        ]);
        expect(headlineClauses('Wait, what?')).toEqual(['Wait,', 'what?']);
    });

    it('finds Chinese words of two or more characters and keeps them on one line', () => {
        expect(chineseWords('封面不抓人，标题白写')).toEqual(['封面', '抓人', '标题']);
        // 单字、标点和西文不算中文词，西文另有自己的探针。
        expect(chineseWords('用AI三天做完一个App')).toEqual(['三天', '做完', '一个']);
        expect(chineseWords('Get it')).toEqual([]);
        expect(headlineMarkup('封面不抓人', { fontPx: 10, keepClauses: false })).toBe(
            '<span class="word">封面</span>不<span class="word">抓人</span>',
        );
        expect(headlineMarkup('标题<封面>，再说', { fontPx: 10, keepClauses: true })).toBe(
            '<span class="clause"><span class="word">标题</span>&lt;<span class="word">封面</span>&gt;，</span><span class="clause"><span class="word">再说</span></span>',
        );
    });
});

describe('subject sized by the face', () => {
    it('grows a wide person until the face is about a third of the clear height', () => {
        const layout = {
            ...withSubjectArea(familyLayout('landscape')),
            visibleArea: { x: 0, y: 60, width: 1920, height: 1080 },
            clearArea: { x: 0, y: 60, width: 1920, height: 996 },
        };
        const area = layout.subjectArea as Rect;
        // 张开双臂的半身照：比人物区宽，脸在上面偏中。
        const subject = {
            width: 1600,
            height: 1000,
            bust: true,
            face: { x: 0.5, y: 0.25, width: 0.16, height: 0.28 },
        };
        const rect = placeSubject(layout, subject);
        const { face: _face, ...faceless } = subject;
        const before = placeSubject(layout, faceless);
        // 左边不能越过人物区，脸又要留在可见区里，这张图放到脸高约 23% 为止。
        expect((subject.face.height * rect.height) / 996).toBeGreaterThan(0.2);
        expect(rect.height).toBeGreaterThan(before.height * 1.5);
        // 贴底站，不越过朝向标题的那条边，脸在可见区里。
        expect(rect.y + rect.height).toBe(area.y + area.height);
        expect(rect.x).toBeGreaterThanOrEqual(area.x);
        const faceRight = rect.x + (subject.face.x + subject.face.width / 2) * rect.width;
        expect(faceRight).toBeLessThanOrEqual(1920);
        // 没有脸时照原来的办法摆，不放大。
        expect(before.width).toBeLessThanOrEqual(area.width);
    });
});
