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
    /** 裁切只留中间一小块的预设才有，提醒模型把主体放进那块 */
    subjectSuffix?: string;
}

// 生成尺寸只用模型原生的 1536x1024 与 1024x1536，再从正中裁出目标比例。
const LANDSCAPE = { generateWidth: 1536, generateHeight: 1024 } as const;
const PORTRAIT = { generateWidth: 1024, generateHeight: 1536 } as const;

const PORTRAIT_3X4 = {
    ...PORTRAIT,
    cropWidth: 1024,
    cropHeight: 1365,
    cropLeft: 0,
    cropTop: 85,
    outputWidth: 1080,
    outputHeight: 1440,
} as const;

const PORTRAIT_9X16 = {
    ...PORTRAIT,
    cropWidth: 864,
    cropHeight: 1536,
    cropLeft: 80,
    cropTop: 0,
    outputWidth: 1080,
    outputHeight: 1920,
} as const;

const LOCAL_MODEL_CANVAS_PLANS: Record<DimensionPresetName, LocalModelCanvasPlan> = {
    youtube: {
        preset: 'youtube',
        ...LANDSCAPE,
        cropWidth: 1536,
        cropHeight: 864,
        cropLeft: 0,
        cropTop: 80,
        outputWidth: 1280,
        outputHeight: 720,
    },
    bilibili: {
        preset: 'bilibili',
        ...LANDSCAPE,
        cropWidth: 1536,
        cropHeight: 961,
        cropLeft: 0,
        cropTop: 31,
        outputWidth: 1146,
        outputHeight: 717,
    },
    wechat: {
        preset: 'wechat',
        ...LANDSCAPE,
        cropWidth: 1536,
        cropHeight: 654,
        cropLeft: 0,
        cropTop: 185,
        outputWidth: 900,
        outputHeight: 383,
        subjectSuffix: '主体集中在画面正中，四周只放背景',
    },
    x: {
        preset: 'x',
        ...LANDSCAPE,
        cropWidth: 1536,
        cropHeight: 294,
        cropLeft: 0,
        cropTop: 365,
        outputWidth: 1920,
        outputHeight: 368,
        subjectSuffix: '主体集中在画面中间的窄横带内，上下只放背景',
    },
    xiaohongshu: { preset: 'xiaohongshu', ...PORTRAIT_3X4 },
    instagram: { preset: 'instagram', ...PORTRAIT_3X4 },
    'instagram-reels': { preset: 'instagram-reels', ...PORTRAIT_9X16 },
    douyin: { preset: 'douyin', ...PORTRAIT_9X16 },
    tiktok: { preset: 'tiktok', ...PORTRAIT_9X16 },
};

export function getLocalModelCanvasPlan(preset: DimensionPresetName): LocalModelCanvasPlan {
    getDimensionPreset(preset);
    return { ...LOCAL_MODEL_CANVAS_PLANS[preset] };
}
