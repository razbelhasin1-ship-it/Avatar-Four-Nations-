import * as THREE from 'three';
import type { GameContext } from '../../../core/GameContext';
import type { ContentBuilder } from '../../kit/Builder';
import type { P2 } from '../../WorldLayout';
import { annulusGeometry, stripGeometry } from './geom';
import { hangingBanner } from './parts';
import { prismGeometry } from './walls';
import type { BuildEnv } from './env';
import {
  AVENUES,
  C,
  DEG,
  FARM_ROADS,
  FOOT,
  GATES,
  GROUND,
  LOWER_LANES,
  R,
  RAIL,
  RAIL_LINES,
  RING_STREETS,
  WALL,
  gatesOf,
  polar,
  wrapAngle,
  type GateDef,
} from './bssLayout';
import { BssMats, RailPath, batteredSegment, gateBlock, medallion, pillarTower, ringChords, ringFrame, ringSections, sign, slabGeometry, type Frame, type Portal } from './bssKit';

/**
 * Ba Sing Se walls: the backdrop-scale Outer Wall (180 m, with homes and
 * sentry houses, three gate towers), the earthen Inner Wall (60 m, main gate
 * with the road tunnel and three viaduct portals), the 30 m ring walls with
 * 中環 / 上環 gates (viaducts pass through notches flanked by pagoda pillar
 * towers), the palace wall, ground surfaces and the earthbent gate slabs.
 */

export interface WallSite {
  env: BuildEnv;
  bm: BssMats;
  gates: GateRuntime;
  mark(id: string, x: number, y: number, z: number): void;
}

const ARCS = { outer: 16, inner: 12, ring: 8 };

function arcChunk(env: BuildEnv, key: string, theta: number, arcs: number): ContentBuilder {
  const i = Math.floor((wrapAngle(theta) / (Math.PI * 2)) * arcs) % arcs;
  return env.chunks.named('major', `${key}:${i}`).builder;
}

/** Smoothed rail centre lines (shared with the viaduct builder). */
let railPaths: Map<string, RailPath> | null = null;
export function railPath(id: string): RailPath {
  if (!railPaths) {
    railPaths = new Map();
    for (const l of RAIL_LINES) railPaths.set(l.id, new RailPath(l.pts, l.kind === 'loop'));
  }
  return railPaths.get(id)!;
}

/** Where rail lines cross a wall of radius r: θ, lateral offset in a gate frame and the gap width along the wall. */
export function railCrossings(r: number): Array<{ theta: number; p: P2; along: number }> {
  const out: Array<{ theta: number; p: P2; along: number }> = [];
  for (const l of RAIL_LINES) {
    if (l.kind !== 'shuttle') continue;
    for (const c of railPath(l.id).crossings(r)) {
      const nr = Math.abs(c.tx * Math.cos(c.theta) + c.tz * Math.sin(c.theta));
      out.push({ theta: c.theta, p: { x: c.x, z: c.z }, along: RAIL.deckW / Math.max(0.35, nr) });
    }
  }
  return out;
}

function gateHalf(g: GateDef, W: number, r: number): [number, number] {
  return [g.theta, W / 2 + 0.2 + 0 * r];
}

function lateral(f: Frame, p: P2): number {
  const rx = Math.cos(f.yaw), rz = -Math.sin(f.yaw);
  return (p.x - f.x) * rx + (p.z - f.z) * rz;
}

// ---------------------------------------------------------------------------
// Outer Wall
// ---------------------------------------------------------------------------

export function buildOuterWall(site: WallSite): void {
  const { env, bm } = site;
  const W = WALL.outer;
  const H = W.h + 2;
  const base = GROUND - 2;
  const gateW = (g: GateDef) => (g.main ? 58 : 42);
  const gates = gatesOf('outer');
  const secs = ringSections(R.outer, gates.map((g) => gateHalf(g, gateW(g), R.outer)));
  let k = 0;
  for (const [t0, t1] of secs) {
    for (const [a, c, tm] of ringChords(R.outer, t0, t1, 18)) {
      const b = arcChunk(env, 'outer', tm, ARCS.outer);
      batteredSegment(b, bm.outerStone, a, c, base, H, W.base, W.top, { coping: 'stone_light', bands: [0.16, 0.34, 0.52, 0.7, 0.88], bandMat: 'stone_tan', parapet: 1.6, stack: 3, extend: 0.7 });
      const yaw = Math.atan2(-(c.z - a.z), c.x - a.x);
      const s = Math.sin(yaw) * Math.cos(tm) + Math.cos(yaw) * Math.sin(tm) >= 0 ? 1 : -1;
      const mx = (a.x + c.x) / 2, mz = (a.z + c.z) / 2;
      // Stepped battered buttresses on the city face.
      if (k % 4 === 1) {
        const dIn = (y: number) => W.base / 2 - ((W.base - W.top) / 2) * (y / H);
        const hb = H * 0.82;
        const g = prismGeometry([[-s * (dIn(0) - 1), 0], [-s * (dIn(0) + 6), 0], [-s * (dIn(hb) - 0.6), hb]], 8);
        b.mesh(bm.outerStone, g, { x: mx, y: base, z: mz, yaw });
        g.dispose();
        const g2 = prismGeometry([[s * (dIn(0) - 1), 0], [s * (dIn(0) + 6), 0], [s * (dIn(hb) - 0.6), hb]], 8);
        b.mesh(bm.outerStone, g2, { x: mx, y: base, z: mz, yaw });
        g2.dispose();
        const pIn = polar(tm, R.outer - dIn(0) - 3);
        b.collider({ shape: 'box', x: pIn.x, y: base + 20, z: pIn.z, hx: 4, hz: 3.2, hy: 20, yaw, walkable: false, solid: true });
      }
      // Sentry houses on the walkway.
      if (k % 5 === 2) {
        const top = base + H;
        b.block('plaster_tan', { x: mx, y: top, z: mz, sx: 7, sy: 4.4, sz: 7, yaw });
        b.box('wood_red', { x: mx, y: top + 2.2, z: mz, sx: 7.3, sy: 0.5, sz: 7.3, yaw });
        b.roof('roof_green', { x: mx, y: top + 4.4, z: mz, w: 7, d: 7, height: 2.6, yaw, overhang: 1.4, curve: 0.8, style: 'hip', ridge: null });
      }
      k++;
    }
  }
  // Homes built into the city face around the main gate: windows, doors, balconies, lanterns.
  const main = gates.find((g) => g.main)!;
  const homes = env.chunks.named('props', 'outer_homes').builder;
  for (let lat = -150; lat <= 150; lat += 6.5) {
    if (Math.abs(lat) < gateW(main) / 2 + 6) continue;
    const t = main.theta + lat / R.outer;
    const r = env.rnd;
    for (let lvl = 0; lvl < 6; lvl++) {
      if (r.next() < 0.28 + lvl * 0.05) continue;
      const y = 2.2 + lvl * 8.5;
      const dIn = W.base / 2 - ((W.base - W.top) / 2) * ((y + 2) / H);
      const p = polar(t, R.outer - dIn - 0.12);
      const yaw = Math.atan2(-Math.cos(t), -Math.sin(t));
      if (lvl === 0) {
        homes.box('wood_dark', { x: p.x, y: GROUND + 1.25, z: p.z, sx: 1.6, sy: 2.5, sz: 0.3, yaw });
        homes.box('stone_tan', { x: p.x - Math.cos(t) * 0.8, y: GROUND + 0.15, z: p.z - Math.sin(t) * 0.8, sx: 2.6, sy: 0.3, sz: 1.4, yaw });
        homes.box('roof_dark', { x: p.x - Math.cos(t) * 0.5, y: GROUND + 3.0, z: p.z - Math.sin(t) * 0.5, sx: 2.6, sy: 0.18, sz: 1.2, yaw, pitch: -0.25 });
        continue;
      }
      homes.box('wood_dark', { x: p.x, y: GROUND + y, z: p.z, sx: 1.3, sy: 1.7, sz: 0.3, yaw });
      homes.box('wood_red', { x: p.x, y: GROUND + y + 1.0, z: p.z, sx: 1.7, sy: 0.22, sz: 0.4, yaw });
      if (r.next() < 0.45) {
        const q = polar(t, R.outer - dIn - 0.9);
        homes.box('wood', { x: q.x, y: GROUND + y - 1.05, z: q.z, sx: 2.6, sy: 0.18, sz: 1.6, yaw });
        homes.box('wood_dark', { x: q.x - Math.cos(t) * 0.75, y: GROUND + y - 0.55, z: q.z - Math.sin(t) * 0.75, sx: 2.6, sy: 0.9, sz: 0.08, yaw });
      }
      if (r.next() < 0.2) homes.lantern(new THREE.Vector3(p.x - Math.cos(t) * 0.6, GROUND + y + 1.3, p.z - Math.sin(t) * 0.6), { color: 'red', hanging: true });
    }
  }
  // Gate towers.
  for (const g of gates) {
    const Wg = gateW(g);
    const D = W.base + 6;
    const f = ringFrame(g.theta, g.r);
    const b = env.chunks.named('major', `outer_gate:${g.id}`).builder;
    const Ht = H + 10;
    gateBlock(b, { f, baseY: base, W: Wg, D, H: Ht, mat: bm.outerStone, trim: 'stone_light', tunnel: { aw: g.width, spring: g.height - g.width / 2 + 2 }, bands: [0.16, 0.34, 0.52, 0.7, 0.88].map((q) => (q * H) / Ht) });
    // Gate hall on top.
    const top = base + Ht;
    const hw = Wg * 0.62, hd = D * 0.42;
    b.block('plaster_tan', { x: f.x, y: top, z: f.z, sx: hw, sy: 9, sz: hd, yaw: f.yaw });
    for (let i = 0; i <= 8; i++) {
      for (const sd of [-1, 1]) {
        const q = f.at(-hw / 2 + (i * hw) / 8, sd * (hd / 2 + 0.2));
        b.box('wood_red', { x: q.x, y: top + 4.5, z: q.z, sx: 0.7, sy: 9, sz: 0.5, yaw: f.yaw });
      }
    }
    b.roof('roof_green', { x: f.x, y: top + 9, z: f.z, w: hw, d: hd, height: 6, yaw: f.yaw, overhang: 3.2, curve: 0.9, style: 'hip', ridge: 'roof_dark' });
    b.block('plaster_tan', { x: f.x, y: top + 11.5, z: f.z, sx: hw * 0.62, sy: 6, sz: hd * 0.62, yaw: f.yaw });
    b.roof('roof_green', { x: f.x, y: top + 17.5, z: f.z, w: hw * 0.62, d: hd * 0.62, height: 5.5, yaw: f.yaw, overhang: 2.6, curve: 0.9, style: 'hip', ridge: 'roof_dark' });
    // Medallions and banners on both faces.
    for (const side of [1, -1]) {
      const p = f.at(0, side * (D / 2 + 0.25));
      const faceYaw = side > 0 ? f.yaw : f.yaw + Math.PI;
      medallion(b, bm, p.x, base + g.height + 16, p.z, faceYaw, g.main ? 7 : 5.5, 0.6);
      for (const bx of [-1, 1]) {
        const q = f.at(bx * (g.width / 2 + 7), side * (D / 2 + 0.3));
        hangingBanner(b, env.mats, q.x, base + g.height + 30, q.z, faceYaw - Math.PI / 2, 5, 24);
      }
    }
    // Paved passage through the gate.
    const floor = new THREE.PlaneGeometry(g.width, D + 8);
    floor.rotateX(-Math.PI / 2);
    b.mesh('paving', floor, { x: f.x, y: GROUND + 0.05, z: f.z, yaw: f.yaw }, { castShadow: false });
    floor.dispose();
    site.gates.add({ id: g.id, f, lz: D / 2 - 2, baseY: GROUND, aw: g.width, spring: g.height - g.width / 2, thick: 2.6, openR: g.main ? 46 : 36 });
    site.mark(`gate_${g.id}`, f.x, GROUND, f.z);
  }
}

// ---------------------------------------------------------------------------
// Inner Wall
// ---------------------------------------------------------------------------

export function buildInnerWall(site: WallSite): void {
  const { env, bm } = site;
  const W = WALL.inner;
  const H = W.h + 1;
  const base = GROUND - 1;
  const gates = gatesOf('inner');
  const gateW = (g: GateDef) => (g.main ? 66 : 30);
  for (const [t0, t1] of ringSections(R.inner, gates.map((g) => gateHalf(g, gateW(g), R.inner)))) {
    for (const [a, c, tm] of ringChords(R.inner, t0, t1, 12)) {
      batteredSegment(arcChunk(env, 'inner', tm, ARCS.inner), bm.earthen, a, c, base, H, W.base, W.top, { coping: 'stone_tan', bands: [0.33, 0.66], bandMat: 'stone_grey', parapet: 1.4, stack: 2, extend: 0.5 });
    }
  }
  const crossings = railCrossings(R.inner);
  for (const g of gates) {
    const Wg = gateW(g);
    const D = W.base + 4;
    const f = ringFrame(g.theta, g.r);
    const b = env.chunks.named('major', `inner_gate:${g.id}`).builder;
    const portals: Portal[] = [];
    if (g.main) {
      for (const c of crossings) {
        const lat = lateral(f, c.p);
        if (Math.abs(lat) < Wg / 2) portals.push({ lat, w: RAIL.deckW + 2, y0: GROUND + RAIL.deck - 1.7 - base, jamb: 7.2 });
      }
    }
    gateBlock(b, { f, baseY: base, W: Wg, D, H: H + 4, mat: bm.earthen, trim: 'stone_tan', tunnel: { aw: g.width, spring: g.height - g.width / 2 + 1 }, portals, bands: [0.33, 0.66].map((q) => (q * H) / (H + 4)) });
    // Corner bastions frame the gate on the farm side.
    for (const sd of [-1, 1]) {
      const p = f.at(sd * (Wg / 2 + 3.5), D / 2 - 1);
      b.box(bm.earthen, { x: p.x, y: base + (H + 6) / 2, z: p.z, sx: 7, sy: H + 6, sz: 9, yaw: f.yaw }, { collide: true, walkable: true });
      b.box('stone_tan', { x: p.x, y: base + H + 6, z: p.z, sx: 7.6, sy: 0.8, sz: 9.6, yaw: f.yaw });
    }
    const top = base + H + 4;
    if (g.main) {
      const hw = 34, hd = 13;
      const c0 = f.at(0, -1);
      b.block('plaster_tan', { x: c0.x, y: top, z: c0.z, sx: hw, sy: 8, sz: hd, yaw: f.yaw });
      for (let i = 0; i <= 10; i++) {
        for (const sd of [-1, 1]) {
          const q = f.at(-hw / 2 + (i * hw) / 10, -1 + sd * (hd / 2 + 0.2));
          b.box('wood_red', { x: q.x, y: top + 4, z: q.z, sx: 0.6, sy: 8, sz: 0.45, yaw: f.yaw });
        }
      }
      b.roof('roof_green', { x: c0.x, y: top + 8, z: c0.z, w: hw, d: hd, height: 5, yaw: f.yaw, overhang: 2.8, curve: 0.9, style: 'hip', ridge: 'roof_dark' });
      b.block('plaster_tan', { x: c0.x, y: top + 10, z: c0.z, sx: hw * 0.6, sy: 5.5, sz: hd * 0.66, yaw: f.yaw });
      b.roof('roof_green', { x: c0.x, y: top + 15.5, z: c0.z, w: hw * 0.6, d: hd * 0.66, height: 4.5, yaw: f.yaw, overhang: 2.2, curve: 0.9, style: 'hip', ridge: 'roof_dark' });
    }
    for (const side of [1, -1]) {
      const p = f.at(0, side * (D / 2 + 0.2));
      const faceYaw = side > 0 ? f.yaw : f.yaw + Math.PI;
      medallion(b, bm, p.x, base + g.height + 5, p.z, faceYaw, g.main ? 4.2 : 3.2, 0.45);
      if (side > 0) {
        for (const bx of [-1, 1]) {
          const q = f.at(bx * (g.width / 2 + 4), D / 2 + 0.25);
          hangingBanner(b, env.mats, q.x, base + g.height + 12, q.z, faceYaw - Math.PI / 2, 3.4, 14);
        }
      }
    }
    const floor = new THREE.PlaneGeometry(g.width, D + 6);
    floor.rotateX(-Math.PI / 2);
    b.mesh('paving', floor, { x: f.x, y: GROUND + 0.05, z: f.z, yaw: f.yaw }, { castShadow: false });
    floor.dispose();
    site.gates.add({ id: g.id, f, lz: D / 2 - 1.5, baseY: GROUND, aw: g.width, spring: g.height - g.width / 2, thick: 2.2, openR: g.main ? 40 : 30 });
    site.mark(`gate_${g.id}`, f.x, GROUND, f.z);
  }
}

// ---------------------------------------------------------------------------
// Ring walls (中環 / 上環)
// ---------------------------------------------------------------------------

export function buildRingWall(site: WallSite, which: 'middle' | 'upper'): void {
  const { env, bm } = site;
  const W = WALL.ring;
  const r = which === 'middle' ? R.middle : R.upper;
  const H = W.h + 1;
  const base = GROUND - 1;
  const lowTop = GROUND + RAIL.deck - 1.7;
  const gates = gatesOf(which);
  // Main (west) gates also carry the Central Line notch beside the road tunnel.
  const gw = (g: GateDef) => (g.main ? 38 : 24);
  const crossings = railCrossings(r);
  // Crossings that pass through a gate get a notch; the others lower a stretch of wall.
  const inGate = (c: { p: P2 }) => gates.some((g) => Math.abs(lateral(ringFrame(g.theta, g.r), c.p)) < gw(g) / 2 - 4 && Math.hypot(c.p.x - polar(g.theta, r).x, c.p.z - polar(g.theta, r).z) < gw(g));
  const open = crossings.filter((c) => !inGate(c));
  const gaps: Array<[number, number]> = gates.map((g) => gateHalf(g, gw(g), r));
  for (const c of open) gaps.push([c.theta, c.along / 2 + 1.5]);
  const key = `ring_${which}`;
  for (const [t0, t1] of ringSections(r, gaps)) {
    for (const [a, c, tm] of ringChords(r, t0, t1, 10)) {
      const b = arcChunk(env, key, tm, ARCS.ring);
      batteredSegment(b, bm.ringStone, a, c, base, H, W.base, W.top, { coping: 'stone_tan', bands: [0.09, 0.5], bandMat: 'stone_tan', parapet: 1.3, stack: 1, extend: 0.4 });
      // Merlons on the outer edge.
      const dx = c.x - a.x, dz = c.z - a.z;
      const len = Math.hypot(dx, dz);
      const yaw = Math.atan2(-dz, dx);
      const n = Math.max(1, Math.floor(len / 2.6));
      for (let i = 0; i < n; i++) {
        const u = (i + 0.5) / n;
        const p = { x: a.x + dx * u + Math.cos(tm) * (W.top / 2 - 0.4), z: a.z + dz * u + Math.sin(tm) * (W.top / 2 - 0.4) };
        b.box(bm.ringStone, { x: p.x, y: base + H + 1.3 + 0.5, z: p.z, sx: 1.2, sy: 1.0, sz: 0.8, yaw });
      }
    }
  }
  // Lowered stretches under oblique viaducts, flanked by pagoda pillar towers.
  for (const c of open) {
    const hw = c.along / 2 + 1.5;
    const b = env.chunks.named('major', `${key}_rail:${Math.round(c.theta * 100)}`).builder;
    for (const [a, q] of ringChords(r, c.theta - hw / r, c.theta + hw / r, 10).map(([a1, c1]) => [a1, c1] as [P2, P2])) {
      batteredSegment(b, bm.ringStone, a, q, base, lowTop - base, W.base, W.top, { coping: 'stone_tan', bands: [0.09], bandMat: 'stone_tan', stack: 1, extend: 0.3 });
    }
    for (const sd of [-1, 1]) {
      const p = polar(c.theta + (sd * (hw + 3.2)) / r, r);
      pillarTower(b, bm, p.x, p.z, GROUND, c.theta + Math.PI / 2, 6.4, 38);
    }
  }
  for (const g of gates) {
    const f = ringFrame(g.theta, g.r);
    const b = env.chunks.named('major', `${key}_gate:${g.id}`).builder;
    const gateW = gw(g);
    const thru = crossings.find((c) => !open.includes(c) && Math.abs(lateral(f, c.p)) < gateW / 2);
    const D = W.base + 3;
    gateBlock(b, {
      f,
      baseY: base,
      W: gateW,
      D,
      H: H + 4,
      mat: bm.ringStone,
      trim: 'stone_tan',
      tunnel: { aw: g.width, spring: g.height - g.width / 2 + 1 },
      notch: thru ? { lat: lateral(f, thru.p), w: RAIL.deckW + 2, y0: lowTop - base } : undefined,
      bands: [0.09, 0.5],
    });
    if (thru) {
      for (const sd of [-1, 1]) {
        const p = f.at(lateral(f, thru.p) + sd * (RAIL.deckW / 2 + 4.6), 0);
        pillarTower(b, bm, p.x, p.z, GROUND, f.yaw, 6.4, 40);
      }
    } else {
      const top = base + H + 4;
      b.block('plaster_tan', { x: f.x, y: top, z: f.z, sx: 15, sy: 5, sz: 7, yaw: f.yaw });
      b.roof('roof_green', { x: f.x, y: top + 5, z: f.z, w: 15, d: 7, height: 3.4, yaw: f.yaw, overhang: 1.8, curve: 0.9, style: 'hip', ridge: 'roof_dark' });
    }
    // Sign on the outward face (seen when walking in), medallion on the inner face.
    const apex = g.height;
    const po = f.at(0, D / 2 + 0.05);
    sign(b, bm, g.sign ?? '', po.x, GROUND + apex + 4.2, po.z, f.yaw, 5.6, { vertical: true });
    const pi = f.at(0, -D / 2 - 0.25);
    medallion(b, bm, pi.x, GROUND + apex + 4.5, pi.z, f.yaw + Math.PI, 2.4, 0.35);
    for (const bx of [-1, 1]) {
      const q = f.at(bx * (g.width / 2 + 3.2), D / 2 + 0.25);
      hangingBanner(b, env.mats, q.x, GROUND + apex + 8, q.z, f.yaw - Math.PI / 2, 2.6, 10);
    }
    const floor = new THREE.PlaneGeometry(g.width, D + 4);
    floor.rotateX(-Math.PI / 2);
    b.mesh('paving', floor, { x: f.x, y: GROUND + 0.06, z: f.z, yaw: f.yaw }, { castShadow: false });
    floor.dispose();
    site.gates.add({ id: g.id, f, lz: 0, baseY: GROUND, aw: g.width, spring: g.height - g.width / 2, thick: 1.8, openR: 24 });
    site.mark(`gate_${g.id}`, f.x, GROUND, f.z);
  }
}

// ---------------------------------------------------------------------------
// Palace wall
// ---------------------------------------------------------------------------

export const PALACE_GATES: Array<{ id: string; theta: number; w: number }> = [
  { id: 'palace_south', theta: 90 * DEG, w: 30 },
  { id: 'palace_north', theta: 270 * DEG, w: 12 },
];

export function buildPalaceWall(site: WallSite): void {
  const { env, bm } = site;
  const W = WALL.palace;
  const b0 = env.chunks.named('major', 'palace_wall').builder;
  for (const [t0, t1] of ringSections(R.palace, PALACE_GATES.map((g) => [g.theta, g.w / 2] as [number, number]))) {
    for (const [a, c] of ringChords(R.palace, t0, t1, 6)) {
      batteredSegment(b0, 'stone_white', a, c, GROUND - 0.5, W.h + 0.5, W.base, W.top, { coping: 'gold', stack: 1, extend: 0.2 });
      const dx = c.x - a.x, dz = c.z - a.z;
      const yaw = Math.atan2(-dz, dx);
      const len = Math.hypot(dx, dz) + 0.5;
      b0.roof(bm.palaceRoof, { x: (a.x + c.x) / 2, y: GROUND + W.h + 0.1, z: (a.z + c.z) / 2, w: len, d: W.top + 1.2, height: 1.1, yaw, overhang: 0.5, curve: 0.6, style: 'gable', ridge: null });
      b0.box('plaster_red', { x: (a.x + c.x) / 2, y: GROUND + 0.6, z: (a.z + c.z) / 2, sx: len, sy: 1.2, sz: W.base + 0.4, yaw });
    }
  }
}

// ---------------------------------------------------------------------------
// Ground surfaces
// ---------------------------------------------------------------------------

export function buildGrounds(site: WallSite): void {
  const { env } = site;
  const m = env.mats;
  const g = env.chunks.named('major', 'grounds').builder;
  const ring = (mat: THREE.Material | 'paving', r0: number, r1: number, y: number, tile: number, segs = 256) => {
    const geo = annulusGeometry(C.x, C.z, () => r0, () => r1, y, tile, segs, 2);
    g.mesh(mat, geo, { x: 0, y: 0, z: 0 }, { castShadow: false });
    geo.dispose();
  };
  ring(site.bm.mud, FOOT.middleOut - 0.5, FOOT.innerIn + 0.5, GROUND + 0.03, 9);
  ring(site.bm.lawn, FOOT.upperOut - 0.5, FOOT.middleIn + 0.5, GROUND + 0.03, 6);
  ring(m.groundUpper, FOOT.palaceOut - 0.4, FOOT.upperIn + 0.5, GROUND + 0.03, 4);
  ring('paving', 0.01, R.palace - WALL.palace.base / 2 + 0.3, GROUND + 0.03, 3, 96);
  // Ring streets.
  const rs = RING_STREETS;
  for (const s of [rs.upper, rs.middleIn, rs.middleOut]) ring('paving', s.r - s.width / 2, s.r + s.width / 2, GROUND + 0.05, 3);
  for (const s of [rs.lowerIn, rs.lowerMid, ...LOWER_LANES]) ring(site.bm.mudTrack, s.r - s.width / 2, s.r + s.width / 2, GROUND + 0.05, 6);
  // Radial avenues (stone in the Lower Ring, flagstones further in).
  for (const a of AVENUES) {
    const segsR: Array<[number, number, THREE.Material | 'paving']> = [
      [Math.max(a.r0, FOOT.middleOut - 1), FOOT.innerIn + 1, site.bm.mudTrack],
      [Math.max(a.r0, FOOT.upperOut - 1), FOOT.middleIn + 1, 'paving'],
      [a.r0, FOOT.upperIn + 1, 'paving'],
    ];
    for (const [r0, r1, mat] of segsR) {
      if (r1 <= r0) continue;
      const geo = stripGeometry([polar(a.theta, r0), polar(a.theta, r1)], a.width / 2, GROUND + 0.07, mat === 'paving' ? 3 : 5);
      g.mesh(mat, geo, { x: 0, y: 0, z: 0 }, { castShadow: false });
      geo.dispose();
    }
  }
  // Farm roads between the walls.
  for (const rd of FARM_ROADS) {
    const geo = stripGeometry(rd.points, rd.width / 2, GROUND + 0.06, 5);
    g.mesh(m.road, geo, { x: 0, y: 0, z: 0 }, { castShadow: false });
    geo.dispose();
  }
}

// ---------------------------------------------------------------------------
// Earthbent gate slabs (runtime)
// ---------------------------------------------------------------------------

export interface GateSlabDef {
  id: string;
  f: Frame;
  /** Offset of the slab along the passage axis (local Z of the gate frame). */
  lz: number;
  baseY: number;
  aw: number;
  spring: number;
  thick: number;
  /** Player distance that opens the gate. */
  openR: number;
}

interface SlabRt {
  d: GateSlabDef;
  mesh: THREE.Mesh;
  col: number;
  open: number;
  target: number;
  dustT: number;
  h: number;
  x: number;
  z: number;
}

/**
 * Stone slabs closing the gate tunnels. Royal Earthbender Guards "open" them:
 * the slab sinks into the ground (with dust and a grinding rumble) while the
 * player is near and rises again once they have moved on. Colliders are
 * dynamic (re-created each session; the world clears dynamic colliders).
 */
export class GateRuntime {
  readonly group = new THREE.Group();
  private readonly items: SlabRt[] = [];
  private readonly geos: THREE.BufferGeometry[] = [];
  private ctx: GameContext | null = null;

  constructor(parent: THREE.Group, private readonly bm: BssMats) {
    this.group.name = 'bss_gate_slabs';
    parent.add(this.group);
  }

  add(d: GateSlabDef): void {
    const geo = slabGeometry(d.aw - 0.15, d.spring, d.thick);
    this.geos.push(geo);
    const mesh = new THREE.Mesh(geo, this.bm.slab);
    const p = d.f.at(0, d.lz);
    mesh.position.set(p.x, d.baseY, p.z);
    mesh.rotation.y = d.f.yaw;
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.name = `slab_${d.id}`;
    // Emblem on both faces.
    const disc = new THREE.CircleGeometry(Math.min(d.aw * 0.22, 3.2), 28);
    this.geos.push(disc);
    for (const side of [1, -1]) {
      const em = new THREE.Mesh(disc, this.bm.emblem);
      em.position.set(0, d.spring * 0.72, side * (d.thick / 2 + 0.03));
      em.rotation.y = side > 0 ? 0 : Math.PI;
      mesh.add(em);
    }
    this.group.add(mesh);
    this.items.push({ d, mesh, col: 0, open: 0, target: 0, dustT: 0, h: d.spring + d.aw / 2, x: p.x, z: p.z });
  }

  get count(): number {
    return this.items.length;
  }

  onSessionStart(ctx: GameContext): void {
    this.ctx = ctx;
    for (const it of this.items) {
      it.col = ctx.world.collision.add(
        { shape: 'box', x: it.x, y: it.d.baseY + it.h / 2 - it.h * it.open, z: it.z, hx: it.d.aw / 2, hz: it.d.thick / 2 + 0.1, hy: it.h / 2, yaw: it.d.f.yaw, solid: true, walkable: false, tag: 'ba_sing_se' },
        true,
      );
    }
  }

  onSessionEnd(): void {
    if (this.ctx) for (const it of this.items) if (it.col) this.ctx.world.collision.remove(it.col);
    for (const it of this.items) it.col = 0;
    this.ctx = null;
  }

  /** Open (1) or close (0) a gate immediately (tests / cut-scenes). */
  set(id: string, open: number): boolean {
    const it = this.items.find((q) => q.d.id === id);
    if (!it) return false;
    it.open = it.target = open;
    this.place(it);
    return true;
  }

  state(): Array<{ id: string; open: number }> {
    return this.items.map((it) => ({ id: it.d.id, open: +it.open.toFixed(2) }));
  }

  update(dt: number, ctx: GameContext): void {
    const p = ctx.player?.position;
    if (!p) return;
    for (const it of this.items) {
      const d = Math.hypot(p.x - it.x, p.z - it.z);
      if (d < it.d.openR) it.target = 1;
      else if (d > it.d.openR + 16) it.target = 0;
      if (it.open === it.target) continue;
      const was = it.open;
      it.open = it.target > it.open ? Math.min(1, it.open + dt * 0.42) : Math.max(0, it.open - dt * 0.42);
      if (was === 0 || was === 1) {
        ctx.audio.play(it.target > 0 ? 'bend_earth_sink' : 'bend_earth_rise', { position: new THREE.Vector3(it.x, it.d.baseY + 2, it.z), volume: 0.9, pitch: 0.55 });
        if (d < 30) ctx.events.emit('camera:shake', { intensity: 0.05, duration: 0.5 });
      }
      it.dustT -= dt;
      if (it.dustT <= 0 && d < 160) {
        it.dustT = 0.12;
        for (const side of [-1, 1]) {
          const q = it.d.f.at((Math.random() - 0.5) * it.d.aw, it.d.lz + side * (it.d.thick / 2 + 0.6));
          ctx.vfx.burst('dust', new THREE.Vector3(q.x, it.d.baseY + 0.3, q.z), { count: 4, size: 1.4, radius: 0.8 });
        }
      }
      this.place(it);
    }
  }

  private place(it: SlabRt): void {
    const k = it.open * it.open * (3 - 2 * it.open);
    it.mesh.position.y = it.d.baseY - it.h * k - (k > 0.999 ? 0.2 : 0);
    it.mesh.visible = k < 0.995;
    if (this.ctx && it.col) this.ctx.world.collision.update(it.col, { y: it.d.baseY + it.h / 2 - it.h * k - (k > 0.97 ? 2 : 0) });
  }

  dispose(): void {
    this.onSessionEnd();
    for (const g of this.geos) g.dispose();
    this.geos.length = 0;
    this.group.removeFromParent();
    this.group.clear();
  }
}
