# Project Overview for AI Agents

## Goal

Provide the `beastcover` CLI and its agent distribution surfaces. BeastCover makes covers only: thumbnails and headers for articles, videos, and posts on WeChat, X, YouTube, Bilibili, Xiaohongshu, Instagram, Douyin, and TikTok, plus Open Graph link previews and GitHub social previews.

The name plays on Beauty and the Beast: a cover needs that kind of contrast and impact, because people see the title and the cover first and skip anything that does not grab them. The product contract is covers that get the click, with every platform version of one piece in the same style and palette.

A cover is the promise of the content, not its decoration: it wins on an idea (a conflict, a before and after, the stakes, a surprising result), not on putting the title on a wall. Every platform has several cover types that keep winning, so the product is a set of cover types, and every cover is checked after rendering before it counts as done.

## Scope

Phase one currently ships these working surfaces:

- `gen --template <type>` renders one of ten cover types locally: `big-type`, `number`, `face-text`, `face-stakes`, `versus`, `before-after`, `scene-title`, `callout`, `collage`, `mood`. Without `--template` the type is picked from the inputs (person, photo count). Retired names (`text`, `poster`, `compare`) and flags (`--before`, `--after`, `--callout`) fail pointing at the new spelling
- `--photo` (repeatable) takes stock refs or local paths, `--subject` a person (transparent PNG, or a photo cut out on macOS 14+ with Vision), `--scheme` one of six colour schemes, `--tag`, `--number`, `--labels`, `--look`, `--fit` per type. A `*keyword*` in the headline gets the accent treatment
- `--scene "<description>"` paints the picture for `scene-title`, `mood`, and `face-stakes` when there is no photo: the user's image model key first, then their codex or agy CLI, else a colour gradient with a printed note. `--via` names one painter and nothing else is tried
- Every render is checked after rendering (QC): failures print in red and the files are still written, a template's other placement is tried when the first fails, and a feed preview sheet is saved and printed
- `stock search` and `stock fetch` find and download free photos from Openverse (cc0 and pdm only, no key) or Pexels (needs `stock.pexels.apiKey`)
- `agent` calls the user's own Codex or agy CLI to paint a cover, and `--remix` redraws one image or puts the person from one image into the scene of another
- `gen --source model` paints the same styles through the user's own image API key: GPT Image (`openai`) or Nano Banana (`gemini`), keys in `model.<provider>.apiKey`. No refs or remix yet
- The default path is completely free (free stock photos plus local HTML rendering). agent and model are opt-ins the user already pays for elsewhere
- `styles` lists the four self-contained catalog styles, used only by `agent` and `model`. Render and stock covers take `--scheme`, and `--style` with them fails saying so
- No workspace and no project state: the tool finishes and leaves. The removed `new`/`project` commands fail pointing at `gen`

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
- Cover types live in `src/genres/`, one file per family of recipes, all built on `genrePage` (`page.ts`): background, layers under and over the headline, and the typed headline. A type supplies `layoutFor`, optional `placements` (other spots tried when QC fails), `measureHtml`, `measureAccentHtml` for a second fitted text (the number figure, the stakes sign), and `renderHtml`. The registry (`index.ts`) declares each type's photo count, person, and accepted options; options that belong to another type fail instead of being ignored. `src/genres/genres.test.ts` renders every type on every family in real Chromium and checks the headline stays inside its text area, and that every text and figure area sits inside each platform crop and outside its covered rectangles. Change a type's geometry only together with that test.
- Headline type (`src/render/type.ts`) stacks identical markup: outline layer, optional ring layer, fill layer on top, so outlines and synthetic weight never fight. Effects are sized in em and counted as padding when fitting, so they stay inside the safe area.
- Fonts are never bundled. `src/render/fonts.ts` probes candidate families in the same Chromium (coverage, installed, 900-weight ink density) and picks per role (heavy, condensed, brush, round, serif). Without a heavy enough Chinese font it uses the heaviest available plus synthetic weight and prints a `Font:` note; display roles without a Chinese font degrade to heavy.
- QC lives in `src/qc/`: the master is rendered with and without text, the pixel difference is the ink mask, macOS Vision analyses the text-free background (faces, people and body poses, text, objectness), and each platform crop is checked for the headline covering them, for busy detail under the words, and for darkness. Subject objects only count against ink on picture pixels, not on flat design bands. Without Vision the picture check is skipped with a printed note. A FAIL writes the files and marks them red; the skill says not to ship them.
- Scene painting lives in `src/scene/`. It asks for a real photograph with no text in it, paints once per orientation (landscape serves landscape and ultrawide), and passes the per-family pictures to the type through `GenrePhoto.byFamily`.
- agent and model run once per family, stage the raw image in the system temp dir (`$TMPDIR/beastcover/cache/`), and crop each platform from it.
- Subject cutout lives in `src/subject/`. A PNG with at least 2% transparent pixels is used as is. Otherwise the Swift source in `vision.ts` is compiled once into `~/.beastcover/bin/vision-tool-<hash>` and run on the image, and the result is cached in `$TMPDIR/beastcover/cache/` by image hash. The compiled tool prefers `~/.beastcover/bin/` and falls back to the temp dir with a printed note when a sandbox (codex workspace-write) blocks home writes; the Swift source lives in `skills/beastcover/scripts/vision-tool.swift` and is inlined at build time via vite `?raw`. Non-macOS or macOS before 14 fails with a request for a transparent PNG. The person sits in its own subject area, above the headline, and the subject area never overlaps the text area (`src/render/layout.test.ts`).
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
│   ├── index.ts            # Family masters, crops, placements, QC per platform, custom canvas
│   ├── guides.ts           # --guides overlay for text, focus, subject, figure, and covered areas
│   └── index.test.ts
├── genres/
│   ├── index.ts            # Cover type registry, defaults from inputs, option checks
│   ├── page.ts             # Shared page: layers, typed headline, photos, scrims, chips, font kit
│   ├── schemes.ts          # Six colour schemes
│   ├── options.ts          # --hook, --tag, --number parsing
│   ├── big-type.ts         # Big type
│   ├── number.ts           # Number hook: figure sized to its length
│   ├── face.ts             # Face with big words, face with stakes
│   ├── split.ts            # Versus and before-after: panels, band, labels, seam badge
│   ├── photo.ts            # Scene title, callout, mood, and their other placements
│   ├── collage.ts          # Two to four photos with a colour band
│   └── genres.test.ts
├── qc/
│   ├── index.ts            # Ink mask, picture-only ink, overlap, busy, and brightness checks, report
│   ├── preview.ts          # Feed preview sheet
│   └── index.test.ts
├── scene/
│   ├── index.ts            # --scene painter discovery, photo prompt, gradient fallback
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
│   ├── fonts.ts            # Installed-font probe and per-role choice with degrade notes
│   ├── type.ts             # Headline type: outline, ring, shadow, keyword highlight, tilt
│   ├── photo-cover.ts      # Photo framing, extend fit, callout geometry
│   ├── photo-framing.test.ts
│   ├── photo-cover.test.ts
│   └── template.ts         # Page skeleton, headline CSS, subject layer with outline
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

## Operational Docs (`docs/`)

1. Docs carry front-matter metadata (`summary`, `read_when`) and ship in the npm package. Each English page has a `.zh-CN.md` twin, linked from the top line of both.
2. Before creating a new doc, run `pnpm docs:list` to review the existing index.
3. Existing docs: `packaging` (the cover, the title, and the description as one promise with three jobs, and how each platform shows them).

## CLI Usage

```bash
beastcover styles
beastcover gen "One headline, every platform" --preset all
beastcover gen "3个错误*毁了*我的频道" --template big-type --tag "新手必看" --preset xiaohongshu
beastcover stock search "harbour dawn" --orientation landscape
beastcover gen "The tide comes back" --photo openverse:<id> --preset wechat,x --guides
beastcover gen "别再乱剪了" --subject me.jpg --preset youtube,xiaohongshu
beastcover gen "15元和150元的拉面" --template versus --photo a.jpg --photo b.jpg --labels "¥15,¥150"
beastcover gen "个习惯多出两小时" --template number --number 3 --preset all
beastcover gen "在火山口住了一晚" --subject me.jpg --scene "a volcano crater at dusk" --number "50米"
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
- UI-facing cover type changes require newly rendered PNGs, a clean QC report, and visual inspection on every platform family.
- After cover type or layout changes, run `pnpm examples` and compare the regenerated covers in `examples/` against git by eye. The script stops on any QC failure. Looks cannot be asserted in tests, so this folder is the baseline. The painted-scene and agent examples are repainted by hand.
