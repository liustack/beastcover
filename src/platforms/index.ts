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
] as const;

export type PlatformName = (typeof PLATFORM_NAMES)[number];

export interface Platform {
    name: PlatformName;
    width: number;
    height: number;
    use: string;
}

const PLATFORMS: Readonly<Record<PlatformName, Platform>> = {
    youtube: { name: 'youtube', width: 1280, height: 720, use: 'YouTube thumbnail' },
    bilibili: { name: 'bilibili', width: 1146, height: 717, use: 'Bilibili video cover' },
    wechat: { name: 'wechat', width: 900, height: 383, use: 'WeChat article cover' },
    // X 没公布文章封面规格，1920x368 是第三方上传实测值，待自己实测后再定。
    x: { name: 'x', width: 1920, height: 368, use: 'X article cover' },
    xiaohongshu: { name: 'xiaohongshu', width: 1080, height: 1440, use: 'Xiaohongshu note cover' },
    instagram: { name: 'instagram', width: 1080, height: 1440, use: 'Instagram post' },
    'instagram-reels': {
        name: 'instagram-reels',
        width: 1080,
        height: 1920,
        use: 'Instagram Reels cover',
    },
    douyin: { name: 'douyin', width: 1080, height: 1920, use: 'Douyin video cover' },
    tiktok: { name: 'tiktok', width: 1080, height: 1920, use: 'TikTok video cover' },
};

const RETIRED_PRESET_HINTS: ReadonlyMap<string, string> = new Map([
    ['16:9', 'Preset "16:9" is now "youtube".'],
    ['5:2', 'Preset "5:2" is gone. Use "x" or "wechat" for a wide banner cover.'],
    ['3:2', 'Preset "3:2" is gone. Use "youtube" or "bilibili" for a landscape cover.'],
    ['3:4', 'Preset "3:4" is now "xiaohongshu" or "instagram".'],
]);

export function listPlatforms(): Platform[] {
    return PLATFORM_NAMES.map((name) => ({ ...PLATFORMS[name] }));
}

export function getPlatform(name: string): Platform {
    if (!PLATFORM_NAMES.includes(name as PlatformName)) {
        const hint = RETIRED_PRESET_HINTS.get(name);
        throw new Error(
            hint ?? `Unknown platform preset "${name}". Use ${PLATFORM_NAMES.join(', ')}.`,
        );
    }

    return { ...PLATFORMS[name as PlatformName] };
}
