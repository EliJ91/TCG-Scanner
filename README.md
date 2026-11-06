# CardSlinger — Pokémon Auto Scanner

A mobile-first React + TypeScript application for hands-free scanning above a physical card-slinger. Camera frames, OpenCV processing, JPEGs, recovery data, and ZIP files stay in the browser. No card recognition service, upload, backend, or account is required by the application.

Live app: [elij91.github.io/TCG-Scanner](https://elij91.github.io/TCG-Scanner/). Source: [EliJ91/TCG-Scanner](https://github.com/EliJ91/TCG-Scanner).

## Run locally

Requires Node **22.12+** (or Node 24+), npm, and a modern browser.

```sh
npm ci
npm run dev
```

Open `http://localhost:5173` on this computer. **A phone visiting your computer's LAN HTTP address does not get camera access.** Use HTTPS for phone testing; see below.

```sh
npm test             # critical logic and real OpenCV WASM tests
npm run build        # TypeScript checks, optimized app, generated offline service worker
npm run preview      # serve the production build locally on port 4173
npm run verify:build # verify cached production assets and offline worker behavior
```

`postinstall` copies the pinned OpenCV runtime into `public/vendor`. It contains its own WASM; no CDN is contacted. The fonts are also bundled locally. Commit `package-lock.json` and use `npm ci` for reproducibility. Regenerate app icons, if needed, with `python scripts/generate-icons.py` (Pillow is only needed for this development utility).

## Use the scanner

1. Mount the phone securely above the slinger. Use diffuse light from the sides. All four edges must be visible with background around the card. Fill roughly 20–80% of the camera area with one card.
2. The camera preview opens as soon as the app opens. Choose **Allow** if the browser asks; if it requires a tap, use **Enable camera**. Set the quantity in **Menu → Batch**. Tap the batch name/pencil in the camera's upper-left corner to rename it at any time, including before the first photo.
3. Choose **Auto** or **Manual** below the preview. Place the first card, then tap **Start scanning** in Auto. It photographs each new card after **0.22 seconds** of stillness. Manual uses **Take photo** and captures only on a tap. The zoom slider adjusts framing from 1× to 3× in either mode.
4. A short ding means the original photo is safely saved. Drop in the next card immediately. Card boundaries and blur are checked later by a separate processing worker; capture does not wait for cropping. The main count includes ready photos plus queued originals, with a separate processing count.
5. Capture stops reserving photos when the ready-plus-queued total reaches the batch target. The completion alarm plays once all target images are processed and stored. A failed crop stays available for review and does not count as a ready image.
6. Open **Menu → Recent cards**, rotate any upside-down cards, and **Download ZIP** from the menu or gallery. Edit the batch name in the download dialog; it defaults to `Batch#001`, `Batch#002`, etc., and your edit is remembered for later exports. The archive is named after this batch (for example `Batch#001.zip` or `Trade night.zip`). Images inside keep sequential filenames: `Pokemon_0001.jpg`, `Pokemon_0002.jpg`, etc. No gaps are introduced by failed or deleted scans. ZIP order follows physical capture order.

The centered scanner includes a visible editable batch name, zoom slider, capture mode, count, and capture control. Batch quantity, recent cards, downloads, settings, and the guide stay behind **Menu**. Opening a menu or gallery keeps the camera mounted and detection running. Recent-card thumbnails render only while the gallery is open.

Toggle dark/light mode under **Menu → Settings → Dark mode**. Dark mode uses a pure black background and neutral gray surfaces, with monochrome controls. The initial theme follows your device preference and your selection is remembered locally.

### Mobile camera access

The app requests the preview automatically on entry, independently of saved-data loading or processing initialization. **Enable camera** remains the direct tap fallback when browser policy requires interaction. Opening the preview never starts photographing cards by itself. Processing failures report an error and keep the session and preview active.

Open the HTTPS app directly in **Safari on iPhone** or **Chrome on Android**. Some chat, social, GitHub, and other embedded browsers do not expose a camera API or disallow camera permission prompts. If detected, the app displays an **Open scanner in Safari or Chrome** link. The app cannot override its host app's camera restrictions. If you previously denied permission, allow Camera for this site in your browser's site settings and tap Enable camera again.

The preview is visible during startup, explicitly muted, and marked for inline playback before its stream is attached. Startup listens for metadata/playing events before calling `play()` and also bounds a pending playback promise, avoiding a silent indefinite Safari wait. Preferred resolution constraints fall back to simpler camera requests when unsupported; permission denials are never retried as resolution errors. Device enumeration, capabilities, and settings APIs are optional and cannot tear down a working preview.

Auto deliberately captures the first stationary card after the quiet interval when a new batch starts. After a capture, it requires fresh movement followed by stillness to avoid repeating the same card. Resuming a partially scanned batch does not recapture its last stationary card. Manual never fires on a timer. Mode switches do not restart the camera. Use **Pause scanning** or **Menu → Stop camera** to pause explicitly; pending snapshots still finish. Background browsers may suspend camera hardware, so the app reconnects on return while preserving scan intent. It never bypasses a denied permission.

Batch size is immutable once a batch exists. Download and explicitly clear the batch to start a different one. **Clearing deletes the active batch**; downloads never clear it automatically. Only one active batch is presented in the UI.

## Errors, retries, and storage

Raw JPEGs of the selected zoom framing are staged in IndexedDB **before** processing, independently of boundary detection. The background queue holds only IDs and metadata in memory; one original at a time is read for processing. Accepted JPEG + thumbnail storage and deletion of the raw attempt happen in one transaction. Reload automatically resumes queued processing and opens the preview; new camera photos still require Start scanning or Take photo. The database upgrade preserves existing batches, originals, names, and settings.

A crop failure produces a distinct low buzz, releases its batch slot, and **does not pause capture or count as a ready image**. The original remains under **Menu → Recent cards → Needs your attention**, without a blocking boundary alert on the capture screen. Keep feeding cards, then pause to Retry crop or Save original. Retries preserve capture order. The ding confirms durable original storage; the descending completion alarm confirms the finished batch. Browsers require a user interaction before audible playback. Volume and mute apply to every sound.

If storage fails, the session stays active and retains the original. It applies storage backpressure instead of taking unlimited unsavable photos, and retries the same retained snapshot every three seconds, including while capture is paused. The camera remains visible. Save originals before closing, and free storage if needed. Missing camera access similarly waits/reconnects. Browser eviction/private browsing can limit persistence. If an older scanner tab blocks a database upgrade, close the older tab to let recovery finish. Export regularly and check your downloaded archive.

Deleting a stored scan reduces the count and pauses the scanner, including a previously completed batch. It never starts scanning automatically. Resume explicitly to fill the open slot. Gallery edits are disabled during capture or pending processing.

## Settings

**Menu → Settings** starts with Dark mode, Wait before each photo, and Sounds/Volume. Camera and photo tuning stay inside **Advanced settings**. Selected camera, resolution, zoom, flashlight, camera locks, capture mode, and tuning are saved in browser preferences and restored on entry. A missing remembered camera falls back to the rear camera. **Reset settings** restores defaults and the device's theme preference without deleting photos or the batch; pause capture before resetting. Earlier slow-capture settings migrate once to the new 220 ms default; later explicit delay choices are preserved.

| Control | Default | Notes |
| --- | --- | --- |
| Capture mode | Auto | Manual takes one snapshot per tap |
| Wait before each photo | 0.22 seconds | Adjustable 0.1–3 seconds of stillness; independent of crop speed |
| Ignore small movements | A little (2.5%) | Advanced; fraction of changed luma pixels after exposure-shift compensation |
| Zoom | 1× | Preview slider, 1–3× center crop; capture and motion use identical framing |
| Photo quality | 95% | Advanced; raw staging JPEGs use 100%; export uses saved correction |
| Saved photo size | Standard (1260 px maximum) | Advanced; never upscales; portrait height follows 63:88 |
| Blur filter | Normal (45) | Advanced; Laplacian variance measured at normalized 360 px card width |
| Camera detail | High (2560 px wide) | Advanced; rear-facing, closest available resolution |
| Alternate photo method | Off | Advanced; optional `ImageCapture.grabFrame()`, with video-canvas fallback |

The zoom slider works on all supported browsers using the original camera pixels, without enlarging saved pixels. Higher zoom reduces the available source area; keep every card edge visible. Torch, focus, exposure, and white balance controls depend on the device. Camera selection appears after permission when available. Resolution changes require stopping the camera. Queue capacity is the remaining batch quantity; it is no longer a two-photo processing bottleneck.

Enable **Show scan details** in Settings → Advanced settings to add **Scan details** to the menu. It exposes motion and noise scores, stability, cycle number, capture state, queue length, analysis timing, processing duration, focus score, confidence, and **last accepted** boundaries. The preview guide is framing assistance, not a required crop calibration. Detection always examines the actual captured image.

## How it works

The modules have separate responsibilities:

| File | Responsibility |
| --- | --- |
| `src/core/camera.ts` | Persistent rear-camera stream, controls, snapshot capture |
| `src/core/motion.ts` | 160×120 luma analysis, global brightness compensation, adaptive noise, debounce, hysteresis, timed stability |
| `src/core/batch.ts` | Strict slot reservations, bounded queue, ordered commits, storage failures, exact target |
| `src/core/pipeline.ts` | Immediate durable capture, metadata-only queue, single-reader background processing, storage retries |
| `src/core/preferences.ts` | Synchronous browser preference cache and capture-default migration |
| `public/processor.worker.js` | Serialized heavy processing outside the UI thread |
| `public/vision.js` | Shared actual OpenCV boundary detection, geometry, perspective warp, blur rejection, JPEG encoding |
| `src/core/processor.ts` | Worker lifecycle, deadlines, main-thread compatibility fallback |
| `src/core/storage.ts` | IndexedDB transactions, raw staging, recovery |
| `src/core/audio.ts` | Generated success ding, distinct error buzz, and completion alarm |
| `src/core/zoom.ts` | Shared center-crop geometry for live framing, analysis, and snapshots |
| `src/core/export.ts` | Ordered ZIP creation and 180° image correction |
| `src/useScanner.ts` | Capture orchestration, interruptions, physical-cycle rearming |

Motion analysis samples at most about every 60 ms, only on new video frames, and uses elapsed timestamps rather than a fixed-frame stability assumption. It compensates global brightness changes and ignores small changes. Capture consumes one motion cycle. A fresh high-threshold movement is needed to rearm, regardless of artwork.

The camera snapshot is copied synchronously from the stabilized video frame before JPEG encoding. `takePhoto()` is deliberately not used: it may interrupt preview, add shutter latency, or change camera behavior. Optional `ImageCapture.grabFrame()` is available for device evaluation. A missed transition between sampled frames cannot be inferred from identical stationary artwork.

The worker combines multi-threshold Canny edges, local contrast enhancement, histogram equalization, and color distance from an automatically estimated background gradient. This recovers faint silver/blue borders on white surfaces while favoring the exterior over strong internal artwork. Enhancement is used only for detection: correction and JPEG output use the original pixels. Convexity, size, center, card proportions, perspective, and sharpness are still validated. It does not perform OCR or authenticate/identify a card. Top-vs-bottom orientation is corrected with the gallery's 180° control.

Reservations are made **before** taking a snapshot. `stored + reserved <= target` is enforced by the controller, including during storage. Pending results commit in capture order even if processing finishes out of order. A failed slot is released only after its ordered result is resolved. Successful export names are generated from the ordered stored list, so no filename gaps occur. The batch remains incomplete if the final reserved image fails.

The capture path only copies, encodes, and persists each original. Cropping can fall behind for the whole remaining batch without blocking the next shutter. There is one staging photo and one decoded processing image at a time; queued originals remain in IndexedDB. Genuine storage exhaustion still applies backpressure. On browsers without worker canvas support, heavy compatibility processing waits until capture is paused or all batch photos are saved, including if a worker fails mid-session. Capture cannot guarantee one card per second on every phone: encoding, storage, optics, heat, and observable motion still need hardware measurement.

## HTTPS deployment and offline installation

The build is a static site. GitHub Actions tests, builds, verifies offline support, and publishes `main` automatically to **GitHub Pages** using `.github/workflows/deploy-pages.yml`. The workflow gets the deployment base path from GitHub Pages; camera workers, local OpenCV, icons, PWA scope, and offline caches all follow that path. No account or sign-in is needed to use the hosted app. GitHub Pages must have **GitHub Actions** selected as its publishing source.

To deploy elsewhere, upload the **contents of `dist/`** to an HTTPS static host (Cloudflare Pages, Netlify, Vercel static hosting, or an HTTPS server). The default build uses the origin root `/`. For a subpath, set `VITE_BASE_PATH=/TCG-Scanner/` before `npm run build`, or run `npm run build -- --base=/TCG-Scanner/`. Run `npm run verify:build` after either build; it checks the actual deployment prefix, PWA paths, and offline cache behavior. Set the base back to `/` for a custom root domain. No server APIs or runtime secrets are needed.

Recommended headers:

```text
Content-Type: application/javascript   # .js including worker and service worker
Content-Type: application/manifest+json # .webmanifest
Cache-Control: no-cache               # /index.html and /sw.js
Cache-Control: public, max-age=31536000, immutable # hashed /assets/*
Permissions-Policy: camera=(self), microphone=()
```

Avoid cross-origin isolation requirements; Safari compatibility does not need SharedArrayBuffer. If you add a CSP, allow same-origin workers/scripts and WASM compilation (`wasm-unsafe-eval` where supported), inline styles used by React, and `blob:` images. Test your policy on both target browsers.

For LAN development, terminate HTTPS using a certificate trusted by your phone (for example a local HTTPS reverse proxy with a trusted development certificate). Set its upstream to Vite at `http://127.0.0.1:5173`. A trusted HTTPS tunnel is another option. Do not bypass certificate warnings and expect camera permissions to work. Production hosting supplies the simplest trusted HTTPS address.

The production build generates a content-versioned service worker and pre-caches the entire application, worker, OpenCV runtime, icons, and local fonts. The first visit needs connectivity and enough cache space (roughly 12 MB plus scans). Wait for service worker installation before airplane-mode testing. Fully cached updates activate without waiting for every app tab to close. Activation does not reload the current interface or interrupt active scanning; refresh when ready to use the updated version. Offline support is disabled in Vite development mode; test it using the production preview. Android offers installation from its browser menu. On iOS use Safari's Share → Add to Home Screen. Scans are scoped to browser/profile/origin; an installed iOS app can have different storage from a Safari tab.

## Validation and limitations

`npm test` covers automatic preview startup, Auto/Manual switching, quiet placement timing, shared zoom framing, distinct error audio, continuous error/storage/camera recovery, motion/stability, stationary duplicate prevention, identical consecutive artwork, rapid movement, additive lighting changes, camera noise, interruptions, out-of-order completion, pending final slots, failed capture/storage, slot recovery, pause/resume, deletion, numbering, concurrent batch renaming, safe archive names, ZIP ordering, IndexedDB recovery, and actual OpenCV detection/warping with synthetic white/silver/yellow-like/dark borders, rotation, missing edges, invalid geometry, and blur.

For a development fixture, open `http://127.0.0.1:5173/?test-camera=1&test-processing-delay=2000`. This explicitly labeled mode generates a canvas camera and adds two seconds per processed image to expose a growing background queue. Select ten cards, use **Use silver border**, start over the first card, and press **Feed 9 cards · one per second**. The final ten-photo total should be reached before all crops finish. **Blank test frame** tests failure review; Slide restores a valid card. All fixture and delay code is removed from production builds. These are synthetic integration tools, not phone-throughput claims.

The synthetic tests verify algorithms, not the lighting, optics, or mechanics of your slinger. **The real phone + card-slinger acceptance test must still be run** using `docs/MOBILE_TESTING.md`. No particular cards-per-minute rate is guaranteed or claimed. The UI displays measured session pace only after multiple scans, and excludes paused time; after reload the pace is unavailable until new session scans are collected.

White-on-white edges with no visible contrast, heavy glare, large perspective, hidden corners, hands or another card forming a competing rectangle, and featureless/overexposed frames can defeat geometric detection. Use side lighting and full visible edges. Confidence is a geometry heuristic, not a calibrated probability. Some pathological images may need manual rejection in the gallery. No browser can recover a physically skipped identical card that never produced observable motion. Long analysis gaps reset motion tracking and report an issue while scanning stays active; reposition the current card and review for missed scans. Older Safari may use the slower main-thread fallback. Large ZIPs require memory; export smaller batches on constrained devices. JPEG rotation re-encodes once at 98% quality.

Technical references: [OpenCV contour documentation](https://docs.opencv.org/4.11.0/d5/daa/tutorial_js_contours_begin.html), [OpenCV perspective transformation source example](https://github.com/opencv/opencv/blob/5.x/doc/js_tutorials/js_assets/js_geometric_transformations_warpPerspective.html), [MDN ImageCapture](https://developer.mozilla.org/en-US/docs/Web/API/ImageCapture).
