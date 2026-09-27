// 封面类型共用的短文本选项：钩子短句、痛点标签、大数字。长短在这里拦，空的直接报错。

export const MAX_TAG_LENGTH = 16;
export const MAX_FIGURE_LENGTH = 8;

/** --hook 的短句：去掉首尾空白，不能为空。长短交给 Headline: 提醒 */
export function parseHook(value: string): string {
    const hook = value.trim();
    if (hook === '') {
        throw new Error('--hook must not be empty.');
    }
    return hook;
}

export function parseTag(value: string): string {
    const tag = value.trim();
    if (tag === '') {
        throw new Error('--tag must not be empty.');
    }
    if (Array.from(tag).length > MAX_TAG_LENGTH) {
        throw new Error(
            `--tag is longer than ${MAX_TAG_LENGTH} characters. Keep it to a few words.`,
        );
    }
    return tag;
}

/** --number：数字冲击的大数字，或赌注牌上的字（$10,000、DAY 7） */
export function parseFigure(value: string): string {
    const figure = value.trim();
    if (figure === '') {
        throw new Error('--number must not be empty.');
    }
    if (Array.from(figure).length > MAX_FIGURE_LENGTH) {
        throw new Error(
            `--number is longer than ${MAX_FIGURE_LENGTH} characters. Use a figure like 3, 90%, $10,000, or DAY 7.`,
        );
    }
    return figure;
}
