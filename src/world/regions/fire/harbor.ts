import * as THREE from 'three';
import type { GameContext } from '../../../core/GameContext';
import type { ContentBuilder } from '../../kit/Builder';
import { getRoadRuntime, heightAt } from '../../Heightfield';
import { FireRegion } from './FireRegion';
import { hullGeo, mulberry } from './geom';
import { basaltMat, bannerDarkMat, crimsonMat, goldMat, ivoryMat, lacquerRedMat, steelDarkMat, steelMat } from './materials';
import { bannerPole, brazier, cargo, crest, flight, hall, hangingLantern, lanternPost, local, P, parapet, roof, stall, wallBanner } from './parts';
import { addFireSpots } from './spots';

/**
 * Capital Harbor, outside the caldera rim on the eastern shore of the island:
 *
 *  - North quay (z 962–1000) and South basin quay (z 1000–1068) at y 5.2 on
 *    the natural rock shelf, with a harbour wall dropping into the sea;
 *  - two long piers with moored Fire Navy steamships (smokestacks, superstructure,
 *    boardable decks via gangplanks), a beacon tower, cranes, warehouses,
 *    a fish market (merchant_fn_3) and lanterns;
 *  - the harbour-master's overlook terrace at the fn_harbor landmark (y ≈ 46)
 *    joined to the causeway road;
 *  - a paved ramp from the causeway road's start down to the quays.
 */

export const HARBOR = {
  Y: 5.2,
  north: { x0: -909, x1: -894, z0: 962, z1: 1000 },
  south: { x0: -906, x1: -875, z0: 1000, z1: 1068 },
  piers: [
    { z: 984, x0: -895, x1: -846, w: 7 },
    { z: 1049, x0: -876, x1: -828, w: 7 },
  ],
  ships: [
    { x: -866, z: 974.6, L: 44, B: 10, H: 7.4, stacks: 2 },
    { x: -847, z: 1039.4, L: 40, B: 9.4, H: 7, stacks: 2 },
    { x: -848, z: 1058.6, L: 24, B: 6.4, H: 5.2, stacks: 1 },
  ],
  overlook: { x: -1010, z: 981, w: 26, d: 22 },
  landmark: { x: -1010, z: 980 },
  market: { x: -901.5, z0: 968 },
  beacon: { x: -849, z: 984 },
} as const;

/** Fish-market stall i (pure; shared with the merchant spot). */
function marketStall(i: number): { x: number; z: number; yaw: number } {
  return { x: HARBOR.market.x, z: HARBOR.market.z0 + i * 6.2, yaw: Math.PI / 2 };
}

export class FireHarbor extends FireRegion {
  readonly id = 'fire_harbor';
  readonly center = { x: -935, z: 1010 };
  readonly loadRadius = 430;
  private shipGroups: Array<{ g: THREE.Object3D; phase: number; base: number }> = [];

  protected construct(_ctx: GameContext): void {
    this.buildQuays();
    this.buildPiers();
    this.buildShips();
    this.buildWarehouses();
    this.buildOverlook();
    this.buildRamp();
    this.ambientLife();
  }

  private ambientLife(): void {
    let seed = 9300;
    const R = 'fire_nation_capital';
    const add = (id: string, name: string, role: 'villager' | 'soldier' | 'noble' | 'guard', x: number, z: number, y: number, yaw: number, variant: 'stand' | 'work' | 'guard' | 'sit') =>
      this.npc({ id: `fn_harbor_${id}`, name, role, nation: 'fire', appearanceSeed: seed++, x, z, y, yaw, behavior: { type: 'idle', variant }, region: R, marker: 'none' });
    add('docker_1', 'Dock Worker', 'villager', -891, 1013, HARBOR.Y, -Math.PI / 2, 'work');
    add('docker_2', 'Dock Worker', 'villager', -887.5, 1046, HARBOR.Y, -Math.PI / 2, 'work');
    add('docker_3', 'Fishmonger', 'villager', -897, 990.5, HARBOR.Y, Math.PI / 2, 'work');
    const s0 = HARBOR.ships[0];
    add('sailor_1', 'Fire Navy Sailor', 'soldier', s0.x + 6, s0.z - 1.5, -s0.H * 0.45 + s0.H, Math.PI / 2, 'guard');
    add('harbormaster', 'Harbour-master', 'noble', HARBOR.north.x0 + 9.2, 993, HARBOR.Y, Math.PI / 2, 'stand');
    add('overlook_guard', 'Harbour Guard', 'guard', HARBOR.overlook.x + 9, HARBOR.overlook.z + 6, this.overlookY, Math.PI / 2, 'guard');
  }

  // -------------------------------------------------------------------------

  private buildQuays(): void {
    const s = this.layer('quays', { far: true });
    const d = this.layer('quays_detail');
    const Y = HARBOR.Y;
    for (const q of [HARBOR.north, HARBOR.south]) {
      const cx = (q.x0 + q.x1) / 2, cz = (q.z0 + q.z1) / 2;
      const w = q.x1 - q.x0, dd = q.z1 - q.z0;
      // Massive quay block from the sea bed to the deck, paved top.
      s.box(basaltMat(), { x: cx, y: (Y - 0.4 - 12) / 2, z: cz, sx: w, sy: Y - 0.4 + 12, sz: dd }, { collide: true, walkable: true, surface: 'stone' });
      s.box('paving', { x: cx, y: Y - 0.2, z: cz, sx: w, sy: 0.4, sz: dd }, { collide: true, walkable: true, surface: 'stone', castShadow: false });
      // Seaward wall face: ivory band with a crimson/gold cope.
      s.box(ivoryMat(), { x: q.x1 + 0.3, y: Y - 1.6, z: cz, sx: 0.6, sy: 2.8, sz: dd }, { castShadow: false });
      s.box(crimsonMat(), { x: q.x1 + 0.25, y: Y - 0.15, z: cz, sx: 0.7, sy: 0.3, sz: dd + 0.2 });
    }
    // South end wall of the north quay where it meets the south basin.
    // Bollards and lantern posts along the sea edges.
    const edge: Array<[number, number, number]> = [
      [HARBOR.north.x1 - 0.8, HARBOR.north.z0 + 3, HARBOR.north.z1 - 1],
      [HARBOR.south.x1 - 0.8, HARBOR.south.z0 + 2, HARBOR.south.z1 - 2],
    ];
    for (const [x, z0, z1] of edge) {
      for (let z = z0; z <= z1; z += 6.5) {
        if (HARBOR.piers.some((p) => Math.abs(p.z - z) < p.w / 2 + 1.5)) continue; // pier roots stay open
        d.cylinder('stone_dark', { x, y: Y, z, r: 0.32, rTop: 0.38, h: 0.75, segments: 8 }, { collide: true, walkable: false });
      }
      for (let z = z0 + 4; z <= z1; z += 19) lanternPost(d, { x: x - 1.6, y: Y, z, yaw: Math.PI / 2, h: 3.6 });
    }
    // Parapet along the north end of the north quay (toward the causeway abutment).
    parapet(s, [{ x: HARBOR.north.x0, z: HARBOR.north.z0 + 0.3 }, { x: HARBOR.north.x1, z: HARBOR.north.z0 + 0.3 }], { y: Y, h: 1.0, thick: 0.5, mat: crimsonMat() });
    // Fish market on the north quay (merchant_fn_3 stands at stall 1).
    for (let i = 0; i < 3; i++) {
      const st = marketStall(i);
      stall(d, { x: st.x, y: Y, z: st.z + 8, yaw: st.yaw, seed: 600 + i, w: 4.4 });
    }
    for (let i = 0; i < 4; i++) cargo(d, { x: -899 + (i % 2) * 2, y: Y, z: 992 + i * 1.5, seed: 700 + i, n: 3 });
    // Harbour-master's office at the north quay's back.
    const ox = HARBOR.north.x0 + 4.5, oz = 993;
    s.block('plaster_cream', { x: ox, y: Y, z: oz, sx: 7, sy: 4, sz: 9 }, { collide: true, walkable: true });
    roof(s, { x: ox, y: Y + 4, z: oz, w: 7, d: 9, h: 2.6, yaw: Math.PI / 2, mat: 'roof_red', overhang: 0.9, curve: 0.5, horns: 0.8, tips: 0.6 });
    wallBanner(d, { x: ox + 3.56, y: Y + 3.6, z: oz, yaw: Math.PI / 2, w: 1.6, len: 3, mat: bannerDarkMat() });
  }

  private buildPiers(): void {
    const s = this.layer('piers', { far: true });
    const d = this.layer('piers_detail');
    const Y = HARBOR.Y;
    for (const p of HARBOR.piers) {
      const cx = (p.x0 + p.x1) / 2, len = p.x1 - p.x0;
      s.box('wood_dark', { x: cx, y: Y - 0.25, z: p.z, sx: len, sy: 0.5, sz: p.w }, { collide: true, walkable: true, surface: 'wood' });
      s.box('wood', { x: cx, y: Y + 0.02, z: p.z, sx: len - 0.2, sy: 0.06, sz: p.w - 0.3 }, { castShadow: false });
      // Piles.
      for (let x = p.x0 + 2; x <= p.x1; x += 5) for (const sz of [-1, 1]) {
        s.cylinder('wood_dark', { x, y: -14, z: p.z + sz * (p.w / 2 - 0.3), r: 0.35, h: Y - 0.4 + 14, segments: 6 });
      }
      // Bollards & lanterns along both sides.
      for (let x = p.x0 + 5; x < p.x1 - 2; x += 8) for (const sz of [-1, 1]) {
        d.cylinder('stone_dark', { x, y: Y, z: p.z + sz * (p.w / 2 - 0.5), r: 0.28, rTop: 0.34, h: 0.7, segments: 8 }, { collide: true, walkable: false });
      }
      for (let x = p.x0 + 9; x < p.x1 - 3; x += 16) lanternPost(d, { x, y: Y, z: p.z - (p.w / 2 - 0.6), yaw: 0, h: 3.4 });
    }
    // Beacon tower at the end of pier A (fire beacon for the fleet).
    const b = HARBOR.beacon;
    s.block(basaltMat(), { x: b.x, y: Y - 0.5, z: b.z, sx: 5, sy: 1.5, sz: 5 }, { collide: true, walkable: true });
    s.block(ivoryMat(), { x: b.x, y: Y + 1, z: b.z, sx: 3.6, sy: 11, sz: 3.6 }, { collide: true, walkable: false });
    for (const by of [4, 8]) s.box(crimsonMat(), { x: b.x, y: Y + 1 + by, z: b.z, sx: 3.75, sy: 0.6, sz: 3.75 });
    s.block('black_lacquer', { x: b.x, y: Y + 12, z: b.z, sx: 4.6, sy: 0.6, sz: 4.6 });
    for (const [sx, sz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) s.box(lacquerRedMat(), { x: b.x + sx * 1.9, y: Y + 14, z: b.z + sz * 1.9, sx: 0.3, sy: 3.4, sz: 0.3 });
    roof(s, { x: b.x, y: Y + 15.7, z: b.z, w: 4, d: 4, h: 2, style: 'pyramid', mat: 'roof_dark', overhang: 0.8, curve: 0.5, tips: 0.6, finial: 1.6 });
    brazier(d, this.flames, { x: b.x, y: Y + 12.6, z: b.z, size: 1.2, style: 'bowl', collide: false });
    this.ambient({ x: b.x, y: Y + 15, z: b.z, preset: 'embers', rate: 3, range: 120 });
    // Cranes on the south basin edge.
    for (const cz of [1020, 1036]) this.crane(s, d, HARBOR.south.x1 - 2.6, Y, cz, Math.PI / 2);
    this.crane(s, d, HARBOR.north.x1 - 2.4, Y, 966, Math.PI / 2);
  }

  /** Timber dock crane: tower, slewing jib over the water, rope and a hanging crate. */
  private crane(s: ContentBuilder, d: ContentBuilder, x: number, y: number, z: number, yaw: number): void {
    s.block('stone_dark', { x, y, z, sx: 3.4, sy: 0.6, sz: 3.4, yaw }, { collide: true, walkable: true });
    for (const [lx, lz] of [[-1.2, -1.2], [1.2, -1.2], [-1.2, 1.2], [1.2, 1.2]]) {
      const p = local(x, z, yaw, lx, lz);
      s.box('wood_dark', { x: p.x, y: y + 5.6, z: p.z, sx: 0.32, sy: 10, sz: 0.32, yaw });
    }
    for (const hy of [3, 6.5, 10]) s.box('wood', { x, y: y + hy, z, sx: 2.8, sy: 0.22, sz: 2.8, yaw });
    s.box('wood_dark', { x, y: y + 10.8, z, sx: 3, sy: 0.6, sz: 3, yaw });
    // Jib: from the tower top out over the water along local +Z, tilted up.
    const jl = 11;
    const tilt = 0.32;
    const jc = local(x, z, yaw, 0, (jl / 2) * Math.cos(tilt) - 1);
    s.box('wood_dark', { x: jc.x, y: y + 11 + (jl / 2) * Math.sin(tilt), z: jc.z, sx: 0.45, sy: 0.55, sz: jl, yaw, pitch: -tilt });
    const tip = local(x, z, yaw, 0, jl * Math.cos(tilt) - 1);
    const tipY = y + 11 + jl * Math.sin(tilt);
    d.box('black_lacquer', { x: tip.x, y: tipY - 4, z: tip.z, sx: 0.06, sy: 8, sz: 0.06, yaw }, { castShadow: false });
    d.box('wood', { x: tip.x, y: tipY - 8.6, z: tip.z, sx: 1.4, sy: 1.1, sz: 1.4, yaw: yaw + 0.4 });
    s.box('stone_dark', { x, y: y + 11.6, z, sx: 1.6, sy: 1, sz: 1.6, yaw }); // counterweight housing
    s.collider({ shape: 'box', x, y: y + 5.6, z, hx: 1.5, hy: 5.2, hz: 1.5, yaw, walkable: true, solid: true });
  }

  private buildShips(): void {
    let i = 0;
    for (const sh of HARBOR.ships) {
      const lname = `ship${i}`;
      const s = this.layer(lname, { far: true });
      const d = this.layer(`${lname}_detail`);
      const yaw = Math.PI / 2; // bow east (+X), out to sea
      const draft = sh.H * 0.45;
      const keelY = -draft;
      const deckY = keelY + sh.H;
      const hull = hullGeo(sh.L, sh.B, sh.H);
      s.mesh(steelMat(), hull, { x: sh.x, y: keelY, z: sh.z, yaw });
      hull.dispose();
      // Red waterline band & gold deck rail line.
      s.box(crimsonMat(), { x: sh.x, y: 0.15, z: sh.z, sx: sh.L * 0.86, sy: 0.5, sz: sh.B * 0.98 + 0.02, yaw: 0 }, { castShadow: false });
      // Deck planking.
      s.box('wood_dark', { x: sh.x - sh.L * 0.04, y: deckY - 0.1, z: sh.z, sx: sh.L * 0.8, sy: 0.2, sz: sh.B * 0.86 }, { castShadow: false });
      // Deck collider (walkable) and hull side colliders.
      s.collider({ shape: 'box', x: sh.x - sh.L * 0.04, y: deckY - 1.5, z: sh.z, hx: sh.L * 0.42, hy: 1.5, hz: sh.B * 0.45, yaw: 0, walkable: true, solid: true, surface: 'wood' });
      s.collider({ shape: 'box', x: sh.x, y: (keelY + deckY) / 2, z: sh.z, hx: sh.L * 0.48, hy: (deckY - keelY) / 2, hz: sh.B * 0.48, yaw: 0, walkable: false, solid: true });
      // Gunwale rails (solid, low) on both sides.
      for (const sz of [-1, 1]) {
        s.box(steelDarkMat(), { x: sh.x - sh.L * 0.04, y: deckY + 0.45, z: sh.z + sz * sh.B * 0.44, sx: sh.L * 0.8, sy: 0.9, sz: 0.18 }, { collide: true, walkable: false });
      }
      // Superstructure at the stern: two decks, bridge windows.
      const sx = sh.x - sh.L * 0.26;
      const sw = sh.L * 0.24, sd = sh.B * 0.7;
      s.block(steelMat(), { x: sx, y: deckY, z: sh.z, sx: sw, sy: 3.2, sz: sd }, { collide: true, walkable: true });
      s.block(steelMat(), { x: sx - sw * 0.12, y: deckY + 3.2, z: sh.z, sx: sw * 0.62, sy: 2.6, sz: sd * 0.78 }, { collide: true, walkable: true });
      s.box(crimsonMat(), { x: sx, y: deckY + 3.1, z: sh.z, sx: sw + 0.1, sy: 0.25, sz: sd + 0.1 }, { castShadow: false });
      for (const sz of [-1, 1]) d.box('black_lacquer', { x: sx - sw * 0.12, y: deckY + 4.6, z: sh.z + sz * (sd * 0.39 + 0.03), sx: sw * 0.5, sy: 0.7, sz: 0.06 }, { castShadow: false });
      // Smokestacks (dark with a red band) amidships.
      for (let k = 0; k < sh.stacks; k++) {
        const kx = sh.x - sh.L * 0.05 + k * sh.L * 0.13;
        const r = sh.B * 0.11;
        const h = sh.H * 1.25;
        s.cylinder(steelDarkMat(), { x: kx, y: deckY, z: sh.z, r, h, segments: 12 }, { collide: true, walkable: false });
        s.cylinder(crimsonMat(), { x: kx, y: deckY + h * 0.72, z: sh.z, r: r * 1.04, h: h * 0.12, segments: 12 });
        this.ambient({ x: kx, y: deckY + h + 0.6, z: sh.z, preset: 'smoke', rate: 1.6, range: 260, essential: true, size: 1.8, speed: 1, dir: new THREE.Vector3(-0.25, 1, 0.1) });
      }
      // Bow emblem (both sides), mast with a pennant.
      for (const sz of [-1, 1]) {
        const p = { x: sh.x + sh.L * 0.36, z: sh.z + sz * (sh.B * 0.3 + 0.05) };
        d.mesh(goldMat(), P.emblem(), { x: p.x, y: deckY - 1.4, z: p.z, yaw: sz > 0 ? 0 : Math.PI, sx: 1.6, sy: 1.6, sz: 1 }, { castShadow: false });
      }
      const mx = sh.x + sh.L * 0.18;
      s.cylinder('wood_dark', { x: mx, y: deckY, z: sh.z, r: 0.18, rTop: 0.12, h: sh.H * 1.6, segments: 6 }, { collide: true, walkable: false });
      d.box(crimsonMat(), { x: mx - 1.2, y: deckY + sh.H * 1.5, z: sh.z, sx: 2.2, sy: 1.0, sz: 0.04 }, { castShadow: false });
      // Gangplank from the pier to the deck (only for ships beside a pier deck).
      const pier = HARBOR.piers.find((p) => Math.abs(p.z - sh.z) < p.w / 2 + sh.B / 2 + 2);
      if (pier) {
        const side = sh.z < pier.z ? 1 : -1; // pier lies at +z of the ship when side = 1
        const pz = pier.z - side * (pier.w / 2);
        const gz0 = sh.z + side * (sh.B * 0.42);
        const gx = Math.max(pier.x0 + 6, Math.min(pier.x1 - 6, sh.x + 2));
        const gl = Math.abs(pz - gz0) + 1.2;
        const y0 = HARBOR.Y, y1 = deckY;
        s.box('wood', { x: gx, y: (y0 + y1) / 2 - 0.05, z: (pz + gz0) / 2, sx: 1.6, sy: 0.12, sz: gl, yaw: 0 }, { castShadow: false });
        s.collider({ shape: 'box', x: gx, y: Math.max(y0, y1) - 0.2, z: (pz + gz0) / 2, hx: 0.9, hy: 0.2, hz: gl / 2, yaw: 0, walkable: true, solid: false, surface: 'wood' });
      }
      const g = this.group.getObjectByName(`${this.id}:${lname}`);
      const gd = this.group.getObjectByName(`${this.id}:${lname}_detail`);
      for (const obj of [g, gd]) if (obj) this.shipGroups.push({ g: obj, phase: i * 1.9, base: obj.position.y });
      i++;
    }
  }

  private buildWarehouses(): void {
    const s = this.layer('warehouses', { far: true });
    const d = this.layer('warehouses_detail');
    const Y = HARBOR.Y;
    const r = mulberry(31);
    const xs = HARBOR.south.x0 + 8;
    for (const [z, w] of [[1011, 16], [1029.5, 15], [1050, 18]] as Array<[number, number]>) {
      const dd = 13;
      const h = 6.5 + r() * 1.5;
      s.block(r() < 0.5 ? 'plaster_cream' : 'wood_dark', { x: xs, y: Y, z, sx: dd, sy: h, sz: w }, { collide: true, walkable: true });
      s.box(crimsonMat(), { x: xs, y: Y + h - 0.4, z, sx: dd + 0.1, sy: 0.8, sz: w + 0.1 });
      roof(s, { x: xs, y: Y + h, z, w, d: dd, h: 3.6, yaw: Math.PI / 2, style: 'gable', mat: r() < 0.5 ? 'roof_red' : 'roof_dark', overhang: 1.0, curve: 0.5, segU: 4, segT: 2 });
      // Big doors on the quay side (+X).
      for (const dz of [-w / 4, w / 4]) d.box('wood_red', { x: xs + dd / 2 + 0.04, y: Y + 2.2, z: z + dz, sx: 0.08, sy: 4.2, sz: 3.6 }, { castShadow: false });
      crest(d, { x: xs + dd / 2 + 0.1, y: Y + h - 1.6, z, yaw: Math.PI / 2, size: 1.2 });
      for (let k = 0; k < 3; k++) cargo(d, { x: xs + dd / 2 + 2.5 + r() * 4, y: Y, z: z - w / 2 + 2 + r() * (w - 4), seed: 900 + Math.round(z) + k, n: 3 });
    }
    for (let z = 1006; z < 1066; z += 14) hangingLantern(d, { x: xs + 6.9, y: Y + 4.6, z, s: 1 });
  }

  private buildOverlook(): void {
    const s = this.layer('overlook', { far: true });
    const d = this.layer('overlook_detail');
    const o = HARBOR.overlook;
    const x0 = o.x - o.w / 2, x1 = o.x + o.w / 2, z0 = o.z - o.d / 2, z1 = o.z + o.d / 2;
    let top = 0;
    let low = Infinity;
    for (let x = x0; x <= x1; x += 2) for (let z = z0; z <= z1; z += 2) {
      const h = heightAt(x, z);
      top = Math.max(top, h);
      low = Math.min(low, h);
    }
    top = Math.round((top + 0.4) * 10) / 10;
    this.overlookY = top;
    s.box('stone_tan', { x: o.x, y: (low - 1 + top) / 2, z: o.z, sx: o.w, sy: top - low + 1, sz: o.d }, { collide: true, walkable: true, surface: 'stone' });
    s.box('paving', { x: o.x, y: top + 0.03, z: o.z, sx: o.w - 0.2, sy: 0.06, sz: o.d - 0.2 }, { castShadow: false });
    s.box(basaltMat(), { x: o.x, y: low + 0.3, z: o.z, sx: o.w + 0.4, sy: 2.6, sz: o.d + 0.4 });
    s.box(crimsonMat(), { x: o.x, y: top - 0.5, z: o.z, sx: o.w + 0.12, sy: 0.8, sz: o.d + 0.12 });
    // Parapet on the seaward (east/south) sides, leaving the north side open toward the road.
    // Parapets on the north (river valley) and east (harbour) edges; the south edge
    // (toward the road) is open where the stair arrives.
    const sx0 = o.x + 4 - 3.6, sx1 = o.x + 4 + 3.6;
    parapet(s, [{ x: x0 + 0.3, z: z0 + 0.3 }, { x: x1 - 0.3, z: z0 + 0.3 }, { x: x1 - 0.3, z: z1 - 0.3 }, { x: sx1, z: z1 - 0.3 }], { y: top, h: 1.05, thick: 0.5, mat: crimsonMat(), merlons: true });
    parapet(s, [{ x: sx0, z: z1 - 0.3 }, { x: x0 + 0.3, z: z1 - 0.3 }], { y: top, h: 1.05, thick: 0.5, mat: crimsonMat(), merlons: true });
    // Harbour-master's hall on the west side (facing east over the harbour).
    hall(s, { x: x0 + 5.5, y: top, z: o.z - 1, yaw: Math.PI / 2, w: 13, d: 7, h: 5.2, veranda: 1.6, colSpacing: 3.6, wall: crimsonMat(), roofMat: 'roof_dark', horns: 1.4, crest: 1.2 });
    // Braziers, banners and a viewing telescope plinth.
    brazier(d, this.flames, { x: x1 - 2, y: top, z: z1 - 2, size: 1.2 });
    brazier(d, this.flames, { x: x1 - 2, y: top, z: z0 + 8, size: 1.2 });
    bannerPole(d, { x: o.x + 4, y: top, z: z0 + 1.2, yaw: Math.PI, h: 10, w: 1.8, len: 5.5 });
    bannerPole(d, { x: o.x - 4, y: top, z: z0 + 1.2, yaw: Math.PI, h: 10, w: 1.8, len: 5.5 });
    this.ambient({ x: x1 - 2, y: top + 2.5, z: z1 - 2, preset: 'embers', rate: 3, range: 50 });
    // Steps from the road down/up to the terrace (north side).
    const road = getRoadRuntime().find((r) => r.id === 'fire_causeway_road');
    if (road) {
      // Closest road point to the terrace's north edge centre.
      let best = { s: 0, d: Infinity };
      for (let sa = 0; sa < 160; sa += 1) {
        const p = road.line.pointAt(sa);
        const dd = Math.hypot(p.x - (o.x + 4), p.z - z1);
        if (dd < best.d) best = { s: sa, d: dd };
      }
      const rp = road.line.pointAt(best.s);
      const ry = road.height(best.s);
      // Top end just outside the terrace edge so the flight reaches full height before the step-off.
    const from = new THREE.Vector3(o.x + 4, top, z1 + 0.6);
      // Walk from the terrace edge toward the road centreline, stop at the road shoulder.
      const dirX = rp.x - from.x, dirZ = rp.z - from.z;
      const dl = Math.hypot(dirX, dirZ) || 1;
      const end = new THREE.Vector3(rp.x - (dirX / dl) * (road.half - 0.5), ry, rp.z - (dirZ / dl) * (road.half - 0.5));
      end.y = Math.max(heightAt(end.x, end.z), ry);
      if (end.y < top) flight(s, { from: end, to: from, width: 5, mat: 'stone_light', cheek: crimsonMat(), cheekH: 0.7 });
      else flight(s, { from, to: end, width: 5, mat: 'stone_light', cheek: crimsonMat(), cheekH: 0.7 });
      this.overlookStair = { x: end.x, z: end.z, y: end.y };
    }
    hangingLantern(d, { x: o.x + 6.6, y: top + 2.8, z: z1 - 0.8 });
    hangingLantern(d, { x: o.x + 1.4, y: top + 2.8, z: z1 - 0.8 });
  }

  overlookY = 0;
  overlookStair: { x: number; z: number; y: number } | null = null;

  /** Paved ramp from the causeway road's start down to the north quay. */
  private buildRamp(): void {
    const s = this.layer('ramp', { far: true });
    const top = new THREE.Vector3(-939, Math.max(heightAt(-939, 968), 10.6), 968);
    const bottom = new THREE.Vector3(HARBOR.north.x0 + 0.2, HARBOR.Y, 971);
    flight(s, { from: bottom, to: top, width: 6, mat: 'stone_light', cheek: basaltMat(), cheekH: 0.6 });
    this.rampTop = { x: top.x, z: top.z, y: top.y };
  }

  rampTop: { x: number; z: number; y: number } | null = null;

  protected override animate(_dt: number, ctx: GameContext): void {
    const t = ctx.time.elapsed;
    for (const sg of this.shipGroups) {
      sg.g.position.y = sg.base + Math.sin(t * 0.7 + sg.phase) * 0.07;
      sg.g.rotation.z = Math.sin(t * 0.5 + sg.phase) * 0.004;
    }
  }
}

// --- Spots ---------------------------------------------------------------
const st = marketStall(1);
addFireSpots({
  dock_fn_harbor: { x: HARBOR.piers[0].x1 - 10, z: HARBOR.piers[0].z, y: HARBOR.Y, yaw: Math.PI / 2, r: 3, label: 'Capital Harbor, pier head', region: 'fire_nation_capital' },
  dock_fn_harbor_quay: { x: -890, z: 1020, y: HARBOR.Y, yaw: Math.PI / 2, r: 30, label: 'Capital Harbor quays', region: 'fire_nation_capital' },
  merchant_fn_3: { x: st.x - 0.15, z: st.z + 8, y: HARBOR.Y, yaw: Math.PI / 2, r: 2, label: 'Harbor fish market', region: 'fire_nation_capital' },
  viewpoint_fn_harbor: { x: HARBOR.landmark.x, z: HARBOR.landmark.z, yaw: Math.PI / 2, r: 14, label: "Harbour-master's overlook", region: 'fire_nation_capital' },
  dock_fn_harbor_north: { x: -912, z: 976, y: HARBOR.Y, yaw: Math.PI / 2, r: 28, label: 'Capital Harbor north quay', region: 'fire_nation_capital' },
});
