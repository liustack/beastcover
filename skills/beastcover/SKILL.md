---
name: beastcover
description: "Make covers that get the click: a thumbnail or header for an article, video, or post, sized for WeChat, X, YouTube, Bilibili, Xiaohongshu, Instagram, Douyin, or TikTok, plus the Open Graph image of a web page and a GitHub social preview. Fourteen cover types (big type, number hook, face with big words, face with stakes, versus, before and after, scene title, callout, collage, mood, product, tier list, quote, screenshot proof), every one checked after rendering. Free by default: local render and cc0 stock, no API key, no upload. Use this skill whenever the user asks for a cover, thumbnail, hero image, banner, OG image, or social preview, or wants the title and description that ship with one. Also use it for BeastCover configuration and offline diagnostics."
compatibility: Requires Node.js 22.19 or newer. Local HTML rendering also requires Playwright Chromium.
allowed-tools: Bash
---

# BeastCover

A cover is the promise of the content, not its decoration. In a feed at least four covers compete at once and people pick in half a second without thinking. The cover that wins shows the tension of the piece (a conflict, a before and after, the stakes, a surprising result) and leaves a gap that only opening it closes. The idea matters more than the design: a plain cover with a sharp idea beats a polished cover of the headline.

So work in this order: find the tension, pick the cover type that shows it, write the words, render, then look at every cover before you hand it over.

## Setup

Use an installed `beastcover` command when available. Otherwise prefix each command with `npx --yes --package @liustack/beastcover@0.7.6`.

Run `beastcover doctor` once on a new machine. If it reports Chromium missing, run `npx --yes --package @liustack/beastcover@0.7.6 playwright install chromium`, then run doctor again. Do not run a bare `npx playwright install`: it can resolve a different Playwright version and download a browser this package cannot use.

There is no workspace. `gen` runs in any directory, writes the PNGs to the current directory (or `--output`), and stages downloads, cutouts, and painted scenes in the system temp dir, printing their paths. Move the finished cover to where the content lives (a Hugo page bundle, `src/content/blog/x/`, next to the user's file). Copy a printed temp path into the project only when the user wants to keep it.

## 1. Find the tension

Before any command, answer: what will make someone stop on this piece? Read the content and pick one:

- **A result with the cause hidden**: "3 habits saved me 2 hours", "I stayed a night on a volcano".
- **A before and after**: the room, the desk, the chart, the body, the cover itself.
- **Two choices without the winner**: ¥15 versus ¥150 ramen, the cheap tool versus the expensive one.
- **The stakes**: a price, a deadline, a distance, a day count (`$10,000`, `DAY 7`, `50 米`).
- **One thing to look at**: an object in a photo nobody would notice without a circle around it.
- **A mood**: when the picture itself is the reason to open (travel, food, a place), words get out of the way.

The gap must be true. Platforms judge the cover by what happens after the click: YouTube's thumbnail test picks the winner by watch time, not clicks. Never promise what the piece does not deliver.

Read [docs/packaging.md](../../docs/packaging.md) for how the cover, the title, and the description split the promise between them.

## 2. Pick the platforms

`--preset` takes one platform, a comma list such as `wechat,x,douyin`, or `all`. Ask which platforms the user publishes to when it is not obvious, then make them all in one command. Several presets write `<name>-<platform>.png` next to each other.

| Preset | Pixels | Keep in mind |
| :-- | :-- | :-- |
| `wechat` | 900×383 | The 1:1 share card is a crop the author picks in the WeChat editor, so point it at the subject or the headline |
| `x` | 1600×640 | 5:2. The WeChat cover is cut from its middle, so keep key content off the far left and right edges |
| `youtube` | 1280×720 | The duration badge covers the bottom-right corner |
| `bilibili` | 1146×717 | Keep key content in the middle |
| `xiaohongshu`, `instagram` | 1080×1440 | Leave about 10% free at the top and bottom |
| `douyin`, `tiktok`, `instagram-reels` | 1080×1920 | Feeds often show only the centre 3:4. The app UI covers about 220px at the top and 380px at the bottom |
| `og` | 1200×630 | The Open Graph image of a web page or article, shown when the link is shared |
| `github` | 1280×640 | A GitHub repository social preview, uploaded in the repository settings |

Platforms with close ratios share one master and are cropped from it. The CLI keeps every headline, label, and figure inside the area all platforms in the group show, and sizes the words as large as that area allows.

## 3. Pick the cover type

`--template` picks the cover type. Without it the CLI picks from the inputs: a person and a photo make `face-stakes`, a person alone makes `face-text`, one photo makes `scene-title`, two make `before-after`, three or four make `collage`, and nothing makes `big-type`. The output always names the type it used.

| Type | Shows | Inputs | Best on |
| :-- | :-- | :-- | :-- |
| `big-type` | The words are the picture: heavy type on a plain or gradient ground | headline, optional `--tag` | Xiaohongshu, WeChat, knowledge posts |
| `number` | One huge figure beside a short line | `--number 3` (or `90%`, `10x`) | Every platform |
| `face-text` | A cut-out person on one side, 2 to 4 big words on the other | `--subject`, optional `--tag` | YouTube, Bilibili, Douyin |
| `face-stakes` | The person inside the scene of the story, the stakes on a tilted sign | `--subject`, one `--photo` or `--scene`, optional `--number` | YouTube challenges, vlogs |
| `versus` | Two equal halves, a price tag on each, a VS badge in the seam | two `--photo`, `--labels "¥15,¥150"` | YouTube, Bilibili, Xiaohongshu reviews |
| `before-after` | Before on the left (top on portrait), after on the right, an arrow between. Both halves show the same place | two `--photo` of the same place, or two `--scene`, optional `--labels "改前,改后"` | Xiaohongshu, Douyin, makeovers |
| `scene-title` | A full-bleed scene with an outlined title in its quiet part | one `--photo` or `--scene` | Bilibili, travel, documentary |
| `callout` | A red circle and arrow on the photo's subject, with a short question | one `--photo` with a small, clear subject | YouTube science, Bilibili knowledge |
| `collage` | Two to four photos in a grid with the title on a colour band | 2 to 4 `--photo` | Xiaohongshu lists, food, trips |
| `mood` | One strong photo with a small, quiet line | one `--photo` or `--scene` | Xiaohongshu, WeChat |
| `product` | One cut-out product filling its side, a soft glow behind it, the price under the headline | `--subject` (the product: a transparent PNG, or a photo to cut out), optional `--number "¥299"`, `--tag` | Reviews, 种草, unboxing, deals |
| `tier` | A ranking board: S, A, B, C rows in the familiar colours, one photo each, the first photo in S | 3 or 4 `--photo`, in rank order | "I ranked every X", food, gear, games |
| `quote` | A person, a big quotation mark, one line they said, and who said it | `--subject`, `--tag "name"` | Interview clips, podcasts, opinion |
| `proof` | A screenshot shown whole on a tilted card beside big words | one `--photo` (the screenshot: chat, stats, a post, a bill) | Knowledge, 吃瓜, exposés, "receipts" |

Options that belong to another type fail with a message naming the types that take them, so pick the type first.

```bash
beastcover gen "3个错误*毁了*我的频道" --template big-type --tag "新手必看" --preset xiaohongshu,wechat
beastcover gen "个习惯 多出两小时" --template number --number 3 --preset all
beastcover gen "我看*傻*了" --subject /abs/me.jpg --preset youtube,bilibili,douyin
beastcover gen "在火山口*住*了一晚" --subject /abs/me.jpg --photo openverse:<id> --number "50米" --preset youtube
beastcover gen "15元和150元的拉面" --template versus --photo /abs/cheap.jpg --photo /abs/fancy.jpg --labels "¥15,¥150" --preset youtube,xiaohongshu
beastcover gen "桌面*改造*" --photo /abs/before.jpg --photo /abs/after.jpg --labels "改前,改后" --preset xiaohongshu
beastcover gen "这是什么？" --template callout --photo openverse:<id> --preset youtube
beastcover gen "东京吃了*7天*" --photo a.jpg --photo b.jpg --photo c.jpg --photo d.jpg --preset xiaohongshu
beastcover gen "降噪*天花板*" --template product --subject /abs/headphones.png --number "¥299" --preset youtube,xiaohongshu
beastcover gen "我排了所有*拉面*" --template tier --photo /abs/s.jpg --photo /abs/a.jpg --photo /abs/b.jpg --photo /abs/c.jpg --preset youtube
beastcover gen "剪辑最忌讳*拖*" --template quote --subject /abs/director.jpg --tag "李导演" --preset youtube,bilibili
beastcover gen "他*承认*了" --template proof --photo /abs/chat.png --tag "实锤" --preset bilibili,xiaohongshu
```

Pick `product` over `face-text` when the subject is a thing, not a person: the product is fitted whole and never cropped like a bust. The product has no edge by default, which looks like a clean product shot. Add `--outline sticker` for a playful 种草 look, or when the cutout edge looks rough in the preview. It does not fix a cutout that kept part of the old background: use a photo of the product on a plain background instead. Put the most arguable pick in S on a `tier` board, since people click to disagree. A `quote` works when the line is specific and contestable, not a description of the topic. A `proof` screenshot is never cropped, so crop it to the part that matters before passing it.

## 4. Write the words

- **The cover carries a label, not the title.** The title sits right next to the cover in every feed, so repeating it wastes half the space. YouTube covers carry a few words at most (`DAY 6`, `How?`, a figure). Chinese platforms take more words (Bilibili breakout covers carry about 8 characters, 10 at most), but still a rewrite, shorter and louder than the title.
- **Mark where a line may break.** A headline wraps to at most three lines and prefers fewer. Put punctuation or a space between Chinese phrases where a break reads naturally: `个习惯 多出两小时` breaks as 个习惯 / 多出两小时, not in the middle of a phrase.
- **Mark one keyword with `*asterisks*`.** It gets the accent colour, a marker stroke, or a colour block, depending on the type. Without a mark, figures (`3`, `90%`, `¥150`) are highlighted automatically. Mark one word, not three.
- **`--hook` for mixed runs.** WeChat and X article cards show the title beside the cover, so a full line is fine there. When one run covers both, pass the full line as the headline and the short label as `--hook`: video and note covers get the hook, WeChat and X keep the headline.
- **`--tag`** is a small label above the headline (`新手必看`, `干货`, `2026`), for `big-type`, `number`, `face-text`, `product`, and `proof`. On `quote` it is who said the line.
- Also write the title and the first line of the description when the user publishes: they carry the searchable phrase and confirm the promise (see packaging.md).

When the output has a `Headline:` line, the text is long for a YouTube or Bilibili cover: offer a shorter hook. A `Thumbnail:` line means the words shrink too far in that platform's feed.

## 5. Colour

`--scheme` picks one of six colour schemes, each one main colour and one accent with strong contrast. Keep one scheme for every platform version of the same piece.

`cream` and `lemon` put dark type straight on a light ground, so they only work where the words sit on flat colour: `big-type`, `number`, `face-text`, `versus`, `before-after`, `collage`. The types that put words on the picture refuse them.

| Scheme | Looks like | Suits |
| :-- | :-- | :-- |
| `cream` | Cream paper, near-black type, yellow marker | `big-type` default. Knowledge, calm explainers |
| `lemon` | Bright yellow, black type, red block | Xiaohongshu lifestyle, `collage` default |
| `orange` | Warm orange, white type, yellow figure | `number` default. Food, fitness, vlogs |
| `teal` | Teal, white type, yellow accent | `face-text` and `tier` default. Reviews, travel, tutorials: cool ground makes warm skin and the warm tier colours stand out |
| `navy` | Deep navy, white type, yellow accent | Tech, finance, education. Dark: QC warns it reads dark in feeds |
| `night` | Near black, white type, lime accent | `versus` and `before-after` bands. Commentary, gaming |

Bright beats dark in feeds. Photo types take their headline colours from the scheme too.

## 6. Lettering style

The type decides the idea and the layout. `--style` decides how the words look, on any type. Keep one style for every platform version of the same piece, and change it between pieces so a channel does not look like one template.

| Style | Looks like | Suits |
| :-- | :-- | :-- |
| `bold` | Heavy type with an outline and a hard shadow, or heavy ink on a light ground | The default everywhere except `mood`. YouTube, reviews, anything loud |
| `variety` | Variety-show 花字: red type in a white ring and a dark edge, the keyword swapped to white, tilted on flat grounds | Bilibili and Douyin entertainment, reactions, challenges |
| `round` | Rounded sticker lettering: dark type in a white outline, the keyword on a marker | Xiaohongshu lifestyle, food, cute and casual |
| `editorial` | Magazine serif, no outline, a soft shadow on pictures | `mood` default. Lifestyle, travel, WeChat, design and luxury |
| `brush` | A calligraphy title with a soft shadow | Bilibili documentary, travel, guofeng, food culture |
| `memo` | A phone notes screen: black type on pale blue paper, a yellow marker, the tag as a yellow sticky note (`big-type` only, own colours, no `--scheme`) | Xiaohongshu 干货, checklists, tips |

`round` and `brush` need a rounded or brush Chinese font, which most Macs do not have until one is installed. Without it the words fall back to the heavy font and a `Font:` line names the free font to install (ZCOOL KuaiLe, Ma Shan Zheng). Tell the user. Windows ships YouYuan and KaiTi, so they work there as is.

Thin handwriting is not offered: it disappears at feed size.

## 7. Pictures

### Free stock photos

Openverse needs no key and returns only cc0 and public-domain photos. Pexels is used when `stock.pexels.apiKey` is set.

```bash
beastcover stock search "harbour dawn" --orientation landscape
```

Pick by the title and creator in each line, not the first result. When the harness can show images, fetch the thumbnail URL and look for one strong subject and a calm area for the words. Pass the ref straight to `gen --photo openverse:<id>`. The photo lands in the temp staging area. Repeat the `Credit` line to the user when it is printed. Use a short concrete English query of two to four words.

`--photo` also takes a local path, and repeats for `versus`, `before-after`, and `collage`. A before-after only works when both photos show the same place or thing: two unrelated stock photos of desks are not a before and after. Use the user's own pair, or paint the pair with two `--scene`. Photos are framed around their own subject (faces first on macOS) and kept clear of the headline. `--look mono|duotone|punch` grades every photo the same way, which keeps a collage or a comparison looking like one set. `--fit extend` keeps a whole photo on a full-bleed type and fills the rest with a blurred copy. Use it when the output says `Photo: the subject falls outside the ... crop`.

### Painted scenes

When a scene type (`scene-title`, `mood`, `face-stakes`) has no photo, `--scene "<what the picture shows>"` paints one:

```bash
beastcover gen "在火山口*住*了一晚" --subject /abs/me.jpg --scene "an active volcano crater at dusk, a small tent on the rim" --number "50米" --preset youtube,xiaohongshu
```

`before-after` takes two `--scene`: the before, then what changes. The after picture is painted from the before picture, so it is the same place from the same camera. Describe the change, not a new scene:

```bash
beastcover gen "桌面*改造*" --template before-after --scene "a cluttered home office desk, tangled cables, stacked papers" --scene "the same desk cleared: cables hidden, papers gone, one plant" --labels "改前,改后"
```

The pair is painted as landscape pictures, which fit the halves of every platform: side by side on landscape covers, stacked on portrait ones. A before-after needs a real painter. With none, it stops and says so, because two gradients compare nothing.

The CLI uses what this machine has, in order: the user's image model key (`model.openai.apiKey`, `model.gemini.apiKey`), then their `codex` or `agy` CLI. `--via openai|gemini|codex|agy` (or `scene.via` in the config) names one painter, and a missing key or CLI is then an error, never a switch to another. With no painter at all, the scene is a plain colour gradient and a `Scene:` line says what to install. Tell the user when that happens: the cover no longer shows the story. Describe one concrete picture in English: the place, the subject, the light. The painter is told to draw a real photograph with no text in it, because the words are set by BeastCover.

Only the scene is painted. The words, the person, the layout, and the checks are always BeastCover's own, so a painted scene gets the same QC as a photo. Tell the user the privacy line the run prints: the scene description (and for a before-after, the painted before picture) goes to their image API with their key, or through their own CLI.

### People

A face helps when there is one, but a product close-up or a striking object also tops the charts. Prefer the user's own photo over stock for people. `--subject` takes a transparent PNG as is. On macOS 14 or newer a normal photo is cut out on the machine. Other systems ask for a transparent PNG: tell the user to cut the photo out first (iPhone or macOS "Copy Subject", remove.bg). Never pass the photo to a model to remove the background: it redraws the face. When the photo has several people close together, crop it to one person first.

## 8. Check every cover before you hand it over

QC is part of the job, not an option. After rendering, the CLI checks each cover and prints:

- `QC FAIL <platforms>: ...` in red: the headline covers a face, a person, text already in the picture, or the main subject. The files are written anyway. **Do not hand a failing cover over.** Fix it: pick another photo, another type, a shorter line, or drop the platform, then render again.
- `QC FAIL ... blends into what is behind it`: the headline does not stand out from the picture (under 3:1 contrast). Pick a darker or lighter part of the picture, another type, or another photo.
- `QC WARN`: the headline sits on a busy area or is weak against the picture, the cover is dark, it has almost no colour, or the face is too small to read in the feed. Fix it when you can (for a small face, ask the user for a head-and-shoulders photo), or tell the user why it stays.
- `Layout: the headline moved ...`: the first placement covered the picture, so the CLI used the other spot. Look at the result.
- `Font: ...`: no heavy Chinese font was found and the headline uses synthetic weight. Tell the user which font to install for the full look.
- `Preview: <path>`: every cover at its feed size on one sheet. **Open it and look.** Can you tell at a glance what the cover shows and why to click? Is anything cut off, covered, or unreadable? The machine cannot see everything: a person Vision missed, a subject that reads wrong at feed size, an idea that does not land.

On systems without macOS Vision the picture check is skipped and the output says so. Then your own look is the only check.

YouTube tests up to three thumbnails. When the user wants to test, make versions that differ clearly (another type, face or no face, another photo), not a new outline colour, and give each run its own `--output`.

## Configuration

```bash
beastcover config init
beastcover config set render.preset wechat,x,xiaohongshu
beastcover config set render.scale 2
beastcover config set stock.pexels.apiKey <key>
beastcover config set model.openai.apiKey <key>
beastcover config set scene.via codex
beastcover config show
```

Settings resolve in this order: command flags, `~/.beastcover/config.json`, built-in defaults. `config show` masks every credential. Never put a key on the command line or in a file the user did not name. `beastcover doctor` performs offline checks only, including which backend `--scene` would paint with.

For a 4K YouTube thumbnail add `--scale 3`. `--width` and `--height` make one custom canvas instead of platform presets. `--guides` draws the safe areas on each cover for checking a layout. Never hand guided covers over.

Stock downloads connect directly to the photo host. A system-wide proxy set only through `HTTPS_PROXY` is not used. Proxies that take over DNS (fake-ip mode) work.
