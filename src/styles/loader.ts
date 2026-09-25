import { BUILT_IN_STYLES } from './catalog.ts';
import type { StyleDefinition } from './schema.ts';

const stylesByName = new Map<string, StyleDefinition>(
    BUILT_IN_STYLES.map((style) => [style.name, style]),
);

export function listStyles(): readonly StyleDefinition[] {
    return BUILT_IN_STYLES;
}

// 只做封面之后删掉的风格：缩成缩略图就认不出来。给个明确提示，免得像拼错了名字。
const RETIRED_STYLES = new Set([
    'minimal_watercolor',
    'freehand_doodle',
    'memory_color_blocks',
    'single_line_sketch',
    'extreme_minimal_abstraction',
    'monet_editorial_impressionism',
]);

export function loadStyle(name: string): StyleDefinition {
    const style = stylesByName.get(name);
    if (!style) {
        const names = BUILT_IN_STYLES.map((item) => item.name).join(', ');
        throw new Error(
            RETIRED_STYLES.has(name)
                ? `Style "${name}" was removed because it does not hold up as a cover. Use ${names}.`
                : `Unknown style "${name}". Use ${names}.`,
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
