/**
 * Profondeur de champ à partir d'une carte de disparité (1/distance).
 *
 * Pour chaque pixel, le diamètre du cercle de confusion vaut
 *   c = f² / N · |1/z − 1/zₘ|   (f en mm, distances en m → c en µm·10³)
 * converti en pixels du viseur (capteur 24 × 36). Le flou est donc exact
 * devant ET derrière le plan net, et suit la focale, l'ouverture et la
 * distance de mise au point.
 *
 * Trois précautions évitent les défauts habituels du flou « par carte » :
 * - l'arrière-plan est flouté sans les pixels du sujet (pas de halo du sujet
 *   sur le fond) ;
 * - un premier plan flou déborde sur ce qui est derrière lui (comme en vrai),
 *   au lieu de garder un bord net ;
 * - les niveaux de flou sont interpolés (pas de paliers visibles).
 */
import { clamp } from '../camera/exposure';
import { ctx2d, makeCanvas } from '../scene/objects';

const SENSOR_W_MM = 36;
/**
 * Le viseur montre l'image en petit (~800 px de large) : on double le flou
 * pour qu'il reste aussi lisible qu'un tirage. Les proportions entre focales,
 * ouvertures et distances restent exactes.
 */
const DOF_GAIN = 2;
const MAX_RADIUS = 36;
const LEVELS = [0, 1, 2, 3.5, 5.5, 8, 11.5, 16, 22, 29, 36];

/** Rayon (px) du flou pour une disparité donnée. */
export function blurRadius(disp: number, focusDisp: number, aperture: number, focal: number, widthPx: number): number {
  const cMm = ((focal * focal) / aperture) * Math.abs(disp - focusDisp) / 1000;
  return clamp(((cMm / SENSOR_W_MM) * widthPx * DOF_GAIN) / 2, 0, MAX_RADIUS);
}

function blurred(src: HTMLCanvasElement, r: number): Uint8ClampedArray {
  const out = makeCanvas(src.width, src.height);
  const c = ctx2d(out);
  c.filter = `blur(${(r * 0.62).toFixed(2)}px)`;
  c.drawImage(src, 0, 0);
  return c.getImageData(0, 0, out.width, out.height).data;
}

/** Niveaux de flou de l'image complète, mémoïsés tant que le cadrage ne change pas. */
let plainCache: { src: HTMLCanvasElement; levels: Map<number, Uint8ClampedArray> } | null = null;
function plainLevel(src: HTMLCanvasElement, r: number): Uint8ClampedArray {
  if (!plainCache || plainCache.src !== src) plainCache = { src, levels: new Map() };
  let d = plainCache.levels.get(r);
  if (!d) { d = blurred(src, r); plainCache.levels.set(r, d); }
  return d;
}

/** Dilatation (maximum glissant) puis lissage d'une carte basse résolution. */
function spread(map: Float32Array, w: number, h: number, r: number): Float32Array {
  const tmp = new Float32Array(map.length);
  const out = new Float32Array(map.length);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    let m = 0;
    for (let k = Math.max(0, x - r); k <= Math.min(w - 1, x + r); k++) m = Math.max(m, map[y * w + k]);
    tmp[y * w + x] = m;
  }
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    let m = 0;
    for (let k = Math.max(0, y - r); k <= Math.min(h - 1, y + r); k++) m = Math.max(m, tmp[k * w + x]);
    out[y * w + x] = m;
  }
  // Lissage (moyenne glissante) : la transition du premier plan flou vers le
  // fond reste progressive, sans arête visible.
  const b = Math.max(1, Math.ceil(r / 2));
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    let sum = 0; let n = 0;
    for (let k = Math.max(0, x - b); k <= Math.min(w - 1, x + b); k++) { sum += out[y * w + k]; n++; }
    tmp[y * w + x] = sum / n;
  }
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    let sum = 0; let n = 0;
    for (let k = Math.max(0, y - b); k <= Math.min(h - 1, y + b); k++) { sum += tmp[k * w + x]; n++; }
    out[y * w + x] = sum / n;
  }
  return out;
}

/** Couleur interpolée entre deux niveaux de flou. */
function sampleLevels(levels: number[], data: Uint8ClampedArray[], r: number, p: number, out: number[]): void {
  let k = 1;
  while (k < levels.length - 1 && levels[k] < r) k++;
  const t = clamp((r - levels[k - 1]) / Math.max(levels[k] - levels[k - 1], 1e-3), 0, 1);
  const a = data[k - 1];
  const b = data[k];
  out[0] = a[p] + (b[p] - a[p]) * t;
  out[1] = a[p + 1] + (b[p + 1] - a[p + 1]) * t;
  out[2] = a[p + 2] + (b[p + 2] - a[p + 2]) * t;
  out[3] = Math.min(a[p + 3], b[p + 3]);
}

function bilinear(map: Float32Array, lw: number, lh: number, fx: number, fy: number): number {
  const x0 = Math.min(lw - 1, Math.floor(fx)); const y0 = Math.min(lh - 1, Math.floor(fy));
  const x1 = Math.min(lw - 1, x0 + 1); const y1 = Math.min(lh - 1, y0 + 1);
  const tx = fx - x0; const ty = fy - y0;
  const top = map[y0 * lw + x0] * (1 - tx) + map[y0 * lw + x1] * tx;
  const bot = map[y1 * lw + x0] * (1 - tx) + map[y1 * lw + x1] * tx;
  return top * (1 - ty) + bot * ty;
}

export function renderDepthOfField(
  src: HTMLCanvasElement,
  disp: Float32Array,
  focusDisp: number,
  aperture: number,
  focal: number
): HTMLCanvasElement {
  const w = src.width;
  const h = src.height;
  const n = w * h;
  const coc = new Float32Array(n);
  let maxR = 0;
  for (let i = 0; i < n; i++) {
    const r = blurRadius(disp[i], focusDisp, aperture, focal, w);
    coc[i] = r;
    if (r > maxR) maxR = r;
  }
  if (maxR < 0.5) return src;

  // Premier plan : son flou s'étale sur ce qui est derrière lui.
  const q = 4;
  const lw = Math.ceil(w / q);
  const lh = Math.ceil(h / q);
  const near = new Float32Array(lw * lh);
  let maxNear = 0;
  for (let y = 0; y < h; y += q) for (let x = 0; x < w; x += q) {
    const i = y * w + x;
    if (disp[i] > focusDisp && coc[i] > 0.5) {
      const j = (y / q) * lw + x / q;
      near[j] = Math.max(near[j], coc[i]);
      if (coc[i] > maxNear) maxNear = coc[i];
    }
  }
  const nearSpread = maxNear > 0.5 ? spread(near, lw, lh, Math.ceil(maxNear / q)) : null;

  // Fond sans le sujet ni le premier plan : évite le halo autour du sujet.
  const bgSrc = makeCanvas(w, h);
  const bctx = ctx2d(bgSrc);
  bctx.drawImage(src, 0, 0);
  const bgImg = bctx.getImageData(0, 0, w, h);
  for (let i = 0; i < n; i++) if (disp[i] >= focusDisp - 0.004) bgImg.data[i * 4 + 3] = 0;
  bctx.putImageData(bgImg, 0, 0);

  const original = ctx2d(src).getImageData(0, 0, w, h).data;
  const levels = LEVELS.filter((r, i) => i === 0 || LEVELS[i - 1] <= maxR);
  const plain: Uint8ClampedArray[] = levels.map((r) => (r === 0 ? original : plainLevel(src, r)));
  const bg: Uint8ClampedArray[] = levels.map((r) => (r === 0 ? original : blurred(bgSrc, r)));

  const out = makeCanvas(w, h);
  const octx = ctx2d(out);
  const res = octx.createImageData(w, h);
  const o = res.data;
  const base = [0, 0, 0, 0];
  const front = [0, 0, 0, 0];
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      const p = i * 4;
      const r = coc[i];
      const isNear = disp[i] > focusDisp;
      // Couleur propre au pixel : flou complet pour le premier plan, flou du
      // fond seul (sans le sujet) derrière le plan net.
      if (r < 0.5) {
        base[0] = original[p]; base[1] = original[p + 1]; base[2] = original[p + 2];
      } else if (isNear) {
        sampleLevels(levels, plain, r, p, base);
      } else {
        sampleLevels(levels, bg, r, p, base);
        // Zone du fond entièrement cachée par le sujet : repli sur l'image complète.
        if (base[3] < 24) sampleLevels(levels, plain, r, p, base);
      }
      // Débord progressif d'un premier plan flou sur ce qui est derrière lui.
      if (nearSpread && !isNear) {
        const s = bilinear(nearSpread, lw, lh, x / q, y / q);
        const wgt = clamp((s - r) / 6, 0, 1);
        if (wgt > 0.01) {
          sampleLevels(levels, plain, Math.max(r, s * 0.85), p, front);
          base[0] += (front[0] - base[0]) * wgt;
          base[1] += (front[1] - base[1]) * wgt;
          base[2] += (front[2] - base[2]) * wgt;
        }
      }
      o[p] = base[0]; o[p + 1] = base[1]; o[p + 2] = base[2]; o[p + 3] = 255;
    }
  }
  octx.putImageData(res, 0, 0);
  return out;
}

/**
 * Objet en rotation (sprite centré sur son axe) : flou de profondeur, puis
 * flou de filé = moyenne des positions sur l'angle parcouru pendant la pose.
 */
export function drawSpinner(
  ctx: CanvasRenderingContext2D,
  sprite: HTMLCanvasElement,
  cx: number,
  cy: number,
  size: number,
  rotation: number,
  arc: number
): void {
  const a = Math.min(Math.abs(arc), Math.PI * 2);
  const steps = a > 0.02 ? clamp(Math.ceil(a / 0.06), 2, 40) : 1;
  const pad = Math.ceil(size * 0.75);
  const acc = makeCanvas(pad * 2, pad * 2);
  const actx = ctx2d(acc);
  actx.globalCompositeOperation = 'lighter';
  actx.globalAlpha = 1 / steps;
  for (let i = 0; i < steps; i++) {
    actx.save();
    actx.translate(pad, pad);
    actx.rotate(rotation + (steps > 1 ? (a * i) / (steps - 1) : 0));
    actx.drawImage(sprite, -size / 2, -size / 2, size, size);
    actx.restore();
  }
  ctx.drawImage(acc, cx - pad, cy - pad);
}
