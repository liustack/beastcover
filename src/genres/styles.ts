// 字的风格：封面类型管点子和构图，风格只管字长什么样（字体、描边、投影、关键词怎么标）。
// 依据 research.md 第 5 节各平台常见的字：B 站和抖音的综艺花字、书法题字，小红书的大字报、
// 圆体贴纸字和备忘录，公众号和生活方式内容的编辑感衬线。细手写体缩到信息流里会糊（第 6.1 节），不做。
import type { TypeColors, TypeSpec } from '../render/type.ts';
import type { FontKit } from './page.ts';

export const STYLE_NAMES = ['bold', 'variety', 'round', 'editorial', 'brush', 'memo'] as const;

export type StyleName = (typeof STYLE_NAMES)[number];

/** 每种风格一句话，放进帮助和报错 */
export const STYLE_SUMMARIES: Readonly<Record<StyleName, string>> = {
    bold: 'heavy type with an outline and a hard shadow, or heavy ink on a light ground',
    variety:
        'variety-show lettering: red type in a white ring and a dark edge, tilted, the keyword swapped',
    round: 'rounded sticker lettering: dark type in a white outline',
    editorial: 'magazine serif: no outline, a soft shadow on pictures',
    brush: 'calligraphy title in a brush font, for travel, documentary, and guofeng',
    memo: 'a phone notes screen: black type on pale blue paper with a yellow marker',
};

export function parseStyle(value: string): StyleName {
    if (!STYLE_NAMES.includes(value as StyleName)) {
        throw new Error(`Unknown style "${value}". Use ${STYLE_NAMES.join(', ')}.`);
    }
    return value as StyleName;
}

/** 字落在什么上面：浅色纯色底（深色字直接压底）、照片，或者深色纯色底 */
export interface Ground {
    light: boolean;
    picture: boolean;
}

// 花字：红字、白色内圈、深色外圈。红和白对比 4.7:1，关键词对调成白字红圈也够。
const VARIETY_RED = '#E0241B';
const INK = '#141414';

/**
 * 这种风格下标题的字和颜色。bold 就是每个类型原来的样子（类型自己给），
 * memo 的字是浅底深字，备忘录的界面由大字报自己画。
 */
export function styledType(
    style: StyleName,
    input: { fonts: FontKit; ground: Ground; colors: TypeColors; bold: TypeSpec },
): { type: TypeSpec; colors: TypeColors } {
    const { fonts, ground, colors, bold } = input;
    switch (style) {
        case 'bold':
        case 'memo':
            return { type: bold, colors };
        case 'variety':
            // 综艺字三层：红字、白色内圈、深色外圈加硬投影。关键词对调成白字红圈。
            // 中文笔画细，彩色放在字上才读得出是红字，放在内圈会把白字吃掉。
            // 纯色底上歪一点更热闹；照片上的标题贴着上沿或下沿排，一歪就伸出标题区，不歪。
            return {
                type: {
                    style: 'double',
                    font: fonts.choose('heavy'),
                    highlight: 'swap',
                    ...(ground.picture ? {} : { tilt: -3 }),
                },
                colors: {
                    fill: VARIETY_RED,
                    ring: '#FFFFFF',
                    stroke: INK,
                    accent: VARIETY_RED,
                },
            };
        case 'round':
            // 贴纸字：深色圆体加白描边，放在什么底上都有一圈白把字托出来。关键词压荧光笔。
            return {
                type: { style: 'outline', font: fonts.choose('round'), highlight: 'marker' },
                colors: { fill: INK, stroke: '#FFFFFF', ring: '#FFFFFF', accent: colors.accent },
            };
        case 'editorial':
        case 'brush':
            // 不描边：浅底上是深色字直接压底，照片和深底上是白字加软投影。
            return {
                type: {
                    style: ground.light ? 'ink' : 'soft',
                    font: fonts.choose(style === 'editorial' ? 'serif' : 'brush'),
                    highlight: ground.light ? (bold.highlight ?? 'marker') : 'color',
                },
                colors,
            };
    }
}
