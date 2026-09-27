// 故事画面：封面类型要场景照片、用户又没给 --photo 时，用 --scene 描述的画面现画。
// 前后对比画两张，第二张照着第一张改，保证是同一个地方。
// 按本机能力分级：配了图像模型 API key 用模型，装了 agent CLI 用 agent，都没有就退到配色渐变，
// 并打印一行说明装什么能画出来。点名了后端（--via 或 scene.via）就只用它，没有就报错，不换家。
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import sharp from 'sharp';
import {
    AGENT_PROVIDERS,
    type AgentProvider,
    MODEL_PROVIDERS,
    type ModelConfig,
    type ModelProvider,
    type PainterName,
} from '../config.ts';
import type { FamilyName } from '../platforms/index.ts';
import { type AgentSpawnRequest, paintWithAgent, sceneEnvelope } from './agent.ts';
import { hasModelKey, type ModelPainter, modelPainter, paintWithModel } from './model.ts';
import type { ModelFetch } from './openai.ts';

export type ScenePainter =
    | ({ kind: 'model' } & ModelPainter)
    | { kind: 'agent'; provider: AgentProvider; commandPath: string };

export type SceneOrientation = 'landscape' | 'portrait';

// 生图模型的原生尺寸：横版和超宽共用横图，竖版用竖图。
export const SCENE_SIZE: Readonly<Record<SceneOrientation, { width: number; height: number }>> = {
    landscape: { width: 1536, height: 1024 },
    portrait: { width: 1024, height: 1536 },
};

export const MAX_SCENE_LENGTH = 200;

export function parseScene(value: string): string {
    const scene = value.trim();
    if (scene === '') {
        throw new Error('--scene must not be empty.');
    }
    if (Array.from(scene).length > MAX_SCENE_LENGTH) {
        throw new Error(
            `--scene is longer than ${MAX_SCENE_LENGTH} characters. Describe one picture in a sentence or two.`,
        );
    }
    return scene;
}

function agentPainter(
    provider: AgentProvider,
    lookup: (name: string) => string | undefined,
): ScenePainter | undefined {
    const commandPath = lookup(provider);
    return commandPath === undefined ? undefined : { kind: 'agent', provider, commandPath };
}

/**
 * 找画场景的后端。点名了就只看点名的，缺 key 或没装就报错；没点名时先看配了 key 的图像模型，
 * 再看 PATH 上的 agent CLI。都没有返回 undefined，由调用方退到渐变并说明。
 */
export function findScenePainter(input: {
    via?: PainterName;
    model?: ModelConfig;
    lookup: (name: string) => string | undefined;
}): ScenePainter | undefined {
    const { via } = input;
    if (via !== undefined) {
        if (MODEL_PROVIDERS.includes(via as ModelProvider)) {
            return { kind: 'model', ...modelPainter(via as ModelProvider, input.model) };
        }
        const painter = agentPainter(via as AgentProvider, input.lookup);
        if (painter === undefined) {
            throw new Error(
                `${via} is not installed. Install it or pick another painter with --via.`,
            );
        }
        return painter;
    }
    for (const provider of MODEL_PROVIDERS) {
        if (hasModelKey(provider, input.model)) {
            return { kind: 'model', ...modelPainter(provider, input.model) };
        }
    }
    for (const provider of AGENT_PROVIDERS) {
        const painter = agentPainter(provider, input.lookup);
        if (painter !== undefined) {
            return painter;
        }
    }
    return undefined;
}

/**
 * 这一族的场景画成横的还是竖的。满版的类型跟着画布走。分两半的类型（前后对比）看半边的形状：
 * 横版左右分，半边偏竖，画竖图；竖版上下分，半边偏横，画横图；超宽版左右分，半边还是横的。
 */
export function sceneOrientation(family: FamilyName, halves = false): SceneOrientation {
    if (halves) {
        return family === 'landscape' ? 'portrait' : 'landscape';
    }
    return family === 'portrait' ? 'portrait' : 'landscape';
}

/**
 * 场景照片的提示词：真实照片，一个清楚的主体，不要任何字（封面的字由 BeastCover 排，画里有字
 * 会和标题打架）。满版的类型标题压在画上，要留一块安静的地方。分两半的类型标题在中间的色带上，
 * 画面就让主体占满，别留一大片空桌面。
 */
export function scenePrompt(scene: string, halves = false): string {
    return [
        `A real photograph, not an illustration: ${scene}.`,
        'One clear subject with natural light and real textures, shot like a documentary still.',
        halves
            ? 'Let the subject fill the frame, with no large empty area.'
            : 'Keep the lower third calm and uncluttered so a headline can sit there.',
        'No text, letters, numbers, logos, captions, or watermarks anywhere in the image.',
    ].join(' ');
}

/**
 * 照着参考图改的提示词：前后对比的「后」必须是同一个地方，机位、取景、光线、没变的东西都不动，
 * 只改描述里说的。两张不是同一处，对比就不成立。
 */
export function sceneEditPrompt(change: string): string {
    return [
        'Edit the reference photograph. Keep the same place, camera position, framing, lens, and light, and keep every object the change does not touch exactly where it is.',
        `Change only this: ${change}.`,
        'It stays a real photograph, not an illustration.',
        'No text, letters, numbers, logos, captions, or watermarks anywhere in the image.',
    ].join(' ');
}

export interface PaintOptions {
    verbose?: boolean;
    backendOutput?: { write(chunk: string): unknown };
    /** 测试注入：不真的发请求、不真的起进程 */
    fetch?: ModelFetch;
    spawn?: (request: AgentSpawnRequest) => Promise<void>;
}

export interface SceneRequest {
    /** 画什么。给了 reference 时是要改成什么样 */
    scene: string;
    orientation: SceneOrientation;
    runDir: string;
    /** 第几张（从 0 起），进文件名，一次画几张不会互相覆盖 */
    index: number;
    /** 照着改的那张图：前后对比的「后」照着「前」画 */
    reference?: string;
    /** 画的是分两半的类型的一半：标题不压在画上，不用留空 */
    halves?: boolean;
}

/** 画一张场景，返回原图路径。一个朝向画一次，同朝向的各族都从它构图 */
export async function paintScene(
    painter: ScenePainter,
    request: SceneRequest,
    options: PaintOptions = {},
): Promise<string> {
    const { orientation, runDir, reference } = request;
    mkdirSync(runDir, { recursive: true });
    const generatedPath = join(runDir, `scene-${orientation}-${request.index + 1}.png`);
    const size = SCENE_SIZE[orientation];
    const prompt =
        reference === undefined
            ? scenePrompt(request.scene, request.halves)
            : sceneEditPrompt(request.scene);
    if (painter.kind === 'model') {
        await paintWithModel({
            painter,
            prompt,
            ...size,
            generatedPath,
            ...(reference === undefined ? {} : { referencePath: reference }),
            ...(options.fetch === undefined ? {} : { fetch: options.fetch }),
        });
    } else {
        await paintWithAgent({
            provider: painter.provider,
            commandPath: painter.commandPath,
            prompt: sceneEnvelope({
                prompt,
                generatedPath,
                ...size,
                ...(reference === undefined ? {} : { referencePath: reference }),
            }),
            ...(reference === undefined ? {} : { referencePath: reference }),
            generatedPath,
            ...(options.verbose === undefined ? {} : { verbose: options.verbose }),
            ...(options.backendOutput === undefined
                ? {}
                : { backendOutput: options.backendOutput }),
            ...(options.spawn === undefined ? {} : { spawn: options.spawn }),
        });
    }
    return generatedPath;
}

/**
 * 画不了时的场景：配色两档的斜向渐变。一张实打实的图片，封面类型照常构图、压暗、排字，
 * 只是画面不讲故事，所以一定要打印降级说明。
 */
export async function gradientScene(
    colors: { base: string; deep: string },
    orientation: SceneOrientation,
    runDir: string,
): Promise<string> {
    mkdirSync(runDir, { recursive: true });
    const { width, height } = SCENE_SIZE[orientation];
    const path = join(runDir, `scene-${orientation}-gradient.png`);
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">
        <defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0" stop-color="${colors.base}"/><stop offset="1" stop-color="${colors.deep}"/>
        </linearGradient></defs>
        <rect width="100%" height="100%" fill="url(#g)"/>
    </svg>`;
    await sharp(Buffer.from(svg)).png().toFile(path);
    return path;
}

/** 画不了场景时的说明：用了什么代替、怎么才能画出来 */
export const SCENE_DEGRADED =
    'Scene: no image model key or agent CLI on this machine, so the scene is a plain colour gradient. Pass --photo, set model.openai.apiKey or model.gemini.apiKey, or install codex or agy to paint it.';

export function painterLabel(painter: ScenePainter): string {
    return painter.kind === 'model'
        ? `${painter.provider} ${painter.model} (your API key)`
        : `your ${painter.provider} CLI`;
}
