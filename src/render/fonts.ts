// 标题字体：不打包字体，用本机装了的。每个角色一串候选（设计首选在前，系统自带在后），
// 渲染前在同一个 Chromium 里探测装没装、覆盖不覆盖标题里的字、够不够粗，
// 选第一个合格的。都不合格就降级：退到最粗的可用字体加合成加粗，展示字体退到粗黑体，
// 并各打印一行说明，告诉用户装什么字体能拿到完整效果。

export const FONT_ROLES = ['heavy', 'condensed', 'brush', 'round', 'serif'] as const;
export type FontRole = (typeof FONT_ROLES)[number];

export type FontScript = 'cjk' | 'latin';

export interface FontProbe {
    family: string;
    installed: boolean;
    /** 标题里这个文字系统的字全都有字形 */
    covers: boolean;
    /** 900 字重下的笔画密度：墨迹像素 ÷（字数 × 字号²） */
    density: number;
}

export type FontProber = (family: string, script: FontScript) => FontProbe;

export interface FontChoice {
    role: FontRole;
    cjk?: string;
    latin?: string;
    /** CSS font-family，西文字体在前，中文字体在后，逐字回退 */
    stack: string;
    /** 合成加粗：同色描边的宽度，单位 em。0 表示字体本身够粗 */
    syntheticBold: number;
    /** 展示字体没装、退到粗黑体时记下原来的角色 */
    degradedFrom?: FontRole;
    notes: string[];
}

interface Candidates {
    cjk: readonly string[];
    latin: readonly string[];
}

// 本机实测（120px、900 字重）：思源黑体 Heavy / Noto Sans CJK SC Black 0.475，
// Hiragino Sans W9 0.508，PingFang SC Semibold 0.388，Hiragino Sans GB W6 0.374。
// 西文 Futura 0.343、Arial Black 0.333、Impact 0.318、PingFang 0.225。
const HEAVY_DENSITY: Record<FontScript, number> = { cjk: 0.44, latin: 0.28 };

// 从 PingFang Semibold 的 0.388 加到 0.47 上下，大约要 0.035em 宽的同色描边。
const SYNTHETIC_BOLD_EM = 0.035;

const HEAVY_CJK = [
    'Source Han Sans SC',
    'Source Han Sans CN',
    'Noto Sans CJK SC',
    'Noto Sans SC',
    'HarmonyOS Sans SC',
    'MiSans',
    'Alibaba PuHuiTi 3.0',
    'Alibaba PuHuiTi',
    'Hiragino Sans',
    'PingFang SC',
    'Microsoft YaHei',
    'Hiragino Sans GB',
    'Heiti SC',
    'SimHei',
    'WenQuanYi Zen Hei',
] as const;

const CANDIDATES: Readonly<Record<FontRole, Candidates>> = {
    heavy: {
        cjk: HEAVY_CJK,
        latin: [
            'Archivo Black',
            'Montserrat',
            'Anton',
            'Impact',
            'Arial Black',
            'Futura',
            'Avenir Next',
            'Helvetica Neue',
            'Segoe UI',
            'Arial',
        ],
    },
    condensed: {
        cjk: HEAVY_CJK,
        latin: [
            'Anton',
            'Bebas Neue',
            'Oswald',
            'Impact',
            'Avenir Next Condensed',
            'DIN Condensed',
            'Arial Narrow',
        ],
    },
    brush: {
        cjk: [
            'Ma Shan Zheng',
            'Zhi Mang Xing',
            'Liu Jian Mao Cao',
            'Xingkai SC',
            'STXingkai',
            'Kaiti SC',
            'STKaiti',
            'KaiTi',
            'AR PL UKai CN',
        ],
        latin: ['Bangers', 'Permanent Marker'],
    },
    round: {
        cjk: [
            'ZCOOL KuaiLe',
            'Yuanti SC',
            'HanziPen SC',
            'Hannotate SC',
            'Source Han Rounded',
            'YouYuan',
        ],
        latin: ['Baloo 2', 'Nunito', 'Arial Rounded MT Bold'],
    },
    serif: {
        cjk: [
            'Source Han Serif SC',
            'Noto Serif CJK SC',
            'Noto Serif SC',
            'Songti SC',
            'STSong',
            'SimSun',
        ],
        latin: ['Iowan Old Style', 'Playfair Display', 'Georgia', 'Times New Roman'],
    },
};

const GENERIC: Record<FontRole, string> = {
    heavy: 'sans-serif',
    condensed: 'sans-serif',
    brush: 'cursive',
    round: 'sans-serif',
    serif: 'serif',
};

// 粗细有要求的角色：挑够粗的，不够就合成加粗。展示字体（笔刷、圆体、衬线）只看装没装。
const WEIGHTED: ReadonlySet<FontRole> = new Set(['heavy', 'condensed']);

const INSTALL_HINT: Record<FontRole, string> = {
    heavy: 'Source Han Sans (Heavy), HarmonyOS Sans SC, or Alibaba PuHuiTi Heavy',
    condensed: 'Source Han Sans (Heavy) with Anton or Bebas Neue',
    brush: 'Ma Shan Zheng or Zhi Mang Xing',
    round: 'ZCOOL KuaiLe',
    serif: 'Source Han Serif SC',
};

export function fontCandidates(role: FontRole): { cjk: string[]; latin: string[] } {
    const { cjk, latin } = CANDIDATES[role];
    return { cjk: [...cjk], latin: [...latin] };
}

/** 探测要量的全部字体，按文字系统分开，去重 */
export function probeFamilies(): Record<FontScript, string[]> {
    const cjk = new Set<string>();
    const latin = new Set<string>();
    for (const role of FONT_ROLES) {
        for (const name of CANDIDATES[role].cjk) cjk.add(name);
        for (const name of CANDIDATES[role].latin) latin.add(name);
    }
    return { cjk: [...cjk], latin: [...latin] };
}

/** 渲染器的探测结果转成 chooseFont 要的查询函数，没探过的字体当没装 */
export function proberFrom(results: ReadonlyArray<FontProbe & { script: FontScript }>): FontProber {
    const byKey = new Map(results.map((r) => [`${r.script}:${r.family}`, r]));
    return (family, script) =>
        byKey.get(`${script}:${family}`) ?? { family, installed: false, covers: false, density: 0 };
}

function quote(family: string): string {
    return `"${family.replaceAll('"', '')}"`;
}

/** 一个文字系统里挑字体：第一个装了、覆盖、够粗的；没有就退到覆盖的里面最粗的 */
function pick(
    names: readonly string[],
    script: FontScript,
    prober: FontProber,
    weighted: boolean,
): { family?: string; heavyEnough: boolean } {
    const usable = names.map((name) => prober(name, script)).filter((p) => p.installed && p.covers);
    if (!weighted) {
        return { family: usable[0]?.family, heavyEnough: true };
    }
    const heavy = usable.find((p) => p.density >= HEAVY_DENSITY[script]);
    if (heavy !== undefined) {
        return { family: heavy.family, heavyEnough: true };
    }
    const heaviest = [...usable].sort((a, b) => b.density - a.density)[0];
    return { family: heaviest?.family, heavyEnough: false };
}

export function chooseFont(role: FontRole, prober: FontProber): FontChoice {
    const candidates = CANDIDATES[role];
    const weighted = WEIGHTED.has(role);
    const cjk = pick(candidates.cjk, 'cjk', prober, weighted);
    const latin = pick(candidates.latin, 'latin', prober, weighted);

    if (!weighted && cjk.family === undefined) {
        // 展示字体没装：整套退到粗体（西文也换，免得细的手写西文配粗黑中文），说一声装什么。
        const heavy = chooseFont('heavy', prober);
        return {
            ...heavy,
            role,
            degradedFrom: role,
            notes: [
                ...heavy.notes,
                `Font: no ${role} Chinese font found, so the headline uses ${heavy.cjk ?? 'the system sans-serif'} instead. Install ${INSTALL_HINT[role]} for the ${role} look.`,
            ],
        };
    }

    const families = [latin.family, cjk.family].filter(
        (name): name is string => name !== undefined,
    );
    const stack = [...families.map(quote), GENERIC[role]].join(', ');
    const syntheticBold = weighted && !cjk.heavyEnough ? SYNTHETIC_BOLD_EM : 0;
    const notes =
        syntheticBold > 0
            ? [
                  `Font: no heavy Chinese font found, so the headline uses ${cjk.family ?? 'the system sans-serif'} with synthetic weight. Install ${INSTALL_HINT[role]} for the full look.`,
              ]
            : [];
    return {
        role,
        ...(cjk.family !== undefined ? { cjk: cjk.family } : {}),
        ...(latin.family !== undefined ? { latin: latin.family } : {}),
        stack,
        syntheticBold,
        notes,
    };
}
