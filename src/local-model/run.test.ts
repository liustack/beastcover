import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import sharp from 'sharp';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
    LOCAL_MODEL_TIMEOUT_MS,
    type LocalModelSpawnRequest,
    runLocalModel,
    spawnCapturedProcess,
} from './index.ts';

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
        prompt: 'Use your image generation capability. 主体：海岸.',
        referencePaths: [] as string[],
        generatedPath: outputPath,
        targets: [{ preset: 'youtube' as const, outputPath }],
    };
}

describe('local-model run', () => {
    it('exports a 5-minute default timeout', () => {
        expect(LOCAL_MODEL_TIMEOUT_MS).toBe(300_000);
    });

    it('removes the target file before spawn so a stale PNG cannot count as success', async () => {
        const outputPath = join(tempDir('beastcover-run-stale-'), 'stale.png');
        writeFileSync(outputPath, Buffer.concat([PNG_MAGIC, Buffer.from('stale')]));
        let goneWhenSpawned = false;
        const spawn = vi.fn(async (_request: LocalModelSpawnRequest) => {
            goneWhenSpawned = !existsSync(outputPath);
        });

        let thrown: unknown;
        try {
            await runLocalModel({
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
        expect(message).toMatch(/local-model|codex/);
    });

    it('rejects missing, empty, and non-image output', async () => {
        const directory = tempDir('beastcover-run-verify-');
        const missingPath = join(directory, 'missing.png');
        const emptyPath = join(directory, 'empty.png');
        const randomPath = join(directory, 'random.png');

        const missingError = await runLocalModel({
            ...baseInput(missingPath),
            spawn: vi.fn(async (_request: LocalModelSpawnRequest) => undefined),
        }).then(
            () => undefined,
            (error: unknown) => error,
        );
        expect(missingError).toBeInstanceOf(Error);
        expect((missingError as Error).message).toMatch(/missing|not found|does not exist/i);
        expect((missingError as Error).message).toMatch(/local-model|codex/);

        const emptySpawn = vi.fn(async (_request: LocalModelSpawnRequest) => {
            writeFileSync(emptyPath, Buffer.alloc(0));
        });
        const emptyError = await runLocalModel({
            ...baseInput(emptyPath),
            spawn: emptySpawn,
        }).then(
            () => undefined,
            (error: unknown) => error,
        );
        expect(emptyError).toBeInstanceOf(Error);
        expect((emptyError as Error).message).toMatch(/empty/i);
        expect((emptyError as Error).message).toMatch(/local-model|codex/);

        const randomSpawn = vi.fn(async (_request: LocalModelSpawnRequest) => {
            writeFileSync(randomPath, 'not-an-image');
        });
        const randomError = await runLocalModel({
            ...baseInput(randomPath),
            spawn: randomSpawn,
        }).then(
            () => undefined,
            (error: unknown) => error,
        );
        expect(randomError).toBeInstanceOf(Error);
        expect((randomError as Error).message).toMatch(/invalid/i);
        expect((randomError as Error).message).toMatch(/local-model|codex/);
    });

    it('rejects a hung local-model spawn after the injected timeout', async () => {
        const outputPath = join(tempDir('beastcover-run-timeout-'), 'out.png');
        const spawn = vi.fn((_request: LocalModelSpawnRequest) => new Promise<void>(() => {}));

        let thrown: unknown;
        try {
            await runLocalModel({
                ...baseInput(outputPath),
                timeoutMs: 50,
                spawn,
            });
        } catch (error) {
            thrown = error;
        }
        expect(thrown).toBeInstanceOf(Error);
        const message = thrown instanceof Error ? thrown.message : String(thrown);
        expect(message).toContain('local-model');
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
            'local-model via codex exited with code 2.',
        );
    });
});

describe('local-model finish after verify', () => {
    async function generate(outputPath: string, width: number, height: number, jpeg = false) {
        const image = sharp({
            create: { width, height, channels: 3, background: { r: 0, g: 255, b: 0 } },
        });
        await (jpeg ? image.jpeg() : image.png()).toFile(outputPath);
    }

    it('crops and resizes a verified PNG in place to youtube production pixels', async () => {
        const outputPath = join(tempDir('beastcover-run-finish-png-'), 'out.png');
        const spawn = vi.fn(async (_request: LocalModelSpawnRequest) => {
            await generate(outputPath, 1536, 1024);
        });

        await expect(runLocalModel({ ...baseInput(outputPath), spawn })).resolves.toEqual({
            outputPaths: [outputPath],
        });
        const meta = await sharp(outputPath).metadata();
        expect([meta.width, meta.height]).toEqual([1280, 720]);
    });

    it('rewrites JPEG bytes saved under the .png target as a PNG at youtube size', async () => {
        const outputPath = join(tempDir('beastcover-run-finish-jpeg-'), 'out.png');
        const spawn = vi.fn(async (_request: LocalModelSpawnRequest) => {
            await generate(outputPath, 1536, 1024, true);
        });

        await runLocalModel({ ...baseInput(outputPath), spawn });
        const meta = await sharp(outputPath).metadata();
        expect([meta.format, meta.width, meta.height]).toEqual(['png', 1280, 720]);
    });

    it('crops every platform of one family from a single generation', async () => {
        const directory = tempDir('beastcover-run-family-');
        const generatedPath = join(directory, 'cache', 'raw.png');
        const spawn = vi.fn(async (_request: LocalModelSpawnRequest) => {
            await generate(generatedPath, 1024, 1536);
        });
        const targets = [
            { preset: 'xiaohongshu' as const, outputPath: join(directory, 'out', 'a.png') },
            { preset: 'douyin' as const, outputPath: join(directory, 'out', 'b.png') },
        ];

        await expect(
            runLocalModel({ ...baseInput(generatedPath), generatedPath, targets, spawn }),
        ).resolves.toEqual({ outputPaths: targets.map((target) => target.outputPath) });
        expect(spawn).toHaveBeenCalledOnce();
        const sizes = await Promise.all(
            targets.map(async (target) => {
                const meta = await sharp(target.outputPath).metadata();
                return [meta.width, meta.height];
            }),
        );
        expect(sizes).toEqual([
            [1080, 1440],
            [1080, 1920],
        ]);
        expect(existsSync(generatedPath)).toBe(true);
    });

    it('refuses to crop platforms of different families from one generation', async () => {
        const directory = tempDir('beastcover-run-mixed-');
        const spawn = vi.fn(async () => undefined);
        await expect(
            runLocalModel({
                ...baseInput(join(directory, 'raw.png')),
                targets: [
                    { preset: 'youtube', outputPath: join(directory, 'a.png') },
                    { preset: 'douyin', outputPath: join(directory, 'b.png') },
                ],
                spawn,
            }),
        ).rejects.toThrowError('runLocalModel crops one family per generation.');
        expect(spawn).not.toHaveBeenCalled();
    });
});
