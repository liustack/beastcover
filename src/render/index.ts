import { type Browser, chromium, type Page } from 'playwright';
import type { Rect } from '../platforms/index.ts';

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
    close(): Promise<void>;
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

export async function openRenderer(): Promise<CoverRenderer> {
    const browser = await chromium.launch({ headless: true });

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
                    for (const probe of await page.locator('.probe').all()) {
                        const size = await probe.boundingBox();
                        if (size !== null && size.width > box.width + FIT_TOLERANCE) {
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

        async close() {
            await browser.close();
        },
    };
}
