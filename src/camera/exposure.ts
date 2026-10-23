export type CameraMode = 'program' | 'aperture-priority' | 'shutter-priority' | 'manual';

export type LightingLevel = 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9;

export interface SimSettings {
  /** P | Av | Tv | M */
  mode: CameraMode;
  /** Sensibilité ISO (en unités normalisées) */
  iso: number;
  /** Ouverture (f/number) */
  aperture: number;
  /** Vitesse d'obturation en secondes */
  shutter: number;
  /** Position sur l'échelle Kelvin (1 .. 9), conserve aussi l'EV associé. */
  lighting: number;
  /** Température de couleur effective en Kelvin. */
  temperatureK: number;
  /** Distance sujet <-> photographe en mètres (1 .. 6) */
  distance: number;
  /** Position verticale du collimateur dans le viseur (0 = haut, 1 = bas). */
  focusY: number;
  /** Position horizontale du collimateur dans le viseur (0 = gauche, 1 = droite). */
  focusX: number;
  /** Plan visé en mètres ; null signifie que le sujet est verrouillé. */
  focusDistance: number | null;
  /** Focale en millimètres (24, 28, 35, 50 ou 70) */
  focalLength: number;
  /** Trépied actif ? supprime le flou de bougé */
  tripod: boolean;
}

export interface SimConfig {
  isoStops: number[];
  apertureStops: number[];
  shutterStops: number[];
  focalStops: number[];
  distanceRange: { min: number; max: number; step: number };
  lightingRange: { min: number; max: number; step: number };
  lightingLabels: Record<number, string>;
  temperatureRange: { min: number; max: number; step: number };
  defaults: SimSettings;
}

/** Réglages par défaut : mode Programme, scène bien éclairée. */
export const DEFAULT_SETTINGS: SimSettings = {
  mode: 'program',
  iso: 200,
  aperture: 5.6,
  shutter: 1 / 125,
  lighting: 6,
  temperatureK: 6000,
  // Le cadrage maître du diorama correspond à la vue la plus large : 24 mm à 5 m.
  distance: 5,
  focusX: 0.5,
  focusY: 0.5,
  focusDistance: null,
  focalLength: 24,
  tripod: true
};

export const ISO_STOPS: number[] = [100, 200, 400, 800, 1600, 3200, 6400];
export const APERTURE_STOPS: number[] = [1.4, 2, 2.8, 4, 5.6, 8, 11, 16, 22];
export const SHUTTER_STOPS: number[] = [
  1 / 4000, 1 / 2000, 1 / 1000, 1 / 500, 1 / 250, 1 / 125,
  1 / 60, 1 / 30, 1 / 15, 1 / 8, 1 / 4, 1 / 2, 1, 2, 4, 8, 15, 30
];

/** EV (exposition requise, équivalent ISO 100) par niveau de lumière de jauges de 1 à 9. */
export const REQUIRED_EV: Record<number, number> = {
  1: 2,   // bougie
  2: 3,   // crépuscule profond
  3: 4,   // nuit urbaine
  4: 5,   // intérieur très sombre
  5: 6,   // intérieur tamisé
  6: 8,   // intérieur lumineux
  7: 10,  // extérieur nuageux
  8: 12,  // ciel couvert clair
  9: 14   // soleil franc
};

/** Échelle de température présentée dans le panneau de scène. */
export const KELVIN_STOPS: Record<number, { kelvin: number; label: string; icon: string }> = {
  1: { kelvin: 1000, label: 'Bougie', icon: '🕯' },
  2: { kelvin: 2000, label: 'Lampe incandescente', icon: '💡' },
  3: { kelvin: 3000, label: 'Coucher / lever du soleil', icon: '🌅' },
  4: { kelvin: 4000, label: 'Clair de lune', icon: '🌙' },
  5: { kelvin: 5000, label: 'Matin / après-midi', icon: '☀️' },
  6: { kelvin: 6000, label: 'Lumière du jour', icon: '☀️' },
  7: { kelvin: 7000, label: 'Grand soleil', icon: '🌞' },
  8: { kelvin: 8000, label: 'Ciel couvert', icon: '☁️' },
  9: { kelvin: 9000, label: 'Ciel brumeux', icon: '☁️≋' }
};

export function kelvinStop(level: number): { kelvin: number; label: string; icon: string } {
  return KELVIN_STOPS[Math.round(clamp(level, 1, 9))] ?? KELVIN_STOPS[6];
}

export function lightingLabels(): Record<number, string> {
  return Object.fromEntries(Object.entries(KELVIN_STOPS).map(([level, stop]) => [Number(level), stop.label]));
}

/* ----------------------------- Math helpers ----------------------------- */

export const log2 = (x: number): number => Math.log(x) / Math.LN2;
export const pow2 = (x: number): number => Math.pow(2, x);

export function clamp(v: number, min: number, max: number): number {
  if (!Number.isFinite(v)) return min;
  return Math.min(max, Math.max(min, v));
}

export function evOfLighting(lighting: number): number {
  const l = Math.round(clamp(lighting, 1, 9));
  return REQUIRED_EV[l];
}

/** EV réellement produit par la combinaison donnée, ramené à la sensibilité ISO. */
export function deliveredEV(aperture: number, shutter: number, iso: number): number {
  return log2((aperture * aperture) / shutter) + log2(iso / 100);
}

/**
 * Ratio d'exposition: 1 = parfait.
 * > 1 : sur-exposé (image claire), < 1 : sous-exposé (image sombre).
 */
export function exposureRatio(aperture: number, shutter: number, iso: number, lighting: number): number {
  const req = evOfLighting(lighting);
  const del = deliveredEV(aperture, shutter, iso);
  return pow2(del - req);
}

/**
 * Écart de pose au posemètre en IL (stops).
 * 0 = expo correcte, positif = sur-exposition, négatif = sous-exposition.
 */
export function meterDelta(aperture: number, shutter: number, iso: number, lighting: number): number {
  return deliveredEV(aperture, shutter, iso) - evOfLighting(lighting);
}

/* ------------------------- Résolution des modes ------------------------- */

/** Ouverture requise pour atteindre l'expo cible avec une vitesse donnée. */
export function apertureFor(shutter: number, iso: number, lighting: number): number {
  const target = evOfLighting(lighting) - log2(iso / 100) + log2(shutter);
  return pow2(0.5 * target);
}

/** Vitesse requise pour atteindre l'expo cible avec une ouverture donnée. */
export function shutterFor(aperture: number, iso: number, lighting: number): number {
  const ev = evOfLighting(lighting) - log2(iso / 100);
  return pow2(2 * log2(aperture) - ev);
}

/* ------------------------------ Odometers ------------------------------- */

export function nearestStop(value: number, stops: number[]): number {
  if (!Number.isFinite(value) || stops.length === 0) return stops[0];
  let best = stops[0];
  let bestDist = Infinity;
  for (const s of stops) {
    const d = Math.abs(log2(value / s));
    if (d < bestDist) {
      bestDist = d;
      best = s;
    }
  }
  return best;
}

/** Calcul complet du triangle d'exposition selon le mode actif. */
export interface ExposureSolution {
  aperture: number;
  shutter: number;
}

export function solveSettings(settings: SimSettings): ExposureSolution {
  const { mode, iso, aperture, shutter, lighting } = settings;
  const minA = APERTURE_STOPS[0];
  const maxA = APERTURE_STOPS[APERTURE_STOPS.length - 1];
  const fastest = SHUTTER_STOPS[0]; // ex. 1/4000
  const slowest = SHUTTER_STOPS[SHUTTER_STOPS.length - 1]; // ex. 30s

  switch (mode) {
    case 'aperture-priority': {
      const t = shutterFor(aperture, iso, lighting);
      return { aperture, shutter: nearestStop(clamp(t, fastest, slowest), SHUTTER_STOPS) };
    }
    case 'shutter-priority': {
      const a = apertureFor(shutter, iso, lighting);
      return { aperture: nearestStop(clamp(a, minA, maxA), APERTURE_STOPS), shutter };
    }
    case 'manual': {
      return { aperture, shutter };
    }
    case 'program':
    default: {
      // Ligne de programme : on cherche une combinaison équilibrée.
      let t = 1 / 60;
      let a = apertureFor(t, iso, lighting);
      if (a < minA) {
        a = minA;
        t = shutterFor(a, iso, lighting);
      } else if (a > maxA) {
        a = maxA;
        t = shutterFor(a, iso, lighting);
      }
      const snappedA = nearestStop(a, APERTURE_STOPS);
      const t2 = shutterFor(snappedA, iso, lighting);
      return { aperture: snappedA, shutter: nearestStop(clamp(t2, fastest, slowest), SHUTTER_STOPS) };
    }
  }
}

/** Résout les valeurs auto pour le mode et renvoie les réglages effectifs. */
export function resolveEffective(settings: SimSettings): SimSettings {
  const s = solveSettings(settings);
  return { ...settings, aperture: s.aperture, shutter: s.shutter };
}

/* ------------------------------- Config --------------------------------- */

export function defaultConfig(): SimConfig {
  return {
    isoStops: [...ISO_STOPS],
    apertureStops: [...APERTURE_STOPS],
    shutterStops: [...SHUTTER_STOPS],
    focalStops: [24, 28, 35, 50, 70],
    distanceRange: { min: 1, max: 5, step: 1 },
    lightingRange: { min: 1, max: 9, step: 1 },
    lightingLabels: lightingLabels(),
    temperatureRange: { min: 2000, max: 8000, step: 100 },
    defaults: { ...DEFAULT_SETTINGS }
  };
}

/* ------------------------------- Formatting ------------------------------ */

export function formatShutter(t: number): string {
  if (!Number.isFinite(t) || t <= 0) return '—';
  if (t >= 1) return `${Math.round(t)}s`;
  const n = Math.round(1 / t);
  return `1/${n}`;
}

export function formatAperture(a: number): string {
  if (!Number.isFinite(a) || a <= 0) return 'f/—';
  return `f/${a}`;
}

export function formatIso(i: number): string {
  if (!Number.isFinite(i) || i <= 0) return 'ISO —';
  return `ISO ${i}`;
}

export function formatFocal(f: number): string {
  if (!Number.isFinite(f) || f <= 0) return '— mm';
  return `${f}mm`;
}

export function formatDistance(d: number): string {
  return d < 10 ? `${d.toFixed(1)}m` : `${Math.round(d)}m`;
}
