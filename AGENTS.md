# Project Overview for AI Agents

## Goal

Provide the `beastcover` CLI and its agent distribution surfaces. BeastCover creates image sets for articles, presentations, products, and campaigns that remain inside one coherent visual system.

The product contract is article-level consistency. A cover, body illustration, social crop, and transition graphic belong to the same visual family instead of looking like unrelated one-off generations.

## Scope

Phase one currently ships these working surfaces:

- `render` turns the built-in HTML template and user text into a local PNG
- `stock search` and `stock fetch` find and download free photos from Openverse (cc0 and pdm only, no key) or Pexels (needs `stock.pexels.apiKey`)
- `gen --source stock --photo <ref-or-path>` composes a photo cover: the photo is inlined as a data URI, the project palette tints it, and the headline sits on a scrim
- `local-model` calls the user's own Codex, Grok, or Claude CLI to generate an image
- `styles` lists the ten self-contained catalog styles
- `new` and `project` manage a per-project `.beastcover/` workspace

Do not add:

- server accounts, billing, credits, or cloud image proxying
- a dependency on briefpress or webpress
- a global prompt assembler that combines style, palette, and discipline fragments
- silent source substitution when a requested source is unavailable
- defaults that hide malformed internal state

The ten-style catalog is in `src/styles/`. Each style prompt is copied unchanged from the artwork source. Palette slots and canvas strategy are metadata on that record, not extra prompt layers. Recenter and contact-sheet tools remain outside this pass. local-model crop and resize are part of generation, not those tools.

## Technical Approach

- TypeScript, Commander, Vite library build, Vitest, and Biome. Node.js 22.19 or newer is required.
- The CLI bundle is `dist/main.js`. Runtime dependencies and Node built-ins remain external.
- Layered settings resolve in this order: CLI flags, `~/.beastcover/config.json`, built-in defaults.
- Config writes use mode 0600. Invalid JSON and schema violations fail at the config boundary.
- The render engine uses Playwright Chromium directly. It disables JavaScript and blocks HTTP and HTTPS requests, then captures the requested viewport as PNG. Photo covers therefore inline the photo as a JPEG data URI after `sharp` has cropped it to the canvas pixel size.
- Stock providers never fall back to each other. A missing Pexels key is an error, not a switch to Openverse. Openverse results are filtered to cc0 and pdm at search time and re-checked at download time.
- Stock downloads go through `src/stock/ssrf.ts`: blocked hostnames, private and reserved IP ranges, DNS resolved up front, and the socket pinned to the address that passed. `fetch` and `sleep` are injected so tests never touch the network.
- Size presets are production pixels. `scale` controls Chromium device scale and therefore output pixel density.
- `local-model` asks the backend for the native generate size, then crops and resizes in-process with `sharp`. It does not shell out to sips or ImageMagick.
- Each style record is self-contained. Copy its full prompt unchanged. Append one subject description, or fill a declared subject slot in place instead of appending.
- A project workspace lives at `.beastcover/` inside the user project. Discovery walks up from the current directory. Missing workspaces are reported, never created silently.
- Workspace ignore rules live only in `src/workspace/ignore.ts`. The CLI writes `.beastcover/.gitignore` (`/out/`, `/cache/`, `/refs/`) and never touches the user's `.gitignore` or `.git/info/exclude`. `project.json` and `history.jsonl` stay commitable.
- Tests live next to their modules as `*.test.ts` or `*.test.js`.

## Code Organization

```text
src/
├── main.ts                 # Commander entry and command assembly
├── config.ts               # Layered config, typed writes, private file mode, redacted display
├── config.test.ts
├── doctor.ts               # Offline Node, Chromium, config permission, and local CLI checks
├── doctor.test.ts
├── dimensions.ts           # Four production size presets
├── dimensions.test.ts
├── local-model/
│   ├── index.ts            # Prompt envelope, argv, provider selection, spawn
│   ├── prompt.ts           # Style prompt plus 主体, conditional palette replace
│   ├── argv.ts             # Codex/Grok/Claude argv and named --ref files
│   ├── provider.ts         # Backend selection with no silent fallback
│   ├── canvas.ts           # Native generate size, crop box, production size
│   ├── finish.ts           # sharp crop then resize
│   └── run.ts              # rm, spawn, captured stdio, on-disk image verification
├── render/
│   ├── index.ts            # Playwright HTML to PNG engine
│   ├── index.test.ts
│   ├── photo-cover.ts      # Photo cover template and sharp preprocessing
│   ├── photo-cover.test.ts
│   ├── template.ts         # Built-in text-led visual template
│   └── template.test.ts
├── stock/
│   ├── index.ts            # Provider selection, search, fetch, file stems
│   ├── types.ts            # StockHit, StockPhoto, providers, orientations
│   ├── ref.ts              # pexels:<id> / openverse:<id> parsing
│   ├── http.ts             # Injected fetch, 429 backoff, secret redaction
│   ├── openverse.ts        # Anonymous search, optional OAuth token, cc0/pdm gate
│   ├── pexels.ts           # Keyed search and photo detail
│   ├── download.ts         # https-only download, content-type gate, sidecar
│   └── ssrf.ts             # Hostname and IP checks, DNS pin
├── styles/
│   ├── schema.ts           # Style, palette slot, canvas, and catalog metadata types
│   ├── catalog.ts          # Ten self-contained styles
│   ├── records/            # One file per style, prompt copied verbatim
│   ├── loader.ts           # Exact-name style lookup with no fallback
│   ├── loader.test.ts
│   └── catalog.test.ts
└── workspace/
    ├── ignore.ts           # .beastcover/.gitignore policy
    ├── ignore.test.ts
    ├── index.ts            # Discover, create, project.json, history.jsonl
    └── index.test.ts

skills/beastcover/SKILL.md      # Agent skill and routing contract
dsh/index.js                # DeepSeek Harness plugin backed by the bundled CLI
cordis.patch.yml            # DSH bundle mount
```

## CLI Usage

```bash
beastcover styles
beastcover new demo --style memory_color_blocks
beastcover project
beastcover gen "One visual family across the whole story" --source render --preset 16:9
beastcover stock search "harbour dawn" --orientation landscape
beastcover gen "The tide comes back" --source stock --photo openverse:<id> --preset 16:9
beastcover gen "A figure on a shore" --source local-model --via codex --preset 3:2
beastcover config init
beastcover config set render.preset 3:2
beastcover config set stock.pexels.apiKey <key>
beastcover config show
beastcover doctor
```

## Verification

- Run `pnpm check` for type checking, Biome, and all Vitest suites.
- Run `pnpm build` and confirm it produces `dist/main.js`.
- Run the built CLI against the real local Chromium and inspect the generated PNG dimensions and appearance.
- UI-facing template changes require a newly rendered PNG and visual inspection.
