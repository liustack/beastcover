---
name: beastcover
description: "Make covers that get the click: a thumbnail or header for an article, video, or post, sized for WeChat, X, YouTube, Bilibili, Xiaohongshu, Instagram, Douyin, or TikTok, plus the Open Graph image of a web page and a GitHub social preview. Start with a free photo cover: search cc0 stock, put the headline and project palette on it, no API key and no upload. Use this skill whenever the user asks for a cover, thumbnail, hero image, banner, OG image, social preview, or a text-led title card. Also use it for BeastCover configuration and offline diagnostics."
compatibility: Requires Node.js 22.19 or newer. Local HTML rendering also requires Playwright Chromium.
allowed-tools: Bash
---

# BeastCover

People see the title and the cover before anything else. If the cover does not grab them, they scroll past. Make covers with impact: one clear subject, a short headline in large type, strong contrast. Keep every platform version of one piece in the same style and palette.

## Setup

Use an installed `beastcover` command when available. Otherwise prefix each command with `npx --yes --package @liustack/beastcover@0.3.2`.

Run `beastcover doctor` once on a new machine. If it reports Chromium missing, run `npx --yes --package @liustack/beastcover@0.3.2 playwright install chromium`, then run doctor again. Do not run a bare `npx playwright install`: it can resolve a different Playwright version and download a browser this package cannot use.

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

## Pick the platforms

`--preset` takes one platform, a comma list such as `wechat,x,douyin`, or `all`. Ask which platforms the user publishes to when it is not obvious, then make them all in one command. Several presets write `<name>-<platform>.png` next to each other.

| Preset | Pixels | Keep in mind |
| :-- | :-- | :-- |
| `wechat` | 900×383 | The share card crops the centre square. Keep the subject and headline there |
| `x` | 1600×640 | 5:2. The WeChat cover is cut from its middle, so keep key content off the far left and right edges |
| `youtube` | 1280×720 | The duration badge covers the bottom-right corner |
| `bilibili` | 1146×717 | Keep key content in the middle |
| `xiaohongshu`, `instagram` | 1080×1440 | Leave about 10% free at the top and bottom |
| `douyin`, `tiktok`, `instagram-reels` | 1080×1920 | Feeds often show only the centre 3:4. The app UI covers about 220px at the top and 380px at the bottom |
| `og` | 1200×630 | The Open Graph image of a web page or article, shown when the link is shared |
| `github` | 1280×640 | A GitHub repository social preview, uploaded in the repository settings |

Platforms with close ratios share one master and are cropped from it: WeChat from the middle of the X banner, Xiaohongshu and Instagram from the middle of the Douyin frame, YouTube from the Bilibili frame. The CLI keeps the headline inside the area every platform in the group shows and sizes it as large as that area allows. The table above is only for choosing platforms and judging the result.

Add `--guides` to draw the headline area (green), the focus area (orange), and app UI (red) on each cover when the user wants to check a layout. Do not hand guided covers over as finished files.

When the output has a `Thumbnail:` line, the headline will be hard to read in that platform's feed. Offer a shorter headline.

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

The output lists one photo per line: ref, size, license, creator, thumbnail URL. Do not take the first result by default. Pick by the text you can read: the source page title and creator hint at the subject. The listed size can be optimistic: some Openverse sources only serve a 1024px copy. `stock fetch` and `gen` report the size that was actually served, and `gen` prints a `Photo: ... is stretched` line when a platform needs the photo blown up more than 1.5x. Offer a larger photo when you see it. When the harness can show images, fetch a thumbnail URL and look for one strong subject and a calm area where the headline can sit. Then render:

```bash
beastcover gen "<headline>" --source stock --photo openverse:<id> --preset wechat,x,xiaohongshu
```

`--photo` also accepts a local image path. A fetched photo and its provenance sidecar land in `.beastcover/refs/` when a workspace exists, otherwise in a temp directory. The command prints `License`, `Credit`, and `Source` lines. Repeat the `Credit` line to the user when it is present. cc0 and pdm photos print no credit because none is required.

Use a short concrete English query of two to four words. Keep mood words and negatives out of it.

The photo is framed around its own subject (faces first on macOS, the most striking area elsewhere) and moved clear of the headline, which keeps to the lower part of the cover. Two options change the photo itself, all on the machine:

- `--look mono|duotone|punch` grades it: black and white, the palette's dark and accent colours, or more saturation and contrast. The default `natural` keeps the palette wash.
- `--fit extend` keeps the whole photo and fills the rest with a blurred copy. Use it when the output says `Photo: the subject does not fit the ... crop`, typically a portrait photo on the X or WeChat banner.

## Put a person on the cover

A face with an expression is the strongest hook a cover can have. When the user has a photo of themselves, a guest, or a character, add it with `--subject`:

```bash
beastcover gen "<1 to 6 words>" --source render --subject /absolute/me.jpg --preset youtube,xiaohongshu
beastcover gen "<headline>" --source stock --photo openverse:<id> --subject /absolute/me.png --preset all
```

- A transparent PNG is used as is. On macOS 14 or newer a normal photo is cut out on the machine with the system cutout, and the output says `cut out on this machine with macOS Vision`. The first cutout compiles a small tool, which takes a few seconds.
- Other systems fail with a message asking for a transparent PNG. Tell the user to cut the photo out first (iPhone or macOS "Copy Subject", remove.bg, Photoshop). Never pass the photo to a local-model CLI to remove the background: the model redraws the face.
- The person stands on one side (the bottom on portrait covers) with a white outline, and the headline takes the other side. Keep that headline short: three to six characters, or a few words.
- The cutout keeps everything that stands out in the foreground. When the photo has several people or things close together, crop it to the one person first, or ask for a PNG that is already cut out.
- `--subject` works with `render` and `stock`, not with `local-model`.

## Render a text cover

`--source render` has four templates. Pick the one that matches the hook:

| Template | Use it when | Extra options |
| :-- | :-- | :-- |
| `text` (default) | A headline on a calm paper background | `--subject` |
| `poster` | Loud and flat: a full-bleed palette colour, huge type | `--tag "<2 to 6 words>"`, `--subject` |
| `number` | The hook is a figure: 3 habits, 90%, 10x | `--number <figure>` (required) |
| `compare` | Before and after, this versus that | `--before <path> --after <path>` (required), `--labels "<first>,<second>"` |

```bash
beastcover gen "<headline>" --source render --preset xiaohongshu
beastcover gen "封面没人点" --source render --template poster --tag "新手必看" --preset all
beastcover gen "个习惯多出两小时" --source render --template number --number 3 --preset all
beastcover gen "三个月后" --source render --template compare --before /abs/old.jpg --after /abs/new.jpg --labels "之前,之后" --preset all
```

Options that belong to another template fail with a message, so pick the template first. With `number` and `compare` the headline sits in a smaller area: keep it to a few words, or the `Thumbnail:` warning will ask for it.

```bash
npx --yes --package @liustack/beastcover@0.3.2 beastcover gen "<headline>" --source render --preset youtube --output <path>.png
```

When a workspace exists, omit `--output` so the PNG lands in `.beastcover/out/`. Use `--output` only when the user names a path. Use `--width`, `--height`, and `--scale` only when the requested output needs an explicit override.

After the command finishes, verify that the PNG exists at the reported path. Tell the user that render content stayed on the machine.

## Paint with a local model

`local-model` needs a workspace. The style lives in `.beastcover/project.json`. Do not create a workspace silently.

Copy the selected style prompt in full, then append one subject description (`主体：...`). Do not assemble extra style, palette, or discipline layers.

```bash
beastcover gen "<subject>" --source local-model --via codex --preset youtube
beastcover gen "<subject>" --source local-model --via grok --ref /absolute/a.png --preset xiaohongshu,douyin
```

The model runs once per group of platforms, saves its image in `.beastcover/cache/`, and each platform is cropped from that image. `xiaohongshu,douyin` is one model call. `wechat,youtube` is two.

`--via` chooses `codex`, `grok`, or `claude`. It is only valid with `--source local-model`. `--ref` names files only. Do not glob. Do not pass a directory.

### Redraw or combine images

Only when the user asks for it, `--remix` hands their images to the model:

```bash
beastcover gen "<subject>" --source local-model --via codex --remix /abs/me.jpg --preset youtube
beastcover gen "<subject>" --source local-model --via codex --remix /abs/me.jpg --remix /abs/scene.jpg --preset douyin
```

- One image: redrawn in the project style, keeping the composition, pose, and face.
- Two images: the person from the first is put into the scene from the second.
- Only the user's own images or cc0/pdm photos go to the model. A photo fetched from Pexels is refused.
- The model redraws the face and invents what the photo does not show, like the rest of a body. When the face must stay exact, use `--subject` on a render or stock cover instead.

After the command finishes, verify the image at the reported path. Tell the user: `Privacy: local-model used your own CLI. We did not handle the data.`

## Make it land

- One subject, one headline. Cut the headline to the fewest words that still make someone curious.
- Check the cover at thumbnail size. The CLI already warns when the headline gets too small in a feed. If the subject is hard to make out there, pick another photo.
- Lock one style and one palette for every platform version of the same piece.
- Treat every style prompt as self-contained source text. Never assemble a prompt from global style, palette, and discipline fragments.

## Configuration

```bash
beastcover config init
beastcover config set render.preset wechat,x,xiaohongshu
beastcover config set render.scale 2
beastcover config set stock.pexels.apiKey <key>
beastcover config show
```

`stock.openverse.clientId` and `stock.openverse.clientSecret` are optional and only raise the Openverse rate limit.

Settings resolve in this order: command flags, `~/.beastcover/config.json`, built-in defaults. The default preset is `youtube`. `config show` masks every stock credential. `beastcover doctor` performs offline checks only.

Stock downloads connect directly to the photo host. A system-wide proxy set only through `HTTPS_PROXY` is not used. Proxies that take over DNS (fake-ip mode) work.
