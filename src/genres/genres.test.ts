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
import { faceLayout, litSubject } from './face.ts';
import {
    checkGenreInputs,
    defaultGenre,
    GENRE_NAMES,
    type GenreName,
    genreTemplate,
    parseGenre,
} from './index.ts';
import { fontKit, type GenrePhoto, localScrim } from './page.ts';
import { isLightScheme, SCHEME_NAMES, SCHEMES } from './schemes.ts';
import { splitLabelRects } from './split.ts';
import { parseStyle, STYLE_NAMES, type StyleName, styledType } from './styles.ts';

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

function templateFor(name: GenreName, paths: readonly string[], style?: StyleName): CoverTemplate {
    const styled = style === undefined ? {} : { style };
    const photos = paths.map(photo);
    switch (name) {
        case 'big-type':
            return genreTemplate(name, {
                ...styled,
                text: '三个错误*毁了*我的频道',
                fonts: FONTS,
                photos: [],
                tag: '新手必看',
            });
        case 'number':
            return genreTemplate(name, {
                ...styled,
                text: '个习惯*救了*我',
                fonts: FONTS,
                photos: [],
                figure: '90%',
            });
        case 'face-text':
            return genreTemplate(name, {
                ...styled,
                text: '我看*傻*了',
                fonts: FONTS,
                photos: [],
                subject: SUBJECT,
            });
        case 'face-stakes':
            return genreTemplate(name, {
                ...styled,
                text: '在火山口住了一晚',
                fonts: FONTS,
                photos: photos.slice(0, 1),
                subject: SUBJECT,
                figure: '$10,000',
            });
        case 'versus':
        case 'before-after':
            return genreTemplate(name, {
                ...styled,
                text: '15元和150元的拉面',
                fonts: FONTS,
                photos: photos.slice(0, 2),
                labels: ['¥15', '¥150'],
            });
        case 'collage':
            return genreTemplate(name, {
                ...styled,
                text: '东京吃了*7天*',
                fonts: FONTS,
                photos: photos.slice(0, 3),
            });
        case 'product':
            return genreTemplate(name, {
                ...styled,
                text: '降噪*天花板*',
                fonts: FONTS,
                photos: [],
                subject: SUBJECT,
                figure: '¥299',
                tag: '实测',
            });
        case 'tier':
            return genreTemplate(name, {
                ...styled,
                text: '我排了所有*拉面*',
                fonts: FONTS,
                photos: photos.slice(0, 3),
            });
        case 'quote':
            return genreTemplate(name, {
                ...styled,
                text: '别再*乱剪*了',
                fonts: FONTS,
                photos: [],
                subject: SUBJECT,
                tag: '李导演',
            });
        case 'proof':
            return genreTemplate(name, {
                ...styled,
                text: '他*承认*了',
                fonts: FONTS,
                photos: photos.slice(0, 1),
                tag: '实锤',
            });
        default:
            return genreTemplate(name, {
                ...styled,
                text: '离岩浆*50米*',
                fonts: FONTS,
                photos: photos.slice(0, 1),
            });
    }
}

describe('cover type registry', () => {
    it('parses every type name and refuses anything else', () => {
        expect(() => parseGenre('poster')).toThrow('Unknown template "poster"');
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
        ).toThrow(
            '--tag works with --template big-type, number, face-text, product, quote, proof.',
        );
        expect(() =>
            checkGenreInputs('product', {
                photos: 0,
                subject: true,
                options: { outline: 'sticker' },
            }),
        ).not.toThrow();
        expect(() =>
            checkGenreInputs('face-text', {
                photos: 0,
                subject: true,
                options: { outline: 'sticker' },
            }),
        ).toThrow('--outline works with --template product.');
        // 浅底方案的深色字只能压纯色，压照片的类型直接拒绝。
        expect(() =>
            checkGenreInputs('scene-title', {
                photos: 1,
                subject: false,
                options: {},
                scheme: 'cream',
            }),
        ).toThrow('scene-title puts its words on the picture');
        expect(() =>
            checkGenreInputs('face-text', {
                photos: 0,
                subject: true,
                options: {},
                scheme: 'lemon',
            }),
        ).not.toThrow();
    });
});

describe('product outline', () => {
    const html = async (outline?: 'none' | 'clean' | 'sticker') => {
        const template = genreTemplate('product', {
            text: '降噪*天花板*',
            fonts: FONTS,
            photos: [],
            subject: SUBJECT,
            ...(outline === undefined ? {} : { outline }),
        });
        const base = familyLayout('landscape');
        const layout = template.layoutFor === undefined ? base : template.layoutFor(base);
        const page = await template.renderHtml(
            layout,
            { fontPx: 80, keepClauses: false },
            layout.width,
            layout.height,
        );
        return page.html;
    };

    it('shows the product bare unless a sticker edge is asked for', async () => {
        expect(await html()).not.toContain('subject-outline');
        expect(await html('none')).not.toContain('subject-outline');
        // 奶油底上白边会糊进底色，外面要再包一圈深色细边。
        const sticker = await html('sticker');
        expect(sticker).toContain('url(#subject-outline)');
        expect(sticker).toContain('rgba(0,0,0,0.55)');
    });
});

describe('styles', () => {
    it('parses every style and refuses anything else', () => {
        expect(STYLE_NAMES.map(parseStyle)).toEqual([...STYLE_NAMES]);
        expect(() => parseStyle('poster')).toThrow('Unknown style "poster"');
    });

    it('keeps the type as it is for bold and sets the words for the others', () => {
        const bold = {
            style: 'outline' as const,
            font: FONTS.choose('heavy'),
            highlight: 'color' as const,
        };
        const colors = SCHEMES.navy.type;
        const on = (style: StyleName, light: boolean, picture: boolean) =>
            styledType(style, { fonts: FONTS, ground: { light, picture }, colors, bold });
        expect(on('bold', false, false)).toEqual({ type: bold, colors });
        expect(on('variety', false, false).type).toMatchObject({
            style: 'double',
            highlight: 'swap',
        });
        expect(on('round', false, true).type).toMatchObject({
            style: 'outline',
            highlight: 'marker',
        });
        // 衬线和书法不描边：浅底深字直接压底，照片上白字软投影。
        expect(on('editorial', true, false).type.style).toBe('ink');
        expect(on('editorial', false, true).type.style).toBe('soft');
        expect(on('brush', false, true).type.font.role).toBe(FONTS.choose('brush').role);
    });

    it('keeps memo to big-type and its own colours', () => {
        expect(() =>
            checkGenreInputs('number', {
                photos: 0,
                subject: false,
                options: { number: '3' },
                style: 'memo',
            }),
        ).toThrow('--style memo draws a phone notes screen for --template big-type.');
        expect(() =>
            checkGenreInputs('big-type', {
                photos: 0,
                subject: false,
                options: {},
                style: 'memo',
                scheme: 'navy',
            }),
        ).toThrow("--style memo uses the notes app's own colours. Drop --scheme.");
        expect(() =>
            checkGenreInputs('big-type', { photos: 0, subject: false, options: {}, style: 'memo' }),
        ).not.toThrow();
    });
});

describe('split halves', () => {
    it('gives landscape pictures a landscape half on every family', () => {
        // 前后对比现画的一对是横图，每一族的半边都得是横的，不然画出来的东西会被裁掉一大截。
        const photo: GenrePhoto = { path: '/a.jpg', width: 1536, height: 1024 };
        for (const family of FAMILY_NAMES) {
            const layout = familyLayout(family);
            const { panels } = splitLabelRects('before-after', layout, ['a', 'b'], [photo, photo]);
            for (const panel of panels) {
                expect(panel.width, family).toBeGreaterThanOrEqual(panel.height);
            }
        }
    });
});

describe('schemes', () => {
    const luminance = (hex: string) => {
        const [r, g, b] = [1, 3, 5].map((at) => {
            const c = Number.parseInt(hex.slice(at, at + 2), 16) / 255;
            return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
        }) as [number, number, number];
        return 0.2126 * r + 0.7152 * g + 0.0722 * b;
    };
    const contrast = (a: string, b: string) => {
        const [x, y] = [luminance(a), luminance(b)];
        return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
    };

    it('puts every pair of colours that touch at 4.5:1 or more', () => {
        for (const name of SCHEME_NAMES) {
            const { base, baseDeep, type } = SCHEMES[name];
            const pairs: [string, string, string][] = [
                // 高亮色块上的字
                ['block highlight', type.accentInk ?? type.stroke, type.accent],
            ];
            if (isLightScheme(name)) {
                // 浅底：深色字直接压底，荧光笔高亮压在强调色上
                pairs.push(
                    ['type on base', type.fill, base],
                    ['type on deep base', type.fill, baseDeep],
                );
            } else {
                // 深底：字和强调色都靠描边
                pairs.push(
                    ['type on outline', type.fill, type.stroke],
                    ['accent on outline', type.accent, type.stroke],
                );
            }
            for (const [what, a, b] of pairs) {
                expect(contrast(a, b), `${name} ${what}`).toBeGreaterThanOrEqual(4.5);
            }
            // 荧光笔只垫在字的下三分之一，字的其余部分压在底色上。强调色同时要托白字（色块）
            // 和黑字（荧光笔），两头都到 4.5:1 的颜色不存在，荧光笔按大字的底线 3:1 算。
            if (isLightScheme(name)) {
                expect(contrast(type.fill, type.accent), `${name} marker`).toBeGreaterThanOrEqual(
                    3,
                );
            }
        }
    });
});

describe('local scrim', () => {
    const layout = familyLayout('landscape');
    const peak = (css: string) => Number(/rgba\(0, 0, 0, ([\d.]+)\) 100%/.exec(css)?.[1]);

    it('only quiets the detail under outlined letters', () => {
        for (const style of ['outline', 'double'] as const) {
            const type = { style, font: FONTS.choose('heavy') };
            expect(peak(localScrim(layout, 'top', type, 0.62).css), style).toBe(0.35);
        }
    });

    it('keeps the full strength under soft letters, which lean on it', () => {
        const type = { style: 'soft' as const, font: FONTS.choose('serif') };
        expect(peak(localScrim(layout, 'top', type, 0.62).css)).toBe(0.62);
    });
});

describe('face lighting', () => {
    const face = { x: 0.5, y: 0.3, width: 0.5, height: 0.3 };
    const person = async (colour: string): Promise<SubjectLayer> => {
        const png = await sharp({
            create: { width: 100, height: 150, channels: 4, background: colour },
        })
            .png()
            .toBuffer();
        return {
            dataUri: `data:image/png;base64,${png.toString('base64')}`,
            width: 100,
            height: 150,
            method: 'transparent',
            bust: true,
            face,
        };
    };
    const lumaOf = async (subject: SubjectLayer) => {
        const bytes = Buffer.from(
            subject.dataUri.slice(subject.dataUri.indexOf(',') + 1),
            'base64',
        );
        const { channels } = await sharp(bytes).removeAlpha().stats();
        const [r, g, b] = channels.map((channel) => channel.mean) as [number, number, number];
        return 0.299 * r + 0.587 * g + 0.114 * b;
    };

    it('brightens a face darker than what is behind it, by at most a third', async () => {
        const dark = await person('#503c32');
        const lit = await litSubject(dark, 180);
        expect(lit.dataUri).not.toBe(dark.dataUri);
        const before = await lumaOf(dark);
        const after = await lumaOf(lit);
        expect(after).toBeGreaterThan(before);
        expect(after).toBeLessThanOrEqual(before * 1.4);
    });

    it('never pushes a light face on a light ground into blown-out white', async () => {
        const light = await person('#e6c3aa');
        const lit = await litSubject(light, 230);
        const bytes = Buffer.from(lit.dataUri.slice(lit.dataUri.indexOf(',') + 1), 'base64');
        const { data } = await sharp(bytes).raw().toBuffer({ resolveWithObject: true });
        expect(Math.max(data[0] ?? 0, data[1] ?? 0, data[2] ?? 0)).toBeLessThanOrEqual(245);
        // 透明度原样保留。
        expect(data[3]).toBe(255);
    });

    it('keeps transparent pixels transparent when it brightens', async () => {
        const half = await sharp({
            create: { width: 100, height: 150, channels: 4, background: '#503c32' },
        })
            .composite([
                {
                    input: {
                        create: {
                            width: 100,
                            height: 60,
                            channels: 4,
                            background: { r: 0, g: 0, b: 0, alpha: 1 },
                        },
                    },
                    left: 0,
                    top: 90,
                    // 下面 60 行挖成全透明。
                    blend: 'dest-out',
                },
            ])
            .png()
            .toBuffer();
        const subject: SubjectLayer = {
            ...(await person('#503c32')),
            dataUri: `data:image/png;base64,${half.toString('base64')}`,
        };
        const lit = await litSubject(subject, 180);
        expect(lit.dataUri).not.toBe(subject.dataUri);
        const bytes = Buffer.from(lit.dataUri.slice(lit.dataUri.indexOf(',') + 1), 'base64');
        const { data, info } = await sharp(bytes).raw().toBuffer({ resolveWithObject: true });
        expect(data[(120 * info.width + 50) * info.channels + 3]).toBe(0);
        expect(data[(10 * info.width + 50) * info.channels + 3]).toBe(255);
    });

    it('leaves a face that already stands out alone', async () => {
        const bright = await person('#e6c3aa');
        expect(await litSubject(bright, 60)).toBe(bright);
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

    it('shrinks the longest labels to fit their own panel, clear of the app UI and the headline', () => {
        const longest: [string, string] = ['一二三四五六七八', '¥1,500,00'];
        for (const kind of ['versus', 'before-after'] as const) {
            for (const family of FAMILY_NAMES) {
                const framed = framedLayout(family);
                const template = templateFor(kind, ['/a.png', '/b.png']);
                const layout = { ...(template.layoutFor?.(framed) ?? framed) };
                const { rects, panels, badge } = splitLabelRects(kind, layout, longest, [
                    photo('/a.png'),
                    photo('/b.png'),
                ]);
                expect(badge, `${kind} ${family} has a seam badge`).toBeDefined();
                expect(overlaps(badge as Rect, layout.textArea), `${kind} ${family} badge`).toBe(
                    false,
                );
                const visible = layout.visibleArea as Rect;
                rects.forEach((rect, index) => {
                    const panel = panels[index] as Rect;
                    const where = `${kind} ${family} label ${index}`;
                    expect(rect.x, where).toBeGreaterThanOrEqual(Math.max(panel.x, visible.x));
                    expect(rect.x + rect.width, where).toBeLessThanOrEqual(
                        Math.min(panel.x + panel.width, visible.x + visible.width),
                    );
                    expect(overlaps(rect, layout.textArea), where).toBe(false);
                    expect(overlaps(rect, badge as Rect), where).toBe(false);
                    for (const covered of layout.coveredAreas ?? []) {
                        expect(overlaps(rect, covered), where).toBe(false);
                    }
                });
                expect(overlaps(rects[0] as Rect, rects[1] as Rect), `${kind} ${family}`).toBe(
                    false,
                );
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

    // 每种字的风格放到每个类型上，出图后质检不能有不合格：字要读得出、不贴边、不压主体。
    it('renders every style on every type without a QC failure', async () => {
        const failures: string[] = [];
        for (const style of STYLE_NAMES) {
            const names = style === 'memo' ? (['big-type'] as const) : GENRE_NAMES;
            for (const name of names) {
                const platform = style === 'memo' ? 'xiaohongshu' : 'youtube';
                const composed = await composeCovers({
                    renderer,
                    template: templateFor(name, paths, style),
                    text: 'unused',
                    targets: [
                        { platform, outputPath: join(directory, `style-${style}-${name}.png`) },
                    ],
                    scale: 1,
                    qc: {},
                }).catch((error: unknown) => {
                    failures.push(`${style} ${name}: ${(error as Error).message}`);
                    return [];
                });
                for (const finding of composed[0]?.findings ?? []) {
                    if (finding.level === 'fail') {
                        failures.push(`${style} ${name}: ${finding.message}`);
                    }
                }
            }
        }
        expect(failures).toEqual([]);
    }, 900_000);

    // 纯色底的类型自己定底色，底色让封面发暗发灰就是类型的错，换照片也救不了。
    it('keeps the flat grounds of tier and memo bright and colourful', async () => {
        const covers = [
            { name: 'tier', template: templateFor('tier', paths), platform: 'youtube' },
            {
                name: 'memo with a tag',
                template: templateFor('big-type', paths, 'memo'),
                platform: 'xiaohongshu',
            },
            {
                name: 'memo without a tag',
                template: genreTemplate('big-type', {
                    text: '*租房*避坑清单',
                    fonts: FONTS,
                    photos: [],
                    style: 'memo',
                }),
                platform: 'xiaohongshu',
            },
        ] as const;
        const warnings: string[] = [];
        for (const cover of covers) {
            const [composed] = await composeCovers({
                renderer,
                template: cover.template,
                text: 'unused',
                targets: [
                    {
                        platform: cover.platform,
                        outputPath: join(directory, `ground-${cover.name}.png`),
                    },
                ],
                scale: 1,
                qc: {},
            });
            for (const finding of composed?.findings ?? []) {
                if (/is dark|nearly grey/.test(finding.message)) {
                    warnings.push(`${cover.name}: ${finding.message}`);
                }
            }
        }
        expect(warnings).toEqual([]);
    }, 120_000);

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
    }, 900_000);

    // 标签字号是按字宽估出来的。估算对不对，只有真渲染出来量外框才知道：韩文、emoji、最宽的
    // 西文字母、汉字都要落在自己那半边看得见的地方，两个标签不互压，也不压平台界面。
    it('keeps rendered labels inside their panels for every script', async () => {
        const browser = await chromium.launch({ headless: true });
        try {
            for (const kind of ['versus', 'before-after'] as const) {
                for (const labels of [
                    ['가나다라마바사아', '가나다라마바사아'],
                    ['WWWWWWWW', '😀😀😀😀😀😀😀😀'],
                    ['一二三四五六七八', '¥1,500,00'],
                ] as [string, string][]) {
                    const template = genreTemplate(kind, {
                        text: '对比',
                        fonts: FONTS,
                        photos: [photo(paths[0] as string), photo(paths[1] as string)],
                        labels,
                    });
                    const pages: { html: string; width: number; height: number }[] = [];
                    const recording: CoverRenderer = {
                        ...renderer,
                        screenshot: async (page) => {
                            pages.push(page);
                            return renderer.screenshot(page);
                        },
                    };
                    const targets = (['youtube', 'douyin', 'x'] as const).map((platform) => ({
                        platform,
                        outputPath: join(directory, `labels-${kind}-${platform}.png`),
                    }));
                    await composeCovers({
                        renderer: recording,
                        template,
                        text: '对比',
                        targets,
                        scale: 1,
                    });
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
                        const layout = {
                            ...(template.layoutFor?.(framed) ?? framed),
                            ...framed,
                            textArea: (template.layoutFor?.(framed) ?? framed).textArea,
                        };
                        const { panels } = splitLabelRects(kind, layout, labels, [
                            photo(paths[0] as string),
                            photo(paths[1] as string),
                        ]);
                        const page = await browser.newPage({
                            viewport: { width: recorded.width, height: recorded.height },
                        });
                        await page.setContent(recorded.html, { waitUntil: 'load' });
                        const boxes = (await Promise.all(
                            (await page.locator('.chip').all()).map((chip) => chip.boundingBox()),
                        )) as Rect[];
                        await page.close();
                        const where = `${kind} ${family} ${labels.join('/')}`;
                        expect(boxes, where).toHaveLength(2);
                        boxes.forEach((box, side) => {
                            const panel = panels[side] as Rect;
                            const seen = framed.visibleArea;
                            // 横向在自己那半边看得见的部分里，纵向在可见区里（标签本来就骑在标题带下沿），
                            // 不压标题。
                            expect(
                                inside(box, {
                                    x: Math.max(panel.x, seen.x),
                                    y: seen.y,
                                    width:
                                        Math.min(panel.x + panel.width, seen.x + seen.width) -
                                        Math.max(panel.x, seen.x),
                                    height: seen.height,
                                }),
                                `${where} label ${side}: ${JSON.stringify(box)}`,
                            ).toBe(true);
                            expect(
                                overlaps(box, layout.textArea),
                                `${where} label ${side} headline`,
                            ).toBe(false);
                            for (const covered of framed.coveredAreas) {
                                expect(overlaps(box, covered), `${where} label ${side} UI`).toBe(
                                    false,
                                );
                            }
                        });
                        expect(overlaps(boxes[0] as Rect, boxes[1] as Rect), where).toBe(false);
                    }
                }
            }
        } finally {
            await browser.close();
        }
    }, 300_000);

    // 用户看到的问题：竖版前后对比的「后」只露出上半张，主体（整洁的桌面）在照片下半截，
    // 质检照样通过。现在两半按平台看得清的那一截来分，主体要整个露出来，质检也会核对。
    it('shows the whole subject of both photos on a portrait before-after', async () => {
        const deskBefore = {
            x: 0.55,
            y: 0.36,
            width: 0.72,
            height: 0.62,
            source: 'saliency' as const,
        };
        const deskAfter = {
            x: 0.44,
            y: 0.545,
            width: 0.79,
            height: 0.547,
            source: 'saliency' as const,
        };
        const wide = [join(directory, 'wide-0.png'), join(directory, 'wide-1.png')] as const;
        for (const path of wide) {
            await sharp({
                create: { width: 1200, height: 800, channels: 3, background: '#8899aa' },
            })
                .png()
                .toFile(path);
        }
        for (const presets of [['xiaohongshu'], ['douyin'], ['xiaohongshu', 'douyin']] as const) {
            const template = genreTemplate('before-after', {
                text: '桌面改造',
                fonts: FONTS,
                photos: [
                    { path: wide[0], width: 1200, height: 800, focus: deskBefore },
                    { path: wide[1], width: 1200, height: 800, focus: deskAfter },
                ],
                labels: ['改前', '改后'],
            });
            const covers = await composeCovers({
                renderer,
                template,
                text: '桌面改造',
                targets: presets.map((platform) => ({
                    platform,
                    outputPath: join(directory, `desk-${presets.join('-')}-${platform}.png`),
                })),
                scale: 1,
                qc: {},
            });
            const cut = covers.flatMap((cover) =>
                cover.findings.filter((finding) => finding.message.includes('is cut off')),
            );
            expect(
                cut.map((f) => `${f.platform}: ${f.message.slice(0, 40)}`),
                presets.join(','),
            ).toEqual([]);
        }
    }, 120_000);

    it('frames both halves of a same-size before-after pair with one window', async () => {
        const pair = [join(directory, 'pair-0.png'), join(directory, 'pair-1.png')] as const;
        for (const path of pair) {
            await sharp({
                create: { width: 1536, height: 1024, channels: 3, background: '#998877' },
            })
                .png()
                .toFile(path);
        }
        const at = (x: number, width: number) => ({
            x,
            y: 0.55,
            width,
            height: 0.4,
            source: 'saliency' as const,
        });
        const relative = (subject: { box: Rect; frame: Rect }) => ({
            x: Math.round(subject.box.x - subject.frame.x),
            y: Math.round(subject.box.y - subject.frame.y),
            width: Math.round(subject.box.width),
            height: Math.round(subject.box.height),
        });
        // 同一个主体、上下分的竖版：两个标签挂的位置不同，取景也得一样。
        const same = at(0.5, 0.3);
        const template = genreTemplate('before-after', {
            text: '厨房改造',
            fonts: FONTS,
            photos: [
                { path: pair[0], width: 1536, height: 1024, focus: same },
                { path: pair[1], width: 1536, height: 1024, focus: same },
            ],
            labels: ['改前', '改后'],
        });
        const base = familyLayout('portrait');
        const layout = template.layoutFor === undefined ? base : template.layoutFor(base);
        const page = await template.renderHtml(
            layout,
            { fontPx: 80, keepClauses: false },
            layout.width,
            layout.height,
        );
        const [a, b] = page.subjects;
        if (a === undefined || b === undefined) {
            throw new Error('before-after reported no subjects');
        }
        expect(relative(a)).toEqual(relative(b));

        // 主体一个在最左、一个在最右，合起来放不进一个取景：各自构图，两边的主体都完整露出来，
        // 质检分别核对的也是各自的主体。
        const [cover] = await composeCovers({
            renderer,
            template: genreTemplate('before-after', {
                text: '厨房改造',
                fonts: FONTS,
                photos: [
                    { path: pair[0], width: 1536, height: 1024, focus: at(0.03, 0.05) },
                    { path: pair[1], width: 1536, height: 1024, focus: at(0.97, 0.05) },
                ],
                labels: ['改前', '改后'],
            }),
            text: '厨房改造',
            targets: [{ platform: 'youtube', outputPath: join(directory, 'pair-edges.png') }],
            scale: 1,
            qc: {},
        });
        expect(cover?.findings.filter((finding) => finding.message.includes('is cut off'))).toEqual(
            [],
        );
    }, 60_000);

    it('checks the scene subject of face-stakes, and finds none in a gradient scene', async () => {
        // 竖版照片正好铺满母版，主体贴着底边（y 1820-1920），放大 1.5 倍也只能挪到 0.93 一带，
        // 抖音底栏从 1540 起：主体被挡。
        const tall = join(directory, 'tall.png');
        await sharp({ create: { width: 1080, height: 1920, channels: 3, background: '#557799' } })
            .png()
            .toFile(tall);
        const compose = (focus: GenrePhoto['focus']) =>
            composeCovers({
                renderer,
                template: genreTemplate('face-stakes', {
                    text: '在火山口住了一晚',
                    fonts: FONTS,
                    photos: [
                        {
                            path: tall,
                            width: 1080,
                            height: 1920,
                            ...(focus === undefined ? {} : { focus }),
                        },
                    ],
                    subject: SUBJECT,
                }),
                text: '在火山口住了一晚',
                targets: [{ platform: 'douyin', outputPath: join(directory, 'stakes-douyin.png') }],
                scale: 1,
                qc: {},
            });
        const hidden = await compose({
            x: 300 / 1080,
            y: 1870 / 1920,
            width: 200 / 1080,
            height: 100 / 1920,
            source: 'saliency',
        });
        expect(hidden[0]?.findings.map((finding) => finding.message)).toContain(
            "the scene's subject is cut off or hidden under the app's buttons. Pick a photo with more room around its subject, or another type.",
        );
        // 画不了场景时的渐变底没有主体，不拿它去核对。
        const gradient = await compose(undefined);
        expect(
            gradient[0]?.findings.filter((finding) => finding.message.includes("scene's subject")),
        ).toEqual([]);
    }, 120_000);

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
