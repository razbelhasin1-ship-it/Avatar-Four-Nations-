import * as THREE from 'three';
import { Random } from '../../core/Random';

/**
 * Procedural canvas textures for architecture (cached, repeat-wrapped).
 * All colour textures are sRGB; detail/normal-ish maps are linear.
 */

const cache = new Map<string, THREE.Texture>();

function canvas(w: number, h: number): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return [c, c.getContext('2d')!];
}

function finish(c: HTMLCanvasElement, key: string, srgb = true): THREE.Texture {
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  t.anisotropy = 4;
  t.generateMipmaps = true;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  cache.set(key, t);
  return t;
}

function shade(hex: string, f: number): string {
  const c = new THREE.Color(hex);
  c.multiplyScalar(f);
  return '#' + c.getHexString();
}

/** Speckle/stain noise over the whole canvas. */
function grime(g: CanvasRenderingContext2D, w: number, h: number, r: Random, amount = 0.12, dark = '#000000'): void {
  g.globalAlpha = amount;
  for (let i = 0; i < (w * h) / 60; i++) {
    g.fillStyle = r.chance(0.5) ? dark : '#ffffff';
    g.globalAlpha = amount * r.range(0.2, 1);
    const s = r.range(1, 3.5);
    g.fillRect(r.range(0, w), r.range(0, h), s, s);
  }
  // soft stains
  for (let i = 0; i < 10; i++) {
    const x = r.range(0, w), y = r.range(0, h), rad = r.range(w * 0.05, w * 0.2);
    const grd = g.createRadialGradient(x, y, 0, x, y, rad);
    grd.addColorStop(0, `rgba(0,0,0,${amount * 0.6})`);
    grd.addColorStop(1, 'rgba(0,0,0,0)');
    g.globalAlpha = 1;
    g.fillStyle = grd;
    g.fillRect(x - rad, y - rad, rad * 2, rad * 2);
  }
  g.globalAlpha = 1;
}

/** Cut-stone blocks with mortar lines. One texture tile ≈ `tileMetres` in the world. */
export function stoneBlocks(base: string, mortar = '#00000055', rows = 6, cols = 4, seed = 1): THREE.Texture {
  const key = `stone:${base}:${mortar}:${rows}:${cols}:${seed}`;
  const hit = cache.get(key);
  if (hit) return hit;
  const [c, g] = canvas(256, 256);
  const r = new Random(seed);
  g.fillStyle = base;
  g.fillRect(0, 0, 256, 256);
  const rh = 256 / rows;
  for (let y = 0; y < rows; y++) {
    const offset = (y % 2) * (256 / cols / 2);
    const cw = 256 / cols;
    for (let x = -1; x <= cols; x++) {
      const bx = x * cw + offset;
      g.fillStyle = shade(base, r.range(0.82, 1.12));
      g.fillRect(bx + 1.5, y * rh + 1.5, cw - 3, rh - 3);
      // bevel highlight
      g.fillStyle = 'rgba(255,255,255,0.08)';
      g.fillRect(bx + 1.5, y * rh + 1.5, cw - 3, 2);
      g.fillStyle = 'rgba(0,0,0,0.12)';
      g.fillRect(bx + 1.5, y * rh + rh - 4, cw - 3, 2.5);
    }
  }
  g.strokeStyle = mortar;
  g.lineWidth = 2;
  for (let y = 0; y <= rows; y++) {
    g.beginPath();
    g.moveTo(0, y * rh);
    g.lineTo(256, y * rh);
    g.stroke();
  }
  grime(g, 256, 256, r, 0.1);
  return finish(c, key);
}

/** Smooth plaster/stucco with weathering. */
export function plaster(base: string, seed = 2): THREE.Texture {
  const key = `plaster:${base}:${seed}`;
  const hit = cache.get(key);
  if (hit) return hit;
  const [c, g] = canvas(256, 256);
  const r = new Random(seed);
  g.fillStyle = base;
  g.fillRect(0, 0, 256, 256);
  for (let i = 0; i < 1200; i++) {
    g.fillStyle = shade(base, r.range(0.9, 1.08));
    g.globalAlpha = 0.25;
    g.fillRect(r.range(0, 256), r.range(0, 256), r.range(2, 9), r.range(2, 9));
  }
  g.globalAlpha = 1;
  // vertical rain streaks
  for (let i = 0; i < 14; i++) {
    const x = r.range(0, 256);
    const grd = g.createLinearGradient(0, 0, 0, 256);
    grd.addColorStop(0, 'rgba(0,0,0,0)');
    grd.addColorStop(1, 'rgba(0,0,0,0.12)');
    g.fillStyle = grd;
    g.fillRect(x, r.range(0, 120), r.range(2, 6), 256);
  }
  grime(g, 256, 256, r, 0.06);
  return finish(c, key);
}

/** Wooden planks running along U. */
export function planks(base: string, seed = 3): THREE.Texture {
  const key = `planks:${base}:${seed}`;
  const hit = cache.get(key);
  if (hit) return hit;
  const [c, g] = canvas(256, 256);
  const r = new Random(seed);
  const n = 8;
  const ph = 256 / n;
  for (let i = 0; i < n; i++) {
    g.fillStyle = shade(base, r.range(0.8, 1.12));
    g.fillRect(0, i * ph, 256, ph);
    // grain
    g.strokeStyle = 'rgba(0,0,0,0.12)';
    g.lineWidth = 1;
    for (let k = 0; k < 5; k++) {
      g.beginPath();
      const y = i * ph + r.range(3, ph - 3);
      g.moveTo(0, y);
      for (let x = 0; x <= 256; x += 32) g.lineTo(x, y + r.range(-1.5, 1.5));
      g.stroke();
    }
    g.fillStyle = 'rgba(0,0,0,0.35)';
    g.fillRect(0, i * ph, 256, 1.5);
    // plank ends
    const cut = r.range(40, 216);
    g.fillRect(cut, i * ph, 1.5, ph);
  }
  grime(g, 256, 256, r, 0.07);
  return finish(c, key);
}

/** Curved roof tiles (rows along U, running down V). */
export function roofTiles(base: string, seed = 4): THREE.Texture {
  const key = `roof:${base}:${seed}`;
  const hit = cache.get(key);
  if (hit) return hit;
  const [c, g] = canvas(256, 256);
  const r = new Random(seed);
  g.fillStyle = shade(base, 0.6);
  g.fillRect(0, 0, 256, 256);
  const cols = 8;
  const cw = 256 / cols;
  for (let x = 0; x < cols; x++) {
    const grd = g.createLinearGradient(x * cw, 0, x * cw + cw, 0);
    const tone = r.range(0.88, 1.1);
    grd.addColorStop(0, shade(base, 0.62 * tone));
    grd.addColorStop(0.45, shade(base, 1.15 * tone));
    grd.addColorStop(1, shade(base, 0.7 * tone));
    g.fillStyle = grd;
    g.fillRect(x * cw + 1, 0, cw - 2, 256);
  }
  // tile overlaps
  for (let y = 0; y < 256; y += 32) {
    g.fillStyle = 'rgba(0,0,0,0.25)';
    g.fillRect(0, y, 256, 3);
    g.fillStyle = 'rgba(255,255,255,0.08)';
    g.fillRect(0, y + 3, 256, 2);
  }
  grime(g, 256, 256, r, 0.08);
  return finish(c, key);
}

/** Packed ice with cracks and bubbles. */
export function iceTexture(base = '#cfe8f6', seed = 5): THREE.Texture {
  const key = `ice:${base}:${seed}`;
  const hit = cache.get(key);
  if (hit) return hit;
  const [c, g] = canvas(256, 256);
  const r = new Random(seed);
  const grd = g.createLinearGradient(0, 0, 256, 256);
  grd.addColorStop(0, shade(base, 1.05));
  grd.addColorStop(1, shade(base, 0.85));
  g.fillStyle = grd;
  g.fillRect(0, 0, 256, 256);
  g.strokeStyle = 'rgba(255,255,255,0.55)';
  g.lineWidth = 1;
  for (let i = 0; i < 18; i++) {
    let x = r.range(0, 256), y = r.range(0, 256);
    g.beginPath();
    g.moveTo(x, y);
    for (let k = 0; k < 6; k++) {
      x += r.range(-30, 30);
      y += r.range(-30, 30);
      g.lineTo(x, y);
    }
    g.stroke();
  }
  // faint large blocks (carved ice bricks)
  g.strokeStyle = 'rgba(80,120,150,0.25)';
  g.lineWidth = 2;
  for (let y = 0; y <= 256; y += 64) {
    g.beginPath();
    g.moveTo(0, y);
    g.lineTo(256, y);
    g.stroke();
    for (let x = (y / 64) % 2 ? 0 : 64; x <= 256; x += 128) {
      g.beginPath();
      g.moveTo(x, y);
      g.lineTo(x, y + 64);
      g.stroke();
    }
  }
  for (let i = 0; i < 80; i++) {
    g.fillStyle = 'rgba(255,255,255,0.35)';
    g.beginPath();
    g.arc(r.range(0, 256), r.range(0, 256), r.range(0.5, 2), 0, Math.PI * 2);
    g.fill();
  }
  return finish(c, key);
}

/** Paving: irregular flagstones. */
export function flagstones(base: string, seed = 6): THREE.Texture {
  const key = `flag:${base}:${seed}`;
  const hit = cache.get(key);
  if (hit) return hit;
  const [c, g] = canvas(256, 256);
  const r = new Random(seed);
  g.fillStyle = shade(base, 0.55);
  g.fillRect(0, 0, 256, 256);
  const cell = 64;
  for (let y = 0; y < 256; y += cell) {
    for (let x = 0; x < 256; x += cell) {
      const inset = 2.5;
      const jx = r.range(-4, 4), jy = r.range(-4, 4);
      g.fillStyle = shade(base, r.range(0.85, 1.12));
      g.beginPath();
      g.moveTo(x + inset + jx * 0.3, y + inset);
      g.lineTo(x + cell - inset, y + inset + jy * 0.3);
      g.lineTo(x + cell - inset + jx * 0.2, y + cell - inset);
      g.lineTo(x + inset, y + cell - inset + jy * 0.2);
      g.closePath();
      g.fill();
    }
  }
  grime(g, 256, 256, r, 0.1);
  return finish(c, key);
}

/** Cloth/banner with a simple woven pattern. */
export function cloth(base: string, seed = 7): THREE.Texture {
  const key = `cloth:${base}:${seed}`;
  const hit = cache.get(key);
  if (hit) return hit;
  const [c, g] = canvas(128, 128);
  const r = new Random(seed);
  g.fillStyle = base;
  g.fillRect(0, 0, 128, 128);
  g.globalAlpha = 0.08;
  for (let i = 0; i < 128; i += 2) {
    g.fillStyle = i % 4 ? '#000' : '#fff';
    g.fillRect(0, i, 128, 1);
    g.fillRect(i, 0, 1, 128);
  }
  g.globalAlpha = 1;
  grime(g, 128, 128, r, 0.05);
  return finish(c, key);
}

/** Greyscale detail noise for breaking up flat colours (linear). */
export function detailNoise(seed = 9): THREE.Texture {
  const key = `noise:${seed}`;
  const hit = cache.get(key);
  if (hit) return hit;
  const [c, g] = canvas(128, 128);
  const r = new Random(seed);
  const img = g.createImageData(128, 128);
  for (let i = 0; i < 128 * 128; i++) {
    const v = 110 + r.range(0, 60);
    img.data[i * 4] = img.data[i * 4 + 1] = img.data[i * 4 + 2] = v;
    img.data[i * 4 + 3] = 255;
  }
  g.putImageData(img, 0, 0);
  return finish(c, key, false);
}

/** Emblem banner: element symbol in a circle on cloth. */
export function emblemBanner(bg: string, fg: string, emblem: 'water' | 'earth' | 'fire' | 'air', trim = '#d6b25e'): THREE.Texture {
  const key = `banner:${bg}:${fg}:${emblem}:${trim}`;
  const hit = cache.get(key);
  if (hit) return hit;
  const [c, g] = canvas(128, 256);
  g.fillStyle = bg;
  g.fillRect(0, 0, 128, 256);
  g.fillStyle = trim;
  g.fillRect(0, 0, 128, 10);
  g.fillRect(0, 246, 128, 10);
  g.fillRect(0, 0, 6, 256);
  g.fillRect(122, 0, 6, 256);
  g.strokeStyle = fg;
  g.fillStyle = fg;
  g.lineWidth = 7;
  g.lineCap = 'round';
  const cx = 64, cy = 118;
  if (emblem === 'water') {
    g.beginPath();
    g.arc(cx, cy, 40, 0, Math.PI * 2);
    g.stroke();
    for (let k = 0; k < 2; k++) {
      g.beginPath();
      const y = cy + k * 16 - 2;
      g.moveTo(cx - 32, y);
      g.bezierCurveTo(cx - 16, y - 12, cx - 4, y + 12, cx + 8, y);
      g.bezierCurveTo(cx + 16, y - 10, cx + 26, y + 6, cx + 32, y - 2);
      g.stroke();
    }
  } else if (emblem === 'earth') {
    g.beginPath();
    g.moveTo(cx - 22, cy - 40);
    g.lineTo(cx + 22, cy - 40);
    g.lineTo(cx + 36, cy + 20);
    g.lineTo(cx - 36, cy + 20);
    g.closePath();
    g.stroke();
    g.beginPath();
    g.moveTo(cx - 28, cy + 36);
    g.lineTo(cx + 28, cy + 36);
    g.moveTo(cx - 20, cy + 50);
    g.lineTo(cx + 20, cy + 50);
    g.stroke();
    g.beginPath();
    g.arc(cx, cy - 8, 9, 0, Math.PI * 1.6);
    g.stroke();
  } else if (emblem === 'fire') {
    g.beginPath();
    g.moveTo(cx, cy + 46);
    g.bezierCurveTo(cx - 44, cy + 40, cx - 36, cy - 6, cx - 14, cy - 30);
    g.bezierCurveTo(cx - 10, cy - 10, cx - 2, cy - 6, cx + 2, cy - 4);
    g.bezierCurveTo(cx, cy - 26, cx + 8, cy - 44, cx + 20, cy - 56);
    g.bezierCurveTo(cx + 22, cy - 30, cx + 44, cy - 10, cx + 40, cy + 18);
    g.bezierCurveTo(cx + 36, cy + 40, cx + 18, cy + 46, cx, cy + 46);
    g.stroke();
  } else {
    for (const [ox, oy] of [[0, -26], [-24, 18], [24, 18]]) {
      g.beginPath();
      g.arc(cx + ox, cy + oy, 14, 0, Math.PI * 1.7);
      g.stroke();
    }
  }
  return finish(c, key);
}

export function disposeKitTextures(): void {
  for (const t of cache.values()) t.dispose();
  cache.clear();
}
