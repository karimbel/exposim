import {
  clamp,
  defaultConfig,
  exposureRatio,
  formatAperture,
  formatDistance,
  formatFocal,
  formatShutter,
  kelvinLevel,
  kelvinStop,
  LIGHT_LEVELS,
  lightingLabels,
  meterDelta,
  resolveEffective,
  type CameraMode,
  type SimConfig,
  type SimSettings
} from './camera/exposure';
import { exposeLayer, handheldMinShutter, motionAmount, postProcess, shakeBlur, shakeLengthPx } from './effects/post';
import { blurRadius, drawSpinner, renderDepthOfField } from './effects/dof';
import { smoothWater } from './effects/water';
import {
  croppedDisparity,
  croppedMask,
  drawCropped,
  loadPhotoScenes,
  photoCrop,
  photoImage,
  PHOTO_REF_DIST,
  sceneForLevel,
  type Crop,
  type PhotoScene
} from './scene/photoScenes';
import { makeCanvas } from './scene/objects';
import { journal } from './debug/journal';
import { lightIconSvg } from './lightIcons';

// Plein format 24 × 36 mm : ratio 3:2.
export const SCENE_W = 1050;
export const SCENE_H = 700;

export type Language = 'fr' | 'en';

const COPY = {
  fr: {
    tagline: 'Simulateur photographique — la scène, notre image.',
    scene: 'Lumière de la scène', light: 'Luminosité', temperature: 'Balance des blancs',
    lens: 'Objectif', distance: 'Distance au sujet', focal: 'Focale (zoom)',
    series: 'Série', tripod: 'Trépied (stabilise l’image)', highlights: 'Alerte hautes lumières', thirds: 'Grille des tiers', compare: 'Comparer avec une autre photo', capture: 'Déclencher', shortcut: 'ou appuyer sur Espace',
    save: 'Sauvegarder l’image', gallery: 'Photos prises', galleryHint: 'cliquez pour agrandir · ⇄ pour comparer deux photos · ✕ pour supprimer',
    empty: 'Aucune photo pour le moment.', backLive: 'Revenir au direct',
    bokeh: 'Effet bokeh marqué', depth: 'Profondeur de champ', motionBlur: 'Flou de filé possible', frozen: 'Mouvement figé',
    sharpRange: (a: string, b: string) => `Net de ${a} à ${b}`, sharpToInf: (a: string) => `Net de ${a} à l’infini`,
    spinFrozen: 'Moulinet figé', spinSlight: 'Moulinet : léger filé', spinStrong: 'Moulinet : filé marqué', spinDisc: 'Moulinet : disque flou',
    waterSmooth: 'eau lissée', waterSilk: 'eau laiteuse',
    grain: ['Grain invisible', 'Léger grain', 'Grain visible', 'Grain marqué'],
    handheld: (min: string, focal: number) => `Risque de bougé : ${min} s mini à ${focal} mm`,
    program: 'L’appareil choisit le diaphragme et la vitesse.',
    aperturePriority: 'Vous choisissez l’ouverture ; l’appareil règle la vitesse.',
    shutterPriority: 'Vous choisissez la vitesse ; l’appareil règle l’ouverture.',
    exposureOk: 'Exposition optimale', over: 'Sur-exposition de', under: 'Sous-exposition de',
    creativeCommons: '© 2026 ExpoSim · CC BY-NC-SA 4.0'
  },
  en: {
    tagline: 'Photography simulator — the scene, our image.',
    scene: 'Scene light', light: 'Brightness', temperature: 'White balance',
    lens: 'Lens', distance: 'Subject distance', focal: 'Focal length (zoom)',
    series: 'Series', tripod: 'Tripod (stabilizes the image)', highlights: 'Highlight alert', thirds: 'Rule-of-thirds grid', compare: 'Compare with another photo', capture: 'Capture', shortcut: 'or press Space',
    save: 'Save image', gallery: 'Captured photos', galleryHint: 'click to enlarge · ⇄ to compare two photos · ✕ to delete',
    empty: 'No photos yet.', backLive: 'Return to live view',
    bokeh: 'Strong bokeh effect', depth: 'Depth of field', motionBlur: 'Motion blur possible', frozen: 'Motion frozen',
    sharpRange: (a: string, b: string) => `Sharp from ${a} to ${b}`, sharpToInf: (a: string) => `Sharp from ${a} to infinity`,
    spinFrozen: 'Pinwheel frozen', spinSlight: 'Pinwheel: slight blur', spinStrong: 'Pinwheel: strong blur', spinDisc: 'Pinwheel: blurred disc',
    waterSmooth: 'smoothed water', waterSilk: 'silky water',
    grain: ['No visible grain', 'Slight grain', 'Visible grain', 'Strong grain'],
    handheld: (min: string, focal: number) => `Camera shake risk: ${min} s min. at ${focal} mm`,
    program: 'The camera selects aperture and shutter speed.',
    aperturePriority: 'You select the aperture; the camera sets shutter speed.',
    shutterPriority: 'You select shutter speed; the camera sets the aperture.',
    exposureOk: 'Optimal exposure', over: 'Overexposed by', under: 'Underexposed by',
    creativeCommons: '© 2026 ExpoSim · CC BY-NC-SA 4.0'
  }
} as const;

/* ------------------------------ Simulateur ------------------------------ */

/** Une photo prise, prête pour la galerie. */
export interface Shot {
  canvas: HTMLCanvasElement;
  label: string;
  /** Réglages abrégés, affichés sous la vignette (deux lignes). */
  short: [string, string];
}

export class Simulator {
  config: SimConfig;
  settings: SimSettings;
  lastShot: HTMLCanvasElement | null = null;

  constructor(config: SimConfig) {
    this.config = config;
    this.settings = { ...config.defaults };
    this.applyAuto();
  }

  private applyAuto(): void {
    if (this.settings.mode !== 'manual') {
      const eff = resolveEffective(this.settings);
      this.settings.aperture = eff.aperture;
      this.settings.shutter = eff.shutter;
    }
  }

  setMode(mode: CameraMode): void {
    this.settings.mode = mode;
    this.applyAuto();
    this.emitChange();
  }

  setLighting(v: number): void {
    // La luminosité ne modifie que l'IL de la scène, jamais sa couleur.
    this.settings.lighting = clamp(Math.round(v), 1, 9);
    // La température se cale sur la lumière de la scène, comme référence ;
    // l'utilisateur peut ensuite la modifier.
    this.settings.temperatureK = sceneForLevel(this.settings.lighting).nativeK;
    this.applyAuto();
    this.emitChange();
  }

  setTemperatureK(v: number): void {
    // La couleur de la lumière ne change pas l'exposition.
    this.settings.temperatureK = clamp(Math.round(v), this.config.temperatureRange.min, this.config.temperatureRange.max);
    this.emitChange();
  }

  setDistance(v: number): void {
    this.settings.distance = clamp(v, this.config.distanceRange.min, this.config.distanceRange.max);
    this.emitChange();
  }

  /**
   * Point de mise au point : position dans l'image (ix, iy) et dans le
   * viseur (sx, sy). Le zoom se fait autour de lui : quand la focale ou la
   * distance change, ce point reste au même endroit du viseur.
   * Par défaut, il est posé sur le sujet.
   */
  afPoint: { ix: number; iy: number; sx: number; sy: number } | null = null;

  private anchor(): { ix: number; iy: number; sx: number; sy: number } {
    if (this.afPoint) return this.afPoint;
    const sc = this.scene();
    return { ix: sc.subjectX, iy: sc.subjectY, sx: sc.subjectX, sy: sc.subjectY };
  }

  /** Position actuelle du carré de mise au point dans le viseur (fractions). */
  afScreen(): { x: number; y: number } {
    const a = this.anchor();
    const c = this.photoFrame().crop;
    return { x: (a.ix - c.x) / c.w, y: (a.iy - c.y) / c.h };
  }

  setFocusAt(x: number, y: number, onSubject: boolean): void {
    this.settings.focusX = clamp(x, 0.04, 0.96);
    this.settings.focusY = clamp(y, 0.04, 0.96);
    // Distance réelle du point visé, lue dans la carte de profondeur.
    this.settings.focusDistance = onSubject ? null : clamp(this.depthAt(x, y), 0.3, 1000);
    // Le point visé devient le centre du zoom.
    const c = this.photoFrame().crop;
    this.afPoint = { ix: c.x + x * c.w, iy: c.y + y * c.h, sx: x, sy: y };
    this.emitChange();
  }

  setFocalByIndex(i: number): void {
    this.settings.focalLength = this.config.focalStops[clamp(Math.round(i), 0, this.config.focalStops.length - 1)];
    this.applyAuto();
    this.emitChange();
  }

  setIsoByIndex(i: number): void {
    this.settings.iso = this.config.isoStops[clamp(Math.round(i), 0, this.config.isoStops.length - 1)];
    this.applyAuto();
    this.emitChange();
  }

  setApertureByIndex(i: number): void {
    this.settings.aperture = this.config.apertureStops[clamp(Math.round(i), 0, this.config.apertureStops.length - 1)];
    this.applyAuto();
    this.emitChange();
  }

  setShutterByIndex(i: number): void {
    this.settings.shutter = this.config.shutterStops[clamp(Math.round(i), 0, this.config.shutterStops.length - 1)];
    this.applyAuto();
    this.emitChange();
  }

  setTripod(v: boolean): void {
    this.settings.tripod = v;
    this.emitChange();
  }

  /* ------------------------------- observateurs --------------------------- */

  private onChangeCallbacks: Array<() => void> = [];
  onChange(cb: () => void): void {
    this.onChangeCallbacks.push(cb);
  }
  private emitChange(): void {
    this.onChangeCallbacks.forEach((cb) => cb());
  }

  /* --------------------------------- analyse ------------------------------ */

  analysis(): number {
    const { aperture, shutter, iso, lighting } = this.settings;
    return meterDelta(aperture, shutter, iso, lighting);
  }

  /* --------------------------------- rendu -------------------------------- */

  /* ------------------------- scène photo + profondeur ------------------------ */

  private frameKey = '';
  private frame: { plate: HTMLCanvasElement; disp: Float32Array; crop: Crop; spinner: HTMLCanvasElement | null; water: HTMLCanvasElement | null } | null = null;
  private liveKey = '';
  private liveCanvas: HTMLCanvasElement | null = null;
  private spinnerReady: HTMLCanvasElement | null = null;

  /** Invalide les caches du viseur (après un changement de réglage). */
  clearStaticCache(): void {
    this.liveKey = '';
  }

  private scene(): PhotoScene {
    return sceneForLevel(this.settings.lighting);
  }

  /** Image et disparité recadrées selon la focale et la distance (mémoïsées). */
  private photoFrame() {
    const s = this.settings;
    const scene = this.scene();
    const a = this.anchor();
    const key = `${scene.id}|${s.focalLength}|${s.distance.toFixed(2)}|${a.ix.toFixed(4)},${a.iy.toFixed(4)},${a.sx.toFixed(4)},${a.sy.toFixed(4)}`;
    if (!this.frame || this.frameKey !== key) {
      const img = photoImage(scene.image);
      const depth = photoImage(scene.depth);
      const aspect = SCENE_W / SCENE_H;
      const imgAspect = img ? img.width / img.height : 1.5;
      const crop = photoCrop(s.focalLength, s.distance, aspect, imgAspect, a);
      const plate = img ? drawCropped(img, crop, SCENE_W, SCENE_H) : makeCanvas(SCENE_W, SCENE_H);
      const disp = depth ? croppedDisparity(depth, crop, SCENE_W, SCENE_H, s.distance) : new Float32Array(SCENE_W * SCENE_H);
      const spriteImg = scene.spinner ? photoImage(scene.spinner.file) : null;
      let spinner: HTMLCanvasElement | null = null;
      if (spriteImg) {
        spinner = makeCanvas(spriteImg.width, spriteImg.height);
        spinner.getContext('2d')!.drawImage(spriteImg, 0, 0);
      }
      const waterImg = scene.water ? photoImage(scene.water) : null;
      const water = waterImg ? croppedMask(waterImg, crop, SCENE_W, SCENE_H) : null;
      this.frame = { plate, disp, crop, spinner, water };
      this.frameKey = key;
    }
    return this.frame;
  }

  /** Disparité (m⁻¹) du plan net : le sujet, ou le point visé au collimateur. */
  private focusDisp(): number {
    const s = this.settings;
    const scale = PHOTO_REF_DIST / s.distance;
    if (s.focusDistance === null) return this.scene().subjectDisp * scale;
    return (1 / s.focusDistance) * scale;
  }

  /**
   * Zone nette (m) selon la formule optique classique, cercle de confusion
   * de 0,03 mm (plein format) : distance de mise au point s, focale f,
   * ouverture N, hyperfocale H = f²/(N·c) + f.
   */
  dofRange(): { near: number; far: number } {
    const s = 1 / Math.max(this.focusDisp(), 1e-4);
    const f = this.settings.focalLength / 1000;
    const N = this.settings.aperture;
    const H = (f * f) / (N * 0.00003) + f;
    const near = (s * (H - f)) / (H + s - 2 * f);
    const far = s >= H ? Infinity : (s * (H - f)) / (H - s);
    return { near, far };
  }

  /** Angle (degrés) parcouru par l'objet en rotation pendant la pose, ou null s'il n'y en a pas. */
  spinnerArcDeg(): number | null {
    const sp = this.scene().spinner;
    return sp ? (sp.realSpin * this.settings.shutter * 180) / Math.PI : null;
  }

  /** Distance (dans l'image d'origine) du point visé, pour la mise au point au clic. */
  depthAt(x: number, y: number): number {
    const f = this.photoFrame();
    const px = clamp(Math.round(x * SCENE_W), 0, SCENE_W - 1);
    const py = clamp(Math.round(y * SCENE_H), 0, SCENE_H - 1);
    const d = f.disp[py * SCENE_W + px] / (PHOTO_REF_DIST / this.settings.distance);
    return 1 / Math.max(d, 1 / 1000);
  }

  isOnSubject(x: number, y: number): boolean {
    const z = this.depthAt(x, y);
    return Math.abs(1 / z - this.scene().subjectDisp) < 0.02;
  }

  private spinnerPose(elapsed: number) {
    const sp = this.scene().spinner;
    const f = this.photoFrame();
    if (!sp || !f.spinner) return null;
    return {
      cx: ((sp.cx - f.crop.x) / f.crop.w) * SCENE_W,
      cy: ((sp.cy - f.crop.y) / f.crop.h) * SCENE_H,
      size: (sp.widthFrac / f.crop.w) * SCENE_W,
      rotation: (sp.displaySpin * elapsed / 1000) % (Math.PI * 2),
      arc: sp.realSpin * this.settings.shutter
    };
  }

  /** Image simulée sans l'objet animé : profondeur de champ, exposition, couleur, grain. */
  private renderStill(motion: number): { image: HTMLCanvasElement; spinner: HTMLCanvasElement | null } {
    const s = this.settings;
    const f = this.photoFrame();
    const focusDisp = this.focusDisp();
    const t0 = performance.now();
    // Pose longue : l'eau se lisse avant le calcul du flou de profondeur.
    const plate = f.water ? smoothWater(f.plate, f.water, s.shutter) : f.plate;
    const sharp = renderDepthOfField(plate, f.disp, focusDisp, s.aperture, s.focalLength);
    const exposure = exposureRatio(s.aperture, s.shutter, s.iso, s.lighting);
    const referenceK = this.scene().nativeK;
    const image = postProcess(sharp, { exposure, iso: s.iso, temperatureK: s.temperatureK, referenceK, shakeAmount: 0, motionAmount: motion });
    let spinner: HTMLCanvasElement | null = null;
    const sp = this.scene().spinner;
    if (sp && f.spinner) {
      // Même flou de profondeur, même exposition et même couleur que la scène.
      const scale = PHOTO_REF_DIST / s.distance;
      const r = blurRadius(this.scene().subjectDisp * scale, focusDisp, s.aperture, s.focalLength, SCENE_W) * (f.spinner.width / ((sp.widthFrac / f.crop.w) * SCENE_W));
      let src = f.spinner;
      if (r > 0.5) {
        src = makeCanvas(f.spinner.width, f.spinner.height);
        const c = src.getContext('2d')!;
        c.filter = `blur(${(r * 0.62).toFixed(2)}px)`;
        c.drawImage(f.spinner, 0, 0);
      }
      spinner = exposeLayer(src, exposure, s.temperatureK, referenceK);
    }
    this.lastRenderMs = Math.round(performance.now() - t0);
    return { image, spinner };
  }

  lastRenderMs = 0;

  /** Dernier rendu du viseur sans l'objet animé (sert à l'alerte de hautes lumières). */
  stillCanvas(): HTMLCanvasElement | null {
    return this.liveCanvas;
  }

  /** État interne utile au diagnostic (journal). */
  debugInfo(): Record<string, unknown> {
    const f = this.frame;
    const sp = this.spinnerPose(performance.now());
    return {
      scene: this.scene().id,
      cadrage: f ? { x: +f.crop.x.toFixed(4), y: +f.crop.y.toFixed(4), w: +f.crop.w.toFixed(4), h: +f.crop.h.toFixed(4) } : null,
      miseAuPointM: +(1 / Math.max(this.focusDisp(), 1e-4)).toFixed(2),
      moulinet: sp ? { x: Math.round(sp.cx), y: Math.round(sp.cy), taille: Math.round(sp.size), arcRad: +sp.arc.toFixed(3) } : null,
      renduMs: this.lastRenderMs
    };
  }

  /** Viseur électronique : rendu recalculé seulement quand un réglage change. */
  renderPreview(elapsed: number): HTMLCanvasElement {
    const s = this.settings;
    this.photoFrame();
    const key = `${this.frameKey}|${s.aperture}|${s.shutter}|${s.iso}|${s.lighting}|${s.temperatureK}|${s.focusDistance ?? 'subject'}`;
    if (!this.liveCanvas || this.liveKey !== key) {
      const still = this.renderStill(0);
      this.liveCanvas = still.image;
      this.spinnerReady = still.spinner;
      this.liveKey = key;
    }
    const pose = this.spinnerPose(elapsed);
    if (!pose || !this.spinnerReady) return this.liveCanvas;
    const out = makeCanvas(SCENE_W, SCENE_H);
    const ctx = out.getContext('2d')!;
    ctx.drawImage(this.liveCanvas, 0, 0);
    // Le viseur montre déjà le filé que produira la vitesse choisie.
    drawSpinner(ctx, this.spinnerReady, pose.cx, pose.cy, pose.size, pose.rotation, pose.arc);
    return out;
  }

  /** Prise de vue : filé de l'objet animé pendant la pose, puis bougé éventuel. */
  capture(elapsed: number): HTMLCanvasElement {
    const s = this.settings;
    const still = this.renderStill(motionAmount(s.shutter));
    const out = makeCanvas(SCENE_W, SCENE_H);
    const ctx = out.getContext('2d')!;
    ctx.drawImage(still.image, 0, 0);
    const pose = this.spinnerPose(elapsed);
    if (pose && still.spinner) drawSpinner(ctx, still.spinner, pose.cx, pose.cy, pose.size, pose.rotation, pose.arc);
    const final = shakeBlur(out, shakeLengthPx(s.shutter, s.focalLength, s.tripod));
    this.lastShot = final;
    return final;
  }
}

/* ----------------------------------- UI ---------------------------------- */

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls?: string, text?: string): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (cls) node.className = cls;
  if (text !== undefined) node.textContent = text;
  return node;
}

const ICON_PATHS: Record<string, string> = {
  sun: '<circle cx="12" cy="12" r="3.5"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3M4.9 4.9 7 7M17 17l2.1 2.1M19.1 4.9 17 7M7 17l-2.1 2.1"/>',
  lens: '<circle cx="10.5" cy="10.5" r="6.5"/><path d="m16 16 4 4M10.5 7v7M7 10.5h7"/>',
  series: '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M8 4v16M3 9h18"/>',
  gallery: '<rect x="3" y="3" width="18" height="18" rx="2"/><path d="M3 10h18M10 3v18"/>',
  iso: '<circle cx="12" cy="12" r="8"/><circle cx="12" cy="12" r="3"/><path d="M12 4v2M20 12h-2M12 20v-2M4 12h2"/>',
  aperture: '<circle cx="12" cy="12" r="8"/><circle cx="12" cy="12" r="3"/><path d="m8 5 2.5 4M16 5l-2.5 4M19 10l-4 .5M17 18l-2-3.5M7 18l2-3.5M5 10l4 .5"/>',
  shutter: '<circle cx="12" cy="12" r="8"/><path d="M12 7v5l3.5 2.5"/>'
};

function iconText(cls: string, icon: string, text: string): HTMLElement {
  const node = el('span', cls);
  const glyph = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  glyph.classList.add('title-icon');
  glyph.setAttribute('viewBox', '0 0 24 24');
  glyph.setAttribute('fill', 'none');
  glyph.setAttribute('stroke', 'currentColor');
  glyph.setAttribute('stroke-width', '1.8');
  glyph.setAttribute('stroke-linecap', 'round');
  glyph.setAttribute('stroke-linejoin', 'round');
  glyph.setAttribute('aria-hidden', 'true');
  glyph.innerHTML = ICON_PATHS[icon] ?? '';
  node.append(glyph, document.createTextNode(text));
  return node;
}

interface SliderSpec {
  label: string;
  icon?: string;
  fmt: (v: number) => string;
  min: number;
  max: number;
  step: number;
  get: () => number;
  set: (v: number) => void;
  isActive: () => boolean;
}

function buildSlider(spec: SliderSpec): { wrap: HTMLElement; value: HTMLElement; input: HTMLInputElement; setValue: (v: number) => void } {
  const wrap = el('div', 'control');
  const head = el('div', 'control__head');
  const label = el('span', 'control__label', spec.label);
  const value = el('span', 'control__value', spec.fmt(spec.get()));
  head.append(label, value);

  const input = document.createElement('input');
  input.type = 'range';
  input.className = 'control__range';
  input.min = String(spec.min);
  input.max = String(spec.max);
  input.step = String(spec.step);
  input.value = String(spec.get());

  input.addEventListener('input', () => {
    spec.set(parseFloat(input.value));
    value.textContent = spec.fmt(spec.get());
  });

  wrap.append(head, input);
  return { wrap, value, input, setValue: (v) => { input.value = String(v); value.textContent = spec.fmt(v); } };
}

/** Cadran d'exposition : grande valeur + ‑ / curseur / ＋ + badge AUTO. */
function buildDial(spec: SliderSpec): { wrap: HTMLElement; value: HTMLElement; badge: HTMLElement; hint: HTMLElement; setValue: () => void } {
  const wrap = el('div', 'dial');
  const head = el('div', 'dial__head');
  const label = iconText('dial__label', spec.icon ?? '', spec.label);
  const badge = el('span', 'dial__badge', 'AUTO');
  head.append(label, badge);

  const row = el('div', 'dial__row');
  const minus = el('button', 'btn dial__btn', '−');
  minus.type = 'button';
  minus.setAttribute('aria-label', `Diminuer ${spec.label}`);
  const value = el('span', 'dial__value', spec.fmt(spec.get()));
  const plus = el('button', 'btn dial__btn', '+');
  plus.type = 'button';
  plus.setAttribute('aria-label', `Augmenter ${spec.label}`);
  row.append(minus, value, plus);

  const input = document.createElement('input');
  input.type = 'range';
  input.className = 'control__range dial__range';
  input.min = String(spec.min);
  input.max = String(spec.max);
  input.step = String(spec.step);
  input.value = String(spec.get());
  input.setAttribute('aria-label', spec.label);

  const apply = (v: number) => {
    spec.set(clamp(v, parseFloat(input.min), parseFloat(input.max)));
  };
  minus.addEventListener('click', () => apply(parseFloat(input.value) - parseFloat(input.step)));
  plus.addEventListener('click', () => apply(parseFloat(input.value) + parseFloat(input.step)));
  input.addEventListener('input', () => {
    const v = parseFloat(input.value);
    if (Number.isFinite(v)) apply(v);
  });

  const hint = el('span', 'dial__hint', '');
  wrap.append(head, row, input, hint);
  return {
    wrap,
    value,
    badge,
    hint,
    setValue: () => {
      const active = spec.isActive();
      value.textContent = spec.fmt(spec.get());
      input.value = String(spec.get());
      input.disabled = !active;
      minus.disabled = !active;
      plus.disabled = !active;
      wrap.classList.toggle('is-auto', !active);
    }
  };
}

function formatShutterValue(t: number): string {
  return formatShutter(t);
}

export function buildApp(root: HTMLElement, language: Language): void {
  const cfg = defaultConfig();
  const sim = new Simulator(cfg);
  const lightLabels = lightingLabels(language);
  const copy = COPY[language];

  /* -------------------------------- header -------------------------------- */
  const header = el('header', 'app__header');
  const logo = el('div', 'logo', 'EXPOSIM');
  const tagline = el('div', 'tagline', copy.tagline);
  const languageControl = el('div', 'language-control');
  const languageLabel = el('span', 'language-label', language === 'fr' ? 'Langue' : 'Language');
  const languageMenu = document.createElement('details');
  languageMenu.className = 'language-menu';
  const languageSummary = document.createElement('summary');
  languageSummary.textContent = language.toUpperCase();
  languageMenu.append(languageSummary);
  const languageOptions = el('div', 'language-options');
  for (const value of ['fr', 'en'] as const) {
    const option = el('button', 'language-option', value === 'fr' ? 'Français' : 'English');
    option.type = 'button';
    option.classList.toggle('is-active', value === language);
    option.addEventListener('click', () => {
      localStorage.setItem('exposim-language', value);
      window.location.reload();
    });
    languageOptions.append(option);
  }
  languageMenu.append(languageOptions);
  languageControl.append(languageLabel, languageMenu);
  const themeToggle = el('button', 'theme-toggle');
  themeToggle.type = 'button';
  const setTheme = (theme: 'light' | 'dark', persist = true): void => {
    document.documentElement.dataset.theme = theme;
    if (persist) localStorage.setItem('exposim-theme', theme);
    const light = theme === 'light';
    themeToggle.textContent = light ? '☾' : '☀';
    themeToggle.title = light
      ? (language === 'fr' ? 'Activer le thème sombre' : 'Switch to dark theme')
      : (language === 'fr' ? 'Activer le thème clair' : 'Switch to light theme');
    themeToggle.setAttribute('aria-label', themeToggle.title);
    themeToggle.setAttribute('aria-pressed', String(light));
  };
  setTheme(document.documentElement.dataset.theme === 'light' ? 'light' : 'dark', false);
  themeToggle.addEventListener('click', () => {
    setTheme(document.documentElement.dataset.theme === 'light' ? 'dark' : 'light');
  });
  const headerTools = el('div', 'header-tools');
  headerTools.append(languageControl, themeToggle);
  header.append(logo, tagline, headerTools);
  root.append(header);

  const main = el('main', 'app__main');

  /* ----------------------------- barre de pose ---------------------------- */
  const camBar = el('div', 'cambar');

  const modes = el('div', 'modes');
  const log = el('div', 'log', '');
  const modeDefs: Array<{ id: CameraMode; label: string; title: string }> = [
    { id: 'program', label: 'P', title: language === 'fr' ? 'Programme' : 'Program' },
    { id: 'aperture-priority', label: 'Av', title: language === 'fr' ? 'Priorité à l\u2019ouverture' : 'Aperture priority' },
    { id: 'shutter-priority', label: 'Tv', title: language === 'fr' ? 'Priorité à la vitesse' : 'Shutter priority' },
    { id: 'manual', label: 'M', title: language === 'fr' ? 'Manuel' : 'Manual' }
  ];
  const modeButtons = new Map<CameraMode, HTMLButtonElement>();
  for (const def of modeDefs) {
    const b = el('button', 'btn mode__btn', def.label);
    b.type = 'button';
    b.title = def.title;
    b.setAttribute('aria-label', def.title);
    b.addEventListener('click', () => {
      sim.setMode(def.id);
      pokeUI();
    });
    modeButtons.set(def.id, b);
    modes.append(b);
  }
  const modesWrap = el('div', 'modes-wrap');
  modesWrap.append(modes, log);
  camBar.append(modesWrap);

  const stopIndex = (value: number, stops: number[]): number => {
    const exact = stops.indexOf(value);
    if (exact >= 0) return exact;
    let bestIndex = 0;
    let bestDistance = Infinity;
    for (let i = 0; i < stops.length; i++) {
      const distance = Math.abs(Math.log2(value / stops[i]));
      if (Number.isFinite(distance) && distance < bestDistance) {
        bestDistance = distance;
        bestIndex = i;
      }
    }
    return bestIndex;
  };
  const isoIdx = () => stopIndex(sim.settings.iso, cfg.isoStops);
  const aperIdx = () => stopIndex(sim.settings.aperture, cfg.apertureStops);
  const shutIdx = () => stopIndex(sim.settings.shutter, cfg.shutterStops);

  const apertureEnabled = () => sim.settings.mode === 'manual' || sim.settings.mode === 'aperture-priority';
  const shutterEnabled = () => sim.settings.mode === 'manual' || sim.settings.mode === 'shutter-priority';

  const dials: Array<SliderSpec> = [
    {
      label: 'ISO',
      icon: 'iso',
      fmt: (v) => String(cfg.isoStops[Math.round(v)]),
      min: 0, max: cfg.isoStops.length - 1, step: 1,
      get: () => isoIdx(),
      set: (v) => sim.setIsoByIndex(Math.round(v)),
      isActive: () => true
    },
    {
      label: language === 'fr' ? 'Ouverture' : 'Aperture',
      icon: 'aperture',
      fmt: (v) => formatAperture(cfg.apertureStops[Math.round(v)]),
      min: 0, max: cfg.apertureStops.length - 1, step: 1,
      get: () => aperIdx(),
      set: (v) => sim.setApertureByIndex(Math.round(v)),
      isActive: () => apertureEnabled()
    },
    {
      label: language === 'fr' ? 'Vitesse' : 'Shutter',
      icon: 'shutter',
      fmt: (v) => formatShutterValue(cfg.shutterStops[Math.round(v)]),
      min: 0, max: cfg.shutterStops.length - 1, step: 1,
      get: () => shutIdx(),
      set: (v) => sim.setShutterByIndex(Math.round(v)),
      isActive: () => shutterEnabled()
    }
  ];
  const dialNodes = dials.map((d) => buildDial(d));
  const dialsWrap = el('div', 'dials');
  for (const n of dialNodes) dialsWrap.append(n.wrap);
  camBar.append(dialsWrap);

  /* ------------------------------ posemètre ------------------------------- */
  // affiché en pied de viseur (HUD d'appareil photo), pas dans la barre
  const meter = el('div', 'meter');
  buildMeter(meter);

  const shutterBtn = el('button', 'btn btn--shutter', '');
  shutterBtn.type = 'button';
  shutterBtn.title = language === 'fr' ? 'Prendre la photo (Espace)' : 'Take photo (Space)';
  shutterBtn.setAttribute('aria-label', shutterBtn.title);

  main.append(camBar);

  /* --------------------------------- stage -------------------------------- */
  const stage = el('section', 'stage');
  const viewfinder = el('div', 'viewfinder');
  const view = document.createElement('canvas');
  view.width = SCENE_W;
  view.height = SCENE_H;
  view.className = 'viewfinder__canvas';

  const vfOverlay = el('div', 'vf-overlay');
  const vfBrackets = el('div', 'vf-brackets');
  for (const corner of ['tl', 'tr', 'bl', 'br']) vfBrackets.append(el('span', `vf-bracket vf-bracket--${corner}`));
  const vfAf = el('div', 'vf-af', '');
  vfAf.setAttribute('aria-label', 'Mise au point verrouillée sur le sujet');
  const vfGrid = el('div', 'vf-grid');
  for (const line of ['v1', 'v2', 'h1', 'h2']) vfGrid.append(el('span', `vf-grid__line vf-grid__line--${line}`));
  vfOverlay.append(vfGrid, vfBrackets, vfAf);

  const vfHistogram = document.createElement('canvas');
  vfHistogram.className = 'vf-histogram';
  vfHistogram.width = 128;
  vfHistogram.height = 44;
  vfHistogram.setAttribute('aria-label', language === 'fr' ? 'Histogramme de luminosité' : 'Brightness histogram');

  // barre du bas : vitesse et ouverture (blocs séparés) à gauche du posemètre, ISO à droite
  const vfSpeed = el('div', 'vf-side vf-side--speed', '');
  const vfAperture = el('div', 'vf-side vf-side--aperture', '');
  const vfSideRight = el('div', 'vf-side vf-side--right', '');
  const vfBottom = el('div', 'vf-bottom');
  vfBottom.append(vfSpeed, vfAperture, meter, vfSideRight);
  const liveBtn = el('button', 'btn viewfinder__live', copy.backLive);
  liveBtn.type = 'button';
  liveBtn.addEventListener('click', () => {
    selectedShot = null;
    simulateLiveDraw(performance.now());
    refreshGallery();
    syncAll();
  });
  viewfinder.append(view, vfOverlay, vfHistogram, vfBottom, liveBtn);
  stage.append(viewfinder);
  main.append(stage);

  /* remise à l'échelle : toute la scène tient dans la fenêtre, sans scroll */
  let fitW = 0;
  function fitScene(): void {
    const r = stage.getBoundingClientRect();
    const scale = Math.max(0.01, Math.min(r.width / SCENE_W, r.height / SCENE_H));
    const w = Math.floor(SCENE_W * scale);
    if (w !== fitW) {
      journal('redimensionnement', { avant: fitW, apres: w, scene: [Math.round(r.width), Math.round(r.height)] });
      fitW = w;
      viewfinder.style.width = `${w}px`;
    }
  }
  const fitObserver = new ResizeObserver(fitScene);
  fitObserver.observe(stage);
  fitScene();

  /* -------------------------------- galerie ------------------------------- */
  const gallery = el('section', 'gallery');
  const galleryHead = el('div', 'gallery__head');
  const galleryTitle = iconText('gallery__title', 'gallery', copy.gallery);
  const galleryHint = el('span', 'gallery__hint', copy.galleryHint);
  galleryHead.append(galleryTitle, galleryHint);

  const galleryStrip = el('div', 'gallery__strip');
  galleryStrip.append(el('div', 'gallery__empty', copy.empty));

  const recap = el('div', 'recap', '');
  gallery.append(galleryHead, galleryStrip, recap);
  main.append(gallery);

  /* -------------------------------- panneau ------------------------------- */
  const panel = el('aside', 'panel');

  const sceneSec = el('div', 'panel__section');
  sceneSec.append(iconText('panel__title', 'sun', copy.scene));
  const lightSlider = buildSlider({
    label: copy.light,
    fmt: (v) => {
      const level = Math.round(clamp(v, 1, 9));
      return `${lightLabels[level]} · ${language === 'fr' ? 'IL' : 'EV'} ${LIGHT_LEVELS[level].ev}`;
    },
    min: cfg.lightingRange.min, max: cfg.lightingRange.max, step: cfg.lightingRange.step,
    get: () => sim.settings.lighting,
    set: (v) => sim.setLighting(v),
    isActive: () => true
  });
  // Balance des blancs : valeur fixe, celle de la lumière de la scène
  // (affichée comme repère, non modifiable).
  const wbRow = el('div', 'control control--readonly');
  const wbHead = el('div', 'control__head');
  const wbValue = el('span', 'control__value', '');
  wbHead.append(el('span', 'control__label', copy.temperature), wbValue);
  wbRow.append(wbHead);
  const kelvinMood = el('div', 'kelvin-mood');
  const kelvinMoodIcon = el('span', 'kelvin-mood__icon');
  const kelvinMoodLabel = el('span', 'kelvin-mood__label');
  kelvinMood.append(kelvinMoodIcon, kelvinMoodLabel);
  sceneSec.append(lightSlider.wrap, wbRow, kelvinMood);
  panel.append(sceneSec);

  const lensSec = el('div', 'panel__section');
  lensSec.append(iconText('panel__title', 'lens', copy.lens));
  const distSlider = buildSlider({
    label: copy.distance,
    fmt: (v) => formatDistance(v),
    min: cfg.distanceRange.min, max: cfg.distanceRange.max, step: cfg.distanceRange.step,
    get: () => sim.settings.distance,
    set: (v) => sim.setDistance(v),
    isActive: () => true
  });
  const focalSlider = buildSlider({
    label: copy.focal,
    fmt: (v) => formatFocal(cfg.focalStops[Math.round(v)]),
    min: 0, max: cfg.focalStops.length - 1, step: 1,
    get: () => cfg.focalStops.indexOf(sim.settings.focalLength),
    set: (v) => sim.setFocalByIndex(Math.round(v)),
    isActive: () => true
  });
  lensSec.append(distSlider.wrap, focalSlider.wrap);
  panel.append(lensSec);

  const serSec = el('div', 'panel__section');
  serSec.append(iconText('panel__title', 'series', copy.series));
  const tripodRow = el('label', 'control control--tripod');
  const tripodCheck = document.createElement('input');
  tripodCheck.type = 'checkbox';
  tripodCheck.id = 'tripod';
  tripodCheck.checked = sim.settings.tripod;
  tripodRow.append(tripodCheck, el('span', 'control__label', copy.tripod));
  tripodCheck.addEventListener('change', () => sim.setTripod(tripodCheck.checked));
  serSec.append(tripodRow);
  // Alerte de hautes lumières : les zones brûlées clignotent en noir,
  // dans le viseur comme sur les photos prises.
  const gridRow = el('label', 'control control--tripod');
  const gridCheck = document.createElement('input');
  gridCheck.type = 'checkbox';
  gridCheck.id = 'thirds';
  gridCheck.checked = false;
  gridRow.append(gridCheck, el('span', 'control__label', copy.thirds));
  gridCheck.addEventListener('change', () => {
    vfGrid.classList.toggle('is-visible', gridCheck.checked);
    journal('grille-tiers', { active: gridCheck.checked });
  });
  serSec.append(gridRow);
  const hiRow = el('label', 'control control--tripod');
  const hiCheck = document.createElement('input');
  hiCheck.type = 'checkbox';
  hiCheck.id = 'highlights';
  hiCheck.checked = false;
  hiRow.append(hiCheck, el('span', 'control__label', copy.highlights));
  hiCheck.addEventListener('change', () => journal('alerte-hautes-lumieres', { active: hiCheck.checked }));
  serSec.append(hiRow);
  panel.append(serSec);

  const captureAction = el('div', 'panel__action panel__action--capture');
  const captureText = el('div', 'panel__action-copy');
  captureText.append(el('strong', undefined, copy.capture), el('span', undefined, copy.shortcut));
  captureAction.append(captureText, shutterBtn);
  panel.append(captureAction);

  const saveBtn = el('button', 'btn btn--save');
  saveBtn.type = 'button';
  saveBtn.disabled = true;
  const saveIcon = el('span', 'save__icon', '⇩');
  saveIcon.setAttribute('aria-hidden', 'true');
  const saveText = el('span', 'save__text', copy.save);
  const saveBadge = el('span', 'save__badge', 'PNG');
  saveBadge.title = 'Image PNG haute qualité';
  saveBtn.append(saveIcon, saveText, saveBadge);
  panel.append(saveBtn);

  main.append(panel);
  root.append(main);

  /* ------------------------------ lightbox ------------------------------- */
  const lightbox = el('div', 'lightbox');
  lightbox.setAttribute('role', 'dialog');
  lightbox.setAttribute('aria-modal', 'true');
  lightbox.setAttribute('aria-label', language === 'fr' ? 'Photo prise agrandie' : 'Enlarged captured photo');
  const lightboxFrame = el('div', 'lightbox__frame');
  const lightboxCanvas = document.createElement('canvas');
  lightboxCanvas.width = SCENE_W;
  lightboxCanvas.height = SCENE_H;
  lightboxCanvas.className = 'lightbox__canvas';
  const lightboxCaption = el('div', 'lightbox__caption', '');
  const lightboxCanvas2 = document.createElement('canvas');
  lightboxCanvas2.width = SCENE_W;
  lightboxCanvas2.height = SCENE_H;
  lightboxCanvas2.className = 'lightbox__canvas';
  const lightboxCaption2 = el('div', 'lightbox__caption', '');
  const lightboxFig = el('div', 'lightbox__fig');
  lightboxFig.append(lightboxCanvas, lightboxCaption);
  const lightboxFig2 = el('div', 'lightbox__fig lightbox__fig--second');
  lightboxFig2.append(lightboxCanvas2, lightboxCaption2);
  const lightboxClose = el('button', 'lightbox__close', '×');
  lightboxClose.type = 'button';
  lightboxClose.setAttribute('aria-label', language === 'fr' ? 'Fermer la photo agrandie' : 'Close enlarged photo');
  lightboxFrame.append(lightboxFig, lightboxFig2, lightboxClose);
  lightbox.append(lightboxFrame);
  root.append(lightbox);

  /* ------------------------------ intégration ----------------------------- */
  const ctx = view.getContext('2d')!;

  /* galerie */
  const shots: Shot[] = [];
  let selectedShot: Shot | null = null;
  /** Photos cochées pour la comparaison (deux au plus). */
  const compareSel: Shot[] = [];
  let freezeUntil = 0;
  let lastHistogramAt = 0;

  function drawHistogram(c: HTMLCanvasElement): void {
    const now = performance.now();
    if (now - lastHistogramAt < 140) return;
    lastHistogramAt = now;

    const source = c.getContext('2d')!.getImageData(0, 0, c.width, c.height).data;
    const bins = new Array<number>(48).fill(0);
    // Un pixel sur seize suffit à une lecture fluide sans alourdir le viseur.
    for (let i = 0; i < source.length; i += 64) {
      const luminance = (source[i] * 0.2126 + source[i + 1] * 0.7152 + source[i + 2] * 0.0722) / 255;
      bins[Math.min(bins.length - 1, Math.floor(luminance * bins.length))]++;
    }

    const hctx = vfHistogram.getContext('2d')!;
    const w = vfHistogram.width;
    const h = vfHistogram.height;
    const peak = Math.max(...bins, 1);
    hctx.clearRect(0, 0, w, h);
    hctx.beginPath();
    hctx.moveTo(0, h - 1);
    bins.forEach((count, i) => {
      const x = (i / (bins.length - 1)) * w;
      const y = h - 2 - (count / peak) * (h - 5);
      hctx.lineTo(x, y);
    });
    hctx.lineTo(w, h - 1);
    hctx.closePath();
    hctx.fillStyle = 'rgba(255, 225, 0, 0.34)';
    hctx.fill();
    hctx.strokeStyle = 'rgba(255, 238, 128, 0.95)';
    hctx.lineWidth = 1.2;
    hctx.stroke();
  }

  /** Zones brûlées (au moins un canal saturé), mémoïsées par image source. */
  let clipSource: HTMLCanvasElement | null = null;
  let clipMask: HTMLCanvasElement | null = null;
  function clippedMask(src: HTMLCanvasElement): HTMLCanvasElement | null {
    if (clipSource === src) return clipMask;
    clipSource = src;
    // Analyse à 1/3 de résolution : le moyennage efface le grain, sinon le
    // masque serait un semis de points au lieu de zones nettes.
    const sw = Math.max(1, Math.round(src.width / 3));
    const sh = Math.max(1, Math.round(src.height / 3));
    const small = makeCanvas(sw, sh);
    const sctx = small.getContext('2d')!;
    sctx.imageSmoothingQuality = 'high';
    sctx.drawImage(src, 0, 0, sw, sh);
    const data = sctx.getImageData(0, 0, sw, sh);
    const d = data.data;
    let count = 0;
    const flags = new Uint8Array(sw * sh);
    for (let i = 0; i < d.length; i += 4) {
      flags[i >> 2] = Math.max(d[i], d[i + 1], d[i + 2]) >= 249 ? 1 : 0;
    }
    // Filtre majoritaire 3 × 3 : les pixels isolés disparaissent, les zones
    // brûlées restent d'un seul tenant.
    for (let y = 0; y < sh; y++) {
      for (let x = 0; x < sw; x++) {
        let n = 0;
        for (let dy = -1; dy <= 1; dy++) {
          const yy = Math.min(sh - 1, Math.max(0, y + dy));
          for (let dx = -1; dx <= 1; dx++) n += flags[yy * sw + Math.min(sw - 1, Math.max(0, x + dx))];
        }
        const clipped = n >= 5;
        const i = (y * sw + x) * 4;
        d[i] = 0; d[i + 1] = 0; d[i + 2] = 0;
        d[i + 3] = clipped ? 235 : 0;
        if (clipped) count++;
      }
    }
    // Quelques pixels isolés (reflets ponctuels) ne déclenchent pas l'alerte.
    if (count < (d.length / 4) * 0.0004) { clipMask = null; return null; }
    sctx.putImageData(data, 0, 0);
    clipMask = small;
    return clipMask;
  }

  function drawCanvas(c: HTMLCanvasElement, still: HTMLCanvasElement = c): void {
    ctx.drawImage(c, 0, 0);
    drawHistogram(c);
    // Clignotement (≈ 3 fois par seconde), comme à la relecture sur un appareil.
    if (hiCheck.checked && Math.floor(performance.now() / 330) % 2 === 0) {
      const mask = clippedMask(still);
      if (mask) {
        ctx.imageSmoothingEnabled = true;
        ctx.drawImage(mask, 0, 0, c.width, c.height);
      }
    }
  }

  function openLightbox(shot: Shot): void {
    lightboxFrame.classList.remove('is-compare');
    lightboxCanvas.getContext('2d')!.drawImage(shot.canvas, 0, 0);
    lightboxCaption.textContent = shot.label;
    lightbox.classList.add('is-open');
    lightboxClose.focus();
  }

  /** Deux photos côte à côte (ex. f/1.4 contre f/16). */
  function openCompare(a: Shot, b: Shot): void {
    lightboxFrame.classList.add('is-compare');
    lightboxCanvas.getContext('2d')!.drawImage(a.canvas, 0, 0);
    lightboxCaption.textContent = `#${shots.indexOf(a) + 1} · ${a.label}`;
    lightboxCanvas2.getContext('2d')!.drawImage(b.canvas, 0, 0);
    lightboxCaption2.textContent = `#${shots.indexOf(b) + 1} · ${b.label}`;
    lightbox.classList.add('is-open');
    lightboxClose.focus();
    journal('comparaison', { a: a.label, b: b.label });
  }

  function closeLightbox(): void {
    if (compareSel.length > 0) {
      compareSel.length = 0;
      refreshGallery();
    }
    lightbox.classList.remove('is-open');
  }

  lightboxClose.addEventListener('click', closeLightbox);
  lightbox.addEventListener('click', (ev) => {
    if (ev.target === lightbox) closeLightbox();
  });

  function paint(elapsed: number): void {
    if (selectedShot) {
      // Photo affichée : on la redessine pour faire clignoter l'alerte.
      if (hiCheck.checked) drawCanvas(selectedShot.canvas);
      return;
    }
    if (elapsed < freezeUntil) return;
    simulateLiveDraw(elapsed);
  }

  let shakeLogged = false;
  function simulateLiveDraw(elapsed: number): void {
    drawCanvas(sim.renderPreview(elapsed), sim.stillCanvas() ?? undefined);
    if (!sim.settings.tripod) {
      // À main levée, la main tremble en permanence : le viseur bouge
      // doucement, d'autant plus qu'on zoome. La vitesse ne change que ce
      // qui s'imprime sur la photo.
      const amplitude = 0.5 + 0.9 * (sim.settings.focalLength / 24);
      const x = Math.sin(elapsed * 0.0021) * amplitude + Math.sin(elapsed * 0.0057 + 1.3) * amplitude * 0.35;
      const y = Math.cos(elapsed * 0.0017) * amplitude * 0.7 + Math.sin(elapsed * 0.0049) * amplitude * 0.25;
      if (!shakeLogged) { shakeLogged = true; journal('viseur-tremblement', { actif: true, amplitudePx: +amplitude.toFixed(2) }); }
      view.style.transform = `translate(${x.toFixed(2)}px, ${y.toFixed(2)}px) scale(1.025)`;
    } else {
      if (shakeLogged) { shakeLogged = false; journal('viseur-tremblement', { actif: false }); }
      view.style.transform = '';
    }
  }

  function refreshGallery(): void {
    galleryStrip.textContent = '';
    if (shots.length === 0) {
      galleryStrip.append(el('div', 'gallery__empty', copy.empty));
      return;
    }
    for (let i = 0; i < shots.length; i++) {
      const shot = shots[i];
      const card = el('div', 'shot');
      if (shot === selectedShot) card.classList.add('shot--active');
      // Vignette au format 3:2 de la photo (aucun recadrage), en double
      // définition pour rester nette sur les écrans haute densité.
      const thumb = document.createElement('canvas');
      thumb.width = 264;
      thumb.height = 176;
      thumb.getContext('2d')!.drawImage(shot.canvas, 0, 0, thumb.width, thumb.height);
      const meta = el('div', 'shot__meta', `#${i + 1}`);
      const settings = el('div', 'shot__settings');
      settings.append(el('span', '', shot.short[0]), el('span', '', shot.short[1]));
      const cmp = el('button', 'shot__cmp', '⇄');
      cmp.type = 'button';
      cmp.title = copy.compare;
      cmp.setAttribute('aria-label', copy.compare);
      if (compareSel.includes(shot)) {
        card.classList.add('shot--compare');
        cmp.classList.add('is-on');
      }
      cmp.addEventListener('click', (ev) => {
        ev.stopPropagation();
        const at = compareSel.indexOf(shot);
        if (at >= 0) compareSel.splice(at, 1);
        else compareSel.push(shot);
        refreshGallery();
        if (compareSel.length === 2) openCompare(compareSel[0], compareSel[1]);
      });
      const del = el('button', 'shot__del', '✕');
      del.type = 'button';
      del.title = language === 'fr' ? 'Supprimer' : 'Delete';
      del.addEventListener('click', (ev) => {
        ev.stopPropagation();
        const idx = shots.indexOf(shot);
        if (idx >= 0) shots.splice(idx, 1);
        const sel = compareSel.indexOf(shot);
        if (sel >= 0) compareSel.splice(sel, 1);
        if (selectedShot === shot) {
          selectedShot = null;
          simulateLiveDraw(performance.now());
        }
        refreshGallery();
        syncAll();
      });
      const pic = el('div', 'shot__pic');
      pic.append(thumb, meta, cmp, del);
      card.append(pic, settings);
      card.addEventListener('click', () => {
        selectedShot = shot;
        drawCanvas(shot.canvas);
        refreshGallery();
        syncAll();
        openLightbox(shot);
      });
      galleryStrip.append(card);
    }
  }

  function selectFromRecap(): void {
    recap.textContent = '';
    if (selectedShot) {
      recap.textContent = selectedShot.label;
    }
    saveBtn.disabled = !(selectedShot || sim.lastShot);
    // Une étiquette de taille fixe évite de modifier la hauteur du panneau à
    // la prise de vue, et donc de faire apparaître une barre de défilement.
    saveText.textContent = copy.save;
  }

  /* ------------------------------ diagnostic ------------------------------ */
  function snapshot(): Record<string, unknown> {
    const r = view.getBoundingClientRect();
    const s = sim.settings;
    return {
      reglages: {
        mode: s.mode, iso: s.iso, ouverture: s.aperture, vitesse: formatShutterValue(s.shutter),
        lumiere: s.lighting, kelvin: s.temperatureK, distanceM: s.distance, focaleMm: s.focalLength,
        trepied: s.tripod, miseAuPoint: s.focusDistance === null ? 'sujet' : +s.focusDistance.toFixed(2)
      },
      ecartIL: +sim.analysis().toFixed(2),
      bougePx: +shakeLengthPx(s.shutter, s.focalLength, s.tripod).toFixed(1),
      message: log.textContent,
      viseur: { largeur: Math.round(r.width), hauteur: Math.round(r.height), transform: view.style.transform || 'aucune' },
      fenetre: [window.innerWidth, window.innerHeight],
      ...sim.debugInfo()
    };
  }
  let reglageTimer: number | null = null;
  function journalReglage(): void {
    if (reglageTimer !== null) window.clearTimeout(reglageTimer);
    // Un curseur qu'on fait glisser ne note que la position finale.
    reglageTimer = window.setTimeout(() => { reglageTimer = null; journal('reglage', snapshot()); }, 400);
  }

  /* synchronisation */
  function syncModes(): void {
    modeButtons.forEach((b, m) => b.classList.toggle('is-active', m === sim.settings.mode));
  }
  function syncDials(): void {
    for (let i = 0; i < dials.length; i++) {
      const active = dials[i].isActive();
      dialNodes[i].value.classList.toggle('is-auto', !active);
      dialNodes[i].badge.classList.toggle('is-visible', !active);
      dialNodes[i].setValue();
    }
    const { shutter, iso } = sim.settings;
    const loc = language === 'fr' ? 'fr-FR' : 'en-US';
    const num = (m: number) => m.toLocaleString(loc, { maximumFractionDigits: m < 10 ? 1 : 0 });

    // ISO : niveau de grain.
    dialNodes[0].hint.textContent = copy.grain[iso <= 200 ? 0 : iso <= 800 ? 1 : iso <= 3200 ? 2 : 3];

    // Ouverture : zone nette réelle (profondeur de champ optique).
    const dof = sim.dofRange();
    dialNodes[1].hint.textContent = dof.far === Infinity ? copy.sharpToInf(`${num(dof.near)} m`) : copy.sharpRange(num(dof.near), `${num(dof.far)} m`);
    // Vitesse lente (≥ 1/30 s) : le mouvement laisse une traînée.
    const minHand = handheldMinShutter(sim.settings.focalLength);
    if (!sim.settings.tripod && shutter > minHand * 1.01) {
      // Règle du 1/focale : en dessous, risque de photo floue à main levée.
      dialNodes[2].hint.textContent = copy.handheld(formatShutterValue(minHand), sim.settings.focalLength);
    } else {
      // Effet de la vitesse sur ce qui bouge dans la scène.
      const parts: string[] = [];
      const spin = sim.spinnerArcDeg();
      if (spin !== null) parts.push(spin < 6 ? copy.spinFrozen : spin < 45 ? copy.spinSlight : spin < 300 ? copy.spinStrong : copy.spinDisc);
      if (shutter >= 1) parts.push(copy.waterSilk);
      else if (shutter >= 1 / 8) parts.push(copy.waterSmooth);
      if (parts.length === 0) parts.push(shutter >= 1 / 30 ? copy.motionBlur : copy.frozen);
      const text = parts.join(' · ');
      dialNodes[2].hint.textContent = text.charAt(0).toUpperCase() + text.slice(1);
    }
  }
  function syncReadout(): void {
    const { aperture, shutter, iso } = sim.settings;
    // vitesse et ouverture à gauche du posemètre (blocs séparés), ISO à droite ;
    // les préfixes 1/, f/ et ISO sont en exposant (affichage reflex)
    const sv = formatShutterValue(shutter);
    vfSpeed.innerHTML = sv.startsWith('1/') ? `<sup>1/</sup>${sv.slice(2)}` : sv;
    vfAperture.innerHTML = `<sup>f/</sup>${formatAperture(aperture).slice(2)}`;
    vfSideRight.innerHTML = `<sup>ISO</sup> ${iso}`;
  }
  function syncFocus(): void {
    const af = sim.afScreen();
    const focusX = clamp(af.x * SCENE_W, 28, SCENE_W - 28);
    const focusY = clamp(af.y * SCENE_H, 28, SCENE_H - 42);
    const focusXPct = (focusX / SCENE_W) * 100;
    const focusPct = (focusY / SCENE_H) * 100;
    vfAf.style.left = `${focusXPct}%`;
    vfAf.style.top = `${focusPct}%`;
  }
  const MODE_LABELS: Record<CameraMode, string> = {
    program: 'P', 'aperture-priority': 'Av', 'shutter-priority': 'Tv', manual: 'M'
  };
  function syncMeter(): void {
    const delta = clamp(sim.analysis(), -3, 3);
    const pos = Math.round(delta);
    meter.querySelectorAll('.meter__cell').forEach((c) => c.classList.remove('is-needle'));
    const cell = meter.querySelector<HTMLElement>(`.meter__cell[data-stop="${pos}"]`);
    if (cell) cell.classList.add('is-needle');
  }
  function syncLog(): void {
    const s = sim.settings;
    if (s.mode === 'manual') {
      const d = Math.round(clamp(sim.analysis(), -3, 3));
      log.textContent =
        d > 0 ? `${copy.over} ${d} IL` : d < 0 ? `${copy.under} ${Math.abs(d)} IL` : copy.exposureOk;
    } else if (Math.abs(Math.round(sim.analysis())) >= 1) {
      // Mode automatique hors plage : l'appareil ne peut pas compenser.
      const d = Math.round(clamp(sim.analysis(), -3, 3));
      const limit = language === 'fr' ? 'limite atteinte' : 'limit reached';
      log.textContent = `${d > 0 ? copy.over : copy.under} ${Math.abs(d)} IL · ${limit}`;
    } else {
      const hints: Record<Exclude<CameraMode, 'manual'>, string> = {
        program: copy.program,
        'aperture-priority': copy.aperturePriority,
        'shutter-priority': copy.shutterPriority
      };
      log.textContent = hints[s.mode];
    }
  }
  function syncSceneSliders(): void {
    // La température peut changer avec la luminosité : le curseur suit.
    wbValue.textContent = `${sim.settings.temperatureK.toLocaleString(language === 'fr' ? 'fr-FR' : 'en-US')} K`;
  }
  function syncKelvinMood(): void {
    const level = kelvinLevel(sim.settings.temperatureK);
    const stop = kelvinStop(level);
    const label = language === 'en' ? stop.labelEn : stop.label;
    kelvinMoodIcon.innerHTML = lightIconSvg(level);
    kelvinMoodLabel.textContent = label;
    kelvinMood.classList.toggle('is-empty', !stop.icon && !label);
  }
  function syncAll(): void {
    syncModes();
    syncDials();
    syncReadout();
    syncFocus();
    syncMeter();
    syncLog();
    syncKelvinMood();
    syncSceneSliders();
    selectFromRecap();
    liveBtn.classList.toggle('is-visible', selectedShot !== null);
  }
  const pokeUI = syncAll;

  /* ------------------------------- captation ------------------------------ */
  let shutterAudio: AudioContext | null = null;
  function playShutterSound(): void {
    try {
      shutterAudio ??= new AudioContext();
      const audio = shutterAudio;
      const now = audio.currentTime;
      const buffer = audio.createBuffer(1, Math.round(audio.sampleRate * 0.055), audio.sampleRate);
      const data = buffer.getChannelData(0);
      for (let i = 0; i < data.length; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / data.length);
      const noise = audio.createBufferSource();
      const gain = audio.createGain();
      noise.buffer = buffer;
      gain.gain.setValueAtTime(0.12, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.055);
      noise.connect(gain).connect(audio.destination);
      noise.start(now);
    } catch {
      // Le son est un agrément : le déclenchement reste fonctionnel sans audio.
    }
  }

  function releaseShutter(elapsed: number): void {
    playShutterSound();
    selectedShot = null;
    view.style.transform = '';
    freezeUntil = elapsed + 1400;
    view.classList.add('viewfinder__flash');
    window.setTimeout(() => view.classList.remove('viewfinder__flash'), 90);

    const shotCanvas = sim.capture(elapsed);
    drawCanvas(shotCanvas);
    const s = sim.settings;
    const shot: Shot = {
      canvas: shotCanvas,
      label: `${MODE_LABELS[s.mode]} · ${formatFocal(s.focalLength)} · ${formatAperture(s.aperture)} · ${formatShutterValue(s.shutter)} · ISO${s.iso} · ${formatDistance(s.distance)}`,
      short: [`${formatAperture(s.aperture)} · ${formatShutterValue(s.shutter)}`, `ISO ${s.iso} · ${formatFocal(s.focalLength)}`]
    };
    shots.push(shot);
    journal('photo', { ...snapshot(), legende: shot.label });
    selectedShot = shot;
    refreshGallery();
    syncAll();
  }
  shutterBtn.addEventListener('click', () => releaseShutter(performance.now()));
  viewfinder.addEventListener('click', (ev) => {
    if (ev.target === liveBtn) return;
    if (!selectedShot) {
      const rect = view.getBoundingClientRect();
      const x = (ev.clientX - rect.left) / rect.width;
      const y = (ev.clientY - rect.top) / rect.height;
      sim.setFocusAt(x, y, sim.isOnSubject(x, y));
      journal('mise-au-point', { x: +x.toFixed(3), y: +y.toFixed(3), distanceVisee: +sim.depthAt(x, y).toFixed(2) });
      return;
    }
    selectedShot = null;
    refreshGallery();
    syncAll();
  });

  document.addEventListener('keydown', (ev) => {
    if (ev.key === 'Escape' && lightbox.classList.contains('is-open')) {
      closeLightbox();
      return;
    }
    if (ev.code === 'Space' || ev.key === ' ') {
      // Espace garde son rôle normal sur un bouton, une case ou un curseur.
      const target = ev.target as HTMLElement | null;
      if (target?.closest('button, input, select, textarea, summary, [contenteditable]')) return;
      if (lightbox.classList.contains('is-open') || ev.repeat) return;
      ev.preventDefault();
      waitUntilUnfrozen(() => releaseShutter(performance.now()));
    }
  });

  let spaceQueued = false;
  function waitUntilUnfrozen(fn: () => void): void {
    if (performance.now() >= freezeUntil) { fn(); return; }
    if (spaceQueued) return;
    spaceQueued = true;
    const t = window.setInterval(() => {
      if (performance.now() >= freezeUntil) {
        window.clearInterval(t);
        spaceQueued = false;
        fn();
      }
    }, 100);
  }

  saveBtn.addEventListener('click', () => {
    const src = selectedShot?.canvas ?? sim.lastShot;
    if (!src) return;
    const a = document.createElement('a');
    a.download = `exposim-${Date.now()}.png`;
    a.href = src.toDataURL('image/png');
    a.click();
  });

  /* ----------------------------- boucle live ------------------------------ */
  let last = 0;
  const FRAME_MS = 40;
  function tick(t: number): void {
    requestAnimationFrame(tick);
    if (t - last < FRAME_MS) return;
    last = t;
    paint(t);
  }

  sim.onChange(() => {
    // Le rendu complet est recalculé au prochain tick de la boucle : glisser
    // un curseur ne déclenche pas un rendu par événement.
    sim.clearStaticCache();
    syncAll();
    journalReglage();
  });

  loadPhotoScenes().then(() => {
    syncAll();
    window.setTimeout(() => journal('demarrage', snapshot()), 600);
    requestAnimationFrame(tick);
  });
}

/* --------------------------------- posemètre ------------------------------ */
function buildMeter(container: HTMLElement): void {
  const scale = el('div', 'meter__scale');
  for (let s = -3; s <= 3; s++) {
    const cell = el('div', `meter__cell ${s === 0 ? 'meter__cell--center' : ''}`, s === 0 ? '0' : '');
    cell.dataset.stop = String(s);
    scale.append(cell);
  }
  container.append(scale);
}

/* --------------------------------- pied ---------------------------------- */
export function buildFooter(root: HTMLElement, language: Language): void {
  const footer = el('footer', 'app__footer');
  const info = el('p', undefined, COPY[language].creativeCommons);
  footer.append(info);
  root.append(footer);
}
