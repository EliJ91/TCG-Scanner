# CardSlinger — Pokémon Auto Scanner

A mobile-first React and TypeScript camera app for hands-free photography above a physical card-slinger. Photos and ZIP downloads stay in the browser.

Live app: [elij91.github.io/TCG-Scanner](https://elij91.github.io/TCG-Scanner/). Source: [EliJ91/TCG-Scanner](https://github.com/EliJ91/TCG-Scanner).

## Run locally

Requires Node **22.12+** (or Node 24+), npm, and a modern browser.

```sh
npm ci
npm run dev
```

Open `http://localhost:5173` on this computer. **A phone visiting your computer's LAN HTTP address does not get camera access.** Use HTTPS for phone testing; see below.

```sh
npm test             # camera, motion, storage, and export tests
npm run build        # TypeScript checks, optimized app, generated offline service worker
npm run preview      # serve the production build locally on port 4173
npm run verify:build # verify cached production assets and offline worker behavior
```

Fonts and app assets are bundled locally. Use `npm ci` for a reproducible install.

## Use the scanner

1. Mount the phone securely above a plain surface. Use diffuse light from the sides. Center one card with background visible around it. Fill roughly 20–80% of the camera area with the card.
2. The camera preview opens as soon as the app opens. Choose **Allow** if the browser asks; if it requires a tap, use **Enable camera**. Set the quantity in **Menu → Batch**. Tap the batch name/pencil in the camera's upper-left corner to rename it at any time, including before the first photo.
3. Choose **Auto** or **Manual**. In Auto, place the first card and tap **Start scanning**. The green bar fills during the stillness delay. Remove the card after the photo and briefly show the bare surface before placing the next card. Set **Wait before each photo** from **10 ms to 1 second** in Settings. In Manual, tap **Take photo**.
4. Use zoom to frame the photo. On a supported camera, drag the right-side slider to focus manually. Tap the lock to hold focus or restore autofocus.
5. The camera dings when it takes a photo. The completion alarm plays after the batch target is saved.
6. Tap the scan count to view **Recent cards**, rotate any upside-down cards, and choose **Download ZIP** from the menu or gallery. Edit the batch name in the download dialog. It defaults to `Batch#001`, `Batch#002`, and so on, and your edit is remembered for later exports. The archive uses the batch name, such as `Batch#001.zip` or `Trade night.zip`. Images inside use sequential filenames such as `Pokemon_0001.jpg` in capture order, with no gaps from failed or deleted scans.

The centered scanner includes an editable batch name, zoom slider, capture mode, scan count, and capture control. The count opens Recent cards. **Menu** also gives access to batch quantity, recent cards, downloads, settings, and the guide. Opening the menu or gallery keeps the camera mounted and detection running. Thumbnails render only while the gallery is open.

Toggle dark/light mode under **Menu → Settings → Dark mode**. Dark mode uses a pure black background and neutral gray surfaces, with monochrome controls. The initial theme follows your device preference and your selection is remembered locally.

### Mobile camera access

The preview opens independently of saved-data loading. **Enable camera** remains available when browser policy requires a tap. Capture starts when you choose **Start scanning** or **Take photo**.

Open the HTTPS app directly in **Safari on iPhone** or **Chrome on Android**. Some chat, social, GitHub, and other embedded browsers do not expose a camera API or disallow camera permission prompts. If detected, the app displays an **Open scanner in Safari or Chrome** link. The app cannot override its host app's camera restrictions. If you previously denied permission, allow Camera for this site in your browser's site settings and tap Enable camera again.

The preview is visible during startup, explicitly muted, and marked for inline playback before its stream is attached. Startup listens for metadata/playing events before calling `play()` and also bounds a pending playback promise, avoiding a silent indefinite Safari wait. Preferred resolution constraints fall back to simpler camera requests when unsupported; permission denials are never retried as resolution errors. Device enumeration, capabilities, and settings APIs are optional and cannot tear down a working preview.

Auto checks low-resolution preview frames for printed detail against the surrounding surface. Once a card is visible and still, Auto copies the confirmed preview frame. After a photo, Auto waits for two camera frames showing the bare surface before it can capture another placement. Clear the view when reopening a saved batch. Manual fires on tap. Mode switches keep the camera running. Use **Pause scanning** or **Menu → Stop camera** to pause capture while pending saves finish. The app reconnects on return if the browser suspended the camera.

Batch size is immutable once a batch exists. Download and explicitly clear the batch to start a different one. **Clearing deletes the active batch**; downloads never clear it automatically. Only one active batch is presented in the UI.

## Errors, retries, and storage

The shutter copies the current preview frame. JPEG encoding and IndexedDB writes can finish while the next card is captured. Up to eight photos can queue, subject to the batch target. Previously queued originals are added to the active batch up to its target. Additional originals can be downloaded or added to the batch from **Recent cards**. [Canvas specification](https://html.spec.whatwg.org/multipage/canvas.html#dom-canvas-toblob)

If storage fails, the session stays active and holds the unsaved JPEGs in memory. It waits for storage to recover and retries the retained photos in capture order every three seconds, including while capture is paused. Keep the page open until they save or download the originals. The camera remains visible. Browser eviction and private browsing can limit persistence. If an older scanner tab blocks a database upgrade, close the older tab to let recovery finish.

Deleting a stored scan reduces the count and pauses the scanner, including a previously completed batch. It never starts scanning automatically. Resume explicitly to fill the open slot. Pause capture and finish saving before editing photos.

## Settings

**Menu → Settings** starts with Dark mode, Wait before each photo, and Sounds/Volume. Camera and photo tuning stay inside **Advanced settings**. Selected camera, resolution, zoom, flashlight, focus position, camera locks, capture mode, and tuning are saved in browser preferences and restored on entry. A missing remembered camera falls back to the rear camera. **Reset settings** restores defaults and the device's theme preference while keeping photos and the batch. Pause capture before resetting. The previous 220 ms setting migrates to 100 ms. Other custom delays are kept within the supported range.

| Control | Default | Notes |
| --- | --- | --- |
| Capture mode | Auto | Manual takes one snapshot per tap |
| Wait before each photo | 100 ms | Adjustable from 10 ms to 1 second |
| Ignore small movements | A little (2.5%) | Advanced; fraction of changed luma pixels after exposure-shift compensation |
| Zoom | 1× | Preview slider, 1–3× center crop; capture and motion use identical framing |
| Photo quality | 100% | JPEG encoding quality for new photos |

| Camera detail | High (2560 px wide) | Advanced; rear-facing, closest available resolution |
| Alternate manual photo method | Off | Advanced; optional `ImageCapture.grabFrame()` for manual shots, with video-canvas fallback |

Zoom controls framing. Camera selection appears after permission, and resolution changes require stopping the camera. The focus slider and lock use camera capabilities exposed by the browser. [MediaStream Image Capture specification](https://w3c.github.io/mediacapture-image/)

Enable **Show scan details** in Settings to see motion, stability, capture state, analysis time, and capture pace.

## How it works

The modules have separate responsibilities:

| File | Responsibility |
| --- | --- |
| `src/core/camera.ts` | Persistent rear-camera stream, controls, snapshot capture |
| `src/core/card-presence.ts` | Lightweight card presence check on the 160×120 preview |
| `src/core/motion.ts` | Exposure-compensated motion, timed stillness, and removal before rearming |
| `src/core/batch.ts` | Strict slot reservations, bounded queue, ordered commits, storage failures, exact target |
| `src/core/pipeline.ts` | Background JPEG writes, batch limits, and storage retries |
| `src/core/preferences.ts` | Synchronous browser preference cache and capture-default migration |

| `src/core/storage.ts` | IndexedDB transactions and original photo recovery |
| `src/core/audio.ts` | Generated success ding, distinct error buzz, and completion alarm |
| `src/core/zoom.ts` | Shared center-crop geometry for live framing, analysis, and snapshots |
| `src/core/export.ts` | Ordered ZIP creation and 180° image correction |
| `src/useScanner.ts` | Capture orchestration, interruptions, physical-cycle rearming |

Motion analysis samples a small preview when the video advances. The stillness deadline can fire between frames. Any available fresh frame is checked before the shutter fires. Actual timing depends on frame delivery and browser scheduling.

The camera snapshot is copied synchronously from the stabilized video frame before JPEG encoding. `takePhoto()` is deliberately not used: it may interrupt preview, add shutter latency, or change camera behavior. Optional `ImageCapture.grabFrame()` is available for device evaluation. A missed transition between sampled frames cannot be inferred from identical stationary artwork.

The controller reserves one slot during capture and storage. The count advances after the write succeeds. ZIP filenames follow capture order.

## HTTPS deployment and offline installation

The build is a static site. GitHub Actions tests, builds, verifies offline support, and publishes `main` automatically to **GitHub Pages** using `.github/workflows/deploy-pages.yml`. The workflow gets the deployment base path from GitHub Pages. Icons, app scope, and offline caches follow that path. No account or sign-in is needed to use the hosted app. GitHub Pages must have **GitHub Actions** selected as its publishing source.

To deploy elsewhere, upload the **contents of `dist/`** to an HTTPS static host (Cloudflare Pages, Netlify, Vercel static hosting, or an HTTPS server). The default build uses the origin root `/`. For a subpath, set `VITE_BASE_PATH=/TCG-Scanner/` before `npm run build`, or run `npm run build -- --base=/TCG-Scanner/`. Run `npm run verify:build` after either build; it checks the actual deployment prefix, PWA paths, and offline cache behavior. Set the base back to `/` for a custom root domain. No server APIs or runtime secrets are needed.

Recommended headers:

```text
Content-Type: application/javascript   # .js including worker and service worker
Content-Type: application/manifest+json # .webmanifest
Cache-Control: no-cache               # /index.html and /sw.js
Cache-Control: public, max-age=31536000, immutable # hashed /assets/*
Permissions-Policy: camera=(self), microphone=()
```

If you add a CSP, allow same-origin scripts, inline styles used by React, and `blob:` images.

For LAN development, terminate HTTPS using a certificate trusted by your phone (for example a local HTTPS reverse proxy with a trusted development certificate). Set its upstream to Vite at `http://127.0.0.1:5173`. A trusted HTTPS tunnel is another option. Do not bypass certificate warnings and expect camera permissions to work. Production hosting supplies the simplest trusted HTTPS address.

The production build generates a content-versioned service worker and pre-caches the application, icons, and local fonts. The first visit needs connectivity and enough cache space (app assets plus photos). Wait for service worker installation before airplane-mode testing. Opening or refreshing the scanner online loads the published page. Offline launches use the installed copy. Active scans continue when an update installs. Offline support is disabled in Vite development mode. Test it using the production preview. Android offers installation from its browser menu. On iOS use Safari's Share → Add to Home Screen. Scans are scoped to browser/profile/origin. An installed iOS app can have different storage from a Safari tab.

## Validation and limitations

`npm test` covers capture, motion, camera controls, storage recovery, batch limits, and ZIP export.

Open `http://127.0.0.1:5173/?test-camera=1` to test with a synthetic camera. Select ten photos, capture the first card, then press **Feed 9 cards** to test a one-card-per-second sequence.

The synthetic tests verify algorithms, not the lighting, optics, or mechanics of your slinger. **The real phone + card-slinger acceptance test must still be run** using `docs/MOBILE_TESTING.md`. No particular cards-per-minute rate is guaranteed or claimed. The UI displays measured session pace only after multiple scans, and excludes paused time; after reload the pace is unavailable until new session scans are collected.
