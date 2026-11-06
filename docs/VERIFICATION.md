# Verification record

Automated validation:

- TypeScript strict checks and Vite production build pass.
- 34 tests exercise motion, batch reservations, recovery, ZIP ordering/names, and the real OpenCV WASM boundary/validation pipeline, including mild perspective and landscape-to-portrait correction.
- `npm audit` reports zero vulnerabilities in the installed dependency graph.
- `npm run verify:build` verifies all 20 production precache assets, offline navigation/OpenCV/worker responses with network unavailable, bundled fonts, and exclusion of the development camera fixture.

Browser integration was exercised in a separate local development origin with an explicitly enabled synthetic canvas camera:

- The stationary initial card was not automatically captured.
- Two animated card slides produced exactly two accepted, cropped portrait JPEGs through the real camera snapshot, OpenCV Web Worker, and IndexedDB pipeline.
- The configured two-card batch reached completion and disabled additional captures.
- The gallery displayed both images in order. The first image was rotated and saved.
- The export dialog defaulted to `Batch#001`. A custom name produced `Acceptance test.zip` with `Pokemon_0001.jpg` and `Pokemon_0002.jpg`, both valid 378 × 528 JPEGs; ZIP CRC validation passed.
- Reload recovered both images and the saved custom batch name, with no new automatic capture.
- Dark mode rendered on a phone-sized viewport and remained selected after a reload. Settings and gallery controls rendered, with no page overflow at the tested phone width.

This is a software and synthetic-browser verification record. Physical card-slinger performance, mobile camera optics, device audio output, glare behavior, thermal behavior, iOS/Android downloads, and production offline installation still require the hardware checklist in `MOBILE_TESTING.md`. The synthetic processing duration and session pace are not phone throughput claims.
