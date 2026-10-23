export type Rng = () => number;

export function makeCanvas(w: number, h: number): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return c;
}

export function ctx2d(c: HTMLCanvasElement): CanvasRenderingContext2D {
  return c.getContext('2d')!;
}

export function mulberry32(seed: number): Rng {
  return function () {
    let a = seed | 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function hexToRgb(hex: string): [number, number, number] {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function mixRgb(a: [number, number, number], b: [number, number, number], t: number): [number, number, number] {
  return [
    Math.round(a[0] + (b[0] - a[0]) * t),
    Math.round(a[1] + (b[1] - a[1]) * t),
    Math.round(a[2] + (b[2] - a[2]) * t)
  ];
}

function rgbToHex(c: [number, number, number]): string {
  return `#${c.map((v) => v.toString(16).padStart(2, '0')).join('')}`;
}

/** Interpole entre deux couleurs selon la luminosité de la scène (1..10 → t). */
function lerpColor(c0: string, c1: string, t: number): string {
  return rgbToHex(mixRgb(hexToRgb(c0), hexToRgb(c1), Math.min(1, Math.max(0, t))));
}

/* --------------------------------- Sky ---------------------------------- */

/**
 * CIEL DE SECOURS — utilisé uniquement si le décor photo (`bg.jpg`) est absent.
 */
export function drawSky(ctx: CanvasRenderingContext2D, w: number, h: number, lighting: number): void {
  const t = (lighting - 1) / 9;
  const stopTop = lerpColor('#040b18', '#1158a6', t);
  const stopMid = lerpColor('#0a1f3d', '#6fb2e8', t);
  const stopLow = lerpColor('#0f2233', '#dff0fd', t);

  const g = ctx.createLinearGradient(0, 0, 0, h * 0.82);
  g.addColorStop(0, stopTop);
  g.addColorStop(0.5, stopMid);
  g.addColorStop(1, stopLow);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, w, h * 0.82 + 2);
}