import {
  clamp,
  defaultConfig,
  exposureRatio,
  formatAperture,
  formatDistance,
  formatFocal,
  formatShutter,
  kelvinStop,
  lightingLabels,
  meterDelta,
  resolveEffective,
  type CameraMode,
  type SimConfig,
  type SimSettings
} from './camera/exposure';
import { computeBlurRadii, compositeScene, gradeScene, motionAmount, postProcess, shakeAmount } from './effects/post';
import { animPose, bakeAnimatedSprite, drawAnimatedSprite, loadSceneImages } from './scene/images';
import { makeCanvas } from './scene/objects';
import { renderScene } from './scene/world';
import { REF_FOCAL_MM } from './scene/sceneConfig';

// Plein format 24 × 36 mm : ratio 3:2.
export const SCENE_W = 1050;
export const SCENE_H = 700;

export type Language = 'fr' | 'en';

const COPY = {
  fr: {
    tagline: 'Simulateur photographique — la scène, notre image.',
    scene: 'Échelle de Kelvin', light: 'Températures', temperature: 'Température de couleur',
    lens: 'Objectif', distance: 'Distance au sujet', focal: 'Focale (zoom)',
    series: 'Série', tripod: 'Trépied (stabilise l’image)', capture: 'Déclencher', shortcut: 'ou appuyer sur Espace',
    save: 'Sauvegarder l’image', gallery: 'Photos prises', galleryHint: 'cliquez pour agrandir · ✕ pour supprimer',
    empty: 'Aucune photo pour le moment.', backLive: 'Revenir au direct',
    bokeh: 'Effet bokeh marqué', depth: 'Profondeur de champ', motionBlur: 'Flou de filé et bougé possibles', frozen: 'Mouvement figé',
    program: 'L’appareil choisit le diaphragme et la vitesse.',
    aperturePriority: 'Vous choisissez l’ouverture ; l’appareil règle la vitesse.',
    shutterPriority: 'Vous choisissez la vitesse ; l’appareil règle l’ouverture.',
    exposureOk: 'Exposition optimale', over: 'Sur-exposition de', under: 'Sous-exposition de',
    creativeCommons: '© 2026 ExpoSim · CC BY-NC-SA 4.0'
  },
  en: {
    tagline: 'Photography simulator — the scene, our image.',
    scene: 'Kelvin scale', light: 'Temperatures', temperature: 'Colour temperature',
    lens: 'Lens', distance: 'Subject distance', focal: 'Focal length (zoom)',
    series: 'Series', tripod: 'Tripod (stabilizes the image)', capture: 'Capture', shortcut: 'or press Space',
    save: 'Save image', gallery: 'Captured photos', galleryHint: 'click to enlarge · ✕ to delete',
    empty: 'No photos yet.', backLive: 'Return to live view',
    bokeh: 'Strong bokeh effect', depth: 'Depth of field', motionBlur: 'Motion blur possible', frozen: 'Motion frozen',
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
    this.settings.lighting = clamp(Math.round(v), 1, 9);
    this.settings.temperatureK = kelvinStop(this.settings.lighting).kelvin;
    this.applyAuto();
    this.emitChange();
  }

  setTemperatureK(v: number): void {
    this.settings.temperatureK = clamp(Math.round(v), 2000, 8000);
    this.emitChange();
  }

  setDistance(v: number): void {
    this.settings.distance = clamp(v, this.config.distanceRange.min, this.config.distanceRange.max);
    this.emitChange();
  }

  setFocusAt(x: number, y: number, onSubject: boolean): void {
    this.settings.focusX = clamp(x, 0.04, 0.96);
    this.settings.focusY = clamp(y, 0.04, 0.96);
    // Un clic sur le sujet le verrouille net ; ailleurs, l'axe vertical du
    // viseur représente une progression du lointain (haut) au proche (bas).
    // Trois tiers lisibles : loin en haut, intermédiaire au centre, proche
    // en bas. Le sujet reste visible : on évite le flou brutal d'un rendu
    // purement théorique dans un viseur électronique.
    this.settings.focusDistance = onSubject ? null : 30 - 31.5 * this.settings.focusY;
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

  renderScene(animate: boolean): ReturnType<typeof renderScene> {
    return renderScene({ settings: this.settings, width: SCENE_W, height: SCENE_H, seed: 7, animate });
  }

  private staticKey = '';
  private staticCanvas: HTMLCanvasElement | null = null;
  private staticBlur = 0;
  private bakedAnim: HTMLCanvasElement | null = null;
  private bakeKey = '';

  /** Invalide le cache du décor statique (après un changement de réglage). */
  clearStaticCache(): void {
    this.staticKey = '';
    this.bakeKey = '';
  }

  /** Aperçu de validation : l'image maître est montrée brute et nette. */
  renderPreview(elapsed: number): HTMLCanvasElement {
    const { focalLength, aperture, distance } = this.settings;
    const key = `${focalLength}|${aperture}|${distance.toFixed(2)}|${this.settings.lighting}|${this.settings.focusY.toFixed(3)}|${this.settings.focusDistance ?? 'subject'}`;
    if (this.staticKey !== key) {
      const layers = this.renderScene(false);
      // Pendant la validation des fonds, aucun effet photo ne doit dégrader
      // l'image maître : pas de profondeur de champ, exposition ou grain.
      this.staticCanvas = makeCanvas(SCENE_W, SCENE_H);
      const staticCtx = this.staticCanvas.getContext('2d')!;
      staticCtx.drawImage(layers.far, 0, 0);
      staticCtx.drawImage(layers.nearBg, 0, 0);
      staticCtx.drawImage(layers.subject, 0, 0);
      this.staticBlur = 0;
      this.staticKey = key;
    }

    const bakeKey = `${focalLength}|${distance.toFixed(2)}|${this.staticBlur.toFixed(1)}`;
    if (this.bakeKey !== bakeKey) {
      this.bakedAnim = bakeAnimatedSprite(elapsed, SCENE_W, SCENE_H, focalLength, distance, this.staticBlur, this.settings.shutter);
      this.bakeKey = bakeKey;
    }

    const out = makeCanvas(SCENE_W, SCENE_H);
    const ctx = out.getContext('2d')!;
    ctx.drawImage(this.staticCanvas!, 0, 0);
    if (this.bakedAnim) {
      const pose = animPose(elapsed, SCENE_W, SCENE_H, focalLength, distance, this.settings.shutter);
      drawAnimatedSprite(ctx, pose, this.bakedAnim);
    }
    return out;
  }

  /** Prise de vue complète (élément animé figé + bougé + vitesse lente). */
  capture(elapsed: number): HTMLCanvasElement {
    const layers = this.renderScene(true);
    const blur = computeBlurRadii(layers);
    const motion = motionAmount(this.settings.shutter);
    const composed = compositeScene(layers, blur);
    const ratio = exposureRatio(this.settings.aperture, this.settings.shutter, this.settings.iso, this.settings.lighting);
    const shake = shakeAmount(this.settings.shutter, this.settings.tripod);
    const final = postProcess(composed, {
      exposure: ratio,
      iso: this.settings.iso,
      shakeAmount: shake,
      motionAmount: motion
    });
    const graded = gradeScene(final, 1, 5600);
    this.lastShot = graded;
    return graded;
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
  const labels = language === 'en'
    ? { 1: 'Candle', 2: 'Incandescent bulb', 3: 'Sunrise / sunset', 4: 'Moonlight', 5: 'Morning / afternoon', 6: 'Daylight', 7: 'Bright sun', 8: 'Overcast sky', 9: 'Misty sky' }
    : lightingLabels();
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
      label: 'Ouverture',
      icon: 'aperture',
      fmt: (v) => formatAperture(cfg.apertureStops[Math.round(v)]),
      min: 0, max: cfg.apertureStops.length - 1, step: 1,
      get: () => aperIdx(),
      set: (v) => sim.setApertureByIndex(Math.round(v)),
      isActive: () => apertureEnabled()
    },
    {
      label: 'Vitesse',
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
  vfOverlay.append(vfBrackets, vfAf);

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
      const stop = kelvinStop(v);
      return `${stop.kelvin.toLocaleString(language === 'fr' ? 'fr-FR' : 'en-US')} K`;
    },
    min: cfg.lightingRange.min, max: cfg.lightingRange.max, step: cfg.lightingRange.step,
    get: () => sim.settings.lighting,
    set: (v) => sim.setLighting(v),
    isActive: () => true
  });
  const kelvinMood = el('div', 'kelvin-mood');
  const kelvinMoodIcon = el('span', 'kelvin-mood__icon');
  const kelvinMoodLabel = el('span', 'kelvin-mood__label');
  kelvinMood.append(kelvinMoodIcon, kelvinMoodLabel);
  // L'échelle Kelvin est désormais intégrée au curseur de température ci-dessus.
  sceneSec.append(lightSlider.wrap, kelvinMood);
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
  const lightboxClose = el('button', 'lightbox__close', '×');
  lightboxClose.type = 'button';
  lightboxClose.setAttribute('aria-label', language === 'fr' ? 'Fermer la photo agrandie' : 'Close enlarged photo');
  lightboxFrame.append(lightboxCanvas, lightboxCaption, lightboxClose);
  lightbox.append(lightboxFrame);
  root.append(lightbox);

  /* ------------------------------ intégration ----------------------------- */
  const ctx = view.getContext('2d')!;

  /* galerie */
  const shots: Shot[] = [];
  let selectedShot: Shot | null = null;
  let freezeUntil = 0;
  let shownCanvas: HTMLCanvasElement | null = null;
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

  function drawCanvas(c: HTMLCanvasElement): void {
    shownCanvas = c;
    ctx.drawImage(c, 0, 0);
    drawHistogram(c);
  }

  function openLightbox(shot: Shot): void {
    lightboxCanvas.getContext('2d')!.drawImage(shot.canvas, 0, 0);
    lightboxCaption.textContent = shot.label;
    lightbox.classList.add('is-open');
    lightboxClose.focus();
  }

  function closeLightbox(): void {
    lightbox.classList.remove('is-open');
  }

  lightboxClose.addEventListener('click', closeLightbox);
  lightbox.addEventListener('click', (ev) => {
    if (ev.target === lightbox) closeLightbox();
  });

  function paint(elapsed: number): void {
    if (selectedShot) return;
    if (elapsed < freezeUntil) return;
    simulateLiveDraw(elapsed);
  }

  function simulateLiveDraw(elapsed: number): void {
    drawCanvas(sim.renderPreview(elapsed));
    const shake = shakeAmount(sim.settings.shutter, sim.settings.tripod);
    if (shake > 0.02) {
      // Le tremblement se voit dans le viseur, tandis que le collimateur reste fixe.
      const amplitude = 1 + shake * 7;
      const x = Math.sin(elapsed * 0.0045) * amplitude + Math.sin(elapsed * 0.008) * amplitude * 0.28;
      const y = Math.cos(elapsed * 0.0055) * amplitude * 0.68;
      view.style.transform = `translate(${x.toFixed(1)}px, ${y.toFixed(1)}px) scale(1.04)`;
    } else {
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
      const thumb = document.createElement('canvas');
      thumb.width = 220;
      thumb.height = 100;
      const srcHeight = (SCENE_W * thumb.height) / thumb.width;
      const srcY = (SCENE_H - srcHeight) / 2;
      thumb.getContext('2d')!.drawImage(shot.canvas, 0, srcY, SCENE_W, srcHeight, 0, 0, thumb.width, thumb.height);
      const meta = el('div', 'shot__meta', `#${i + 1}`);
      const del = el('button', 'shot__del', '✕');
      del.type = 'button';
      del.title = language === 'fr' ? 'Supprimer' : 'Delete';
      del.addEventListener('click', (ev) => {
        ev.stopPropagation();
        const idx = shots.indexOf(shot);
        if (idx >= 0) shots.splice(idx, 1);
        if (selectedShot === shot) {
          selectedShot = null;
          simulateLiveDraw(performance.now());
        }
        refreshGallery();
        syncAll();
      });
      card.append(thumb, meta, del);
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
    const { aperture, shutter } = sim.settings;
    dialNodes[1].hint.textContent = aperture <= 2.8 ? copy.bokeh : copy.depth;
    dialNodes[2].hint.textContent = shutter <= 1 / 30 ? copy.motionBlur : copy.frozen;
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
    const focusX = clamp(sim.settings.focusX * SCENE_W, 28, SCENE_W - 28);
    const focusY = clamp(sim.settings.focusY * SCENE_H, 28, SCENE_H - 42);
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
    } else {
      const hints: Record<Exclude<CameraMode, 'manual'>, string> = {
        program: copy.program,
        'aperture-priority': copy.aperturePriority,
        'shutter-priority': copy.shutterPriority
      };
      log.textContent = hints[s.mode];
    }
  }
  function syncKelvinMood(): void {
    const level = Math.round(clamp(sim.settings.lighting, 1, 9));
    const stop = kelvinStop(level);
    const label = labels[level] ?? stop.label;
    kelvinMoodIcon.innerHTML = `<img src="${import.meta.env.BASE_URL}kelvin/${level}.png" alt="" />`;
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
      label: `${MODE_LABELS[s.mode]} · ${formatFocal(s.focalLength)} · ${formatAperture(s.aperture)} · ${formatShutterValue(s.shutter)} · ISO${s.iso} · ${formatDistance(s.distance)}`
    };
    shots.push(shot);
    selectedShot = shot;
    refreshGallery();
    syncAll();
  }
  shutterBtn.addEventListener('click', () => releaseShutter(performance.now()));
  viewfinder.addEventListener('click', (ev) => {
    if (ev.target === liveBtn) return;
    if (!selectedShot) {
      const rect = view.getBoundingClientRect();
      const x = ((ev.clientX - rect.left) / rect.width) * SCENE_W;
      const y = ((ev.clientY - rect.top) / rect.height) * SCENE_H;
      const layers = sim.renderScene(false);
      const pixel = layers.subject.getContext('2d')!.getImageData(
        clamp(Math.round(x), 0, SCENE_W - 1),
        clamp(Math.round(y), 0, SCENE_H - 1),
        1,
        1
      ).data;
      sim.setFocusAt(x / SCENE_W, y / SCENE_H, pixel[3] > 32);
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
    sim.clearStaticCache?.();
    simulateLiveDraw(performance.now());
    syncAll();
  });

  loadSceneImages().then(() => {
    syncAll();
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
