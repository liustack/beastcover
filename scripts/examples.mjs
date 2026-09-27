// 重新生成 examples/ 里的案例封面。
// 用法：pnpm examples （先 pnpm build）
//
// 案例按爆款标准选材：表情人脸、狠文案、高对比底图。免费路径全部可复现，
// 照片来自 Openverse 的 cc0/pdm 记录，人物是 AI 生成的示例人物（examples/face.jpg）。
// agent 案例要本机模型 CLI，不在脚本里，风格变了手动重画。
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

// 案例用的 Openverse 照片，都是 cc0 或公有领域。下架了就换一张并同步 README。
const PHOTOS = {
    lava: 'openverse:ffe36656-7f80-45fe-a390-ab5b50aa2906',
    sailboat: 'openverse:d788f4c8-9d3d-40cf-8784-02d2573ce9a0',
    plane: 'openverse:5f19ac60-f04c-4504-9d94-4a846c503566',
};

const staging = mkdtempSync(join(tmpdir(), 'beastcover-examples-'));
process.on('exit', () => rmSync(staging, { recursive: true, force: true }));

function run(args, { allowFailure = false } = {}) {
    const result = spawnSync('node', [cli, ...args], { cwd: staging, stdio: 'inherit' });
    if (result.status !== 0 && !allowFailure) {
        console.error(`beastcover ${args.join(' ')} failed.`);
        process.exit(result.status ?? 1);
    }
    return result.status === 0;
}

mkdirSync(examplesDir, { recursive: true });
const out = (name) => join(examplesDir, name);
const face = join(examplesDir, 'assets', 'face.jpg');

// 主打：表情人脸加海报底，一稿两端（横版加竖版展示跨族重排）。抠图要 macOS 14+。
const subjectOk = run(
    ['gen', '我看傻了', '--source', 'render', '--template', 'poster', '--subject', face, '--preset', 'youtube,xiaohongshu', '--output', out('subject-poster.png')],
    { allowFailure: true },
);
if (!subjectOk) {
    console.error('subject example skipped: cutout needs macOS 14+. The old images stay.');
}
run(['gen', '封面没人点', '--source', 'render', '--template', 'poster', '--tag', '新手必看', '--preset', 'xiaohongshu', '--output', out('poster-xiaohongshu.png')]);
run(['gen', '个错误毁了我', '--source', 'render', '--template', 'number', '--number', '3', '--preset', 'youtube', '--output', out('number-youtube.png')]);
run(['gen', '离岩浆50米', '--source', 'stock', '--photo', PHOTOS.lava, '--look', 'punch', '--preset', 'youtube', '--output', out('photo-lava-youtube.png')]);
run(['gen', 'The tide comes back', '--source', 'stock', '--photo', PHOTOS.sailboat, '--preset', 'x', '--output', out('photo-x.png')]);
run(['gen', '看这里', '--source', 'stock', '--photo', PHOTOS.plane, '--callout', '--preset', 'youtube', '--output', out('photo-callout-youtube.png')]);

// 改前改后：左边平庸排版，右边人脸海报，产品价值一张图讲完。
// 人脸海报依赖上面的抠图步骤，抠图跳过且没有旧图时这张也跳过，别拿缺失文件当输入。
const jpegs = ['photo-lava-youtube', 'photo-x', 'photo-callout-youtube'];
if (existsSync(out('subject-poster-youtube.png'))) {
    const plain = join(staging, 'plain.png');
    run(['gen', '封面不狠，没人点开', '--source', 'render', '--preset', 'youtube', '--output', plain]);
    run(['gen', '就差这一步', '--source', 'render', '--template', 'compare', '--before', plain, '--after', out('subject-poster-youtube.png'), '--labels', '改前,改后', '--preset', 'youtube', '--output', out('compare-youtube.png')]);
    jpegs.push('compare-youtube');
} else {
    console.error('compare example skipped: it needs the face poster from the cutout step.');
}

// 照片封面的 PNG 动辄 1-2MB，展示和目检用 jpeg 足够，别让仓库背无损照片。
for (const name of jpegs) {
    await sharp(out(`${name}.png`)).jpeg({ quality: 90 }).toFile(out(`${name}.jpg`));
    unlinkSync(out(`${name}.png`));
}

// agent 案例要本机模型 CLI，慢且计费，默认不重生成。
// 重画：beastcover gen "<主体描述>" --source agent --via agy --style luminous_impasto --preset youtube
for (const name of ['agent-agy-youtube.jpg', 'agent-impasto-youtube.jpg']) {
    if (!existsSync(out(name))) {
        console.error(`${name} missing: repaint it with --source agent and convert to jpeg.`);
    }
}

console.log('\nDone. Compare the changed files under examples/ against git before committing.');
