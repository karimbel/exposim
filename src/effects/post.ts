import { clamp, log2 } from '../camera/exposure';
import { makeCanvas, ctx2d } from '../scene/objects';

/* --------------------------- Effets & paramètres ------------------------ */

export interface PostParams {
  /** ratio d'exposition (1 = correct, 2 = +1 IL, 0,5 = −1 IL) */
  exposure: number;
  iso: number;
  /** Température de couleur choisie (K). */
  temperatureK: number;
  /** Température d'origine de l'image (K) : à cette valeur, les couleurs restent inchangées. */
  referenceK?: number;
  /** 0..1 flou de bougé (sans trépied) */
  shakeAmount: number;
  /** 0..1 filé du sujet */
  motionAmount: number;
}

/**
 * Longueur du flou de bougé à main levée, en pixels du viseur (1 050 px de
 * large). Le tremblement de la main est un petit mouvement angulaire : sur
 * l'image, il grandit avec la focale et avec la durée de pose. On retrouve
 * la règle du « 1/focale » : à 1/focale s le flou reste sous le pixel, il se
 * voit à deux fois plus lent et s'allonge ensuite avec la pose.
 */
export function shakeLengthPx(shutter: number, focal: number, tripod: boolean): number {
  if (tripod) return 0;
  return Math.min(1.1 * focal * shutter, 120);
}

/** Vitesse minimale conseillée à main levée (règle du 1/focale), arrondie au cran standard. */
export function handheldMinShutter(focal: number): number {
  const stops = [1 / 30, 1 / 60, 1 / 125, 1 / 250, 1 / 500];
  return stops.find((t) => t <= 1 / focal) ?? stops[stops.length - 1];
}

/** Filé du sujet : perceptible seulement aux vitesses réellement lentes. */
export function motionAmount(shutter: number): number {
  const s = Math.max(shutter, 1 / 8000);
  return clamp((log2(s) - log2(1 / 30)) / 5, 0, 1);
}

/* ------------------------------ Post-processing -------------------------- */

/* ---------------------- lumière linéaire & couleur ---------------------- */

const SRGB_TO_LINEAR = new Float32Array(256);
for (let v = 0; v < 256; v++) {
  const c = v / 255;
  SRGB_TO_LINEAR[v] = c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
}

/**
 * Épaule des hautes lumières : linéaire jusqu'à 90 %, puis approche douce du
 * blanc. Les zones très surexposées finissent bien brûlées, sans les aplats
 * colorés d'un écrêtage brutal canal par canal.
 */
function highlightShoulder(l: number): number {
  const knee = 0.9;
  if (l <= knee) return l;
  const room = 1 - knee;
  return knee + room * (1 - Math.exp(-(l - knee) / room));
}

function linearToSrgb8(linear: number): number {
  const l = highlightShoulder(linear);
  const c = l <= 0.0031308 ? l * 12.92 : 1.055 * Math.pow(l, 1 / 2.4) - 0.055;
  return Math.round(clamp(c, 0, 1) * 255);
}

/** Couleur approximative d'un corps noir (K → RGB sRGB 0..255), d'après Tanner Helland. */
export function kelvinToRgb(kelvin: number): [number, number, number] {
  const t = clamp(kelvin, 1000, 40000) / 100;
  const r = t <= 66 ? 255 : 329.698727446 * Math.pow(t - 60, -0.1332047592);
  const g = t <= 66
    ? 99.4708025861 * Math.log(t) - 161.1195681661
    : 288.1221695283 * Math.pow(t - 60, -0.0755148492);
  const b = t >= 66 ? 255 : t <= 19 ? 0 : 138.5177312231 * Math.log(t - 10) - 305.0447927307;
  return [clamp(r, 0, 255), clamp(g, 0, 255), clamp(b, 0, 255)];
}

/** Balance des blancs de l'appareil : réglée sur la lumière du jour. */
export const CAMERA_WHITE_BALANCE_K = 5500;

/**
 * Gains RVB (en lumière linéaire) d'une scène éclairée à `kelvin` vue par un
 * appareil réglé sur la lumière du jour : bougie → orangé, ombre → bleuté.
 * Les gains sont normalisés pour ne pas modifier la luminance globale.
 */
export function whiteBalanceGains(kelvin: number): [number, number, number] {
  const light = kelvinToRgb(kelvin);
  const ref = kelvinToRgb(CAMERA_WHITE_BALANCE_K);
  // Atténuation (en log) : une dominante lisible sans éteindre un canal entier.
  const strength = 0.75;
  const gains = light.map((v, i) => {
    const ratio = Math.max(SRGB_TO_LINEAR[Math.round(v)], 0.02) / SRGB_TO_LINEAR[Math.round(ref[i])];
    return Math.exp(strength * Math.log(ratio));
  }) as [number, number, number];
  const luminance = gains[0] * 0.2126 + gains[1] * 0.7152 + gains[2] * 0.0722;
  return [gains[0] / luminance, gains[1] / luminance, gains[2] / luminance];
}

/**
 * Exposition et couleur en lumière linéaire : chaque IL double la lumière,
 * et ce qui dépasse le blanc est écrêté (hautes lumières brûlées), comme sur
 * un capteur réel. À 0 IL et 5 500 K, l'image est quasiment inchangée.
 */
function applyExposure(img: HTMLCanvasElement, exposure: number, temperatureK: number, referenceK = CAMERA_WHITE_BALANCE_K): HTMLCanvasElement {
  const stops = clamp(Math.log2(Math.max(exposure, 1e-6)), -6, 6);
  const gain = Math.pow(2, stops);
  // Teinte relative à la lumière d'origine de l'image : une scène déjà
  // orangée (coucher de soleil) ne le devient pas une seconde fois.
  const target = whiteBalanceGains(temperatureK);
  const ref = whiteBalanceGains(referenceK);
  const wb = target.map((g, i) => g / ref[i]);
  const luts = wb.map((channelGain) => {
    const lut = new Uint8ClampedArray(256);
    for (let v = 0; v < 256; v++) lut[v] = linearToSrgb8(SRGB_TO_LINEAR[v] * gain * channelGain);
    return lut;
  });

  const out = makeCanvas(img.width, img.height);
  const ctx = ctx2d(out);
  ctx.drawImage(img, 0, 0);
  const id = ctx.getImageData(0, 0, out.width, out.height);
  const d = id.data;
  const [lr, lg, lb] = luts;
  for (let i = 0; i < d.length; i += 4) {
    d[i] = lr[d[i]];
    d[i + 1] = lg[d[i + 1]];
    d[i + 2] = lb[d[i + 2]];
  }
  ctx.putImageData(id, 0, 0);
  return out;
}

/** Exposition et couleur seules, pour un calque superposé au viseur (élément animé). */
export function exposeLayer(img: HTMLCanvasElement, exposure: number, temperatureK: number, referenceK?: number): HTMLCanvasElement {
  return applyExposure(img, exposure, temperatureK, referenceK);
}

function addGrain(img: HTMLCanvasElement, iso: number): HTMLCanvasElement {
  const amp = clamp(Math.sqrt(iso / 100) * 14 - 12, 0, 34);
  if (amp < 0.5) return img;
  const out = makeCanvas(img.width, img.height);
  const ctx = ctx2d(out);
  ctx.drawImage(img, 0, 0);
  const id = ctx.getImageData(0, 0, out.width, out.height);
  const d = id.data;
  const chroma = amp * 0.28;
  for (let i = 0; i < d.length; i += 4) {
    // Bruit de luminance identique sur les trois canaux (aucune dominante),
    // plus un léger bruit chromatique rouge/bleu en opposition.
    const n = (Math.random() - 0.5) * 2 * amp;
    const c = (Math.random() - 0.5) * 2 * chroma;
    d[i] = d[i] + n + c;
    d[i + 1] = d[i + 1] + n;
    d[i + 2] = d[i + 2] + n - c;
  }
  ctx.putImageData(id, 0, 0);
  return out;
}

/** Flou de bougé (appareil tenu à main levée). */
export function shakeBlur(img: HTMLCanvasElement, lengthPx: number): HTMLCanvasElement {
  if (lengthPx < 0.8) return img;
  // Trajet de l'appareil pendant la pose : presque droit pour une pose
  // courte, de plus en plus courbe pour une pose longue (la main dérive).
  const steps = clamp(Math.ceil(lengthPx * 1.2), 6, 96);
  const theta0 = Math.random() * Math.PI * 2;
  const curl = clamp((lengthPx - 12) / 60, 0, 1) * (Math.random() < 0.5 ? -1.8 : 1.8);
  const wobble = clamp((lengthPx - 25) / 80, 0, 1) * 0.6;
  const phase = Math.random() * Math.PI * 2;
  const pts: Array<[number, number]> = [[0, 0]];
  const seg = lengthPx / (steps - 1);
  for (let i = 1; i < steps; i++) {
    const u = i / (steps - 1);
    const a = theta0 + curl * (u - 0.5) + wobble * Math.sin(u * Math.PI * 3 + phase);
    const [px, py] = pts[i - 1];
    // Le tremblement vertical est un peu plus faible que l'horizontal.
    pts.push([px + Math.cos(a) * seg, py + Math.sin(a) * seg * 0.75]);
  }
  const cx = pts.reduce((s, p) => s + p[0], 0) / steps;
  const cy = pts.reduce((s, p) => s + p[1], 0) / steps;
  const out = makeCanvas(img.width, img.height);
  const ctx = ctx2d(out);
  // Moyenne cumulée : chaque position pèse autant que les autres.
  for (let i = 0; i < steps; i++) {
    ctx.globalAlpha = 1 / (i + 1);
    ctx.drawImage(img, pts[i][0] - cx, pts[i][1] - cy);
  }
  ctx.globalAlpha = 1;
  return out;
}

function vignette(img: HTMLCanvasElement, exposure: number): HTMLCanvasElement {
  const out = makeCanvas(img.width, img.height);
  const ctx = ctx2d(out);
  ctx.drawImage(img, 0, 0);
  const strength = 0.2 + 0.12 * clamp(1 - exposure, 0, 1);
  const g = ctx.createRadialGradient(
    img.width / 2,
    img.height / 2,
    Math.min(img.width, img.height) * 0.45,
    img.width / 2,
    img.height / 2,
    Math.max(img.width, img.height) * 0.72
  );
  g.addColorStop(0, 'rgba(0,0,0,0)');
  g.addColorStop(1, `rgba(0,0,0,${strength.toFixed(2)})`);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, img.width, img.height);
  return out;
}

/** Pipeline complet : exposition -> grain -> bougé -> vignettage. */
export function postProcess(img: HTMLCanvasElement, p: PostParams): HTMLCanvasElement {
  let out = applyExposure(img, p.exposure, p.temperatureK, p.referenceK);
  out = addGrain(out, p.iso);
  if (p.shakeAmount > 0.02) out = shakeBlur(out, p.shakeAmount);
  out = vignette(out, p.exposure);
  return out;
}

/** Formatte un ratio d'exposition en crans IL. */
export function ratioToStops(ratio: number): number {
  return log2(ratio);
}

export function stopsToLabel(stops: number): string {
  const s = Math.round(stops);
  if (s === 0) return '0';
  return s > 0 ? `+${s}` : `${s}`;
}
