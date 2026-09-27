#!/usr/bin/env node

declare const __APP_VERSION__: string;

import { existsSync, mkdirSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { basename, dirname, extname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { Command, CommanderError, Option } from 'commander';
import sharp from 'sharp';
import {
    buildEnvelopePrompt,
    runAgent as defaultRunAgent,
    getAgentCanvasPlan,
    resolveNamedRefFiles,
    selectAgentProvider,
} from './agent/index.ts';
import { assertRedrawable, remixModeFor } from './agent/remix.ts';
import {
    type ComposedCover,
    type CoverTarget,
    type CoverTemplate,
    checkCallout,
    composeCovers,
    composeCustomCover,
    coverOutputPaths,
    focusCropWarnings,
    headlineLengthWarnings,
    MAX_PHOTO_STRETCH,
    photoStretchWarnings,
    type QcRuntime,
    textOnlyWarnings,
    thumbnailWarnings,
} from './compose/index.ts';
import {
    AGENT_PROVIDERS,
    type AgentProvider,
    CONFIG_PATH,
    type ConfigFlags,
    type EffectiveConfig,
    IMAGE_SOURCES,
    type ImageSource,
    initConfigFile,
    loadConfigFile,
    MODEL_PROVIDERS,
    type ModelProvider,
    renderConfigShow,
    resolveEffectiveConfig,
    setConfigValue,
} from './config.ts';
import { type DoctorReport, lookupCommandOnPath, renderDoctorReport, runDoctor } from './doctor.ts';
import {
    checkGenreInputs,
    defaultGenre,
    GENRE_NAMES,
    GENRES,
    type GenreName,
    genreTemplate,
    parseGenre,
} from './genres/index.ts';
import { parseFigure, parseHook, parseTag } from './genres/options.ts';
import { type FontKit, fontKit, type GenrePhoto } from './genres/page.ts';
import { parseScheme, SCHEME_NAMES, SCHEMES, type SchemeName } from './genres/schemes.ts';
import { parseLabels } from './genres/split.ts';
import { runModelApi as defaultRunModelApi, selectModelProvider } from './model/index.ts';
import { buildModelPrompt } from './model/prompt.ts';
import { newRunDir, tempCacheDir, tempRefsDir } from './paths.ts';
import {
    FAMILY_NAMES,
    type FamilyName,
    getPlatform,
    PLATFORM_NAMES,
    type PlatformName,
    parsePlatformList,
} from './platforms/index.ts';
import { formatFindings } from './qc/index.ts';
import { feedPreview } from './qc/preview.ts';
import { probeFamilies, proberFrom } from './render/fonts.ts';
import { type CoverRenderer, openRenderer } from './render/index.ts';
import {
    PHOTO_LOOKS,
    type PhotoFit,
    type PhotoLook,
    parsePhotoFit,
    parsePhotoLook,
} from './render/photo-cover.ts';
import { parseEmphasis, stripEmphasis } from './render/type.ts';
import {
    findScenePainter,
    gradientScene,
    painterLabel,
    paintScene,
    parseScene,
    SCENE_DEGRADED,
    type ScenePainter,
    sceneOrientation,
} from './scene/index.ts';
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
import { mergedPalette, packFor } from './styles/pack.ts';
import type { StyleDefinition } from './styles/schema.ts';
import { findPhotoFocus } from './subject/focus.ts';
import {
    prepareSubject,
    type SubjectLayer,
    visionCutoutUnavailable,
    visionSubjectCutout,
} from './subject/index.ts';
import {
    type PhotoFocus,
    type VisionCutoutRuntime,
    visionAnalyze,
    visionFocus,
} from './subject/vision.ts';

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
    doctor: () => Promise<DoctorReport>;
    now: () => Date;
    setExitCode: (code: number) => void;
    lookupCommand: (name: string) => string | undefined;
    runAgent: typeof defaultRunAgent;
    runModelApi: typeof defaultRunModelApi;
    /** 质检的画面分析，本机没有 Vision 或被关掉时为 undefined。键始终存在，二次组装运行时不会又打开 */
    qc: QcRuntime | undefined;
    stock: Pick<StockRuntime, 'fetch' | 'sleep' | 'download'>;
    /** 把普通照片里的主体抠成透明 PNG，默认用 macOS Vision */
    cutout: (inputPath: string, outputPath: string) => Promise<void>;
    /** 照片主体在哪：macOS 上用 Vision 找人脸和显著区域，其他系统用 sharp */
    photoFocus: (imagePath: string) => Promise<PhotoFocus>;
}

export type CliRuntimeOverrides = Partial<CliRuntime>;

function createRuntime(overrides: CliRuntimeOverrides = {}): CliRuntime {
    const configPath = overrides.configPath ?? CONFIG_PATH;
    const stderr = overrides.stderr ?? process.stderr;
    const vision = {
        platform: process.platform,
        binDir: join(dirname(configPath), 'bin'),
        lookupCommand: overrides.lookupCommand ?? lookupCommandOnPath,
        // 沙箱写不进 home 时降级临时目录，这行提示教 agent 怎么替用户申请持久权限。
        note: (line: string) => stderr.write(`${line}\n`),
    };
    return {
        stdout: overrides.stdout ?? process.stdout,
        stderr,
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
        runAgent: overrides.runAgent ?? defaultRunAgent,
        runModelApi: overrides.runModelApi ?? defaultRunModelApi,
        qc: qcRuntimeFor(overrides, vision),
        stock: overrides.stock ?? {},
        cutout: overrides.cutout ?? visionSubjectCutout(vision),
        photoFocus:
            overrides.photoFocus ??
            ((imagePath) =>
                findPhotoFocus(imagePath, {
                    ...(visionCutoutUnavailable(vision) === undefined
                        ? { vision: (path: string) => visionFocus(path, vision) }
                        : {}),
                })),
    };
}

const QC_PICTURE_SKIPPED =
    'QC: the picture check (faces, people, and text under the headline) needs macOS 14+ Vision, so it was skipped. Look at every cover before you ship.';

function isTerminal(writer: OutputWriter): boolean {
    return (writer as { isTTY?: boolean }).isTTY === true;
}

/** 质检的画面分析：测试里可以注入或关掉（qc: undefined），真跑时有 Vision 才开 */
function qcRuntimeFor(
    overrides: CliRuntimeOverrides,
    vision: VisionCutoutRuntime,
): QcRuntime | undefined {
    if ('qc' in overrides) {
        return overrides.qc;
    }
    if (visionCutoutUnavailable(vision) !== undefined) {
        return {};
    }
    return {
        async analyze(background) {
            const dir = newRunDir();
            const path = join(dir, 'qc-background.png');
            writeFileSync(path, background);
            try {
                return await visionAnalyze(path, vision);
            } finally {
                rmSync(dir, { recursive: true, force: true });
            }
        },
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

function sizeLine(fetched: { width: number; height: number; photo: StockHit }): string {
    const size = `Size: ${fetched.width}x${fetched.height}`;
    return fetched.width === fetched.photo.width && fetched.height === fetched.photo.height
        ? size
        : `${size} (the host served a smaller copy than the listed ${fetched.photo.width}x${fetched.photo.height})`;
}

function parseImageSource(value: string): ImageSource {
    if (value === 'local-model') {
        throw new Error('Source "local-model" is now "agent".');
    }
    if (!IMAGE_SOURCES.includes(value as ImageSource)) {
        throw new Error(`Unknown source "${value}". Use ${IMAGE_SOURCES.join(', ')}.`);
    }
    return value as ImageSource;
}

function parseVia(value: string): AgentProvider | ModelProvider {
    if (value === 'grok' || value === 'claude') {
        throw new Error(
            `via "${value}" was removed: the ${value} CLI has no image generation. Use codex or agy.`,
        );
    }
    if (
        !AGENT_PROVIDERS.includes(value as AgentProvider) &&
        !MODEL_PROVIDERS.includes(value as ModelProvider)
    ) {
        throw new Error(
            `Unknown via "${value}". Use ${AGENT_PROVIDERS.join(', ')} with --source agent, or ${MODEL_PROVIDERS.join(', ')} with --source model.`,
        );
    }
    return value as AgentProvider | ModelProvider;
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

/**
 * 超宽族（公众号、X 文章）的卡片上标题挨着封面，封面放完整一句。其余族是视频和笔记的封面，
 * 给了 --hook 时放这句短的钩子。
 */
function coverLine(platform: PlatformName, text: string, hook: string | undefined): string {
    return hook !== undefined && getPlatform(platform).family !== 'ultrawide' ? hook : text;
}

/** 画布、--guides、--hook 的组合对不对。下载照片、抠图、画场景之前先查，别为必然失败的命令花时间和额度 */
function checkCoverRequest(
    render: EffectiveRender,
    guides: boolean,
    hook: string | undefined,
): void {
    if (render.canvas && guides) {
        throw new Error('--guides draws platform safe areas. Drop --width and --height to use it.');
    }
    if (hook !== undefined && render.canvas) {
        throw new Error(
            '--hook is the short line for video and note covers. Drop --width and --height to use it.',
        );
    }
    if (
        hook !== undefined &&
        render.presets.every((name) => getPlatform(name).family === 'ultrawide')
    ) {
        throw new Error(
            '--hook is for video and note covers, and WeChat and X article covers keep the headline. Add a video or note platform, or drop --hook.',
        );
    }
}

/** 按平台出一组封面，或给了 --width/--height 时出一张自定义画布 */
async function writeCovers(
    runtime: CliRuntime,
    text: string,
    templateFor: (line: string, fonts: FontKit) => CoverTemplate,
    render: EffectiveRender,
    outputPath: string,
    guides: boolean,
    hook?: string,
): Promise<{ covers: WrittenCover[]; warnings: string[] }> {
    checkCoverRequest(render, guides, hook);
    const renderer = await runtime.openRenderer();
    try {
        // 本机装了哪些字体、覆不覆盖标题里的字：在出图的同一个 Chromium 里探一次，按角色挑。
        const fonts = fontKit(
            proberFrom(
                await renderer.probeFonts(
                    stripEmphasis([text, hook ?? ''].join(' ')),
                    probeFamilies(),
                ),
            ),
        );
        if (render.canvas) {
            const cover = await composeCustomCover({
                renderer,
                template: templateFor(text, fonts),
                text: stripEmphasis(text),
                ...render.canvas,
                scale: render.scale,
                outputPath,
                ...(runtime.qc === undefined ? {} : { qc: runtime.qc }),
            });
            return {
                covers: [{ outputPath: cover.outputPath, ...render.canvas }],
                warnings: [
                    ...(cover.moved
                        ? [
                              'Layout: the headline moved to its other spot on the canvas, where it covers less of the picture.',
                          ]
                        : []),
                    ...fonts.notes(),
                    ...(runtime.qc === undefined
                        ? []
                        : formatFindings(cover.findings, isTerminal(runtime.stdout))),
                    ...(runtime.qc !== undefined && runtime.qc.analyze === undefined
                        ? [QC_PICTURE_SKIPPED]
                        : []),
                ],
            };
        }
        const targets = coverOutputPaths(outputPath, render.presets);
        const lines = [...new Set(targets.map((target) => coverLine(target.platform, text, hook)))];
        const byPlatform = new Map<PlatformName, ComposedCover>();
        for (const line of lines) {
            const group = await composeCovers({
                renderer,
                template: templateFor(line, fonts),
                text: stripEmphasis(line),
                targets: targets.filter(
                    (target) => coverLine(target.platform, text, hook) === line,
                ),
                scale: render.scale,
                guides,
                ...(runtime.qc === undefined ? {} : { qc: runtime.qc }),
            });
            for (const cover of group) {
                byPlatform.set(cover.platform, cover);
            }
        }
        const composed = targets.map((target) => {
            const cover = byPlatform.get(target.platform);
            if (cover === undefined) {
                throw new Error(`No cover was composed for ${target.platform}.`);
            }
            return cover;
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
            warnings: [
                ...headlineLengthWarnings(
                    stripEmphasis(coverLine('youtube', text, hook)),
                    render.presets,
                ),
                ...thumbnailWarnings(composed),
                ...(composed.some((cover) => cover.moved)
                    ? [
                          `Layout: the headline moved to its other spot on ${composed
                              .filter((cover) => cover.moved)
                              .map((cover) => cover.platform)
                              .join(', ')}, where it covers less of the picture.`,
                      ]
                    : []),
                ...fonts.notes(),
                ...formatFindings(
                    composed.flatMap((cover) => cover.findings),
                    isTerminal(runtime.stdout),
                ),
                ...(runtime.qc !== undefined && runtime.qc.analyze === undefined
                    ? [QC_PICTURE_SKIPPED]
                    : []),
                ...(runtime.qc === undefined
                    ? []
                    : [
                          `Preview: ${await feedPreview(composed)} (every cover at its feed size; look at each one before you ship)`,
                      ]),
            ],
        };
    } finally {
        await renderer.close();
    }
}

/**
 * 成品路径：--output 优先，其次配置里的默认（当前目录下）。裁好的成品一律是 PNG，
 * 渲染和调模型都慢，所以在动手之前就拦下别的扩展名。
 */
function coverOutputPath(runtime: CliRuntime, flags: ConfigFlags, fallback: string): string {
    const path = resolve(runtime.cwd, flags.output ?? fallback);
    if (extname(path).toLowerCase() !== '.png') {
        throw new Error(`Cover output must use the .png extension: ${path}`);
    }
    return path;
}

function coverLines(covers: readonly WrittenCover[], scale: number): string[] {
    return covers.flatMap((cover) => [
        `Created ${cover.outputPath}`,
        `Canvas: ${cover.width}x${cover.height} at ${scale}x`,
    ]);
}

/** 转正后的尺寸：EXIF 方向 5 到 8 表示要转 90 度，宽高互换 */
async function imageSize(path: string): Promise<{ width: number; height: number }> {
    const meta = await sharp(path, { failOn: 'error' }).metadata();
    if (meta.width === undefined || meta.height === undefined) {
        throw new Error(`Cannot read the image size of ${path}.`);
    }
    return (meta.orientation ?? 1) >= 5
        ? { width: meta.height, height: meta.width }
        : { width: meta.width, height: meta.height };
}

function stretchLines(
    photo: { width: number; height: number },
    render: EffectiveRender,
    fit: PhotoFit,
): string[] {
    if (render.canvas === undefined) {
        return photoStretchWarnings(photo, render.presets, render.scale, fit);
    }
    // cover 按铺满算，extend 按整张放进画布算。
    const fill =
        fit === 'extend'
            ? Math.min(render.canvas.width / photo.width, render.canvas.height / photo.height)
            : Math.max(render.canvas.width / photo.width, render.canvas.height / photo.height);
    const stretch = fill * render.scale;
    return stretch > MAX_PHOTO_STRETCH
        ? [
              `Photo: ${photo.width}x${photo.height} is stretched ${stretch.toFixed(1)}x on the ${render.canvas.width}x${render.canvas.height} canvas. A larger photo stays sharp.`,
          ]
        : [];
}

interface LoadedSubject {
    path: string;
    layer: SubjectLayer;
}

async function loadSubject(
    runtime: CliRuntime,
    subjectOption: string | undefined,
): Promise<LoadedSubject | undefined> {
    if (subjectOption === undefined) {
        return undefined;
    }
    const path = resolve(runtime.cwd, subjectOption);
    if (!existsSync(path)) {
        throw new Error(`Subject not found: ${path}`);
    }
    const cacheDir = tempCacheDir();
    return {
        path,
        layer: await prepareSubject(path, {
            cacheDir,
            cutout: runtime.cutout,
            // 只在真的找到脸时按脸裁。没有 Vision 的系统找的是显著区域，不算脸。
            findFace: async (imagePath) => {
                const focus = await runtime.photoFocus(imagePath);
                return focus.source === 'faces' ? focus : undefined;
            },
        }),
    };
}

function subjectLine(subject: LoadedSubject | undefined): string[] {
    if (subject === undefined) {
        return [];
    }
    const how =
        subject.layer.method === 'transparent'
            ? 'used as a transparent PNG'
            : `cut out on this machine with macOS Vision, saved at ${subject.layer.cutoutPath}`;
    return [`Subject: ${subject.path} (${how})`];
}

interface PhotoCredit {
    ref?: string;
    provider?: StockProvider;
    creator?: string;
    license?: string;
    attribution?: string;
    pageUrl?: string;
}

interface LoadedPhoto {
    photo: GenrePhoto;
    credit: PhotoCredit;
}

/** 一张 --photo：图库编号就下载进临时目录（项目零残留），本地路径就检查存在，再量尺寸、找主体 */
async function loadPhoto(
    runtime: CliRuntime,
    value: string,
    stockRuntime: StockRuntime,
): Promise<LoadedPhoto> {
    let path: string;
    let credit: PhotoCredit = {};
    if (isStockRef(value)) {
        const refsDir = tempRefsDir();
        mkdirSync(refsDir, { recursive: true });
        const fetched = await fetchStockPhoto(
            { ref: value, basePath: join(refsDir, stockFileStem(value)), now: runtime.now() },
            stockRuntime,
        );
        path = fetched.imagePath;
        credit = {
            ref: fetched.photo.ref,
            provider: fetched.photo.provider,
            creator: fetched.photo.creator,
            license: fetched.photo.license,
            attribution: fetched.photo.attribution,
            pageUrl: fetched.photo.pageUrl,
        };
    } else {
        path = resolve(runtime.cwd, value);
        if (!existsSync(path)) {
            throw new Error(`Photo not found: ${path}`);
        }
    }
    const size = await imageSize(path);
    return { photo: { path, ...size, focus: await runtime.photoFocus(path) }, credit };
}

function photoLines(photos: readonly LoadedPhoto[]): string[] {
    return photos.flatMap(({ photo, credit }) => [
        credit.ref === undefined
            ? `Photo: ${photo.path}`
            : `Photo: ${credit.ref} (saved at ${photo.path})`,
        ...creditLines(credit),
    ]);
}

// 能用 --scene 现画场景的类型：一张满版的场景照片。圈注要圈真实的主体，对比和拼图要真实的几张。
const SCENE_GENRES: ReadonlySet<GenreName> = new Set(['scene-title', 'mood', 'face-stakes']);

// 只有一张满版照片的类型：照片放大和主体被裁的提醒按整张画布算。
const FULL_BLEED: ReadonlySet<GenreName> = new Set([
    'face-stakes',
    'scene-title',
    'callout',
    'mood',
]);

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
            'Headline for the cover, or the subject for agent and model',
            DEFAULT_RENDER_TEXT,
        )
        .option('--source <source>', 'Image source: render, stock, agent, or model')
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
        .option('--via <provider>', 'Backend: codex or agy for agent, openai or gemini for model')
        .option('--style <name>', 'Catalog style for this run (see beastcover styles)')
        .option('--ref <path>', 'Named reference image (repeatable)', collectRefs, [])
        .option(
            '--remix <path>',
            'agent: one image to redraw in the project style, or two (person, then scene) to combine',
            collectRefs,
            [],
        )
        .option(
            '--photo <ref-or-path>',
            'Stock photo ref (pexels:<id>, openverse:<id>) or a local image (repeatable for versus, before-after, collage)',
            collectRefs,
            [],
        )
        .option(
            '--subject <path>',
            'Person for face-text and face-stakes: a transparent PNG, or a photo to cut out on macOS',
        )
        .option(
            '--scene <description>',
            'scene-title, mood, face-stakes with no --photo: the picture to paint with your image model key or agent CLI',
        )
        .option('--template <name>', `Cover type: ${GENRE_NAMES.join(', ')}`)
        .option('--scheme <name>', `Colour scheme: ${SCHEME_NAMES.join(', ')}`)
        .option('--tag <text>', 'big-type, number, face-text: a short label above the headline')
        .option(
            '--number <figure>',
            'number: the big figure, like 3 or 90%. face-stakes: the stakes sign, like $10,000',
        )
        .option(
            '--labels <first,second>',
            'versus: the two price tags. before-after: a label for each side',
        )
        .option('--look <name>', `Photo colour: ${PHOTO_LOOKS.join(', ')}`)
        .option(
            '--fit <mode>',
            'Full-bleed photo framing: cover (crop, default) or extend (keep the whole photo)',
        )
        .option(
            '--hook <text>',
            'A short line for the video and note covers. WeChat and X article covers keep the headline',
        )
        .addOption(new Option('--callout').hideHelp())
        .addOption(new Option('--before <path>').hideHelp())
        .addOption(new Option('--after <path>').hideHelp())
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
                    style?: string;
                    ref?: string[];
                    remix?: string[];
                    photo?: string[];
                    scene?: string;
                    subject?: string;
                    template?: string;
                    scheme?: string;
                    hook?: string;
                    callout?: boolean;
                    look?: string;
                    fit?: string;
                    tag?: string;
                    number?: string;
                    before?: string;
                    after?: string;
                    labels?: string;
                    verbose?: boolean;
                },
            ) => {
                // 换掉的旗标报错时指到新写法。
                if (options.callout === true) {
                    throw new Error(
                        '--callout is now a template. Use --template callout --photo <photo>.',
                    );
                }
                if (options.before !== undefined || options.after !== undefined) {
                    throw new Error(
                        '--before and --after were replaced. Use --template before-after --photo <before> --photo <after>.',
                    );
                }
                const flags = flagsFromOptions(options);
                const fileConfig = loadConfigFile(runtime.configPath);
                const effective = resolveEffectiveConfig(fileConfig, flags);
                const guides = Boolean(options.guides);
                const rendered = effective.source === 'render' || effective.source === 'stock';

                // --via 在 render 和 stock 里只用来点名画场景的后端。
                if (flags.via !== undefined && rendered && options.scene === undefined) {
                    throw new Error(
                        '--via is only valid with --source agent or model, or with --scene to name the painter.',
                    );
                }
                if ((options.remix ?? []).length > 0 && effective.source !== 'agent') {
                    throw new Error('--remix works with --source agent.');
                }
                if (!rendered) {
                    const renderOnly: [string, unknown][] = [
                        ['--photo', (options.photo ?? []).length > 0 ? true : undefined],
                        ['--scene', options.scene],
                        ['--template', options.template],
                        ['--scheme', options.scheme],
                        ['--tag', options.tag],
                        ['--number', options.number],
                        ['--labels', options.labels],
                        ['--look', options.look],
                        ['--fit', options.fit],
                        ['--hook', options.hook],
                        ['--scale', options.scale],
                    ];
                    const used = renderOnly.find(([, value]) => value !== undefined);
                    if (used !== undefined) {
                        throw new Error(
                            used[0] === '--scale'
                                ? `--scale works with --source render or stock. ${effective.source} output size comes from the model.`
                                : `${used[0]} works with --source render or stock.`,
                        );
                    }
                }
                if (rendered && options.style !== undefined) {
                    throw new Error(
                        '--style picks the painting style for --source agent and model. Render and stock covers take --scheme.',
                    );
                }

                if (effective.source === 'agent') {
                    if (effective.render.canvas) {
                        throw new Error('agent uses preset sizes. Omit --width and --height.');
                    }
                    if (guides) {
                        throw new Error('--guides works with --source render or stock.');
                    }
                    if (options.subject !== undefined) {
                        throw new Error('--subject works with --source render or stock.');
                    }
                    const pack = packFor(options.style);
                    const style = loadStyle(pack.style);
                    const palette = mergedPalette(pack);
                    if (
                        flags.via !== undefined &&
                        !AGENT_PROVIDERS.includes(flags.via as AgentProvider)
                    ) {
                        throw new Error(
                            `--via ${flags.via} works with --source model. --source agent takes ${AGENT_PROVIDERS.join(' or ')}.`,
                        );
                    }
                    const selected = selectAgentProvider({
                        via: flags.via as AgentProvider | undefined,
                        configVia: effective.agent?.via,
                        lookup: runtime.lookupCommand,
                    });
                    // 二创的图排在最前面，提示词里的「参考图 1、2」就是它们。
                    const remixPaths = resolveNamedRefFiles(options.remix ?? [], runtime.cwd);
                    const remix = remixPaths.length > 0 ? remixModeFor(remixPaths) : undefined;
                    for (const path of remixPaths) {
                        assertRedrawable(path);
                    }
                    const refs = [
                        ...remixPaths,
                        ...resolveNamedRefFiles(options.ref ?? [], runtime.cwd),
                    ];
                    if (refs.length > 0) {
                        runtime.stdout.write(
                            `References sent to ${selected.provider}:\n${refs
                                .map((path) => `  ${path}`)
                                .join('\n')}\n`,
                        );
                    }

                    const outputPath = coverOutputPath(runtime, flags, effective.output);
                    // 一族只调一次模型：原图暂存进系统临时目录，族内各平台从同一张图裁。
                    const byFamily = new Map<FamilyName, CoverTarget[]>();
                    for (const target of coverOutputPaths(outputPath, effective.render.presets)) {
                        const family = getPlatform(target.platform).family;
                        byFamily.set(family, [...(byFamily.get(family) ?? []), target]);
                    }
                    const stem = basename(outputPath, extname(outputPath));
                    const runDir = newRunDir();
                    const lines: string[] = [];
                    for (const [family, targets] of byFamily) {
                        const generatedPath = join(runDir, `${stem}-${family}.png`);
                        const prompt = buildEnvelopePrompt({
                            style,
                            subject: text,
                            mergedPalette: palette,
                            generatedPath,
                            family,
                            provider: selected.provider,
                            referencePaths: refs,
                            ...(remix ? { remix } : {}),
                        });
                        await runtime.runAgent({
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
                            const plan = getAgentCanvasPlan(target.platform);
                            lines.push(
                                `Created ${target.outputPath}`,
                                `Canvas: ${plan.outputWidth}x${plan.outputHeight}`,
                            );
                        }
                        // 原图路径打印给调用方：值得留就拷走，临时目录会被系统清。
                        lines.push(`Original: ${generatedPath}`);
                    }

                    runtime.stdout.write(
                        [
                            ...lines,
                            `Backend: ${selected.provider}`,
                            ...(remix === 'restyle'
                                ? [`Remix: redrew ${remixPaths[0]} in the project style`]
                                : remix === 'place'
                                  ? [
                                        `Remix: put the person from ${remixPaths[0]} into ${remixPaths[1]}`,
                                    ]
                                  : []),
                            'Privacy: agent used your own CLI. We did not handle the data.',
                            '',
                        ].join('\n'),
                    );
                    return;
                }

                if (effective.source === 'model') {
                    if (effective.render.canvas) {
                        throw new Error('model uses preset sizes. Omit --width and --height.');
                    }
                    if (guides) {
                        throw new Error('--guides works with --source render or stock.');
                    }
                    if (options.subject !== undefined) {
                        throw new Error('--subject works with --source render or stock.');
                    }
                    if ((options.ref ?? []).length > 0) {
                        throw new Error('--ref works with --source agent.');
                    }
                    if (
                        flags.via !== undefined &&
                        !MODEL_PROVIDERS.includes(flags.via as ModelProvider)
                    ) {
                        throw new Error(
                            `--via ${flags.via} works with --source agent. --source model takes ${MODEL_PROVIDERS.join(' or ')}.`,
                        );
                    }
                    const pack = packFor(options.style);
                    const style = loadStyle(pack.style);
                    const palette = mergedPalette(pack);
                    const selected = selectModelProvider({
                        ...(flags.via !== undefined ? { via: flags.via as ModelProvider } : {}),
                        ...(effective.model ? { config: effective.model } : {}),
                    });

                    const outputPath = coverOutputPath(runtime, flags, effective.output);
                    // 和 agent 一样一族只生成一次：原图暂存进系统临时目录，族内各平台从同一张图裁。
                    const byFamily = new Map<FamilyName, CoverTarget[]>();
                    for (const target of coverOutputPaths(outputPath, effective.render.presets)) {
                        const family = getPlatform(target.platform).family;
                        byFamily.set(family, [...(byFamily.get(family) ?? []), target]);
                    }
                    const stem = basename(outputPath, extname(outputPath));
                    const runDir = newRunDir();
                    const lines: string[] = [];
                    for (const [family, targets] of byFamily) {
                        const generatedPath = join(runDir, `${stem}-${family}.png`);
                        const prompt = buildModelPrompt({
                            style,
                            subject: text,
                            mergedPalette: palette,
                            family,
                        });
                        await runtime.runModelApi({
                            provider: selected.provider,
                            apiKey: selected.apiKey,
                            model: selected.model,
                            prompt,
                            family,
                            generatedPath,
                            targets: targets.map((target) => ({
                                preset: target.platform,
                                outputPath: target.outputPath,
                            })),
                        });
                        for (const target of targets) {
                            const plan = getAgentCanvasPlan(target.platform);
                            lines.push(
                                `Created ${target.outputPath}`,
                                `Canvas: ${plan.outputWidth}x${plan.outputHeight}`,
                            );
                        }
                        // 原图路径打印给调用方：值得留就拷走，临时目录会被系统清。
                        lines.push(`Original: ${generatedPath}`);
                    }

                    runtime.stdout.write(
                        [
                            ...lines,
                            `Backend: ${selected.provider} ${selected.model}`,
                            `Privacy: the prompt went to ${selected.provider} with your API key. No local file left this machine.`,
                            '',
                        ].join('\n'),
                    );
                    return;
                }

                // render 和 stock 走同一条封面类型的路：先核对类型和素材，再下载、抠图、出图。
                const photoValues = (options.photo ?? []).map((value) => value.trim());
                if (effective.source === 'stock' && photoValues.length === 0) {
                    throw new Error(
                        'Source "stock" needs --photo <ref-or-path>. Run beastcover stock search "<query>" to pick one.',
                    );
                }
                if (photoValues.some((value) => value === '')) {
                    throw new Error('--photo must not be empty.');
                }
                const scene = options.scene === undefined ? undefined : parseScene(options.scene);
                if (scene !== undefined && photoValues.length > 0) {
                    throw new Error(
                        'Use --photo or --scene, not both. --scene paints the picture when there is no photo.',
                    );
                }
                // 现画的场景算一张照片。
                const pictures = photoValues.length + (scene === undefined ? 0 : 1);
                const hasSubject = options.subject !== undefined;
                const genre =
                    options.template === undefined
                        ? defaultGenre({ photos: pictures, subject: hasSubject })
                        : parseGenre(options.template);
                if (scene !== undefined && !SCENE_GENRES.has(genre)) {
                    throw new Error(
                        `--scene paints the picture for --template ${[...SCENE_GENRES].join(', ')}. ${genre} needs real photos.`,
                    );
                }
                checkGenreInputs(genre, {
                    photos: pictures,
                    subject: hasSubject,
                    options: {
                        tag: options.tag,
                        number: options.number,
                        labels: options.labels,
                        look: options.look,
                        fit: options.fit,
                    },
                });
                parseEmphasis(text);
                const hook = options.hook === undefined ? undefined : parseHook(options.hook);
                if (hook !== undefined) {
                    parseEmphasis(hook);
                }
                const scheme: SchemeName | undefined =
                    options.scheme === undefined ? undefined : parseScheme(options.scheme);
                const tag = options.tag === undefined ? undefined : parseTag(options.tag);
                const figure =
                    options.number === undefined ? undefined : parseFigure(options.number);
                const labels =
                    options.labels === undefined ? undefined : parseLabels(options.labels);
                const look: PhotoLook | undefined =
                    options.look === undefined ? undefined : parsePhotoLook(options.look);
                const fit: PhotoFit =
                    options.fit === undefined ? 'cover' : parsePhotoFit(options.fit);

                // 成品路径和各选项的组合不依赖照片，先算先拦，别为必然失败的命令下载照片或画场景。
                checkCoverRequest(effective.render, guides, hook);
                const outputPath = coverOutputPath(runtime, flags, effective.output);
                const subject = await loadSubject(runtime, options.subject);
                const stockRuntime: StockRuntime = { config: fileConfig.stock, ...runtime.stock };
                const photos: LoadedPhoto[] = [];
                for (const value of photoValues) {
                    photos.push(await loadPhoto(runtime, value, stockRuntime));
                }
                // 故事画面：没给照片、给了 --scene，就按本机能力现画，画不了退到配色渐变并说明。
                const genrePhotos = photos.map((loaded) => loaded.photo);
                const sceneLines: string[] = [];
                let painter: ScenePainter | undefined;
                if (scene !== undefined) {
                    painter = findScenePainter({
                        ...(flags.via === undefined ? {} : { via: flags.via }),
                        ...(effective.model === undefined ? {} : { model: effective.model }),
                        lookup: runtime.lookupCommand,
                    });
                    const canvas = effective.render.canvas;
                    const orientations = [
                        ...new Set(
                            canvas === undefined
                                ? effective.render.presets.map((name) =>
                                      sceneOrientation(getPlatform(name).family),
                                  )
                                : [canvas.width >= canvas.height ? 'landscape' : 'portrait'],
                        ),
                    ] as ('landscape' | 'portrait')[];
                    const runDir = newRunDir();
                    const colors = SCHEMES[scheme ?? 'navy'];
                    const painted: { orientation: 'landscape' | 'portrait'; photo: GenrePhoto }[] =
                        [];
                    for (const orientation of orientations) {
                        const path =
                            painter === undefined
                                ? await gradientScene(
                                      { base: colors.base, deep: colors.baseDeep },
                                      orientation,
                                      runDir,
                                  )
                                : await paintScene(painter, scene, orientation, runDir, {
                                      runModelApi: runtime.runModelApi,
                                      runAgent: runtime.runAgent,
                                      verbose: Boolean(options.verbose),
                                      backendOutput: runtime.stderr,
                                  });
                        painted.push({
                            orientation,
                            photo: {
                                path,
                                ...(await imageSize(path)),
                                focus: await runtime.photoFocus(path),
                            },
                        });
                        if (painter !== undefined) {
                            sceneLines.push(
                                `Scene: painted by ${painterLabel(painter)}, saved at ${path}`,
                            );
                        }
                    }
                    if (painter === undefined) {
                        sceneLines.push(SCENE_DEGRADED);
                    }
                    const byFamily = Object.fromEntries(
                        FAMILY_NAMES.flatMap((family) => {
                            const match = painted.find(
                                (entry) => entry.orientation === sceneOrientation(family),
                            );
                            return match === undefined ? [] : [[family, match.photo]];
                        }),
                    );
                    const primary = painted[0]?.photo;
                    if (primary === undefined) {
                        throw new Error('No scene was painted.');
                    }
                    genrePhotos.push({ ...primary, byFamily });
                }
                const single = photos.length === 1 ? photos[0] : undefined;
                if (genre === 'callout' && single !== undefined) {
                    checkCallout(
                        single.photo,
                        single.photo.focus,
                        effective.render.presets,
                        effective.render.canvas,
                    );
                }
                const templateFor = (line: string, fonts: FontKit): CoverTemplate =>
                    genreTemplate(genre, {
                        text: line,
                        fonts,
                        photos: genrePhotos,
                        ...(subject === undefined ? {} : { subject: subject.layer }),
                        ...(scheme === undefined ? {} : { scheme }),
                        ...(tag === undefined ? {} : { tag }),
                        ...(figure === undefined ? {} : { figure }),
                        ...(labels === undefined ? {} : { labels }),
                        ...(look === undefined ? {} : { look }),
                        ...(options.fit === undefined ? {} : { fit }),
                    });
                const written = await writeCovers(
                    runtime,
                    text,
                    templateFor,
                    effective.render,
                    outputPath,
                    guides,
                    hook,
                );
                const fullBleed =
                    single !== undefined && FULL_BLEED.has(genre) ? single : undefined;
                const provider = photos.find((loaded) => loaded.credit.provider)?.credit.provider;

                runtime.stdout.write(
                    [
                        ...coverLines(written.covers, effective.render.scale),
                        `Template: ${genre}, ${GENRES[genre].summary}${options.template === undefined ? ' (picked from the inputs; set --template to choose)' : ''}`,
                        ...written.warnings,
                        ...(fullBleed === undefined
                            ? []
                            : stretchLines(fullBleed.photo, effective.render, fit)),
                        ...(fullBleed !== undefined &&
                        genre !== 'callout' &&
                        fit === 'cover' &&
                        effective.render.canvas === undefined
                            ? focusCropWarnings(
                                  fullBleed.photo,
                                  fullBleed.photo.focus,
                                  effective.render.presets,
                                  genre === 'face-stakes',
                              )
                            : []),
                        ...(effective.render.canvas
                            ? []
                            : textOnlyWarnings(
                                  effective.render.presets,
                                  subject !== undefined || genrePhotos.length > 0,
                              )),
                        ...subjectLine(subject),
                        ...photoLines(photos),
                        ...sceneLines,
                        painter?.kind === 'model'
                            ? `Privacy: the scene description went to ${painter.provider} with your API key. Render stayed on this machine.`
                            : painter?.kind === 'agent'
                              ? `Privacy: the scene was painted by your own ${painter.provider} CLI. Render stayed on this machine.`
                              : provider
                                ? `Privacy: the ${photos.length === 1 ? 'photo was' : 'photos were'} downloaded from ${provider}. Render stayed on this machine.`
                                : 'Privacy: render stayed on this machine.',
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
        .option('--dir <directory>', 'Target directory (defaults to the temp staging area)')
        .action(async (ref: string, options: { dir?: string }) => {
            const fileConfig = loadConfigFile(runtime.configPath);
            const targetDir = options.dir ? resolve(runtime.cwd, options.dir) : tempRefsDir();
            mkdirSync(targetDir, { recursive: true });
            const fetched = await fetchStockPhoto(
                { ref, basePath: join(targetDir, stockFileStem(ref)), now: runtime.now() },
                { config: fileConfig.stock, ...runtime.stock },
            );
            runtime.stdout.write(
                [
                    `Saved ${fetched.imagePath}`,
                    `Sidecar: ${fetched.sidecar}`,
                    sizeLine(fetched),
                    ...creditLines(fetched.photo),
                    '',
                ].join('\n'),
            );
        });

    // 工作区随 0.7.2 移除：做完就走，不跟项目绑定。旧命令报错指新路，不静默消失。
    for (const [removed, hint] of [
        ['new', 'Covers no longer need a workspace: run beastcover gen directly, anywhere.'],
        ['project', 'Workspaces were removed. Pick a style per run with gen --style <name>.'],
    ] as const) {
        program
            .command(removed, { hidden: true })
            .allowUnknownOption()
            .argument('[args...]')
            .action(() => {
                throw new Error(`beastcover ${removed} was removed. ${hint}`);
            });
    }

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
        .action(async () => {
            const report = await runtime.doctor();
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
