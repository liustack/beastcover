import { chmodSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { renderDoctorReport, runDoctor } from './doctor.ts';

const tempDirectories: string[] = [];

afterEach(() => {
    for (const directory of tempDirectories.splice(0)) {
        rmSync(directory, { recursive: true, force: true });
    }
});

describe('offline doctor', () => {
    it('checks Node, the Chromium executable, private config permissions, and local-model CLIs', () => {
        const directory = mkdtempSync(join(tmpdir(), 'beastcover-doctor-'));
        tempDirectories.push(directory);
        const chromiumPath = join(directory, 'chromium');
        const configPath = join(directory, 'config.json');
        writeFileSync(chromiumPath, '#!/bin/sh\n', { mode: 0o700 });
        writeFileSync(configPath, '{}\n', { mode: 0o600 });

        const healthy = runDoctor({
            nodeVersion: '22.19.0',
            chromiumPath,
            configPath,
            platform: 'darwin',
            lookupCommand: () => undefined,
        });

        expect(healthy.healthy).toBe(true);
        expect(healthy.checks).toHaveLength(6);
        expect(healthy.checks.find((check) => check.id === 'node')).toMatchObject({
            id: 'node',
            status: 'ok',
        });
        expect(healthy.checks.find((check) => check.id === 'chromium')).toMatchObject({
            id: 'chromium',
            status: 'ok',
        });
        expect(healthy.checks.find((check) => check.id === 'config-permissions')).toMatchObject({
            id: 'config-permissions',
            status: 'ok',
        });
        for (const id of ['codex', 'grok', 'claude'] as const) {
            expect(healthy.checks.find((check) => check.id === id)).toMatchObject({
                id,
                status: 'warn',
            });
            expect(healthy.checks.find((check) => check.id === id)?.message).toMatch(id);
        }
        expect(renderDoctorReport(healthy)).toContain('BeastCover doctor: healthy');

        chmodSync(configPath, 0o644);
        const unsafe = runDoctor({
            nodeVersion: '22.19.0',
            chromiumPath,
            configPath,
            platform: 'darwin',
            lookupCommand: () => undefined,
        });
        expect(unsafe.healthy).toBe(false);
        expect(unsafe.checks.find((check) => check.id === 'config-permissions')).toMatchObject({
            id: 'config-permissions',
            status: 'error',
        });
        expect(unsafe.checks.find((check) => check.id === 'codex')).toMatchObject({
            status: 'warn',
        });
    });

    it('reports installed local-model CLIs as ok without changing health', () => {
        const directory = mkdtempSync(join(tmpdir(), 'beastcover-doctor-cli-'));
        tempDirectories.push(directory);
        const chromiumPath = join(directory, 'chromium');
        const configPath = join(directory, 'config.json');
        writeFileSync(chromiumPath, '#!/bin/sh\n', { mode: 0o700 });
        writeFileSync(configPath, '{}\n', { mode: 0o600 });

        const report = runDoctor({
            nodeVersion: '22.19.0',
            chromiumPath,
            configPath,
            platform: 'darwin',
            lookupCommand: (name) => `/usr/bin/${name}`,
        });

        expect(report.healthy).toBe(true);
        for (const id of ['codex', 'grok', 'claude'] as const) {
            expect(report.checks.find((check) => check.id === id)).toMatchObject({
                id,
                status: 'ok',
            });
        }
    });
});
