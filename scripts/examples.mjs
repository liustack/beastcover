// 重新生成 examples/ 里的案例封面。
// 用法：pnpm examples （先 pnpm build）
//
// 免费路径的案例（render、stock）全部重生成，照片来自 Openverse 的 cc0/pdm 记录。
// agent 案例需要本机的 codex 或 agy，跑不了就保留旧图并提示。
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
    sailboat: 'openverse:d788f4c8-9d3d-40cf-8784-02d2573ce9a0',
    plane: 'openverse:5f19ac60-f04c-4504-9d94-4a846c503566',
    portrait: 'openverse:8cbbf9f4-f800-4ace-b860-a2eea59d49aa',
};

const workspace = mkdtempSync(join(tmpdir(), 'beastcover-examples-'));
process.on('exit', () => rmSync(workspace, { recursive: true, force: true }));

function run(args, { allowFailure = false } = {}) {
    const result = spawnSync('node', [cli, ...args], { cwd: workspace, stdio: 'inherit' });
    if (result.status !== 0 && !allowFailure) {
        console.error(`beastcover ${args.join(' ')} failed.`);
        process.exit(result.status ?? 1);
    }
    return result.status === 0;
}

function refPath(ref) {
    return join(workspace, 'refs', `${ref.replace(':', '-')}.jpg`);
}

mkdirSync(examplesDir, { recursive: true });
for (const ref of Object.values(PHOTOS)) {
    run(['stock', 'fetch', ref, '--dir', join(workspace, 'refs')]);
}

const out = (name) => join(examplesDir, name);

// 同一个标题出两个平台，展示族内裁切和跨族重排。
run(['gen', '封面不狠，没人点开', '--source', 'render', '--preset', 'youtube,xiaohongshu', '--output', out('text.png')]);
run(['gen', '封面没人点', '--source', 'render', '--template', 'poster', '--tag', '新手必看', '--preset', 'xiaohongshu', '--output', out('poster-xiaohongshu.png')]);
run(['gen', '个习惯多出两小时', '--source', 'render', '--template', 'number', '--number', '3', '--preset', 'youtube', '--output', out('number-youtube.png')]);
run(['gen', '下一站', '--source', 'render', '--template', 'compare', '--before', refPath(PHOTOS.sailboat), '--after', refPath(PHOTOS.plane), '--labels', '海上,天上', '--preset', 'youtube', '--output', out('compare-youtube.png')]);
run(['gen', 'The tide comes back', '--source', 'stock', '--photo', PHOTOS.sailboat, '--preset', 'x', '--output', out('photo-x.png')]);
run(['gen', '看这里', '--source', 'stock', '--photo', PHOTOS.plane, '--callout', '--preset', 'youtube', '--output', out('photo-callout-youtube.png')]);

// 照片封面的 PNG 动辄 1-2MB，展示和目检用 jpeg 足够，别让仓库背无损照片。
for (const name of ['compare-youtube', 'photo-x', 'photo-callout-youtube']) {
    await sharp(out(`${name}.png`)).jpeg({ quality: 90 }).toFile(out(`${name}.jpg`));
    unlinkSync(out(`${name}.png`));
}

// 抠图要 macOS 14+，其他系统保留旧图。
const subjectOk = run(
    ['gen', '别再乱剪了', '--source', 'render', '--subject', refPath(PHOTOS.portrait), '--preset', 'youtube', '--output', out('subject-youtube.png')],
    { allowFailure: true },
);
if (!subjectOk) {
    console.error('subject example skipped: cutout needs macOS 14+. The old image stays.');
}

// agent 案例要本机模型 CLI，慢且计费，默认不重生成。
// 重画：beastcover gen "三个习惯" --source agent --via agy --preset youtube
for (const name of ['agent-agy-youtube.jpg', 'agent-codex-xiaohongshu.jpg']) {
    if (!existsSync(out(name))) {
        console.error(`${name} missing: regenerate it with --source agent and convert to jpeg.`);
    }
}

console.log('\nDone. Compare the changed files under examples/ against git before committing.');
