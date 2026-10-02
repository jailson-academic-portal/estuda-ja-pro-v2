/* ============================================================================
 * OMR — Optical Mark Recognition utilities (client-side, canvas-based).
 *
 * Pipeline:
 *   1. Convert a captured camera frame to grayscale on an HTMLCanvas.
 *   2. Find the four black corner fiducials printed on the answer sheet by
 *      searching the darkest blob centroid inside each page quadrant.
 *   3. Compute a perspective transform (homography) that maps PDF-point
 *      coordinates from the printed layout to pixel coordinates in the photo.
 *   4. For every bubble in the stored layout, sample mean darkness inside the
 *      bubble disc and a surrounding annulus, then classify as marked /
 *      unmarked / ambiguous.
 * ========================================================================== */

export type Point = { x: number; y: number };

export type OMRBubble = { label: string; x: number; y: number; r: number };
export type OMRQuestion = {
  question_id: string;
  qtype: "multiple_choice" | "true_false" | "fill_blank" | "essay";
  bubbles: OMRBubble[];
};
export type OMRLayout = {
  page: { w: number; h: number };
  fiducials: { tl: Point; tr: Point; bl: Point; br: Point };
  fiducial_size: number;
  questions: OMRQuestion[];
};

type RgbaImage = { data: Uint8ClampedArray; W: number; H: number };

export type DetectedAnswer = {
  question_id: string;
  qtype: OMRQuestion["qtype"];
  picked: string | null;
  fills: Array<{ label: string; ratio: number }>;
  ambiguous: boolean;
  reason?: string;
  confidence?: number;
};

/* ----- 4-point homography solver (PDF pts → image pixels) ------------------ */
function solveHomography(src: Point[], dst: Point[]): number[] {
  // Build 8x9 augmented system from 4 point pairs.
  const A: number[][] = [];
  for (let i = 0; i < 4; i++) {
    const { x: X, y: Y } = src[i];
    const { x: u, y: v } = dst[i];
    A.push([X, Y, 1, 0, 0, 0, -u * X, -u * Y, u]);
    A.push([0, 0, 0, X, Y, 1, -v * X, -v * Y, v]);
  }
  // Gauss-Jordan elimination.
  for (let col = 0; col < 8; col++) {
    let piv = col;
    for (let r = col + 1; r < 8; r++) if (Math.abs(A[r][col]) > Math.abs(A[piv][col])) piv = r;
    if (piv !== col) [A[col], A[piv]] = [A[piv], A[col]];
    const d = A[col][col];
    if (Math.abs(d) < 1e-12) throw new Error("Matriz singular ao calcular alinhamento.");
    for (let c = col; c < 9; c++) A[col][c] /= d;
    for (let r = 0; r < 8; r++) {
      if (r === col) continue;
      const f = A[r][col];
      if (!f) continue;
      for (let c = col; c < 9; c++) A[r][c] -= f * A[col][c];
    }
  }
  const h = [A[0][8], A[1][8], A[2][8], A[3][8], A[4][8], A[5][8], A[6][8], A[7][8], 1];
  return h;
}

function applyHomography(h: number[], p: Point): Point {
  const w = h[6] * p.x + h[7] * p.y + h[8];
  return {
    x: (h[0] * p.x + h[1] * p.y + h[2]) / w,
    y: (h[3] * p.x + h[4] * p.y + h[5]) / w,
  };
}

function invertHomography(h: number[]): number[] {
  const [a, b, c, d, e, f, g, i, j] = h;
  const A = e * j - f * i;
  const B = c * i - b * j;
  const C = b * f - c * e;
  const D = f * g - d * j;
  const E = a * j - c * g;
  const F = c * d - a * f;
  const G = d * i - e * g;
  const I = b * g - a * i;
  const J = a * e - b * d;
  const det = a * A + b * D + c * G;
  if (Math.abs(det) < 1e-12) throw new Error("Matriz singular ao validar alinhamento.");
  return [A / det, B / det, C / det, D / det, E / det, F / det, G / det, I / det, J / det];
}

/* ----- grayscale + fiducial detection -------------------------------------- */
function toGrayscale(data: Uint8ClampedArray, w: number, h: number): Uint8Array {
  const out = new Uint8Array(w * h);
  for (let i = 0, j = 0; i < data.length; i += 4, j++) {
    out[j] = (data[i] * 299 + data[i + 1] * 587 + data[i + 2] * 114) / 1000;
  }
  return out;
}

/** Find darkest blob centroid inside a rectangular search window. */
function findDarkBlob(
  gray: Uint8Array,
  W: number,
  H: number,
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  target?: Point,
): Point | null {
  x0 = Math.max(0, x0 | 0);
  y0 = Math.max(0, y0 | 0);
  x1 = Math.min(W, x1 | 0);
  y1 = Math.min(H, y1 | 0);
  // Otsu threshold on the window.
  const hist = new Int32Array(256);
  let n = 0;
  for (let y = y0; y < y1; y++)
    for (let x = x0; x < x1; x++) {
      hist[gray[y * W + x]]++;
      n++;
    }
  if (!n) return null;
  let sum = 0;
  for (let i = 0; i < 256; i++) sum += i * hist[i];
  let sumB = 0,
    wB = 0,
    maxVar = -1,
    thr = 80;
  for (let i = 0; i < 256; i++) {
    wB += hist[i];
    if (!wB) continue;
    const wF = n - wB;
    if (!wF) break;
    sumB += i * hist[i];
    const mB = sumB / wB,
      mF = (sum - sumB) / wF;
    const v = wB * wF * (mB - mF) * (mB - mF);
    if (v > maxVar) {
      maxVar = v;
      thr = i;
    }
  }
  thr = Math.min(thr, 110); // never accept very pale "dark"
  // Find connected components of dark pixels, keep the most compact-square one.
  const visited = new Uint8Array((x1 - x0) * (y1 - y0));
  const wWin = x1 - x0;
  let best: { area: number; cx: number; cy: number; aspect: number; score: number } | null = null;
  const stack: number[] = [];
  for (let y = y0; y < y1; y++) {
    for (let x = x0; x < x1; x++) {
      const idxWin = (y - y0) * wWin + (x - x0);
      if (visited[idxWin]) continue;
      if (gray[y * W + x] > thr) {
        visited[idxWin] = 1;
        continue;
      }
      // BFS / DFS
      stack.length = 0;
      stack.push(x, y);
      let area = 0,
        sx = 0,
        sy = 0;
      let minX = x,
        maxX = x,
        minY = y,
        maxY = y;
      while (stack.length) {
        const py = stack.pop()!;
        const px = stack.pop()!;
        const i2 = (py - y0) * wWin + (px - x0);
        if (visited[i2]) continue;
        visited[i2] = 1;
        if (gray[py * W + px] > thr) continue;
        area++;
        sx += px;
        sy += py;
        if (px < minX) minX = px;
        if (px > maxX) maxX = px;
        if (py < minY) minY = py;
        if (py > maxY) maxY = py;
        if (px + 1 < x1) stack.push(px + 1, py);
        if (px - 1 >= x0) stack.push(px - 1, py);
        if (py + 1 < y1) stack.push(px, py + 1);
        if (py - 1 >= y0) stack.push(px, py - 1);
      }
      if (area < 25) continue;
      const bw = maxX - minX + 1,
        bh = maxY - minY + 1;
      const aspect = Math.min(bw, bh) / Math.max(bw, bh);
      const density = area / Math.max(1, bw * bh);
      const maxSquareDim = Math.max(18, Math.min(W, H) * 0.07);
      if (aspect < 0.55) continue; // ignore long edges / text
      if (density < 0.35) continue; // ignore sparse QR clusters / outlines
      if (bw > maxSquareDim || bh > maxSquareDim) continue; // ignore QR-code blocks and large graphics
      const cx = sx / area,
        cy = sy / area;
      const distPenalty = target
        ? Math.hypot(cx - target.x, cy - target.y) / Math.max(32, Math.min(W, H) * 0.08)
        : 0;
      const score = (area * aspect) / (1 + distPenalty * distPenalty);
      if (!best || score > best.score) best = { area, cx, cy, aspect, score };
    }
  }
  return best ? { x: best.cx, y: best.cy } : null;
}

function findFiducialNear(gray: Uint8Array, W: number, H: number, expected: Point): Point | null {
  const winW = Math.max(W * 0.18, 90);
  const winH = Math.max(H * 0.18, 90);
  return findDarkBlob(
    gray,
    W,
    H,
    expected.x - winW / 2,
    expected.y - winH / 2,
    expected.x + winW / 2,
    expected.y + winH / 2,
    expected,
  );
}

type MarkerCandidate = Point & {
  area: number;
  w: number;
  h: number;
  density: number;
  score: number;
};

function isNeutralDark(data: Uint8ClampedArray, gray: Uint8Array, idx: number): boolean {
  const rgba = idx * 4;
  const r = data[rgba],
    g = data[rgba + 1],
    b = data[rgba + 2];
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const sat = max > 0 ? (max - min) / max : 0;
  // Fiducials are printed black, but phone photos often shift them toward
  // green/yellow under shadows. Keep this relaxed enough to retain all four
  // square markers while still excluding saturated blue/purple pen marks.
  return gray[idx] < 132 && sat < 0.34 && max - min < 54;
}

function findSquareMarkerCandidates(gray: Uint8Array, img: RgbaImage): MarkerCandidate[] {
  const { W, H, data } = img;
  const visited = new Uint8Array(W * H);
  const minDim = Math.min(W, H);
  const minSide = Math.max(7, minDim * 0.008);
  const maxSide = Math.max(36, minDim * 0.12);
  const out: MarkerCandidate[] = [];
  const stack: number[] = [];

  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++) {
      const idx = y * W + x;
      if (visited[idx]) continue;
      if (!isNeutralDark(data, gray, idx)) {
        visited[idx] = 1;
        continue;
      }
      stack.length = 0;
      stack.push(x, y);
      let area = 0,
        sx = 0,
        sy = 0;
      let minX = x,
        maxX = x,
        minY = y,
        maxY = y;
      while (stack.length) {
        const py = stack.pop()!;
        const px = stack.pop()!;
        if (px < 0 || px >= W || py < 0 || py >= H) continue;
        const i2 = py * W + px;
        if (visited[i2]) continue;
        visited[i2] = 1;
        if (!isNeutralDark(data, gray, i2)) continue;
        area++;
        sx += px;
        sy += py;
        if (px < minX) minX = px;
        if (px > maxX) maxX = px;
        if (py < minY) minY = py;
        if (py > maxY) maxY = py;
        stack.push(px + 1, py, px - 1, py, px, py + 1, px, py - 1);
      }
      if (area < 32) continue;
      const bw = maxX - minX + 1,
        bh = maxY - minY + 1;
      if (bw < minSide || bh < minSide || bw > maxSide || bh > maxSide) continue;
      const aspect = Math.min(bw, bh) / Math.max(bw, bh);
      const density = area / Math.max(1, bw * bh);
      if (aspect < 0.66 || density < 0.46) continue;
      const score = area * density * aspect;
      out.push({ x: sx / area, y: sy / area, area, w: bw, h: bh, density, score });
    }
  return out.sort((a, b) => b.score - a.score).slice(0, 34);
}

function orderAsCorners(
  points: MarkerCandidate[],
): { tl: Point; tr: Point; bl: Point; br: Point } | null {
  const tl = points.reduce((best, p) => (p.x + p.y < best.x + best.y ? p : best));
  const br = points.reduce((best, p) => (p.x + p.y > best.x + best.y ? p : best));
  const tr = points.reduce((best, p) => (p.x - p.y > best.x - best.y ? p : best));
  const bl = points.reduce((best, p) => (p.x - p.y < best.x - best.y ? p : best));
  if (new Set([tl, tr, bl, br]).size !== 4) return null;
  return { tl, tr, bl, br };
}

function chooseFiducialQuad(
  candidates: MarkerCandidate[],
  layout: OMRLayout,
  W: number,
  H: number,
): { tl: Point; tr: Point; bl: Point; br: Point } | null {
  if (candidates.length < 4) return null;
  const sourceW = Math.hypot(
    layout.fiducials.tr.x - layout.fiducials.tl.x,
    layout.fiducials.tr.y - layout.fiducials.tl.y,
  );
  const sourceH = Math.hypot(
    layout.fiducials.bl.x - layout.fiducials.tl.x,
    layout.fiducials.bl.y - layout.fiducials.tl.y,
  );
  const expectedAspect = sourceW / Math.max(1, sourceH);
  const minDim = Math.min(W, H);
  let best: { quad: { tl: Point; tr: Point; bl: Point; br: Point }; score: number } | null = null;

  for (let a = 0; a < candidates.length - 3; a++)
    for (let b = a + 1; b < candidates.length - 2; b++) {
      for (let c = b + 1; c < candidates.length - 1; c++)
        for (let d = c + 1; d < candidates.length; d++) {
          const group = [candidates[a], candidates[b], candidates[c], candidates[d]];
          const quad = orderAsCorners(group);
          if (!quad) continue;
          const topW = Math.hypot(quad.tr.x - quad.tl.x, quad.tr.y - quad.tl.y);
          const botW = Math.hypot(quad.br.x - quad.bl.x, quad.br.y - quad.bl.y);
          const leftH = Math.hypot(quad.bl.x - quad.tl.x, quad.bl.y - quad.tl.y);
          const rightH = Math.hypot(quad.br.x - quad.tr.x, quad.br.y - quad.tr.y);
          const width = (topW + botW) / 2;
          const height = (leftH + rightH) / 2;
          if (width < minDim * 0.18 || height < minDim * 0.12) continue;
          const aspectPenalty = Math.abs(Math.log(width / Math.max(1, height) / expectedAspect));
          const balancePenalty =
            Math.abs(Math.log(topW / Math.max(1, botW))) +
            Math.abs(Math.log(leftH / Math.max(1, rightH)));
          const diagPenalty = Math.abs(
            Math.log(
              Math.hypot(quad.br.x - quad.tl.x, quad.br.y - quad.tl.y) /
                Math.max(1, Math.hypot(quad.bl.x - quad.tr.x, quad.bl.y - quad.tr.y)),
            ),
          );
          const markerScore = group.reduce((sum, p) => sum + Math.log(1 + p.score), 0) / 4;
          const coverage = Math.sqrt(width * height) / minDim;
          const score =
            markerScore +
            coverage * 1.6 -
            aspectPenalty * 2.2 -
            balancePenalty * 1.1 -
            diagPenalty * 0.8;
          if (!best || score > best.score) best = { quad, score };
        }
    }
  return best?.quad ?? null;
}

/* ----- bubble sampling ----------------------------------------------------- */
function clamp01(v: number): number {
  return Math.max(0, Math.min(1, v));
}

function sampleMarkedRatio(
  gray: Uint8Array,
  img: RgbaImage,
  cx: number,
  cy: number,
  radius: number,
  paperGray: number,
): number {
  let hitWeight = 0,
    totalWeight = 0,
    darkEnergy = 0,
    chromaEnergy = 0;
  const r = radius * 0.86;
  const r2 = r * r;
  const x0 = Math.max(0, Math.floor(cx - r));
  const x1 = Math.min(img.W, Math.ceil(cx + r));
  const y0 = Math.max(0, Math.floor(cy - r));
  const y1 = Math.min(img.H, Math.ceil(cy + r));
  const darkDelta = Math.max(28, paperGray * 0.15);

  for (let y = y0; y < y1; y++)
    for (let x = x0; x < x1; x++) {
      const dx = x - cx,
        dy = y - cy;
      const d2 = dx * dx + dy * dy;
      if (d2 > r2) continue;
      const dist = Math.sqrt(d2) / r;
      // The printed letter is centered and the printed outline is on the rim.
      // Down-weight both zones and prioritize the inner ring where a real fill appears.
      const zoneWeight = dist < 0.24 ? 0.28 : dist > 0.76 ? 0.45 : 1;
      const gi = y * img.W + x;
      const rgba = gi * 4;
      const rr = img.data[rgba],
        gg = img.data[rgba + 1],
        bb = img.data[rgba + 2];
      const g = gray[gi];
      const maxCh = Math.max(rr, gg, bb);
      const minCh = Math.min(rr, gg, bb);
      const sat = maxCh > 0 ? (maxCh - minCh) / maxCh : 0;
      const delta = Math.max(0, paperGray - g);
      const blueInk = sat > 0.13 && bb > gg + 7 && delta > 5;
      const purpleBlueInk = sat > 0.15 && rr > gg + 8 && bb > gg + 8 && delta > 4;
      const blackInk = delta > darkDelta && sat < 0.38;
      const marked = blueInk || purpleBlueInk || blackInk || delta > darkDelta * 1.65;
      if (marked) hitWeight += zoneWeight;
      darkEnergy += zoneWeight * clamp01(delta / Math.max(42, paperGray * 0.34));
      if (blueInk || purpleBlueInk) chromaEnergy += zoneWeight * clamp01((sat - 0.08) / 0.34);
      totalWeight += zoneWeight;
    }
  if (!totalWeight) return 0;
  const hitFraction = hitWeight / totalWeight;
  const darknessFraction = darkEnergy / totalWeight;
  const colorFraction = chromaEnergy / totalWeight;
  return clamp01(Math.max(hitFraction, darknessFraction * 0.72) + colorFraction * 0.42);
}

function sampleAnnulus(
  gray: Uint8Array,
  W: number,
  H: number,
  cx: number,
  cy: number,
  rIn: number,
  rOut: number,
): number {
  let sum = 0,
    n = 0;
  const r2In = rIn * rIn,
    r2Out = rOut * rOut;
  const x0 = Math.max(0, Math.floor(cx - rOut));
  const x1 = Math.min(W, Math.ceil(cx + rOut));
  const y0 = Math.max(0, Math.floor(cy - rOut));
  const y1 = Math.min(H, Math.ceil(cy + rOut));
  for (let y = y0; y < y1; y++)
    for (let x = x0; x < x1; x++) {
      const dx = x - cx,
        dy = y - cy;
      const d2 = dx * dx + dy * dy;
      if (d2 > r2In && d2 <= r2Out) {
        sum += gray[y * W + x];
        n++;
      }
    }
  return n ? sum / n : 255;
}

function refineBubbleCenter(
  gray: Uint8Array,
  img: RgbaImage,
  cx: number,
  cy: number,
  radius: number,
  paperGray: number,
): Point {
  let best = { x: cx, y: cy, score: -1 };
  const step = Math.max(1, radius * 0.22);
  const search = Math.max(2, radius * 0.72);
  for (let oy = -search; oy <= search; oy += step)
    for (let ox = -search; ox <= search; ox += step) {
      const x = cx + ox,
        y = cy + oy;
      if (x < radius || y < radius || x >= img.W - radius || y >= img.H - radius) continue;
      const fill = sampleMarkedRatio(gray, img, x, y, radius, paperGray);
      const rim = 255 - sampleAnnulus(gray, img.W, img.H, x, y, radius * 0.82, radius * 1.28);
      const distancePenalty = Math.hypot(ox, oy) / Math.max(1, search);
      const score = fill * 1.8 + clamp01(rim / 120) * 0.55 - distancePenalty * 0.2;
      if (score > best.score) best = { x, y, score };
    }
  return { x: best.x, y: best.y };
}

function quadQuality(
  quad: { tl: Point; tr: Point; bl: Point; br: Point },
  layout: OMRLayout,
): number {
  const sourceW = Math.hypot(
    layout.fiducials.tr.x - layout.fiducials.tl.x,
    layout.fiducials.tr.y - layout.fiducials.tl.y,
  );
  const sourceH = Math.hypot(
    layout.fiducials.bl.x - layout.fiducials.tl.x,
    layout.fiducials.bl.y - layout.fiducials.tl.y,
  );
  const expectedAspect = sourceW / Math.max(1, sourceH);
  const topW = Math.hypot(quad.tr.x - quad.tl.x, quad.tr.y - quad.tl.y);
  const botW = Math.hypot(quad.br.x - quad.bl.x, quad.br.y - quad.bl.y);
  const leftH = Math.hypot(quad.bl.x - quad.tl.x, quad.bl.y - quad.tl.y);
  const rightH = Math.hypot(quad.br.x - quad.tr.x, quad.br.y - quad.tr.y);
  const width = (topW + botW) / 2;
  const height = (leftH + rightH) / 2;
  const aspectError = Math.abs(Math.log(width / Math.max(1, height) / expectedAspect));
  const balanceError =
    Math.abs(Math.log(topW / Math.max(1, botW))) + Math.abs(Math.log(leftH / Math.max(1, rightH)));
  const crossError = Math.abs(
    Math.log(
      Math.hypot(quad.br.x - quad.tl.x, quad.br.y - quad.tl.y) /
        Math.max(1, Math.hypot(quad.bl.x - quad.tr.x, quad.bl.y - quad.tr.y)),
    ),
  );
  return aspectError + balanceError * 0.75 + crossError * 0.45;
}

/* ----- main entry ---------------------------------------------------------- */
export type ProcessResult = {
  detected: DetectedAnswer[];
  warnings: string[];
};

export function processOMR(canvas: HTMLCanvasElement, layout: OMRLayout): ProcessResult {
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) throw new Error("Canvas indisponível.");
  const W = canvas.width,
    H = canvas.height;
  const img = ctx.getImageData(0, 0, W, H);
  const gray = toGrayscale(img.data, W, H);

  // 1. Detect the four OMR-block fiducials. They are not page-corner markers,
  // so search near their stored layout positions instead of blindly splitting
  // the camera frame into quadrants (which can pick QR-code squares by mistake).
  const pageH = layout.page.h;
  const expected = {
    tl: {
      x: (layout.fiducials.tl.x / layout.page.w) * W,
      y: ((pageH - layout.fiducials.tl.y) / pageH) * H,
    },
    tr: {
      x: (layout.fiducials.tr.x / layout.page.w) * W,
      y: ((pageH - layout.fiducials.tr.y) / pageH) * H,
    },
    bl: {
      x: (layout.fiducials.bl.x / layout.page.w) * W,
      y: ((pageH - layout.fiducials.bl.y) / pageH) * H,
    },
    br: {
      x: (layout.fiducials.br.x / layout.page.w) * W,
      y: ((pageH - layout.fiducials.br.y) / pageH) * H,
    },
  };
  const markerQuad = chooseFiducialQuad(
    findSquareMarkerCandidates(gray, { data: img.data, W, H }),
    layout,
    W,
    H,
  );
  const halfW = W / 2,
    halfH = H / 2;
  const tl =
    markerQuad?.tl ??
    findFiducialNear(gray, W, H, expected.tl) ??
    findDarkBlob(gray, W, H, 0, 0, halfW, halfH);
  const tr =
    markerQuad?.tr ??
    findFiducialNear(gray, W, H, expected.tr) ??
    findDarkBlob(gray, W, H, halfW, 0, W, halfH);
  const bl =
    markerQuad?.bl ??
    findFiducialNear(gray, W, H, expected.bl) ??
    findDarkBlob(gray, W, H, 0, halfH, halfW, H);
  const br =
    markerQuad?.br ??
    findFiducialNear(gray, W, H, expected.br) ??
    findDarkBlob(gray, W, H, halfW, halfH, W, H);
  if (!tl || !tr || !bl || !br) {
    throw new Error(
      "Não foi possível localizar os 4 marcadores pretos da folha. Enquadre a folha inteira sob boa iluminação e tente novamente.",
    );
  }

  // 2. Build homography from PDF coords (origin bottom-left) → image pixels (origin top-left).
  const srcPts: Point[] = [
    { x: layout.fiducials.tl.x, y: pageH - layout.fiducials.tl.y },
    { x: layout.fiducials.tr.x, y: pageH - layout.fiducials.tr.y },
    { x: layout.fiducials.bl.x, y: pageH - layout.fiducials.bl.y },
    { x: layout.fiducials.br.x, y: pageH - layout.fiducials.br.y },
  ];
  const dstPts: Point[] = [tl, tr, bl, br];
  const h = solveHomography(srcPts, dstPts);
  const invH = invertHomography(h);
  const alignmentError =
    dstPts.reduce((sum, p, idx) => {
      const back = applyHomography(invH, p);
      return sum + Math.hypot(back.x - srcPts[idx].x, back.y - srcPts[idx].y);
    }, 0) / dstPts.length;
  const quality = quadQuality({ tl, tr, bl, br }, layout);
  if (alignmentError > 2.5 || quality > 0.48) {
    throw new Error(
      "Alinhamento inseguro dos marcadores pretos. Enquadre o bloco de gabarito inteiro, sem cortar os 4 quadrados, e tente novamente.",
    );
  }

  // 3. Estimate effective bubble radius in pixels from the homography scale.
  const scaleX =
    Math.hypot(tr.x - tl.x, tr.y - tl.y) /
    Math.hypot(srcPts[1].x - srcPts[0].x, srcPts[1].y - srcPts[0].y);
  const scaleY =
    Math.hypot(bl.x - tl.x, bl.y - tl.y) /
    Math.hypot(srcPts[2].x - srcPts[0].x, srcPts[2].y - srcPts[0].y);
  const scale = (scaleX + scaleY) / 2;

  const warnings: string[] = [];
  const detected: DetectedAnswer[] = [];
  for (const q of layout.questions) {
    if (q.qtype !== "multiple_choice" && q.qtype !== "true_false") {
      detected.push({
        question_id: q.question_id,
        qtype: q.qtype,
        picked: null,
        fills: [],
        ambiguous: false,
      });
      continue;
    }
    const fills: Array<{ label: string; ratio: number }> = [];
    for (const b of q.bubbles) {
      const src: Point = { x: b.x, y: pageH - b.y };
      const dst = applyHomography(h, src);
      const rPx = Math.max(4, b.r * scale * 0.92);
      const around = sampleAnnulus(gray, W, H, dst.x, dst.y, rPx * 1.65, rPx * 2.65);
      const center = refineBubbleCenter(gray, { data: img.data, W, H }, dst.x, dst.y, rPx, around);
      // Count real ink inside the bubble, not only grayscale delta. This catches
      // both black and blue pen marks and avoids treating the printed outline as a mark.
      const ratio = Math.max(
        0,
        Math.min(
          1,
          sampleMarkedRatio(gray, { data: img.data, W, H }, center.x, center.y, rPx, around),
        ),
      );
      fills.push({ label: b.label, ratio });
    }
    // Sort descending by fill ratio.
    const sorted = [...fills].sort((a, b) => b.ratio - a.ratio);
    const top = sorted[0],
      second = sorted[1];
    const ratios = sorted.map((f) => f.ratio);
    const lowGroup = ratios.slice(Math.max(1, Math.ceil(ratios.length / 2)));
    const baseline = lowGroup.length
      ? lowGroup.reduce((sum, r) => sum + r, 0) / lowGroup.length
      : 0;
    const spread = top && second ? top.ratio - second.ratio : (top?.ratio ?? 0);
    const MARK_THRESHOLD = 0.18;
    const STRONG_THRESHOLD = 0.27;
    const MIN_ADAPTIVE = 0.135;
    const MIN_SPREAD = 0.055;
    const SAFE_SPREAD = 0.075;
    let picked: string | null = null;
    let ambiguous = false;
    let reason: string | undefined;
    let confidence = 0;
    const adaptiveMarked =
      !!top &&
      top.ratio >= MIN_ADAPTIVE &&
      top.ratio >= baseline + 0.055 &&
      (!second || spread >= MIN_SPREAD);
    if (top)
      confidence = clamp01(
        top.ratio * 0.9 + spread * 2.2 + Math.max(0, top.ratio - baseline) * 0.85 - baseline * 0.35,
      );
    if (!top || (top.ratio < MARK_THRESHOLD && !adaptiveMarked)) {
      picked = null;
      ambiguous = false; // genuinely blank — teacher can override on review screen
    } else if ((!second || spread >= SAFE_SPREAD) && confidence >= 0.52) {
      picked = top.label;
      ambiguous = top.ratio < STRONG_THRESHOLD || confidence < 0.68;
      reason = ambiguous
        ? `Marcação provável (${top.label}: ${(top.ratio * 100).toFixed(0)}%) — confirme.`
        : undefined;
    } else if (adaptiveMarked && confidence >= 0.45) {
      picked = top.label;
      ambiguous = true;
      reason = `Marcação provável (${top.label}: ${(top.ratio * 100).toFixed(0)}%) — confirme.`;
    } else {
      picked = null;
      ambiguous = true;
      reason = second
        ? `Leitura insegura (${top.label}: ${(top.ratio * 100).toFixed(0)}% / ${second.label}: ${(second.ratio * 100).toFixed(0)}%) — selecione manualmente.`
        : `Leitura insegura (${top.label}: ${(top.ratio * 100).toFixed(0)}%) — selecione manualmente.`;
    }
    detected.push({
      question_id: q.question_id,
      qtype: q.qtype,
      picked,
      fills,
      ambiguous,
      reason,
      confidence,
    });
  }

  return { detected, warnings };
}
