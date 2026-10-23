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
  /** Niveau de luminosité de la scène (1 .. 9), voir `LIGHT_LEVELS`. */
  lighting: number;
  /** Température de couleur de la lumière en Kelvin (1 000 .. 9 000), indépendante de la luminosité. */
  temperatureK: number;
  /** Distance sujet <-> photographe en mètres (1 .. 5) */
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
  lighting: 8,
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

/**
 * Luminosité de la scène : IL de scène (base ISO 100) par niveau, de 1 à 9.
 * Valeurs usuelles des tables d'exposition (règle du « f/16 au soleil » = IL 15).
 * Ce réglage est indépendant de la température de couleur.
 */
export const LIGHT_LEVELS: Record<number, { ev: number; fr: string; en: string }> = {
  1: { ev: -2, fr: 'Nuit de pleine lune', en: 'Full-moon night' },
  2: { ev: 3, fr: 'Nuit, feu de camp', en: 'Night, campfire' },
  3: { ev: 5, fr: 'Crépuscule', en: 'Dusk' },
  4: { ev: 8, fr: 'Après le coucher du soleil', en: 'Just after sunset' },
  5: { ev: 10, fr: 'Coucher de soleil', en: 'Sunset' },
  6: { ev: 12, fr: 'Ciel très couvert', en: 'Heavy overcast' },
  7: { ev: 13, fr: 'Ciel couvert', en: 'Overcast' },
  8: { ev: 14, fr: 'Soleil voilé', en: 'Hazy sun' },
  9: { ev: 15, fr: 'Plein soleil', en: 'Full sun' }
};

/** Compatibilité : IL requis par niveau de lumière. */
export const REQUIRED_EV: Record<number, number> = Object.fromEntries(
  Object.entries(LIGHT_LEVELS).map(([level, l]) => [Number(level), l.ev])
);

/** Échelle de température présentée dans le panneau de scène (crans 1 .. 9). */
export const KELVIN_STOPS: Record<number, { kelvin: number; label: string; labelEn: string; icon: string }> = {
  1: { kelvin: 1000, label: 'Bougie', labelEn: 'Candle', icon: '🕯' },
  2: { kelvin: 2000, label: 'Lampe incandescente', labelEn: 'Incandescent bulb', icon: '💡' },
  3: { kelvin: 3000, label: 'Coucher / lever du soleil', labelEn: 'Sunrise / sunset', icon: '🌅' },
  4: { kelvin: 4000, label: 'Clair de lune', labelEn: 'Moonlight', icon: '🌙' },
  5: { kelvin: 5000, label: 'Matin / après-midi', labelEn: 'Morning / afternoon', icon: '☀️' },
  6: { kelvin: 6000, label: 'Lumière du jour', labelEn: 'Daylight', icon: '☀️' },
  7: { kelvin: 7000, label: 'Grand soleil', labelEn: 'Bright sun', icon: '🌞' },
  8: { kelvin: 8000, label: 'Ciel couvert', labelEn: 'Overcast sky', icon: '☁️' },
  9: { kelvin: 9000, label: 'Ciel brumeux', labelEn: 'Misty sky', icon: '☁️≋' }
};

export function kelvinStop(level: number): { kelvin: number; label: string; labelEn: string; icon: string } {
  return KELVIN_STOPS[Math.round(clamp(level, 1, 9))] ?? KELVIN_STOPS[6];
}

/** Cran Kelvin (1 .. 9) le plus proche d'une température donnée. */
export function kelvinLevel(kelvin: number): number {
  return Math.round(clamp(kelvin / 1000, 1, 9));
}

export function lightingLabels(language: 'fr' | 'en' = 'fr'): Record<number, string> {
  return Object.fromEntries(Object.entries(LIGHT_LEVELS).map(([level, l]) => [Number(level), l[language]]));
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

/**
 * IL de scène (base ISO 100) pour lequel la combinaison est correctement
 * exposée : EV100 = log2(N² / t) − log2(ISO / 100).
 * Fermer le diaphragme ou accélérer la vitesse l'augmente ; monter les ISO le
 * diminue (il faut alors moins de lumière).
 */
export function settingsEV(aperture: number, shutter: number, iso: number): number {
  return log2((aperture * aperture) / shutter) - log2(iso / 100);
}

/** @deprecated alias conservé pour l'API : utiliser `settingsEV`. */
export const deliveredEV = settingsEV;

/**
 * Ratio d'exposition: 1 = parfait.
 * > 1 : sur-exposé (image claire), < 1 : sous-exposé (image sombre).
 */
export function exposureRatio(aperture: number, shutter: number, iso: number, lighting: number): number {
  return pow2(meterDelta(aperture, shutter, iso, lighting));
}

/**
 * Écart de pose au posemètre en IL (stops).
 * 0 = expo correcte, positif = sur-exposition, négatif = sous-exposition.
 */
export function meterDelta(aperture: number, shutter: number, iso: number, lighting: number): number {
  return evOfLighting(lighting) - settingsEV(aperture, shutter, iso);
}

/* ------------------------- Résolution des modes ------------------------- */

/** Ouverture requise pour atteindre l'expo cible avec une vitesse donnée. */
export function apertureFor(shutter: number, iso: number, lighting: number): number {
  // N² = t · 2^(EV100 + log2(ISO/100))
  const target = evOfLighting(lighting) + log2(iso / 100) + log2(shutter);
  return pow2(0.5 * target);
}

/** Vitesse requise pour atteindre l'expo cible avec une ouverture donnée. */
export function shutterFor(aperture: number, iso: number, lighting: number): number {
  // t = N² / 2^(EV100 + log2(ISO/100))
  const ev = evOfLighting(lighting) + log2(iso / 100);
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
      // Ligne de programme : Av = log2(N²), Tv = log2(1/t), Av + Tv = IL (à l'ISO choisi).
      // En faible lumière on reste à pleine ouverture ; au-delà de 1/30 s, on
      // ferme d'un demi-cran pour chaque cran gagné, comme un appareil réel.
      const evAtIso = evOfLighting(lighting) + log2(iso / 100);
      const av = clamp((evAtIso - 6) / 2 + 1, log2(minA * minA), log2(maxA * maxA));
      const snappedA = nearestStop(Math.sqrt(pow2(av)), APERTURE_STOPS);
      const t = shutterFor(snappedA, iso, lighting);
      return { aperture: snappedA, shutter: nearestStop(clamp(t, fastest, slowest), SHUTTER_STOPS) };
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
    temperatureRange: { min: 1000, max: 9000, step: 1000 },
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
