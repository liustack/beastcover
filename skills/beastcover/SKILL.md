---
name: beastcover
description: "Make a cover or illustration for an article, presentation, product, or campaign with BeastCover, and keep every image in the piece inside one visual family. Start with a free photo cover: search cc0 stock, put the project palette and headline on it, no API key and no upload. Use this skill whenever the user asks for a cover, hero image, article illustration, social variant, or an editable text-led card. Also use it for BeastCover configuration and offline diagnostics."
compatibility: Requires Node.js 22.19 or newer. Local HTML rendering also requires Playwright Chromium.
allowed-tools: Bash
---

# BeastCover

Create a set of images that shares one visual language. Treat the article, presentation, product, or campaign as the unit of style. Do not pick a new style for each image.

## Setup

Use an installed `beastcover` command when available. Otherwise prefix each command with `npx --yes --package @liustack/beastcover@0.2.0`.

Run `beastcover doctor` once on a new machine. If it reports Chromium missing, run `npx --yes --package @liustack/beastcover@0.2.0 playwright install chromium`, then run doctor again. Do not run a bare `npx playwright install`: it can resolve a different Playwright version and download a browser this package cannot use.

## Workspace first

Run `beastcover project` before generating anything.

- If a workspace exists, keep it. Do not create another one.
- If the command says no workspace was found, run `beastcover new <name> --style <style>` once.
- One project locks one style. Covers, body illustrations, social crops, and transition graphics all use that style.
- Write every generated PNG to `.beastcover/out/`. Do not invent extra image folders in the user project.
- Keep `.beastcover/project.json` as the project visual system. Commit it.
- Keep `.beastcover/history.jsonl` as the generation log. Commit it.
- Leave `out/`, `cache/`, and `refs/` untracked. Fetched stock photos and their `.json` sidecars live in `refs/`. Force-add only the refs the user names.
- Copy a style prompt in full. Never rewrite, shorten, or restyle the catalog text.

```bash
beastcover project
beastcover new <name> --style memory_color_blocks
beastcover styles
beastcover styles memory_color_blocks
```

`memory_color_blocks` is the fallback style when the choice is uncertain. `minimal_watercolor`, `freehand_doodle`, and `memory_color_blocks` are the long-term primary styles. `luminous_impasto` is cover-only, needs a scene with depth, and does not go into body illustrations.

## Choose the source

Use the content role, not the presence of text, to choose a source.

| Output | Source |
| :-- | :-- |
| A cover or hero image: a real photo carries the mood and a headline sits on it | `stock` |
| Text is the information subject, or the wording will be edited repeatedly | `render` |
| An illustration where the picture is the subject and the user has a model CLI | `local-model` |

`stock` and `render` need nothing beyond Node and Chromium. `local-model` needs the user's own Codex, Grok, or Claude CLI. Do not silently substitute one source for another. If a requested local-model backend is missing, stop and name the CLI to install. Do not switch to stock, render, or a different CLI.

## Photo cover from free stock

Search first. Openverse needs no key and returns only cc0 and public-domain photos. Pexels is used automatically when `stock.pexels.apiKey` is set, or when asked for with `--provider pexels`.

```bash
beastcover stock search "harbour dawn" --orientation landscape
```

The output lists one photo per line: ref, size, license, creator, thumbnail URL. Do not take the first result by default. Pick by the text you can read: the source page title and creator hint at the subject, and the size must not be smaller than the target preset. When the harness can show images, fetch a thumbnail URL and look for a calm area where the headline can sit. Then render:

```bash
beastcover gen "<headline>" --source stock --photo openverse:<id> --preset 16:9
```

`--photo` also accepts a local image path. A fetched photo and its provenance sidecar land in `.beastcover/refs/` when a workspace exists, otherwise in a temp directory. The command prints `License`, `Credit`, and `Source` lines. Repeat the `Credit` line to the user when it is present. cc0 and pdm photos print no credit because none is required.

Use a short concrete English query of two to four words. Keep mood words and negatives out of it.

## Render a PNG

Use an installed `beastcover` command when available. Otherwise run the package with npx.

```bash
beastcover doctor
beastcover gen "<text>" --source render --preset 16:9
```

```bash
npx --yes --package @liustack/beastcover@0.2.0 beastcover gen "<text>" --source render --preset 16:9 --output <path>.png
```

When a workspace exists, omit `--output` so the PNG lands in `.beastcover/out/`. Use `--output` only when the user names a path.

Available presets are `16:9`, `5:2`, `3:2`, and `3:4`. Use `--width`, `--height`, and `--scale` only when the requested output needs an explicit override.

After the command finishes, verify that the PNG exists at the reported path. Tell the user that render content stayed on the machine.

## Generate with a local model

`local-model` needs a workspace. The style lives in `.beastcover/project.json`. Do not create a workspace silently.

Copy the selected style prompt in full. Do not assemble extra style, palette, or discipline layers.

If the style has no subject slot, append one subject description (`主体：...`). If it declares a subject slot, fill that slot with the user text and do not append a trailing `主体：` paragraph. This is still the same two pieces of content, not a new layer.

`extreme_minimal_abstraction` is the only catalog style with a slot. The slot is a relationship, not a theme. The relationship must still be the same event in the article. Do not invent a separate abstract idea. A bad fill from 2026-08-23 used "主体正要迈出去，但一根来自身后的线仍牵着它" for the theme "一个人站在半开的门前，门外是清晨", and dropped the door and the morning. The filled relationship must keep the person, the half-open door, and the morning.

```bash
beastcover gen "<subject>" --source local-model --via codex --preset 3:2
beastcover gen "<subject>" --source local-model --via grok --ref /absolute/a.png
```

`--via` chooses `codex`, `grok`, or `claude`. It is only valid with `--source local-model`. `--ref` names files only. Do not glob. Do not pass a directory.

After the command finishes, verify the image at the reported path. Tell the user: `Privacy: local-model used your own CLI. We did not handle the data.`

## Preserve the visual system

- Lock one style for the whole article or product.
- Keep one project palette across covers, article illustrations, social crops, and transition graphics.
- Treat every style prompt as self-contained source text.
- Copy the selected style prompt in full, unchanged, then append one subject description. If the style declares a subject slot, fill that slot instead of appending `主体：`.
- Never assemble a prompt from global style, palette, and discipline fragments. Those layers interfere with each style in different ways.
- Review for over-completion. Reject images that finish every object, fill every gap, or turn every surface into realistic material.
- Follow the style canvas strategy. Paper styles keep a real paper border. Full-bleed color fields fill the canvas.

## Configuration

```bash
beastcover config init
beastcover config set render.preset 3:2
beastcover config set render.scale 2
beastcover config set stock.pexels.apiKey <key>
beastcover config show
```

`stock.openverse.clientId` and `stock.openverse.clientSecret` are optional and only raise the Openverse rate limit.

Settings resolve in this order: command flags, `~/.beastcover/config.json`, built-in defaults. `config show` masks every stock credential. `beastcover doctor` performs offline checks only.

Stock downloads connect directly to the photo host. A system-wide proxy set only through `HTTPS_PROXY` is not used. Proxies that take over DNS (fake-ip mode) work.
