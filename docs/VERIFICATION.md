# Verification record

Automated validation:

- TypeScript strict checks and Vite production build pass.
- 79 tests exercise automatic camera preview, mobile startup, Manual capture, mode persistence, quiet placement timing, zoom framing, distinct/muted error audio, continuous error/camera/storage recovery, motion, batch reservations, concurrent naming, ZIP ordering/names, and the real OpenCV WASM boundary/validation pipeline, including mild perspective and landscape-to-portrait correction.
- `npm audit` reports zero vulnerabilities in the installed dependency graph.
- `npm run verify:build` verifies all 20 production precache assets, offline navigation/OpenCV/worker responses with network unavailable, bundled fonts, and exclusion of the development camera fixture. Both root (`/`) and GitHub Pages (`/TCG-Scanner/`) builds pass; PWA start paths, icons, worker paths, and cache isolation are checked for the actual build prefix.

Browser integration was exercised in a separate local development origin with an explicitly enabled synthetic canvas camera:

- Auto displayed a quiet countdown over the stationary initial card, then captured once after the full 1.2-second interval. Leaving it stationary did not produce a duplicate.
- Two animated card slides produced exactly two accepted, cropped portrait JPEGs through the real camera snapshot, OpenCV Web Worker, and IndexedDB pipeline.
- The configured two-card batch reached completion and disabled additional captures.
- The gallery displayed both images in order. The first image was rotated and saved.
- The export dialog defaulted to `Batch#001`. A custom name produced `Acceptance test.zip` with `Pokemon_0001.jpg` and `Pokemon_0002.jpg`, both valid 378 × 528 JPEGs; ZIP CRC validation passed.
- Reload recovered both images and the saved custom batch name, with no new automatic capture.
- Dark mode rendered on a phone-sized viewport and remained selected after a reload. Settings and gallery controls rendered, with no page overflow at the tested phone width.

This is a software and synthetic-browser verification record. Physical card-slinger performance, mobile camera optics, device audio output, glare behavior, thermal behavior, iOS/Android downloads, and production offline installation still require the hardware checklist in `MOBILE_TESTING.md`. The synthetic processing duration and session pace are not phone throughput claims.

Minimal scanner layout verification:

- Default screen contains the camera, editable batch-name pill, Menu button, zoom slider, capture status/count, Auto/Manual selector, and primary capture control. Batch quantity, settings, diagnostics, downloads, and recent cards appear only after opening the menu.
- With no expanded error message, at 320 × 568, 375 × 667, 390 × 844, 430 × 932, 844 × 390, and 1440 × 900, the scanner is centered within 0.01 px, has no horizontal overflow, and keeps the main action inside the viewport. Long actionable error messages can make the page scroll.
- Dark mode computes to `rgb(0, 0, 0)` on the page, with neutral gray panels and monochrome controls. Light mode and the persisted theme preference also work.
- The synthetic two-card batch still completes exactly at its limit. A second card was captured while Recent cards was open, without interrupting the video. Thumbnails were absent before opening the gallery and removed when it closed. The export dialog retained its editable `Batch#001` default.
- An existing production tab initially retained the previous interface through its offline cache. The service worker now activates fully cached updates immediately, without reloading an active scanning session, so a later refresh can show the new interface while other tabs stay open.

Mobile camera startup regression coverage:

- The real camera requester calls `getUserMedia` immediately, prefers the rear camera without microphone access, retries incompatible constraints, and never retries a permission denial as a resolution failure.
- The actual React app requests the preview on entry with pending or failed IndexedDB initialization, retaining Enable camera as the tap fallback. Permission/preview startup does not initialize OpenCV or audio. Optional enumeration failures and OpenCV startup errors leave the granted preview available.
- The camera configures muted inline playback before attaching the stream, registers frame listeners before playback, handles a pending `play()` promise with a deadline, cleans up late permission grants after cancellation, and uses actual portrait video dimensions.
- Unsupported/permission-blocked embedded browsers receive a direct-browser recovery link; a subsequent successful retry clears that message.
- Temporary page hiding while a native mobile permission dialog dismisses does not cancel the granted preview. An actually backgrounded page still stops camera use safely.
- In the browser fixture, the visible, playing, muted inline preview opened automatically at 1000 × 900 before OpenCV/scanning started, with the count still zero.

Zoom, capture controls, and continuous recovery verification:

- Manual mode did not take timed photos. A blank-frame photo was rejected without incrementing the count or pausing; Take photo stayed available. Restoring a valid frame still waited for the next tap, which saved a valid crop through the real OpenCV worker and IndexedDB pipeline.
- The preview zoom slider changed from 1.0× to 1.5× and applied the matching video scale. Accepted outputs remained native-size 378 × 528 JPEGs. Changing zoom in an active, partially scanned Auto batch did not trigger a stationary duplicate.
- Switching Manual → Auto kept the preview and batch intact. The next slide displayed Card moving, waited for stillness, and completed the two-card batch at exactly two accepted scans. The failed original remained available for review.
- The batch-name/pencil edited a draft before the first photo and renamed an existing completed batch. The ZIP dialog showed the same name. Reload preserved both accepted scans, the custom name, Manual selection, and 1.5× zoom; the preview reopened without taking another photo.
- Controlled failure tests confirm that processing rejection frees its slot and leaves scanning active, storage backpressure retries the same original without another snapshot, lost/frozen camera frames reconnect, and foreground return preserves active scan intent without a Resume tap.
- Audio tests confirm separate high sine success tones, a descending three-note completion alarm, and low sawtooth error tones, with mute/zero-volume and rapid-error throttling.

These camera regressions use controlled browser-API mocks and a DOM environment. They do not substitute for the real iOS Safari/Android Chrome permission and camera checks in `MOBILE_TESTING.md`.
