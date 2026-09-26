import { type FamilyName, getPlatform, type PlatformName } from '../platforms/index.ts';

/** 一族只让模型生成一次：原生尺寸和构图提示按族定，族内各平台再各自裁切 */
export interface LocalModelGeneratePlan {
    family: FamilyName;
    generateWidth: number;
    generateHeight: number;
    /** 族内最窄的裁切只留中间一块时才有，提醒模型把主体放进那块 */
    subjectSuffix?: string;
}

export interface LocalModelCanvasPlan {
    preset: PlatformName;
    family: FamilyName;
    generateWidth: number;
    generateHeight: number;
    cropWidth: number;
    cropHeight: number;
    cropLeft: number;
    cropTop: number;
    outputWidth: number;
    outputHeight: number;
}

// 生成尺寸只用模型原生的 1536x1024 与 1024x1536，再从正中裁出各平台的比例。
const LOCAL_MODEL_GENERATE_PLANS: Record<FamilyName, LocalModelGeneratePlan> = {
    landscape: { family: 'landscape', generateWidth: 1536, generateHeight: 1024 },
    // X 裁掉上下各五分之一，公众号再裁掉左右各一窄条。
    ultrawide: {
        family: 'ultrawide',
        generateWidth: 1536,
        generateHeight: 1024,
        subjectSuffix: '主体集中在画面正中，上下边缘和左右两侧只放背景',
    },
    // 小红书裁掉上下各一截，抖音顶部和底部被界面挡住。
    portrait: {
        family: 'portrait',
        generateWidth: 1024,
        generateHeight: 1536,
        subjectSuffix: '主体集中在画面中部，顶部和底部只放背景',
    },
};

const LANDSCAPE = { family: 'landscape', generateWidth: 1536, generateHeight: 1024 } as const;
const ULTRAWIDE = { family: 'ultrawide', generateWidth: 1536, generateHeight: 1024 } as const;
const PORTRAIT = { family: 'portrait', generateWidth: 1024, generateHeight: 1536 } as const;

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

const LOCAL_MODEL_CANVAS_PLANS: Record<PlatformName, LocalModelCanvasPlan> = {
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
        ...ULTRAWIDE,
        cropWidth: 1536,
        cropHeight: 654,
        cropLeft: 0,
        cropTop: 185,
        outputWidth: 900,
        outputHeight: 383,
    },
    x: {
        preset: 'x',
        ...ULTRAWIDE,
        cropWidth: 1536,
        cropHeight: 614,
        cropLeft: 0,
        cropTop: 205,
        outputWidth: 1600,
        outputHeight: 640,
    },
    xiaohongshu: { preset: 'xiaohongshu', ...PORTRAIT_3X4 },
    instagram: { preset: 'instagram', ...PORTRAIT_3X4 },
    'instagram-reels': { preset: 'instagram-reels', ...PORTRAIT_9X16 },
    douyin: { preset: 'douyin', ...PORTRAIT_9X16 },
    tiktok: { preset: 'tiktok', ...PORTRAIT_9X16 },
    og: {
        preset: 'og',
        ...LANDSCAPE,
        cropWidth: 1536,
        cropHeight: 806,
        cropLeft: 0,
        cropTop: 109,
        outputWidth: 1200,
        outputHeight: 630,
    },
    github: {
        preset: 'github',
        ...LANDSCAPE,
        cropWidth: 1536,
        cropHeight: 768,
        cropLeft: 0,
        cropTop: 128,
        outputWidth: 1280,
        outputHeight: 640,
    },
};

export function getLocalModelCanvasPlan(preset: PlatformName): LocalModelCanvasPlan {
    getPlatform(preset);
    return { ...LOCAL_MODEL_CANVAS_PLANS[preset] };
}

export function getLocalModelGeneratePlan(family: FamilyName): LocalModelGeneratePlan {
    return { ...LOCAL_MODEL_GENERATE_PLANS[family] };
}
