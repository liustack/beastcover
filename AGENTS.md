# Project Overview for AI Agents

## Goal

Provide the `beastcover` CLI and its agent distribution surfaces. BeastCover makes covers only: thumbnails and headers for articles, videos, and posts on WeChat, X, YouTube, Bilibili, Xiaohongshu, Instagram, Douyin, and TikTok, plus Open Graph link previews and GitHub social previews.

The name plays on Beauty and the Beast: a cover needs that kind of contrast and impact, because people see the title and the cover first and skip anything that does not grab them. The product contract is covers that get the click, with every platform version of one piece in the same style and palette.

## Scope

Phase one currently ships these working surfaces:

- `render` turns the built-in HTML template and a headline into a local PNG cover
- `stock search` and `stock fetch` find and download free photos from Openverse (cc0 and pdm only, no key) or Pexels (needs `stock.pexels.apiKey`)
- `gen --source stock --photo <ref-or-path>` composes a photo cover: the photo is inlined as a data URI, the project palette tints it, and the headline sits on a scrim
- `gen --source render --template text|poster|number|compare` picks the text cover: a calm headline, a loud full-bleed poster with an optional `--tag`, a huge `--number` beside a short line, or a `--before`/`--after` split with an arrow
- `gen --subject <path>` puts a person or object on a render or stock cover: a transparent PNG as is, or a photo cut out on macOS 14+ with Vision
- `gen --source stock` frames the photo around its subject (Vision faces and saliency on macOS, sharp attention elsewhere), and takes `--look natural|mono|duotone|punch` and `--fit cover|extend`
- `agent` calls the user's own Codex or agy CLI to paint a cover, and `--remix` redraws one image or puts the person from one image into the scene of another
- `gen --source model` paints the same styles through the user's own image API key: GPT Image (`openai`) or Nano Banana (`gemini`), keys in `model.<provider>.apiKey`. No refs or remix yet
- The default path is completely free (free stock photos plus local HTML rendering). agent and model are opt-ins the user already pays for elsewhere
- `styles` lists the four self-contained catalog styles
- No workspace and no project state: the tool finishes and leaves. `--style <name>` picks a catalog style per run (fallback style otherwise), and the removed `new`/`project` commands fail pointing at `gen`

Do not add:

- server accounts, billing, credits, or cloud image proxying
- a dependency on briefpress or webpress
- a global prompt assembler that combines style, palette, and discipline fragments
- silent source substitution when a requested source is unavailable
- defaults that hide malformed internal state
- article illustrations or styles that only work as illustrations (thin lines, watercolor, low-contrast soft color, single-line sketch)
- a bundled cutout model (BiRefNet, RMBG, or any ONNX runtime), or background removal through a generative model that redraws the face

The four-style catalog is in `src/styles/`. Each style prompt is copied unchanged from the artwork source. Palette slots and the composition note are metadata on that record, not extra prompt layers. Removed style names fail with a message that says they were removed. Recenter and contact-sheet tools remain outside this pass. agent crop and resize are part of generation, not those tools.

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
- agent and model run once per family, stage the raw image in the system temp dir (`$TMPDIR/beastcover/cache/`), and crop each platform from it.
- Subject cutout lives in `src/subject/`. A PNG with at least 2% transparent pixels is used as is. Otherwise the Swift source in `vision.ts` is compiled once into `~/.beastcover/bin/vision-tool-<hash>` and run on the image, and the result is cached in `$TMPDIR/beastcover/cache/` by image hash. The compiled tool prefers `~/.beastcover/bin/` and falls back to the temp dir with a printed note when a sandbox (codex workspace-write) blocks home writes; the Swift source lives in `skills/beastcover/scripts/vision-tool.swift` and is inlined at build time via vite `?raw`. Non-macOS or macOS before 14 fails with a request for a transparent PNG. The person sits in its own subject area, above the headline, and the subject area never overlaps the text area (`src/render/layout.test.ts`).
- Templates live in `src/render/` (`template.ts`, `poster.ts`, `number.ts`, `compare.ts`, `photo-cover.ts`) and are assembled into a `CoverTemplate` by `src/compose/templates.ts`. A template may change the layout (`layoutFor`) and may fit a second big text (`measureAccentHtml` into `accentArea`, the number figure). Options that belong to another template fail instead of being ignored.
- Photo framing lives in `src/subject/focus.ts` (where the subject is) and `src/render/photo-cover.ts` (`placeWindow`, `photoFocusTarget`, `photoTextLayout`). The crop window keeps the whole subject box when it fits and moves its centre toward a target clear of the headline. When the subject cannot fit a family crop, `gen` suggests `--fit extend` instead of switching by itself.
- `--remix` images go first in the model reference list, the instruction joins the subject line, and `src/agent/remix.ts` refuses images whose stock sidecar is not openverse cc0 or pdm.
- Stock downloads are measured with sharp. The sidecar keeps the served size and, when different, the listed size. `gen` warns when a photo is stretched more than 1.5x on a platform.
- `agent` asks the backend for the native generate size, then crops and resizes in-process with `sharp`. It does not shell out to sips or ImageMagick.
- `model` reuses the agent generate plans and crop pipeline: one API call per family, the returned image is normalized to the plan size with `sharp`, then cropped per platform. Providers never fall back to each other, a missing key is an error naming the config key, keys go only into request headers and never into error messages, and `fetch` is injected so tests never touch the network. Model ids live in `MODEL_DEFAULTS` and `model.<provider>.model` overrides them.
- Each style record is self-contained. Copy its full prompt unchanged and append one subject description.
- Intermediates (downloaded stock photos with their license sidecars, model originals, cutout cache) live in `$TMPDIR/beastcover/`: sandboxed agents (codex workspace-write) can always write there, the project directory stays clean, and printed paths tell the agent what to copy if anything is worth keeping. Verified by probing codex and Claude Code sandboxes on 2026-09-27: home is not writable under the codex sandbox, cwd and the temp dir are writable under both.
- The CLI never touches the user's git: no `.gitignore` writes, no `.git/info/exclude` writes, no files the user is nudged to commit (user decision, 2026-09-27).
- Tests live next to their modules as `*.test.ts` or `*.test.js`.

## Code Organization

```text
src/
├── main.ts                 # Commander entry and command assembly
├── config.ts               # Layered config, typed writes, private file mode, redacted display
├── config.test.ts
├── doctor.ts               # Offline Node, Chromium, config permission, cutout, and local CLI checks
├── doctor.test.ts
├── platforms/
│   ├── index.ts            # Platform presets, families, crops, safe areas, retired ratio names
│   └── index.test.ts
├── compose/
│   ├── index.ts            # Family masters, crops, custom canvas, thumbnail check
│   ├── templates.ts        # --template name and options to a CoverTemplate
│   ├── guides.ts           # --guides overlay for text, focus, subject, figure, and covered areas
│   └── index.test.ts
├── subject/
│   ├── index.ts            # Transparent PNG or cutout, cache by image hash, trim
│   ├── vision.ts           # macOS Vision tool: cutout and focus modes, one-time build, run
│   ├── focus.ts            # Photo subject: Vision faces or saliency, else sharp attention
│   └── index.test.ts
├── agent/
│   ├── index.ts            # Prompt envelope, argv, provider selection, spawn
│   ├── prompt.ts           # Style prompt plus 主体, conditional palette replace
│   ├── argv.ts             # codex and agy argv and named --ref files
│   ├── provider.ts         # Backend selection with no silent fallback
│   ├── canvas.ts           # Generate plan per family, centred crop box per platform
│   ├── remix.ts            # --remix mode and the own-or-cc0/pdm license gate
│   ├── finish.ts           # sharp crop then resize
│   └── run.ts              # rm, spawn, captured stdio, on-disk image verification
├── model/
│   ├── index.ts            # Re-exports
│   ├── provider.ts         # Key-based provider selection with no silent fallback
│   ├── prompt.ts           # Style prompt plus 主体 plus the family composition note
│   ├── openai.ts           # GPT Image generations call, key only in the header
│   ├── gemini.ts           # Nano Banana generateContent call, aspect ratio config
│   └── run.ts              # One call per family, normalize to plan size, crop per platform
├── render/
│   ├── index.ts            # Playwright renderer: fit the headline, screenshot a page
│   ├── layout.ts           # Cover layouts, subject split, headline markup, measuring probes
│   ├── layout.test.ts
│   ├── index.test.ts
│   ├── poster.ts           # Poster template: full-bleed colour, dot texture, tag
│   ├── number.ts           # Number template: fitted figure beside a short line
│   ├── compare.ts          # Compare template: split panels, seam arrow, labels
│   ├── templates.test.ts
│   ├── photo-cover.ts      # Photo cover template, subject framing, looks, extend fit
│   ├── photo-framing.test.ts
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
├── paths.ts                # $TMPDIR/beastcover staging areas for refs and cache
└── raw.d.ts                # vite ?raw module declaration for the Swift source

examples/                   # Real covers with their commands, also the visual regression set
scripts/examples.mjs        # pnpm examples: regenerate the free-path examples
skills/beastcover/SKILL.md      # Agent skill and routing contract
dsh/index.js                # DeepSeek Harness plugin backed by the bundled CLI
cordis.patch.yml            # DSH bundle mount
```

## CLI Usage

```bash
beastcover styles
beastcover gen "One headline, every platform" --preset all
beastcover gen "封面没人点" --template poster --tag "新手必看" --style luminous_impasto
beastcover stock search "harbour dawn" --orientation landscape
beastcover gen "The tide comes back" --source stock --photo openverse:<id> --preset wechat,x --guides
beastcover gen "别再乱剪了" --source render --subject me.jpg --preset youtube,xiaohongshu
beastcover gen "封面没人点" --source render --template poster --tag "新手必看" --preset all
beastcover gen "个习惯多出两小时" --source render --template number --number 3 --preset all
beastcover gen "A figure on a shore" --source agent --via codex --preset xiaohongshu
beastcover gen "A figure on a shore" --source model --via gemini --preset xiaohongshu
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
- After template or layout changes, run `pnpm examples` and compare the regenerated covers in `examples/` against git by eye. Looks cannot be asserted in tests; this folder is the baseline. The agent examples are repainted by hand.
