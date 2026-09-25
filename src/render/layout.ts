// 封面版式的公共部分：画布尺寸、标题可放的区域、HTML 转义，以及量字号用的探针。
import { type FamilyName, getFamily, type Rect } from '../platforms/index.ts';

export interface CoverLayout {
    width: number;
    height: number;
    /** 标题只能落在这个区域里，坐标以画布左上角为原点 */
    textArea: Rect;
    /** 族母版才有，自定义画布为 undefined */
    family?: FamilyName;
    /** 有人物主体时才有：人物贴着这个区域的底边放 */
    subjectArea?: Rect;
    /** 模板的第二段大字（比如数字钩子里的数字）放这里，字号单独量 */
    accentArea?: Rect;
}

// 人物版式：人物占一侧（竖版占下半），标题让到另一侧。人物压在最上层，所以两块不重叠，
// 人物永远挡不住字。坐标都在族母版里，人物区贴着母版底边，标题区仍在族的安全区内。
const SUBJECT_LAYOUTS: Readonly<Record<FamilyName, { textArea: Rect; subjectArea: Rect }>> = {
    landscape: {
        textArea: { x: 192, y: 132, width: 864, height: 876 },
        subjectArea: { x: 1056, y: 60, width: 672, height: 1140 },
    },
    portrait: {
        textArea: { x: 86, y: 384, width: 842, height: 480 },
        subjectArea: { x: 86, y: 864, width: 842, height: 1056 },
    },
    // 人物放在公众号裁切框的右半边，公众号转发卡片的正中方块里能看到人和字各一部分。
    ultrawide: {
        textArea: { x: 576, y: 36, width: 464, height: 296 },
        subjectArea: { x: 1040, y: 0, width: 304, height: 368 },
    },
};

export function withSubjectArea(layout: CoverLayout): CoverLayout {
    if (layout.family !== undefined) {
        const areas = SUBJECT_LAYOUTS[layout.family];
        return {
            ...layout,
            textArea: { ...areas.textArea },
            subjectArea: { ...areas.subjectArea },
        };
    }
    const area = layout.textArea;
    if (layout.width >= layout.height) {
        const split = Math.round(area.width * 0.55);
        const top = Math.round(area.y / 2);
        return {
            ...layout,
            textArea: { ...area, width: split },
            subjectArea: {
                x: area.x + split,
                y: top,
                width: area.width - split,
                height: layout.height - top,
            },
        };
    }
    const split = Math.round(area.height * 0.4);
    return {
        ...layout,
        textArea: { ...area, height: split },
        subjectArea: {
            x: area.x,
            y: area.y + split,
            width: area.width,
            height: layout.height - area.y - split,
        },
    };
}

export function familyLayout(name: FamilyName): CoverLayout {
    const family = getFamily(name);
    return {
        width: family.masterWidth,
        height: family.masterHeight,
        textArea: family.textArea,
        family: name,
    };
}

/** 自定义 --width/--height 的画布没有平台遮挡，四周各留一圈边距 */
export function customLayout(width: number, height: number): CoverLayout {
    const marginX = Math.round(width * 0.075);
    const marginY = Math.round(height * 0.1);
    return {
        width,
        height,
        textArea: {
            x: marginX,
            y: marginY,
            width: width - marginX * 2,
            height: height - marginY * 2,
        },
    };
}

export function escapeHtml(value: string): string {
    return value
        .replaceAll('&', '&amp;')
        .replaceAll('<', '&lt;')
        .replaceAll('>', '&gt;')
        .replaceAll('"', '&quot;')
        .replaceAll("'", '&#39;');
}

const CJK = /[　-鿿豈-﫿＀-￯]/;
/**
 * 不该被拆开的西文单词。量字号时每个单词单独不换行排一次，最宽的那个不能超出标题区域，
 * 否则大字号会把单词从中间劈开。中文按字换行是常规排法，不设探针，字号可以更大。
 */
export function unbreakableRuns(text: string): string[] {
    return text
        .trim()
        .split(/\s+/)
        .filter((word) => word !== '' && !CJK.test(word));
}

export interface Headline {
    fontPx: number;
    /** 按标点切成短句，每句不拆开，句与句之间换行 */
    keepClauses: boolean;
    /** 版式有 accentArea 时，第二段大字量出来的字号 */
    accentPx?: number;
}

const CLAUSE_END = /(?<=[，。！？；：、,.!?;:])\s*/u;

export function headlineClauses(text: string): string[] {
    return text
        .trim()
        .split(CLAUSE_END)
        .filter((clause) => clause !== '');
}

export function headlineMarkup(text: string, headline: Headline): string {
    if (!headline.keepClauses) {
        return escapeHtml(text);
    }
    return headlineClauses(text)
        .map((clause) => `<span class="clause">${escapeHtml(clause)}</span>`)
        .join('');
}

/** 量字号用的隐藏探针，和标题共用 .copy 的字体样式 */
export function probeMarkup(text: string, headline: Headline): string {
    const runs = [...unbreakableRuns(text), ...(headline.keepClauses ? headlineClauses(text) : [])];
    return runs
        .map((run) => `<span class="copy probe" aria-hidden="true">${escapeHtml(run)}</span>`)
        .join('');
}

export function textAreaCss(layout: CoverLayout): string {
    const area = layout.textArea;
    return `left: ${area.x}px; top: ${area.y}px; width: ${area.width}px; height: ${area.height}px;`;
}

export function lineHeightFor(text: string): number {
    return Array.from(text.trim()).length <= 40 ? 1.02 : 1.12;
}
