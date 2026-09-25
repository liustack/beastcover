---
name: beastcover
description: "Make covers that get the click: a thumbnail or header for an article, video, or post, sized for WeChat, X, YouTube, Bilibili, Xiaohongshu, Instagram, Douyin, or TikTok. Start with a free photo cover: search cc0 stock, put the headline and project palette on it, no API key and no upload. Use this skill whenever the user asks for a cover, thumbnail, hero image, banner, or a text-led title card. Also use it for BeastCover configuration and offline diagnostics."
compatibility: Requires Node.js 22.19 or newer. Local HTML rendering also requires Playwright Chromium.
allowed-tools: Bash
---

# BeastCover

People see the title and the cover before anything else. If the cover does not grab them, they scroll past. Make covers with impact: one clear subject, a short headline in large type, strong contrast. Keep every platform version of one piece in the same style and palette.

## Setup

Use an installed `beastcover` command when available. Otherwise prefix each command with `npx --yes --package @liustack/beastcover@0.2.0`.

Run `beastcover doctor` once on a new machine. If it reports Chromium missing, run `npx --yes --package @liustack/beastcover@0.2.0 playwright install chromium`, then run doctor again. Do not run a bare `npx playwright install`: it can resolve a different Playwright version and download a browser this package cannot use.

## Workspace first

Run `beastcover project` before generating anything.

- If a workspace exists, keep it. Do not create another one.
- If the command says no workspace was found, run `beastcover new <name> --style <style>` once.
- Every cover in the workspace uses its style and palette, on every platform.
- Write every generated PNG to `.beastcover/out/`. Do not invent extra image folders in the user project.
- Keep `.beastcover/project.json` as the project style and palette. Commit it.
- Keep `.beastcover/history.jsonl` as the generation log. Commit it.
- Leave `out/`, `cache/`, and `refs/` untracked. Fetched stock photos and their `.json` sidecars live in `refs/`. Force-add only the refs the user names.
- Copy a style prompt in full. Never rewrite, shorten, or restyle the catalog text.

```bash
beastcover project
beastcover new <name> --style risograph_editorial
beastcover styles
beastcover styles risograph_editorial
```

`risograph_editorial` is the fallback style when the choice is uncertain. `luminous_impasto` needs a scene with depth: a landscape or street, not a desk still life.

## Pick the platform

`--preset` takes the platform name. Ask which platforms the user publishes to when it is not obvious.

| Preset | Pixels | Keep in mind |
| :-- | :-- | :-- |
| `wechat` | 900×383 | The share card crops the centre square. Keep the subject and headline there |
| `x` | 1920×368 | Very wide and shallow. Keep everything in the middle band |
| `youtube` | 1280×720 | The duration badge covers the bottom-right corner |
| `bilibili` | 1146×717 | Keep key content in the middle |
| `xiaohongshu`, `instagram` | 1080×1440 | Leave about 10% free at the top and bottom |
| `douyin`, `tiktok`, `instagram-reels` | 1080×1920 | Feeds often show only the centre 3:4. The app UI covers about 220px at the top and 380px at the bottom |

Old ratio names (`16:9`, `5:2`, `3:2`, `3:4`) are gone. The CLI names the replacement if one is used.

## Choose the source

| Output | Source |
| :-- | :-- |
| A real photo carries the mood and the headline sits on it | `stock` |
| The headline is the whole cover, or the wording will change often | `render` |
| A painted cover in the project style, and the user has a model CLI | `local-model` |

`stock` and `render` need nothing beyond Node and Chromium. `local-model` needs the user's own Codex, Grok, or Claude CLI. Do not silently substitute one source for another. If a requested local-model backend is missing, stop and name the CLI to install. Do not switch to stock, render, or a different CLI.

## Photo cover from free stock

Search first. Openverse needs no key and returns only cc0 and public-domain photos. Pexels is used automatically when `stock.pexels.apiKey` is set, or when asked for with `--provider pexels`.

```bash
beastcover stock search "harbour dawn" --orientation landscape
```

The output lists one photo per line: ref, size, license, creator, thumbnail URL. Do not take the first result by default. Pick by the text you can read: the source page title and creator hint at the subject, and the size must not be smaller than the target preset. When the harness can show images, fetch a thumbnail URL and look for one strong subject and a calm area where the headline can sit. Then render:

```bash
beastcover gen "<headline>" --source stock --photo openverse:<id> --preset wechat
```

`--photo` also accepts a local image path. A fetched photo and its provenance sidecar land in `.beastcover/refs/` when a workspace exists, otherwise in a temp directory. The command prints `License`, `Credit`, and `Source` lines. Repeat the `Credit` line to the user when it is present. cc0 and pdm photos print no credit because none is required.

Use a short concrete English query of two to four words. Keep mood words and negatives out of it.

## Render a text cover

```bash
beastcover gen "<headline>" --source render --preset xiaohongshu
```

```bash
npx --yes --package @liustack/beastcover@0.2.0 beastcover gen "<headline>" --source render --preset youtube --output <path>.png
```

When a workspace exists, omit `--output` so the PNG lands in `.beastcover/out/`. Use `--output` only when the user names a path. Use `--width`, `--height`, and `--scale` only when the requested output needs an explicit override.

After the command finishes, verify that the PNG exists at the reported path. Tell the user that render content stayed on the machine.

## Paint with a local model

`local-model` needs a workspace. The style lives in `.beastcover/project.json`. Do not create a workspace silently.

Copy the selected style prompt in full, then append one subject description (`主体：...`). Do not assemble extra style, palette, or discipline layers.

```bash
beastcover gen "<subject>" --source local-model --via codex --preset youtube
beastcover gen "<subject>" --source local-model --via grok --ref /absolute/a.png --preset douyin
```

`--via` chooses `codex`, `grok`, or `claude`. It is only valid with `--source local-model`. `--ref` names files only. Do not glob. Do not pass a directory.

After the command finishes, verify the image at the reported path. Tell the user: `Privacy: local-model used your own CLI. We did not handle the data.`

## Make it land

- One subject, one headline. Cut the headline to the fewest words that still make someone curious.
- Check the cover at thumbnail size, about 160px wide. If the subject or the headline is hard to read there, simplify.
- Lock one style and one palette for every platform version of the same piece.
- Treat every style prompt as self-contained source text. Never assemble a prompt from global style, palette, and discipline fragments.

## Configuration

```bash
beastcover config init
beastcover config set render.preset wechat
beastcover config set render.scale 2
beastcover config set stock.pexels.apiKey <key>
beastcover config show
```

`stock.openverse.clientId` and `stock.openverse.clientSecret` are optional and only raise the Openverse rate limit.

Settings resolve in this order: command flags, `~/.beastcover/config.json`, built-in defaults. The default preset is `youtube`. `config show` masks every stock credential. `beastcover doctor` performs offline checks only.

Stock downloads connect directly to the photo host. A system-wide proxy set only through `HTTPS_PROXY` is not used. Proxies that take over DNS (fake-ip mode) work.
