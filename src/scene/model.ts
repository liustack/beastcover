// 用户自己的图像模型 API key 画场景：GPT Image（openai）或 Nano Banana（gemini）。
// key 只进请求头，服务端回显的 key 在报错前脱敏（openai.ts）。各家返回的分辨率不一定等于
// 要的尺寸（Gemini 按 1K/2K 档），统一归一到要的尺寸再存。
import { mkdirSync, readFileSync } from 'node:fs';
import { dirname } from 'node:path';
import sharp from 'sharp';
import { MODEL_DEFAULTS, type ModelConfig, type ModelProvider } from '../config.ts';
import { generateGeminiImage } from './gemini.ts';
import { generateOpenAiImage, type ModelFetch } from './openai.ts';

export interface ModelPainter {
    provider: ModelProvider;
    apiKey: string;
    model: string;
}

/** 这家配了 key 才能用，模型代号取配置里的，没配用默认 */
export function modelPainter(
    provider: ModelProvider,
    config: ModelConfig | undefined,
): ModelPainter {
    const apiKey = config?.[provider]?.apiKey;
    if (apiKey === undefined || apiKey === '') {
        throw new Error(
            `No API key for ${provider}. Run beastcover config set model.${provider}.apiKey <key>.`,
        );
    }
    return { provider, apiKey, model: config?.[provider]?.model ?? MODEL_DEFAULTS[provider] };
}

/** 配了 key 就算有，没有 key 的不算 */
export function hasModelKey(provider: ModelProvider, config: ModelConfig | undefined): boolean {
    const apiKey = config?.[provider]?.apiKey;
    return apiKey !== undefined && apiKey !== '';
}

function aspectRatioOf(width: number, height: number): string {
    const gcd = (a: number, b: number): number => (b === 0 ? a : gcd(b, a % b));
    const d = gcd(width, height);
    return `${width / d}:${height / d}`;
}

export async function paintWithModel(input: {
    painter: ModelPainter;
    prompt: string;
    width: number;
    height: number;
    generatedPath: string;
    /** 照着改的那张图的路径（前后对比的「后」照着「前」画） */
    referencePath?: string;
    fetch?: ModelFetch;
}): Promise<void> {
    const { painter } = input;
    const reference =
        input.referencePath === undefined ? {} : { reference: readFileSync(input.referencePath) };
    const fetcher: ModelFetch =
        input.fetch ?? ((url, init) => globalThis.fetch(url, init) as Promise<Response>);
    const bytes =
        painter.provider === 'openai'
            ? await generateOpenAiImage({
                  apiKey: painter.apiKey,
                  model: painter.model,
                  prompt: input.prompt,
                  width: input.width,
                  height: input.height,
                  ...reference,
                  fetch: fetcher,
              })
            : await generateGeminiImage({
                  apiKey: painter.apiKey,
                  model: painter.model,
                  prompt: input.prompt,
                  aspectRatio: aspectRatioOf(input.width, input.height),
                  ...reference,
                  fetch: fetcher,
              });
    mkdirSync(dirname(input.generatedPath), { recursive: true });
    await sharp(bytes, { failOn: 'error' })
        .resize(input.width, input.height, { fit: 'cover' })
        .png()
        .toFile(input.generatedPath);
}
