import { type Stats, statSync } from 'node:fs';
import { resolve } from 'node:path';
import type { LocalModelProvider } from '../config.ts';

export function buildLocalModelArgv(input: {
    provider: LocalModelProvider;
    prompt: string;
    referencePaths: string[];
}): { command: string; args: string[]; stdin: 'ignore' } {
    if (input.provider === 'codex') {
        const args = ['exec', '--skip-git-repo-check', input.prompt];
        for (const referencePath of input.referencePaths) {
            args.push('-i', referencePath);
        }
        return { command: 'codex', args, stdin: 'ignore' };
    }

    if (input.provider === 'grok') {
        // grok CLI 帮助里没有与 codex 对等的 -i。参考图写进提示词末尾，这个写法未经实战验证。
        return {
            command: 'grok',
            args: ['-p', input.prompt, '--permission-mode', 'bypassPermissions', '--verbatim'],
            stdin: 'ignore',
        };
    }

    // claude CLI 帮助里没有与 codex 对等的 -i（Issue #10195 仍在要这个旗标）。参考图写进提示词末尾，这个写法未经实战验证。
    return {
        command: 'claude',
        args: ['-p', input.prompt, '--dangerously-skip-permissions'],
        stdin: 'ignore',
    };
}

export function resolveNamedRefFiles(paths: string[], cwd: string): string[] {
    return paths.map((path) => {
        const absolute = resolve(cwd, path);
        let info: Stats;
        try {
            info = statSync(absolute);
        } catch (error) {
            if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
                throw new Error(`Reference file not found: ${path}`);
            }
            throw new Error(
                `Cannot inspect reference ${path}: ${error instanceof Error ? error.message : String(error)}`,
            );
        }
        if (!info.isFile()) {
            throw new Error(`Reference path is not a file: ${path}`);
        }
        return absolute;
    });
}
