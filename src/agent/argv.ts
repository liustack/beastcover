import { type Stats, statSync } from 'node:fs';
import { resolve } from 'node:path';
import type { AgentProvider } from '../config.ts';

export function buildAgentArgv(input: {
    provider: AgentProvider;
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

    // agy 没有与 codex 对等的图片旗标。参考图路径写进提示词末尾，agy 用自己的文件工具读。
    return {
        command: 'agy',
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
