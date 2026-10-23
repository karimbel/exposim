import type { SimSettings } from '../camera/exposure';
import { renderSceneLayers } from './images';

export const SENSOR_WIDTH_MM = 36;
/** Hauteur de l'appareil au-dessus du sol (m). */
export const CAMERA_HEIGHT_M = 1.4;
/** Léger angle de plongée pour garder le sujet visible à toutes les focales (radians). */
export const LOOK_DOWN_RAD = (8 * Math.PI) / 180;
/** Position de la ligne d'horizon dans le cadre (fraction de la hauteur). */
export const HORIZON_FRACTION = 0.47;

/** Rendu à l'écran d'un point de l'espace monde (x latéral, y vertical, z profondeur), en mètres. */
export interface View {
  width: number;
  height: number;
  horizonY: number;
  worldX: (x: number, z: number) => number;
  worldY: (y: number, z: number) => number;
  pxPerMAt: (z: number) => number;
}

export interface RenderOptions {
  settings: SimSettings;
  width: number;
  height: number;
  seed?: number;
  /** false → couche animée vide (décor statique, pour l'aperçu performant). */
  animate?: boolean;
}

export interface SceneLayers {
  far: HTMLCanvasElement;
  mid: HTMLCanvasElement;
  nearBg: HTMLCanvasElement;
  subject: HTMLCanvasElement;
  fg: HTMLCanvasElement;
  /** Focale effective (mm) — utilisée pour le calcul du flou. */
  focalLength: number;
  /** Ouverture effective — utilisée pour le calcul du flou. */
  aperture: number;
  /** Distance sujet (m) depuis l'appareil. */
  subjectZ: number;
  /** Distance du plan actuellement visé par le collimateur. */
  focusZ: number;
  /** Pixels par mètre du sujet (pour le flou de filé). */
  subjectPxPerM: number;
  /** Position verticale de la ligne de mise au point dans le cadre (px). */
  focusScreenY: number;
  /** Ligne des pieds du sujet : départ du bokeh du premier plan. */
  subjectFeetScreenY: number;
  /** Le collimateur est-il verrouillé sur le sujet ? */
  focusOnSubject: boolean;
}

/** Profondeur de référence de chaque couche (m) pour le calcul du bokeh. */
export interface LayerDepth {
  far: number;
  mid: number;
  nearBg: number;
  subject: number;
  fg: number;
}

export const LAYER_DEPTH: LayerDepth = {
  far: 40,
  mid: 12,
  nearBg: 18,
  subject: 3,
  fg: 1.2
};

/**
 * Rend la scène à partir des 4 couches d'images (`SCENE_LAYERS`) :
 * fond, élément animé, sujet et premier plan. Aucun objet vectoriel procédural.
 */
export function renderScene(opts: RenderOptions): SceneLayers {
  const { settings, width, height } = opts;
  const animate = opts.animate ?? true;
  const elapsed = typeof performance !== 'undefined' ? performance.now() : 0;

  const layers = renderSceneLayers(
    {
      width,
      height,
      focal: settings.focalLength,
      distance: settings.distance,
      shutter: settings.shutter,
      lighting: settings.lighting,
      elapsed
    },
    animate
  );

  return {
    far: layers.far,
    mid: layers.mid,
    nearBg: layers.nearBg,
    subject: layers.subject,
    fg: layers.fg,
    focalLength: settings.focalLength,
    aperture: settings.aperture,
    subjectZ: settings.distance,
    focusZ: settings.focusDistance ?? settings.distance,
    subjectPxPerM: layers.subjectPxPerM,
    focusScreenY: settings.focusY * height,
    subjectFeetScreenY: layers.subjectFeetScreenY,
    focusOnSubject: settings.focusDistance === null
  };
}
