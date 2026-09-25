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

        const created = createWorkspace(cwd, { name: 'demo', styleName: 'minimal_watercolor' });
        const style = loadStyle('minimal_watercolor');

        expect(created.path).toBe(join(cwd, '.beastcover'));
        expect(created.pack.style).toBe('minimal_watercolor');
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
        expect(created.pack.style).toBe('memory_color_blocks');
    });

    it('finds a parent workspace and refuses to create a second one', () => {
        const root = tempDir('beastcover-walk-');
        createWorkspace(root, { name: 'root' });
        const nested = join(root, 'src', 'article');
        mkdirSync(nested, { recursive: true });

        expect(findWorkspace(nested)).toBe(join(root, '.beastcover'));
        expect(() => createWorkspace(nested, { name: 'nested' })).toThrowError(
            `An BeastCover workspace already exists at ${join(root, '.beastcover')}.`,
        );
        expect(existsSync(join(nested, '.beastcover'))).toBe(false);
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
                style: 'memory_color_blocks',
                palette: { unknown: '#fff' },
                composition: { strategy: 'paper-border', guidance: 'x' },
            })}\n`,
            'utf8',
        );
        expect(() => loadStylePack(workspaceDir)).toThrowError(
            `${join(workspaceDir, 'project.json')} contains unknown palette slot "unknown".`,
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
                style: 'memory_color_blocks',
                palette: { paper: '纯白' },
                composition: { strategy: 'paper-border', guidance: 'x' },
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
                style: 'memory_color_blocks',
                palette: { paper: { prompt: '纯白', css: '暖白' } },
                composition: { strategy: 'paper-border', guidance: 'x' },
            })}\n`,
            'utf8',
        );
        expect(() => loadStylePack(workspaceDir)).toThrowError(
            `${packPath} has invalid "palette.paper.css". Expected a CSS color value.`,
        );
    });

    it('lets a slot override only css or only prompt and fills the rest from the catalog', () => {
        const cwd = tempDir('beastcover-pack-partial-');
        const created = createWorkspace(cwd, { name: 'demo', styleName: 'minimal_watercolor' });
        const packPath = join(created.path, 'project.json');

        writeFileSync(
            packPath,
            `${JSON.stringify({
                name: 'demo',
                style: 'minimal_watercolor',
                palette: {
                    paper: { css: '#ff0000' },
                    accent: { prompt: '低饱和暖黄' },
                },
                composition: created.pack.composition,
            })}\n`,
            'utf8',
        );

        const loaded = loadStylePack(created.path);
        expect(loaded.palette).toEqual({
            paper: { css: '#ff0000' },
            accent: { prompt: '低饱和暖黄' },
        });
        expect(mergedPalette(loaded)).toEqual({
            paper: { prompt: '暖白', css: '#ff0000' },
            primary: { prompt: '低饱和雾蓝与灰青绿', css: '#7a93a0' },
            secondary: { prompt: '沙色、米白', css: '#d8cbb8' },
            accent: { prompt: '低饱和暖黄', css: '#d4b56a' },
            dark: { prompt: '淡墨', css: '#5c5a54' },
        });
    });

    it('appends a history.jsonl line for each generation', () => {
        const cwd = tempDir('beastcover-history-');
        const workspaceDir = createWorkspace(cwd, { name: 'demo' }).path;
        const first = {
            createdAt: '2026-08-23T00:00:00.000Z',
            style: 'memory_color_blocks',
            palette: { paper: { prompt: '纯白', css: '#ffffff' } },
            text: 'One visual family',
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
        const created = createWorkspace(cwd, { name: 'demo', styleName: 'minimal_watercolor' });
        appendHistory(created.path, {
            createdAt: '2026-08-23T00:00:00.000Z',
            style: 'minimal_watercolor',
            palette: {},
            text: '碎玻璃上的反光',
            output: join(created.path, 'out', 'a.png'),
        });
        const raw = readFileSync(join(created.path, 'history.jsonl'), 'utf8').trim();
        expect(JSON.parse(raw).output).toBe(join('out', 'a.png'));
        expect(raw).not.toContain(cwd);
    });

    it('round-trips optional source, via, and catalogPalette when present', () => {
        const cwd = tempDir('beastcover-history-optional-');
        const workspaceDir = createWorkspace(cwd, { name: 'demo' }).path;
        const palette = { paper: { prompt: '纯白', css: '#ffffff' } };
        const record = {
            createdAt: '2026-08-23T00:00:00.000Z',
            style: 'memory_color_blocks',
            palette,
            catalogPalette: {
                paper: { prompt: '纯白', css: '#ffffff' },
                landscape: { prompt: '浅蓝、雾蓝、蓝灰、灰青绿、湖青、米白', css: '#8aa3b5' },
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
            style: 'memory_color_blocks',
            palette: { paper: { prompt: '纯白', css: '#ffffff' } },
            text: 'One visual family',
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
                style: 'memory_color_blocks',
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
