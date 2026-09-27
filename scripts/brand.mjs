// 生成 README 横幅（中英各一张）和 GitHub 社交预览图，全部用 examples/ 里真实出的封面拼。
// 用法：pnpm brand （先 pnpm examples，横幅里的封面就是最新的）
//
// 横幅是一面封面墙：十种封面类型，每张标上类型和平台。社交预览是左边项目名和一句话、
// 右边一叠真实封面。示例封面换了，重新跑一遍即可。
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import sharp from 'sharp';

const repo = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const examples = join(repo, 'examples');
const assets = join(repo, 'assets');

function dataUri(name) {
    const bytes = readFileSync(join(examples, name));
    const type = name.endsWith('.png') ? 'image/png' : 'image/jpeg';
    return `data:${type};base64,${bytes.toString('base64')}`;
}

const TILES = {
    'face-text-youtube.png': { en: 'Face with big words', zh: '人物大字', platform: ['YouTube', 'YouTube'] },
    'versus-youtube.jpg': { en: 'Versus', zh: '档位对比', platform: ['YouTube', 'YouTube'] },
    'number-youtube.png': { en: 'Number hook', zh: '数字冲击', platform: ['YouTube', 'YouTube'] },
    'callout-youtube.jpg': { en: 'Callout', zh: '圈注科普', platform: ['YouTube', 'YouTube'] },
    'scene-title-youtube.jpg': { en: 'Scene title', zh: '场景题字', platform: ['YouTube', 'YouTube'] },
    'face-stakes-scene-youtube.jpg': {
        en: 'Face with stakes',
        zh: '人物加赌注',
        platform: ['YouTube', 'YouTube'],
    },
    'big-type-xiaohongshu.png': { en: 'Big type', zh: '大字报', platform: ['Xiaohongshu', '小红书'] },
    'collage-xiaohongshu.jpg': { en: 'Collage', zh: '拼图', platform: ['Xiaohongshu', '小红书'] },
    'before-after-xiaohongshu.jpg': {
        en: 'Before and after',
        zh: '前后对比',
        platform: ['Xiaohongshu', '小红书'],
    },
    'mood-xiaohongshu.jpg': { en: 'Mood', zh: '氛围单图', platform: ['Xiaohongshu', '小红书'] },
};

const ROWS = [
    ['face-text-youtube.png', 'versus-youtube.jpg', 'number-youtube.png'],
    ['callout-youtube.jpg', 'scene-title-youtube.jpg', 'face-stakes-scene-youtube.jpg'],
    [
        'big-type-xiaohongshu.png',
        'collage-xiaohongshu.jpg',
        'before-after-xiaohongshu.jpg',
        'mood-xiaohongshu.jpg',
    ],
];

const FONT =
    '"Helvetica Neue", "PingFang SC", "Noto Sans CJK SC", "Hiragino Sans GB", Arial, sans-serif';

function bannerHtml(language) {
    const index = language === 'en' ? 0 : 1;
    const rows = ROWS.map(
        (row) => `<section class="row">${row
            .map((name) => {
                const tile = TILES[name];
                return `<figure><img src="${dataUri(name)}" alt=""><figcaption><b>${tile[language]}</b><span>${tile.platform[index]}</span></figcaption></figure>`;
            })
            .join('')}</section>`,
    ).join('');
    return `<!doctype html><html><head><meta charset="utf-8"><style>
        * { box-sizing: border-box; }
        body { margin: 0; width: 2400px; background: #111214; font-family: ${FONT}; }
        main { padding: 56px; display: flex; flex-direction: column; gap: 40px; }
        .row { display: flex; gap: 32px; }
        figure { margin: 0; flex: 1 1 0; min-width: 0; }
        img { display: block; width: 100%; border-radius: 14px; box-shadow: 0 10px 30px rgba(0, 0, 0, 0.45); }
        figcaption { display: flex; justify-content: space-between; align-items: baseline; margin-top: 14px; color: #8b8f96; font-size: 26px; }
        figcaption b { color: #f3f3f1; font-size: 30px; font-weight: 700; white-space: nowrap; }
    </style></head><body><main>${rows}</main></body></html>`;
}

function socialHtml() {
    const card = (name, style) =>
        `<img class="card" style="${style}" src="${dataUri(name)}" alt="">`;
    return `<!doctype html><html><head><meta charset="utf-8"><style>
        * { box-sizing: border-box; }
        body { margin: 0; width: 2560px; height: 1280px; overflow: hidden; background: #ffe45c; font-family: ${FONT}; position: relative; }
        .copy { position: absolute; left: 150px; top: 150px; width: 1180px; }
        .tag { display: inline-block; padding: 16px 30px; background: #121212; color: #ffe45c; font-size: 40px; font-weight: 800; letter-spacing: 0.08em; }
        h1 { margin: 44px 0 0; font-size: 250px; line-height: 0.92; font-weight: 900; letter-spacing: -0.04em; color: #121212; }
        h1 span { color: #ff3b30; display: block; }
        p { margin: 52px 0 0; font-size: 62px; line-height: 1.18; font-weight: 700; color: #121212; }
        code { display: inline-block; margin-top: 60px; padding: 24px 36px; background: #fff; border: 6px solid #121212; box-shadow: 14px 14px 0 #121212; font: 700 40px Menlo, monospace; color: #121212; white-space: nowrap; }
        .card { position: absolute; border: 12px solid #fff; border-radius: 18px; box-shadow: 0 24px 60px rgba(0, 0, 0, 0.35); }
    </style></head><body>
        <div class="copy">
            <div class="tag">10 COVER TYPES · EVERY PLATFORM</div>
            <h1>Beast<span>Cover</span></h1>
            <p>Covers that get the click, checked before you ship.</p>
            <code>npx -y skills add liustack/beastcover -g</code>
        </div>
        ${card('big-type-xiaohongshu.png', 'left: 1450px; top: 90px; width: 430px; transform: rotate(-6deg);')}
        ${card('versus-youtube.jpg', 'left: 1880px; top: 130px; width: 600px; transform: rotate(5deg);')}
        ${card('face-text-youtube.png', 'left: 1520px; top: 600px; width: 900px; transform: rotate(-3deg);')}
    </body></html>`;
}

const browser = await chromium.launch({ headless: true });
try {
    const shoot = async (html, width, height, output) => {
        const page = await browser.newPage({ viewport: { width, height: height ?? 800 } });
        await page.setContent(html, { waitUntil: 'load' });
        const png = await page.screenshot({ type: 'png', fullPage: height === undefined });
        await page.close();
        await sharp(png).jpeg({ quality: 88, mozjpeg: true }).toFile(output);
        console.log(`Wrote ${output}`);
    };
    await shoot(bannerHtml('en'), 2400, undefined, join(assets, 'banner.jpg'));
    await shoot(bannerHtml('zh'), 2400, undefined, join(assets, 'banner.zh-CN.jpg'));
    await shoot(socialHtml(), 2560, 1280, join(assets, 'social-preview.jpg'));
} finally {
    await browser.close();
}
