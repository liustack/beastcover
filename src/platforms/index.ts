export const PLATFORM_NAMES = [
    'youtube',
    'bilibili',
    'wechat',
    'x',
    'xiaohongshu',
    'instagram',
    'instagram-reels',
    'douyin',
    'tiktok',
    'og',
    'github',
] as const;

export type PlatformName = (typeof PLATFORM_NAMES)[number];

export const FAMILY_NAMES = ['landscape', 'portrait', 'ultrawide'] as const;

export type FamilyName = (typeof FAMILY_NAMES)[number];

export interface Rect {
    x: number;
    y: number;
    width: number;
    height: number;
}

/**
 * 比例相近的平台共用一张母版，族内各平台从母版里裁出来。
 * 所有 Rect 都是母版坐标。textArea 和 focusArea 是族内所有平台都看得见、
 * 又不被平台界面挡住的区域，标题放 textArea，主体放 focusArea。
 */
export interface PlatformFamily {
    name: FamilyName;
    masterWidth: number;
    masterHeight: number;
    textArea: Rect;
    focusArea: Rect;
}

export interface Platform {
    name: PlatformName;
    width: number;
    height: number;
    use: string;
    family: FamilyName;
    /** 在母版里裁出这个平台的区域，比例与 width/height 一致 */
    crop: Rect;
    /** 平台界面盖在封面上的区域（时长角标、点赞栏等），母版坐标 */
    covered: readonly Rect[];
    /** 信息流里缩略图的常见宽度，用来检查标题缩小后还认不认得出来 */
    feedWidth: number;
}

const FAMILIES: Readonly<Record<FamilyName, PlatformFamily>> = {
    landscape: {
        name: 'landscape',
        masterWidth: 1920,
        masterHeight: 1200,
        textArea: { x: 192, y: 132, width: 1392, height: 876 },
        focusArea: { x: 192, y: 132, width: 1536, height: 876 },
    },
    portrait: {
        name: 'portrait',
        masterWidth: 1080,
        masterHeight: 1920,
        textArea: { x: 86, y: 384, width: 842, height: 1152 },
        focusArea: { x: 86, y: 384, width: 858, height: 1152 },
    },
    ultrawide: {
        name: 'ultrawide',
        masterWidth: 1920,
        masterHeight: 768,
        // 标题放在正中方块里：公众号转发卡片只露正中的方块
        textArea: { x: 576, y: 72, width: 768, height: 624 },
        focusArea: { x: 576, y: 0, width: 768, height: 768 },
    },
};

const SHORT_VIDEO_UI: readonly Rect[] = [
    { x: 0, y: 0, width: 1080, height: 220 },
    { x: 0, y: 1540, width: 1080, height: 380 },
    { x: 944, y: 768, width: 136, height: 772 },
];

const PORTRAIT_3X4_CROP: Rect = { x: 0, y: 240, width: 1080, height: 1440 };
const PORTRAIT_FULL_CROP: Rect = { x: 0, y: 0, width: 1080, height: 1920 };

const PLATFORMS: Readonly<Record<PlatformName, Platform>> = {
    youtube: {
        name: 'youtube',
        width: 1280,
        height: 720,
        use: 'YouTube thumbnail',
        family: 'landscape',
        crop: { x: 0, y: 60, width: 1920, height: 1080 },
        covered: [{ x: 1632, y: 1008, width: 288, height: 132 }],
        feedWidth: 168,
    },
    bilibili: {
        name: 'bilibili',
        width: 1146,
        height: 717,
        use: 'Bilibili video cover',
        family: 'landscape',
        crop: { x: 0, y: 0, width: 1920, height: 1200 },
        covered: [{ x: 0, y: 1056, width: 1920, height: 144 }],
        feedWidth: 160,
    },
    wechat: {
        name: 'wechat',
        width: 900,
        height: 383,
        use: 'WeChat article cover',
        family: 'ultrawide',
        crop: { x: 58, y: 0, width: 1805, height: 768 },
        covered: [],
        feedWidth: 340,
    },
    x: {
        name: 'x',
        width: 1600,
        height: 640,
        use: 'X article cover',
        family: 'ultrawide',
        crop: { x: 0, y: 0, width: 1920, height: 768 },
        covered: [],
        feedWidth: 500,
    },
    xiaohongshu: {
        name: 'xiaohongshu',
        width: 1080,
        height: 1440,
        use: 'Xiaohongshu note cover',
        family: 'portrait',
        crop: PORTRAIT_3X4_CROP,
        covered: [],
        feedWidth: 180,
    },
    instagram: {
        name: 'instagram',
        width: 1080,
        height: 1440,
        use: 'Instagram post',
        family: 'portrait',
        crop: PORTRAIT_3X4_CROP,
        covered: [],
        feedWidth: 125,
    },
    'instagram-reels': {
        name: 'instagram-reels',
        width: 1080,
        height: 1920,
        use: 'Instagram Reels cover',
        family: 'portrait',
        crop: PORTRAIT_FULL_CROP,
        covered: SHORT_VIDEO_UI,
        feedWidth: 125,
    },
    douyin: {
        name: 'douyin',
        width: 1080,
        height: 1920,
        use: 'Douyin video cover',
        family: 'portrait',
        crop: PORTRAIT_FULL_CROP,
        covered: SHORT_VIDEO_UI,
        feedWidth: 180,
    },
    tiktok: {
        name: 'tiktok',
        width: 1080,
        height: 1920,
        use: 'TikTok video cover',
        family: 'portrait',
        crop: PORTRAIT_FULL_CROP,
        covered: SHORT_VIDEO_UI,
        feedWidth: 125,
    },
    // 网页分享卡片通用的 Open Graph 图，X、微信、Slack、LinkedIn 贴链接时都用它。
    og: {
        name: 'og',
        width: 1200,
        height: 630,
        use: 'Open Graph link preview',
        family: 'landscape',
        crop: { x: 0, y: 96, width: 1920, height: 1008 },
        covered: [],
        feedWidth: 500,
    },
    github: {
        name: 'github',
        width: 1280,
        height: 640,
        use: 'GitHub repository social preview',
        family: 'landscape',
        crop: { x: 0, y: 120, width: 1920, height: 960 },
        covered: [],
        feedWidth: 420,
    },
};

const RETIRED_PRESET_HINTS: ReadonlyMap<string, string> = new Map([
    ['16:9', 'Preset "16:9" is now "youtube".'],
    ['5:2', 'Preset "5:2" is gone. Use "x" or "wechat" for a wide banner cover.'],
    ['3:2', 'Preset "3:2" is gone. Use "youtube" or "bilibili" for a landscape cover.'],
    ['3:4', 'Preset "3:4" is now "xiaohongshu" or "instagram".'],
]);

function copyPlatform(platform: Platform): Platform {
    return {
        ...platform,
        crop: { ...platform.crop },
        covered: platform.covered.map((rect) => ({ ...rect })),
    };
}

export function listPlatforms(): Platform[] {
    return PLATFORM_NAMES.map((name) => copyPlatform(PLATFORMS[name]));
}

export function getFamily(name: FamilyName): PlatformFamily {
    const family = FAMILIES[name];
    return {
        ...family,
        textArea: { ...family.textArea },
        focusArea: { ...family.focusArea },
    };
}

/** `all` 或逗号分隔的平台名，去重后按 PLATFORM_NAMES 的顺序返回 */
export function parsePlatformList(value: string): PlatformName[] {
    const names = value
        .split(',')
        .map((name) => name.trim())
        .filter((name) => name !== '');
    if (names.length === 0) {
        throw new Error(`Preset list is empty. Use all or ${PLATFORM_NAMES.join(', ')}.`);
    }
    if (names.includes('all')) {
        if (names.length > 1) {
            throw new Error('Preset "all" cannot be combined with other presets.');
        }
        return [...PLATFORM_NAMES];
    }
    const requested = new Set(names.map((name) => getPlatform(name).name));
    return PLATFORM_NAMES.filter((name) => requested.has(name));
}

export function getPlatform(name: string): Platform {
    if (!PLATFORM_NAMES.includes(name as PlatformName)) {
        const hint = RETIRED_PRESET_HINTS.get(name);
        throw new Error(
            hint ?? `Unknown platform preset "${name}". Use ${PLATFORM_NAMES.join(', ')}.`,
        );
    }

    return copyPlatform(PLATFORMS[name as PlatformName]);
}
