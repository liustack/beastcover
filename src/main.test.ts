import {
    existsSync,
    mkdirSync,
    mkdtempSync,
    readdirSync,
    readFileSync,
    rmSync,
    writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import sharp from 'sharp';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { familyClearArea, familyCoveredAreas, familyVisibleArea } from './compose/index.ts';
import { setConfigValue } from './config.ts';
import { createProgram, runCli } from './main.ts';
import type { CoverRenderer, RenderPage } from './render/index.ts';
import { familyLayout } from './render/layout.ts';
import { calloutGeometry, calloutLayout, framedFocusBox } from './render/photo-cover.ts';

const tempDirectories: string[] = [];

afterEach(() => {
    for (const directory of tempDirectories.splice(0)) {
        rmSync(directory, { recursive: true, force: true });
    }
});

function tempDir(prefix: string): string {
    const directory = mkdtempSync(join(tmpdir(), prefix));
    tempDirectories.push(directory);
    return directory;
}

function captureOutput(): { chunks: string[]; write: (chunk: string) => void } {
    const chunks: string[] = [];
    return {
        chunks,
        write: (chunk: string) => {
            chunks.push(chunk);
        },
    };
}

/** 假渲染器：量字号固定返回 64px，截图按请求尺寸返回纯色 PNG。screenshot 的调用记录就是渲染过的页面 */
function mockRender() {
    const screenshot = vi.fn(async (page: RenderPage) =>
        sharp({
            create: {
                width: Math.round(page.width * page.scale),
                height: Math.round(page.height * page.scale),
                channels: 3,
                background: { r: 20, g: 20, b: 20 },
            },
        })
            .png()
            .toBuffer(),
    );
    const renderer: CoverRenderer = {
        fitText: vi.fn(async () => 64),
        screenshot,
        close: vi.fn(async () => undefined),
        probeFonts: vi.fn(async () => []),
        inspect: vi.fn(async () => ({ background: Buffer.alloc(0), withText: Buffer.alloc(0) })),
    };
    return Object.assign(screenshot, { open: vi.fn(async () => renderer) });
}

const centreFocus = async (_imagePath: string) => ({
    x: 0.5,
    y: 0.5,
    width: 0.3,
    height: 0.3,
    source: 'attention' as const,
});

async function testPngBytes(width: number, height: number): Promise<Buffer> {
    return sharp({
        create: { width, height, channels: 3, background: { r: 40, g: 80, b: 120 } },
    })
        .png()
        .toBuffer();
}

/** 假画家：不发请求、不起进程，在运行目录里放一张对应朝向尺寸的图 */
function fakePainter() {
    return vi.fn(
        async (
            _painter: unknown,
            _scene: string,
            orientation: 'landscape' | 'portrait',
            runDir: string,
        ) => {
            const path = join(runDir, `scene-${orientation}.png`);
            mkdirSync(runDir, { recursive: true });
            const [width, height] = orientation === 'portrait' ? [1024, 1536] : [1536, 1024];
            await sharp(await testPngBytes(width, height)).toFile(path);
            return path;
        },
    );
}

describe('BeastCover CLI', () => {
    it('registers every first-phase command', () => {
        const program = createProgram();
        expect(program.commands.map((command) => command.name())).toEqual([
            'gen',
            'stock',
            'config',
            'doctor',
        ]);
        const stock = program.commands.find((command) => command.name() === 'stock');
        expect(stock?.commands.map((command) => command.name())).toEqual(['search', 'fetch']);
    });

    it('runs gen through the local renderer with CLI flags above file config', async () => {
        const directory = tempDir('beastcover-cli-');
        const configPath = join(directory, 'config.json');
        const outputPath = join(directory, 'result.png');
        setConfigValue('render.preset', 'x', configPath);
        setConfigValue('render.scale', '2', configPath);

        const renderHtml = mockRender();
        const stdout = captureOutput();
        const stderr = captureOutput();

        const exitCode = await runCli(
            [
                'node',
                'beastcover',
                'gen',
                'One headline for every platform',
                '--output',
                outputPath,
                '--width',
                '800',
            ],
            {
                cwd: directory,
                configPath,
                openRenderer: renderHtml.open,
                qc: undefined,
                stdout,
                stderr,
            },
        );

        expect(exitCode).toBe(0);
        expect(stderr.chunks).toEqual([]);
        expect(renderHtml).toHaveBeenCalledOnce();
        expect(renderHtml.mock.calls[0]?.[0]).toMatchObject({ width: 800, height: 640, scale: 2 });
        expect(renderHtml.mock.calls[0]?.[0].html).toContain('One headline for every platform');
        const meta = await sharp(outputPath).metadata();
        expect([meta.width, meta.height]).toEqual([1600, 1280]);
        expect(stdout.chunks.join('')).toContain(`Created ${outputPath}\nCanvas: 800x640 at 2x`);
        expect(stdout.chunks.join('')).toContain('Privacy: render stayed on this machine.');
        expect(readdirSync(directory)).not.toContain('.beastcover');
    });

    it('takes --scheme for one run and leaves nothing behind in the directory', async () => {
        const cwd = tempDir('beastcover-cli-scheme-');
        const renderHtml = mockRender();
        const genOut = captureOutput();
        const exitCode = await runCli(
            ['node', 'beastcover', 'gen', 'Scheme card', '--scheme', 'navy'],
            {
                cwd,
                configPath: join(cwd, 'unused-config.json'),
                openRenderer: renderHtml.open,
                qc: undefined,
                stdout: genOut,
            },
        );

        expect(exitCode).toBe(0);
        const outputPath = join(cwd, 'beastcover.png');
        expect(existsSync(outputPath)).toBe(true);
        expect(genOut.chunks.join('')).toContain(`Created ${outputPath}\nCanvas: 1280x720 at 1x`);
        expect(genOut.chunks.join('')).toContain('Template: big-type');
        expect(renderHtml.mock.calls[0]?.[0].html).toContain('Scheme card');
        expect(renderHtml.mock.calls[0]?.[0].html).toContain('#123A6B');
        // 做完就走：目录里只有成品，没有任何工具目录或档案。
        expect(readdirSync(cwd)).toEqual(['beastcover.png']);

        for (const [args, message] of [
            [
                ['--scheme', 'watercolor'],
                'Unknown scheme "watercolor". Use navy, night, orange, teal, cream, lemon.',
            ],
        ] as const) {
            const stderr = captureOutput();
            expect(
                await runCli(['node', 'beastcover', 'gen', 'x', ...args], {
                    cwd,
                    configPath: join(cwd, 'unused-config.json'),
                    openRenderer: renderHtml.open,
                    qc: undefined,
                    stdout: captureOutput(),
                    stderr,
                }),
            ).toBe(1);
            expect(stderr.chunks.join('')).toBe(`Error: ${message}\n`);
        }
    });

    it('renders a photo cover from a local image and records the photo in history', async () => {
        const cwd = tempDir('beastcover-photo-local-');
        const photoPath = join(cwd, 'sea.png');
        writeFileSync(photoPath, await testPngBytes(64, 32));

        const renderHtml = mockRender();
        const stdout = captureOutput();
        const now = new Date('2026-09-23T00:00:00.000Z');
        const exitCode = await runCli(
            ['node', 'beastcover', 'gen', 'Dawn tide', '--photo', 'sea.png'],
            {
                cwd,
                configPath: join(cwd, 'unused-config.json'),
                openRenderer: renderHtml.open,
                qc: undefined,
                photoFocus: centreFocus,
                stdout,
                now: () => now,
            },
        );

        expect(exitCode).toBe(0);
        const html = renderHtml.mock.calls[0]?.[0].html ?? '';
        expect(html).toContain('Dawn tide');
        expect(html).toContain('data:image/jpeg;base64,');
        expect(stdout.chunks.join('')).toContain('Template: scene-title');
        expect(stdout.chunks.join('')).toContain(
            'Photo: 64x32 is stretched 25.0x on youtube. A larger photo stays sharp.',
        );
        expect(stdout.chunks.join('')).toContain(`Photo: ${photoPath}`);
        expect(stdout.chunks.join('')).toContain('Privacy: render stayed on this machine.');
    });

    it('fetches a stock ref into the temp staging area and renders it as the cover', async () => {
        const cwd = tempDir('beastcover-photo-ref-');
        const png = await testPngBytes(80, 40);
        const fetchImpl = vi.fn(async (url: string | URL | Request) => {
            expect(String(url)).toBe('https://api.openverse.org/v1/images/a1/');
            return new Response(
                JSON.stringify({
                    id: 'a1',
                    url: 'https://upload.example/a1.png',
                    license: 'cc0',
                    creator: 'Ada',
                    width: 80,
                    height: 40,
                    foreign_landing_url: 'https://flickr.example/a1',
                }),
                { status: 200 },
            );
        });
        const stock = {
            fetch: fetchImpl as typeof fetch,
            sleep: async () => undefined,
            download: {
                lookup: async () => [{ address: '104.16.1.1', family: 4 }],
                pinnedFetch: async () =>
                    new Response(png, { status: 200, headers: { 'content-type': 'image/png' } }),
            },
        };

        const renderHtml = mockRender();
        const stdout = captureOutput();
        const now = new Date('2026-09-23T00:00:00.000Z');
        const exitCode = await runCli(
            ['node', 'beastcover', 'gen', 'Quiet harbour', '--photo', 'openverse:a1'],
            {
                cwd,
                configPath: join(cwd, 'unused-config.json'),
                openRenderer: renderHtml.open,
                qc: undefined,
                photoFocus: centreFocus,
                stdout,
                now: () => now,
                stock,
            },
        );

        expect(exitCode).toBe(0);
        // 下载暂存在系统临时目录：项目目录零残留，路径打印给 agent 决定去留。
        const refPath = join(tmpdir(), 'beastcover', 'refs', 'openverse-a1.png');
        expect(existsSync(refPath)).toBe(true);
        expect(JSON.parse(readFileSync(`${refPath}.json`, 'utf8'))).toMatchObject({
            ref: 'openverse:a1',
            license: 'cc0',
            creator: 'Ada',
        });
        expect(renderHtml.mock.calls[0]?.[0].html).toContain('Quiet harbour');
        const out = stdout.chunks.join('');
        expect(out).toContain(`Photo: openverse:a1 (saved at ${refPath})`);
        expect(out).toContain('License: cc0');
        expect(out).not.toContain('Credit:');
        expect(out).toContain('Source: https://flickr.example/a1');
        expect(out).toContain('Privacy: the photo was downloaded from openverse.');
        expect(readdirSync(cwd)).toEqual(['beastcover.png']);
    });

    it('searches stock and prints picks without choosing one', async () => {
        const cwd = tempDir('beastcover-stock-search-');
        const fetchImpl = vi.fn(
            async () =>
                new Response(
                    JSON.stringify({
                        results: [
                            {
                                id: 'a1',
                                url: 'https://upload.example/a1.jpg',
                                license: 'pdm',
                                creator: 'Ada',
                                width: 1600,
                                height: 900,
                                thumbnail: 'https://api.openverse.org/thumb/a1',
                            },
                        ],
                    }),
                    { status: 200 },
                ),
        );
        const stdout = captureOutput();
        const exitCode = await runCli(
            ['node', 'beastcover', 'stock', 'search', 'harbour dawn', '--orientation', 'landscape'],
            {
                cwd,
                configPath: join(cwd, 'unused-config.json'),
                stdout,
                stock: { fetch: fetchImpl as typeof fetch, sleep: async () => undefined },
            },
        );

        expect(exitCode).toBe(0);
        const out = stdout.chunks.join('');
        expect(out).toContain('Provider: openverse');
        expect(out).toContain('openverse:a1');
        expect(out).toContain('1600x900');
        expect(out).toContain('https://api.openverse.org/thumb/a1');
        expect(out).toContain('Pick one by eye');
    });

    it('refuses --provider pexels without a key instead of switching to openverse', async () => {
        const cwd = tempDir('beastcover-stock-pexels-');
        const fetchImpl = vi.fn();
        const stderr = captureOutput();
        const exitCode = await runCli(
            ['node', 'beastcover', 'stock', 'search', 'desk', '--provider', 'pexels'],
            {
                cwd,
                configPath: join(cwd, 'unused-config.json'),
                stdout: captureOutput(),
                stderr,
                stock: { fetch: fetchImpl as typeof fetch },
            },
        );

        expect(exitCode).toBe(1);
        expect(fetchImpl).not.toHaveBeenCalled();
        expect(stderr.chunks.join('')).toContain('Pexels needs an API key.');
    });

    it('stock fetch reports the size the host served when it is smaller than listed', async () => {
        const cwd = tempDir('beastcover-stock-fetch-size-');
        const png = await testPngBytes(80, 40);
        const stock = {
            fetch: (async () =>
                new Response(
                    JSON.stringify({
                        id: 'a1',
                        url: 'https://upload.example/a1.png',
                        license: 'cc0',
                        creator: 'Ada',
                        width: 5000,
                        height: 2500,
                        foreign_landing_url: 'https://rawpixel.example/a1',
                    }),
                    { status: 200 },
                )) as unknown as typeof fetch,
            sleep: async () => undefined,
            download: {
                lookup: async () => [{ address: '104.16.1.1', family: 4 }],
                pinnedFetch: async () =>
                    new Response(png, { status: 200, headers: { 'content-type': 'image/png' } }),
            },
        };
        const stdout = captureOutput();

        const exitCode = await runCli(
            ['node', 'beastcover', 'stock', 'fetch', 'openverse:a1', '--dir', 'refs'],
            { cwd, configPath: join(cwd, 'unused-config.json'), stdout, stock },
        );

        expect(exitCode).toBe(0);
        expect(stdout.chunks.join('')).toContain(
            'Size: 80x40 (the host served a smaller copy than the listed 5000x2500)',
        );
        expect(
            JSON.parse(readFileSync(join(cwd, 'refs', 'openverse-a1.png.json'), 'utf8')),
        ).toMatchObject({ width: 80, height: 40, listedWidth: 5000, listedHeight: 2500 });
    });

    it('stock fetch lands in the temp staging area by default and honors --dir', async () => {
        const cwd = tempDir('beastcover-stock-fetch-dir-');
        const png = await testPngBytes(80, 40);
        const stock = {
            fetch: (async () =>
                new Response(
                    JSON.stringify({
                        id: 'd1',
                        url: 'https://upload.example/d1.png',
                        license: 'cc0',
                        creator: 'Ada',
                        width: 80,
                        height: 40,
                    }),
                    { status: 200 },
                )) as typeof fetch,
            sleep: async () => undefined,
            download: {
                lookup: async () => [{ address: '104.16.1.1', family: 4 }],
                pinnedFetch: async () =>
                    new Response(png, { status: 200, headers: { 'content-type': 'image/png' } }),
            },
        };

        const stdout = captureOutput();
        const exitCode = await runCli(
            ['node', 'beastcover', 'stock', 'fetch', 'openverse:d1', '--dir', 'picked'],
            { cwd, configPath: join(cwd, 'unused-config.json'), stdout, stock },
        );
        expect(exitCode).toBe(0);
        expect(existsSync(join(cwd, 'picked', 'openverse-d1.png'))).toBe(true);

        const defaults = captureOutput();
        const defaultCode = await runCli(['node', 'beastcover', 'stock', 'fetch', 'openverse:d1'], {
            cwd,
            configPath: join(cwd, 'unused-config.json'),
            stdout: defaults,
            stock,
        });
        expect(defaultCode).toBe(0);
        expect(defaults.chunks.join('')).toContain(
            join(tmpdir(), 'beastcover', 'refs', 'openverse-d1.png'),
        );
        expect(existsSync(join(cwd, '.beastcover'))).toBe(false);
    });

    it('refuses --via without --scene, since it only names who paints the scene', async () => {
        const directory = tempDir('beastcover-via-alone-');
        const renderHtml = mockRender();
        const stderr = captureOutput();
        const code = await runCli(['node', 'beastcover', 'gen', 'A figure', '--via', 'agy'], {
            cwd: directory,
            configPath: join(directory, 'unused-config.json'),
            openRenderer: renderHtml.open,
            qc: undefined,
            lookupCommand: () => '/fake/agy',
            stdout: captureOutput(),
            stderr,
        });
        expect(code).toBe(1);
        expect(renderHtml).not.toHaveBeenCalled();
        expect(stderr.chunks.join('')).toBe(
            'Error: --via names who paints --scene. Add --scene or drop --via.\n',
        );
    });

    it('writes one cover per platform from one master per family', async () => {
        const cwd = tempDir('beastcover-cli-multi-');
        const renderHtml = mockRender();
        const stdout = captureOutput();
        const now = new Date('2026-09-25T00:00:00.000Z');

        const exitCode = await runCli(
            ['node', 'beastcover', 'gen', 'Beast', '--preset', 'x,wechat,douyin'],
            {
                cwd,
                configPath: join(cwd, 'unused-config.json'),
                openRenderer: renderHtml.open,
                qc: undefined,
                stdout,
                now: () => now,
            },
        );

        expect(exitCode).toBe(0);
        expect(renderHtml.mock.calls.map(([page]) => [page.width, page.height])).toEqual([
            [1920, 768],
            [1080, 1920],
        ]);
        const stem = join(cwd, 'beastcover');
        const printed = stdout.chunks.join('');
        for (const [platform, size] of [
            ['wechat', [900, 383]],
            ['x', [1600, 640]],
            ['douyin', [1080, 1920]],
        ] as const) {
            const path = `${stem}-${platform}.png`;
            const meta = await sharp(path).metadata();
            expect([meta.width, meta.height], platform).toEqual([...size]);
            expect(printed).toContain(`Created ${path}\nCanvas: ${size[0]}x${size[1]} at 1x`);
        }
        expect(renderHtml.open).toHaveBeenCalledOnce();
    });

    it('puts --hook on video covers and keeps the headline on WeChat and X', async () => {
        const cwd = tempDir('beastcover-cli-hook-');
        const renderHtml = mockRender();
        const now = new Date('2026-09-26T00:00:00.000Z');

        const exitCode = await runCli(
            [
                'node',
                'beastcover',
                'gen',
                'Why most productivity advice fails',
                '--hook',
                'It fails',
                '--preset',
                'youtube,x',
            ],
            {
                cwd,
                configPath: join(cwd, 'unused-config.json'),
                openRenderer: renderHtml.open,
                qc: undefined,
                stdout: captureOutput(),
                now: () => now,
            },
        );

        expect(exitCode).toBe(0);
        const landscape = renderHtml.mock.calls.find(([page]) => page.height === 1200)?.[0].html;
        const wide = renderHtml.mock.calls.find(([page]) => page.height === 768)?.[0].html;
        expect(landscape).toContain('It fails');
        expect(landscape).not.toContain('productivity');
        expect(wide).toContain('Why most productivity advice fails');
        expect(renderHtml.open).toHaveBeenCalledOnce();
    });

    it('refuses the callout template where it cannot circle the photo subject', async () => {
        const directory = tempDir('beastcover-cli-callout-refuse-');
        for (const [args, message] of [
            [['--template', 'callout'], 'Error: --template callout needs one --photo. It got 0.\n'],
            [
                ['--template', 'callout', '--photo', 'x.jpg', '--fit', 'extend'],
                'Error: --fit works with --template face-stakes, scene-title, mood.\n',
            ],
            [
                ['--template', 'callout', '--photo', 'x.jpg', '--subject', 'me.png'],
                'Error: --subject works with --template face-text or face-stakes. callout has no person in it.\n',
            ],
        ] as const) {
            const stderr = captureOutput();
            const exitCode = await runCli(['node', 'beastcover', 'gen', 'Headline', ...args], {
                cwd: directory,
                configPath: join(directory, 'config.json'),
                openRenderer: mockRender().open,
                qc: undefined,
                stdout: captureOutput(),
                stderr,
            });
            expect(exitCode).toBe(1);
            expect(stderr.chunks.join('')).toBe(message);
        }
    });

    it('checks the callout against every requested cover before opening the renderer', async () => {
        const cwd = tempDir('beastcover-cli-callout-check-');
        writeFileSync(join(cwd, 'wide.png'), await testPngBytes(400, 200));
        const renderHtml = mockRender();
        const stderr = captureOutput();
        // 主体在照片正中，占三成：横版母版挪不动，红圈下面剩不下标题带。
        const exitCode = await runCli(
            [
                'node',
                'beastcover',
                'gen',
                'Look',
                '--photo',
                'wide.png',
                '--template',
                'callout',
                '--preset',
                'youtube,douyin',
                '--output',
                join(cwd, 'look.png'),
            ],
            {
                cwd,
                configPath: join(cwd, 'unused-config.json'),
                openRenderer: renderHtml.open,
                qc: undefined,
                photoFocus: centreFocus,
                stdout: captureOutput(),
                stderr,
            },
        );
        expect(exitCode).toBe(1);
        expect(stderr.chunks.join('')).toBe(
            'Error: The callout cannot mark the subject on youtube: the red circle would leave no room for the headline below it. Pick a photo where the subject is small and has empty space around it, or use another --template.\n',
        );
        expect(renderHtml.open).not.toHaveBeenCalled();
        expect(readdirSync(cwd).filter((name) => name.startsWith('look'))).toEqual([]);
    });

    it('draws the callout on every requested cover when the subject is small and clear', async () => {
        const cwd = tempDir('beastcover-cli-callout-draw-');
        writeFileSync(join(cwd, 'wide.png'), await testPngBytes(400, 200));
        const renderHtml = mockRender();
        const exitCode = await runCli(
            [
                'node',
                'beastcover',
                'gen',
                'Look',
                '--photo',
                'wide.png',
                '--template',
                'callout',
                '--preset',
                'youtube,douyin',
                '--output',
                join(cwd, 'look.png'),
            ],
            {
                cwd,
                configPath: join(cwd, 'unused-config.json'),
                openRenderer: renderHtml.open,
                qc: undefined,
                photoFocus: async () => ({
                    x: 0.75,
                    y: 0.35,
                    width: 0.1,
                    height: 0.1,
                    source: 'saliency' as const,
                }),
                stdout: captureOutput(),
            },
        );
        expect(exitCode).toBe(0);
        expect(renderHtml).toHaveBeenCalledTimes(2);
        for (const call of renderHtml.mock.calls) {
            expect(call[0].html).toContain('<svg class="callout"');
        }
        expect(existsSync(join(cwd, 'look-youtube.png'))).toBe(true);
        expect(existsSync(join(cwd, 'look-douyin.png'))).toBe(true);
    });

    it('stops before the browser when a later family cannot take the callout, leaving no files', async () => {
        const cwd = tempDir('beastcover-cli-callout-family-');
        writeFileSync(join(cwd, 'wide.png'), await testPngBytes(400, 200));
        const renderHtml = mockRender();
        const stderr = captureOutput();
        // 横版放得下，竖版把 15% 宽的主体撑到一半宽，圈不了。
        const exitCode = await runCli(
            [
                'node',
                'beastcover',
                'gen',
                'Look',
                '--photo',
                'wide.png',
                '--template',
                'callout',
                '--preset',
                'youtube,xiaohongshu',
                '--output',
                join(cwd, 'look.png'),
            ],
            {
                cwd,
                configPath: join(cwd, 'unused-config.json'),
                openRenderer: renderHtml.open,
                qc: undefined,
                photoFocus: async () => ({
                    x: 0.75,
                    y: 0.35,
                    width: 0.15,
                    height: 0.1,
                    source: 'saliency' as const,
                }),
                stdout: captureOutput(),
                stderr,
            },
        );
        expect(exitCode).toBe(1);
        expect(stderr.chunks.join('')).toMatch(
            /^Error: The callout on xiaohongshu: the subject covers/,
        );
        expect(renderHtml.open).not.toHaveBeenCalled();
        expect(readdirSync(cwd).filter((name) => name.startsWith('look'))).toEqual([]);
    });

    it('refuses a non-PNG output for a stock ref before downloading anything', async () => {
        const cwd = tempDir('beastcover-cli-stock-jpg-');
        const fetchImpl = vi.fn();
        const renderHtml = mockRender();
        const stderr = captureOutput();
        const before = readdirSync(tmpdir()).filter((name) => name.startsWith('beastcover-stock-'));
        const exitCode = await runCli(
            [
                'node',
                'beastcover',
                'gen',
                'Headline',
                '--photo',
                'openverse:4e78d273-4403-467b-8ec3-439619a55e01',
                '--output',
                'cover.jpg',
            ],
            {
                cwd,
                configPath: join(cwd, 'unused-config.json'),
                openRenderer: renderHtml.open,
                qc: undefined,
                stock: { fetch: fetchImpl as unknown as typeof fetch },
                stdout: captureOutput(),
                stderr,
            },
        );
        expect(exitCode).toBe(1);
        expect(stderr.chunks.join('')).toBe(
            `Error: Cover output must use the .png extension: ${join(cwd, 'cover.jpg')}\n`,
        );
        expect(fetchImpl).not.toHaveBeenCalled();
        expect(renderHtml.open).not.toHaveBeenCalled();
        const after = readdirSync(tmpdir()).filter((name) => name.startsWith('beastcover-stock-'));
        expect(after).toEqual(before);
    });

    it('removes the temporary stock folder when the callout check refuses', async () => {
        const cwd = tempDir('beastcover-cli-stock-tmp-');
        const png = await testPngBytes(400, 200);
        const fetchImpl = vi.fn(
            async () =>
                new Response(
                    JSON.stringify({
                        id: 'a1',
                        url: 'https://upload.example/a1.png',
                        license: 'cc0',
                        creator: 'Ada',
                        width: 400,
                        height: 200,
                        foreign_landing_url: 'https://flickr.example/a1',
                    }),
                    { status: 200 },
                ),
        );
        const stderr = captureOutput();
        const before = readdirSync(tmpdir()).filter((name) => name.startsWith('beastcover-stock-'));
        const exitCode = await runCli(
            [
                'node',
                'beastcover',
                'gen',
                'Look',
                '--photo',
                'openverse:a1',
                '--template',
                'callout',
                '--preset',
                'youtube',
                '--output',
                join(cwd, 'look.png'),
            ],
            {
                cwd,
                configPath: join(cwd, 'unused-config.json'),
                openRenderer: mockRender().open,
                qc: undefined,
                photoFocus: centreFocus,
                stock: {
                    fetch: fetchImpl as typeof fetch,
                    sleep: async () => undefined,
                    download: {
                        lookup: async () => [{ address: '104.16.1.1', family: 4 }],
                        pinnedFetch: async () =>
                            new Response(png, {
                                status: 200,
                                headers: { 'content-type': 'image/png' },
                            }),
                    },
                },
                stdout: captureOutput(),
                stderr,
            },
        );
        expect(exitCode).toBe(1);
        expect(fetchImpl).toHaveBeenCalledOnce();
        expect(stderr.chunks.join('')).toMatch(
            /^Error: The callout cannot mark the subject on youtube/,
        );
        const after = readdirSync(tmpdir()).filter((name) => name.startsWith('beastcover-stock-'));
        expect(after).toEqual(before);
    });

    it('draws the ring where the pre-render check put it, even at a scale that rounds the master', async () => {
        const cwd = tempDir('beastcover-cli-callout-scale-');
        // 1200x641 进 16:10 母版的窗口宽度落在 1025.6 附近，2.02 倍的像素画布比例会把它推到另一边。
        writeFileSync(join(cwd, 'wide.png'), await testPngBytes(1200, 641));
        const focus = { x: 0.62, y: 0.41, width: 0.13, height: 0.14, source: 'saliency' as const };
        const renderHtml = mockRender();
        const exitCode = await runCli(
            [
                'node',
                'beastcover',
                'gen',
                'Look',
                '--photo',
                'wide.png',
                '--template',
                'callout',
                '--preset',
                'youtube',
                '--scale',
                '2.02',
                '--output',
                join(cwd, 'look.png'),
            ],
            {
                cwd,
                configPath: join(cwd, 'unused-config.json'),
                openRenderer: renderHtml.open,
                qc: undefined,
                photoFocus: async () => focus,
                stdout: captureOutput(),
            },
        );
        expect(exitCode).toBe(0);
        const html = renderHtml.mock.calls[0]?.[0].html ?? '';
        const drawn = /<ellipse cx="([\d.]+)" cy="([\d.]+)" rx="([\d.]+)" ry="([\d.]+)"/.exec(html);
        expect(drawn).not.toBeNull();
        const base = {
            ...familyLayout('landscape'),
            visibleArea: familyVisibleArea('landscape', ['youtube']),
            clearArea: familyClearArea('landscape', ['youtube']),
            coveredAreas: familyCoveredAreas('landscape', ['youtube']),
        };
        const photo = { width: 1200, height: 641 };
        const layout = calloutLayout(base, photo, focus);
        const expected = calloutGeometry(layout, framedFocusBox(photo, focus, layout, false));
        expect(Number(drawn?.[1])).toBeCloseTo(expected.cx, 6);
        expect(Number(drawn?.[2])).toBeCloseTo(expected.cy, 6);
        expect(Number(drawn?.[3])).toBeCloseTo(expected.rx, 6);
        expect(Number(drawn?.[4])).toBeCloseTo(expected.ry, 6);
    });

    it('refuses a non-PNG output before opening the renderer', async () => {
        const cwd = tempDir('beastcover-cli-jpg-');
        writeFileSync(join(cwd, 'wide.png'), await testPngBytes(400, 200));
        for (const args of [[], ['--photo', 'wide.png']] as const) {
            const renderHtml = mockRender();
            const stderr = captureOutput();
            const exitCode = await runCli(
                ['node', 'beastcover', 'gen', 'Headline', ...args, '--output', 'cover.jpg'],
                {
                    cwd,
                    configPath: join(cwd, 'unused-config.json'),
                    openRenderer: renderHtml.open,
                    qc: undefined,
                    photoFocus: centreFocus,
                    stdout: captureOutput(),
                    stderr,
                },
            );
            expect(exitCode, args.join(' ')).toBe(1);
            expect(stderr.chunks.join('')).toBe(
                `Error: Cover output must use the .png extension: ${join(cwd, 'cover.jpg')}\n`,
            );
            expect(renderHtml.open).not.toHaveBeenCalled();
        }
    });

    it('refuses --hook where no cover would show it', async () => {
        const directory = tempDir('beastcover-cli-hook-refuse-');
        for (const [args, message] of [
            [
                ['--preset', 'x,wechat'],
                'Error: --hook is for video and note covers, and WeChat and X article covers keep the headline. Add a video or note platform, or drop --hook.\n',
            ],
            [
                ['--width', '800', '--height', '600'],
                'Error: --hook is the short line for video and note covers. Drop --width and --height to use it.\n',
            ],
            [['--preset', 'youtube', '--hook', ' '], 'Error: --hook must not be empty.\n'],
        ] as const) {
            const stderr = captureOutput();
            const exitCode = await runCli(
                ['node', 'beastcover', 'gen', 'Headline', '--hook', 'Hook', ...args],
                {
                    cwd: directory,
                    configPath: join(directory, 'config.json'),
                    openRenderer: mockRender().open,
                    qc: undefined,
                    stdout: captureOutput(),
                    stderr,
                },
            );
            expect(exitCode).toBe(1);
            expect(stderr.chunks.join('')).toBe(message);
        }
    });

    it('prints a thumbnail warning when the headline shrinks too far in a feed', async () => {
        const directory = tempDir('beastcover-cli-thumb-');
        const renderHtml = mockRender();
        const renderer = await renderHtml.open();
        vi.mocked(renderer.fitText).mockResolvedValue(40);
        const stdout = captureOutput();

        const exitCode = await runCli(
            [
                'node',
                'beastcover',
                'gen',
                'A long headline',
                '--preset',
                'instagram',
                '--output',
                join(directory, 'ig.png'),
            ],
            {
                cwd: directory,
                configPath: join(directory, 'config.json'),
                openRenderer: renderHtml.open,
                qc: undefined,
                stdout,
            },
        );

        expect(exitCode).toBe(0);
        expect(stdout.chunks.join('')).toContain(
            'Thumbnail: the headline is 4.6px at instagram feed size (125px wide). A shorter headline reads bigger.',
        );
    });

    it('refuses a custom size with several presets or with guides', async () => {
        const directory = tempDir('beastcover-cli-custom-');
        for (const [args, message] of [
            [
                ['--preset', 'x,wechat', '--width', '800'],
                'Error: A custom --width or --height makes one cover. Pick a single --preset or drop the size override.\n',
            ],
            [
                ['--width', '800', '--guides'],
                'Error: --guides draws platform safe areas. Drop --width and --height to use it.\n',
            ],
        ] as const) {
            const renderHtml = mockRender();
            const stderr = captureOutput();
            const exitCode = await runCli(['node', 'beastcover', 'gen', 'A', ...args], {
                cwd: directory,
                configPath: join(directory, 'config.json'),
                openRenderer: renderHtml.open,
                qc: undefined,
                stdout: captureOutput(),
                stderr,
            });
            expect(exitCode).toBe(1);
            expect(stderr.chunks.join('')).toBe(message);
            expect(renderHtml).not.toHaveBeenCalled();
        }
    });

    it('puts a transparent subject on the cover and records it in history', async () => {
        const cwd = tempDir('beastcover-cli-subject-');
        const subjectPath = join(cwd, 'me.png');
        await sharp({
            create: {
                width: 40,
                height: 60,
                channels: 4,
                background: { r: 0, g: 0, b: 0, alpha: 0 },
            },
        })
            .composite([
                {
                    input: {
                        create: {
                            width: 20,
                            height: 40,
                            channels: 4,
                            background: { r: 200, g: 40, b: 40, alpha: 1 },
                        },
                    },
                    left: 10,
                    top: 20,
                },
            ])
            .png()
            .toFile(subjectPath);
        const renderHtml = mockRender();
        const cutout = vi.fn();
        const stdout = captureOutput();

        const exitCode = await runCli(['node', 'beastcover', 'gen', 'Me', '--subject', 'me.png'], {
            cwd,
            configPath: join(cwd, 'unused-config.json'),
            openRenderer: renderHtml.open,
            qc: undefined,
            cutout,
            stdout,
            now: () => new Date('2026-09-25T00:00:00.000Z'),
        });

        expect(exitCode).toBe(0);
        expect(cutout).not.toHaveBeenCalled();
        expect(renderHtml.mock.calls[0]?.[0].html).toContain('class="subject"');
        expect(stdout.chunks.join('')).toContain(
            `Subject: ${subjectPath} (used as a transparent PNG)`,
        );
    });

    it('cuts out an opaque subject photo into the temp cache', async () => {
        const cwd = tempDir('beastcover-cli-cutout-');
        // 抠图缓存按图片哈希放在全局临时目录，图片内容加随机噪声避开上次运行的缓存。
        const noisy = await sharp({
            create: {
                width: 64,
                height: 64,
                channels: 3,
                background: {
                    r: Math.floor(Math.random() * 256),
                    g: Math.floor(Math.random() * 256),
                    b: Math.floor(Math.random() * 256),
                },
            },
        })
            .png()
            .toBuffer();
        writeFileSync(join(cwd, 'me.jpg'), noisy);
        const cutout = vi.fn(async (_input: string, output: string) => {
            await sharp({
                create: {
                    width: 32,
                    height: 48,
                    channels: 4,
                    background: { r: 10, g: 20, b: 30, alpha: 1 },
                },
            })
                .png()
                .toFile(output);
        });
        const stdout = captureOutput();

        const exitCode = await runCli(['node', 'beastcover', 'gen', 'Me', '--subject', 'me.jpg'], {
            cwd,
            configPath: join(cwd, 'unused-config.json'),
            openRenderer: mockRender().open,
            qc: undefined,
            cutout,
            stdout,
        });

        expect(exitCode).toBe(0);
        expect(cutout.mock.calls[0]?.[0]).toBe(join(cwd, 'me.jpg'));
        expect(cutout.mock.calls[0]?.[1].startsWith(join(tmpdir(), 'beastcover', 'cache'))).toBe(
            true,
        );
        expect(stdout.chunks.join('')).toContain(
            'cut out on this machine with macOS Vision, saved at ',
        );
    });

    it('rejects a missing subject', async () => {
        const cwd = tempDir('beastcover-cli-subject-errors-');
        const stderr = captureOutput();
        const exitCode = await runCli(
            ['node', 'beastcover', 'gen', 'Me', '--subject', 'nobody.png'],
            {
                cwd,
                configPath: join(cwd, 'unused-config.json'),
                openRenderer: mockRender().open,
                qc: undefined,
                stdout: captureOutput(),
                stderr,
            },
        );
        expect(exitCode).toBe(1);
        expect(stderr.chunks.join('')).toBe(
            `Error: Subject not found: ${join(cwd, 'nobody.png')}\n`,
        );
    });

    it('renders each cover type from its inputs and names it in the output', async () => {
        const cwd = tempDir('beastcover-cli-templates-');
        for (const name of ['a.png', 'b.png', 'c.png']) {
            writeFileSync(join(cwd, name), await testPngBytes(64, 64));
        }

        for (const [name, args, marker] of [
            ['big-type', ['--tag', '新手必看'], 'class="eyebrow">新手必看'],
            ['number', ['--number', '3'], 'class="figure-face figure">3'],
            [
                'before-after',
                ['--photo', 'a.png', '--photo', 'b.png', '--labels', '之前,之后'],
                '>之后</div>',
            ],
            [
                'versus',
                ['--photo', 'a.png', '--photo', 'b.png', '--labels', '¥15,¥150'],
                '>VS</span>',
            ],
            [
                'collage',
                ['--photo', 'a.png', '--photo', 'b.png', '--photo', 'c.png'],
                'class="band"',
            ],
            ['mood', ['--photo', 'a.png'], 'data:image/jpeg;base64,'],
        ] as const) {
            const renderHtml = mockRender();
            const stdout = captureOutput();
            const exitCode = await runCli(
                [
                    'node',
                    'beastcover',
                    'gen',
                    '封面没人点',
                    '--template',
                    name,
                    ...args,
                    '--output',
                    join(cwd, `${name}.png`),
                ],
                {
                    cwd,
                    configPath: join(cwd, 'unused-config.json'),
                    openRenderer: renderHtml.open,
                    qc: undefined,
                    photoFocus: centreFocus,
                    stdout,
                },
            );
            expect(exitCode, name).toBe(0);
            expect(renderHtml.mock.calls[0]?.[0].html, name).toContain(marker);
            expect(existsSync(join(cwd, `${name}.png`)), name).toBe(true);
            expect(stdout.chunks.join(''), name).toContain(`Template: ${name}, `);
        }
    });

    it('picks the cover type from the inputs when --template is missing', async () => {
        const cwd = tempDir('beastcover-cli-default-type-');
        for (const name of ['a.png', 'b.png', 'c.png']) {
            writeFileSync(join(cwd, name), await testPngBytes(64, 64));
        }
        for (const [args, name] of [
            [[], 'big-type'],
            [['--photo', 'a.png'], 'scene-title'],
            [['--photo', 'a.png', '--photo', 'b.png'], 'before-after'],
            [['--photo', 'a.png', '--photo', 'b.png', '--photo', 'c.png'], 'collage'],
        ] as const) {
            const stdout = captureOutput();
            const exitCode = await runCli(
                ['node', 'beastcover', 'gen', 'Pick', ...args, '--output', join(cwd, 'pick.png')],
                {
                    cwd,
                    configPath: join(cwd, 'unused-config.json'),
                    openRenderer: mockRender().open,
                    qc: undefined,
                    photoFocus: centreFocus,
                    stdout,
                },
            );
            expect(exitCode, name).toBe(0);
            expect(stdout.chunks.join(''), name).toContain(`Template: ${name}, `);
            expect(stdout.chunks.join(''), name).toContain(
                '(picked from the inputs; set --template to choose)',
            );
        }
    });

    it('paints the scene with the configured model when there is no photo', async () => {
        const cwd = tempDir('beastcover-cli-scene-');
        const configPath = join(cwd, 'config.json');
        writeFileSync(configPath, '{"model":{"openai":{"apiKey":"o-key"}}}\n', 'utf8');
        const paintScene = fakePainter();
        const renderHtml = mockRender();
        const stdout = captureOutput();
        const exitCode = await runCli(
            [
                'node',
                'beastcover',
                'gen',
                '海边第一天',
                '--scene',
                'a harbour at dawn',
                '--preset',
                'youtube,x',
                '--output',
                join(cwd, 'scene.png'),
            ],
            {
                cwd,
                configPath,
                openRenderer: renderHtml.open,
                qc: undefined,
                paintScene,
                photoFocus: centreFocus,
                lookupCommand: () => undefined,
                stdout,
            },
        );
        expect(exitCode).toBe(0);
        // 横版和超宽共用一张横图，只画一次，画家是配了 key 的 openai。
        expect(paintScene).toHaveBeenCalledOnce();
        expect(paintScene.mock.calls[0]?.[0]).toMatchObject({ kind: 'model', provider: 'openai' });
        expect(paintScene.mock.calls[0]?.[1]).toBe('a harbour at dawn');
        expect(paintScene.mock.calls[0]?.[2]).toBe('landscape');
        expect(renderHtml.mock.calls[0]?.[0].html).toContain('data:image/jpeg;base64,');
        const out = stdout.chunks.join('');
        expect(out).toContain('Template: scene-title');
        expect(out).toContain('Scene: painted by openai');
        expect(out).toContain(
            'Privacy: the scene description went to openai with your API key. Render stayed on this machine.',
        );
    });

    it('refuses a doomed --scene run before it calls the painter', async () => {
        const cwd = tempDir('beastcover-cli-scene-early-');
        const configPath = join(cwd, 'config.json');
        writeFileSync(configPath, '{"model":{"openai":{"apiKey":"o-key"}}}\n', 'utf8');
        const paintScene = fakePainter();
        for (const [args, message] of [
            [
                ['--width', '800', '--height', '600', '--guides'],
                '--guides draws platform safe areas. Drop --width and --height to use it.',
            ],
            [['--hook', 'short', '--preset', 'x'], '--hook is for video and note covers'],
            [['--subject', 'nobody.png'], `Subject not found: ${join(cwd, 'nobody.png')}`],
        ] as const) {
            const stderr = captureOutput();
            const code = await runCli(
                ['node', 'beastcover', 'gen', 'Test', '--scene', 'sky', ...args],
                {
                    cwd,
                    configPath,
                    openRenderer: mockRender().open,
                    qc: undefined,
                    paintScene,
                    photoFocus: centreFocus,
                    lookupCommand: () => undefined,
                    stdout: captureOutput(),
                    stderr,
                },
            );
            expect(code, args.join(' ')).toBe(1);
            expect(stderr.chunks.join(''), args.join(' ')).toContain(message);
        }
        expect(paintScene).not.toHaveBeenCalled();
    });

    it('falls back to a gradient scene and says how to paint it', async () => {
        const cwd = tempDir('beastcover-cli-scene-degrade-');
        // 渐变底没有主体，不去找。
        const photoFocus = vi.fn(centreFocus);
        const stdout = captureOutput();
        const exitCode = await runCli(
            [
                'node',
                'beastcover',
                'gen',
                '海边第一天',
                '--template',
                'mood',
                '--scene',
                'a harbour at dawn',
                '--output',
                join(cwd, 'scene.png'),
            ],
            {
                cwd,
                configPath: join(cwd, 'unused-config.json'),
                openRenderer: mockRender().open,
                qc: undefined,
                photoFocus,
                lookupCommand: () => undefined,
                stdout,
            },
        );
        expect(exitCode).toBe(0);
        expect(stdout.chunks.join('')).toContain(
            'Scene: no image model key or agent CLI on this machine, so the scene is a plain colour gradient.',
        );
        expect(photoFocus).not.toHaveBeenCalled();

        for (const [args, message] of [
            [
                ['--scene', 'x', '--photo', 'a.png'],
                'Use --photo or --scene, not both. --scene paints the picture when there is no photo.',
            ],
            [
                ['--scene', 'x', '--template', 'versus'],
                '--scene paints the picture for --template scene-title, mood, face-stakes. versus needs real photos.',
            ],
            [
                ['--scene', 'x', '--via', 'codex'],
                'codex is not installed. Install it or pick another painter with --via.',
            ],
        ] as const) {
            const stderr = captureOutput();
            const code = await runCli(['node', 'beastcover', 'gen', 'A', ...args], {
                cwd,
                configPath: join(cwd, 'unused-config.json'),
                openRenderer: mockRender().open,
                qc: undefined,
                photoFocus: centreFocus,
                lookupCommand: () => undefined,
                stdout: captureOutput(),
                stderr,
            });
            expect(code, args.join(' ')).toBe(1);
            expect(stderr.chunks.join(''), args.join(' ')).toBe(`Error: ${message}\n`);
        }
    });

    it('rejects template options that do not match the template', async () => {
        const cwd = tempDir('beastcover-cli-template-errors-');
        for (const [args, message] of [
            [
                ['--template', 'banner'],
                'Unknown template "banner". Use big-type, number, face-text, face-stakes, versus, before-after, scene-title, callout, collage, mood.',
            ],
            [
                ['--tag', '新手', '--photo', 'a.png'],
                '--tag works with --template big-type, number, face-text.',
            ],
            [
                ['--template', 'big-type', '--number', '3'],
                '--number works with --template number, face-stakes.',
            ],
            [
                ['--template', 'number'],
                '--template number needs --number <figure>, like --number 3.',
            ],
            [
                ['--template', 'before-after', '--photo', 'a.png'],
                '--template before-after needs 2 --photo images. It got 1.',
            ],
            [
                ['--template', 'before-after', '--photo', 'a.png', '--photo', 'b.png'],
                `Photo not found: ${join(cwd, 'a.png')}`,
            ],
            [
                ['--template', 'versus', '--photo', 'a.png', '--photo', 'b.png'],
                '--template versus needs --labels for the two price tags, like --labels "¥15,¥1500".',
            ],
            [
                ['--template', 'number', '--number', '3', '--subject', 'me.png'],
                '--subject works with --template face-text or face-stakes. number has no person in it.',
            ],
            [
                ['--template', 'face-text'],
                '--template face-text needs --subject <path>, a photo of the person.',
            ],
        ] as const) {
            const stderr = captureOutput();
            const exitCode = await runCli(['node', 'beastcover', 'gen', 'A', ...args], {
                cwd,
                configPath: join(cwd, 'unused-config.json'),
                openRenderer: mockRender().open,
                qc: undefined,
                stdout: captureOutput(),
                stderr,
            });
            expect(exitCode, args.join(' ')).toBe(1);
            expect(stderr.chunks.join(''), args.join(' ')).toBe(`Error: ${message}\n`);
        }
    });

    it('frames the photo around its focus and applies the look', async () => {
        const cwd = tempDir('beastcover-cli-look-');
        writeFileSync(join(cwd, 'wide.png'), await testPngBytes(400, 200));
        const renderHtml = mockRender();
        const photoFocus = vi.fn(centreFocus);

        const exitCode = await runCli(
            [
                'node',
                'beastcover',
                'gen',
                'Look',
                '--photo',
                'wide.png',
                '--look',
                'duotone',
                '--fit',
                'extend',
                '--preset',
                'douyin',
                '--output',
                join(cwd, 'look.png'),
            ],
            {
                cwd,
                configPath: join(cwd, 'unused-config.json'),
                openRenderer: renderHtml.open,
                qc: undefined,
                photoFocus,
                stdout: captureOutput(),
            },
        );

        expect(exitCode).toBe(0);
        expect(photoFocus).toHaveBeenCalledOnce();
        expect(photoFocus.mock.calls[0]?.[0]).toBe(join(cwd, 'wide.png'));
        const html = renderHtml.mock.calls[0]?.[0].html ?? '';
        expect(html).toContain('class="tone tone-deep"');
        expect(html).toContain('filter: grayscale(1) contrast(1.2)');

        for (const [args, message] of [
            [
                ['--look', 'sepia', '--photo', 'wide.png'],
                'Unknown look "sepia". Use natural, mono, duotone, punch.',
            ],
            [
                ['--fit', 'stretch', '--photo', 'wide.png'],
                'Unknown fit "stretch". Use cover, extend.',
            ],
            [
                ['--look', 'mono'],
                '--look works with --template face-stakes, versus, before-after, scene-title, callout, collage, mood.',
            ],
        ] as const) {
            const stderr = captureOutput();
            const code = await runCli(['node', 'beastcover', 'gen', 'Look', ...args], {
                cwd,
                configPath: join(cwd, 'unused-config.json'),
                openRenderer: mockRender().open,
                qc: undefined,
                photoFocus,
                stdout: captureOutput(),
                stderr,
            });
            expect(code, args.join(' ')).toBe(1);
            expect(stderr.chunks.join('')).toBe(`Error: ${message}\n`);
        }
    });
});

describe('bin entry', () => {
    it('runs when invoked through a symlinked bin, not only by its real path', () => {
        // npm 装完 bin 是符号链接，argv[1] 是链接路径而 import.meta.url 是真实路径。
        // 只比对未解析的路径会让 CLI 加载却不执行，这个回归发布前一刻才被抓到。
        const source = readFileSync(new URL('./main.ts', import.meta.url), 'utf8');
        const guard = source.slice(source.lastIndexOf('const entryPath'));
        expect(guard).toContain('realpathSync');
        expect(guard.match(/realpathSync/g)).toHaveLength(2);
    });
});
