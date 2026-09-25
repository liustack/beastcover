import { describe, expect, it } from 'vitest';
import { getPlatform, listPlatforms } from './index.ts';

describe('platform presets', () => {
    it('exposes one preset per platform at its production pixel size', () => {
        expect(listPlatforms()).toEqual([
            { name: 'youtube', width: 1280, height: 720, use: 'YouTube thumbnail' },
            { name: 'bilibili', width: 1146, height: 717, use: 'Bilibili video cover' },
            { name: 'wechat', width: 900, height: 383, use: 'WeChat article cover' },
            { name: 'x', width: 1920, height: 368, use: 'X article cover' },
            { name: 'xiaohongshu', width: 1080, height: 1440, use: 'Xiaohongshu note cover' },
            { name: 'instagram', width: 1080, height: 1440, use: 'Instagram post' },
            {
                name: 'instagram-reels',
                width: 1080,
                height: 1920,
                use: 'Instagram Reels cover',
            },
            { name: 'douyin', width: 1080, height: 1920, use: 'Douyin video cover' },
            { name: 'tiktok', width: 1080, height: 1920, use: 'TikTok video cover' },
        ]);
        expect(getPlatform('wechat')).toEqual({
            name: 'wechat',
            width: 900,
            height: 383,
            use: 'WeChat article cover',
        });
    });

    it('names the replacement when a retired ratio preset is used', () => {
        expect(() => getPlatform('16:9')).toThrowError('Preset "16:9" is now "youtube".');
        expect(() => getPlatform('5:2')).toThrowError(
            'Preset "5:2" is gone. Use "x" or "wechat" for a wide banner cover.',
        );
        expect(() => getPlatform('3:2')).toThrowError(
            'Preset "3:2" is gone. Use "youtube" or "bilibili" for a landscape cover.',
        );
        expect(() => getPlatform('3:4')).toThrowError(
            'Preset "3:4" is now "xiaohongshu" or "instagram".',
        );
    });

    it('lists every preset for an unknown name, including inherited object keys', () => {
        const message =
            'Use youtube, bilibili, wechat, x, xiaohongshu, instagram, instagram-reels, douyin, tiktok.';
        expect(() => getPlatform('square')).toThrowError(
            `Unknown platform preset "square". ${message}`,
        );
        expect(() => getPlatform('toString')).toThrowError(
            `Unknown platform preset "toString". ${message}`,
        );
    });
});
