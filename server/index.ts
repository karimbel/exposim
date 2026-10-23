import path from 'node:path';
import express from 'express';
import type { Request, Response } from 'express';
import {
  APERTURE_STOPS,
  SHUTTER_STOPS,
  ISO_STOPS,
  deliveredEV,
  evOfLighting,
  exposureRatio,
  meterDelta,
  resolveEffective,
  type SimSettings
} from '../src/camera/exposure';

const app = express();
app.use(express.json());

const DIST_DIR = path.join(__dirname, '..', '..', 'dist');

/* -------------------------------- API ---------------------------------- */

app.get('/api/health', (_req: Request, res: Response) => {
  res.json({ status: 'ok', service: 'exposim', version: '1.0.0' });
});

app.get('/api/camera/config', (_req: Request, res: Response) => {
  res.json({
    isoStops: ISO_STOPS,
    apertureStops: APERTURE_STOPS,
    shutterStops: SHUTTER_STOPS,
    focalRange: { min: 18, max: 200, step: 1 },
    distanceRange: { min: 1.5, max: 20, step: 0.1 },
    lightingRange: { min: 1, max: 10, step: 1 },
    defaults: {
      mode: 'program',
      iso: 200,
      aperture: 5.6,
      shutter: 1 / 125,
      lighting: 7,
      distance: 3,
      focalLength: 24,
      tripod: true
    },
    lightingLabels: {
      1: 'Bougie',
      2: 'Crépuscule profond',
      3: 'Nuit urbaine',
      4: 'Intérieur sombre',
      5: 'Intérieur tamisé',
      6: 'Intérieur lumineux',
      7: 'Extérieur couvert',
      8: 'Ciel clair',
      9: 'Soleil franc',
      10: 'Pleine lumière'
    }
  });
});

/**
 * Calcule l'analyse d'exposition d'une combinaison.
 * GET /api/camera/analyse?mode=manual&iso=200&aperture=5.6&shutter=0.008&lighting=7
 */
app.get('/api/camera/analyse', (req: Request, res: Response) => {
  const q = req.query;
  const settings: SimSettings = {
    mode: (q.mode as SimSettings['mode']) || 'manual',
    iso: q.iso ? parseFloat(q.iso as string) : 200,
    aperture: q.aperture ? parseFloat(q.aperture as string) : 5.6,
    shutter: q.shutter ? parseFloat(q.shutter as string) : 1 / 125,
    lighting: q.lighting ? parseFloat(q.lighting as string) : 7,
    temperatureK: q.temperatureK ? parseFloat(q.temperatureK as string) : 5200,
    distance: q.distance ? parseFloat(q.distance as string) : 3,
    focusX: q.focusX ? parseFloat(q.focusX as string) : 0.5,
    focusY: q.focusY ? parseFloat(q.focusY as string) : 0.5,
    focusDistance: q.focusDistance ? parseFloat(q.focusDistance as string) : null,
    focalLength: q.focalLength ? parseFloat(q.focalLength as string) : 24,
    tripod: q.tripod === 'true' || q.tripod === '1'
  };

  const effective = resolveEffective(settings);
  const requiredEV = evOfLighting(settings.lighting);
  const delivered = deliveredEV(effective.aperture, effective.shutter, effective.iso);

  res.json({
    requested: settings,
    effective,
    requiredEV,
    deliveredEV: delivered,
    deltaEV: meterDelta(effective.aperture, effective.shutter, effective.iso, settings.lighting),
    exposureRatio: exposureRatio(effective.aperture, effective.shutter, effective.iso, settings.lighting)
  });
});

/* ------------------------------- statique ------------------------------- */

app.use(express.static(DIST_DIR));

// SPA fallback — mais pas pour les fichiers d'assets manquants (retourner 404)
app.get('*', (req: Request, res: Response) => {
  if (/\.(png|jpe?g|gif|svg|webp|ico|js|css|map|woff2?|ttf)$/i.test(req.path)) {
    res.status(404).type('text/plain').send('Not found');
    return;
  }
  res.sendFile(path.join(DIST_DIR, 'index.html'));
});

/* --------------------------------- boot --------------------------------- */

const PORT = Number(process.env.PORT || 3000);
app.listen(PORT, () => {
  console.log(`[exposim] API + client sur http://localhost:${PORT}`);
});
