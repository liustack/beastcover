import {
    appendFileSync,
    existsSync,
    mkdirSync,
    readFileSync,
    statSync,
    writeFileSync,
} from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import {
    IMAGE_SOURCES,
    type ImageSource,
    LOCAL_MODEL_PROVIDERS,
    type LocalModelProvider,
} from '../config.ts';
import { PLATFORM_NAMES, type PlatformName } from '../platforms/index.ts';
import { STOCK_PROVIDERS, type StockProvider } from '../stock/types.ts';
import { loadFallbackStyle, loadStyle } from '../styles/loader.ts';
import {
    isCssColorValue,
    type PaletteSlotOverride,
    type PaletteSlotValue,
    parseCssColorValue,
} from '../styles/schema.ts';
import type { SubjectMethod } from '../subject/index.ts';
import { writeWorkspaceIgnoreFile } from './ignore.ts';

export const WORKSPACE_DIRNAME = '.beastcover';
export const PROJECT_PACK_FILE = 'project.json';
export const HISTORY_FILE = 'history.jsonl';

export interface StylePack {
    name: string;
    style: string;
    palette: Record<string, PaletteSlotOverride>;
    composition: string;
}

export interface HistoryPhoto {
    path: string;
    ref?: string;
    provider?: StockProvider;
    creator?: string;
    license?: string;
    attribution?: string;
    pageUrl?: string;
}

export interface HistoryRecord {
    createdAt: string;
    style: string;
    palette: Record<string, PaletteSlotValue>;
    text: string;
    output: string;
    source?: ImageSource;
    via?: LocalModelProvider;
    /** 出图的平台，自定义画布时没有 */
    preset?: PlatformName;
    catalogPalette?: Record<string, PaletteSlotValue>;
    photo?: HistoryPhoto;
    subject?: HistorySubject;
}

export interface HistorySubject {
    path: string;
    method: SubjectMethod;
}

const SUBJECT_METHODS: readonly SubjectMethod[] = ['transparent', 'macos-vision'];

const HISTORY_PHOTO_KEYS = new Set([
    'path',
    'ref',
    'provider',
    'creator',
    'license',
    'attribution',
    'pageUrl',
]);

export interface CreateWorkspaceOptions {
    name: string;
    styleName?: string;
}

export interface CreatedWorkspace {
    path: string;
    pack: StylePack;
}

const STYLE_PACK_KEYS = new Set(['name', 'style', 'palette', 'composition']);
const PALETTE_SLOT_KEYS = new Set(['prompt', 'css']);

function isPlainObject(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function invalidPack(packPath: string, key: string, expectation: string): never {
    throw new Error(`${packPath} has invalid "${key}". Expected ${expectation}.`);
}

export function workspacePath(cwd: string): string {
    return join(resolve(cwd), WORKSPACE_DIRNAME);
}

export function findWorkspace(startDir: string): string | undefined {
    let directory = resolve(startDir);
    while (true) {
        const candidate = join(directory, WORKSPACE_DIRNAME);
        // 只认带 project.json 的目录。家目录的 ~/.beastcover 是设置目录，同名但不是工作区。
        try {
            if (statSync(join(candidate, PROJECT_PACK_FILE)).isFile()) {
                return candidate;
            }
        } catch (error) {
            const code = (error as NodeJS.ErrnoException).code;
            if (code !== 'ENOENT' && code !== 'ENOTDIR') {
                throw new Error(
                    `Cannot inspect ${candidate}: ${error instanceof Error ? error.message : String(error)}`,
                );
            }
        }

        const parent = dirname(directory);
        if (parent === directory) {
            return undefined;
        }
        directory = parent;
    }
}

function parsePaletteSlotOverride(
    packPath: string,
    key: string,
    value: unknown,
): PaletteSlotOverride {
    if (!isPlainObject(value)) {
        invalidPack(packPath, `palette.${key}`, 'an object with "prompt" and/or "css" strings');
    }

    for (const field of Object.keys(value)) {
        if (!PALETTE_SLOT_KEYS.has(field)) {
            throw new Error(`${packPath} contains unknown key "palette.${key}.${field}".`);
        }
    }

    const override: PaletteSlotOverride = {};
    if ('prompt' in value) {
        if (typeof value.prompt !== 'string' || value.prompt.trim() === '') {
            invalidPack(packPath, `palette.${key}.prompt`, 'a non-empty string');
        }
        override.prompt = value.prompt;
    }
    if ('css' in value) {
        if (typeof value.css !== 'string' || value.css.trim() === '') {
            invalidPack(packPath, `palette.${key}.css`, 'a non-empty string');
        }
        if (!isCssColorValue(value.css)) {
            invalidPack(packPath, `palette.${key}.css`, 'a CSS color value');
        }
        override.css = parseCssColorValue(value.css);
    }
    if (override.prompt === undefined && override.css === undefined) {
        invalidPack(packPath, `palette.${key}`, 'an object with "prompt" and/or "css" strings');
    }

    return override;
}

export function loadStylePack(workspaceDir: string): StylePack {
    const packPath = join(workspaceDir, PROJECT_PACK_FILE);
    let raw: string;
    try {
        raw = readFileSync(packPath, 'utf8');
    } catch (error) {
        throw new Error(
            `Cannot read ${packPath}: ${error instanceof Error ? error.message : String(error)}`,
        );
    }

    let parsed: unknown;
    try {
        parsed = JSON.parse(raw);
    } catch {
        throw new Error(`${packPath} is not valid JSON.`);
    }

    if (!isPlainObject(parsed)) {
        throw new Error(`${packPath} must contain a JSON object.`);
    }

    for (const key of Object.keys(parsed)) {
        if (!STYLE_PACK_KEYS.has(key)) {
            throw new Error(`${packPath} contains unknown key "${key}".`);
        }
    }

    if (typeof parsed.name !== 'string' || parsed.name.trim() === '') {
        invalidPack(packPath, 'name', 'a non-empty string');
    }
    if (typeof parsed.style !== 'string' || parsed.style.trim() === '') {
        invalidPack(packPath, 'style', 'a catalog style name');
    }

    const style = loadStyle(parsed.style);

    if (!isPlainObject(parsed.palette)) {
        invalidPack(packPath, 'palette', 'an object');
    }
    const slotNames = new Set(style.paletteSlots.map((slot) => slot.name));
    const palette: Record<string, PaletteSlotOverride> = {};
    for (const [key, value] of Object.entries(parsed.palette)) {
        if (!slotNames.has(key)) {
            throw new Error(`${packPath} contains unknown palette slot "${key}".`);
        }
        palette[key] = parsePaletteSlotOverride(packPath, key, value);
    }

    if (typeof parsed.composition !== 'string' || parsed.composition.trim() === '') {
        invalidPack(packPath, 'composition', 'a non-empty string');
    }

    return {
        name: parsed.name,
        style: parsed.style,
        palette,
        composition: parsed.composition,
    };
}

function writeStylePack(workspaceDir: string, pack: StylePack): void {
    writeFileSync(join(workspaceDir, PROJECT_PACK_FILE), `${JSON.stringify(pack, null, 2)}\n`, {
        encoding: 'utf8',
    });
}

export function createWorkspace(cwd: string, options: CreateWorkspaceOptions): CreatedWorkspace {
    const name = options.name.trim();
    if (name === '') {
        throw new Error('Project name must not be empty.');
    }

    const target = workspacePath(cwd);
    if (existsSync(join(target, PROJECT_PACK_FILE))) {
        throw new Error(`A BeastCover workspace already exists at ${target}.`);
    }
    if (existsSync(target)) {
        throw new Error(
            `${target} already exists and is not a BeastCover workspace. It may be the settings folder. Run beastcover new in a project folder instead.`,
        );
    }

    const existing = findWorkspace(cwd);
    if (existing) {
        throw new Error(`A BeastCover workspace already exists at ${existing}.`);
    }

    const style =
        options.styleName === undefined ? loadFallbackStyle() : loadStyle(options.styleName);
    const palette: Record<string, PaletteSlotOverride> = {};
    for (const slot of style.paletteSlots) {
        palette[slot.name] = { prompt: slot.prompt, css: slot.css };
    }
    const pack: StylePack = {
        name,
        style: style.name,
        palette,
        composition: style.composition,
    };

    mkdirSync(target, { recursive: true });
    for (const directory of ['refs', 'out', 'cache']) {
        mkdirSync(join(target, directory), { recursive: true });
    }
    writeWorkspaceIgnoreFile(target);
    writeStylePack(target, pack);

    return { path: target, pack };
}

export function defaultWorkspaceOutputPath(workspaceDir: string, now = new Date()): string {
    const stamp = now.toISOString().replaceAll(':', '-');
    return join(workspaceDir, 'out', `beastcover-${stamp}.png`);
}

function historyPath(workspaceDir: string): string {
    return join(workspaceDir, HISTORY_FILE);
}

function parseHistoryPaletteSlot(
    filePath: string,
    lineNumber: number,
    key: string,
    value: unknown,
): PaletteSlotValue {
    const location = `${filePath}:${lineNumber}`;
    if (!isPlainObject(value)) {
        throw new Error(
            `${location} has invalid "palette.${key}". Expected an object with "prompt" and "css" strings.`,
        );
    }
    for (const field of Object.keys(value)) {
        if (!PALETTE_SLOT_KEYS.has(field)) {
            throw new Error(`${location} contains unknown key "palette.${key}.${field}".`);
        }
    }
    if (typeof value.prompt !== 'string' || value.prompt.trim() === '') {
        throw new Error(
            `${location} has invalid "palette.${key}.prompt". Expected a non-empty string.`,
        );
    }
    if (typeof value.css !== 'string' || value.css.trim() === '') {
        throw new Error(
            `${location} has invalid "palette.${key}.css". Expected a non-empty string.`,
        );
    }
    if (!isCssColorValue(value.css)) {
        throw new Error(
            `${location} has invalid "palette.${key}.css". Expected a CSS color value.`,
        );
    }
    return { prompt: value.prompt, css: parseCssColorValue(value.css) };
}

function parseHistoryPhoto(filePath: string, lineNumber: number, value: unknown): HistoryPhoto {
    const location = `${filePath}:${lineNumber}`;
    if (!isPlainObject(value)) {
        throw new Error(`${location} has invalid "photo". Expected an object.`);
    }
    for (const key of Object.keys(value)) {
        if (!HISTORY_PHOTO_KEYS.has(key)) {
            throw new Error(`${location} contains unknown key "photo.${key}".`);
        }
        if (typeof value[key] !== 'string') {
            throw new Error(`${location} has invalid "photo.${key}". Expected a string.`);
        }
    }
    if (typeof value.path !== 'string' || value.path.trim() === '') {
        throw new Error(`${location} has invalid "photo.path". Expected a non-empty string.`);
    }
    if (
        value.provider !== undefined &&
        !STOCK_PROVIDERS.includes(value.provider as StockProvider)
    ) {
        throw new Error(
            `${location} has invalid "photo.provider". Expected one of ${STOCK_PROVIDERS.join(', ')}.`,
        );
    }
    return value as unknown as HistoryPhoto;
}

function parseHistoryRecord(filePath: string, lineNumber: number, raw: string): HistoryRecord {
    let parsed: unknown;
    try {
        parsed = JSON.parse(raw);
    } catch {
        throw new Error(`${filePath}:${lineNumber} is not valid JSON.`);
    }
    if (!isPlainObject(parsed)) {
        throw new Error(`${filePath}:${lineNumber} must contain a JSON object.`);
    }
    for (const key of ['createdAt', 'style', 'text', 'output'] as const) {
        if (typeof parsed[key] !== 'string') {
            throw new Error(`${filePath}:${lineNumber} has invalid "${key}". Expected a string.`);
        }
    }
    if (!isPlainObject(parsed.palette)) {
        throw new Error(`${filePath}:${lineNumber} has invalid "palette". Expected an object.`);
    }
    const palette: Record<string, PaletteSlotValue> = {};
    for (const [key, value] of Object.entries(parsed.palette)) {
        palette[key] = parseHistoryPaletteSlot(filePath, lineNumber, key, value);
    }
    const record: HistoryRecord = {
        createdAt: parsed.createdAt as string,
        style: parsed.style as string,
        palette,
        text: parsed.text as string,
        output: parsed.output as string,
    };
    if (parsed.source !== undefined) {
        if (
            typeof parsed.source !== 'string' ||
            !IMAGE_SOURCES.includes(parsed.source as ImageSource)
        ) {
            throw new Error(
                `${filePath}:${lineNumber} has invalid "source". Expected one of ${IMAGE_SOURCES.join(', ')}.`,
            );
        }
        record.source = parsed.source as ImageSource;
    }
    if (parsed.via !== undefined) {
        if (
            typeof parsed.via !== 'string' ||
            !LOCAL_MODEL_PROVIDERS.includes(parsed.via as LocalModelProvider)
        ) {
            throw new Error(
                `${filePath}:${lineNumber} has invalid "via". Expected one of ${LOCAL_MODEL_PROVIDERS.join(', ')}.`,
            );
        }
        record.via = parsed.via as LocalModelProvider;
    }
    if (parsed.preset !== undefined) {
        if (
            typeof parsed.preset !== 'string' ||
            !PLATFORM_NAMES.includes(parsed.preset as PlatformName)
        ) {
            throw new Error(
                `${filePath}:${lineNumber} has invalid "preset". Expected one of ${PLATFORM_NAMES.join(', ')}.`,
            );
        }
        record.preset = parsed.preset as PlatformName;
    }
    if (parsed.photo !== undefined) {
        record.photo = parseHistoryPhoto(filePath, lineNumber, parsed.photo);
    }
    if (parsed.subject !== undefined) {
        const subject = parsed.subject;
        if (
            !isPlainObject(subject) ||
            Object.keys(subject).some((key) => key !== 'path' && key !== 'method') ||
            typeof subject.path !== 'string' ||
            !SUBJECT_METHODS.includes(subject.method as SubjectMethod)
        ) {
            throw new Error(
                `${filePath}:${lineNumber} has invalid "subject". Expected "path" and a "method" of ${SUBJECT_METHODS.join(' or ')}.`,
            );
        }
        record.subject = { path: subject.path, method: subject.method as SubjectMethod };
    }
    if (parsed.catalogPalette !== undefined) {
        if (!isPlainObject(parsed.catalogPalette)) {
            throw new Error(
                `${filePath}:${lineNumber} has invalid "catalogPalette". Expected an object.`,
            );
        }
        const catalogPalette: Record<string, PaletteSlotValue> = {};
        for (const [key, value] of Object.entries(parsed.catalogPalette)) {
            catalogPalette[key] = parseHistoryPaletteSlot(filePath, lineNumber, key, value);
        }
        record.catalogPalette = catalogPalette;
    }
    return record;
}

export function listHistory(workspaceDir: string): HistoryRecord[] {
    const filePath = historyPath(workspaceDir);
    let raw: string;
    try {
        raw = readFileSync(filePath, 'utf8');
    } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
            return [];
        }
        throw new Error(
            `Cannot read ${filePath}: ${error instanceof Error ? error.message : String(error)}`,
        );
    }

    return raw
        .split('\n')
        .map((line) => line.trim())
        .filter((line) => line !== '')
        .map((line, index) => parseHistoryRecord(filePath, index + 1, line));
}

export function appendHistory(workspaceDir: string, record: HistoryRecord): string {
    const filePath = historyPath(workspaceDir);
    // history.jsonl 会进版本库，绝对路径会把本机目录结构和用户名带进仓库，换台机器也对不上。
    const stored: HistoryRecord = { ...record, output: relative(workspaceDir, record.output) };
    appendFileSync(filePath, `${JSON.stringify(stored)}\n`, { encoding: 'utf8' });
    return filePath;
}

export function mergedPalette(pack: StylePack): Record<string, PaletteSlotValue> {
    const style = loadStyle(pack.style);
    const palette: Record<string, PaletteSlotValue> = {};
    for (const slot of style.paletteSlots) {
        const override = pack.palette[slot.name];
        palette[slot.name] = {
            prompt: override && override.prompt !== undefined ? override.prompt : slot.prompt,
            css: override && override.css !== undefined ? override.css : slot.css,
        };
    }
    return palette;
}
