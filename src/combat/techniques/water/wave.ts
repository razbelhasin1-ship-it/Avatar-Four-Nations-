import * as THREE from 'three';
import type { GameContext } from '../../../core/GameContext';
import { solidAt } from '../../../vfx/effects/constructs';
import { clamp01, easeIn, easeOut } from '../../water/Curve';
import { createWaterMaterial } from '../../water/WaterMaterials';
import { StreamBody, type WaterEffect, type WaterFX } from '../../water/WaterFX';
import type { Cast, WaterGrant } from '../../types';
import { finisherFreeze, finisherImpact } from '../bending/util';
import { basis, douse, fxOf, handPos, refundWater, returnToReserve, spill, UP } from './shared';

/**
 * Fifth strike of Water Whip, the finisher: Crashing Wave. The bender sweeps the whip's water up —
 * with more drawn from the reserve or a source within reach — into a ring spinning overhead, then
 * hurls it down in front: it lands as a breaking wave that rolls ~7 m forward across a wide front,
 * knocking down and soaking everyone it meets, breaks against walls, and spills into puddles that
 * can be bent again. Every drop is real water (the cast's grant plus the extra drawn here), and all
 * of it goes back into the world.
 */

export const WAVE = {
  /** Extra water drawn for the wave on top of the whip's (units). */
  extra: 6,
  width: 6.5,
  height: 2.35,
  /** The front lands this far ahead and rolls on to `to` (m) in `crash` seconds, then collapses. */
  from: 2.1,
  to: 8.2,
  crash: 0.42,
  collapse: 0.32,
};

/** Breaking-wave cross-section (forward z, up y) for unit height: back toe → crest → lip → front toe. */
const PROFILE: Array<[number, number]> = [
  [-0.95, 0.0],
  [-0.68, 0.34],
  [-0.4, 0.8],
  [0.0, 1.0],
  [0.42, 0.95],
  [0.66, 0.72],
  [0.44, 0.56],
  [0.24, 0.32],
  [0.3, 0.0],
];

function sampleProfile(n: number): Array<[number, number]> {
  const curve = new THREE.SplineCurve(PROFILE.map(([z, y]) => new THREE.Vector2(z, y)));
  const out: Array<[number, number]> = [];
  for (let i = 0; i <= n; i++) {
    const p = curve.getPoint(i / n);
    out.push([p.x, p.y]);
  }
  return out;
}

const tA = new THREE.Vector3();
const tB = new THREE.Vector3();
const tC = new THREE.Vector3();

/** Surface the wave runs on: water where there is water, else the ground. */
function surfaceAt(ctx: GameContext, x: number, z: number, nearY: number): number {
  const g = ctx.world.groundAt(x, z, nearY + 2).y;
  const l = ctx.world.liquidAt(x, z);
  return l && l.level > g ? l.level : g;
}

/** The wave's water sheet, rebuilt in world space every frame (its columns follow the ground). */
class WaveSheet {
  readonly mesh: THREE.Mesh;
  private readonly mat: THREE.ShaderMaterial;
  private readonly geo: THREE.BufferGeometry;
  private readonly pos: Float32Array;
  private readonly prof: Array<[number, number]>;
  readonly crest: THREE.Vector3[] = [];
  readonly toes: THREE.Vector3[] = [];

  constructor(private readonly ctx: GameContext, readonly cols: number, readonly rows: number) {
    this.prof = sampleProfile(rows);
    const nv = (cols + 1) * (rows + 1);
    this.pos = new Float32Array(nv * 3);
    const uv = new Float32Array(nv * 2);
    const idx: number[] = [];
    for (let i = 0; i <= cols; i++) {
      for (let j = 0; j <= rows; j++) {
        const k = i * (rows + 1) + j;
        uv[k * 2] = i / cols;
        uv[k * 2 + 1] = (j / rows) * 3;
        if (i < cols && j < rows) {
          const a = k, b = k + rows + 1;
          idx.push(a, b, a + 1, b, b + 1, a + 1);
        }
      }
    }
    this.geo = new THREE.BufferGeometry();
    this.geo.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    this.geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    this.geo.setIndex(idx);
    // Bent water wears the tone of the source it came from (shared bend palette).
    this.mat = createWaterMaterial({ opacity: 0.92, flow: 4.5, foam: 2.4, glow: 0.06 });
    this.mat.side = THREE.DoubleSide;
    this.mesh = new THREE.Mesh(this.geo, this.mat);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 3;
    this.mesh.visible = false;
    for (let i = 0; i <= cols; i++) {
      this.crest.push(new THREE.Vector3());
      this.toes.push(new THREE.Vector3());
    }
    ctx.vfx.group.add(this.mesh);
  }

  /** Pose around the front centre moving along `dir`: height h, width w, topple 0..1 (the lip falls forward). */
  update(front: THREE.Vector3, dir: THREE.Vector3, side: THREE.Vector3, h: number, w: number, topple: number, t: number): void {
    const { cols, rows, pos, prof } = this;
    this.mesh.visible = h > 0.02;
    for (let i = 0; i <= cols; i++) {
      const u = i / cols;
      const s = (u - 0.5) * 2;
      const taper = 1 - Math.pow(Math.abs(s), 2.4);
      // The ends trail behind the centre (a curved front) and ripple.
      const back = -0.9 * s * s + 0.15 * Math.sin(t * 6 + u * 9);
      const cx = front.x + side.x * s * w * 0.5 + dir.x * back;
      const cz = front.z + side.z * s * w * 0.5 + dir.z * back;
      const gy = surfaceAt(this.ctx, cx, cz, front.y);
      const hh = Math.max(0.03, h * (0.25 + 0.75 * taper) * (1 + 0.07 * Math.sin(t * 9 + u * 13)));
      const thick = Math.max(0.45, hh * 0.75);
      for (let j = 0; j <= rows; j++) {
        const [pz, py] = prof[j];
        // Toppling: the higher the water, the further it is thrown forward over the front.
        const z = pz + py * py * topple * 0.9;
        const k = (i * (rows + 1) + j) * 3;
        pos[k] = cx + dir.x * z * thick;
        pos[k + 1] = gy + py * hh * (1 - 0.35 * topple * py) - 0.04;
        pos[k + 2] = cz + dir.z * z * thick;
      }
      this.crest[i].set(cx + dir.x * (0.55 + 0.6 * topple) * thick, gy + hh * 0.85, cz + dir.z * (0.55 + 0.6 * topple) * thick);
      this.toes[i].set(cx + dir.x * 0.3 * thick, gy, cz + dir.z * 0.3 * thick);
    }
    (this.geo.getAttribute('position') as THREE.BufferAttribute).needsUpdate = true;
    this.geo.computeVertexNormals();
  }

  dispose(): void {
    this.mesh.removeFromParent();
    this.geo.dispose();
    this.mat.dispose();
  }
}

const RING_PTS = 10;

/**
 * The finisher's water from gather to puddle: feed streams from its sources into the hands, a ring
 * spinning overhead while the arms rise, then the breaking wave. Lives in the WaterFX runtime.
 */
export class CrashWaveEffect implements WaterEffect {
  readonly kind = 'crash_wave';
  readonly castId: number;
  private readonly fx: WaterFX;
  private readonly feeds: Array<{ body: StreamBody; from: THREE.Vector3 }> = [];
  private readonly ring: StreamBody;
  private readonly sheet: WaveSheet;
  private readonly f = new THREE.Vector3();
  private readonly r = new THREE.Vector3();
  private readonly ringC = new THREE.Vector3();
  readonly front = new THREE.Vector3();
  /** Water carried (units): the whip's grant plus what was drawn extra. */
  readonly amount: number;
  /** Size of the wave from how much water there is (0.65..1). */
  private readonly k: number;
  private t = 0;
  private relT = -1;
  private crashT = -1;
  private collapseT = -1;
  private aborted = false;
  private abortT = 0;
  private landed = false;
  private travelled = 0;
  private lastWet = -99;
  private h = 0;
  private w = 0;
  private spilled = false;
  private gone = false;
  readonly hits: number[] = [];

  constructor(readonly cast: Cast, private readonly extra: WaterGrant | null) {
    this.fx = fxOf(cast);
    this.castId = cast.id;
    basis(cast.aimDir, this.f, this.r);
    this.f.setY(0).normalize();
    this.r.set(-this.f.z, 0, this.f.x);
    this.amount = cast.water.amount + (extra?.amount ?? 0);
    this.k = Math.max(0.65, Math.min(1, this.amount / (4 + WAVE.extra)));
    const hands = handPos(cast.caster, 'hands', tA);
    // Feed streams: the whip's water, and the extra drawn from a real source if it came from one.
    const from0 = this.fx.originFor(cast, hands, new THREE.Vector3());
    const sources = [from0];
    if (extra?.from && extra.sourceType !== 'reserve') sources.push(extra.from.clone());
    for (const from of sources) {
      const body = new StreamBody(this.fx, { flow: 8, foam: 1 }, from.distanceTo(hands) > 9 ? 1.4 : 1, 3);
      body.radius = 0.3;
      body.wobble = 0.05;
      this.feeds.push({ body, from });
    }
    this.ring = new StreamBody(this.fx, { flow: 10, foam: 1.3 }, 1.2, RING_PTS + 1);
    this.ring.wobble = 0.06;
    const q = cast.ctx.vfx.quality;
    this.sheet = new WaveSheet(cast.ctx, q === 'low' ? 10 : q === 'medium' ? 14 : 18, q === 'low' ? 8 : 11);
    this.fx.logCast(cast, from0);
    if (cast.water.from) this.fx.splash(from0, 0.7, { sound: false });
    cast.ctx.audio.play('water_gather', { position: from0, volume: 0.7, pitch: 0.9 });
  }

  /** The arms come down: the ring is hurled forward and lands as the wave. */
  release(): void {
    if (this.relT >= 0 || this.aborted) return;
    this.relT = this.t;
  }

  /** Interrupted before the throw: the water falls back where it came from. */
  abort(): void {
    if (this.relT >= 0 || this.aborted) return;
    this.aborted = true;
    this.abortT = 0;
    this.fx.droplets(this.ring.path, 0, this.ring.path.length, 10);
    refundWater(this.cast);
    const x = this.extra;
    if (x && x.amount > 0) {
      if (x.sourceType === 'reserve') returnToReserve(this.cast, x.amount);
      else if (x.from && x.sourceType !== 'conjured') this.cast.ctx.water.release(x.from, x.amount);
    }
  }

  update(dt: number): boolean {
    if (this.gone) return false;
    this.t += dt;
    const cast = this.cast;
    const c = cast.caster;
    const ctx = cast.ctx;
    const hands = handPos(c, 'hands', tA);
    // ---- Gather: feeds into the hands, the ring swelling overhead --------------------------------------
    if (this.aborted) {
      this.abortT += dt;
      for (const fd of this.feeds) fd.body.hide();
      this.ring.radius *= Math.max(0, 1 - dt * 7);
      for (const p of this.ring.pts) p.y -= 12 * this.abortT * dt * 4;
      this.ring.build(RING_PTS + 1);
      return this.abortT < 0.35;
    }
    const pre = this.relT < 0;
    const gt = pre ? this.t : this.relT;
    const grow = easeOut(clamp01(gt / 0.34));
    for (const fd of this.feeds) {
      const fp = fd.body.pts;
      fp[0].copy(fd.from);
      const d = fd.from.distanceTo(hands);
      fp[1].lerpVectors(fd.from, hands, 0.5).addScaledVector(UP, 0.25 * d + 0.5);
      fp[2].copy(hands);
      fd.body.head = easeOut(clamp01(this.t / 0.22));
      fd.body.tail = easeIn(clamp01((this.t - 0.16) / 0.22));
      if (fd.body.tail < 0.995) fd.body.build(3);
      else fd.body.hide();
    }
    // The ring: round the raised hands, spinning, tilted a little toward the front.
    const chest = handPos(c, 'chest', tB);
    this.ringC.copy(chest).addScaledVector(UP, 1.05 * grow).addScaledVector(this.f, 0.15);
    const rr = (0.3 + 0.75 * grow) * this.k;
    let ringShow = 1;
    if (!pre) ringShow = 1 - clamp01((this.t - this.relT) / 0.09);
    if (ringShow > 0) {
      const spin = this.t * 9;
      for (let i = 0; i <= RING_PTS; i++) {
        const a = spin + (i / RING_PTS) * Math.PI * 2;
        const ca = Math.cos(a), sa = Math.sin(a);
        // While thrown, the ring stretches out toward where the wave lands.
        const reach = pre ? 0 : (1 - ringShow) * 1.5;
        this.ring.pts[i].copy(this.ringC).addScaledVector(this.r, ca * rr).addScaledVector(this.f, sa * rr * 0.8 + reach).addScaledVector(UP, sa * rr * 0.3 - reach * 0.6);
      }
      this.ring.radius = (0.13 + 0.09 * grow) * this.k * (0.4 + 0.6 * ringShow);
      this.ring.profile = () => 1;
      this.ring.tail = 0;
      this.ring.head = 1;
      this.ring.build(RING_PTS + 1);
      if (Math.random() < dt * 30) this.fx.shed(this.ring.pts[Math.floor(Math.random() * RING_PTS)], tC.set(0, 1, 0), 1, 1.2);
    } else this.ring.hide();
    if (pre) {
      if (this.t > 2) this.abort();
      return true;
    }
    // ---- Crash: the wave lands in front and rolls forward ----------------------------------------------
    if (this.crashT < 0) {
      this.crashT = 0;
      this.front.copy(c.position).addScaledVector(this.f, WAVE.from);
      this.front.y = surfaceAt(ctx, this.front.x, this.front.z, c.position.y);
    } else if (this.collapseT < 0) this.crashT += dt;
    const s = clamp01(this.crashT / WAVE.crash);
    if (this.collapseT < 0) {
      const want = WAVE.from + (WAVE.to - WAVE.from) * (1 - Math.pow(1 - s, 1.6)) * (0.8 + 0.2 * this.k);
      const step = Math.max(0, want - WAVE.from - this.travelled);
      if (step > 0) {
        const nx = this.front.x + this.f.x * step, nz = this.front.z + this.f.z * step;
        const ny = surfaceAt(ctx, nx, nz, this.front.y);
        // A wall or a steep rise stops it: it breaks there.
        const blocked = ny - this.front.y > 1.4 || solidAt(ctx, tC.set(nx, ny + 1.1, nz), 0.5, [], 0.5) !== null;
        if (blocked) this.collapseT = 0;
        else {
          this.front.set(nx, ny, nz);
          this.travelled += step;
        }
      }
      if (s >= 1 && this.collapseT < 0) this.collapseT = 0;
    } else this.collapseT += dt;
    const fall = this.collapseT < 0 ? 1 : Math.max(0, 1 - this.collapseT / WAVE.collapse);
    const rise = s < 0.12 ? 0.55 + (s / 0.12) * 0.45 : 1 - 0.5 * Math.pow((s - 0.12) / 0.88, 1.3);
    this.h = WAVE.height * this.k * rise * fall;
    this.w = WAVE.width * this.k * (0.75 + 0.35 * s);
    const topple = Math.min(1, s * 0.9 + (this.collapseT >= 0 ? this.collapseT / WAVE.collapse : 0));
    this.sheet.update(this.front, this.f, this.r, this.h, this.w, topple, this.t);
    if (!this.landed) {
      this.landed = true;
      this.fx.splash(tC.copy(this.front).setY(this.front.y + 0.2), 1.6, { volume: 0.9 });
      ctx.audio.play('water.splash.big', { position: this.front, volume: 0.9, pitch: 1.1 });
      ctx.audio.play('water_launch', { position: this.front, volume: 0.7, pitch: 0.8 });
      finisherImpact(cast, this.front, 0.32, 0.36);
    }
    if (this.collapseT < 0 || this.collapseT < 0.08) this.hitFront();
    this.spray(dt);
    if (this.travelled - this.lastWet > 1.5) {
      this.lastWet = this.travelled;
      for (const o of [-0.3, 0, 0.3]) ctx.world.fx.wet(tC.copy(this.front).addScaledVector(this.r, o * this.w), 1.6 + Math.random());
      ctx.world.fx.disturb(this.front, this.w * 0.6, 1);
    }
    if (this.collapseT >= WAVE.collapse) {
      this.finish();
      return false;
    }
    return true;
  }

  /** Everyone the front meets is knocked down and soaked (once each). */
  private hitFront(): void {
    const cast = this.cast;
    const ctx = cast.ctx;
    const thick = Math.max(0.45, this.h * 0.75);
    for (const e of [...ctx.entities.queryRadius(this.front, this.w * 0.5 + 2.5)]) {
      if (e === cast.caster || !ctx.combat.canHarm(cast.caster, e)) continue;
      const rel = tC.subVectors(e.position, this.front);
      const along = rel.dot(this.f);
      const lat = rel.dot(this.r);
      const sNorm = Math.min(1, Math.abs(lat) / (this.w * 0.5));
      // The front is curved: its ends trail behind the centre.
      const back = -0.9 * sNorm * sNorm;
      if (Math.abs(lat) > this.w * 0.5 + e.radius) continue;
      if (along - back > 0.9 + e.radius || along - back < -1.4 * thick - 0.6) continue;
      if (e.position.y - surfaceAt(ctx, e.position.x, e.position.z, e.position.y) > this.h + 0.4) continue;
      const kb = this.f.clone().addScaledVector(this.r, Math.sign(lat) * sNorm * 0.35).normalize().multiplyScalar(11);
      const at = e.aimPoint(new THREE.Vector3());
      const res = cast.hit(e, { damage: 22, knockback: kb, launch: 2.5, knockdown: true, stagger: 85, status: [{ type: 'soaked', duration: 8 }], point: at });
      if (!res) continue;
      this.hits.push(e.id);
      douse(cast, e);
      this.fx.splash(at, 1.2, { volume: 0.7 });
      finisherFreeze(cast, e, 0.15);
    }
  }

  /** Spray off the crest, foam at the toe. */
  private spray(dt: number): void {
    const ctx = this.cast.ctx;
    const sh = this.sheet;
    const rate = ctx.vfx.quality === 'low' ? 0.3 : 0.6;
    for (let i = 0; i <= sh.cols; i += 2) {
      if (Math.random() > rate || this.h < 0.25) continue;
      ctx.vfx.burst('spray', sh.crest[i], { count: 2, dir: tC.copy(this.f).setY(0.7), spread: 0.5, speed: 1.8 });
      if (Math.random() < 0.35) ctx.vfx.burst('splash', sh.toes[i], { count: 2, dir: tC.copy(this.f).setY(1), spread: 0.6, speed: 2 });
    }
    if (this.collapseT >= 0 && this.collapseT < dt * 1.5) {
      ctx.vfx.burst('splash', tC.copy(this.front).setY(this.front.y + 0.8), { count: 26, radius: this.w * 0.35, speed: 2.6 });
      ctx.vfx.burst('spray', tC.copy(this.front).setY(this.front.y + 1.1), { count: 18, radius: this.w * 0.3, speed: 1.8 });
      ctx.audio.play('water.splash', { position: this.front, volume: 0.8, pitch: 0.9 });
    }
  }

  /**
   * The water returns to the world where the wave broke: all of it in one place, so it pools into a
   * puddle that can be bent again (a few units alone are too little to pool); the ground is wet across
   * the whole front.
   */
  private finish(): void {
    if (this.spilled) return;
    this.spilled = true;
    spill(this.cast, tC.copy(this.front).addScaledVector(this.f, -0.5), this.amount);
    for (const o of [-0.35, 0.35]) this.cast.ctx.world.fx.wet(tC.copy(this.front).addScaledVector(this.r, o * this.w), 1.8);
  }

  trace(): Record<string, unknown> {
    const phase = this.aborted ? 'aborted' : this.relT < 0 ? 'gather' : this.collapseT >= 0 ? 'collapse' : 'crash';
    return { phase, front: this.front.toArray(), height: this.h, width: this.w, travelled: this.travelled, amount: this.amount, hits: [...this.hits] };
  }

  dispose(): void {
    this.gone = true;
    // Cleared before it landed (session end, death): the water still goes back into the world.
    if (this.relT >= 0 && !this.spilled) this.finish();
    for (const fd of this.feeds) fd.body.dispose();
    this.ring.dispose();
    this.sheet.dispose();
  }
}

/** Draw the wave's extra water: as much as possible from the reserve and real sources (never conjured). */
export function drawWaveWater(cast: Cast): WaterGrant | null {
  const ctx = cast.ctx;
  const c = cast.caster;
  const take = (amount: number): WaterGrant | null => (amount >= 0.5 ? ctx.water.acquire(c, { amount }, cast.aimDir, cast.aimPoint) : null);
  return take(WAVE.extra) ?? take(Math.min(WAVE.extra, Math.floor(c.waterReserve * 10) / 10));
}
