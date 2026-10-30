import * as THREE from 'three';
import type { GameContext } from '../../../core/GameContext';
import type { ContentBuilder } from '../../kit/Builder';
import { AVENUES, GROUND, R, RAIL, RAIL_LINES, RING_STREETS, WALL, hash01, radiusOf, thetaOf, type RailLineDef } from './bssLayout';
import { medallion, sign, type BssMats, type MatKey, type PathSample, type RailPath } from './bssKit';
import { FigureRenderer, Pose } from './bssFigures';
import { railPath, type WallSite } from './bssWalls';

/**
 * Monorail infrastructure: arcaded stone viaducts (tall arches, emblem
 * medallions, walkable deck with two stone rails), stations with side
 * platforms, green-tiled roofs and a gatehouse, and lift towers worked by an
 * earthbender. Piers keep clear of avenues, ring streets, walls and other
 * lines (spans grow instead). Shuttle lines converge to one stub track at
 * their terminals so trains can reverse.
 */

export interface StationRt {
  id: string;
  name: string;
  cjk: string;
  line: RailLineDef;
  s: number;
  half: number;
  /** −1 / +1: terminal at the path start / end; 0: through station. */
  terminal: -1 | 0 | 1;
  deckY: number;
  /** Platform top height. */
  top: number;
  liftSide: 1 | -1 | 0;
  /** Lateral distance from the centre line to the inner platform edge. */
  inner: number;
}

const PLAT_TERMINAL = 38;
const PLAT_INNER_LOOP = 34;
const TAPER = [42, 62];

/** Lateral track offset of a train at arc length s moving in direction dir (shuttles converge at terminals). */
export function trackOffset(line: RailLineDef, path: RailPath, s: number, dir: 1 | -1): number {
  if (line.kind === 'loop') return RAIL.track;
  const dEnd = Math.min(s, path.total - s);
  const k = Math.min(1, Math.max(0, (dEnd - TAPER[0]) / (TAPER[1] - TAPER[0])));
  return dir * RAIL.track * k * k * (3 - 2 * k);
}

export function stationsOf(line: RailLineDef): StationRt[] {
  const path = railPath(line.id);
  const deckY = GROUND + line.deck;
  const out = line.stations.map((d, i): StationRt => {
    let terminal: -1 | 0 | 1 = 0;
    let s = path.nearest(d.at.x, d.at.z);
    let half = (line.id === 'inner_loop' ? PLAT_INNER_LOOP : RAIL.platformLen) / 2;
    if (line.kind === 'shuttle' && (i === 0 || i === line.stations.length - 1)) {
      terminal = i === 0 ? -1 : 1;
      half = PLAT_TERMINAL / 2;
      s = i === 0 ? half + 2 : path.total - half - 2;
    }
    return {
      id: d.id,
      name: d.name,
      cjk: d.cjk,
      line,
      s,
      half,
      terminal,
      deckY,
      top: deckY + 1.0,
      liftSide: d.stairs,
      inner: terminal ? RAIL.carW / 2 + 0.3 : RAIL.deckW / 2,
    };
  });
  return out.sort((a, b) => a.s - b.s);
}

const tmpS: PathSample = { x: 0, z: 0, tx: 1, tz: 0 };

/**
 * Spandrel over one span: a rectangle (span × height) with a circular-segment
 * arch of the given rise cut from its bottom (rise = span / 2 → semicircle).
 * Long spans get flatter segmental arches instead of impossible half-circles.
 */
function arcSpandrelGeometry(span: number, rise: number, height: number, depth: number, segs: number): THREE.BufferGeometry {
  const hs = span / 2;
  const R = (hs * hs + rise * rise) / (2 * rise);
  const cy = rise - R;
  const a0 = Math.atan2(-cy, -hs), a1 = Math.atan2(-cy, hs);
  const shape = new THREE.Shape();
  shape.moveTo(-hs, 0);
  for (let i = 1; i < segs; i++) {
    const a = a0 + ((a1 - a0) * i) / segs;
    shape.lineTo(Math.cos(a) * R, cy + Math.sin(a) * R);
  }
  shape.lineTo(hs, 0);
  shape.lineTo(hs, height);
  shape.lineTo(-hs, height);
  shape.closePath();
  const g = new THREE.ExtrudeGeometry(shape, { depth, bevelEnabled: false, steps: 1, curveSegments: segs });
  g.translate(0, 0, -depth / 2);
  return g;
}

// ---------------------------------------------------------------------------
// Ribbons (deck, parapets, rail beams) following a path
// ---------------------------------------------------------------------------

function ribbonBox(path: RailPath, s0: number, s1: number, off: (s: number) => number, halfW: number, y0: number, y1: number, step = 2): THREE.BufferGeometry {
  const pos: number[] = [], nrm: number[] = [], uv: number[] = [], idx: number[] = [];
  const n = Math.max(1, Math.ceil((s1 - s0) / step));
  const ring: Array<{ lx: number; lz: number; rx: number; rz: number; nx: number; nz: number; s: number }> = [];
  for (let i = 0; i <= n; i++) {
    const s = s0 + ((s1 - s0) * i) / n;
    const p = path.at(s, tmpS);
    const nx = -p.tz, nz = p.tx;
    const o = off(s);
    ring.push({ lx: p.x + nx * (o + halfW), lz: p.z + nz * (o + halfW), rx: p.x + nx * (o - halfW), rz: p.z + nz * (o - halfW), nx, nz, s });
  }
  const quad = (a: number[], b: number[], c: number[], d: number[], nn: number[], u0: number, u1: number, v0: number, v1: number) => {
    const base = pos.length / 3;
    pos.push(...a, ...b, ...c, ...d);
    for (let k = 0; k < 4; k++) nrm.push(...nn);
    uv.push(u0, v0, u1, v0, u1, v1, u0, v1);
    idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
  };
  for (let i = 0; i < n; i++) {
    const A = ring[i], B = ring[i + 1];
    const u0 = A.s / 3, u1 = B.s / 3;
    // Top (+Y), facing up: order L(A) → L(B) → R(B) → R(A) must be CCW seen from above.
    quad([A.rx, y1, A.rz], [B.rx, y1, B.rz], [B.lx, y1, B.lz], [A.lx, y1, A.lz], [0, 1, 0], u0, u1, 0, (halfW * 2) / 3);
    // Left side (+normal)
    quad([A.lx, y0, A.lz], [A.lx, y1, A.lz], [B.lx, y1, B.lz], [B.lx, y0, B.lz], [A.nx, 0, A.nz], 0, (y1 - y0) / 3, u0, u1);
    // Right side (−normal)
    quad([B.rx, y0, B.rz], [B.rx, y1, B.rz], [A.rx, y1, A.rz], [A.rx, y0, A.rz], [-A.nx, 0, -A.nz], 0, (y1 - y0) / 3, u1, u0);
  }
  // End caps (only meaningful for open ribbons).
  for (const [E, sgn] of [[ring[0], -1], [ring[n], 1]] as const) {
    const p = path.at(E.s, tmpS);
    quad([E.lx, y0, E.lz], [E.rx, y0, E.rz], [E.rx, y1, E.rz], [E.lx, y1, E.lz], [p.tx * sgn, 0, p.tz * sgn], 0, 1, 0, 1);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nrm, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.computeBoundingSphere();
  return g;
}

/** Fix winding so every face of a ribbon is front-facing from outside. */
function orient(g: THREE.BufferGeometry): THREE.BufferGeometry {
  const p = g.getAttribute('position') as THREE.BufferAttribute;
  const n = g.getAttribute('normal') as THREE.BufferAttribute;
  const idx = g.getIndex()!;
  const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3(), fn = new THREE.Vector3(), nn = new THREE.Vector3();
  for (let i = 0; i < idx.count; i += 3) {
    const ia = idx.getX(i), ib = idx.getX(i + 1), ic = idx.getX(i + 2);
    a.fromBufferAttribute(p, ia);
    b.fromBufferAttribute(p, ib);
    c.fromBufferAttribute(p, ic);
    fn.subVectors(b, a).cross(c.sub(a));
    nn.fromBufferAttribute(n, ia);
    if (fn.dot(nn) < 0) {
      idx.setX(i + 1, ic);
      idx.setX(i + 2, ib);
    }
  }
  idx.needsUpdate = true;
  return g;
}

function addRibbon(b: ContentBuilder, mat: MatKey, g: THREE.BufferGeometry, castShadow = true): void {
  b.mesh(mat, orient(g), { x: 0, y: 0, z: 0 }, { castShadow });
  g.dispose();
}

// ---------------------------------------------------------------------------
// Viaducts
// ---------------------------------------------------------------------------

interface Obstacle {
  test(x: number, z: number, tx: number, tz: number): boolean;
}

function roadObstacle(): Obstacle {
  return {
    test(x, z, tx, tz) {
      const nx = -tz, nz = tx;
      const r = radiusOf(x, z);
      const th = thetaOf(x, z);
      // Radial avenues: distance from the avenue axis vs the pier's extent across it.
      for (const a of AVENUES) {
        const d = Math.abs(Math.sin(th - a.theta)) * r;
        if (Math.cos(th - a.theta) < 0 || r < a.r0 - 6 || r > a.r1 + 6) continue;
        const mx = -Math.sin(a.theta), mz = Math.cos(a.theta);
        const e = (RAIL.pier / 2) * Math.abs(tx * mx + tz * mz) + (RAIL.deckW / 2) * Math.abs(nx * mx + nz * mz);
        if (d < a.width / 2 + e + 0.4) return true;
      }
      // Ring streets.
      const ux = Math.cos(th), uz = Math.sin(th);
      const er = (RAIL.pier / 2) * Math.abs(tx * ux + tz * uz) + (RAIL.deckW / 2) * Math.abs(nx * ux + nz * uz);
      for (const s of Object.values(RING_STREETS)) if (Math.abs(r - s.r) < s.width / 2 + er + 0.4) return true;
      return false;
    },
  };
}

/** Arc lengths where a path crosses the city walls (piers stay clear). */
function wallBlocks(path: RailPath): Array<[number, number]> {
  const out: Array<[number, number]> = [];
  for (const [r, half] of [[R.inner, WALL.inner.base / 2], [R.middle, WALL.ring.base / 2], [R.upper, WALL.ring.base / 2], [R.outer, WALL.outer.base / 2]] as const) {
    for (const c of path.crossings(r)) {
      const nr = Math.abs(c.tx * Math.cos(c.theta) + c.tz * Math.sin(c.theta));
      const m = (half + 2.5) / Math.max(0.3, nr) + RAIL.pier;
      out.push([c.s - m, c.s + m]);
    }
  }
  return out;
}

function otherLines(self: RailLineDef): Obstacle {
  const pts: Array<[number, number]> = [];
  for (const l of RAIL_LINES) {
    if (l === self) continue;
    const p = railPath(l.id);
    for (let i = 0; i < p.xs.length; i += 2) pts.push([p.xs[i], p.zs[i]]);
  }
  return {
    test(x, z) {
      for (const [px, pz] of pts) if ((px - x) * (px - x) + (pz - z) * (pz - z) < 13.5 * 13.5) return true;
      return false;
    },
  };
}

export interface ViaductStats {
  piers: number;
  spans: number;
}

function buildViaduct(site: WallSite, line: RailLineDef, path: RailPath, stations: StationRt[], stats: ViaductStats): void {
  const { env, bm } = site;
  const deckY = GROUND + line.deck;
  const under = deckY - 1.7;
  const hw = RAIL.deckW / 2;
  const chunk = (s: number) => env.chunks.named('major', `rail:${line.id}:${Math.floor(s / 110)}`).builder;
  const loop = line.kind === 'loop';
  const mod = RAIL.arch + RAIL.pier;
  const n = Math.max(1, Math.round(path.total / mod));
  const step = path.total / n;
  const blocks = wallBlocks(path);
  const roads = roadObstacle();
  const others = otherLines(line);
  // Pier positions.
  const piers: number[] = [];
  const start = loop ? 0 : 3;
  const end = loop ? path.total - step * 0.5 : path.total - 3;
  for (let s = start; s <= end; s += step) {
    let placed = -1;
    for (let k = 0; k <= 4 && placed < 0; k++) {
      const q = s + k * 1.5;
      if (!loop && q > path.total - 3) break;
      if (blocks.some(([a, b]) => q > a && q < b)) continue;
      const p = path.at(q, tmpS);
      if (roads.test(p.x, p.z, p.tx, p.tz)) continue;
      if (others.test(p.x, p.z, p.tx, p.tz)) continue;
      placed = q;
    }
    if (placed >= 0 && (!piers.length || placed - piers[piers.length - 1] > RAIL.pier + 2)) piers.push(placed);
  }
  // Abutments at shuttle ends (stub buffers).
  if (!loop) {
    piers.unshift(0);
    piers.push(path.total);
  }
  const pierAt = (s: number, len: number) => {
    const p = path.at(s, tmpS);
    const yaw = Math.atan2(-p.tz, p.tx);
    const b = chunk(s);
    const h = under - GROUND + 1;
    b.box(bm.ringStone, { x: p.x, y: GROUND - 1 + h / 2, z: p.z, sx: len, sy: h, sz: RAIL.deckW, yaw }, { collide: true, walkable: false });
    // Only the piers block buildings: streets and houses run beneath the arches.
    env.excl.box(p.x, p.z, len / 2 + 0.7, RAIL.deckW / 2 + 0.7, yaw);
    b.box('stone_tan', { x: p.x, y: GROUND + 1.0, z: p.z, sx: len + 0.7, sy: 2.0, sz: RAIL.deckW + 0.7, yaw });
    stats.piers++;
    return { p: { x: p.x, z: p.z }, yaw };
  };
  for (let i = 0; i < piers.length; i++) {
    const s = piers[i];
    const isEnd = !loop && (i === 0 || i === piers.length - 1);
    const len = isEnd ? 5 : RAIL.pier;
    const sc = isEnd ? (i === 0 ? 2.5 : path.total - 2.5) : s;
    const { yaw } = pierAt(sc, len);
    // Medallions on both faces of the spandrel wall above the pier.
    if (!isEnd && hash01(i, line.deck) < 0.85) {
      const p = path.at(sc, tmpS);
      for (const side of [1, -1]) {
        const x = p.x + -p.tz * side * (hw + 0.05), z = p.z + p.tx * side * (hw + 0.05);
        const faceYaw = Math.atan2(-p.tz * side, p.tx * side);
        medallion(chunk(sc), bm, x, under - 2.6, z, faceYaw, 1.05, 0.12, true);
      }
    }
    void yaw;
  }
  // Spans between consecutive piers (loops wrap around).
  const count = loop ? piers.length : piers.length - 1;
  for (let i = 0; i < count; i++) {
    const a = piers[i];
    let b = loop ? piers[(i + 1) % piers.length] : piers[i + 1];
    if (loop && b <= a) b += path.total;
    const ha = !loop && i === 0 ? 5 : RAIL.pier;
    const hb = !loop && i === count - 1 ? 5 : RAIL.pier;
    const sa = (!loop && i === 0 ? 2.5 : a) + ha / 2, sb = (!loop && i === count - 1 ? path.total - 2.5 : b) - hb / 2;
    const pa = path.at(sa, { x: 0, z: 0, tx: 1, tz: 0 }), pb = path.at(sb, { x: 0, z: 0, tx: 1, tz: 0 });
    const span = Math.hypot(pb.x - pa.x, pb.z - pa.z);
    if (span < 0.5) continue;
    // Semicircular arches where they fit; flatter segmental arches for long spans,
    // nearly flat ones where the span bridges another line (its trains pass below).
    const room = under - 1.0 - (GROUND + 3);
    const mid = path.at((sa + sb) / 2, { x: 0, z: 0, tx: 1, tz: 0 });
    const overLine = span > 16 && others.test(mid.x, mid.z, mid.tx, mid.tz);
    const rise = overLine ? Math.min(room, 2.5 + span * 0.025) : Math.min(span / 2, room);
    const radius = rise;
    const spring = under - 1.0 - rise;
    const height = under - spring;
    const g = arcSpandrelGeometry(span + 0.3, rise, height, RAIL.deckW, Math.min(24, Math.max(10, Math.round(span))));
    const yaw = Math.atan2(-(pb.z - pa.z), pb.x - pa.x);
    const b2 = chunk((sa + sb) / 2);
    b2.mesh(bm.ringStone, g, { x: (pa.x + pb.x) / 2, y: spring, z: (pa.z + pb.z) / 2, yaw });
    g.dispose();
    // Impost band where the arch springs.
    if (radius < 12) {
      for (const [q] of [[pa], [pb]] as const) {
        b2.box('stone_tan', { x: q.x, y: spring - 0.25, z: q.z, sx: 0.6, sy: 0.5, sz: RAIL.deckW + 0.5, yaw });
      }
    }
    stats.spans++;
  }
  // Deck, cornice, parapets, rail beams (in ~110 m pieces for culling).
  const pieceLen = 110;
  const nP = Math.max(1, Math.ceil(path.total / pieceLen));
  for (let k = 0; k < nP; k++) {
    const s0 = (path.total * k) / nP, s1 = (path.total * (k + 1)) / nP;
    const b = chunk((s0 + s1) / 2);
    addRibbon(b, 'paving', ribbonBox(path, s0, s1, () => 0, hw, under, deckY));
    addRibbon(b, 'stone_tan', ribbonBox(path, s0, s1, () => 0, hw + 0.35, under + 0.15, under + 0.75), false);
    for (const side of [1, -1]) {
      addRibbon(b, 'stone_light', ribbonBox(path, s0, s1, () => side * (hw - 0.22), 0.22, deckY, deckY + 0.8), false);
    }
    for (const dir of [1, -1] as const) {
      addRibbon(b, 'stone_grey', ribbonBox(path, s0, s1, (s) => trackOffset(line, path, s, dir), 0.45, deckY, deckY + 0.42), false);
      if (loop) break;
    }
    // Walkable deck + parapet colliders per chord.
    const nc = Math.max(1, Math.ceil((s1 - s0) / 8));
    for (let c = 0; c < nc; c++) {
      const ca = path.at(s0 + ((s1 - s0) * c) / nc, { x: 0, z: 0, tx: 1, tz: 0 });
      const cb = path.at(s0 + ((s1 - s0) * (c + 1)) / nc, { x: 0, z: 0, tx: 1, tz: 0 });
      const len = Math.hypot(cb.x - ca.x, cb.z - ca.z) + 0.3;
      const yaw = Math.atan2(-(cb.z - ca.z), cb.x - ca.x);
      const mx = (ca.x + cb.x) / 2, mz = (ca.z + cb.z) / 2;
      b.collider({ shape: 'box', x: mx, y: deckY - 0.85, z: mz, hx: len / 2, hz: hw, hy: 0.85, yaw, walkable: true, solid: true, surface: 'stone' });
      const nx = -(cb.z - ca.z) / Math.max(0.01, len - 0.3), nz = (cb.x - ca.x) / Math.max(0.01, len - 0.3);
      for (const side of [1, -1]) {
        if (stations.some((st) => Math.abs(path.wrap(s0 + ((s1 - s0) * (c + 0.5)) / nc) - st.s) < st.half + 1)) continue;
        b.collider({ shape: 'box', x: mx + nx * side * (hw - 0.22), y: deckY + 0.5, z: mz + nz * side * (hw - 0.22), hx: len / 2, hz: 0.22, hy: 0.5, yaw, walkable: false, solid: true });
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Stations
// ---------------------------------------------------------------------------

export interface LiftDef {
  id: string;
  station: string;
  x: number;
  z: number;
  y0: number;
  y1: number;
  yaw: number;
  /** Top landing edge (for the safety bar). */
  bar: { x: number; z: number; yaw: number };
}

function higherDeckOver(line: RailLineDef, x: number, z: number): boolean {
  for (const l of RAIL_LINES) {
    if (l === line || l.deck <= line.deck) continue;
    const p = railPath(l.id);
    const s = p.nearest(x, z);
    const q = p.at(s, { x: 0, z: 0, tx: 1, tz: 0 });
    if (Math.hypot(q.x - x, q.z - z) < RAIL.deckW / 2 + 9) return true;
  }
  return false;
}

function buildStation(site: WallSite, path: RailPath, st: StationRt, lifts: LiftDef[]): void {
  const { env, bm } = site;
  const b = env.chunks.named('major', `station:${st.id}`).builder;
  const top = st.top;
  const pw = RAIL.platformW;
  const outer = st.inner + pw;
  const pieces = Math.max(2, Math.round((st.half * 2) / 6));
  const len = (st.half * 2) / pieces;
  const liftS = st.s;
  for (let i = 0; i < pieces; i++) {
    const sm = st.s - st.half + (i + 0.5) * len;
    const p = path.at(sm, { x: 0, z: 0, tx: 1, tz: 0 });
    const yaw = Math.atan2(-p.tz, p.tx);
    const nx = -p.tz, nz = p.tx;
    for (const side of [1, -1]) {
      const lat = side * (st.inner + pw / 2);
      const x = p.x + nx * lat, z = p.z + nz * lat;
      b.box('paving', { x, y: top - 0.7, z, sx: len + 0.06, sy: 1.4, sz: pw, yaw }, { collide: true, walkable: true });
      b.box('stone_tan', { x: x + nx * side * 0.1, y: top - 1.55, z: z + nz * side * 0.1, sx: len + 0.06, sy: 0.4, sz: pw + 0.4, yaw });
      // Outer parapet (gap at the lift bridge).
      const atLift = side === st.liftSide && Math.abs(sm - liftS) < len * 0.75;
      const ox = p.x + nx * side * (outer + 0.15), oz = p.z + nz * side * (outer + 0.15);
      if (!atLift) b.box('stone_light', { x: ox, y: top + 0.5, z: oz, sx: len + 0.06, sy: 1.0, sz: 0.3, yaw }, { collide: true, walkable: false });
      // Columns.
      const cx = p.x + nx * side * (outer - 0.35), cz = p.z + nz * side * (outer - 0.35);
      b.box('wood_red', { x: cx, y: top + 2.4, z: cz, sx: 0.36, sy: 4.8, sz: 0.36, yaw });
      b.box('stone_tan', { x: cx, y: top + 0.2, z: cz, sx: 0.6, sy: 0.4, sz: 0.6, yaw });
      // Benches on through stations.
      if (!st.terminal && i % 3 === 1) b.box('wood_dark', { x: p.x + nx * side * (outer - 1.0), y: top + 0.45, z: p.z + nz * side * (outer - 1.0), sx: 2.4, sy: 0.12, sz: 0.5, yaw });
      // Hanging lanterns between columns.
      if (i % 2 === 0) b.lantern(new THREE.Vector3(cx, top + 4.1, cz), { color: 'warm', hanging: true });
    }
    // Roof piece (skipped under a higher deck, which shelters the platform).
    if (!higherDeckOver(st.line, p.x, p.z)) {
      b.box('plaster_cream', { x: p.x, y: top + 4.88, z: p.z, sx: len + 0.1, sy: 0.16, sz: outer * 2 + 0.4, yaw });
      b.roof('roof_green', { x: p.x, y: top + 4.98, z: p.z, w: len + 0.25, d: outer * 2 + 0.9, height: 1.5, yaw, overhang: 0.35, curve: 0.3, style: 'gable', ridge: null });
    }
  }
  // Gatehouse over the middle of the station: a raised second roof and the name boards.
  const pc = path.at(st.s, { x: 0, z: 0, tx: 1, tz: 0 });
  const yawC = Math.atan2(-pc.tz, pc.tx);
  if (!higherDeckOver(st.line, pc.x, pc.z)) {
    b.block('plaster_tan', { x: pc.x, y: top + 6.4, z: pc.z, sx: 11, sy: 2.6, sz: outer * 1.5, yaw: yawC });
    for (let k = -2; k <= 2; k++) {
      for (const sd of [1, -1]) {
        const q = { x: pc.x + pc.tx * k * 2.6 + -pc.tz * sd * (outer * 0.75 + 0.05), z: pc.z + pc.tz * k * 2.6 + pc.tx * sd * (outer * 0.75 + 0.05) };
        b.box('wood_red', { x: q.x, y: top + 7.7, z: q.z, sx: 0.35, sy: 2.6, sz: 0.25, yaw: yawC });
      }
    }
    b.roof('roof_green', { x: pc.x, y: top + 9.0, z: pc.z, w: 12.5, d: outer * 1.7, height: 3.2, yaw: yawC, overhang: 1.4, curve: 0.9, style: 'hip', ridge: 'roof_dark' });
    for (const sd of [1, -1]) {
      const q = { x: pc.x + pc.tx * sd * 5.6, z: pc.z + pc.tz * sd * 5.6 };
      const fy = Math.atan2(pc.tx * sd, pc.tz * sd);
      sign(b, bm, st.cjk, q.x, top + 6.6, q.z, fy, 1.3, { vertical: false });
    }
  }
  // Lift tower beside the platform.
  if (st.liftSide !== 0) {
    const sd = st.liftSide;
    const nx = -pc.tz, nz = pc.tx;
    const lx = pc.x + nx * sd * (outer + 3.4), lz = pc.z + nz * sd * (outer + 3.4);
    const H = top - GROUND + 4.8;
    const hwT = 2.8;
    for (const [ax, az] of [[1, 1], [1, -1], [-1, 1], [-1, -1]]) {
      const x = lx + pc.tx * ax * hwT + nx * az * hwT, z = lz + pc.tz * ax * hwT + nz * az * hwT;
      b.box(bm.ringStone, { x, y: GROUND + H / 2, z, sx: 0.9, sy: H, sz: 0.9, yaw: yawC }, { collide: true, walkable: false });
    }
    for (let y = GROUND + 8; y < top - 2; y += 8) {
      for (const [ax, az, sx, sz] of [[0, 1, 2 * hwT, 0.3], [0, -1, 2 * hwT, 0.3]] as const) {
        const x = lx + pc.tx * ax * hwT + nx * az * hwT, z = lz + pc.tz * ax * hwT + nz * az * hwT;
        b.box('wood_dark', { x, y, z, sx, sy: 0.35, sz, yaw: yawC });
      }
    }
    b.roof('roof_green', { x: lx, y: GROUND + H, z: lz, w: 7, d: 7, height: 2.6, yaw: yawC, overhang: 0.9, curve: 0.9, style: 'hip', ridge: null });
    medallion(b, bm, lx + nx * sd * (hwT + 0.5), GROUND + H - 2.2, lz + nz * sd * (hwT + 0.5), Math.atan2(nx * sd, nz * sd), 1.1, 0.15, true);
    // Bridge from the platform edge into the shaft.
    const bx = pc.x + nx * sd * (outer + 0.35), bz = pc.z + nz * sd * (outer + 0.35);
    b.box('paving', { x: bx, y: top - 0.25, z: bz, sx: 2.6, sy: 0.5, sz: 0.8, yaw: yawC }, { collide: true, walkable: true });
    for (const k of [-1, 1]) {
      const rx = bx + pc.tx * k * 1.4 + nx * sd * 0.6, rz = bz + pc.tz * k * 1.4 + nz * sd * 0.6;
      b.box('stone_light', { x: rx, y: top + 0.5, z: rz, sx: 0.25, sy: 1.0, sz: 2.2, yaw: yawC }, { collide: true, walkable: false });
    }
    // Ground plaza and a plaque.
    const plaza = new THREE.PlaneGeometry(9, 9);
    plaza.rotateX(-Math.PI / 2);
    b.mesh('paving', plaza, { x: lx, y: GROUND + 0.08, z: lz, yaw: yawC }, { castShadow: false });
    plaza.dispose();
    env.excl.circle(lx, lz, 6.5);
    lifts.push({ id: `lift_${st.id}`, station: st.id, x: lx, z: lz, y0: GROUND, y1: top, yaw: yawC, bar: { x: pc.x + nx * sd * (outer + 1.2), z: pc.z + nz * sd * (outer + 1.2), yaw: yawC } });
    site.mark(`lift_${st.id}`, lx, GROUND, lz);
  }
  site.mark(`station_${st.id}`, pc.x, top, pc.z);
}

/** Walkways joining neighbouring terminal platforms (arrival station, junction). */
function crossBridges(site: WallSite, sts: StationRt[]): void {
  const b = site.env.chunks.named('major', 'station_bridges').builder;
  const groups = new Map<string, StationRt[]>();
  for (const st of sts) {
    const key = st.id.split('_')[0];
    if (key !== 'arrival' && key !== 'y') continue;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(st);
  }
  for (const [, g] of groups) {
    const pts = g.map((st) => {
      const p = railPath(st.line.id).at(st.s, { x: 0, z: 0, tx: 1, tz: 0 });
      return { st, p };
    });
    for (let i = 0; i < pts.length; i++) {
      for (let j = i + 1; j < pts.length; j++) {
        const A = pts[i], B = pts[j];
        if (Math.abs(A.st.top - B.st.top) > 0.1) continue;
        const d = Math.hypot(B.p.x - A.p.x, B.p.z - A.p.z);
        if (d > 30) continue;
        const yaw = Math.atan2(-(B.p.z - A.p.z), B.p.x - A.p.x);
        const mx = (A.p.x + B.p.x) / 2, mz = (A.p.z + B.p.z) / 2;
        // Bridge at the platform ends nearest the wall (out of the trains' way at terminals: offset along the line).
        const off = A.st.terminal ? -A.st.terminal * (A.st.half - 1.5) : A.st.half - 1.5;
        const ox = A.p.x !== B.p.x || A.p.z !== B.p.z ? off : 0;
        const tA = railPath(A.st.line.id).at(A.st.s + ox, { x: 0, z: 0, tx: 1, tz: 0 });
        const tB = railPath(B.st.line.id).at(B.st.s + (B.st.terminal ? -B.st.terminal * (B.st.half - 1.5) : B.st.half - 1.5), { x: 0, z: 0, tx: 1, tz: 0 });
        const L = Math.hypot(tB.x - tA.x, tB.z - tA.z);
        const yw = Math.atan2(-(tB.z - tA.z), tB.x - tA.x);
        b.box('paving', { x: (tA.x + tB.x) / 2, y: A.st.top - 0.25, z: (tA.z + tB.z) / 2, sx: L, sy: 0.5, sz: 2.6, yaw: yw }, { collide: true, walkable: true });
        void yaw;
        void mx;
        void mz;
      }
    }
  }
}

export function buildRailways(site: WallSite): { stations: StationRt[]; lifts: LiftDef[]; stats: ViaductStats } {
  const stations: StationRt[] = [];
  const lifts: LiftDef[] = [];
  const stats: ViaductStats = { piers: 0, spans: 0 };
  for (const line of RAIL_LINES) {
    const path = railPath(line.id);
    const sts = stationsOf(line);
    stations.push(...sts);
    buildViaduct(site, line, path, sts, stats);
    for (const st of sts) buildStation(site, path, st, lifts);
  }
  crossBridges(site, stations);
  return { stations, lifts, stats };
}

// ---------------------------------------------------------------------------
// Lifts (runtime)
// ---------------------------------------------------------------------------

interface LiftRt {
  d: LiftDef;
  mesh: THREE.Mesh;
  col: number;
  bar: number;
  pos: number;
  target: number;
  wait: number;
  moving: boolean;
}

/**
 * Station lifts: a stone disc raised and lowered by an earthbender. Step on it
 * (or wait at a landing to call it); the disc moves at most ~0.33 m per frame
 * so the player always stays on it. A bar closes the top landing while the
 * disc is away.
 */
export class LiftRuntime {
  readonly group = new THREE.Group();
  private readonly items: LiftRt[] = [];
  private readonly geo: THREE.BufferGeometry;
  private ctx: GameContext | null = null;

  constructor(parent: THREE.Group, defs: LiftDef[], private readonly bm: BssMats) {
    this.group.name = 'bss_lifts';
    parent.add(this.group);
    this.geo = new THREE.CylinderGeometry(1.75, 1.75, 0.5, 20);
    for (const d of defs) {
      const mesh = new THREE.Mesh(this.geo, this.bm.slab);
      mesh.position.set(d.x, d.y0 - 0.25, d.z);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      this.group.add(mesh);
      this.items.push({ d, mesh, col: 0, bar: 0, pos: 0, target: 0, wait: 0, moving: false });
    }
  }

  get count(): number {
    return this.items.length;
  }

  onSessionStart(ctx: GameContext): void {
    this.ctx = ctx;
    for (const it of this.items) {
      const y = it.d.y0 + (it.d.y1 - it.d.y0) * it.pos;
      it.col = ctx.world.collision.add({ shape: 'box', x: it.d.x, y: y - 0.25, z: it.d.z, hx: 1.75, hz: 1.75, hy: 0.25, yaw: it.d.yaw, walkable: true, solid: true, surface: 'stone', tag: 'ba_sing_se' }, true);
      it.bar = ctx.world.collision.add({ shape: 'box', x: it.d.bar.x, y: it.d.y1 + (it.pos > 0.99 ? -5 : 0.6), z: it.d.bar.z, hx: 1.4, hz: 0.15, hy: 0.6, yaw: it.d.bar.yaw, walkable: false, solid: true, tag: 'ba_sing_se' }, true);
    }
  }

  onSessionEnd(): void {
    if (this.ctx) for (const it of this.items) {
      if (it.col) this.ctx.world.collision.remove(it.col);
      if (it.bar) this.ctx.world.collision.remove(it.bar);
    }
    for (const it of this.items) it.col = it.bar = 0;
    this.ctx = null;
  }

  state(): Array<{ id: string; pos: number }> {
    return this.items.map((it) => ({ id: it.d.id, pos: +it.pos.toFixed(2) }));
  }

  /** Send a lift to the top (1) or bottom (0) (tests). */
  call(id: string, to: number): boolean {
    const it = this.items.find((q) => q.d.id === id || q.d.station === id);
    if (!it) return false;
    it.target = to;
    return true;
  }

  update(dt: number, ctx: GameContext, figures: FigureRenderer | null): void {
    const p = ctx.player?.position;
    for (const it of this.items) {
      const d = it.d;
      const span = d.y1 - d.y0;
      const discY = d.y0 + span * it.pos;
      if (p) {
        const h = Math.hypot(p.x - d.x, p.z - d.z);
        const near = h < 7;
        if (near && !it.moving) {
          const onDisc = h < 1.6 && Math.abs(p.y - discY) < 0.7;
          if (onDisc) {
            it.wait += dt;
            if (it.wait > 0.5) it.target = it.pos < 0.5 ? 1 : 0;
          } else {
            it.wait = 0;
            if (h < 4.2 && Math.abs(p.y - d.y0) < 1.8 && it.pos > 0.99) it.target = 0;
            if (Math.hypot(p.x - d.bar.x, p.z - d.bar.z) < 4 && Math.abs(p.y - d.y1) < 1.8 && it.pos < 0.01) it.target = 1;
          }
        }
      }
      if (it.target !== it.pos) {
        if (!it.moving) {
          it.moving = true;
          ctx.audio.play('bend_earth_rise', { position: new THREE.Vector3(d.x, discY, d.z), volume: 0.6, pitch: 0.7 });
        }
        const speed = Math.min(5.5, 0.33 / Math.max(dt, 1 / 120));
        const dp = (speed * dt) / span;
        it.pos = it.target > it.pos ? Math.min(it.target, it.pos + dp) : Math.max(it.target, it.pos - dp);
        if (it.pos === it.target) {
          it.moving = false;
          it.wait = 0;
          ctx.vfx.burst('dust', new THREE.Vector3(d.x, d.y0 + span * it.pos, d.z), { count: 8, size: 1.2, radius: 1.4 });
        }
      }
      const y = d.y0 + span * it.pos;
      it.mesh.position.y = y - 0.25;
      if (this.ctx && it.col) this.ctx.world.collision.update(it.col, { y: y - 0.25 });
      if (this.ctx && it.bar) this.ctx.world.collision.update(it.bar, { y: it.pos > 0.99 ? d.y1 - 5 : d.y1 + 0.6 });
      // The lift operator works the stone from the bottom landing.
      if (figures) {
        const ox = d.x + Math.cos(d.yaw) * 3.6, oz = d.z - Math.sin(d.yaw) * 3.6;
        figures.push(ox, d.y0, oz, d.yaw + Math.PI / 2, it.moving ? Pose.raise : Pose.idle, ctx.time.elapsed * 2, it.moving ? 1 : 0, 0, 0x3d5a34, 0x8a7a55, 0xc79a72, 0);
      }
    }
  }

  dispose(): void {
    this.onSessionEnd();
    this.geo.dispose();
    this.group.removeFromParent();
    this.group.clear();
  }
}
