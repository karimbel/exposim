import { clamp } from '../camera/exposure';
import { ctx2d, makeCanvas } from './objects';
import { REF_DIST_M, REF_FOCAL_MM, SCENE_LAYERS, type SceneLayerConfig } from './sceneConfig';

const cache = new Map<string, HTMLImageElement | null>();
let loading: Record<string, Promise<void>> = {};
const KELVIN_BACKGROUNDS: Record<number, string> = {
  1: 'scene/bg.png',
  2: 'scene/bg.png',
  3: 'scene/bg.png',
  4: 'scene/bg.png',
  5: 'scene/bg.png',
  6: 'scene/bg.png',
  7: 'scene/bg.png',
  8: 'scene/bg.png',
  9: 'scene/bg.png'
};
const KELVIN_LANDSCAPES: Partial<Record<number, string>> = {};
const KELVIN_SUBJECTS: Partial<Record<number, string>> = {};
const LANDSCAPE_TINTS: Partial<Record<number, { color: string; alpha: number }>> = {
  3: { color: '#d96f45', alpha: 0.24 },
  6: { color: '#6f9fca', alpha: 0.08 },
  7: { color: '#f0bb58', alpha: 0.18 },
  8: { color: '#8194a3', alpha: 0.22 },
  9: { color: '#83c5d3', alpha: 0.24 }
};
const DEFAULT_BACKGROUND = 'scene/bg.png';

/** Charge une image (mise en cache). Résout même en cas d'échec. */
export function loadImage(src: string): Promise<void> {
  if (cache.has(src)) return Promise.resolve();
  if (loading[src] !== undefined) return loading[src];
  loading[src] = new Promise((resolve) => {
    const i = new Image();
    i.onload = () => {
      cache.set(src, i);
      resolve();
    };
    i.onerror = () => {
      console.warn('[exposim] image indisponible :', src);
      cache.set(src, null);
      resolve();
    };
    i.src = `${import.meta.env.BASE_URL}${src}`;
  });
  return loading[src];
}

/** Charge toutes les images de la scène (idempotent). */
export function loadSceneImages(): Promise<void> {
  return Promise.all([
    ...SCENE_LAYERS.map((c) => (c.file ? loadImage(c.file) : Promise.resolve())),
    loadImage(DEFAULT_BACKGROUND),
    ...Object.values(KELVIN_BACKGROUNDS).map(loadImage),
    ...Object.values(KELVIN_LANDSCAPES).filter((file): file is string => Boolean(file)).map(loadImage),
    ...Object.values(KELVIN_SUBJECTS).filter((file): file is string => Boolean(file)).map(loadImage)
  ]).then(() => undefined);
}

const allCanvases = new Map<string, HTMLCanvasElement | null>();

/** Renvoie une couche comme canvas réutilisable (mémoïsé), ou null si absente/illisible. */
function imageCanvas(file: string): HTMLCanvasElement | null {
  const img = cache.get(file);
  if (!img) return null; // pas encore chargée ou en erreur : on réessaiera au prochain rendu
  if (allCanvases.has(file)) return allCanvases.get(file) ?? null;
  const c = makeCanvas(img.naturalWidth, img.naturalHeight);
  ctx2d(c).drawImage(img, 0, 0);
  allCanvases.set(file, c);
  return c;
}

function layerCanvas(cfg: SceneLayerConfig): HTMLCanvasElement | null {
  return cfg.file ? imageCanvas(cfg.file) : null;
}

/** Calque plein cadre : recadre l'image (centrée) pour remplir w×h — même axe pour toutes les couches. */
export function coverDraw(
  ctx: CanvasRenderingContext2D,
  img: HTMLCanvasElement | HTMLImageElement,
  w: number,
  h: number
): void {
  const iw = img.width;
  const ih = img.height;
  const scale = Math.max(w / iw, h / ih);
  const srcW = w / scale;
  const srcH = h / scale;
  ctx.drawImage(img, (iw - srcW) / 2, (ih - srcH) / 2, srcW, srcH, 0, 0, w, h);
}

/**
 * Même recadrage que le décor principal : indispensable lorsque deux PNG ont
 * les mêmes dimensions et doivent être superposés pixel pour pixel.
 */
interface FocalCrop {
  srcX: number;
  srcY: number;
  srcW: number;
  srcH: number;
}

function focalCropDraw(
  ctx: CanvasRenderingContext2D,
  img: HTMLCanvasElement | HTMLImageElement,
  w: number,
  h: number,
  focal: number
): FocalCrop {
  const iw = img.width;
  const ih = img.height;
  let srcW = (iw * REF_FOCAL_MM) / focal;
  srcW = clamp(srcW, iw / 8, iw);
  let srcH = (srcW * h) / w;
  if (srcH > ih) {
    srcH = ih;
    srcW = (srcH * w) / h;
  }
  const srcX = (iw - srcW) / 2;
  const srcY = (ih - srcH) / 2;
  ctx.drawImage(img, srcX, srcY, srcW, srcH, 0, 0, w, h);
  return { srcX, srcY, srcW, srcH };
}

export interface LayerRenderOptions {
  width: number;
  height: number;
  focal: number;
  distance: number;
  /** Vitesse d'obturation (s) — pilote la rotation de l'élément animé. */
  shutter: number;
  /** Temps écoulé (ms) — pilote l'élément animé. */
  elapsed: number;
  /** Cran actif sur l'échelle Kelvin (1 .. 9) : choix des variantes d'images. */
  kelvinLevel: number;
}

export interface LayerRenderResult {
  far: HTMLCanvasElement;
  mid: HTMLCanvasElement;
  nearBg: HTMLCanvasElement;
  subject: HTMLCanvasElement;
  fg: HTMLCanvasElement;
  /** Largeur du sujet affichée en px pour 1 m réel (filé). */
  subjectPxPerM: number;
  /** Position verticale de la ligne de mise au point (px). */
  focusScreenY: number;
  /** Position verticale des pieds du sujet (px). */
  subjectFeetScreenY: number;
}

/* ------------------------- élément animé (couche mid) --------------------- */

export interface AnimPose {
  x: number;
  y: number;
  w: number;
  h: number;
  sx: number;
  sy: number;
  /** Point de pivot de la rotation dans le calque (px). */
  pivotX?: number;
  pivotY?: number;
  /** Angle de rotation du sprite (rad) au temps t. */
  rotation: number;
}

/** Position de l'élément animé dans le cadre à l'instant t (fraction du cadre → px). */
export function animPose(elapsed: number, width: number, height: number, focal: number, distance: number, shutter: number): AnimPose {
  const cfg = SCENE_LAYERS.find((c) => c.key === 'mid');
  const img = cfg ? layerCanvas(cfg) : null;
  if (!cfg || !img) return { x: -1e4, y: -1e4, w: 0, h: 0, sx: 0, sy: 0, rotation: 0 };
  const elapsedSec = elapsed / 1000;
  const zoom = focal / REF_FOCAL_MM;
  // Une vitesse lente laisse le temps au sujet de tourner davantage ; une
  // vitesse rapide le fige presque. L'échelle logarithmique suit les crans
  // photographiques : +1 IL double approximativement la rotation.
  const shutterStops = clamp(Math.log2(Math.max(shutter, 1 / 8000) / (1 / 1000)), 0, 6.5);
  const spinFactor = 0.25 + (shutterStops / 6.5) * 3.75;
  const spin = (cfg.spinRadsPerSec ?? 0) * spinFactor;
  const drift = cfg.driftFracPerSec ?? 0;
  const bob = cfg.bobFrac ?? 0;
  const period = cfg.bobPeriodSec ?? 3;
  // calque plein cadre : même axe que le décor, seule la rotation anime
  if (cfg.method === 'cover') {
    const distanceZoom = 1 + (5 - distance) * 0.08;
    const effectiveFocal = focal * distanceZoom;
    let srcW = clamp((img.width * REF_FOCAL_MM) / effectiveFocal, img.width / 8, img.width);
    let srcH = (srcW * height) / width;
    if (srcH > img.height) {
      srcH = img.height;
      srcW = (srcH * width) / height;
    }
    const srcX = (img.width - srcW) / 2;
    const srcY = (img.height - srcH) / 2;
    return {
      x: 0,
      y: 0,
      w: width,
      h: height,
      sx: img.width,
      sy: img.height,
      pivotX: ((cfg.anchorX * img.width - srcX) / srcW) * width,
      pivotY: ((cfg.anchorY * img.height - srcY) / srcH) * height,
      rotation: spin === 0 ? 0 : (spin * elapsedSec) % (Math.PI * 2)
    };
  }
  let ax = cfg.anchorX;
  let ay = cfg.anchorY;
  // un objet qui tourne reste en place ; sinon il dérive et flotte
  if (spin === 0) {
    ax = ax + drift * elapsedSec;
    ax = ax - Math.floor(ax);
    ay = cfg.anchorY + bob * Math.sin((elapsedSec / period) * Math.PI * 2);
  }
  const rotation = spin === 0 ? 0 : (spin * elapsedSec) % (Math.PI * 2);
  const drawW = cfg.widthFrac * zoom * width;
  const drawH = drawW * (img.width / img.height);
  return {
    x: ax * width - drawW / 2,
    y: ay * height - drawH / 2,
    w: drawW,
    h: drawH,
    sx: img.width,
    sy: img.height,
    rotation
  };
}

/** Dessine le sprite animé (rotation éventuelle autour de son centre). */
export function drawAnimatedSprite(ctx: CanvasRenderingContext2D, pose: AnimPose, sprite: HTMLCanvasElement): void {
  if (pose.w <= 0 || pose.h <= 0) return;
  if (pose.rotation === 0) {
    ctx.drawImage(sprite, pose.x, pose.y, pose.w, pose.h);
    return;
  }
  const pivotX = pose.pivotX ?? pose.w / 2;
  const pivotY = pose.pivotY ?? pose.h / 2;
  ctx.save();
  ctx.translate(pose.x + pivotX, pose.y + pivotY);
  ctx.rotate(pose.rotation);
  ctx.drawImage(sprite, -pivotX, -pivotY, pose.w, pose.h);
  ctx.restore();
}

/** Version « sprite prétraduit » de l'élément animé, prête pour l'overlay. */
export function bakeAnimatedSprite(elapsed: number, width: number, height: number, focal: number, distance: number, blur: number, shutter: number): HTMLCanvasElement | null {
  const cfg = SCENE_LAYERS.find((c) => c.key === 'mid');
  const img = cfg ? layerCanvas(cfg) : null;
  const pose = animPose(elapsed, width, height, focal, distance, shutter);
  if (!cfg || !img || !pose.w) return null;
  const out = makeCanvas(Math.ceil(pose.w), Math.ceil(pose.h));
  const c = ctx2d(out);
  if (cfg.method === 'cover') {
    // Même recadrage optique que les calques de la scène.
    const distanceZoom = 1 + (5 - distance) * 0.08;
    focalCropDraw(c, img, out.width, out.height, focal * distanceZoom);
  } else {
    c.drawImage(img, 0, 0, pose.w, pose.h);
  }
  if (blur > 0.5) {
    c.filter = `blur(${blur.toFixed(1)}px)`;
    c.drawImage(out, 0, 0);
    c.filter = 'none';
  }
  return out;
}

/* --------------------------------- rendu --------------------------------- */

/** Rend les 4 couches de scène (far, mid, subject, fg) à partir des images de configuration. */
export function renderSceneLayers(opts: LayerRenderOptions, animateMid: boolean): LayerRenderResult {
  const { width, height, focal, distance, shutter, elapsed, kelvinLevel } = opts;
  const zoom = focal / REF_FOCAL_MM;
  // S'éloigner réduit la taille apparente du sujet ; se rapprocher l'augmente.
  const distFactor = REF_DIST_M / distance;
  // De 1 à 5 m, la distance agit comme un déplacement de l'appareil : tout le
  // cadrage (décor et sujet) évolue autour du centre, sans palier inactif.
  // À 5 m, la scène est montrée dans son cadrage le plus large.
  const distanceZoom = 1 + (5 - distance) * 0.08;
  const distanceFocal = focal * distanceZoom;

  const far = makeCanvas(width, height);
  const farCtx = ctx2d(far);
  const bgFile = KELVIN_BACKGROUNDS[kelvinLevel] ?? DEFAULT_BACKGROUND;
  const bgImg = cache.get(bgFile) ?? null;

  if (bgImg) {
    // Même recadrage optique que le sujet : décor et personnages restent
    // alignés pixel pour pixel quelles que soient la focale et la distance.
    focalCropDraw(farCtx, bgImg, width, height, distanceFocal);
  } else {
    // décor absent : aplati neutre (aucun objet vectoriel procédural)
    farCtx.fillStyle = '#141b26';
    farCtx.fillRect(0, 0, width, height);
  }

  const mid = makeCanvas(width, height);
  if (animateMid) {
    const anim = SCENE_LAYERS.find((c) => c.key === 'mid');
    const animImg = anim ? layerCanvas(anim) : null;
    if (anim && animImg) {
      const pose = animPose(elapsed, width, height, focal, distance, shutter);
      if (anim.method === 'cover') {
        // plein cadre, même axe que le décor : seules la rotation anime
        const base = makeCanvas(width, height);
        focalCropDraw(ctx2d(base), animImg, width, height, distanceFocal);
        drawAnimatedSprite(ctx2d(mid), pose, base);
      } else {
        drawAnimatedSprite(ctx2d(mid), pose, animImg);
      }
    }
  }

  const nearBg = makeCanvas(width, height);
  const nearCfg = SCENE_LAYERS.find((c) => c.key === 'nearBg');
  const landscapeFile = KELVIN_LANDSCAPES[kelvinLevel];
  const nearImg = landscapeFile
    ? (cache.get(landscapeFile) ?? null)
    : (nearCfg ? layerCanvas(nearCfg) : null);
  if (nearCfg && nearImg) {
    const nearCtx = ctx2d(nearBg);
    focalCropDraw(nearCtx, nearImg, width, height, distanceFocal);
    const tint = LANDSCAPE_TINTS[kelvinLevel];
    if (tint) {
      nearCtx.save();
      nearCtx.globalCompositeOperation = 'source-atop';
      nearCtx.globalAlpha = tint.alpha;
      nearCtx.fillStyle = tint.color;
      nearCtx.fillRect(0, 0, width, height);
      nearCtx.restore();
    }
    // À 9 000 K, seule une brume légère voile le sommet du relief :
    // la géométrie et le cadrage restent strictement ceux du calque maître.
    if (kelvinLevel === 9) {
      const mist = nearCtx.createLinearGradient(0, height * 0.24, 0, height * 0.62);
      mist.addColorStop(0, 'rgba(221, 244, 246, 0)');
      mist.addColorStop(0.36, 'rgba(221, 244, 246, 0.14)');
      mist.addColorStop(1, 'rgba(221, 244, 246, 0)');
      nearCtx.save();
      nearCtx.globalCompositeOperation = 'source-atop';
      nearCtx.fillStyle = mist;
      nearCtx.fillRect(0, 0, width, height);
      nearCtx.restore();
    }
  }

  const subject = makeCanvas(width, height);
  const subjectCtx = ctx2d(subject);
  const subj = SCENE_LAYERS.find((c) => c.key === 'subject');
  const subjectFile = KELVIN_SUBJECTS[kelvinLevel] ?? subj?.file;
  const subjImg = subjectFile ? imageCanvas(subjectFile) : null;
  let subjectPxPerM = 0;
  let subjectFocusScreenY: number | null = null;
  let subjectFeetScreenY: number | null = null;
  if (subj && subjImg) {
    if (subj.method === 'cover') {
      // PNG plein cadre : calage dans son canevas d'origine, puis exactement
      // le même recadrage que le décor.
      const baseScale = subj.frameScale ?? 1;
      const scale = baseScale;
      const baseOffsetX = (subj.frameOffsetXFrac ?? 0) * subjImg.width;
      const baseOffsetY = (subj.frameOffsetYFrac ?? 0) * subjImg.height;
      // La famille change d'échelle autour de son point d'appui, pas depuis le
      // coin du PNG : son placement reste naturel lorsque la distance varie.
      const anchorX = (subj.frameScaleAnchorXFrac ?? 0.5) * subjImg.width;
      const anchorY = (subj.frameScaleAnchorYFrac ?? 0.9) * subjImg.height;
      const offsetX = baseOffsetX + baseScale * anchorX - scale * anchorX;
      const offsetY = baseOffsetY + baseScale * anchorY - scale * anchorY;
      const aligned = makeCanvas(subjImg.width, subjImg.height);
      ctx2d(aligned).drawImage(subjImg, offsetX, offsetY, subjImg.width * scale, subjImg.height * scale);
      const crop = focalCropDraw(subjectCtx, aligned, width, height, distanceFocal);
      const focusInSource = offsetY + subjImg.height * scale * (subj.focusYFrac ?? 0.5);
      subjectFocusScreenY = ((focusInSource - crop.srcY) / crop.srcH) * height;
      const feetInSource = offsetY + subjImg.height * scale * (subj.feetYFrac ?? 0.95);
      subjectFeetScreenY = ((feetInSource - crop.srcY) / crop.srcH) * height;
      subjectPxPerM = (width / crop.srcW) * subjImg.width * scale / Math.max(subj.approxWidthM, 0.05);
    } else {
      const drawW = subj.widthFrac * zoom * distFactor * width;
      const drawH = drawW * (subjImg.height / subjImg.width);
      const cx = subj.anchorX * width - drawW / 2;
      const cy = subj.anchorY * height - drawH;
      subjectCtx.drawImage(subjImg, cx, cy, drawW, drawH);
      subjectPxPerM = drawW / Math.max(subj.approxWidthM, 0.05);
    }
  }
  // Les flammes restent un calque distinct afin de pouvoir les animer plus tard,
  // mais partagent pour l'instant le plan de netteté du personnage et du foyer.
  const fireCfg = SCENE_LAYERS.find((c) => c.key === 'fire');
  const fireImg = fireCfg ? layerCanvas(fireCfg) : null;
  if (fireCfg && fireImg) focalCropDraw(subjectCtx, fireImg, width, height, distanceFocal);


  const fg = makeCanvas(width, height);
  const fgCtx = ctx2d(fg);
  const fgCfg = SCENE_LAYERS.find((c) => c.key === 'fg');
  const fgImg = fgCfg ? layerCanvas(fgCfg) : null;
  if (fgImg && fgCfg) {
    if (fgCfg.method === 'cover') focalCropDraw(fgCtx, fgImg, width, height, distanceFocal);
    else {
      const drawW = fgCfg.widthFrac * width * zoom;
      const drawH = drawW * (fgImg.height / fgImg.width);
      const bandY = fgCfg.anchorY * height - drawH;
      fgCtx.drawImage(fgImg, 0, bandY, drawW, drawH);
    }
  }

  const subjCfg = SCENE_LAYERS.find((c) => c.key === 'subject');
  let focusScreenY = height * 0.5;
  let feetScreenY = height * 0.82;
  if (subjCfg?.method === 'sprite' && subjImg) {
    const drawW = subjCfg.widthFrac * zoom * distFactor * width;
    const drawH = drawW * (subjImg.height / subjImg.width);
    const top = subjCfg.anchorY * height - drawH;
    focusScreenY = top + drawH * (subjCfg.focusYFrac ?? 0.5);
    feetScreenY = top + drawH * (subjCfg.feetYFrac ?? 0.95);
  } else if (subjectFocusScreenY !== null) {
    focusScreenY = subjectFocusScreenY;
    feetScreenY = subjectFeetScreenY ?? feetScreenY;
  }

  return { far, mid, nearBg, subject, fg, subjectPxPerM, focusScreenY, subjectFeetScreenY: feetScreenY };
}
