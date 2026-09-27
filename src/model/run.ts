import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import sharp from 'sharp';
import { getAgentCanvasPlan, getAgentGeneratePlan } from '../agent/canvas.ts';
import { finishAgentImage } from '../agent/finish.ts';
import type { ModelProvider } from '../config.ts';
import type { FamilyName, PlatformName } from '../platforms/index.ts';
import { generateGeminiImage } from './gemini.ts';
import { generateOpenAiImage, type ModelFetch } from './openai.ts';

export interface ModelRunInput {
    provider: ModelProvider;
    apiKey: string;
    model: string;
    prompt: string;
    family: FamilyName;
    /** 模型原图落这里，一族一张，之后按族内各平台裁切 */
    generatedPath: string;
    targets: readonly { preset: PlatformName; outputPath: string }[];
    fetch?: ModelFetch;
}

function aspectRatioOf(width: number, height: number): string {
    const gcd = (a: number, b: number): number => (b === 0 ? a : gcd(b, a % b));
    const d = gcd(width, height);
    return `${width / d}:${height / d}`;
}

export async function runModelApi(input: ModelRunInput): Promise<{ outputPaths: string[] }> {
    const plans = input.targets.map((target) => ({
        ...target,
        plan: getAgentCanvasPlan(target.preset),
    }));
    if (plans.some(({ plan }) => plan.family !== input.family)) {
        throw new Error('runModelApi crops one family per generation.');
    }

    const generate = getAgentGeneratePlan(input.family);
    const fetcher: ModelFetch =
        input.fetch ?? ((url, init) => globalThis.fetch(url, init) as Promise<Response>);
    const bytes =
        input.provider === 'openai'
            ? await generateOpenAiImage({
                  apiKey: input.apiKey,
                  model: input.model,
                  prompt: input.prompt,
                  width: generate.generateWidth,
                  height: generate.generateHeight,
                  fetch: fetcher,
              })
            : await generateGeminiImage({
                  apiKey: input.apiKey,
                  model: input.model,
                  prompt: input.prompt,
                  aspectRatio: aspectRatioOf(generate.generateWidth, generate.generateHeight),
                  fetch: fetcher,
              });

    // 各家返回的分辨率不一定等于生成计划（Gemini 按 1K/2K 档），统一归一到计划尺寸再裁。
    mkdirSync(dirname(input.generatedPath), { recursive: true });
    await sharp(bytes, { failOn: 'error' })
        .resize(generate.generateWidth, generate.generateHeight, { fit: 'cover' })
        .png()
        .toFile(input.generatedPath);

    for (const { outputPath, plan } of plans) {
        mkdirSync(dirname(outputPath), { recursive: true });
        await finishAgentImage({ sourcePath: input.generatedPath, outputPath, plan });
    }
    return { outputPaths: plans.map(({ outputPath }) => outputPath) };
}
