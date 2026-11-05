import * as THREE from 'three';
import { heightAt } from '../../../Heightfield';
import { capitalGreen } from '../../../landforms/fireCapital';
import { ROADS, type P2 } from '../../../WorldLayout';
import type { ArchetypeId } from '../../earth/archetypes';
import { CAUSEWAY, causewayPoint } from '../causeway';
import { crimsonMat, emberGlowMat } from '../materials';
import { bannerPole, brazier, hall, roof, stall, tree } from '../parts';
import type { Cap } from './FireCapital';
import { CONFIG, DISTRICTS, FNC, PLAZA, atAxis, atPolar, cityBlocked, footR, harborHalf, polarOf, ringR, sectorWeight, spokeBearings } from './layout';
import { drapedStrip, groundSpan, rng } from './kit';

/**
 * Harbor City: radial around the volcano — ring streets and spokes, the Royal Way up the axis
 * from the plaza's passage to the start of Sozin's road. Cream plaster houses of one to three
 * storeys with steep red roofs line every street (shops with awnings near the Royal Way and the
 * harbour); the foundry quarter smokes in the east, Zoryu Park spreads in the west, the north
 * and south hills are packed with houses on stone foundations.
 */

/** Split a polyline into runs that avoid blocked ground. */
export function openRuns(pts: P2[]): P2[][] {
  const out: P2[][] = [];
  let cur: P2[] = [];
  for (const p of pts) {
    if (cityBlocked(p.x, p.z)) {
      if (cur.length > 1) out.push(cur);
      cur = [];
    } else cur.push(p);
  }
  if (cur.length > 1) out.push(cur);
  return out;
}

/** Ring street k as a polyline across the city's sector. */
export function ringPolyline(k: number, step = 2): P2[] {
  const C = FNC.city;
  const pts: P2[] = [];
  for (let a = C.phi0; a <= C.phi1 + 0.01; a += step) pts.push(atPolar(a, ringR(k, a)));
  return pts;
}

/** Spoke street at bearing a (from the volcano's foot outward). */
export function spokePolyline(a: number): P2[] {
  const pts: P2[] = [];
  const r0 = footR(a) + 4, r1 = footR(a) + CONFIG.ringOffsets[CONFIG.ringOffsets.length - 1] + 70;
  for (let r = r0; r <= r1; r += 4) pts.push(atPolar(a, r));
  return pts;
}

/** The avenue from the Western Causeway's island end into the city (WorldLayout 'fire_causeway_road'). */
const AVENUE = ROADS.find((r) => r.id === 'fire_causeway_road')!;
/** Half-width of the ground kept clear along the bridge and the avenue (deck 10 m, the island gate's towers, a walk). */
const CORRIDOR_HALF = 10;
let corridorPts: P2[] | null = null;
let corridorBox = { x0: 0, x1: 0, z0: 0, z1: 0 };

/** Centreline of the bridge over the island (from well out over the strait) and the avenue, every 1.5 m. */
function corridor(): P2[] {
  if (corridorPts) return corridorPts;
  const pts: P2[] = [];
  for (let s = CAUSEWAY.len - 170; s < CAUSEWAY.len; s += 1.5) {
    const p = causewayPoint(s);
    pts.push({ x: p.x, z: p.z });
  }
  const av = AVENUE.points;
  for (let i = 0; i < av.length - 1; i++) {
    const a = av[i], b = av[i + 1];
    const L = Math.hypot(b.x - a.x, b.z - a.z);
    for (let d = 0; d < L; d += 1.5) pts.push({ x: a.x + ((b.x - a.x) * d) / L, z: a.z + ((b.z - a.z) * d) / L });
  }
  pts.push(av[av.length - 1]);
  corridorBox = { x0: Infinity, x1: -Infinity, z0: Infinity, z1: -Infinity };
  for (const p of pts) {
    corridorBox.x0 = Math.min(corridorBox.x0, p.x);
    corridorBox.x1 = Math.max(corridorBox.x1, p.x);
    corridorBox.z0 = Math.min(corridorBox.z0, p.z);
    corridorBox.z1 = Math.max(corridorBox.z1, p.z);
  }
  corridorPts = pts;
  return pts;
}

/**
 * True when a footprint (centre, width × depth, yaw as the houses use it) comes within `half` of the
 * Western Causeway's landing: the bridge deck over the island and the avenue on from its end. The
 * bridge lands inside Harbor City's outer rings, so the rows of houses must leave its way open.
 */
export function onCausewayLanding(x: number, z: number, w: number, d: number, yaw: number, half = CORRIDOR_HALF): boolean {
  const pts = corridor();
  const hw = w / 2, hd = d / 2;
  const reach = half + Math.hypot(hw, hd);
  const B = corridorBox;
  if (x < B.x0 - reach || x > B.x1 + reach || z < B.z0 - reach || z > B.z1 + reach) return false;
  const c = Math.cos(yaw), s = Math.sin(yaw);
  for (const p of pts) {
    const dx = p.x - x, dz = p.z - z;
    if (Math.abs(dx) > reach || Math.abs(dz) > reach) continue;
    // Into the footprint's frame: width along (cos yaw, −sin yaw), depth along (sin yaw, cos yaw).
    const lx = dx * c - dz * s, lz = dx * s + dz * c;
    const ex = Math.max(0, Math.abs(lx) - hw), ez = Math.max(0, Math.abs(lz) - hd);
    if (ex * ex + ez * ez < half * half) return true;
  }
  return false;
}

const inFoundries = (phi: number, r: number): boolean => {
  const D = DISTRICTS.foundries;
  return phi > D.phi0 && phi < D.phi1 && r > footR(phi) + 14 && r < footR(phi) + 214;
};
const inMarket = (x: number, z: number): boolean => {
  const s = z - FNC.V.z, t = Math.abs(x - FNC.V.x);
  return s > DISTRICTS.market.s0 && s < DISTRICTS.market.s1 && t < CONFIG.wayW / 2 + 9;
};

const WALL_TINTS = ['#f6eddc', '#efe2c8', '#e9d8b9', '#f2e6d0', '#e4d0ad', '#f8f0e2'];
const ROOF_TINTS = ['#a8302a', '#9b2620', '#b53b2c', '#8f241e', '#a62c24'];

export function* buildCity(cap: Cap): Generator<unknown, void, unknown> {
  const { env } = cap;
  const pave = 'paving' as const;
  // Ring streets.
  for (let k = 0; k < CONFIG.ringOffsets.length; k++) {
    const b = env.chunks.named('major', `fnc_ring${k}`).builder;
    for (const run of openRuns(ringPolyline(k))) drapedStrip(b, pave, run, CONFIG.ringW, { tile: 4 });
    yield;
  }
  // Spokes (the Royal Way is wider and built separately).
  {
    const b = env.chunks.named('major', 'fnc_spokes').builder;
    for (const a of spokeBearings()) {
      if (Math.abs(a - 90) < 1) continue;
      for (const run of openRuns(spokePolyline(a))) drapedStrip(b, pave, run, CONFIG.spokeW, { tile: 4 });
    }
    yield;
  }
  // The Royal Way.
  {
    const b = env.chunks.named('major', 'fnc_royal_way').builder;
    const pts: P2[] = [];
    for (let s = PLAZA.tower.topS + 1; s >= FNC.road.s0 + 8; s -= 4) pts.push(atAxis(0, s));
    drapedStrip(b, 'stone_tan', pts, CONFIG.wayW, { tile: 5, across: 6 });
    const top = atAxis(0, FNC.road.s0 + 8);
    cap.mark('royalWayTop', top.x, heightAt(top.x, top.z), top.z);
  }
  // The avenue from the Western Causeway's end (Harbor City's east gate) to the ring street; it sits
  // a touch above the street it joins so the two pavings never fight.
  {
    const b = env.chunks.named('major', 'fnc_east_road').builder;
    drapedStrip(b, pave, AVENUE.points, AVENUE.width, { tile: 4, lift: 0.09 });
    const g = AVENUE.points[0];
    cap.mark('eastGate', g.x, heightAt(g.x, g.z), g.z);
  }
  yield* houses(cap);
  yield* rimQuarters(cap);
  yield* market(cap);
  yield* foundries(cap);
  yield* park(cap);
}

/** Rows of houses along both sides of every ring street, then the outer hills. */
function* houses(cap: Cap): Generator<unknown, void, unknown> {
  const { env } = cap;
  const rnd = rng(CONFIG.seed ^ 0x5151);
  const A = env.arch;
  const spokes = spokeBearings();
  const pick = (ids: ArchetypeId[]) => A[ids[Math.floor(rnd() * ids.length)]];
  const shopIds: ArchetypeId[] = ['N3', 'N3b', 'N3b'];
  const homeIds: ArchetypeId[] = ['N1', 'N2', 'N2', 'N5', 'N7', 'N1'];
  const tallIds: ArchetypeId[] = ['N4', 'N8', 'N2', 'N7'];
  let count = 0;
  const C = FNC.city;

  const smallIds: ArchetypeId[] = ['N1', 'N5', 'N1', 'N2'];
  shopFronts.length = 0;
  /**
   * Place one house whose front lines a street: `edgeR` is the street edge radius, `side` +1 when
   * the house stands outside it (facing inward), -1 inside it (facing outward). Returns its width.
   */
  const place = (phi: number, edgeR: number, side: 1 | -1, kind: 'shop' | 'home' | 'tall' | 'small'): number => {
    const arch = pick(kind === 'shop' ? shopIds : kind === 'tall' ? tallIds : kind === 'small' ? smallIds : homeIds);
    const r = edgeR + side * (arch.spanD / 2 + 0.5);
    const inward = side > 0;
    const p = atPolar(phi, r);
    // Front faces the street the row lines.
    const yaw = inward ? Math.atan2(FNC.V.x - p.x, FNC.V.z - p.z) : Math.atan2(p.x - FNC.V.x, p.z - FNC.V.z);
    // The Western Causeway lands among the outer rows: its bridge and avenue stay open.
    if (onCausewayLanding(p.x, p.z, arch.spanW, arch.spanD, yaw)) return arch.spanW;
    const span = groundSpan(p.x, p.z, arch.spanW, arch.spanD, yaw);
    if (span.max - span.min > 4.5) return arch.spanW;
    for (const [lx, lz] of [[-0.5, -0.5], [0.5, -0.5], [-0.5, 0.5], [0.5, 0.5], [0, 0]] as const) {
      const c = Math.cos(yaw), sn = Math.sin(yaw);
      const qx = p.x + lx * arch.spanW * c + lz * arch.spanD * sn;
      const qz = p.z - lx * arch.spanW * sn + lz * arch.spanD * c;
      if (cityBlocked(qx, qz) || capitalGreen(qx, qz) || inMarket(qx, qz)) return arch.spanW;
      const q = polarOf(qx, qz);
      if (inFoundries(q.phi, q.r) || sectorWeight(q.phi) < 0.6) return arch.spanW;
      if (q.r < footR(q.phi) + 6) return arch.spanW;
      // Every corner clear of the spokes and the Royal Way.
      for (const a of spokes) {
        const half = (a === 90 ? CONFIG.wayW : CONFIG.spokeW) / 2 + 0.7;
        if (Math.abs(q.phi - a) * (Math.PI / 180) * q.r < half) return arch.spanW;
      }
    }
    const y = span.max;
    const tint = new THREE.Color(WALL_TINTS[Math.floor(rnd() * WALL_TINTS.length)]);
    const roofTint = new THREE.Color(ROOF_TINTS[Math.floor(rnd() * ROOF_TINTS.length)]);
    env.chunks.addHouse(arch, p.x, y, p.z, yaw, { tint, roofTint });
    if (kind === 'shop') {
      const f = arch.spanD / 2 + 1.1;
      shopFronts.push({ x: p.x + Math.sin(yaw) * f, z: p.z + Math.cos(yaw) * f, yaw: yaw + Math.PI, w: arch.spanW });
    }
    if (span.max - span.min > 0.35) {
      // Stone foundation down to the low side of the slope.
      const fb = env.chunks.at('houses', p.x, p.z).builder;
      fb.box('stone_tan', { x: p.x, y: (span.min - 0.4 + y) / 2, z: p.z, sx: arch.w + 0.3, sy: y - span.min + 0.4, sz: arch.d + 0.3, yaw });
    }
    count++;
    return arch.spanW;
  };

  /** March a row of houses along the arc, fronts on the edge of ring street k (or a lane at `lane`). */
  const row = (k: number, side: 1 | -1, lane = 0, kindFix?: 'small') => {
    for (let phi = C.phi0 + 1; phi < C.phi1 - 1; ) {
      const edgeR = ringR(k, phi) + side * (CONFIG.ringW / 2 + 0.4) + lane;
      const r = edgeR + side * 4;
      // Keep off the spokes (and the wider Royal Way).
      let nearSpoke = false;
      for (const a of spokes) {
        const half = (a === 90 ? CONFIG.wayW : CONFIG.spokeW) / 2 + 5.5;
        if (Math.abs(phi - a) * (Math.PI / 180) * r < half) nearSpoke = true;
      }
      if (nearSpoke) {
        phi += (1.2 / r) * (180 / Math.PI);
        continue;
      }
      const toWay = Math.abs(phi - 90) * (Math.PI / 180) * r;
      const kind: 'shop' | 'home' | 'tall' | 'small' = kindFix ?? (toWay < 70 || k === 0 ? (rnd() < 0.55 ? 'shop' : 'tall') : rnd() < 0.2 ? 'tall' : rnd() < 0.12 ? 'shop' : 'home');
      const w = place(phi, edgeR, side, kind);
      // Gaps: a lane now and then, otherwise near-continuous frontage.
      const gap = rnd() < 0.1 ? CONFIG.laneW + 0.5 : 0.15 + rnd() * 0.6;
      phi += ((w + gap) / r) * (180 / Math.PI);
    }
  };
  for (let k = 0; k < CONFIG.ringOffsets.length; k++) {
    row(k, 1);
    if (k > 0) row(k, -1);
    // Middle of the block: small houses facing a back alley behind the outer row.
    if (k < CONFIG.ringOffsets.length - 1) row(k, 1, 13.5, 'small');
    yield;
  }
  // Outer rows beyond the last ring (the hills above the plaza and the harbour).
  const last = CONFIG.ringOffsets.length - 1;
  for (const extra of [14, 26, 38, 50]) {
    for (let phi = C.phi0 + 1; phi < C.phi1 - 1; ) {
      const edgeR = ringR(last, phi) + CONFIG.ringW / 2 + extra - 6;
      const w = place(phi, edgeR, 1, rnd() < 0.25 ? 'tall' : 'home');
      const r = edgeR + 4;
      phi += ((w + 0.6 + rnd() * 1.2) / r) * (180 / Math.PI);
    }
    yield;
  }
  cap.mark('houses', count, 0, 0);
}

/**
 * The harbour quarters: the terraces above the plaza's cliffs and the harbour walls, packed with
 * cream-walled, red-roofed houses, shops and warehouses along three streets that follow the walls
 * down towards the sea (cross streets between them), watchtowers with braziers on the cliff edge,
 * banners at the corners. Harbor City climbing the slopes behind the plaza and the harbour.
 */
function* rimQuarters(cap: Cap): Generator<unknown, void, unknown> {
  const { env } = cap;
  const rnd = rng(CONFIG.seed ^ 0x7e11);
  const A = env.arch;
  rimStreets.length = 0;
  homeFronts.length = 0;
  const S0 = 552, S1 = 772;
  const STREETS = [10, 40, 70];
  const CROSS = [612, 672, 732];
  const edge = (s: number): number => (s < FNC.harbor.s0 - 8 ? FNC.plaza.valleyHalf + 10 : harborHalf(s) + FNC.harbor.quayW + 4);
  const ok = (x: number, z: number): boolean => !cityBlocked(x, z) && heightAt(x, z) > 4;
  const at = (side: number, o: number, s: number): P2 => atAxis(side * (edge(s) + o), s);
  let count = 0;
  for (const side of [-1, 1]) {
    const b = env.chunks.named('major', `fnc_rim${side > 0 ? 'E' : 'W'}`).builder;
    // Streets along the walls (they end where the land does), cross streets between them.
    for (const o of STREETS) {
      const pts: P2[] = [];
      for (let s = S0; s <= S1; s += 4) {
        const p = at(side, o, s);
        if (!ok(p.x, p.z)) break;
        pts.push(p);
      }
      if (pts.length > 2) {
        drapedStrip(b, 'paving', pts, 6, { tile: 4 });
        rimStreets.push(pts);
      }
    }
    for (const s of CROSS) {
      const pts: P2[] = [];
      for (const o of STREETS) {
        const p = at(side, o, s);
        if (ok(p.x, p.z)) pts.push(p);
      }
      if (pts.length > 1) {
        drapedStrip(b, 'paving', pts, 5, { tile: 4 });
        rimStreets.push(pts);
      }
    }
    yield;
    // Houses in four rows facing the streets: the cliff-side row, back-to-back rows along the
    // middle street, the outer row climbing the slope.
    const rows: Array<{ o: number; face: 1 | -1 }> = [{ o: 10, face: 1 }, { o: 40, face: -1 }, { o: 40, face: 1 }, { o: 70, face: 1 }];
    for (const row of rows) {
      for (let s = S0 + 3; s < S1 - 3; ) {
        if (CROSS.some((c) => Math.abs(c - s) < 5.5)) {
          s += 1.5;
          continue;
        }
        const r = rnd();
        const ids: ArchetypeId[] = r < 0.28 ? ['N3', 'N3b'] : r < 0.55 ? ['N4', 'N8', 'N2', 'N7'] : ['N1', 'N2', 'N5', 'N7'];
        const arch = A[ids[Math.floor(rnd() * ids.length)]];
        const p0 = at(side, row.o, s - 2), p1 = at(side, row.o, s + 2);
        const dl = Math.hypot(p1.x - p0.x, p1.z - p0.z) || 1;
        const dx = (p1.x - p0.x) / dl, dz = (p1.z - p0.z) / dl;
        // Outward normal (away from the plaza / harbour axis).
        let nx = dz, nz = -dx;
        if (Math.sign(nx) !== side) {
          nx = -nx;
          nz = -nz;
        }
        const st = at(side, row.o, s);
        const off = 3.5 + arch.spanD / 2;
        const c = { x: st.x + nx * row.face * off, z: st.z + nz * row.face * off };
        const yaw = Math.atan2(-nx * row.face, -nz * row.face);
        const step = (arch.spanW + 0.3 + rnd() * 0.8) * dz;
        s += Math.max(3, step);
        const span = groundSpan(c.x, c.z, arch.spanW, arch.spanD, yaw);
        if (span.max - span.min > 4.5) continue;
        let clear = true;
        const cs = Math.cos(yaw), sn = Math.sin(yaw);
        for (const [lx, lz] of [[-0.5, -0.5], [0.5, -0.5], [-0.5, 0.5], [0.5, 0.5], [0, 0]] as const) {
          const qx = c.x + lx * arch.spanW * cs + lz * arch.spanD * sn, qz = c.z - lx * arch.spanW * sn + lz * arch.spanD * cs;
          if (!ok(qx, qz) || capitalGreen(qx, qz)) clear = false;
        }
        if (!clear) continue;
        const y = span.max;
        env.chunks.addHouse(arch, c.x, y, c.z, yaw, { tint: new THREE.Color(WALL_TINTS[Math.floor(rnd() * WALL_TINTS.length)]), roofTint: new THREE.Color(ROOF_TINTS[Math.floor(rnd() * ROOF_TINTS.length)]) });
        if (span.max - span.min > 0.35) {
          const fb = env.chunks.at('houses', c.x, c.z).builder;
          fb.box('stone_tan', { x: c.x, y: (span.min - 0.4 + y) / 2, z: c.z, sx: arch.w + 0.3, sy: y - span.min + 0.4, sz: arch.d + 0.3, yaw });
        }
        const f = arch.spanD / 2 + 1.1;
        const door = { x: c.x + Math.sin(yaw) * f, z: c.z + Math.cos(yaw) * f, yaw: yaw + Math.PI };
        if (ids[0] === 'N3') shopFronts.push({ ...door, w: arch.spanW });
        else homeFronts.push(door);
        count++;
      }
      yield;
    }
    // Watchtowers on the cliff edge, banners and braziers at the street corners.
    const props = env.chunks.named('props', `fnc_rim_props${side > 0 ? 'E' : 'W'}`).builder;
    for (let s = S0 + 14; s < S1 - 10; s += 56) {
      const c = at(side, 3.2, s);
      if (!ok(c.x, c.z)) continue;
      const base = heightAt(c.x, c.z) - 0.5, top = base + 9;
      b.block('stone_dark', { x: c.x, y: base, z: c.z, sx: 4.4, sy: top - base, sz: 4.4 }, { collide: true, walkable: true });
      b.box(crimsonMat(), { x: c.x, y: top - 1.6, z: c.z, sx: 4.6, sy: 1.1, sz: 4.6 });
      roof(b, { x: c.x, y: top + 2.8, z: c.z, w: 3.4, d: 3.4, h: 2, style: 'pyramid', mat: 'roof_red', trim: 'gold', tips: 0.3, finial: 0.9 });
      for (const [px, pz] of [[-1.5, -1.5], [1.5, -1.5], [1.5, 1.5], [-1.5, 1.5]] as const) b.box('wood_red', { x: c.x + px, y: top + 1.4, z: c.z + pz, sx: 0.26, sy: 2.8, sz: 0.26 });
      brazier(b, cap.flames, { x: c.x, y: top, z: c.z, size: 0.6, style: 'bowl', collide: false });
    }
    for (const s of CROSS) {
      for (const o of STREETS) {
        const q = at(side, o + 3.6, s + 3.6);
        if (!ok(q.x, q.z)) continue;
        if ((o / 30 + s) % 2 < 1) bannerPole(props, { x: q.x, y: heightAt(q.x, q.z), z: q.z, yaw: 0, h: 6.5 });
        else brazier(props, cap.flames, { x: q.x, y: heightAt(q.x, q.z), z: q.z, size: 0.7, style: 'tripod', collide: false });
      }
    }
    yield;
  }
  cap.mark('rimHouses', count, 0, 0);
}

/** Royal Way market: stalls both sides, banners, braziers. */
function* market(cap: Cap): Generator<unknown, void, unknown> {
  const { env } = cap;
  const b = env.chunks.named('props', 'fnc_market').builder;
  const M = DISTRICTS.market;
  let seed = 31;
  marketStalls.length = 0;
  for (let s = M.s0 + 4; s < M.s1 - 2; s += 6.5) {
    for (const side of [-1, 1]) {
      const p = atAxis(side * (CONFIG.wayW / 2 + 2.2), s);
      const yaw = side < 0 ? Math.PI / 2 : -Math.PI / 2;
      stall(b, { x: p.x, y: heightAt(p.x, p.z), z: p.z, yaw, w: 4.2, seed: seed++ });
      marketStalls.push({ x: p.x, y: heightAt(p.x, p.z), z: p.z, yaw, w: 4.2, d: 2.6 });
    }
  }
  for (let s = M.s0; s <= M.s1; s += 23) {
    for (const side of [-1, 1]) {
      const p = atAxis(side * (CONFIG.wayW / 2 + 0.6), s);
      bannerPole(b, { x: p.x, y: heightAt(p.x, p.z), z: p.z, yaw: 0, h: 7 });
    }
  }
  const sq = atAxis(0, (M.s0 + M.s1) / 2);
  cap.mark('market', sq.x, heightAt(sq.x, sq.z), sq.z);
  yield;
}

/** Foundry quarter: smoking factory halls with furnace doors and tall stacks. */
function* foundries(cap: Cap): Generator<unknown, void, unknown> {
  const { env } = cap;
  const rnd = rng(CONFIG.seed ^ 0x2b1d);
  const D = DISTRICTS.foundries;
  const soot = sootMat();
  let n = 0;
  const stacks: Array<{ x: number; y: number; z: number }> = [];
  for (let k = 0; k < CONFIG.ringOffsets.length - 1; k++) {
    const r0 = (ringR(k, (D.phi0 + D.phi1) / 2) + ringR(k + 1, (D.phi0 + D.phi1) / 2)) / 2;
    for (let phi = D.phi0 + 3; phi < D.phi1 - 3; phi += (34 / r0) * (180 / Math.PI)) {
      const p = atPolar(phi, r0);
      if (cityBlocked(p.x, p.z)) continue;
      const b = env.chunks.at('major', p.x, p.z).builder;
      const yaw = Math.atan2(FNC.V.x - p.x, FNC.V.z - p.z);
      const span = groundSpan(p.x, p.z, 22, 16, yaw);
      const y = span.max;
      b.box('stone_dark', { x: p.x, y: (span.min - 0.5 + y) / 2, z: p.z, sx: 22.6, sy: y - span.min + 0.5, sz: 16.6, yaw });
      b.block(soot, { x: p.x, y, z: p.z, sx: 22, sy: 9, sz: 16, yaw }, { collide: true, walkable: true });
      roof(b, { x: p.x, y: y + 9, z: p.z, w: 22.6, d: 16.6, h: 3.6, yaw, style: 'gable', mat: 'roof_dark', trim: null, ridge: 'iron', overhang: 0.8, curve: 0.3 });
      // Glowing furnace doors on the street face.
      const c = Math.cos(yaw), sn = Math.sin(yaw);
      for (const lx of [-6, 0, 6]) {
        const fx = p.x + lx * c + 8.05 * sn, fz = p.z - lx * sn + 8.05 * c;
        b.box(emberGlowMat(), { x: fx, y: y + 1.9, z: fz, sx: 3, sy: 3.6, sz: 0.1, yaw });
        b.box('iron', { x: fx, y: y + 3.9, z: fz, sx: 3.6, sy: 0.35, sz: 0.25, yaw });
      }
      // Stacks.
      for (const lx of [-7.5, 7.5]) {
        if (rnd() < 0.25) continue;
        const sx = p.x + lx * c - 4 * sn, sz = p.z - lx * sn - 4 * c;
        const h = 22 + rnd() * 12;
        b.cylinder('stone_red', { x: sx, y, z: sz, r: 1.3, rTop: 1.0, h, segments: 10 }, { collide: true, walkable: false });
        b.cylinder('iron', { x: sx, y: y + h - 1.2, z: sz, r: 1.18, h: 1.2, segments: 10 });
        stacks.push({ x: sx, y: y + h, z: sz });
      }
      n++;
    }
    yield;
  }
  foundryStacks.length = 0;
  foundryStacks.push(...stacks);
  const f = atPolar((D.phi0 + D.phi1) / 2, footR((D.phi0 + D.phi1) / 2) + 110);
  cap.mark('foundry', f.x, heightAt(f.x, f.z), f.z);
  cap.mark('foundries', n, stacks.length, 0);
}

/** Smokestack tops (smoke columns in phase 5). */
export const foundryStacks: Array<{ x: number; y: number; z: number }> = [];
/** The harbour quarters' streets (polylines) and house doors, for the crowds' walking graph. */
export const rimStreets: P2[][] = [];
export const homeFronts: Array<{ x: number; z: number; yaw: number }> = [];

/** Shop fronts along the streets (a spot on the street before the door, facing it) for the crowds. */
export const shopFronts: Array<{ x: number; z: number; yaw: number; w: number }> = [];
/** Market stalls on the Royal Way (centre, facing the way) for sellers and the night covers. */
export const marketStalls: Array<{ x: number; y: number; z: number; yaw: number; w: number; d: number }> = [];

/** Zoryu Park: lawns, trees, ponds and pavilions in the west. */
function* park(cap: Cap): Generator<unknown, void, unknown> {
  const { env } = cap;
  const rnd = rng(CONFIG.seed ^ 0x9a7c);
  const P = DISTRICTS.park;
  const props = env.chunks.named('props', 'fnc_park').builder;
  let trees = 0;
  for (let i = 0; i < 220; i++) {
    const phi = P.phi0 + rnd() * (P.phi1 - P.phi0);
    const r = footR(phi) + P.rIn + rnd() * (P.rOut - P.rIn);
    const p = atPolar(phi, r);
    if (!capitalGreen(p.x, p.z) || cityBlocked(p.x, p.z)) continue;
    // Keep the streets clear.
    let onStreet = false;
    for (let k = 0; k < CONFIG.ringOffsets.length; k++) if (Math.abs(r - ringR(k, phi)) < CONFIG.ringW / 2 + 2.5) onStreet = true;
    if (onStreet) continue;
    const kind = rnd() < 0.45 ? 'maple' : rnd() < 0.6 ? 'willow' : 'pine';
    tree(props, kind, { x: p.x, y: heightAt(p.x, p.z) - 0.1, z: p.z, s: 6 + rnd() * 5, yaw: rnd() * 6, variant: i, collide: true });
    trees++;
  }
  // Pavilions by the pond and on the lawns.
  const b = env.chunks.named('major', 'fnc_park').builder;
  for (const [phi, dr] of [[150, 96], [142, 150], [160, 60]] as const) {
    const p = atPolar(phi, footR(phi) + dr);
    const y = heightAt(p.x, p.z);
    hall(b, { x: p.x, y: y + 0.4, z: p.z, yaw: Math.atan2(FNC.V.x - p.x, FNC.V.z - p.z), w: 7, d: 5, h: 3.4, veranda: 1.6, colSpacing: 2.6, roofMat: 'roof_red', lattice: false, doors: false, horns: 0.8 });
    b.block('stone_light', { x: p.x, y: y - 0.6, z: p.z, sx: 11, sy: 1, sz: 9 }, { collide: true, walkable: true });
    brazier(b, cap.flames, { x: p.x + 5, y, z: p.z + 4, size: 0.8, style: 'tripod' });
  }
  const pc = atPolar(152, footR(152) + 100);
  cap.mark('park', pc.x, heightAt(pc.x, pc.z), pc.z);
  cap.mark('parkTrees', trees, 0, 0);
  yield;
}

let soot: THREE.MeshStandardMaterial | null = null;
function sootMat(): THREE.MeshStandardMaterial {
  if (!soot) soot = new THREE.MeshStandardMaterial({ color: '#3a302c', roughness: 0.95 });
  return soot;
}
