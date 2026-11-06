# Verification record

Automated validation:

- TypeScript strict checks and Vite production build pass.
- 61 tests exercise mobile camera requests and preview startup, scanner initialization, motion, batch reservations, recovery, ZIP ordering/names, and the real OpenCV WASM boundary/validation pipeline, including mild perspective and landscape-to-portrait correction.
- `npm audit` reports zero vulnerabilities in the installed dependency graph.
- `npm run verify:build` verifies all 20 production precache assets, offline navigation/OpenCV/worker responses with network unavailable, bundled fonts, and exclusion of the development camera fixture. Both root (`/`) and GitHub Pages (`/TCG-Scanner/`) builds pass; PWA start paths, icons, worker paths, and cache isolation are checked for the actual build prefix.

Browser integration was exercised in a separate local development origin with an explicitly enabled synthetic canvas camera:

- The stationary initial card was not automatically captured.
- Two animated card slides produced exactly two accepted, cropped portrait JPEGs through the real camera snapshot, OpenCV Web Worker, and IndexedDB pipeline.
- The configured two-card batch reached completion and disabled additional captures.
- The gallery displayed both images in order. The first image was rotated and saved.
- The export dialog defaulted to `Batch#001`. A custom name produced `Acceptance test.zip` with `Pokemon_0001.jpg` and `Pokemon_0002.jpg`, both valid 378 × 528 JPEGs; ZIP CRC validation passed.
- Reload recovered both images and the saved custom batch name, with no new automatic capture.
- Dark mode rendered on a phone-sized viewport and remained selected after a reload. Settings and gallery controls rendered, with no page overflow at the tested phone width.

This is a software and synthetic-browser verification record. Physical card-slinger performance, mobile camera optics, device audio output, glare behavior, thermal behavior, iOS/Android downloads, and production offline installation still require the hardware checklist in `MOBILE_TESTING.md`. The synthetic processing duration and session pace are not phone throughput claims.

Minimal scanner layout verification:

- Default screen contains the camera, Menu button, capture status/count, and Start/Pause control. Batch, settings, diagnostics, downloads, and recent cards appear only after opening the menu.
- At 320 × 568, 375 × 667, 390 × 844, 430 × 932, 844 × 390, and 1440 × 900, the scanner is horizontally centered, vertically centered within 0.01 px, has no horizontal overflow, and keeps the main action inside the viewport.
- Dark mode computes to `rgb(0, 0, 0)` on the page, with neutral gray panels and monochrome controls. Light mode and the persisted theme preference also work.
- The synthetic two-card batch still completes exactly at its limit. A second card was captured while Recent cards was open, without interrupting the video. Thumbnails were absent before opening the gallery and removed when it closed. The export dialog retained its editable `Batch#001` default.
- An existing production tab initially retained the previous interface through its offline cache. The service worker now activates fully cached updates immediately, without reloading an active scanning session, so a later refresh can show the new interface while other tabs stay open.

Mobile camera startup regression coverage:

- The real camera requester calls `getUserMedia` immediately, prefers the rear camera without microphone access, retries incompatible constraints, and never retries a permission denial as a resolution failure.
- The actual React app keeps Enable camera usable with pending or failed IndexedDB initialization. Permission/preview startup does not initialize OpenCV or audio. Optional enumeration failures and OpenCV startup errors leave the granted preview available.
- The camera configures muted inline playback before attaching the stream, registers frame listeners before playback, handles a pending `play()` promise with a deadline, cleans up late permission grants after cancellation, and uses actual portrait video dimensions.
- Unsupported/permission-blocked embedded browsers receive a direct-browser recovery link; a subsequent successful retry clears that message.
- Temporary page hiding while a native mobile permission dialog dismisses does not cancel the granted preview. An actually backgrounded page still stops camera use safely.
- In the browser fixture, Enable camera opened a visible, playing, muted inline preview at 1000 × 900 before OpenCV/scanning started, with the count still zero. Starting scanning and sliding two synthetic cards then completed a two-card batch successfully, with no browser errors.

These camera regressions use controlled browser-API mocks and a DOM environment. They do not substitute for the real iOS Safari/Android Chrome permission and camera checks in `MOBILE_TESTING.md`.
