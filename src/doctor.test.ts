import { chmodSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { renderDoctorReport, runDoctor } from './doctor.ts';

const tempDirectories: string[] = [];

const startsChromium = async () => ({ close: async () => undefined });

afterEach(() => {
    for (const directory of tempDirectories.splice(0)) {
        rmSync(directory, { recursive: true, force: true });
    }
});

describe('offline doctor', () => {
    it('checks Chromium by starting it the way render does', async () => {
        const directory = mkdtempSync(join(tmpdir(), 'beastcover-doctor-chromium-'));
        tempDirectories.push(directory);
        const configPath = join(directory, 'config.json');
        writeFileSync(configPath, '{}\n', { mode: 0o600 });
        const missing = await runDoctor({
            nodeVersion: '22.19.0',
            configPath,
            platform: 'darwin',
            lookupCommand: () => undefined,
            launchChromium: async () => {
                throw new Error(
                    "browserType.launch: Executable doesn't exist at /x/chrome-headless-shell\nmore lines",
                );
            },
        });
        expect(missing.healthy).toBe(false);
        expect(missing.checks.find((check) => check.id === 'chromium')).toEqual({
            id: 'chromium',
            label: 'Chromium',
            status: 'error',
            message:
                "Headless Chromium does not start: browserType.launch: Executable doesn't exist at /x/chrome-headless-shell Run npx --yes --package @liustack/beastcover playwright install chromium.",
        });
    });

    it('checks Node, the Chromium executable, private config permissions, and local-model CLIs', async () => {
        const directory = mkdtempSync(join(tmpdir(), 'beastcover-doctor-'));
        tempDirectories.push(directory);
        const configPath = join(directory, 'config.json');
        writeFileSync(configPath, '{}\n', { mode: 0o600 });

        const healthy = await runDoctor({
            nodeVersion: '22.19.0',
            launchChromium: startsChromium,
            configPath,
            platform: 'darwin',
            osRelease: '24.3.0',
            lookupCommand: () => undefined,
        });

        expect(healthy.healthy).toBe(true);
        expect(healthy.checks).toHaveLength(7);
        // 没有 swiftc 时自动抠图不可用，只是提醒，不影响健康。
        expect(healthy.checks.find((check) => check.id === 'cutout')).toEqual({
            id: 'cutout',
            label: 'Subject cutout',
            status: 'warn',
            message:
                '--subject needs a transparent PNG here: automatic cutout needs the Swift compiler. Run xcode-select --install.',
        });
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
        const unsafe = await runDoctor({
            nodeVersion: '22.19.0',
            launchChromium: startsChromium,
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

    it('reports the macOS cutout as ok when swiftc is on PATH and as a warning elsewhere', async () => {
        const directory = mkdtempSync(join(tmpdir(), 'beastcover-doctor-cutout-'));
        tempDirectories.push(directory);
        const configPath = join(directory, 'config.json');
        writeFileSync(configPath, '{}\n', { mode: 0o600 });
        const base = { nodeVersion: '22.19.0', launchChromium: startsChromium, configPath };

        const mac = await runDoctor({
            ...base,
            platform: 'darwin',
            osRelease: '24.3.0',
            lookupCommand: (name) => (name === 'swiftc' ? '/usr/bin/swiftc' : undefined),
        });
        expect(mac.checks.find((check) => check.id === 'cutout')).toMatchObject({
            status: 'ok',
            message: '--subject photos are cut out on this machine with macOS Vision.',
        });

        const linux = await runDoctor({
            ...base,
            platform: 'linux',
            lookupCommand: () => '/usr/bin/x',
        });
        expect(linux.checks.find((check) => check.id === 'cutout')).toMatchObject({
            status: 'warn',
            message:
                '--subject needs a transparent PNG here: automatic cutout needs macOS 14 or newer.',
        });
    });

    it('reports installed local-model CLIs as ok without changing health', async () => {
        const directory = mkdtempSync(join(tmpdir(), 'beastcover-doctor-cli-'));
        tempDirectories.push(directory);
        const configPath = join(directory, 'config.json');
        writeFileSync(configPath, '{}\n', { mode: 0o600 });

        const report = await runDoctor({
            nodeVersion: '22.19.0',
            launchChromium: startsChromium,
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
