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
import type { AgentProvider } from '../config.ts';

// 用户本机的 agent CLI 画场景：用它自带的生图能力画一张图存到指定路径，我们只核对文件真的在。
export const AGENT_TIMEOUT_MS = 300_000;

const ENVELOPE_CLOSER = 'Generate the image file only, do not do anything else.';

/** 交给 agent 的整句要求：用生图能力画一张、存到哪、画什么、多大 */
export function sceneEnvelope(input: {
    prompt: string;
    generatedPath: string;
    width: number;
    height: number;
}): string {
    const size =
        input.height > input.width
            ? `Portrait ${input.width}x${input.height}`
            : `Landscape ${input.width}x${input.height}`;
    return `Use your image generation capability to create one image and save it to ${input.generatedPath}. ${input.prompt} ${size}. ${ENVELOPE_CLOSER}`;
}

/** codex 和 agy 的调用参数：提示词整句作为一个参数 */
export function agentArgs(provider: AgentProvider, prompt: string): string[] {
    return provider === 'codex'
        ? ['exec', '--skip-git-repo-check', prompt]
        : ['-p', prompt, '--dangerously-skip-permissions'];
}

export interface AgentSpawnRequest {
    command: string;
    args: readonly string[];
    stdin: 'ignore';
    timeoutMs: number;
}

export interface AgentPaintInput {
    provider: AgentProvider;
    commandPath: string;
    /** 完整的信封提示词（sceneEnvelope） */
    prompt: string;
    /** agent 把图存到这里 */
    generatedPath: string;
    timeoutMs?: number;
    spawn?: (request: AgentSpawnRequest) => Promise<void>;
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
    provider: AgentProvider,
): Promise<void> {
    return new Promise((resolve, reject) => {
        let settled = false;
        const timer = setTimeout(() => {
            if (settled) {
                return;
            }
            settled = true;
            reject(new Error(`${provider} timed out after ${timeoutMs}ms.`));
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
    provider: AgentProvider;
    backendOutput?: { write(chunk: string): unknown };
}): Promise<void> {
    return new Promise((resolve, reject) => {
        const child = spawn(input.command, [...input.args], {
            stdio: ['ignore', 'pipe', 'pipe'],
        });
        const stdout = child.stdout;
        const stderr = child.stderr;
        if (stdout === null || stderr === null) {
            reject(new Error(`${input.provider} spawn is missing stdout or stderr pipes.`));
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
            reject(new Error(`${input.provider} timed out after ${input.timeoutMs}ms.`));
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
            reject(new Error(`${input.provider} exited with code ${code}.`));
        });
    });
}

function verifyOutput(outputPath: string, provider: AgentProvider): void {
    let info: Stats;
    try {
        info = statSync(outputPath);
    } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
            throw new Error(`${provider} produced no image. File not found: ${outputPath}.`);
        }
        throw error;
    }

    if (!info.isFile()) {
        throw new Error(`${provider} produced no image at ${outputPath}.`);
    }
    if (info.size === 0) {
        throw new Error(`${provider} produced an empty file at ${outputPath}.`);
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
        throw new Error(`${provider} produced an invalid image at ${outputPath}.`);
    }
}

/** 让 agent 画一张图，等它写完文件再核对：先删旧文件，免得上次的图被当成这次的 */
export async function paintWithAgent(input: AgentPaintInput): Promise<void> {
    const timeoutMs = input.timeoutMs ?? AGENT_TIMEOUT_MS;
    mkdirSync(dirname(input.generatedPath), { recursive: true });
    removeTarget(input.generatedPath);
    const request: AgentSpawnRequest = {
        command: input.commandPath,
        args: agentArgs(input.provider, input.prompt),
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
    verifyOutput(input.generatedPath, input.provider);
}
