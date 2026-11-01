import * as THREE from 'three';
import { createModel, modelDetail } from '../companions/models';
import { defaultAnim, type CreatureModel } from '../companions/models/CreatureModel';
import type { GameContext } from '../core/GameContext';
import { TRAVEL_POINTS, type CityId, type TravelPointDef } from '../data/travel';
import type { NPCDef } from '../npc/NPCTypes';
import { ContentBuilder } from '../world/kit/Builder';
import { kitMaterial as kitMaterialOf, type KitMaterialName } from '../world/kit/Materials';
import { atAxis } from '../world/landforms/fireCapital';
import type { RegionContent, RegionFactory } from '../world/RegionContent';
import { polar as satPolar, yawOut as satYawOut } from '../world/regions/air/sat/layout';
import type { P2 } from '../world/WorldLayout';
import { shipParts, signTexture, type ShipStyle } from './kit';
import type { TravelSystem } from './TravelSystem';

/**
 * The four city travel points, each a tiny self-contained region (so no city file changes): a prop
 * (ice pier + Water Tribe trader; harbormaster's kiosk + merchant ship; "Island Ferries" counter;
 * saddled sky bison), a painted sign, the staff NPC (talk = travel dialog), a trigger on the sign,
 * and a few idling travellers. Positions sit on open quay / headland / lawn / terrace paving next
 * to existing features (checked against the cities' colliders).
 */

/** Placement helper: a point offset from `o` by (right, forward) metres in the frame of `yaw`. */
function off(o: P2, yaw: number, right: number, fwd: number): P2 {
  // forward = (sin yaw, cos yaw); right = (−cos yaw, sin yaw) (character's right is −X at yaw 0)
  return { x: o.x + Math.sin(yaw) * fwd - Math.cos(yaw) * right, z: o.z + Math.cos(yaw) * fwd + Math.sin(yaw) * right };
}

interface Built {
  /** Extra objects to update / dispose (creature models). */
  models: CreatureModel[];
  /** Owned materials / textures (signs). */
  owned: Array<THREE.Material | THREE.Texture>;
  /** Trigger position (on the sign). */
  trigger: THREE.Vector3;
  /** The docked ship (own meshes) that hides while the journey's moving copy sails. */
  vehicle?: THREE.Group;
  npcs: NPCDef[];
}

type CityBuilder = (b: ContentBuilder, ctx: GameContext, p: TravelPointDef, out: Built) => void;

/** A ship moored at (x, y, z) with heading `yaw` (bow along +Z at yaw 0): its own meshes, so it can hide. */
function ship(out: Built, style: ShipStyle, x: number, y: number, z: number, yaw: number): void {
  const g = new THREE.Group();
  g.position.set(x, y, z);
  g.rotation.y = yaw;
  for (const part of shipParts(style).parts) {
    const m = new THREE.Mesh(part.geo, kitMaterialOf(part.mat));
    m.castShadow = true;
    m.receiveShadow = true;
    g.add(m);
  }
  out.vehicle = g;
}

/** A signboard on two posts facing `yaw` (its painted face looks along forward). */
function sign(b: ContentBuilder, out: Built, at: P2, y: number, yaw: number, tex: THREE.CanvasTexture, post: KitMaterialName, w = 1.3, h = 1.62): void {
  const mat = new THREE.MeshStandardMaterial({ map: tex, roughness: 0.85 });
  mat.name = 'travel_sign';
  out.owned.push(mat, tex);
  const face = new THREE.PlaneGeometry(w, h);
  b.mesh(mat, face, { x: at.x + Math.sin(yaw) * 0.07, y: y + 1.0 + h / 2, z: at.z + Math.cos(yaw) * 0.07, yaw });
  face.dispose();
  b.box(post, { x: at.x, y: y + 1.0 + h / 2, z: at.z, sx: w + 0.16, sy: h + 0.16, sz: 0.1, yaw }, { collide: false });
  for (const s of [-1, 1]) {
    const q = off(at, yaw, s * (w / 2 + 0.05), -0.02);
    b.box(post, { x: q.x, y: y + (1.0 + h) / 2 + 0.05, z: q.z, sx: 0.12, sy: 1.1 + h, sz: 0.12, yaw }, { collide: true, solid: true });
  }
}

function traveller(id: string, nation: NPCDef['nation'], at: P2, yaw: number, seed: number, y?: number, variant: 'stand' | 'sit' = 'stand'): NPCDef {
  return { id, name: 'Traveller', role: 'villager', nation, appearanceSeed: seed, x: at.x, z: at.z, y, yaw, behavior: variant === 'sit' ? { type: 'idle', variant: 'sit' } : { type: 'converse' }, schedule: 'day' };
}

// ---------------------------------------------------------------------------
// Northern Water Tribe: an ice pier off the north end of the west quay, a trade ship at its head.
// ---------------------------------------------------------------------------
const NWT_Y = 5.5;
const buildNwt: CityBuilder = (b, _ctx, p, out) => {
  // Pier: ice slab on ice piles, quay level, 9.5 m into the basin.
  b.box('ice', { x: -249.25, y: NWT_Y - 0.35, z: -1857, sx: 9.5, sy: 0.7, sz: 3.2 }, { collide: true, walkable: true, solid: true, surface: 'ice' });
  b.box('snow', { x: -249.25, y: NWT_Y + 0.01, z: -1857, sx: 9.3, sy: 0.04, sz: 3.0 }, { collide: false });
  for (const x of [-252, -248.5, -245]) for (const z of [-1858.3, -1855.7]) b.cylinder('ice_deep', { x, y: 3, z, r: 0.32, h: 2.2, segments: 8 }, { collide: false });
  for (const z of [-1858.4, -1855.6]) b.cylinder('ice', { x: -245.1, y: NWT_Y, z, r: 0.22, h: 0.8, segments: 8 }, { collide: true, solid: true });
  // The trader moored at the pier head, bow toward the sea gate; a gangplank to its deck.
  ship(out, 'water', -242.2, 4.55, -1865.8, Math.PI);
  b.box('wood', { x: -243.7, y: NWT_Y + 0.25, z: -1859.4, sx: 0.9, sy: 0.08, sz: 2.4, pitch: 0.18 }, { collide: false });
  // Cargo waiting on the quay.
  for (const [x, z, s] of [[-264.5, -1858.4, 0.9], [-265.6, -1856.9, 0.8], [-264.8, -1855.6, 0.7]] as const) b.box('wood_dark', { x, y: NWT_Y + s / 2, z, sx: s, sy: s, sz: s, yaw: x * 0.7 }, { collide: true, solid: true });
  const at: P2 = { x: -261.6, z: -1858.4 };
  sign(b, out, at, NWT_Y, 0.25, signTexture(['Kyoshi Island', 'Trade ship', 'sails on the tide'], { bg: '#e8f2fa', fg: '#1d4a7a', emblem: 'water', accent: '#2f6fae' }), 'ice');
  out.trigger.set(-258.6, NWT_Y, -1857.6);
  out.npcs.push(
    { id: p.staff.id, name: p.staff.name, title: p.staff.title, role: 'merchant', nation: 'water', appearanceSeed: 7101, x: -256.6, z: -1855.2, y: NWT_Y, yaw: 0.35, behavior: { type: 'idle', variant: 'stand' }, dialogue: 'travel_staff', marker: 'none', schedule: 'always', region: p.region },
    traveller('travel_nwt_t1', 'water', { x: -263.2, z: -1853.8 }, 1.3, 7102, NWT_Y),
    traveller('travel_nwt_t2', 'water', { x: -262.4, z: -1852.1 }, -2.2, 7103, NWT_Y),
  );
};

// ---------------------------------------------------------------------------
// Fire Nation capital: on the west harbour head beside the sea wall — the harbormaster's red-roofed
// kiosk, stairs down the cliff to a landing stage and a merchant ship (clear of the warship lanes).
// ---------------------------------------------------------------------------
const fncAt = (t: number, s: number) => atAxis(t, s);
const buildFnc: CityBuilder = (b, ctx, p, out) => {
  const H = (q: P2) => ctx.world.heightAt(q.x, q.z);
  // Kiosk: a small timber booth with a counter window and a red hip roof.
  const k = fncAt(-171, 788.5);
  const ky = H(k);
  const kyaw = Math.PI; // counter faces north, toward the city
  b.box('stone_dark', { x: k.x, y: ky + 0.15, z: k.z, sx: 4.4, sy: 0.3, sz: 3.6, yaw: kyaw }, { collide: true, walkable: true, solid: true });
  for (const [r, f] of [[-1.9, -1.5], [1.9, -1.5], [-1.9, 1.5], [1.9, 1.5]] as const) {
    const q = off(k, kyaw, r, f);
    b.box('wood_red', { x: q.x, y: ky + 1.6, z: q.z, sx: 0.24, sy: 2.6, sz: 0.24, yaw: kyaw }, { collide: true, solid: true });
  }
  const back = off(k, kyaw, 0, -1.45);
  b.box('plaster_cream', { x: back.x, y: ky + 1.5, z: back.z, sx: 3.6, sy: 2.4, sz: 0.16, yaw: kyaw }, { collide: true, solid: true });
  for (const s of [-1, 1]) {
    const q = off(k, kyaw, s * 1.85, 0);
    b.box('plaster_cream', { x: q.x, y: ky + 1.5, z: q.z, sx: 0.16, sy: 2.4, sz: 2.9, yaw: kyaw }, { collide: true, solid: true });
  }
  const counter = off(k, kyaw, 0, 1.3);
  b.box('wood_dark', { x: counter.x, y: ky + 0.85, z: counter.z, sx: 3.6, sy: 1.1, sz: 0.5, yaw: kyaw }, { collide: true, solid: true });
  b.roof('roof_red', { x: k.x, y: ky + 2.9, z: k.z, w: 5.0, d: 4.2, height: 1.5, yaw: kyaw, overhang: 0.5, curve: 0.5, style: 'hip', ridge: 'gold' });
  b.lantern(new THREE.Vector3(off(k, kyaw, -2.2, 2.0).x, ky + 2.6, off(k, kyaw, -2.2, 2.0).z), { color: 'red', hanging: true });
  // Stairs down the head's seaward cliff to a timber landing stage on piles.
  const sTop = fncAt(-158, 792.5), sBot = fncAt(-158, 811.5);
  const topY = H(sTop);
  b.stairs({ from: new THREE.Vector3(sTop.x, topY, sTop.z), to: new THREE.Vector3(sBot.x, 1.8, sBot.z), width: 3, material: 'wood_dark', sideMaterial: 'stone_dark', surface: 'wood' });
  const stage = fncAt(-158.5, 819);
  b.box('wood', { x: stage.x, y: 1.6, z: stage.z, sx: 6, sy: 0.4, sz: 15, yaw: 0 }, { collide: true, walkable: true, solid: true, surface: 'wood' });
  for (let i = 0; i < 4; i++) for (const s of [-1, 1]) {
    const q = fncAt(-158.5 + s * 2.6, 812.5 + i * 4.3);
    b.cylinder('wood_dark', { x: q.x, y: -6, z: q.z, r: 0.25, h: 8.2, segments: 8 }, { collide: false });
  }
  for (const s of [813, 819, 825]) {
    const q = fncAt(-155.8, s);
    b.cylinder('iron', { x: q.x, y: 1.8, z: q.z, r: 0.18, h: 0.6, segments: 8 }, { collide: true, solid: true });
  }
  // The merchant ship alongside the stage, bow to the open sea.
  const sh = fncAt(-151.2, 824);
  ship(out, 'fire', sh.x, 0, sh.z, 0);
  const plank = fncAt(-155.2, 822);
  b.box('wood', { x: plank.x, y: 1.95, z: plank.z, sx: 2.2, sy: 0.08, sz: 0.9, roll: -0.12 }, { collide: false });
  // Sign at the stair head.
  const sg = fncAt(-163.5, 791.6);
  sign(b, out, sg, H(sg), Math.PI - 0.5, signTexture(['Kyoshi Island', 'Passenger berth', 'Earth Kingdom isles'], { bg: '#f1e2c6', fg: '#5a120c', emblem: 'fan', accent: '#b0201a' }), 'wood_red');
  out.trigger.set(counter.x, ky, counter.z);
  const hm = off(k, kyaw, 0, 0.35);
  const t1 = fncAt(-163, 783.5), t2 = fncAt(-161.2, 782.6);
  out.npcs.push(
    { id: p.staff.id, name: p.staff.name, title: p.staff.title, role: 'merchant', nation: 'fire', appearanceSeed: 7201, x: hm.x, z: hm.z, y: ky + 0.3, yaw: kyaw, behavior: { type: 'idle', variant: 'stand' }, dialogue: 'travel_staff', marker: 'none', schedule: 'always', region: p.region },
    traveller('travel_fnc_t1', 'fire', t1, -2.4, 7202),
    traveller('travel_fnc_t2', 'fire', t2, 0.9, 7203),
  );
  // Luggage by the travellers.
  for (const [dt, ds, s] of [[-164.5, 784.8, 0.7], [-165.3, 783.8, 0.6]] as const) {
    const q = fncAt(dt, ds);
    b.box('wood_dark', { x: q.x, y: H(q) + s / 2, z: q.z, sx: s, sy: s, sz: s * 1.2, yaw: 0.4 }, { collide: true, solid: true });
  }
};

// ---------------------------------------------------------------------------
// Ba Sing Se: the "Island Ferries" counter on the lawn beside the gate road, under the Outer Wall
// arrival station. The ride is the monorail out through the gate, then the coastal ferry.
// ---------------------------------------------------------------------------
const BSS_Y = 26;
const buildBss: CityBuilder = (b, _ctx, p, out) => {
  const k: P2 = { x: 490, z: -179.5 };
  const kyaw = 0; // faces the gate road (south of the booth; north is −Z)
  b.box('stone_tan', { x: k.x, y: BSS_Y + 0.12, z: k.z, sx: 5.2, sy: 0.24, sz: 3.8, yaw: kyaw }, { collide: true, walkable: true, solid: true });
  for (const [r, f] of [[-2.3, -1.6], [2.3, -1.6], [-2.3, 1.6], [2.3, 1.6]] as const) {
    const q = off(k, kyaw, r, f);
    b.box('wood_dark', { x: q.x, y: BSS_Y + 1.55, z: q.z, sx: 0.26, sy: 2.7, sz: 0.26, yaw: kyaw }, { collide: true, solid: true });
  }
  const back = off(k, kyaw, 0, -1.55);
  b.box('plaster_green', { x: back.x, y: BSS_Y + 1.45, z: back.z, sx: 4.4, sy: 2.5, sz: 0.16, yaw: kyaw }, { collide: true, solid: true });
  const counter = off(k, kyaw, 0, 1.35);
  b.box('wood', { x: counter.x, y: BSS_Y + 0.8, z: counter.z, sx: 4.4, sy: 1.1, sz: 0.55, yaw: kyaw }, { collide: true, solid: true });
  b.roof('roof_green', { x: k.x, y: BSS_Y + 2.9, z: k.z, w: 6.0, d: 4.6, height: 1.6, yaw: kyaw, overhang: 0.6, curve: 0.6, style: 'hip', ridge: 'jade' });
  // Earth Kingdom emblem over the counter and a standing "Island Ferries" board.
  const em = off(k, kyaw, 0, 1.75);
  const emTex = signTexture(['Island Ferries', 'Kyoshi Island'], { bg: '#e9dcb4', fg: '#2f4f25', emblem: 'earth', accent: '#4f7f3a' });
  sign(b, out, { x: em.x + 3.6, z: em.z + 1.2 }, BSS_Y, kyaw - 0.35, emTex, 'wood_dark');
  const crest = new THREE.CircleGeometry(0.55, 24);
  const crestMat = new THREE.MeshStandardMaterial({ map: signTexture([''], { bg: '#c9a227', fg: '#2f4f25', emblem: 'earth', accent: '#2f4f25' }), roughness: 0.6, metalness: 0.3 });
  out.owned.push(crestMat, crestMat.map!);
  b.mesh(crestMat, crest, { x: em.x, y: BSS_Y + 2.35, z: em.z, yaw: kyaw });
  crest.dispose();
  // Benches and luggage for the waiting travellers.
  for (const s of [-1, 1]) {
    const q = off(k, kyaw, s * 5.2, 1.2);
    b.box('wood', { x: q.x, y: BSS_Y + 0.45, z: q.z, sx: 2.2, sy: 0.12, sz: 0.6, yaw: kyaw }, { collide: true, walkable: true, solid: true });
    for (const e of [-0.9, 0.9]) {
      const l = off(q, kyaw, e, 0);
      b.box('wood_dark', { x: l.x, y: BSS_Y + 0.2, z: l.z, sx: 0.12, sy: 0.4, sz: 0.5, yaw: kyaw }, { collide: false });
    }
  }
  for (const [x, z, s] of [[497.4, -176.6, 0.65], [498.1, -177.5, 0.5], [482.2, -176.6, 0.6]] as const) b.box('wood_dark', { x, y: BSS_Y + s / 2, z, sx: s, sy: s * 0.8, sz: s * 1.2, yaw: 0.3 }, { collide: true, solid: true });
  out.trigger.set(counter.x, BSS_Y, counter.z);
  const clerk = off(k, kyaw, 0, 0.45);
  const bench = off(k, kyaw, 5.2, 1.2);
  out.npcs.push(
    { id: p.staff.id, name: p.staff.name, title: p.staff.title, role: 'merchant', nation: 'earth', appearanceSeed: 7301, x: clerk.x, z: clerk.z, y: BSS_Y + 0.24, yaw: kyaw, behavior: { type: 'idle', variant: 'stand' }, dialogue: 'travel_staff', marker: 'none', schedule: 'always', region: p.region },
    traveller('travel_bss_t1', 'earth', { x: bench.x, z: bench.z }, kyaw, 7302, BSS_Y + 0.5, 'sit'),
    traveller('travel_bss_t2', 'earth', { x: 495.4, z: -175.4 }, -2.0, 7303),
    traveller('travel_bss_t3', 'earth', { x: 484.6, z: -175.8 }, 2.2, 7304),
  );
};

// ---------------------------------------------------------------------------
// Southern Air Temple: a saddled sky bison waiting in the west corner of the bison terrace, where
// the road tops out from the gate plaza (clear of the herd's two landing ledges, the pond and hay).
// ---------------------------------------------------------------------------
const SAT_Y = 348.2;
const buildSat: CityBuilder = (b, ctx, p, out) => {
  const g = ctx.settings.data.graphics;
  const bison = createModel('sky_bison', 0, modelDetail(g.preset), 0.92);
  if (bison) {
    const c = satPolar(268.4, 70.2);
    bison.root.position.set(c.x, SAT_Y, c.z);
    bison.root.rotation.y = satYawOut(268.4) + 0.12;
    bison.setSaddle(true);
    bison.setShadows(g.shadows !== 'off');
    out.models.push(bison);
  }
  // Mounting steps beside the saddle, a feed basket, the keeper's sign.
  const st = satPolar(265.2, 71.2);
  for (let i = 0; i < 3; i++) b.box('wood', { x: st.x, y: SAT_Y + 0.2 + i * 0.4, z: st.z - i * 0.35, sx: 1.4, sy: 0.4, sz: 1.1 - i * 0.3, yaw: satYawOut(265.2) }, { collide: true, walkable: true, solid: true });
  const bk = satPolar(270.9, 66.5);
  b.cylinder('wood', { x: bk.x, y: SAT_Y, z: bk.z, r: 0.5, rTop: 0.6, h: 0.6, segments: 10 }, { collide: true, solid: true });
  const sg = satPolar(272.1, 76.2);
  sign(b, out, sg, SAT_Y, satYawOut(272.1) + Math.PI + 0.6, signTexture(['Kyoshi Island', 'By sky bison', 'over the clouds'], { bg: '#f3e6c4', fg: '#7a3d0a', emblem: 'air', accent: '#e08a1e' }), 'wood_red');
  const tr = satPolar(270.4, 74.4);
  out.trigger.set(tr.x, SAT_Y, tr.z);
  const keeper = satPolar(270.6, 76.6);
  const toBison = Math.atan2(satPolar(268.4, 70.2).x - keeper.x, satPolar(268.4, 70.2).z - keeper.z);
  out.npcs.push(
    { id: p.staff.id, name: p.staff.name, title: p.staff.title, role: 'merchant', nation: 'air', appearanceSeed: 7401, x: keeper.x, z: keeper.z, y: SAT_Y, yaw: toBison + 1.2, behavior: { type: 'idle', variant: 'stand' }, dialogue: 'travel_staff', marker: 'none', schedule: 'always', region: p.region },
    traveller('travel_sat_t1', 'air', satPolar(268.8, 78.4), satYawOut(268.8) + Math.PI, 7402, SAT_Y),
    traveller('travel_sat_t2', 'air', satPolar(273.6, 80.5), satYawOut(273.6) + 2.6, 7403, SAT_Y),
  );
};

const BUILDERS: Record<CityId, CityBuilder> = { nwt: buildNwt, fnc: buildFnc, bss: buildBss, sat: buildSat };

/** One city's travel point as a small region (built when near, freed when far). */
export class TravelPoint implements RegionContent {
  readonly id: string;
  readonly center: P2;
  readonly loadRadius = 260;
  readonly unloadRadius = 1100;
  readonly group = new THREE.Group();
  private b: ContentBuilder | null = null;
  private built: Built | null = null;
  private offs: Array<() => void> = [];
  private ctx!: GameContext;
  private detail: 'full' | 'far' | 'hidden' = 'full';

  constructor(readonly def: TravelPointDef) {
    this.id = `travel_${def.id}`;
    this.center = { x: def.stand.x, z: def.stand.z };
    this.group.name = this.id;
  }

  build(ctx: GameContext): void {
    this.ctx = ctx;
    const b = new ContentBuilder(ctx, this.group, this.id);
    const out: Built = { models: [], owned: [], trigger: new THREE.Vector3(), npcs: [] };
    BUILDERS[this.def.id](b, ctx, this.def, out);
    b.finish();
    for (const m of out.models) this.group.add(m.root);
    if (out.vehicle) this.group.add(out.vehicle);
    this.b = b;
    this.built = out;
  }

  update(dt: number, ctx: GameContext): void {
    if (!this.built || this.detail === 'hidden') return;
    for (const m of this.built.models) {
      const a = defaultAnim();
      a.dt = dt;
      a.grounded = true;
      a.time = ctx.time.elapsed;
      m.update(a);
    }
  }

  /** Hide the docked ship / waiting bison while the journey's moving copy is on screen. */
  setVehicleVisible(v: boolean): void {
    if (!this.built) return;
    if (this.built.vehicle) this.built.vehicle.visible = v;
    for (const m of this.built.models) m.root.visible = v;
  }

  setDetail(level: 'full' | 'far' | 'hidden'): void {
    this.detail = level;
    this.group.visible = level !== 'hidden';
  }

  onSessionStart(ctx: GameContext): void {
    if (!this.built) return;
    for (const d of this.built.npcs) ctx.npcs.addDef(d);
    for (const off of this.offs) off();
    const travel = ctx.extra.get('travel') as TravelSystem | undefined;
    this.offs = [
      ctx.interactions.register({
        id: `${this.id}:sign`,
        position: this.built.trigger,
        radius: 3.4,
        label: this.def.prompt,
        priority: 0,
        interact: () => travel?.offerFromCity(this.def.id),
      }),
    ];
  }

  onSessionEnd(): void {
    for (const off of this.offs) off();
    this.offs = [];
  }

  dispose(): void {
    this.onSessionEnd();
    this.b?.dispose();
    this.b = null;
    if (this.built) {
      for (const m of this.built.models) {
        m.root.removeFromParent();
        m.dispose();
      }
      for (const o of this.built.owned) o.dispose();
      if (this.built.vehicle) {
        this.built.vehicle.traverse((c) => (c as THREE.Mesh).isMesh && (c as THREE.Mesh).geometry.dispose());
        this.built.vehicle.removeFromParent();
      }
    }
    this.built = null;
    this.group.clear();
  }

  /** Debug: where the parts are. */
  info(): Record<string, unknown> {
    return { id: this.id, built: !!this.built, trigger: this.built?.trigger.toArray(), npcs: this.built?.npcs.map((n) => n.id) ?? [], meshes: this.b?.meshes.length ?? 0 };
  }
}

export const TRAVEL_POINT_FACTORIES: RegionFactory[] = (Object.keys(TRAVEL_POINTS) as CityId[]).map((id) => () => new TravelPoint(TRAVEL_POINTS[id]));
