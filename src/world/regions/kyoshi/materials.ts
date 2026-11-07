import * as THREE from 'three';
import { Random } from '../../../core/Random';

/**
 * Kyoshi Island's own materials, painted on canvases at build time (no image files): straw thatch in
 * layered courses for the Meeting Hall and the thatched houses and huts, and paper lattice windows
 * (shoji) that glow faintly warm. Both tile every 2 m like the kit's textures (roof and box UVs are in
 * metres / 2), the thatch's courses running along the eaves. Created once per build of the island;
 * the region disposes them with the rest of what it owns.
 */
export interface KyoshiMats {
  /** Fresh golden straw. */
  thatch: THREE.MeshStandardMaterial;
  /** Older, greyer straw with moss (some houses and the beach huts). */
  thatchOld: THREE.MeshStandardMaterial;
  /** Paper windows in a dark wooden lattice. */
  shoji: THREE.MeshStandardMaterial;
  owned: Array<THREE.Material | THREE.Texture>;
}

const SIZE = 256;

function canvas(): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const c = document.createElement('canvas');
  c.width = c.height = SIZE;
  return [c, c.getContext('2d')!];
}

function texture(c: HTMLCanvasElement, color: boolean): THREE.CanvasTexture {
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  if (color) t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

/** Draw `fn` at (x, y) and at its wrapped copies near the edges, so the tile is seamless. */
function wrapped(x: number, y: number, reach: number, fn: (x: number, y: number) => void): void {
  for (const ox of [-SIZE, 0, SIZE]) {
    for (const oy of [-SIZE, 0, SIZE]) {
      const px = x + ox, py = y + oy;
      if (px < -reach || px > SIZE + reach || py < -reach || py > SIZE + reach) continue;
      fn(px, py);
    }
  }
}

/**
 * Thatch: three courses per tile (a course is about 0.67 m of roof), each a bundle of straw lying
 * down the slope — lit at its top, shadowed where the course below tucks under it, with ragged straw
 * ends hanging over the edge. Canvas y runs down the slope (v up the slope = up the canvas).
 */
function paintThatch(old: boolean, seed: number): { color: HTMLCanvasElement; bump: HTMLCanvasElement } {
  const rnd = new Random(seed);
  const [cc, g] = canvas();
  const [bc, bg] = canvas();
  const base = old ? '#7f7258' : '#a3844d';
  const straw = old ? ['#8e8264', '#7a6f55', '#9c8f6c', '#6c634e', '#a99a74'] : ['#b8975a', '#a8864c', '#c6a768', '#8f733f', '#d1b479', '#9b7b44'];
  g.fillStyle = base;
  g.fillRect(0, 0, SIZE, SIZE);
  bg.fillStyle = '#808080';
  bg.fillRect(0, 0, SIZE, SIZE);
  const courses = 3;
  const ch = SIZE / courses;
  for (let k = 0; k < courses; k++) {
    const top = k * ch;
    // Light at the course's top, darker toward its lower edge.
    const grd = g.createLinearGradient(0, top, 0, top + ch);
    grd.addColorStop(0, old ? 'rgba(170,160,130,0.25)' : 'rgba(235,205,140,0.28)');
    grd.addColorStop(0.75, 'rgba(0,0,0,0)');
    grd.addColorStop(1, 'rgba(30,20,10,0.35)');
    g.fillStyle = grd;
    g.fillRect(0, top, SIZE, ch);
    const bgr = bg.createLinearGradient(0, top, 0, top + ch);
    bgr.addColorStop(0, '#b0b0b0');
    bgr.addColorStop(1, '#3a3a3a');
    bg.fillStyle = bgr;
    bg.fillRect(0, top, SIZE, ch);
  }
  // Straw: short strokes lying down the slope, a few degrees off.
  const strokes = 2600;
  for (let i = 0; i < strokes; i++) {
    const x = rnd.range(0, SIZE), y = rnd.range(0, SIZE);
    const len = rnd.range(7, 20), ang = Math.PI / 2 + rnd.range(-0.16, 0.16);
    const dx = Math.cos(ang) * len, dy = Math.sin(ang) * len;
    const col = straw[Math.floor(rnd.range(0, straw.length))];
    const a = rnd.range(0.45, 0.95);
    const w = rnd.range(0.8, 1.7);
    const lum = Math.floor(rnd.range(150, 230));
    wrapped(x, y, 24, (px, py) => {
      g.globalAlpha = a;
      g.strokeStyle = col;
      g.lineWidth = w;
      g.beginPath();
      g.moveTo(px, py);
      g.lineTo(px + dx, py + dy);
      g.stroke();
      bg.globalAlpha = 0.55;
      bg.strokeStyle = `rgb(${lum},${lum},${lum})`;
      bg.lineWidth = w;
      bg.beginPath();
      bg.moveTo(px, py);
      bg.lineTo(px + dx, py + dy);
      bg.stroke();
    });
  }
  g.globalAlpha = 1;
  bg.globalAlpha = 1;
  // The ragged lower edge of each course: a shadow line and straw ends hanging over it.
  for (let k = 1; k <= courses; k++) {
    const y = (k * ch) % SIZE;
    for (let x = 0; x < SIZE; x += 1.5) {
      const hang = rnd.range(2, 9);
      const col = straw[Math.floor(rnd.range(0, straw.length))];
      wrapped(x, y, 12, (px, py) => {
        g.strokeStyle = 'rgba(40,28,14,0.55)';
        g.lineWidth = 1.2;
        g.beginPath();
        g.moveTo(px, py - 1);
        g.lineTo(px + rnd.range(-0.6, 0.6), py + hang * 0.6);
        g.stroke();
        g.strokeStyle = col;
        g.globalAlpha = 0.8;
        g.beginPath();
        g.moveTo(px, py - 3);
        g.lineTo(px + rnd.range(-0.8, 0.8), py - 3 + hang);
        g.stroke();
        g.globalAlpha = 1;
        bg.strokeStyle = '#202020';
        bg.lineWidth = 1.4;
        bg.beginPath();
        bg.moveTo(px, py);
        bg.lineTo(px, py + hang * 0.5);
        bg.stroke();
      });
    }
  }
  // Weathering: soft darker patches (and moss on the old straw).
  const blots = old ? 26 : 12;
  for (let i = 0; i < blots; i++) {
    const x = rnd.range(0, SIZE), y = rnd.range(0, SIZE), r = rnd.range(10, 30);
    const moss = old && rnd.chance(0.55);
    wrapped(x, y, r, (px, py) => {
      const grd = g.createRadialGradient(px, py, 0, px, py, r);
      grd.addColorStop(0, moss ? 'rgba(78,96,52,0.35)' : 'rgba(50,40,28,0.22)');
      grd.addColorStop(1, 'rgba(0,0,0,0)');
      g.fillStyle = grd;
      g.fillRect(px - r, py - r, r * 2, r * 2);
    });
  }
  return { color: cc, bump: bc };
}

/**
 * Shoji: warm paper with faint fibres behind a lattice of thin dark bars, cells about 25 cm wide and
 * 33 cm tall (8 × 6 per 2 m tile), so any cut of it reads as a window.
 */
function paintShoji(seed: number): HTMLCanvasElement {
  const rnd = new Random(seed);
  const [c, g] = canvas();
  g.fillStyle = '#efe4c8';
  g.fillRect(0, 0, SIZE, SIZE);
  for (let i = 0; i < 900; i++) {
    const x = rnd.range(0, SIZE), y = rnd.range(0, SIZE), l = rnd.range(2, 7), a = rnd.range(0, Math.PI);
    g.strokeStyle = rnd.chance(0.5) ? 'rgba(200,184,150,0.35)' : 'rgba(255,250,236,0.4)';
    g.lineWidth = 0.7;
    g.beginPath();
    g.moveTo(x, y);
    g.lineTo(x + Math.cos(a) * l, y + Math.sin(a) * l);
    g.stroke();
  }
  // Slightly warmer toward each cell's centre (light behind the paper).
  const cw = SIZE / 8, chh = SIZE / 6;
  for (let i = 0; i < 8; i++) {
    for (let j = 0; j < 6; j++) {
      const cx = (i + 0.5) * cw, cy = (j + 0.5) * chh;
      const grd = g.createRadialGradient(cx, cy, 0, cx, cy, cw * 0.7);
      grd.addColorStop(0, 'rgba(255,236,190,0.35)');
      grd.addColorStop(1, 'rgba(255,236,190,0)');
      g.fillStyle = grd;
      g.fillRect(cx - cw, cy - chh, cw * 2, chh * 2);
    }
  }
  g.fillStyle = '#3e2a1c';
  for (let i = 0; i <= 8; i++) g.fillRect(i * cw - 2, 0, 4, SIZE);
  for (let j = 0; j <= 6; j++) g.fillRect(0, j * chh - 2, SIZE, 4);
  return c;
}

export function kyoshiMaterials(): KyoshiMats {
  const owned: Array<THREE.Material | THREE.Texture> = [];
  const thatchOf = (old: boolean, seed: number): THREE.MeshStandardMaterial => {
    const p = paintThatch(old, seed);
    const map = texture(p.color, true);
    const bump = texture(p.bump, false);
    const m = new THREE.MeshStandardMaterial({ map, bumpMap: bump, bumpScale: 2.2, roughness: 1, metalness: 0, side: THREE.DoubleSide });
    m.name = old ? 'ki_thatch_old' : 'ki_thatch';
    owned.push(m, map, bump);
    return m;
  };
  const thatch = thatchOf(false, 0x7a11);
  const thatchOld = thatchOf(true, 0x7a12);
  const sm = texture(paintShoji(0x7a13), true);
  const shoji = new THREE.MeshStandardMaterial({ map: sm, emissive: '#ffd59a', emissiveMap: sm, emissiveIntensity: 0.22, roughness: 0.9, metalness: 0 });
  shoji.name = 'ki_shoji';
  owned.push(shoji, sm);
  return { thatch, thatchOld, shoji, owned };
}
