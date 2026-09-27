import { type Browser, chromium, type Page } from 'playwright';
import type { Rect } from '../platforms/index.ts';
import type { FontProbe, FontScript } from './fonts.ts';

export interface RenderPage {
    html: string;
    width: number;
    height: number;
    scale: number;
}

export interface FitTextRequest {
    /** 按字号生成量字号用的页面，里面要有 .copy，可选若干 .probe */
    html: (fontPx: number) => string;
    width: number;
    height: number;
    /** 标题必须落在这个区域里 */
    box: Rect;
    minPx: number;
    maxPx: number;
}

export interface CoverRenderer {
    /** 在 [minPx, maxPx] 里找标题放得进 box 的最大整数字号，最小字号也放不下时抛错 */
    fitText(request: FitTextRequest): Promise<number>;
    screenshot(page: RenderPage): Promise<Buffer>;
    /**
     * 质检用，都按 1 倍截：带字的、把字全部隐藏的（两张一比就是字迹），和只画标题填色的
     * （字黑其余全白，字和背景同色也找得到字在哪）。隐藏用 visibility，不改排版。
     */
    inspect(page: RenderPage): Promise<{ background: Buffer; withText: Buffer; headline: Buffer }>;
    /** 探测候选字体装没装、覆不覆盖这句标题、多粗，结果和截图用的是同一个 Chromium */
    probeFonts(text: string, families: Record<FontScript, string[]>): Promise<FontProbeResult[]>;
    close(): Promise<void>;
}

export interface FontProbeResult extends FontProbe {
    script: FontScript;
}

export class TextDoesNotFitError extends Error {}

function validateDimension(name: string, value: number): void {
    if (!Number.isInteger(value) || value < 1 || value > 10_000) {
        throw new Error(`${name} must be an integer from 1 to 10000.`);
    }
}

function validateScale(value: number): void {
    if (!Number.isFinite(value) || value < 1 || value > 4) {
        throw new Error('Scale must be a number from 1 to 4.');
    }
}

/** 封面上的字：标题填色层、描边层、数字、标签，以及模板显式标出的 .qc-text */
export const TEXT_SELECTOR = '.copy:not(.probe), .figure, .label, .qc-text';
const HIDE_TEXT_SELECTOR = `${TEXT_SELECTOR}, .copy-layer, .headline-stack`;
// 只留标题填色：别的全隐藏、底刷白，字刷黑。描边宽度留着（合成粗体靠它加粗），只改颜色，
// 投影、高亮色块、伪元素都去掉，剩下的就是字本身占的像素。
const HEADLINE_ONLY = `
    html, body { background: #fff !important; }
    body * { visibility: hidden !important; }
    .copy:not(.probe), .copy:not(.probe) * {
        visibility: visible !important;
        color: #000 !important;
        -webkit-text-fill-color: #000 !important;
        -webkit-text-stroke-color: #000 !important;
        text-shadow: none !important;
        background: none !important;
        box-shadow: none !important;
        border-color: transparent !important;
        filter: none !important;
        opacity: 1 !important;
    }
    .copy:not(.probe)::before, .copy:not(.probe)::after,
    .copy:not(.probe) *::before, .copy:not(.probe) *::after { visibility: hidden !important; }
`;

function withStyle(html: string, css: string): string {
    const style = `<style>${css}</style>`;
    return html.includes('</head>')
        ? html.replace('</head>', `${style}</head>`)
        : `${style}${html}`;
}

// 半个像素的余量吸收亚像素排版误差。
const FIT_TOLERANCE = 0.5;

async function withPage<T>(
    browser: Browser,
    size: { width: number; height: number; scale: number },
    run: (page: Page) => Promise<T>,
): Promise<T> {
    // 渲染的是自己拼的 HTML，仍然禁 JS、拦所有 http(s) 请求，保证封面内容不出本机。
    const context = await browser.newContext({
        viewport: { width: size.width, height: size.height },
        deviceScaleFactor: size.scale,
        javaScriptEnabled: false,
    });
    try {
        await context.route(/^https?:\/\//, async (route) => {
            await route.abort('blockedbyclient');
        });
        return await run(await context.newPage());
    } finally {
        await context.close();
    }
}

/** render 启动 Chromium 的唯一方式，doctor 用同一个函数检查，两边不会各说各话 */
export function launchChromium(): Promise<Browser> {
    return chromium.launch({ headless: true });
}

export async function openRenderer(): Promise<CoverRenderer> {
    const browser = await launchChromium();

    return {
        async fitText(request) {
            validateDimension('Width', request.width);
            validateDimension('Height', request.height);
            return withPage(browser, { ...request, scale: 1 }, async (page) => {
                const fits = async (fontPx: number): Promise<boolean> => {
                    await page.setContent(request.html(fontPx), { waitUntil: 'load' });
                    const copy = await page.locator('.copy:not(.probe)').boundingBox();
                    if (copy === null) {
                        throw new Error('Measure page has no .copy element.');
                    }
                    const box = request.box;
                    if (
                        copy.x < box.x - FIT_TOLERANCE ||
                        copy.y < box.y - FIT_TOLERANCE ||
                        copy.x + copy.width > box.x + box.width + FIT_TOLERANCE ||
                        copy.y + copy.height > box.y + box.height + FIT_TOLERANCE
                    ) {
                        return false;
                    }
                    // 探针是不能断开的一段。排版时宽出一点点，浏览器就会在它里面断行，
                    // 所以探针不留余量，必须严格放得下。
                    for (const probe of await page.locator('.probe').all()) {
                        const size = await probe.boundingBox();
                        if (size !== null && size.width > box.width) {
                            return false;
                        }
                    }
                    return true;
                };

                if (!(await fits(request.minPx))) {
                    throw new TextDoesNotFitError(`Headline does not fit at ${request.minPx}px.`);
                }
                let low = request.minPx;
                let high = request.maxPx;
                while (low < high) {
                    const middle = Math.ceil((low + high) / 2);
                    if (await fits(middle)) {
                        low = middle;
                    } else {
                        high = middle - 1;
                    }
                }
                return low;
            });
        },

        async screenshot(request) {
            validateDimension('Width', request.width);
            validateDimension('Height', request.height);
            validateScale(request.scale);
            return withPage(browser, request, async (page) => {
                await page.setContent(request.html, { waitUntil: 'load' });
                return page.screenshot({
                    type: 'png',
                    animations: 'disabled',
                    caret: 'hide',
                    fullPage: false,
                });
            });
        },

        async inspect(request) {
            validateDimension('Width', request.width);
            validateDimension('Height', request.height);
            const shot = (page: Page) =>
                page.screenshot({
                    type: 'png',
                    animations: 'disabled',
                    caret: 'hide',
                    fullPage: false,
                });
            return withPage(browser, { ...request, scale: 1 }, async (page) => {
                await page.setContent(request.html, { waitUntil: 'load' });
                const withText = await shot(page);
                await page.setContent(
                    withStyle(
                        request.html,
                        `${HIDE_TEXT_SELECTOR} { visibility: hidden !important; }`,
                    ),
                    { waitUntil: 'load' },
                );
                const background = await shot(page);
                await page.setContent(withStyle(request.html, HEADLINE_ONLY), {
                    waitUntil: 'load',
                });
                const headline = await shot(page);
                return { background, withText, headline };
            });
        },

        async probeFonts(text, families) {
            // 探测页要跑 canvas，只有这个上下文开 JS，照样拦所有网络请求。
            const context = await browser.newContext({ javaScriptEnabled: true });
            try {
                await context.route(/^https?:\/\//, async (route) => {
                    await route.abort('blockedbyclient');
                });
                const page = await context.newPage();
                await page.setContent('<canvas id="c" width="160" height="160"></canvas>');
                return await page.evaluate(probeFontsInPage, { text, families });
            } finally {
                await context.close();
            }
        },

        async close() {
            await browser.close();
        },
    };
}

/**
 * 在页面里跑的探测函数（会被序列化进浏览器，不能引用外部变量）。
 * 覆盖：同一个字用「候选, sans-serif」和「候选, serif」各画一次，候选有这个字时两次都用它，
 * 画出来一样；没有时两次各自回退到不同的系统字体，画出来不一样。中文字宽都是 1em，
 * 只比宽度分不出来，所以比像素。密度：900 字重下墨迹像素 ÷（字数 × 字号²）。
 */
function probeFontsInPage(input: {
    text: string;
    families: Record<'cjk' | 'latin', string[]>;
}): Array<{
    family: string;
    script: 'cjk' | 'latin';
    installed: boolean;
    covers: boolean;
    density: number;
}> {
    // 工程不带 DOM 类型库，这里只描述用到的那几个成员。函数会被序列化进浏览器执行。
    interface Ctx2d {
        font: string;
        fillStyle: string;
        clearRect(x: number, y: number, w: number, h: number): void;
        fillText(text: string, x: number, y: number): void;
        getImageData(x: number, y: number, w: number, h: number): { data: ArrayLike<number> };
    }
    interface Canvas {
        width: number;
        height: number;
        getContext(kind: '2d', options: { willReadFrequently: boolean }): Ctx2d;
    }
    const doc = (
        globalThis as unknown as {
            document: { getElementById(id: string): Canvas; createElement(tag: 'canvas'): Canvas };
        }
    ).document;
    const canvas = doc.getElementById('c');
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    const SIZE = 120;
    const signature = (font: string, char: string): string => {
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        ctx.font = font;
        ctx.fillStyle = '#000';
        ctx.fillText(char, 10, 128);
        const data = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
        let hash = 0;
        for (let i = 3; i < data.length; i += 4) {
            hash = (hash * 31 + (data[i] ?? 0) * ((i >> 2) % 997)) >>> 0;
        }
        return String(hash);
    };
    const has = (family: string, char: string): boolean =>
        signature(`64px "${family}", sans-serif`, char) ===
        signature(`64px "${family}", serif`, char);
    const density = (family: string, sample: string): number => {
        const wide = doc.createElement('canvas');
        wide.width = SIZE * (Array.from(sample).length + 1);
        wide.height = SIZE * 1.5;
        const w = wide.getContext('2d', { willReadFrequently: true });
        w.font = `900 ${SIZE}px "${family}", sans-serif`;
        w.fillStyle = '#000';
        w.fillText(sample, 4, SIZE * 1.2);
        const data = w.getImageData(0, 0, wide.width, wide.height).data;
        let ink = 0;
        for (let i = 3; i < data.length; i += 4) {
            ink += (data[i] ?? 0) > 128 ? 1 : 0;
        }
        return ink / (Array.from(sample).length * SIZE * SIZE);
    };
    const chars = Array.from(new Set(Array.from(input.text)));
    const han = chars.filter((c) => /\p{Script=Han}/u.test(c));
    const latin = chars.filter((c) => /[\p{Script=Latin}\p{N}]/u.test(c));
    const out = [];
    for (const script of ['cjk', 'latin'] as const) {
        const own = script === 'cjk' ? han : latin;
        const probeChar = script === 'cjk' ? '永' : 'R';
        // 密度用固定样本量：用标题自己的字量，西文小写天然墨少，会把粗体误判成不够粗。
        const sample = script === 'cjk' ? '国永点面' : 'HOOK93';
        for (const family of input.families[script]) {
            const installed = has(family, probeChar);
            const covers = installed && own.every((c) => has(family, c));
            out.push({
                family,
                script,
                installed,
                covers: own.length === 0 ? installed : covers,
                density: installed ? density(family, sample) : 0,
            });
        }
    }
    return out;
}
