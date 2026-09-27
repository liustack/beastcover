import { renameSync, writeFileSync } from 'node:fs';
import sharp from 'sharp';
import type { AgentCanvasPlan } from './canvas.ts';

async function normalizeGenerateSize(sourcePath: string, plan: AgentCanvasPlan): Promise<void> {
    const image = sharp(sourcePath, { failOn: 'error' });
    const meta = await image.metadata();
    if (meta.width === undefined || meta.height === undefined) {
        throw new Error(
            `agent image size is missing, expected ${plan.generateWidth}x${plan.generateHeight}.`,
        );
    }
    if (meta.width === plan.generateWidth && meta.height === plan.generateHeight) {
        return;
    }
    // 模型不总按提示词给尺寸（agy 常给同比例小图）。和 model 源一致：归一到生成计划
    // 尺寸再裁，比例偏差由 cover 裁掉，别在模型跑完之后才把图扔掉。
    const normalized = await sharp(sourcePath, { failOn: 'error' })
        .resize(plan.generateWidth, plan.generateHeight, { fit: 'cover' })
        .png()
        .toBuffer();
    writeFileSync(sourcePath, normalized);
}

function writeFinishedPng(outputPath: string, bytes: Buffer, sourcePath: string): void {
    if (sourcePath === outputPath) {
        const tempPath = `${outputPath}.tmp`;
        writeFileSync(tempPath, bytes);
        renameSync(tempPath, outputPath);
        return;
    }
    writeFileSync(outputPath, bytes);
}

export async function cropAgentImage(sourcePath: string, plan: AgentCanvasPlan): Promise<Buffer> {
    await normalizeGenerateSize(sourcePath, plan);
    return sharp(sourcePath)
        .extract({
            left: plan.cropLeft,
            top: plan.cropTop,
            width: plan.cropWidth,
            height: plan.cropHeight,
        })
        .png()
        .toBuffer();
}

export async function resizeAgentImage(cropped: Buffer, plan: AgentCanvasPlan): Promise<Buffer> {
    // 裁切框取整后和成品比例差不到一个像素，resize 用 fill 拉满。
    return sharp(cropped)
        .resize(plan.outputWidth, plan.outputHeight, { fit: 'fill' })
        .png()
        .toBuffer();
}

export async function finishAgentImage(input: {
    sourcePath: string;
    outputPath: string;
    plan: AgentCanvasPlan;
}): Promise<{
    cropWidth: number;
    cropHeight: number;
    outputWidth: number;
    outputHeight: number;
}> {
    const cropped = await cropAgentImage(input.sourcePath, input.plan);
    const finished = await resizeAgentImage(cropped, input.plan);
    writeFinishedPng(input.outputPath, finished, input.sourcePath);

    return {
        cropWidth: input.plan.cropWidth,
        cropHeight: input.plan.cropHeight,
        outputWidth: input.plan.outputWidth,
        outputHeight: input.plan.outputHeight,
    };
}
