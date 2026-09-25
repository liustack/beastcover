import { renameSync, writeFileSync } from 'node:fs';
import sharp from 'sharp';
import type { LocalModelCanvasPlan } from './canvas.ts';

async function assertGenerateSize(sourcePath: string, plan: LocalModelCanvasPlan): Promise<void> {
    const image = sharp(sourcePath, { failOn: 'error' });
    const meta = await image.metadata();
    if (meta.width === undefined || meta.height === undefined) {
        throw new Error(
            `local-model image size is missing, expected ${plan.generateWidth}x${plan.generateHeight}.`,
        );
    }
    if (meta.width !== plan.generateWidth || meta.height !== plan.generateHeight) {
        throw new Error(
            `local-model image is ${meta.width}x${meta.height}, expected ${plan.generateWidth}x${plan.generateHeight}.`,
        );
    }
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

export async function cropLocalModelImage(
    sourcePath: string,
    plan: LocalModelCanvasPlan,
): Promise<Buffer> {
    await assertGenerateSize(sourcePath, plan);
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

export async function resizeLocalModelImage(
    cropped: Buffer,
    plan: LocalModelCanvasPlan,
): Promise<Buffer> {
    // 裁切框取整后和成品比例差不到一个像素，resize 用 fill 拉满。
    return sharp(cropped)
        .resize(plan.outputWidth, plan.outputHeight, { fit: 'fill' })
        .png()
        .toBuffer();
}

export async function finishLocalModelImage(input: {
    sourcePath: string;
    outputPath: string;
    plan: LocalModelCanvasPlan;
}): Promise<{
    cropWidth: number;
    cropHeight: number;
    outputWidth: number;
    outputHeight: number;
}> {
    const cropped = await cropLocalModelImage(input.sourcePath, input.plan);
    const finished = await resizeLocalModelImage(cropped, input.plan);
    writeFinishedPng(input.outputPath, finished, input.sourcePath);

    return {
        cropWidth: input.plan.cropWidth,
        cropHeight: input.plan.cropHeight,
        outputWidth: input.plan.outputWidth,
        outputHeight: input.plan.outputHeight,
    };
}
