# ExpoSim

> La scène, notre image.  
> *The scene, our image.*

---

## 🇫🇷 À propos

**ExpoSim** est un simulateur photographique interactif conçu pour rendre la technique photo sensible, immédiate et visuelle.

À travers une scène vivante, l'utilisateur compose son image comme avec un appareil photo : il choisit sa focale, sa distance, sa mise au point, son ouverture, sa vitesse et sa sensibilité ISO. Chaque réglage transforme le rendu et met en évidence les liens entre exposition, profondeur de champ, mouvement et cadrage.

L'objectif n'est pas de reproduire l'interface d'un appareil existant, mais de proposer une expérience pédagogique claire, contemporaine et agréable à explorer.

### Ce que l'on peut expérimenter

- Les modes de prise de vue P, Av, Tv et M
- L'équilibre entre ISO, ouverture et vitesse
- Le bokeh et la profondeur de champ
- La mise au point par clic directement dans le viseur
- La focale, la distance et leur influence sur le cadrage
- Le filé du sujet, le bougé à main levée et l'effet stabilisateur du trépied
- L'eau qui devient laiteuse en pose lente
- Le grain, la balance des blancs et cinq ambiances lumineuses, de la pleine lune au plein soleil
- L'alerte de hautes lumières : les zones brûlées clignotent dans le viseur et sur les photos
- La grille des tiers pour composer l'image
- La prise, la consultation et l'export des photos, avec leurs réglages et la comparaison de deux photos côte à côte

### Une scène qui peut évoluer

Chaque ambiance repose sur une photo, sa carte de profondeur (qui pilote le flou), un masque d'eau et un élément animé. Cette architecture permet de remplacer facilement l'univers visuel d'ExpoSim et de créer de nouveaux exercices ou situations photographiques.

### Feuille de route

- [ ] Compensation d'exposition (±3 IL) en modes P, Av et Tv
- [ ] Défis : reproduire une photo cible avec les bons réglages
- [ ] Flammes animées pour la scène du feu de camp

---

## 🇬🇧 About

**ExpoSim** is an interactive photography simulator designed to make photographic technique visual, intuitive, and hands-on.

Using a living scene, the user composes an image as they would with a camera: selecting focal length, subject distance, focus, aperture, shutter speed, and ISO. Each setting changes the image and reveals the relationships between exposure, depth of field, motion, and framing.

The goal is not to replicate a specific camera interface, but to offer a clear, contemporary, and enjoyable learning experience.

### What you can explore

- P, Av, Tv, and M shooting modes
- The balance between ISO, aperture, and shutter speed
- Bokeh and depth of field
- Click-to-focus directly in the viewfinder
- Focal length, distance, and their effect on framing
- Subject motion blur, handheld camera shake, and tripod stabilisation
- Water turning silky with long exposures
- Grain, white balance, and five lighting moods, from full moon to full sun
- Highlight alert: blown-out areas blink in the viewfinder and on your photos
- A rule-of-thirds grid for composition
- Capturing, reviewing, and exporting your photos, with their settings and side-by-side comparison of two shots

### An adaptable scene

Each lighting mood is built from a photo, its depth map (which drives the blur), a water mask, and an animated element. This makes it easy to replace ExpoSim's visual world and create new photographic scenarios or learning exercises.

### Roadmap

- [ ] Exposure compensation (±3 EV) in P, Av, and Tv modes
- [ ] Challenges: match a target photo with the right settings
- [ ] Animated flames for the campfire scene

---

## Licence / License

Ce projet est proposé sous licence [Creative Commons Attribution – Pas d'Utilisation Commerciale – Partage dans les Mêmes Conditions 4.0 International (CC BY-NC-SA 4.0)](https://creativecommons.org/licenses/by-nc-sa/4.0/deed.fr).

This project is released under the [Creative Commons Attribution–NonCommercial–ShareAlike 4.0 International (CC BY-NC-SA 4.0)](https://creativecommons.org/licenses/by-nc-sa/4.0/) license.

ExpoSim est un projet indépendant, inspiré du principe pédagogique des simulateurs photographiques. Il ne réutilise ni le code ni les images de CameraSim.

ExpoSim is an independent project inspired by the educational principle of photography simulators. It does not reuse CameraSim code or imagery.

---

## Développement / Development

```bash
npm install
npm run dev      # serveur local / local server
npm run build    # site statique dans dist/ / static site in dist/
```

Le site est publié sur GitHub Pages à chaque envoi sur `main`. / The site is deployed to GitHub Pages on every push to `main`.
