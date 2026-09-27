// 故事画面：封面类型要一张场景照片、用户又没给 --photo 时，用 --scene 描述的画面现画一张。
// 按本机能力分级：配了图像模型 API key 用模型，装了 agent CLI 用 agent，都没有就退到配色渐变，
// 并打印一行说明装什么能画出来。--via 点名时只用点名的后端，没有就报错，不换家。
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import sharp from 'sharp';
import { buildSceneEnvelopePrompt } from '../agent/prompt.ts';
import type { AgentRunInput } from '../agent/run.ts';
import {
    AGENT_PROVIDERS,
    type AgentProvider,
    MODEL_PROVIDERS,
    type ModelConfig,
    type ModelProvider,
} from '../config.ts';
import { selectModelProvider } from '../model/provider.ts';
import type { ModelRunInput } from '../model/run.ts';
import type { FamilyName } from '../platforms/index.ts';

export type ScenePainter =
    | { kind: 'model'; provider: ModelProvider; apiKey: string; model: string }
    | { kind: 'agent'; provider: AgentProvider; commandPath: string };

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

/**
 * 找画场景的后端：点名了就只看点名的；没点名时先看配了 key 的图像模型，再看 PATH 上的 agent CLI。
 * 都没有返回 undefined，由调用方退到渐变并说明。
 */
export function findScenePainter(input: {
    via?: string;
    model?: ModelConfig;
    lookup: (name: string) => string | undefined;
}): ScenePainter | undefined {
    const { via } = input;
    if (via !== undefined) {
        if (MODEL_PROVIDERS.includes(via as ModelProvider)) {
            return {
                kind: 'model',
                ...selectModelProvider({
                    via: via as ModelProvider,
                    ...(input.model === undefined ? {} : { config: input.model }),
                }),
            };
        }
        if (AGENT_PROVIDERS.includes(via as AgentProvider)) {
            const commandPath = input.lookup(via);
            if (commandPath === undefined) {
                throw new Error(`No installed CLI found for via "${via}". Install ${via}.`);
            }
            return { kind: 'agent', provider: via as AgentProvider, commandPath };
        }
        throw new Error(
            `Unknown --via "${via}". Use ${[...MODEL_PROVIDERS, ...AGENT_PROVIDERS].join(', ')}.`,
        );
    }
    for (const provider of MODEL_PROVIDERS) {
        const apiKey = input.model?.[provider]?.apiKey;
        if (apiKey !== undefined && apiKey !== '') {
            return {
                kind: 'model',
                ...selectModelProvider({
                    via: provider,
                    ...(input.model === undefined ? {} : { config: input.model }),
                }),
            };
        }
    }
    for (const provider of AGENT_PROVIDERS) {
        const commandPath = input.lookup(provider);
        if (commandPath !== undefined) {
            return { kind: 'agent', provider, commandPath };
        }
    }
    return undefined;
}

/** 这一族的场景画成横的还是竖的：横版和超宽共用一张横图，竖版单画一张竖图 */
export function sceneOrientation(family: FamilyName): 'landscape' | 'portrait' {
    return family === 'portrait' ? 'portrait' : 'landscape';
}

const ORIENTATION_FAMILY: Readonly<Record<'landscape' | 'portrait', FamilyName>> = {
    landscape: 'landscape',
    portrait: 'portrait',
};

/**
 * 场景照片的提示词：真实照片，一个清楚的主体，给标题留一块安静的地方，不要任何字。
 * 封面的字由 BeastCover 排，画里有字会和标题打架。
 */
export function scenePrompt(scene: string): string {
    return [
        `A real photograph, not an illustration: ${scene}.`,
        'One clear subject with natural light and real textures, shot like a documentary still.',
        'Keep the lower third calm and uncluttered so a headline can sit there.',
        'No text, letters, numbers, logos, captions, or watermarks anywhere in the image.',
    ].join(' ');
}

export interface SceneRuntime {
    runModelApi: (input: ModelRunInput) => Promise<{ outputPaths: string[] }>;
    runAgent: (input: AgentRunInput) => Promise<{ outputPaths: string[] }>;
    verbose?: boolean;
    backendOutput?: { write(chunk: string): unknown };
}

/** 画一张场景，返回原图路径。一个朝向画一次，同朝向的各族都从它构图 */
export async function paintScene(
    painter: ScenePainter,
    scene: string,
    orientation: 'landscape' | 'portrait',
    runDir: string,
    runtime: SceneRuntime,
): Promise<string> {
    mkdirSync(runDir, { recursive: true });
    const generatedPath = join(runDir, `scene-${orientation}.png`);
    const family = ORIENTATION_FAMILY[orientation];
    const prompt = scenePrompt(scene);
    if (painter.kind === 'model') {
        await runtime.runModelApi({
            provider: painter.provider,
            apiKey: painter.apiKey,
            model: painter.model,
            prompt,
            family,
            generatedPath,
            targets: [],
        });
    } else {
        await runtime.runAgent({
            provider: painter.provider,
            commandPath: painter.commandPath,
            prompt: buildSceneEnvelopePrompt({ prompt, generatedPath, family }),
            referencePaths: [],
            generatedPath,
            targets: [],
            ...(runtime.verbose === undefined ? {} : { verbose: runtime.verbose }),
            ...(runtime.backendOutput === undefined
                ? {}
                : { backendOutput: runtime.backendOutput }),
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
    orientation: 'landscape' | 'portrait',
    runDir: string,
): Promise<string> {
    mkdirSync(runDir, { recursive: true });
    const [width, height] = orientation === 'portrait' ? [1024, 1536] : [1536, 1024];
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
