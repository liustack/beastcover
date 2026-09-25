# Project Overview for AI Agents

## Goal

Provide the `beastcover` CLI and its agent distribution surfaces. BeastCover makes covers only: thumbnails and headers for articles, videos, and posts on WeChat, X, YouTube, Bilibili, Xiaohongshu, Instagram, Douyin, and TikTok.

The name plays on Beauty and the Beast: a cover needs that kind of contrast and impact, because people see the title and the cover first and skip anything that does not grab them. The product contract is covers that get the click, with every platform version of one piece in the same style and palette.

## Scope

Phase one currently ships these working surfaces:

- `render` turns the built-in HTML template and a headline into a local PNG cover
- `stock search` and `stock fetch` find and download free photos from Openverse (cc0 and pdm only, no key) or Pexels (needs `stock.pexels.apiKey`)
- `gen --source stock --photo <ref-or-path>` composes a photo cover: the photo is inlined as a data URI, the project palette tints it, and the headline sits on a scrim
- `local-model` calls the user's own Codex, Grok, or Claude CLI to paint a cover
- `styles` lists the four self-contained catalog styles
- `new` and `project` manage a per-project `.beastcover/` workspace

Do not add:

- server accounts, billing, credits, or cloud image proxying
- a dependency on briefpress or webpress
- a global prompt assembler that combines style, palette, and discipline fragments
- silent source substitution when a requested source is unavailable
- defaults that hide malformed internal state
- article illustrations or styles that only work as illustrations (thin lines, watercolor, low-contrast soft color, single-line sketch)

The four-style catalog is in `src/styles/`. Each style prompt is copied unchanged from the artwork source. Palette slots and the composition note are metadata on that record, not extra prompt layers. Removed style names fail with a message that says they were removed. Recenter and contact-sheet tools remain outside this pass. local-model crop and resize are part of generation, not those tools.

## Technical Approach

- TypeScript, Commander, Vite library build, Vitest, and Biome. Node.js 22.19 or newer is required.
- The CLI bundle is `dist/main.js`. Runtime dependencies and Node built-ins remain external.
- Layered settings resolve in this order: CLI flags, `~/.beastcover/config.json`, built-in defaults.
- Config writes use mode 0600. Invalid JSON and schema violations fail at the config boundary.
- The render engine uses Playwright Chromium directly. It disables JavaScript and blocks HTTP and HTTPS requests, then captures the requested viewport as PNG. Photo covers therefore inline the photo as a JPEG data URI after `sharp` has cropped it to the canvas pixel size.
- Stock providers never fall back to each other. A missing Pexels key is an error, not a switch to Openverse. Openverse results are filtered to cc0 and pdm at search time and re-checked at download time.
- Stock downloads go through `src/stock/ssrf.ts`: blocked hostnames, private and reserved IP ranges, DNS resolved up front, and the socket pinned to the address that passed. `fetch` and `sleep` are injected so tests never touch the network.
- Size presets are named after platforms and hold production pixels. Old ratio names fail with a message naming the replacement. `scale` controls Chromium device scale and therefore output pixel density.
- Platforms belong to three families (landscape, portrait, ultrawide). Each family has one master size, a text area, and a focus area, all in master coordinates, and each platform has a crop box in that master plus the rectangles its app UI covers. `src/platforms/index.test.ts` proves the text and focus areas sit inside every member crop and outside every covered rectangle. Change the geometry only together with that test.
- `gen` renders one master per family at 2x or more, then crops and scales every requested platform from it with `sharp`. The renderer finds the largest font that keeps the headline inside the text area, keeps Latin words whole, and keeps punctuated clauses together when that costs under 30% of the size. Headline size is never set by fixed CSS ratios.
- local-model runs the model once per family, saves the raw image in `.beastcover/cache/`, and crops each platform from it.
- `local-model` asks the backend for the native generate size, then crops and resizes in-process with `sharp`. It does not shell out to sips or ImageMagick.
- Each style record is self-contained. Copy its full prompt unchanged and append one subject description.
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
├── platforms/
│   ├── index.ts            # Platform presets, families, crops, safe areas, retired ratio names
│   └── index.test.ts
├── compose/
│   ├── index.ts            # Family masters, crops, custom canvas, thumbnail check
│   ├── guides.ts           # --guides overlay for text, focus, and covered areas
│   └── index.test.ts
├── local-model/
│   ├── index.ts            # Prompt envelope, argv, provider selection, spawn
│   ├── prompt.ts           # Style prompt plus 主体, conditional palette replace
│   ├── argv.ts             # Codex/Grok/Claude argv and named --ref files
│   ├── provider.ts         # Backend selection with no silent fallback
│   ├── canvas.ts           # Generate plan per family, centred crop box per platform
│   ├── finish.ts           # sharp crop then resize
│   └── run.ts              # rm, spawn, captured stdio, on-disk image verification
├── render/
│   ├── index.ts            # Playwright renderer: fit the headline, screenshot a page
│   ├── layout.ts           # Cover layouts, headline markup, measuring probes
│   ├── index.test.ts
│   ├── photo-cover.ts      # Photo cover template and sharp preprocessing
│   ├── photo-cover.test.ts
│   ├── template.ts         # Built-in text-led cover template
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
│   ├── schema.ts           # Style, palette slot, and catalog metadata types
│   ├── catalog.ts          # Four self-contained cover styles
│   ├── records/            # One file per style, prompt copied verbatim
│   ├── loader.ts           # Exact-name style lookup with no fallback, removed-style message
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
beastcover new demo --style risograph_editorial
beastcover project
beastcover gen "One headline, every platform" --source render --preset all
beastcover stock search "harbour dawn" --orientation landscape
beastcover gen "The tide comes back" --source stock --photo openverse:<id> --preset wechat,x --guides
beastcover gen "A figure on a shore" --source local-model --via codex --preset xiaohongshu
beastcover config init
beastcover config set render.preset x
beastcover config set stock.pexels.apiKey <key>
beastcover config show
beastcover doctor
```

## Verification

- Run `pnpm check` for type checking, Biome, and all Vitest suites.
- Run `pnpm build` and confirm it produces `dist/main.js`.
- Run the built CLI against the real local Chromium and inspect the generated PNG dimensions and appearance.
- UI-facing template changes require a newly rendered PNG and visual inspection on every platform preset.
