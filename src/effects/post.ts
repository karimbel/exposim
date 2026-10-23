import { clamp, log2 } from '../camera/exposure';
import { makeCanvas, ctx2d } from '../scene/objects';
import type { SceneLayers, LayerDepth } from '../scene/world';
import { LAYER_DEPTH } from '../scene/world';

/* --------------------------- Effets & paramètres ------------------------ */

export interface BlurRadii {
  far: number;
  mid: number;
  nearBg: number;
  subject: number;
  fg: number;
}

export interface PostParams {
  /** ratio d'exposition (1 = correct, 2 = +1 IL, 0,5 = −1 IL) */
  exposure: number;
  iso: number;
  /** Température de couleur de la lumière (K) ; la balance des blancs reste fixe à 5 500 K. */
  temperatureK: number;
  /** 0..1 flou de bougé (sans trépied) */
  shakeAmount: number;
  /** 0..1 filé du sujet */
  motionAmount: number;
}

/** Rayon de bokeh (px) pour un élément situé à la profondeur z. */
export function dofRadius(z: number, aperture: number, focal: number, subjectZ: number): number {
  const dz = z - subjectZ;
  if (Math.abs(dz) < 0.05) return 0;
  // Compression douce du cercle de confusion : le viseur d'un hybride garde
  // une lecture de scène, même lorsque le point est loin du sujet.
  const base = 0.2 * (focal / aperture) * (Math.abs(dz) / z);
  return clamp(base, 0, 24);
}

/** Flou de bougé : sans trépied, il est clairement perceptible dès 1/500 s. */
export function shakeAmount(shutter: number, tripod: boolean): number {
  if (tripod) return 0;
  const s = Math.max(shutter, 1 / 8000);
  return clamp((log2(s) - log2(1 / 500) + 0.45) / 2.25, 0, 1);
}

/** Filé du sujet : perceptible seulement aux vitesses réellement lentes. */
export function motionAmount(shutter: number): number {
  const s = Math.max(shutter, 1 / 8000);
  return clamp((log2(s) - log2(1 / 30)) / 5, 0, 1);
}

/** Calcule les rayons de flou pour chaque couche selon les réglages. */
export function computeBlurRadii(layers: SceneLayers): BlurRadii {
  const { aperture, focalLength, subjectZ, focusZ } = layers;
  // Le moulin est tenu par la famille : il partage donc exactement son plan
  // de netteté, quelle que soit la distance choisie dans le simulateur.
  const depth: LayerDepth = { ...LAYER_DEPTH, mid: subjectZ, subject: subjectZ };
  return {
    far: dofRadius(depth.far, aperture, focalLength, focusZ),
    mid: dofRadius(depth.mid, aperture, focalLength, focusZ),
    nearBg: dofRadius(depth.nearBg, aperture, focalLength, focusZ),
    subject: dofRadius(depth.subject, aperture, focalLength, focusZ),
    fg: dofRadius(depth.fg, aperture, focalLength, focusZ)
  };
}

/* ------------------------------- Composition ---------------------------- */

function drawLayer(ctx: CanvasRenderingContext2D, layer: HTMLCanvasElement, blur: number): void {
  if (blur > 0.5) {
    ctx.drawImage(opaqueBlur(layer, blur), 0, 0);
  } else {
    ctx.drawImage(layer, 0, 0);
  }
}

/**
 * Bokeh contenu dans le masque original : la diffusion reste visuelle, mais
 * l'élément conserve son alpha et ne devient jamais translucide sur le décor.
 */
function opaqueBlur(layer: HTMLCanvasElement, blur: number): HTMLCanvasElement {
  const out = makeCanvas(layer.width, layer.height);
  applyBlur(ctx2d(out), layer, blur);
  const ctx = ctx2d(out);
  ctx.globalCompositeOperation = 'destination-in';
  ctx.drawImage(layer, 0, 0);
  ctx.globalCompositeOperation = 'source-over';
  return out;
}

function applyBlur(ctx: CanvasRenderingContext2D, layer: HTMLCanvasElement, blur: number): void {
  ctx.save();
  // Approximation d'un cercle de confusion : contrairement au flou gaussien,
  // chaque détail se diffuse dans un disque, plus proche d'un vrai bokeh.
  const samples = clamp(Math.round(8 + blur * 1.3), 8, 28);
  for (let i = 0; i < samples; i++) {
    const radius = blur * Math.sqrt((i + 0.5) / samples);
    const angle = i * 2.399963229728653; // angle d'or : répartition régulière
    ctx.globalAlpha = 1 / samples;
    ctx.drawImage(layer, Math.cos(angle) * radius, Math.sin(angle) * radius);
  }
  ctx.restore();
}

/**
 * Flou de profondeur progressif : la couche est rendue selon une rampe verticale
 * de flou (variant en douceur de `blurTop` vers `blurBottom`), la zone la plus
 * nette s'alignant sur la ligne de mise au point du sujet.
 */
function drawDepthRamp(
  ctx: CanvasRenderingContext2D,
  layer: HTMLCanvasElement,
  blurTop: number,
  blurBottom: number,
  focusY: number
): void {
  if (Math.max(blurTop, blurBottom) < 0.5) {
    ctx.drawImage(layer, 0, 0);
    return;
  }
  const w = layer.width;
  const h = layer.height;

  const topLayer = makeCanvas(w, h);
  const topCtx = ctx2d(topLayer);
  applyBlur(topCtx, layer, blurTop);

  const botLayer = makeCanvas(w, h);
  const botCtx = ctx2d(botLayer);
  applyBlur(botCtx, layer, blurBottom);

  // amorce la partie lointaine (plus floue)
  ctx.drawImage(topLayer, 0, 0);
  if (blurBottom < 0.5 && blurTop < 0.5) return;
  if (Math.abs(blurTop - blurBottom) < 0.6) {
    ctx.drawImage(botLayer, 0, 0);
    return;
  }

  // bande de transition (partie proche, moins floue) centrée sur le sujet
  const band = Math.max(60, h * 0.34);
  const yMid = clamp(focusY, band * 0.5, h - band * 0.15);
  const yTop = yMid - band * 0.55;
  const yBot = yMid + band * 0.45;

  const mask = makeCanvas(w, h);
  const mctx = ctx2d(mask);
  const g = mctx.createLinearGradient(0, yTop, 0, yBot);
  g.addColorStop(0, 'rgba(255,255,255,0)');
  g.addColorStop(1, 'rgba(255,255,255,1)');
  mctx.fillStyle = g;
  mctx.fillRect(0, 0, w, h);

  const bottom = makeCanvas(w, h);
  const bctx = ctx2d(bottom);
  bctx.drawImage(botLayer, 0, 0);
  bctx.globalCompositeOperation = 'destination-in';
  bctx.drawImage(mask, 0, 0);

  ctx.drawImage(bottom, 0, 0);
}

/** Bokeh de premier plan : démarre aux pieds du sujet et augmente vers le bas. */
function drawGroundBokeh(ctx: CanvasRenderingContext2D, layer: HTMLCanvasElement, startY: number, blur: number): void {
  if (blur < 0.5 || startY >= layer.height - 2) return;
  const w = layer.width;
  const h = layer.height;
  const blurred = makeCanvas(w, h);
  applyBlur(ctx2d(blurred), layer, blur);

  const mask = makeCanvas(w, h);
  const maskCtx = ctx2d(mask);
  const gradient = maskCtx.createLinearGradient(0, startY, 0, h);
  gradient.addColorStop(0, 'rgba(255,255,255,0)');
  gradient.addColorStop(1, 'rgba(255,255,255,1)');
  maskCtx.fillStyle = gradient;
  maskCtx.fillRect(0, 0, w, h);

  const overlay = makeCanvas(w, h);
  const overlayCtx = ctx2d(overlay);
  overlayCtx.drawImage(blurred, 0, 0);
  overlayCtx.globalCompositeOperation = 'destination-in';
  overlayCtx.drawImage(mask, 0, 0);
  ctx.drawImage(overlay, 0, 0);
}

function drawSubject(
  ctx: CanvasRenderingContext2D,
  layer: HTMLCanvasElement,
  blur: number,
  motionAmount: number,
  subjectPxPerM: number
): void {
  const prepared = makeCanvas(layer.width, layer.height);
  const preparedCtx = ctx2d(prepared);
  if (blur > 0.5) preparedCtx.drawImage(opaqueBlur(layer, blur), 0, 0);
  else preparedCtx.drawImage(layer, 0, 0);
  if (motionAmount < 0.03) {
    ctx.drawImage(prepared, 0, 0);
    return;
  }
  // Traînée discrète : elle ne doit jamais ajouter de lumière au sujet.
  const ghosts = 3;
  const travel = motionAmount * 0.18 * subjectPxPerM;
  ctx.save();
  ctx.globalCompositeOperation = 'source-over';
  for (let i = 1; i <= ghosts; i++) {
    const a = ((ghosts - i + 1) / ghosts) * 0.12;
    const dx = (i / ghosts) * travel;
    ctx.globalAlpha = a;
    ctx.drawImage(prepared, -dx, 0);
    ctx.drawImage(prepared, dx, 0);
  }
  ctx.restore();
  ctx.globalAlpha = 1;
  ctx.drawImage(prepared, 0, 0);
}

/** Assemble les couches avec profondeur de champ dans une image nette non exposée. */
export function compositeScene(layers: SceneLayers, blur: BlurRadii, includeMid = true): HTMLCanvasElement {
  const w = layers.far.width;
  const h = layers.far.height;
  const out = makeCanvas(w, h);
  const ctx = ctx2d(out);

  // décor : constitution progressive du net vers le sujet (rampe verticale)
  const bgNearRadius = dofRadius(8, layers.aperture, layers.focalLength, layers.focusZ);
  drawDepthRamp(ctx, layers.far, blur.far, bgNearRadius, layers.focusScreenY);
  if (layers.focusOnSubject) {
    drawGroundBokeh(ctx, layers.far, layers.subjectFeetScreenY, Math.max(blur.fg, blur.far * 1.25));
  }
  if (includeMid) drawLayer(ctx, layers.mid, blur.mid);

  // Paysage puis sujet : le personnage, le foyer et le ventilateur sont
  // physiquement devant les collines et le lac.
  // La famille est immobile : le filé concerne uniquement le moulin animé,
  // jamais les personnages du calque sujet.
  const subjectMotion = 0;
  drawLayer(ctx, layers.nearBg, blur.nearBg);
  drawSubject(ctx, layers.subject, blur.subject * 0.15, subjectMotion, layers.subjectPxPerM);

  drawLayer(ctx, layers.fg, blur.fg);
  return out;
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
function applyExposure(img: HTMLCanvasElement, exposure: number, temperatureK: number): HTMLCanvasElement {
  const stops = clamp(Math.log2(Math.max(exposure, 1e-6)), -6, 6);
  const gain = Math.pow(2, stops);
  const wb = whiteBalanceGains(temperatureK);
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

function shakeBlur(img: HTMLCanvasElement, amount: number): HTMLCanvasElement {
  const out = makeCanvas(img.width, img.height);
  const ctx = ctx2d(out);
  // Échantillons rapprochés sur un seul axe : contrairement à quelques
  // décalages aléatoires importants, cela donne un bougé continu sans
  // produire de silhouettes fantômes reconnaissables.
  const steps = 14 + Math.round(amount * 14);
  const spread = 2 + amount * 14;
  const angle = Math.random() * Math.PI * 2;
  const dirX = Math.cos(angle);
  const dirY = Math.sin(angle) * 0.72;
  for (let i = 0; i < steps; i++) {
    const t = i / (steps - 1) - 0.5;
    const dx = t * spread * dirX;
    const dy = t * spread * dirY;
    ctx.globalAlpha = 1 / steps;
    ctx.save();
    ctx.translate(dx, dy);
    ctx.drawImage(img, 0, 0);
    ctx.restore();
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
  let out = applyExposure(img, p.exposure, p.temperatureK);
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
