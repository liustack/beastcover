// 重新生成 examples/ 里的案例封面，每种封面类型至少一张，三个平台族都有。
// 用法：pnpm examples （先 pnpm build）
//
// 照片来自 Openverse 的 cc0/pdm 记录，人物是 AI 生成的示例人物（examples/assets/face.jpg）。
// 质检是必须工序：任何一张出现 QC FAIL，脚本就停下，不拿不合格的封面当案例。
// 现画场景和 agent 案例要本机的模型 CLI，不在脚本里，风格变了手动重画。
// 改过版式后跑一遍，和 git 里的旧图并排目检，这个目录就是观感回归的基准集。
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, rmSync, unlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const repo = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const cli = join(repo, 'dist', 'main.js');
const examplesDir = join(repo, 'examples');

if (!existsSync(cli)) {
    console.error('dist/main.js not found. Run pnpm build first.');
    process.exit(1);
}

// 案例用的 Openverse 照片，都是 cc0。下架了就换一张并同步 examples/README.md 的署名。
const PHOTOS = {
    lava: 'openverse:ffe36656-7f80-45fe-a390-ab5b50aa2906',
    sailboat: 'openverse:d788f4c8-9d3d-40cf-8784-02d2573ce9a0',
    plane: 'openverse:5f19ac60-f04c-4504-9d94-4a846c503566',
    ramen: 'openverse:0f89f9cc-d7fd-4828-bcb4-a2b0b5e390be',
    ramenFancy: 'openverse:a01ecc5c-176b-4d1f-a445-655ff2184e3a',
    tsukemen: 'openverse:1ba9b26d-990f-4c66-ba15-f2cc8cabb41b',
    streetFood: 'openverse:3db8719f-ce9f-4ed3-bc27-0ee02624fe3e',
    deskBefore: 'openverse:db683a42-45c4-4715-97cc-318a86cc568e',
    deskAfter: 'openverse:19f89def-c920-4e19-bc37-c20a2dedaa5a',
    coffee: 'openverse:278488ee-cc5d-49d9-84bb-de0281b20f60',
};

const staging = mkdtempSync(join(tmpdir(), 'beastcover-examples-'));
process.on('exit', () => rmSync(staging, { recursive: true, force: true }));

mkdirSync(examplesDir, { recursive: true });
const out = (name) => join(examplesDir, name);
const face = join(examplesDir, 'assets', 'face.jpg');

/** 跑一条 gen，把输出原样打出来。退出码不为 0 或质检不过都算失败 */
function gen(args, { optional = false } = {}) {
    const result = spawnSync('node', [cli, 'gen', ...args], { cwd: staging, encoding: 'utf8' });
    process.stdout.write(result.stdout);
    process.stderr.write(result.stderr);
    if (result.status !== 0) {
        if (optional) {
            return false;
        }
        console.error(`beastcover gen ${args.join(' ')} failed.`);
        process.exit(result.status ?? 1);
    }
    if (result.stdout.includes('QC FAIL')) {
        console.error(`beastcover gen ${args.join(' ')} failed QC. Fix the example before keeping it.`);
        process.exit(1);
    }
    return true;
}

// 照片封面的 PNG 动辄 1-2MB，展示和目检用 jpeg 足够，别让仓库背无损照片。
const jpegs = [];

gen(['3个错误*毁了*我的频道', '--template', 'big-type', '--tag', '新手必看', '--preset', 'xiaohongshu,wechat', '--output', out('big-type.png')]);
gen(['个习惯救了我的时间', '--template', 'number', '--number', '3', '--preset', 'youtube,douyin', '--output', out('number.png')]);

// 人物两张要抠图（macOS 14+）。抠不了时留着旧图，不拿缺失文件当输入。
if (gen(['我看*傻*了', '--subject', face, '--preset', 'youtube,xiaohongshu', '--output', out('face-text.png')], { optional: true })) {
    gen(['离岩浆*50米*', '--subject', face, '--photo', PHOTOS.lava, '--number', 'DAY 1', '--preset', 'youtube', '--output', out('face-stakes-youtube.png')]);
    jpegs.push('face-stakes-youtube');
} else {
    console.error('face examples skipped: cutout needs macOS 14+. The old images stay.');
}

gen(['15元和150元的拉面', '--template', 'versus', '--photo', PHOTOS.ramen, '--photo', PHOTOS.ramenFancy, '--labels', '¥15,¥150', '--preset', 'youtube', '--output', out('versus-youtube.png')]);
gen(['桌面*改造*', '--template', 'before-after', '--photo', PHOTOS.deskBefore, '--photo', PHOTOS.deskAfter, '--labels', '改前,改后', '--preset', 'xiaohongshu', '--output', out('before-after-xiaohongshu.png')]);
gen(['*出海*第一天', '--template', 'scene-title', '--photo', PHOTOS.sailboat, '--preset', 'youtube,x', '--output', out('scene-title.png')]);
gen(['这是什么？', '--template', 'callout', '--photo', PHOTOS.plane, '--preset', 'youtube', '--output', out('callout-youtube.png')]);
gen(['一周吃了*7碗*面', '--template', 'collage', '--photo', PHOTOS.ramen, '--photo', PHOTOS.tsukemen, '--photo', PHOTOS.streetFood, '--photo', PHOTOS.ramenFancy, '--preset', 'xiaohongshu', '--output', out('collage-xiaohongshu.png')]);
gen(['慢一点的早晨', '--template', 'mood', '--photo', PHOTOS.coffee, '--preset', 'xiaohongshu', '--output', out('mood-xiaohongshu.png')]);
jpegs.push(
    'versus-youtube',
    'before-after-xiaohongshu',
    'scene-title-youtube',
    'scene-title-x',
    'callout-youtube',
    'collage-xiaohongshu',
    'mood-xiaohongshu',
);

for (const name of jpegs) {
    await sharp(out(`${name}.png`)).jpeg({ quality: 90 }).toFile(out(`${name}.jpg`));
    unlinkSync(out(`${name}.png`));
}

// 现画场景和 agent 案例要本机模型 CLI，慢且计费，默认不重生成。
//   beastcover gen "在火山口*住*了一晚" --subject face.jpg --scene "<画面>" --number 50米 --preset youtube
//   beastcover gen "<主体描述>" --source agent --via agy --style luminous_impasto --preset youtube
for (const name of ['face-stakes-scene-youtube.jpg', 'agent-agy-youtube.jpg', 'agent-impasto-youtube.jpg']) {
    if (!existsSync(out(name))) {
        console.error(`${name} missing: repaint it with your agent CLI and convert to jpeg.`);
    }
}

console.log('\nDone. Look at every changed file under examples/ and compare against git before committing.');
