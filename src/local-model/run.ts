import { spawn } from 'node:child_process';
import {
    closeSync,
    mkdirSync,
    openSync,
    readSync,
    type Stats,
    statSync,
    unlinkSync,
} from 'node:fs';
import { dirname } from 'node:path';
import type { LocalModelProvider } from '../config.ts';
import type { DimensionPresetName } from '../dimensions.ts';
import { buildLocalModelArgv } from './argv.ts';
import { getLocalModelCanvasPlan } from './canvas.ts';
import { finishLocalModelImage } from './finish.ts';

export const LOCAL_MODEL_TIMEOUT_MS = 300_000;

export interface LocalModelSpawnRequest {
    command: string;
    args: readonly string[];
    stdin: 'ignore';
    timeoutMs: number;
}

export interface LocalModelRunInput {
    provider: LocalModelProvider;
    commandPath: string;
    prompt: string;
    referencePaths: string[];
    outputPath: string;
    preset: DimensionPresetName;
    timeoutMs?: number;
    spawn?: (request: LocalModelSpawnRequest) => Promise<void>;
    verbose?: boolean;
    backendOutput?: { write(chunk: string): unknown };
}

const PNG_MAGIC = Buffer.from([0x89, 0x50, 0x4e, 0x47]);
const JPEG_MAGIC = Buffer.from([0xff, 0xd8, 0xff]);

function removeTarget(outputPath: string): void {
    try {
        unlinkSync(outputPath);
    } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
            throw error;
        }
    }
}

function withTimeout(
    task: Promise<void>,
    timeoutMs: number,
    provider: LocalModelProvider,
): Promise<void> {
    return new Promise((resolve, reject) => {
        let settled = false;
        const timer = setTimeout(() => {
            if (settled) {
                return;
            }
            settled = true;
            reject(new Error(`local-model via ${provider} timed out after ${timeoutMs}ms.`));
        }, timeoutMs);
        task.then(
            (value) => {
                if (settled) {
                    return;
                }
                settled = true;
                clearTimeout(timer);
                resolve(value);
            },
            (error: unknown) => {
                if (settled) {
                    return;
                }
                settled = true;
                clearTimeout(timer);
                reject(error);
            },
        );
    });
}

export async function spawnCapturedProcess(input: {
    command: string;
    args: readonly string[];
    timeoutMs: number;
    verbose: boolean;
    provider: LocalModelProvider;
    backendOutput?: { write(chunk: string): unknown };
}): Promise<void> {
    return new Promise((resolve, reject) => {
        const child = spawn(input.command, [...input.args], {
            stdio: ['ignore', 'pipe', 'pipe'],
        });
        const stdout = child.stdout;
        const stderr = child.stderr;
        if (stdout === null || stderr === null) {
            reject(new Error('local-model spawn is missing stdout or stderr pipes.'));
            return;
        }

        const chunks: Buffer[] = [];
        const append = (chunk: Buffer): void => {
            chunks.push(chunk);
        };
        stdout.on('data', append);
        stderr.on('data', append);

        const dumpCaptured = (): void => {
            const writer = input.backendOutput === undefined ? process.stderr : input.backendOutput;
            writer.write(Buffer.concat(chunks).toString());
        };

        let settled = false;
        const timer = setTimeout(() => {
            child.kill('SIGTERM');
            const killTimer = setTimeout(() => {
                child.kill('SIGKILL');
            }, 1000);
            child.once('close', () => {
                clearTimeout(killTimer);
            });
            if (settled) {
                return;
            }
            settled = true;
            dumpCaptured();
            reject(
                new Error(
                    `local-model via ${input.provider} timed out after ${input.timeoutMs}ms.`,
                ),
            );
        }, input.timeoutMs);

        child.on('error', (error) => {
            if (settled) {
                return;
            }
            settled = true;
            clearTimeout(timer);
            reject(error);
        });

        child.on('close', (code) => {
            if (settled) {
                return;
            }
            settled = true;
            clearTimeout(timer);
            if (code === 0) {
                if (input.verbose) {
                    dumpCaptured();
                }
                resolve();
                return;
            }
            dumpCaptured();
            reject(new Error(`local-model via ${input.provider} exited with code ${code}.`));
        });
    });
}

function verifyOutput(outputPath: string, provider: LocalModelProvider): void {
    let info: Stats;
    try {
        info = statSync(outputPath);
    } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
            throw new Error(
                `local-model via ${provider} produced no image. File not found: ${outputPath}.`,
            );
        }
        throw error;
    }

    if (!info.isFile()) {
        throw new Error(`local-model via ${provider} produced no image at ${outputPath}.`);
    }
    if (info.size === 0) {
        throw new Error(`local-model via ${provider} produced an empty file at ${outputPath}.`);
    }

    const fd = openSync(outputPath, 'r');
    let header: Buffer;
    try {
        header = Buffer.alloc(4);
        const bytesRead = readSync(fd, header, 0, 4, 0);
        header = header.subarray(0, bytesRead);
    } finally {
        closeSync(fd);
    }

    const isPng = header.length >= 4 && header.subarray(0, 4).equals(PNG_MAGIC);
    const isJpeg = header.length >= 3 && header.subarray(0, 3).equals(JPEG_MAGIC);
    if (!isPng && !isJpeg) {
        throw new Error(`local-model via ${provider} produced an invalid image at ${outputPath}.`);
    }
}

export async function runLocalModel(input: LocalModelRunInput): Promise<{ outputPath: string }> {
    const timeoutMs = input.timeoutMs ?? LOCAL_MODEL_TIMEOUT_MS;
    mkdirSync(dirname(input.outputPath), { recursive: true });
    removeTarget(input.outputPath);

    const argv = buildLocalModelArgv({
        provider: input.provider,
        prompt: input.prompt,
        referencePaths: input.referencePaths,
    });
    const request: LocalModelSpawnRequest = {
        command: input.commandPath,
        args: argv.args,
        stdin: 'ignore',
        timeoutMs,
    };

    if (input.spawn !== undefined) {
        await withTimeout(input.spawn(request), timeoutMs, input.provider);
    } else {
        await spawnCapturedProcess({
            command: request.command,
            args: request.args,
            timeoutMs,
            verbose: Boolean(input.verbose),
            provider: input.provider,
            backendOutput: input.backendOutput,
        });
    }

    verifyOutput(input.outputPath, input.provider);
    const plan = getLocalModelCanvasPlan(input.preset);
    await finishLocalModelImage({
        sourcePath: input.outputPath,
        outputPath: input.outputPath,
        plan,
    });
    return { outputPath: input.outputPath };
}
