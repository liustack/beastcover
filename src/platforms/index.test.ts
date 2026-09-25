import { describe, expect, it } from 'vitest';
import {
    FAMILY_NAMES,
    getFamily,
    getPlatform,
    listPlatforms,
    PLATFORM_NAMES,
    parsePlatformList,
    type Rect,
} from './index.ts';

function inside(inner: Rect, outer: Rect): boolean {
    return (
        inner.x >= outer.x &&
        inner.y >= outer.y &&
        inner.x + inner.width <= outer.x + outer.width &&
        inner.y + inner.height <= outer.y + outer.height
    );
}

function overlaps(a: Rect, b: Rect): boolean {
    return (
        a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height
    );
}

describe('platform presets', () => {
    it('exposes one preset per platform at its production pixel size', () => {
        expect(
            listPlatforms().map(({ name, width, height, family }) => [name, width, height, family]),
        ).toEqual([
            ['youtube', 1280, 720, 'landscape'],
            ['bilibili', 1146, 717, 'landscape'],
            ['wechat', 900, 383, 'ultrawide'],
            ['x', 1920, 368, 'ultrawide'],
            ['xiaohongshu', 1080, 1440, 'portrait'],
            ['instagram', 1080, 1440, 'portrait'],
            ['instagram-reels', 1080, 1920, 'portrait'],
            ['douyin', 1080, 1920, 'portrait'],
            ['tiktok', 1080, 1920, 'portrait'],
        ]);
        expect(getPlatform('wechat').use).toBe('WeChat article cover');
    });

    it('crops every platform from its family master at the platform ratio', () => {
        for (const platform of listPlatforms()) {
            const family = getFamily(platform.family);
            const master = { x: 0, y: 0, width: family.masterWidth, height: family.masterHeight };
            expect(inside(platform.crop, master), platform.name).toBe(true);
            const drift =
                platform.crop.width / platform.crop.height / (platform.width / platform.height) - 1;
            expect(Math.abs(drift), platform.name).toBeLessThan(0.002);
            expect(
                Math.abs(platform.crop.x + platform.crop.width / 2 - family.masterWidth / 2),
                `${platform.name} is centred horizontally`,
            ).toBeLessThanOrEqual(1);
        }
    });

    it('keeps the family text and focus areas visible and uncovered on every member', () => {
        for (const familyName of FAMILY_NAMES) {
            const family = getFamily(familyName);
            const members = listPlatforms().filter((platform) => platform.family === familyName);
            expect(members.length, familyName).toBeGreaterThan(1);
            for (const platform of members) {
                for (const [label, area] of [
                    ['text', family.textArea],
                    ['focus', family.focusArea],
                ] as const) {
                    expect(inside(area, platform.crop), `${platform.name} ${label}`).toBe(true);
                    for (const covered of platform.covered) {
                        expect(overlaps(area, covered), `${platform.name} ${label}`).toBe(false);
                    }
                }
            }
        }
    });

    it('keeps the wechat share square and the title band inside the wechat crop', () => {
        const ultrawide = getFamily('ultrawide');
        expect(ultrawide.focusArea).toEqual({ x: 776, y: 0, width: 368, height: 368 });
        expect(inside(ultrawide.textArea, getPlatform('wechat').crop)).toBe(true);
    });

    it('returns copies so callers cannot mutate the tables', () => {
        const platform = getPlatform('youtube');
        platform.crop.y = 0;
        const family = getFamily('landscape');
        family.textArea.x = 0;
        expect(getPlatform('youtube').crop.y).toBe(60);
        expect(getFamily('landscape').textArea.x).toBe(192);
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

describe('platform lists', () => {
    it('parses comma lists into catalog order without duplicates', () => {
        expect(parsePlatformList('douyin, wechat,youtube,wechat')).toEqual([
            'youtube',
            'wechat',
            'douyin',
        ]);
        expect(parsePlatformList('x')).toEqual(['x']);
    });

    it('expands all to every platform', () => {
        expect(parsePlatformList('all')).toEqual([...PLATFORM_NAMES]);
    });

    it('rejects empty lists, all mixed with names, and unknown names', () => {
        expect(() => parsePlatformList(' , ')).toThrowError(/Preset list is empty/);
        expect(() => parsePlatformList('all,x')).toThrowError(
            'Preset "all" cannot be combined with other presets.',
        );
        expect(() => parsePlatformList('x,16:9')).toThrowError('Preset "16:9" is now "youtube".');
    });
});
