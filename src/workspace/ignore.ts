import { writeFileSync } from 'node:fs';
import { join } from 'node:path';

export const WORKSPACE_GITIGNORE_ENTRIES = ['/out/', '/cache/', '/refs/'] as const;

export const WORKSPACE_GITIGNORE = `${WORKSPACE_GITIGNORE_ENTRIES.join('\n')}\n`;

export function writeWorkspaceIgnoreFile(workspaceDir: string): void {
    writeFileSync(join(workspaceDir, '.gitignore'), WORKSPACE_GITIGNORE, { encoding: 'utf8' });
}
