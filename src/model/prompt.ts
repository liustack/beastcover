import { getAgentGeneratePlan } from '../agent/canvas.ts';
import { buildStyleAndSubjectPrompt } from '../agent/prompt.ts';
import type { FamilyName } from '../platforms/index.ts';
import type { PaletteSlotValue, StyleDefinition } from '../styles/schema.ts';

/** API 直连的提示词：画风原文加主体，再带上族的构图提醒。尺寸走请求参数，不进提示词。 */
export function buildModelPrompt(input: {
    style: StyleDefinition;
    subject: string;
    mergedPalette: Record<string, PaletteSlotValue>;
    family: FamilyName;
}): string {
    const plan = getAgentGeneratePlan(input.family);
    const body = buildStyleAndSubjectPrompt({
        style: input.style,
        subject: input.subject,
        mergedPalette: input.mergedPalette,
    });
    return plan.subjectSuffix === undefined ? body : `${body}。${plan.subjectSuffix}`;
}
