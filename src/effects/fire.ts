/**
 * Feu de camp animé : le sprite détouré (bûches + flammes) est séparé en deux
 * couches. Les bûches restent fixes ; les flammes ondulent (vague qui monte,
 * plus ample vers les pointes) et palpitent en hauteur.
 *
 * En pose lente, plusieurs instants de la flamme sont moyennés sur la durée
 * de la pose : au 1/500 la flamme est figée et découpée, au 1/4 elle devient
 * un voile lumineux lisse, comme sur une vraie photo.
 */
import { clamp } from '../camera/exposure';
import { ctx2d, makeCanvas } from '../scene/objects';

export interface FireLayers {
  /** Bûches et braises (sans les flammes). */
  logs: HTMLCanvasElement;
  /** Flammes seules. */
  flame: HTMLCanvasElement;
}

/** Sépare bûches et flammes d'après la couleur (jaune ou orange vif = flamme). */
export function splitFire(src: CanvasImageSource & { width: number; height: number }): FireLayers {
  const w = src.width;
  const h = src.height;
  const all = makeCanvas(w, h);
  ctx2d(all).drawImage(src, 0, 0);
  const data = ctx2d(all).getImageData(0, 0, w, h);
  const logsData = new ImageData(w, h);
  const flameData = new ImageData(w, h);
  const d = data.data;
  for (let i = 0; i < d.length; i += 4) {
    const r = d[i] / 255;
    const g = d[i + 1] / 255;
    const fl = Math.max(clamp((g - 0.38) / 0.25, 0, 1), clamp((r - 0.68) / 0.2, 0, 1) * clamp((r - g) / 0.3, 0, 1));
    for (let k = 0; k < 3; k++) {
      logsData.data[i + k] = d[i + k];
      flameData.data[i + k] = d[i + k];
    }
    logsData.data[i + 3] = Math.round(d[i + 3] * (1 - fl));
    flameData.data[i + 3] = Math.round(d[i + 3] * fl);
  }
  const logs = makeCanvas(w, h);
  ctx2d(logs).putImageData(logsData, 0, 0);
  const flame = makeCanvas(w, h);
  ctx2d(flame).putImageData(flameData, 0, 0);
  return { logs, flame };
}

/** Une image de la flamme à l'instant t (s). */
function flameFrame(flame: HTMLCanvasElement, out: HTMLCanvasElement, t: number): void {
  const w = flame.width;
  const h = flame.height;
  const ctx = ctx2d(out);
  ctx.clearRect(0, 0, w, h);
  // Palpitation : la flamme s'étire et se tasse, ancrée sur les bûches.
  const stretch = 1 + 0.07 * Math.sin(t * 6.3) + 0.04 * Math.sin(t * 10.7 + 0.8);
  const step = 2;
  for (let y = 0; y < h; y += step) {
    const up = 1 - y / h; // 0 en bas, 1 en haut
    const amp = 8.5 * Math.pow(up, 1.6) * (0.75 + 0.25 * Math.sin(t * 3.1));
    const dx = amp * (Math.sin(y * 0.05 - t * 9) + 0.5 * Math.sin(y * 0.12 - t * 14.7 + 1.3));
    const sy = h - (h - y) / stretch;
    if (sy < 0) continue;
    ctx.drawImage(flame, 0, sy, w, step / stretch, dx, y, w, step);
  }
}

export class FireAnimator {
  private frame: HTMLCanvasElement;
  private acc: HTMLCanvasElement;

  constructor(private layers: FireLayers) {
    this.frame = makeCanvas(layers.flame.width, layers.flame.height);
    this.acc = makeCanvas(layers.flame.width, layers.flame.height);
  }

  /** Nombre d'instants moyennés pour une pose donnée. */
  static samples(shutter: number): number {
    return shutter < 1 / 90 ? 1 : Math.round(clamp(shutter * 45, 2, 14));
  }

  /**
   * Dessine le feu dans le rectangle (x, y, w, h) à l'instant t (s), avec le
   * flou de mouvement des flammes correspondant à la vitesse d'obturation.
   */
  draw(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, t: number, shutter: number): void {
    ctx.drawImage(this.layers.logs, x, y, w, h);
    const n = FireAnimator.samples(shutter);
    // La flamme change de forme en ~0,3 s : au-delà, la pose la lisse déjà.
    const span = Math.min(shutter, 0.6);
    const acc = ctx2d(this.acc);
    acc.clearRect(0, 0, this.acc.width, this.acc.height);
    for (let k = 0; k < n; k++) {
      flameFrame(this.layers.flame, this.frame, t - (span * k) / Math.max(1, n - 1));
      // Moyenne courante : chaque instant pèse 1/n dans le résultat.
      acc.globalAlpha = 1 / (k + 1);
      acc.drawImage(this.frame, 0, 0);
    }
    acc.globalAlpha = 1;
    ctx.save();
    // Scintillement de la luminosité.
    ctx.globalAlpha = n > 1 ? 1 : 0.9 + 0.1 * Math.sin(t * 13.3) * Math.sin(t * 4.1);
    // Pose lente : les formes successives se fondent en un voile lisse
    // (flou croissant avec la durée, à l'échelle du sprite affiché).
    const veil = n > 1 ? clamp(Math.log2(shutter * 60), 0, 5) * 1.6 * (w / this.acc.width) : 0;
    if (veil > 0.3) {
      ctx.filter = `blur(${veil.toFixed(2)}px)`;
      ctx.drawImage(this.acc, x, y, w, h);
      ctx.filter = 'none';
      // Le cœur de la flamme garde un peu de matière sous le voile.
      ctx.globalAlpha = 0.45;
    }
    ctx.drawImage(this.acc, x, y, w, h);
    ctx.restore();
  }
}
