import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { WORKSPACE_GITIGNORE, writeWorkspaceIgnoreFile } from './ignore.ts';

const tempDirectories: string[] = [];

afterEach(() => {
    for (const directory of tempDirectories.splice(0)) {
        rmSync(directory, { recursive: true, force: true });
    }
});

describe('workspace ignore policy', () => {
    it('hides the whole workspace from the user git, records included', () => {
        expect(WORKSPACE_GITIGNORE).toBe('*\n');

        const directory = mkdtempSync(join(tmpdir(), 'beastcover-ignore-'));
        tempDirectories.push(directory);
        writeWorkspaceIgnoreFile(directory);
        expect(readFileSync(join(directory, '.gitignore'), 'utf8')).toBe(WORKSPACE_GITIGNORE);
    });
});
