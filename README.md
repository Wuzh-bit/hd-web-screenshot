# HD Web Screenshot

> A Chrome/Edge browser extension for capturing **high-resolution** webpage screenshots — sharper than built-in tools and most marketplace alternatives.

Browser built-in screenshot tools (like Edge's "Web Capture" or Chrome DevTools "Capture full size screenshot") often produce blurry output because they cap the rendering resolution. This extension uses [dom-to-image-more](https://github.com/1904labs/dom-to-image-more) with an adaptive pixel budget algorithm, rendering at **up to 3× devicePixelRatio** while respecting browser canvas limits — giving you crisp, readable captures every time.

## Why HD?

| Tool | Max Resolution | Quality |
|------|---------------|---------|
| Edge Web Capture | Viewport only, 1× DPR | Blurry on HiDPI screens |
| Chrome Full Size Screenshot | 1× DPR | Text barely readable |
| Most marketplace extensions | 1–2× DPR, no budget control | Inconsistent |
| **HD Web Screenshot** | **Up to 3× DPR, auto-adaptive** | **Sharp & clear** |

## Features

- **Region Screenshot** — Drag to select any area. Resize handles (4 corners + 4 edges) for precise adjustment. Hold `Shift` for square selection.
- **Full Page Screenshot** — Captures the entire scrollable page at high resolution.
- **Copy to Clipboard** — Instant paste into documents, chats, or design tools.
- **Save as PNG** — Uses File System Access API with download fallback.
- **Smart Pixel Budget** — Automatically scales down for extremely large pages to avoid canvas overflow, with a user-friendly warning.
- **Edge Snap** — Selection edges snap to viewport boundaries (±8px) for precision.
- **Auto-scroll Selection** — Drag to screen edges to auto-scroll and capture across the fold.
- **Dark Mode Support** — UI follows system `prefers-color-scheme`.
- **Privacy First** — Manifest V3, `activeTab` + `scripting` permissions only. No network requests, no data collection. Everything runs locally.

## Installation

### Chrome / Edge (Developer Mode)

1. Download or clone this repository.
2. Open `chrome://extensions/` (Chrome) or `edge://extensions/` (Edge).
3. Enable **Developer mode** (toggle in top-right / left sidebar).
4. Click **Load unpacked** and select the `screenshot-extension` folder.
5. The extension icon appears in your toolbar — pin it for quick access.

> 中文安装说明见 [安装指南.md](./安装指南.md)

### Usage

| Action | How |
|--------|-----|
| Open screenshot menu | Click toolbar icon or press **Alt + Shift + S** |
| Region screenshot | Choose "选择区域" → drag to select → adjust handles → Copy / Save |
| Full page screenshot | Choose "整个网页" → wait for rendering → Copy / Save |
| Cancel | Press **Esc** or click "取消" |

## Tech Stack

- **Manifest V3** — Modern extension API with minimal permissions
- **dom-to-image-more** — DOM-to-SVG-to-Canvas rendering pipeline
- **Vanilla JavaScript** — Zero dependencies beyond the rendering library
- **File System Access API** — Native save dialog with `showSaveFilePicker`
- **Clipboard API** — Direct image copy with `navigator.clipboard.write`

## Limitations

- `chrome://`, `edge://`, and extension store pages cannot be captured (browser restriction).
- Cross-origin images (no CORS headers), `<iframe>` content, video frames, and WebGL may appear blank — this is a limitation of DOM-based rendering.
- Websites with strict Content-Security-Policy (e.g., GitHub, Twitter) may block SVG `foreignObject` rendering. The extension detects this and provides a fallback guide.

## License

MIT © 2026
