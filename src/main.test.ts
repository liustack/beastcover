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
import { join, resolve } from 'node:path';
import sharp from 'sharp';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { setConfigValue } from './config.ts';
import type { LocalModelRunInput } from './local-model/index.ts';
import { createProgram, runCli } from './main.ts';
import type { CoverRenderer, RenderPage } from './render/index.ts';
import { loadStyle } from './styles/loader.ts';

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
    };
    return Object.assign(screenshot, { open: vi.fn(async () => renderer) });
}

async function testPngBytes(width: number, height: number): Promise<Buffer> {
    return sharp({
        create: { width, height, channels: 3, background: { r: 40, g: 80, b: 120 } },
    })
        .png()
        .toBuffer();
}

function mockRunLocalModel() {
    return vi.fn(async (input: LocalModelRunInput) => ({
        outputPaths: input.targets.map((target) => target.outputPath),
    }));
}

function catalogPalette(styleName: string) {
    const style = loadStyle(styleName);
    return Object.fromEntries(
        style.paletteSlots.map((slot) => [slot.name, { prompt: slot.prompt, css: slot.css }]),
    );
}

describe('BeastCover CLI', () => {
    it('registers every first-phase command', () => {
        const program = createProgram();
        expect(program.commands.map((command) => command.name())).toEqual([
            'gen',
            'stock',
            'new',
            'project',
            'styles',
            'config',
            'doctor',
        ]);
        const stock = program.commands.find((command) => command.name() === 'stock');
        expect(stock?.commands.map((command) => command.name())).toEqual(['search', 'fetch']);
    });

    it('lists styles and prints a style prompt unchanged', async () => {
        const stdout = captureOutput();
        const listCode = await runCli(['node', 'beastcover', 'styles'], { stdout });
        expect(listCode).toBe(0);
        const listed = stdout.chunks.join('');
        const lines = listed.trimEnd().split('\n');
        expect(lines.map((line) => line.split(/\s+/)[0])).toEqual([
            'risograph_editorial',
            'luminous_impasto',
            'torn_paper_editorial_collage',
            'conceptual_colorfield',
        ]);
        expect(lines[0]).toContain('fallback');
        expect(lines[1]).toContain('needs-scene');

        const detailOut = captureOutput();
        const detailCode = await runCli(['node', 'beastcover', 'styles', 'risograph_editorial'], {
            stdout: detailOut,
        });
        expect(detailCode).toBe(0);
        const detail = detailOut.chunks.join('');
        expect(detail).toContain(loadStyle('risograph_editorial').prompt);
        expect(detail).toContain('paper: 亮白 / #ffffff');
        expect(detail).toContain('spot: 荧光粉加靛蓝、或亮蓝加荧光橙、或青加荧光粉加黄 / #ff48a5');
        expect(detail).toContain('composition: 2026-08-23 实测定案');
        expect(detail).not.toContain('tier');
        expect(detail).not.toContain('defaultValue');

        const unknownOut = captureOutput();
        const unknownErr = captureOutput();
        const unknownCode = await runCli(['node', 'beastcover', 'styles', 'unknown'], {
            stdout: unknownOut,
            stderr: unknownErr,
        });
        expect(unknownCode).toBe(1);
        expect(unknownErr.chunks.join('')).toContain('Unknown style "unknown"');
    });

    it('creates a workspace with new and shows it with project', async () => {
        const cwd = tempDir('beastcover-cli-new-');
        mkdirSync(join(cwd, '.git', 'info'), { recursive: true });
        writeFileSync(join(cwd, '.gitignore'), 'dist/\n', 'utf8');
        writeFileSync(join(cwd, '.git', 'info', 'exclude'), 'secret\n', 'utf8');
        const stdout = captureOutput();

        const exitCode = await runCli(
            ['node', 'beastcover', 'new', 'demo', '--style', 'conceptual_colorfield'],
            { cwd, stdout },
        );

        expect(exitCode).toBe(0);
        expect(stdout.chunks.join('')).toBe(
            [
                'Created .beastcover/',
                '  project.json    style and palette, commit this',
                '  .gitignore      keeps out/, cache/, refs/ out of git',
                '  refs/ out/ cache/',
                '',
                'Nothing was written to your .gitignore or .git/info/exclude.',
                '',
            ].join('\n'),
        );
        expect(
            JSON.parse(readFileSync(join(cwd, '.beastcover', 'project.json'), 'utf8')).style,
        ).toBe('conceptual_colorfield');
        expect(readFileSync(join(cwd, '.gitignore'), 'utf8')).toBe('dist/\n');
        expect(readFileSync(join(cwd, '.git', 'info', 'exclude'), 'utf8')).toBe('secret\n');

        const projectOut = captureOutput();
        const projectCode = await runCli(['node', 'beastcover', 'project'], {
            cwd,
            stdout: projectOut,
        });
        expect(projectCode).toBe(0);
        expect(projectOut.chunks.join('')).toContain('Style: conceptual_colorfield');
        expect(projectOut.chunks.join('')).toContain('background: 暖白 / #f4efe6');
        expect(projectOut.chunks.join('')).toContain('accent: 柔和暖色 / #d4a574');
        expect(projectOut.chunks.join('')).toContain(
            'Composition: 色域铺满整幅画布，负空间由大面积色块自身承担。',
        );
        expect(projectOut.chunks.join('')).toContain('Images: 0');
    });

    it('tells project to run new instead of creating a workspace', async () => {
        const cwd = tempDir('beastcover-cli-missing-');
        const stdout = captureOutput();
        const stderr = captureOutput();
        const exitCode = await runCli(['node', 'beastcover', 'project'], { cwd, stdout, stderr });

        expect(exitCode).toBe(1);
        expect(stderr.chunks.join('')).toBe(
            'Error: No BeastCover workspace found. Run beastcover new <name> first.\n',
        );
        expect(stdout.chunks).toEqual([]);
        expect(readdirSync(cwd)).toEqual([]);
    });

    it('runs gen through the local renderer with CLI flags above file config', async () => {
        const directory = tempDir('beastcover-cli-');
        const configPath = join(directory, 'config.json');
        const outputPath = join(directory, 'result.png');
        setConfigValue('source', 'stock', configPath);
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
                '--source',
                'render',
                '--output',
                outputPath,
                '--width',
                '800',
            ],
            { cwd: directory, configPath, openRenderer: renderHtml.open, stdout, stderr },
        );

        expect(exitCode).toBe(0);
        expect(stderr.chunks).toEqual([]);
        expect(renderHtml).toHaveBeenCalledOnce();
        expect(renderHtml.mock.calls[0]?.[0]).toMatchObject({ width: 800, height: 368, scale: 2 });
        expect(renderHtml.mock.calls[0]?.[0].html).toContain('One headline for every platform');
        const meta = await sharp(outputPath).metadata();
        expect([meta.width, meta.height]).toEqual([1600, 736]);
        expect(stdout.chunks.join('')).toContain(`Created ${outputPath}\nCanvas: 800x368 at 2x`);
        expect(stdout.chunks.join('')).toContain('Privacy: render stayed on this machine.');
        expect(readdirSync(directory)).not.toContain('.beastcover');
    });

    it('writes workspace gen output under .beastcover/out and records history', async () => {
        const cwd = tempDir('beastcover-cli-ws-');
        const stdout = captureOutput();
        await runCli(['node', 'beastcover', 'new', 'demo', '--style', 'conceptual_colorfield'], {
            cwd,
            stdout,
        });

        const renderHtml = mockRender();
        const genOut = captureOutput();
        const now = new Date('2026-08-23T00:00:00.000Z');
        const exitCode = await runCli(
            ['node', 'beastcover', 'gen', 'Workspace card', '--source', 'render'],
            {
                cwd,
                configPath: join(cwd, 'unused-config.json'),
                openRenderer: renderHtml.open,
                stdout: genOut,
                now: () => now,
            },
        );

        expect(exitCode).toBe(0);
        const outputPath = join(
            cwd,
            '.beastcover',
            'out',
            'beastcover-2026-08-23T00-00-00.000Z.png',
        );
        expect(existsSync(outputPath)).toBe(true);
        expect(genOut.chunks.join('')).toContain(`Created ${outputPath}\nCanvas: 1280x720 at 1x`);
        expect(renderHtml.mock.calls[0]?.[0]).toMatchObject({
            width: 1920,
            height: 1200,
            scale: 2,
        });
        expect(renderHtml.mock.calls[0]?.[0].html).toContain('Workspace card');
        expect(renderHtml.mock.calls[0]?.[0].html).toContain('暖白');
        expect(renderHtml.mock.calls[0]?.[0].html).toContain('--cover-paper: #f4efe6');
        expect(renderHtml.mock.calls[0]?.[0].html).toContain('--cover-ink: #3a3a38');
        const historyLines = readFileSync(join(cwd, '.beastcover', 'history.jsonl'), 'utf8')
            .trimEnd()
            .split('\n');
        expect(historyLines).toHaveLength(1);
        const history = JSON.parse(historyLines[0] ?? '{}');
        expect(history).toEqual({
            createdAt: '2026-08-23T00:00:00.000Z',
            style: 'conceptual_colorfield',
            palette: catalogPalette('conceptual_colorfield'),
            text: 'Workspace card',
            preset: 'youtube',
            output: join('out', 'beastcover-2026-08-23T00-00-00.000Z.png'),
        });
    });

    it('requires --photo for the stock source and rejects --photo elsewhere', async () => {
        const directory = tempDir('beastcover-source-');
        const configPath = join(directory, 'config.json');
        setConfigValue('source', 'stock', configPath);
        const renderHtml = mockRender();
        const stderr = captureOutput();

        const exitCode = await runCli(['node', 'beastcover', 'gen', 'A subject'], {
            cwd: directory,
            configPath,
            openRenderer: renderHtml.open,
            stdout: captureOutput(),
            stderr,
        });
        expect(exitCode).toBe(1);
        expect(renderHtml).not.toHaveBeenCalled();
        expect(stderr.chunks.join('')).toBe(
            'Error: Source "stock" needs --photo <ref-or-path>. Run beastcover stock search "<query>" to pick one.\n',
        );

        const renderErr = captureOutput();
        const renderExit = await runCli(
            ['node', 'beastcover', 'gen', 'A', '--source', 'render', '--photo', 'x.jpg'],
            {
                cwd: directory,
                configPath,
                openRenderer: renderHtml.open,
                stdout: captureOutput(),
                stderr: renderErr,
            },
        );
        expect(renderExit).toBe(1);
        expect(renderErr.chunks.join('')).toBe(
            'Error: --photo is only valid with --source stock.\n',
        );
    });

    it('renders a photo cover from a local image and records the photo in history', async () => {
        const cwd = tempDir('beastcover-photo-local-');
        await runCli(['node', 'beastcover', 'new', 'demo', '--style', 'conceptual_colorfield'], {
            cwd,
            stdout: captureOutput(),
        });
        const photoPath = join(cwd, 'sea.png');
        writeFileSync(photoPath, await testPngBytes(64, 32));

        const renderHtml = mockRender();
        const stdout = captureOutput();
        const now = new Date('2026-09-23T00:00:00.000Z');
        const exitCode = await runCli(
            ['node', 'beastcover', 'gen', 'Dawn tide', '--source', 'stock', '--photo', 'sea.png'],
            {
                cwd,
                configPath: join(cwd, 'unused-config.json'),
                openRenderer: renderHtml.open,
                stdout,
                now: () => now,
            },
        );

        expect(exitCode).toBe(0);
        const html = renderHtml.mock.calls[0]?.[0].html ?? '';
        expect(html).toContain('Dawn tide');
        expect(html).toContain('data:image/jpeg;base64,');
        expect(html).toContain('--cover-paper: #f4efe6');
        expect(stdout.chunks.join('')).toContain(`Photo: ${photoPath}`);
        expect(stdout.chunks.join('')).toContain('Privacy: render stayed on this machine.');

        const history = JSON.parse(
            readFileSync(join(cwd, '.beastcover', 'history.jsonl'), 'utf8').trim(),
        );
        expect(history).toMatchObject({
            source: 'stock',
            text: 'Dawn tide',
            photo: { path: photoPath },
        });
    });

    it('fetches a stock ref into .beastcover/refs and renders it as the cover', async () => {
        const cwd = tempDir('beastcover-photo-ref-');
        await runCli(['node', 'beastcover', 'new', 'demo'], { cwd, stdout: captureOutput() });
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
            [
                'node',
                'beastcover',
                'gen',
                'Quiet harbour',
                '--source',
                'stock',
                '--photo',
                'openverse:a1',
            ],
            {
                cwd,
                configPath: join(cwd, 'unused-config.json'),
                openRenderer: renderHtml.open,
                stdout,
                now: () => now,
                stock,
            },
        );

        expect(exitCode).toBe(0);
        const refPath = join(cwd, '.beastcover', 'refs', 'openverse-a1.png');
        expect(existsSync(refPath)).toBe(true);
        expect(JSON.parse(readFileSync(`${refPath}.json`, 'utf8'))).toMatchObject({
            ref: 'openverse:a1',
            license: 'cc0',
            creator: 'Ada',
        });
        expect(renderHtml.mock.calls[0]?.[0].html).toContain('Quiet harbour');
        const out = stdout.chunks.join('');
        expect(out).toContain('Photo: openverse:a1');
        expect(out).toContain('License: cc0');
        expect(out).not.toContain('Credit:');
        expect(out).toContain('Source: https://flickr.example/a1');
        expect(out).toContain('Privacy: the photo was downloaded from openverse.');

        const history = JSON.parse(
            readFileSync(join(cwd, '.beastcover', 'history.jsonl'), 'utf8').trim(),
        );
        expect(history.photo).toEqual({
            path: refPath,
            ref: 'openverse:a1',
            provider: 'openverse',
            creator: 'Ada',
            license: 'cc0',
            attribution: '',
            pageUrl: 'https://flickr.example/a1',
        });
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

    it('stock fetch needs a workspace or --dir and never creates one', async () => {
        const cwd = tempDir('beastcover-stock-fetch-');
        const stderr = captureOutput();
        const exitCode = await runCli(['node', 'beastcover', 'stock', 'fetch', 'openverse:a1'], {
            cwd,
            configPath: join(cwd, 'unused-config.json'),
            stdout: captureOutput(),
            stderr,
            stock: { fetch: vi.fn() as unknown as typeof fetch },
        });

        expect(exitCode).toBe(1);
        expect(existsSync(join(cwd, '.beastcover'))).toBe(false);
        expect(stderr.chunks.join('')).toBe(
            'Error: No BeastCover workspace found. Pass --dir <directory> or run beastcover new <name> first.\n',
        );
    });

    it('rejects --via when the source is render and does not switch to local-model', async () => {
        const directory = tempDir('beastcover-via-render-');
        const renderHtml = mockRender();
        const runLocalModel = mockRunLocalModel();
        const lookupCommand = vi.fn(() => '/fake/grok');

        const flagged = captureOutput();
        const flaggedErr = captureOutput();
        const flaggedCode = await runCli(
            ['node', 'beastcover', 'gen', 'A figure', '--via', 'grok', '--source', 'render'],
            {
                cwd: directory,
                configPath: join(directory, 'unused-config.json'),
                openRenderer: renderHtml.open,
                runLocalModel,
                lookupCommand,
                stdout: flagged,
                stderr: flaggedErr,
            },
        );
        expect(flaggedCode).toBe(1);
        expect(renderHtml).not.toHaveBeenCalled();
        expect(runLocalModel).not.toHaveBeenCalled();
        expect(flaggedErr.chunks.join('')).toContain('--via');
        expect(flaggedErr.chunks.join('')).toMatch(/local-model/);

        const implicit = captureOutput();
        const implicitErr = captureOutput();
        const implicitCode = await runCli(
            ['node', 'beastcover', 'gen', 'A figure', '--via', 'grok'],
            {
                cwd: directory,
                configPath: join(directory, 'unused-config.json'),
                openRenderer: renderHtml.open,
                runLocalModel,
                lookupCommand,
                stdout: implicit,
                stderr: implicitErr,
            },
        );
        expect(implicitCode).toBe(1);
        expect(renderHtml).not.toHaveBeenCalled();
        expect(runLocalModel).not.toHaveBeenCalled();
        expect(implicitErr.chunks.join('')).toContain('--via');
        expect(implicitErr.chunks.join('')).toMatch(/local-model/);
    });

    it('requires a workspace for local-model and does not create one', async () => {
        const cwd = tempDir('beastcover-local-missing-ws-');
        const runLocalModel = mockRunLocalModel();
        const stdout = captureOutput();
        const stderr = captureOutput();
        const exitCode = await runCli(
            ['node', 'beastcover', 'gen', 'A figure on a shore', '--source', 'local-model'],
            {
                cwd,
                configPath: join(cwd, 'unused-config.json'),
                runLocalModel,
                lookupCommand: () => '/fake/codex',
                stdout,
                stderr,
            },
        );

        expect(exitCode).toBe(1);
        expect(stderr.chunks.join('')).toBe(
            'Error: No BeastCover workspace found. Run beastcover new <name> first.\n',
        );
        expect(runLocalModel).not.toHaveBeenCalled();
        expect(existsSync(join(cwd, '.beastcover'))).toBe(false);
        expect(readdirSync(cwd)).toEqual([]);
    });

    it('runs gen through local-model with an injected runner', async () => {
        const cwd = tempDir('beastcover-local-happy-');
        await runCli(['node', 'beastcover', 'new', 'demo'], { cwd, stdout: captureOutput() });

        const renderHtml = mockRender();
        const runLocalModel = mockRunLocalModel();
        const stdout = captureOutput();
        const stderr = captureOutput();
        const now = new Date('2026-08-23T00:00:00.000Z');
        const exitCode = await runCli(
            [
                'node',
                'beastcover',
                'gen',
                'A figure on a shore',
                '--source',
                'local-model',
                '--via',
                'codex',
                '--preset',
                'wechat',
            ],
            {
                cwd,
                configPath: join(cwd, 'unused-config.json'),
                openRenderer: renderHtml.open,
                runLocalModel,
                lookupCommand: (name) => (name === 'codex' ? '/fake/codex' : undefined),
                stdout,
                stderr,
                now: () => now,
            },
        );

        const outputPath = join(
            cwd,
            '.beastcover',
            'out',
            'beastcover-2026-08-23T00-00-00.000Z.png',
        );
        const printed = stdout.chunks.join('');
        expect(exitCode).toBe(0);
        expect(stderr.chunks).toEqual([]);
        expect(printed).toContain(`Created ${outputPath}`);
        expect(printed).toContain('Backend: codex');
        expect(printed).toContain('Canvas: 900x383');
        expect(printed).not.toContain('at 1x');
        expect(printed).toContain(
            'Privacy: local-model used your own CLI. We did not handle the data.',
        );
        expect(renderHtml).not.toHaveBeenCalled();
        expect(runLocalModel).toHaveBeenCalledOnce();
        const localInput = runLocalModel.mock.calls[0]?.[0];
        if (localInput === undefined) {
            throw new Error('runLocalModel was not called.');
        }
        const generatedPath = join(
            cwd,
            '.beastcover',
            'cache',
            'beastcover-2026-08-23T00-00-00.000Z-ultrawide.png',
        );
        expect(localInput).toMatchObject({
            provider: 'codex',
            commandPath: '/fake/codex',
            generatedPath,
            targets: [{ preset: 'wechat', outputPath }],
            verbose: false,
        });
        expect(localInput.prompt).toContain(`save it to ${generatedPath}. `);
        expect(localInput.prompt).toContain(
            '主体集中在画面正中的窄横带内，四周只放背景. Landscape 1536x1024',
        );

        const historyPath = join(cwd, '.beastcover', 'history.jsonl');
        const historyText = readFileSync(historyPath, 'utf8');
        const historyLines = historyText.trimEnd().split('\n');
        expect(historyLines).toHaveLength(1);
        const palette = catalogPalette('risograph_editorial');
        expect(JSON.parse(historyLines[0] ?? '{}')).toEqual({
            createdAt: '2026-08-23T00:00:00.000Z',
            style: 'risograph_editorial',
            palette,
            catalogPalette: palette,
            text: 'A figure on a shore',
            source: 'local-model',
            via: 'codex',
            preset: 'wechat',
            output: join('out', 'beastcover-2026-08-23T00-00-00.000Z.png'),
        });
        expect(historyText).not.toContain(cwd);
    });

    it('prints the douyin production canvas and keeps generate size in the prompt', async () => {
        const cwd = tempDir('beastcover-local-douyin-');
        await runCli(['node', 'beastcover', 'new', 'demo'], { cwd, stdout: captureOutput() });

        const runLocalModel = mockRunLocalModel();
        const stdout = captureOutput();
        const stderr = captureOutput();
        const now = new Date('2026-08-23T00:00:00.000Z');
        const exitCode = await runCli(
            [
                'node',
                'beastcover',
                'gen',
                'A figure on a shore',
                '--source',
                'local-model',
                '--preset',
                'douyin',
            ],
            {
                cwd,
                configPath: join(cwd, 'unused-config.json'),
                runLocalModel,
                lookupCommand: () => '/fake/codex',
                stdout,
                stderr,
                now: () => now,
            },
        );

        expect(exitCode).toBe(0);
        expect(stderr.chunks).toEqual([]);
        expect(stdout.chunks.join('')).toContain('Canvas: 1080x1920');
        expect(runLocalModel).toHaveBeenCalledOnce();
        const input = runLocalModel.mock.calls[0]?.[0];
        if (input === undefined) {
            throw new Error('runLocalModel was not called.');
        }
        expect(input.targets.map((target) => target.preset)).toEqual(['douyin']);
        expect(input.prompt).toContain('竖版 1024x1536');
        expect(input.prompt).not.toContain('1080x1920');
    });

    it('passes verbose true to runLocalModel', async () => {
        const cwd = tempDir('beastcover-local-verbose-');
        await runCli(['node', 'beastcover', 'new', 'demo'], { cwd, stdout: captureOutput() });
        const runLocalModel = mockRunLocalModel();
        const exitCode = await runCli(
            [
                'node',
                'beastcover',
                'gen',
                'A figure on a shore',
                '--source',
                'local-model',
                '--via',
                'codex',
                '--preset',
                'wechat',
                '--verbose',
            ],
            {
                cwd,
                configPath: join(cwd, 'unused-config.json'),
                runLocalModel,
                lookupCommand: (name) => (name === 'codex' ? '/fake/codex' : undefined),
                stdout: captureOutput(),
                now: () => new Date('2026-08-23T00:00:00.000Z'),
            },
        );

        expect(exitCode).toBe(0);
        expect(runLocalModel.mock.calls[0]?.[0]).toMatchObject({ verbose: true });
    });

    it('writes one cover per platform from one master per family', async () => {
        const cwd = tempDir('beastcover-cli-multi-');
        await runCli(['node', 'beastcover', 'new', 'demo'], { cwd, stdout: captureOutput() });
        const renderHtml = mockRender();
        const stdout = captureOutput();
        const now = new Date('2026-09-25T00:00:00.000Z');

        const exitCode = await runCli(
            [
                'node',
                'beastcover',
                'gen',
                'Beast',
                '--source',
                'render',
                '--preset',
                'x,wechat,douyin',
            ],
            {
                cwd,
                configPath: join(cwd, 'unused-config.json'),
                openRenderer: renderHtml.open,
                stdout,
                now: () => now,
            },
        );

        expect(exitCode).toBe(0);
        expect(renderHtml.mock.calls.map(([page]) => [page.width, page.height])).toEqual([
            [1920, 368],
            [1080, 1920],
        ]);
        const stem = join(cwd, '.beastcover', 'out', 'beastcover-2026-09-25T00-00-00.000Z');
        const printed = stdout.chunks.join('');
        for (const [platform, size] of [
            ['wechat', [900, 383]],
            ['x', [1920, 368]],
            ['douyin', [1080, 1920]],
        ] as const) {
            const path = `${stem}-${platform}.png`;
            const meta = await sharp(path).metadata();
            expect([meta.width, meta.height], platform).toEqual([...size]);
            expect(printed).toContain(`Created ${path}\nCanvas: ${size[0]}x${size[1]} at 1x`);
        }
        const history = readFileSync(join(cwd, '.beastcover', 'history.jsonl'), 'utf8')
            .trimEnd()
            .split('\n')
            .map((line) => JSON.parse(line) as { preset: string; output: string });
        expect(history.map((record) => [record.preset, record.output])).toEqual([
            ['wechat', join('out', 'beastcover-2026-09-25T00-00-00.000Z-wechat.png')],
            ['x', join('out', 'beastcover-2026-09-25T00-00-00.000Z-x.png')],
            ['douyin', join('out', 'beastcover-2026-09-25T00-00-00.000Z-douyin.png')],
        ]);
        expect(renderHtml.open).toHaveBeenCalledOnce();
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
                '--source',
                'render',
                '--preset',
                'instagram',
                '--output',
                join(directory, 'ig.png'),
            ],
            {
                cwd: directory,
                configPath: join(directory, 'config.json'),
                openRenderer: renderHtml.open,
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
            const exitCode = await runCli(
                ['node', 'beastcover', 'gen', 'A', '--source', 'render', ...args],
                {
                    cwd: directory,
                    configPath: join(directory, 'config.json'),
                    openRenderer: renderHtml.open,
                    stdout: captureOutput(),
                    stderr,
                },
            );
            expect(exitCode).toBe(1);
            expect(stderr.chunks.join('')).toBe(message);
            expect(renderHtml).not.toHaveBeenCalled();
        }
    });

    it('calls the model once per family and crops every platform from that image', async () => {
        const cwd = tempDir('beastcover-local-families-');
        await runCli(['node', 'beastcover', 'new', 'demo'], { cwd, stdout: captureOutput() });
        const runLocalModel = mockRunLocalModel();
        const stdout = captureOutput();

        const exitCode = await runCli(
            [
                'node',
                'beastcover',
                'gen',
                'A figure on a shore',
                '--source',
                'local-model',
                '--via',
                'codex',
                '--preset',
                'x,douyin,wechat,xiaohongshu',
            ],
            {
                cwd,
                configPath: join(cwd, 'unused-config.json'),
                runLocalModel,
                lookupCommand: () => '/fake/codex',
                stdout,
                now: () => new Date('2026-09-25T00:00:00.000Z'),
            },
        );

        expect(exitCode).toBe(0);
        const stem = 'beastcover-2026-09-25T00-00-00.000Z';
        expect(
            runLocalModel.mock.calls.map(([input]) => [
                input.generatedPath,
                input.targets.map((target) => target.preset),
            ]),
        ).toEqual([
            [join(cwd, '.beastcover', 'cache', `${stem}-ultrawide.png`), ['wechat', 'x']],
            [join(cwd, '.beastcover', 'cache', `${stem}-portrait.png`), ['xiaohongshu', 'douyin']],
        ]);
        const printed = stdout.chunks.join('');
        expect(printed).toContain(
            `Created ${join(cwd, '.beastcover', 'out', `${stem}-douyin.png`)}\nCanvas: 1080x1920`,
        );
        expect(printed.match(/Backend: codex/g)).toHaveLength(1);
        const history = readFileSync(join(cwd, '.beastcover', 'history.jsonl'), 'utf8')
            .trimEnd()
            .split('\n');
        expect(history).toHaveLength(4);
    });

    it('names the platform preset when an old ratio preset is passed', async () => {
        const renderHtml = mockRender();
        const stderr = captureOutput();
        const exitCode = await runCli(
            ['node', 'beastcover', 'gen', 'A', '--source', 'render', '--preset', '16:9'],
            {
                cwd: tempDir('beastcover-old-preset-'),
                configPath: join(tempDir('beastcover-old-preset-config-'), 'config.json'),
                openRenderer: renderHtml.open,
                stdout: captureOutput(),
                stderr,
            },
        );

        expect(exitCode).toBe(1);
        expect(renderHtml).not.toHaveBeenCalled();
        expect(stderr.chunks.join('')).toBe('Error: Preset "16:9" is now "youtube".\n');
    });

    it('rejects local-model width overrides that leave preset sizes', async () => {
        const cwd = tempDir('beastcover-local-width-');
        await runCli(['node', 'beastcover', 'new', 'demo'], { cwd, stdout: captureOutput() });
        const runLocalModel = mockRunLocalModel();
        const stderr = captureOutput();
        const exitCode = await runCli(
            [
                'node',
                'beastcover',
                'gen',
                'A figure on a shore',
                '--source',
                'local-model',
                '--width',
                '800',
            ],
            {
                cwd,
                configPath: join(cwd, 'unused-config.json'),
                runLocalModel,
                lookupCommand: () => '/fake/codex',
                stdout: captureOutput(),
                stderr,
            },
        );

        expect(exitCode).toBe(1);
        expect(runLocalModel).not.toHaveBeenCalled();
        expect(stderr.chunks.join('')).toBe(
            'Error: local-model uses preset sizes. Omit --width and --height.\n',
        );
    });

    it('prints named --ref paths before calling runLocalModel', async () => {
        const cwd = tempDir('beastcover-local-refs-');
        await runCli(['node', 'beastcover', 'new', 'demo'], { cwd, stdout: captureOutput() });
        const abs1 = resolve(cwd, 'a.png');
        const abs2 = resolve(cwd, 'b.jpg');
        writeFileSync(abs1, 'png', 'utf8');
        writeFileSync(abs2, 'jpg', 'utf8');

        const stdout = captureOutput();
        const runLocalModel = vi.fn(async (input: LocalModelRunInput) => {
            expect(stdout.chunks.join('')).toContain(
                ['References sent to codex:', `  ${abs1}`, `  ${abs2}`].join('\n'),
            );
            return { outputPaths: input.targets.map((target) => target.outputPath) };
        });

        const exitCode = await runCli(
            [
                'node',
                'beastcover',
                'gen',
                'A figure on a shore',
                '--source',
                'local-model',
                '--via',
                'codex',
                '--ref',
                abs1,
                '--ref',
                abs2,
            ],
            {
                cwd,
                configPath: join(cwd, 'unused-config.json'),
                runLocalModel,
                lookupCommand: () => '/fake/codex',
                stdout,
                now: () => new Date('2026-08-23T00:00:00.000Z'),
            },
        );

        expect(exitCode).toBe(0);
        expect(runLocalModel).toHaveBeenCalledOnce();
    });

    it('allows --via when config source is already local-model', async () => {
        const cwd = tempDir('beastcover-local-config-via-');
        const configPath = join(cwd, 'config.json');
        await runCli(['node', 'beastcover', 'new', 'demo'], { cwd, stdout: captureOutput() });
        setConfigValue('source', 'local-model', configPath);

        const renderHtml = mockRender();
        const runLocalModel = mockRunLocalModel();
        const stdout = captureOutput();
        const stderr = captureOutput();
        const exitCode = await runCli(
            ['node', 'beastcover', 'gen', 'A figure on a shore', '--via', 'grok'],
            {
                cwd,
                configPath,
                openRenderer: renderHtml.open,
                runLocalModel,
                lookupCommand: (name) => (name === 'grok' ? '/fake/grok' : undefined),
                stdout,
                stderr,
                now: () => new Date('2026-08-23T00:00:00.000Z'),
            },
        );

        expect(exitCode).toBe(0);
        expect(stderr.chunks).toEqual([]);
        expect(renderHtml).not.toHaveBeenCalled();
        expect(runLocalModel).toHaveBeenCalledOnce();
        expect(runLocalModel.mock.calls[0]?.[0]).toMatchObject({
            provider: 'grok',
            commandPath: '/fake/grok',
        });
        expect(stdout.chunks.join('')).toContain('Backend: grok');
    });

    it('does not fall back from an explicit missing --via grok to codex', async () => {
        const cwd = tempDir('beastcover-local-via-missing-');
        await runCli(['node', 'beastcover', 'new', 'demo'], { cwd, stdout: captureOutput() });
        const runLocalModel = mockRunLocalModel();
        const stdout = captureOutput();
        const stderr = captureOutput();
        const lookupCommand = vi.fn((name: string) =>
            name === 'codex' ? '/fake/codex' : undefined,
        );

        const exitCode = await runCli(
            [
                'node',
                'beastcover',
                'gen',
                'A figure on a shore',
                '--source',
                'local-model',
                '--via',
                'grok',
            ],
            {
                cwd,
                configPath: join(cwd, 'unused-config.json'),
                runLocalModel,
                lookupCommand,
                stdout,
                stderr,
            },
        );

        expect(exitCode).toBe(1);
        expect(runLocalModel).not.toHaveBeenCalled();
        expect(stderr.chunks.join('')).toContain('grok');
        expect(stderr.chunks.join('')).not.toMatch(/falling back|using codex/i);
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
