import type { LocalModelProvider } from '../config.ts';
import type { DimensionPresetName } from '../dimensions.ts';
import type { PaletteSlotValue, StyleDefinition } from '../styles/schema.ts';
import { getLocalModelCanvasPlan } from './canvas.ts';

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

export function buildEnvelopePrompt(input: {
    style: StyleDefinition;
    subject: string;
    mergedPalette: Record<string, PaletteSlotValue>;
    outputPath: string;
    preset: DimensionPresetName;
    provider: LocalModelProvider;
    referencePaths?: string[];
}): string {
    const plan = getLocalModelCanvasPlan(input.preset);
    const body = stylePromptWithPalette(input.style, input.mergedPalette);
    const size = formatSizePhrase(plan.generateWidth, plan.generateHeight);
    const subjectLine =
        plan.subjectSuffix === undefined
            ? `主体：${input.subject}`
            : `主体：${input.subject}。${plan.subjectSuffix}`;
    const envelope =
        `Use your image generation capability to create one image and save it to ${input.outputPath}. ` +
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
