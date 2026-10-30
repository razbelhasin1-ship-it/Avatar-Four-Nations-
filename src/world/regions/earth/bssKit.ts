import * as THREE from 'three';
import type { ContentBuilder } from '../../kit/Builder';
import { applyTriplanar, kitMaterialTinted, type KitMaterialName } from '../../kit/Materials';
import { stoneBlocks } from '../../kit/Textures';
import type { P2 } from '../../WorldLayout';
import { archBlockGeometry, spandrelGeometry } from './geom';
import { prismGeometry } from './walls';
import { polar, radiusOf, thetaOf, wrapAngle } from './bssLayout';

/**
 * Ba Sing Se building kit: owned materials (emblem medallions, CJK signs,
 * big-block stone, rammed earth), battered wall segments, gate blocks with a
 * road tunnel and viaduct portals or notches, pagoda pillar towers, and the
 * smoothed rail path shared by the viaduct builder and the train runtime.
 */

export type MatKey = KitMaterialName | THREE.Material;

// ---------------------------------------------------------------------------
// Materials
// ---------------------------------------------------------------------------

export interface SignStyle {
  bg?: string;
  fg?: string;
  border?: string;
  vertical?: boolean;
}

const CJK_FONT = '"Noto Serif CJK TC", "Noto Serif CJK SC", "Source Han Serif TC", "Songti TC", "PMingLiU", "Noto Sans CJK TC", "Microsoft JhengHei", "WenQuanYi Zen Hei", serif';

function canvas(w: number, h: number): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return [c, c.getContext('2d')!];
}

function rand(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s ^ (s >>> 15), 0x2c1b3c6d) + 0x9e3779b9) >>> 0;
    return (s & 0xffffff) / 0x1000000;
  };
}

/** Earth Kingdom emblem: round medallion with a squared glyph. */
function emblemTexture(): THREE.CanvasTexture {
  const [c, g] = canvas(256, 256);
  const cx = 128;
  g.fillStyle = '#2f4a2c';
  g.beginPath();
  g.arc(cx, cx, 126, 0, Math.PI * 2);
  g.fill();
  g.strokeStyle = '#d9b860';
  g.lineWidth = 14;
  g.beginPath();
  g.arc(cx, cx, 112, 0, Math.PI * 2);
  g.stroke();
  g.lineWidth = 4;
  g.beginPath();
  g.arc(cx, cx, 96, 0, Math.PI * 2);
  g.stroke();
  // Squared glyph: outer square, inner square, four bars joining them.
  g.lineWidth = 13;
  g.strokeRect(cx - 58, cx - 58, 116, 116);
  g.fillStyle = '#d9b860';
  g.fillRect(cx - 20, cx - 20, 40, 40);
  for (const [dx, dy] of [[0, -1], [0, 1], [-1, 0], [1, 0]]) {
    g.fillRect(cx + dx * 39 - (dx ? 19 : 6), cx + dy * 39 - (dy ? 19 : 6), dx ? 38 : 12, dy ? 38 : 12);
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

/** Horizontal rammed-earth courses with pebbles (Inner Wall). */
function earthTexture(): THREE.CanvasTexture {
  const [c, g] = canvas(256, 256);
  const r = rand(77);
  const tones = ['#b39d78', '#ad9772', '#b8a27c', '#a9926d', '#b19a74'];
  let y = 0;
  while (y < 256) {
    const h = 14 + Math.floor(r() * 22);
    g.fillStyle = tones[Math.floor(r() * tones.length)];
    g.fillRect(0, y, 256, h);
    g.fillStyle = 'rgba(60,45,30,0.22)';
    g.fillRect(0, y + h - 2, 256, 2);
    y += h;
  }
  // Mottling breaks up the courses so they read as earth, not wood grain.
  for (let i = 0; i < 70; i++) {
    const x = r() * 256, yy = r() * 256, rad = 10 + r() * 34;
    const gr = g.createRadialGradient(x, yy, 0, x, yy, rad);
    const dark = r() < 0.5;
    gr.addColorStop(0, dark ? 'rgba(90,70,45,0.18)' : 'rgba(225,205,170,0.16)');
    gr.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = gr;
    g.fillRect(x - rad, yy - rad, rad * 2, rad * 2);
  }
  for (let i = 0; i < 900; i++) {
    g.fillStyle = r() < 0.5 ? 'rgba(70,55,40,0.35)' : 'rgba(230,215,185,0.3)';
    const s = 1 + r() * 3;
    g.fillRect(r() * 256, r() * 256, s, s * 0.7);
  }
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

function signTexture(text: string, s: SignStyle): THREE.CanvasTexture {
  const chars = [...text];
  const vertical = s.vertical ?? chars.length <= 3;
  const cell = 128;
  const pad = 30;
  const w = vertical ? cell + pad * 2 : chars.length * cell + pad * 2;
  const h = vertical ? chars.length * cell + pad * 2 : cell + pad * 2;
  const [c, g] = canvas(w, h);
  g.fillStyle = s.bg ?? '#1f3a26';
  g.fillRect(0, 0, w, h);
  g.strokeStyle = s.border ?? '#c9a24e';
  g.lineWidth = 10;
  g.strokeRect(8, 8, w - 16, h - 16);
  g.lineWidth = 3;
  g.strokeRect(20, 20, w - 40, h - 40);
  g.fillStyle = s.fg ?? '#e8c86a';
  g.font = `bold ${cell * 0.82}px ${CJK_FONT}`;
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  chars.forEach((ch, i) => {
    const x = vertical ? w / 2 : pad + cell * (i + 0.5);
    const y = vertical ? pad + cell * (i + 0.5) : h / 2 + 4;
    g.fillText(ch, x, y);
  });
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

/**
 * Materials created for Ba Sing Se (disposed by the region). Kit textures used
 * here (stone blocks) belong to the kit cache; canvases made here are owned.
 */
export class BssMats {
  readonly outerStone: THREE.MeshStandardMaterial;
  readonly earthen: THREE.MeshStandardMaterial;
  readonly ringStone: THREE.MeshStandardMaterial;
  readonly emblem: THREE.MeshStandardMaterial;
  readonly slab: THREE.MeshStandardMaterial;
  readonly palaceRoof: THREE.MeshStandardMaterial;
  private readonly owned: THREE.Material[] = [];
  private readonly textures: THREE.Texture[] = [];
  private readonly signs = new Map<string, THREE.MeshStandardMaterial>();

  constructor() {
    this.outerStone = this.own(new THREE.MeshStandardMaterial({ color: '#ffffff', roughness: 0.95, map: stoneBlocks('#cdc4ae', '#00000030', 3, 2, 31) }));
    applyTriplanar(this.outerStone, 9);
    this.outerStone.name = 'bss_outer_stone';
    const earth = this.tex(earthTexture());
    this.earthen = this.own(new THREE.MeshStandardMaterial({ color: '#ffffff', roughness: 0.97, map: earth }));
    applyTriplanar(this.earthen, 7);
    this.earthen.name = 'bss_earthen';
    this.ringStone = this.own(new THREE.MeshStandardMaterial({ color: '#ffffff', roughness: 0.92, map: stoneBlocks('#d9d0bc', '#00000038', 5, 3, 33) }));
    applyTriplanar(this.ringStone, 4.5);
    this.ringStone.name = 'bss_ring_stone';
    this.emblem = this.own(new THREE.MeshStandardMaterial({ map: this.tex(emblemTexture()), roughness: 0.55, metalness: 0.35 }));
    this.emblem.name = 'bss_emblem';
    this.slab = this.own(new THREE.MeshStandardMaterial({ color: '#ffffff', roughness: 0.96, map: stoneBlocks('#8f8a7e', '#00000050', 4, 3, 35) }));
    applyTriplanar(this.slab, 3.5);
    this.slab.name = 'bss_slab';
    this.palaceRoof = kitMaterialTinted('roof_green', '#5d8a62');
  }

  private own<T extends THREE.Material>(m: T): T {
    this.owned.push(m);
    return m;
  }

  private tex<T extends THREE.Texture>(t: T): T {
    this.textures.push(t);
    return t;
  }

  /** Lacquered sign with gold CJK characters (cached per text + style). */
  sign(text: string, s: SignStyle = {}): THREE.MeshStandardMaterial {
    const key = `${text}|${s.bg}|${s.fg}|${s.vertical}`;
    let m = this.signs.get(key);
    if (!m) {
      m = this.own(new THREE.MeshStandardMaterial({ map: this.tex(signTexture(text, s)), roughness: 0.5, metalness: 0.1, emissive: '#ffffff', emissiveIntensity: 0.06 }));
      m.emissiveMap = m.map;
      m.name = `bss_sign_${text}`;
      this.signs.set(key, m);
    }
    return m;
  }

  /** Width / height ratio of a sign texture (for sizing boards). */
  signAspect(text: string, vertical?: boolean): number {
    const n = [...text].length;
    const v = vertical ?? n <= 3;
    return v ? 188 / (n * 128 + 60) : (n * 128 + 60) / 188;
  }

  dispose(): void {
    for (const m of this.owned) m.dispose();
    for (const t of this.textures) t.dispose();
    this.owned.length = 0;
    this.textures.length = 0;
    this.signs.clear();
  }
}

// ---------------------------------------------------------------------------
// Frames
// ---------------------------------------------------------------------------

/** Local frame on the ground: +X along `tan`, +Z along `out`. */
export interface Frame {
  x: number;
  z: number;
  yaw: number;
  /** Local (lx, lz) → world (x, z). */
  at(lx: number, lz: number): P2;
}

export function frameAt(x: number, z: number, outX: number, outZ: number): Frame {
  const l = Math.hypot(outX, outZ) || 1;
  const ox = outX / l, oz = outZ / l;
  const yaw = Math.atan2(ox, oz);
  const rx = Math.cos(yaw), rz = -Math.sin(yaw);
  return { x, z, yaw, at: (lx, lz) => ({ x: x + rx * lx + ox * lz, z: z + rz * lx + oz * lz }) };
}

/** Frame on a ring at θ: local +Z points away from the palace. */
export function ringFrame(theta: number, r: number): Frame {
  const p = polar(theta, r);
  return frameAt(p.x, p.z, Math.cos(theta), Math.sin(theta));
}

// ---------------------------------------------------------------------------
// Walls
// ---------------------------------------------------------------------------

export interface BatterOpts {
  coping?: MatKey;
  bands?: number[];
  bandMat?: MatKey;
  /** Parapet height on both edges of the top (0 = none). */
  parapet?: number;
  /** Number of stacked collider boxes for the body (0 = no colliders). */
  stack?: number;
  extend?: number;
  castShadow?: boolean;
}

/** One straight battered wall segment along a → c (centre line). */
export function batteredSegment(b: ContentBuilder, mat: MatKey, a: P2, c: P2, baseY: number, H: number, tBase: number, tTop: number, o: BatterOpts = {}): void {
  const dx = c.x - a.x, dz = c.z - a.z;
  const len = Math.hypot(dx, dz);
  if (len < 0.05) return;
  const yaw = Math.atan2(-dz, dx);
  const mx = (a.x + c.x) / 2, mz = (a.z + c.z) / 2;
  const L = len + (o.extend ?? 0.3) * 2;
  const g = prismGeometry([[-tBase / 2, 0], [tBase / 2, 0], [tTop / 2, H], [-tTop / 2, H]], L);
  b.mesh(mat, g, { x: mx, y: baseY, z: mz, yaw }, { castShadow: o.castShadow });
  g.dispose();
  const tAt = (f: number) => tBase + (tTop - tBase) * f;
  for (const f of o.bands ?? []) b.box(o.bandMat ?? mat, { x: mx, y: baseY + H * f, z: mz, sx: L, sy: Math.max(0.5, H * 0.008), sz: tAt(f) + 0.7, yaw });
  if (o.coping) b.box(o.coping, { x: mx, y: baseY + H - 0.35, z: mz, sx: L, sy: 0.7, sz: tTop + 0.6, yaw });
  const ph = o.parapet ?? 0;
  if (ph > 0) {
    for (const side of [-1, 1]) {
      const off = side * (tTop / 2 - 0.4);
      const px = mx + Math.sin(yaw) * off, pz = mz + Math.cos(yaw) * off;
      b.box(mat, { x: px, y: baseY + H + ph / 2, z: pz, sx: L, sy: ph, sz: 0.8, yaw });
      b.collider({ shape: 'box', x: px, y: baseY + H + ph / 2, z: pz, hx: L / 2, hz: 0.4, hy: ph / 2, yaw, walkable: false, solid: true });
    }
  }
  const n = o.stack ?? 1;
  for (let i = 0; i < n; i++) {
    const y0 = (H * i) / n, y1 = (H * (i + 1)) / n;
    b.collider({ shape: 'box', x: mx, y: baseY + (y0 + y1) / 2, z: mz, hx: L / 2, hz: tAt(i / n) / 2, hy: (y1 - y0) / 2, yaw, walkable: i === n - 1, solid: true });
  }
}

/**
 * Angular sections of a ring wall between gaps. Gaps are [centre θ, half-width m].
 * Returns [θ0, θ1] ranges (θ1 may exceed 2π to wrap).
 */
export function ringSections(r: number, gaps: Array<[number, number]>): Array<[number, number]> {
  const g = gaps.map(([t, hw]) => [wrapAngle(t) - hw / r, wrapAngle(t) + hw / r] as [number, number]).sort((p, q) => p[0] - q[0]);
  if (!g.length) return [[0, Math.PI * 2]];
  const out: Array<[number, number]> = [];
  for (let i = 0; i < g.length; i++) {
    const end = g[i][1];
    const next = i + 1 < g.length ? g[i + 1][0] : g[0][0] + Math.PI * 2;
    if (next > end + 0.2 / r) out.push([end, next]);
  }
  return out;
}

/** Split [θ0, θ1] on a circle of radius r into chords about `segLen` long. */
export function ringChords(r: number, t0: number, t1: number, segLen: number): Array<[P2, P2, number]> {
  const n = Math.max(1, Math.ceil(((t1 - t0) * r) / segLen));
  const out: Array<[P2, P2, number]> = [];
  for (let i = 0; i < n; i++) {
    const a = t0 + ((t1 - t0) * i) / n, c = t0 + ((t1 - t0) * (i + 1)) / n;
    out.push([polar(a, r), polar(c, r), (a + c) / 2]);
  }
  return out;
}

// ---------------------------------------------------------------------------
// Gate blocks
// ---------------------------------------------------------------------------

export interface Portal {
  /** Centre offset along the wall (local X). */
  lat: number;
  w: number;
  /** Opening bottom (above the block base). */
  y0: number;
  /** Straight jamb height above y0 before the arch starts. */
  jamb: number;
}

export interface GateBlockOpts {
  f: Frame;
  baseY: number;
  W: number;
  D: number;
  H: number;
  mat: MatKey;
  trim: MatKey;
  /** Road tunnel at ground level (centred). */
  tunnel?: { aw: number; spring: number };
  /** Arched openings above the tunnel (viaduct portals). */
  portals?: Portal[];
  /** Open notch from y0 to the top (viaduct passing over a lower wall). */
  notch?: { lat: number; w: number; y0: number };
  bands?: number[];
}

/** A wall-aligned block (local X along the wall, +Z outward) with a road tunnel and viaduct openings. */
export function gateBlock(b: ContentBuilder, o: GateBlockOpts): void {
  const { f, W, D, H } = o;
  const yaw = f.yaw;
  const put = (lx: number, ly: number, sx: number, sy: number, sz = D, mat: MatKey = o.mat, collide = true, walkable = true) => {
    if (sx <= 0.01 || sy <= 0.01) return;
    const p = f.at(lx, 0);
    b.box(mat, { x: p.x, y: o.baseY + ly + sy / 2, z: p.z, sx, sy, sz, yaw });
    if (collide) b.collider({ shape: 'box', x: p.x, y: o.baseY + ly + sy / 2, z: p.z, hx: sx / 2, hz: sz / 2, hy: sy / 2, yaw, walkable, solid: true });
  };
  // Upper openings decide where the solid lower tier ends.
  const upperY = Math.min(o.portals?.length ? Math.min(...o.portals.map((p) => p.y0)) : H, o.notch ? o.notch.y0 : H);
  // Tier A: tunnel block.
  if (o.tunnel) {
    const t = o.tunnel;
    const g = archBlockGeometry(W, upperY, D, t.aw, t.spring, 14);
    b.mesh(o.mat, g, { x: f.x, y: o.baseY, z: f.z, yaw });
    g.dispose();
    const fw = (W - t.aw) / 2;
    for (const side of [-1, 1]) {
      const p = f.at(side * (t.aw / 2 + fw / 2), 0);
      b.collider({ shape: 'box', x: p.x, y: o.baseY + upperY / 2, z: p.z, hx: fw / 2, hz: D / 2, hy: upperY / 2, yaw, walkable: true, solid: true });
    }
    const apex = t.spring + t.aw / 2;
    const c = f.at(0, 0);
    b.collider({ shape: 'box', x: c.x, y: o.baseY + (apex + upperY) / 2, z: c.z, hx: t.aw / 2 + 0.1, hz: D / 2, hy: (upperY - apex) / 2, yaw, walkable: true, solid: true });
    // Voussoir ring on both faces.
    for (const side of [-1, 1]) {
      const segs = 11;
      for (let i = 0; i <= segs; i++) {
        const a = Math.PI - (i / segs) * Math.PI;
        const rr = t.aw / 2 + 0.6;
        const p = f.at(Math.cos(a) * rr, side * (D / 2 + 0.18));
        b.box(o.trim, { x: p.x, y: o.baseY + t.spring + Math.sin(a) * rr, z: p.z, sx: 1.5, sy: 1.2, sz: 0.45, yaw, roll: a + Math.PI / 2 });
      }
    }
  } else {
    put(0, 0, W, upperY);
  }
  // Tier B: portals (piers + spandrels) or a notch (two piers).
  if (o.portals?.length) {
    const ps = [...o.portals].sort((p, q) => p.lat - q.lat);
    const y0 = upperY;
    const crown = Math.max(...ps.map((p) => p.y0 + p.jamb + p.w / 2 + 1.4));
    let x = -W / 2;
    for (const p of ps) {
      const l = p.lat - p.w / 2;
      put((x + l) / 2, y0, l - x, crown - y0);
      // Spandrel above the jambs.
      const g = spandrelGeometry(p.w, crown - (p.y0 + p.jamb), D, 12);
      const c = f.at(p.lat, 0);
      b.mesh(o.mat, g, { x: c.x, y: o.baseY + p.y0 + p.jamb, z: c.z, yaw });
      g.dispose();
      b.collider({ shape: 'box', x: c.x, y: o.baseY + (p.y0 + p.jamb + p.w / 2 + crown) / 2, z: c.z, hx: p.w / 2, hz: D / 2, hy: (crown - (p.y0 + p.jamb + p.w / 2)) / 2, yaw, walkable: true, solid: true });
      // Fill under the portal sill down to the tier-A top.
      if (p.y0 > y0) put(p.lat, y0, p.w, p.y0 - y0);
      x = p.lat + p.w / 2;
    }
    put((x + W / 2) / 2, y0, W / 2 - x, crown - y0);
    put(0, crown, W, H - crown);
  } else if (o.notch) {
    const n = o.notch;
    const l = n.lat - n.w / 2, r = n.lat + n.w / 2;
    put((-W / 2 + l) / 2, upperY, l + W / 2, H - upperY);
    put((r + W / 2) / 2, upperY, W / 2 - r, H - upperY);
  }
  for (const fy of o.bands ?? []) {
    const p = f.at(0, 0);
    b.box(o.trim, { x: p.x, y: o.baseY + H * fy, z: p.z, sx: W + 0.8, sy: 0.9, sz: D + 0.8, yaw });
  }
  const top = f.at(0, 0);
  if (!o.notch) b.box(o.trim, { x: top.x, y: o.baseY + H - 0.4, z: top.z, sx: W + 0.6, sy: 0.8, sz: D + 0.6, yaw });
}

/** Arched slab that closes a tunnel (local: width along X, height along Y from 0, thickness along Z). */
export function slabGeometry(aw: number, spring: number, thick: number): THREE.BufferGeometry {
  const s = new THREE.Shape();
  const r = aw / 2;
  s.moveTo(-r, 0);
  s.lineTo(r, 0);
  s.lineTo(r, spring);
  for (let i = 1; i < 14; i++) {
    const a = (i / 14) * Math.PI;
    s.lineTo(Math.cos(a) * r, spring + Math.sin(a) * r);
  }
  s.lineTo(-r, spring);
  s.closePath();
  const g = new THREE.ExtrudeGeometry(s, { depth: thick, bevelEnabled: false, curveSegments: 14 });
  g.translate(0, 0, -thick / 2);
  return g;
}

// ---------------------------------------------------------------------------
// Ornament
// ---------------------------------------------------------------------------

/** Round emblem medallion facing local +Z of `yaw`. */
export function medallion(b: ContentBuilder, m: BssMats, x: number, y: number, z: number, yaw: number, r: number, depth = 0.35): void {
  const g = new THREE.CylinderGeometry(r, r, depth, 28, 1);
  g.rotateX(Math.PI / 2);
  b.mesh(m.emblem, g, { x, y, z, yaw }, { castShadow: false });
  g.dispose();
  const ring = new THREE.TorusGeometry(r * 1.02, Math.max(0.08, r * 0.07), 6, 28);
  b.mesh('gold', ring, { x: x + Math.sin(yaw) * depth * 0.4, y, z: z + Math.cos(yaw) * depth * 0.4, yaw }, { castShadow: false });
  ring.dispose();
}

/** Sign board with an explicit yaw (PlaneGeometry rotated into place) and a wooden frame. */
export function sign(b: ContentBuilder, m: BssMats, text: string, x: number, y: number, z: number, yaw: number, h: number, s: SignStyle = {}): number {
  const w = h * m.signAspect(text, s.vertical);
  const g = new THREE.PlaneGeometry(w, h);
  b.mesh(m.sign(text, s), g, { x: x + Math.sin(yaw) * 0.14, y, z: z + Math.cos(yaw) * 0.14, yaw }, { castShadow: false });
  g.dispose();
  b.box('wood_red', { x, y, z, sx: w + 0.35, sy: h + 0.35, sz: 0.2, yaw });
  return w;
}

/** Square stone pillar tower with gold bands, a lantern chamber and a two-tier pagoda roof (image 4). */
export function pillarTower(b: ContentBuilder, m: BssMats, x: number, z: number, baseY: number, yaw: number, w: number, h: number): void {
  b.box('stone_white', { x, y: baseY + h / 2, z, sx: w, sy: h, sz: w, yaw }, { collide: true, walkable: true });
  for (const f of [0.08, 0.55, 0.78]) b.box('gold', { x, y: baseY + h * f, z, sx: w + 0.3, sy: 0.45, sz: w + 0.3, yaw });
  b.box('stone_tan', { x, y: baseY + 0.9, z, sx: w + 1.0, sy: 1.8, sz: w + 1.0, yaw });
  // Chamber with dark openings on four faces.
  const ch = Math.min(5, h * 0.14);
  const y0 = baseY + h;
  b.box('stone_white', { x, y: y0 + ch / 2, z, sx: w * 0.86, sy: ch, sz: w * 0.86, yaw });
  for (let k = 0; k < 4; k++) {
    const a = yaw + (k * Math.PI) / 2;
    const px = x + Math.sin(a) * (w * 0.43 + 0.02), pz = z + Math.cos(a) * (w * 0.43 + 0.02);
    b.box('wood_dark', { x: px, y: y0 + ch * 0.48, z: pz, sx: w * 0.42, sy: ch * 0.62, sz: 0.1, yaw: a });
    if (k % 2 === 0) medallion(b, m, x + Math.sin(a) * (w / 2 + 0.05), baseY + h * 0.66, z + Math.cos(a) * (w / 2 + 0.05), a, w * 0.24, 0.2);
  }
  b.roof('roof_green', { x, y: y0 + ch, z, w: w * 1.15, d: w * 1.15, height: w * 0.32, yaw, overhang: w * 0.32, curve: 0.9, style: 'hip', ridge: null });
  b.box('stone_white', { x, y: y0 + ch + w * 0.3 + ch * 0.32, z, sx: w * 0.55, sy: ch * 0.65, sz: w * 0.55, yaw });
  b.roof('roof_green', { x, y: y0 + ch + w * 0.3 + ch * 0.65, z, w: w * 0.7, d: w * 0.7, height: w * 0.42, yaw, overhang: w * 0.22, curve: 0.9, style: 'pagoda', ridge: null });
  b.box('gold', { x, y: y0 + ch + w * 0.3 + ch * 0.65 + w * 0.5, z, sx: 0.3, sy: 1.2, sz: 0.3, yaw });
}

// ---------------------------------------------------------------------------
// Rail path (smoothed centre line with arc-length parameter)
// ---------------------------------------------------------------------------

export interface PathSample {
  x: number;
  z: number;
  /** Unit tangent. */
  tx: number;
  tz: number;
}

/** Centripetal Catmull-Rom through control points, resampled to ~1 m with cumulative length. */
export class RailPath {
  readonly xs: Float64Array;
  readonly zs: Float64Array;
  readonly cum: Float64Array;
  readonly total: number;

  constructor(ctrl: P2[], readonly closed: boolean, step = 1) {
    const n = ctrl.length;
    const P = (i: number): P2 => {
      if (closed) return ctrl[((i % n) + n) % n];
      if (i < 0) return { x: 2 * ctrl[0].x - ctrl[1].x, z: 2 * ctrl[0].z - ctrl[1].z };
      if (i >= n) return { x: 2 * ctrl[n - 1].x - ctrl[n - 2].x, z: 2 * ctrl[n - 1].z - ctrl[n - 2].z };
      return ctrl[i];
    };
    const xs: number[] = [], zs: number[] = [];
    const spans = closed ? n : n - 1;
    for (let i = 0; i < spans; i++) {
      const p0 = P(i - 1), p1 = P(i), p2 = P(i + 1), p3 = P(i + 2);
      const k = Math.max(2, Math.ceil(Math.hypot(p2.x - p1.x, p2.z - p1.z) / step));
      for (let j = 0; j < k; j++) {
        const q = catmull(p0, p1, p2, p3, j / k);
        xs.push(q.x);
        zs.push(q.z);
      }
    }
    if (!closed) {
      xs.push(ctrl[n - 1].x);
      zs.push(ctrl[n - 1].z);
    } else {
      xs.push(xs[0]);
      zs.push(zs[0]);
    }
    this.xs = Float64Array.from(xs);
    this.zs = Float64Array.from(zs);
    this.cum = new Float64Array(xs.length);
    for (let i = 1; i < xs.length; i++) this.cum[i] = this.cum[i - 1] + Math.hypot(xs[i] - xs[i - 1], zs[i] - zs[i - 1]);
    this.total = this.cum[xs.length - 1];
  }

  wrap(s: number): number {
    if (!this.closed) return Math.max(0, Math.min(this.total, s));
    const t = s % this.total;
    return t < 0 ? t + this.total : t;
  }

  /** Point and tangent at arc length s (no allocation when `out` is given). */
  at(s: number, out: PathSample = { x: 0, z: 0, tx: 1, tz: 0 }): PathSample {
    s = this.wrap(s);
    const c = this.cum;
    let lo = 0, hi = c.length - 1;
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1;
      if (c[mid] <= s) lo = mid;
      else hi = mid;
    }
    const seg = c[hi] - c[lo] || 1;
    const t = (s - c[lo]) / seg;
    const dx = this.xs[hi] - this.xs[lo], dz = this.zs[hi] - this.zs[lo];
    const l = Math.hypot(dx, dz) || 1;
    out.x = this.xs[lo] + dx * t;
    out.z = this.zs[lo] + dz * t;
    out.tx = dx / l;
    out.tz = dz / l;
    return out;
  }

  /** Arc length of the sample nearest to (x, z). */
  nearest(x: number, z: number): number {
    let best = 0, bd = Infinity;
    for (let i = 0; i < this.xs.length; i++) {
      const d = (this.xs[i] - x) ** 2 + (this.zs[i] - z) ** 2;
      if (d < bd) {
        bd = d;
        best = i;
      }
    }
    return this.cum[best];
  }

  /** Where the path crosses the circle of radius r around the palace. */
  crossings(r: number): Array<{ s: number; theta: number; x: number; z: number; tx: number; tz: number }> {
    const out: Array<{ s: number; theta: number; x: number; z: number; tx: number; tz: number }> = [];
    for (let i = 1; i < this.xs.length; i++) {
      const a = radiusOf(this.xs[i - 1], this.zs[i - 1]) - r, c = radiusOf(this.xs[i], this.zs[i]) - r;
      if ((a < 0) === (c < 0)) continue;
      const t = a / (a - c);
      const s = this.cum[i - 1] + (this.cum[i] - this.cum[i - 1]) * t;
      const p = this.at(s);
      out.push({ s, theta: thetaOf(p.x, p.z), x: p.x, z: p.z, tx: p.tx, tz: p.tz });
    }
    return out;
  }
}

function catmull(p0: P2, p1: P2, p2: P2, p3: P2, t: number): P2 {
  const a = 0.5;
  const d = (p: P2, q: P2) => Math.max(1e-4, Math.hypot(q.x - p.x, q.z - p.z) ** a);
  const t0 = 0, t1 = t0 + d(p0, p1), t2 = t1 + d(p1, p2), t3 = t2 + d(p2, p3);
  const u = t1 + (t2 - t1) * t;
  const lerp = (p: P2, q: P2, ta: number, tb: number): P2 => {
    const k = (u - ta) / (tb - ta);
    return { x: p.x + (q.x - p.x) * k, z: p.z + (q.z - p.z) * k };
  };
  const A1 = lerp(p0, p1, t0, t1), A2 = lerp(p1, p2, t1, t2), A3 = lerp(p2, p3, t2, t3);
  const B1 = lerp(A1, A2, t0, t2), B2 = lerp(A2, A3, t1, t3);
  return lerp(B1, B2, t1, t2);
}
