import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { getPlatform, type PlatformName, parsePlatformList } from './platforms/index.ts';

export const CONFIG_PATH = join(homedir(), '.beastcover', 'config.json');

export const IMAGE_SOURCES = ['render', 'stock', 'agent'] as const;
export type ImageSource = (typeof IMAGE_SOURCES)[number];

export const AGENT_PROVIDERS = ['codex', 'agy'] as const;
export type AgentProvider = (typeof AGENT_PROVIDERS)[number];

export interface StockConfig {
    pexels?: {
        apiKey?: string;
    };
    openverse?: {
        clientId?: string;
        clientSecret?: string;
    };
}

export interface BeastCoverConfigFile {
    source?: ImageSource;
    output?: string;
    render?: {
        /** 一个平台名、逗号分隔的平台列表，或 all */
        preset?: string;
        width?: number;
        height?: number;
        scale?: number;
    };
    stock?: StockConfig;
    agent?: {
        via?: AgentProvider;
    };
}

export interface ConfigFlags {
    source?: ImageSource;
    output?: string;
    presets?: PlatformName[];
    width?: number;
    height?: number;
    scale?: number;
    via?: AgentProvider;
}

export interface EffectiveConfig {
    source: ImageSource;
    output: string;
    render: {
        presets: PlatformName[];
        /** 给了 width 或 height 时才有：不按平台出图，直接用这个画布 */
        canvas?: { width: number; height: number };
        scale: number;
    };
    stock?: BeastCoverConfigFile['stock'];
    agent?: BeastCoverConfigFile['agent'];
}

export const BUILT_IN_CONFIG = {
    source: 'render',
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
        if (key === 'apiKey' || key === 'baseUrl') {
            throw new Error(
                `${configPath} uses the old "stock.${key}" key. Stock credentials are now per provider: delete "stock.${key}" from the file, then run beastcover config set stock.pexels.apiKey <key> if you use Pexels.`,
            );
        }
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

function validateConfig(parsed: Record<string, unknown>, configPath: string): BeastCoverConfigFile {
    const rootKeys = new Set(['source', 'output', 'render', 'stock', 'agent']);
    for (const key of Object.keys(parsed)) {
        if (key === 'localModel') {
            throw new Error(
                `${configPath} uses the old "localModel" key. The section is now "agent": rename it in the file.`,
            );
        }
        if (!rootKeys.has(key)) {
            throw new Error(`${configPath} contains unknown config key "${key}".`);
        }
    }

    if (parsed.source === 'local-model') {
        throw new Error(`${configPath} has source "local-model". The source is now "agent".`);
    }
    if (
        parsed.source !== undefined &&
        (typeof parsed.source !== 'string' || !IMAGE_SOURCES.includes(parsed.source as ImageSource))
    ) {
        invalidConfig(configPath, 'source', `one of ${IMAGE_SOURCES.join(', ')}`);
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

    if (parsed.agent !== undefined) {
        if (!isPlainObject(parsed.agent)) {
            invalidConfig(configPath, 'agent', 'an object');
        }
        for (const key of Object.keys(parsed.agent)) {
            if (key !== 'via') {
                throw new Error(`${configPath} contains unknown config key "agent.${key}".`);
            }
        }
        if (parsed.agent.via === 'grok' || parsed.agent.via === 'claude') {
            throw new Error(
                `${configPath} has agent.via "${parsed.agent.via}". That backend was removed: the ${parsed.agent.via} CLI has no image generation. Use codex or agy.`,
            );
        }
        if (
            parsed.agent.via !== undefined &&
            (typeof parsed.agent.via !== 'string' ||
                !AGENT_PROVIDERS.includes(parsed.agent.via as AgentProvider))
        ) {
            invalidConfig(configPath, 'agent.via', `one of ${AGENT_PROVIDERS.join(', ')}`);
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
        case 'localModel.via':
            throw new Error('The "localModel.via" key is now "agent.via".');
        case 'source': {
            if (value === 'local-model') {
                throw new Error('Source "local-model" is now "agent".');
            }
            if (!IMAGE_SOURCES.includes(value as ImageSource)) {
                throw new Error(`source must be one of ${IMAGE_SOURCES.join(', ')}.`);
            }
            config.source = value as ImageSource;
            break;
        }
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
        case 'agent.via': {
            if (value === 'grok' || value === 'claude') {
                throw new Error(
                    `agent.via "${value}" was removed: the ${value} CLI has no image generation. Use codex or agy.`,
                );
            }
            if (!AGENT_PROVIDERS.includes(value as AgentProvider)) {
                throw new Error(`agent.via must be one of ${AGENT_PROVIDERS.join(', ')}.`);
            }
            config.agent ??= {};
            config.agent.via = value as AgentProvider;
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
        source: flags.source ?? fileConfig.source ?? BUILT_IN_CONFIG.source,
        output: flags.output ?? fileConfig.output ?? BUILT_IN_CONFIG.output,
        render: {
            presets,
            ...(canvas ? { canvas } : {}),
            scale: flags.scale ?? fileConfig.render?.scale ?? BUILT_IN_CONFIG.render.scale,
        },
        ...(fileConfig.stock ? { stock: structuredClone(fileConfig.stock) } : {}),
        ...(fileConfig.agent ? { agent: { ...fileConfig.agent } } : {}),
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

export function renderConfigShow(fileConfig: BeastCoverConfigFile): string {
    const effective = resolveEffectiveConfig(fileConfig, {});
    const redacted: EffectiveConfig = {
        ...effective,
        ...(effective.stock ? { stock: redactStockConfig(effective.stock) } : {}),
    };

    return JSON.stringify(redacted, null, 2);
}
