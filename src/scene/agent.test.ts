import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
    AGENT_TIMEOUT_MS,
    type AgentSpawnRequest,
    agentArgs,
    paintWithAgent,
    sceneEnvelope,
    spawnCapturedProcess,
} from './agent.ts';

const tempDirectories: string[] = [];
const PNG_MAGIC = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

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

function baseInput(outputPath: string) {
    return {
        provider: 'codex' as const,
        commandPath: '/fake/codex',
        prompt: 'Use your image generation capability. A harbour at dawn.',
        generatedPath: outputPath,
    };
}

describe('agent painter', () => {
    it('passes the whole envelope as one argument to codex and agy', () => {
        expect(agentArgs('codex', 'Paint it.')).toEqual([
            'exec',
            '--skip-git-repo-check',
            'Paint it.',
        ]);
        expect(agentArgs('agy', 'Paint it.')).toEqual([
            '-p',
            'Paint it.',
            '--dangerously-skip-permissions',
        ]);
    });

    it('asks for one saved image at the native size and nothing else', () => {
        const envelope = sceneEnvelope({
            prompt: 'A harbour at dawn.',
            generatedPath: '/tmp/scene.png',
            width: 1024,
            height: 1536,
        });
        expect(envelope).toContain('save it to /tmp/scene.png');
        expect(envelope).toContain('A harbour at dawn.');
        expect(envelope).toContain('Portrait 1024x1536');
        expect(envelope).toContain('Generate the image file only');
    });

    it('exports a 5-minute default timeout', () => {
        expect(AGENT_TIMEOUT_MS).toBe(300_000);
    });

    it('removes the target file before spawn so a stale PNG cannot count as success', async () => {
        const outputPath = join(tempDir('beastcover-run-stale-'), 'stale.png');
        writeFileSync(outputPath, Buffer.concat([PNG_MAGIC, Buffer.from('stale')]));
        let goneWhenSpawned = false;
        const spawn = vi.fn(async (_request: AgentSpawnRequest) => {
            goneWhenSpawned = !existsSync(outputPath);
        });

        let thrown: unknown;
        try {
            await paintWithAgent({
                ...baseInput(outputPath),
                spawn,
            });
        } catch (error) {
            thrown = error;
        }

        expect(spawn).toHaveBeenCalled();
        expect(goneWhenSpawned).toBe(true);
        expect(spawn.mock.calls[0]?.[0].stdin).toBe('ignore');
        expect(thrown).toBeInstanceOf(Error);
        const message = thrown instanceof Error ? thrown.message : String(thrown);
        expect(message).toMatch(/missing|not found|does not exist|invalid|empty/i);
        expect(message).toMatch(/codex/);
    });

    it('rejects missing, empty, and non-image output', async () => {
        const directory = tempDir('beastcover-run-verify-');
        const missingPath = join(directory, 'missing.png');
        const emptyPath = join(directory, 'empty.png');
        const randomPath = join(directory, 'random.png');

        const missingError = await paintWithAgent({
            ...baseInput(missingPath),
            spawn: vi.fn(async (_request: AgentSpawnRequest) => undefined),
        }).then(
            () => undefined,
            (error: unknown) => error,
        );
        expect(missingError).toBeInstanceOf(Error);
        expect((missingError as Error).message).toMatch(/missing|not found|does not exist/i);
        expect((missingError as Error).message).toMatch(/codex/);

        const emptySpawn = vi.fn(async (_request: AgentSpawnRequest) => {
            writeFileSync(emptyPath, Buffer.alloc(0));
        });
        const emptyError = await paintWithAgent({
            ...baseInput(emptyPath),
            spawn: emptySpawn,
        }).then(
            () => undefined,
            (error: unknown) => error,
        );
        expect(emptyError).toBeInstanceOf(Error);
        expect((emptyError as Error).message).toMatch(/empty/i);
        expect((emptyError as Error).message).toMatch(/codex/);

        const randomSpawn = vi.fn(async (_request: AgentSpawnRequest) => {
            writeFileSync(randomPath, 'not-an-image');
        });
        const randomError = await paintWithAgent({
            ...baseInput(randomPath),
            spawn: randomSpawn,
        }).then(
            () => undefined,
            (error: unknown) => error,
        );
        expect(randomError).toBeInstanceOf(Error);
        expect((randomError as Error).message).toMatch(/invalid/i);
        expect((randomError as Error).message).toMatch(/codex/);
    });

    it('rejects a hung agent spawn after the injected timeout', async () => {
        const outputPath = join(tempDir('beastcover-run-timeout-'), 'out.png');
        const spawn = vi.fn((_request: AgentSpawnRequest) => new Promise<void>(() => {}));

        let thrown: unknown;
        try {
            await paintWithAgent({
                ...baseInput(outputPath),
                timeoutMs: 50,
                spawn,
            });
        } catch (error) {
            thrown = error;
        }
        expect(thrown).toBeInstanceOf(Error);
        const message = thrown instanceof Error ? thrown.message : String(thrown);
        expect(message).toContain('codex');
        expect(message).toContain('50');
    }, 3000);
});

describe('spawnCapturedProcess', () => {
    function memoryWriter() {
        const chunks: string[] = [];
        return {
            chunks,
            backendOutput: {
                write(chunk: string) {
                    chunks.push(chunk);
                },
            },
        };
    }

    it('keeps backend output out of the writer when verbose is false', async () => {
        const { chunks, backendOutput } = memoryWriter();
        await spawnCapturedProcess({
            command: process.execPath,
            args: ['-e', "console.log('BACKEND_NOISE'); console.error('BACKEND_NOISE');"],
            timeoutMs: 10000,
            verbose: false,
            provider: 'codex',
            backendOutput,
        });
        expect(chunks.join('')).not.toContain('BACKEND_NOISE');
    });

    it('writes backend output when verbose is true', async () => {
        const { chunks, backendOutput } = memoryWriter();
        await spawnCapturedProcess({
            command: process.execPath,
            args: ['-e', "console.log('BACKEND_NOISE'); console.error('BACKEND_NOISE');"],
            timeoutMs: 10000,
            verbose: true,
            provider: 'codex',
            backendOutput,
        });
        expect(chunks.join('')).toContain('BACKEND_NOISE');
    });

    it('captures backend output on non-zero exit even when verbose is false', async () => {
        const { chunks, backendOutput } = memoryWriter();
        let thrown: unknown;
        try {
            await spawnCapturedProcess({
                command: process.execPath,
                args: ['-e', "console.log('BACKEND_NOISE'); process.exit(2);"],
                timeoutMs: 10000,
                verbose: false,
                provider: 'codex',
                backendOutput,
            });
        } catch (error) {
            thrown = error;
        }
        expect(chunks.join('')).toContain('BACKEND_NOISE');
        expect(thrown).toBeInstanceOf(Error);
        expect(thrown instanceof Error ? thrown.message : String(thrown)).toBe(
            'codex exited with code 2.',
        );
    });
});
