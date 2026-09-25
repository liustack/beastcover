import { chromium, type Page } from 'playwright';
import { describe, expect, it } from 'vitest';
import { panelVisibility } from '../compose/templates.ts';
import {
    FAMILY_NAMES,
    getFamily,
    getPlatform,
    PLATFORM_NAMES,
    type Rect,
} from '../platforms/index.ts';
import { compareLayout, createCompareTemplate, parseLabels } from './compare.ts';
import { openRenderer } from './index.ts';
import { customLayout, familyLayout, withSubjectArea } from './layout.ts';
import { createNumberTemplate, numberLayout, validateNumber } from './number.ts';
import { createPosterTemplate, validateTag } from './poster.ts';
import { contrastingText } from './template.ts';

function inside(inner: Rect, outer: Rect, slack = 0.5): boolean {
    return (
        inner.x >= outer.x - slack &&
        inner.y >= outer.y - slack &&
        inner.x + inner.width <= outer.x + outer.width + slack &&
        inner.y + inner.height <= outer.y + outer.height + slack
    );
}

function overlaps(a: Rect, b: Rect): boolean {
    return (
        a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height
    );
}

const photo = { dataUri: 'data:image/jpeg;base64,AAAA', sourceWidth: 1, sourceHeight: 1 };

describe('big text templates in every family', () => {
    it('keeps the headline, tag, and figure inside their fitted areas', async () => {
        const renderer = await openRenderer();
        const browser = await chromium.launch({ headless: true });
        const fitIn = (
            layout: { width: number; height: number },
            box: Rect,
            html: (px: number) => string,
        ) =>
            renderer.fitText({
                html,
                width: layout.width,
                height: layout.height,
                box,
                minPx: 16,
                maxPx: 900,
            });

        try {
            for (const familyName of FAMILY_NAMES) {
                const page = await browser.newPage({
                    viewport: {
                        width: getFamily(familyName).masterWidth,
                        height: getFamily(familyName).masterHeight,
                    },
                });

                // 大字报：标签在标题段落里，一起量、一起放进标题区。
                const poster = familyLayout(familyName);
                const posterText = '月薪三千到三万，我只做对了一件事';
                const posterPx = await fitIn(poster, poster.textArea, (px) =>
                    createPosterTemplate(posterText, {
                        layout: poster,
                        headline: { fontPx: px, keepClauses: false },
                        tag: '新手必看',
                        measure: true,
                    }),
                );
                await page.setContent(
                    createPosterTemplate(posterText, {
                        layout: poster,
                        headline: { fontPx: posterPx, keepClauses: false },
                        tag: '新手必看',
                    }),
                );
                const posterBox = await page.locator('.copy').boundingBox();
                const tagBox = await page.locator('.tag').boundingBox();
                expect(inside(posterBox as Rect, poster.textArea), `${familyName} poster`).toBe(
                    true,
                );
                expect(inside(tagBox as Rect, poster.textArea), `${familyName} tag`).toBe(true);

                // 数字钩子：数字和短话各量各的，各在各的区域里，互不重叠。
                const numbered = numberLayout(familyLayout(familyName));
                const accent = numbered.accentArea as Rect;
                expect(overlaps(accent, numbered.textArea), familyName).toBe(false);
                const figurePx = await fitIn(numbered, accent, (px) =>
                    createNumberTemplate('x', {
                        layout: numbered,
                        figure: '90%',
                        headline: { fontPx: px, keepClauses: false },
                        measure: 'figure',
                    }),
                );
                const wordsPx = await fitIn(numbered, numbered.textArea, (px) =>
                    createNumberTemplate('个习惯让我每天多出两小时', {
                        layout: numbered,
                        figure: '90%',
                        headline: { fontPx: px, keepClauses: false },
                        measure: 'headline',
                    }),
                );
                await page.setContent(
                    createNumberTemplate('个习惯让我每天多出两小时', {
                        layout: numbered,
                        figure: '90%',
                        headline: { fontPx: wordsPx, keepClauses: false, accentPx: figurePx },
                    }),
                );
                const figureBox = await page.locator('.figure').boundingBox();
                const wordsBox = await page.locator('.copy').boundingBox();
                expect(inside(figureBox as Rect, accent), `${familyName} figure`).toBe(true);
                expect(inside(wordsBox as Rect, numbered.textArea), `${familyName} words`).toBe(
                    true,
                );

                // 前后对比：标题带在族的安全区内，标签和箭头也在。
                const compared = compareLayout(familyLayout(familyName));
                const comparePx = await fitIn(compared, compared.textArea, (px) =>
                    createCompareTemplate('三个月后，墙变成了这样', {
                        layout: compared,
                        headline: { fontPx: px, keepClauses: false },
                        labels: ['之前', '之后'],
                        measure: true,
                    }),
                );
                await page.setContent(
                    createCompareTemplate('三个月后，墙变成了这样', {
                        layout: compared,
                        headline: { fontPx: comparePx, keepClauses: false },
                        labels: ['之前', '之后'],
                        images: [photo, photo],
                    }),
                );
                const family = getFamily(familyName);
                for (const selector of ['.copy', '.label-a', '.label-b', '.arrow']) {
                    const box = (await page.locator(selector).boundingBox()) as Rect;
                    if (selector === '.copy') {
                        expect(inside(box, compared.textArea), `${familyName} band`).toBe(true);
                        expect(inside(box, family.textArea), `${familyName} safe`).toBe(true);
                    }
                    for (const preset of PLATFORM_NAMES.filter(
                        (name) => getPlatform(name).family === familyName,
                    )) {
                        const platform = getPlatform(preset);
                        expect(inside(box, platform.crop), `${preset} ${selector}`).toBe(true);
                        for (const covered of platform.covered) {
                            expect(overlaps(box, covered), `${preset} ${selector} covered`).toBe(
                                false,
                            );
                        }
                    }
                }
                await page.close();
            }
        } finally {
            await browser.close();
            await renderer.close();
        }
    }, 180_000);
});

/** 标题里每个字所在行的顶边，跳过标签，顺序和标题原文一致。tsconfig 不带 DOM 类型，脚本写成字符串 */
const CHAR_TOPS_SCRIPT = `(() => {
    const copy = document.querySelector('.copy:not(.probe)');
    const walker = document.createTreeWalker(copy, NodeFilter.SHOW_TEXT);
    let text = '';
    const tops = [];
    for (let node = walker.nextNode(); node !== null; node = walker.nextNode()) {
        if (node.parentElement.closest('.tag') !== null) continue;
        const value = node.textContent;
        for (let index = 0; index < value.length; index += 1) {
            const range = document.createRange();
            range.setStart(node, index);
            range.setEnd(node, index + 1);
            text += value[index];
            tops.push(Math.round(range.getBoundingClientRect().top));
        }
    }
    return { text, tops };
})()`;

function charTops(page: Page): Promise<{ text: string; tops: number[] }> {
    return page.evaluate(CHAR_TOPS_SCRIPT);
}

describe('Chinese headline line breaks', () => {
    it('never splits a Chinese word across two lines', async () => {
        const renderer = await openRenderer();
        const browser = await chromium.launch({ headless: true });
        const cases = [
            { text: '封面不抓人，标题白写', words: ['封面', '抓人', '标题'] },
            { text: '月薪三千到三万，我只做对了一件事', words: ['月薪', '三千', '三万', '一件事'] },
        ];
        try {
            // 带人物时标题区只有半幅宽，最容易把词拆开。
            for (const layout of FAMILY_NAMES.flatMap((name) => [
                familyLayout(name),
                withSubjectArea(familyLayout(name)),
            ])) {
                const familyName = `${layout.family} ${layout.textArea.width}`;
                const page = await browser.newPage({
                    viewport: { width: layout.width, height: layout.height },
                });
                for (const { text, words } of cases) {
                    for (const keepClauses of [false, true]) {
                        const fontPx = await renderer.fitText({
                            html: (px) =>
                                createPosterTemplate(text, {
                                    layout,
                                    headline: { fontPx: px, keepClauses },
                                    tag: 'BeastCover',
                                    measure: true,
                                }),
                            width: layout.width,
                            height: layout.height,
                            box: layout.textArea,
                            minPx: 16,
                            maxPx: 900,
                        });
                        await page.setContent(
                            createPosterTemplate(text, {
                                layout,
                                headline: { fontPx, keepClauses },
                                tag: 'BeastCover',
                            }),
                        );
                        const lines = await charTops(page);
                        expect(lines.text).toBe(text);
                        for (const word of words) {
                            const start = lines.text.indexOf(word);
                            const tops = new Set(lines.tops.slice(start, start + word.length));
                            expect(tops.size, `${familyName} ${keepClauses} ${text} ${word}`).toBe(
                                1,
                            );
                        }
                    }
                }
                await page.close();
            }
        } finally {
            await browser.close();
            await renderer.close();
        }
    }, 180_000);
});

describe('template layouts', () => {
    it('splits the number template side by side on wide areas and stacked on tall ones', () => {
        const wide = numberLayout(familyLayout('landscape'));
        expect(wide.accentArea?.y).toBe(wide.textArea.y);
        const tall = numberLayout(familyLayout('portrait'));
        expect(tall.accentArea?.x).toBe(tall.textArea.x);
        expect((tall.accentArea as Rect).y + (tall.accentArea as Rect).height).toBeLessThan(
            tall.textArea.y,
        );
    });

    it('knows which part of each compare panel the requested platforms show', () => {
        const { panels } = compareLayout(familyLayout('ultrawide'));
        const wechat = getPlatform('wechat').crop;
        // 公众号只看得到左半的右边 432px 和右半的左边 433px。
        const left = panelVisibility(panels.first, wechat);
        const right = panelVisibility(panels.second, wechat);
        expect(left.x).toBeCloseTo(528 / 960, 3);
        expect(left.width).toBeCloseTo(432 / 960, 3);
        expect(right.x).toBe(0);
        expect(right.width).toBeCloseTo(433 / 960, 3);
        expect(() =>
            panelVisibility(panels.first, { x: 1000, y: 0, width: 100, height: 100 }),
        ).toThrowError('A compare panel has no visible part on the requested platforms.');
    });

    it('splits compare covers at the master centre and is safe to apply twice', () => {
        for (const familyName of FAMILY_NAMES) {
            const family = getFamily(familyName);
            const layout = compareLayout(familyLayout(familyName));
            const { panels } = layout;
            if (panels.split === 'columns') {
                expect(panels.second.x, familyName).toBe(family.masterWidth / 2);
            } else {
                expect(panels.second.y, familyName).toBe(family.masterHeight / 2);
            }
            expect(compareLayout(layout)).toBe(layout);
        }
        const custom = compareLayout(customLayout(1600, 900));
        expect(compareLayout(custom).textArea).toEqual(custom.textArea);
    });
});

describe('template options', () => {
    it('keeps tags, figures, and labels short', () => {
        expect(validateTag(' 新手必看 ')).toBe('新手必看');
        expect(() => validateTag('这是一个特别特别特别特别特别长的标签')).toThrowError(
            '--tag is longer than 16 characters. Keep it to a few words.',
        );
        expect(validateNumber('90%')).toBe('90%');
        expect(() => validateNumber('1234567')).toThrowError(/longer than 6 characters/);
        expect(parseLabels('Before, After')).toEqual(['Before', 'After']);
        expect(() => parseLabels('Before')).toThrowError(/two labels/);
        expect(() => parseLabels('一二三四五六七八九,后')).toThrowError(/8 characters or fewer/);
    });

    it('picks black or white text from the background lightness in CSS', () => {
        expect(contrastingText('var(--cover-accent)')).toBe(
            'oklch(from var(--cover-accent) clamp(0.18, (0.62 - l) * 1000, 1) 0 0)',
        );
    });
});
