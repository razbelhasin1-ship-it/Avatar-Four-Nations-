import * as THREE from 'three';
import { Random } from '../../../core/Random';
import type { ContentBuilder } from '../../kit/Builder';
import type { DistrictPlan, PlanBuilding, PlanLamp, PlanSpan } from './agnaPlan';
import { archPath, bulbDome, dome, mergeParts, panelWithArches } from './geometry';
import { wtMat, type WTMaterialName } from './materials';
import { TUNE, type Side } from './nwtLayout';

/**
 * Agna Qel'a architecture from the district plans: smooth carved-ice blocks
 * with rounded corners, a plinth, storey bands and a deep cornice; crenellated,
 * domed, stepped (tiered), vaulted or flat roofs; small tiered corner towers;
 * balconies on curved brackets; arched passages under buildings.
 *
 * Bodies are accumulated per material and merged into one mesh per material
 * per district (few draw calls, frustum-culled per district). Windows, doors,
 * merlons, balconies and lanterns are instanced in the district's detail
 * layer, which the region hides beyond a camera distance.
 */

const STOREY = TUNE.storey;
const UP = new THREE.Vector3(0, 1, 0);
const SIDES: Side[] = ['n', 's', 'w', 'e'];
const v3 = new THREE.Vector3();
const nv = new THREE.Vector3();
const nm = new THREE.Matrix3();

/** Triangle soup per material, emitted as one merged mesh per material. */
export class MeshAcc {
  private readonly parts = new Map<WTMaterialName, { p: number[]; n: number[]; i: number[] }>();

  private get(mat: WTMaterialName): { p: number[]; n: number[]; i: number[] } {
    let a = this.parts.get(mat);
    if (!a) {
      a = { p: [], n: [], i: [] };
      this.parts.set(mat, a);
    }
    return a;
  }

  vert(mat: WTMaterialName, x: number, y: number, z: number, nx: number, ny: number, nz: number): number {
    const a = this.get(mat);
    a.p.push(x, y, z);
    a.n.push(nx, ny, nz);
    return a.p.length / 3 - 1;
  }

  tri(mat: WTMaterialName, a: number, b: number, c: number): void {
    this.get(mat).i.push(a, b, c);
  }

  /** Append a three.js geometry, optionally transformed (the caller keeps ownership). */
  add(mat: WTMaterialName, g: THREE.BufferGeometry, m?: THREE.Matrix4): void {
    const a = this.get(mat);
    const pos = g.getAttribute('position');
    if (!g.getAttribute('normal')) g.computeVertexNormals();
    const nor = g.getAttribute('normal');
    if (m) nm.getNormalMatrix(m);
    const base = a.p.length / 3;
    for (let k = 0; k < pos.count; k++) {
      v3.fromBufferAttribute(pos, k);
      nv.fromBufferAttribute(nor, k);
      if (m) {
        v3.applyMatrix4(m);
        nv.applyMatrix3(nm).normalize();
      }
      a.p.push(v3.x, v3.y, v3.z);
      a.n.push(nv.x, nv.y, nv.z);
    }
    const idx = g.getIndex();
    if (idx) for (let k = 0; k < idx.count; k++) a.i.push(base + idx.getX(k));
    else for (let k = 0; k < pos.count; k++) a.i.push(base + k);
  }

  /** Emit one merged mesh per material into a builder. */
  emit(cb: ContentBuilder, shadow: (m: WTMaterialName) => boolean = () => true): void {
    for (const [mat, a] of this.parts) {
      if (!a.i.length) continue;
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(a.p, 3));
      g.setAttribute('normal', new THREE.Float32BufferAttribute(a.n, 3));
      g.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array((a.p.length / 3) * 2), 2));
      g.setIndex(a.i);
      cb.mesh(wtMat(mat), g, { x: 0, y: 0, z: 0 }, { castShadow: shadow(mat) });
      g.dispose();
    }
    this.parts.clear();
  }
}

// ---------------------------------------------------------------------------
// Rounded-rectangle prisms (walls, bands, cornices)
// ---------------------------------------------------------------------------

/** Rounded rectangle in plan: centre, half sizes, corner radius. */
export interface RBox {
  cx: number;
  cz: number;
  hw: number;
  hd: number;
  r: number;
}

const RS = 2; // corner arc segments

/** Outline points (x, z, outward nx, nz), ordered so side quads face outward. */
function ring(b: RBox): Array<[number, number, number, number]> {
  const out: Array<[number, number, number, number]> = [];
  const r = Math.max(0.03, Math.min(b.r, b.hw - 0.01, b.hd - 0.01));
  const cs = [[1, 1], [1, -1], [-1, -1], [-1, 1]];
  for (let k = 0; k < 4; k++) {
    const ox = b.cx + cs[k][0] * (b.hw - r), oz = b.cz + cs[k][1] * (b.hd - r);
    const a0 = Math.PI / 2 - (k * Math.PI) / 2;
    for (let j = 0; j <= RS; j++) {
      const a = a0 - (j / RS) * (Math.PI / 2);
      const c = Math.cos(a), s = Math.sin(a);
      out.push([ox + c * r, oz + s * r, c, s]);
    }
  }
  return out;
}

export const grow = (b: RBox, k: number): RBox => ({ cx: b.cx, cz: b.cz, hw: b.hw + k, hd: b.hd + k, r: Math.max(0.05, b.r + k) });

function fan(acc: MeshAcc, mat: WTMaterialName, b: RBox, y: number, dir: 1 | -1): void {
  const R = ring(b);
  const c = acc.vert(mat, b.cx, y, b.cz, 0, dir, 0);
  const idx = R.map(([x, z]) => acc.vert(mat, x, y, z, 0, dir, 0));
  for (let k = 0; k < idx.length; k++) {
    const a = idx[k], n = idx[(k + 1) % idx.length];
    if (dir > 0) acc.tri(mat, c, a, n);
    else acc.tri(mat, c, n, a);
  }
}

/** Vertical rounded prism from y0 to y1, with an optional top cap and underside. */
export function prism(acc: MeshAcc, mat: WTMaterialName, b: RBox, y0: number, y1: number, cap: WTMaterialName | null = null, under: WTMaterialName | null = null): void {
  const R = ring(b);
  const n = R.length;
  const base: number[] = [];
  for (const [x, z, nx, nz] of R) {
    base.push(acc.vert(mat, x, y0, z, nx, 0, nz));
    acc.vert(mat, x, y1, z, nx, 0, nz);
  }
  for (let k = 0; k < n; k++) {
    const b0 = base[k], b1 = base[(k + 1) % n];
    acc.tri(mat, b0, b1, b1 + 1);
    acc.tri(mat, b0, b1 + 1, b0 + 1);
  }
  if (cap) fan(acc, cap, b, y1, 1);
  if (under) fan(acc, under, b, y0, -1);
}

/** Flat ring between two rounded outlines at y (a ledge top). */
export function ledge(acc: MeshAcc, mat: WTMaterialName, inner: RBox, outer: RBox, y: number): void {
  const A = ring(inner), B = ring(outer);
  const ia = A.map(([x, z]) => acc.vert(mat, x, y, z, 0, 1, 0));
  const ib = B.map(([x, z]) => acc.vert(mat, x, y, z, 0, 1, 0));
  for (let k = 0; k < ia.length; k++) {
    const k1 = (k + 1) % ia.length;
    acc.tri(mat, ia[k], ib[k], ib[k1]);
    acc.tri(mat, ia[k], ib[k1], ia[k1]);
  }
}

/** Vertical cylinder (or frustum) from y0 to y1, capped on top. */
export function cyl(acc: MeshAcc, mat: WTMaterialName, x: number, z: number, r: number, y0: number, y1: number, segs = 12, rTop = r): void {
  const g = new THREE.CylinderGeometry(rTop, r, y1 - y0, segs, 1, false);
  g.translate(x, (y0 + y1) / 2, z);
  acc.add(mat, g);
  g.dispose();
}

// ---------------------------------------------------------------------------
// Instanced detail geometry (local: facade plane z = 0, facing +Z, base y = 0)
// ---------------------------------------------------------------------------

const WIN = { w: 0.95, h: 2.0 };
const SMALL = { w: 0.7, h: 1.3 };
const DOOR = { w: 1.5, h: 2.6 };

/** Arch segments of instanced windows and frames (there are thousands of them). */
const ARCH_SEGS = 5;

function archPane(w: number, h: number): THREE.BufferGeometry {
  return new THREE.ShapeGeometry(archPath(new THREE.Shape(), w, h, 0, 0, ARCH_SEGS), ARCH_SEGS);
}

function archFrame(w: number, h: number, t: number): THREE.BufferGeometry {
  const s = archPath(new THREE.Shape(), w + 2 * t, h + t, 0, -t * 0.5, ARCH_SEGS);
  s.holes.push(archPath(new THREE.Path(), w, h, 0, 0, ARCH_SEGS, true));
  return new THREE.ShapeGeometry(s, ARCH_SEGS);
}

function merlonGeo(): THREE.BufferGeometry {
  const g = new THREE.BoxGeometry(0.72, 0.8, 0.42);
  g.translate(0, 0.4, 0);
  return g;
}

/** Balcony slab on two curved brackets with a low parapet (facade at z = 0). */
function balconyGeo(): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  const slab = new THREE.BoxGeometry(2.7, 0.24, 1.15);
  slab.translate(0, 0, 0.575);
  parts.push(slab);
  const front = new THREE.BoxGeometry(2.7, 0.75, 0.16);
  front.translate(0, 0.49, 1.07);
  parts.push(front);
  for (const sx of [-1, 1]) {
    const side = new THREE.BoxGeometry(0.16, 0.75, 1.0);
    side.translate(sx * 1.27, 0.49, 0.55);
    parts.push(side);
    // Curved bracket: a fillet between the wall and the slab underside.
    const s = new THREE.Shape();
    s.moveTo(0, 0);
    s.lineTo(0.95, 0);
    for (let i = 1; i < 8; i++) {
      const a = Math.PI / 2 + (i / 8) * (Math.PI / 2);
      s.lineTo(0.95 + Math.cos(a) * 0.95, -0.95 + Math.sin(a) * 0.95);
    }
    s.lineTo(0, -0.95);
    s.closePath();
    const br = new THREE.ExtrudeGeometry(s, { depth: 0.22, bevelEnabled: false, curveSegments: 8 });
    br.rotateY(-Math.PI / 2); // shape x → world z (outward), extrusion → −x
    br.translate(sx * 0.95 + 0.11, -0.12, 0);
    parts.push(br);
  }
  return mergeParts(parts);
}

/** Glowing lantern body (paper/ice), hanging point at y = 0.42 above its centre. */
function lanternGeo(): THREE.BufferGeometry {
  const g = new THREE.CylinderGeometry(0.17, 0.2, 0.42, 8);
  return g;
}

/** Dark caps, rim and hook of a lantern (pairs with lanternGeo). */
function lanternCapGeo(): THREE.BufferGeometry {
  const top = new THREE.ConeGeometry(0.27, 0.16, 8);
  top.translate(0, 0.29, 0);
  const bottom = new THREE.CylinderGeometry(0.14, 0.2, 0.06, 8);
  bottom.translate(0, -0.24, 0);
  const hook = new THREE.BoxGeometry(0.03, 0.34, 0.03);
  hook.translate(0, 0.52, 0);
  return mergeParts([top, bottom, hook]);
}

/** Wall bracket: plate on the facade, an arm reaching out along +Z with a brace. */
function bracketGeo(): THREE.BufferGeometry {
  const plate = new THREE.BoxGeometry(0.18, 0.34, 0.05);
  plate.translate(0, -0.12, 0.025);
  const arm = new THREE.BoxGeometry(0.06, 0.06, 0.7);
  arm.translate(0, 0, 0.35);
  const brace = new THREE.BoxGeometry(0.05, 0.05, 0.62);
  brace.rotateX(Math.PI / 4);
  brace.translate(0, -0.2, 0.22);
  return mergeParts([plate, arm, brace]);
}

function ropeGeo(): THREE.BufferGeometry {
  return new THREE.BoxGeometry(1, 0.035, 0.035);
}

// ---------------------------------------------------------------------------
// Districts
// ---------------------------------------------------------------------------

interface Facade {
  len: number;
  /** World (x, z) of facade offset u (along) at distance off in front of the wall. */
  at(u: number, off: number): [number, number];
  yaw: number;
}

function facade(b: { x0: number; z0: number; x1: number; z1: number }, s: Side): Facade {
  const cx = (b.x0 + b.x1) / 2, cz = (b.z0 + b.z1) / 2;
  switch (s) {
    case 'e':
      return { len: b.z1 - b.z0, at: (u, off) => [b.x1 + off, cz + u], yaw: Math.PI / 2 };
    case 'w':
      return { len: b.z1 - b.z0, at: (u, off) => [b.x0 - off, cz - u], yaw: -Math.PI / 2 };
    case 's':
      return { len: b.x1 - b.x0, at: (u, off) => [cx + u, b.z1 + off], yaw: 0 };
    default:
      return { len: b.x1 - b.x0, at: (u, off) => [cx - u, b.z0 - off], yaw: Math.PI };
  }
}

export interface DistrictBuild {
  /** Merged architecture (stays visible with the region). */
  body: ContentBuilder;
  /** Instanced windows, doors, lanterns (a distance-culled layer). */
  detail: ContentBuilder;
  /** Share of lit windows (time of day is handled by the emissive material). */
  litShare?: number;
}

/** Instanced facade details (windows, doors, lanterns, merlons) written into one builder. */
export class Detail {
  private readonly M = new THREE.Matrix4();
  private readonly Q = new THREE.Quaternion();
  private readonly P = new THREE.Vector3();
  private readonly S = new THREE.Vector3();
  /** Glowing lantern centres (x, y, z triples) for the night light pool. */
  readonly glow: number[] = [];

  constructor(readonly cb: ContentBuilder) {}

  put(key: string, factory: () => THREE.BufferGeometry, mat: WTMaterialName, x: number, y: number, z: number, yaw: number, sx = 1, sy = 1, sz = 1, shadow = false): void {
    this.Q.setFromAxisAngle(UP, yaw);
    this.cb.instance(key, factory, wtMat(mat), this.M.compose(this.P.set(x, y, z), this.Q, this.S.set(sx, sy, sz)), shadow);
  }

  /** Arched window with an ice-trim frame; (x, z) on the wall plane, facing yaw. */
  window(x: number, y: number, z: number, yaw: number, small: boolean, lit: boolean): void {
    const d = small ? SMALL : WIN;
    const fx = Math.sin(yaw), fz = Math.cos(yaw);
    this.put(small ? 'agna_frame_s' : 'agna_frame', () => archFrame(d.w, d.h, 0.16), 'ice_trim', x + fx * 0.015, y, z + fz * 0.015, yaw);
    this.put(`${small ? 'agna_win_s' : 'agna_win'}_${lit ? 'lit' : 'dark'}`, () => archPane(d.w, d.h), lit ? 'window' : 'dark', x + fx * 0.035, y, z + fz * 0.035, yaw);
  }

  /** Arched door (dark, or lit when open) with its frame. */
  door(x: number, y: number, z: number, yaw: number, lit: boolean, scale = 1): void {
    const fx = Math.sin(yaw), fz = Math.cos(yaw);
    this.put('agna_door_frame', () => archFrame(DOOR.w, DOOR.h, 0.2), 'ice_trim', x + fx * 0.135, y + 0.02, z + fz * 0.135, yaw, scale, scale, 1);
    this.put(lit ? 'agna_door_lit' : 'agna_door', () => archPane(DOOR.w, DOOR.h), lit ? 'window' : 'dark', x + fx * 0.155, y + 0.02, z + fz * 0.155, yaw, scale, scale, 1);
  }

  /** Lantern on a wall bracket; (x, y, z) = bracket on the wall, facing yaw. */
  wallLamp(x: number, y: number, z: number, yaw: number): void {
    this.put('agna_bracket', bracketGeo, 'dark', x, y, z, yaw);
    const fx = Math.sin(yaw), fz = Math.cos(yaw);
    this.lantern(x + fx * 0.64, y - 0.62, z + fz * 0.64, yaw);
  }

  /** Lantern hanging from a point (its centre 0.62 m below it). */
  lantern(x: number, y: number, z: number, yaw = 0): void {
    this.glow.push(x, y, z);
    this.put('agna_lantern', lanternGeo, 'lantern_warm', x, y, z, yaw);
    this.put('agna_lantern_cap', lanternCapGeo, 'dark', x, y, z, yaw);
  }

  /** Lantern on a rope strung across an alley (rope along local X). */
  hang(x: number, y: number, z: number, yaw: number, span: number): void {
    this.put('agna_rope', ropeGeo, 'rope', x, y, z, yaw, span, 1, 1);
    this.lantern(x, y - 0.62, z, yaw);
  }

  merlon(x: number, y: number, z: number, yaw: number, s = 1): void {
    this.put('agna_merlon', merlonGeo, 'ice_wall', x, y, z, yaw, s, s, s);
  }

  /** Merlons along the edge of a rounded block top. */
  merlons(b: RBox, y: number, step = 1.55): void {
    for (const s of SIDES) {
      const along = s === 'n' || s === 's';
      const half = (along ? b.hw : b.hd) - b.r;
      if (half < 0.6) continue;
      const n = Math.max(1, Math.floor((2 * half) / step) + 1);
      for (let i = 0; i < n; i++) {
        const u = n === 1 ? 0 : -half + (2 * half * i) / (n - 1);
        const x = along ? b.cx + u : b.cx + (s === 'e' ? 1 : -1) * (b.hw - 0.24);
        const z = along ? b.cz + (s === 's' ? 1 : -1) * (b.hd - 0.24) : b.cz + u;
        this.merlon(x, y, z, along ? 0 : Math.PI / 2);
      }
    }
  }
}

/** Build every building, passage and lantern of a district plan; returns its lantern positions. */
export function buildDistrict(plan: DistrictPlan, out: DistrictBuild): number[] {
  const acc = new MeshAcc();
  const rnd = new Random(plan.spec.seed * 31 + 7);
  const { body } = out;
  const det = new Detail(out.detail);
  const lit = out.litShare ?? 0.36;
  const put = det.put.bind(det);
  const addWindow = (f: Facade, u: number, y: number, small: boolean, on: boolean): void => {
    const [x, z] = f.at(u, 0);
    det.window(x, y, z, f.yaw, small, on);
  };
  const wallLamp = det.wallLamp.bind(det);
  const merlons = (b: RBox, y: number): void => det.merlons(b, y);

  const house = (b: PlanBuilding): void => {
    const w = b.x1 - b.x0, d = b.z1 - b.z0;
    const box: RBox = { cx: (b.x0 + b.x1) / 2, cz: (b.z0 + b.z1) / 2, hw: w / 2, hd: d / 2, r: Math.min(1.1, 0.17 * Math.min(w, d)) };
    const y = b.y, top = b.y + b.h;
    const roofY = top + 0.12;
    const minS = Math.min(w, d);
    // Plinth, walls, storey bands, cornice with a snowy roof.
    prism(acc, 'ice_trim', grow(box, 0.12), y - 0.4, y + 0.42);
    ledge(acc, 'ice_trim', box, grow(box, 0.12), y + 0.42);
    prism(acc, 'ice_wall', box, y + 0.42, top - 0.3);
    for (let f = 1; f < b.floors; f++) prism(acc, 'ice_trim', grow(box, 0.07), y + f * STOREY - 0.09, y + f * STOREY + 0.09);
    prism(acc, 'ice_trim', grow(box, 0.22), top - 0.3, roofY, 'snow', 'ice_trim');
    let crown = roofY;
    body.collider({ shape: 'box', x: box.cx, y: (y + roofY) / 2, z: box.cz, hx: box.hw + 0.08, hy: (roofY - y) / 2, hz: box.hd + 0.08, walkable: true, solid: true, surface: 'ice' });

    // Roof.
    if (b.roof === 'crenel') merlons(grow(box, 0.22), roofY);
    else if (b.roof === 'dome') {
      const r = Math.min(4.2, minS * 0.36);
      cyl(acc, 'ice_trim', box.cx, box.cz, r + 0.18, roofY, roofY + 0.55, 16);
      const dg = dome(r, 0.92, 16, 6);
      dg.translate(box.cx, roofY + 0.55, box.cz);
      acc.add('ice_wall', dg);
      dg.dispose();
      const tip = roofY + 0.55 + r * 0.92;
      cyl(acc, 'ice_trim', box.cx, box.cz, 0.16, tip - 0.1, tip + 0.9, 6, 0.02);
      crown = tip;
      body.collider({ shape: 'cylinder', x: box.cx, y: roofY + (tip - roofY) * 0.4, z: box.cz, r: r * 0.9, hy: (tip - roofY) * 0.4, walkable: true, solid: true, surface: 'ice' });
    } else if (b.roof === 'tier') {
      const t = Math.max(1.1, Math.min(2.2, minS * 0.2));
      if (minS - 2 * t >= 2.8) {
        const tb: RBox = { cx: box.cx, cz: box.cz, hw: box.hw - t, hd: box.hd - t, r: Math.max(0.4, box.r - t * 0.4) };
        const t1 = roofY + 2.9;
        prism(acc, 'ice_wall', tb, roofY, t1 - 0.25);
        prism(acc, 'ice_trim', grow(tb, 0.16), t1 - 0.25, t1 + 0.1, 'snow', 'ice_trim');
        merlons(grow(box, 0.22), roofY);
        for (const s of SIDES) {
          if (!b.open[s]) continue;
          const f = facade({ x0: tb.cx - tb.hw, z0: tb.cz - tb.hd, x1: tb.cx + tb.hw, z1: tb.cz + tb.hd }, s);
          if (f.len - 2 * tb.r >= 1.2) addWindow(f, 0, roofY + 0.7, true, rnd.chance(lit + 0.1));
        }
        crown = t1 + 0.1;
        body.collider({ shape: 'box', x: tb.cx, y: (roofY + crown) / 2, z: tb.cz, hx: tb.hw, hy: (crown - roofY) / 2, hz: tb.hd, walkable: true, solid: true, surface: 'ice' });
        if (Math.min(tb.hw, tb.hd) >= 1.6) {
          const r = Math.min(tb.hw, tb.hd) * 0.8;
          const dg = dome(r, 0.85, 14, 5);
          dg.translate(tb.cx, crown, tb.cz);
          acc.add('ice_wall', dg);
          dg.dispose();
          crown += r * 0.85;
        }
      } else merlons(grow(box, 0.22), roofY);
    } else if (b.roof === 'vault') {
      const alongX = w >= d;
      const r = (alongX ? d : w) / 2 - 0.2;
      const len = (alongX ? w : d) - 0.3;
      const g = new THREE.CylinderGeometry(r, r, len, 12, 1, false, 0, Math.PI);
      g.rotateZ(Math.PI / 2);
      g.scale(1, 0.55, 1);
      if (!alongX) g.rotateY(Math.PI / 2);
      g.translate(box.cx, roofY, box.cz);
      acc.add('ice_wall', g);
      g.dispose();
      crown = roofY + r * 0.55;
      body.collider({ shape: 'box', x: box.cx, y: roofY + r * 0.27, z: box.cz, hx: alongX ? len / 2 : r * 0.8, hy: r * 0.27, hz: alongX ? r * 0.8 : len / 2, walkable: true, solid: true, surface: 'ice' });
    }

    // Small tiered tower on a corner.
    if (b.tower) {
      const k = b.seed % 4;
      const sx = k === 0 || k === 1 ? 1 : -1, sz = k === 0 || k === 3 ? 1 : -1;
      const tx = box.cx + sx * (box.hw - 1.4), tz = box.cz + sz * (box.hd - 1.4);
      const h1 = Math.max(roofY + 4.4, crown + 1.5);
      cyl(acc, 'ice_wall', tx, tz, 1.25, roofY - 0.2, h1, 14);
      cyl(acc, 'ice_trim', tx, tz, 1.42, h1 - 0.2, h1 + 0.25, 14);
      cyl(acc, 'ice_trim', tx, tz, 1.34, roofY + 1.6, roofY + 1.8, 14);
      const bd = bulbDome(1.32, 3.1, 12);
      bd.translate(tx, h1 + 0.25, tz);
      acc.add('ice_wall', bd);
      bd.dispose();
      const a = Math.atan2(sx, sz);
      const f: Facade = { len: 3, at: (u, off) => [tx + Math.sin(a) * (1.25 + off) + Math.cos(a) * u, tz + Math.cos(a) * (1.25 + off) - Math.sin(a) * u], yaw: a };
      addWindow(f, 0, roofY + 2.1, true, rnd.chance(0.5));
      body.collider({ shape: 'cylinder', x: tx, y: (roofY + h1 + 3.3) / 2, z: tz, r: 1.3, hy: (h1 + 3.3 - roofY) / 2, walkable: false, solid: true, surface: 'ice' });
    }

    // Door (on a walkable side), with a lantern beside it.
    let doorU: number | null = null;
    if (b.door) {
      const f = facade(b, b.door);
      const flat = f.len - 2 * box.r;
      doorU = flat > 4.4 ? rnd.range(-1, 1) * (flat / 2 - 1.7) : 0;
      const [dx, dz] = f.at(doorU, 0);
      det.door(dx, y, dz, f.yaw, rnd.chance(0.16));
      if (rnd.chance(0.55)) {
        const side = doorU > 0 ? -1 : 1;
        const lu = doorU + side * 1.25;
        if (Math.abs(lu) < f.len / 2 - box.r - 0.3) {
          const [lx, lz] = f.at(lu, 0.02);
          wallLamp(lx, y + 3.05, lz, f.yaw);
        }
      }
    }

    // Tall arched windows on every open facade and storey.
    for (const s of SIDES) {
      if (!b.open[s]) continue;
      const f = facade(b, s);
      const flat = f.len - 2 * box.r;
      const n = Math.max(f.len >= 3 ? 1 : 0, Math.floor((flat - 0.4) / 2.2));
      for (let fl = 0; fl < b.floors; fl++) {
        for (let i = 0; i < n; i++) {
          const u = (i - (n - 1) / 2) * 2.2;
          if (fl === 0 && b.door === s && doorU !== null && Math.abs(u - doorU) < 1.75) continue;
          addWindow(f, u, y + fl * STOREY + 0.8, false, rnd.chance(lit));
        }
      }
    }

    // Balcony on curved brackets (first floor).
    if (b.balcony && b.floors >= 2) {
      const f = facade(b, b.balcony);
      if (f.len - 2 * box.r >= 3) {
        const u = b.door === b.balcony && doorU !== null ? doorU : 0;
        const [x, z] = f.at(u, 0);
        const by = y + STOREY + 0.06;
        put('agna_balcony', balconyGeo, 'ice_trim', x, by, z, f.yaw, 1, 1, 1, true);
        const fx = Math.sin(f.yaw), fz = Math.cos(f.yaw);
        body.collider({ shape: 'box', x: x + fx * 0.58, y: by + 0.25, z: z + fz * 0.58, hx: 1.35, hy: 0.5, hz: 0.58, yaw: f.yaw, walkable: true, solid: true, surface: 'ice' });
      }
    }
  };

  const span = (s: PlanSpan): void => {
    const y = plan.spec.y;
    const alongX = s.along === 'x';
    const width = alongX ? s.z1 - s.z0 : s.x1 - s.x0;
    const depth = alongX ? s.x1 - s.x0 : s.z1 - s.z0;
    const cx = (s.x0 + s.x1) / 2, cz = (s.z0 + s.z1) / 2;
    const g = panelWithArches(width, s.top - y, depth, [{ x: 0, y: 0, w: width - 0.62, h: s.bottom - y }], 8);
    g.applyMatrix4(new THREE.Matrix4().compose(new THREE.Vector3(cx, y, cz), new THREE.Quaternion().setFromAxisAngle(UP, alongX ? Math.PI / 2 : 0), new THREE.Vector3(1, 1, 1)));
    acc.add('ice_wall', g);
    g.dispose();
    const rb: RBox = { cx, cz, hw: (s.x1 - s.x0) / 2, hd: (s.z1 - s.z0) / 2, r: 0.1 };
    prism(acc, 'ice_trim', grow(rb, 0.14), s.top - 0.28, s.top + 0.1, 'snow', 'ice_trim');
    body.collider({ shape: 'box', x: cx, y: (s.bottom + s.top + 0.1) / 2, z: cz, hx: (s.x1 - s.x0) / 2, hy: (s.top + 0.1 - s.bottom) / 2, hz: (s.z1 - s.z0) / 2, walkable: true, solid: true, surface: 'ice' });
    // A lantern hanging in the passage.
    det.lantern(cx, s.bottom - 0.75, cz);
  };

  const lamp = (l: PlanLamp): void => {
    if (l.kind === 'wall') {
      wallLamp(l.x, l.y, l.z, l.yaw);
      return;
    }
    det.hang(l.x, l.y, l.z, l.yaw, (l.span ?? 3) + 0.4);
  };

  for (const b of plan.buildings) house(b);
  for (const s of plan.spans) span(s);
  for (const l of plan.lamps) lamp(l);
  acc.emit(body);
  return det.glow;
}
