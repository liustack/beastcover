#!/usr/bin/env node

declare const __APP_VERSION__: string;

import { existsSync, mkdtempSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, extname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { Command, CommanderError } from 'commander';
import {
    type ComposedCover,
    type CoverTarget,
    type CoverTemplate,
    composeCovers,
    composeCustomCover,
    coverOutputPaths,
    thumbnailWarnings,
} from './compose/index.ts';
import {
    CONFIG_PATH,
    type ConfigFlags,
    type EffectiveConfig,
    IMAGE_SOURCES,
    type ImageSource,
    initConfigFile,
    LOCAL_MODEL_PROVIDERS,
    type LocalModelProvider,
    loadConfigFile,
    renderConfigShow,
    resolveEffectiveConfig,
    setConfigValue,
} from './config.ts';
import { type DoctorReport, lookupCommandOnPath, renderDoctorReport, runDoctor } from './doctor.ts';
import {
    buildEnvelopePrompt,
    runLocalModel as defaultRunLocalModel,
    getLocalModelCanvasPlan,
    resolveNamedRefFiles,
    selectLocalModelProvider,
} from './local-model/index.ts';
import {
    type FamilyName,
    getPlatform,
    PLATFORM_NAMES,
    type PlatformName,
    parsePlatformList,
} from './platforms/index.ts';
import { type CoverRenderer, openRenderer } from './render/index.ts';
import { createPhotoCoverTemplate, preparePhotoLayer } from './render/photo-cover.ts';
import { createRenderTemplate } from './render/template.ts';
import {
    fetchStockPhoto,
    isStockRef,
    STOCK_ORIENTATIONS,
    STOCK_PROVIDERS,
    type StockHit,
    type StockOrientation,
    type StockProvider,
    type StockRuntime,
    searchStock,
    stockFileStem,
} from './stock/index.ts';
import { listStyles, loadStyle } from './styles/loader.ts';
import type { StyleDefinition } from './styles/schema.ts';
import {
    appendHistory,
    createWorkspace,
    defaultWorkspaceOutputPath,
    findWorkspace,
    listHistory,
    loadStylePack,
    mergedPalette,
} from './workspace/index.ts';

const APP_VERSION = typeof __APP_VERSION__ === 'string' ? __APP_VERSION__ : '0.0.0-dev';
const DEFAULT_RENDER_TEXT = 'Your headline here';

interface OutputWriter {
    write(chunk: string): unknown;
}

export interface CliRuntime {
    stdout: OutputWriter;
    stderr: OutputWriter;
    cwd: string;
    configPath: string;
    openRenderer: () => Promise<CoverRenderer>;
    doctor: () => DoctorReport;
    now: () => Date;
    setExitCode: (code: number) => void;
    lookupCommand: (name: string) => string | undefined;
    runLocalModel: typeof defaultRunLocalModel;
    stock: Pick<StockRuntime, 'fetch' | 'sleep' | 'download'>;
}

export type CliRuntimeOverrides = Partial<CliRuntime>;

function createRuntime(overrides: CliRuntimeOverrides = {}): CliRuntime {
    const configPath = overrides.configPath ?? CONFIG_PATH;
    return {
        stdout: overrides.stdout ?? process.stdout,
        stderr: overrides.stderr ?? process.stderr,
        cwd: overrides.cwd ?? process.cwd(),
        configPath,
        openRenderer: overrides.openRenderer ?? openRenderer,
        doctor:
            overrides.doctor ??
            (() =>
                runDoctor({
                    configPath,
                    lookupCommand: overrides.lookupCommand ?? lookupCommandOnPath,
                })),
        now: overrides.now ?? (() => new Date()),
        setExitCode: overrides.setExitCode ?? (() => undefined),
        lookupCommand: overrides.lookupCommand ?? lookupCommandOnPath,
        runLocalModel: overrides.runLocalModel ?? defaultRunLocalModel,
        stock: overrides.stock ?? {},
    };
}

function parseStockProvider(value: string): StockProvider {
    if (!STOCK_PROVIDERS.includes(value as StockProvider)) {
        throw new Error(`Unknown provider "${value}". Use ${STOCK_PROVIDERS.join(', ')}.`);
    }
    return value as StockProvider;
}

function parseOrientation(value: string): StockOrientation {
    if (!STOCK_ORIENTATIONS.includes(value as StockOrientation)) {
        throw new Error(`Unknown orientation "${value}". Use ${STOCK_ORIENTATIONS.join(', ')}.`);
    }
    return value as StockOrientation;
}

function clip(value: string, width: number): string {
    const chars = Array.from(value);
    return chars.length <= width ? value : `${chars.slice(0, width - 1).join('')}…`;
}

function formatStockHit(hit: StockHit): string {
    const size = `${hit.width}x${hit.height}`;
    return `${hit.ref.padEnd(48)}${size.padEnd(12)}${clip(hit.license, 15).padEnd(16)}${clip(hit.creator, 23).padEnd(24)}${hit.thumbnail}`;
}

function creditLines(photo: {
    license?: string;
    attribution?: string;
    pageUrl?: string;
}): string[] {
    const lines: string[] = [];
    if (photo.license) {
        lines.push(`License: ${photo.license}`);
    }
    if (photo.attribution) {
        lines.push(`Credit: ${photo.attribution}`);
    }
    if (photo.pageUrl) {
        lines.push(`Source: ${photo.pageUrl}`);
    }
    return lines;
}

function parseImageSource(value: string): ImageSource {
    if (!IMAGE_SOURCES.includes(value as ImageSource)) {
        throw new Error(`Unknown source "${value}". Use ${IMAGE_SOURCES.join(', ')}.`);
    }
    return value as ImageSource;
}

function parseVia(value: string): LocalModelProvider {
    if (!LOCAL_MODEL_PROVIDERS.includes(value as LocalModelProvider)) {
        throw new Error(`Unknown via "${value}". Use ${LOCAL_MODEL_PROVIDERS.join(', ')}.`);
    }
    return value as LocalModelProvider;
}

function collectRefs(value: string, previous: string[]): string[] {
    return [...previous, value];
}

function parseIntegerOption(name: string, value: string): number {
    const parsed = Number(value);
    if (!Number.isInteger(parsed) || parsed < 1 || parsed > 10_000) {
        throw new Error(`${name} must be an integer from 1 to 10000.`);
    }
    return parsed;
}

function parseScaleOption(value: string): number {
    const parsed = Number(value);
    if (!Number.isFinite(parsed) || parsed < 1 || parsed > 4) {
        throw new Error('--scale must be a number from 1 to 4.');
    }
    return parsed;
}

function flagsFromOptions(options: {
    source?: string;
    output?: string;
    preset?: string;
    width?: string;
    height?: string;
    scale?: string;
    via?: string;
}): ConfigFlags {
    return {
        ...(options.source ? { source: parseImageSource(options.source) } : {}),
        ...(options.output ? { output: options.output } : {}),
        ...(options.preset ? { presets: parsePlatformList(options.preset) } : {}),
        ...(options.width ? { width: parseIntegerOption('--width', options.width) } : {}),
        ...(options.height ? { height: parseIntegerOption('--height', options.height) } : {}),
        ...(options.scale ? { scale: parseScaleOption(options.scale) } : {}),
        ...(options.via ? { via: parseVia(options.via) } : {}),
    };
}

function formatStyleListLine(style: StyleDefinition): string {
    const tags: string[] = [];
    if (style.isFallback) {
        tags.push('fallback');
    }
    if (style.requiresScene) {
        tags.push('needs-scene');
    }
    return `${style.name.padEnd(32)}${tags.join(' ').padEnd(22)}${style.scenarios.join('、')}`;
}

function formatStyleDetail(style: StyleDefinition): string {
    return [
        `name: ${style.name}`,
        `displayName: ${style.displayName}`,
        `fallback: ${style.isFallback ? 'yes' : 'no'}`,
        `requiresScene: ${style.requiresScene ? 'yes' : 'no'}`,
        `scenarios: ${style.scenarios.join('、')}`,
        `avoid: ${style.avoid.join('、')}`,
        `composition: ${style.composition}`,
        'palette:',
        ...style.paletteSlots.map((slot) => `  ${slot.name}: ${slot.prompt} / ${slot.css}`),
        'prompt:',
        style.prompt,
        '',
    ].join('\n');
}

type EffectiveRender = EffectiveConfig['render'];

interface WrittenCover {
    platform?: PlatformName;
    outputPath: string;
    width: number;
    height: number;
}

/** 按平台出一组封面，或给了 --width/--height 时出一张自定义画布 */
async function writeCovers(
    runtime: CliRuntime,
    text: string,
    template: CoverTemplate,
    render: EffectiveRender,
    outputPath: string,
    guides: boolean,
): Promise<{ covers: WrittenCover[]; warnings: string[] }> {
    if (render.canvas && guides) {
        throw new Error('--guides draws platform safe areas. Drop --width and --height to use it.');
    }
    const renderer = await runtime.openRenderer();
    try {
        if (render.canvas) {
            const cover = await composeCustomCover({
                renderer,
                template,
                text,
                ...render.canvas,
                scale: render.scale,
                outputPath,
            });
            return { covers: [{ outputPath: cover.outputPath, ...render.canvas }], warnings: [] };
        }
        const composed: ComposedCover[] = await composeCovers({
            renderer,
            template,
            text,
            targets: coverOutputPaths(outputPath, render.presets),
            scale: render.scale,
            guides,
        });
        return {
            covers: composed.map((cover) => {
                const platform = getPlatform(cover.platform);
                return {
                    platform: cover.platform,
                    outputPath: cover.outputPath,
                    width: platform.width,
                    height: platform.height,
                };
            }),
            warnings: thumbnailWarnings(composed),
        };
    } finally {
        await renderer.close();
    }
}

function coverLines(covers: readonly WrittenCover[], scale: number): string[] {
    return covers.flatMap((cover) => [
        `Created ${cover.outputPath}`,
        `Canvas: ${cover.width}x${cover.height} at ${scale}x`,
    ]);
}

export function createProgram(overrides: CliRuntimeOverrides = {}): Command {
    const runtime = createRuntime(overrides);
    const program = new Command();

    program
        .name('beastcover')
        .description('Make covers for every platform you publish to, rendered on your machine')
        .version(APP_VERSION)
        .showSuggestionAfterError()
        .configureOutput({
            writeOut: (text) => runtime.stdout.write(text),
            writeErr: (text) => runtime.stderr.write(text),
        })
        .exitOverride();

    program
        .command('gen')
        .description('Generate covers from a headline')
        .argument(
            '[text]',
            'Headline for the cover, or the subject for local-model',
            DEFAULT_RENDER_TEXT,
        )
        .option('--source <source>', 'Image source: render, stock, or local-model')
        .option(
            '-o, --output <path>',
            'Output PNG path. With several presets, each file gets the platform name',
        )
        .option(
            '--preset <platforms>',
            `Platform, comma list, or all: ${PLATFORM_NAMES.join(', ')}`,
        )
        .option('--width <pixels>', 'Custom canvas width instead of a platform preset')
        .option('--height <pixels>', 'Custom canvas height instead of a platform preset')
        .option('--scale <factor>', 'Device scale factor from 1 to 4')
        .option('--guides', 'Draw the safe areas on each cover for checking the layout')
        .option('--via <provider>', 'Local model CLI: codex, grok, or claude')
        .option('--ref <path>', 'Named reference image (repeatable)', collectRefs, [])
        .option(
            '--photo <ref-or-path>',
            'Stock photo ref (pexels:<id>, openverse:<id>) or a local image',
        )
        .option('--verbose', 'Print backend CLI output')
        .action(
            async (
                text: string,
                options: {
                    source?: string;
                    output?: string;
                    preset?: string;
                    width?: string;
                    height?: string;
                    scale?: string;
                    guides?: boolean;
                    via?: string;
                    ref?: string[];
                    photo?: string;
                    verbose?: boolean;
                },
            ) => {
                const flags = flagsFromOptions(options);
                const fileConfig = loadConfigFile(runtime.configPath);
                const effective = resolveEffectiveConfig(fileConfig, flags);
                const guides = Boolean(options.guides);

                if (flags.via !== undefined && effective.source !== 'local-model') {
                    throw new Error('--via is only valid with --source local-model.');
                }
                if (options.photo !== undefined && effective.source !== 'stock') {
                    throw new Error('--photo is only valid with --source stock.');
                }

                if (effective.source === 'stock') {
                    if (options.photo === undefined || options.photo.trim() === '') {
                        throw new Error(
                            'Source "stock" needs --photo <ref-or-path>. Run beastcover stock search "<query>" to pick one.',
                        );
                    }
                    const workspaceDir = findWorkspace(runtime.cwd);
                    const pack = workspaceDir ? loadStylePack(workspaceDir) : undefined;
                    const palette = pack ? mergedPalette(pack) : undefined;
                    const now = runtime.now();
                    const stockRuntime: StockRuntime = {
                        config: fileConfig.stock,
                        ...runtime.stock,
                    };

                    let photoPath: string;
                    let tempDir: string | undefined;
                    let photoMeta: {
                        ref?: string;
                        provider?: StockProvider;
                        creator?: string;
                        license?: string;
                        attribution?: string;
                        pageUrl?: string;
                    } = {};
                    if (isStockRef(options.photo)) {
                        const stem = stockFileStem(options.photo);
                        if (!workspaceDir) {
                            tempDir = mkdtempSync(join(tmpdir(), 'beastcover-stock-'));
                        }
                        const refsDir = workspaceDir
                            ? join(workspaceDir, 'refs')
                            : (tempDir as string);
                        const fetched = await fetchStockPhoto(
                            { ref: options.photo, basePath: join(refsDir, stem), now },
                            stockRuntime,
                        );
                        photoPath = fetched.imagePath;
                        photoMeta = {
                            ref: fetched.photo.ref,
                            provider: fetched.photo.provider,
                            creator: fetched.photo.creator,
                            license: fetched.photo.license,
                            attribution: fetched.photo.attribution,
                            pageUrl: fetched.photo.pageUrl,
                        };
                    } else {
                        photoPath = resolve(runtime.cwd, options.photo);
                        if (!existsSync(photoPath)) {
                            throw new Error(`Photo not found: ${photoPath}`);
                        }
                    }

                    const outputPath = flags.output
                        ? flags.output
                        : workspaceDir
                          ? defaultWorkspaceOutputPath(workspaceDir, now)
                          : effective.output;
                    const paletteOption = palette ? { palette } : {};
                    const template: CoverTemplate = {
                        measureHtml: (layout, headline) =>
                            createPhotoCoverTemplate(text, {
                                layout,
                                headline,
                                measure: true,
                                ...paletteOption,
                            }),
                        renderHtml: async (layout, headline, pixelWidth, pixelHeight) =>
                            createPhotoCoverTemplate(text, {
                                layout,
                                headline,
                                photo: await preparePhotoLayer(photoPath, pixelWidth, pixelHeight),
                                ...paletteOption,
                            }),
                    };
                    let written: Awaited<ReturnType<typeof writeCovers>>;
                    try {
                        written = await writeCovers(
                            runtime,
                            text,
                            template,
                            effective.render,
                            outputPath,
                            guides,
                        );
                    } finally {
                        if (tempDir !== undefined) {
                            rmSync(tempDir, { recursive: true, force: true });
                        }
                    }

                    if (workspaceDir && pack) {
                        for (const cover of written.covers) {
                            appendHistory(workspaceDir, {
                                createdAt: now.toISOString(),
                                style: pack.style,
                                palette: palette ?? {},
                                text,
                                source: 'stock',
                                ...(cover.platform ? { preset: cover.platform } : {}),
                                output: cover.outputPath,
                                photo: { path: photoPath, ...photoMeta },
                            });
                        }
                    }

                    runtime.stdout.write(
                        [
                            ...coverLines(written.covers, effective.render.scale),
                            ...written.warnings,
                            `Photo: ${photoMeta.ref ?? photoPath}`,
                            ...creditLines(photoMeta),
                            photoMeta.provider
                                ? `Privacy: the photo was downloaded from ${photoMeta.provider}. Render stayed on this machine.`
                                : 'Privacy: render stayed on this machine.',
                            '',
                        ].join('\n'),
                    );
                    return;
                }

                if (effective.source === 'local-model') {
                    const workspaceDir = findWorkspace(runtime.cwd);
                    if (workspaceDir === undefined) {
                        throw new Error(
                            'No BeastCover workspace found. Run beastcover new <name> first.',
                        );
                    }
                    if (effective.render.canvas) {
                        throw new Error(
                            'local-model uses preset sizes. Omit --width and --height.',
                        );
                    }
                    if (guides) {
                        throw new Error('--guides works with --source render or stock.');
                    }
                    const pack = loadStylePack(workspaceDir);
                    const style = loadStyle(pack.style);
                    const palette = mergedPalette(pack);
                    const catalogPalette = Object.fromEntries(
                        style.paletteSlots.map((slot) => [
                            slot.name,
                            { prompt: slot.prompt, css: slot.css },
                        ]),
                    );
                    const selected = selectLocalModelProvider({
                        via: flags.via,
                        configVia: effective.localModel?.via,
                        lookup: runtime.lookupCommand,
                    });
                    const refs = resolveNamedRefFiles(options.ref ?? [], runtime.cwd);
                    if (refs.length > 0) {
                        runtime.stdout.write(
                            `References sent to ${selected.provider}:\n${refs
                                .map((path) => `  ${path}`)
                                .join('\n')}\n`,
                        );
                    }

                    const now = runtime.now();
                    const outputPath = resolve(
                        runtime.cwd,
                        flags.output ?? defaultWorkspaceOutputPath(workspaceDir, now),
                    );
                    // 一族只调一次模型：原图存进 cache/，族内各平台从同一张图裁。
                    const byFamily = new Map<FamilyName, CoverTarget[]>();
                    for (const target of coverOutputPaths(outputPath, effective.render.presets)) {
                        const family = getPlatform(target.platform).family;
                        byFamily.set(family, [...(byFamily.get(family) ?? []), target]);
                    }
                    const stem = basename(outputPath, extname(outputPath));
                    const lines: string[] = [];
                    for (const [family, targets] of byFamily) {
                        const generatedPath = join(workspaceDir, 'cache', `${stem}-${family}.png`);
                        const prompt = buildEnvelopePrompt({
                            style,
                            subject: text,
                            mergedPalette: palette,
                            generatedPath,
                            family,
                            provider: selected.provider,
                            referencePaths: refs,
                        });
                        await runtime.runLocalModel({
                            provider: selected.provider,
                            commandPath: selected.commandPath,
                            prompt,
                            referencePaths: refs,
                            generatedPath,
                            targets: targets.map((target) => ({
                                preset: target.platform,
                                outputPath: target.outputPath,
                            })),
                            verbose: Boolean(options.verbose),
                            backendOutput: runtime.stderr,
                        });
                        for (const target of targets) {
                            appendHistory(workspaceDir, {
                                createdAt: now.toISOString(),
                                style: pack.style,
                                palette,
                                catalogPalette,
                                text,
                                source: 'local-model',
                                via: selected.provider,
                                preset: target.platform,
                                output: target.outputPath,
                            });
                            const plan = getLocalModelCanvasPlan(target.platform);
                            lines.push(
                                `Created ${target.outputPath}`,
                                `Canvas: ${plan.outputWidth}x${plan.outputHeight}`,
                            );
                        }
                    }

                    runtime.stdout.write(
                        [
                            ...lines,
                            `Backend: ${selected.provider}`,
                            'Privacy: local-model used your own CLI. We did not handle the data.',
                            '',
                        ].join('\n'),
                    );
                    return;
                }

                const workspaceDir = findWorkspace(runtime.cwd);
                const pack = workspaceDir ? loadStylePack(workspaceDir) : undefined;
                const palette = pack ? mergedPalette(pack) : undefined;
                const now = runtime.now();
                const outputPath = flags.output
                    ? flags.output
                    : workspaceDir
                      ? defaultWorkspaceOutputPath(workspaceDir, now)
                      : effective.output;
                const paletteOption = palette ? { palette } : {};
                const template: CoverTemplate = {
                    measureHtml: (layout, headline) =>
                        createRenderTemplate(text, {
                            layout,
                            headline,
                            measure: true,
                            ...paletteOption,
                        }),
                    renderHtml: async (layout, headline) =>
                        createRenderTemplate(text, { layout, headline, ...paletteOption }),
                };
                const written = await writeCovers(
                    runtime,
                    text,
                    template,
                    effective.render,
                    outputPath,
                    guides,
                );

                if (workspaceDir && pack) {
                    for (const cover of written.covers) {
                        appendHistory(workspaceDir, {
                            createdAt: now.toISOString(),
                            style: pack.style,
                            palette: palette ?? {},
                            text,
                            ...(cover.platform ? { preset: cover.platform } : {}),
                            output: cover.outputPath,
                        });
                    }
                }

                runtime.stdout.write(
                    [
                        ...coverLines(written.covers, effective.render.scale),
                        ...written.warnings,
                        'Privacy: render stayed on this machine.',
                        '',
                    ].join('\n'),
                );
            },
        );

    const stock = program
        .command('stock')
        .description('Search and fetch free stock photos for photo covers');

    stock
        .command('search')
        .description('Search Pexels (with a key) or Openverse cc0/pdm photos')
        .argument('<query>', 'Two to four concrete English words')
        .option('--provider <name>', `Force a provider: ${STOCK_PROVIDERS.join(', ')}`)
        .option('--orientation <name>', `Filter: ${STOCK_ORIENTATIONS.join(', ')}`)
        .action(async (query: string, options: { provider?: string; orientation?: string }) => {
            const fileConfig = loadConfigFile(runtime.configPath);
            const { provider, hits } = await searchStock(
                {
                    query,
                    ...(options.provider ? { provider: parseStockProvider(options.provider) } : {}),
                    ...(options.orientation
                        ? { orientation: parseOrientation(options.orientation) }
                        : {}),
                },
                { config: fileConfig.stock, ...runtime.stock },
            );
            const lines = [`Provider: ${provider}`];
            if (hits.length === 0) {
                lines.push(`No ${provider} results for "${query.trim()}".`);
            } else {
                lines.push(...hits.map(formatStockHit));
                lines.push(
                    'Pick one by eye, then run: beastcover gen "<text>" --source stock --photo <ref>',
                );
            }
            runtime.stdout.write(`${lines.join('\n')}\n`);
        });

    stock
        .command('fetch')
        .description('Download one photo and its provenance sidecar')
        .argument('<ref>', 'pexels:<id> or openverse:<id>')
        .option('--dir <directory>', 'Target directory (defaults to .beastcover/refs/)')
        .action(async (ref: string, options: { dir?: string }) => {
            const fileConfig = loadConfigFile(runtime.configPath);
            const workspaceDir = findWorkspace(runtime.cwd);
            const targetDir = options.dir
                ? resolve(runtime.cwd, options.dir)
                : workspaceDir
                  ? join(workspaceDir, 'refs')
                  : undefined;
            if (targetDir === undefined) {
                throw new Error(
                    'No BeastCover workspace found. Pass --dir <directory> or run beastcover new <name> first.',
                );
            }
            const fetched = await fetchStockPhoto(
                { ref, basePath: join(targetDir, stockFileStem(ref)), now: runtime.now() },
                { config: fileConfig.stock, ...runtime.stock },
            );
            runtime.stdout.write(
                [
                    `Saved ${fetched.imagePath}`,
                    `Sidecar: ${fetched.sidecar}`,
                    `Size: ${fetched.photo.width}x${fetched.photo.height}`,
                    ...creditLines(fetched.photo),
                    '',
                ].join('\n'),
            );
        });

    program
        .command('new')
        .description('Create a cover workspace in this project')
        .argument('<name>', 'Project name')
        .option('--style <style>', 'Catalog style name')
        .action((name: string, options: { style?: string }) => {
            createWorkspace(runtime.cwd, {
                name,
                styleName: options.style,
            });
            runtime.stdout.write(
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
        });

    program
        .command('project')
        .description('Show the current cover workspace')
        .action(() => {
            const workspaceDir = findWorkspace(runtime.cwd);
            if (!workspaceDir) {
                throw new Error('No BeastCover workspace found. Run beastcover new <name> first.');
            }

            const pack = loadStylePack(workspaceDir);
            const palette = mergedPalette(pack);
            runtime.stdout.write(
                [
                    `Project: ${pack.name}`,
                    `Path: ${workspaceDir}`,
                    `Style: ${pack.style}`,
                    `Composition: ${pack.composition}`,
                    'Palette:',
                    ...Object.entries(palette).map(
                        ([slot, value]) => `  ${slot}: ${value.prompt} / ${value.css}`,
                    ),
                    `Images: ${listHistory(workspaceDir).length}`,
                    '',
                ].join('\n'),
            );
        });

    program
        .command('styles')
        .description('List built-in styles or print one style')
        .argument('[name]', 'Style name')
        .action((name?: string) => {
            if (name) {
                runtime.stdout.write(formatStyleDetail(loadStyle(name)));
                return;
            }

            runtime.stdout.write(`${listStyles().map(formatStyleListLine).join('\n')}\n`);
        });

    const config = program
        .command('config')
        .description(`Manage layered settings in ${runtime.configPath}`)
        .action(() => {
            config.outputHelp();
        });

    config
        .command('init')
        .description('Create a private starter config')
        .option('--force', 'Replace an existing config file')
        .action((options: { force?: boolean }) => {
            initConfigFile(runtime.configPath, Boolean(options.force));
            runtime.stdout.write(`Created ${runtime.configPath} with mode 600.\n`);
        });

    config
        .command('set')
        .description('Set a typed config value')
        .argument('<key>', 'Config key')
        .argument('<value>', 'Config value')
        .action((key: string, value: string) => {
            setConfigValue(key, value, runtime.configPath);
            runtime.stdout.write(`Saved ${key} to ${runtime.configPath}.\n`);
        });

    config
        .command('show')
        .description('Print effective settings with secrets redacted')
        .action(() => {
            runtime.stdout.write(`${renderConfigShow(loadConfigFile(runtime.configPath))}\n`);
        });

    program
        .command('doctor')
        .description('Run offline checks for Node.js, Chromium, and config permissions')
        .action(() => {
            const report = runtime.doctor();
            runtime.stdout.write(`${renderDoctorReport(report)}\n`);
            if (!report.healthy) {
                runtime.setExitCode(1);
            }
        });

    return program;
}

export async function runCli(
    argv: string[] = process.argv,
    overrides: CliRuntimeOverrides = {},
): Promise<number> {
    let exitCode = 0;
    const runtime = createRuntime({
        ...overrides,
        setExitCode: (code) => {
            exitCode = Math.max(exitCode, code);
            overrides.setExitCode?.(code);
        },
    });
    const program = createProgram(runtime);

    try {
        await program.parseAsync(argv);
    } catch (error) {
        if (error instanceof CommanderError) {
            return error.exitCode;
        }
        runtime.stderr.write(`Error: ${error instanceof Error ? error.message : String(error)}\n`);
        return 1;
    }

    return exitCode;
}

// npm 装完 bin 是符号链接，argv[1] 是链接路径而 import.meta.url 是解析后的真实路径，
// 直接比对会判定自己不是入口，于是 CLI 加载了却不执行。两边都取真实路径再比。
const entryPath = process.argv[1]
    ? pathToFileURL(realpathSync(resolve(process.argv[1]))).href
    : undefined;
if (entryPath === pathToFileURL(realpathSync(fileURLToPath(import.meta.url))).href) {
    process.exitCode = await runCli();
}
