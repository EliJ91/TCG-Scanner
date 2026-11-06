/* Shared, locally hosted OpenCV pipeline. Executed in a classic worker, with a
   yielding main-thread fallback on older browsers. No remote requests. */
(function (scope) {
  'use strict';
  const distance = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
  function orderCorners(points) {
    const cx = points.reduce((s, p) => s + p.x, 0) / 4;
    const cy = points.reduce((s, p) => s + p.y, 0) / 4;
    const sorted = [...points].sort((a, b) => Math.atan2(a.y - cy, a.x - cx) - Math.atan2(b.y - cy, b.x - cx));
    let start = 0;
    for (let i = 1; i < 4; i++) if (sorted[i].x + sorted[i].y < sorted[start].x + sorted[start].y) start = i;
    return [...sorted.slice(start), ...sorted.slice(0, start)];
  }
  function geometry(points, width, height) {
    let p = orderCorners(points);
    const sides = p.map((v, i) => distance(v, p[(i + 1) % 4]));
    const a = (sides[0] + sides[2]) / 2, b = (sides[1] + sides[3]) / 2;
    const ratio = Math.min(a, b) / Math.max(a, b);
    if (ratio < 0.54 || ratio > 0.88 || Math.min(sides[0], sides[2]) / Math.max(sides[0], sides[2]) < 0.63 || Math.min(sides[1], sides[3]) / Math.max(sides[1], sides[3]) < 0.63) return null;
    if (p.some(v => v.x < 3 || v.y < 3 || v.x > width - 4 || v.y > height - 4)) return null;
    let cosine = 0;
    for (let i = 0; i < 4; i++) {
      const prev = p[(i + 3) % 4], v = p[i], next = p[(i + 1) % 4];
      cosine += Math.abs(((prev.x - v.x) * (next.x - v.x) + (prev.y - v.y) * (next.y - v.y)) / (distance(prev, v) * distance(next, v)));
    }
    cosine /= 4;
    if (cosine > 0.37) return null;
    if (a > b) p = [p[1], p[2], p[3], p[0]];
    return { points: p, quality: Math.max(0, 1 - Math.abs(ratio - 63 / 88) * 3 - cosine * 0.65) };
  }
  function findCard(cv, src) {
    const scale = Math.min(1, 900 / Math.max(src.cols, src.rows));
    const small = new cv.Mat(), gray = new cv.Mat(), blur = new cv.Mat(), edges = new cv.Mat();
    const kernel = cv.getStructuringElement(cv.MORPH_RECT, new cv.Size(3, 3));
    let best = null;
    try {
      cv.resize(src, small, new cv.Size(Math.round(src.cols * scale), Math.round(src.rows * scale)), 0, 0, cv.INTER_AREA);
      cv.cvtColor(small, gray, cv.COLOR_RGBA2GRAY);
      cv.GaussianBlur(gray, blur, new cv.Size(5, 5), 0);
      for (const [low, high] of [[20, 65], [55, 150], [8, 28]]) {
        cv.Canny(blur, edges, low, high);
        cv.morphologyEx(edges, edges, cv.MORPH_CLOSE, kernel);
        const contours = new cv.MatVector(), hierarchy = new cv.Mat();
        try {
          cv.findContours(edges, contours, hierarchy, cv.RETR_LIST, cv.CHAIN_APPROX_SIMPLE);
          for (let i = 0; i < contours.size(); i++) {
            const contour = contours.get(i), approx = new cv.Mat();
            try {
              const area = Math.abs(cv.contourArea(contour));
              const fraction = area / (small.cols * small.rows);
              if (fraction < 0.10 || fraction > 0.94) continue;
              const perimeter = cv.arcLength(contour, true);
              for (const epsilon of [0.02, 0.035, 0.012]) {
                cv.approxPolyDP(contour, approx, perimeter * epsilon, true);
                if (approx.rows !== 4 || !cv.isContourConvex(approx)) continue;
                const points = Array.from({ length: 4 }, (_, j) => ({ x: approx.data32S[j * 2], y: approx.data32S[j * 2 + 1] }));
                const g = geometry(points, small.cols, small.rows);
                if (!g) continue;
                const cx = points.reduce((s, v) => s + v.x, 0) / 4 / small.cols;
                const cy = points.reduce((s, v) => s + v.y, 0) / 4 / small.rows;
                const center = Math.hypot(cx - 0.5, cy - 0.5);
                if (center > 0.27) continue;
                // Favor the exterior over artwork rectangles with similar proportions.
                const score = fraction * 1.5 + g.quality * 0.35 - center * 0.4;
                if (!best || score > best.score) best = { score, confidence: g.quality, corners: g.points.map(p => ({ x: p.x / scale, y: p.y / scale })) };
              }
            } finally { contour.delete(); approx.delete(); }
          }
        } finally { contours.delete(); hierarchy.delete(); }
      }
      if (!best || best.confidence < 0.55) throw new Error('Card boundaries are uncertain. Keep all four edges in view, reduce glare, and improve side lighting.');
      return best;
    } finally { small.delete(); gray.delete(); blur.delete(); edges.delete(); kernel.delete(); }
  }
  function sharpness(cv, src) {
    const small = new cv.Mat(), gray = new cv.Mat(), lap = new cv.Mat(), mean = new cv.Mat(), std = new cv.Mat();
    try {
      cv.resize(src, small, new cv.Size(360, Math.round(360 * 88 / 63)), 0, 0, cv.INTER_AREA);
      cv.cvtColor(small, gray, cv.COLOR_RGBA2GRAY); cv.Laplacian(gray, lap, cv.CV_64F);
      cv.meanStdDev(lap, mean, std); return std.data64F[0] ** 2;
    } finally { small.delete(); gray.delete(); lap.delete(); mean.delete(); std.delete(); }
  }
  function rectify(cv, src, detected, settings) {
    const p = detected.corners;
    const nativeWidth = (distance(p[0], p[1]) + distance(p[2], p[3])) / 2;
    const width = Math.floor(Math.min(settings.outputWidth, nativeWidth));
    if (width < 250) throw new Error('Card is too small in the camera frame. Move the phone closer or increase camera resolution.');
    const height = Math.round(width * 88 / 63);
    const from = cv.matFromArray(4, 1, cv.CV_32FC2, p.flatMap(v => [v.x, v.y]));
    const to = cv.matFromArray(4, 1, cv.CV_32FC2, [0, 0, width - 1, 0, width - 1, height - 1, 0, height - 1]);
    const matrix = cv.getPerspectiveTransform(from, to), output = new cv.Mat();
    try {
      cv.warpPerspective(src, output, matrix, new cv.Size(width, height), cv.INTER_CUBIC, cv.BORDER_REPLICATE);
      const focus = sharpness(cv, output);
      if (!Number.isFinite(focus) || focus < settings.minSharpness) throw new Error(`Image is too blurry (${Math.round(focus)} sharpness). Refocus, increase light, or increase stability delay.`);
      return { mat: output, width, height, sharpness: focus };
    } catch (error) { output.delete(); throw error; }
    finally { from.delete(); to.delete(); matrix.delete(); }
  }
  const canvas = (w, h) => {
    if (typeof OffscreenCanvas !== 'undefined') return new OffscreenCanvas(w, h);
    const c = document.createElement('canvas'); c.width = w; c.height = h; return c;
  };
  const encode = (c, quality) => c.convertToBlob ? c.convertToBlob({ type: 'image/jpeg', quality }) : new Promise((resolve, reject) => c.toBlob(b => b ? resolve(b) : reject(new Error('JPEG encoding failed.')), 'image/jpeg', quality));
  async function processCard(cv, bitmap, settings) {
    const start = performance.now();
    const input = canvas(bitmap.width, bitmap.height), context = input.getContext('2d', { willReadFrequently: true });
    context.drawImage(bitmap, 0, 0); bitmap.close?.();
    const imageData = context.getImageData(0, 0, input.width, input.height);
    const src = cv.matFromImageData(imageData);
    let corrected;
    try {
      const detected = findCard(cv, src);
      // Yield in the fallback path to keep controls operable between stages.
      await new Promise(r => setTimeout(r, 0));
      corrected = rectify(cv, src, detected, settings);
      const out = canvas(corrected.width, corrected.height), ctx = out.getContext('2d');
      ctx.putImageData(new ImageData(new Uint8ClampedArray(corrected.mat.data), corrected.width, corrected.height), 0, 0);
      const thumb = canvas(180, Math.round(180 * 88 / 63)); thumb.getContext('2d').drawImage(out, 0, 0, thumb.width, thumb.height);
      const [blob, thumbnail] = await Promise.all([encode(out, settings.quality), encode(thumb, 0.8)]);
      return { blob, thumbnail, width: corrected.width, height: corrected.height, corners: detected.corners, sharpness: corrected.sharpness, confidence: detected.confidence, processingMs: performance.now() - start };
    } finally { src.delete(); corrected?.mat.delete(); input.width = 1; input.height = 1; }
  }
  scope.CardVision = { orderCorners, geometry, findCard, sharpness, rectify, processCard };
})(globalThis);
