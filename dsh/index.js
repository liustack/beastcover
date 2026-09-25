import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { extname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const CLI_PATH = fileURLToPath(new URL('../dist/main.js', import.meta.url))
const CLI_TIMEOUT_MS = 120_000
// 与 src/platforms/index.ts 的 PLATFORM_NAMES 保持一致，dsh/index.test.js 会比对。
const PRESETS = [
  'youtube',
  'bilibili',
  'wechat',
  'x',
  'xiaohongshu',
  'instagram',
  'instagram-reels',
  'douyin',
  'tiktok',
  'og',
  'github',
]

export const name = 'beastcover'
export const inject = ['tools']

function run(command, args, signal) {
  return new Promise((resolveRun, rejectRun) => {
    const child = spawn(command, args, {
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    })
    let stdout = ''
    let stderr = ''
    let settled = false

    const finish = (callback) => {
      if (settled) return
      settled = true
      clearTimeout(timeout)
      signal?.removeEventListener('abort', abort)
      callback()
    }
    const abort = () => {
      child.kill()
      finish(() => rejectRun(new Error('BeastCover generation was cancelled.')))
    }
    const timeout = setTimeout(() => {
      child.kill()
      finish(() => rejectRun(new Error(`BeastCover generation timed out after ${CLI_TIMEOUT_MS}ms.`)))
    }, CLI_TIMEOUT_MS)

    child.stdout.on('data', (chunk) => {
      stdout += chunk.toString()
    })
    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString()
    })
    child.on('error', (error) => finish(() => rejectRun(error)))
    child.on('close', (code) => finish(() => resolveRun({ code, stdout, stderr })))

    if (signal?.aborted) {
      abort()
    } else {
      signal?.addEventListener('abort', abort, { once: true })
    }
  })
}

export function createGenerateTool(toolName = 'beastcover_generate_image') {
  return {
    name: toolName,
    description:
      'Render a headline into a local PNG cover with BeastCover, sized for one platform. Use for text-led covers whose wording may change. The render source runs locally and sends no content over the network.',
    parameters: {
      type: 'object',
      properties: {
        text: {
          type: 'string',
          description: 'The cover headline',
        },
        output: {
          type: 'string',
          description: 'Optional PNG output path, relative to the current directory or absolute',
        },
        preset: {
          type: 'string',
          enum: PRESETS,
          description: 'Platform the cover is for. Sets its production pixel size',
        },
      },
      required: ['text'],
    },
    output: {
      schema: {
        type: 'object',
        properties: {
          pngPath: { type: 'string' },
          source: { type: 'string', const: 'render' },
          privacy: { type: 'string', const: 'local' },
        },
        required: ['pngPath', 'source', 'privacy'],
      },
      render: (_args, value) => [{ type: 'text', text: `Created ${value.pngPath}. Render stayed on this machine.` }],
    },
    timeoutMs: CLI_TIMEOUT_MS + 10_000,
    isConcurrencySafe: () => true,
    presentCall: (args) => ({
      card: 'generic',
      title: toolName,
      kind: 'write',
      rawInput: args,
      ...(typeof args?.output === 'string' ? { locations: [{ path: args.output }] } : {}),
    }),
    async execute(args, exec = {}) {
      if (typeof args?.text !== 'string' || args.text.trim() === '') {
        throw new Error(`${toolName} needs a non-empty string "text".`)
      }
      if (args.output !== undefined && (typeof args.output !== 'string' || args.output.trim() === '')) {
        throw new Error(`${toolName} output must be a non-empty PNG path.`)
      }
      if (args.preset !== undefined && !PRESETS.includes(args.preset)) {
        throw new Error(`${toolName} preset must be one of ${PRESETS.join(', ')}.`)
      }

      const outputPath = resolve(args.output ?? 'beastcover.png')
      if (extname(outputPath).toLowerCase() !== '.png') {
        throw new Error(`${toolName} output must use the .png extension.`)
      }

      const cliArgs = [CLI_PATH, 'gen', args.text, '--source', 'render', '--output', outputPath]
      if (args.preset) cliArgs.push('--preset', args.preset)
      const result = await run(process.execPath, cliArgs, exec.signal)
      if (result.code !== 0) {
        throw new Error(
          `beastcover failed with exit ${result.code}: ${(result.stderr || result.stdout).trim().slice(0, 500)}`,
        )
      }
      if (!existsSync(outputPath)) {
        throw new Error(`beastcover exited successfully but did not create ${outputPath}.`)
      }

      return { pngPath: outputPath, source: 'render', privacy: 'local' }
    },
  }
}

export function apply(ctx, config = {}) {
  ctx.tools.register(createGenerateTool(config.toolName))
}
