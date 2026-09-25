# Changelog

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
