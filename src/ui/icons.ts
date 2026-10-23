import type { Element } from '../core/types';

/**
 * Original SVG emblems for the four elements (drawn for this project),
 * inspired by the traditional symbols: three spirals (air), a circle of waves
 * (water), a grounded trapezoid with a spiral (earth), a flame with a spiral (fire).
 */

const AIR = `<svg viewBox="0 0 100 100" fill="none" stroke="currentColor" stroke-width="6" stroke-linecap="round">
<path d="M50 30c6 0 10-4 10-9s-4-9-9-9-9 4-9 10c0 8 8 14 16 14"/>
<path d="M30 66c-1-6-5-9-10-8s-8 5-7 10 6 8 11 6c8-2 11-11 9-18"/>
<path d="M70 66c5 3 10 2 12-3s0-10-5-11-10 1-11 7c-1 8 5 15 13 16"/>
</svg>`;

const WATER = `<svg viewBox="0 0 100 100" fill="none" stroke="currentColor" stroke-width="6" stroke-linecap="round">
<circle cx="50" cy="50" r="40"/>
<path d="M18 50c10-8 20 8 32 0s22 8 32 0"/>
<path d="M22 66c9-6 18 6 28 0s19 6 28 0"/>
<path d="M30 36c4-10 18-12 22-2 3 8-6 12-10 8"/>
</svg>`;

const EARTH = `<svg viewBox="0 0 100 100" fill="none" stroke="currentColor" stroke-width="6" stroke-linecap="round" stroke-linejoin="round">
<path d="M30 14h40l14 52H16z"/>
<path d="M50 50c-6 0-8-6-4-9s10-1 10 5c0 7-8 11-14 8"/>
<path d="M22 78h56M30 88h40"/>
</svg>`;

const FIRE = `<svg viewBox="0 0 100 100" fill="none" stroke="currentColor" stroke-width="6" stroke-linecap="round" stroke-linejoin="round">
<path d="M50 90c-18 0-30-12-30-28 0-14 9-22 14-34 2 10 8 14 12 16 0-12 4-24 14-32 0 14 8 22 12 30 5 8 8 14 8 22 0 15-12 26-30 26z"/>
<path d="M50 74c-6 0-10-5-8-10s9-4 10 1"/>
</svg>`;

const AVATAR = `<svg viewBox="0 0 100 100" fill="none" stroke="currentColor" stroke-width="5" stroke-linecap="round">
<circle cx="50" cy="50" r="38"/>
<path d="M50 12v12M50 76v12M12 50h12M76 50h12"/>
<circle cx="50" cy="50" r="12"/>
</svg>`;

export const ELEMENT_SVG: Record<Element | 'avatar', string> = { air: AIR, water: WATER, earth: EARTH, fire: FIRE, avatar: AVATAR };

export const ELEMENT_COLORS: Record<Element | 'avatar', { color: string; glow: string; shadow: string }> = {
  air: { color: '#e8b04a', glow: '#ffe6a8', shadow: 'rgba(255,214,120,0.45)' },
  water: { color: '#2f6fd6', glow: '#9fd8ff', shadow: 'rgba(110,180,255,0.45)' },
  earth: { color: '#3f8f3a', glow: '#b9e59a', shadow: 'rgba(150,220,120,0.4)' },
  fire: { color: '#d0362a', glow: '#ffb070', shadow: 'rgba(255,120,60,0.45)' },
  avatar: { color: '#cfefff', glow: '#ffffff', shadow: 'rgba(207,239,255,0.6)' },
};

/** Inline emblem element with the element's colour. */
export function emblem(e: Element | 'avatar', cls = 'emblem'): HTMLElement {
  const span = document.createElement('span');
  span.className = cls;
  span.style.color = ELEMENT_COLORS[e].glow;
  span.innerHTML = ELEMENT_SVG[e];
  return span;
}

/** Icon for a technique icon key: element emblem keys or an emoji. */
export function iconHTML(key: string): string {
  if (key in ELEMENT_SVG) return `<span style="color:${ELEMENT_COLORS[key as Element].glow};display:inline-grid;width:28px;height:28px">${ELEMENT_SVG[key as Element]}</span>`;
  return key;
}
