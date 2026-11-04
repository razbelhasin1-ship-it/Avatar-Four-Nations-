import * as THREE from 'three';
import type { LoopHandle } from '../../../audio/AudioEngine';
import { registerClip } from '../../../character/Animator';
import type { GameContext } from '../../../core/GameContext';
import type { Action } from '../../../core/Input';
import type { Entity } from '../../../entities/Entity';
import { capTaper } from '../../water/FlowTube';
import { createPuddleMaterial, createWaterMaterial } from '../../water/WaterMaterials';
import { StreamBody, type WaterEffect, type WaterFX } from '../../water/WaterFX';
import { registerTechnique } from '../../CombatSystem';
import type { Cast, Combatant, Projectile } from '../../types';
import { anim, stopAnim } from '../bending/util';
import { douse, fxOf, handPos, refundWater, returnToReserve, spill } from '../water/shared';

/**
 * Octopus Form — Master Pakku's form, which Katara and Aang learn at the North Pole.
 *
 * Water from a real source rises around the bender into a shell (a column of water that streams
 * upward over a rippling pool) and eight tentacles grow out of it, swaying and curling at the
 * tips. The tentacles do what is drawn: a blast coming in is caught and swatted by the tip of the
 * tentacle that reaches it (the shell itself stops anything that slips past); a foe in reach is
 * lashed — the tentacle winds up, whips out and the hit lands when its tip arrives. The bender can
 * walk slowly inside it; Attack orders a double lash at the target; pressing the form again lets
 * the water fall. It ends with the tentacles drawing back into the shell and the shell collapsing.
 */

const ARMS = 8;
/** Lash reach from the bender (m). */
export const OCTOPUS_REACH = 3.7;
/** Incoming projectiles are tracked from this far. */
const SWAT_RANGE = 5.6;
const FORM_TIME = 6;
const SEG = 14;
const SHELL_CATCH = 1.25;
const UPV = new THREE.Vector3(0, 1, 0);

// ---------------------------------------------------------------------------
// Stance clip: arms raised out to the sides, wrists rolling like the tentacles
// ---------------------------------------------------------------------------

registerClip({
  id: 'octopus_stance',
  duration: 1.6,
  mask: 'upper',
  loop: true,
  keys: [
    { t: 0, pose: { spine: [-0.06, 0, 0], chest: [-0.04, 0, 0], upperArmL: [-0.4, 0.1, 1.12], foreArmL: [-0.55, 0, 0], handL: [0.35, 0, 0.25], upperArmR: [-0.3, -0.1, -1.2], foreArmR: [-0.45, 0, 0], handR: [-0.25, 0, -0.15], fistL: 0, fistR: 0, hipsY: -0.07 } },
    { t: 0.8, pose: { spine: [-0.04, 0.06, 0], chest: [-0.03, 0.04, 0], upperArmL: [-0.3, 0.1, 1.2], foreArmL: [-0.45, 0, 0], handL: [-0.25, 0, 0.15], upperArmR: [-0.42, -0.1, -1.1], foreArmR: [-0.6, 0, 0], handR: [0.35, 0, -0.25], hipsY: -0.09 }, ease: 'inout' },
    { t: 1.6, pose: { spine: [-0.06, 0, 0], chest: [-0.04, 0, 0], upperArmL: [-0.4, 0.1, 1.12], foreArmL: [-0.55, 0, 0], handL: [0.35, 0, 0.25], upperArmR: [-0.3, -0.1, -1.2], foreArmR: [-0.45, 0, 0], handR: [-0.25, 0, -0.15], hipsY: -0.07 }, ease: 'inout' },
  ],
});

// ---------------------------------------------------------------------------
// Shared geometry (built once, never disposed)
// ---------------------------------------------------------------------------

let shellGeo: THREE.BufferGeometry | null = null;
let poolGeo: THREE.BufferGeometry | null = null;

/** A column of water around the bender, domed over the head; uv.y = metres up the surface. */
function shellGeometry(): THREE.BufferGeometry {
  if (shellGeo) return shellGeo;
  const prof: Array<[number, number]> = [
    [0.7, 0.0],
    [0.8, 0.22],
    [0.85, 0.6],
    [0.83, 1.0],
    [0.77, 1.4],
    [0.65, 1.76],
    [0.47, 2.02],
    [0.25, 2.18],
    [0.001, 2.24],
  ];
  const pts = prof.map(([r, y]) => new THREE.Vector2(r, y));
  const g = new THREE.LatheGeometry(pts, 30);
  // uv.y: arc length up the profile (so the flow shader's streaks rise in metres).
  const arc: number[] = [0];
  for (let i = 1; i < prof.length; i++) arc.push(arc[i - 1] + Math.hypot(prof[i][0] - prof[i - 1][0], prof[i][1] - prof[i - 1][1]));
  const uv = g.getAttribute('uv') as THREE.BufferAttribute;
  const n = prof.length;
  for (let k = 0; k < uv.count; k++) {
    const j = k % n;
    uv.setY(k, arc[j]);
    uv.setX(k, uv.getX(k) * 4);
  }
  g.computeBoundingSphere();
  shellGeo = g;
  return g;
}

function poolGeometry(): THREE.BufferGeometry {
  if (poolGeo) return poolGeo;
  const g = new THREE.CircleGeometry(1, 40);
  g.rotateX(-Math.PI / 2);
  poolGeo = g;
  return g;
}

// ---------------------------------------------------------------------------
// The form
// ---------------------------------------------------------------------------

type ArmMode = 'idle' | 'wind' | 'strike' | 'recover' | 'swat';

interface Arm {
  body: StreamBody;
  /** Azimuth around the bender (relative to facing), base height, rest length. */
  az: number;
  h: number;
  len: number;
  phase: number;
  delay: number;
  grow: number;
  curl: number;
  mode: ArmMode;
  t: number;
  tip: THREE.Vector3;
  from: THREE.Vector3;
  aim: THREE.Vector3;
  target: Entity | null;
  proj: Projectile | null;
}

const aB = new THREE.Vector3();
const aD = new THREE.Vector3();
const aR = new THREE.Vector3();
const aW = new THREE.Vector3();
const aT = new THREE.Vector3();
const aX = new THREE.Vector3();
const aP1 = new THREE.Vector3();
const aP2 = new THREE.Vector3();
const aDir = new THREE.Vector3();
const aQ = new THREE.Quaternion();
const tA = new THREE.Vector3();
const tB = new THREE.Vector3();

const easeOut = (k: number) => 1 - (1 - k) * (1 - k) * (1 - k);
const easeInOut = (k: number) => (k < 0.5 ? 4 * k * k * k : 1 - Math.pow(-2 * k + 2, 3) / 2);

export class OctopusForm implements WaterEffect {
  readonly kind = 'octopus';
  castId: number;
  private readonly fx: WaterFX;
  readonly arms: Arm[] = [];
  private readonly shell: THREE.Mesh;
  private readonly shellMat: THREE.ShaderMaterial;
  private readonly pool: THREE.Mesh;
  private readonly poolMat: THREE.ShaderMaterial;
  private feed: StreamBody | null = null;
  private readonly feedFrom = new THREE.Vector3();
  private t = 0;
  private rise = 0;
  /** Seconds since the form was released (-1 before). */
  done = false;
  private collapseT = 0;
  private splashed = false;
  /** Stats for tests / debug. */
  readonly stats = { swats: 0, shellCatches: 0, strikes: 0, landed: 0 };

  constructor(readonly cast: Cast) {
    this.fx = fxOf(cast);
    this.castId = cast.id;
    const ice = cast.water.frozen ? 0.15 : 0;
    // Shell (both faces: its far side shows through the near one).
    this.shellMat = createWaterMaterial({ opacity: 0, flow: 1.25, foam: 0.6, ice });
    this.shellMat.side = THREE.DoubleSide;
    this.shell = new THREE.Mesh(shellGeometry(), this.shellMat);
    this.shell.renderOrder = 11;
    this.shell.frustumCulled = false;
    this.shell.name = 'octopus_shell';
    this.fx.group.add(this.shell);
    this.poolMat = createPuddleMaterial();
    this.poolMat.uniforms.uRipple.value = 1;
    this.poolMat.uniforms.uOpacity.value = 0;
    this.pool = new THREE.Mesh(poolGeometry(), this.poolMat);
    this.pool.renderOrder = 10;
    this.pool.name = 'octopus_pool';
    this.fx.group.add(this.pool);
    // Tentacles: alternating high and low around the shell, each its own sway.
    const n = this.fx.quality === 'low' ? 6 : ARMS;
    for (let i = 0; i < n; i++) {
      const body = new StreamBody(this.fx, { flow: 4.2, foam: 0.7, ice }, 1, SEG);
      body.radius = 0.19;
      body.wobble = 0;
      body.profile = (u) => (0.17 + 0.83 * Math.pow(1 - u, 1.25)) * capTaper(u, 0, 0.07);
      const az = ((i + 0.5) / n) * Math.PI * 2;
      this.arms.push({
        body,
        az,
        h: i % 2 === 0 ? 1.28 : 0.92,
        len: 1.9 + (i % 3) * 0.18,
        phase: i * 1.37,
        delay: 0.16 + (i % 4) * 0.05 + (i > 3 ? 0.03 : 0),
        grow: 0,
        curl: 1,
        mode: 'idle',
        t: 0,
        tip: new THREE.Vector3(),
        from: new THREE.Vector3(),
        aim: new THREE.Vector3(),
        target: null,
        proj: null,
      });
    }
    // The water arrives from its source (or the bender's hands, for carried water).
    const c = cast.caster;
    if (cast.water.from && cast.water.sourceType !== 'reserve') this.feedFrom.copy(cast.water.from);
    else handPos(c, 'hands', this.feedFrom);
    this.feed = new StreamBody(this.fx, { flow: 6, ice }, 1.2, 6);
    this.feed.radius = 0.16;
  }

  private center(out: THREE.Vector3): THREE.Vector3 {
    return out.copy(this.cast.caster.position);
  }

  /** Arm best placed to reach a world point (idle or recovering first). */
  private pickArm(at: THREE.Vector3, allowBusy = false): Arm | null {
    const c = this.cast.caster;
    const want = Math.atan2(at.x - c.position.x, at.z - c.position.z);
    let best: Arm | null = null;
    let bestD = Infinity;
    for (const a of this.arms) {
      if (a.grow < 0.6) continue;
      const free = a.mode === 'idle' || a.mode === 'recover';
      if (!free && !allowBusy) continue;
      const az = c.yaw + a.az;
      const d = Math.abs(Math.atan2(Math.sin(az - want), Math.cos(az - want))) + (free ? 0 : 3);
      if (d < bestD) {
        bestD = d;
        best = a;
      }
    }
    return best;
  }

  get formed(): boolean {
    return !this.done && this.rise > 0.8 && this.arms.some((a) => a.grow > 0.8);
  }

  tracks(p: Projectile): boolean {
    return this.arms.some((a) => a.mode === 'swat' && a.proj === p);
  }

  get busyStrikes(): number {
    let n = 0;
    for (const a of this.arms) if (a.mode === 'wind' || a.mode === 'strike') n++;
    return n;
  }

  /** Lash at a foe (or at a point when `target` is null). Returns false if no tentacle is free. */
  strike(target: Entity | null, at: THREE.Vector3, delay = 0): boolean {
    if (!this.formed) return false;
    const a = this.pickArm(at);
    if (!a) return false;
    a.mode = 'wind';
    a.t = -delay;
    a.from.copy(a.tip);
    a.aim.copy(at);
    a.target = target;
    a.proj = null;
    this.stats.strikes++;
    return true;
  }

  /** Send a tentacle to catch an incoming projectile. */
  swat(p: Projectile): boolean {
    if (!this.formed) return false;
    const a = this.pickArm(p.position, true);
    if (!a || a.mode === 'swat') return false;
    a.mode = 'swat';
    a.t = 0;
    a.from.copy(a.tip);
    a.proj = p;
    a.target = null;
    return true;
  }

  /** The shell stopped something that got past the tentacles. */
  shellCatch(at: THREE.Vector3): void {
    this.stats.shellCatches++;
    this.fx.splash(at, 0.7, { sound: true });
  }

  update(dt: number): boolean {
    this.t += dt;
    const cast = this.cast;
    const c = cast.caster;
    const ctx = cast.ctx;
    const C = this.center(tA);
    // Rise / collapse.
    if (this.done) {
      this.collapseT += dt;
      if (!this.splashed) {
        this.splashed = true;
        this.fx.splash(tB.copy(C).setY(C.y + 0.1), 1.3, { sound: true, ring: true });
        ctx.vfx.burst('spray', tB.copy(C).setY(C.y + 1.2), { count: 14, speed: 3.5, spread: 1 });
      }
      this.rise = Math.max(0, 1 - this.collapseT / 0.5);
    } else {
      this.rise = Math.min(1, this.rise + dt / 0.45);
    }
    const r = easeOut(this.rise);
    // Shell: rises out of the pool, swirls, breathes.
    this.shell.position.copy(C);
    this.shell.rotation.y += dt * 0.7;
    const breathe = 1 + 0.025 * Math.sin(this.t * 3.1);
    this.shell.scale.set(breathe * (1.05 - 0.05 * r), Math.max(0.02, r), breathe * (1.05 - 0.05 * r));
    this.shellMat.uniforms.uOpacity.value = 0.3 * r;
    this.shell.visible = r > 0.01;
    // Pool at the base.
    const g = ctx.world.groundAt(C.x, C.z, C.y + 1).y;
    this.pool.position.set(C.x, g + 0.03, C.z);
    this.pool.scale.setScalar(0.4 + 1.0 * Math.max(r, this.done ? 1 - this.collapseT : 0));
    this.poolMat.uniforms.uOpacity.value = 0.7 * (this.done ? Math.max(0, 1 - this.collapseT / 1.2) : r);
    // Feed: the water streaming in from its source during the first moments.
    if (this.feed) {
      const ft = this.t;
      if (ft > 0.6 || this.done) {
        this.feed.dispose();
        this.feed = null;
      } else {
        const p = this.feed.pts;
        p[0].copy(this.feedFrom);
        aX.copy(C).setY(C.y + 0.25);
        const d = this.feedFrom.distanceTo(aX);
        for (let k = 1; k < 5; k++) {
          const u = k / 5;
          p[k].lerpVectors(this.feedFrom, aX, u).addScaledVector(UPV, Math.sin(Math.PI * u) * (0.35 + d * 0.18));
        }
        p[5].copy(aX);
        this.feed.head = Math.min(1, ft / 0.25);
        this.feed.tail = Math.max(0, (ft - 0.3) / 0.3);
        this.feed.build(6);
      }
    }
    // Tentacles.
    for (const a of this.arms) this.updateArm(a, dt, C);
    if (this.done) return this.collapseT < 1.3;
    return true;
  }

  private updateArm(a: Arm, dt: number, C: THREE.Vector3): void {
    const cast = this.cast;
    const c = cast.caster;
    const ctx = cast.ctx;
    const t = this.t;
    // Emerge after the shell has risen; draw back in when the form ends.
    if (this.done) a.grow = Math.max(0, a.grow - dt / 0.35);
    else if (t > a.delay) a.grow = Math.min(1, a.grow + dt / 0.35);
    if (a.grow <= 0.001) {
      a.body.hide();
      a.tip.copy(C).setY(C.y + a.h);
      return;
    }
    const azw = c.yaw + a.az + 0.14 * Math.sin(t * 0.7 + a.phase);
    const dir = aD.set(Math.sin(azw), 0, Math.cos(azw));
    const B = aB.copy(C).addScaledVector(dir, 0.5).setY(C.y + a.h);
    // Rest pose: reaching out and up, swaying.
    const sway = 0.22 * Math.sin(t * 0.9 + a.phase * 1.7);
    const swayDir = aR.set(Math.sin(azw + sway), 0, Math.cos(azw + sway));
    const rest = aW.copy(C).addScaledVector(swayDir, 0.5 + a.len).setY(C.y + a.h + 0.12 + 0.32 * Math.sin(t * 1.3 + a.phase));
    let curlTo = 1;
    let straight = 0;
    switch (a.mode) {
      case 'idle': {
        const k = 1 - Math.exp(-dt * 6);
        a.tip.lerp(rest, k);
        break;
      }
      case 'wind': {
        a.t += dt;
        if (a.t < 0) {
          a.tip.lerp(rest, 1 - Math.exp(-dt * 6));
          a.from.copy(a.tip);
          break;
        }
        // Cocked up and back, away from the target.
        if (a.target?.alive) a.target.aimPoint(a.aim);
        aT.subVectors(a.aim, B).setY(0).normalize();
        aX.copy(B).addScaledVector(UPV, 1.15).addScaledVector(dir, 0.35).addScaledVector(aT, -0.35);
        const k = Math.min(1, a.t / 0.12);
        a.tip.lerpVectors(a.from, aX, easeOut(k));
        curlTo = 0.5;
        if (k >= 1) {
          a.mode = 'strike';
          a.t = 0;
          a.from.copy(a.tip);
          ctx.audio.play('water_whip', { position: a.tip, volume: 0.42, pitch: 1.1 + Math.random() * 0.25 });
        }
        break;
      }
      case 'strike': {
        a.t += dt;
        if (a.target?.alive) a.target.aimPoint(a.aim);
        const k = Math.min(1, a.t / 0.13);
        a.tip.lerpVectors(a.from, a.aim, k * k);
        curlTo = 0;
        straight = 1;
        if (k > 0.3) this.fx.shed(a.tip, tB.subVectors(a.aim, a.from).multiplyScalar(4), 1, 1.4);
        if (k >= 1) {
          this.land(a);
          // Hold the lash out for a beat so the blow reads.
          a.mode = 'recover';
          a.t = -0.07;
          a.from.copy(a.tip);
        }
        break;
      }
      case 'recover': {
        a.t += dt;
        const k = Math.max(0, Math.min(1, a.t / 0.3));
        a.tip.lerpVectors(a.from, rest, easeInOut(k));
        curlTo = 0.6;
        if (k >= 1) a.mode = 'idle';
        break;
      }
      case 'swat': {
        a.t += dt;
        const p = a.proj;
        if (!p || !p.alive || a.t > 0.8 || p.position.distanceTo(C) > SWAT_RANGE + 1.2) {
          a.mode = 'recover';
          a.t = 0;
          a.from.copy(a.tip);
          a.proj = null;
          break;
        }
        // The tip chases the blast (a little ahead of it) and slaps it down.
        aX.copy(p.position).addScaledVector(p.velocity, 0.03);
        a.tip.lerp(aX, 1 - Math.exp(-dt * 28));
        curlTo = 0.1;
        straight = 0.7;
        if (a.tip.distanceTo(p.position) < 0.5 + p.spec.radius) {
          p.kill();
          this.stats.swats++;
          this.fx.splash(p.position, 0.75, { sound: true });
          ctx.vfx.burst('spray', p.position, { count: 10, speed: 4, spread: 1 });
          if (p.cast.def.element === 'water') returnToReserve(cast, 2);
          if (p.cast.def.element === 'fire') ctx.vfx.burst('dust', p.position, { count: 4, color: '#dfe8ee', speed: 1.2 });
          a.mode = 'recover';
          a.t = 0;
          a.from.copy(a.tip);
          a.proj = null;
        }
        break;
      }
    }
    // Never stretch past what the water can reach.
    aX.subVectors(a.tip, B);
    const maxL = a.len * 1.55 + 0.6;
    if (aX.length() > maxL) a.tip.copy(B).addScaledVector(aX.normalize(), maxL);
    a.curl += (curlTo - a.curl) * (1 - Math.exp(-dt * 8));
    // Shape: base leaves the shell outward and up; the arm arches over and curls at the tip.
    const grow = easeOut(a.grow);
    aT.copy(B).lerp(a.tip, grow);
    const L = Math.max(0.2, aT.distanceTo(B));
    aX.copy(dir).multiplyScalar(0.9).addScaledVector(UPV, 0.43);
    aP1.copy(B).addScaledVector(aX, L * 0.42);
    // Arriving at the tip: reaching out and a little down (rest) or straight along the lash.
    aDir.copy(swayDir).multiplyScalar(0.85).addScaledVector(UPV, -0.5).normalize();
    tB.subVectors(aT, B).normalize();
    aDir.lerp(tB, straight).normalize();
    aP2.copy(aT).addScaledVector(aDir, -L * 0.36);
    const pts = a.body.pts;
    const axis = aR.crossVectors(aDir, UPV);
    if (axis.lengthSq() < 1e-6) axis.set(1, 0, 0);
    axis.normalize();
    const k0 = Math.floor((SEG - 1) * 0.68);
    for (let k = 0; k < SEG; k++) {
      const u = k / (SEG - 1);
      const iu = 1 - u;
      pts[k]
        .copy(B)
        .multiplyScalar(iu * iu * iu)
        .addScaledVector(aP1, 3 * iu * iu * u)
        .addScaledVector(aP2, 3 * iu * u * u)
        .addScaledVector(aT, u * u * u);
    }
    // Curl the last stretch around itself, up and in.
    if (a.curl > 0.02) {
      const pivot = aW.copy(pts[k0]);
      for (let k = k0 + 1; k < SEG; k++) {
        const u = (k - k0) / (SEG - 1 - k0);
        aQ.setFromAxisAngle(axis, a.curl * 1.75 * Math.pow(u, 1.4));
        pts[k].sub(pivot).applyQuaternion(aQ).add(pivot);
      }
    }
    // A wave running down the arm (weaker while it lashes).
    const amp = 0.1 * (1 - 0.7 * straight) * grow;
    for (let k = 1; k < SEG; k++) {
      const u = k / (SEG - 1);
      pts[k].addScaledVector(axis, amp * Math.sin(u * 6.5 - t * 4.6 + a.phase) * u);
    }
    a.body.radius = 0.19 * (0.55 + 0.45 * grow);
    a.body.build(SEG);
  }

  /** A lash arrives: hit the target if the tip really reached it. */
  private land(a: Arm): void {
    const cast = this.cast;
    const ctx = cast.ctx;
    const c = cast.caster;
    this.fx.splash(a.tip, 0.65, { sound: false });
    ctx.audio.play('water_impact', { position: a.tip, volume: 0.5, pitch: 1.15 });
    const e = a.target;
    a.target = null;
    if (!e || !e.alive || !ctx.combat.canHarm(c, e)) return;
    e.aimPoint(tB);
    if (tB.distanceTo(a.tip) > 1.0 || e.position.distanceTo(c.position) > OCTOPUS_REACH + 0.8) return;
    const away = tB.subVectors(e.position, c.position).setY(0);
    if (away.lengthSq() < 1e-4) away.set(Math.sin(c.yaw), 0, Math.cos(c.yaw));
    away.normalize().multiplyScalar(6.5);
    const res = cast.hit(e, { damage: 9, knockback: away.clone(), launch: 1.2, stagger: 38, status: [{ type: 'soaked', duration: 4 }], point: a.tip.clone() }, true);
    if (res) {
      this.stats.landed++;
      douse(cast, e);
    }
  }

  trace(): Record<string, unknown> {
    return {
      kind: this.kind,
      formed: this.formed,
      arms: this.arms.map((a) => ({ mode: a.mode, tip: [+a.tip.x.toFixed(2), +a.tip.y.toFixed(2), +a.tip.z.toFixed(2)], grow: +a.grow.toFixed(2) })),
      ...this.stats,
    };
  }

  dispose(): void {
    for (const a of this.arms) a.body.dispose();
    this.feed?.dispose();
    this.feed = null;
    this.shell.removeFromParent();
    this.pool.removeFromParent();
    this.shellMat.dispose();
    this.poolMat.dispose();
  }
}

// ---------------------------------------------------------------------------
// Technique
// ---------------------------------------------------------------------------

const projBuf: Projectile[] = [];
const fC = new THREE.Vector3();
const fD = new THREE.Vector3();

/** Automation: window.__game.debug.octopus.state() (the player's form). */
let lastForm: OctopusForm | null = null;
function installDebug(ctx: GameContext): void {
  const g = (globalThis as { __game?: { debug?: Record<string, unknown> } }).__game;
  if (!g?.debug || g.debug.octopus) return;
  g.debug.octopus = {
    state: () => (lastForm ? lastForm.trace() : null),
    active: () => !!lastForm && !(lastForm as OctopusForm).done,
  };
  void ctx;
}

function slotAction(ctx: GameContext, id: string): Action | null {
  const i = ctx.progression.slotsFor('water').indexOf(id);
  return i >= 0 ? (['ability1', 'ability2', 'ability3', 'ability4'] as Action[])[i] : null;
}

/** Best foe for a player-ordered lash: the locked target, else the nearest one in front. */
function lashTarget(cast: Cast): Entity | null {
  const ctx = cast.ctx;
  const c = cast.caster;
  const p = ctx.player;
  if (p && c === p && p.lockTarget?.alive && ctx.combat.canHarm(c, p.lockTarget) && p.lockTarget.position.distanceTo(c.position) < OCTOPUS_REACH + 1.2) return p.lockTarget;
  const fwd = fD.set(Math.sin(c.yaw), 0, Math.cos(c.yaw));
  let best: Entity | null = null;
  let bestS = -Infinity;
  for (const e of ctx.entities.queryRadius(c.position, OCTOPUS_REACH + 0.8)) {
    if (e === c || !e.alive || !ctx.combat.canHarm(c, e)) continue;
    fC.subVectors(e.position, c.position).setY(0);
    const d = fC.length();
    const facing = d > 0.01 ? fC.dot(fwd) / d : 1;
    const s = facing * 2 - d * 0.3;
    if (s > bestS) {
      bestS = s;
      best = e;
    }
  }
  return best;
}

registerTechnique({
  id: 'octopus_form',
  name: 'Octopus Form',
  element: 'water',
  kind: 'defense',
  tier: 3,
  description:
    'Master Pakku\'s form: water rises around you into a shell and eight tentacles grow out of it. Blasts that come at you are caught and swatted down by the tentacle that reaches them, anyone who steps within reach is lashed, and you can walk slowly inside your fortress of water.',
  usage: `Defensive technique (slot). Needs water. Lasts ${FORM_TIME} s: incoming blasts are swatted (the shell stops whatever slips past), foes within ${OCTOPUS_REACH} m are lashed. Attack: a double lash at your target. Press the technique again to let the water fall.`,
  icon: 'water',
  chiCost: 28,
  cooldown: 10,
  water: { amount: 30 },
  windup: 0.35,
  recovery: 0.3,
  movement: 'slow',
  airborne: false,
  channel: FORM_TIME,
  // A stance, not a gesture: blows do not break it.
  interruptible: false,
  range: OCTOPUS_REACH,
  begin(cast) {
    installDebug(cast.ctx);
    anim(cast.caster, 'circle_arms', { speed: 1.1, fadeIn: 0.05 });
    const form = fxOf(cast).add(new OctopusForm(cast));
    cast.data.form = form;
    if (cast.isPlayer) lastForm = form;
    cast.ctx.audio.play('water_gather', { position: cast.caster.position, volume: 0.8 });
  },
  release(cast) {
    cast.data.released = true;
    cast.data.loop = cast.ctx.audio.loop('water_swirl', { position: cast.caster.position, volume: 0.55 });
    cast.data.cd = new Map<number, number>();
    cast.data.orderCd = 0;
    anim(cast.caster, 'octopus_stance', { fadeIn: 0.2 });
    if (cast.isPlayer) {
      const a = slotAction(cast.ctx, 'octopus_form');
      if (a) cast.ctx.input.consume(a);
    }
  },
  channelUpdate(cast, dt) {
    const ctx = cast.ctx;
    const c = cast.caster as Combatant;
    const form = cast.data.form as OctopusForm;
    if (!c.alive) return false;
    // A stance: blows land but cannot stagger the bender out of it.
    if (c.health) c.health.poise = 9999;
    (cast.data.loop as LoopHandle | undefined)?.setPosition(c.position);
    const center = fC.copy(c.position).setY(c.position.y + 1.1);
    // Incoming blasts: a tentacle goes for each; the shell stops what slips past.
    for (const p of ctx.combat.projectilesInRadius(center, SWAT_RANGE, projBuf)) {
      const owner = p.cast.caster;
      if (owner === c || !ctx.combat.canHarm(owner, c)) continue;
      const d = p.position.distanceTo(center);
      if (d < SHELL_CATCH) {
        p.kill();
        form.shellCatch(p.position);
        if (p.cast.def.element === 'water') returnToReserve(cast, 2);
        continue;
      }
      if (form.tracks(p)) continue;
      // Only what is coming this way.
      fD.subVectors(center, p.position);
      if (fD.dot(p.velocity) <= 0) continue;
      form.swat(p);
    }
    // Foes within reach get lashed (each at most every 0.85 s; two lashes in the air at once).
    const cd = cast.data.cd as Map<number, number>;
    const now = ctx.time.elapsed;
    for (const e of ctx.entities.queryRadius(c.position, OCTOPUS_REACH)) {
      if (e === c || !e.alive || !ctx.combat.canHarm(c, e)) continue;
      if ((cd.get(e.id) ?? 0) > now || form.busyStrikes >= 2) continue;
      if (form.strike(e, e.aimPoint(fD))) cd.set(e.id, now + 0.85);
    }
    // Player: Attack orders a double lash; pressing the form again lets the water fall.
    if (cast.isPlayer) {
      cast.data.orderCd = Math.max(0, (cast.data.orderCd as number) - dt);
      if (ctx.input.wasPressed('attack') && (cast.data.orderCd as number) <= 0) {
        ctx.input.consume('attack');
        cast.data.orderCd = 0.35;
        const e = lashTarget(cast);
        if (e) {
          e.aimPoint(fD);
          form.strike(e, fD);
          form.strike(e, fD, 0.06);
          cd.set(e.id, now + 0.85);
        } else {
          fD.set(Math.sin(c.yaw), 0, Math.cos(c.yaw)).multiplyScalar(OCTOPUS_REACH).add(c.position).setY(c.position.y + 0.3);
          form.strike(null, fD);
        }
      }
      const a = slotAction(ctx, 'octopus_form');
      if (a && ctx.input.wasPressed(a)) {
        ctx.input.consume(a);
        // Let go now: the water starts falling while the bender recovers.
        form.done = true;
        return false;
      }
    }
    return true;
  },
  end(cast, interrupted) {
    const form = cast.data.form as OctopusForm | undefined;
    if (form) form.done = true;
    (cast.data.loop as LoopHandle | undefined)?.stop(0.3);
    stopAnim(cast.caster, 'octopus_stance', 0.25);
    const hp = cast.caster.health;
    if (hp) hp.poise = Math.min(hp.poise, hp.maxPoise);
    if (!cast.data.released) {
      if (interrupted) refundWater(cast);
      return;
    }
    if (cast.data.waterDone) return;
    cast.data.waterDone = true;
    const c = cast.caster;
    const back = returnToReserve(cast, cast.water.amount * 0.5);
    const g = cast.ctx.world.groundAt(c.position.x, c.position.z, c.position.y + 1);
    spill(cast, tA.set(c.position.x, g.y, c.position.z), cast.water.amount - back);
  },
  aiScore: (_c, _t, dist) => (dist < 6 ? 0.35 : 0.05),
});
