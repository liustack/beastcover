export type CanvasStrategy = 'paper-border' | 'full-bleed';

export type StyleTier = 'primary' | 'accent';

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

export interface SubjectSlot {
    /** Exact placeholder text inside `prompt`. Replaced with the subject. */
    marker: string;
    /** Printed by the CLI when this style is used. */
    hint?: string;
}

export interface StyleDefinition {
    name: string;
    displayName: string;
    scenarios: readonly string[];
    prompt: string;
    avoid: readonly string[];
    paletteSlots: readonly PaletteSlot[];
    canvas: {
        strategy: CanvasStrategy;
        guidance: string;
    };
    tier: StyleTier;
    isFallback: boolean;
    coverOnly: boolean;
    requiresScene: boolean;
    subjectSlot?: SubjectSlot;
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
