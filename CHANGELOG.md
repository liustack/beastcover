# Changelog

## 0.7.5 (unreleased)

- **The DeepSeek Harness plugin is gone.** DSH loads skills, so it uses the same `skills/beastcover` skill as every other agent and gets every cover type, not just a headline on the default one. The package no longer exports a plugin entry or ships `cordis.patch.yml`.

## 0.7.4 (2026-09-28)

0.7.3 was tagged but never published: its release checks failed on the font probe. Everything planned for 0.7.3 ships here, plus:

- **Fonts are found correctly on Windows and Linux.** A font counts as installed only when it draws differently from a name no machine has, so a system whose Chinese fallback is the same for every generic family no longer reports missing fonts as installed.

## 0.7.3 (2026-09-28, not published)

Covers are now built from ten cover types, the ones that keep winning on each platform, and every cover is checked after rendering. The old four templates looked like a headline on a wall. A cover wins on its idea, so each type is made to show one: the stakes, a before and after, two choices, one thing to look at, a mood.

- **Ten cover types.** `--template big-type | number | face-text | face-stakes | versus | before-after | scene-title | callout | collage | mood`. Without `--template` the type is picked from what you give it: a person and a photo make `face-stakes`, a person alone `face-text`, one photo `scene-title`, two `before-after`, three or four `collage`, nothing `big-type`. The output names the type it used.
- **One way in.** `gen` renders every cover. `--photo` repeats (versus and before-after take two, a collage two to four) and takes a stock ref or a local file. There is no `--source` any more.
- **Painting only makes the story scene.** When `scene-title`, `mood`, or `face-stakes` has no photo, `--scene "<what the picture shows>"` has your own painter draw a real photograph. `before-after` takes two `--scene`, and the after picture is painted from the before picture, so both halves show the same place from the same camera. The painters: your image model key (GPT Image or Nano Banana) first, then your codex or agy CLI. With neither, a single scene becomes a colour gradient and a `Scene:` line says what to install, and a before-after stops with an error, because two gradients compare nothing. `--via` or `config set scene.via` names one painter and nothing else is tried. The words, the person, the layout, and the checks stay BeastCover's own. Whole covers painted in a catalog style are gone, with `--source agent`, `--source model`, `--style`, `--ref`, `--remix`, and `beastcover styles`: a painting of a person at a desk is not a cover that gets the click.
- **Type with craft.** Headlines have outlines and hard shadows that survive any background, and one `*keyword*` gets the accent colour, a marker stroke, or a colour block (figures are highlighted when nothing is marked). A headline wraps to at most three lines and takes fewer when that keeps 70% of its size, and a space between Chinese phrases marks where it may break, like punctuation. Outlined lines are spaced so one line's outline never touches the next. Fonts are not bundled: the heaviest Chinese font installed is found in the same Chromium that renders, and when none is heavy enough the headline gets synthetic weight and a `Font:` line says what to install.
- **Six colour schemes.** `--scheme cream | lemon | orange | teal | navy | night`, each one strong ground and one accent, every pair of colours that touch at 4.5:1 or more. `cream` and `lemon` set dark type straight on a light ground, so the types that put words on a photo refuse them. Photos in one cover get the same `--look`, and the two halves of a comparison are brightened or dimmed to match, so neither side wins by lighting.
- **QC after every render.** The headline is checked against faces, people, text in the photo, and the main subject in every requested crop, and against busy detail, weak contrast, a dark or nearly grey cover, and words running off the edge. Contrast is measured letter by letter against what is right around them (the outline, the colour block, or the photo), so a line that reads on one half and vanishes on the other fails, and so does type painted in the colour behind it: the weakest tenth of the headline must reach 3:1. A cut-out face darker than what is behind it is brightened, never so far that its highlights blow out. Every photo's subject and every face must stay in view: a subject that fits a platform must show in full, clear of its bars and buttons. Photos are framed only into the part each platform shows, so a stacked before-after no longer hides half the after photo. Failures print in red and the files are still written. When a type has another spot for the headline and the first one fails, the cover is rendered again there and a `Layout:` line says so. A preview sheet shows every cover at its feed size. Custom `--width`/`--height` canvases get the same checks.
- **Config.** `source`, `agent`, and `model.via` are gone, and `scene.via` names the default painter. `doctor` reports which painter `--scene` would use instead of listing CLIs. Old names are no longer translated: an unknown flag, key, preset, or template is simply reported as unknown.
- **Examples redone.** One example per type across the three platform shapes, all passing QC, plus a face-with-stakes cover whose volcano scene codex painted, and a before-after whose two desks codex painted as one place. `pnpm examples` stops when an example fails QC.
- **The skill is a handbook now.** Find the tension, pick the type for the platform and the content, write the words, render, then read QC and look at the preview before handing anything over.

## 0.7.2 (2026-09-27)

BeastCover now finishes and leaves. There is no workspace, no setup command, and nothing left behind in your project or your git.

- **`gen` runs anywhere.** The cover lands in the directory you run from (or `--output`), `--style <name>` picks a catalog style per run with the fallback style otherwise, and the removed `new` and `project` commands fail pointing at `gen`. `project.json` and `history.jsonl` are gone.
- **Intermediates stage in the system temp folder.** Downloaded photos with their license records, model originals, and the cutout cache go to `$TMPDIR/beastcover/`, each run in its own subdirectory so two runs from different directories can never crop each other's image. Every staged path is printed: the `Photo:` line names the download, agent and model print an `Original:` line per platform family, and the `Subject:` line names the cutout file. Copy what you want to keep; the system cleans the rest.
- **Sandboxed agents can always run it.** Verified against the codex workspace-write sandbox and Claude Code: the working directory and the temp dir are writable in both, so the whole flow works with no permission grants. The compiled macOS cutout tool still prefers `~/.beastcover/bin` and falls back to the temp dir with a printed note that tells the agent how to ask for a persistent grant. The Swift source now ships inside the skill at `skills/beastcover/scripts/vision-tool.swift`.
- **agent accepts off-size images.** agy sometimes returns a same-ratio smaller frame; it is now normalized to the generate plan and cropped, matching the model source, instead of being refused after the model already ran.
- **Breakout-grade examples.** The examples folder is now a portfolio made by single commands: an expressive face on a loud poster, a lava photo with a numbered hook, a red-circle callout, a before-and-after of the product itself, and two agent paintings. `pnpm examples` regenerates the free-path covers as the visual regression baseline.

## 0.7.0 (2026-09-27)

BeastCover is free by default: free stock photos plus local rendering. The two painted-cover paths are opt-ins you already pay for elsewhere, and this release renames one and adds the other.

- **`--source local-model` is now `--source agent`.** The model never ran locally; what is local is the agent CLI and your subscription, so the name said the wrong thing. The backends are `codex` and `agy`, the two CLIs that can actually generate an image. The `grok` and `claude` backends are gone: neither CLI has image generation, so covers through them never worked. Old names fail with the new spelling: the source `local-model`, the config section `localModel`, and `--via grok|claude`. Old history records still list.
- **`--source model` paints through your own API key.** GPT Image (`--via openai`, default `gpt-image-2.5-flare`) or Nano Banana (`--via gemini`, default `gemini-3-pro-image-preview`), with keys in `model.<provider>.apiKey`, set through `beastcover config set`. One API call per platform family, cropped like an agent cover. A missing key is an error naming the config key, never a switch to another provider, and the key stays out of every error message, even when the server echoes it back. Model ids move fast, so `model.<provider>.model` replaces the default without a release. `--ref` and `--remix` are not supported yet.
- **The Bilibili bottom bar matches the site.** Measured on bilibili.com: feed cards show a 16:10 cover at about 16:9, and the play count, comment count, and duration row sits on the bottom tenth of that. The covered band starts at y 1020 of the master instead of 1056, so headlines stay clear of it. The YouTube duration badge was measured too and the existing estimate already contains it.
- **CI runs on Windows.** Line endings are pinned to LF, the POSIX file-mode assertions skip where Windows manages access through ACLs, and two runs cutting out the same photo no longer collide when Windows refuses to replace a cache file the other run is reading.

- **`--callout` stays clear of the headline, the crops, and the app UI.** 0.6.0 drew the ring on the master without checking where it landed: YouTube, OG, and GitHub cut its top off, the ring ran into the headline on every real photo, and the arrow could start under Douyin's bottom bar or, when no side was free, at the subject itself. The headline band now shrinks to what is left below the ring (down to a fifth of the text area), the ring and the whole arrow are checked against every requested platform's crop and covered areas, and `gen` runs that check for every family before it opens the browser, so a refusal leaves no half-written set of covers. The message names the platforms and what would go wrong. On a small custom canvas the line width has a floor, so the arrowhead's wings and their white stroke could still poke past the canvas edge: every candidate arrow now keeps its shaft, tip, and wings, stroke included, inside the visible area, and turns to another side when they do not fit.
- **`gen` rejects a non-PNG `--output` before starting work for every source.** render and stock used to render the cover first and refuse at the write, and a stock ref was downloaded first. A stock run without a workspace now also removes its temporary download folder whenever it fails.
- **`--scale` is rejected with `--source local-model`.** It was accepted and ignored, and the skill's `--scale 3` advice now says it applies to render and stock covers.
- **`doctor` and render share one Chromium launcher**, so the doctor check cannot drift from what render does.

## 0.6.0 (2026-09-26)

- **`--callout` on photo covers.** Circles the photo subject in red and points an arrow at it from the empty side, clear of the headline. Science and tech channels mark the thing to look at this way (14 of 90 top YouTube thumbnails use a red circle or arrow). It needs one small, clear subject, and fails with a message when the subject fills most of the frame.
- **`doctor` checks the Chromium that render uses.** It looked for the full Chromium build, while render starts the headless shell. It now starts Chromium the same way render does, so it no longer reports a working setup as broken, or a broken one as working.
- **local-model refuses a non-PNG output before calling the model.** `--output cover.jpg` used to write PNG bytes into a .jpg file after the model had already run.
- **Skill:** how to make clearly different versions for YouTube's A/B test, and `--scale 3` for a 3840×2160 YouTube thumbnail.

## 0.5.0 (2026-09-26)

- **`--hook` for a short cover line.** A video thumbnail wants a hook of a few words, while WeChat and X article cards show the title next to the cover. `--hook "It fails"` puts the short line on the video and note covers and keeps the full headline on WeChat and X. It fails when no requested cover would show it.
- **People are sized by the face.** On macOS the cutout is cropped to head and shoulders when a face is found, and the person grows until the face is about 30% of the clear height. The person may run off the canvas edge away from the headline, never toward it, and the face stays inside what every requested platform shows. In test covers the face went from 10-18% to 21-31% of the frame height. Breakout YouTube thumbnails have a median of 27%.
- **Hints based on real covers.**
  - `Cover:` suggests a subject when a YouTube thumbnail is text only. None of 90 top YouTube thumbnails were text only.
  - `Headline:` now also covers Bilibili, with a 10 Chinese character limit. In 136 trending and weekly-pick Bilibili covers the median was 8 characters, and only one in five repeated the video title word for word.
- **Lighter photo covers.** The dark gradient covered the top and most of the bottom. It now darkens only the lower part, and lightly, and a shadow close to the letters keeps the headline legible. Dark thumbnails consistently lag in 1of10's 300,000-video study.

## 0.4.0 (2026-09-26)

- **Styles keep their colours on render covers.** Covers looked up colours by slot name, so the risograph pink (slot `spot`) and the impasto blue (slot `colors`) fell back to the default blue. Each style now marks which slot is the cover paper, ink, and accent, and every style must mark one accent.
- **Punctuated clauses no longer break inside.** The font size check let an unbreakable run be up to half a pixel wider than the text area, and the browser then split it. A headline such as 封面不狠，没人点开 now keeps each clause on its own line.
- **A `Headline:` hint for YouTube.** When the headline is long for a YouTube thumbnail (more than about five words or eight Chinese characters), `gen` suggests a short hook for the cover and the full line for the video title. Breakout thumbnails in vidIQ's and 1of10's studies carry a few words or none.
- **Skill advice based on research.** Faces help but are not required, a calm face beats a screaming one in creators' A/B tests, bright colour beats dark, and test versions should differ clearly.

## 0.3.3 (2026-09-26)

- **Bigger headlines on X and WeChat covers.** The headline on the wide covers had to fit in the middle square so a forwarded WeChat card would still show it. The WeChat editor lets the author pick where that 1:1 crop goes, so the headline now uses almost the whole WeChat crop, and with a person on the cover it sits on the left with the person on the right, as on landscape covers. Compare covers get the wider headline band too.
- **Photo covers on X and WeChat put the headline on the dark lower part.** The headline used to fill the full height on the left and could land on the brightest part of the photo. It now sits in the lower half, and the subject moves up and to the right, as on landscape covers.

## 0.3.2 (2026-09-26)

- **Releases come from CI.** Pushing a `v*` tag runs the checks on GitHub Actions and publishes to npm through trusted publishing, with provenance, then creates the GitHub Release from this file. `pnpm release <version>` bumps the version, updates the pinned version in the skill, and pushes the tag. It never publishes by itself.
- **CI on every push.** Ubuntu and macOS, Node 22.19 and 24, with real Chromium rendering and, on macOS, the Vision cutout.

## 0.3.1 (2026-09-26)

- **The X article cover is 1600×640 (5:2).** 0.3.0 used 1920×368, taken from a third-party guide, and a real X article cover is 5:2. The wide master is now 1920×768. The WeChat cover (900×383) is cut from its middle and loses only a thin strip on each side. The text, poster, number, compare, and photo covers were all redrawn at the new size. local-model crops 1536×614 from the middle of the 1536×1024 image for X.
- **Chinese words stay on one line.** Headlines broke between any two Chinese characters, so a narrow text area could split a word such as 标题 across lines. Words of two or more characters, found with `Intl.Segmenter`, now stay whole, and the font size is measured so the longest word fits.

## 0.3.0 (2026-09-26)

- **BeastCover makes covers only.** The package was renamed and article illustrations were removed. Covers are sized for WeChat, X, YouTube, Bilibili, Xiaohongshu, Instagram, Douyin, and TikTok, plus Open Graph link previews (`og`, 1200×630) and GitHub social previews (`github`, 1280×640).
- **One headline, every platform.** Platforms with close ratios share one master and are cropped from it. The headline is fitted as large as the area every requested platform shows, clear of app UI. `--guides` draws that area.
- **Templates.** `text`, `poster` with `--tag`, `number` with `--number`, and `compare` with `--before` and `--after`.
- **A person or object on the cover.** `--subject` takes a transparent PNG, or cuts out a photo on macOS 14+ with Vision. Nothing is uploaded and no model redraws the face.
- **Photo covers.** Photos are framed around their subject, with `--look` and `--fit extend`.
- **local-model remix.** `--remix` redraws one image in the project style or puts the person from one image into the scene of another.
