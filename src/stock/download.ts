import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { userAgent } from './http.ts';
import { assertSafeRemoteTarget, type DnsLookup, defaultDnsLookup, pinnedFetch } from './ssrf.ts';
import type { StockPhoto } from './types.ts';

export const MAX_DOWNLOAD_BYTES = 40 * 1024 * 1024;

const IMAGE_EXTENSIONS: Record<string, string> = {
    'image/jpeg': '.jpg',
    'image/png': '.png',
    'image/webp': '.webp',
};

export type PinnedFetch = typeof pinnedFetch;

export interface DownloadContext {
    lookup?: DnsLookup;
    pinnedFetch?: PinnedFetch;
    timeoutMs?: number;
}

function assertSafeDownloadUrl(value: string): URL {
    let url: URL;
    try {
        url = new URL(value);
    } catch {
        throw new Error(`Stock photo download URL is not a valid URL: ${value}`);
    }
    if (url.protocol !== 'https:') {
        throw new Error(`Stock photo download URL must use https: ${value}`);
    }
    return url;
}

export function extensionForContentType(contentType: string | null): string {
    const media = (contentType ?? '').split(';')[0]?.trim().toLowerCase() ?? '';
    const extension = IMAGE_EXTENSIONS[media];
    if (extension === undefined) {
        throw new Error(
            `Stock photo response is "${media || 'unknown'}", expected image/jpeg, image/png, or image/webp.`,
        );
    }
    return extension;
}

export interface DownloadedPhoto {
    bytes: Buffer;
    extension: string;
}

export async function downloadPhotoBytes(
    downloadUrl: string,
    context: DownloadContext = {},
): Promise<DownloadedPhoto> {
    const url = assertSafeDownloadUrl(downloadUrl);
    const pin = await assertSafeRemoteTarget(url, context.lookup ?? defaultDnsLookup);
    const doFetch = context.pinnedFetch ?? pinnedFetch;
    const response = await doFetch(url, pin, {
        headers: { 'Accept-Encoding': 'identity', 'User-Agent': userAgent() },
        maxBytes: MAX_DOWNLOAD_BYTES,
        ...(context.timeoutMs !== undefined ? { timeoutMs: context.timeoutMs } : {}),
    });
    if (!response.ok) {
        throw new Error(`Stock photo download failed with HTTP ${response.status}.`);
    }
    const extension = extensionForContentType(response.headers.get('content-type'));
    const bytes = Buffer.from(await response.arrayBuffer());
    if (bytes.byteLength === 0) {
        throw new Error('Stock photo download returned an empty body.');
    }
    if (bytes.byteLength > MAX_DOWNLOAD_BYTES) {
        throw new Error(
            `Stock photo is ${bytes.byteLength} bytes, larger than the ${MAX_DOWNLOAD_BYTES} byte limit.`,
        );
    }
    return { bytes, extension };
}

export interface StockSidecar {
    ref: string;
    provider: StockPhoto['provider'];
    id: string;
    creator: string;
    license: string;
    attribution: string;
    pageUrl: string;
    downloadUrl: string;
    width: number;
    height: number;
    fetchedAt: string;
}

export function sidecarPath(imagePath: string): string {
    return `${imagePath}.json`;
}

export function writePhotoFiles(input: {
    photo: StockPhoto;
    downloaded: DownloadedPhoto;
    basePath: string;
    now: Date;
}): { imagePath: string; sidecar: string } {
    const imagePath = resolve(`${input.basePath}${input.downloaded.extension}`);
    mkdirSync(dirname(imagePath), { recursive: true });
    writeFileSync(imagePath, input.downloaded.bytes);
    const sidecar: StockSidecar = {
        ref: input.photo.ref,
        provider: input.photo.provider,
        id: input.photo.id,
        creator: input.photo.creator,
        license: input.photo.license,
        attribution: input.photo.attribution,
        pageUrl: input.photo.pageUrl,
        downloadUrl: input.photo.downloadUrl,
        width: input.photo.width,
        height: input.photo.height,
        fetchedAt: input.now.toISOString(),
    };
    const sidecarFile = sidecarPath(imagePath);
    writeFileSync(sidecarFile, `${JSON.stringify(sidecar, null, 2)}\n`, 'utf8');
    return { imagePath, sidecar: sidecarFile };
}
