import * as THREE from 'three';
import { mergeVertices } from 'three/addons/utils/BufferGeometryUtils.js';
import type { LoopHandle } from '../../audio/AudioEngine';
import { capTaper } from '../../combat/water/FlowTube';
import { getWaterFX, StreamBody, type WaterFX } from '../../combat/water/WaterFX';
import { createWaterMaterial } from '../../combat/water/WaterMaterials';
import type { WaterSource } from '../../combat/WaterSources';
import type { GameContext } from '../../core/GameContext';
import type { WaterSourceType } from '../../core/types';
import { addEffect } from '../../vfx/effects/loop';
import type { Player } from '../Player';
import { aimRay, HeldFollow, holdBand, holdPoint, type PlayInteraction } from './common';

/**
 * Waterbending play: hold the attack while looking at real water (river, lake, sea, pond,
 * fountain, canal, puddle, a water jar or rain barrel), or at snow and ice (melted into
 * water as it is drawn), and it is pulled out in a stream that gathers into a floating orb. The orb follows the aim (look up/down to raise/lower
 * it), lags and sloshes with every turn, ripples, spins and sheds drops. Letting go drops
 * it: it falls, splashes and the water returns to the world (a puddle on dry ground, back
 * into a nearby jar or pond, or just into the river).
 *
 * The water is real: it is taken from the source you look at through the water source
 * registry (finite sources visibly drop and must hold enough; unlimited ones are
 * rate-limited locally like any draw).
 */

/** Units of water an orb takes from its source (a jar holds 16). */
export const ORB_UNITS = 8;
/** Orb radius (m): "medium-sized". */
const ORB_R = 0.42;
/** Metres from the bender to the water they may draw from. */
const REACH = 15;
/** Metres in front of the chest the orb floats. */
const HOLD_DIST = 2.6;
const BENDABLE: ReadonlySet<WaterSourceType> = new Set<WaterSourceType>(['ocean', 'river', 'lake', 'waterfall', 'stream', 'pond', 'canal', 'fountain', 'puddle', 'snow', 'ice']);
/** Ground a waterbender melts into water. */
const FROZEN_GROUND: ReadonlySet<string> = new Set(['snow', 'packedsnow', 'ice']);

export interface WaterTarget {
  id: string;
  label: string;
  type: WaterSourceType;
  /** Point on the water surface the stream rises from. */
  point: THREE.Vector3;
  /** Units available (finite sources) or Infinity. */
  available: number;
  finite: boolean;
}

const tO = new THREE.Vector3();
const tD = new THREE.Vector3();
const tA = new THREE.Vector3();
const tB = new THREE.Vector3();
const tC = new THREE.Vector3();
const tQ = new THREE.Quaternion();

/** Is the world point inside the grab volume of a registered source (basin, channel or vessel)? */
function insideSource(s: WaterSource, x: number, y: number, z: number): boolean {
  const vessel = s.r < 0.6;
  if (y > s.y + (vessel ? 0.45 : 0.1) || y < s.y - (vessel ? 1.05 : 0.6)) return false;
  if (s.path && s.path.length >= 2) {
    for (let i = 0; i < s.path.length - 1; i++) {
      const a = s.path[i], b = s.path[i + 1];
      const abx = b.x - a.x, abz = b.z - a.z;
      const l2 = abx * abx + abz * abz;
      const t = l2 > 0 ? Math.max(0, Math.min(1, ((x - a.x) * abx + (z - a.z) * abz) / l2)) : 0;
      if (Math.hypot(a.x + abx * t - x, a.z + abz * t - z) <= s.r) return true;
    }
    return false;
  }
  return Math.hypot(x - s.x, z - s.z) <= Math.max(s.r, 0.3) + (vessel ? 0.28 : 0.05);
}

/**
 * The water under the crosshair: the first bendable water surface (or water vessel) the aim
 * ray reaches before anything solid, within REACH of the bender and in line of sight; else
 * snow or ice there (frozen lakes, rivers and sea, glacier ice, snowfields), which melts into
 * water as it is drawn. Returns it even when a finite source is too low (`available` tells),
 * null otherwise.
 */
export function findWaterTarget(ctx: GameContext, player: Player): WaterTarget | null {
  aimRay(ctx, player, tO, tD);
  const p = player.position;
  const solid = ctx.world.raycast(tO, tD, 60);
  const limit = Math.min(60, solid ? solid.distance + 0.35 : 60);
  const near: WaterSource[] = [];
  for (const s of ctx.water.list()) {
    if (s.frozen || !BENDABLE.has(s.type) || s.id.startsWith('lake:')) continue;
    if (!s.path && Math.hypot(s.x - p.x, s.z - p.z) > REACH + s.r + 1) continue;
    near.push(s);
  }
  let hitPoint: THREE.Vector3 | null = null;
  let reg: WaterSource | null = null;
  for (let t = 0; t <= limit; t += 0.25) {
    const x = tO.x + tD.x * t, y = tO.y + tD.y * t, z = tO.z + tD.z * t;
    if (Math.hypot(x - p.x, z - p.z) > REACH) {
      if (t > 4) break;
      continue;
    }
    for (const s of near) {
      if (!insideSource(s, x, y, z)) continue;
      reg = s;
      hitPoint = tA.set(x, s.y, z);
      if (s.r < 0.6) hitPoint.set(s.x, s.y, s.z); // a vessel: from its mouth
      break;
    }
    if (reg) break;
    const w = ctx.world.waterAt(x, z);
    if (w && y <= w.level + (w.frozen ? 0.3 : 0.06)) {
      hitPoint = tA.set(x, w.level, z);
      break;
    }
  }
  // Snow or ice where the aim meets the ground (or the side of an ice wall or boulder).
  if (!hitPoint && solid && Math.hypot(solid.point.x - p.x, solid.point.z - p.z) <= REACH) {
    const sp = solid.point;
    const g = ctx.world.groundAt(sp.x, sp.z, sp.y + 0.5);
    if (FROZEN_GROUND.has(g.surface) || ctx.world.collision.get(solid.colliderId)?.surface === 'ice') hitPoint = tA.copy(sp);
  }
  if (!hitPoint) return null;
  const point = hitPoint.clone();
  // Must be reachable: nothing solid between the hands and the water.
  const chest = player.castOrigin('chest', tB);
  if (!ctx.world.hasLineOfSight(chest, tC.copy(point).setY(point.y + 0.35))) return null;
  if (reg) {
    const finite = Number.isFinite(reg.capacity);
    return { id: reg.id, label: reg.label, type: reg.type, point, available: finite ? reg.amount : Infinity, finite };
  }
  const all = ctx.water.findAll(point, 3, { allowLiquid: true, allowIce: true, allowSnow: ctx.water.snowCapable(player), includeDepleted: true });
  const hit = all.find((h) => !h.frozen && BENDABLE.has(h.type)) ?? all.find((h) => h.frozen && (BENDABLE.has(h.type) || h.type === 'ocean' || h.type === 'river' || h.type === 'lake'));
  if (!hit) return null;
  const finite = Number.isFinite(hit.capacity ?? Infinity);
  return { id: hit.id, label: hit.label, type: hit.type, point, available: finite ? hit.available : Infinity, finite };
}

// ---------------------------------------------------------------------------
// Orb body: a wobbling sphere of the bent-water material (real shaded liquid)
// ---------------------------------------------------------------------------

class OrbBody {
  readonly mesh: THREE.Mesh;
  private readonly geo: THREE.BufferGeometry;
  private readonly mat: THREE.ShaderMaterial;
  private readonly dirs: Float32Array;
  private readonly local = new THREE.Vector3();
  private readonly spinAxis = new THREE.Vector3(0.3, 1, 0.2).normalize();
  /** Slosh energy from accelerations (decays). */
  slosh = 0;
  radius = 0;

  constructor(fx: WaterFX, detail: number) {
    const ico = new THREE.IcosahedronGeometry(1, detail);
    ico.deleteAttribute('normal');
    ico.deleteAttribute('uv');
    this.geo = mergeVertices(ico);
    ico.dispose();
    const pos = this.geo.getAttribute('position') as THREE.BufferAttribute;
    this.dirs = new Float32Array(pos.array as Float32Array);
    // Seamless "flow" coordinates (a continuous function of the direction: no uv seam).
    const uv = new Float32Array(pos.count * 2);
    for (let i = 0; i < pos.count; i++) {
      const x = this.dirs[i * 3], y = this.dirs[i * 3 + 1], z = this.dirs[i * 3 + 2];
      uv[i * 2] = 0.5 + 0.35 * x + 0.2 * z;
      uv[i * 2 + 1] = 0.9 * y + 0.25 * x;
    }
    this.geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    this.geo.computeVertexNormals();
    this.mat = createWaterMaterial({ flow: 1.4, foam: 0.55, opacity: 0.94 });
    this.mesh = new THREE.Mesh(this.geo, this.mat);
    this.mesh.name = 'water_orb';
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 11;
    fx.group.add(this.mesh);
  }

  /** Re-shape: ripples + slosh, stretched along the velocity, a little sag at the bottom. */
  shape(t: number, vel: THREE.Vector3, dt: number): void {
    const m = this.mesh;
    const speed = vel.length();
    m.quaternion.multiply(tQ.setFromAxisAngle(this.spinAxis, dt * (0.9 + speed * 0.35)));
    // Velocity in the orb's own (spinning) frame.
    const v = this.local.copy(vel).applyQuaternion(tQ.copy(m.quaternion).invert());
    const s = Math.min(0.32, speed * 0.055);
    if (speed > 1e-3) v.multiplyScalar(1 / speed);
    const squash = 1 / Math.sqrt(1 + s);
    const amp = 0.055 + Math.min(0.12, this.slosh * 0.05);
    const pos = this.geo.getAttribute('position') as THREE.BufferAttribute;
    const arr = pos.array as Float32Array;
    const d = this.dirs;
    const sag = new THREE.Vector3(0, -1, 0).applyQuaternion(tQ.copy(m.quaternion).invert());
    for (let i = 0; i < pos.count; i++) {
      const x = d[i * 3], y = d[i * 3 + 1], z = d[i * 3 + 2];
      let w = 0.6 * Math.sin(3.1 * x + 2.3 * t) * Math.cos(2.7 * y - 1.7 * t);
      w += 0.45 * Math.sin(4.3 * z + 2.9 * y + 3.1 * t);
      w += 0.25 * Math.sin(7.0 * (x + y) - 5.2 * t) + 0.18 * Math.sin(9.0 * (z - x) + 6.1 * t);
      const down = Math.max(0, x * sag.x + y * sag.y + z * sag.z);
      let r = 1 + amp * w - 0.05 * down * down;
      if (r < 0.75) r = 0.75;
      let px = x * r, py = y * r, pz = z * r;
      if (s > 0.002) {
        const along = px * v.x + py * v.y + pz * v.z;
        px = (px - v.x * along) * squash + v.x * along * (1 + s);
        py = (py - v.y * along) * squash + v.y * along * (1 + s);
        pz = (pz - v.z * along) * squash + v.z * along * (1 + s);
      }
      arr[i * 3] = px;
      arr[i * 3 + 1] = py;
      arr[i * 3 + 2] = pz;
    }
    pos.needsUpdate = true;
    this.geo.computeVertexNormals();
    this.geo.computeBoundingSphere();
    m.scale.setScalar(Math.max(0.001, this.radius));
  }

  dispose(): void {
    this.mesh.removeFromParent();
    this.geo.dispose();
    this.mat.dispose();
  }
}

// ---------------------------------------------------------------------------
// The interaction
// ---------------------------------------------------------------------------

export class WaterOrb implements PlayInteraction {
  readonly kind = 'water' as const;
  readonly moveFactor = 0.55;
  readonly facesAim = true;
  private readonly fx: WaterFX;
  private readonly orb: OrbBody;
  private stream: StreamBody | null = null;
  private column: StreamBody | null = null;
  private readonly pos = new THREE.Vector3();
  private readonly vel = new THREE.Vector3();
  private readonly lastVel = new THREE.Vector3();
  private readonly target = new THREE.Vector3();
  /** Swings around the bender (never through them) and lags a little behind turns. */
  private readonly follow = new HeldFollow(8);
  private readonly from: THREE.Vector3;
  private t = 0;
  /** Seconds the water takes to arrive (longer from further away). */
  private readonly formTime: number;
  private band: 'low' | 'mid' | 'high' = 'mid';
  private loop: LoopHandle | null = null;
  private dripT = 0.3;
  private rippleT = 0;
  private released = false;

  constructor(private readonly ctx: GameContext, private readonly player: Player, readonly source: WaterTarget) {
    this.fx = getWaterFX(ctx);
    this.from = source.point.clone();
    const quality = ctx.vfx.quality;
    this.orb = new OrbBody(this.fx, quality === 'low' ? 3 : 4);
    holdPoint(ctx, player, HOLD_DIST, ORB_R, this.pos);
    this.target.copy(this.pos);
    this.follow.reset(player.castOrigin('chest', tB), this.pos);
    this.formTime = 0.5 + Math.min(0.6, this.from.distanceTo(this.pos) * 0.045);
    this.orb.mesh.position.copy(this.pos);
    this.orb.radius = 0.04;
    // The surface is torn open where the water is pulled out.
    this.fx.crown(this.from, 0.45);
    ctx.vfx.ring(tA.copy(this.from).setY(this.from.y + 0.04), '#cfefff', 1.4, 0.6, { opacity: 0.45 });
    // (The draw sound itself comes from the 'water:drawn' audio binding.)
    this.loop = ctx.audio.loop('water_swirl', { position: this.pos, volume: 0.22 });
    player.humanoid.animator.play('water_draw', { fadeIn: 0.12 });
  }

  /** 0 → 1 while the water flows in. */
  private get formed(): number {
    return Math.min(1, this.t / this.formTime);
  }

  update(dt: number): boolean {
    const ctx = this.ctx;
    this.t += dt;
    holdPoint(ctx, this.player, HOLD_DIST, ORB_R, this.target);
    this.lastVel.copy(this.vel);
    this.follow.update(this.player.castOrigin('chest', tB), this.target, dt);
    this.pos.copy(this.follow.pos);
    this.vel.copy(this.follow.vel);
    // Sudden turns slosh the water.
    const acc = tA.subVectors(this.vel, this.lastVel).length() / Math.max(dt, 1e-3);
    this.orb.slosh = Math.min(3, this.orb.slosh * Math.exp(-dt * 2.2) + acc * dt * 0.35);
    const k = this.formed;
    this.orb.radius = ORB_R * (0.12 + 0.88 * Math.pow(k, 0.7)) * (1 + 0.025 * Math.sin(this.t * 5.3));
    this.orb.mesh.position.copy(this.pos).setY(this.pos.y + 0.03 * Math.sin(this.t * 2.1));
    this.orb.shape(this.fx.time, this.vel, dt);
    this.updateStream(dt, k);
    // Arms follow the orb's height.
    const chest = this.player.castOrigin('chest', tB);
    const band = k < 1 ? 'mid' : holdBand(this.pos.y, chest.y, this.band);
    if (k >= 1 && (band !== this.band || !this.player.humanoid.animator.isPlaying(this.clipFor(band)))) {
      this.band = band;
      this.player.humanoid.animator.play(this.clipFor(band), { fadeIn: 0.25 });
    }
    // Drops shed from the moving surface; drips when still.
    const speed = this.vel.length();
    this.dripT -= dt * (1 + speed * 0.8 + this.orb.slosh);
    if (this.dripT <= 0 && k > 0.6) {
      this.dripT = 0.22 + Math.random() * 0.35;
      tC.randomDirection();
      if (speed > 0.8) tC.addScaledVector(this.vel, -0.3 / Math.max(speed, 1)).normalize();
      tA.copy(this.orb.mesh.position).addScaledVector(tC, this.orb.radius * 0.95);
      tB.copy(this.vel).multiplyScalar(0.5).addScaledVector(tC, 0.6 + Math.random() * 0.8);
      this.fx.drops.emit(tA, tB, 0.016 + 0.02 * Math.random(), 1.1);
    }
    // Close over water, the orb's pull ripples the surface below.
    this.rippleT -= dt;
    if (this.rippleT <= 0 && k >= 1) {
      this.rippleT = 0.5;
      const w = ctx.world.liquidAt(this.pos.x, this.pos.z);
      if (w && this.pos.y - w.level < 1.4) ctx.vfx.ring(tA.set(this.pos.x, w.level + 0.04, this.pos.z), '#cfefff', 0.9, 0.7, { opacity: 0.35 });
    }
    this.loop?.setPosition(this.pos);
    this.loop?.setVolume(0.2 + Math.min(0.25, speed * 0.05 + this.orb.slosh * 0.05));
    return true;
  }

  private clipFor(band: 'low' | 'mid' | 'high'): string {
    return band === 'high' ? 'play_water_hold_high' : band === 'low' ? 'play_water_hold_low' : 'play_water_hold';
  }

  /** The stream from the source into the orb, and the whirl lifting out of the surface. */
  private updateStream(dt: number, k: number): void {
    if (k >= 1 && this.t > this.formTime + 0.35) {
      this.stream?.dispose();
      this.stream = null;
      this.column?.dispose();
      this.column = null;
      return;
    }
    if (!this.stream) {
      this.stream = new StreamBody(this.fx, { flow: 9, foam: 1 }, 1.1, 5);
      this.stream.wobble = 0.06;
    }
    const s = this.stream;
    const from = this.from;
    const to = this.orb.mesh.position;
    const d = from.distanceTo(to);
    s.pts[0].copy(from);
    s.pts[1].lerpVectors(from, to, 0.3).setY(Math.max(from.y, to.y) * 0.5 + Math.min(from.y, to.y) * 0.5 + 0.35 + d * 0.12);
    s.pts[2].lerpVectors(from, to, 0.62).setY(Math.max(from.y, to.y) + 0.15 + d * 0.06);
    s.pts[3].lerpVectors(from, to, 0.88);
    s.pts[4].copy(to);
    // The head races to the orb, then the tail follows the last of the water in.
    const flow = Math.min(1, this.t / (this.formTime * 0.55));
    const drain = Math.max(0, (this.t - this.formTime * 0.65) / (this.formTime * 0.6));
    s.head = flow;
    s.tail = Math.min(0.999, drain);
    s.radius = 0.11 + 0.05 * (1 - k);
    s.profile = (u) => capTaper(u, 0.05, 0.12) * (1.15 - 0.35 * u) * (0.75 + 0.25 * Math.sin(u * 20 - this.fx.time * 12) ** 2);
    if (s.tail >= 0.995) s.hide();
    else s.build(5);
    if (!this.column) {
      this.column = new StreamBody(this.fx, { flow: 6, foam: 1.3 }, 1, 6);
      this.column.wobble = 0.05;
    }
    const col = this.column;
    const lift = Math.max(0, 1 - drain);
    const spin = this.fx.time * 7;
    for (let i = 0; i < 6; i++) {
      const u = i / 5;
      const r = 0.45 * (1 - u) + 0.05;
      col.pts[i].set(from.x + Math.cos(spin + u * 4.4) * r, from.y + 0.02 + u * 0.6 * lift, from.z + Math.sin(spin + u * 4.4) * r);
    }
    col.radius = 0.03 + 0.06 * lift;
    col.head = 1;
    col.tail = 0;
    col.profile = (u) => (1.15 - 0.5 * u) * capTaper(u, 0.03, 0.2);
    if (lift < 0.02) col.hide();
    else col.build(6);
    if (Math.random() < dt * 10 && s.path.length > 0.5 && s.head > s.tail + 0.05) {
      s.path.at(s.path.length * (s.tail + (s.head - s.tail) * Math.random()), tA);
      this.fx.shed(tA, tB.subVectors(to, from).normalize().multiplyScalar(3.5), 1, 1);
    }
  }

  release(): void {
    if (this.released) return;
    this.released = true;
    const ctx = this.ctx;
    this.stream?.dispose();
    this.column?.dispose();
    this.stream = this.column = null;
    this.loop?.stop(0.25);
    this.loop = null;
    this.player.humanoid.animator.stop(this.clipFor(this.band), 0.3);
    this.player.humanoid.animator.stop('water_draw', 0.2);
    // Not formed yet: the water that made it this far simply splashes down.
    const units = ORB_UNITS * Math.max(0.25, this.formed);
    const orb = this.orb;
    const fx = this.fx;
    const pos = this.pos.copy(orb.mesh.position);
    const vel = this.vel.multiplyScalar(0.8);
    let t = 0;
    addEffect({
      update: (dt) => {
        t += dt;
        vel.y -= 9.8 * dt;
        pos.addScaledVector(vel, dt);
        orb.mesh.position.copy(pos);
        orb.slosh = Math.min(3, orb.slosh + dt * 3);
        orb.shape(fx.time, vel, dt);
        const ground = ctx.world.groundAt(pos.x, pos.z, pos.y + 1).y;
        const w = ctx.world.liquidAt(pos.x, pos.z);
        const floor = Math.max(ground, w ? w.level : -Infinity);
        if (pos.y - orb.radius * 0.6 > floor && t < 4) return true;
        // Splash: drops, spray and a ring where it lands; the water goes back to the world.
        const at = tA.set(pos.x, floor + 0.05, pos.z);
        fx.splash(at, 1.05, { sound: true, volume: 0.7, dir: tB.copy(vel).setY(0).multiplyScalar(0.15) });
        fx.crown(at, 0.9);
        if (!w) ctx.world.fx.wet(at, 1.3);
        ctx.water.release(at, units);
        return false;
      },
      dispose: () => orb.dispose(),
    });
  }

  dispose(): void {
    this.released = true;
    this.stream?.dispose();
    this.column?.dispose();
    this.stream = this.column = null;
    this.loop?.stop(0.1);
    this.loop = null;
    this.player.humanoid.animator.stop(this.clipFor(this.band), 0.1);
    this.player.humanoid.animator.stop('water_draw', 0.1);
    this.orb.dispose();
  }

  debug(): Record<string, unknown> {
    const p = this.orb.mesh.position;
    return {
      source: { id: this.source.id, type: this.source.type, label: this.source.label },
      formed: +this.formed.toFixed(2),
      radius: +this.orb.radius.toFixed(3),
      orb: [+p.x.toFixed(2), +p.y.toFixed(2), +p.z.toFixed(2)],
      stream: !!this.stream,
      band: this.band,
    };
  }
}
