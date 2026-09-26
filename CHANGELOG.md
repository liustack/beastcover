# Changelog

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
