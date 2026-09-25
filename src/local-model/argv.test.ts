import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { buildLocalModelArgv, resolveNamedRefFiles } from './index.ts';

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

describe('places every codex -i after the prompt argument and rejects glob or missing refs', () => {
    const prompt = 'Use your image generation capability. 主体：海岸上的人.';
    const abs1 = '/tmp/cover-ref-a.png';
    const abs2 = '/tmp/cover-ref-b.jpg';

    it('builds codex argv with the prompt as one argument and every -i after it', () => {
        const result = buildLocalModelArgv({
            provider: 'codex',
            prompt,
            referencePaths: [abs1, abs2],
        });

        expect(result.command).toBe('codex');
        expect(result.stdin).toBe('ignore');
        expect(result.args[0]).toBe('exec');
        expect(result.args).toContain('--skip-git-repo-check');
        expect(result.args.filter((argument) => argument === prompt)).toHaveLength(1);
        const promptIndex = result.args.indexOf(prompt);
        expect(promptIndex).toBeGreaterThan(-1);
        const skipIndex = result.args.indexOf('--skip-git-repo-check');
        expect(skipIndex).toBeGreaterThan(-1);
        expect(skipIndex).toBeLessThan(promptIndex);
        const flagIndices = result.args.flatMap((argument, index) =>
            argument === '-i' || argument === '--image' ? [index] : [],
        );
        expect(flagIndices.length).toBeGreaterThan(0);
        for (const index of flagIndices) {
            expect(index).toBeGreaterThan(promptIndex);
        }
        expect(result.args.slice(promptIndex + 1)).toEqual(['-i', abs1, '-i', abs2]);
    });

    it('builds grok argv without -i or --image', () => {
        const result = buildLocalModelArgv({
            provider: 'grok',
            prompt,
            referencePaths: [abs1, abs2],
        });

        expect(result.command).toBe('grok');
        expect(result.stdin).toBe('ignore');
        expect(result.args).toEqual([
            '-p',
            prompt,
            '--permission-mode',
            'bypassPermissions',
            '--verbatim',
        ]);
        expect(result.args).not.toContain('-i');
        expect(result.args).not.toContain('--image');
    });

    it('builds claude argv without -i or --image', () => {
        const result = buildLocalModelArgv({
            provider: 'claude',
            prompt,
            referencePaths: [abs1, abs2],
        });

        expect(result.command).toBe('claude');
        expect(result.stdin).toBe('ignore');
        expect(result.args).toEqual(['-p', prompt, '--dangerously-skip-permissions']);
        expect(result.args).not.toContain('-i');
        expect(result.args).not.toContain('--image');
    });

    it('resolves named reference files to absolute paths and rejects missing files, directories, and globs', () => {
        const cwd = tempDir('beastcover-argv-refs-');
        const named = join(cwd, 'shot.png');
        writeFileSync(named, 'png-bytes', 'utf8');
        expect(resolveNamedRefFiles(['shot.png'], cwd)).toEqual([resolve(cwd, 'shot.png')]);
        expect(resolveNamedRefFiles([named], cwd)).toEqual([named]);

        expect(() => resolveNamedRefFiles(['missing.png'], cwd)).toThrowError('missing.png');

        const directory = join(cwd, 'refs-dir');
        mkdirSync(directory);
        expect(() => resolveNamedRefFiles([directory], cwd)).toThrowError(directory);

        writeFileSync(join(cwd, 'one.png'), 'a', 'utf8');
        writeFileSync(join(cwd, 'two.png'), 'b', 'utf8');
        let globResult: string[] | undefined;
        let globError: unknown;
        try {
            globResult = resolveNamedRefFiles(['*.png'], cwd);
        } catch (error) {
            globError = error;
        }
        if (globError) {
            expect(globError).toBeInstanceOf(Error);
            expect((globError as Error).message).toContain('*.png');
        } else {
            expect(globResult).not.toEqual(
                [resolve(cwd, 'one.png'), resolve(cwd, 'two.png')].sort(),
            );
            expect(globResult).not.toHaveLength(2);
        }
    });
});
