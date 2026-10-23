import * as THREE from 'three';
import { Random } from '../../../core/Random';
import { heightAt } from '../../Heightfield';
import { archSlab, boulder, bulbDome, conifer, crystal, crystalCluster, disc, dome, emblem, flatDisc, flatRing, koi, mergeParts, panelWithArches, pillow, roundTree } from './geometry';
import { wtMat, wtWater } from './materials';
import { COURT_POOL, COURTYARD, HEALER, L1, L2, L3, OASIS, OASIS_FLOOR, PALACE, PASSAGE, PODIUM_BOTTOM, T1, T2, WALL, YUGODA_TRAIN, inRect } from './nwtLayout';
import type { NwtKit } from './nwtKit';
import { banner, flight, houseKit, iceSpikes, lanternPost, parapet, placeHouse, V, waterfall } from './parts';
import { rasterRects } from './raster';

/**
 * NWT landmarks: the palace terraces with their waterfalls, the Waterbending
 * Courtyard (Master Siku), Yugoda's healing hut, the Spirit Oasis hidden
 * behind the palace, and the glacier caves in the mountains to the south-west.
 */

// -----------------------------------------------------------------------------
// Terraces, palace, waterfalls
// -----------------------------------------------------------------------------

export function buildTerraces(k: NwtKit): void {
  const cb = k.core;
  const ice = wtMat('ice_massive');
  // T1 and T2 platforms (solid, walkable tops).
  cb.box(ice, { x: (T1[0] + T1[2]) / 2, y: (L2 + L1 - 0.5) / 2, z: (T1[1] + T1[3]) / 2, sx: T1[2] - T1[0], sy: L2 - L1 + 0.5, sz: T1[3] - T1[1] }, { collide: true, walkable: true, surface: 'packedsnow' });
  cb.box(wtMat('paving'), { x: (T1[0] + T1[2]) / 2, y: L2 - 0.1, z: (T1[1] + T1[3]) / 2, sx: T1[2] - T1[0] - 0.8, sy: 0.24, sz: T1[3] - T1[1] - 0.8 });
  cb.box(ice, { x: (T2[0] + T2[2]) / 2, y: (L3 + L2 - 0.5) / 2, z: (T2[1] + T2[3]) / 2, sx: T2[2] - T2[0], sy: L3 - L2 + 0.5, sz: T2[3] - T2[1] }, { collide: true, walkable: true, surface: 'packedsnow' });
  cb.box(wtMat('paving'), { x: (T2[0] + T2[2]) / 2, y: L3 - 0.1, z: (T2[1] + T2[3]) / 2, sx: T2[2] - T2[0] - 0.8, sy: 0.24, sz: T2[3] - T2[1] - 0.8 });
  // Blind arcades on the terrace fronts.
  const arcade = (x0: number, x1: number, zFace: number, y0: number, h: number) => {
    const w = x1 - x0;
    const n = Math.max(1, Math.round(w / 5));
    const ops = [];
    for (let i = 0; i < n; i++) ops.push({ x: -w / 2 + (i + 0.5) * (w / n), y: 0.3, w: Math.min(3, (w / n) * 0.6), h: h - 0.9 });
    const g = panelWithArches(w, h, 0.5, ops, 6);
    cb.mesh(wtMat('ice_trim'), g, { x: (x0 + x1) / 2, y: y0, z: zFace - 0.25, yaw: Math.PI });
    g.dispose();
    const back = new THREE.PlaneGeometry(w, h);
    cb.mesh(wtMat('dark'), back, { x: (x0 + x1) / 2, y: y0 + h / 2, z: zFace - 0.02, yaw: Math.PI }, { castShadow: false });
    back.dispose();
  };
  arcade(T1[0], -241, T1[1], L1, L2 - L1);
  arcade(-199, T1[2], T1[1], L1, L2 - L1);
  arcade(T2[0], -229, T2[1], L2, L3 - L2);
  arcade(-211, T2[2], T2[1], L2, L3 - L2);
  // Grand stairs: twin flights L1→L2 flanking the central cascade, one wide flight L2→L3.
  flight(cb, V(-235, L1, T1[1] - 12), V(-235, L2, T1[1]), 10, 'ice_trim', 'ice_wall', 'ice');
  flight(cb, V(-205, L1, T1[1] - 12), V(-205, L2, T1[1]), 10, 'ice_trim', 'ice_wall', 'ice');
  flight(cb, V(-220, L2, T2[1] - 12), V(-220, L3, T2[1]), 14, 'ice_trim', 'ice_wall', 'ice');
  // Balustrades along the terrace edges (gaps at the stairs).
  const edge = (x0: number, x1: number, z: number, y: number) => parapet(cb, 'ice_wall', x0, z, x1, z, y, 0.9, 0.5, 'snow');
  edge(T1[0] + 0.3, -240.6, T1[1] + 0.3, L2);
  edge(-229.4, -210.6, T1[1] + 0.3, L2);
  edge(-199.4, T1[2] - 0.3, T1[1] + 0.3, L2);
  edge(T2[0] + 0.3, -227.4, T2[1] + 0.3, L3);
  edge(-212.6, T2[2] - 0.3, T2[1] + 0.3, L3);
  for (const x of [T1[0] + 0.3, T1[2] - 0.3]) parapet(cb, 'ice_wall', x, T1[1] + 0.6, x, T1[3] - 1, L2, 0.9, 0.5, 'snow');
  for (const x of [T2[0] + 0.3, T2[2] - 0.3]) parapet(cb, 'ice_wall', x, T2[1] + 0.6, x, T2[3] - 1, L3, 0.9, 0.5, 'snow');

  // --- Water: cliff falls → T2 pools → cascades → T1 pools; T1 fountain → front cascade → plaza pool.
  const pool = (id: string, label: string, x0: number, z0: number, x1: number, z1: number, floor: number, rim = 0.7) => {
    const level = floor + rim - 0.15;
    for (const [ax, az, bx, bz] of [[x0, z0, x1, z0], [x0, z1, x1, z1], [x0, z0, x0, z1], [x1, z0, x1, z1]] as const) {
      parapet(cb, 'ice_trim', ax, az, bx, bz, floor, rim, 0.5, null);
    }
    cb.box(wtMat('canal_bed'), { x: (x0 + x1) / 2, y: floor + 0.02, z: (z0 + z1) / 2, sx: x1 - x0 - 0.4, sy: 0.04, sz: z1 - z0 - 0.4 }, { castShadow: false });
    k.sheets.rect(wtWater('pool'), x0 + 0.25, z0 + 0.25, x1 - 0.25, z1 - 0.25, level);
    k.water({ id: `nwt:${id}`, type: 'fountain', label, x: (x0 + x1) / 2, y: level, z: (z0 + z1) / 2, r: Math.min(x1 - x0, z1 - z0) / 2, capacity: 160, regen: 8, size: 'medium' });
    return level;
  };
  // Cliff falls into the T2 side pools.
  for (const [x0, x1, id] of [[T2[0] + 0.5, PALACE.x - PALACE.w / 2 - 0.5, 'west'], [PALACE.x + PALACE.w / 2 + 0.5, T2[2] - 0.5, 'east']] as const) {
    const lvl = pool(`palace_pool_${id}`, 'Palace Falls Pool', x0, WALL.s0 - 20, x1, WALL.s0 - 0.5, L3);
    const cx = (x0 + x1) / 2;
    const f = waterfall(k.wet, cx, WALL.s0 - 0.4, Math.PI, WALL.sTop - 0.5, lvl, x1 - x0 - 3, 1.0);
    k.water({ id: `nwt:palace_fall_${id}`, type: 'waterfall', label: 'Palace Falls', x: f.x, y: (f.topY + f.bottomY) / 2, z: f.z - 1, r: 2.5, capacity: 400, regen: 25, size: 'large' });
    k.emitter('mist', 4, V(cx, lvl + 1, WALL.s0 - 3), { radius: 2.5 }, 120, true);
    // Lip notch & ice buttresses beside the fall.
    for (const sx of [-1, 1]) cb.box(wtMat('ice_trim'), { x: cx + sx * ((x1 - x0) / 2 - 0.6), y: (WALL.sTop + L3) / 2, z: WALL.s0 - 0.8, sx: 1.2, sy: WALL.sTop - L3, sz: 1.6 });
    // Channel along the palace flank to the T2 front.
    const chX = cx;
    parapet(cb, 'ice_trim', chX - 1.6, WALL.s0 - 20, chX - 1.6, T2[1] + 1, L3, 0.5, 0.4, null);
    parapet(cb, 'ice_trim', chX + 1.6, WALL.s0 - 20, chX + 1.6, T2[1] + 1, L3, 0.5, 0.4, null);
    k.sheets.rect(wtWater('pool'), chX - 1.4, T2[1] + 0.5, chX + 1.4, WALL.s0 - 20, L3 + 0.35);
    // Cascade down the T2 front into a T1 pool.
    const lvl2 = pool(`t1_pool_${id}`, 'Terrace Pool', chX - 5, T2[1] - 9, chX + 5, T2[1] - 0.6, L2);
    waterfall(k.wet, chX, T2[1] - 0.1, Math.PI, L3 + 0.35, lvl2, 2.6, 0.5);
  }
  // T1 Moon Fountain feeding the central cascade.
  {
    const fx = -220, fz = T1[1] + 13;
    const lvl = pool('t1_fountain', 'Moon Fountain', fx - 5, fz - 5, fx + 5, fz + 5, L2, 0.75);
    k.core.cylinder(wtMat('ice_trim'), { x: fx, y: L2, z: fz, r: 0.9, rTop: 0.6, h: 4.2, segments: 10 }, { collide: true, walkable: false });
    const cres = emblem(1.4, 0.25, true);
    k.core.mesh(wtMat('snow'), cres, { x: fx, y: L2 + 5.2, z: fz, yaw: Math.PI });
    cres.dispose();
    k.emitter('spray', 6, V(fx, L2 + 4.3, fz), { radius: 0.3, speed: 2.2, spread: 0.5, dir: new THREE.Vector3(0, 1, 0) }, 90, true);
    // Channel to the front edge, then the cascade into the plaza-level pool.
    parapet(cb, 'ice_trim', fx - 2.2, fz - 5, fx - 2.2, T1[1] + 0.3, L2, 0.5, 0.4, null);
    parapet(cb, 'ice_trim', fx + 2.2, fz - 5, fx + 2.2, T1[1] + 0.3, L2, 0.5, 0.4, null);
    k.sheets.rect(wtWater('pool'), fx - 2, T1[1], fx + 2, fz - 5, L2 + 0.4);
    const lvl3 = pool('stair_pool', 'Cascade Pool', fx - 6, T1[1] - 10, fx + 6, T1[1] - 0.4, L1, 0.7);
    waterfall(k.wet, fx, T1[1] - 0.05, Math.PI, L2 + 0.4, lvl3, 3.6, 0.6);
    k.emitter('mist', 3, V(fx, lvl3 + 0.6, T1[1] - 2), { radius: 2 }, 80, true);
    void lvl;
  }

  buildPalace(k);

  // Terrace dressing: lantern posts, banners, ice statues of waterbenders (simple columns).
  for (const x of [T1[0] + 4, T1[2] - 4]) {
    lanternPost(k.props, x, L2, T1[1] + 3, 'blue');
    lanternPost(k.props, x, L2, T2[1] - 3, 'blue');
  }
  for (const x of [T2[0] + 3, T2[2] - 3]) lanternPost(k.props, x, L3, T2[1] + 3, 'blue');
  for (const x of [-252, -188]) {
    cb.cylinder(wtMat('ice_trim'), { x, y: L2, z: T1[1] + 22, r: 0.25, h: 12, segments: 8 }, { collide: true, walkable: false });
    banner(k.props, x, L2 + 11.5, T1[1] + 22.3, 0, 2.2, 7, 'banner_moon');
  }
  // Noble houses on T1 behind the side pools (west & east wings).
  const kitH = houseKit();
  placeHouse(cb, kitH.get('tier_dome')!, T1[0] + 4.6, L2, -1470, Math.PI / 2, 0.75);
  placeHouse(cb, kitH.get('tier_dome')!, T1[2] - 4.6, L2, -1470, -Math.PI / 2, 0.75);
}

function buildPalace(k: NwtKit): void {
  const cb = k.core;
  const { x, z, w, d } = PALACE;
  const front = z - d / 2; // north face
  // Base platform with entrance stairs.
  cb.box(wtMat('ice_trim'), { x, y: L3 + 0.75, z, sx: w + 2, sy: 1.5, sz: d + 2 }, { collide: true, walkable: true, surface: 'ice' });
  flight(cb, V(x, L3, front - 4.8), V(x, L3 + 1.5, front - 1), 10, 'ice_trim', null, 'ice');
  // Stepped tiers.
  let y = L3 + 1.5;
  const tiers = 8;
  for (let i = 0; i < tiers; i++) {
    const tw = w - i * 4.0, td = d - i * 3.9;
    const th = 6.6 - i * 0.3;
    cb.box(wtMat('ice_wall'), { x, y: y + th / 2, z, sx: tw, sy: th, sz: td }, { collide: true, walkable: true, surface: 'snow' });
    cb.box(wtMat('ice_trim'), { x, y: y + th - 0.2, z, sx: tw + 0.5, sy: 0.4, sz: td + 0.5 });
    const p = pillow(tw + 0.3, td + 0.3, 0.45, 0.2, 1);
    cb.mesh(wtMat('snow'), p, { x, y: y + th - 0.05, z }, { castShadow: false });
    p.dispose();
    // Windows on four faces (arched recesses, some lit).
    const faces: Array<[number, number, number, number]> = [
      [0, -td / 2, Math.PI, tw],
      [0, td / 2, 0, tw],
      [-tw / 2, 0, -Math.PI / 2, td],
      [tw / 2, 0, Math.PI / 2, td],
    ];
    faces.forEach(([ox, oz, yaw, span], fi) => {
      const n = Math.max(2, Math.floor(span / 3.3));
      for (let j = 0; j < n; j++) {
        const along = -span / 2 + (j + 0.5) * (span / n);
        if (i === 0 && fi === 0 && Math.abs(along) < 5) continue; // portal
        const wx = x + ox + Math.cos(yaw) * along, wz = z + oz - Math.sin(yaw) * along;
        const lit = (i + j + fi) % 3 === 0;
        const g = archSlab(1.1, Math.min(2.6, th - 1.6), 0.16, 6);
        cb.mesh(wtMat(lit ? 'window' : 'dark'), g, { x: wx + Math.sin(yaw) * 0.04, y: y + 1.0, z: wz + Math.cos(yaw) * 0.04, yaw }, { castShadow: false });
        g.dispose();
      }
    });
    y += th;
  }
  // Crown: drum, dome, spire and a moon orb.
  cb.cylinder(wtMat('ice_trim'), { x, y, z, r: 4.2, h: 1.2, segments: 20 });
  const dm = dome(4.4, 0.95, 20, 8);
  cb.mesh(wtMat('snow'), dm, { x, y: y + 1.1, z });
  dm.dispose();
  const sp = bulbDome(1.2, 5.5, 12);
  cb.mesh(wtMat('ice_trim'), sp, { x, y: y + 4.6, z });
  sp.dispose();
  const orb = new THREE.SphereGeometry(0.7, 16, 10);
  k.props.mesh(wtMat('lantern_blue'), orb, { x, y: y + 10.6, z }, { castShadow: false });
  orb.dispose();
  // Portal: dark arched doorway with columns and the great emblem above.
  const portal = archSlab(7, 8.5, 0.3, 10);
  cb.mesh(wtMat('dark'), portal, { x, y: L3 + 1.5, z: front - 0.1, yaw: Math.PI }, { castShadow: false });
  portal.dispose();
  const frame = archSlab(8.6, 9.4, 0.25, 10);
  cb.mesh(wtMat('ice_trim'), frame, { x, y: L3 + 1.5, z: front - 0.02, yaw: Math.PI });
  frame.dispose();
  for (const sx of [-1, 1]) {
    for (const off of [5.5, 9.5, 13.5]) {
      cb.cylinder(wtMat('ice_trim'), { x: x + sx * off, y: L3 + 1.5, z: front - 1.4, r: 0.55, h: 6.5, segments: 10 }, { collide: true, walkable: false });
      cb.box(wtMat('ice_wall'), { x: x + sx * off, y: L3 + 8.2, z: front - 1.4, sx: 1.6, sy: 0.4, sz: 1.6 });
    }
  }
  cb.box(wtMat('ice_wall'), { x, y: L3 + 8.6, z: front - 1.4, sx: 29, sy: 0.6, sz: 1.8 });
  const dsk = disc(3.0, 0.5, 32);
  cb.mesh(wtMat('ice_trim'), dsk, { x, y: L3 + 13.6, z: front + 2.2 - 0.3, yaw: Math.PI });
  dsk.dispose();
  const em = emblem(2.6, 0.3, true);
  cb.mesh(wtMat('snow'), em, { x, y: L3 + 13.6, z: front + 2.2 - 0.7, yaw: Math.PI });
  em.dispose();
  banner(k.props, x - 3.2, L3 + 11.8, front - 0.45, Math.PI, 1.8, 5.5, 'banner_water');
  banner(k.props, x + 3.2, L3 + 11.8, front - 0.45, Math.PI, 1.8, 5.5, 'banner_water');
  k.emitter('spirit', 1.2, V(x, L3 + 3, front - 3), { radius: 3 }, 70, true);
}

// -----------------------------------------------------------------------------
// Waterbending Courtyard (Master Siku)
// -----------------------------------------------------------------------------

export function buildCourtyard(k: NwtKit): void {
  const { x, z, r } = COURTYARD;
  const cb = k.core;
  // Polished ice floor (flush), rings and the central pool.
  const floor = flatDisc(r, 48);
  cb.mesh(wtMat('ice_clear'), floor, { x, y: L1 + 0.015, z }, { castShadow: false });
  floor.dispose();
  for (const [r0, r1] of [[r - 0.8, r - 0.3], [7.5, 7.9]] as const) {
    const ring = flatRing(r0, r1, 56);
    cb.mesh(wtMat('ice_trim'), ring, { x, y: L1 + 0.025, z }, { castShadow: false });
    ring.dispose();
  }
  // Central pool: sunken and wadeable (the whole courtyard stays open for training).
  const pr = COURT_POOL.r;
  const wall = new THREE.CylinderGeometry(pr, pr, L1 - COURT_POOL.floor, 32, 1, true);
  wall.scale(-1, 1, 1); // faces inward
  cb.mesh(wtMat('ice_trim'), wall, { x, y: (L1 + COURT_POOL.floor) / 2, z }, { castShadow: false });
  wall.dispose();
  const rimTop = flatRing(pr, pr + 1.7, 40);
  cb.mesh(wtMat('ice_trim'), rimTop, { x, y: L1 + 0.02, z }, { castShadow: false });
  rimTop.dispose();
  const bed = flatDisc(pr, 24);
  cb.mesh(wtMat('canal_bed'), bed, { x, y: COURT_POOL.floor + 0.01, z }, { castShadow: false });
  bed.dispose();
  k.sheets.disc(wtWater('pool'), x, z, pr + 0.02, COURT_POOL.level, 32);
  // Floor inside the pool and a walkable ring over the podium's raster edge.
  cb.collider({ shape: 'cylinder', x, y: COURT_POOL.floor - 0.4, z, r: pr + 1.2, hy: 0.4, walkable: true, solid: false, surface: 'water' });
  for (let i = 0; i < 20; i++) {
    const a = ((i + 0.5) / 20) * Math.PI * 2;
    const rr = pr + 0.85;
    cb.collider({ shape: 'box', x: x + Math.cos(a) * rr, y: (L1 + PODIUM_BOTTOM) / 2, z: z + Math.sin(a) * rr, hx: 0.85, hy: (L1 - PODIUM_BOTTOM) / 2, hz: (Math.PI * 2 * rr) / 40 + 0.15, yaw: -a, walkable: true, solid: true, surface: 'ice' });
  }
  k.water({ id: 'nwt:courtyard_pool', type: 'fountain', label: 'Courtyard Pool', x, y: COURT_POOL.level, z, r: pr, capacity: 220, regen: 12, size: 'medium' });
  k.emitter('mist', 0.8, V(x, L1 + 0.6, z), { radius: pr * 0.8 }, 50, true);
  // Semicircular colonnade on the west side (behind the master), open toward the gorge.
  const n = 9;
  for (let i = 0; i < n; i++) {
    const a = Math.PI / 2 + (i / (n - 1)) * Math.PI; // from south (+z) round the west to north
    const cx = x + Math.cos(a) * (r + 1.6), cz = z + Math.sin(a) * (r + 1.6);
    cb.cylinder(wtMat('ice_trim'), { x: cx, y: L1, z: cz, r: 0.5, h: 5.2, segments: 10 }, { collide: true, walkable: false });
    cb.box(wtMat('ice_wall'), { x: cx, y: L1 + 5.4, z: cz, sx: 1.4, sy: 0.5, sz: 1.4 });
    if (i < n - 1) {
      const a2 = Math.PI / 2 + ((i + 0.5) / (n - 1)) * Math.PI;
      const lx = x + Math.cos(a2) * (r + 1.6), lz = z + Math.sin(a2) * (r + 1.6);
      cb.box(wtMat('ice_wall'), { x: lx, y: L1 + 5.85, z: lz, sx: ((Math.PI * (r + 1.6)) / (n - 1)) + 0.4, sy: 0.6, sz: 0.9, yaw: -a2 + Math.PI / 2 });
    }
  }
  // Master's dais (low, walkable) and banners.
  cb.box(wtMat('ice_trim'), { x: x - r + 3.2, y: L1 + 0.15, z, sx: 3, sy: 0.3, sz: 4 }, { collide: true, walkable: true, surface: 'ice' });
  banner(k.props, x - r - 1.6, L1 + 5.2, z - 3.2, Math.PI / 2, 1.5, 4, 'banner_water');
  banner(k.props, x - r - 1.6, L1 + 5.2, z + 3.2, Math.PI / 2, 1.5, 4, 'banner_moon');
  // Blue flame braziers (lanterns) at the opening.
  lanternPost(k.props, x + r * 0.7, L1, z - r * 0.75, 'blue');
  lanternPost(k.props, x + r * 0.7, L1, z + r * 0.75, 'blue');
}

// -----------------------------------------------------------------------------
// Yugoda's healing hut
// -----------------------------------------------------------------------------

export function buildHealer(k: NwtKit): void {
  const { x, z } = HEALER;
  const cb = k.core;
  const kitH = houseKit();
  placeHouse(cb, kitH.get('dome')!, x, L1, z, -Math.PI / 2, 1.35);
  // Healing basins in front of the hut (fed with glacier water).
  const basins: Array<[number, number]> = [[x - 9.5, z - 6], [x - 10.5, z], [x - 9.5, z + 6]];
  basins.forEach(([bx, bz], i) => {
    const r = 1.15;
    const shell = new THREE.CylinderGeometry(r + 0.25, r * 0.85, 0.85, 18, 1, true);
    cb.mesh(wtMat('ice_trim'), shell, { x: bx, y: L1 + 0.425, z: bz });
    shell.dispose();
    const top = flatRing(r, r + 0.25, 20);
    cb.mesh(wtMat('snow'), top, { x: bx, y: L1 + 0.86, z: bz }, { castShadow: false });
    top.dispose();
    k.sheets.disc(wtWater('pool'), bx, bz, r, L1 + 0.7, 18);
    cb.collider({ shape: 'cylinder', x: bx, y: L1 + 0.43, z: bz, r: r + 0.25, hy: 0.43, walkable: false, solid: true, surface: 'ice' });
    k.water({ id: `nwt:healing_basin_${i}`, type: 'fountain', label: 'Healing Basin', x: bx, y: L1 + 0.7, z: bz, r, capacity: 80, regen: 6, size: 'small' });
  });
  k.emitter('heal', 1.0, V(x - 10, L1 + 1.2, z), { radius: 5 }, 40, true);
  // Drying herbs rack, furs, lanterns.
  lanternPost(k.props, x - 6, L1, z - 9, 'warm');
  lanternPost(k.props, x - 6, L1, z + 9, 'warm');
  banner(k.props, x - 5.6, L1 + 3.6, z, -Math.PI / 2, 1.2, 1.6, 'banner_moon');
  // Yard floor marker (training ground for the healer's lessons).
  const ring = flatRing(YUGODA_TRAIN.r - 0.6, YUGODA_TRAIN.r - 0.2, 48);
  cb.mesh(wtMat('ice_trim'), ring, { x: YUGODA_TRAIN.x, y: L1 + 0.012, z: YUGODA_TRAIN.z }, { castShadow: false });
  ring.dispose();
}

// -----------------------------------------------------------------------------
// Spirit Oasis (hidden behind the palace)
// -----------------------------------------------------------------------------

export function buildOasis(k: NwtKit): void {
  const cb = k.core;
  const [x0, z0, x1, z1] = OASIS;
  const T = 3;
  const top = 15.5;
  const ice = wtMat('ice_massive');
  // Enclosure: north, east and west walls (south is the glacier cliff). Door in the west wall.
  const door = { z0: -1453.5, z1: -1449.5, top: 9.5 };
  cb.box(ice, { x: (x0 + x1) / 2, y: (top + 2) / 2, z: z0 + T / 2, sx: x1 - x0, sy: top - 2, sz: T }, { collide: true, walkable: true });
  cb.box(ice, { x: x1 - T / 2, y: (top + 2) / 2, z: (z0 + z1) / 2, sx: T, sy: top - 2, sz: z1 - z0 }, { collide: true, walkable: true });
  cb.box(ice, { x: x0 + T / 2, y: (top + 2) / 2, z: (z0 + door.z0) / 2, sx: T, sy: top - 2, sz: door.z0 - z0 }, { collide: true, walkable: true });
  cb.box(ice, { x: x0 + T / 2, y: (top + 2) / 2, z: (door.z1 + z1) / 2, sx: T, sy: top - 2, sz: z1 - door.z1 }, { collide: true, walkable: true });
  cb.box(ice, { x: x0 + T / 2, y: (top + door.top) / 2, z: (door.z0 + door.z1) / 2, sx: T, sy: top - door.top, sz: door.z1 - door.z0 }, { collide: true, walkable: true });
  const frame = archSlab(4.6, 4.4, 0.4, 8);
  cb.mesh(wtMat('ice_trim'), frame, { x: x0 - 0.1, y: L1, z: (door.z0 + door.z1) / 2, yaw: -Math.PI / 2 });
  frame.dispose();
  // Passage through the door (L1) and steps down into the garden.
  cb.box(wtMat('paving'), { x: x0 + T / 2, y: L1 - 0.25, z: (door.z0 + door.z1) / 2, sx: T + 0.2, sy: 0.5, sz: door.z1 - door.z0 }, { collide: true, walkable: true, surface: 'packedsnow' });
  flight(cb, V(x0 + T + 4, OASIS_FLOOR, (door.z0 + door.z1) / 2), V(x0 + T, L1, (door.z0 + door.z1) / 2), 3.6, 'rock', null, 'stone');
  for (const s of [-1, 1]) cb.box(wtMat('rock_dark'), { x: x0 + T + 2, y: (L1 + 3.9) / 2, z: (door.z0 + door.z1) / 2 + s * 2.1, sx: 4.2, sy: L1 - 3.9 + 0.6, sz: 0.6 }, { collide: true, walkable: false });
  // Garden floor: grass slabs around a pond.
  const pond = { x: -106, z: -1444, r: 6.5 };
  const inner: [number, number, number, number] = [x0 + T, z0 + T, x1 - T, z1];
  for (const r of rasterRects(inner[0], inner[1], inner[2], inner[3], 1, (px, pz) => Math.hypot(px - pond.x, pz - pond.z) > pond.r + 0.6 && !(px < x0 + T + 4.2 && Math.abs(pz - (door.z0 + door.z1) / 2) < 1.9))) {
    cb.box(wtMat('grass'), { x: (r.x0 + r.x1) / 2, y: (OASIS_FLOOR + 3.4) / 2, z: (r.z0 + r.z1) / 2, sx: r.x1 - r.x0, sy: OASIS_FLOOR - 3.4, sz: r.z1 - r.z0 }, { collide: true, walkable: true, surface: 'grass' });
  }
  // Pond: dark bed, water, stone edge, lily pads; a real (spirit) water source.
  const bed = flatDisc(pond.r + 0.8, 32);
  cb.mesh(wtMat('canal_bed'), bed, { x: pond.x, y: 3.7, z: pond.z }, { castShadow: false });
  bed.dispose();
  cb.collider({ shape: 'cylinder', x: pond.x, y: 3.55, z: pond.z, r: pond.r + 0.8, hy: 0.15, walkable: true, solid: false, surface: 'water' });
  const level = OASIS_FLOOR - 0.18;
  k.sheets.disc(wtWater('spirit'), pond.x, pond.z, pond.r + 0.9, level, 40);
  k.water({ id: 'nwt:spirit_oasis', type: 'pond', label: 'Spirit Oasis Pond', x: pond.x, y: level, z: pond.z, r: pond.r, capacity: 300, regen: 15, size: 'medium' });
  const rnd = new Random(1212);
  const stones: THREE.BufferGeometry[] = [];
  for (let i = 0; i < 22; i++) {
    const a = (i / 22) * Math.PI * 2 + rnd.range(-0.08, 0.08);
    const rr = pond.r + 0.7 + rnd.range(-0.2, 0.3);
    const g = boulder(900 + i, rnd.range(0.5, 0.9), rnd.range(0.3, 0.5), rnd.range(0.5, 0.8), 0);
    g.translate(pond.x + Math.cos(a) * rr, OASIS_FLOOR - 0.15, pond.z + Math.sin(a) * rr);
    stones.push(g);
  }
  const sg = mergeParts(stones);
  cb.mesh(wtMat('rock'), sg, { x: 0, y: 0, z: 0 });
  sg.dispose();
  for (let i = 0; i < 9; i++) {
    const a = rnd.range(0, Math.PI * 2), d = rnd.range(1.5, pond.r - 0.8);
    k.props.instance('oasis_lily', () => {
      const g = new THREE.CircleGeometry(0.45, 10, 0.3, Math.PI * 2 - 0.6);
      g.rotateX(-Math.PI / 2);
      return g;
    }, wtMat('leaf'), new THREE.Matrix4().compose(V(pond.x + Math.cos(a) * d, level + 0.02, pond.z + Math.sin(a) * d), new THREE.Quaternion().setFromEuler(new THREE.Euler(0, rnd.range(0, 6), 0)), V(1, 1, 1)), false);
  }
  // Tui and La: two koi circling forever.
  const koiGeo = k.own(koi(0.9));
  const kw = new THREE.Mesh(koiGeo, wtMat('koi_white'));
  const kb = new THREE.Mesh(koiGeo, wtMat('koi_black'));
  kw.name = 'koi_tui';
  kb.name = 'koi_la';
  k.addProp(kw);
  k.addProp(kb);
  k.onTick((t) => {
    const a = t * 0.55;
    const rr = 3.0 + 0.4 * Math.sin(t * 0.3);
    kw.position.set(pond.x + Math.cos(a) * rr, level - 0.12, pond.z + Math.sin(a) * rr);
    kb.position.set(pond.x + Math.cos(a + Math.PI) * rr, level - 0.12, pond.z + Math.sin(a + Math.PI) * rr);
    // Swim tangentially (counter-clockwise): forward = derivative of the circle.
    kw.rotation.y = Math.atan2(-Math.sin(a), Math.cos(a));
    kb.rotation.y = Math.atan2(-Math.sin(a + Math.PI), Math.cos(a + Math.PI));
  });
  // Tiny shrine: a wooden gate and a stone lantern at the pond's south side.
  const sx = -104, sz = -1431;
  for (const s of [-1, 1]) cb.cylinder(wtMat('lacquer'), { x: sx + s * 1.3, y: OASIS_FLOOR, z: sz, r: 0.13, h: 2.6, segments: 8 }, { collide: true, walkable: false });
  cb.box(wtMat('lacquer'), { x: sx, y: OASIS_FLOOR + 2.65, z: sz, sx: 3.6, sy: 0.22, sz: 0.3 });
  cb.box(wtMat('lacquer'), { x: sx, y: OASIS_FLOOR + 2.2, z: sz, sx: 2.9, sy: 0.14, sz: 0.2 });
  cb.cylinder(wtMat('rock'), { x: sx, y: OASIS_FLOOR, z: sz + 2.6, r: 0.4, rTop: 0.25, h: 1.0, segments: 6 }, { collide: true, walkable: false });
  k.props.instance('oasis_lamp', () => new THREE.SphereGeometry(0.22, 10, 8), wtMat('spirit'), new THREE.Matrix4().makeTranslation(sx, OASIS_FLOOR + 1.2, sz + 2.6), false);
  // Trees, bamboo, bushes, reeds: a warm, green contrast to the ice city.
  const trees: Array<[number, number, 'round' | 'pine', number]> = [
    [-141, -1471, 'round', 8], [-128, -1472, 'round', 7], [-114, -1471.5, 'pine', 10], [-99, -1471, 'round', 8.5],
    [-141, -1427, 'pine', 10.5], [-131, -1425.5, 'round', 7], [-116, -1425, 'round', 6.5], [-97, -1430, 'round', 8],
    [-97, -1460, 'pine', 9], [-141, -1440, 'round', 6.5], [-141, -1462, 'round', 6], [-122, -1462, 'round', 5.5],
  ];
  const trunks: THREE.BufferGeometry[] = [];
  const leaves: THREE.BufferGeometry[] = [];
  const pines: THREE.BufferGeometry[] = [];
  for (const [tx, tz, kind, h] of trees) {
    const [tr, fo] = kind === 'pine' ? conifer(Math.round(tx * 3 + tz), h) : roundTree(Math.round(tx + tz * 7), h);
    tr.translate(tx, OASIS_FLOOR - 0.1, tz);
    fo.translate(tx, OASIS_FLOOR - 0.1, tz);
    trunks.push(tr);
    (kind === 'pine' ? pines : leaves).push(fo);
    cb.collider({ shape: 'cylinder', x: tx, y: OASIS_FLOOR + 1.5, z: tz, r: 0.4, hy: 1.5, walkable: false, solid: true });
  }
  const tg = mergeParts(trunks);
  cb.mesh(wtMat('wood'), tg, { x: 0, y: 0, z: 0 });
  tg.dispose();
  const lg = mergeParts(leaves);
  cb.mesh(wtMat('leaf'), lg, { x: 0, y: 0, z: 0 });
  lg.dispose();
  const pg = mergeParts(pines);
  cb.mesh(wtMat('moss'), pg, { x: 0, y: 0, z: 0 });
  pg.dispose();
  // Bamboo groves in two corners.
  for (const [gx, gz] of [[-136, -1430], [-100, -1468]] as const) {
    for (let i = 0; i < 14; i++) {
      const bx = gx + rnd.range(-3, 3), bz = gz + rnd.range(-2.5, 2.5);
      const hh = rnd.range(5, 8.5);
      k.props.instance('oasis_bamboo', () => {
        const c = new THREE.CylinderGeometry(0.07, 0.09, 1, 5);
        c.translate(0, 0.5, 0);
        return c;
      }, wtMat('moss'), new THREE.Matrix4().compose(V(bx, OASIS_FLOOR - 0.05, bz), new THREE.Quaternion().setFromEuler(new THREE.Euler(rnd.range(-0.06, 0.06), 0, rnd.range(-0.06, 0.06))), V(1, hh, 1)));
      k.props.instance('oasis_bamboo_leaf', () => {
        const l = new THREE.ConeGeometry(0.6, 1.4, 5);
        l.translate(0, 0.7, 0);
        return l;
      }, wtMat('leaf'), new THREE.Matrix4().compose(V(bx, OASIS_FLOOR + hh - 0.6, bz), new THREE.Quaternion(), V(1, 1, 1)), false);
    }
    cb.collider({ shape: 'cylinder', x: gx, y: OASIS_FLOOR + 2, z: gz, r: 3.2, hy: 2, walkable: false, solid: true });
  }
  // Bushes along the walls.
  for (let i = 0; i < 18; i++) {
    const side = i % 3;
    const bx = side === 0 ? rnd.range(x0 + T + 6, x1 - T - 2) : side === 1 ? x1 - T - 1.2 : rnd.range(x0 + T + 6, x1 - T - 2);
    const bz = side === 0 ? z0 + T + 1.2 : side === 1 ? rnd.range(z0 + T + 2, z1 - 2) : z1 - 1.4;
    k.props.instance('oasis_bush', () => {
      const b2 = new THREE.IcosahedronGeometry(1, 1);
      b2.scale(1, 0.75, 1);
      b2.translate(0, 0.45, 0);
      return b2;
    }, wtMat('leaf'), new THREE.Matrix4().compose(V(bx, OASIS_FLOOR - 0.1, bz), new THREE.Quaternion().setFromEuler(new THREE.Euler(0, rnd.range(0, 6), 0)), V(rnd.range(0.8, 1.5), rnd.range(0.8, 1.3), rnd.range(0.8, 1.5))));
  }
  // Reeds around the pond and a stepping-stone path from the door to the shrine.
  for (let i = 0; i < 26; i++) {
    const a = rnd.range(0, Math.PI * 2);
    const rr = pond.r + rnd.range(-0.3, 0.6);
    k.props.instance('oasis_reed', () => {
      const parts: THREE.BufferGeometry[] = [];
      for (let j = 0; j < 4; j++) {
        const c = new THREE.ConeGeometry(0.05, 1.3, 3);
        c.translate(0, 0.65, 0);
        c.rotateZ((j - 1.5) * 0.12);
        c.rotateY(j * 1.4);
        parts.push(c);
      }
      return mergeParts(parts);
    }, wtMat('moss'), new THREE.Matrix4().makeTranslation(pond.x + Math.cos(a) * rr, level - 0.1, pond.z + Math.sin(a) * rr), false);
  }
  const path: Array<[number, number]> = [[-142, -1451.5], [-134, -1452], [-126, -1450], [-119, -1446], [-116, -1439], [-110, -1434], [-105, -1433.5]];
  for (let i = 0; i < path.length - 1; i++) {
    const [ax, az] = path[i], [bx2, bz2] = path[i + 1];
    const n = Math.max(1, Math.round(Math.hypot(bx2 - ax, bz2 - az) / 1.3));
    for (let j = 0; j < n; j++) {
      const t = (j + 0.5) / n;
      k.props.instance('oasis_step', () => {
        const g = new THREE.CylinderGeometry(0.5, 0.55, 0.1, 8);
        g.translate(0, 0.03, 0);
        return g;
      }, wtMat('stone_floor'), new THREE.Matrix4().compose(V(ax + (bx2 - ax) * t, OASIS_FLOOR, az + (bz2 - az) * t), new THREE.Quaternion().setFromEuler(new THREE.Euler(0, rnd.range(0, 3), 0)), V(rnd.range(0.85, 1.1), 1, rnd.range(0.75, 1))), false);
    }
  }
  // Moss along the foot of the enclosure walls.
  for (const [mx, mz, mw, md] of [[(x0 + x1) / 2, z0 + T + 0.4, x1 - x0 - 2 * T, 1.2], [x1 - T - 0.4, (z0 + z1) / 2, 1.2, z1 - z0 - T]] as const) {
    const m = pillow(mw, md, 0.5, 0.25, 1);
    cb.mesh(wtMat('moss'), m, { x: mx, y: OASIS_FLOOR - 0.2, z: mz }, { castShadow: false });
    m.dispose();
  }
  const flowerCols = ['#f2c14e', '#e86f8a', '#ffffff'];
  const nf = Math.round(46 * k.density);
  for (let i = 0; i < nf; i++) {
    const fx = rnd.range(x0 + T + 1, x1 - T - 1), fz = rnd.range(z0 + T + 1, z1 - 2);
    if (Math.hypot(fx - pond.x, fz - pond.z) < pond.r + 1.6) continue;
    if (fx < x0 + T + 5 && Math.abs(fz - (door.z0 + door.z1) / 2) < 3) continue;
    const col = flowerCols[i % 3];
    k.props.instance(`oasis_flower_${i % 3}`, () => {
      const g = new THREE.ConeGeometry(0.14, 0.32, 5);
      g.rotateX(Math.PI);
      g.translate(0, 0.42, 0);
      const stem = new THREE.CylinderGeometry(0.02, 0.02, 0.36, 3);
      stem.translate(0, 0.18, 0);
      return mergeParts([g, stem]);
    }, flowerMat(col), new THREE.Matrix4().makeTranslation(fx, OASIS_FLOOR, fz), false);
  }
  // Warm mist & spirit motes; a calm meditation spot.
  k.emitter('mist', 1.2, V(pond.x, level + 0.4, pond.z), { radius: pond.r * 0.8, color: '#e8fff4' }, 60, true);
  k.emitter('spirit', 1.6, V(-118, OASIS_FLOOR + 1.5, -1448), { radius: 12 }, 60, true);
  k.interact({
    id: 'nwt:oasis_meditate',
    position: V(sx, OASIS_FLOOR, sz - 1.5),
    radius: 3,
    label: 'Meditate at the Spirit Oasis',
    priority: 1,
    interact: (ctx) => {
      const pl = ctx.player;
      if (!pl) return;
      pl.chi = pl.maxChi;
      ctx.avatar.spirit = ctx.avatar.maxSpirit;
      ctx.vfx.burst('spirit', pl.position.clone().setY(pl.position.y + 1.2), { count: 36, radius: 1.4 });
      ctx.events.emit('ui:notify', { text: 'The Ocean and the Moon circle in harmony. Your spirit is restored.', kind: 'success', duration: 3.5 });
    },
  });
  // Lanterns inside.
  lanternPost(k.props, x0 + T + 6.5, OASIS_FLOOR, -1459, 'warm');
  lanternPost(k.props, x0 + T + 6.5, OASIS_FLOOR, -1444, 'warm');
  void inRect;
  void PASSAGE;
}

const flowerMats = new Map<string, THREE.MeshStandardMaterial>();
function flowerMat(c: string): THREE.MeshStandardMaterial {
  let m = flowerMats.get(c);
  if (!m) {
    m = new THREE.MeshStandardMaterial({ color: c, roughness: 0.8, emissive: c, emissiveIntensity: 0.12 });
    flowerMats.set(c, m);
  }
  return m;
}

/** Free the module-level flower materials (called when the last Water Tribe region is disposed). */
export function disposeFlowerMats(): void {
  for (const m of flowerMats.values()) m.dispose();
  flowerMats.clear();
}

// -----------------------------------------------------------------------------
// Glacier caves (south-west, in the mountains)
// -----------------------------------------------------------------------------

/**
 * A walk-in ice cave on the shelf at (-520,-1340): an irregular vault of
 * glacier ice whose floor ramps up into the slope. Inside: icicles, crystal
 * formations, a frozen pool (ice source) and a small shrine at the back.
 */
export function buildCaves(k: NwtKit): void {
  const cb = k.core;
  const entrance = { x: -520, z: -1360 };
  const back = { x: -522, z: -1326 };
  const dx = back.x - entrance.x, dz = back.z - entrance.z;
  const len = Math.hypot(dx, dz);
  const ux = dx / len, uz = dz / len; // inward
  const nx = -uz, nz = ux; // across
  const yawIn = Math.atan2(ux, uz); // local +Z points inward
  const W = 13; // inner width
  const H = 8; // inner height
  const STEPS = 8;
  const floorAt = (t: number) => {
    // floor follows the terrain maximum across the width (+0.3) so the terrain never pokes through
    const px = entrance.x + ux * len * t, pz = entrance.z + uz * len * t;
    let m = -Infinity;
    for (let s = -W / 2 - 1; s <= W / 2 + 1; s += 1.5) m = Math.max(m, heightAt(px + nx * s, pz + nz * s));
    return m + 0.35;
  };
  const ys: number[] = [];
  for (let i = 0; i <= STEPS; i++) ys.push(floorAt(i / STEPS));
  // Make the floor monotonic (ramps up into the hill) and smooth.
  for (let i = 1; i <= STEPS; i++) ys[i] = Math.max(ys[i], ys[i - 1]);
  const segLen = len / STEPS;
  for (let i = 0; i < STEPS; i++) {
    const t0 = i / STEPS, t1 = (i + 1) / STEPS;
    const cx = entrance.x + ux * len * (t0 + t1) / 2, cz = entrance.z + uz * len * (t0 + t1) / 2;
    const y0 = ys[i], y1 = ys[i + 1];
    const rise = y1 - y0;
    // Ramp collider: local +X must point uphill (inward).
    const yaw = Math.atan2(-uz, ux);
    const bottom = Math.min(y0, y1) - 3;
    cb.collider({ shape: 'box', x: cx, y: (y1 + bottom) / 2, z: cz, hx: segLen / 2 + 0.05, hy: (y1 - bottom) / 2, hz: W / 2 + 0.5, yaw, slopeRise: rise > 0.01 ? rise : 0, walkable: true, solid: true, surface: 'ice' });
    const fl = new THREE.BoxGeometry(segLen + 0.3, 0.5, W + 1.2);
    cb.mesh(wtMat('snow'), fl, { x: cx, y: (y0 + y1) / 2 - 0.25, z: cz, yaw, roll: Math.atan2(rise, segLen) });
    fl.dispose();
    // Walls (solid) and a vaulted ceiling made of tilted slabs.
    for (const s of [-1, 1]) {
      const wx = cx + nx * s * (W / 2 + 1.2), wz = cz + nz * s * (W / 2 + 1.2);
      cb.box(wtMat('ice_massive'), { x: wx, y: (y0 + y1) / 2 + H / 2 - 1, z: wz, sx: segLen + 0.6, sy: H + 2, sz: 2.4, yaw }, { collide: true, walkable: true });
      const sl = new THREE.BoxGeometry(segLen + 0.6, 1.6, W / 2 + 2.6);
      cb.mesh(wtMat('ice_massive'), sl, { x: cx + nx * s * (W / 4 + 0.6), y: (y0 + y1) / 2 + H + 0.9, z: cz + nz * s * (W / 4 + 0.6), yaw, pitch: 0, roll: 0 });
      sl.dispose();
    }
    cb.box(wtMat('ice_clear'), { x: cx, y: (y0 + y1) / 2 + H + 1.9, z: cz, sx: segLen + 0.6, sy: 1.2, sz: W * 0.6, yaw });
    // Snow mound on top so the cave reads as a glacier snout from outside.
    const mound = pillow(segLen + 3, W + 7, 2.2, 1.0, 1);
    cb.mesh(wtMat('snow'), mound, { x: cx, y: (y0 + y1) / 2 + H + 1.6, z: cz, yaw }, { castShadow: false });
    mound.dispose();
    // Icicles from the ceiling.
    for (let j = 0; j < 4; j++) {
      const ox = (j - 1.5) * (W / 4.5);
      const icx = cx + nx * ox, icz = cz + nz * ox;
      k.props.instance('cave_icicle', () => {
        const c = new THREE.ConeGeometry(0.22, 1.6, 6);
        c.rotateX(Math.PI);
        c.translate(0, -0.8, 0);
        return c;
      }, wtMat('ice_clear'), new THREE.Matrix4().compose(V(icx, (y0 + y1) / 2 + H, icz), new THREE.Quaternion(), V(1, 0.6 + ((i * 7 + j * 3) % 5) * 0.25, 1)), false);
    }
  }
  // Back wall.
  const yb = ys[STEPS];
  cb.box(wtMat('ice_massive'), { x: back.x + ux * 1.2, y: yb + H / 2 - 1, z: back.z + uz * 1.2, sx: W + 5, sy: H + 3, sz: 2.4, yaw: Math.atan2(-uz, ux) + Math.PI / 2 }, { collide: true, walkable: true });
  // Entrance arch (facing out).
  const ya = ys[0];
  const arch = panelWithArches(W + 8, H + 4, 2.2, [{ x: 0, y: 0, w: W, h: H + 0.6 }], 10);
  cb.mesh(wtMat('ice_massive'), arch, { x: entrance.x - ux * 0.6, y: ya - 0.6, z: entrance.z - uz * 0.6, yaw: yawIn });
  arch.dispose();
  for (const s of [-1, 1]) {
    cb.collider({ shape: 'box', x: entrance.x - ux * 0.6 + nx * s * (W / 2 + 2), y: ya + H / 2, z: entrance.z - uz * 0.6 + nz * s * (W / 2 + 2), hx: 2, hy: H / 2 + 2, hz: 1.1, yaw: Math.atan2(-uz, ux) + Math.PI / 2, walkable: false, solid: true });
  }
  // Ice formations & glowing crystals.
  const rnd = new Random(88);
  for (let i = 0; i < 9; i++) {
    const t = rnd.range(0.2, 0.95);
    const s = (rnd.chance(0.5) ? -1 : 1) * rnd.range(W / 2 - 2.2, W / 2 - 0.8);
    const px = entrance.x + ux * len * t + nx * s, pz = entrance.z + uz * len * t + nz * s;
    const fy = ys[Math.min(STEPS, Math.round(t * STEPS))];
    const c = crystalCluster(700 + i, rnd.range(1.2, 2.4), 5);
    cb.mesh(wtMat(i % 3 === 0 ? 'lantern_blue' : 'ice_clear'), c, { x: px, y: fy - 0.2, z: pz, yaw: rnd.range(0, 6) });
    c.dispose();
    cb.collider({ shape: 'cylinder', x: px, y: fy + 0.8, z: pz, r: 0.9, hy: 0.9, walkable: false, solid: true });
  }
  // Frozen pool near the back (walkable ice; an ice source).
  const pt = 0.72;
  const pxp = entrance.x + ux * len * pt, pzp = entrance.z + uz * len * pt;
  const py = ys[Math.round(pt * STEPS)] + 0.05;
  const ice = flatDisc(3.2, 28);
  cb.mesh(wtMat('ice_clear'), ice, { x: pxp, y: py + 0.03, z: pzp }, { castShadow: false });
  ice.dispose();
  k.water({ id: 'nwt:cave_ice', type: 'ice', label: 'Frozen Cave Pool', x: pxp, y: py, z: pzp, r: 3.2, capacity: 200, regen: 4, frozen: true, size: 'medium' });
  // Tiny shrine at the back with a spirit light.
  const shx = back.x - ux * 2.5, shz = back.z - uz * 2.5;
  cb.cylinder(wtMat('ice_trim'), { x: shx, y: yb, z: shz, r: 0.6, rTop: 0.45, h: 1.2, segments: 8 }, { collide: true, walkable: true });
  const orb = new THREE.SphereGeometry(0.35, 12, 8);
  k.props.mesh(wtMat('spirit'), orb, { x: shx, y: yb + 1.6, z: shz }, { castShadow: false });
  orb.dispose();
  k.emitter('spirit', 1, V(shx, yb + 1.5, shz), { radius: 2 }, 40, true);
  k.emitter('snow', 1.5, V(entrance.x - ux * 3, ya + H, entrance.z - uz * 3), { radius: 5 }, 60, true);
  // Trail markers from the west postern up the slope.
  const trail: Array<[number, number]> = [[-400, -1492], [-430, -1470], [-462, -1455], [-500, -1440], [-530, -1420], [-540, -1395], [-532, -1375]];
  for (const [tx, tz] of trail) {
    k.props.instance('cave_cairn', () => {
      const a = new THREE.DodecahedronGeometry(0.55, 0);
      a.translate(0, 0.35, 0);
      const b2 = new THREE.DodecahedronGeometry(0.38, 0);
      b2.translate(0.05, 0.95, 0);
      const c = new THREE.DodecahedronGeometry(0.24, 0);
      c.translate(0, 1.4, 0);
      return mergeParts([a, b2, c]);
    }, wtMat('rock'), new THREE.Matrix4().makeTranslation(tx, heightAt(tx, tz) - 0.1, tz));
  }
  iceSpikes(k.props, entrance.x + nx * (W / 2 + 4), heightAt(entrance.x + nx * (W / 2 + 4), entrance.z), entrance.z + nz * (W / 2 + 4), 4, 61);
  iceSpikes(k.props, entrance.x - nx * (W / 2 + 4), heightAt(entrance.x - nx * (W / 2 + 4), entrance.z), entrance.z - nz * (W / 2 + 4), 3.5, 62);

  // Snow-buried entrance: a drift over the arch and ice boulders flanking it.
  {
    const ya2 = ys[0];
    const top = boulder(1300, W / 2 + 5, 2.6, 3.2, 1);
    cb.mesh(wtMat('snow'), top, { x: entrance.x - ux * 0.6, y: ya2 + H + 3.2, z: entrance.z - uz * 0.6, yaw: yawIn });
    top.dispose();
    for (const s of [-1, 1]) {
      const bx = entrance.x - ux * 1.2 + nx * s * (W / 2 + 4.5), bz = entrance.z - uz * 1.2 + nz * s * (W / 2 + 4.5);
      const b = boulder(1310 + (s > 0 ? 1 : 0), 3.2, 4.5, 3.0, 1);
      cb.mesh(wtMat('ice_massive'), b, { x: bx, y: ya2 + 1.2, z: bz, yaw: yawIn + s * 0.4 });
      b.dispose();
      cb.collider({ shape: 'cylinder', x: bx, y: ya2 + 2.5, z: bz, r: 2.7, hy: 3.2, walkable: false, solid: true });
    }
  }

  // Glacier cover: lumpy snow / ice mounds over and beside the tunnel so it reads
  // as a glacier snout from outside (kept outside the walls and the vault), plus
  // a walkable roof collider so nobody can drop through the vault from the slope.
  for (let i = 0; i < STEPS; i++) {
    const t = (i + 0.5) / STEPS;
    const px = entrance.x + ux * len * t, pz = entrance.z + uz * len * t;
    const fy = (ys[i] + ys[i + 1]) / 2;
    cb.collider({ shape: 'box', x: px, y: fy + H + 0.9, z: pz, hx: segLen / 2 + 0.3, hy: 0.8, hz: W / 2 + 2.5, yaw: Math.atan2(-uz, ux), walkable: true, solid: true, surface: 'snow' });
    if (i % 2 === 1) continue;
    const top = boulder(1200 + i, W / 2 + 6, 4.5, segLen * 1.7, 1);
    cb.mesh(wtMat('snow'), top, { x: px + ux * segLen * 0.5, y: fy + H + 4.6, z: pz + uz * segLen * 0.5, yaw: yawIn }, { castShadow: true });
    top.dispose();
    for (const s of [-1, 1]) {
      const side = boulder(1250 + i * 2 + (s > 0 ? 1 : 0), 4, H / 2 + 2.5, segLen * 1.4, 1);
      const off = W / 2 + 4.2;
      cb.mesh(wtMat(i % 4 === 0 ? 'ice_massive' : 'snow'), side, { x: px + ux * segLen * 0.5 + nx * s * off, y: fy + H / 2 - 0.5, z: pz + uz * segLen * 0.5 + nz * s * off, yaw: yawIn });
      side.dispose();
    }
  }

  // Organic ice breaking up the straight walls: boulders hugging the walls
  // (floor-level ones are solid), glowing veins high up, stalagmites and long
  // icicle curtains near the walls.
  const r2 = new Random(311);
  for (let i = 0; i < STEPS; i++) {
    const fy = (ys[i] + ys[i + 1]) / 2;
    for (const s of [-1, 1]) {
      for (let j = 0; j < 3; j++) {
        const t = (i + (j + 0.5) / 3) / STEPS;
        const off = W / 2 + r2.range(0.1, 0.8);
        const bx = entrance.x + ux * len * t + nx * s * off, bz = entrance.z + uz * len * t + nz * s * off;
        const sz = r2.range(1.3, 2.3);
        const low = j !== 1;
        const by = low ? fy + r2.range(-0.4, 0.3) : fy + r2.range(3.2, 5.8);
        const b = boulder(900 + i * 11 + j * 3 + (s > 0 ? 1 : 0), sz, sz * r2.range(0.8, 1.4), sz * 0.85, 1);
        cb.mesh(wtMat(r2.chance(0.35) ? 'ice_trim' : 'ice_massive'), b, { x: bx, y: by, z: bz, yaw: r2.range(0, 6) });
        b.dispose();
        if (low) cb.collider({ shape: 'cylinder', x: bx, y: by + sz * 0.5, z: bz, r: sz * 0.75, hy: sz * 0.9, walkable: false, solid: true });
        else if (r2.chance(0.6)) {
          const c = crystalCluster(950 + i * 5 + j + (s > 0 ? 2 : 0), r2.range(0.7, 1.2), 4);
          k.props.mesh(wtMat('lantern_blue'), c, { x: bx - nx * s * sz * 0.7, y: by - 0.4, z: bz - nz * s * sz * 0.7, yaw: r2.range(0, 6), roll: s * 0.9 }, { castShadow: false });
          c.dispose();
        }
      }
      // Stalagmites and an icicle curtain along this wall.
      const t = (i + 0.5) / STEPS;
      const off = W / 2 - 1.2;
      const gx = entrance.x + ux * len * t + nx * s * off, gz = entrance.z + uz * len * t + nz * s * off;
      for (let q = 0; q < 3; q++) {
        const h = r2.range(0.8, 2.2);
        k.props.instance('cave_stalagmite', () => crystal(0.32, 1, 0.5), wtMat('ice_clear'),
          new THREE.Matrix4().compose(V(gx + ux * (q - 1) * 1.3, fy - 0.1, gz + uz * (q - 1) * 1.3), new THREE.Quaternion().setFromEuler(new THREE.Euler(0, r2.range(0, 6), 0)), V(1, h, 1)));
      }
      cb.collider({ shape: 'box', x: gx, y: fy + 1, z: gz, hx: 1.9, hy: 1.1, hz: 0.45, yaw: Math.atan2(-uz, ux), walkable: false, solid: true });
      for (let q = 0; q < 5; q++) {
        const cx2 = gx + ux * (q - 2) * 0.9 + nx * s * 0.6, cz2 = gz + uz * (q - 2) * 0.9 + nz * s * 0.6;
        k.props.instance('cave_icicle', () => {
          const c = new THREE.ConeGeometry(0.22, 1.6, 6);
          c.rotateX(Math.PI);
          c.translate(0, -0.8, 0);
          return c;
        }, wtMat('ice_clear'), new THREE.Matrix4().compose(V(cx2, fy + H + 0.2, cz2), new THREE.Quaternion(), V(1.2, r2.range(1.2, 2.6), 1.2)), false);
      }
    }
  }
}
