import * as THREE from 'three';
import type { ContentBuilder } from '../../kit/Builder';
import type { P2 } from '../../WorldLayout';
import type { ArchetypeId } from './archetypes';
import { stripGeometry } from './geom';
import { crates, guardianStatue, lanternPost, lanternString, marketStall, paifang, pavilion, planter, tree, type TreeKind } from './parts';
import { AVENUES, BSS, C, FOOT, GROUND, R, RING_STREETS, angleDiff, hash01, polar, ringLocal, thetaOf, wrapAngle, type Avenue } from './bssLayout';
import { sign } from './bssKit';
import { fillRing, ringStreet, type DistrictSite, type PlacedHouse, type RingRow } from './bssLower';
import { NavTag } from './bssNav';
import { railCrossings } from './bssWalls';

/**
 * Middle Ring: wealthier, calmer and greener. Flagstone streets lined with
 * trees and flower planters, two-to-four storey houses and shops with vivid
 * green roofs; a market plaza with awnings, string lamps and an octagonal
 * pavilion; Ba Sing Se University (永固城大學), the old Town Hall, counting
 * houses, a bathhouse, a poetry house, tea houses and restaurants, the
 * moon-bridge garden and the Stone Fist Dojo.
 *
 * The band between the two ring roads is cut into blocks by radial cross
 * streets and a tree-lined lane; landmarks take whole blocks. Streets are
 * planned against what already stands here (viaduct piers, lift towers)
 * before any ground is claimed.
 */

const ROOFS_MID = [new THREE.Color(0.32, 0.68, 0.36), new THREE.Color(0.27, 0.6, 0.31), new THREE.Color(0.38, 0.74, 0.4), new THREE.Color(0.24, 0.54, 0.32)];
const WALLS_MID = [new THREE.Color(1, 1, 1), new THREE.Color(0.97, 0.95, 0.9), new THREE.Color(0.95, 0.91, 0.84), new THREE.Color(0.93, 0.93, 0.9)];
const MID_TYPES: Array<[ArchetypeId, number]> = [['N7', 24], ['N8', 18], ['N6', 9], ['N4', 14], ['N3', 9], ['N3b', 9], ['N2', 9]];
const TREES: TreeKind[] = ['round', 'blossom', 'round', 'cypress', 'round'];
const SHOP_SIGNS = ['茶', '麵', '布', '藥', '書', '酒', '米', '扇'];

/** Tree-lined lane through the middle of the band (paved width + planting strip each side). */
const LANE = { r: 136, width: 4.6, strip: 1.4 };
const RADIAL_W = 4.8;
/** Target spacing of the radial cross streets (m along the lane). */
const RADIAL_SPACING = 32;
const ROOF_OLD = new THREE.Color(0.25, 0.5, 0.3);
const WALL_OLD = new THREE.Color(0.93, 0.8, 0.72);

interface Block {
  id: string;
  c: P2;
  /** Half-width along the ring and radial half-depth. */
  hw: number;
  hd: number;
}

const BLOCKS: Block[] = [
  { id: 'dojo', ...BSS.dojo },
  { id: 'university', ...BSS.university },
  { id: 'town_hall', ...BSS.townHall },
  { id: 'financial', ...BSS.financial },
  { id: 'plaza', c: BSS.marketPlaza.c, hw: BSS.marketPlaza.r, hd: BSS.marketPlaza.r },
  { id: 'garden', c: BSS.gardenW.c, hw: BSS.gardenW.r + 2, hd: BSS.gardenW.r + 2 },
  { id: 'spa', ...BSS.spa },
  { id: 'poetry', ...BSS.poetry },
];

function inBlock(x: number, z: number, m: number): boolean {
  for (const b of BLOCKS) {
    const t = thetaOf(b.c.x, b.c.z);
    const dx = x - b.c.x, dz = z - b.c.z;
    const u = -dx * Math.sin(t) + dz * Math.cos(t), v = dx * Math.cos(t) + dz * Math.sin(t);
    if (Math.abs(u) < b.hw + m && Math.abs(v) < b.hd + m) return true;
  }
  return false;
}

function nearAvenue(theta: number, r: number, margin: number): boolean {
  for (const a of AVENUES) {
    const d = Math.abs(Math.sin(theta - a.theta)) * r;
    if (Math.cos(theta - a.theta) > 0 && d < a.width / 2 + margin) return true;
  }
  return false;
}

/** Angular half-width of an avenue (plus margin m) at radius r. */
function avenueHalf(a: Avenue, r: number, m: number): number {
  return Math.asin(Math.min(1, (a.width / 2 + m) / r));
}

/** Is angle t inside the (unwrapped, a ≤ b) arc [a, b]? */
function inArc(t: number, a: number, b: number): boolean {
  return wrapAngle(t - a) <= b - a;
}

export function* buildMiddleRing(site: DistrictSite): Generator<unknown, void, unknown> {
  const { env, nav } = site;
  const MT = NavTag.middle;
  const TAU = Math.PI * 2;
  const rIn = RING_STREETS.middleIn, rOut = RING_STREETS.middleOut;
  const r0 = rIn.r + rIn.width / 2, r1 = rOut.r - rOut.width / 2;

  // ---- Plan against what already stands here (viaduct piers, lift towers).
  const hard = (x: number, z: number, m: number) => env.excl.pointBlocked(x, z, m);
  const corridorFree = (t: number): boolean => {
    for (let r = r0 + 0.4; r <= r1 - 0.4; r += 1.4) {
      const p = polar(t, r);
      if (hard(p.x, p.z, RADIAL_W / 2 + 0.2) || inBlock(p.x, p.z, RADIAL_W / 2 + 0.3)) return false;
    }
    return true;
  };
  const radials: number[] = [];
  const tryRadial = (t: number, dir: number): void => {
    for (const s of [0, 1.5, -1.5, 3, -3, 4.5, -4.5, 6, -6]) {
      if (dir * s < 0) continue;
      const tt = wrapAngle(t + s / LANE.r);
      if (corridorFree(tt)) {
        radials.push(tt);
        return;
      }
    }
  };
  // Flank streets on both sides of every landmark block (unless an avenue already runs there).
  const occupied: Array<[number, number]> = [];
  for (const b of BLOCKS) {
    const tc = thetaOf(b.c.x, b.c.z);
    const rmin = Math.max(r0, Math.hypot(b.c.x - C.x, b.c.z - C.z) - b.hd);
    const d = Math.asin((b.hw + RADIAL_W / 2 + 0.5) / rmin);
    const e = d + RADIAL_W / 2 / rmin;
    occupied.push([tc - e, tc + e]);
    for (const side of [-1, 1]) {
      const t = tc + side * d;
      if (AVENUES.some((a) => Math.abs(angleDiff(t, a.theta)) < avenueHalf(a, r0, RADIAL_W / 2 + 8))) continue;
      tryRadial(t, side);
    }
  }
  for (const a of AVENUES) {
    const h = avenueHalf(a, r0, 0.5);
    occupied.push([a.theta - h, a.theta + h]);
  }
  // Evenly spaced cross streets in the gaps between blocks and avenues.
  const iv = occupied.map(([a, b]): [number, number] => [wrapAngle(a), wrapAngle(a) + (b - a)]).sort((p, q) => p[0] - q[0]);
  const merged: Array<[number, number]> = [];
  for (const v of iv) {
    const last = merged[merged.length - 1];
    if (last && v[0] <= last[1]) last[1] = Math.max(last[1], v[1]);
    else merged.push([v[0], v[1]]);
  }
  for (let i = 0; i < merged.length; i++) {
    const g0 = merged[i][1];
    const g1 = i + 1 < merged.length ? merged[i + 1][0] : merged[0][0] + TAU;
    if (g1 <= g0) continue;
    const n = Math.floor(((g1 - g0) * LANE.r) / RADIAL_SPACING);
    for (let k = 1; k <= n; k++) tryRadial(g0 + ((g1 - g0) * k) / (n + 1), 0);
  }
  radials.sort((p, q) => p - q);
  // Lane: free 1 m samples around the band → arcs (cut by landmark blocks and piers).
  const N = Math.ceil(TAU * LANE.r);
  const laneFree = new Uint8Array(N);
  for (let i = 0; i < N; i++) {
    const p = polar((i / N) * TAU, LANE.r);
    laneFree[i] = hard(p.x, p.z, LANE.width / 2 + 0.2) || inBlock(p.x, p.z, LANE.width / 2 + 0.2) ? 0 : 1;
  }
  const arcs: Array<[number, number]> = [];
  const startI = laneFree.indexOf(0);
  if (startI < 0) arcs.push([0, TAU]);
  else {
    let run = -1;
    for (let k = 1; k <= N; k++) {
      const free = laneFree[(startI + k) % N] === 1;
      if (free && run < 0) run = startI + k;
      if (!free && run >= 0) {
        const end = startI + k - 1;
        if (end - run >= 6) arcs.push([(run / N) * TAU, (end / N) * TAU]);
        run = -1;
      }
    }
  }
  const onLane = (t: number) => arcs.some(([a, b]) => inArc(t, a, b));
  const laneTrees: P2[] = [];
  for (const [a, b] of arcs) {
    for (const side of [-1, 1]) {
      const r = LANE.r + side * (LANE.width / 2 + 0.5);
      for (let t = a + 4 / r; t < b - 4 / r; t += 9.5 / r) {
        const p = polar(t, r);
        if (hard(p.x, p.z, 1.0) || inBlock(p.x, p.z, 1.0) || nearAvenue(t, r, 2.5)) continue;
        if (radials.some((q) => Math.abs(angleDiff(q, t)) * r < RADIAL_W / 2 + 1.6)) continue;
        laneTrees.push(p);
      }
    }
  }
  // Lift towers of the Middle Ring stations: a short paved path to the nearest street.
  const access: Array<{ lift: P2; end: P2; t: number; rl: number; rt: number }> = [];
  for (const l of site.lifts) {
    const rl = Math.hypot(l.x - C.x, l.z - C.z);
    if (rl < r0 - 6 || rl > r1 + 6) continue;
    const t = thetaOf(l.x, l.z);
    const targets = [rIn.r, rOut.r, LANE.r].filter((rt) => rt !== LANE.r || onLane(t)).sort((a, b) => Math.abs(a - rl) - Math.abs(b - rl));
    for (const rt of targets) {
      const dir = Math.sign(rt - rl), len = Math.abs(rt - rl);
      let ok = true;
      for (let s = 8.6; s < len - 2; s += 1.2) {
        const p = polar(t, rl + dir * s);
        if (hard(p.x, p.z, 1.9) || inBlock(p.x, p.z, 1.9)) {
          ok = false;
          break;
        }
      }
      if (ok) {
        access.push({ lift: { x: l.x, z: l.z }, end: polar(t, rt), t, rl, rt });
        break;
      }
    }
  }
  // Tiled garden walls along both sides of the lane (behind the houses), broken at crossings.
  const wallRuns: Array<{ r: number; a: number; b: number }> = [];
  for (const [a, b] of arcs) {
    for (const side of [-1, 1]) {
      const r = LANE.r + side * (LANE.width / 2 + LANE.strip - 0.2);
      let run = -1;
      const n = Math.ceil((b - a) * r);
      for (let i = 0; i <= n + 1; i++) {
        const t = a + (Math.min(i, n) / n) * (b - a);
        const p = polar(t, r);
        const ok =
          i <= n &&
          !hard(p.x, p.z, 0.4) &&
          !inBlock(p.x, p.z, 0.4) &&
          !nearAvenue(t, r, 0.6) &&
          !radials.some((q) => Math.abs(angleDiff(q, t)) * r < RADIAL_W / 2 + 0.25) &&
          !access.some((q) => Math.abs(angleDiff(q.t, t)) * r < 2.2 && (q.rt === LANE.r || Math.abs(q.rl - r) < Math.abs(q.rt - q.rl)));
        if (ok && run < 0) run = t;
        if (!ok && run >= 0) {
          if ((t - run) * r > 3) wallRuns.push({ r, a: run, b: t - 0.6 / r });
          run = -1;
        }
      }
    }
  }

  // ---- Claim the ground: landmark blocks, ring roads, avenues, cross streets, lane, lift paths.
  for (const b of BLOCKS) env.excl.box(b.c.x, b.c.z, b.hw, b.hd, ringLocal(b.c).yaw);
  ringStreet(site, rIn.r, rIn.width, MT);
  ringStreet(site, rOut.r, rOut.width, MT);
  const gb = env.chunks.named('major', 'mid_streets').builder;
  const pave = (pts: P2[], hw: number, y: number): void => {
    const geo = stripGeometry(pts, hw, GROUND + y, 3);
    gb.mesh('paving', geo, { x: 0, y: 0, z: 0 }, { castShadow: false });
    geo.dispose();
  };
  for (const a of AVENUES) {
    const p0 = polar(a.theta, FOOT.upperOut - 1), p1 = polar(a.theta, FOOT.middleIn + 1);
    env.excl.seg(p0.x, p0.z, p1.x, p1.z, a.width / 2 + 0.5);
    nav.street([p0, polar(a.theta, rIn.r), polar(a.theta, LANE.r), polar(a.theta, rOut.r), polar(a.theta, FOOT.middleOut + 1)], MT | NavTag.street, 9, 5);
    for (const r of [rIn.r, rOut.r]) {
      const p = polar(a.theta, r);
      nav.join(p.x, p.z, 6);
    }
  }
  for (const t of radials) {
    const a = polar(t, r0), b = polar(t, r1);
    env.excl.seg(a.x, a.z, b.x, b.z, RADIAL_W / 2);
    if (onLane(t)) {
      pave([a, polar(t, LANE.r - LANE.width / 2)], RADIAL_W / 2, 0.056);
      pave([polar(t, LANE.r + LANE.width / 2), b], RADIAL_W / 2, 0.056);
    } else pave([a, b], RADIAL_W / 2, 0.056);
    nav.street([polar(t, rIn.r), polar(t, LANE.r), polar(t, rOut.r)], MT | NavTag.street, 9, 5);
  }
  for (const [a, b] of arcs) {
    const cuts = [...radials, ...AVENUES.map((v) => v.theta)].map((q) => a + wrapAngle(q - a)).filter((q) => q > a && q < b);
    const ts = [a, b, ...cuts];
    for (let t = a + 8 / LANE.r; t < b; t += 8 / LANE.r) if (!cuts.some((q) => Math.abs(q - t) * LANE.r < 2)) ts.push(t);
    ts.sort((p, q) => p - q);
    const pts = ts.map((t) => polar(t, LANE.r));
    env.excl.polyline(pts, LANE.width / 2 + LANE.strip);
    nav.street(pts, MT | NavTag.street, 9, 3);
    // Flagstones, broken where an avenue crosses.
    let run: P2[] = [];
    for (let t = a; t <= b + 1e-6; t += 2.5 / LANE.r) {
      if (nearAvenue(t, LANE.r, 0.2)) {
        if (run.length > 1) pave(run, LANE.width / 2, 0.055);
        run = [];
      } else run.push(polar(Math.min(t, b), LANE.r));
    }
    if (run.length > 1) pave(run, LANE.width / 2, 0.055);
  }
  for (const s of access) {
    env.excl.seg(s.lift.x, s.lift.z, s.end.x, s.end.z, 1.9);
    const dir = Math.sign(s.rt - s.rl);
    const edge = s.rt === LANE.r ? LANE.width / 2 : rIn.width / 2;
    if (Math.abs(s.rt - s.rl) - edge > 6.6) pave([polar(s.t, s.rl + dir * 6.4), polar(s.t, s.rt - dir * edge)], 1.5, 0.054);
    nav.street([s.lift, s.end], MT | NavTag.street, 8, 5);
    nav.poi(s.lift.x, s.lift.z, MT | NavTag.station, 0, 9);
  }
  yield;

  // ---- Landmarks.
  buildMarketPlaza(site);
  buildDojo(site);
  buildUniversity(site);
  buildTownHall(site);
  yield;
  buildGarden(site);
  buildSpa(site);
  buildPoetry(site);
  buildCountingHouses(site);
  yield;

  // ---- Houses: deep lots facing the ring roads, small lane-facing houses in what is left.
  const laneIn = LANE.r - LANE.width / 2 - LANE.strip, laneOut = LANE.r + LANE.width / 2 + LANE.strip;
  const rows: RingRow[] = [
    { key: 'M1', rFront: r0 + 0.45, facing: -1, maxDepth: laneIn - r0 - 0.6, types: MID_TYPES, roofs: ROOFS_MID, walls: WALLS_MID, scale: [0.95, 1.22], gap: [0.25, 1.3], vacancy: 0.02, tag: MT },
    { key: 'M2', rFront: r1 - 0.45, facing: 1, maxDepth: r1 - laneOut - 0.6, types: MID_TYPES, roofs: ROOFS_MID, walls: WALLS_MID, scale: [0.95, 1.22], gap: [0.25, 1.3], vacancy: 0.02, tag: MT },
  ];
  const placed: PlacedHouse[] = [];
  for (const row of rows) {
    placed.push(...fillRing(site, row));
    yield;
  }
  site.mark('middleHouses', placed.length, GROUND, 0);
  laneWalls(site, wallRuns);
  dressMiddle(site, placed, radials, laneTrees);
  site.mark('middleStreets', radials.length, arcs.length, access.length);
  yield;
}

// ---------------------------------------------------------------------------
// Shared bits
// ---------------------------------------------------------------------------

type Frame = ReturnType<typeof ringLocal>;

/** Floor plane over a whole block (local frame). */
function blockFloor(site: DistrictSite, name: string, F: Frame, c: P2, w: number, d: number, mat: Parameters<ContentBuilder['mesh']>[0], y = 0.08): void {
  const geo = new THREE.PlaneGeometry(w, d);
  geo.rotateX(-Math.PI / 2);
  site.env.chunks.named('major', name).builder.mesh(mat, geo, { x: c.x, y: GROUND + y, z: c.z, yaw: F.yaw }, { castShadow: false });
  geo.dispose();
}

/** Compound wall along the block edge (local frame) with a gap of `gate` metres in the front (+Z) side. */
function compoundWall(b: ContentBuilder, F: Frame, hw: number, hd: number, H: number, gate: number, open: { back?: boolean } = {}): void {
  const seg = (lx0: number, lz0: number, lx1: number, lz1: number) => {
    const a = F.at(lx0, lz0), c = F.at(lx1, lz1);
    const len = Math.hypot(c.x - a.x, c.z - a.z);
    const yaw = Math.atan2(c.x - a.x, c.z - a.z);
    const mx = (a.x + c.x) / 2, mz = (a.z + c.z) / 2;
    b.box('plaster_white', { x: mx, y: GROUND + H / 2, z: mz, sx: 0.55, sy: H, sz: len, yaw }, { collide: true });
    b.box('roof_green', { x: mx, y: GROUND + H + 0.12, z: mz, sx: 1.0, sy: 0.26, sz: len + 0.4, yaw });
    b.box('stone_grey', { x: mx, y: GROUND + 0.25, z: mz, sx: 0.75, sy: 0.5, sz: len, yaw });
  };
  seg(-hw, -hd, -hw, hd);
  seg(hw, -hd, hw, hd);
  if (!open.back) seg(-hw, -hd, hw, -hd);
  seg(-hw, hd, -gate / 2, hd);
  seg(gate / 2, hd, hw, hd);
}

function house(site: DistrictSite, id: ArchetypeId, F: Frame, lx: number, lz: number, yaw: number, s: number, y = GROUND, wall = WALLS_MID[0], roof = ROOFS_MID[0]): void {
  const p = F.at(lx, lz);
  site.env.chunks.addHouse(site.env.arch[id], p.x, y, p.z, yaw, { scale: s, tint: wall, roofTint: roof });
}

// ---------------------------------------------------------------------------
// Market plaza (image 3): awnings, string lamps, octagonal pavilion
// ---------------------------------------------------------------------------

function buildMarketPlaza(site: DistrictSite): void {
  const { env, nav } = site;
  const P = BSS.marketPlaza;
  const F = ringLocal(P.c);
  const b = env.chunks.named('props', 'mid_plaza').builder;
  // Paths across the plaza join the lane (along the ring) and both ring roads.
  nav.street([F.at(-P.r - 4.8, 0), F.at(P.r + 4.8, 0)], NavTag.middle | NavTag.square, 8, 5);
  nav.street([F.at(0, P.r + 5), F.at(0, -P.r - 5)], NavTag.middle | NavTag.square, 8, 5);
  const floor = new THREE.CircleGeometry(P.r, 40);
  floor.rotateX(-Math.PI / 2);
  env.chunks.named('major', 'mid_plaza_floor').builder.mesh('paving', floor, { x: P.c.x, y: GROUND + 0.07, z: P.c.z }, { castShadow: false });
  floor.dispose();
  const kerb = new THREE.RingGeometry(P.r - 0.35, P.r, 48);
  kerb.rotateX(-Math.PI / 2);
  env.chunks.named('major', 'mid_plaza_floor').builder.mesh('stone_light', kerb, { x: P.c.x, y: GROUND + 0.09, z: P.c.z }, { castShadow: false });
  kerb.dispose();
  // Octagonal pavilion: plinth, 8 red columns, double green roof with a gold finial.
  const R0 = 5.2;
  b.cylinder('stone_light', { x: P.c.x, y: GROUND, z: P.c.z, r: R0 + 0.8, h: 0.6, segments: 8 }, { collide: true, walkable: true });
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2 + Math.PI / 8;
    const x = P.c.x + Math.cos(a) * R0, z = P.c.z + Math.sin(a) * R0;
    b.cylinder('wood_red', { x, y: GROUND + 0.6, z, r: 0.24, h: 4.0, segments: 8 }, { collide: true });
    b.lantern(new THREE.Vector3(x * 0.85 + P.c.x * 0.15, GROUND + 3.9, z * 0.85 + P.c.z * 0.15), { color: 'warm', hanging: true });
  }
  b.cylinder('wood_dark', { x: P.c.x, y: GROUND + 4.5, z: P.c.z, r: R0 + 0.4, h: 0.4, segments: 8 });
  b.roof('roof_green', { x: P.c.x, y: GROUND + 4.85, z: P.c.z, w: R0 * 2 + 0.6, d: R0 * 2 + 0.6, height: 2.0, overhang: 0.9, curve: 0.9, style: 'pagoda', ridge: null });
  b.cylinder('plaster_cream', { x: P.c.x, y: GROUND + 6.2, z: P.c.z, r: 2.3, h: 1.4, segments: 8 });
  b.cylinder('wood_red', { x: P.c.x, y: GROUND + 7.45, z: P.c.z, r: 2.45, h: 0.2, segments: 8 });
  b.roof('roof_green', { x: P.c.x, y: GROUND + 7.6, z: P.c.z, w: 6.0, d: 6.0, height: 2.2, overhang: 0.8, curve: 0.9, style: 'pagoda', ridge: null });
  b.box('gold', { x: P.c.x, y: GROUND + 10.2, z: P.c.z, sx: 0.25, sy: 1.0, sz: 0.25 });
  for (let i = 0; i < 3; i++) {
    const a = (i / 3) * Math.PI * 2;
    const x = P.c.x + Math.cos(a) * 2.4, z = P.c.z + Math.sin(a) * 2.4;
    b.cylinder('wood', { x, y: GROUND + 1.35, z, r: 0.65, h: 0.08, segments: 10 });
    b.cylinder('wood_dark', { x, y: GROUND + 0.6, z, r: 0.1, h: 0.75, segments: 6 });
    nav.poi(x + Math.cos(a) * 1.1, z + Math.sin(a) * 1.1, NavTag.tea | NavTag.bench | NavTag.middle, a + Math.PI);
  }
  // Eight awning stalls around the rim, entrances on the four axes; string lamps to poles behind them.
  const awnings = ['cloth_green', 'cloth_yellow', 'cloth_red', 'cloth_orange', 'cloth_white'] as const;
  for (let i = 0; i < 8; i++) {
    const a = ((22.5 + i * 45) * Math.PI) / 180;
    const rr = P.r - 2.4;
    const p = F.at(Math.cos(a) * rr, Math.sin(a) * rr);
    const yaw = F.yaw + Math.atan2(-Math.cos(a), -Math.sin(a));
    marketStall(b, p.x, GROUND, p.z, yaw, awnings[i % awnings.length], env.rnd, 3.6, 2);
    site.stalls.push({ x: p.x, z: p.z, yaw, w: 3.6, d: 2 });
    const q = F.at(Math.cos(a) * (rr - 2.1), Math.sin(a) * (rr - 2.1));
    nav.poi(q.x, q.z, NavTag.stall | NavTag.middle, yaw + Math.PI);
    const pole = F.at(Math.cos(a) * (P.r - 0.5), Math.sin(a) * (P.r - 0.5));
    b.cylinder('wood_dark', { x: pole.x, y: GROUND, z: pole.z, r: 0.12, h: 5.2, segments: 6 }, { collide: true });
    const top = F.at(Math.cos(a) * (R0 + 1.1), Math.sin(a) * (R0 + 1.1));
    lanternString(b, env.mats, new THREE.Vector3(top.x, GROUND + 5.3, top.z), new THREE.Vector3(pole.x, GROUND + 5.0, pole.z), 0.7, 6, 'warm');
  }
  for (let i = 0; i < 4; i++) {
    const a = ((45 + i * 90) * Math.PI) / 180;
    const p = F.at(Math.cos(a) * 9.4, Math.sin(a) * 9.4);
    planter(b, env.mats, p.x, GROUND, p.z, 0.9);
  }
  site.mark('middle_plaza', P.c.x, GROUND, P.c.z);
}

// ---------------------------------------------------------------------------
// Stone Fist Dojo (Master Lien's training floor)
// ---------------------------------------------------------------------------

function buildDojo(site: DistrictSite): void {
  const { env, bm, nav } = site;
  const D = BSS.dojo;
  const F = ringLocal(D.c);
  const b = env.chunks.named('props', 'mid_dojo').builder;
  blockFloor(site, 'mid_dojo_floor', F, D.c, D.hw * 2 - 1, D.hd * 2 - 1, 'stone_tan');
  const yard = F.at(0, 5.5);
  b.cylinder('stone_grey', { x: yard.x, y: GROUND + 0.1, z: yard.z, r: 7.5, h: 0.08, segments: 40 });
  compoundWall(b, F, D.hw, D.hd, 3.2, 6.5);
  const g = F.at(0, D.hd);
  paifang(b, g.x, GROUND, g.z, F.yaw, 6.5, 5.6, { roof: 'roof_green' });
  const s = F.at(0, D.hd + 0.35);
  sign(b, bm, '石拳道館', s.x, GROUND + 4.1, s.z, F.yaw, 0.85, { vertical: false });
  // Training hall across the back of the yard, porch toward the gate.
  house(site, 'N6', F, 0, -D.hd + 0.6 + (env.arch.N6.d * 1.1) / 2, F.yaw, 1.1, GROUND, WALLS_MID[1], ROOFS_MID[1]);
  for (const side of [-1, 1]) {
    for (const lz of [-0.5, 4.5, 9.5]) {
      const p = F.at(side * (D.hw - 2.2), lz);
      b.cylinder('wood', { x: p.x, y: GROUND, z: p.z, r: 0.22, h: 1.8, segments: 8 }, { collide: true });
    }
    const r = F.at(side * (D.hw - 0.75), -2.5);
    b.box('wood_dark', { x: r.x, y: GROUND + 1.0, z: r.z, sx: 0.3, sy: 2.0, sz: 3, yaw: F.yaw }, { collide: true });
    const l = F.at(side * (D.hw - 2), D.hd - 2);
    lanternPost(b, l.x, GROUND, l.z, 'red');
  }
  nav.poi(F.at(0, D.hd + 2.4).x, F.at(0, D.hd + 2.4).z, NavTag.middle | NavTag.school, F.yaw + Math.PI);
  site.mark('dojo', D.c.x, GROUND, D.c.z);
}

// ---------------------------------------------------------------------------
// Ba Sing Se University
// ---------------------------------------------------------------------------

function buildUniversity(site: DistrictSite): void {
  const { env, bm, nav } = site;
  const U = BSS.university;
  const F = ringLocal(U.c);
  const b = env.chunks.named('props', 'mid_university').builder;
  nav.street([F.at(0, U.hd + 3), F.at(0, 9.5), F.at(-1.6, 4), F.at(0, -1)], NavTag.middle | NavTag.street | NavTag.school, 8, 5);
  blockFloor(site, 'mid_univ_floor', F, U.c, U.hw * 2 - 1, U.hd * 2 - 1, 'paving');
  compoundWall(b, F, U.hw, U.hd, 2.6, 10);
  const g = F.at(0, U.hd);
  paifang(b, g.x, GROUND, g.z, F.yaw, 9.5, 7.6, { roof: 'roof_green', posts: 4 });
  const s = F.at(0, U.hd + 0.42);
  sign(b, bm, '永固城大學', s.x, GROUND + 5.7, s.z, F.yaw, 1.05, { vertical: false });
  // Lecture halls face each other across the courtyard; the library closes the back.
  const N6 = env.arch.N6, N8 = env.arch.N8;
  for (const side of [-1, 1]) {
    const lx = side * (U.hw - 0.8 - (N6.d * 1.3) / 2);
    house(site, 'N6', F, lx, 1.2, F.yaw - (side * Math.PI) / 2, 1.3, GROUND, WALLS_MID[0], ROOFS_MID[3]);
    const door = F.at(side * 6.6, 1.2);
    nav.poi(door.x, door.z, NavTag.middle | NavTag.school, F.yaw + (side * Math.PI) / 2);
  }
  house(site, 'N8', F, 0, -U.hd + 0.8 + (N8.d * 1.45) / 2, F.yaw, 1.45, GROUND, WALLS_MID[2], ROOFS_MID[3]);
  const lib = F.at(0, -U.hd + 1.2 + N8.d * 1.45 + 1.4);
  nav.poi(lib.x, lib.z, NavTag.middle | NavTag.school, F.yaw + Math.PI);
  for (const [lx, lz] of [[-4.6, 10], [4.6, 10], [-4.6, 1.5], [4.6, 1.5]]) {
    const t = F.at(lx, lz);
    tree(b, env.mats, t.x, GROUND, t.z, 0.85, lz > 5 ? 'blossom' : 'round', lx + lz);
  }
  for (const side of [-1, 1]) {
    const t = F.at(side * 2.6, 6);
    b.box('stone_light', { x: t.x, y: GROUND + 0.23, z: t.z, sx: 0.6, sy: 0.46, sz: 2.2, yaw: F.yaw }, { collide: true, walkable: true });
    nav.poi(t.x, t.z, NavTag.bench | NavTag.middle | NavTag.school, F.yaw - (side * Math.PI) / 2);
  }
  const urn = F.at(0, 4);
  b.cylinder('bronze', { x: urn.x, y: GROUND + 0.4, z: urn.z, r: 0.55, rTop: 0.7, h: 0.7, segments: 10 }, { collide: true });
  b.cylinder('stone_grey', { x: urn.x, y: GROUND, z: urn.z, r: 0.9, h: 0.4, segments: 8 }, { collide: true, walkable: true });
  site.mark('university', U.c.x, GROUND, U.c.z);
}

// ---------------------------------------------------------------------------
// Town Hall (one of the oldest buildings in the city)
// ---------------------------------------------------------------------------

function buildTownHall(site: DistrictSite): void {
  const { env, bm, nav } = site;
  const T = BSS.townHall;
  const F = ringLocal(T.c);
  const b = env.chunks.named('props', 'mid_townhall').builder;
  blockFloor(site, 'mid_townhall_floor', F, T.c, T.hw * 2 - 1, T.hd * 2 - 1, 'stone_grey');
  const pod = F.at(0, -5.5);
  b.box('stone_grey', { x: pod.x, y: GROUND + 0.6, z: pod.z, sx: 26, sy: 1.2, sz: 16, yaw: F.yaw }, { collide: true, walkable: true });
  b.box('stone_light', { x: pod.x, y: GROUND + 1.22, z: pod.z, sx: 26.3, sy: 0.08, sz: 16.3, yaw: F.yaw });
  const N6 = env.arch.N6;
  house(site, 'N6', F, 0, -13 + (N6.d * 1.4) / 2, F.yaw, 1.4, GROUND + 1.2, WALL_OLD, ROOF_OLD);
  const st0 = F.at(0, 5.2), st1 = F.at(0, 2.5);
  b.stairs({ from: new THREE.Vector3(st0.x, GROUND, st0.z), to: new THREE.Vector3(st1.x, GROUND + 1.2, st1.z), width: 7, material: 'stone_grey' });
  for (const lx of [-4.8, 4.8]) {
    const g = F.at(lx, 7.2);
    guardianStatue(b, g.x, GROUND, g.z, F.yaw, 1, 'stone_grey');
  }
  const gate = F.at(0, T.hd - 0.6);
  paifang(b, gate.x, GROUND, gate.z, F.yaw, 8.5, 6.4, { roof: 'roof_dark' });
  const s = F.at(0, T.hd - 0.2);
  sign(b, bm, '市政廳', s.x, GROUND + 4.7, s.z, F.yaw, 0.95, { vertical: false });
  for (const side of [-1, 1]) {
    const l = F.at(side * 9.5, 8.5);
    lanternPost(b, l.x, GROUND, l.z, 'warm');
    const f = F.at(side * 12.2, 3);
    b.cylinder('wood_dark', { x: f.x, y: GROUND, z: f.z, r: 0.1, h: 8, segments: 6 }, { collide: true });
    const ban = F.at(side * 12.2 + side * 0.05, 3);
    b.box('cloth_green', { x: ban.x, y: GROUND + 6.0, z: ban.z, sx: 0.05, sy: 3.2, sz: 1.1, yaw: F.yaw });
  }
  nav.street([F.at(0, T.hd + 3), F.at(0, 6.2)], NavTag.middle | NavTag.street, 8, 5);
  const top = F.at(0, 1.5);
  nav.poi(top.x, top.z, NavTag.middle | NavTag.work | NavTag.square, F.yaw);
  site.mark('town_hall', T.c.x, GROUND, T.c.z);
}

// ---------------------------------------------------------------------------
// Moon-bridge garden, bathhouse, poetry house, counting houses
// ---------------------------------------------------------------------------

function buildGarden(site: DistrictSite): void {
  const { env, nav } = site;
  const G = BSS.gardenW;
  const F = ringLocal(G.c);
  const b = env.chunks.named('props', 'mid_garden').builder;
  const mb = env.chunks.named('major', 'mid_garden_floor').builder;
  const grass = new THREE.CircleGeometry(G.r + 1.8, 32);
  grass.rotateX(-Math.PI / 2);
  mb.mesh(env.mats.leafLight, grass, { x: G.c.x, y: GROUND + 0.075, z: G.c.z }, { castShadow: false });
  grass.dispose();
  const path = new THREE.RingGeometry(G.r - 0.2, G.r + 1.0, 48);
  path.rotateX(-Math.PI / 2);
  mb.mesh('stone_tan', path, { x: G.c.x, y: GROUND + 0.085, z: G.c.z }, { castShadow: false });
  path.dispose();
  site.water(b, { id: 'ba_sing_se:garden_pond', label: 'Garden pond', x: G.c.x, z: G.c.z, y: GROUND + 0.25, w: G.r * 1.55, d: G.r * 1.55, circle: true, capacity: 160, regen: 6, type: 'pond' });
  const rim = new THREE.TorusGeometry(G.r * 0.775 + 0.15, 0.32, 6, 48);
  rim.rotateX(-Math.PI / 2);
  mb.mesh('stone_light', rim, { x: G.c.x, y: GROUND + 0.2, z: G.c.z });
  rim.dispose();
  // Moon bridge along the ring (walkable arch), paths from the lane on both sides.
  const e0 = F.at(-(G.r - 0.4), 0), e1 = F.at(G.r - 0.4, 0);
  b.bridge({ a: new THREE.Vector3(e0.x, GROUND, e0.z), b: new THREE.Vector3(e1.x, GROUND, e1.z), width: 2.2, deck: 'wood_red', rail: 'wood_red', arch: 2.6 });
  for (const side of [-1, 1]) {
    const p0 = F.at(side * (G.r - 0.2), 0), p1 = F.at(side * (G.r + 4.5), 0);
    const geo = stripGeometry([p0, p1], 1.2, GROUND + 0.09, 3);
    mb.mesh('stone_tan', geo, { x: 0, y: 0, z: 0 }, { castShadow: false });
    geo.dispose();
  }
  for (let i = 0; i < 8; i++) {
    const a = ((22.5 + i * 45) * Math.PI) / 180;
    const p = F.at(Math.cos(a) * (G.r + 1.2), Math.sin(a) * (G.r + 1.2));
    tree(b, env.mats, p.x, GROUND, p.z, 0.85, i % 2 ? 'blossom' : 'round', a);
  }
  for (const lz of [-G.r - 0.4, G.r + 0.4]) {
    const p = F.at(0, lz);
    lanternPost(b, p.x, GROUND, p.z, 'warm');
  }
  for (const side of [-1, 1]) {
    const p = F.at(side * (G.r + 1.5), 0);
    nav.poi(p.x, p.z, NavTag.middle | NavTag.water | NavTag.bench, F.yaw - (side * Math.PI) / 2);
  }
  nav.street([F.at(-G.r - 5, 0), F.at(G.r + 5, 0)], NavTag.middle | NavTag.street, 8, 5);
  site.mark('moon_bridge', G.c.x, GROUND + 2.6, G.c.z);
}

function buildSpa(site: DistrictSite): void {
  const { env, bm, nav } = site;
  const S = BSS.spa;
  const F = ringLocal(S.c);
  const b = env.chunks.named('props', 'mid_spa').builder;
  const N8 = env.arch.N8;
  const bodyZ = S.hd - 0.6 - (N8.d * 1.3) / 2;
  house(site, 'N8', F, 0, bodyZ, F.yaw, 1.3, GROUND, WALLS_MID[1], ROOFS_MID[2]);
  const back = bodyZ - (N8.d * 1.3) / 2;
  // Walled courtyard with a steaming bath behind the house.
  blockFloor(site, 'mid_spa_floor', F, F.at(0, (back - S.hd) / 2), S.hw * 2 - 1, back + S.hd, 'stone_tan');
  const yawSeg = (lx0: number, lz0: number, lx1: number, lz1: number) => {
    const a = F.at(lx0, lz0), c = F.at(lx1, lz1);
    const len = Math.hypot(c.x - a.x, c.z - a.z);
    b.box('plaster_white', { x: (a.x + c.x) / 2, y: GROUND + 1.3, z: (a.z + c.z) / 2, sx: 0.5, sy: 2.6, sz: len, yaw: Math.atan2(c.x - a.x, c.z - a.z) }, { collide: true });
    b.box('roof_green', { x: (a.x + c.x) / 2, y: GROUND + 2.72, z: (a.z + c.z) / 2, sx: 0.9, sy: 0.24, sz: len + 0.3, yaw: Math.atan2(c.x - a.x, c.z - a.z) });
  };
  yawSeg(-S.hw, back, -S.hw, -S.hd);
  yawSeg(S.hw, back, S.hw, -S.hd);
  yawSeg(-S.hw, -S.hd, S.hw, -S.hd);
  const pool = F.at(0, (back - S.hd) / 2);
  site.water(b, { id: 'ba_sing_se:spa_bath', label: 'Bathhouse pool', x: pool.x, z: pool.z, y: GROUND + 0.3, w: 7.4, d: 7.4, circle: true, capacity: 90, regen: 4, type: 'pond' });
  for (let i = 0; i < 14; i++) {
    const a = (i / 14) * Math.PI * 2;
    b.box('stone_light', { x: pool.x + Math.cos(a) * 3.95, y: GROUND + 0.22, z: pool.z + Math.sin(a) * 3.95, sx: 0.55, sy: 0.44, sz: 1.8, yaw: Math.atan2(Math.cos(a), Math.sin(a)) + Math.PI / 2 }, { collide: true, walkable: true });
  }
  site.smoke.push({ x: pool.x + 1, y: GROUND + 0.8, z: pool.z, rate: 0.5, steam: true }, { x: pool.x - 1.2, y: GROUND + 0.8, z: pool.z + 0.8, rate: 0.4, steam: true });
  const sg = F.at(-3.4, S.hd - 0.5);
  sign(b, bm, '浴館', sg.x, GROUND + 2.6, sg.z, F.yaw, 1.3, { vertical: true });
  for (const side of [-1, 1]) {
    const l = F.at(side * 2.2, S.hd - 0.2);
    b.lantern(new THREE.Vector3(l.x, GROUND + 3.2, l.z), { color: 'red', hanging: true });
  }
  const door = F.at(0, S.hd + 1.4);
  nav.poi(door.x, door.z, NavTag.middle | NavTag.shop, F.yaw + Math.PI);
  site.mark('bathhouse', S.c.x, GROUND, S.c.z);
}

function buildPoetry(site: DistrictSite): void {
  const { env, bm, nav } = site;
  const P = BSS.poetry;
  const F = ringLocal(P.c);
  const b = env.chunks.named('props', 'mid_poetry').builder;
  blockFloor(site, 'mid_poetry_floor', F, P.c, P.hw * 2 - 0.6, P.hd * 2 - 0.6, env.mats.leafLight, 0.075);
  compoundWall(b, F, P.hw, P.hd, 1.9, 4);
  const pv = F.at(0, 5);
  pavilion(b, pv.x, GROUND, pv.z, 8, 6.5, 3.6, F.yaw, 'roof_green', 2);
  const s = F.at(0, 8.45);
  sign(b, bm, '詩社', s.x, GROUND + 3.15, s.z, F.yaw, 0.8, { vertical: false });
  const geo = stripGeometry([F.at(0, P.hd), F.at(0, 8.2)], 1.0, GROUND + 0.09, 3);
  env.chunks.named('major', 'mid_poetry_floor').builder.mesh('stone_tan', geo, { x: 0, y: 0, z: 0 }, { castShadow: false });
  geo.dispose();
  for (const [lx, lz, k] of [[-5.5, 10, 'blossom'], [5.5, 10, 'blossom'], [-5, -3, 'round'], [5, -3, 'cypress'], [-4.5, -10.5, 'round'], [4.5, -10.5, 'blossom']] as Array<[number, number, TreeKind]>) {
    const t = F.at(lx, lz);
    tree(b, env.mats, t.x, GROUND, t.z, 0.8, k, lx * lz);
  }
  for (const side of [-1, 1]) {
    const t = F.at(side * 2.4, -5);
    b.box('stone_light', { x: t.x, y: GROUND + 0.23, z: t.z, sx: 0.6, sy: 0.46, sz: 2.0, yaw: F.yaw }, { collide: true, walkable: true });
    nav.poi(t.x, t.z, NavTag.bench | NavTag.middle, F.yaw - (side * Math.PI) / 2);
  }
  nav.street([F.at(0, P.hd + 3), F.at(0, 2)], NavTag.middle | NavTag.street, 8, 5);
  const seat = F.at(0, 4.5);
  nav.poi(seat.x, seat.z, NavTag.middle | NavTag.bench | NavTag.tea, F.yaw + Math.PI);
  site.mark('poetry_house', P.c.x, GROUND, P.c.z);
}

function buildCountingHouses(site: DistrictSite): void {
  const { env, bm, nav } = site;
  const B = BSS.financial;
  const F = ringLocal(B.c);
  const names = ['錢莊', '銀號', '當鋪'];
  const s = 1.2;
  const w = env.arch.N7.w * s;
  for (let i = 0; i < 3; i++) {
    const lx = (i - 1) * (w + 0.7);
    house(site, 'N7', F, lx, B.hd - 0.3 - (env.arch.N7.d * s) / 2, F.yaw, s, GROUND, new THREE.Color(0.9, 0.9, 0.87), ROOFS_MID[i % ROOFS_MID.length]);
    const p = F.at(lx - w * 0.3, B.hd + 0.15);
    const b = env.chunks.at('props', p.x, p.z).builder;
    sign(b, bm, names[i], p.x, GROUND + 2.5, p.z, F.yaw, 1.5, { vertical: true, bg: '#20160e' });
    const d = F.at(lx, B.hd + 1.6);
    nav.poi(d.x, d.z, NavTag.middle | NavTag.shop | NavTag.work, F.yaw + Math.PI);
  }
  site.mark('financial_district', B.c.x, GROUND, B.c.z);
}

/** White garden walls with green tile coping along the lane; a round moon gate now and then. */
function laneWalls(site: DistrictSite, runs: Array<{ r: number; a: number; b: number }>): void {
  const { env } = site;
  const H = 2.3;
  let k = 0;
  for (const run of runs) {
    const n = Math.max(1, Math.ceil(((run.b - run.a) * run.r) / 6));
    for (let i = 0; i < n; i++) {
      k++;
      const t0 = run.a + ((run.b - run.a) * i) / n, t1 = run.a + ((run.b - run.a) * (i + 1)) / n;
      const a = polar(t0, run.r), c = polar(t1, run.r);
      const len = Math.hypot(c.x - a.x, c.z - a.z);
      const yaw = Math.atan2(c.x - a.x, c.z - a.z);
      const mx = (a.x + c.x) / 2, mz = (a.z + c.z) / 2;
      const b = env.chunks.at('props', mx, mz).builder;
      b.box('plaster_white', { x: mx, y: GROUND + H / 2, z: mz, sx: 0.4, sy: H, sz: len + 0.02, yaw }, { collide: true });
      b.box('roof_green', { x: mx, y: GROUND + H + 0.12, z: mz, sx: 0.85, sy: 0.24, sz: len + 0.1, yaw });
      b.box('stone_grey', { x: mx, y: GROUND + 0.22, z: mz, sx: 0.55, sy: 0.44, sz: len + 0.02, yaw });
      if (len > 4 && hash01(k, 341) < 0.22) {
        // Painted gate leaf facing the lane.
        const out = run.r < LANE.r ? 1 : -1;
        const tm = (t0 + t1) / 2;
        const p = polar(tm, run.r + out * 0.21);
        b.box('wood_red', { x: p.x, y: GROUND + 1.0, z: p.z, sx: 0.06, sy: 2.0, sz: 1.3, yaw });
        b.box('gold', { x: p.x, y: GROUND + 1.0, z: p.z, sx: 0.08, sy: 0.08, sz: 0.08, yaw });
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Dressing: street trees, planters, lanterns, shop fronts
// ---------------------------------------------------------------------------

function dressMiddle(site: DistrictSite, houses: PlacedHouse[], radials: number[], laneTrees: P2[]): void {
  const { env, bm, nav } = site;
  // Trees along the foot of both ring walls (clear of gates and viaduct crossings) and along the lane.
  const crossings = [...railCrossings(R.upper), ...railCrossings(R.middle)].map((c) => c.theta);
  let k = 0;
  for (const r of [FOOT.upperOut + 2.6, FOOT.middleIn - 2.6]) {
    for (let t = 0.02; t < Math.PI * 2; t += 12.5 / r) {
      k++;
      const tt = t + (hash01(k, 311) - 0.5) * (3 / r);
      const p = polar(tt, r);
      if (nearAvenue(tt, r, 7) || crossings.some((q) => Math.abs(angleDiff(q, tt)) * r < 16) || env.excl.pointBlocked(p.x, p.z, 1.4)) continue;
      const b = env.chunks.at('props', p.x, p.z).builder;
      if (hash01(k, 312) < 0.8) tree(b, env.mats, p.x, GROUND, p.z, 0.75 + hash01(k, 313) * 0.35, TREES[k % TREES.length], k);
      else planter(b, env.mats, p.x, GROUND, p.z, 1.1);
    }
  }
  for (const p of laneTrees) {
    k++;
    const b = env.chunks.at('props', p.x, p.z).builder;
    if (hash01(k, 314) < 0.78) tree(b, env.mats, p.x, GROUND, p.z, 0.62 + hash01(k, 315) * 0.25, k % 3 ? 'blossom' : 'round', k);
    else planter(b, env.mats, p.x, GROUND, p.z, 0.9);
  }
  // Back-garden trees rising over the lane walls.
  const laneIn = LANE.r - LANE.width / 2 - LANE.strip, laneOut = LANE.r + LANE.width / 2 + LANE.strip;
  for (let i = 0; i < houses.length; i++) {
    const h = houses[i];
    if (hash01(i, 331) > 0.55) continue;
    const rh = Math.hypot(h.x - C.x, h.z - C.z);
    const r = rh < LANE.r ? laneIn - 1.3 : laneOut + 1.3;
    const p = polar(h.theta + (hash01(i, 332) - 0.5) * (h.w * 0.6) / r, r);
    if (env.excl.pointBlocked(p.x, p.z, 0.7)) continue;
    tree(env.chunks.at('props', p.x, p.z).builder, env.mats, p.x, GROUND, p.z, 0.7 + hash01(i, 333) * 0.3, TREES[i % TREES.length], i);
  }
  // Lantern posts at the corners where cross streets meet the ring roads.
  const r0 = RING_STREETS.middleIn.r + RING_STREETS.middleIn.width / 2, r1 = RING_STREETS.middleOut.r - RING_STREETS.middleOut.width / 2;
  for (const t of radials) {
    for (const [r, side] of [[r0 + 0.8, 1], [r1 - 0.8, -1]] as const) {
      // On the cross street's own edge: radials were planned clear of piers and lifts.
      const p = polar(t + (side * (RADIAL_W / 2 - 0.35)) / r, r);
      lanternPost(env.chunks.at('props', p.x, p.z).builder, p.x, GROUND, p.z, 'warm');
    }
  }
  // Shop fronts, tea houses and restaurants.
  for (let i = 0; i < houses.length; i++) {
    const h = houses[i];
    const u = hash01(i, 321);
    const fx = Math.sin(h.yaw), fz = Math.cos(h.yaw), lx = Math.cos(h.yaw), lz = -Math.sin(h.yaw);
    const db = env.chunks.at('detail', h.x, h.z).builder;
    if (h.id === 'N3' || h.id === 'N3b') {
      crates(db, h.door.x + lx * 2.2 + fx * 0.9, GROUND, h.door.z + lz * 2.2 + fz * 0.9, env.rnd, 2);
      db.lantern(new THREE.Vector3(h.door.x + fx * 0.3 + lx * 1.8, GROUND + 3.0, h.door.z + fz * 0.3 + lz * 1.8), { color: 'red', hanging: true });
      if (u < 0.55) sign(db, bm, SHOP_SIGNS[i % SHOP_SIGNS.length], h.door.x - lx * 2.6 - fx * 0.5, GROUND + 2.3, h.door.z - lz * 2.6 - fz * 0.5, h.yaw, 1.2, { vertical: true });
    } else if (h.id === 'N8' && u < 0.35) {
      for (const s of [-1, 1]) db.lantern(new THREE.Vector3(h.door.x + fx * 0.4 + lx * s * 2.2, GROUND + 3.2, h.door.z + fz * 0.4 + lz * s * 2.2), { color: 'warm', hanging: true });
      const tx = h.door.x + fx * 1.6, tz = h.door.z + fz * 1.6;
      db.cylinder('wood', { x: tx, y: GROUND + 0.72, z: tz, r: 0.6, h: 0.08, segments: 10 });
      db.cylinder('wood_dark', { x: tx, y: GROUND, z: tz, r: 0.1, h: 0.72, segments: 6 });
      sign(db, bm, u < 0.18 ? '茶館' : '酒樓', h.door.x - lx * 2.9 - fx * 0.5, GROUND + 2.4, h.door.z - lz * 2.9 - fz * 0.5, h.yaw, 1.4, { vertical: true });
      nav.poi(tx + lx * 1.1, tz + lz * 1.1, NavTag.tea | NavTag.bench | NavTag.middle, h.yaw - Math.PI / 2);
    } else if (u < 0.3) {
      planter(db, env.mats, h.door.x + lx * 2.3 + fx * 0.5, GROUND, h.door.z + lz * 2.3 + fz * 0.5, 0.8);
    }
  }
}
