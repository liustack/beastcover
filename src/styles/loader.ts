import { BUILT_IN_STYLES } from './catalog.ts';
import type { StyleDefinition } from './schema.ts';

const stylesByName = new Map<string, StyleDefinition>(
    BUILT_IN_STYLES.map((style) => [style.name, style]),
);

export function listStyles(): readonly StyleDefinition[] {
    return BUILT_IN_STYLES;
}

export function loadStyle(name: string): StyleDefinition {
    const style = stylesByName.get(name);
    if (!style) {
        throw new Error(
            `Unknown style "${name}". Use ${BUILT_IN_STYLES.map((item) => item.name).join(', ')}.`,
        );
    }

    return style;
}

export function loadFallbackStyle(): StyleDefinition {
    const matches = BUILT_IN_STYLES.filter((style) => style.isFallback);
    if (matches.length !== 1) {
        throw new Error(
            `Catalog must declare exactly one fallback style. Found ${matches.length}.`,
        );
    }

    return matches[0];
}
