import * as THREE from 'three';
import type { GameContext } from '../../../core/GameContext';
import type { ContentBuilder } from '../../kit/Builder';
import { heightAt } from '../../Heightfield';
import { FireRegion } from './FireRegion';
import { mulberry, sunDiscGeo } from './geom';
import { ancientStoneMat, emberGlowMat, goldMat, mossStoneMat, sunDiscMat } from './materials';
import { dragonStatue, flight, local, P, rock, tree } from './parts';
import { addFireSpots } from './spots';

/**
 * The Sun Warrior Ruins (hidden landmark dragon_bone_caldera) on the volcano's
 * north-western flank: an overgrown stone plaza (training ground of Sun Chief
 * Ahkon) with the altar of the Eternal Flame, a stepped pyramid temple built
 * into the hillside crowned by the sun disc, stone dragon statues, broken
 * colonnades, jungle growth and, higher up the ridge, the dragon's perch.
 *
 * Site frame: origin at the landmark, local +Z points downhill (south-west),
 * local +X to the north-west.
 */
export const RUINS = (() => {
  const o = { x: -1560, z: 940 };
  const yaw = -0.75 * Math.PI; // local +Z → (sin, cos) = (-0.707, -0.707): south-west
  const W = (lx: number, lz: number) => local(o.x, o.z, yaw, lx, lz);
  // Plaza: lx ∈ [-17, 17], lz ∈ [-6, 26]; top just above the highest terrain under it.
  let top = 0;
  for (let lx = -17; lx <= 17; lx += 2) for (let lz = -6; lz <= 26; lz += 2) {
    const p = W(lx, lz);
    top = Math.max(top, heightAt(p.x, p.z));
  }
  const plazaY = Math.round((top + 0.3) * 10) / 10;
  return { o, yaw, W, plazaY, plaza: { x0: -17, x1: 17, z0: -6, z1: 26 }, pyramid: { lz: -20, base: 28, tiers: 5, tierH: 4.2, inset: 2.6 }, altar: { lx: 11, lz: -1 }, train: { lx: 0, lz: 12.5 }, perch: { x: -1512, z: 988 } };
})();

export class SunWarriorRuins extends FireRegion {
  readonly id = 'fire_sun_warrior_ruins';
  readonly center = { x: RUINS.o.x + 6, z: RUINS.o.z + 6 };
  readonly loadRadius = 300;

  protected construct(_ctx: GameContext): void {
    // Hidden ruins: nothing is drawn at 'far' detail (they sit behind the caldera rim
    // and should be found, not spotted from the capital).
    const s = this.layer('ruins', { far: false, shadows: true });
    const d = this.layer('ruins_detail');
    const g = this.layer('ruins_growth', { decor: 'extra' });
    const R = RUINS;
    const Y = R.plazaY;
    const W = R.W;
    const yaw = R.yaw;
    const stone = ancientStoneMat();
    const moss = mossStoneMat();
    const rnd = mulberry(1337);

    // --- Plaza platform (retaining walls down to the hillside) ---
    const pc = W(0, (R.plaza.z0 + R.plaza.z1) / 2);
    const pw = R.plaza.x1 - R.plaza.x0, pd = R.plaza.z1 - R.plaza.z0;
    let low = Infinity;
    for (let lx = R.plaza.x0; lx <= R.plaza.x1; lx += 4) for (let lz = R.plaza.z0; lz <= R.plaza.z1; lz += 4) {
      const p = W(lx, lz);
      low = Math.min(low, heightAt(p.x, p.z));
    }
    s.box(stone, { x: pc.x, y: (low - 2 + Y) / 2, z: pc.z, sx: pw, sy: Y - low + 2, sz: pd, yaw }, { collide: true, walkable: true, surface: 'stone' });
    s.box(moss, { x: pc.x, y: Y + 0.02, z: pc.z, sx: pw - 0.3, sy: 0.05, sz: pd - 0.3, yaw }, { castShadow: false });
    // Sun inlay on the training ground (gold ring + rays, worn).
    const tc = W(R.train.lx, R.train.lz);
    d.mesh(sunDiscMat(), P.crestRing(), { x: tc.x, y: Y + 0.05, z: tc.z, pitch: -Math.PI / 2, sx: 14, sy: 14, sz: 0.2 }, { castShadow: false });
    // Weathered cornice blocks along the plaza edge (gaps = collapsed parts).
    for (let lx = R.plaza.x0 + 1; lx <= R.plaza.x1 - 1; lx += 2.2) {
      for (const lz of [R.plaza.z1 - 0.5]) {
        if (Math.abs(lx) < 6) continue; // approach stair
        if (rnd() < 0.25) continue;
        const p = W(lx, lz);
        s.box(stone, { x: p.x, y: Y + 0.45, z: p.z, sx: 1.9, sy: 0.9 + rnd() * 0.4, sz: 0.9, yaw: yaw + (rnd() - 0.5) * 0.08 }, { collide: true, walkable: true });
      }
    }
    for (const side of [-1, 1]) {
      for (let lz = R.plaza.z0 + 1; lz <= R.plaza.z1 - 1; lz += 2.2) {
        if (rnd() < 0.3) continue;
        const p = W(side * (pw / 2 - 0.5), lz);
        s.box(stone, { x: p.x, y: Y + 0.45, z: p.z, sx: 0.9, sy: 0.9 + rnd() * 0.4, sz: 1.9, yaw: yaw + (rnd() - 0.5) * 0.08 }, { collide: true, walkable: true });
      }
    }
    // Grand approach stair down the hillside (south-west).
    const stTop = W(0, R.plaza.z1);
    let stBottomLz = R.plaza.z1 + 4;
    let footY = Y;
    for (let lz = R.plaza.z1 + 4; lz < R.plaza.z1 + 120; lz += 1) {
      const p = W(0, lz);
      const h = heightAt(p.x, p.z);
      // Stair line descends at ~35°; stop where it meets the ground.
      const sy = Y - (lz - R.plaza.z1) * 0.7;
      stBottomLz = lz;
      footY = Math.max(h, sy);
      if (sy <= h + 0.3) break;
    }
    const stBottom = W(0, stBottomLz);
    if (Y - footY > 0.4) flight(s, { from: new THREE.Vector3(stBottom.x, footY, stBottom.z), to: new THREE.Vector3(stTop.x, Y, stTop.z), width: 9, mat: stone, cheek: moss, cheekH: 0.8, step: 0.24 });
    this.approach = { x: stBottom.x, z: stBottom.z, y: footY };

    // --- Stepped pyramid built into the hillside ---
    const py = R.pyramid;
    let size = py.base;
    let y = Y;
    for (let i = 0; i < py.tiers; i++) {
      const c = W(0, py.lz);
      const h = py.tierH;
      s.box(i % 2 === 0 ? stone : moss, { x: c.x, y: y + h / 2 - (i === 0 ? 3 : 0), z: c.z, sx: size, sy: h + (i === 0 ? 6 : 0), sz: size, yaw }, { collide: true, walkable: true });
      // Cornice line and carved frieze blocks on the front face.
      const f = W(0, py.lz + size / 2 + 0.15);
      s.box(stone, { x: f.x, y: y + h - 0.3, z: f.z, sx: size + 0.3, sy: 0.6, sz: 0.5, yaw });
      for (let k = -2; k <= 2; k++) {
        if (k === 0) continue;
        const q = W(k * size * 0.19, py.lz + size / 2 + 0.2);
        d.box(moss, { x: q.x, y: y + h * 0.45, z: q.z, sx: 1.6, sy: 1.6, sz: 0.3, yaw }, { castShadow: false });
      }
      y += h;
      size -= py.inset * 2;
    }
    const summitY = y;
    // Central stair from the plaza to the summit.
    const sb = W(0, py.lz + py.base / 2 + 6.5);
    // The flight ends 0.6 m in front of the top tier so it is at full height before the step-off.
    const stEnd = W(0, py.lz + size / 2 + py.inset + 0.6);
    flight(s, { from: new THREE.Vector3(sb.x, Y, sb.z), to: new THREE.Vector3(stEnd.x, summitY, stEnd.z), width: 6, mat: stone, cheek: moss, cheekH: 1.0, step: 0.25 });
    // Summit shrine: sun disc on a stone frame facing the plaza, flanked by pillars.
    const sc = W(0, py.lz - 1);
    s.block(stone, { x: sc.x, y: summitY, z: sc.z, sx: size, sy: 0.6, sz: size, yaw }, { collide: true, walkable: true });
    const disc = sunDiscGeo(3.4, 16, 0.5);
    const dc = W(0, py.lz - size / 2 + 1.2);
    s.block(stone, { x: dc.x, y: summitY + 0.6, z: dc.z, sx: 9.5, sy: 1.2, sz: 1.6, yaw }, { collide: true, walkable: true });
    for (const side of [-1, 1]) {
      const pp = W(side * 4.2, py.lz - size / 2 + 1.2);
      s.cylinder(stone, { x: pp.x, y: summitY + 1.8, z: pp.z, r: 0.75, h: 7.2, segments: 8 }, { collide: true, walkable: false });
    }
    s.mesh(sunDiscMat(), disc, { x: dc.x, y: summitY + 6.6, z: dc.z, yaw }, { castShadow: true });
    disc.dispose();
    s.box(stone, { x: dc.x, y: summitY + 9.4, z: dc.z, sx: 10.5, sy: 1.0, sz: 1.8, yaw });
    this.summit = { ...W(0, py.lz + 1.5), y: summitY + 0.6 };

    // --- Altar of the Eternal Flame ---
    const al = W(R.altar.lx, R.altar.lz);
    s.cylinder(stone, { x: al.x, y: Y, z: al.z, r: 2.6, rTop: 2.3, h: 0.6, segments: 10 }, { collide: true, walkable: true });
    s.cylinder(moss, { x: al.x, y: Y + 0.6, z: al.z, r: 1.7, rTop: 1.4, h: 0.9, segments: 10 }, { collide: true, walkable: false });
    s.mesh('bronze', P.bowl(), { x: al.x, y: Y + 1.5, z: al.z, sx: 1.25, sy: 0.9, sz: 1.25 });
    s.cylinder(emberGlowMat(), { x: al.x, y: Y + 2.0, z: al.z, r: 1.05, h: 0.08, segments: 12 });
    this.flames.add(al.x, Y + 2.05, al.z, 2.6, 3.6);
    this.flames.add(al.x + 0.35, Y + 2.0, al.z - 0.2, 1.6, 2.4);
    this.flames.add(al.x - 0.3, Y + 2.0, al.z + 0.25, 1.5, 2.2);
    this.ambient({ x: al.x, y: Y + 3, z: al.z, preset: 'embers', rate: 6, range: 120, essential: true });
    this.altar = { x: al.x, z: al.z, y: Y };
    this.interactable({
      id: 'fn_eternal_flame',
      position: new THREE.Vector3(al.x, Y + 1.2, al.z),
      radius: 4.2,
      label: 'Meditate before the Eternal Flame',
      enabled: () => this.ctx.time.elapsed > this.meditateCooldown,
      interact: (ctx) => {
        this.meditateCooldown = ctx.time.elapsed + 20;
        const p = ctx.player;
        if (p) p.chi = p.maxChi;
        ctx.events.emit('ui:notify', { text: 'The Eternal Flame breathes with you. Your inner fire is renewed.', kind: 'info', duration: 3.5 });
      },
    });

    // --- Stone dragons: at the approach and flanking the pyramid stair ---
    for (const side of [-1, 1]) {
      const a = W(side * 10, R.plaza.z1 - 2.6);
      dragonStatue(s, { x: a.x, y: Y, z: a.z, yaw, s: 5.5, mat: moss, pedestal: stone, pedestalH: 1.4 });
      const b = W(side * 6, py.lz + py.base / 2 + 3.2);
      dragonStatue(s, { x: b.x, y: Y, z: b.z, yaw, s: 4.2, mat: stone, pedestal: moss, pedestalH: 1.0 });
    }

    // --- Broken colonnades along the plaza sides ---
    for (const side of [-1, 1]) {
      for (let k = 0; k < 7; k++) {
        const lz = R.plaza.z0 + 3 + k * 4.2;
        if (Math.abs(side * 14.2 - R.altar.lx) < 5 && Math.abs(lz - R.altar.lz) < 5) continue; // altar side
        const p = W(side * 14.2, lz);
        const h = rnd() < 0.35 ? 1.2 + rnd() * 2 : 5.5 + rnd() * 1.5;
        s.cylinder(k % 2 ? moss : stone, { x: p.x, y: Y, z: p.z, r: 0.7, rTop: 0.62, h, segments: 8 }, { collide: true, walkable: false });
        if (h > 5) s.box(stone, { x: p.x, y: Y + h + 0.3, z: p.z, sx: 1.8, sy: 0.6, sz: 1.8, yaw });
        else rock(d, { x: p.x + (rnd() - 0.5) * 3, y: Y, z: p.z + (rnd() - 0.5) * 3, s: 0.9, sy: 0.7, variant: k, mat: stone });
      }
    }

    // --- Jungle growth: trees around the terraces, vines on the tiers ---
    for (let i = 0; i < 26; i++) {
      const a = rnd() * Math.PI * 2;
      const r = 26 + rnd() * 30;
      const x = pc.x + Math.cos(a) * r, z = pc.z + Math.sin(a) * r;
      // Trees have trunk colliders, so they live in an always-visible layer (only collider-free growth is optional decor).
      tree(d, 'jungle', { x, y: heightAt(x, z) - 0.2, z, s: 9 + rnd() * 7, yaw: rnd() * 6, variant: i, collide: true });
    }
    for (let i = 0; i < 10; i++) {
      const lx = (rnd() - 0.5) * 30, lz = R.plaza.z0 + 1 + rnd() * (pd - 2);
      if (Math.hypot(lx - R.train.lx, lz - R.train.lz) < 14) continue;
      const p = W(lx, lz);
      tree(g, 'bush', { x: p.x, y: Y, z: p.z, s: 1.4 + rnd() * 1.0, variant: i, collide: false });
    }
    let vs = py.base;
    let vy = Y;
    for (let i = 0; i < py.tiers; i++) {
      for (let k = 0; k < 4; k++) {
        const lx = (rnd() - 0.5) * (vs - 2);
        if (Math.abs(lx) < 4) continue;
        const p = W(lx, py.lz + vs / 2 + 0.3);
        const len = 1.5 + rnd() * 2.5;
        g.box('plaster_green', { x: p.x, y: vy + py.tierH - len / 2, z: p.z, sx: 0.5 + rnd() * 0.6, sy: len, sz: 0.12, yaw }, { castShadow: false });
      }
      vy += py.tierH;
      vs -= py.inset * 2;
    }

    // --- Dragon's perch: a flat ledge high on the ridge above the ruins ---
    const pr = RUINS.perch;
    let ph = 0, pl = Infinity;
    for (let dx = -8; dx <= 8; dx += 2) for (let dz = -8; dz <= 8; dz += 2) {
      const h = heightAt(pr.x + dx, pr.z + dz);
      ph = Math.max(ph, h);
      pl = Math.min(pl, h);
    }
    ph = Math.round((ph + 0.3) * 10) / 10;
    // A natural rock outcrop: a flat basalt table on a cluster of big boulders.
    s.cylinder('stone_dark', { x: pr.x, y: ph - 1.4, z: pr.z, r: 8.6, rTop: 8.2, h: 1.4, segments: 9 }, { collide: true, walkable: true, surface: 'rock' });
    for (let k = 0; k < 9; k++) {
      const a = (k / 9) * Math.PI * 2 + rnd() * 0.3;
      const rr = 4 + rnd() * 3.5;
      const bx = pr.x + Math.cos(a) * rr, bz = pr.z + Math.sin(a) * rr;
      const gh = heightAt(bx, bz);
      const sy = Math.max(2, ph - gh + 1);
      rock(s, { x: bx, y: gh - 1.5, z: bz, s: 4.5 + rnd() * 2.5, sy: sy * 0.75, yaw: rnd() * 6, variant: k, mat: 'stone_dark' });
    }
    s.collider({ shape: 'cylinder', x: pr.x, y: (pl + ph) / 2 - 1, z: pr.z, r: 8.4, hy: (ph - pl) / 2 + 0.6, walkable: true, solid: true, surface: 'rock' });
    for (let k = 0; k < 6; k++) {
      const a = (k / 6) * Math.PI * 2;
      rock(s, { x: pr.x + Math.cos(a) * 7.8, y: ph - 0.5, z: pr.z + Math.sin(a) * 7.8, s: 1.4 + rnd(), sy: 1.2, variant: k, mat: stone, collide: true });
    }
    // Scorched claw marks / old bones hint: dark slabs.
    d.box('stone_dark', { x: pr.x, y: ph + 0.02, z: pr.z, sx: 6, sy: 0.04, sz: 1.2, yaw: 0.5 }, { castShadow: false });
    this.perchY = ph;
    void goldMat;
  }

  approach: { x: number; z: number; y: number } | null = null;
  private meditateCooldown = -1;
  summit: { x: number; z: number; y: number } | null = null;
  altar: { x: number; z: number; y: number } | null = null;
  perchY = 0;
}

// --- Spots ---------------------------------------------------------------
{
  const R = RUINS;
  const t = R.W(R.train.lx, R.train.lz);
  const m = R.W(R.altar.lx - 3.6, R.altar.lz + 1.5);
  const faceSW = Math.atan2(Math.sin(R.yaw), Math.cos(R.yaw));
  let ph = 0;
  for (let dx = -8; dx <= 8; dx += 2) for (let dz = -8; dz <= 8; dz += 2) ph = Math.max(ph, heightAt(R.perch.x + dx, R.perch.z + dz));
  addFireSpots({
    master_ahkon: { x: m.x, z: m.z, y: R.plazaY, yaw: R.yaw, r: 3, label: 'Sun Chief Ahkon, Altar of the Eternal Flame', region: 'fire_nation_capital' },
    training_ahkon: { x: t.x, z: t.z, y: R.plazaY, yaw: R.yaw + Math.PI, r: 12, label: 'Sun Warrior plaza', region: 'fire_nation_capital' },
    shrine_eternal_flame: { x: R.W(R.altar.lx, R.altar.lz).x, z: R.W(R.altar.lx, R.altar.lz).z, y: R.plazaY, yaw: R.yaw, r: 3, label: 'Altar of the Eternal Flame', region: 'fire_nation_capital' },
    shrine_sun_warrior_pyramid: { x: R.W(0, R.pyramid.lz).x, z: R.W(0, R.pyramid.lz).z, r: 21, label: 'Sun Warrior pyramid', region: 'fire_nation_capital' },
    viewpoint_sun_warrior_approach: { x: R.W(0, R.plaza.z1 + 22).x, z: R.W(0, R.plaza.z1 + 22).z, r: 14, label: 'Sun Warrior approach stair', region: 'fire_nation_capital' },
    habitat_dragon_1: { x: R.perch.x, z: R.perch.z, y: Math.round((ph + 0.3) * 10) / 10, yaw: faceSW, r: 8, label: "Dragon's perch above the Sun Warrior Ruins", region: 'fire_nation_capital' },
  });
}
