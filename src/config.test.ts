import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
    initConfigFile,
    loadConfigFile,
    renderConfigShow,
    resolveEffectiveConfig,
    setConfigValue,
} from './config.ts';

const tempDirectories: string[] = [];

function tempConfigPath(): string {
    const directory = mkdtempSync(join(tmpdir(), 'beastcover-config-'));
    tempDirectories.push(directory);
    return join(directory, 'nested', 'config.json');
}

afterEach(() => {
    for (const directory of tempDirectories.splice(0)) {
        rmSync(directory, { recursive: true, force: true });
    }
});

describe('layered config', () => {
    it('resolves flags over file values over built-ins', () => {
        expect(
            resolveEffectiveConfig(
                {
                    source: 'stock',
                    output: 'from-file.png',
                    render: { preset: '5:2', width: 1200, scale: 2 },
                },
                { source: 'render', width: 800 },
            ),
        ).toMatchObject({
            source: 'render',
            output: 'from-file.png',
            render: { preset: '5:2', width: 800, height: 640, scale: 2 },
        });

        expect(resolveEffectiveConfig({}, {})).toMatchObject({
            source: 'render',
            output: 'beastcover.png',
            render: { preset: '16:9', width: 1600, height: 900, scale: 1 },
        });
    });

    it('initializes a private config without freezing built-in defaults', () => {
        const configPath = tempConfigPath();

        initConfigFile(configPath);

        expect(readFileSync(configPath, 'utf8')).toBe('{}\n');
        expect(statSync(configPath).mode & 0o777).toBe(0o600);
        expect(() => initConfigFile(configPath)).toThrowError(
            `${configPath} already exists. Use --force to replace it.`,
        );
    });

    it('fails loudly when the config file is corrupt', () => {
        const configPath = tempConfigPath();
        initConfigFile(configPath);
        writeFileSync(configPath, '{not-json', 'utf8');

        expect(() => loadConfigFile(configPath)).toThrowError(`${configPath} is not valid JSON.`);
    });

    it('rejects valid JSON that violates the config contract', () => {
        const configPath = tempConfigPath();
        initConfigFile(configPath);
        writeFileSync(configPath, '{"render":{"scale":"2"}}\n', 'utf8');

        expect(() => loadConfigFile(configPath)).toThrowError(
            `${configPath} has invalid "render.scale". Expected a number from 1 to 4.`,
        );
    });

    it('rejects unknown stock providers and non-string credentials at the config boundary', () => {
        const configPath = tempConfigPath();
        initConfigFile(configPath);
        writeFileSync(configPath, '{"stock":{"apiKey":"k","baseUrl":"https://x"}}\n', 'utf8');
        expect(() => loadConfigFile(configPath)).toThrowError(
            `${configPath} uses the old "stock.apiKey" key. Stock credentials are now per provider: delete "stock.apiKey" from the file, then run beastcover config set stock.pexels.apiKey <key> if you use Pexels.`,
        );

        writeFileSync(configPath, '{"stock":{"unsplash":{"apiKey":"x"}}}\n', 'utf8');
        expect(() => loadConfigFile(configPath)).toThrowError(
            `${configPath} contains unknown config key "stock.unsplash".`,
        );

        writeFileSync(configPath, '{"stock":{"pexels":{"apiKey":42}}}\n', 'utf8');
        expect(() => loadConfigFile(configPath)).toThrowError(
            `${configPath} has invalid "stock.pexels.apiKey". Expected a string.`,
        );

        writeFileSync(configPath, '{"stock":{"openverse":{"token":"x"}}}\n', 'utf8');
        expect(() => loadConfigFile(configPath)).toThrowError(
            `${configPath} contains unknown config key "stock.openverse.token".`,
        );
    });

    it('sets only known typed keys and keeps the file private', () => {
        const configPath = tempConfigPath();

        setConfigValue('source', 'stock', configPath);
        setConfigValue('render.preset', '3:2', configPath);
        setConfigValue('render.scale', '2', configPath);
        setConfigValue('stock.pexels.apiKey', 'sk-private-value', configPath);
        setConfigValue('stock.openverse.clientId', 'ov-client', configPath);
        setConfigValue('stock.openverse.clientSecret', 'ov-secret', configPath);
        setConfigValue('localModel.via', 'codex', configPath);

        expect(loadConfigFile(configPath)).toEqual({
            source: 'stock',
            render: { preset: '3:2', scale: 2 },
            stock: {
                pexels: { apiKey: 'sk-private-value' },
                openverse: { clientId: 'ov-client', clientSecret: 'ov-secret' },
            },
            localModel: { via: 'codex' },
        });
        expect(statSync(configPath).mode & 0o777).toBe(0o600);
        expect(() => setConfigValue('render.unknown', '1', configPath)).toThrowError(
            'Unknown config key "render.unknown".',
        );
    });

    it('redacts every stock credential from config show output', () => {
        const shown = renderConfigShow({
            stock: {
                pexels: { apiKey: 'sk-private-value' },
                openverse: { clientId: 'ov-client', clientSecret: 'ov-secret' },
            },
        });

        expect(shown).not.toContain('sk-private-value');
        expect(shown).not.toContain('ov-client');
        expect(shown).not.toContain('ov-secret');
        expect(shown).toContain('[redacted]');
        expect(JSON.parse(shown)).toMatchObject({
            source: 'render',
            output: 'beastcover.png',
            render: { preset: '16:9', width: 1600, height: 900, scale: 1 },
        });
    });
});
