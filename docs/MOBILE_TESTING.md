# Real card-slinger acceptance checklist

Record phone model, OS, browser version, camera resolution, lighting, stability threshold, motion threshold, blur threshold, queue capacity, and ambient temperature. Run separately on Android Chrome and iPhone Safari. Clear only expendable test batches after checking exports.

## Setup and permissions

- [ ] Open a trusted HTTPS root URL. First load and cache the complete production build online.
- [ ] Open the app: confirm that the native camera request/preview opens automatically before scanning. If the browser requires a gesture, tap Enable camera. Verify no photos are taken before Start scanning or Take photo.
- [ ] Deny camera permission; confirm an actionable message. Allow Camera in browser site settings, tap Enable camera again, and verify rear camera selection.
- [ ] Open inside an embedded/in-app browser that blocks camera access. Verify an actionable message and the direct Safari/Chrome link. Repeat in the full mobile browser.
- [ ] With storage loading slowly or unavailable, Enable camera must still request permission and show the preview. Capturing remains disabled until persistent storage is ready.
- [ ] Check preview framing: all corners visible with a margin, approximately centered, no hands or slinger edges forming a competing card-like rectangle.
- [ ] Verify portrait/landscape orientations; rotation resets motion analysis without automatically pausing the session.
- [ ] Test available camera selection, zoom, torch, and locks. Unsupported controls should be absent or report an error without losing images.
- [ ] Tap Start/Take photo and test volume/mute. Check three distinct sounds: success ding, low error buzz, and completion alarm. Audio before any user interaction may be blocked by the browser.
- [ ] Test the 1–3× zoom slider in both modes. Saved framing must match the preview and preserve native pixel quality. Adjusting zoom must not trigger an extra Auto photo.
- [ ] Tap the visible batch name/pencil, save a new name before the first photo, rename during scanning, and reload. The scanner and ZIP dialog must show the same persisted name.
- [ ] Toggle light/dark through Menu → Settings; reload to confirm persistence. Dark mode must use pure black and neutral gray surfaces. Check contrast and controls in both modes.
- [ ] Settings should initially show only Dark mode, Wait before each photo, Sounds, and Volume. Open Advanced settings to find photo/camera controls. Confirm the descriptions are clear and Done is always reachable on a small screen.
- [ ] At 320, 375, 390, and 430 px widths, verify the scanner is horizontally centered and its Start/Pause control fits on screen. No sidebar, bottom navigation, batch panel, or recent-card thumbnails should be visible until opened from Menu.

## Detection and image quality

- [ ] Start Auto over a stationary first card: capture only after a full 1.2-second quiet interval. Continued placement/hand movement must restart that interval. Leave it stationary afterward: no duplicate.
- [ ] In Manual, wait over a stationary card: zero automatic photos. Each Take photo tap requests one photo, subject to queue/batch capacity.
- [ ] Switch Auto/Manual while active. Keep the same preview and batch, with no extra stationary duplicate.
- [ ] Slide in a card and hold still: one scan, one ding, all four borders preserved, portrait crop, no background beyond edge rounding, no artwork clipped.
- [ ] Leave it stationary for 30 seconds: no duplicate scans.
- [ ] Slide another card directly over the last with no empty interval: exactly one new scan.
- [ ] Repeat with two or more identical-artwork cards. Count physical cards against saved images.
- [ ] Test yellow, white, silver, and dark borders; textured and holographic cards; slight rotation; mild perspective. Inspect corners at full resolution.
- [ ] Move a lamp or trigger autofocus. Small noise/global exposure changes should not add scans. Strong local shadows may require a higher motion threshold.
- [ ] Test slow slides, short fast slides, vibration, rapid successive feeds, and a hand crossing the view. Increase stability delay or decrease feed speed if needed.
- [ ] Test missing corners, partial cards, blur, defocus, and glare. Failures must not count; originals stay retained, the error buzz plays, and scanning stays active. Reposition/retake successfully without a Resume tap.
- [ ] Test retry on a retained source with adjusted settings, discard and physical recapture, Save original, 180° correction, and deletion.

## Strict batch and asynchronous pipeline

- [ ] Select 50 and feed 50 valid cards. Verify exactly 50 stored images and 50 success dings.
- [ ] Confirm the final image is stored before its ding, followed by the distinct completion alarm. Additional movements must not capture anything.
- [ ] Force the final image to fail. Batch remains incomplete; no completion alarm until the valid replacement fills its slot.
- [ ] Fill the processing queue. The scanner should indicate backpressure and hold a settled card until a slot opens.
- [ ] Feed another card before a held card is captured: verify a reported/audible overrun without an automatic pause. Check saved order and retake missed cards.
- [ ] Pause with images in processing. They should finish and save; no fresh captures until Resume.
- [ ] Resume over the same stationary card: no duplicate. Explicit capture is available if needed.
- [ ] Open the gallery while scanning: camera and detector should continue. Editing remains disabled until capture is paused and the queue is empty.
- [ ] Delete an image from a complete batch. Count falls by one, scanner stays paused, explicit Resume can refill the batch.

## Persistence, export, and recovery

- [ ] Download a partial batch, then a completed batch. Unzip and check exact file count, valid JPEG decoding, portrait dimensions, sequential filenames without gaps, and physical order.
- [ ] Confirm rotated/deleted images are reflected in the next ZIP. Download never clears saved data.
- [ ] In the download dialog, confirm default `Batch#XXX`, edit to a custom batch name, and verify the archive name and persisted name on the next export. Names inside remain `Pokemon_0001.jpg` onward.
- [ ] On iOS inspect the downloaded ZIP in Files, and test Share / Save when available.
- [ ] Reload after saved scans; verify recovery and no automatic stationary recapture.
- [ ] Reload during processing; verify retained raw attempts can be retried, with no counted duplicate.
- [ ] Background/lock the app or interrupt camera access. Keep saved images/originals intact; on return reconnect the camera and preserve the active scan intent without requiring Resume. Respect a browser permission denial.
- [ ] Simulate near-full storage in a disposable profile. Failed storage must not increment count, and raw originals must remain available in session for saving. Do not close the page until saved.
- [ ] While storage is unavailable, keep the session active but apply capture backpressure. Once storage recovers, retry retained snapshots automatically without taking duplicate photos.
- [ ] Force worker startup failure in developer tools; verify compatibility fallback or actionable initialization error. Feed slowly in fallback.
- [ ] An OpenCV initialization failure must not close an already granted camera preview. Optional camera capability/device-enumeration failures must not stop the stream.
- [ ] Force a ZIP generation error; saved images remain available for another export.
- [ ] Clear a test batch through the explicit confirmation. New batch starts at image 0001 and the next batch archive number.

## Performance and offline

- [ ] Enable Show scan details in Settings → Advanced settings. Record median and slowest processing times, motion-analysis time, queue depth, and measured cards/min across a full batch.
- [ ] Run for 10–15 minutes. Check heat, battery use, frame gaps, memory, and responsiveness. Lower resolution/output size or feed speed if the device cannot keep up.
- [ ] After production service worker is active, close/reopen the site in airplane mode and scan/export. OpenCV, fonts, gallery, and ZIP should work without network.
- [ ] Install on Android and through iOS Add to Home Screen. Repeat camera/sound/offline tests in installed mode.
- [ ] Publish an update while scanning. It must not force a reload or interrupt capture. Once the new assets are cached, pause and refresh to see the updated interface without closing every app tab.

For each run record: physical card count, accepted count, failures, false positives, duplicates, missed movements, crop errors, average processing time, elapsed active scanning time, and export verification. Accept the setup only after 50-card runs with zero missed/duplicate/count/order errors. Accuracy takes priority over a faster feed rate.
