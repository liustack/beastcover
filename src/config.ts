import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { getPlatform, type PlatformName, parsePlatformList } from './platforms/index.ts';

export const CONFIG_PATH = join(homedir(), '.beastcover', 'config.json');

// 给 --scene 画场景的后端：用户自己的图像模型 API key，或本机的 agent CLI。
export const MODEL_PROVIDERS = ['openai', 'gemini'] as const;
export type ModelProvider = (typeof MODEL_PROVIDERS)[number];

export const AGENT_PROVIDERS = ['codex', 'agy'] as const;
export type AgentProvider = (typeof AGENT_PROVIDERS)[number];

export const PAINTERS = [...MODEL_PROVIDERS, ...AGENT_PROVIDERS] as const;
export type PainterName = (typeof PAINTERS)[number];

export function parsePainter(value: string): PainterName {
    if (!PAINTERS.includes(value as PainterName)) {
        throw new Error(`Unknown painter "${value}". Use ${PAINTERS.join(', ')}.`);
    }
    return value as PainterName;
}

// 模型代号更新很快，写错一代只需要 config set model.<provider>.model 就能改。
export const MODEL_DEFAULTS: Record<ModelProvider, string> = {
    openai: 'gpt-image-2.5-flare',
    gemini: 'gemini-3-pro-image-preview',
};

export interface ModelConfig {
    openai?: { apiKey?: string; model?: string };
    gemini?: { apiKey?: string; model?: string };
}

export interface StockConfig {
    pexels?: {
        apiKey?: string;
    };
    openverse?: {
        clientId?: string;
        clientSecret?: string;
    };
}

export interface SceneConfig {
    /** 默认用哪个后端画场景，--via 可以临时换 */
    via?: PainterName;
}

export interface BeastCoverConfigFile {
    output?: string;
    render?: {
        /** 一个平台名、逗号分隔的平台列表，或 all */
        preset?: string;
        width?: number;
        height?: number;
        scale?: number;
    };
    stock?: StockConfig;
    model?: ModelConfig;
    scene?: SceneConfig;
}

export interface ConfigFlags {
    output?: string;
    presets?: PlatformName[];
    width?: number;
    height?: number;
    scale?: number;
}

export interface EffectiveConfig {
    output: string;
    render: {
        presets: PlatformName[];
        /** 给了 width 或 height 时才有：不按平台出图，直接用这个画布 */
        canvas?: { width: number; height: number };
        scale: number;
    };
    stock?: BeastCoverConfigFile['stock'];
    model?: BeastCoverConfigFile['model'];
    scene?: BeastCoverConfigFile['scene'];
}

export const BUILT_IN_CONFIG = {
    output: 'beastcover.png',
    render: {
        preset: 'youtube',
        scale: 1,
    },
} as const;

function isPlainObject(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function writeConfigFile(config: BeastCoverConfigFile, configPath: string): void {
    mkdirSync(dirname(configPath), { recursive: true, mode: 0o700 });
    writeFileSync(configPath, `${JSON.stringify(config, null, 2)}\n`, {
        encoding: 'utf8',
        mode: 0o600,
    });
    chmodSync(configPath, 0o600);
}

function parseIntegerSetting(key: string, value: string, minimum: number, maximum: number): number {
    const parsed = Number(value);
    if (!Number.isInteger(parsed) || parsed < minimum || parsed > maximum) {
        throw new Error(`${key} must be an integer from ${minimum} to ${maximum}.`);
    }
    return parsed;
}

function parseScaleSetting(value: string): number {
    const parsed = Number(value);
    if (!Number.isFinite(parsed) || parsed < 1 || parsed > 4) {
        throw new Error('render.scale must be a number from 1 to 4.');
    }
    return parsed;
}

function invalidConfig(configPath: string, key: string, expectation: string): never {
    throw new Error(`${configPath} has invalid "${key}". Expected ${expectation}.`);
}

const STOCK_PROVIDER_KEYS: Record<keyof StockConfig, readonly string[]> = {
    pexels: ['apiKey'],
    openverse: ['clientId', 'clientSecret'],
};

function validateStockConfig(stock: unknown, configPath: string): void {
    if (!isPlainObject(stock)) {
        invalidConfig(configPath, 'stock', 'an object');
    }
    for (const key of Object.keys(stock)) {
        if (!(key in STOCK_PROVIDER_KEYS)) {
            throw new Error(`${configPath} contains unknown config key "stock.${key}".`);
        }
    }
    for (const [provider, allowed] of Object.entries(STOCK_PROVIDER_KEYS)) {
        const section = stock[provider];
        if (section === undefined) {
            continue;
        }
        if (!isPlainObject(section)) {
            invalidConfig(configPath, `stock.${provider}`, 'an object');
        }
        for (const key of Object.keys(section)) {
            if (!allowed.includes(key)) {
                throw new Error(
                    `${configPath} contains unknown config key "stock.${provider}.${key}".`,
                );
            }
            if (typeof section[key] !== 'string') {
                invalidConfig(configPath, `stock.${provider}.${key}`, 'a string');
            }
        }
    }
}

const MODEL_PROVIDER_KEYS = ['apiKey', 'model'] as const;

function validateModelConfig(model: unknown, configPath: string): void {
    if (!isPlainObject(model)) {
        invalidConfig(configPath, 'model', 'an object');
    }
    for (const key of Object.keys(model)) {
        if (!MODEL_PROVIDERS.includes(key as ModelProvider)) {
            throw new Error(`${configPath} contains unknown config key "model.${key}".`);
        }
    }
    for (const provider of MODEL_PROVIDERS) {
        const section = model[provider];
        if (section === undefined) {
            continue;
        }
        if (!isPlainObject(section)) {
            invalidConfig(configPath, `model.${provider}`, 'an object');
        }
        for (const key of Object.keys(section)) {
            if (!(MODEL_PROVIDER_KEYS as readonly string[]).includes(key)) {
                throw new Error(
                    `${configPath} contains unknown config key "model.${provider}.${key}".`,
                );
            }
            if (typeof section[key] !== 'string') {
                invalidConfig(configPath, `model.${provider}.${key}`, 'a string');
            }
        }
    }
}

function validateConfig(parsed: Record<string, unknown>, configPath: string): BeastCoverConfigFile {
    const rootKeys = new Set(['output', 'render', 'stock', 'model', 'scene']);
    for (const key of Object.keys(parsed)) {
        if (!rootKeys.has(key)) {
            throw new Error(`${configPath} contains unknown config key "${key}".`);
        }
    }

    if (
        parsed.output !== undefined &&
        (typeof parsed.output !== 'string' || parsed.output.trim() === '')
    ) {
        invalidConfig(configPath, 'output', 'a non-empty string');
    }

    if (parsed.render !== undefined) {
        if (!isPlainObject(parsed.render)) {
            invalidConfig(configPath, 'render', 'an object');
        }
        const renderKeys = new Set(['preset', 'width', 'height', 'scale']);
        for (const key of Object.keys(parsed.render)) {
            if (!renderKeys.has(key)) {
                throw new Error(`${configPath} contains unknown config key "render.${key}".`);
            }
        }
        if (parsed.render.preset !== undefined) {
            if (typeof parsed.render.preset !== 'string') {
                invalidConfig(configPath, 'render.preset', 'a platform preset name or list');
            }
            try {
                parsePlatformList(parsed.render.preset);
            } catch (error) {
                throw new Error(
                    `${configPath} has invalid "render.preset". ${(error as Error).message}`,
                );
            }
        }
        for (const key of ['width', 'height'] as const) {
            const value = parsed.render[key];
            if (
                value !== undefined &&
                (typeof value !== 'number' ||
                    !Number.isInteger(value) ||
                    value < 1 ||
                    value > 10_000)
            ) {
                invalidConfig(configPath, `render.${key}`, 'an integer from 1 to 10000');
            }
        }
        const scale = parsed.render.scale;
        if (
            scale !== undefined &&
            (typeof scale !== 'number' || !Number.isFinite(scale) || scale < 1 || scale > 4)
        ) {
            invalidConfig(configPath, 'render.scale', 'a number from 1 to 4');
        }
    }

    if (parsed.stock !== undefined) {
        validateStockConfig(parsed.stock, configPath);
    }

    if (parsed.model !== undefined) {
        validateModelConfig(parsed.model, configPath);
    }

    if (parsed.scene !== undefined) {
        if (!isPlainObject(parsed.scene)) {
            invalidConfig(configPath, 'scene', 'an object');
        }
        for (const key of Object.keys(parsed.scene)) {
            if (key !== 'via') {
                throw new Error(`${configPath} contains unknown config key "scene.${key}".`);
            }
        }
        const via = parsed.scene.via;
        if (
            via !== undefined &&
            (typeof via !== 'string' || !PAINTERS.includes(via as PainterName))
        ) {
            invalidConfig(configPath, 'scene.via', `one of ${PAINTERS.join(', ')}`);
        }
    }

    return parsed as BeastCoverConfigFile;
}

export function loadConfigFile(configPath = CONFIG_PATH): BeastCoverConfigFile {
    let raw: string;
    try {
        raw = readFileSync(configPath, 'utf8');
    } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
            return {};
        }
        throw new Error(
            `Cannot read ${configPath}: ${error instanceof Error ? error.message : String(error)}`,
        );
    }

    let parsed: unknown;
    try {
        parsed = JSON.parse(raw);
    } catch {
        throw new Error(`${configPath} is not valid JSON.`);
    }

    if (!isPlainObject(parsed)) {
        throw new Error(`${configPath} must contain a JSON object.`);
    }

    return validateConfig(parsed, configPath);
}

export function initConfigFile(configPath = CONFIG_PATH, force = false): void {
    if (!force && existsSync(configPath)) {
        throw new Error(`${configPath} already exists. Use --force to replace it.`);
    }

    writeConfigFile({}, configPath);
}

export function setConfigValue(
    dottedKey: string,
    rawValue: string,
    configPath = CONFIG_PATH,
): void {
    const value = rawValue.trim();
    const config = loadConfigFile(configPath);

    switch (dottedKey) {
        case 'output': {
            if (value === '') {
                throw new Error('output must not be empty.');
            }
            config.output = value;
            break;
        }
        case 'render.preset': {
            config.render ??= {};
            config.render.preset = parsePlatformList(value).join(',');
            break;
        }
        case 'render.width':
        case 'render.height': {
            config.render ??= {};
            const field = dottedKey.slice('render.'.length) as 'width' | 'height';
            config.render[field] = parseIntegerSetting(dottedKey, value, 1, 10_000);
            break;
        }
        case 'render.scale': {
            config.render ??= {};
            config.render.scale = parseScaleSetting(value);
            break;
        }
        case 'stock.pexels.apiKey': {
            config.stock ??= {};
            config.stock.pexels ??= {};
            config.stock.pexels.apiKey = rawValue;
            break;
        }
        case 'stock.openverse.clientId':
        case 'stock.openverse.clientSecret': {
            config.stock ??= {};
            config.stock.openverse ??= {};
            const field = dottedKey.slice('stock.openverse.'.length) as 'clientId' | 'clientSecret';
            config.stock.openverse[field] = rawValue;
            break;
        }
        case 'model.openai.apiKey':
        case 'model.openai.model':
        case 'model.gemini.apiKey':
        case 'model.gemini.model': {
            const [, provider, field] = dottedKey.split('.') as [
                string,
                ModelProvider,
                'apiKey' | 'model',
            ];
            if (value === '') {
                throw new Error(`${dottedKey} must not be empty.`);
            }
            config.model ??= {};
            config.model[provider] ??= {};
            (config.model[provider] as Record<string, string>)[field] = rawValue.trim();
            break;
        }
        case 'scene.via': {
            config.scene ??= {};
            config.scene.via = parsePainter(value);
            break;
        }
        default:
            throw new Error(`Unknown config key "${dottedKey}".`);
    }

    writeConfigFile(config, configPath);
}

export function resolveEffectiveConfig(
    fileConfig: BeastCoverConfigFile,
    flags: ConfigFlags,
): EffectiveConfig {
    const presets =
        flags.presets ??
        parsePlatformList(fileConfig.render?.preset ?? BUILT_IN_CONFIG.render.preset);
    const width = flags.width ?? fileConfig.render?.width;
    const height = flags.height ?? fileConfig.render?.height;
    let canvas: { width: number; height: number } | undefined;
    if (width !== undefined || height !== undefined) {
        if (presets.length > 1) {
            throw new Error(
                'A custom --width or --height makes one cover. Pick a single --preset or drop the size override.',
            );
        }
        const platform = getPlatform(presets[0] as PlatformName);
        canvas = { width: width ?? platform.width, height: height ?? platform.height };
    }

    return {
        output: flags.output ?? fileConfig.output ?? BUILT_IN_CONFIG.output,
        render: {
            presets,
            ...(canvas ? { canvas } : {}),
            scale: flags.scale ?? fileConfig.render?.scale ?? BUILT_IN_CONFIG.render.scale,
        },
        ...(fileConfig.stock ? { stock: structuredClone(fileConfig.stock) } : {}),
        ...(fileConfig.model ? { model: structuredClone(fileConfig.model) } : {}),
        ...(fileConfig.scene ? { scene: { ...fileConfig.scene } } : {}),
    };
}

function redactStockConfig(stock: StockConfig): StockConfig {
    const redacted = structuredClone(stock);
    for (const [provider, allowed] of Object.entries(STOCK_PROVIDER_KEYS)) {
        const section = redacted[provider as keyof StockConfig] as
            | Record<string, string | undefined>
            | undefined;
        if (section === undefined) {
            continue;
        }
        for (const key of allowed) {
            if (section[key] !== undefined) {
                section[key] = '[redacted]';
            }
        }
    }
    return redacted;
}

function redactModelConfig(model: ModelConfig): ModelConfig {
    const redacted = structuredClone(model);
    for (const provider of MODEL_PROVIDERS) {
        const section = redacted[provider];
        if (section?.apiKey !== undefined) {
            section.apiKey = '[redacted]';
        }
    }
    return redacted;
}

export function renderConfigShow(fileConfig: BeastCoverConfigFile): string {
    const effective = resolveEffectiveConfig(fileConfig, {});
    const redacted: EffectiveConfig = {
        ...effective,
        ...(effective.stock ? { stock: redactStockConfig(effective.stock) } : {}),
        ...(effective.model ? { model: redactModelConfig(effective.model) } : {}),
    };

    return JSON.stringify(redacted, null, 2);
}
