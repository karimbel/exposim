/**
 * Configuration de la scène photographique.
 *
 * Toutes les images originales ont les mêmes dimensions et sont **superposées
 * sur le même axe** (calque plein cadre, recadré centré) :
 *
 *   1. `far`      → ciel                    → `sky-clear.png`
 *   2. `nearBg`   → lac, collines et table  → `landscape.png`
 *   3. `subject`  → personnage et foyer     → `camp-scene.png`
 *   4. `mid`      → pales du ventilateur    → `fan-blades.png`
 *   5. `fg`       → végétation proche       → `foreground.png`
 *
 * Chaque couche a son propre plan de profondeur (`depthM`) : plus il est éloigné
 * du plan de mise au point, plus il est flouté (profondeur de champ).
 */

export const SCENE_IMG_BASE = 'scene';
/** Focale de référence : distance à laquelle le recadrage du fond est 1:1. */
export const REF_FOCAL_MM = 28;
/** Distance de référence : cadrage maître à 5 m. */
export const REF_DIST_M = 5;

export interface SceneLayerConfig {
  key: 'far' | 'mid' | 'nearBg' | 'subject' | 'fire' | 'fg';
  /** Fichier image dans `public/scene/`. Laisser vide pour désactiver la couche. */
  file: string;
  /** `cover` remplit tout le cadre ; `sprite` place l'image à une position donnée. */
  method: 'cover' | 'sprite' | 'strip';
  /** Position horizontale de l'ancre (0 = gauche, 1 = droite). */
  anchorX: number;
  /** Position verticale de l'image (0 = haut, 1 = bas du cadre). */
  anchorY: number;
  /** Point de mise au point à l'intérieur de l'image (0 = haut, 1 = bas). */
  focusYFrac?: number;
  /** Ligne des pieds du sujet dans l'image (0 = haut, 1 = bas). */
  feetYFrac?: number;
  /** Échelle d'un calque plein cadre avant son recadrage optique. */
  frameScale?: number;
  /** Décalage horizontal d'un calque plein cadre (fraction de sa largeur). */
  frameOffsetXFrac?: number;
  /** Décalage vertical d'un calque plein cadre (fraction de sa hauteur). */
  frameOffsetYFrac?: number;
  /** Point fixe pendant un changement de distance (fractions du calque). */
  frameScaleAnchorXFrac?: number;
  frameScaleAnchorYFrac?: number;
  /** Largeur affichée en fraction de la largeur du cadre (à focale et distance de référence). */
  widthFrac: number;
  /** Plan de profondeur de la couche (m) — pilote le bokeh. */
  depthM: number;
  /** Largeur réelle approximative de l'élément (m) — pour l'effet de filé. */
  approxWidthM: number;
  /** Rotation de l'élément animé (rad/s) — couche `mid`. */
  spinRadsPerSec?: number;
  /** Déplacement horizontal animé (fraction du cadre / seconde) — couche `mid`. */
  driftFracPerSec?: number;
  /** Balancement vertical animé (fraction du cadre). */
  bobFrac?: number;
  /** Période du balancement (s). */
  bobPeriodSec?: number;
}

export const SCENE_LAYERS: SceneLayerConfig[] = [
  {
    key: 'far',
    file: `${SCENE_IMG_BASE}/bg.png`,
    method: 'cover',
    anchorX: 0.5,
    anchorY: 0,
    widthFrac: 1,
    depthM: 40,
    approxWidthM: 40
  },
  {
    key: 'mid',
    // En attente des calques définitifs du diorama.
    file: '',
    // Calque plein cadre transparent : les pales tournent autour du moyeu,
    // sans déplacer la cage ou le petit meuble.
    method: 'cover',
    anchorX: 0.246,
    anchorY: 0.419,
    widthFrac: 1,
    depthM: 3,
    approxWidthM: 0.35,
    // La vitesse réelle est modulée par la vitesse d'obturation choisie.
    spinRadsPerSec: 2.2
  },
  {
    key: 'nearBg',
    file: '',
    method: 'cover',
    anchorX: 0.5,
    anchorY: 0.5,
    widthFrac: 1,
    depthM: 18,
    approxWidthM: 20
  },
  {
    key: 'subject',
    file: `${SCENE_IMG_BASE}/subject.png`,
    // Tous les calques de la maquette ont la même définition et le même axe.
    method: 'cover',
    anchorX: 0.5,
    anchorY: 0.5,
    focusYFrac: 0.54,
    feetYFrac: 0.91,
    frameScaleAnchorXFrac: 0.5,
    frameScaleAnchorYFrac: 0.5,
    widthFrac: 1,
    depthM: 5,
    approxWidthM: 3
  },
  {
    key: 'fire',
    // Pas de flamme isolée tant que le foyer définitif n'est pas intégré.
    file: '',
    method: 'cover',
    anchorX: 0.5,
    anchorY: 0.5,
    widthFrac: 1,
    depthM: 3,
    approxWidthM: 0.4
  },
  {
    key: 'fg',
    // Étape de validation des images maîtres : aucun premier plan.
    file: '',
    method: 'cover',
    anchorX: 0.5,
    anchorY: 0.5,
    widthFrac: 1,
    depthM: 1.2,
    approxWidthM: 2
  }
];
