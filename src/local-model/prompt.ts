import type { LocalModelProvider } from '../config.ts';
import type { FamilyName } from '../platforms/index.ts';
import type { PaletteSlotValue, StyleDefinition } from '../styles/schema.ts';
import { getLocalModelGeneratePlan } from './canvas.ts';

const ENVELOPE_CLOSER = 'Generate the image file only, do not do anything else.';

export function formatSizePhrase(width: number, height: number): string {
    return height > width ? `竖版 ${width}x${height}` : `Landscape ${width}x${height}`;
}

function mergedSlot(
    mergedPalette: Record<string, PaletteSlotValue>,
    slotName: string,
): PaletteSlotValue {
    const value = mergedPalette[slotName];
    if (value === undefined) {
        throw new Error(`Missing merged palette slot "${slotName}".`);
    }
    return value;
}

function palettePromptDiffers(
    style: StyleDefinition,
    mergedPalette: Record<string, PaletteSlotValue>,
): boolean {
    for (const slot of style.paletteSlots) {
        if (mergedSlot(mergedPalette, slot.name).prompt !== slot.prompt) {
            return true;
        }
    }
    return false;
}

function formatPaletteParagraph(
    style: StyleDefinition,
    mergedPalette: Record<string, PaletteSlotValue>,
): string {
    const parts = style.paletteSlots.map((slot) => {
        const value = mergedSlot(mergedPalette, slot.name);
        return `${slot.role} ${value.prompt}`;
    });
    return `配色：${parts.join('，')}。`;
}

function replacePaletteParagraph(prompt: string, replacement: string): string {
    const paragraphs = prompt.split('\n\n');
    const index = paragraphs.findIndex((paragraph) => paragraph.trim().startsWith('配色'));
    if (index === -1) {
        throw new Error('Could not find a palette paragraph starting with 配色.');
    }
    paragraphs[index] = replacement;
    return paragraphs.join('\n\n');
}

function stylePromptWithPalette(
    style: StyleDefinition,
    mergedPalette: Record<string, PaletteSlotValue>,
): string {
    if (!palettePromptDiffers(style, mergedPalette)) {
        return style.prompt;
    }
    return replacePaletteParagraph(style.prompt, formatPaletteParagraph(style, mergedPalette));
}

export function buildStyleAndSubjectPrompt(input: {
    style: StyleDefinition;
    subject: string;
    mergedPalette: Record<string, PaletteSlotValue>;
}): string {
    return `${stylePromptWithPalette(input.style, input.mergedPalette)}\n\n主体：${input.subject}`;
}

export type RemixMode = 'restyle' | 'place';

// 二创的要求并进主体那一句，画风原文照旧一字不改。
const REMIX_INSTRUCTIONS: Readonly<Record<RemixMode, string>> = {
    restyle: '以参考图 1 为底稿重绘：保留构图、人物姿态和脸部特征，只换成上面的画风',
    place: '把参考图 1 里的人放进参考图 2 的场景：这个人的脸、发型和衣着保持不变，光线和色调跟着场景走',
};

export function buildEnvelopePrompt(input: {
    style: StyleDefinition;
    subject: string;
    mergedPalette: Record<string, PaletteSlotValue>;
    /** 模型把原图存到这里，之后再按族内各平台裁切 */
    generatedPath: string;
    family: FamilyName;
    provider: LocalModelProvider;
    referencePaths?: string[];
    /** 二创：restyle 按画风重绘参考图 1，place 把参考图 1 的人放进参考图 2 的场景 */
    remix?: RemixMode;
}): string {
    const plan = getLocalModelGeneratePlan(input.family);
    const body = stylePromptWithPalette(input.style, input.mergedPalette);
    const size = formatSizePhrase(plan.generateWidth, plan.generateHeight);
    const remix = input.remix === undefined ? '' : `。${REMIX_INSTRUCTIONS[input.remix]}`;
    const subjectLine =
        plan.subjectSuffix === undefined
            ? `主体：${input.subject}${remix}`
            : `主体：${input.subject}${remix}。${plan.subjectSuffix}`;
    const envelope =
        `Use your image generation capability to create one image and save it to ${input.generatedPath}. ` +
        `${body}. ${subjectLine}. ${size}. ${ENVELOPE_CLOSER}`;

    if (
        (input.provider === 'grok' || input.provider === 'claude') &&
        input.referencePaths !== undefined &&
        input.referencePaths.length > 0
    ) {
        return `${envelope}\n${input.referencePaths.join('\n')}`;
    }

    return envelope;
}
