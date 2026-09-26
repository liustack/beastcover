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
    /** 本次要出的同族平台都看得见的区域（它们裁切框的交集），合成时填上 */
    visibleArea?: Rect;
    /** 可见区域再去掉顶部和底部的平台界面栏，合成时填上 */
    clearArea?: Rect;
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
    // 和横版一样标题在左、人物在右，都在公众号裁切框里。
    ultrawide: {
        textArea: { x: 154, y: 72, width: 860, height: 624 },
        subjectArea: { x: 1014, y: 0, width: 752, height: 768 },
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

/**
 * 人物在人物区里的实际位置。高的主体（人）按高度放满、贴着底边站，身子被裁掉也没关系。
 * 扁的主体（物件、横放的东西）按宽度放满，在人物区和无遮挡区的交集里垂直居中，
 * 免得贴底以后整个掉出平台裁切框，或者被底部界面挡住。按脸裁过的头肩（bust）下边是直切口，
 * 不管扁不扁都贴底站，切口落在画面外。
 */
export function subjectRect(
    area: Rect,
    clear: Rect | undefined,
    subjectWidth: number,
    subjectHeight: number,
    bust = false,
): Rect {
    const scale = Math.min(area.width / subjectWidth, area.height / subjectHeight);
    const width = Math.round(subjectWidth * scale);
    const height = Math.round(subjectHeight * scale);
    const x = Math.round(area.x + (area.width - width) / 2);
    const bottom = area.y + area.height;
    const tall = height >= area.height - 1;
    if (tall || bust || clear === undefined) {
        return { x, y: bottom - height, width, height };
    }
    const top = Math.max(area.y, clear.y);
    const end = Math.min(bottom, clear.y + clear.height);
    const y = end - top >= height ? top + (end - top - height) / 2 : bottom - height;
    return { x, y: Math.round(y), width, height };
}

// 有脸的人物按脸定大小：脸高约占无遮挡区高度的三成。爆款缩略图里脸高中位数是画面的 27%，
// vidIQ 的前 50 名里常见脸占画面三分之一。
const FACE_SHARE = 0.3;
// 脸离可见区左右边缘至少留这么多（按可见区宽度算）。
const FACE_MARGIN = 0.03;
const SHRINK_STEP = 0.95;

/** 摆人物要用到的图层信息，和 subject/index.ts 的 SubjectLayer 对得上 */
export interface PlacedSubject {
    width: number;
    height: number;
    bust: boolean;
    /** 脸在人物图里的位置，0 到 1，x、y 是中心 */
    face?: { x: number; y: number; width: number; height: number };
}

/**
 * 人物的位置和大小。有脸时按脸放大，贴底站，可以越过人物区一直伸到背对标题那一侧的
 * 画面边缘（被画面切掉），但不越过朝向标题的那条边，脸也要落在可见区里。放不下就缩小，
 * 缩回原来的大小还不行就照没有脸时的办法摆。
 */
export function placeSubject(layout: CoverLayout, subject: PlacedSubject): Rect {
    const area = layout.subjectArea;
    if (area === undefined) {
        throw new Error('A subject needs a layout with a subject area.');
    }
    const base = subjectRect(area, layout.clearArea, subject.width, subject.height, subject.bust);
    const face = subject.face;
    if (face === undefined) {
        return base;
    }
    const canvas = { x: 0, y: 0, width: layout.width, height: layout.height };
    const visible = layout.visibleArea ?? canvas;
    const clear = layout.clearArea ?? visible;
    const text = layout.textArea;
    // 标题在人物区左边时，人物不能越过人物区左边。标题在上面时左右都可以伸出画面。
    const left = text.x + text.width <= area.x ? area.x : Number.NEGATIVE_INFINITY;
    const right = text.x >= area.x + area.width ? area.x + area.width : Number.POSITIVE_INFINITY;
    const bottom = area.y + area.height;
    const margin = visible.width * FACE_MARGIN;
    const baseScale = base.width / subject.width;
    const faceScale = (clear.height * FACE_SHARE) / (face.height * subject.height);
    let scale = Math.max(baseScale, Math.min(faceScale, area.height / subject.height));
    while (scale > baseScale) {
        const width = subject.width * scale;
        const height = subject.height * scale;
        const faceLeft = (face.x - face.width / 2) * width;
        const faceRight = (face.x + face.width / 2) * width;
        const lowest = right - width;
        let x = area.x + area.width / 2 - face.x * width;
        x = Math.min(Math.max(x, left), lowest);
        x = Math.min(x, visible.x + visible.width - margin - faceRight);
        x = Math.max(x, visible.x + margin - faceLeft);
        const y = bottom - height;
        const faceBottom = y + (face.y + face.height / 2) * height;
        if (x >= left && x <= lowest && faceBottom <= clear.y + clear.height) {
            return {
                x: Math.round(x),
                y: Math.round(y),
                width: Math.round(width),
                height: Math.round(height),
            };
        }
        scale *= SHRINK_STEP;
    }
    return base;
}

export function escapeHtml(value: string): string {
    return value
        .replaceAll('&', '&amp;')
        .replaceAll('<', '&lt;')
        .replaceAll('>', '&gt;')
        .replaceAll('"', '&quot;')
        .replaceAll("'", '&#39;');
}

// 连续的拉丁、希腊、西里尔字母和数字，带重音和组合附加符号（é、ß、e + U+0301），
// 中间允许撇号和连字符（don't、GPT-5）。汉字不在这些文字里，所以中文紧挨着也能切出整词。
const WORD_CHAR = String.raw`\p{Script=Latin}\p{Script=Greek}\p{Script=Cyrillic}\p{N}`;
const LATIN_WORD = new RegExp(
    String.raw`[${WORD_CHAR}][${WORD_CHAR}\p{M}]*(?:['’-][${WORD_CHAR}][${WORD_CHAR}\p{M}]*)*`,
    'gu',
);

/**
 * 不该被拆开的西文单词，直接从全文里找，中文紧挨着英文时也能找到。量字号时每个单词单独
 * 不换行排一次，最宽的那个不能超出标题区域，否则大字号会把单词从中间劈开。
 * 中文词另由 chineseWords 找。
 */
export function unbreakableRuns(text: string): string[] {
    return text.match(LATIN_WORD) ?? [];
}

const CHINESE_SEGMENTER = new Intl.Segmenter('zh', { granularity: 'word' });
const HAN_WORD = /^\p{Script=Han}{2,}$/u;

/**
 * 两个字以上的中文词（封面、标题、一件事），按 Intl.Segmenter 的词典切。浏览器会在任意
 * 两个汉字之间断行，这些词要包成不换行的片段，量字号时也各放一个探针。词典切错时要么
 * 多连了两个字（少一个断行点），要么少连（和按字断一样），都不会比按字断更差。
 */
export function chineseWords(text: string): string[] {
    return Array.from(CHINESE_SEGMENTER.segment(text), (part) => part.segment).filter((word) =>
        HAN_WORD.test(word),
    );
}

/** 转义后的标题文字，中文词包进 .word，词内不换行 */
function wordMarkup(text: string): string {
    return Array.from(CHINESE_SEGMENTER.segment(text), ({ segment }) =>
        HAN_WORD.test(segment)
            ? `<span class="word">${escapeHtml(segment)}</span>`
            : escapeHtml(segment),
    ).join('');
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
        return wordMarkup(text);
    }
    return headlineClauses(text)
        .map((clause) => `<span class="clause">${wordMarkup(clause)}</span>`)
        .join('');
}

/** 量字号用的隐藏探针，和标题共用 .copy 的字体样式 */
export function probeMarkup(text: string, headline: Headline): string {
    const runs = [
        ...unbreakableRuns(text),
        ...chineseWords(text),
        ...(headline.keepClauses ? headlineClauses(text) : []),
    ];
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
