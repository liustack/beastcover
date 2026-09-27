import { writeFileSync } from 'node:fs';
import { join } from 'node:path';

// 整个工作区对用户的 git 隐身：工具的档案不动员用户提交。
// `*` 连同这份 .gitignore 自己一起忽略，用户的仓库里看不到 .beastcover/ 的任何内容。
export const WORKSPACE_GITIGNORE = '*\n';

export function writeWorkspaceIgnoreFile(workspaceDir: string): void {
    writeFileSync(join(workspaceDir, '.gitignore'), WORKSPACE_GITIGNORE, { encoding: 'utf8' });
}
