// 下载图库图片前的 SSRF 防护。API 返回的下载地址是外部输入，先解析 DNS、
// 逐个检查地址，再把连接钉在通过检查的那个 IP 上，避免解析结果在检查和
// 连接之间被换掉。
//
// 钉定走 node:https 的 lookup 选项，不引入 npm 的 undici：npm undici 一旦被
// import 就会替换全局 dispatcher，Node 内置 fetch 随后收到剥掉 content-encoding
// 的 gzip 原文，所有 JSON 请求都会坏掉。
import type { LookupAddress, LookupOptions } from 'node:dns';
import { lookup as dnsLookup } from 'node:dns/promises';
import { request as httpRequest } from 'node:http';
import { request as httpsRequest } from 'node:https';
import { isIP } from 'node:net';

export interface PinnedTarget {
    hostname: string;
    address: string;
    family: number;
}

export type DnsLookup = (hostname: string) => Promise<Array<{ address: string; family: number }>>;

export async function defaultDnsLookup(
    hostname: string,
): Promise<Array<{ address: string; family: number }>> {
    return dnsLookup(hostname, { all: true, verbatim: true });
}

const BLOCKED_HOSTNAMES = new Set([
    'localhost',
    'localhost.localdomain',
    'metadata.google.internal',
    'metadata.amazonaws.com',
    'metadata.azure.internal',
]);

export function isBlockedHostname(hostname: string): boolean {
    const normalized = hostname.trim().toLowerCase();
    if (!normalized) {
        return true;
    }
    if (BLOCKED_HOSTNAMES.has(normalized)) {
        return true;
    }
    return normalized.endsWith('.localhost');
}

export function isPrivateIpAddress(ipAddress: string): boolean {
    const normalized = ipAddress.trim().toLowerCase();
    const family = isIP(normalized);
    if (family === 4) {
        return isPrivateIPv4(normalized);
    }
    if (family === 6) {
        return isPrivateIPv6(normalized);
    }
    return true;
}

function blockedMessage(target: string): string {
    return `Blocked private or reserved download target: ${target}. BeastCover does not download from private addresses.`;
}

function stripIpv6Brackets(hostname: string): string {
    if (hostname.startsWith('[') && hostname.endsWith(']')) {
        return hostname.slice(1, -1);
    }
    return hostname;
}

export async function assertSafeRemoteTarget(url: URL, lookup: DnsLookup): Promise<PinnedTarget> {
    if (isBlockedHostname(url.hostname)) {
        throw new Error(blockedMessage(url.hostname));
    }

    const hostname = stripIpv6Brackets(url.hostname);
    const ipFamily = isIP(hostname);
    if (ipFamily > 0) {
        if (isPrivateIpAddress(hostname)) {
            throw new Error(blockedMessage(hostname));
        }
        return { hostname, address: hostname, family: ipFamily };
    }

    let resolved: Array<{ address: string; family: number }>;
    try {
        resolved = await lookup(hostname);
    } catch (error) {
        throw new Error(
            `DNS lookup failed for host ${hostname}: ${error instanceof Error ? error.message : String(error)}`,
        );
    }
    if (resolved.length === 0) {
        throw new Error(`Host ${hostname} did not resolve to any IP address.`);
    }
    const blocked = resolved.find((record) => isPrivateIpAddress(record.address));
    if (blocked) {
        throw new Error(blockedMessage(`${hostname} -> ${blocked.address}`));
    }
    const chosen = resolved[0] as { address: string; family: number };
    return { hostname, address: chosen.address, family: chosen.family };
}

export interface PinnedFetchInit {
    headers?: Record<string, string>;
    // 正文超过这个字节数就断开连接，不等读完再判断。
    maxBytes?: number;
    // 建连和每次等待数据的上限，以及整个请求的总上限。
    timeoutMs?: number;
}

export const DEFAULT_PINNED_TIMEOUT_MS = 30_000;

type LookupCallback = (
    err: NodeJS.ErrnoException | null,
    address: string | LookupAddress[],
    family?: number,
) => void;

// 只允许 GET，不跟随重定向：3xx 会以非 2xx 状态返回给调用方。
export function pinnedFetch(
    url: URL,
    pin: PinnedTarget,
    init: PinnedFetchInit = {},
): Promise<Response> {
    const doRequest = url.protocol === 'http:' ? httpRequest : httpsRequest;
    const timeoutMs = init.timeoutMs ?? DEFAULT_PINNED_TIMEOUT_MS;
    return new Promise((resolve, reject) => {
        let settled = false;
        const fail = (error: Error) => {
            if (settled) {
                return;
            }
            settled = true;
            clearTimeout(deadline);
            req.destroy(error);
            reject(error);
        };
        const deadline = setTimeout(() => {
            fail(new Error(`Download of ${url.host} exceeded ${timeoutMs}ms.`));
        }, timeoutMs);
        const req = doRequest(
            url,
            {
                method: 'GET',
                headers: init.headers,
                servername: url.protocol === 'https:' ? pin.hostname : undefined,
                lookup: (_hostname: string, options: LookupOptions, callback: LookupCallback) => {
                    if (options.all === true) {
                        callback(null, [{ address: pin.address, family: pin.family }]);
                    } else {
                        callback(null, pin.address, pin.family);
                    }
                },
            },
            (res) => {
                const declared = Number(res.headers['content-length']);
                if (
                    init.maxBytes !== undefined &&
                    Number.isFinite(declared) &&
                    declared > init.maxBytes
                ) {
                    fail(
                        new Error(
                            `Stock photo is ${declared} bytes, larger than the ${init.maxBytes} byte limit.`,
                        ),
                    );
                    return;
                }
                const chunks: Buffer[] = [];
                let received = 0;
                res.on('data', (chunk: Buffer) => {
                    received += chunk.byteLength;
                    if (init.maxBytes !== undefined && received > init.maxBytes) {
                        fail(
                            new Error(
                                `Stock photo exceeded the ${init.maxBytes} byte limit while downloading.`,
                            ),
                        );
                        return;
                    }
                    chunks.push(chunk);
                });
                res.on('error', fail);
                res.on('end', () => {
                    if (settled) {
                        return;
                    }
                    settled = true;
                    clearTimeout(deadline);
                    const headers = new Headers();
                    for (const [name, value] of Object.entries(res.headers)) {
                        if (typeof value === 'string') {
                            headers.set(name, value);
                        } else if (Array.isArray(value)) {
                            headers.set(name, value.join(', '));
                        }
                    }
                    resolve(
                        new Response(Buffer.concat(chunks), {
                            status: res.statusCode ?? 0,
                            statusText: res.statusMessage ?? '',
                            headers,
                        }),
                    );
                });
            },
        );
        req.setTimeout(timeoutMs, () => {
            fail(new Error(`Download of ${url.host} stalled for ${timeoutMs}ms.`));
        });
        req.on('error', fail);
        req.end();
    });
}

function ipv4ToNumber(ipAddress: string): number {
    const octets = ipAddress.split('.').map((part) => Number.parseInt(part, 10));
    return (
        (octets[0] as number) * 256 ** 3 +
        (octets[1] as number) * 256 ** 2 +
        (octets[2] as number) * 256 +
        (octets[3] as number)
    );
}

function inRange(value: number, start: string, end: string): boolean {
    return value >= ipv4ToNumber(start) && value <= ipv4ToNumber(end);
}

// 198.18.0.0/15 故意不拦：Clash、Surge、Mihomo 的 fake-ip 模式默认把所有域名解析到
// 这个段，再由代理接管连接。这个段在公网不可路由，也没有云元数据服务。
function isPrivateIPv4(ipAddress: string): boolean {
    const octets = ipAddress.split('.').map((part) => Number.parseInt(part, 10));
    if (
        octets.length !== 4 ||
        octets.some((value) => !Number.isFinite(value) || value < 0 || value > 255)
    ) {
        return true;
    }
    const value = ipv4ToNumber(ipAddress);
    return (
        inRange(value, '0.0.0.0', '0.255.255.255') ||
        inRange(value, '10.0.0.0', '10.255.255.255') ||
        inRange(value, '100.64.0.0', '100.127.255.255') ||
        inRange(value, '127.0.0.0', '127.255.255.255') ||
        inRange(value, '169.254.0.0', '169.254.255.255') ||
        inRange(value, '172.16.0.0', '172.31.255.255') ||
        inRange(value, '192.0.0.0', '192.0.0.255') ||
        inRange(value, '192.168.0.0', '192.168.255.255') ||
        inRange(value, '224.0.0.0', '255.255.255.255')
    );
}

function parseIpv6Groups(groups: string[]): number[] | null {
    if (groups.length !== 8) {
        return null;
    }
    const parsed = groups.map((group) => Number.parseInt(group || '0', 16));
    if (parsed.some((value) => !Number.isFinite(value) || value < 0 || value > 0xffff)) {
        return null;
    }
    return parsed;
}

function expandIpv6(ipAddress: string): number[] | null {
    const value = ipAddress.toLowerCase();
    if (value.includes('::')) {
        const [left, right] = value.split('::');
        const leftGroups = left ? left.split(':').filter(Boolean) : [];
        const rightGroups = right ? right.split(':').filter(Boolean) : [];
        if (leftGroups.length + rightGroups.length > 8) {
            return null;
        }
        const middle = new Array(8 - leftGroups.length - rightGroups.length).fill('0');
        return parseIpv6Groups([...leftGroups, ...middle, ...rightGroups]);
    }
    return parseIpv6Groups(value.split(':'));
}

function ipv6ToBigInt(ipAddress: string): bigint | null {
    const expanded = expandIpv6(ipAddress);
    if (!expanded) {
        return null;
    }
    return expanded.reduce((acc, group) => (acc << 16n) + BigInt(group), 0n);
}

function inIpv6Range(value: bigint, start: string, prefixLength: number): boolean {
    const startValue = ipv6ToBigInt(start);
    if (startValue === null) {
        return false;
    }
    const mask =
        prefixLength === 0 ? 0n : ((1n << BigInt(prefixLength)) - 1n) << BigInt(128 - prefixLength);
    return (value & mask) === (startValue & mask);
}

function ipv4FromLow32(value: bigint): string {
    const low = Number(value & 0xffffffffn);
    return [low >>> 24, (low >>> 16) & 0xff, (low >>> 8) & 0xff, low & 0xff].join('.');
}

function embeddedIpv4(value: bigint): string | null {
    if (inIpv6Range(value, '::', 96) || inIpv6Range(value, '64:ff9b::', 96)) {
        return ipv4FromLow32(value);
    }
    if (inIpv6Range(value, '2002::', 16)) {
        return ipv4FromLow32(value >> 80n);
    }
    return null;
}

function hasMappedV4Prefix(groups: number[]): boolean {
    return groups.slice(0, 5).every((group) => group === 0) && groups[5] === 0xffff;
}

function extractMappedIpv4(ipAddress: string): string | null {
    const lower = ipAddress.toLowerCase();
    const marker = '::ffff:';
    if (!lower.startsWith(marker)) {
        return null;
    }
    const candidate = lower.slice(marker.length);
    return isIP(candidate) === 4 ? candidate : null;
}

function isPrivateIPv6(ipAddress: string): boolean {
    const groups = expandIpv6(ipAddress);
    if (groups !== null && hasMappedV4Prefix(groups)) {
        const g6 = groups[6] as number;
        const g7 = groups[7] as number;
        const mapped = [g6 >> 8, g6 & 0xff, g7 >> 8, g7 & 0xff].join('.');
        return isPrivateIPv4(mapped);
    }
    const normalized = ipAddress.split('%')[0] as string;
    const mapped = extractMappedIpv4(normalized);
    if (mapped && isPrivateIPv4(mapped)) {
        return true;
    }
    const value = ipv6ToBigInt(normalized);
    if (value === null) {
        return true;
    }
    // ::/96 是废弃的 IPv4 兼容地址，2002::/16 是 6to4，64:ff9b::/96 是 NAT64，
    // 三种都能把一个 IPv4 藏进 IPv6 里。
    const embedded = embeddedIpv4(value);
    if (embedded !== null && isPrivateIPv4(embedded)) {
        return true;
    }
    return (
        inIpv6Range(value, '::', 96) ||
        inIpv6Range(value, '2002::', 16) ||
        inIpv6Range(value, '64:ff9b::', 96) ||
        inIpv6Range(value, '::1', 128) ||
        inIpv6Range(value, 'fc00::', 7) ||
        inIpv6Range(value, 'fe80::', 10) ||
        inIpv6Range(value, 'ff00::', 8) ||
        inIpv6Range(value, '2001:db8::', 32)
    );
}
