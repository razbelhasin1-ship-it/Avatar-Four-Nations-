import * as THREE from 'three';
import type { GameContext } from '../../core/GameContext';
import { SUB_SITES } from '../../data/quests_subskills';
import { rockGeometry } from '../../vfx/effects/rocks';
import { ContentBuilder } from '../../world/kit/Builder';
import type { RegionContent } from '../../world/RegionContent';

/**
 * Places for the specialized-bending quests (minimal new geometry, built with the region kit):
 *
 *  - The lava tunnels: a mound of dark volcanic rock at the north-west foot of the Fire Nation
 *    capital's volcano, sealed inside: entrance hall, a passage cut by a lava flow, the great
 *    chamber where the lava wave comes, a rock plug, and the deepest chamber for the trial.
 *    (The world's terrain cannot hold caves below it, so the tunnels are inside the mound, like the
 *    Dai Li base inside its hill.) The lava itself is world lava from LavaSystem, placed by the
 *    quest scripts.
 *  - Hama's hamlet west of the capital: the inn, a lane of houses, the lockup, and the cave
 *    prison in the hillside to the east, sealed by a stone slab.
 *
 * Exposes the tunnel frame and the plug / slab for the scripts (SITES).
 */

export interface TunnelFrame {
  /** Floor height of the whole complex. */
  F: number;
  /** Local (u along +X, v along +Z) to world. */
  at(u: number, v: number, dy?: number): THREE.Vector3;
}

export const SITES: {
  built: boolean;
  tunnel: TunnelFrame | null;
  plug: { mesh: THREE.Mesh; col: number } | null;
  slab: { mesh: THREE.Mesh; col: number } | null;
  heatBlock: number;
  vault: null;
} = { built: false, tunnel: null, plug: null, slab: null, heatBlock: 0, vault: null };

const T = SUB_SITES.tunnels;

export class SubskillSites implements RegionContent {
  readonly id = 'subskill_sites';
  readonly center = { x: -1700, z: 750 };
  readonly loadRadius = 420;
  readonly group = new THREE.Group();
  private b: ContentBuilder | null = null;
  private readonly owned: Array<{ dispose(): void }> = [];
  private lights: THREE.PointLight[] = [];

  build(ctx: GameContext): void {
    this.group.name = 'subskill_sites';
    const b = new ContentBuilder(ctx, this.group, 'subskill_sites');
    this.b = b;
    this.buildTunnels(ctx, b);
    this.buildVillage(ctx, b);
    b.finish();
    SITES.built = true;
  }

  // ---------------------------------------------------------------------------
  // Lava tunnels
  // ---------------------------------------------------------------------------

  private buildTunnels(ctx: GameContext, b: ContentBuilder): void {
    const U0 = -36, U1 = 36, V0 = -9, V1 = 9;
    // Floor above the highest ground under the footprint.
    let maxG = -Infinity;
    for (let u = U0; u <= U1; u += 4) for (let v = V0; v <= V1; v += 3) maxG = Math.max(maxG, ctx.world.heightAt(T.x + u, T.z + v));
    const F = maxG + 0.4;
    const at = (u: number, v: number, dy = 0) => new THREE.Vector3(T.x + u, F + dy, T.z + v);
    SITES.tunnel = { F, at };
    const H = 5.2;
    const box = (u0: number, u1: number, v0: number, v1: number, y0: number, y1: number, mat: 'stone_dark' | 'stone_grey' | 'stone_red', walk = false) => {
      const c = at((u0 + u1) / 2, (v0 + v1) / 2, (y0 + y1) / 2);
      b.box(mat, { x: c.x, y: c.y, z: c.z, sx: u1 - u0, sy: y1 - y0, sz: v1 - v0 }, { collide: true, walkable: walk, surface: 'rock' });
    };
    // Floor slab (down to the lowest ground so no gap shows outside) and roof.
    let minG = Infinity;
    for (let u = U0; u <= U1; u += 4) for (let v = V0; v <= V1; v += 3) minG = Math.min(minG, ctx.world.heightAt(T.x + u, T.z + v));
    box(U0 - 1, U1 + 1, V0 - 1, V1 + 1, minG - F - 1, 0, 'stone_dark', true);
    box(U0 - 1, U1 + 1, V0 - 1, V1 + 1, H, H + 1.4, 'stone_dark');
    // Outer walls; the mouth in the east wall faces the volcano.
    box(U0 - 1, U0, V0, V1, 0, H, 'stone_dark');
    box(U0, U1, V0 - 1, V0, 0, H, 'stone_dark');
    box(U0, U1, V1, V1 + 1, 0, H, 'stone_dark');
    box(U1, U1 + 1, V0, -2.2, 0, H, 'stone_dark');
    box(U1, U1 + 1, 2.2, V1, 0, H, 'stone_dark');
    box(U1, U1 + 1, -2.2, 2.2, 4.2, H, 'stone_dark');
    // Rock filling between the rooms: hall (22..36, |v|<5), flow passage (6..22, |v|<2.5),
    // great chamber (-16..6, |v|<8), plug passage (-20..-16, |v|<2.5), deep chamber (-36..-20, |v|<7).
    box(22, U1, 5, V1, 0, H, 'stone_dark');
    box(22, U1, V0, -5, 0, H, 'stone_dark');
    box(6, 22, 2.5, V1, 0, H, 'stone_dark');
    box(6, 22, V0, -2.5, 0, H, 'stone_dark');
    box(-16, 6, 8, V1, 0, H, 'stone_dark');
    box(-16, 6, V0, -8, 0, H, 'stone_dark');
    box(-20, -16, 2.5, V1, 0, H, 'stone_dark');
    box(-20, -16, V0, -2.5, 0, H, 'stone_dark');
    box(U0, -20, 7, V1, 0, H, 'stone_dark');
    box(U0, -20, V0, -7, 0, H, 'stone_dark');
    // The rock plug between the great chamber and the deep chamber (melted in the quest).
    const plugGeo = new THREE.BoxGeometry(3.8, 4.2, 5);
    this.owned.push(plugGeo);
    const plugMat = new THREE.MeshStandardMaterial({ color: '#4a3a32', roughness: 0.95, flatShading: true });
    this.owned.push(plugMat);
    const plug = new THREE.Mesh(plugGeo, plugMat);
    plug.position.copy(at(-18, 0, 2.1));
    this.group.add(plug);
    const plugCol = ctx.world.collision.add({ shape: 'box', x: plug.position.x, y: plug.position.y, z: plug.position.z, hx: 1.9, hy: 2.1, hz: 2.5, yaw: 0, solid: true, walkable: false, surface: 'rock', tag: 'subskill_plug' });
    SITES.plug = { mesh: plug, col: plugCol };
    // Heat too fierce to cross while the flow in the passage is molten.
    SITES.heatBlock = ctx.world.collision.add({ shape: 'box', x: at(13.7, 0).x, y: F + 2, z: T.z, hx: 1.3, hy: 2, hz: 2.5, yaw: 0, solid: true, walkable: false, tag: 'subskill_heat' });
    // A natural mound outside: big boulders of dark volcanic rock around and on top.
    const rmat = new THREE.MeshStandardMaterial({ color: '#3b302b', roughness: 1, flatShading: true });
    this.owned.push(rmat);
    let k = 0;
    for (let u = U0 - 2; u <= U1 + 2; u += 7) {
      for (const v of [V0 - 3.2, V1 + 3.2]) {
        const s = 4.2 + ((k * 37) % 10) * 0.25;
        b.mesh(rmat, rockGeometry(k % 4, 1), { x: T.x + u, y: F + 1.2, z: T.z + v, sx: s * 1.4, sy: s * 1.3, sz: s, yaw: k * 1.3 });
        k++;
      }
    }
    for (let u = U0; u <= U1; u += 9) {
      const s = 5 + (k % 3);
      b.mesh(rmat, rockGeometry(k % 4, 1), { x: T.x + u, y: F + H + 1.6, z: T.z + ((k % 2) - 0.5) * 3, sx: s * 1.5, sy: s * 0.7, sz: s * 1.4, yaw: k * 0.7 });
      k++;
    }
    for (const v of [-5.5, 5.5]) b.mesh(rmat, rockGeometry(k++ % 4, 1), { x: T.x + U1 + 2.5, y: F + 2.6, z: T.z + v, sx: 3.4, sy: 4.6, sz: 3, yaw: k });
    // Glow inside where the settings allow real lights.
    if (ctx.settings.data.graphics.dynamicLights) {
      for (const [u, v] of [[13.7, 0], [-5, 4], [-28, 0]] as const) {
        const l = new THREE.PointLight('#ff7a2a', 3.5, 16, 1.6);
        l.position.copy(at(u, v, 2.6));
        this.group.add(l);
        this.lights.push(l);
      }
    }
  }

  // ---------------------------------------------------------------------------
  // Hama's hamlet
  // ---------------------------------------------------------------------------

  private buildVillage(ctx: GameContext, b: ContentBuilder): void {
    const ground = (x: number, z: number, hw: number, hd: number) => {
      let m = -Infinity;
      for (const [dx, dz] of [[0, 0], [hw, hd], [-hw, hd], [hw, -hd], [-hw, -hd]]) m = Math.max(m, ctx.world.heightAt(x + dx, z + dz));
      return m;
    };
    const house = (x: number, z: number, w: number, d: number, h: number, yaw: number, wall: 'plaster_red' | 'plaster_cream' | 'stone_grey', roof: 'roof_red' | 'roof_dark') => {
      const y = ground(x, z, w / 2, d / 2);
      b.building({ x, y, z, w, d, h, yaw, wall, roof, trim: 'wood_dark', roofStyle: 'gable', door: true, windows: true, plinth: 'stone_grey' });
    };
    const I = SUB_SITES.inn;
    house(I.x, I.z, 10, 8, 4.4, 0, 'plaster_red', 'roof_red');
    house(I.x - 16, I.z + 14, 7, 6, 3.6, Math.PI / 2, 'plaster_cream', 'roof_red');
    house(I.x + 17, I.z + 15, 7, 6, 3.6, -Math.PI / 2, 'plaster_cream', 'roof_red');
    house(I.x - 18, I.z - 14, 7, 6, 3.4, Math.PI / 2, 'plaster_red', 'roof_dark');
    // The lockup (Hama in custody).
    const L = SUB_SITES.lockup;
    house(L.x, L.z + 2.6, 6, 4, 3, 0, 'stone_grey', 'roof_dark');
    // Lanterns along the lane.
    for (let i = 0; i < 4; i++) {
      const x = I.x - 6 + i * 6, z = I.z + 7.5;
      b.lantern(new THREE.Vector3(x, ctx.world.heightAt(x, z), z), { color: 'red', post: true });
    }
    // The cave prison in the hillside: a mound of rock with a slab-sealed mouth facing the village.
    const P = SUB_SITES.prison;
    const gy = ctx.world.heightAt(P.x, P.z);
    const rmat = new THREE.MeshStandardMaterial({ color: '#5b4a3e', roughness: 1, flatShading: true });
    this.owned.push(rmat);
    for (const [dx, dz, s] of [[6, -6, 7], [6, 6, 7.5], [11, 0, 8], [3, -10, 5], [3, 10, 5.5]] as const) {
      b.mesh(rmat, rockGeometry(Math.abs(dx + dz) % 4, 1), { x: P.x + dx, y: gy + s * 0.35, z: P.z + dz, sx: s, sy: s * 0.9, sz: s, yaw: dx * 0.7 });
      b.collider({ shape: 'cylinder', x: P.x + dx, y: gy + s * 0.4, z: P.z + dz, r: s * 0.8, hy: s * 0.45, solid: true, walkable: true, surface: 'rock' });
    }
    // Cave chamber behind the slab (the villagers are held here).
    b.box('stone_dark', { x: P.x + 4.5, y: gy + 3.5, z: P.z, sx: 6, sy: 1, sz: 6 }, { collide: true });
    const slabGeo = new THREE.BoxGeometry(0.8, 3.2, 3.6);
    this.owned.push(slabGeo);
    const slabMat = new THREE.MeshStandardMaterial({ color: '#6a5a4c', roughness: 0.95, flatShading: true });
    this.owned.push(slabMat);
    const slab = new THREE.Mesh(slabGeo, slabMat);
    slab.position.set(P.x + 1, gy + 1.6, P.z);
    this.group.add(slab);
    const slabCol = ctx.world.collision.add({ shape: 'box', x: slab.position.x, y: slab.position.y, z: slab.position.z, hx: 0.4, hy: 1.6, hz: 1.8, yaw: 0, solid: true, walkable: false, surface: 'rock', tag: 'subskill_slab' });
    SITES.slab = { mesh: slab, col: slabCol };
  }

  dispose(ctx: GameContext): void {
    this.b?.dispose();
    this.b = null;
    for (const id of [SITES.plug?.col, SITES.slab?.col, SITES.heatBlock]) if (id) ctx.world.collision.remove(id);
    SITES.plug = null;
    SITES.slab = null;
    SITES.heatBlock = 0;
    SITES.tunnel = null;
    SITES.built = false;
    for (const l of this.lights) l.removeFromParent();
    this.lights = [];
    for (const o of this.owned) o.dispose();
    this.owned.length = 0;
    this.group.clear();
  }
}
