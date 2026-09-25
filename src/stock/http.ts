// 图库 API 共用的 HTTP 层。fetch 和 sleep 都从外面注入，单元测试不碰网络也不等退避。

declare const __APP_VERSION__: string;

const APP_VERSION = typeof __APP_VERSION__ === 'string' ? __APP_VERSION__ : '0.0.0-dev';

export type FetchImpl = typeof fetch;
export type SleepFn = (ms: number) => Promise<void>;

export const defaultSleep: SleepFn = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export function userAgent(): string {
    return `beastcover/${APP_VERSION} (+https://github.com/liustack/beastcover)`;
}

export function asRecord(value: unknown): Record<string, unknown> | null {
    if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
        return value as Record<string, unknown>;
    }
    return null;
}

export function asString(value: unknown): string | undefined {
    return typeof value === 'string' && value !== '' ? value : undefined;
}

export function asNumber(value: unknown): number | undefined {
    return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

export function redactSecrets(text: string, secrets: readonly string[]): string {
    let result = text;
    for (const secret of secrets) {
        if (secret !== '') {
            result = result.replaceAll(secret, '[redacted]');
        }
    }
    return result;
}

export const MAX_RETRY_DELAY_MS = 10_000;
export const JSON_TIMEOUT_MS = 20_000;

function retryDelayMs(res: Response, attempt: number): number {
    const raw = res.headers.get('Retry-After');
    if (raw !== null && raw !== '') {
        const seconds = Number(raw);
        if (Number.isFinite(seconds) && seconds >= 0) {
            return Math.min(Math.round(seconds * 1000), MAX_RETRY_DELAY_MS);
        }
    }
    return attempt === 0 ? 500 : 1500;
}

export interface JsonRequest {
    label: string;
    url: string;
    init: RequestInit;
    fetch: FetchImpl;
    sleep: SleepFn;
    secrets: readonly string[];
}

export async function fetchJson(request: JsonRequest): Promise<unknown> {
    let attempt = 0;
    while (true) {
        let res: Response;
        try {
            res = await request.fetch(request.url, {
                ...request.init,
                signal: AbortSignal.timeout(JSON_TIMEOUT_MS),
            });
        } catch (error) {
            throw new Error(
                redactSecrets(
                    `${request.label} request failed: ${error instanceof Error ? error.message : String(error)}`,
                    request.secrets,
                ),
            );
        }
        const body = Buffer.from(await res.arrayBuffer());
        const text = body.toString('utf8');
        if (res.status === 429) {
            if (attempt >= 2) {
                throw new Error(
                    `${request.label} rate-limited (HTTP 429): ${redactSecrets(text.slice(0, 800), request.secrets)}`,
                );
            }
            await request.sleep(retryDelayMs(res, attempt));
            attempt += 1;
            continue;
        }
        if (!res.ok) {
            throw new Error(
                `${request.label} HTTP ${res.status}: ${redactSecrets(text.slice(0, 800), request.secrets)}`,
            );
        }
        try {
            return JSON.parse(text) as unknown;
        } catch {
            throw new Error(
                `${request.label} returned non-JSON (HTTP ${res.status}, content-encoding ${res.headers.get('content-encoding') ?? 'none'}, first bytes ${body.subarray(0, 8).toString('hex')}): ${redactSecrets(text.slice(0, 120), request.secrets)}`,
            );
        }
    }
}
