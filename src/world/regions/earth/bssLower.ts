import * as THREE from 'three';
import type { ContentBuilder } from '../../kit/Builder';
import type { P2 } from '../../WorldLayout';
import type { ArchetypeId } from './archetypes';
import { stripGeometry } from './geom';
import { crates, figureStatue, lanternPost, lanternString, laundry, marketStall, planter, tree } from './parts';
import { AVENUES, BSS, GROUND, LOWER_LANES, RING_STREETS, STREET, hash01, polar, thetaOf } from './bssLayout';
import { sign, type BssMats } from './bssKit';
import { NavGraph, NavTag } from './bssNav';
import { marketStalls, squareStalls } from './spots';
import type { WallSite } from './bssWalls';

/**
 * Lower Ring: the densest, poorest ring. Concentric muddy streets and back
 * alleys cut by radial lanes; small one-to-three storey plaster houses with
 * black and dark-brown tile roofs packed shoulder to shoulder (also under the
 * outer loop arches against the Inner Wall); laundry lines, tarps, crates,
 * puddles; workshops, noodle stalls, tea houses, the Pao Family Tea House, a
 * factory with smoking chimneys beside the trunk viaducts, the market street,
 * a stable, and the Firelight Fountain square (the Earth start).
 */

export interface WaterOpts {
  id: string;
  label: string;
  x: number;
  z: number;
  y: number;
  w: number;
  d: number;
  circle?: boolean;
  yaw?: number;
  /** Surface material (an invisible one registers water drawn elsewhere, e.g. merged canal strips). */
  material?: THREE.Material;
  capacity?: number;
  regen?: number;
  type?: 'pond' | 'canal' | 'fountain' | 'puddle' | 'lake';
}

export interface DistrictSite extends WallSite {
  nav: NavGraph;
  water(b: ContentBuilder, o: WaterOpts): THREE.Mesh;
  /** Chimney / stall emitters (spawned near the camera by the region). */
  smoke: Array<{ x: number; y: number; z: number; rate: number; steam?: boolean }>;
  /** Station lift towers (filled in once the railways are built). */
  lifts: Array<{ id: string; station: string; x: number; z: number }>;
  /** Shop fronts (door point on the street, facing yaw, width, façade set-back) for shutters and sweepers. */
  shops: Array<{ x: number; z: number; yaw: number; w: number; off: number }>;
  /** Market stalls (centre, facing yaw, width, depth) for night tarps and stall keepers. */
  stalls: Array<{ x: number; z: number; yaw: number; w: number; d: number }>;
}

// ---------------------------------------------------------------------------
// Shared row filler (also used by the Middle and Upper Rings)
// ---------------------------------------------------------------------------

export interface RingRow {
  key: string;
  /** Radius of the street-side edge of the lots. */
  rFront: number;
  /** −1: fronts face the palace (lots extend outward); +1: fronts face away (lots extend inward). */
  facing: -1 | 1;
  maxDepth: number;
  t0?: number;
  t1?: number;
  types: Array<[ArchetypeId, number]>;
  roofs: THREE.Color[];
  walls: THREE.Color[];
  scale: [number, number];
  gap: [number, number];
  vacancy: number;
  tag: number;
  maxWidth?: number;
}

export interface PlacedHouse {
  x: number;
  z: number;
  yaw: number;
  theta: number;
  id: ArchetypeId;
  w: number;
  d: number;
  /** Door point on the street edge. */
  door: P2;
}

function pick<T>(items: Array<[T, number]>, u: number): T {
  let total = 0;
  for (const [, w] of items) total += w;
  let x = u * total;
  for (const [v, w] of items) {
    x -= w;
    if (x <= 0) return v;
  }
  return items[items.length - 1][0];
}

export function fillRing(site: DistrictSite, row: RingRow): PlacedHouse[] {
  const { env, nav } = site;
  const out: PlacedHouse[] = [];
  const t0 = row.t0 ?? 0, t1 = row.t1 ?? Math.PI * 2;
  let t = t0;
  let k = 0;
  const seed = Math.round(row.rFront * 10);
  while (t < t1) {
    k++;
    const u = hash01(seed, k, 1);
    let id = pick(row.types, u);
    let arch = env.arch[id];
    const s = row.scale[0] + (row.scale[1] - row.scale[0]) * hash01(seed, k, 2);
    let depth = (arch.d + arch.front) * s;
    if (depth > row.maxDepth || (row.maxWidth && arch.w * s > row.maxWidth)) {
      // Fall back to the smallest type that fits.
      const fit = row.types.map(([q]) => q).find((q) => (env.arch[q].d + env.arch[q].front) * s <= row.maxDepth && (!row.maxWidth || env.arch[q].w * s <= row.maxWidth));
      if (!fit) {
        t += 1.5 / row.rFront;
        continue;
      }
      id = fit;
      arch = env.arch[id];
      depth = (arch.d + arch.front) * s;
    }
    const w = arch.w * s;
    const dt = w / row.rFront;
    const tc = t + dt / 2;
    if (tc + dt / 2 > t1) break;
    // Irregular setbacks and slight skews keep the rows from looking drawn with a compass.
    const setback = hash01(seed, k, 7) * Math.max(0, Math.min(0.9, row.maxDepth - depth));
    const ro = row.rFront - row.facing * ((arch.d / 2 + arch.front) * s + setback);
    const p = polar(tc, ro);
    const fx = row.facing < 0 ? -Math.cos(tc) : Math.cos(tc), fz = row.facing < 0 ? -Math.sin(tc) : Math.sin(tc);
    const yaw = Math.atan2(fx, fz) + (hash01(seed, k, 8) - 0.5) * 0.09;
    // Footprint incl. the awning / porch in front.
    const cx = p.x + fx * (arch.front * s) / 2, cz = p.z + fz * (arch.front * s) / 2;
    const hw = w / 2 + 0.1, hd = depth / 2 + 0.05;
    if (env.excl.rectBlocked(cx, cz, hw, hd, yaw, 0.1)) {
      t += 0.5 / row.rFront;
      continue;
    }
    if (hash01(seed, k, 3) < row.vacancy) {
      t += (w * 0.6) / row.rFront;
      continue;
    }
    const roof = row.roofs[Math.floor(hash01(seed, k, 4) * row.roofs.length)];
    const wall = row.walls[Math.floor(hash01(seed, k, 5) * row.walls.length)];
    env.chunks.addHouse(arch, p.x, GROUND, p.z, yaw, { scale: s, tint: wall, roofTint: roof });
    env.excl.box(cx, cz, hw, hd, yaw);
    const door = polar(tc, row.rFront - row.facing * -0.6);
    const tag = row.tag | (id === 'N3' || id === 'N3b' ? NavTag.shop : NavTag.home);
    if (id === 'N3' || id === 'N3b') site.shops.push({ x: door.x, z: door.z, yaw, w, off: 0.6 + arch.front * s });
    nav.poi(door.x, door.z, tag, Math.atan2(-fx, -fz));
    out.push({ x: p.x, z: p.z, yaw, theta: tc, id, w, d: depth, door });
    const gap = row.gap[0] + (row.gap[1] - row.gap[0]) * hash01(seed, k, 6);
    t += (w + gap) / row.rFront;
  }
  return out;
}

/** Ring street as nav + exclusion (polyline around a circle, optionally an angular range). */
export function ringStreet(site: DistrictSite, r: number, width: number, tag: number, t0 = 0, t1 = Math.PI * 2): void {
  const n = Math.max(8, Math.ceil(((t1 - t0) * r) / 8));
  const pts: P2[] = [];
  for (let i = 0; i <= n; i++) pts.push(polar(t0 + ((t1 - t0) * i) / n, r));
  site.env.excl.polyline(pts, width / 2);
  site.nav.street(pts, tag | NavTag.street, 9, 3);
}

// ---------------------------------------------------------------------------
// Lower Ring
// ---------------------------------------------------------------------------

const ROOFS_LOWER = [new THREE.Color(0.31, 0.27, 0.24), new THREE.Color(0.23, 0.21, 0.2), new THREE.Color(0.37, 0.3, 0.25), new THREE.Color(0.27, 0.24, 0.21), new THREE.Color(0.42, 0.33, 0.26)];
const WALLS_LOWER = [new THREE.Color(0.93, 0.88, 0.82), new THREE.Color(0.84, 0.79, 0.72), new THREE.Color(0.98, 0.95, 0.9), new THREE.Color(0.78, 0.74, 0.68), new THREE.Color(0.9, 0.84, 0.74)];
const LOWER_TYPES: Array<[ArchetypeId, number]> = [['N1', 30], ['N2', 22], ['N3', 8], ['N3b', 7], ['N4', 8], ['N5', 10]];

interface Lane {
  theta: number;
  r0: number;
  r1: number;
  w: number;
}

function nearAvenue(theta: number, r: number, margin: number): boolean {
  for (const a of AVENUES) {
    const d = Math.abs(Math.sin(theta - a.theta)) * r;
    if (Math.cos(theta - a.theta) > 0 && d < a.width / 2 + margin) return true;
  }
  return false;
}

export function* buildLowerRing(site: DistrictSite): Generator<unknown, void, unknown> {
  const { env, bm, nav } = site;
  const LW = NavTag.lower;
  const rIn = RING_STREETS.lowerIn, rMid = RING_STREETS.lowerMid;
  const [lane1, lane2] = LOWER_LANES;
  const sq = BSS.square;
  // ---- Landmark clearings first (rows fill around them).
  env.excl.rect(sq.x - sq.hw, sq.z - sq.hd, sq.x + sq.hw, sq.z + sq.hd);
  const mk = BSS.market;
  {
    const n = Math.ceil(((mk.t1 - mk.t0) * mk.r) / 6);
    const pts: P2[] = [];
    for (let i = 0; i <= n; i++) pts.push(polar(mk.t0 + ((mk.t1 - mk.t0) * i) / n, mk.r));
    env.excl.polyline(pts, mk.width / 2);
  }
  env.excl.box(BSS.paoTea.x, BSS.paoTea.z, 8.5, 6.5, 0);
  const fT = thetaOf(BSS.factory.x, BSS.factory.z);
  env.excl.box(BSS.factory.x, BSS.factory.z, 14, 6, Math.atan2(Math.cos(fT), Math.sin(fT)));
  const stT = thetaOf(BSS.stable.x, BSS.stable.z);
  env.excl.box(BSS.stable.x, BSS.stable.z, 7.5, 4.5, Math.atan2(Math.cos(stT), Math.sin(stT)));
  // ---- Streets: ring roads, back lanes, avenues, radial lanes.
  ringStreet(site, rIn.r, rIn.width, LW);
  ringStreet(site, rMid.r, rMid.width, LW);
  for (const l of LOWER_LANES) ringStreet(site, l.r, l.width, LW);
  // Strip along the 中環 wall foot (vendors' walkway).
  ringStreet(site, 176, 3.2, LW);
  for (const a of AVENUES) {
    const r0 = 172, r1 = 240;
    const pts = [polar(a.theta, r0), polar(a.theta, r1)];
    env.excl.seg(pts[0].x, pts[0].z, pts[1].x, pts[1].z, a.width / 2 + 0.6);
    nav.street(pts, LW | NavTag.street, 9, 5);
  }
  const lanes: Lane[] = [];
  {
    let t = 0.04;
    let i = 0;
    while (t < Math.PI * 2 - 0.05) {
      i++;
      const u = hash01(i, 77);
      t += (22 + u * 12) / 205;
      if (nearAvenue(t, 205, 8)) continue;
      const kind = hash01(i, 78);
      const w = hash01(i, 79) < 0.7 ? STREET.lane : STREET.alley;
      const r0 = kind < 0.7 ? rIn.r + rIn.width / 2 - 0.2 : rMid.r;
      const r1 = kind < 0.42 ? lane2.r : kind < 0.7 ? rMid.r : lane2.r;
      lanes.push({ theta: t + (hash01(i, 80) - 0.5) * 0.02, r0, r1, w });
    }
  }
  const gb = env.chunks.named('major', 'lower_lanes').builder;
  for (const l of lanes) {
    const a = polar(l.theta, l.r0), b = polar(l.theta, l.r1);
    env.excl.seg(a.x, a.z, b.x, b.z, l.w / 2 + 0.2);
    const geo = stripGeometry([a, b], l.w / 2, GROUND + 0.055, 5);
    gb.mesh(bm.mudTrack, geo, { x: 0, y: 0, z: 0 }, { castShadow: false });
    geo.dispose();
    nav.street([a, b], LW | NavTag.street, 8, 4);
    for (const rr of [rIn.r, lane1.r, rMid.r, lane2.r]) if (rr > l.r0 - 1 && rr < l.r1 + 1) {
      const p = polar(l.theta, rr);
      nav.join(p.x, p.z, 6);
    }
  }
  yield;
  // ---- Firelight Fountain square.
  buildSquare(site);
  yield;
  buildPaoTeaHouse(site);
  buildFactory(site);
  buildStable(site);
  buildMarket(site);
  yield;
  // ---- House rows.
  const rows: RingRow[] = [
    { key: 'R1', rFront: rIn.r + rIn.width / 2 + 0.45, facing: -1, maxDepth: lane1.r - lane1.width / 2 - (rIn.r + rIn.width / 2) - 0.6, types: LOWER_TYPES, roofs: ROOFS_LOWER, walls: WALLS_LOWER, scale: [0.88, 1.08], gap: [0, 0.7], vacancy: 0.05, tag: LW },
    { key: 'R2', rFront: rMid.r - rMid.width / 2 - 0.45, facing: 1, maxDepth: rMid.r - rMid.width / 2 - (lane1.r + lane1.width / 2) - 0.6, types: LOWER_TYPES, roofs: ROOFS_LOWER, walls: WALLS_LOWER, scale: [0.88, 1.08], gap: [0, 0.7], vacancy: 0.05, tag: LW },
    { key: 'R2m', rFront: mk.r - mk.width / 2 - 0.45, facing: 1, maxDepth: mk.r - mk.width / 2 - (lane1.r + lane1.width / 2) - 0.5, t0: mk.t0, t1: mk.t1, types: [['N3', 4], ['N3b', 4], ['N1', 2]], roofs: ROOFS_LOWER, walls: WALLS_LOWER, scale: [0.85, 0.95], gap: [0, 0.4], vacancy: 0, tag: LW },
    { key: 'R3', rFront: rMid.r + rMid.width / 2 + 0.45, facing: -1, maxDepth: lane2.r - lane2.width / 2 - (rMid.r + rMid.width / 2) - 0.5, types: LOWER_TYPES, roofs: ROOFS_LOWER, walls: WALLS_LOWER, scale: [0.85, 1.0], gap: [0, 0.6], vacancy: 0.06, tag: LW },
    { key: 'R4', rFront: lane2.r + lane2.width / 2 + 0.45, facing: -1, maxDepth: 236.6 - (lane2.r + lane2.width / 2) - 0.3, types: [['N1', 4], ['N2', 4], ['N4', 1], ['N5', 1]], roofs: ROOFS_LOWER, walls: WALLS_LOWER, scale: [0.85, 0.98], gap: [0.2, 1.2], vacancy: 0.08, tag: LW, maxWidth: 6.3 },
  ];
  const placed: PlacedHouse[] = [];
  for (const row of rows) {
    placed.push(...fillRing(site, row));
    yield;
  }
  site.mark('lowerHouses', placed.length, GROUND, 0);
  // ---- Character: workshops, tea houses, noodle stalls, clutter.
  dressLower(site, placed, lanes);
  yield;
}

// ---------------------------------------------------------------------------
// Square + Firelight Fountain
// ---------------------------------------------------------------------------

function buildSquare(site: DistrictSite): void {
  const { env, bm, nav } = site;
  const sq = BSS.square;
  const b = env.chunks.named('props', 'bss_square').builder;
  const bm2 = env.chunks.named('major', 'bss_square_floor').builder;
  const floor = new THREE.PlaneGeometry(sq.hw * 2, sq.hd * 2);
  floor.rotateX(-Math.PI / 2);
  bm2.mesh(env.mats.groundMiddle, floor, { x: sq.x, y: GROUND + 0.06, z: sq.z }, { castShadow: false });
  floor.dispose();
  // Kerb.
  for (const [x, z, sx, sz] of [[sq.x, sq.z - sq.hd, sq.hw * 2, 0.4], [sq.x, sq.z + sq.hd, sq.hw * 2, 0.4], [sq.x - sq.hw, sq.z, 0.4, sq.hd * 2], [sq.x + sq.hw, sq.z, 0.4, sq.hd * 2]]) {
    bm2.box('stone_tan', { x, y: GROUND + 0.1, z, sx, sy: 0.2, sz }, { castShadow: false });
  }
  const f = BSS.fountain;
  const fy = GROUND;
  // Basin rim (octagon of stone blocks) and floor.
  const segs = 16;
  for (let i = 0; i < segs; i++) {
    const a = (i / segs) * Math.PI * 2, a2 = ((i + 1) / segs) * Math.PI * 2;
    const p1 = { x: f.x + Math.cos(a) * f.r, z: f.z + Math.sin(a) * f.r }, p2 = { x: f.x + Math.cos(a2) * f.r, z: f.z + Math.sin(a2) * f.r };
    const len = Math.hypot(p2.x - p1.x, p2.z - p1.z) + 0.15;
    const yaw = Math.atan2(-(p2.z - p1.z), p2.x - p1.x);
    b.box('stone_light', { x: (p1.x + p2.x) / 2, y: fy + 0.35, z: (p1.z + p2.z) / 2, sx: len, sy: 0.7, sz: 0.75, yaw }, { collide: true, walkable: true });
  }
  b.cylinder('stone_grey', { x: f.x, y: fy + 0.05, z: f.z, r: f.r - 0.2, h: 0.1, segments: 24 });
  site.water(b, { id: 'ba_sing_se:firelight_fountain', label: 'Firelight Fountain', x: f.x, z: f.z, y: fy + 0.5, w: (f.r - 0.35) * 2, d: (f.r - 0.35) * 2, circle: true, capacity: 120, regen: 8, type: 'fountain' });
  // Central structure: plinth, column, a ring of lower lamps, the crowning lamp.
  b.cylinder('stone_light', { x: f.x, y: fy, z: f.z, r: 1.6, h: 1.4, segments: 8 }, { collide: true, walkable: true });
  b.cylinder('stone_tan', { x: f.x, y: fy + 1.3, z: f.z, r: 0.7, h: 2.6, segments: 8 }, { collide: true });
  b.cylinder('stone_light', { x: f.x, y: fy + 3.825, z: f.z, r: 1.25, h: 0.25, segments: 8 });
  for (let i = 0; i < 4; i++) {
    const a = i * (Math.PI / 2) + Math.PI / 4;
    const lx = f.x + Math.cos(a) * 1.1, lz = f.z + Math.sin(a) * 1.1;
    b.box(bm.glow, { x: lx, y: fy + 4.35, z: lz, sx: 0.4, sy: 0.5, sz: 0.4 });
    b.box('wood_dark', { x: lx, y: fy + 4.65, z: lz, sx: 0.55, sy: 0.08, sz: 0.55 });
  }
  b.cylinder('stone_tan', { x: f.x, y: fy + 4.1, z: f.z, r: 0.35, h: 1.8, segments: 8 });
  b.cylinder('wood_red', { x: f.x, y: fy + 6.06, z: f.z, r: 0.62, h: 0.18, segments: 8 });
  b.cylinder(bm.glow, { x: f.x, y: fy + 6.25, z: f.z, r: 0.5, h: 1.0, segments: 8 });
  b.roof('roof_dark', { x: f.x, y: fy + 7.25, z: f.z, w: 1.5, d: 1.5, height: 0.8, overhang: 0.25, curve: 0.8, style: 'pagoda', ridge: null });
  b.box('gold', { x: f.x, y: fy + 8.2, z: f.z, sx: 0.12, sy: 0.6, sz: 0.12 });
  b.lantern(new THREE.Vector3(f.x, fy + 6.75, f.z), { color: 'warm' });
  // Ring of lantern posts around the basin.
  for (let i = 0; i < 10; i++) {
    const a = (i / 10) * Math.PI * 2 + 0.15;
    lanternPost(b, f.x + Math.cos(a) * (f.r + 2.3), fy, f.z + Math.sin(a) * (f.r + 2.3), 'warm');
  }
  nav.poi(f.x + f.r + 1.2, f.z, NavTag.square | NavTag.water | NavTag.lower, Math.PI / 2);
  nav.poi(f.x - f.r - 1.2, f.z, NavTag.square | NavTag.water | NavTag.lower, -Math.PI / 2);
  nav.street([{ x: sq.x - sq.hw, z: sq.z }, { x: f.x - f.r - 2, z: sq.z }], NavTag.lower | NavTag.square, 8, 6);
  nav.street([{ x: f.x + f.r + 2, z: sq.z }, { x: sq.x + sq.hw, z: sq.z }], NavTag.lower | NavTag.square, 8, 6);
  nav.street([{ x: f.x, z: sq.z - sq.hd }, { x: f.x, z: f.z - f.r - 2 }], NavTag.lower | NavTag.square, 8, 6);
  nav.street([{ x: f.x, z: f.z + f.r + 2 }, { x: f.x, z: sq.z + sq.hd }], NavTag.lower | NavTag.square, 8, 6);
  // Floating lanterns and turtle ducks (animated).
  const dChunk = env.chunks.named('detail', 'fountain_life');
  const lg = new THREE.BoxGeometry(0.32, 0.26, 0.32);
  const lanterns = new THREE.InstancedMesh(lg, bm.glow, 9);
  dChunk.add(lanterns);
  const dg = duckGeometry();
  const duckMat = new THREE.MeshStandardMaterial({ color: '#8a7a52', roughness: 0.8 });
  const ducks = new THREE.InstancedMesh(dg, duckMat, 5);
  dChunk.add(ducks, true);
  const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), v = new THREE.Vector3(), one = new THREE.Vector3(1, 1, 1), up = new THREE.Vector3(0, 1, 0);
  env.animated.push((_dt, t) => {
    for (let i = 0; i < 9; i++) {
      const a = (i / 9) * Math.PI * 2 + t * 0.05 * (i % 2 ? 1 : -1);
      const r = 2.4 + (i % 3) * 1.2;
      v.set(f.x + Math.cos(a) * r, fy + 0.62 + Math.sin(t * 1.3 + i) * 0.03, f.z + Math.sin(a) * r);
      q.setFromAxisAngle(up, a);
      m4.compose(v, q, one);
      lanterns.setMatrixAt(i, m4);
    }
    lanterns.instanceMatrix.needsUpdate = true;
    for (let i = 0; i < 5; i++) {
      const sp = 0.18 + i * 0.03;
      const a = t * sp + i * 1.3;
      const r = 3.2 + (i % 2) * 1.4 + Math.sin(t * 0.3 + i) * 0.4;
      v.set(f.x + Math.cos(a) * r, fy + 0.52 + Math.sin(t * 2 + i) * 0.02, f.z + Math.sin(a) * r);
      q.setFromAxisAngle(up, Math.atan2(-Math.sin(a), Math.cos(a)) + Math.PI);
      m4.compose(v, q, i === 4 ? new THREE.Vector3(0.6, 0.6, 0.6) : one);
      ducks.setMatrixAt(i, m4);
    }
    ducks.instanceMatrix.needsUpdate = true;
  });
  // Statue of the Earth King, stalls, trees, benches.
  figureStatue(b, BSS.kingStatue.x, GROUND, BSS.kingStatue.z, 0, 1.6, 'bronze');
  b.box('stone_light', { x: BSS.kingStatue.x, y: GROUND + 0.6, z: BSS.kingStatue.z, sx: 3.6, sy: 1.2, sz: 3.6 }, { collide: true, walkable: true });
  for (const s of squareStalls()) {
    marketStall(b, s.x, GROUND, s.z, Math.PI / 2, 'cloth_green', env.rnd, 3.2, 2);
    site.stalls.push({ x: s.x, z: s.z, yaw: Math.PI / 2, w: 3.2, d: 2 });
    crates(env.chunks.at('detail', s.x, s.z).builder, s.x - 1.6, GROUND, s.z + 1.6, env.rnd, 2);
  }
  for (const [dx, dz] of [[-14, -14], [14, -14], [-14, 14], [14, 14]]) {
    planter(b, env.mats, sq.x + dx, GROUND, sq.z + dz, 1.3);
    tree(b, env.mats, sq.x + dx, GROUND + 0.5, sq.z + dz, 0.9, 'blossom', dx * 0.1);
  }
  for (const [dx, dz, yaw] of [[-6, -11, 0], [6, -11, 0], [-6, 11, Math.PI], [6, 11, Math.PI]]) {
    b.box('wood', { x: f.x + dx, y: GROUND + 0.45, z: f.z + dz, sx: 2.2, sy: 0.12, sz: 0.55, yaw }, { collide: true, walkable: true });
    nav.poi(f.x + dx, f.z + dz + (dz < 0 ? 0.7 : -0.7), NavTag.bench | NavTag.square | NavTag.lower, yaw);
  }
  // Lantern strings across the square.
  for (const dz of [-sq.hd + 1, sq.hd - 1]) {
    lanternString(b, env.mats, new THREE.Vector3(sq.x - sq.hw + 1, GROUND + 5, sq.z + dz), new THREE.Vector3(sq.x + sq.hw - 1, GROUND + 5, sq.z + dz), 1.2, 10, 'red');
  }
  site.mark('square', sq.x, GROUND, sq.z);
  site.mark('firelight_fountain', f.x, GROUND, f.z);
}

function duckGeometry(): THREE.BufferGeometry {
  const body = new THREE.SphereGeometry(0.22, 8, 6);
  body.scale(1, 0.62, 1.35);
  body.translate(0, 0.06, 0);
  const shell = new THREE.SphereGeometry(0.2, 8, 5, 0, Math.PI * 2, 0, Math.PI / 2);
  shell.scale(1, 0.55, 1.15);
  shell.translate(0, 0.1, -0.03);
  const head = new THREE.SphereGeometry(0.1, 8, 6);
  head.translate(0, 0.24, 0.28);
  const beak = new THREE.ConeGeometry(0.035, 0.1, 6);
  beak.rotateX(Math.PI / 2);
  beak.translate(0, 0.23, 0.4);
  const parts = [body, shell, head, beak].map((g) => g.toNonIndexed());
  let n = 0;
  for (const p of parts) n += p.getAttribute('position').count;
  const pos = new Float32Array(n * 3), nrm = new Float32Array(n * 3);
  let o = 0;
  for (const p of parts) {
    pos.set(p.getAttribute('position').array as Float32Array, o * 3);
    nrm.set(p.getAttribute('normal').array as Float32Array, o * 3);
    o += p.getAttribute('position').count;
  }
  for (const g of [body, shell, head, beak, ...parts]) g.dispose();
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.BufferAttribute(nrm, 3));
  return g;
}

// ---------------------------------------------------------------------------
// Pao Family Tea House
// ---------------------------------------------------------------------------

function buildPaoTeaHouse(site: DistrictSite): void {
  const { env, bm, nav } = site;
  const p = BSS.paoTea;
  const b = env.chunks.named('props', 'bss_pao').builder;
  // Two storeys, black tile roof, a deep veranda toward the square (local +Z = south = square side).
  b.building({ x: p.x, y: GROUND, z: p.z - 1.5, w: 13, d: 8, h: 7, yaw: 0, wall: 'plaster_cream', roof: 'roof_dark', trim: 'wood_red', roofStyle: 'hip', floors: 2, door: true });
  for (let i = 0; i <= 4; i++) b.box('wood_red', { x: p.x - 6 + i * 3, y: GROUND + 1.6, z: p.z + 4.3, sx: 0.3, sy: 3.2, sz: 0.3 }, { collide: true });
  b.roof('roof_dark', { x: p.x, y: GROUND + 3.2, z: p.z + 3.2, w: 13.6, d: 3.4, height: 0.9, overhang: 0.5, curve: 0.6, style: 'gable', ridge: null });
  // Counter where Pao serves (merchant spot in front of it).
  b.box('wood_dark', { x: p.x, y: GROUND + 0.55, z: p.z + 3.0, sx: 4.4, sy: 1.1, sz: 0.7 }, { collide: true });
  sign(b, bm, '寶家茶館', p.x, GROUND + 5.2, p.z + 2.55, 0, 1.15, { vertical: false, bg: '#2a1a12', fg: '#e8c36a' });
  for (const dx of [-5.5, 5.5]) b.lantern(new THREE.Vector3(p.x + dx, GROUND + 3.0, p.z + 4.5), { color: 'red', hanging: true });
  // Tables and stools on the square side.
  for (const [dx, dz] of [[-4.5, 7.2], [0, 7.6], [4.5, 7.2]]) {
    b.cylinder('wood', { x: p.x + dx, y: GROUND + 0.75, z: p.z + dz, r: 0.75, h: 0.08, segments: 12 });
    b.cylinder('wood_dark', { x: p.x + dx, y: GROUND, z: p.z + dz, r: 0.12, h: 0.74, segments: 6 }, { collide: true });
    b.box('plaster_white', { x: p.x + dx, y: GROUND + 0.86, z: p.z + dz, sx: 0.22, sy: 0.16, sz: 0.22 });
    for (let k = 0; k < 3; k++) {
      const a = (k / 3) * Math.PI * 2;
      b.cylinder('wood_dark', { x: p.x + dx + Math.cos(a) * 1.15, y: GROUND, z: p.z + dz + Math.sin(a) * 1.15, r: 0.22, h: 0.46, segments: 8 });
      nav.poi(p.x + dx + Math.cos(a) * 1.15, p.z + dz + Math.sin(a) * 1.15, NavTag.tea | NavTag.bench | NavTag.lower, Math.atan2(-Math.cos(a), -Math.sin(a)));
    }
  }
  nav.poi(p.x, p.z + 4.6, NavTag.tea | NavTag.shop | NavTag.lower, 0);
  site.mark('pao_tea_house', p.x, GROUND, p.z);
}

// ---------------------------------------------------------------------------
// Factory, stable, market
// ---------------------------------------------------------------------------

function buildFactory(site: DistrictSite): void {
  const { env, nav } = site;
  const f = BSS.factory;
  const t = thetaOf(f.x, f.z);
  const yaw = Math.atan2(Math.cos(t), Math.sin(t)); // front faces outward (to the 212 street)
  const tx = Math.cos(yaw), tz = -Math.sin(yaw);
  const nx = Math.sin(yaw), nz = Math.cos(yaw);
  const b = env.chunks.named('major', 'bss_factory').builder;
  b.building({ x: f.x, y: GROUND, z: f.z, w: 26, d: 9.5, h: 8, yaw, wall: 'stone_red', roof: 'roof_dark', trim: 'wood_dark', roofStyle: 'gable', floors: 2, door: true });
  // Sawtooth roof lights and three brick chimneys at the back.
  for (const k of [-8.5, 0, 8.5]) {
    const x = f.x + tx * k - nx * 2.6, z = f.z + tz * k - nz * 2.6;
    b.cylinder('stone_red', { x, y: GROUND + 4, z, r: 0.85, rTop: 0.65, h: 20, segments: 10 }, { collide: true });
    b.cylinder('stone_dark', { x, y: GROUND + 23.95, z, r: 0.8, h: 0.5, segments: 10 });
    site.smoke.push({ x, y: GROUND + 24.6, z, rate: 0.28 });
  }
  // Yard with crates and coal.
  const db = env.chunks.at('detail', f.x, f.z).builder;
  for (const k of [-10, -4, 6, 11]) crates(db, f.x + tx * k + nx * 6.2, GROUND, f.z + tz * k + nz * 6.2, env.rnd, 3);
  b.box('stone_dark', { x: f.x + nx * 6, y: GROUND + 0.4, z: f.z + nz * 6, sx: 3, sy: 0.8, sz: 2, yaw });
  nav.poi(f.x + nx * 5.6, f.z + nz * 5.6, NavTag.work | NavTag.lower, yaw + Math.PI);
  nav.poi(f.x + nx * 5.6 + tx * 6, f.z + nz * 5.6 + tz * 6, NavTag.work | NavTag.lower, yaw + Math.PI);
  site.mark('factory', f.x, GROUND, f.z);
}

function buildStable(site: DistrictSite): void {
  const { env, nav } = site;
  const s = BSS.stable;
  const t = thetaOf(s.x, s.z);
  const yaw = Math.atan2(-Math.cos(t), -Math.sin(t)); // front faces the palace (the 212 street)
  const nx = Math.sin(yaw), nz = Math.cos(yaw), tx = Math.cos(yaw), tz = -Math.sin(yaw);
  const b = env.chunks.named('props', 'bss_stable').builder;
  // Shed at the back, fenced yard in front.
  b.building({ x: s.x - nx * 2, y: GROUND, z: s.z - nz * 2, w: 12, d: 4, h: 3.4, yaw, wall: 'wood', roof: 'roof_dark', trim: 'wood_dark', roofStyle: 'gable', floors: 1, door: false });
  for (const k of [-1, 1]) {
    b.box('wood', { x: s.x + tx * k * 6, y: GROUND + 0.6, z: s.z + tz * k * 6, sx: 0.12, sy: 1.2, sz: 7, yaw }, { collide: true });
  }
  b.box('wood', { x: s.x + nx * 3.4 + tx * -3.5, y: GROUND + 0.6, z: s.z + nz * 3.4 + tz * -3.5, sx: 5, sy: 1.2, sz: 0.12, yaw }, { collide: true });
  b.box('wood', { x: s.x + nx * 3.4 + tx * 4.2, y: GROUND + 0.6, z: s.z + nz * 3.4 + tz * 4.2, sx: 3.6, sy: 1.2, sz: 0.12, yaw }, { collide: true });
  for (const k of [-3, 0, 3]) b.box(env.mats.hay, { x: s.x + tx * k, y: GROUND + 0.45, z: s.z + tz * k, sx: 1.4, sy: 0.9, sz: 1, yaw });
  b.box('wood_dark', { x: s.x + nx * 1.5 + tx * 4, y: GROUND + 0.35, z: s.z + nz * 1.5 + tz * 4, sx: 2.2, sy: 0.7, sz: 0.7, yaw });
  nav.poi(s.x + nx * 4.6, s.z + nz * 4.6, NavTag.shop | NavTag.lower, yaw);
  site.mark('stable', s.x, GROUND, s.z);
}

function buildMarket(site: DistrictSite): void {
  const { env, nav } = site;
  const awnings = ['cloth_red', 'cloth_green', 'cloth_yellow', 'cloth_orange', 'cloth_blue'] as const;
  const ms = marketStalls();
  ms.forEach((s, i) => {
    const b = env.chunks.at('props', s.x, s.z).builder;
    marketStall(b, s.x, GROUND, s.z, s.yaw, awnings[i % awnings.length], env.rnd, 3.2, 2);
    site.stalls.push({ x: s.x, z: s.z, yaw: s.yaw, w: 3.2, d: 2 });
    if (i % 3 === 0) crates(env.chunks.at('detail', s.x, s.z).builder, s.mx + Math.cos(s.yaw) * 1.2, GROUND, s.mz - Math.sin(s.yaw) * 1.2, env.rnd, 2);
    const cx = s.x + Math.sin(s.yaw) * 1.3, cz = s.z + Math.cos(s.yaw) * 1.3;
    nav.poi(cx, cz, NavTag.stall | NavTag.lower, s.yaw + Math.PI);
  });
  const mk = BSS.market;
  for (let t = mk.t0 + 0.02; t < mk.t1; t += 13 / mk.r) {
    const a = polar(t, mk.r - mk.width / 2 + 0.5), c = polar(t, mk.r + mk.width / 2 - 0.5);
    lanternString(env.chunks.at('props', a.x, a.z).builder, env.mats, new THREE.Vector3(a.x, GROUND + 4.6, a.z), new THREE.Vector3(c.x, GROUND + 4.6, c.z), 0.9, 6, 'red');
  }
  const c = polar((mk.t0 + mk.t1) / 2, mk.r);
  site.mark('lower_market', c.x, GROUND, c.z);
}

// ---------------------------------------------------------------------------
// Dressing: workshops, tea houses, noodle stalls, laundry, tarps, crates, puddles
// ---------------------------------------------------------------------------

function dressLower(site: DistrictSite, houses: PlacedHouse[], lanes: Lane[]): void {
  const { env, bm, nav } = site;
  const rnd = env.rnd;
  let workshops = 0, teas = 0;
  for (let i = 0; i < houses.length; i++) {
    const h = houses[i];
    const u = hash01(i, 501);
    const fx = Math.sin(h.yaw), fz = Math.cos(h.yaw);
    const lx = Math.cos(h.yaw), lz = -Math.sin(h.yaw);
    const db = env.chunks.at('detail', h.x, h.z).builder;
    const front = { x: h.door.x, z: h.door.z };
    if (h.id === 'N5' && u < 0.45) {
      // Workshop: crates, a forge glow at the door, chimney smoke.
      workshops++;
      crates(db, front.x + lx * 3, GROUND, front.z + lz * 3, rnd, 3);
      db.box(bm.glow, { x: front.x - fx * 0.3, y: GROUND + 0.5, z: front.z - fz * 0.3, sx: 0.7, sy: 0.5, sz: 0.4, yaw: h.yaw });
      db.box('iron', { x: front.x + fx * 0.6 + lx * -1.4, y: GROUND + 0.45, z: front.z + fz * 0.6 + lz * -1.4, sx: 0.8, sy: 0.9, sz: 0.5, yaw: h.yaw });
      if (workshops % 2 === 0) site.smoke.push({ x: h.x - fx * 1.5, y: GROUND + 6.2, z: h.z - fz * 1.5, rate: 0.12 });
      nav.poi(front.x, front.z, NavTag.work | NavTag.lower, h.yaw + Math.PI);
    } else if ((h.id === 'N2' || h.id === 'N4') && u < 0.06 && teas < 14) {
      // Tea house: hanging lanterns and a small table outside.
      teas++;
      for (const k of [-1, 1]) db.lantern(new THREE.Vector3(front.x + lx * k * 1.6 + fx * 0.3, GROUND + 2.8, front.z + lz * k * 1.6 + fz * 0.3), { color: 'red', hanging: true });
      db.cylinder('wood', { x: front.x + fx * 1.4, y: GROUND + 0.72, z: front.z + fz * 1.4, r: 0.6, h: 0.08, segments: 10 });
      db.cylinder('wood_dark', { x: front.x + fx * 1.4, y: GROUND, z: front.z + fz * 1.4, r: 0.1, h: 0.72, segments: 6 });
      nav.poi(front.x + fx * 1.4 + lx, front.z + fz * 1.4 + lz, NavTag.tea | NavTag.bench | NavTag.lower, h.yaw - Math.PI / 2);
    } else if (u < 0.22) {
      crates(db, front.x + lx * (u < 0.11 ? 2 : -2) + fx * 0.6, GROUND, front.z + lz * (u < 0.11 ? 2 : -2) + fz * 0.6, rnd, 1 + Math.floor(u * 10) % 3);
    } else if (u < 0.3) {
      // Tarp awning over the door.
      db.box(u < 0.26 ? 'cloth_orange' : 'cloth_blue', { x: front.x + fx * 1.0, y: GROUND + 2.5, z: front.z + fz * 1.0, sx: 2.6, sy: 0.04, sz: 1.8, yaw: h.yaw, pitch: 0.25 });
      for (const k of [-1, 1]) db.box('wood_dark', { x: front.x + fx * 1.8 + lx * k * 1.2, y: GROUND + 1.15, z: front.z + fz * 1.8 + lz * k * 1.2, sx: 0.07, sy: 2.3, sz: 0.07, yaw: h.yaw });
    }
    if (hash01(i, 502) < 0.12) db.box('wood', { x: front.x + lx * 2.4 + fx * 0.25, y: GROUND + 0.4, z: front.z + lz * 2.4 + fz * 0.25, sx: 0.6, sy: 0.8, sz: 0.6, yaw: h.yaw + 0.4 });
  }
  // Laundry over the back alley (lane at 197) and across radial lanes.
  const l1 = LOWER_LANES[0];
  for (let t = 0.03; t < Math.PI * 2; t += 11 / l1.r) {
    if (hash01(Math.round(t * 1000), 503) < 0.45 || nearAvenue(t, l1.r, 8)) continue;
    const a = polar(t, l1.r - l1.width / 2 - 1.2), c = polar(t + 0.006, l1.r + l1.width / 2 + 1.2);
    const y = GROUND + 3.4 + hash01(Math.round(t * 1000), 505) * 1.2;
    laundry(env.chunks.at('detail', a.x, a.z).builder, env.mats, new THREE.Vector3(a.x, y, a.z), new THREE.Vector3(c.x, y + 0.2, c.z), rnd);
  }
  for (const l of lanes) {
    if (hash01(Math.round(l.theta * 1000), 506) < 0.5) continue;
    const r = (l.r0 + l.r1) / 2 + (hash01(Math.round(l.theta * 1000), 507) - 0.5) * 8;
    const tn = (l.w / 2 + 1.0) / r;
    const a = polar(l.theta - tn, r), c = polar(l.theta + tn, r);
    const y = GROUND + 3.6;
    if (hash01(Math.round(l.theta * 1000), 508) < 0.6) laundry(env.chunks.at('detail', a.x, a.z).builder, env.mats, new THREE.Vector3(a.x, y, a.z), new THREE.Vector3(c.x, y, c.z), rnd);
    else lanternString(env.chunks.at('detail', a.x, a.z).builder, env.mats, new THREE.Vector3(a.x, y + 0.5, a.z), new THREE.Vector3(c.x, y + 0.5, c.z), 0.4, 4, 'red');
  }
  // Puddles on lanes and streets.
  const pb = env.chunks.named('detail', 'lower_puddles').builder;
  for (let i = 0; i < 140; i++) {
    const t = hash01(i, 509) * Math.PI * 2;
    const rings = [RING_STREETS.lowerIn.r, RING_STREETS.lowerMid.r, ...LOWER_LANES.map((q) => q.r)];
    const r = rings[i % rings.length] + (hash01(i, 510) - 0.5) * 2;
    const p = polar(t, r);
    if (nearAvenue(t, r, 2)) continue;
    const g = new THREE.CircleGeometry(0.6 + hash01(i, 511) * 1.1, 10);
    g.rotateX(-Math.PI / 2);
    g.scale(1, 1, 0.55 + hash01(i, 512) * 0.5);
    pb.mesh(bm.puddle, g, { x: p.x, y: GROUND + 0.07, z: p.z, yaw: t }, { castShadow: false });
    g.dispose();
  }
  // Noodle and dumpling stalls along the vendors' walkway at the 中環 wall foot.
  let k = 0;
  for (let t = 0.1; t < Math.PI * 2; t += 34 / 176) {
    k++;
    if (nearAvenue(t, 176, 9)) continue;
    const p = polar(t, 176.6);
    const yaw = Math.atan2(Math.cos(t), Math.sin(t));
    if (env.excl.pointBlocked(p.x, p.z, 0)) continue;
    const b = env.chunks.at('props', p.x, p.z).builder;
    marketStall(b, p.x, GROUND, p.z, yaw, k % 2 ? 'cloth_red' : 'cloth_yellow', rnd, 2.8, 1.6);
    site.stalls.push({ x: p.x, z: p.z, yaw, w: 2.8, d: 1.6 });
    b.cylinder('iron', { x: p.x + Math.cos(yaw) * 0.8, y: GROUND + 0.95, z: p.z - Math.sin(yaw) * 0.8, r: 0.32, h: 0.4, segments: 10 });
    site.smoke.push({ x: p.x + Math.cos(yaw) * 0.8, y: GROUND + 1.5, z: p.z - Math.sin(yaw) * 0.8, rate: 0.5, steam: true });
    nav.poi(p.x + Math.sin(yaw) * 1.6, p.z + Math.cos(yaw) * 1.6, NavTag.stall | NavTag.lower, yaw + Math.PI);
  }
  site.mark('lowerWorkshops', workshops, teas, 0);
}
