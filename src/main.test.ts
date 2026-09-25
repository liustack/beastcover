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

function mockRender() {
    return vi.fn(async (options) => ({
        pngPath: options.outputPath,
        meta: {
            width: options.width,
            height: options.height,
            scale: options.scale,
            pixelWidth: options.width * options.scale,
            pixelHeight: options.height * options.scale,
            generatedAt: '2026-08-23T00:00:00.000Z',
        },
    }));
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
        outputPath: input.outputPath,
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
        expect(listed).toContain('minimal_watercolor');
        expect(listed).toContain('memory_color_blocks');
        expect(listed).toContain('primary');
        expect(listed).toContain('fallback');
        expect(listed).toContain('luminous_impasto');
        expect(listed).toContain('cover-only');

        const detailOut = captureOutput();
        const detailCode = await runCli(['node', 'beastcover', 'styles', 'memory_color_blocks'], {
            stdout: detailOut,
        });
        expect(detailCode).toBe(0);
        const detail = detailOut.chunks.join('');
        expect(detail).toContain(loadStyle('memory_color_blocks').prompt);
        expect(detail).toContain('配色是这个式子的身份');
        expect(detail).toContain('paper: 纯白 / #ffffff');
        expect(detail).toContain('accent: 暖黄点 / #e6b84d');
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
            ['node', 'beastcover', 'new', 'demo', '--style', 'freehand_doodle'],
            { cwd, stdout },
        );

        expect(exitCode).toBe(0);
        expect(stdout.chunks.join('')).toBe(
            [
                'Created .beastcover/',
                '  project.json    your visual system, commit this',
                '  .gitignore      keeps out/, cache/, refs/ out of git',
                '  refs/ out/ cache/',
                '',
                'Nothing was written to your .gitignore or .git/info/exclude.',
                '',
            ].join('\n'),
        );
        expect(
            JSON.parse(readFileSync(join(cwd, '.beastcover', 'project.json'), 'utf8')).style,
        ).toBe('freehand_doodle');
        expect(readFileSync(join(cwd, '.gitignore'), 'utf8')).toBe('dist/\n');
        expect(readFileSync(join(cwd, '.git', 'info', 'exclude'), 'utf8')).toBe('secret\n');

        const projectOut = captureOutput();
        const projectCode = await runCli(['node', 'beastcover', 'project'], {
            cwd,
            stdout: projectOut,
        });
        expect(projectCode).toBe(0);
        expect(projectOut.chunks.join('')).toContain('Style: freehand_doodle');
        expect(projectOut.chunks.join('')).toContain('paper: 纯白 / #ffffff');
        expect(projectOut.chunks.join('')).toContain('fill: 雾蓝加陶土色 / #8a9aaa');
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
        setConfigValue('render.preset', '5:2', configPath);
        setConfigValue('render.scale', '2', configPath);

        const renderHtml = mockRender();
        const stdout = captureOutput();
        const stderr = captureOutput();

        const exitCode = await runCli(
            [
                'node',
                'beastcover',
                'gen',
                'All images belong to one visual family',
                '--source',
                'render',
                '--output',
                outputPath,
                '--width',
                '800',
            ],
            { cwd: directory, configPath, renderHtml, stdout, stderr },
        );

        expect(exitCode).toBe(0);
        expect(stderr.chunks).toEqual([]);
        expect(renderHtml).toHaveBeenCalledOnce();
        expect(renderHtml.mock.calls[0]?.[0]).toMatchObject({
            outputPath,
            width: 800,
            height: 640,
            scale: 2,
        });
        expect(renderHtml.mock.calls[0]?.[0].html).toContain(
            'All images belong to one visual family',
        );
        expect(stdout.chunks.join('')).toContain('Privacy: render stayed on this machine.');
        expect(readdirSync(directory)).not.toContain('.beastcover');
    });

    it('writes workspace gen output under .beastcover/out and records history', async () => {
        const cwd = tempDir('beastcover-cli-ws-');
        const stdout = captureOutput();
        await runCli(['node', 'beastcover', 'new', 'demo', '--style', 'minimal_watercolor'], {
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
                renderHtml,
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
        expect(renderHtml.mock.calls[0]?.[0].outputPath).toBe(outputPath);
        expect(renderHtml.mock.calls[0]?.[0].html).toContain('Workspace card');
        expect(renderHtml.mock.calls[0]?.[0].html).toContain('暖白');
        expect(renderHtml.mock.calls[0]?.[0].html).toContain('#f4efe6');
        expect(renderHtml.mock.calls[0]?.[0].html).toContain('--cover-paper: #f4efe6');
        const historyLines = readFileSync(join(cwd, '.beastcover', 'history.jsonl'), 'utf8')
            .trimEnd()
            .split('\n');
        expect(historyLines).toHaveLength(1);
        const history = JSON.parse(historyLines[0] ?? '{}');
        expect(history).toEqual({
            createdAt: '2026-08-23T00:00:00.000Z',
            style: 'minimal_watercolor',
            palette: {
                paper: { prompt: '暖白', css: '#f4efe6' },
                primary: { prompt: '低饱和雾蓝与灰青绿', css: '#7a93a0' },
                secondary: { prompt: '沙色、米白', css: '#d8cbb8' },
                accent: { prompt: '低饱和暖黄', css: '#d4b56a' },
                dark: { prompt: '淡墨', css: '#5c5a54' },
            },
            text: 'Workspace card',
            output: join('out', 'beastcover-2026-08-23T00-00-00.000Z.png'),
        });
    });

    it('requires --photo for the stock source and rejects --photo elsewhere', async () => {
        const directory = tempDir('beastcover-source-');
        const configPath = join(directory, 'config.json');
        setConfigValue('source', 'stock', configPath);
        const renderHtml = vi.fn();
        const stderr = captureOutput();

        const exitCode = await runCli(['node', 'beastcover', 'gen', 'A subject'], {
            cwd: directory,
            configPath,
            renderHtml,
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
            { cwd: directory, configPath, renderHtml, stdout: captureOutput(), stderr: renderErr },
        );
        expect(renderExit).toBe(1);
        expect(renderErr.chunks.join('')).toBe(
            'Error: --photo is only valid with --source stock.\n',
        );
    });

    it('renders a photo cover from a local image and records the photo in history', async () => {
        const cwd = tempDir('beastcover-photo-local-');
        await runCli(['node', 'beastcover', 'new', 'demo', '--style', 'minimal_watercolor'], {
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
                renderHtml,
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
                renderHtml,
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
                renderHtml,
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
                renderHtml,
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
                '3:2',
            ],
            {
                cwd,
                configPath: join(cwd, 'unused-config.json'),
                renderHtml,
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
        expect(printed).toContain('Canvas: 1536x1024');
        expect(printed).not.toContain('at 1x');
        expect(printed).toContain(
            'Privacy: local-model used your own CLI. We did not handle the data.',
        );
        expect(renderHtml).not.toHaveBeenCalled();
        expect(runLocalModel).toHaveBeenCalledOnce();
        const localInput = runLocalModel.mock.calls[0]?.[0] as
            | { prompt?: string; preset?: string; verbose?: boolean }
            | undefined;
        if (localInput === undefined) {
            throw new Error('runLocalModel was not called.');
        }
        expect(localInput).toMatchObject({
            provider: 'codex',
            commandPath: '/fake/codex',
            outputPath,
            preset: '3:2',
            verbose: false,
        });
        expect(localInput.prompt).toContain('Landscape 1536x1024');

        const historyPath = join(cwd, '.beastcover', 'history.jsonl');
        const historyText = readFileSync(historyPath, 'utf8');
        const historyLines = historyText.trimEnd().split('\n');
        expect(historyLines).toHaveLength(1);
        const palette = catalogPalette('memory_color_blocks');
        expect(JSON.parse(historyLines[0] ?? '{}')).toEqual({
            createdAt: '2026-08-23T00:00:00.000Z',
            style: 'memory_color_blocks',
            palette,
            catalogPalette: palette,
            text: 'A figure on a shore',
            source: 'local-model',
            via: 'codex',
            output: join('out', 'beastcover-2026-08-23T00-00-00.000Z.png'),
        });
        expect(historyText).not.toContain(cwd);
    });

    it('prints 16:9 production canvas and keeps generate size in the prompt', async () => {
        const cwd = tempDir('beastcover-local-16-9-');
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
                '16:9',
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
        expect(stdout.chunks.join('')).toContain('Canvas: 1600x900');
        expect(runLocalModel).toHaveBeenCalledOnce();
        const input = runLocalModel.mock.calls[0]?.[0];
        if (input === undefined) {
            throw new Error('runLocalModel was not called.');
        }
        expect(input.preset).toBe('16:9');
        expect(input.prompt).toContain('Landscape 1536x1024');
        expect(input.prompt).not.toContain('1600x900');
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
                '3:2',
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
        const runLocalModel = vi.fn(async (input: { outputPath: string }) => {
            expect(stdout.chunks.join('')).toContain(
                ['References sent to codex:', `  ${abs1}`, `  ${abs2}`].join('\n'),
            );
            return { outputPath: input.outputPath };
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

    it('prints a relationship hint for extreme_minimal_abstraction', async () => {
        const cwd = tempDir('beastcover-local-hint-');
        await runCli(
            ['node', 'beastcover', 'new', 'demo', '--style', 'extreme_minimal_abstraction'],
            {
                cwd,
                stdout: captureOutput(),
            },
        );
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
            ],
            {
                cwd,
                configPath: join(cwd, 'unused-config.json'),
                runLocalModel: mockRunLocalModel(),
                lookupCommand: () => '/fake/codex',
                stdout,
                now: () => new Date('2026-08-23T00:00:00.000Z'),
            },
        );

        expect(exitCode).toBe(0);
        expect(stdout.chunks.join('')).toContain('This style fills a relationship, not a subject.');
        expect(stdout.chunks.join('')).toContain('same event in the article');
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
                renderHtml,
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
