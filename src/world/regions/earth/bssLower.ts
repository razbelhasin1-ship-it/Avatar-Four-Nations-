import * as THREE from 'three';
import type { KitMaterialName } from '../../kit/Materials';
import { C, GROUND, INNER, INNER_FACE_IN, INNER_GATES, LOWER_AVENUES, MID, MID_FACE, MID_GATES, rayToCircle } from './bssLayout';
import { houseRowsGen, lanternsAlong, lastStats, pavedStrip, segDir } from './cityKit';
import type { EarthRegion } from './EarthRegion';
import type { BuildEnv } from './env';
import { annulusGeometry } from './geom';
import { bannerPole, crates, figureStatue, fountain, guardianStatue, lanternPost, lanternString, marketStall, planter, tree } from './parts';
import { BSS, marketStalls } from './spots';

/**
 * Ba Sing Se, Lower Ring: the paved band between the Inner Wall and the Middle
 * terrace. The Lower Ring Square (Earth start) with fountain, Earth King statue
 * and stalls; the Market Street; hundreds of small green-roofed houses in
 * concentric rows with radial alleys and laundry lines; lantern-lit avenues.
 */

const AWNINGS: KitMaterialName[] = ['cloth_green', 'cloth_yellow', 'cloth_red', 'cloth_white'];

export function* buildLowerRing(env: BuildEnv, site: EarthRegion): Generator<unknown, void, unknown> {
  const { chunks, mats, excl, rnd } = env;
  const Y = GROUND;

  // --- Ground: paved annulus between the terrace face and the inner wall.
  {
    const g = annulusGeometry(C.x, C.z, (a) => rayToCircle(a, MID, MID_FACE) - 1, () => INNER.r, Y + 0.015, 6, 192, 1);
    const b = chunks.named('major', 'ground').builder;
    b.mesh(mats.groundLower, g, { x: 0, y: 0, z: 0 }, { castShadow: false });
    g.dispose();
  }

  // --- Exclusions (before any placement).
  const sq = BSS.square;
  excl.rect(sq.x0, sq.z0, sq.x1, sq.z1);
  excl.circle(BSS.spawn.x, BSS.spawn.z, 8);
  excl.circle(BSS.elder.x, BSS.elder.z, 6);
  excl.seg(BSS.market.a.x, BSS.market.a.z, BSS.market.b.x, BSS.market.b.z, BSS.market.width / 2 + 6);
  for (const av of LOWER_AVENUES) excl.polyline(av.points, av.width / 2 + 2.5);
  // Ring road along the terrace face (the band's inner edge) is kept by the reject test below.
  yield;

  // --- Lower Ring Square.
  const sqB = chunks.named('props', 'lower_square').builder;
  {
    const major = chunks.named('major', 'ground').builder;
    major.box('paving', { x: (sq.x0 + sq.x1) / 2, y: Y - 0.03, z: (sq.z0 + sq.z1) / 2, sx: sq.x1 - sq.x0, sy: 0.1, sz: sq.z1 - sq.z0 }, { castShadow: false });
    // Darker border band along the square edges.
    for (const z of [sq.z0 + 0.6, sq.z1 - 0.6]) major.box('paving_dark', { x: (sq.x0 + sq.x1) / 2, y: Y - 0.02, z, sx: sq.x1 - sq.x0, sy: 0.1, sz: 1.2 }, { castShadow: false });
    // Fountain (water source).
    fountain(sqB, BSS.fountain.x, Y, BSS.fountain.z, BSS.fountain.r, { id: 'bss_square_fountain', label: 'Lower Ring Square fountain', capacity: 90, regen: 2 });
    env.waterIds.push('bss_square_fountain');
    site.mark('fountain', BSS.fountain.x, Y, BSS.fountain.z);
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2 + 0.2;
      planter(sqB, mats, BSS.fountain.x + Math.cos(a) * (BSS.fountain.r + 2.6), Y, BSS.fountain.z + Math.sin(a) * (BSS.fountain.r + 2.6), 1.1);
    }
    // Earth King statue (shrine) facing the square.
    figureStatue(sqB, BSS.kingStatue.x, Y, BSS.kingStatue.z, 0, 1.5, 'bronze');
    for (const sd of [-1, 1]) guardianStatue(sqB, BSS.kingStatue.x + sd * 6, Y, BSS.kingStatue.z + 1, 0, 0.8, 'stone_grey');
    // Stalls along the inner wall (counters facing east) with merchants' crates.
    BSS.squareStalls.forEach((s, i) => {
      marketStall(sqB, s.x, Y, s.z, Math.PI / 2, AWNINGS[i % AWNINGS.length], rnd, 4, 2.4);
      crates(chunks.at('detail', s.x, s.z).builder, s.x - 2.2, Y, s.z + 2.4, rnd, 3);
    });
    // Banner poles around the square and lantern posts.
    for (const [x, z] of [[624, -100], [624, -10], [686, -10], [660, -100], [676, -64], [676, -36]]) bannerPole(sqB, mats, x, Y, z, -Math.PI / 2, 8);
    for (const [x, z] of [[636, -54], [636, -82], [656, -54], [656, -82], [664, -20], [664, -40]]) {
      lanternPost(sqB, x, Y, z, 'warm');
      sqB.collider({ shape: 'cylinder', x, y: Y + 1.5, z, r: 0.2, hy: 1.5, walkable: false, solid: true });
    }
    // Trees in planters along the southern edge.
    for (let x = sq.x0 + 8; x < 664; x += 9) {
      if (Math.hypot(x - BSS.spawn.x, sq.z1 - 4 - BSS.spawn.z) < 9) continue;
      tree(sqB, mats, x, Y, sq.z1 - 4, 1.0, 'blossom', x * 0.3);
    }
  }
  yield;

  // --- Market Street (stalls both sides, lantern strings across).
  {
    const { a, b, width } = BSS.market;
    const mb = chunks.named('props', 'lower_market').builder;
    pavedStrip(chunks.named('major', 'ground').builder, mats.road, [a, b], width + 6, Y + 0.025, 4);
    for (const s of marketStalls()) {
      marketStall(mb, s.x, Y, s.z, s.yaw, rnd.pick(AWNINGS), rnd, 3.4, 2.2);
      if (rnd.chance(0.6)) crates(chunks.at('detail', s.x, s.z).builder, s.x + (s.x - s.mx) * -1.8, Y, s.z + (s.z - s.mz) * -1.8, rnd, 2);
    }
    const d = segDir(a, b);
    const nx = -d.z, nz = d.x;
    for (let s = 3; s < d.len; s += 10.5) {
      const p = { x: a.x + d.x * s, z: a.z + d.z * s };
      const off = width / 2 + 3.6;
      const pa = new THREE.Vector3(p.x + nx * off, Y + 4.6, p.z + nz * off), pc = new THREE.Vector3(p.x - nx * off, Y + 4.6, p.z - nz * off);
      for (const q of [pa, pc]) {
        mb.box('wood_dark', { x: q.x, y: Y + 2.4, z: q.z, sx: 0.2, sy: 4.8, sz: 0.2 }, { collide: true, walkable: false });
      }
      lanternString(chunks.at('detail', p.x, p.z).builder, mats, pa, pc, 0.7, 4, s % 21 < 10 ? 'red' : 'warm');
    }
  }
  yield;

  // --- Avenues: paving strips + lanterns from each inner gate to the terrace stairs.
  {
    const pb = chunks.named('major', 'ground').builder;
    for (const av of LOWER_AVENUES) {
      pavedStrip(pb, mats.road, av.points, av.width, Y + 0.03, 4);
      lanternsAlong(env, av.points, av.width / 2 + 0.8, Y, 18);
    }
    // West: from the inner west gate mouth across the square to the middle stairs.
    const gw = INNER_GATES[0];
    const mouth = { x: C.x + Math.cos(gw.theta) * (INNER_FACE_IN - 4), z: C.z + Math.sin(gw.theta) * (INNER_FACE_IN - 4) };
    pavedStrip(pb, mats.road, [mouth, { x: 650, z: -84 }, { x: MID_GATES[0].x - 12, z: MID_GATES[0].z }], 9, Y + 0.035, 4);
  }
  yield;

  // --- Houses: concentric rows around C (fronts alternate to face shared lanes).
  const n = yield* houseRowsGen(env, {
    c: C,
    rOuter: INNER_FACE_IN - 1.5,
    edge: 4,
    rStop: 120,
    y: Y,
    types: [['L1', 3], ['L2', 2.2], ['L3', 1.4], ['L3b', 1.2], ['L4', 0.9], ['L5', 1.3]],
    scale: [1.12, 1.4],
    pitch: 10.2,
    street: 4.4,
    gap: [0.3, 1.2],
    alleyEvery: 0.25,
    alleyW: 4.5,
    reject: (x, z) => Math.hypot(x - MID.x, z - MID.z) < MID_FACE + 3,
    vacancy: 0.05,
    laundry: 0.3,
    onVacant: (x, z, _yaw, hw) => {
      const b = chunks.at('props', x, z).builder;
      tree(b, mats, x, Y, z, 0.8 + rnd.range(0, 0.4), rnd.chance(0.3) ? 'blossom' : 'round', rnd.range(0, 6));
      if (hw > 3) crates(chunks.at('detail', x, z).builder, x + hw * 0.5, Y, z, rnd, 2);
    },
  });
  site.mark('lowerHouses', n, 0, 0);
  site.mark('lowerStats', lastStats.lots, lastStats.blocked, lastStats.rejected * 1000 + lastStats.outside);
  yield;

  // --- Ambient life: townsfolk in the square and the market, guards at the gates.
  const amb: Array<[string, string, 'villager' | 'merchant' | 'guard' | 'child' | 'elder', number, number, number, { type: 'idle'; variant?: 'stand' | 'sit' | 'work' | 'guard' } | { type: 'wander'; radius: number } | { type: 'converse' }]> = [
    ['sq_vendor_1', 'Cabbage Seller', 'merchant', BSS.squareStalls[0].x - 1.9, BSS.squareStalls[0].z, Math.PI / 2, { type: 'idle', variant: 'work' }],
    ['sq_vendor_2', 'Fruit Vendor', 'merchant', BSS.squareStalls[3].x - 1.9, BSS.squareStalls[3].z, Math.PI / 2, { type: 'idle', variant: 'work' }],
    ['sq_walker_1', 'Lower Ring Resident', 'villager', 650, -50, 0, { type: 'wander', radius: 10 }],
    ['sq_walker_2', 'Refugee', 'villager', 638, -80, 0, { type: 'wander', radius: 8 }],
    ['sq_chat_1', 'Washerwoman', 'villager', 660, -78, -2.2, { type: 'converse' }],
    ['sq_chat_2', 'Porter', 'villager', 662, -80, 1.0, { type: 'converse' }],
    ['sq_child', 'Street Kid', 'child', 652, -64, 0, { type: 'wander', radius: 7 }],
    ['mk_vendor_1', 'Tea Peddler', 'merchant', marketStalls()[4].mx, marketStalls()[4].mz, marketStalls()[4].yaw, { type: 'idle', variant: 'work' }],
    ['mk_vendor_2', 'Silk Merchant', 'merchant', marketStalls()[9].mx, marketStalls()[9].mz, marketStalls()[9].yaw, { type: 'idle', variant: 'work' }],
    ['mk_walker_1', 'Shopper', 'villager', 668, -133, 0, { type: 'wander', radius: 12 }],
    ['mk_walker_2', 'Shopper', 'villager', 662, -120, 0, { type: 'wander', radius: 10 }],
    ['gate_guard_1', 'Gate Guard', 'guard', 633, -90, 1.9, { type: 'idle', variant: 'guard' }],
    ['gate_guard_2', 'Gate Guard', 'guard', 636, -100, 1.9, { type: 'idle', variant: 'guard' }],
    ['stair_guard_1', 'Dai Li Agent', 'guard', MID_GATES[0].x - 13, MID_GATES[0].z - 10, Math.PI / 2, { type: 'idle', variant: 'guard' }],
    ['stair_guard_2', 'Dai Li Agent', 'guard', MID_GATES[0].x - 13, MID_GATES[0].z + 10, Math.PI / 2, { type: 'idle', variant: 'guard' }],
  ];
  let seed = 7100;
  for (const [id, name, role, x, z, yaw, behavior] of amb) {
    site.npc({ id: `bss_amb_${id}`, name, role, nation: 'earth', element: role === 'guard' ? 'earth' : undefined, appearanceSeed: seed++, x, z, y: Y, yaw, behavior, region: 'ba_sing_se', marker: 'none' });
  }
}
