import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import sharp from 'sharp';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { getFamily, getPlatform, PLATFORM_NAMES, type Rect } from '../platforms/index.ts';
import {
    type CoverRenderer,
    type FitTextRequest,
    type RenderPage,
    TextDoesNotFitError,
} from '../render/index.ts';
import { type CoverLayout, type Headline, withSubjectArea } from '../render/layout.ts';
import {
    type CoverTemplate,
    composeCovers,
    composeCustomCover,
    coverOutputPaths,
    photoStretchWarnings,
    thumbnailWarnings,
} from './index.ts';

const tempDirectories: string[] = [];

afterEach(() => {
    for (const directory of tempDirectories.splice(0)) {
        rmSync(directory, { recursive: true, force: true });
    }
});

function tempDir(): string {
    const directory = mkdtempSync(join(tmpdir(), 'beastcover-compose-'));
    tempDirectories.push(directory);
    return directory;
}

interface FakeLayoutPage {
    layout: CoverLayout;
    headline: Headline;
}

/** 页面内容就是版式的 JSON，假渲染器据此画一张红底、标题区涂绿的母版 */
const template: CoverTemplate = {
    measureHtml: (layout, headline) => JSON.stringify({ layout, headline }),
    renderHtml: async (layout, headline) => JSON.stringify({ layout, headline }),
};

function fakeRenderer(fontFor: (request: FitTextRequest, keepClauses: boolean) => number) {
    const screenshots: RenderPage[] = [];
    const fits: boolean[] = [];
    const renderer: CoverRenderer = {
        fitText: vi.fn(async (request: FitTextRequest) => {
            const page = JSON.parse(request.html(request.minPx)) as FakeLayoutPage;
            fits.push(page.headline.keepClauses);
            return fontFor(request, page.headline.keepClauses);
        }),
        screenshot: vi.fn(async (page: RenderPage) => {
            screenshots.push(page);
            const { layout } = JSON.parse(page.html) as FakeLayoutPage;
            const area = layout.textArea;
            const s = page.scale;
            return sharp({
                create: {
                    width: Math.round(page.width * s),
                    height: Math.round(page.height * s),
                    channels: 3,
                    background: { r: 255, g: 0, b: 0 },
                },
            })
                .composite([
                    {
                        input: {
                            create: {
                                width: Math.round(area.width * s),
                                height: Math.round(area.height * s),
                                channels: 3,
                                background: { r: 0, g: 255, b: 0 },
                            },
                        },
                        left: Math.round(area.x * s),
                        top: Math.round(area.y * s),
                    },
                ])
                .png()
                .toBuffer();
        }),
        close: vi.fn(async () => undefined),
    };
    return { renderer, screenshots, fits };
}

async function pixel(path: string, x: number, y: number): Promise<[number, number, number]> {
    const { data, info } = await sharp(path).raw().toBuffer({ resolveWithObject: true });
    const offset = (Math.round(y) * info.width + Math.round(x)) * info.channels;
    return [data[offset] ?? -1, data[offset + 1] ?? -1, data[offset + 2] ?? -1];
}

function toOutput(rect: Rect, crop: Rect, factor: number): Rect {
    return {
        x: (rect.x - crop.x) * factor,
        y: (rect.y - crop.y) * factor,
        width: rect.width * factor,
        height: rect.height * factor,
    };
}

describe('cover composition', () => {
    it('renders one master per family and crops every platform from it', async () => {
        const directory = tempDir();
        const { renderer, screenshots } = fakeRenderer(() => 120);

        const covers = await composeCovers({
            renderer,
            template,
            text: 'Every platform',
            targets: coverOutputPaths(join(directory, 'cover.png'), [...PLATFORM_NAMES]),
            scale: 1,
        });

        expect(screenshots.map((page) => [page.width, page.height, page.scale])).toEqual([
            [1920, 1200, 2],
            [1920, 368, 2],
            [1080, 1920, 2],
        ]);
        expect(covers.map((cover) => cover.platform)).toEqual([...PLATFORM_NAMES]);

        for (const cover of covers) {
            const platform = getPlatform(cover.platform);
            expect(cover.outputPath).toBe(join(directory, `cover-${platform.name}.png`));
            const meta = await sharp(cover.outputPath).metadata();
            expect([meta.width, meta.height], platform.name).toEqual([
                platform.width,
                platform.height,
            ]);

            // 标题区映射到成品里仍然整块是绿的，四角往里收 3px 采样。
            const area = toOutput(
                getFamily(platform.family).textArea,
                platform.crop,
                platform.width / platform.crop.width,
            );
            for (const [x, y] of [
                [area.x + 3, area.y + 3],
                [area.x + area.width - 3, area.y + 3],
                [area.x + 3, area.y + area.height - 3],
                [area.x + area.width - 3, area.y + area.height - 3],
            ] as const) {
                const [r, g] = await pixel(cover.outputPath, x, y);
                expect(g, `${platform.name} at ${x},${y}`).toBeGreaterThan(200);
                expect(r, `${platform.name} at ${x},${y}`).toBeLessThan(60);
            }
        }
        expect(renderer.close).not.toHaveBeenCalled();
    });

    it('writes production pixels times the requested scale', async () => {
        const directory = tempDir();
        const { renderer, screenshots } = fakeRenderer(() => 120);

        const [cover] = await composeCovers({
            renderer,
            template,
            text: 'Scaled',
            targets: [{ platform: 'wechat', outputPath: join(directory, 'wechat.png') }],
            scale: 3,
        });

        expect(screenshots[0]?.scale).toBe(3);
        expect(cover).toMatchObject({ pixelWidth: 2700, pixelHeight: 1149 });
        const meta = await sharp(cover?.outputPath).metadata();
        expect([meta.width, meta.height]).toEqual([2700, 1149]);
    });

    it('keeps clauses together only when that costs less than 30% of the font size', async () => {
        const text = '人接不住认知以外的流量，也赚不到认知以外的钱';
        const directory = tempDir();

        for (const [clauseFont, keep] of [
            [150, true],
            [130, false],
        ] as const) {
            const { renderer } = fakeRenderer((_request, keepClauses) =>
                keepClauses ? clauseFont : 200,
            );
            const html = vi.spyOn(template, 'renderHtml');
            await composeCovers({
                renderer,
                template,
                text,
                targets: [{ platform: 'youtube', outputPath: join(directory, `${keep}.png`) }],
                scale: 1,
            });
            expect(html.mock.calls[0]?.[1]).toEqual({
                fontPx: keep ? clauseFont : 200,
                keepClauses: keep,
            });
            html.mockRestore();
        }
    });

    it('does not try the clause layout for a headline without punctuation', async () => {
        const { renderer, fits } = fakeRenderer(() => 200);
        await composeCovers({
            renderer,
            template,
            text: '人接不住认知以外的流量',
            targets: [{ platform: 'youtube', outputPath: join(tempDir(), 'one.png') }],
            scale: 1,
        });
        expect(fits).toEqual([false]);
    });

    it('names the platforms when the headline cannot fit their safe area', async () => {
        const renderer: CoverRenderer = {
            fitText: async () => {
                throw new TextDoesNotFitError('nope');
            },
            screenshot: vi.fn(),
            close: async () => undefined,
        };
        const directory = tempDir();

        await expect(
            composeCovers({
                renderer,
                template,
                text: 'x'.repeat(2000),
                targets: coverOutputPaths(join(directory, 'long.png'), ['wechat', 'x']),
                scale: 1,
            }),
        ).rejects.toThrowError(
            'The headline is too long to fit the wechat, x safe area even at 16px. Shorten it.',
        );
        expect(renderer.screenshot).not.toHaveBeenCalled();
        expect(existsSync(join(directory, 'long-wechat.png'))).toBe(false);
    });

    it('draws the safe areas on the cover when guides are on', async () => {
        const directory = tempDir();
        const { renderer } = fakeRenderer(() => 120);
        const [plain] = await composeCovers({
            renderer,
            template,
            text: 'Guides',
            targets: [{ platform: 'douyin', outputPath: join(directory, 'plain.png') }],
            scale: 1,
        });
        const [guided] = await composeCovers({
            renderer,
            template,
            text: 'Guides',
            targets: [{ platform: 'douyin', outputPath: join(directory, 'guided.png') }],
            scale: 1,
            guides: true,
        });

        // 标题区边框那一圈是参考线的绿，边框外面没画东西，像素不变。
        const area = getFamily('portrait').textArea;
        const edge = await pixel(guided?.outputPath ?? '', area.x + area.width / 2, area.y);
        const before = await pixel(plain?.outputPath ?? '', area.x + area.width / 2, area.y - 4);
        const after = await pixel(guided?.outputPath ?? '', area.x + area.width / 2, area.y - 4);
        expect(edge[1]).toBeGreaterThan(150);
        expect(edge[0]).toBeLessThan(120);
        expect(after).toEqual(before);
    });

    it('fits the headline in the area the template layout leaves for it', async () => {
        const { renderer } = fakeRenderer(() => 120);
        const directory = tempDir();
        await composeCovers({
            renderer,
            template: { ...template, layoutFor: withSubjectArea },
            text: 'Person',
            targets: [{ platform: 'youtube', outputPath: join(directory, 'person.png') }],
            scale: 1,
            guides: true,
        });

        const request = vi.mocked(renderer.fitText).mock.calls[0]?.[0];
        expect(request?.box).toEqual({ x: 192, y: 132, width: 864, height: 876 });
        // 人物区的蓝色参考线：右边框在母版 x=1728，youtube 缩放 2/3 后是 1152。
        const [r, g, b] = await pixel(join(directory, 'person.png'), 1152, 400);
        expect(b).toBeGreaterThan(150);
        expect(r).toBeLessThan(120);
        expect(g).toBeLessThan(170);
    });

    it('lets a one-line headline fill a shallow band but keeps four characters across', async () => {
        const { renderer } = fakeRenderer(() => 120);
        const band = { x: 192, y: 792, width: 1392, height: 216 };
        const tall = { x: 86, y: 384, width: 842, height: 1152 };
        for (const [area, expected] of [
            [band, 194],
            [tall, 211],
        ] as const) {
            vi.mocked(renderer.fitText).mockClear();
            await composeCovers({
                renderer,
                template: { ...template, layoutFor: (layout) => ({ ...layout, textArea: area }) },
                text: 'Band',
                targets: [{ platform: 'youtube', outputPath: join(tempDir(), 'band.png') }],
                scale: 1,
            });
            expect(vi.mocked(renderer.fitText).mock.calls[0]?.[0].maxPx).toBe(expected);
        }
    });

    it('renders a custom canvas directly without a family master', async () => {
        const directory = tempDir();
        const { renderer, screenshots } = fakeRenderer(() => 40);
        const cover = await composeCustomCover({
            renderer,
            template,
            text: 'Custom',
            width: 800,
            height: 300,
            scale: 2,
            outputPath: join(directory, 'custom.png'),
        });

        expect(screenshots.map((page) => [page.width, page.height, page.scale])).toEqual([
            [800, 300, 2],
        ]);
        expect(cover).toEqual({
            outputPath: join(directory, 'custom.png'),
            pixelWidth: 1600,
            pixelHeight: 600,
        });
    });

    it('rejects an output path that is not a PNG', async () => {
        const { renderer } = fakeRenderer(() => 40);
        await expect(
            composeCovers({
                renderer,
                template,
                text: 'Nope',
                targets: [{ platform: 'x', outputPath: join(tempDir(), 'cover.jpg') }],
                scale: 1,
            }),
        ).rejects.toThrowError(/must use the \.png extension/);
    });
});

describe('cover output paths', () => {
    it('keeps a single path and suffixes the platform name for several', () => {
        expect(coverOutputPaths('/out/cover.png', ['x'])).toEqual([
            { platform: 'x', outputPath: '/out/cover.png' },
        ]);
        expect(coverOutputPaths('/out/cover.png', ['wechat', 'x'])).toEqual([
            { platform: 'wechat', outputPath: '/out/cover-wechat.png' },
            { platform: 'x', outputPath: '/out/cover-x.png' },
        ]);
    });
});

describe('thumbnail check', () => {
    it('warns only for platforms whose feed thumbnail shrinks the headline below 10px', () => {
        const warnings = thumbnailWarnings([
            {
                platform: 'instagram',
                outputPath: '/a.png',
                pixelWidth: 1080,
                pixelHeight: 1440,
                feedHeadlinePx: 9.1,
            },
            {
                platform: 'youtube',
                outputPath: '/b.png',
                pixelWidth: 1280,
                pixelHeight: 720,
                feedHeadlinePx: 18,
            },
        ]);
        expect(warnings).toEqual([
            'Thumbnail: the headline is 9.1px at instagram feed size (125px wide). A shorter headline reads bigger.',
        ]);
    });

    it('scales the fitted font by feed width over the crop width', async () => {
        const { renderer } = fakeRenderer(() => 108);
        const [cover] = await composeCovers({
            renderer,
            template,
            text: 'Feed',
            targets: [{ platform: 'xiaohongshu', outputPath: join(tempDir(), 'feed.png') }],
            scale: 1,
        });
        expect(cover?.feedHeadlinePx).toBeCloseTo((108 * 180) / 1080);
    });
});

describe('photo stretch check', () => {
    it('warns when the photo has to grow more than 1.5x for a platform', () => {
        // 1024x683 铺满母版要放大 1.875 倍。youtube 再从 1920 缩到 1280，只剩 1.25 倍，不提示。
        // x 按母版原样输出，公众号再从 865 宽放到 900 宽。
        expect(
            photoStretchWarnings({ width: 1024, height: 683 }, ['youtube', 'x', 'wechat'], 1),
        ).toEqual([
            'Photo: 1024x683 is stretched 1.9x on x. A larger photo stays sharp.',
            'Photo: 1024x683 is stretched 2.0x on wechat. A larger photo stays sharp.',
        ]);
        expect(
            photoStretchWarnings({ width: 4000, height: 3000 }, ['youtube', 'douyin'], 1),
        ).toEqual([]);
        expect(photoStretchWarnings({ width: 1280, height: 800 }, ['youtube'], 2)).toEqual([
            'Photo: 1280x800 is stretched 2.0x on youtube. A larger photo stays sharp.',
        ]);
    });
});
