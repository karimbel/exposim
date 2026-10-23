/**
 * Icônes filaires des lumières (échelle de Kelvin, crans 1 .. 9).
 * Grille 24 × 24, trait arrondi en `currentColor` : même style que les
 * icônes de titres de l'interface.
 */
export const LIGHT_ICONS: Record<number, string> = {
  // 1 000 K — bougie
  1: '<path d="M9.5 21h5"/><rect x="9" y="11" width="6" height="10" rx="1"/><path d="M12 11V9.5"/><path d="M12 9.5c-1.6-1.3-1.8-3-.2-5.5 1.8 2.3 1.9 4.1.2 5.5Z"/>',
  // 2 000 K — lampe à incandescence
  2: '<path d="M9.5 18h5M10 21h4"/><path d="M9 15.5c0-2.3-3-3.6-3-7a6 6 0 0 1 12 0c0 3.4-3 4.7-3 7Z"/><path d="M10.5 15.5 11 10l1 1.5 1-1.5.5 5.5"/>',
  // 3 000 K — coucher / lever du soleil
  3: '<path d="M2 18h20M5 21h14"/><path d="M7 18a5 5 0 0 1 10 0"/><path d="M12 7.5V5M5.6 10.6 4 9M18.4 10.6 20 9M3.5 15H2M22 15h-1.5"/>',
  // 4 000 K — clair de lune
  4: '<path d="M14.5 3.5a8 8 0 1 0 6 11.5 6.5 6.5 0 0 1-6-11.5Z"/><path d="M19 3v3M17.5 4.5h3M21 8.5v2M20 9.5h2"/>',
  // 5 000 K — matin / après-midi : soleil voilé par un nuage
  5: '<circle cx="9" cy="9" r="3.5"/><path d="M9 2.5V4M2.5 9H4M4.4 4.4l1 1M13.6 4.4l-1 1"/><path d="M8 20h9.5a3.5 3.5 0 0 0 .3-7 5 5 0 0 0-9.6 1.3A2.9 2.9 0 0 0 8 20Z"/>',
  // 6 000 K — lumière du jour
  6: '<circle cx="12" cy="12" r="4"/><path d="M12 2.5v2.5M12 19v2.5M2.5 12H5M19 12h2.5M5.3 5.3l1.8 1.8M16.9 16.9l1.8 1.8M18.7 5.3l-1.8 1.8M7.1 16.9l-1.8 1.8"/>',
  // 7 000 K — grand soleil : soleil plein, rayons longs
  7: '<circle cx="12" cy="12" r="3.2"/><circle cx="12" cy="12" r="5.6" stroke-dasharray="2 2.4"/><path d="M12 1.5v3M12 19.5v3M1.5 12h3M19.5 12h3M4.6 4.6l2.1 2.1M17.3 17.3l2.1 2.1M19.4 4.6l-2.1 2.1M6.7 17.3l-2.1 2.1"/>',
  // 8 000 K — ciel couvert
  8: '<path d="M6.5 19h11a4 4 0 0 0 .4-8 6 6 0 0 0-11.6 1.6A3.2 3.2 0 0 0 6.5 19Z"/><path d="M15 7.5a4 4 0 0 1 6 3.2"/>',
  // 9 000 K — ciel brumeux
  9: '<path d="M7 13h10a3.5 3.5 0 0 0 .3-7 5.2 5.2 0 0 0-10 1.4A2.8 2.8 0 0 0 7 13Z"/><path d="M3 16.5h13M7 19.5h14M4 22h9"/>'
};

export function lightIconSvg(level: number): string {
  const body = LIGHT_ICONS[level] ?? LIGHT_ICONS[6];
  return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${body}</svg>`;
}
