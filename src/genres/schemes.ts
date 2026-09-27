// 配色方案：一个主色加一个强调色，亮度差和冷暖差都大。来自调研的可用组合
// （.issues/2026-09-27-breakout-design/research.md 第 4.3 节），色值是示例值。
import type { TypeColors } from '../render/type.ts';

export interface Scheme {
    /** 背景：主色，渐变的两端 */
    base: string;
    baseDeep: string;
    /** 标题的字、描边、内圈、强调色 */
    type: TypeColors;
}

const SCHEME_TABLE = {
    /** 深海军蓝底加黄：科技、理财、教育、大多数带脸封面，冷底托暖字暖肤 */
    navy: {
        base: '#123A6B',
        baseDeep: '#0B1F3A',
        type: { fill: '#FFFFFF', stroke: '#0B0B0B', ring: '#FFFFFF', accent: '#FFD60A' },
    },
    /** 近黑底加荧光绿：评论、游戏、红色扎堆的赛道 */
    night: {
        base: '#1C2126',
        baseDeep: '#0B0D10',
        type: { fill: '#FFFFFF', stroke: '#000000', ring: '#FFFFFF', accent: '#B6FF00' },
    },
    /** 暖橙底加白字：美食、健身、生活 */
    orange: {
        base: '#FF7A1A',
        baseDeep: '#E04E00',
        type: { fill: '#FFFFFF', stroke: '#1A0E00', ring: '#FFFFFF', accent: '#FFE600' },
    },
    /** 青底加白字：测评、旅行、讲解，冷底不用边缘光就能分开脸 */
    teal: {
        base: '#138A94',
        baseDeep: '#0A5C63',
        type: { fill: '#FFFFFF', stroke: '#06282B', ring: '#FFFFFF', accent: '#FFD60A' },
    },
    /** 奶油白底加深色字：大字报、教育、安静的讲解，一排深色封面里唯一的浅色 */
    cream: {
        base: '#F5EEDC',
        baseDeep: '#EADFC4',
        type: {
            fill: '#121212',
            stroke: '#121212',
            ring: '#FFFFFF',
            accent: '#FFD60A',
            accentInk: '#121212',
        },
    },
    /** 亮黄底加黑字红块：小红书生活类大字报 */
    lemon: {
        base: '#FFE45C',
        baseDeep: '#FFD21F',
        type: {
            fill: '#121212',
            stroke: '#121212',
            ring: '#FFFFFF',
            // 白字压红块要到 4.5:1，#FF3B30 只有 3.5:1。
            accent: '#E0241B',
            accentInk: '#FFFFFF',
        },
    },
} as const satisfies Record<string, Scheme>;

export type SchemeName = keyof typeof SCHEME_TABLE;
export const SCHEMES: Readonly<Record<SchemeName, Scheme>> = SCHEME_TABLE;
export const SCHEME_NAMES = Object.keys(SCHEMES) as SchemeName[];

export function parseScheme(value: string): SchemeName {
    if (!(value in SCHEMES)) {
        throw new Error(`Unknown scheme "${value}". Use ${SCHEME_NAMES.join(', ')}.`);
    }
    return value as SchemeName;
}

const LIGHT_SCHEMES: ReadonlySet<SchemeName> = new Set(['cream', 'lemon']);

/** 浅底方案：深色字直接压底，不描边 */
export function isLightScheme(name: SchemeName): boolean {
    return LIGHT_SCHEMES.has(name);
}

/** 同色相两档的渐变，从字那一侧亮到另一侧深 */
export function schemeGradient(scheme: Scheme, angle = 135): string {
    return `linear-gradient(${angle}deg, ${scheme.base}, ${scheme.baseDeep})`;
}
