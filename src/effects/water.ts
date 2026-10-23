/**
 * Eau en pose longue : pendant que l'obturateur reste ouvert, les vaguelettes
 * bougent et se moyennent. Le lac devient lisse et laiteux, les reflets
 * s'étirent en traînées horizontales. Au-dessus du 1/30 s, l'eau reste figée.
 */
import { clamp } from '../camera/exposure';
import { ctx2d, makeCanvas } from '../scene/objects';

/** Intensité (0..1) de l'effet selon la durée de pose. */
export function waterSmoothing(shutter: number): number {
  // 1/30 s → 0,1 · 1/8 s → 0,33 · 1/2 s → 0,67 · 2 s et plus → 1
  return clamp((Math.log2(Math.max(shutter, 1e-4)) + 5) / 6, 0, 1);
}

/**
 * `mask` : canvas de même taille dont le canal alpha vaut 1 sur le lac.
 * Seuls les pixels du lac sont moyennés (la barrière ou la haie ne bavent
 * pas dans l'eau).
 */
export function smoothWater(plate: HTMLCanvasElement, mask: HTMLCanvasElement, shutter: number): HTMLCanvasElement {
  const s = waterSmoothing(shutter);
  if (s < 0.06) return plate;
  const w = plate.width;
  const h = plate.height;

  // Eau seule (alpha = masque).
  const water = makeCanvas(w, h);
  const wctx = ctx2d(water);
  wctx.drawImage(plate, 0, 0);
  wctx.globalCompositeOperation = 'destination-in';
  wctx.drawImage(mask, 0, 0);

  // Moyenne de positions décalées horizontalement (les vagues avancent),
  // puis un léger flou vertical.
  const reach = 3 + 42 * s;
  const steps = clamp(Math.round(reach), 6, 40);
  const acc = makeCanvas(w, h);
  const actx = ctx2d(acc);
  actx.globalCompositeOperation = 'lighter';
  actx.globalAlpha = 1 / steps;
  for (let i = 0; i < steps; i++) actx.drawImage(water, ((i / (steps - 1)) - 0.5) * 2 * reach, 0);
  const soft = makeCanvas(w, h);
  const sctx = ctx2d(soft);
  sctx.filter = `blur(${(0.6 + 2.4 * s).toFixed(2)}px)`;
  sctx.drawImage(acc, 0, 0);
  sctx.filter = 'none';

  // getImageData rend des couleurs non prémultipliées : la moyenne est
  // donc normalisée sur les seuls pixels d'eau. On applique le résultat
  // avec l'alpha du masque d'origine.
  const sd = sctx.getImageData(0, 0, w, h);
  const md = ctx2d(mask).getImageData(0, 0, w, h).data;
  const blend = Math.pow(s, 0.7);
  for (let i = 0; i < sd.data.length; i += 4) {
    sd.data[i + 3] = sd.data[i + 3] > 8 ? md[i + 3] * blend : 0;
  }
  sctx.putImageData(sd, 0, 0);

  const out = makeCanvas(w, h);
  const octx = ctx2d(out);
  octx.drawImage(plate, 0, 0);
  octx.drawImage(soft, 0, 0);
  return out;
}
