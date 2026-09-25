import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { loadFallbackStyle, loadStyle } from '../styles/loader.ts';
import { WORKSPACE_GITIGNORE } from './ignore.ts';
import {
    appendHistory,
    createWorkspace,
    findWorkspace,
    listHistory,
    loadStylePack,
    mergedPalette,
} from './index.ts';

const tempDirectories: string[] = [];

afterEach(() => {
    for (const directory of tempDirectories.splice(0)) {
        rmSync(directory, { recursive: true, force: true });
    }
});

function tempDir(prefix: string): string {
    const directory = mkdtempSync(join(tmpdir(), prefix));
    tempDirectories.push(directory);
    return directory;
}

describe('project workspace', () => {
    it('creates a self-contained .beastcover directory and leaves project gitignore files untouched', () => {
        const cwd = tempDir('beastcover-new-');
        mkdirSync(join(cwd, '.git', 'info'), { recursive: true });
        const gitignore = join(cwd, '.gitignore');
        const exclude = join(cwd, '.git', 'info', 'exclude');
        writeFileSync(gitignore, 'node_modules/\n', 'utf8');
        writeFileSync(exclude, '# local\n', 'utf8');

        const created = createWorkspace(cwd, {
            name: 'demo',
            styleName: 'torn_paper_editorial_collage',
        });
        const style = loadStyle('torn_paper_editorial_collage');

        expect(created.path).toBe(join(cwd, '.beastcover'));
        expect(created.pack.style).toBe('torn_paper_editorial_collage');
        expect(created.pack.palette).toEqual(
            Object.fromEntries(
                style.paletteSlots.map((slot) => [
                    slot.name,
                    { prompt: slot.prompt, css: slot.css },
                ]),
            ),
        );
        expect(existsSync(join(created.path, 'refs'))).toBe(true);
        expect(existsSync(join(created.path, 'out'))).toBe(true);
        expect(existsSync(join(created.path, 'cache'))).toBe(true);
        expect(existsSync(join(created.path, 'history'))).toBe(false);
        expect(existsSync(join(created.path, 'project.json'))).toBe(true);
        expect(existsSync(join(created.path, 'style.json'))).toBe(false);
        expect(existsSync(join(created.path, 'history.jsonl'))).toBe(false);
        expect(readFileSync(join(created.path, '.gitignore'), 'utf8')).toBe(WORKSPACE_GITIGNORE);
        expect(readFileSync(gitignore, 'utf8')).toBe('node_modules/\n');
        expect(readFileSync(exclude, 'utf8')).toBe('# local\n');
        expect(loadStylePack(created.path).name).toBe('demo');
        expect(listHistory(created.path)).toEqual([]);
    });

    it('selects the catalog fallback style when new does not name one', () => {
        const cwd = tempDir('beastcover-fallback-');
        const created = createWorkspace(cwd, { name: 'safe' });
        expect(created.pack.style).toBe(loadFallbackStyle().name);
        expect(created.pack.style).toBe('risograph_editorial');
    });

    it('finds a parent workspace and refuses to create a second one', () => {
        const root = tempDir('beastcover-walk-');
        createWorkspace(root, { name: 'root' });
        const nested = join(root, 'src', 'article');
        mkdirSync(nested, { recursive: true });

        expect(findWorkspace(nested)).toBe(join(root, '.beastcover'));
        expect(() => createWorkspace(nested, { name: 'nested' })).toThrowError(
            `A BeastCover workspace already exists at ${join(root, '.beastcover')}.`,
        );
        expect(existsSync(join(nested, '.beastcover'))).toBe(false);
    });

    it('skips a .beastcover directory that has no project.json, like the home config dir', () => {
        const home = tempDir('beastcover-home-');
        mkdirSync(join(home, '.beastcover', 'bin'), { recursive: true });
        writeFileSync(join(home, '.beastcover', 'config.json'), '{}\n', 'utf8');
        const project = join(home, 'projects', 'post');
        mkdirSync(project, { recursive: true });

        expect(findWorkspace(project)).toBeUndefined();
        const created = createWorkspace(project, { name: 'post' });
        expect(created.path).toBe(join(project, '.beastcover'));
        expect(findWorkspace(join(project, 'drafts'))).toBe(join(project, '.beastcover'));
    });

    it('refuses to turn an existing non-workspace .beastcover directory into a workspace', () => {
        const home = tempDir('beastcover-home-new-');
        mkdirSync(join(home, '.beastcover'), { recursive: true });
        expect(() => createWorkspace(home, { name: 'home' })).toThrowError(
            `${join(home, '.beastcover')} already exists and is not a BeastCover workspace. It may be the settings folder. Run beastcover new in a project folder instead.`,
        );
    });

    it('does not create a workspace when none exists', () => {
        const cwd = tempDir('beastcover-missing-');
        expect(findWorkspace(cwd)).toBeUndefined();
        expect(existsSync(join(cwd, '.beastcover'))).toBe(false);
    });

    it('fails at the project.json boundary instead of repairing it', () => {
        const cwd = tempDir('beastcover-pack-');
        const workspaceDir = createWorkspace(cwd, { name: 'demo' }).path;
        writeFileSync(join(workspaceDir, 'project.json'), '{not-json', 'utf8');
        expect(() => loadStylePack(workspaceDir)).toThrowError(
            `${join(workspaceDir, 'project.json')} is not valid JSON.`,
        );

        writeFileSync(
            join(workspaceDir, 'project.json'),
            `${JSON.stringify({
                name: 'demo',
                style: 'risograph_editorial',
                palette: { unknown: '#fff' },
                composition: 'x',
            })}\n`,
            'utf8',
        );
        expect(() => loadStylePack(workspaceDir)).toThrowError(
            `${join(workspaceDir, 'project.json')} contains unknown palette slot "unknown".`,
        );

        writeFileSync(
            join(workspaceDir, 'project.json'),
            `${JSON.stringify({
                name: 'demo',
                style: 'risograph_editorial',
                palette: {},
                composition: { strategy: 'full-bleed', guidance: 'x' },
            })}\n`,
            'utf8',
        );
        expect(() => loadStylePack(workspaceDir)).toThrowError(
            `${join(workspaceDir, 'project.json')} has invalid "composition". Expected a non-empty string.`,
        );
    });

    it('rejects a leftover string palette slot instead of treating it as a prompt', () => {
        const cwd = tempDir('beastcover-pack-string-');
        const workspaceDir = createWorkspace(cwd, { name: 'demo' }).path;
        const packPath = join(workspaceDir, 'project.json');
        writeFileSync(
            packPath,
            `${JSON.stringify({
                name: 'demo',
                style: 'risograph_editorial',
                palette: { paper: '纯白' },
                composition: 'x',
            })}\n`,
            'utf8',
        );
        expect(() => loadStylePack(workspaceDir)).toThrowError(
            `${packPath} has invalid "palette.paper". Expected an object with "prompt" and/or "css" strings.`,
        );
    });

    it('rejects invalid palette css at the project.json boundary', () => {
        const cwd = tempDir('beastcover-pack-css-');
        const workspaceDir = createWorkspace(cwd, { name: 'demo' }).path;
        const packPath = join(workspaceDir, 'project.json');
        writeFileSync(
            packPath,
            `${JSON.stringify({
                name: 'demo',
                style: 'risograph_editorial',
                palette: { paper: { prompt: '纯白', css: '暖白' } },
                composition: 'x',
            })}\n`,
            'utf8',
        );
        expect(() => loadStylePack(workspaceDir)).toThrowError(
            `${packPath} has invalid "palette.paper.css". Expected a CSS color value.`,
        );
    });

    it('lets a slot override only css or only prompt and fills the rest from the catalog', () => {
        const cwd = tempDir('beastcover-pack-partial-');
        const created = createWorkspace(cwd, {
            name: 'demo',
            styleName: 'torn_paper_editorial_collage',
        });
        const packPath = join(created.path, 'project.json');

        writeFileSync(
            packPath,
            `${JSON.stringify({
                name: 'demo',
                style: 'torn_paper_editorial_collage',
                palette: {
                    paper: { css: '#ff0000' },
                    accent: { prompt: '赭色' },
                },
                composition: created.pack.composition,
            })}\n`,
            'utf8',
        );

        const loaded = loadStylePack(created.path);
        expect(loaded.palette).toEqual({
            paper: { css: '#ff0000' },
            accent: { prompt: '赭色' },
        });
        expect(mergedPalette(loaded)).toEqual({
            paper: { prompt: '米白', css: '#ff0000' },
            neutrals: { prompt: '暖灰、深蓝灰、墨绿、浅卡其、灰黑', css: '#8a8580' },
            accent: { prompt: '赭色', css: '#c46a38' },
        });
    });

    it('appends a history.jsonl line for each generation', () => {
        const cwd = tempDir('beastcover-history-');
        const workspaceDir = createWorkspace(cwd, { name: 'demo' }).path;
        const first = {
            createdAt: '2026-08-23T00:00:00.000Z',
            style: 'risograph_editorial',
            palette: { paper: { prompt: '亮白', css: '#ffffff' } },
            text: 'One headline, every platform',
            output: join(workspaceDir, 'out', 'beastcover.png'),
        };
        const second = {
            ...first,
            createdAt: '2026-08-23T00:00:01.000Z',
            text: 'Second card',
        };

        appendHistory(workspaceDir, first);
        appendHistory(workspaceDir, second);
        const stored = join('out', 'beastcover.png');
        expect(listHistory(workspaceDir)).toEqual([
            { ...first, output: stored },
            { ...second, output: stored },
        ]);
        expect(
            readFileSync(join(workspaceDir, 'history.jsonl'), 'utf8').trimEnd().split('\n'),
        ).toHaveLength(2);
    });
});

describe('history paths', () => {
    it('stores the output path relative to the workspace, not absolute', () => {
        const cwd = tempDir('beastcover-history-relative-');
        const created = createWorkspace(cwd, {
            name: 'demo',
            styleName: 'torn_paper_editorial_collage',
        });
        appendHistory(created.path, {
            createdAt: '2026-08-23T00:00:00.000Z',
            style: 'torn_paper_editorial_collage',
            palette: {},
            text: '碎玻璃上的反光',
            output: join(created.path, 'out', 'a.png'),
        });
        const raw = readFileSync(join(created.path, 'history.jsonl'), 'utf8').trim();
        expect(JSON.parse(raw).output).toBe(join('out', 'a.png'));
        expect(raw).not.toContain(cwd);
    });

    it('stores photo and subject paths relative to the workspace too', () => {
        const cwd = tempDir('beastcover-history-inputs-');
        const created = createWorkspace(cwd, { name: 'demo' });
        appendHistory(created.path, {
            createdAt: '2026-09-25T00:00:00.000Z',
            style: 'risograph_editorial',
            palette: {},
            text: 'Me',
            output: join(created.path, 'out', 'a.png'),
            source: 'stock',
            photo: { path: join(created.path, 'refs', 'openverse-a1.jpg'), ref: 'openverse:a1' },
            subject: { path: join(cwd, 'photos', 'me.jpg'), method: 'macos-vision' },
        });
        const raw = readFileSync(join(created.path, 'history.jsonl'), 'utf8').trim();
        expect(JSON.parse(raw)).toMatchObject({
            photo: { path: join('refs', 'openverse-a1.jpg'), ref: 'openverse:a1' },
            subject: { path: join('..', 'photos', 'me.jpg'), method: 'macos-vision' },
        });
        expect(raw).not.toContain(cwd);
    });

    it('round-trips optional source, via, and catalogPalette when present', () => {
        const cwd = tempDir('beastcover-history-optional-');
        const workspaceDir = createWorkspace(cwd, { name: 'demo' }).path;
        const palette = { paper: { prompt: '亮白', css: '#ffffff' } };
        const record = {
            createdAt: '2026-08-23T00:00:00.000Z',
            style: 'risograph_editorial',
            palette,
            catalogPalette: {
                paper: { prompt: '亮白', css: '#ffffff' },
                spot: { prompt: '荧光粉加靛蓝、或亮蓝加荧光橙、或青加荧光粉加黄', css: '#ff48a5' },
            },
            text: 'A figure on a shore',
            output: join(workspaceDir, 'out', 'beastcover.png'),
            source: 'local-model' as const,
            via: 'codex' as const,
        };

        appendHistory(workspaceDir, record);
        expect(listHistory(workspaceDir)).toEqual([
            {
                ...record,
                output: join('out', 'beastcover.png'),
            },
        ]);
    });

    it('parses a render-shaped history record without source, via, or catalogPalette', () => {
        const cwd = tempDir('beastcover-history-render-shape-');
        const workspaceDir = createWorkspace(cwd, { name: 'demo' }).path;
        const record = {
            createdAt: '2026-08-23T00:00:00.000Z',
            style: 'risograph_editorial',
            palette: { paper: { prompt: '亮白', css: '#ffffff' } },
            text: 'One headline, every platform',
            output: join('out', 'beastcover.png'),
        };
        writeFileSync(join(workspaceDir, 'history.jsonl'), `${JSON.stringify(record)}\n`, 'utf8');

        expect(listHistory(workspaceDir)).toEqual([record]);
        expect(Object.keys(listHistory(workspaceDir)[0] ?? {}).sort()).toEqual(
            ['createdAt', 'output', 'palette', 'style', 'text'].sort(),
        );
    });

    it('rejects a leftover string palette slot in history.jsonl', () => {
        const cwd = tempDir('beastcover-history-string-');
        const created = createWorkspace(cwd, { name: 'demo' });
        writeFileSync(
            join(created.path, 'history.jsonl'),
            `${JSON.stringify({
                createdAt: '2026-08-23T00:00:00.000Z',
                style: 'risograph_editorial',
                palette: { paper: '纯白' },
                text: 'old',
                output: join('out', 'a.png'),
            })}\n`,
            'utf8',
        );
        expect(() => listHistory(created.path)).toThrowError(
            `${join(created.path, 'history.jsonl')}:1 has invalid "palette.paper". Expected an object with "prompt" and "css" strings.`,
        );
    });
});
