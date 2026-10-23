/**
 * Scènes photographiques : une image entière + sa carte de profondeur.
 *
 * Pas de calques à caler : la carte de profondeur (niveaux de gris, calculée
 * avec Depth Anything V2) donne la distance de chaque pixel. Le flou est
 * ensuite calculé pixel par pixel (`effects/dof.ts`), devant comme derrière
 * le plan de mise au point.
 *
 * Carte de profondeur : valeur 255 = 1 m, 0 = infini (codage en disparité
 * 1/distance, directement proportionnelle au flou optique).
 */
import { clamp } from '../camera/exposure';
import { ctx2d, makeCanvas } from './objects';

export const PHOTO_BASE = 'scene/photo';
/** Valeur 255 de la carte = disparité 1 m⁻¹. */
export const DEPTH_MAX_DISP = 1;
/** Focale à laquelle l'image est montrée entière. */
export const PHOTO_REF_FOCAL = 24;
/** Distance du sujet dans l'image d'origine (m) : cadrage de référence. */
export const PHOTO_REF_DIST = 5;

export interface Spinner {
  /** Sprite détouré, centré sur son axe de rotation. */
  file: string;
  /** Centre de rotation (fractions de l'image). */
  cx: number;
  cy: number;
  /** Largeur du sprite (fraction de la largeur de l'image). */
  widthFrac: number;
  /** Rotation affichée dans le viseur (rad/s), lente et lisible. */
  displaySpin: number;
  /** Rotation réelle (rad/s) : angle parcouru pendant la pose (filé). */
  realSpin: number;
}

export interface PhotoScene {
  id: string;
  /** Image nette partout (l'objet animé en est retiré s'il y en a un). */
  image: string;
  /** Carte de profondeur alignée pixel pour pixel. */
  depth: string;
  /** Masque du lac (blanc = eau) : lissé en pose longue. */
  water?: string;
  /** Disparité du sujet (m⁻¹) : mise au point par défaut. */
  subjectDisp: number;
  /** Centre du sujet (fractions de l'image) : le zoom le garde dans le cadre. */
  subjectX: number;
  subjectY: number;
  spinner?: Spinner;
  /** Température de couleur d'origine (K) : réglage proposé avec cette lumière. */
  nativeK: number;
  /** Niveaux de lumière (1 .. 9) qui utilisent cette scène. */
  levels: number[];
}

export const PHOTO_SCENES: PhotoScene[] = [
  {
    id: 'lune',
    image: `${PHOTO_BASE}/lune.webp`,
    depth: `${PHOTO_BASE}/lune-profondeur.png`,
    water: `${PHOTO_BASE}/lune-lac.png`,
    subjectDisp: 0.21,
    subjectX: 0.33,
    subjectY: 0.56,
    nativeK: 4000,
    levels: [1]
  },
  {
    id: 'feu',
    image: `${PHOTO_BASE}/feu.webp`,
    depth: `${PHOTO_BASE}/feu-profondeur.png`,
    water: `${PHOTO_BASE}/feu-lac.png`,
    subjectDisp: 0.21,
    subjectX: 0.33,
    subjectY: 0.56,
    nativeK: 2000,
    levels: [2, 3]
  },
  {
    id: 'coucher',
    image: `${PHOTO_BASE}/coucher.webp`,
    depth: `${PHOTO_BASE}/coucher-profondeur.png`,
    water: `${PHOTO_BASE}/coucher-lac.png`,
    subjectDisp: 0.21,
    subjectX: 0.33,
    subjectY: 0.56,
    spinner: {
      file: `${PHOTO_BASE}/coucher-moulinet.webp`,
      cx: 389 / 1536,
      cy: 247 / 1024,
      widthFrac: 238 / 1536,
      displaySpin: 2.5,
      // ~10 tours/s : figé au 1/1000, filé visible au 1/60, disque flou au 1/15.
      realSpin: 60
    },
    nativeK: 3000,
    levels: [4, 5]
  },
  {
    id: 'couvert',
    image: `${PHOTO_BASE}/couvert.webp`,
    depth: `${PHOTO_BASE}/couvert-profondeur.png`,
    water: `${PHOTO_BASE}/couvert-lac.png`,
    subjectDisp: 0.21,
    subjectX: 0.33,
    subjectY: 0.56,
    spinner: {
      file: `${PHOTO_BASE}/couvert-moulinet.webp`,
      cx: 389 / 1536,
      cy: 247 / 1024,
      widthFrac: 240 / 1536,
      displaySpin: 2.5,
      // ~10 tours/s : figé au 1/1000, filé visible au 1/60, disque flou au 1/15.
      realSpin: 60
    },
    nativeK: 8000,
    levels: [6, 7]
  },
  {
    id: 'soleil',
    image: `${PHOTO_BASE}/soleil.webp`,
    depth: `${PHOTO_BASE}/soleil-profondeur.png`,
    water: `${PHOTO_BASE}/soleil-lac.png`,
    subjectDisp: 0.21,
    subjectX: 0.33,
    subjectY: 0.56,
    spinner: {
      file: `${PHOTO_BASE}/soleil-moulinet.webp`,
      cx: 390 / 1536,
      cy: 256 / 1024,
      widthFrac: 238 / 1536,
      displaySpin: 2.5,
      // ~10 tours/s : figé au 1/1000, filé visible au 1/60, disque flou au 1/15.
      realSpin: 60
    },
    nativeK: 6000,
    levels: [8, 9]
  }
];

export function sceneForLevel(level: number): PhotoScene {
  const l = Math.round(clamp(level, 1, 9));
  return PHOTO_SCENES.find((s) => s.levels.includes(l)) ?? PHOTO_SCENES[PHOTO_SCENES.length - 1];
}

/* ------------------------------- chargement ------------------------------- */

const images = new Map<string, HTMLImageElement | null>();
const pending = new Map<string, Promise<void>>();

function load(src: string): Promise<void> {
  if (images.has(src)) return Promise.resolve();
  const existing = pending.get(src);
  if (existing) return existing;
  const p = new Promise<void>((resolve) => {
    const img = new Image();
    img.onload = () => { images.set(src, img); resolve(); };
    img.onerror = () => { console.warn('[exposim] image indisponible :', src); images.set(src, null); resolve(); };
    img.src = `${import.meta.env.BASE_URL}${src}`;
  });
  pending.set(src, p);
  return p;
}

export function loadPhotoScenes(): Promise<void> {
  const files = PHOTO_SCENES.flatMap((s) => [s.image, s.depth, ...(s.water ? [s.water] : []), ...(s.spinner ? [s.spinner.file] : [])]);
  return Promise.all(files.map(load)).then(() => undefined);
}

export function photoImage(src: string): HTMLImageElement | null {
  return images.get(src) ?? null;
}

/* -------------------------------- cadrage --------------------------------- */

export interface Crop { x: number; y: number; w: number; h: number }

/** Recadrage (fractions de l'image) pour la focale et la distance choisies. */
export interface ZoomAnchor {
  /** Point de l'image (fractions) autour duquel on zoome… */
  ix: number;
  iy: number;
  /** … et sa position fixe dans le viseur (fractions). */
  sx: number;
  sy: number;
}

export function photoCrop(focal: number, distance: number, aspect: number, imgAspect: number, anchor: ZoomAnchor = { ix: 0.5, iy: 0.5, sx: 0.5, sy: 0.5 }): Crop {
  // Se rapprocher du sujet resserre le cadrage (1 m → ×1,32).
  const eff = focal * (1 + (PHOTO_REF_DIST - distance) * 0.08);
  let w = clamp(PHOTO_REF_FOCAL / eff, 1 / 8, 1);
  let h = (w * imgAspect) / aspect;
  if (h > 1) { h = 1; w = aspect / imgAspect; }
  // Le cadrage zoomé est centré sur le point de mise au point, dans la
  // limite des bords de l'image (au 24 mm, l'image entière est visible).
  const x = clamp(anchor.ix - w / 2, 0, 1 - w);
  const y = clamp(anchor.iy - h / 2, 0, 1 - h);
  return { x, y, w, h };
}

/** Dessine la zone recadrée d'une image dans un canvas w × h. */
export function drawCropped(img: CanvasImageSource & { width: number; height: number }, crop: Crop, w: number, h: number): HTMLCanvasElement {
  const out = makeCanvas(w, h);
  const c = ctx2d(out);
  c.imageSmoothingQuality = 'high';
  c.drawImage(img, crop.x * img.width, crop.y * img.height, crop.w * img.width, crop.h * img.height, 0, 0, w, h);
  return out;
}

/** Masque recadré : la luminance de l'image devient le canal alpha. */
export function croppedMask(mask: HTMLImageElement, crop: Crop, w: number, h: number): HTMLCanvasElement {
  const c = drawCropped(mask, crop, w, h);
  const ctx = ctx2d(c);
  const d = ctx.getImageData(0, 0, w, h);
  for (let i = 0; i < d.data.length; i += 4) d.data[i + 3] = d.data[i];
  ctx.putImageData(d, 0, 0);
  return c;
}

/** Carte de disparité (m⁻¹) recadrée, à la résolution du viseur. */
export function croppedDisparity(depth: HTMLImageElement, crop: Crop, w: number, h: number, distance: number): Float32Array {
  const data = ctx2d(drawCropped(depth, crop, w, h)).getImageData(0, 0, w, h).data;
  // Distance réelle = distance de l'image × (distance choisie / 5 m).
  const scale = (DEPTH_MAX_DISP / 255) * (PHOTO_REF_DIST / distance);
  const out = new Float32Array(w * h);
  for (let i = 0; i < out.length; i++) out[i] = data[i * 4] * scale;
  return out;
}
