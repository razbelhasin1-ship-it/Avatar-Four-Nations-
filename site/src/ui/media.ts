import { MEDIA } from '../data/media';

const base = 'media/';

/** Fill an <img> with the responsive WebP set for a screenshot key and a blurred placeholder. */
export function applyMedia(img: HTMLImageElement, key: string, sizes = '(max-width: 860px) 100vw, 60vw', eager = false): void {
  const m = MEDIA[key];
  if (!m) return;
  img.width = m.w;
  img.height = m.h;
  img.decoding = 'async';
  if (!eager) img.loading = 'lazy';
  img.sizes = sizes;
  img.srcset = m.widths.map((w) => `${base}${key}-${w}.webp ${w}w`).join(', ');
  img.src = `${base}${key}-${m.widths[Math.min(1, m.widths.length - 1)]}.webp`;
  img.style.backgroundImage = `url("${m.lqip}")`;
  img.style.backgroundSize = 'cover';
  img.style.backgroundPosition = 'center';
  const clear = () => {
    img.style.backgroundImage = '';
  };
  if (img.complete && img.naturalWidth) clear();
  else img.addEventListener('load', clear, { once: true });
}

export function mediaImg(key: string, alt: string, sizes?: string, eager = false): HTMLImageElement {
  const img = document.createElement('img');
  img.alt = alt;
  applyMedia(img, key, sizes, eager);
  return img;
}

/** Hydrate every <img data-media="key"> in the page. */
export function hydrateMedia(root: ParentNode = document): void {
  root.querySelectorAll<HTMLImageElement>('img[data-media]').forEach((img) => {
    const key = img.dataset.media!;
    const sizes = img.dataset.sizes ?? (img.closest('.avatar-bg') ? '100vw' : '(max-width: 860px) 100vw, 55vw');
    applyMedia(img, key, sizes);
  });
}
