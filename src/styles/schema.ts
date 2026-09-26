/** 渲染封面时这个颜色当什么用：底色、字色或强调色 */
export type CoverColor = 'paper' | 'ink' | 'accent';

export interface PaletteSlot {
    name: string;
    role: string;
    prompt: string;
    css: string;
    /** 渲染封面时的用途。风格自己的槽名各不相同，封面按这个字段取色，不按槽名猜 */
    cover?: CoverColor;
}

export interface PaletteSlotValue {
    prompt: string;
    css: string;
    cover?: CoverColor;
}

export interface PaletteSlotOverride {
    prompt?: string;
    css?: string;
}

export interface StyleDefinition {
    name: string;
    displayName: string;
    scenarios: readonly string[];
    prompt: string;
    avoid: readonly string[];
    paletteSlots: readonly PaletteSlot[];
    /** How the picture fills the canvas. Recorded in the workspace, never added to the prompt. */
    composition: string;
    isFallback: boolean;
    requiresScene: boolean;
}

const CSS_COLOR = /^(#(?:[0-9a-fA-F]{3,4}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})|rgb\(|hsl\(|oklch\()/;

export function isCssColorValue(value: string): boolean {
    return CSS_COLOR.test(value.trim());
}

export function parseCssColorValue(value: string): string {
    const trimmed = value.trim();
    if (!CSS_COLOR.test(trimmed)) {
        throw new Error(`Invalid CSS color "${value}".`);
    }
    return trimmed;
}
