import { type DimensionPresetName, getDimensionPreset } from '../dimensions.ts';

export interface LocalModelCanvasPlan {
    preset: DimensionPresetName;
    generateWidth: number;
    generateHeight: number;
    cropWidth: number;
    cropHeight: number;
    cropLeft: number;
    cropTop: number;
    outputWidth: number;
    outputHeight: number;
    /** 5:2 为「构图集中在中带、上下留纸」，其余预设为 undefined */
    subjectSuffix?: string;
}

const LOCAL_MODEL_CANVAS_PLANS: Record<DimensionPresetName, LocalModelCanvasPlan> = {
    '16:9': {
        preset: '16:9',
        generateWidth: 1536,
        generateHeight: 1024,
        cropWidth: 1536,
        cropHeight: 864,
        cropLeft: 0,
        cropTop: 80,
        outputWidth: 1600,
        outputHeight: 900,
    },
    '5:2': {
        preset: '5:2',
        generateWidth: 1536,
        generateHeight: 1024,
        cropWidth: 1536,
        cropHeight: 614,
        cropLeft: 0,
        cropTop: 205,
        outputWidth: 1600,
        outputHeight: 640,
        subjectSuffix: '构图集中在中带、上下留纸',
    },
    '3:2': {
        preset: '3:2',
        generateWidth: 1536,
        generateHeight: 1024,
        cropWidth: 1536,
        cropHeight: 1024,
        cropLeft: 0,
        cropTop: 0,
        outputWidth: 1536,
        outputHeight: 1024,
    },
    '3:4': {
        preset: '3:4',
        generateWidth: 1024,
        generateHeight: 1536,
        cropWidth: 1024,
        cropHeight: 1365,
        cropLeft: 0,
        cropTop: 85,
        outputWidth: 1242,
        outputHeight: 1656,
    },
};

export function getLocalModelCanvasPlan(preset: DimensionPresetName): LocalModelCanvasPlan {
    getDimensionPreset(preset);
    return { ...LOCAL_MODEL_CANVAS_PLANS[preset] };
}
