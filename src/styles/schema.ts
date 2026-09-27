export interface PaletteSlot {
    name: string;
    role: string;
    prompt: string;
    css: string;
}

export interface PaletteSlotValue {
    prompt: string;
    css: string;
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
