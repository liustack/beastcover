import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { chromium } from 'playwright';
import sharp from 'sharp';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
    type CoverTemplate,
    composeCovers,
    familyClearArea,
    familyCoveredAreas,
    familyVisibleArea,
} from '../compose/index.ts';
import {
    FAMILY_NAMES,
    type FamilyName,
    getPlatform,
    PLATFORM_NAMES,
    type PlatformName,
    type Rect,
} from '../platforms/index.ts';
import { type CoverRenderer, openRenderer } from '../render/index.ts';
import { familyLayout } from '../render/layout.ts';
import type { SubjectLayer } from '../subject/index.ts';
import { faceLayout } from './face.ts';
import {
    checkGenreInputs,
    defaultGenre,
    GENRE_NAMES,
    type GenreName,
    genreTemplate,
    parseGenre,
} from './index.ts';
import { fontKit, type GenrePhoto } from './page.ts';

function inside(inner: Rect, outer: Rect): boolean {
    return (
        inner.x >= outer.x - 0.5 &&
        inner.y >= outer.y - 0.5 &&
        inner.x + inner.width <= outer.x + outer.width + 0.5 &&
        inner.y + inner.height <= outer.y + outer.height + 0.5
    );
}

function overlaps(a: Rect, b: Rect): boolean {
    return (
        a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height
    );
}

function members(family: FamilyName): PlatformName[] {
    return PLATFORM_NAMES.filter((name) => getPlatform(name).family === family);
}

/** 合成时的版式：族母版加上这一族全部平台的可见区和遮挡区 */
function framedLayout(family: FamilyName) {
    const names = members(family);
    return {
        ...familyLayout(family),
        visibleArea: familyVisibleArea(family, names),
        clearArea: familyClearArea(family, names),
        coveredAreas: familyCoveredAreas(family, names),
    };
}

// 没有任何字体探测结果：每个角色都退到系统字体加合成加粗，测的是版式，不是字体。
const FONTS = fontKit((family) => ({ family, installed: false, covers: false, density: 0 }));

const SMALL_FOCUS = { x: 0.7, y: 0.3, width: 0.08, height: 0.08, source: 'saliency' as const };

function photo(path: string): GenrePhoto {
    return { path, width: 800, height: 600, focus: SMALL_FOCUS };
}

const SUBJECT: SubjectLayer = {
    dataUri:
        'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
    width: 400,
    height: 600,
    method: 'transparent',
    bust: false,
};

function templateFor(name: GenreName, paths: readonly string[]): CoverTemplate {
    const photos = paths.map(photo);
    switch (name) {
        case 'big-type':
            return genreTemplate(name, {
                text: '三个错误*毁了*我的频道',
                fonts: FONTS,
                photos: [],
                tag: '新手必看',
            });
        case 'number':
            return genreTemplate(name, {
                text: '个习惯*救了*我',
                fonts: FONTS,
                photos: [],
                figure: '90%',
            });
        case 'face-text':
            return genreTemplate(name, {
                text: '我看*傻*了',
                fonts: FONTS,
                photos: [],
                subject: SUBJECT,
            });
        case 'face-stakes':
            return genreTemplate(name, {
                text: '在火山口住了一晚',
                fonts: FONTS,
                photos: photos.slice(0, 1),
                subject: SUBJECT,
                figure: '$10,000',
            });
        case 'versus':
        case 'before-after':
            return genreTemplate(name, {
                text: '15元和150元的拉面',
                fonts: FONTS,
                photos: photos.slice(0, 2),
                labels: ['¥15', '¥150'],
            });
        case 'collage':
            return genreTemplate(name, {
                text: '东京吃了*7天*',
                fonts: FONTS,
                photos: photos.slice(0, 3),
            });
        default:
            return genreTemplate(name, {
                text: '离岩浆*50米*',
                fonts: FONTS,
                photos: photos.slice(0, 1),
            });
    }
}

describe('cover type registry', () => {
    it('points the retired template names at their replacements', () => {
        expect(() => parseGenre('poster')).toThrow('Use --template big-type.');
        expect(() => parseGenre('text')).toThrow('Use --template big-type.');
        expect(() => parseGenre('compare')).toThrow('Use --template before-after.');
        expect(() => parseGenre('banner')).toThrow('Unknown template "banner"');
        expect(GENRE_NAMES.map(parseGenre)).toEqual([...GENRE_NAMES]);
    });

    it('picks the type from the inputs', () => {
        expect(defaultGenre({ photos: 0, subject: false })).toBe('big-type');
        expect(defaultGenre({ photos: 0, subject: true })).toBe('face-text');
        expect(defaultGenre({ photos: 1, subject: true })).toBe('face-stakes');
        expect(defaultGenre({ photos: 1, subject: false })).toBe('scene-title');
        expect(defaultGenre({ photos: 2, subject: false })).toBe('before-after');
        expect(defaultGenre({ photos: 4, subject: false })).toBe('collage');
    });

    it('accepts what each type needs and refuses the rest', () => {
        expect(() =>
            checkGenreInputs('versus', { photos: 2, subject: false, options: { labels: 'a,b' } }),
        ).not.toThrow();
        expect(() =>
            checkGenreInputs('collage', { photos: 5, subject: false, options: {} }),
        ).toThrow('--template collage needs 2 to 4 --photo images. It got 5.');
        expect(() =>
            checkGenreInputs('big-type', { photos: 1, subject: false, options: {} }),
        ).toThrow('--template big-type takes no photo.');
        expect(() =>
            checkGenreInputs('mood', { photos: 1, subject: false, options: { tag: 'x' } }),
        ).toThrow('--tag works with --template big-type, number, face-text.');
    });
});

describe('cover type geometry', () => {
    it('keeps every headline and figure area inside each platform crop and clear of the app UI', () => {
        const paths = ['/a.png', '/b.png', '/c.png'];
        for (const name of GENRE_NAMES) {
            const template = templateFor(name, paths);
            for (const family of FAMILY_NAMES) {
                const framed = framedLayout(family);
                const layouts = [template.layoutFor, ...(template.placements ?? [])].map(
                    (place) => ({
                        ...(place?.(framed) ?? framed),
                    }),
                );
                for (const layout of layouts) {
                    const areas = [
                        layout.textArea,
                        ...(layout.accentArea ? [layout.accentArea] : []),
                    ];
                    for (const platform of members(family).map(getPlatform)) {
                        for (const area of areas) {
                            const where = `${name} on ${platform.name}`;
                            expect(inside(area, platform.crop), where).toBe(true);
                            for (const covered of platform.covered) {
                                expect(overlaps(area, covered), where).toBe(false);
                            }
                        }
                    }
                }
            }
        }
    });

    it('leaves a gap between the headline and the person on every family', () => {
        for (const family of FAMILY_NAMES) {
            const layout = faceLayout(framedLayout(family));
            const subject = layout.subjectArea as Rect;
            const gap = Math.min(layout.width, layout.height) * 0.03 - 1;
            const text = layout.textArea;
            const apart =
                subject.y >= text.y + text.height
                    ? subject.y - (text.y + text.height)
                    : subject.x - (text.x + text.width);
            expect(apart, family).toBeGreaterThanOrEqual(gap);
        }
    });
});

describe('cover type rendering', () => {
    let renderer: CoverRenderer;
    let directory: string;
    let paths: string[];

    beforeAll(async () => {
        renderer = await openRenderer();
        directory = mkdtempSync(join(tmpdir(), 'beastcover-genres-'));
        paths = [];
        for (const [index, color] of [
            [0, { r: 200, g: 120, b: 60 }],
            [1, { r: 60, g: 140, b: 200 }],
            [2, { r: 90, g: 180, b: 90 }],
        ] as const) {
            const path = join(directory, `photo-${index}.png`);
            await sharp({ create: { width: 800, height: 600, channels: 3, background: color } })
                .png()
                .toFile(path);
            paths.push(path);
        }
    });

    afterAll(async () => {
        await renderer.close();
        rmSync(directory, { recursive: true, force: true });
    });

    // 量字号的页面和截图的页面是两份 HTML，任何一处排法不一致（标签、倾斜、照片层），
    // 截图里的标题就会跑出标题区。这里拿真 Chromium 渲出成品页面，量标题的实际外框。
    it('keeps the rendered headline inside its text area for every type and family', async () => {
        const browser = await chromium.launch({ headless: true });
        try {
            for (const name of GENRE_NAMES) {
                const template = templateFor(name, paths);
                const pages: { html: string; width: number; height: number }[] = [];
                const recording: CoverRenderer = {
                    ...renderer,
                    screenshot: async (page) => {
                        pages.push(page);
                        return renderer.screenshot(page);
                    },
                };
                const targets = (['youtube', 'xiaohongshu', 'x'] as const).map((platform) => ({
                    platform,
                    outputPath: join(directory, `${name}-${platform}.png`),
                }));
                await composeCovers({
                    renderer: recording,
                    template,
                    text: 'unused',
                    targets,
                    scale: 1,
                });
                expect(pages, name).toHaveLength(3);
                for (const [index, family] of (
                    ['landscape', 'portrait', 'ultrawide'] as const
                ).entries()) {
                    const recorded = pages[index] as {
                        html: string;
                        width: number;
                        height: number;
                    };
                    const names = [targets[index]?.platform as PlatformName];
                    const framed = {
                        ...familyLayout(family),
                        visibleArea: familyVisibleArea(family, names),
                        clearArea: familyClearArea(family, names),
                        coveredAreas: familyCoveredAreas(family, names),
                    };
                    const area = (template.layoutFor?.(framed) ?? framed).textArea;
                    const page = await browser.newPage({
                        viewport: { width: recorded.width, height: recorded.height },
                    });
                    await page.setContent(recorded.html, { waitUntil: 'load' });
                    const box = await page.locator('.copy:not(.probe)').boundingBox();
                    await page.close();
                    expect(box, `${name} ${family}`).not.toBeNull();
                    expect(
                        inside(box as Rect, {
                            x: area.x - 1,
                            y: area.y - 1,
                            width: area.width + 2,
                            height: area.height + 2,
                        }),
                        `${name} ${family}: ${JSON.stringify(box)} in ${JSON.stringify(area)}`,
                    ).toBe(true);
                }
            }
        } finally {
            await browser.close();
        }
    }, 240_000);

    it('escapes the headline and labels instead of running them as markup', () => {
        const template = genreTemplate('versus', {
            text: '<img src=x onerror=alert(1)>',
            fonts: FONTS,
            photos: [photo('/a.png'), photo('/b.png')],
            labels: ['<b>', '"q"'],
        });
        const html = template.measureHtml(
            {
                ...framedLayout('landscape'),
                ...(template.layoutFor?.(framedLayout('landscape')) ?? {}),
            },
            { fontPx: 40, keepClauses: false },
        );
        expect(html).not.toContain('<img src=x');
        expect(html).toContain('&lt;img src=x onerror=alert(');
    });
});
