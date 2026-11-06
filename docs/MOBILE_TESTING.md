# Real card-slinger acceptance checklist

Record phone model, OS, browser version, camera resolution, lighting, stability threshold, motion threshold, blur threshold, queue capacity, and ambient temperature. Run separately on Android Chrome and iPhone Safari. Clear only expendable test batches after checking exports.

## Setup and permissions

- [ ] Open a trusted HTTPS root URL. First load and cache the complete production build online.
- [ ] Deny camera permission; confirm an actionable message. Grant permission in browser settings, retry, and verify rear camera selection.
- [ ] Check preview framing: all corners visible with a margin, approximately centered, no hands or slinger edges forming a competing card-like rectangle.
- [ ] Verify portrait/landscape phone orientations; rotating during capture must pause safely.
- [ ] Test available camera selection, zoom, torch, and locks. Unsupported controls should be absent or report an error without losing images.
- [ ] Tap Start and test volume/mute. Verify sound unlock, silent-mode behavior, and phone hardware volume. Wake lock is optional.
- [ ] Toggle light/dark from the header and Settings; reload to confirm persistence. Check contrast and controls in both modes.

## Detection and image quality

- [ ] Start over an already stationary card. Wait 10 seconds: zero automatic captures. Capture it only by sliding/replacing it or explicitly pressing Capture current.
- [ ] Slide in a card and hold still: one scan, one ding, all four borders preserved, portrait crop, no background beyond edge rounding, no artwork clipped.
- [ ] Leave it stationary for 30 seconds: no duplicate scans.
- [ ] Slide another card directly over the last with no empty interval: exactly one new scan.
- [ ] Repeat with two or more identical-artwork cards. Count physical cards against saved images.
- [ ] Test yellow, white, silver, and dark borders; textured and holographic cards; slight rotation; mild perspective. Inspect corners at full resolution.
- [ ] Move a lamp or trigger autofocus. Small noise/global exposure changes should not add scans. Strong local shadows may require a higher motion threshold.
- [ ] Test slow slides, short fast slides, vibration, rapid successive feeds, and a hand crossing the view. Increase stability delay or decrease feed speed if needed.
- [ ] Test missing corners, partially outside cards, motion blur, defocus, and glare. Failures must not count; originals must be retained and scanning must pause.
- [ ] Test retry on a retained source with adjusted settings, discard and physical recapture, Save original, 180° correction, and deletion.

## Strict batch and asynchronous pipeline

- [ ] Select 50 and feed 50 valid cards. Verify exactly 50 stored images and 50 success dings.
- [ ] Confirm the final image is stored before its ding, followed by the distinct completion alarm. Additional movements must not capture anything.
- [ ] Force the final image to fail. Batch remains incomplete; no completion alarm until the valid replacement fills its slot.
- [ ] Fill the processing queue. The scanner should indicate backpressure and hold a settled card until a slot opens.
- [ ] Feed another card before that held card is captured: verify explicit overrun pause. Check saved order and rescan missed physical cards; do not continue blindly.
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
- [ ] Background the app, lock the screen, switch apps, or interrupt camera access. Return to an explicit pause, with saved images and original captures intact.
- [ ] Simulate near-full storage in a disposable profile. Failed storage must not increment count, and raw originals must remain available in session for saving. Do not close the page until saved.
- [ ] Force worker startup failure in developer tools; verify compatibility fallback or actionable initialization error. Feed slowly in fallback.
- [ ] Force a ZIP generation error; saved images remain available for another export.
- [ ] Clear a test batch through the explicit confirmation. New batch starts at image 0001 and the next batch archive number.

## Performance and offline

- [ ] Enable diagnostics. Record median and slowest processing times, motion-analysis time, queue depth, and measured cards/min across a full batch.
- [ ] Run for 10–15 minutes. Check heat, battery use, frame gaps, memory, and responsiveness. Lower resolution/output size or feed speed if the device cannot keep up.
- [ ] After production service worker is active, close/reopen the site in airplane mode and scan/export. OpenCV, fonts, gallery, and ZIP should work without network.
- [ ] Install on Android and through iOS Add to Home Screen. Repeat camera/sound/offline tests in installed mode.
- [ ] Publish an update while scanning. It must not force a reload. Close all app tabs and reopen to activate the update.

For each run record: physical card count, accepted count, failures, false positives, duplicates, missed movements, crop errors, average processing time, elapsed active scanning time, and export verification. Accept the setup only after 50-card runs with zero missed/duplicate/count/order errors. Accuracy takes priority over a faster feed rate.
