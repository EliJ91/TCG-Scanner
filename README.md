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
2. Select a batch quantity and press **Start scanning**. Allow camera access. This gesture also unlocks Web Audio and requests a screen wake lock where supported.
3. Slide a card fully into place. The motion detector needs a physical transition, then 220 ms of stability by default. It does not use artwork equality. Two identical cards can be scanned in succession.
4. A short ding means a validated, corrected JPEG has been durably saved. Feed the next card. Watch the queue and slow down when it fills. The pipeline can process one image while detecting the next transition.
5. The final successful card gets its ding followed by a distinct descending three-note alarm. The capture controller stops accepting captures at the reserved batch limit.
6. Open the gallery, rotate any upside-down cards, and **Download ZIP**. Edit the batch name in the download dialog; it defaults to `Batch#001`, `Batch#002`, etc., and your edit is remembered for later exports. The archive is named after this batch (for example `Batch#001.zip` or `Trade night.zip`). Images inside keep sequential filenames: `Pokemon_0001.jpg`, `Pokemon_0002.jpg`, etc. No gaps are introduced by failed or deleted scans. ZIP order follows physical capture order.

Toggle dark/light mode using the sun/moon button in the header or the **Dark mode** switch in Settings. The initial theme follows your device preference and your selection is remembered locally.

The scanner does not automatically capture a stationary card on first start, resume, reload, or recovery. To intentionally capture an existing card, press **Capture current** while scanning. Pause or stop never cancels already captured images; they finish processing and storage. Keep the app in the foreground. Going into the background, camera interruption, rotation, or severe analysis delay pauses the scanner.

Batch size is immutable once a batch exists. Download and explicitly clear the batch to start a different one. **Clearing deletes the active batch**; downloads never clear it automatically. Only one active batch is presented in the UI.

## Errors, retries, and storage

Raw full-frame JPEGs are staged in IndexedDB **before** processing. Accepted JPEG + thumbnail storage and deletion of the raw attempt happen in one transaction. Reload recovers saved scans and interrupted raw attempts; it never silently resumes the camera.

A failure pauses scanning and does not count as a successful scan. The original image appears under **Needs your attention** in both scanner and gallery. Improve settings and retry that image, save the original, or discard it and physically rescan the card. Blurry source images and images with missing boundaries need a physical recapture. A raw retry preserves its original capture ordinal, so it returns to the right place in the export. Resolve retained failures before resuming automatic capture.

If browser storage fails or fills, the current raw capture remains in session memory and the scanner pauses. Save its original before closing the page, free storage, then retry. The app requests persistent storage, but browsers may deny it or evict data. Private browsing and OS storage policies can limit retention. Export regularly. Neither a download nor a share operation can guarantee the user actually saved a file; keep the browser batch until you have checked your archive.

Deleting a stored scan reduces the count and pauses the scanner, including a previously completed batch. It never starts scanning automatically. Resume explicitly to fill the open slot. Gallery edits are disabled during capture or pending processing.

## Settings

| Control | Default | Notes |
| --- | --- | --- |
| Stability | 220 ms | Adjustable 150–800 ms; raise it for vibration or autofocus |
| Motion threshold | 5.5% | Fraction of changed luma pixels after exposure-shift compensation |
| JPEG quality | 95% | Raw staging JPEGs use 100%; export uses saved correction |
| Output width | 1260 px maximum | Never upscales; portrait height follows 63:88 |
| Minimum sharpness | 45 | Laplacian variance measured at normalized 360 px card width |
| Camera preference | 2560 px wide | Rear-facing, closest available resolution |
| Queue capacity | 2 | Includes capture, processing, and durable storage |
| ImageCapture | Off | Optional `grabFrame()`, with video-canvas fallback |

Torch, zoom, focus, exposure, and white balance controls appear only when the browser exposes them. Let autofocus and exposure settle before locking supported adjustments. Unsupported requests display a message. Camera selection is available after permission if multiple cameras are exposed. Resolution changes require stopping the camera; queue-capacity changes require a new batch.

Debug mode exposes motion and noise scores, stability, cycle number, capture state, queue length, analysis timing, processing duration, focus score, confidence, and **last accepted** boundaries. The preview guide is framing assistance, not a required crop calibration. Detection always examines the actual captured image.

## How it works

The modules have separate responsibilities:

| File | Responsibility |
| --- | --- |
| `src/core/camera.ts` | Persistent rear-camera stream, controls, snapshot capture |
| `src/core/motion.ts` | 160×120 luma analysis, global brightness compensation, adaptive noise, debounce, hysteresis, timed stability |
| `src/core/batch.ts` | Strict slot reservations, bounded queue, ordered commits, storage failures, exact target |
| `public/processor.worker.js` | Serialized heavy processing outside the UI thread |
| `public/vision.js` | Shared actual OpenCV boundary detection, geometry, perspective warp, blur rejection, JPEG encoding |
| `src/core/processor.ts` | Worker lifecycle, deadlines, main-thread compatibility fallback |
| `src/core/storage.ts` | IndexedDB transactions, raw staging, recovery |
| `src/core/audio.ts` | Generated scan ding and completion alarm |
| `src/core/export.ts` | Ordered ZIP creation and 180° image correction |
| `src/useScanner.ts` | Capture orchestration, interruptions, physical-cycle rearming |

Motion analysis samples at most about every 60 ms, only on new video frames, and uses elapsed timestamps rather than a fixed-frame stability assumption. It compensates global brightness changes and ignores small changes. Capture consumes one motion cycle. A fresh high-threshold movement is needed to rearm, regardless of artwork.

The camera snapshot is copied synchronously from the stabilized video frame before JPEG encoding. `takePhoto()` is deliberately not used: it may interrupt preview, add shutter latency, or change camera behavior. Optional `ImageCapture.grabFrame()` is available for device evaluation. A missed transition between sampled frames cannot be inferred from identical stationary artwork.

The worker detects multi-threshold Canny edges with morphological closing, finds convex quadrilateral contours, and scores size, center, perspective, and approximate Pokémon card proportions. It favors the exterior over smaller internal artwork. It rejects frame-clipped or implausible candidates, warps the full-resolution source using its four detected corners, checks normalized sharpness, and exports a portrait JPEG without upscaling. It does not perform OCR or authenticate/identify a card. Top-vs-bottom orientation is corrected with the gallery's 180° control.

Reservations are made **before** taking a snapshot. `stored + reserved <= target` is enforced by the controller, including during storage. Pending results commit in capture order even if processing finishes out of order. A failed slot is released only after its ordered result is resolved. Successful export names are generated from the ordered stored list, so no filename gaps occur. The batch remains incomplete if the final reserved image fails.

If the queue is full, a settled card is held for capture when a slot frees. If another physical card cycle begins before that held card can be captured, the scanner pauses and reports the overrun. The operator must inspect and rescan missed cards. Arbitrarily fast feeds cannot be buffered without bound on phones. Compatibility fallback forces capacity to one and requires slower feeding.

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

The production build generates a content-versioned service worker and pre-caches the entire application, worker, OpenCV runtime, icons, and local fonts. The first visit needs connectivity and enough cache space (roughly 12 MB plus scans). Wait for service worker installation before airplane-mode testing. An update waits for previous app tabs to close, so it never forcibly reloads a scanning session. Offline support is disabled in Vite development mode; test it using the production preview. Android offers installation from its browser menu. On iOS use Safari's Share → Add to Home Screen. Scans are scoped to browser/profile/origin; an installed iOS app can have different storage from a Safari tab.

## Validation and limitations

`npm test` covers motion/stability, stationary cards, duplicate triggers, identical consecutive artwork, rapid movement, additive lighting changes, camera noise, interruptions, out-of-order completion, pending final slots, failed capture/storage, slot recovery, pause/resume, deletion, numbering, batch-name defaults and safe archive names, ZIP ordering, IndexedDB recovery, and actual OpenCV detection/warping with synthetic white/silver/yellow-like/dark borders, rotation, missing edges, invalid geometry, and blur.

For an end-to-end development fixture, open `http://127.0.0.1:5173/?test-camera=1`. This explicitly labeled, development-only mode generates a local canvas camera. Set a small batch, start scanning, and press **Slide test card** to animate a new physical transition through the real detector, OpenCV worker, IndexedDB, gallery, and ZIP pipeline. It never requests a physical camera and is removed from production builds. Use the different `127.0.0.1` origin to keep fixture scans separate from `localhost` scans. It verifies browser integration, not real hardware performance.

The synthetic tests verify algorithms, not the lighting, optics, or mechanics of your slinger. **The real phone + card-slinger acceptance test must still be run** using `docs/MOBILE_TESTING.md`. No particular cards-per-minute rate is guaranteed or claimed. The UI displays measured session pace only after multiple scans, and excludes paused time; after reload the pace is unavailable until new session scans are collected.

White-on-white edges with no visible contrast, heavy glare, large perspective, hidden corners, hands or another card forming a competing rectangle, and featureless/overexposed frames can defeat geometric detection. Use side lighting and full visible edges. Confidence is a geometry heuristic, not a calibrated probability. Some pathological images may need manual rejection in the gallery. No browser can recover a physically skipped identical card that never produced observable motion. Thermal throttling and long analysis gaps stop scanning for operator review. Older Safari may use the slower main-thread fallback. Large ZIPs require memory; export smaller batches on constrained devices. JPEG rotation re-encodes once at 98% quality.

Technical references: [OpenCV contour documentation](https://docs.opencv.org/4.11.0/d5/daa/tutorial_js_contours_begin.html), [OpenCV perspective transformation source example](https://github.com/opencv/opencv/blob/5.x/doc/js_tutorials/js_assets/js_geometric_transformations_warpPerspective.html), [MDN ImageCapture](https://developer.mozilla.org/en-US/docs/Web/API/ImageCapture).
