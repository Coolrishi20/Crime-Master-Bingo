# Anthem Square — brand and design system

**Anthem Square · MUSIC VIDEO BINGO · HEAR IT. MARK IT. OWN IT.** This is the only approved tagline.

## Logo
The approved icon is a 3×3 grid of rounded squares inside an orange rounded border on Dark Blue:

| | Left | Centre | Right |
|---|---|---|---|
| Top | cream + Dark Blue music note | cream | orange |
| Middle | cream | orange + white play triangle | cream |
| Bottom | orange | cream | cream |

The icon grid is 3×3; Bingo cards stay 5×5. Keep the icon flat, with no shine, glow, 3D effect or extra symbols.

| File (`assets/brand/`) | Use |
|---|---|
| `anthem-square-icon.svg` | Master icon (vector), 48 px and larger |
| `anthem-square-icon-small.svg` | 16–32 px: no note, thicker ring (approved) |
| `anthem-square-icon-square.svg` | Square background version, for platforms that round corners themselves |
| `anthem-square-icon-print.svg` | Low-ink outline icon, used on printed cards |
| `anthem-square-mono-blue.svg` / `-mono-cream.svg` | One-colour versions |
| `anthem-square-horizontal-dark.svg` / `-light.svg` | Horizontal lock-up (icon + wordmark + descriptor) |
| `anthem-square-stacked-*.svg`, `-stacked-tagline-*.svg` | Stacked lock-up, optionally with the tagline |
| `png/anthem-square-{16…1024}.png`, `anthem-square.ico` | Bitmap sizes and the Windows icon (also in `build/icon.ico`) |

Use the tagline on the dashboard welcome card, Settings → About, promo material and the
stacked lock-up. Never place it over a playing video, on the small icon or on working screens.

## Colour (Option D)
| Name | Hex | Role |
|---|---|---|
| Light Cream | `#FFF2CF` | Light backgrounds, Dark Mode text and feature panel |
| Dark Blue | `#102542` | Dark backgrounds, navigation, Light Mode text |
| Vivid Orange Red | `#FF5B32` | Primary action, playback, progress, winning pattern |
| Dark Gray | `#171717` | Text on orange |

**60–30–10.** In Dark Mode (default), Dark Blue covers about 60%, cream 30% and orange 10%.
Light Mode swaps the first two (cream 60, Dark Blue 30). Only the tints in
`src/renderer/shared/theme.css` are added, and only for hierarchy, states and contrast.

**Contrast rules (WCAG AA)**
- Orange buttons always use Dark Gray text (5.8:1). White on orange is 3.1:1, so it is never used for text.
- Orange is never used as text on cream (2.8:1). Use `#B33A17` there (5.3:1).
- On dark panels, orange text uses `#FF7451` (≥4.5:1).
- No green. Success, completed and connected use cream (Dark Mode) or Dark Blue (Light Mode) with a ✓ and a word. "Not valid" uses an orange outline with ✕. States never rely on colour alone.

## Type
Montserrat ExtraBold for display text: headings, the wordmark, numbers and song titles, in
normal capitalisation. Inter for interface text. Both are OFL-licensed and bundled in
`src/renderer/shared/fonts/`, so the app stays fully offline.

## Where the design lives
- `src/renderer/shared/theme.css`: tokens. Dark is the default; `html[data-theme="light"]` switches to Light.
- `src/renderer/host/brand.css`: laptop components.
- `src/renderer/audience/brand.css`: TV, always dark, with flat opaque panels and no blur over the video.
- `src/remote-web/brand.css`: host remote and player phones, which follow the laptop's theme.
- `src/renderer/print/brand.css`: printed cards, with white paper, Dark Blue ink and minimal orange.

## Not renamed on purpose
The data folder (`%APPDATA%\Crime Master Bingo`), the installer app ID, `.cmbbackup` files,
the `CMB1|` card QR prefix and internal file names keep their original names. Renaming any of
them would break existing installs, backups or printed cards.
