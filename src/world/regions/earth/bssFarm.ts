import * as THREE from 'three';
import type { ContentBuilder } from '../../kit/Builder';
import type { P2 } from '../../WorldLayout';
import { waterAt } from '../../Heightfield';
import { stripGeometry } from './geom';
import { crates, lanternPost, paifang, tree, type TreeKind } from './parts';
import { BSS, C, FARM_ROADS, GROUND, THETA_MAIN, angleDiff, hash01, polar, thetaOf, wrapAngle } from './bssLayout';
import { frameAt, sign, type Frame } from './bssKit';
import type { DistrictSite } from './bssLower';
import { NavTag } from './bssNav';

/**
 * Agrarian Zone between the Inner and Outer Walls: a patchwork of rice
 * paddies (some flooded — real water), cabbage rows, grain, orchards, pasture
 * and fallow, irrigation canals (real water), dirt tracks, farmsteads with
 * barns and granaries, three rocky hills, the zoo, and the arrival gateway
 * (歡迎光臨永固城) with the passport hall. Everything is planned around the
 * roads, viaduct piers, station lifts, Lake Laogai and the Dai Li hill first.
 */

type FieldKind = 'paddy' | 'cabbage' | 'grain' | 'orchard' | 'pasture' | 'fallow';
const KINDS: Array<[FieldKind, number]> = [['paddy', 30], ['cabbage', 18], ['grain', 20], ['orchard', 12], ['pasture', 12], ['fallow', 8]];
/** Field rings (radii), dirt ring tracks and the irrigation canal ring between them. */
const RINGS: Array<[number, number]> = [[259, 283.4], [287.6, 313.6], [318.8, 345.6], [349.8, 381]];
const TRACKS = [285.5, 347.7];
const CANAL = { r: 316.2, w: 2.6 };
const DIKE = 1.4;

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

/** Curved field patch between radii r0..r1 and angles t0..t1 (UVs in metres / tile). */
function patchGeometry(r0: number, r1: number, t0: number, t1: number, y: number, tile: number): THREE.BufferGeometry {
  const n = Math.max(2, Math.ceil(((t1 - t0) * r1) / 5));
  const pos: number[] = [], uv: number[] = [], idx: number[] = [];
  for (let i = 0; i <= n; i++) {
    const t = t0 + ((t1 - t0) * i) / n;
    for (const r of [r0, r1]) {
      pos.push(C.x + Math.cos(t) * r, y, C.z + Math.sin(t) * r);
      uv.push(((t - t0) * r) / tile, (r - r0) / tile);
    }
  }
  for (let i = 0; i < n; i++) {
    const a = i * 2;
    idx.push(a, a + 2, a + 1, a + 1, a + 2, a + 3);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

/** Arcs of a ring that are free of obstacles (sampled every metre). */
function freeArcs(free: (t: number) => boolean, r: number, minLen: number): Array<[number, number]> {
  const N = Math.ceil(Math.PI * 2 * r);
  const ok = new Uint8Array(N);
  for (let i = 0; i < N; i++) ok[i] = free((i / N) * Math.PI * 2) ? 1 : 0;
  const start = ok.indexOf(0);
  if (start < 0) return [[0, Math.PI * 2]];
  const out: Array<[number, number]> = [];
  let run = -1;
  for (let k = 1; k <= N; k++) {
    const f = ok[(start + k) % N] === 1;
    if (f && run < 0) run = start + k;
    if (!f && run >= 0) {
      if (start + k - 1 - run >= minLen) out.push([(run / N) * Math.PI * 2, ((start + k - 1) / N) * Math.PI * 2]);
      run = -1;
    }
  }
  return out;
}

export function* buildFarmland(site: DistrictSite): Generator<unknown, void, unknown> {
  const { env, bm, nav } = site;
  const FT = NavTag.farm;
  const hard = (x: number, z: number, m: number) => env.excl.pointBlocked(x, z, m);
  // ---- Reserve roads, the lake, the Dai Li hill, the zoo, the hills and the arrival gateway.
  for (const rd of FARM_ROADS) {
    env.excl.polyline(rd.points, rd.width / 2 + 1.2);
    nav.street(rd.points, FT | NavTag.street, 10, 6);
  }
  env.excl.circle(BSS.lake.x, BSS.lake.z, BSS.lake.r + 7);
  const H = BSS.laogai.hill;
  env.excl.circle(H.x, H.z, Math.max(H.rx, H.rz) + 5);
  env.excl.circle(BSS.laogai.door.x, BSS.laogai.door.z, 12);
  env.excl.circle(BSS.zoo.x, BSS.zoo.z, 34);
  for (const h of BSS.hills) env.excl.circle(h.x, h.z, 36);
  // The welcome gateway's posts and the passport hall must miss the viaduct piers over the road.
  let gateR = BSS.arrivalGate.r;
  for (let r = BSS.arrivalGate.r; r >= BSS.arrivalGate.r - 10; r -= 1) {
    const F = frameAt(polar(THETA_MAIN, r).x, polar(THETA_MAIN, r).z, -Math.cos(THETA_MAIN), -Math.sin(THETA_MAIN));
    const ok = [F.at(-6.7, 0), F.at(6.7, 0), F.at(-21, -4), F.at(-21, 13), F.at(-25, 4), F.at(-17, 4)].every((q) => !hard(q.x, q.z, 1.0));
    if (ok) {
      gateR = r;
      break;
    }
  }
  const gw = polar(THETA_MAIN, gateR);
  env.excl.circle(gw.x, gw.z, 30);
  yield;
  // ---- Dirt ring tracks and the irrigation canal ring.
  const gb = env.chunks.named('major', 'farm_tracks').builder;
  const trackArcs: Array<{ r: number; a: number; b: number }> = [];
  for (const r of TRACKS) {
    for (const [a, b] of freeArcs((t) => !hard(polar(t, r).x, polar(t, r).z, 2.2), r, 12)) trackArcs.push({ r, a, b });
  }
  const canalArcs = freeArcs((t) => {
    const p = polar(t, CANAL.r);
    return !hard(p.x, p.z, CANAL.w / 2 + 1.0);
  }, CANAL.r, 16);
  for (const t of trackArcs) {
    const pts: P2[] = [];
    for (let a = t.a; a <= t.b; a += 4 / t.r) pts.push(polar(a, t.r));
    pts.push(polar(t.b, t.r));
    const g = stripGeometry(pts, 1.6, GROUND + 0.045, 5);
    gb.mesh(bm.mudTrack, g, { x: 0, y: 0, z: 0 }, { castShadow: false });
    g.dispose();
    env.excl.polyline(pts, 1.9);
    nav.street(pts, FT | NavTag.street, 10, 5);
  }
  let seg = 0;
  for (const [a, b] of canalArcs) {
    const pts: P2[] = [];
    for (let t = a; t <= b; t += 3 / CANAL.r) pts.push(polar(t, CANAL.r));
    pts.push(polar(b, CANAL.r));
    for (const side of [-1, 1]) {
      const bank = stripGeometry(pts, 0.35, GROUND + 0.22, 3);
      bank.translate(0, 0, 0);
      const off = pts.map((p) => {
        const t = thetaOf(p.x, p.z);
        return polar(t, CANAL.r + side * (CANAL.w / 2 + 0.35));
      });
      const g = stripGeometry(off, 0.35, GROUND + 0.2, 3);
      gb.mesh('stone_tan', g, { x: 0, y: 0, z: 0 }, { castShadow: false });
      g.dispose();
      bank.dispose();
    }
    env.excl.polyline(pts, CANAL.w / 2 + 0.8);
    const wg = stripGeometry(pts, CANAL.w / 2 + 0.05, GROUND + 0.12, 4);
    gb.mesh(bm.canal, wg, { x: 0, y: 0, z: 0 }, { castShadow: false });
    wg.dispose();
    // Real water in straight segments of ~12 m (each a source for waterbenders; drawn by the strip above).
    const n = Math.max(1, Math.round(((b - a) * CANAL.r) / 12));
    for (let i = 0; i < n; i++) {
      const t0 = a + ((b - a) * i) / n, t1 = a + ((b - a) * (i + 1)) / n;
      const p0 = polar(t0, CANAL.r), p1 = polar(t1, CANAL.r);
      const len = Math.hypot(p1.x - p0.x, p1.z - p0.z);
      seg++;
      site.water(gb, { id: `ba_sing_se:farm_canal_${seg}`, label: 'Irrigation canal', x: (p0.x + p1.x) / 2, z: (p0.z + p1.z) / 2, y: GROUND + 0.12, w: len + 0.3, d: CANAL.w, yaw: Math.atan2(p1.x - p0.x, p1.z - p0.z) + Math.PI / 2, capacity: 60, regen: 5, type: 'canal', material: bm.hiddenWater });
    }
  }
  site.mark('farmCanals', seg, trackArcs.length, 0);
  yield;
  // ---- Fields.
  let fields = 0, steads = 0, flooded = 0, k = 0;
  const radialTracks: Array<{ t: number; r0: number; r1: number }> = [];
  for (const [ra, rb] of RINGS) {
    const rm = (ra + rb) / 2;
    let t = hash01(Math.round(ra), 1) * 0.05;
    let sinceTrack = 0;
    while (t < Math.PI * 2 - 0.02) {
      k++;
      const L = 22 + hash01(k, 2) * 16;
      const t0 = t, t1 = t + L / rm;
      sinceTrack++;
      const track = sinceTrack >= 4 && hash01(k, 3) < 0.45;
      t = t1 + (track ? 3.2 : DIKE) / rm;
      if (track) {
        sinceTrack = 0;
        radialTracks.push({ t: t1 + 1.6 / rm, r0: ra - 1, r1: rb + 1 });
      }
      // Skip the cell if anything stands in it.
      let blocked = false;
      for (let i = 0; i <= 4 && !blocked; i++) {
        for (let j = 0; j <= 3 && !blocked; j++) {
          const r = ra + 0.8 + ((rb - ra - 1.6) * j) / 3;
          const p = polar(t0 + 0.8 / r + ((t1 - t0 - 1.6 / r) * i) / 4, r);
          if (hard(p.x, p.z, 0.3) || waterAt(p.x, p.z)) blocked = true;
        }
      }
      if (blocked) continue;
      const u = hash01(k, 4);
      if (u < 0.1 && (ra < 290 || ra > 345)) {
        farmstead(site, ra, rb, t0, t1, k);
        steads++;
        continue;
      }
      const kind = pick(KINDS, hash01(k, 5));
      fields++;
      if (kind === 'paddy' && hash01(k, 6) < 0.28) {
        // Flooded paddy: real standing water in a rectangle inscribed in the cell.
        const c = polar((t0 + t1) / 2, rm);
        const w = (t1 - t0) * ra - 1.5, d = rb - ra - 1.5;
        flooded++;
        site.water(gb, { id: `ba_sing_se:paddy_${k}`, label: 'Flooded rice paddy', x: c.x, z: c.z, y: GROUND + 0.1, w, d, yaw: Math.atan2(-Math.sin((t0 + t1) / 2), Math.cos((t0 + t1) / 2)) + Math.PI / 2, capacity: 50, regen: 4, type: 'pond' });
        dikes(gb, ra, rb, t0, t1);
        continue;
      }
      const mat = kind === 'orchard' ? bm.fields.pasture : bm.fields[kind];
      const g = patchGeometry(ra, rb, t0, t1, GROUND + 0.035, 8);
      fieldChunk(site, (t0 + t1) / 2).mesh(mat, g, { x: 0, y: 0, z: 0 }, { castShadow: false });
      g.dispose();
      if (kind === 'paddy') dikes(gb, ra, rb, t0, t1);
      dressField(site, kind, ra, rb, t0, t1, k);
      const pc = polar((t0 + t1) / 2, rb + 0.4);
      nav.poi(pc.x, pc.z, FT | NavTag.field | NavTag.work, 0, 16);
    }
    yield;
  }
  for (const rt of radialTracks) {
    const a = polar(rt.t, rt.r0), b = polar(rt.t, rt.r1);
    if (hard((a.x + b.x) / 2, (a.z + b.z) / 2, 1.2) && hard(a.x, a.z, 1.2)) continue;
    const g = stripGeometry([a, b], 1.5, GROUND + 0.04, 5);
    gb.mesh(bm.mudTrack, g, { x: 0, y: 0, z: 0 }, { castShadow: false });
    g.dispose();
    nav.street([a, b], FT | NavTag.street, 10, 6);
  }
  site.mark('farmFields', fields, steads, flooded);
  yield;
  for (let i = 0; i < BSS.hills.length; i++) hill(site, BSS.hills[i], i);
  zoo(site);
  arrivalGateway(site, gateR);
  yield;
}

/** Low earthen dikes round a paddy. */
function dikes(b: ContentBuilder, ra: number, rb: number, t0: number, t1: number): void {
  for (const r of [ra + 0.3, rb - 0.3]) {
    const pts: P2[] = [];
    for (let t = t0; t <= t1 + 1e-6; t += 4 / r) pts.push(polar(Math.min(t, t1), r));
    const g = stripGeometry(pts, 0.32, GROUND + 0.16, 3);
    b.mesh('stone_tan', g, { x: 0, y: 0, z: 0 }, { castShadow: false });
    g.dispose();
  }
}

function dressField(site: DistrictSite, kind: FieldKind, ra: number, rb: number, t0: number, t1: number, k: number): void {
  const { env } = site;
  const rm = (ra + rb) / 2, tm = (t0 + t1) / 2;
  const c = polar(tm, rm);
  const b = env.chunks.at('props', c.x, c.z).builder;
  if (kind === 'orchard') {
    let n = 0;
    for (let r = ra + 3; r < rb - 2; r += 6.2) {
      for (let t = t0 + 3 / r; t < t1 - 2 / r; t += 6.2 / r) {
        n++;
        const p = polar(t, r);
        tree(b, env.mats, p.x, GROUND, p.z, 0.55 + hash01(k, n) * 0.15, hash01(k, 50) < 0.5 ? 'blossom' : 'round', k + n);
      }
    }
  } else if (kind === 'pasture') {
    const fence = (pts: P2[]) => {
      for (let i = 0; i < pts.length - 1; i++) {
        const a = pts[i], e = pts[i + 1];
        const len = Math.hypot(e.x - a.x, e.z - a.z), yaw = Math.atan2(e.x - a.x, e.z - a.z);
        b.box('wood', { x: (a.x + e.x) / 2, y: GROUND + 1.0, z: (a.z + e.z) / 2, sx: 0.08, sy: 0.1, sz: len, yaw }, { collide: true, walkable: false });
        b.box('wood', { x: (a.x + e.x) / 2, y: GROUND + 0.55, z: (a.z + e.z) / 2, sx: 0.08, sy: 0.1, sz: len, yaw });
        b.box('wood_dark', { x: a.x, y: GROUND + 0.6, z: a.z, sx: 0.14, sy: 1.2, sz: 0.14 });
      }
    };
    const arc = (r: number) => {
      const pts: P2[] = [];
      for (let t = t0 + 0.6 / r; t <= t1 - 0.6 / r + 1e-6; t += 3.2 / r) pts.push(polar(Math.min(t, t1 - 0.6 / r), r));
      return pts;
    };
    const inner = arc(ra + 0.6), outer = arc(rb - 0.6);
    fence(inner);
    fence(outer);
    // Gate gap in the middle of the near side end: leave one side open.
    fence([inner[0], outer[0]]);
    for (let i = 0; i < 3; i++) {
      const p = polar(t0 + (t1 - t0) * (0.25 + hash01(k, 70 + i) * 0.5), ra + (rb - ra) * (0.3 + hash01(k, 80 + i) * 0.4));
      b.cylinder(env.mats.hay, { x: p.x, y: GROUND, z: p.z, r: 1.1, rTop: 0.2, h: 1.9, segments: 10 }, { collide: true });
    }
  } else if ((kind === 'grain' || kind === 'cabbage') && hash01(k, 60) < 0.35) {
    const p = polar(tm + (hash01(k, 61) - 0.5) * (t1 - t0) * 0.5, rm);
    b.cylinder('wood_dark', { x: p.x, y: GROUND, z: p.z, r: 0.07, h: 2.0, segments: 5 });
    b.box('wood_dark', { x: p.x, y: GROUND + 1.55, z: p.z, sx: 1.6, sy: 0.07, sz: 0.07, yaw: tm });
    b.box('cloth_orange', { x: p.x, y: GROUND + 1.3, z: p.z, sx: 0.7, sy: 0.7, sz: 0.25, yaw: tm });
    b.cylinder(env.mats.hay, { x: p.x, y: GROUND + 2.0, z: p.z, r: 0.55, rTop: 0.05, h: 0.4, segments: 8 });
  }
}

/** Farmhouse, barn, granary, shed and haystacks round a mud yard. */
/** Field and yard surfaces share four quadrant chunks (a few draw calls each instead of one per 128 m cell). */
function fieldChunk(site: DistrictSite, theta: number): ContentBuilder {
  return site.env.chunks.named('major', `fields:${Math.floor(wrapAngle(theta) / (Math.PI / 2)) % 4}`).builder;
}

function farmstead(site: DistrictSite, ra: number, rb: number, t0: number, t1: number, k: number): void {
  const { env, bm, nav } = site;
  const rm = (ra + rb) / 2, tm = (t0 + t1) / 2;
  const c = polar(tm, rm);
  // Face the nearest dirt track (outer edge of ring A, inner edge of ring D).
  const out = ra > 300 ? -1 : 1;
  const F = frameAt(c.x, c.z, Math.cos(tm) * out, Math.sin(tm) * out);
  const yard = new THREE.PlaneGeometry((t1 - t0) * ra - 2, rb - ra - 2);
  yard.rotateX(-Math.PI / 2);
  fieldChunk(site, tm).mesh(bm.mud, yard, { x: c.x, y: GROUND + 0.03, z: c.z, yaw: F.yaw }, { castShadow: false });
  yard.dispose();
  const put = (id: 'F1' | 'F2' | 'F3', lx: number, lz: number, yaw: number, s = 1) => {
    const p = F.at(lx, lz);
    env.chunks.addHouse(env.arch[id], p.x, GROUND, p.z, F.yaw + yaw, { scale: s });
    env.excl.box(p.x, p.z, (env.arch[id].w * s) / 2 + 0.3, (env.arch[id].d * s) / 2 + 0.3, F.yaw + yaw);
  };
  put('F1', -6, -5, 0);
  put('F2', 7, -6, 0, 1.0);
  put('F3', -10.5, 4, Math.PI / 2);
  const b = env.chunks.at('props', c.x, c.z).builder;
  const silo = F.at(1, 5);
  b.cylinder('plaster_cream', { x: silo.x, y: GROUND, z: silo.z, r: 2.0, h: 5.4, segments: 14 }, { collide: true });
  b.cylinder('roof_dark', { x: silo.x, y: GROUND + 5.4, z: silo.z, r: 2.5, rTop: 0.2, h: 2.2, segments: 14 });
  for (const [lx, lz] of [[6, 5], [9, 3.5]]) {
    const p = F.at(lx, lz);
    b.cylinder(env.mats.hay, { x: p.x, y: GROUND, z: p.z, r: 1.3, rTop: 0.25, h: 2.3, segments: 10 }, { collide: true });
  }
  const well = F.at(-3, 4);
  b.cylinder('stone_grey', { x: well.x, y: GROUND, z: well.z, r: 0.75, h: 0.8, segments: 10 }, { collide: true });
  crates(b, F.at(4, -1).x, GROUND, F.at(4, -1).z, env.rnd, 3);
  const door = F.at(-6, 1);
  nav.poi(door.x, door.z, NavTag.farm | NavTag.home, F.yaw, 22);
  nav.poi(F.at(7, 0).x, F.at(7, 0).z, NavTag.farm | NavTag.work, F.yaw, 22);
  void k;
}

/** Rocky hill: a noisy dome of rammed earth and stone with trees on its shoulders. */
function hill(site: DistrictSite, c: P2, i: number): void {
  const { env, bm } = site;
  const R = 28 + i * 3, Hh = 24 + i * 5;
  const rings = 12, segs = 36;
  const pos: number[] = [], uv: number[] = [], idx: number[] = [];
  const height = (rho: number, a: number) => {
    const n = 1 + 0.16 * Math.sin(a * 3 + i) + 0.1 * Math.sin(a * 7 + i * 2) + 0.07 * Math.sin(a * 13 + rho * 9) + 0.05 * Math.sin(a * 23 + rho * 17);
    // Steep rock faces low down, a rounded crown, a few terraces.
    const base = Math.pow(Math.max(0, 1 - Math.pow(rho, 1.8)), 0.75);
    const terr = Math.round(base * 6) / 6;
    return Hh * (base * 0.75 + terr * 0.25) * n - 1.5 * rho;
  };
  pos.push(c.x, GROUND + height(0, 0), c.z);
  uv.push(0, 0);
  for (let r = 1; r <= rings; r++) {
    const rho = r / rings;
    for (let s = 0; s < segs; s++) {
      const a = (s / segs) * Math.PI * 2;
      const rr = R * rho * (1 + 0.12 * Math.sin(a * 5 + i * 1.7));
      pos.push(c.x + Math.cos(a) * rr, GROUND + height(rho, a), c.z + Math.sin(a) * rr);
      uv.push(Math.cos(a) * rr * 0.1, Math.sin(a) * rr * 0.1);
    }
  }
  for (let s = 0; s < segs; s++) idx.push(0, 1 + ((s + 1) % segs), 1 + s);
  for (let r = 1; r < rings; r++) {
    for (let s = 0; s < segs; s++) {
      const a = 1 + (r - 1) * segs + s, b = 1 + (r - 1) * segs + ((s + 1) % segs);
      const c2 = a + segs, d = b + segs;
      idx.push(a, b, c2, b, d, c2);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  const b = env.chunks.named('major', `farm_hill_${i}`).builder;
  b.mesh(bm.rock, g, { x: 0, y: 0, z: 0 });
  g.dispose();
  for (let k = 0; k < 5; k++) {
    const y0 = (k / 5) * Hh, y1 = ((k + 1) / 5) * Hh;
    const rr = R * Math.sqrt(Math.max(0.05, 1 - Math.pow(y1 / Hh, 1 / 0.9))) * 0.92;
    b.collider({ shape: 'cylinder', x: c.x, y: GROUND + (y0 + y1) / 2, z: c.z, r: rr, hy: (y1 - y0) / 2, walkable: true, solid: true, surface: 'stone' });
  }
  for (let k = 0; k < 7; k++) {
    const a = hash01(i, k, 90) * Math.PI * 2, rho = 0.35 + hash01(i, k, 91) * 0.4;
    const x = c.x + Math.cos(a) * R * rho, z = c.z + Math.sin(a) * R * rho;
    tree(env.chunks.at('props', x, z).builder, env.mats, x, GROUND + height(rho, a) - 0.4, z, 0.8, (['cypress', 'round'] as TreeKind[])[k % 2], k, false);
  }
  site.mark(`hill_${i}`, c.x, GROUND + Hh, c.z);
}

// ---------------------------------------------------------------------------
// Zoo
// ---------------------------------------------------------------------------

/** A sphere scaled into an ellipsoid (baked). */
function blob(sx: number, sy: number, sz: number): THREE.BufferGeometry {
  const g = new THREE.SphereGeometry(1, 12, 9);
  g.scale(sx, sy, sz);
  return g;
}

function animal(b: ContentBuilder, kind: number, x: number, z: number, yaw: number): void {
  const fx = Math.sin(yaw), fz = Math.cos(yaw), rx = Math.cos(yaw), rz = -Math.sin(yaw);
  const at = (f: number, r: number) => ({ x: x + fx * f + rx * r, z: z + fz * f + rz * r });
  const part = (mat: Parameters<ContentBuilder['mesh']>[0], g: THREE.BufferGeometry, f: number, r: number, y: number) => {
    const p = at(f, r);
    b.mesh(mat, g, { x: p.x, y: GROUND + y, z: p.z, yaw });
    g.dispose();
  };
  const legs = (mat: Parameters<ContentBuilder['mesh']>[0], h: number, sf: number, sr: number, rr: number) => {
    for (const f of [-sf, sf]) for (const r of [-sr, sr]) {
      const p = at(f, r);
      b.cylinder(mat, { x: p.x, y: GROUND, z: p.z, r: rr, h, segments: 6 });
    }
  };
  if (kind === 0) {
    // Platypus-bear: heavy brown body, flat bill.
    legs('wood_dark', 0.9, 0.8, 0.55, 0.22);
    part('wood_dark', blob(1.5, 0.9, 1.0), 0, 0, 1.6);
    part('wood_dark', blob(0.55, 0.5, 0.55), 1.55, 0, 2.1);
    part('cloth_yellow', blob(0.42, 0.1, 0.55), 2.15, 0, 2.0);
  } else if (kind === 1) {
    // Ostrich-horse: tan body on long legs, long neck.
    for (const r of [-0.25, 0.25]) {
      const p = at(0, r);
      b.cylinder('wood', { x: p.x, y: GROUND, z: p.z, r: 0.08, h: 1.4, segments: 5 });
    }
    part('plaster_tan', blob(0.8, 0.55, 0.5), 0, 0, 1.75);
    const n = at(0.7, 0);
    b.cylinder('plaster_tan', { x: n.x, y: GROUND + 1.9, z: n.z, r: 0.12, h: 1.1, segments: 6 });
    part('plaster_tan', blob(0.28, 0.22, 0.42), 0.85, 0, 3.05);
    part('wood_dark', blob(0.5, 0.35, 0.12), -0.85, 0, 2.0);
  } else if (kind === 2) {
    // Hippo-ox: grey-blue bulk with horns.
    legs('stone_grey', 0.7, 0.9, 0.6, 0.28);
    part('stone_grey', blob(1.7, 0.95, 1.15), 0, 0, 1.45);
    part('stone_grey', blob(0.7, 0.6, 0.65), 1.8, 0, 1.6);
    for (const r of [-0.45, 0.45]) {
      const p = at(1.85, r);
      b.cylinder('stone_light', { x: p.x, y: GROUND + 2.0, z: p.z, r: 0.1, rTop: 0.02, h: 0.6, segments: 5 });
    }
  } else {
    // Armadillo-lion: banded shell, maned head.
    legs('wood', 0.6, 0.7, 0.45, 0.18);
    part('stone_tan', blob(1.25, 0.75, 0.85), 0, 0, 1.2);
    for (let i = -1; i <= 1; i++) part('wood_dark', blob(0.2, 0.78, 0.88), i * 0.5, 0, 1.22);
    part('cloth_orange', blob(0.62, 0.62, 0.62), 1.3, 0, 1.45);
    part('wood', blob(0.38, 0.36, 0.42), 1.62, 0, 1.45);
  }
}

function zoo(site: DistrictSite): void {
  const { env, bm, nav } = site;
  const Z = BSS.zoo;
  const tz = thetaOf(Z.x, Z.z);
  // Entrance faces the city (inward).
  const F = frameAt(Z.x, Z.z, -Math.cos(tz), -Math.sin(tz));
  const b = env.chunks.named('props', 'farm_zoo').builder;
  const m = env.chunks.named('major', 'farm_zoo_ground').builder;
  const ground = new THREE.CircleGeometry(31, 40);
  ground.rotateX(-Math.PI / 2);
  {
    const uvs = ground.getAttribute('uv') as THREE.BufferAttribute;
    for (let i = 0; i < uvs.count; i++) uvs.setXY(i, uvs.getX(i) * 10, uvs.getY(i) * 10);
  }
  m.mesh(bm.lawn, ground, { x: Z.x, y: GROUND + 0.03, z: Z.z }, { castShadow: false });
  ground.dispose();
  const ring = new THREE.RingGeometry(22.5, 25.5, 56);
  ring.rotateX(-Math.PI / 2);
  m.mesh('paving', ring, { x: Z.x, y: GROUND + 0.05, z: Z.z }, { castShadow: false });
  ring.dispose();
  const g = F.at(0, 29.5);
  paifang(b, g.x, GROUND, g.z, F.yaw, 7, 6.2, { roof: 'roof_green' });
  const s = F.at(0, 29.9);
  sign(b, bm, '動物園', s.x, GROUND + 4.6, s.z, F.yaw, 0.9, { vertical: false });
  // Four enclosures round the keeper's hut, each with its own ground and animals.
  const grounds = [bm.fields.pasture, bm.mud, bm.fields.fallow, bm.fields.grain];
  for (let i = 0; i < 4; i++) {
    const a = Math.PI / 4 + (i * Math.PI) / 2;
    const ec = F.at(Math.cos(a) * 13.5, Math.sin(a) * 13.5);
    const E = frameAt(ec.x, ec.z, ec.x - Z.x, ec.z - Z.z);
    const pen = new THREE.PlaneGeometry(10, 8);
    pen.rotateX(-Math.PI / 2);
    m.mesh(grounds[i], pen, { x: ec.x, y: GROUND + 0.04, z: ec.z, yaw: E.yaw }, { castShadow: false });
    pen.dispose();
    for (const [x0, z0, x1, z1] of [[-5, -4, 5, -4], [-5, 4, 5, 4], [-5, -4, -5, 4], [5, -4, 5, 4]]) {
      const p0 = E.at(x0, z0), p1 = E.at(x1, z1);
      const len = Math.hypot(p1.x - p0.x, p1.z - p0.z), yaw = Math.atan2(p1.x - p0.x, p1.z - p0.z);
      b.box('wood_dark', { x: (p0.x + p1.x) / 2, y: GROUND + 1.1, z: (p0.z + p1.z) / 2, sx: 0.12, sy: 0.12, sz: len, yaw }, { collide: true, walkable: false });
      b.box('wood_dark', { x: (p0.x + p1.x) / 2, y: GROUND + 0.55, z: (p0.z + p1.z) / 2, sx: 0.1, sy: 0.1, sz: len, yaw });
      for (let t = 0; t <= 1.001; t += 0.2) b.box('wood_red', { x: p0.x + (p1.x - p0.x) * t, y: GROUND + 0.65, z: p0.z + (p1.z - p0.z) * t, sx: 0.16, sy: 1.3, sz: 0.16 });
    }
    if (i === 1) {
      const w = E.at(1.5, -1);
      site.water(b, { id: 'ba_sing_se:zoo_pond', label: 'Zoo pond', x: w.x, z: w.z, y: GROUND + 0.18, w: 4.4, d: 4.4, circle: true, capacity: 40, regen: 3, type: 'pond' });
    }
    const an = E.at(-1.5, 0.8);
    animal(b, i, an.x, an.z, E.yaw + Math.PI / 2 + i * 0.7);
    const bench = E.at(0, 6.4);
    b.box('wood', { x: bench.x, y: GROUND + 0.45, z: bench.z, sx: 2.0, sy: 0.12, sz: 0.5, yaw: E.yaw }, { collide: true, walkable: true });
    nav.poi(bench.x, bench.z, NavTag.farm | NavTag.bench | NavTag.square, E.yaw + Math.PI, 18);
  }
  const hut = F.at(0, 0);
  env.chunks.addHouse(env.arch.F1, hut.x, GROUND, hut.z, F.yaw, { scale: 0.9 });
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2 + 0.2;
    const p = { x: Z.x + Math.cos(a) * 27.5, z: Z.z + Math.sin(a) * 27.5 };
    if (Math.abs(angleDiff(a, Math.atan2(g.z - Z.z, g.x - Z.x))) < 0.3) continue;
    tree(b, env.mats, p.x, GROUND, p.z, 0.85, i % 2 ? 'blossom' : 'round', i);
  }
  for (const lx of [-3.8, 3.8]) {
    const l = F.at(lx, 27.5);
    lanternPost(b, l.x, GROUND, l.z, 'red');
  }
  nav.street([F.at(0, 34), F.at(0, 24), F.at(0, 6)], NavTag.farm | NavTag.street | NavTag.square, 8, 8);
  const keeper = F.at(0, 5.2);
  nav.poi(keeper.x, keeper.z, NavTag.farm | NavTag.work, F.yaw + Math.PI, 18);
  site.mark('zoo', Z.x, GROUND, Z.z);
}

// ---------------------------------------------------------------------------
// Arrival gateway and passport hall
// ---------------------------------------------------------------------------

function arrivalGateway(site: DistrictSite, r: number): void {
  const { env, bm, nav } = site;
  const p = polar(THETA_MAIN, r);
  // Local +Z points into the city along the West road.
  const F: Frame = frameAt(p.x, p.z, -Math.cos(THETA_MAIN), -Math.sin(THETA_MAIN));
  const b = env.chunks.named('props', 'farm_arrival').builder;
  paifang(b, p.x, GROUND, p.z, F.yaw, 13, 9.5, { roof: 'roof_green', posts: 4 });
  for (const side of [1, -1]) {
    const s = F.at(0, side * 0.45);
    sign(b, bm, '歡迎光臨永固城', s.x, GROUND + 6.9, s.z, F.yaw + (side > 0 ? 0 : Math.PI), 1.25, { vertical: false });
  }
  // Passport hall beside the road (south side), counters facing the arrivals.
  const hc = F.at(-21, 4);
  const Hf = frameAt(hc.x, hc.z, Math.sin(F.yaw + Math.PI / 2), Math.cos(F.yaw + Math.PI / 2));
  const floor = new THREE.PlaneGeometry(18, 8);
  floor.rotateX(-Math.PI / 2);
  env.chunks.named('major', 'farm_arrival_floor').builder.mesh('paving', floor, { x: hc.x, y: GROUND + 0.06, z: hc.z, yaw: Hf.yaw }, { castShadow: false });
  floor.dispose();
  for (let lx = -8.5; lx <= 8.5 + 0.01; lx += 3.4) {
    for (const lz of [-3.6, 3.6]) {
      const q = Hf.at(lx, lz);
      b.cylinder('wood_red', { x: q.x, y: GROUND, z: q.z, r: 0.2, h: 4.2, segments: 8 }, { collide: true });
    }
  }
  b.box('wood_dark', { x: hc.x, y: GROUND + 4.3, z: hc.z, sx: 18.4, sy: 0.4, sz: 7.8, yaw: Hf.yaw });
  b.roof('roof_green', { x: hc.x, y: GROUND + 4.5, z: hc.z, w: 18.4, d: 7.8, height: 2.4, yaw: Hf.yaw, overhang: 0.9, curve: 0.8, style: 'hip', ridge: null });
  const back = Hf.at(0, -3.7);
  b.box('plaster_white', { x: back.x, y: GROUND + 2.1, z: back.z, sx: 17.6, sy: 4.2, sz: 0.3, yaw: Hf.yaw }, { collide: true });
  for (let i = 0; i < 4; i++) {
    const lx = -6 + i * 4;
    const desk = Hf.at(lx, -1.6);
    b.box('wood_dark', { x: desk.x, y: GROUND + 0.55, z: desk.z, sx: 2.6, sy: 1.1, sz: 0.8, yaw: Hf.yaw }, { collide: true });
    b.box('wood', { x: desk.x, y: GROUND + 1.13, z: desk.z, sx: 2.8, sy: 0.06, sz: 1.0, yaw: Hf.yaw });
    const lamp = Hf.at(lx, -1.6);
    b.lantern(new THREE.Vector3(lamp.x, GROUND + 3.2, lamp.z), { color: 'warm', hanging: true });
    const clerk = Hf.at(lx, -2.6);
    nav.poi(clerk.x, clerk.z, NavTag.farm | NavTag.station | NavTag.work, Hf.yaw, 20);
    const q = Hf.at(lx, 1.4);
    nav.poi(q.x, q.z, NavTag.farm | NavTag.station | NavTag.shop, Hf.yaw + Math.PI, 20);
    // Queue rails.
    for (const dx of [-0.9, 0.9]) {
      const a = Hf.at(lx + dx, -0.8), e = Hf.at(lx + dx, 3.4);
      b.box('gold', { x: (a.x + e.x) / 2, y: GROUND + 0.9, z: (a.z + e.z) / 2, sx: 0.05, sy: 0.05, sz: 4.2, yaw: Hf.yaw });
      for (const pt of [a, e]) b.cylinder('bronze', { x: pt.x, y: GROUND, z: pt.z, r: 0.07, h: 0.95, segments: 6 });
    }
  }
  const sg = Hf.at(-8.2, 3.95);
  sign(b, bm, '護照', sg.x, GROUND + 2.6, sg.z, Hf.yaw, 1.3, { vertical: true });
  const sg2 = Hf.at(0, 3.95);
  sign(b, bm, '入城登記', sg2.x, GROUND + 3.75, sg2.z, Hf.yaw, 0.55, { vertical: false });
  nav.street([F.at(-6, 0), Hf.at(0, 4.5)], NavTag.farm | NavTag.street | NavTag.station, 8, 6);
  // Paved arrival plaza from the Outer Wall gate to the start of the West road.
  const plaza = stripGeometry([polar(THETA_MAIN, BSS.arrivalGate.r + 10), polar(THETA_MAIN, BSS.arrivalGate.r - 18)], 9, GROUND + 0.05, 3);
  env.chunks.named('major', 'farm_arrival_floor').builder.mesh('paving', plaza, { x: 0, y: 0, z: 0 }, { castShadow: false });
  plaza.dispose();
  site.mark('arrival_gateway', p.x, GROUND, p.z);
  site.mark('passport_hall', hc.x, GROUND, hc.z);
}
