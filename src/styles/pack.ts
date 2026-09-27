// 一次运行的风格包：风格名加可选的调色板覆盖。没有档案，--style 旗标或 fallback 决定。

import { loadFallbackStyle, loadStyle } from './loader.ts';
import type { PaletteSlotValue } from './schema.ts';

export interface PaletteSlotOverride {
    prompt?: string;
    css?: string;
}

export interface StylePack {
    style: string;
    palette: Record<string, PaletteSlotOverride>;
    composition: string;
}

/** --style 给了就精确匹配（错名报错不猜），没给用目录的 fallback 风格 */
export function packFor(styleName: string | undefined): StylePack {
    const style = styleName === undefined ? loadFallbackStyle() : loadStyle(styleName);
    return { style: style.name, palette: {}, composition: style.composition };
}

export function mergedPalette(pack: StylePack): Record<string, PaletteSlotValue> {
    const style = loadStyle(pack.style);
    const palette: Record<string, PaletteSlotValue> = {};
    for (const slot of style.paletteSlots) {
        const override = pack.palette[slot.name];
        palette[slot.name] = {
            prompt: override && override.prompt !== undefined ? override.prompt : slot.prompt,
            css: override && override.css !== undefined ? override.css : slot.css,
        };
    }
    return palette;
}
