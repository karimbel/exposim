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
  /** ratio d'exposition (1 = correct) */
  exposure: number;
  iso: number;
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

function applyExposure(img: HTMLCanvasElement, exposure: number): HTMLCanvasElement {
  const e = clamp(exposure, 0.1, 2.6);
  const out = makeCanvas(img.width, img.height);
  const ctx = ctx2d(out);
  ctx.drawImage(img, 0, 0);
  const id = ctx.getImageData(0, 0, out.width, out.height);
  const d = id.data;

  for (let i = 0; i < d.length; i += 4) {
    d[i] = tone(d[i], e);
    d[i + 1] = tone(d[i + 1], e);
    d[i + 2] = tone(d[i + 2], e);
  }
  ctx.putImageData(id, 0, 0);
  return out;
}

/** Courbe de ton à épaule douce : préserve mieux les couleurs dans les hautes lumières. */
function tone(c: number, exposure: number): number {
  const v = c / 255;
  // À l'exposition correcte (e = 1), la courbe est strictement neutre.
  // Au-delà, les hautes lumières montent progressivement vers le blanc au
  // lieu d'écrêter brutalement chaque canal (origine des dominantes cyan).
  const mapped = (v * exposure) / (1 + (exposure - 1) * v);
  return Math.round(clamp(mapped * 255, 0, 255));
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
    const n = (Math.random() - 0.5) * 2;
    d[i] = clamp(d[i] + n * amp, 0, 255);
    d[i + 1] = clamp(d[i + 1] + n * amp * 0.8, 0, 255);
    const chromaN = (Math.random() - 0.5) * 2;
    d[i] = clamp(d[i] + chromaN * chroma, 0, 255);
    d[i + 2] = clamp(d[i + 2] + chromaN * chroma, 0, 255);
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
  let out = applyExposure(img, p.exposure);
  out = addGrain(out, p.iso);
  if (p.shakeAmount > 0.02) out = shakeBlur(out, p.shakeAmount);
  out = vignette(out, p.exposure);
  return out;
}

/** Formatte un ratio d'exposition en crans IL. */
export function ratioToStops(ratio: number): number {
  return log2(ratio);
}

/**
 * Éclairage + température de couleur, appliqués en direct à la scène.
 * ratio = luminosité relative (1 = scène de référence), tempK = température en Kelvin.
 */
export function gradeScene(img: HTMLCanvasElement, ratio: number, tempK: number): HTMLCanvasElement {
  const out = makeCanvas(img.width, img.height);
  const ctx = ctx2d(out);
  ctx.drawImage(img, 0, 0);
  ctx.save();
  ctx.globalCompositeOperation = 'source-atop';

  if (ratio < 1) {
    // assombrir la scène quand la lumière baisse
    ctx.globalAlpha = clamp(1 - ratio, 0, 0.96);
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, out.width, out.height);
  } else if (ratio > 1) {
    // éclaircir quand l'exposition est généreuse
    ctx.globalAlpha = clamp((ratio - 1) * 0.75, 0, 0.92);
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, out.width, out.height);
  }

  // température de couleur : chaud (< 5200 K) ou froid (> 5200 K)
  if (tempK < 5200) {
    ctx.globalAlpha = clamp((5200 - tempK) / 3200, 0, 1) * 0.22;
    ctx.fillStyle = '#f29534';
  } else {
    ctx.globalAlpha = clamp((tempK - 5200) / 2800, 0, 1) * 0.26;
    ctx.fillStyle = '#3f6fd8';
  }
  ctx.fillRect(0, 0, out.width, out.height);
  ctx.restore();
  return out;
}

export function stopsToLabel(stops: number): string {
  const s = Math.round(stops);
  if (s === 0) return '0';
  return s > 0 ? `+${s}` : `${s}`;
}
