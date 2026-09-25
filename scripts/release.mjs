#!/usr/bin/env node
// One command per release:
//
//   pnpm release 0.4.0        explicit version
//   pnpm release patch        bump from the current one
//
// Everything that can refuse to release runs before anything irreversible (tag,
// push) happens.
//
// This script does NOT publish. It runs the guards, bumps the version in
// package.json and in the skill's pinned npx commands, commits, tags, and pushes
// the tag. Pushing the tag triggers .github/workflows/release.yml, the single
// place that runs `npm publish` and creates the GitHub Release.
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const run = (cmd, args, options = {}) =>
    execFileSync(cmd, args, { cwd: root, encoding: 'utf-8', stdio: 'pipe', ...options }).trim();
const runLoud = (cmd, args) => execFileSync(cmd, args, { cwd: root, stdio: 'inherit' });

function fail(message) {
    console.error(`\nRelease stopped: ${message}\n`);
    process.exit(1);
}

const pkgPath = join(root, 'package.json');
const pkgRaw = readFileSync(pkgPath, 'utf-8');
const pkg = JSON.parse(pkgRaw);
const skillPath = join(root, 'skills', 'beastcover', 'SKILL.md');
const PINNED = /@liustack\/beastcover@\d+\.\d+\.\d+/g;

const requested = process.argv[2];
if (!requested) {
    fail('give a version (0.4.0) or a bump (patch, minor, major).');
}

const next = (() => {
    const [major, minor, patch] = pkg.version.split('.').map(Number);
    if (requested === 'major') return `${major + 1}.0.0`;
    if (requested === 'minor') return `${major}.${minor + 1}.0`;
    if (requested === 'patch') return `${major}.${minor}.${patch + 1}`;
    if (!/^\d+\.\d+\.\d+$/.test(requested)) fail(`"${requested}" is not a version or a bump.`);
    // An explicit version must move forward, or npm refuses it late and messily.
    const toParts = (v) => v.split('.').map(Number);
    const [ca, cb, cc] = toParts(pkg.version);
    const [na, nb, nc] = toParts(requested);
    const forward = na > ca || (na === ca && (nb > cb || (nb === cb && nc > cc)));
    if (!forward) {
        fail(`"${requested}" is not higher than the current version ${pkg.version}.`);
    }
    return requested;
})();

// --- refuse early, while nothing has happened yet ---

if (run('git', ['status', '--porcelain'])) {
    fail('the working tree has uncommitted changes. Commit them first.');
}
const branch = run('git', ['rev-parse', '--abbrev-ref', 'HEAD']);
if (branch !== 'main') {
    fail(`on branch ${branch}, not main.`);
}
if (run('git', ['tag', '--list', `v${next}`])) {
    fail(`tag v${next} already exists.`);
}

// The final push must be all-or-nothing, which needs a fast-forward main. Git
// accepts a tag while rejecting a stale main in the same push, and that half
// success would release a tree origin/main does not contain.
run('git', ['fetch', 'origin', 'main']);
try {
    run('git', ['merge-base', '--is-ancestor', 'origin/main', 'HEAD']);
} catch {
    fail('local main is behind or diverged from origin/main. Pull first.');
}
try {
    if (run('git', ['ls-remote', '--tags', 'origin', `refs/tags/v${next}`])) {
        fail(`tag v${next} already exists on origin.`);
    }
} catch (error) {
    fail(`cannot reach origin to verify tags: ${error.message ?? error}`);
}

const changelog = readFileSync(join(root, 'CHANGELOG.md'), 'utf-8');
const section = changelog.match(
    new RegExp(`^## ${next.replace(/\./g, '\\.')}[^\\n]*\\n([\\s\\S]*?)(?=^## |(?![\\s\\S]))`, 'm'),
);
if (!section) {
    fail(`CHANGELOG.md has no "## ${next}" section. Write what changed before releasing it.`);
}
if (section[1].trim().length < 20) {
    fail(`the CHANGELOG entry for ${next} is empty. Say what changed.`);
}

const skillRaw = readFileSync(skillPath, 'utf-8');
if (skillRaw.match(PINNED) === null) {
    fail('skills/beastcover/SKILL.md has no pinned @liustack/beastcover@<version> to update.');
}

console.log(`Releasing ${pkg.name} ${pkg.version} -> ${next}\n`);
runLoud('pnpm', ['lint']);
runLoud('pnpm', ['typecheck']);
runLoud('pnpm', ['test']);
runLoud('pnpm', ['build']);

// --- from here on it is real ---

writeFileSync(pkgPath, pkgRaw.replace(`"version": "${pkg.version}"`, `"version": "${next}"`));
writeFileSync(skillPath, skillRaw.replace(PINNED, `@liustack/beastcover@${next}`));
run('git', ['commit', '-am', `chore(release): ${next}`]);
run('git', ['tag', '-a', `v${next}`, '-m', `v${next}`]);
// --atomic: the branch and the tag land together or not at all. A big postBuffer
// avoids the HTTPS disconnect GitHub gives on larger pushes.
run('git', [
    '-c',
    'http.postBuffer=524288000',
    'push',
    '--atomic',
    'origin',
    'main',
    `refs/tags/v${next}`,
]);

console.log(
    `\nTag v${next} pushed. CI will finish the release: npm publish and the GitHub Release.`,
);
console.log('Watch it: gh run watch, or https://github.com/liustack/beastcover/actions');
