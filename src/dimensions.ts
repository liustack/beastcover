export const DIMENSION_PRESET_NAMES = ['16:9', '5:2', '3:2', '3:4'] as const;

export type DimensionPresetName = (typeof DIMENSION_PRESET_NAMES)[number];

export interface DimensionPreset {
    name: DimensionPresetName;
    width: number;
    height: number;
    use: string;
}

const DIMENSION_PRESETS: Readonly<Record<DimensionPresetName, DimensionPreset>> = {
    '16:9': { name: '16:9', width: 1600, height: 900, use: 'article cover' },
    '5:2': {
        name: '5:2',
        width: 1600,
        height: 640,
        use: 'social cover or section break',
    },
    '3:2': { name: '3:2', width: 1536, height: 1024, use: 'article illustration' },
    '3:4': { name: '3:4', width: 1242, height: 1656, use: 'vertical social cover' },
};

export function listDimensionPresets(): DimensionPreset[] {
    return DIMENSION_PRESET_NAMES.map((name) => ({ ...DIMENSION_PRESETS[name] }));
}

export function getDimensionPreset(name: string): DimensionPreset {
    if (!DIMENSION_PRESET_NAMES.includes(name as DimensionPresetName)) {
        throw new Error(
            `Unknown dimension preset "${name}". Use ${DIMENSION_PRESET_NAMES.join(', ')}.`,
        );
    }

    return { ...DIMENSION_PRESETS[name as DimensionPresetName] };
}
