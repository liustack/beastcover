import { copyFileSync, renameSync, writeFileSync } from 'node:fs';
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

function needsCrop(plan: LocalModelCanvasPlan): boolean {
    return (
        plan.cropLeft !== 0 ||
        plan.cropTop !== 0 ||
        plan.cropWidth !== plan.generateWidth ||
        plan.cropHeight !== plan.generateHeight
    );
}

function needsResize(plan: LocalModelCanvasPlan): boolean {
    return plan.outputWidth !== plan.cropWidth || plan.outputHeight !== plan.cropHeight;
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
    // 5:2 中带是 614，和 1600x640 差一个像素比例，resize 用 fill 拉满。
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
    await assertGenerateSize(input.sourcePath, input.plan);

    if (!needsCrop(input.plan) && !needsResize(input.plan)) {
        if (input.sourcePath !== input.outputPath) {
            copyFileSync(input.sourcePath, input.outputPath);
        }
        return {
            cropWidth: input.plan.cropWidth,
            cropHeight: input.plan.cropHeight,
            outputWidth: input.plan.outputWidth,
            outputHeight: input.plan.outputHeight,
        };
    }

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
