import { mkdirSync } from 'node:fs';
import { dirname, extname, resolve } from 'node:path';
import { type Browser, type BrowserContext, chromium } from 'playwright';

export interface RenderHtmlOptions {
    html: string;
    outputPath: string;
    width: number;
    height: number;
    scale: number;
}

export interface RenderHtmlResult {
    pngPath: string;
    meta: {
        width: number;
        height: number;
        scale: number;
        pixelWidth: number;
        pixelHeight: number;
        generatedAt: string;
    };
}

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

export async function renderHtml(options: RenderHtmlOptions): Promise<RenderHtmlResult> {
    validateDimension('Width', options.width);
    validateDimension('Height', options.height);
    validateScale(options.scale);

    if (extname(options.outputPath).toLowerCase() !== '.png') {
        throw new Error('Render output must use the .png extension.');
    }

    const outputPath = resolve(options.outputPath);
    mkdirSync(dirname(outputPath), { recursive: true });

    let browser: Browser | undefined;
    let context: BrowserContext | undefined;
    try {
        browser = await chromium.launch({ headless: true });
        context = await browser.newContext({
            viewport: { width: options.width, height: options.height },
            deviceScaleFactor: options.scale,
            javaScriptEnabled: false,
        });
        await context.route(/^https?:\/\//, async (route) => {
            await route.abort('blockedbyclient');
        });

        const page = await context.newPage();
        await page.setContent(options.html, { waitUntil: 'load' });
        await page.screenshot({
            path: outputPath,
            type: 'png',
            animations: 'disabled',
            caret: 'hide',
            fullPage: false,
        });
    } finally {
        await context?.close();
        await browser?.close();
    }

    return {
        pngPath: outputPath,
        meta: {
            width: options.width,
            height: options.height,
            scale: options.scale,
            pixelWidth: Math.round(options.width * options.scale),
            pixelHeight: Math.round(options.height * options.scale),
            generatedAt: new Date().toISOString(),
        },
    };
}
