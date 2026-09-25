import { accessSync, constants, type Stats, statSync } from 'node:fs';
import { delimiter, dirname, join } from 'node:path';
import { chromium } from 'playwright';
import { CONFIG_PATH, LOCAL_MODEL_PROVIDERS, type LocalModelProvider } from './config.ts';
import { visionCutoutUnavailable } from './subject/vision.ts';

const MINIMUM_NODE_VERSION = { major: 22, minor: 19, patch: 0 } as const;

export type DoctorStatus = 'ok' | 'warn' | 'error';

export interface DoctorCheck {
    id: 'node' | 'chromium' | 'config-permissions' | 'cutout' | LocalModelProvider;
    label: string;
    status: DoctorStatus;
    message: string;
}

export interface DoctorReport {
    healthy: boolean;
    checks: DoctorCheck[];
}

export interface DoctorOptions {
    nodeVersion?: string;
    chromiumPath?: string;
    configPath?: string;
    platform?: NodeJS.Platform;
    osRelease?: string;
    lookupCommand?: (name: string) => string | undefined;
}

function nodeVersionCheck(version: string): DoctorCheck {
    const match = /^(\d+)\.(\d+)\.(\d+)/.exec(version);
    if (!match) {
        return {
            id: 'node',
            label: 'Node.js',
            status: 'error',
            message: `Cannot parse Node.js version "${version}".`,
        };
    }

    const [major, minor, patch] = match.slice(1).map(Number) as [number, number, number];
    const meetsMinimum =
        major > MINIMUM_NODE_VERSION.major ||
        (major === MINIMUM_NODE_VERSION.major &&
            (minor > MINIMUM_NODE_VERSION.minor ||
                (minor === MINIMUM_NODE_VERSION.minor && patch >= MINIMUM_NODE_VERSION.patch)));

    return {
        id: 'node',
        label: 'Node.js',
        status: meetsMinimum ? 'ok' : 'error',
        message: meetsMinimum
            ? `${version} meets the minimum 22.19.0.`
            : `${version} is too old. Install Node.js 22.19.0 or newer.`,
    };
}

function chromiumCheck(executablePath: string, platform: NodeJS.Platform): DoctorCheck {
    try {
        const info = statSync(executablePath);
        if (!info.isFile()) {
            throw new Error('the resolved path is not a file');
        }
        accessSync(executablePath, platform === 'win32' ? constants.F_OK : constants.X_OK);
        return {
            id: 'chromium',
            label: 'Chromium',
            status: 'ok',
            message: `Installed at ${executablePath}.`,
        };
    } catch {
        return {
            id: 'chromium',
            label: 'Chromium',
            status: 'error',
            message: `Not available at ${executablePath}. Run npx --yes --package @liustack/beastcover playwright install chromium.`,
        };
    }
}

function configPermissionsCheck(configPath: string, platform: NodeJS.Platform): DoctorCheck {
    let info: Stats;
    try {
        info = statSync(configPath);
    } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
            return {
                id: 'config-permissions',
                label: 'Config permissions',
                status: 'warn',
                message: `${configPath} does not exist. Run beastcover config init when you need it.`,
            };
        }
        return {
            id: 'config-permissions',
            label: 'Config permissions',
            status: 'error',
            message: `Cannot inspect ${configPath}.`,
        };
    }

    if (!info.isFile()) {
        return {
            id: 'config-permissions',
            label: 'Config permissions',
            status: 'error',
            message: `${configPath} is not a regular file.`,
        };
    }

    if (platform === 'win32') {
        return {
            id: 'config-permissions',
            label: 'Config permissions',
            status: 'ok',
            message: `${configPath} exists. Windows manages access through ACLs.`,
        };
    }

    const mode = info.mode & 0o777;
    if (mode !== 0o600) {
        return {
            id: 'config-permissions',
            label: 'Config permissions',
            status: 'error',
            message: `${configPath} has mode ${mode.toString(8)}. Expected 600.`,
        };
    }

    return {
        id: 'config-permissions',
        label: 'Config permissions',
        status: 'ok',
        message: `${configPath} has mode 600.`,
    };
}

export function lookupCommandOnPath(
    name: string,
    envPath = process.env.PATH ?? '',
): string | undefined {
    if (envPath === '') {
        return undefined;
    }

    for (const directory of envPath.split(delimiter)) {
        if (directory === '') {
            continue;
        }
        const candidate = join(directory, name);
        try {
            if (statSync(candidate).isFile()) {
                return candidate;
            }
        } catch {
            // PATH 上可能有不可读目录，跳过即可。
        }
    }

    return undefined;
}

function localModelCliCheck(
    name: LocalModelProvider,
    lookup: (commandName: string) => string | undefined,
): DoctorCheck {
    const found = lookup(name);
    if (found === undefined) {
        return {
            id: name,
            label: name,
            status: 'warn',
            message: `${name} is not installed.`,
        };
    }

    return {
        id: name,
        label: name,
        status: 'ok',
        message: `${name} found at ${found}.`,
    };
}

function cutoutCheck(
    platform: NodeJS.Platform,
    osRelease: string | undefined,
    configPath: string,
    lookup: (commandName: string) => string | undefined,
): DoctorCheck {
    const unavailable = visionCutoutUnavailable({
        platform,
        ...(osRelease === undefined ? {} : { osRelease }),
        binDir: join(dirname(configPath), 'bin'),
        lookupCommand: lookup,
    });
    if (unavailable !== undefined) {
        return {
            id: 'cutout',
            label: 'Subject cutout',
            status: 'warn',
            message: `--subject needs a transparent PNG here: ${unavailable}.`,
        };
    }
    return {
        id: 'cutout',
        label: 'Subject cutout',
        status: 'ok',
        message: '--subject photos are cut out on this machine with macOS Vision.',
    };
}

export function runDoctor(options: DoctorOptions = {}): DoctorReport {
    const platform = options.platform ?? process.platform;
    const lookup = options.lookupCommand ?? lookupCommandOnPath;
    const checks = [
        nodeVersionCheck(options.nodeVersion ?? process.versions.node),
        chromiumCheck(options.chromiumPath ?? chromium.executablePath(), platform),
        configPermissionsCheck(options.configPath ?? CONFIG_PATH, platform),
        cutoutCheck(platform, options.osRelease, options.configPath ?? CONFIG_PATH, lookup),
        ...LOCAL_MODEL_PROVIDERS.map((name) => localModelCliCheck(name, lookup)),
    ];

    return {
        healthy: checks.every((check) => check.status !== 'error'),
        checks,
    };
}

export function renderDoctorReport(report: DoctorReport): string {
    const lines = [`BeastCover doctor: ${report.healthy ? 'healthy' : 'needs attention'}`];
    for (const check of report.checks) {
        lines.push(`[${check.status}] ${check.label}: ${check.message}`);
    }
    return lines.join('\n');
}
