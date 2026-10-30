import * as THREE from 'three';
import { Random } from '../../../core/Random';
import type { UVRect } from './geom';

/**
 * Procedural texture atlas for Earth Kingdom houses (2048×1024, 32 px/m).
 *
 * Facades are painted (timber frames, lattice windows, doors, shop fronts,
 * stone plinths, weathering) so instanced/merged house geometry can stay a
 * few hundred triangles while reading as detailed architecture. A matching
 * quarter-resolution glow mask lights the windows at night (emissiveMap).
 *
 * Shared by Ba Sing Se, Gaoling and Riverbend: acquireHouseAtlas() /
 * releaseHouseAtlas() reference-count the GPU resources.
 */

export const ATLAS_W = 2048;
export const ATLAS_H = 1024;
export const PX = 24; // pixels per metre
const GLOW_SCALE = 0.25;
const PAD = 4;

export type WindowStyle = 'lattice' | 'round' | 'shutter' | 'small' | 'tall';
export type DoorStyle = 'none' | 'single' | 'double' | 'red' | 'barn' | 'wide';

export interface FacadeSpec {
  w: number;
  h: number;
  floors?: number;
  wall: string;
  /** Plank walls (farm/river houses); 'half' = planks on the lower half. */
  planks?: boolean | 'half';
  plankColor?: string;
  frame?: string;
  base?: number;
  door?: DoorStyle;
  doorX?: number;
  /** Second door (row houses). */
  door2X?: number;
  /** Window counts per floor (ground floor first). */
  windows?: number[];
  windowStyle?: WindowStyle;
  /** Ground floor shop opening. */
  shop?: boolean;
  /** Painted balcony rail on upper floors. */
  balcony?: boolean;
  /** Hanging sign board colour (shop/house name plaque). */
  sign?: string;
  /** Red lacquered columns painted at the frame positions. */
  columns?: boolean;
  /** Probability a window glows at night. */
  glow?: number;
  seed?: number;
}

interface PxRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface AtlasEntry {
  name: string;
  px: PxRect;
  uv: UVRect;
  wM: number;
  hM: number;
}

function shade(hex: string, f: number): string {
  const c = new THREE.Color(hex);
  c.r = Math.min(1, c.r * f);
  c.g = Math.min(1, c.g * f);
  c.b = Math.min(1, c.b * f);
  return '#' + c.getHexString();
}

function mixHex(a: string, b: string, t: number): string {
  const ca = new THREE.Color(a), cb = new THREE.Color(b);
  return '#' + ca.lerp(cb, t).getHexString();
}

/** Shelf packer for atlas regions. */
class Packer {
  used = 0;
  private x = PAD;
  private y = PAD;
  private shelfH = 0;
  constructor(readonly W: number, readonly H: number) {}
  alloc(w: number, h: number): PxRect {
    w = Math.ceil(w);
    h = Math.ceil(h);
    if (this.x + w + PAD > this.W) {
      this.x = PAD;
      this.y += this.shelfH + PAD * 2;
      this.shelfH = 0;
    }
    if (this.y + h + PAD > this.H) throw new Error(`[EarthAtlas] out of space for ${w}x${h}`);
    this.used = Math.max(this.used, this.y + h + PAD);
    const r = { x: this.x, y: this.y, w, h };
    this.x += w + PAD * 2;
    this.shelfH = Math.max(this.shelfH, h);
    return r;
  }
}

export class HouseAtlas {
  readonly canvas: HTMLCanvasElement;
  readonly glowCanvas: HTMLCanvasElement;
  readonly texture: THREE.CanvasTexture;
  readonly glowTexture: THREE.CanvasTexture;
  /** Houses (vertex coloured, night glow). */
  readonly material: THREE.MeshStandardMaterial;
  private readonly entries = new Map<string, AtlasEntry>();
  private readonly g: CanvasRenderingContext2D;
  private readonly gg: CanvasRenderingContext2D;
  readonly packer = new Packer(ATLAS_W, ATLAS_H);
  private readonly rnd = new Random(8821);

  constructor() {
    this.canvas = document.createElement('canvas');
    this.canvas.width = ATLAS_W;
    this.canvas.height = ATLAS_H;
    this.glowCanvas = document.createElement('canvas');
    this.glowCanvas.width = ATLAS_W * GLOW_SCALE;
    this.glowCanvas.height = ATLAS_H * GLOW_SCALE;
    this.g = this.canvas.getContext('2d')!;
    this.gg = this.glowCanvas.getContext('2d')!;
    this.g.fillStyle = '#8a8070';
    this.g.fillRect(0, 0, ATLAS_W, ATLAS_H);
    this.gg.fillStyle = '#000000';
    this.gg.fillRect(0, 0, this.glowCanvas.width, this.glowCanvas.height);
    this.paintAll();
    this.texture = new THREE.CanvasTexture(this.canvas);
    this.texture.colorSpace = THREE.SRGBColorSpace;
    this.texture.anisotropy = 4;
    this.texture.generateMipmaps = true;
    this.texture.minFilter = THREE.LinearMipmapLinearFilter;
    this.glowTexture = new THREE.CanvasTexture(this.glowCanvas);
    this.glowTexture.colorSpace = THREE.SRGBColorSpace;
    this.material = new THREE.MeshStandardMaterial({
      map: this.texture,
      emissiveMap: this.glowTexture,
      emissive: new THREE.Color('#ffb860'),
      emissiveIntensity: 0,
      vertexColors: true,
      roughness: 0.86,
      metalness: 0,
    });
    this.material.name = 'earth_house_atlas';
  }

  get(name: string): UVRect {
    const e = this.entries.get(name);
    if (!e) throw new Error(`[EarthAtlas] missing region ${name}`);
    return e.uv;
  }

  entry(name: string): AtlasEntry {
    const e = this.entries.get(name);
    if (!e) throw new Error(`[EarthAtlas] missing region ${name}`);
    return e;
  }

  /** Night factor 0..1 drives window glow. */
  setNight(f: number): void {
    this.material.emissiveIntensity = f * 1.35;
  }

  dispose(): void {
    this.texture.dispose();
    this.glowTexture.dispose();
    this.material.dispose();
  }

  // ---------------------------------------------------------------------------
  // Region allocation
  // ---------------------------------------------------------------------------

  private region(name: string, wM: number, hM: number, density = PX): AtlasEntry {
    const px = this.packer.alloc(wM * density, hM * density);
    const uv: UVRect = {
      u0: (px.x + 0.5) / ATLAS_W,
      u1: (px.x + px.w - 0.5) / ATLAS_W,
      v1: 1 - (px.y + 0.5) / ATLAS_H,
      v0: 1 - (px.y + px.h - 0.5) / ATLAS_H,
    };
    const e = { name, px, uv, wM, hM };
    this.entries.set(name, e);
    return e;
  }

  /** Extend a region's border pixels into the padding (reduces mip bleeding). */
  private bleed(e: AtlasEntry): void {
    const g = this.g;
    const { x, y, w, h } = e.px;
    const p = PAD - 1;
    g.drawImage(this.canvas, x, y, w, 1, x, y - p, w, p);
    g.drawImage(this.canvas, x, y + h - 1, w, 1, x, y + h, w, p);
    g.drawImage(this.canvas, x, y - p, 1, h + p * 2, x - p, y - p, p, h + p * 2);
    g.drawImage(this.canvas, x + w - 1, y - p, 1, h + p * 2, x + w, y - p, p, h + p * 2);
  }

  // ---------------------------------------------------------------------------
  // Painting primitives (pixel space)
  // ---------------------------------------------------------------------------

  private speckle(r: PxRect, base: string, amount: number, size = 3): void {
    const g = this.g;
    const n = Math.floor((r.w * r.h) / 40);
    for (let i = 0; i < n; i++) {
      g.globalAlpha = amount * this.rnd.range(0.3, 1);
      g.fillStyle = this.rnd.chance(0.5) ? shade(base, 0.78) : shade(base, 1.14);
      const s = this.rnd.range(1, size);
      g.fillRect(r.x + this.rnd.range(0, r.w), r.y + this.rnd.range(0, r.h), s, s);
    }
    g.globalAlpha = 1;
  }

  private stains(r: PxRect, amount: number): void {
    const g = this.g;
    g.save();
    g.beginPath();
    g.rect(r.x, r.y, r.w, r.h);
    g.clip();
    for (let i = 0; i < 5; i++) {
      const x = r.x + this.rnd.range(0, r.w), y = r.y + this.rnd.range(0, r.h);
      const rad = this.rnd.range(r.w * 0.08, r.w * 0.3);
      const grd = g.createRadialGradient(x, y, 0, x, y, rad);
      grd.addColorStop(0, `rgba(40,30,20,${amount})`);
      grd.addColorStop(1, 'rgba(40,30,20,0)');
      g.fillStyle = grd;
      g.fillRect(x - rad, y - rad, rad * 2, rad * 2);
    }
    // Dirt rising from the ground.
    const grd = g.createLinearGradient(0, r.y + r.h, 0, r.y + r.h - Math.min(r.h, 40));
    grd.addColorStop(0, `rgba(60,45,30,${amount * 1.6})`);
    grd.addColorStop(1, 'rgba(60,45,30,0)');
    g.fillStyle = grd;
    g.fillRect(r.x, r.y + r.h - 40, r.w, 40);
    g.restore();
  }

  private plaster(r: PxRect, color: string): void {
    const g = this.g;
    g.fillStyle = color;
    g.fillRect(r.x, r.y, r.w, r.h);
    for (let i = 0; i < (r.w * r.h) / 220; i++) {
      g.globalAlpha = 0.18;
      g.fillStyle = shade(color, this.rnd.range(0.9, 1.07));
      g.fillRect(r.x + this.rnd.range(0, r.w), r.y + this.rnd.range(0, r.h), this.rnd.range(3, 12), this.rnd.range(2, 8));
    }
    g.globalAlpha = 1;
    this.speckle(r, color, 0.16, 2.5);
  }

  private planks(r: PxRect, color: string, vertical = true): void {
    const g = this.g;
    g.fillStyle = color;
    g.fillRect(r.x, r.y, r.w, r.h);
    const pw = 9;
    if (vertical) {
      for (let x = r.x; x < r.x + r.w; x += pw) {
        g.fillStyle = shade(color, this.rnd.range(0.82, 1.12));
        g.fillRect(x, r.y, pw - 1, r.h);
        g.fillStyle = 'rgba(0,0,0,0.35)';
        g.fillRect(x + pw - 1, r.y, 1, r.h);
      }
    } else {
      for (let y = r.y; y < r.y + r.h; y += pw) {
        g.fillStyle = shade(color, this.rnd.range(0.82, 1.12));
        g.fillRect(r.x, y, r.w, pw - 1);
        g.fillStyle = 'rgba(0,0,0,0.35)';
        g.fillRect(r.x, y + pw - 1, r.w, 1);
      }
    }
    this.speckle(r, color, 0.12, 2);
  }

  private stoneBand(r: PxRect, color: string): void {
    const g = this.g;
    g.fillStyle = shade(color, 0.7);
    g.fillRect(r.x, r.y, r.w, r.h);
    const bh = Math.max(6, Math.min(12, r.h / 2));
    let row = 0;
    for (let y = r.y; y < r.y + r.h; y += bh, row++) {
      let x = r.x - (row % 2) * 9;
      while (x < r.x + r.w) {
        const bw = this.rnd.range(14, 24);
        g.fillStyle = shade(color, this.rnd.range(0.85, 1.12));
        g.fillRect(Math.max(r.x, x + 1), y + 1, Math.min(bw - 2, r.x + r.w - x - 1), Math.min(bh - 2, r.y + r.h - y - 1));
        x += bw;
      }
    }
    g.fillStyle = 'rgba(255,255,255,0.12)';
    g.fillRect(r.x, r.y, r.w, 2);
  }

  private beam(x: number, y: number, w: number, h: number, color: string): void {
    const g = this.g;
    g.fillStyle = color;
    g.fillRect(x, y, w, h);
    g.fillStyle = 'rgba(255,255,255,0.1)';
    g.fillRect(x, y, w, Math.max(1, h * 0.25));
    g.fillStyle = 'rgba(0,0,0,0.25)';
    g.fillRect(x, y + h - Math.max(1, h * 0.25), w, Math.max(1, h * 0.25));
  }

  private glowRect(x: number, y: number, w: number, h: number, color = '#ffd9a0', alpha = 1): void {
    const gg = this.gg;
    gg.globalAlpha = alpha;
    gg.fillStyle = color;
    gg.fillRect(x * GLOW_SCALE, y * GLOW_SCALE, Math.max(1, w * GLOW_SCALE), Math.max(1, h * GLOW_SCALE));
    gg.globalAlpha = 1;
  }

  private window(x: number, y: number, w: number, h: number, style: WindowStyle, frame: string, lit: boolean): void {
    const g = this.g;
    if (style === 'round') {
      const cx = x + w / 2, cy = y + h / 2, rr = Math.min(w, h) / 2;
      g.fillStyle = frame;
      g.beginPath();
      g.arc(cx, cy, rr, 0, Math.PI * 2);
      g.fill();
      g.fillStyle = '#2b2520';
      g.beginPath();
      g.arc(cx, cy, rr - 3, 0, Math.PI * 2);
      g.fill();
      g.strokeStyle = shade(frame, 1.5);
      g.lineWidth = 1.5;
      g.save();
      g.beginPath();
      g.arc(cx, cy, rr - 3, 0, Math.PI * 2);
      g.clip();
      for (let k = -rr; k <= rr; k += 6) {
        g.beginPath();
        g.moveTo(cx + k, cy - rr);
        g.lineTo(cx + k, cy + rr);
        g.moveTo(cx - rr, cy + k);
        g.lineTo(cx + rr, cy + k);
        g.stroke();
      }
      g.restore();
      if (lit) this.glowRect(cx - rr * 0.7, cy - rr * 0.7, rr * 1.4, rr * 1.4);
      return;
    }
    // Frame + sill
    g.fillStyle = frame;
    g.fillRect(x - 2, y - 2, w + 4, h + 4);
    g.fillStyle = shade(frame, 0.7);
    g.fillRect(x - 4, y + h + 1, w + 8, 3);
    if (style === 'shutter') {
      g.fillStyle = '#2a2420';
      g.fillRect(x, y, w, h);
      // Open shutters either side.
      const sw = w * 0.45;
      for (const s of [-1, 1]) {
        const sx = s < 0 ? x - sw - 2 : x + w + 2;
        g.fillStyle = shade(frame, 1.15);
        g.fillRect(sx, y, sw, h);
        g.fillStyle = 'rgba(0,0,0,0.3)';
        for (let k = 3; k < h; k += 5) g.fillRect(sx + 1, y + k, sw - 2, 1);
      }
      if (lit) this.glowRect(x, y, w, h);
      return;
    }
    // Paper lattice: warm paper with a wooden grid.
    g.fillStyle = style === 'small' ? '#3a312a' : '#d9c9a0';
    g.fillRect(x, y, w, h);
    if (style !== 'small') {
      const grd = g.createLinearGradient(0, y, 0, y + h);
      grd.addColorStop(0, 'rgba(0,0,0,0.25)');
      grd.addColorStop(1, 'rgba(0,0,0,0.05)');
      g.fillStyle = grd;
      g.fillRect(x, y, w, h);
    }
    g.strokeStyle = shade(frame, 1.1);
    g.lineWidth = 1.6;
    const cell = style === 'tall' ? 5 : 6;
    for (let k = x + cell; k < x + w - 1; k += cell) {
      g.beginPath();
      g.moveTo(k, y);
      g.lineTo(k, y + h);
      g.stroke();
    }
    for (let k = y + cell; k < y + h - 1; k += cell) {
      g.beginPath();
      g.moveTo(x, k);
      g.lineTo(x + w, k);
      g.stroke();
    }
    if (lit) this.glowRect(x, y, w, h, '#ffcf88', style === 'small' ? 0.7 : 1);
  }

  private door(x: number, y: number, w: number, h: number, style: DoorStyle, frame: string): void {
    const g = this.g;
    const col = style === 'red' ? '#8a2e20' : style === 'barn' ? '#6a4a2c' : '#5a3a24';
    g.fillStyle = shade(frame, 0.8);
    g.fillRect(x - 3, y - 4, w + 6, h + 4);
    g.fillStyle = col;
    g.fillRect(x, y, w, h);
    // Panels
    const leaves = style === 'single' ? 1 : 2;
    const lw = w / leaves;
    for (let i = 0; i < leaves; i++) {
      const lx = x + i * lw;
      g.fillStyle = 'rgba(0,0,0,0.3)';
      g.fillRect(lx + lw - 1, y, 1.5, h);
      g.fillStyle = 'rgba(255,255,255,0.08)';
      g.fillRect(lx + 3, y + 3, lw - 6, h * 0.42);
      g.fillRect(lx + 3, y + h * 0.5, lw - 6, h * 0.45);
      if (style === 'red') {
        g.fillStyle = '#d4a43a';
        for (let r = 0; r < 3; r++) for (let c = 0; c < 2; c++) g.fillRect(lx + lw * 0.3 + c * lw * 0.35, y + h * (0.25 + r * 0.25), 2, 2);
      }
    }
    if (style === 'barn') {
      g.strokeStyle = 'rgba(30,20,10,0.6)';
      g.lineWidth = 2;
      g.beginPath();
      g.moveTo(x, y);
      g.lineTo(x + w, y + h);
      g.moveTo(x + w, y);
      g.lineTo(x, y + h);
      g.stroke();
    }
    // Step
    g.fillStyle = '#7a756c';
    g.fillRect(x - 5, y + h - 3, w + 10, 3);
  }

  private shopFront(x: number, y: number, w: number, h: number, frame: string): void {
    const g = this.g;
    g.fillStyle = '#231d18';
    g.fillRect(x, y, w, h);
    // Shelves with goods
    const goods = ['#c8962e', '#7a9a4a', '#a8442a', '#d9c9a0', '#4a7a8a', '#9a5a8a', '#e0b050'];
    for (let s = 0; s < 3; s++) {
      const sy = y + h * (0.2 + s * 0.22);
      g.fillStyle = '#5a3a24';
      g.fillRect(x + 4, sy + 7, w - 8, 2);
      for (let k = x + 6; k < x + w - 8; k += this.rnd.range(5, 9)) {
        g.fillStyle = this.rnd.pick(goods);
        const gh = this.rnd.range(3, 7);
        g.fillRect(k, sy + 7 - gh, this.rnd.range(3, 6), gh);
      }
    }
    // Counter
    g.fillStyle = shade(frame, 1.2);
    g.fillRect(x - 2, y + h * 0.72, w + 4, h * 0.28);
    g.fillStyle = 'rgba(0,0,0,0.3)';
    g.fillRect(x - 2, y + h * 0.72, w + 4, 2);
    this.glowRect(x, y, w, h * 0.72, '#ffc070', 0.9);
  }

  private sign(x: number, y: number, w: number, h: number, color: string): void {
    const g = this.g;
    g.fillStyle = '#3a2a1a';
    g.fillRect(x - 2, y - 2, w + 4, h + 4);
    g.fillStyle = color;
    g.fillRect(x, y, w, h);
    g.fillStyle = '#e8d8a8';
    // Pseudo-calligraphy strokes.
    const n = Math.max(2, Math.floor(w / 12));
    for (let i = 0; i < n; i++) {
      const cx = x + (i + 0.5) * (w / n);
      g.fillRect(cx - 3, y + h * 0.25, 6, 1.5);
      g.fillRect(cx - 0.75, y + h * 0.2, 1.5, h * 0.6);
      g.fillRect(cx - 3, y + h * 0.6, 6, 1.5);
    }
  }

  /** Paint a full facade from a spec into a freshly allocated region. */
  facade(name: string, s: FacadeSpec): AtlasEntry {
    const e = this.region(name, s.w, s.h);
    const r = e.px;
    const g = this.g;
    const rnd = new Random(s.seed ?? name.length * 977 + Math.round(s.w * 31));
    const frame = s.frame ?? '#4a3222';
    const floors = s.floors ?? 1;
    const base = (s.base ?? 0.4) * PX;
    const fh = (r.h - base) / floors;
    // Wall
    if (s.planks === true) this.planks(r, s.plankColor ?? '#7a5636');
    else this.plaster(r, s.wall);
    if (s.planks === 'half') this.planks({ x: r.x, y: r.y + r.h - base - fh * 0.45, w: r.w, h: fh * 0.45 }, s.plankColor ?? '#6e4c30');
    // Stone base
    if (base > 0) this.stoneBand({ x: r.x, y: r.y + r.h - base, w: r.w, h: base }, '#8f8a80');
    // Timber frame: top beam, corner posts, floor beams
    const post = Math.max(5, PX * 0.24);
    this.beam(r.x, r.y, r.w, Math.max(5, PX * 0.2), frame);
    for (const px of [r.x, r.x + r.w - post]) this.beam(px, r.y, post, r.h - base, s.columns ? '#8e2c1f' : frame);
    for (let f = 1; f < floors; f++) {
      const y = r.y + r.h - base - fh * f;
      this.beam(r.x, y - 3, r.w, 7, frame);
    }
    // Door(s)
    const doorStyle = s.door ?? 'single';
    const doorW = (doorStyle === 'double' || doorStyle === 'red' ? 1.5 : doorStyle === 'barn' ? 2.8 : doorStyle === 'wide' ? 2.2 : 1.05) * PX;
    const doorH = Math.min(fh - 6, (doorStyle === 'barn' ? 3.1 : 2.15) * PX);
    const doors: number[] = [];
    if (doorStyle !== 'none' && !s.shop) doors.push(s.doorX ?? 0.5);
    if (s.door2X !== undefined) doors.push(s.door2X);
    for (const dx of doors) this.door(r.x + r.w * dx - doorW / 2, r.y + r.h - base - doorH, doorW, doorH, doorStyle === 'none' ? 'single' : doorStyle, frame);
    // Shop front
    if (s.shop) {
      const sw = r.w - post * 2 - 10;
      const sh = Math.min(fh * 0.78, 2.5 * PX);
      this.shopFront(r.x + post + 5, r.y + r.h - base - sh, sw, sh, frame);
      if (s.sign) this.sign(r.x + r.w * 0.25, r.y + r.h - base - sh - 0.55 * PX, r.w * 0.5, 0.42 * PX, s.sign);
    } else if (s.sign) {
      this.sign(r.x + r.w * 0.35, r.y + r.h - base - doorH - 0.6 * PX, r.w * 0.3, 0.38 * PX, s.sign);
    }
    // Windows per floor
    const style = s.windowStyle ?? 'lattice';
    const counts = s.windows ?? [2];
    for (let f = 0; f < floors; f++) {
      const n = counts[Math.min(f, counts.length - 1)] ?? 0;
      if (n <= 0) continue;
      if (f === 0 && s.shop) continue;
      const fy0 = r.y + r.h - base - fh * (f + 1);
      const ww = (style === 'small' ? 0.55 : style === 'tall' ? 0.8 : style === 'round' ? 1.0 : 0.95) * PX;
      const wh = (style === 'small' ? 0.45 : style === 'tall' ? 1.5 : style === 'round' ? 1.0 : 0.85) * PX;
      const wy = fy0 + Math.max(4, fh * (f === 0 ? 0.32 : 0.3));
      // Slots avoid the doors on the ground floor.
      const slots: number[] = [];
      for (let i = 0; i < n; i++) slots.push((i + 1) / (n + 1));
      for (const sx of slots) {
        let cx = r.x + r.w * sx;
        if (f === 0) {
          for (const dx of doors) {
            const dcx = r.x + r.w * dx;
            if (Math.abs(cx - dcx) < doorW / 2 + ww / 2 + 6) cx = dcx + Math.sign(cx - dcx || 1) * (doorW / 2 + ww / 2 + 8);
          }
        }
        if (cx - ww / 2 < r.x + post + 3 || cx + ww / 2 > r.x + r.w - post - 3) continue;
        this.window(cx - ww / 2, wy, ww, wh, f > 0 && n === 3 && sx === 0.5 && style === 'lattice' && rnd.chance(0.5) ? 'round' : style, frame, rnd.chance(s.glow ?? 0.6));
      }
      if (f > 0 && s.balcony) {
        const by = fy0 + fh - 0.75 * PX;
        g.fillStyle = shade(frame, 1.05);
        g.fillRect(r.x + post, by, r.w - post * 2, 3);
        g.fillRect(r.x + post, by + 0.6 * PX, r.w - post * 2, 3);
        for (let k = r.x + post + 4; k < r.x + r.w - post; k += 7) g.fillRect(k, by, 2, 0.6 * PX);
      }
    }
    // Eave shadow at the top & weathering
    const grd = g.createLinearGradient(0, r.y, 0, r.y + 0.9 * PX);
    grd.addColorStop(0, 'rgba(20,15,10,0.55)');
    grd.addColorStop(1, 'rgba(20,15,10,0)');
    g.fillStyle = grd;
    g.fillRect(r.x, r.y, r.w, 0.9 * PX);
    this.stains(r, 0.1);
    this.bleed(e);
    return e;
  }

  private roofTiles(name: string, color: string, wM: number, hM: number): AtlasEntry {
    const e = this.region(name, wM, hM);
    const r = e.px;
    const g = this.g;
    g.fillStyle = shade(color, 0.55);
    g.fillRect(r.x, r.y, r.w, r.h);
    const cw = 0.32 * PX; // tile column width
    const rowH = 0.42 * PX;
    for (let x = r.x; x < r.x + r.w; x += cw) {
      const tone = this.rnd.range(0.86, 1.12);
      const grd = g.createLinearGradient(x, 0, x + cw, 0);
      grd.addColorStop(0, shade(color, 0.62 * tone));
      grd.addColorStop(0.45, shade(color, 1.18 * tone));
      grd.addColorStop(1, shade(color, 0.66 * tone));
      g.fillStyle = grd;
      g.fillRect(x + 0.5, r.y, cw - 1, r.h);
    }
    for (let y = r.y; y < r.y + r.h; y += rowH) {
      g.fillStyle = 'rgba(0,0,0,0.28)';
      g.fillRect(r.x, y, r.w, 2);
      g.fillStyle = 'rgba(255,255,255,0.08)';
      g.fillRect(r.x, y + 2, r.w, 1.5);
    }
    // Moss / weathering patches
    for (let i = 0; i < 18; i++) {
      const x = r.x + this.rnd.range(0, r.w), y = r.y + this.rnd.range(0, r.h), rad = this.rnd.range(8, 30);
      const grd = g.createRadialGradient(x, y, 0, x, y, rad);
      grd.addColorStop(0, this.rnd.chance(0.5) ? 'rgba(60,70,40,0.25)' : 'rgba(255,255,240,0.12)');
      grd.addColorStop(1, 'rgba(0,0,0,0)');
      g.fillStyle = grd;
      g.fillRect(x - rad, y - rad, rad * 2, rad * 2);
    }
    // Eave edge (bottom of the slope = v0 = bottom of the region): end-tile caps.
    g.fillStyle = shade(color, 0.45);
    g.fillRect(r.x, r.y + r.h - 5, r.w, 5);
    for (let x = r.x; x < r.x + r.w; x += cw) {
      g.fillStyle = shade(color, 1.25);
      g.beginPath();
      g.arc(x + cw / 2, r.y + r.h - 3, cw * 0.32, 0, Math.PI * 2);
      g.fill();
    }
    this.bleed(e);
    return e;
  }

  private thatch(name: string, wM: number, hM: number): AtlasEntry {
    const e = this.region(name, wM, hM);
    const r = e.px;
    const g = this.g;
    g.fillStyle = '#8a7444';
    g.fillRect(r.x, r.y, r.w, r.h);
    for (let i = 0; i < (r.w * r.h) / 6; i++) {
      const x = r.x + this.rnd.range(0, r.w), y = r.y + this.rnd.range(0, r.h);
      g.strokeStyle = shade(this.rnd.pick(['#b8a060', '#a08850', '#c8b070', '#7a6438']), this.rnd.range(0.85, 1.1));
      g.lineWidth = 1;
      g.beginPath();
      g.moveTo(x, y);
      g.lineTo(x + this.rnd.range(-1.5, 1.5), y + this.rnd.range(6, 14));
      g.stroke();
    }
    for (let y = r.y; y < r.y + r.h; y += 0.6 * PX) {
      g.fillStyle = 'rgba(40,30,10,0.3)';
      g.fillRect(r.x, y, r.w, 2);
    }
    this.bleed(e);
    return e;
  }

  private solid(name: string, wM: number, hM: number, painter: (r: PxRect) => void): AtlasEntry {
    const e = this.region(name, wM, hM);
    painter(e.px);
    this.bleed(e);
    return e;
  }

  private awning(name: string, a: string, b: string): AtlasEntry {
    return this.solid(name, 4, 2, (r) => {
      const g = this.g;
      const sw = 0.4 * PX;
      for (let x = r.x, i = 0; x < r.x + r.w; x += sw, i++) {
        g.fillStyle = i % 2 ? a : b;
        g.fillRect(x, r.y, sw, r.h);
      }
      // Scalloped hem at the bottom (v0 side).
      g.fillStyle = shade(a, 0.75);
      g.fillRect(r.x, r.y + r.h - 4, r.w, 4);
      this.speckle(r, a, 0.1, 2);
    });
  }

  // ---------------------------------------------------------------------------
  // Content
  // ---------------------------------------------------------------------------

  private paintAll(): void {
    // Roofs (12 × 8 m each)
    this.roofTiles('roofA', '#4f8a58', 12, 8);
    this.roofTiles('roofB', '#5d7a5a', 12, 8);
    this.thatch('roofC', 12, 8);
    this.roofTiles('roofD', '#3f6d6a', 12, 8);
    this.solid('ridge', 8, 0.5, (r) => {
      const g = this.g;
      g.fillStyle = '#2f3b33';
      g.fillRect(r.x, r.y, r.w, r.h);
      for (let x = r.x; x < r.x + r.w; x += 8) {
        g.fillStyle = 'rgba(255,255,255,0.12)';
        g.fillRect(x, r.y, 3, r.h);
      }
    });
    this.solid('wood', 4, 4, (r) => this.planks(r, '#6a4a30', false));
    this.solid('woodDark', 3, 3, (r) => this.planks(r, '#3e2a1c', true));
    this.solid('woodRed', 2, 2, (r) => this.planks(r, '#8a2e20', true));
    this.solid('stone', 4, 1.5, (r) => this.stoneBand(r, '#8f8a80'));
    this.solid('plasterCream', 3, 3, (r) => this.plaster(r, '#e2d3b0'));
    this.solid('plasterWhite', 3, 3, (r) => this.plaster(r, '#ece6d6'));
    this.solid('plasterTan', 3, 3, (r) => this.plaster(r, '#d2b88c'));
    this.solid('dark', 1, 1, (r) => {
      this.g.fillStyle = '#2a2420';
      this.g.fillRect(r.x, r.y, r.w, r.h);
    });
    this.awning('awningGreen', '#3f7a46', '#e6dcb8');
    this.awning('awningRed', '#9c3326', '#e8d8b0');
    this.awning('awningYellow', '#d8a83a', '#6a4a2a');
    this.solid('clothMix', 4, 1, (r) => {
      const g = this.g;
      const cols = ['#e8e0d0', '#3f7a46', '#c8962e', '#9c3326', '#4a6a9a', '#d8c8a0', '#6a8a4a'];
      for (let x = r.x; x < r.x + r.w; x += 0.5 * PX) {
        g.fillStyle = this.rnd.pick(cols);
        g.fillRect(x, r.y, 0.5 * PX, r.h);
      }
    });

    const cream = '#e2d3b0', white = '#ece4d2', tan = '#d4bc8e', ochre = '#d8c294', greyg = '#cfcab0';
    // Lower Ring
    this.facade('L1f', { w: 6, h: 3.4, wall: cream, door: 'single', windows: [2], seed: 11 });
    this.facade('L1s', { w: 5, h: 3.4, wall: cream, door: 'none', windows: [1], windowStyle: 'small', seed: 12 });
    this.facade('L1b', { w: 6, h: 3.4, wall: tan, door: 'none', windows: [2], windowStyle: 'shutter', seed: 13 });
    this.facade('L2f', { w: 5.6, h: 6.2, floors: 2, wall: white, door: 'single', doorX: 0.3, windows: [1, 2], balcony: true, seed: 21 });
    this.facade('L2s', { w: 7, h: 6.2, floors: 2, wall: white, door: 'none', windows: [1, 2], windowStyle: 'small', seed: 22 });
    this.facade('L3f', { w: 7, h: 4.4, wall: ochre, shop: true, sign: '#2f5a36', windows: [0], seed: 31 });
    this.facade('L3s', { w: 6, h: 4.4, wall: ochre, door: 'none', windows: [1], seed: 32 });
    this.facade('L4f', { w: 6.6, h: 9, floors: 3, wall: greyg, door: 'double', windows: [1, 2, 2], seed: 41 });
    this.facade('L4s', { w: 6.6, h: 9, floors: 3, wall: greyg, door: 'none', windows: [1, 2, 1], windowStyle: 'small', seed: 42 });
    this.facade('L5f', { w: 10.4, h: 3.6, wall: tan, door: 'single', doorX: 0.25, door2X: 0.75, windows: [4], windowStyle: 'lattice', seed: 51 });
    this.facade('L5s', { w: 5.4, h: 3.6, wall: tan, door: 'none', windows: [1], windowStyle: 'shutter', seed: 52 });
    // Middle Ring
    this.facade('M1f', { w: 11, h: 4.6, wall: white, frame: '#5a2a1e', door: 'red', windows: [4], columns: true, base: 0.6, seed: 61 });
    this.facade('M1s', { w: 8.5, h: 4.6, wall: white, frame: '#5a2a1e', door: 'none', windows: [2], base: 0.6, seed: 62 });
    this.facade('M2f', { w: 9, h: 7.6, floors: 2, wall: cream, frame: '#4a2a1e', door: 'red', windows: [2, 3], balcony: true, columns: true, base: 0.6, seed: 71 });
    this.facade('M2s', { w: 8, h: 7.6, floors: 2, wall: cream, frame: '#4a2a1e', door: 'none', windows: [2, 2], windowStyle: 'tall', base: 0.6, seed: 72 });
    // Farm / village
    this.facade('F1f', { w: 8, h: 3.2, wall: '#d8c8a0', planks: 'half', door: 'single', windows: [2], windowStyle: 'shutter', base: 0.3, seed: 81 });
    this.facade('F1s', { w: 5.6, h: 3.2, wall: '#d8c8a0', planks: 'half', door: 'none', windows: [1], windowStyle: 'shutter', base: 0.3, seed: 82 });
    this.facade('F2f', { w: 10, h: 4.4, wall: '#7a5636', planks: true, plankColor: '#7a5636', door: 'barn', windows: [0], base: 0.3, seed: 91 });
    this.facade('F2s', { w: 7, h: 4.4, wall: '#7a5636', planks: true, plankColor: '#6e4c30', door: 'none', windows: [1], windowStyle: 'small', base: 0.3, seed: 92 });
    this.facade('F3f', { w: 4, h: 2.6, wall: '#6e4c30', planks: true, plankColor: '#6e4c30', door: 'single', windows: [0], base: 0.2, seed: 93 });
    this.facade('F3s', { w: 3.6, h: 2.6, wall: '#6e4c30', planks: true, plankColor: '#5e4028', door: 'none', windows: [0], base: 0.2, seed: 94 });
    this.facade('R1f', { w: 7, h: 3.4, wall: '#5e4028', planks: true, plankColor: '#6a4a2e', door: 'single', windows: [2], windowStyle: 'shutter', base: 0.25, seed: 101 });
    this.facade('R1s', { w: 5.6, h: 3.4, wall: '#5e4028', planks: true, plankColor: '#5e4028', door: 'none', windows: [1], windowStyle: 'shutter', base: 0.25, seed: 102 });
    this.facade('G1f', { w: 9, h: 6.6, floors: 2, wall: white, frame: '#5a3020', door: 'double', windows: [2, 3], balcony: true, base: 0.5, sign: '#8a2e20', seed: 111 });
    this.facade('G1s', { w: 7.5, h: 6.6, floors: 2, wall: white, frame: '#5a3020', door: 'none', windows: [2, 2], base: 0.5, seed: 112 });
    // [additive: Ba Sing Se] Neutral light tiles, tinted per house (black Lower Ring, green Middle, yellow Upper).
    this.roofTiles('roofN', '#dcdad4', 12, 8);
    void mixHex;
  }
}

let shared: HouseAtlas | null = null;
let refs = 0;

export function acquireHouseAtlas(): HouseAtlas {
  if (!shared) shared = new HouseAtlas();
  refs++;
  return shared;
}

export function releaseHouseAtlas(): void {
  refs = Math.max(0, refs - 1);
  if (refs === 0 && shared) {
    shared.dispose();
    shared = null;
  }
}
