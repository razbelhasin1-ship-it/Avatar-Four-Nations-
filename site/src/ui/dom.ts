type Child = Node | string | number | null | undefined | false;
type Attrs = Record<string, string | number | boolean | null | undefined>;

/** Build an element: attributes (class, aria-*, data-*, …) and children (text is escaped). */
export function h<K extends keyof HTMLElementTagNameMap>(tag: K, attrs?: Attrs | null, ...children: Child[]): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  if (attrs) {
    for (const [k, v] of Object.entries(attrs)) {
      if (v === null || v === undefined || v === false) continue;
      if (k === 'class') el.className = String(v);
      else if (k === 'text') el.textContent = String(v);
      else el.setAttribute(k, v === true ? '' : String(v));
    }
  }
  for (const c of children) {
    if (c === null || c === undefined || c === false) continue;
    el.append(typeof c === 'string' || typeof c === 'number' ? document.createTextNode(String(c)) : c);
  }
  return el;
}

const SVG_NS = 'http://www.w3.org/2000/svg';

/** An inline icon referencing a <symbol> in the page sprite. */
export function icon(id: string, cls?: string, viewBox = '0 0 24 24'): SVGSVGElement {
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('viewBox', viewBox);
  svg.setAttribute('aria-hidden', 'true');
  if (cls) svg.setAttribute('class', cls);
  const use = document.createElementNS(SVG_NS, 'use');
  use.setAttribute('href', `#${id}`);
  svg.append(use);
  return svg;
}

export const reducedMotion = (): boolean => matchMedia('(prefers-reduced-motion: reduce)').matches;
export const finePointer = (): boolean => matchMedia('(hover: hover) and (pointer: fine)').matches;

/** localStorage that never throws (private windows, blocked storage). */
export const store = {
  get(key: string): string | null {
    try {
      return localStorage.getItem(key);
    } catch {
      return null;
    }
  },
  set(key: string, value: string): void {
    try {
      localStorage.setItem(key, value);
    } catch {
      /* storage unavailable */
    }
  },
};
