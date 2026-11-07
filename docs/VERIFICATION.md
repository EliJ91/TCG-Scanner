# Verification record

## Direct photo capture update

- The browser fixture saved ten 1000 × 900 JPEGs during a one-card-per-second feed and stopped at the batch target.
- The delay slider reached 10 ms and 1 second in a phone-size viewport. A timed UI test confirms that movement can cancel the countdown at its deadline.
- Camera mocks verify focus adjustment, focus lock, autofocus restoration, and preference storage. Physical focus still needs the device checks in `MOBILE_TESTING.md`.
- Storage tests cover direct JPEG saves, failed-write retries, and recovery of earlier originals. The build check excludes the former processing runtime from offline assets.

## Previous background capture update

- 101 automated tests pass, along with strict TypeScript checks, production builds and offline asset verification.
- A durable pipeline test supplies ten new motion cycles at simulated one-second intervals while the first crop is deliberately unfinished. All ten originals are stored and dinged; only one processing read runs at a time. The queue reaches the exact batch limit, then drains in capture order.
- React integration tests keep Take photo enabled for five successive snapshots while the first boundary result is pending. Processing rejections retain their originals, report review status and keep capture active.
- Failure tests cover original staging failure, processed-image storage failure with other images already queued, encoding failure behind a slow crop, worker loss, delayed compatibility processing and processing startup retry.
- Database recovery tests resume queued originals without starting capture. A schema-1 upgrade test preserves existing raw images, batch name, settings and order, while new queue reads return metadata without JPEG blobs.
- Real OpenCV/WASM tests detect faint silver borders, slight silver/blue color contrast on near-white, a lighting gradient with noise, and a highlight interrupting an edge. Exterior corners must stay close to known source corners despite a stronger internal rectangle. A noisy white surface must still be rejected. Perspective, rotation, missing corners, blur and dark/yellow/white borders remain covered.
- Preference tests restore camera selection, resolution, zoom, flashlight and locks from the browser cache before async loading. Reset restores defaults without deleting the batch or saved photos. A stale camera ID falls back to the rear camera.
- ZIP ordering/name/recovery tests remain green. The app's Web Share code and Share / Save interface are removed; ZIP download remains.
- Production verification checks all 20 precache assets, offline navigation/OpenCV/worker responses, scope isolation and exclusion of synthetic-camera/feed/delay controls. Both root and GitHub Pages deployment prefixes are checked.
- Installing an updated offline worker uses reload requests for every precache asset, preventing the browser HTTP cache from supplying an older unhashed cropper or worker script. The offline test checks this request policy.

Live browser automation was unavailable for this update because browser use is disabled in Work settings. No new real-device or browser-throughput claim is made. Use `MOBILE_TESTING.md` to measure one-card-per-second feeds on actual iOS/Android hardware, including silver/holographic cards, downloads, heat and offline installation.

## Earlier browser verification

The records below predate the new durable queue and 220 ms capture delay:

- A synthetic canvas camera exercised actual snapshots, the OpenCV worker, IndexedDB, gallery and ZIP output. Two-card batches stopped exactly at their limit; ordered JPEG entries decoded at 378 x 528 and passed ZIP CRC checks. Rotation, naming and reload recovery worked.
- Earlier Auto/Manual testing confirmed no timed Manual capture, continuation after a blank frame, matching zoom framing and persistence of mode, zoom and batch names. These behaviors have additional current automated coverage.
- The minimal screen was centered with no horizontal overflow at 320 x 568, 375 x 667, 390 x 844, 430 x 932, 844 x 390 and 1440 x 900. Dark mode used a pure black page with neutral gray surfaces.
- Simple settings and a closed Advanced settings section fit phone-sized viewports with Done visible. Current settings add Reset settings and remove the obsolete two-photo capacity control.
- Camera startup checks cover direct permission requests, muted inline playback, metadata listeners, bounded playback waits, portrait dimensions, cancellation of late grants, optional API failures and embedded-browser recovery links.
- The service worker activated fully cached updates without forcing an active scan to reload. A later refresh displayed the new interface.

These remain software and synthetic verification records. They do not replace the physical card-slinger acceptance checklist.
