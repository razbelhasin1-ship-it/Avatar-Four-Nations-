import * as THREE from 'three';
import type { Entity, HitInfo, HitResult } from '../../../entities/Entity';
import { registerTechnique } from '../../CombatSystem';
import { clamp01, easeIn, easeInOut, easeOut, PathSampler } from '../../water/Curve';
import { capTaper } from '../../water/FlowTube';
import { StreamBody, type WaterEffect, type WaterFX } from '../../water/WaterFX';
import type { Cast } from '../../types';
import { basis, contactsAlongPath, douse, fxOf, handPos, refundWater, returnToReserve, shake, spill, UP, type HandName, type PathContact } from './shared';

/**
 * Water whip: the core of moment-to-moment waterbending.
 *
 * The water visibly travels source → hand → whip: during the windup a feed
 * stream rises from the real source (or peels off the orbiting reserve) into
 * the hand; on release the feed detaches and the whip lashes along a swing
 * arc. The SAME control points pose the whip mesh and drive the swept capsule
 * hit test (sub-stepped so fast swings cannot tunnel through targets).
 */

export type WhipStyle = 'right' | 'left' | 'overhead' | 'freeze';

export interface WhipOptions {
  style: WhipStyle;
  hand: HandName;
  range: number;
  /** Seconds for the tip to sweep the arc. */
  swing: number;
  /** Delay between cast release and the start of the swing. */
  delay?: number;
  radius: number;
  damage: number;
  knockback: number;
  stagger: number;
  launch?: number;
  knockdown?: boolean;
  stun?: number;
  status?: HitInfo['status'];
  /** 0 water .. 1 ice look. */
  ice: number;
  /** Fraction of the water that snaps back into the reserve afterwards. */
  returnFrac: number;
  onHit?(e: Entity, point: THREE.Vector3, cast: Cast, res: HitResult): void;
  /** Called once when the swing completes (tip position). */
  onFinish?(tip: THREE.Vector3, cast: Cast): void;
}

/** Points on the whip curve (enough to carry the travelling ripple). */
const WHIP_PTS = 9;
const tA = new THREE.Vector3();
const tB = new THREE.Vector3();
const tC = new THREE.Vector3();
const tD = new THREE.Vector3();

export class WhipEffect implements WaterEffect {
  readonly kind = 'whip';
  castId: number;
  private readonly fx: WaterFX;
  private readonly feed: StreamBody;
  private readonly whip: StreamBody;
  readonly origin = new THREE.Vector3();
  private readonly f = new THREE.Vector3();
  private readonly r = new THREE.Vector3();
  private readonly pivot = new THREE.Vector3();
  private readonly hand = new THREE.Vector3();
  readonly tip = new THREE.Vector3();
  private readonly prevTip = new THREE.Vector3();
  private tipInit = false;
  private t = 0;
  private relT = -1;
  private aborted = false;
  private abortT = 0;
  private finished = false;
  private collapseT = 0;
  private prevP = 0;
  private elev = 0;
  private targetDist: number;
  private readonly contacts: PathContact[] = [];
  private readonly scratchPath = new PathSampler();
  private readonly scratchPts = Array.from({ length: WHIP_PTS }, () => new THREE.Vector3());
  private readonly ctrl = [new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3()];
  private readonly ctrlPath = new PathSampler();
  private lastSamples: number[][] = [];
  private hitThisFrame: number[] = [];
  readonly hits: Array<{ id: number; frame: number; point: number[] }> = [];
  private gone = false;

  constructor(readonly cast: Cast, readonly o: WhipOptions) {
    this.fx = fxOf(cast);
    this.castId = cast.id;
    basis(cast.aimDir, this.f, this.r);
    const h = handPos(cast.caster, o.hand, this.hand);
    this.fx.originFor(cast, h, this.origin);
    const feedLen = this.origin.distanceTo(h);
    const look = { ice: o.ice, flow: 8, foam: 1 };
    this.feed = new StreamBody(this.fx, look, feedLen > 9 ? 1.4 : 1, 3);
    this.feed.radius = o.radius * 0.9;
    this.feed.wobble = 0.05;
    this.whip = new StreamBody(this.fx, look, 1.2, WHIP_PTS);
    this.whip.radius = o.radius;
    this.whip.wobble = 0.03;
    this.elev = Math.max(-0.55, Math.min(0.55, Math.asin(Math.max(-1, Math.min(1, cast.aimDir.y)))));
    const chest = handPos(cast.caster, 'chest', tA);
    this.targetDist = Math.max(3.5, Math.min(o.range, Math.hypot(cast.aimPoint.x - chest.x, cast.aimPoint.z - chest.z)));
    this.fx.logCast(cast, this.origin);
    if (cast.water.from) {
      this.fx.splash(this.origin, 0.55, { ice: cast.water.frozen, sound: false });
      cast.ctx.audio.play(cast.water.frozen ? 'ice_form' : 'water_gather', { position: this.origin, volume: 0.5, pitch: 1.3 });
    }
  }

  /** Cast released: start the swing (after an optional delay). */
  release(): void {
    if (this.relT < 0 && !this.aborted) this.relT = this.t + (this.o.delay ?? 0);
  }

  /** Cast interrupted before release: the water falls back. */
  abort(): void {
    if (this.relT >= 0 || this.aborted) return;
    this.aborted = true;
    this.abortT = 0;
    this.fx.droplets(this.feed.path, 0, this.feed.path.length * this.feed.head, 6, this.o.ice > 0.5);
    refundWater(this.cast);
  }

  /** Tip position for swing progress p (0..1). Writes control points c1, c2 into a/b. */
  private pose(p: number, tip: THREE.Vector3, c1: THREE.Vector3, c2: THREE.Vector3): void {
    const o = this.o;
    const f = this.f, r = this.r;
    const piv = this.pivot;
    const e = easeInOut(p);
    if (o.style === 'overhead') {
      const R = this.targetDist;
      const phiT = Math.atan2(-1.25 - 0.4, R); // aim down at the ground in front
      const phi0 = 1.85, phi1 = phiT - 0.08;
      const phi = phi0 + (phi1 - phi0) * e;
      const rho = 1.3 + (R - 1.3) * easeOut(Math.min(1, p / 0.62));
      const dirV = (a: number, out: THREE.Vector3) => out.copy(f).multiplyScalar(Math.cos(a)).addScaledVector(UP, Math.sin(a));
      tip.copy(piv).addScaledVector(dirV(phi, tC), rho);
      const lag = 0.25 + 0.75 * Math.sin(Math.PI * Math.min(1, p));
      c1.copy(piv).addScaledVector(dirV(phi + 0.6 * lag, tC), rho * 0.38);
      c2.copy(piv).addScaledVector(dirV(phi + 0.32 * lag, tC), rho * 0.7);
      return;
    }
    let th0: number, th1: number;
    if (o.style === 'left') {
      th0 = -1.25;
      th1 = 0.55;
    } else if (o.style === 'freeze') {
      th0 = 0.85;
      th1 = -0.3;
    } else {
      th0 = 1.25;
      th1 = -0.55;
    }
    const th = th0 + (th1 - th0) * e;
    const R = o.range;
    const rho = 1.2 + (R - 1.2) * easeOut(Math.min(1, p / 0.55));
    const el = this.elev * clamp01(p * 1.6);
    const bump = 0.3 * Math.sin(Math.PI * p);
    const dirH = (a: number, out: THREE.Vector3) => out.copy(f).multiplyScalar(Math.cos(a)).addScaledVector(r, Math.sin(a));
    const ce = Math.cos(el), se = Math.sin(el);
    tip.copy(piv).addScaledVector(dirH(th, tC), rho * ce).addScaledVector(UP, rho * se + bump);
    const lagSign = Math.sign(th0 - th1);
    const lag = (0.2 + 0.8 * Math.sin(Math.PI * Math.min(1, p))) * lagSign;
    c1.copy(piv).addScaledVector(dirH(th + 0.62 * lag, tC), rho * 0.4 * ce).addScaledVector(UP, rho * 0.4 * se + bump * 0.6);
    c2.copy(piv).addScaledVector(dirH(th + 0.34 * lag, tC), rho * 0.72 * ce).addScaledVector(UP, rho * 0.72 * se + bump * 0.9);
  }

  /**
   * The whip curve for swing progress p: the swept arc (hand → two lagging control points →
   * tip), resampled and rippled by a wave that runs from the hand to the tip, so it lashes
   * like a whip instead of sweeping like a rod. Hit tests use this exact curve.
   */
  private buildWhipPath(p: number, path: PathSampler, pts: THREE.Vector3[]): void {
    const c = this.ctrl;
    c[0].copy(this.hand);
    this.pose(p, c[3], c[1], c[2]);
    this.ctrlPath.set(c, 4);
    const L = this.ctrlPath.length;
    const amp = (this.o.style === 'overhead' ? 0.22 : 0.34) * Math.sin(Math.PI * Math.min(1, p)) * Math.min(1, L / 4);
    for (let i = 0; i < WHIP_PTS; i++) {
      const u = i / (WHIP_PTS - 1);
      this.ctrlPath.at(u * L, pts[i]);
      if (i === 0 || i === WHIP_PTS - 1) continue;
      // Ripple across the swing plane: mostly vertical for side lashes, sideways for the slam.
      const w = amp * Math.sin(Math.PI * u) * Math.sin(u * 7.5 - p * 14);
      if (this.o.style === 'overhead') pts[i].addScaledVector(this.r, w);
      else pts[i].addScaledVector(UP, w);
    }
    path.set(pts, WHIP_PTS);
  }

  update(dt: number): boolean {
    if (this.gone) return false;
    this.t += dt;
    const cast = this.cast;
    const caster = cast.caster;
    const o = this.o;
    handPos(caster, o.hand, this.hand);
    handPos(caster, 'chest', this.pivot);
    this.hitThisFrame = [];
    this.lastSamples = [];

    // ---- Feed stream: origin → hand -------------------------------------------
    const fp = this.feed.pts;
    fp[0].copy(this.origin);
    const d = this.origin.distanceTo(this.hand);
    fp[1].lerpVectors(this.origin, this.hand, 0.5).addScaledVector(UP, 0.22 * d + 0.5);
    fp[2].copy(this.hand);
    const windup = Math.max(0.05, cast.def.windup);
    if (this.aborted) {
      this.abortT += dt;
      for (const q of fp) q.y -= 14 * this.abortT * this.abortT;
      this.feed.radius *= Math.max(0, 1 - dt * 6);
      this.feed.build(3);
      this.whip.hide();
      return this.abortT < 0.35;
    }
    if (this.relT < 0 || this.t < this.relT) {
      // Gathering: head races from the source to the hand during the windup.
      this.feed.tail = 0;
      this.feed.head = easeOut(this.t / (windup * 0.9));
      this.feed.profile = (u) => capTaper(u, 0.08, 0.1) * (0.8 + 0.2 * u);
      this.feed.build(3);
      this.whip.hide();
      if (this.t > windup + 1.5 && this.relT < 0) {
        // Never released and never aborted (cast cleared): fade away.
        this.abort();
      }
      return true;
    }
    // ---- Swing -------------------------------------------------------------------
    const st = this.t - this.relT;
    const p = clamp01(st / o.swing);
    // Feed detaches: tail runs up into the hand.
    this.feed.head = 1;
    this.feed.tail = easeIn(Math.min(1, st / (o.swing * 0.7)));
    this.feed.profile = (u) => capTaper(u, 0.12, 0.02);
    if (this.feed.tail < 0.995) this.feed.build(3);
    else this.feed.hide();

    if (!this.finished) {
      // Swept hit test: sub-step from the previous swing progress to now.
      const dp = p - this.prevP;
      const steps = Math.max(1, Math.min(8, Math.ceil(dp / 0.06)));
      for (let k = 1; k <= steps; k++) {
        const pk = this.prevP + (dp * k) / steps;
        this.buildWhipPath(pk, this.scratchPath, this.scratchPts);
        const L = this.scratchPath.length;
        contactsAlongPath(cast, this.scratchPath, L * 0.3, L, o.radius + 0.28, this.contacts, k === steps ? this.lastSamples : undefined);
        for (const c of this.contacts) this.applyHit(c);
      }
      this.prevP = p;
    }
    this.buildWhipPath(p, this.whip.path, this.whip.pts);
    this.tip.copy(this.whip.pts[WHIP_PTS - 1]);
    // Drops fly off the whipping tip.
    if (this.tipInit && dt > 0 && o.ice < 0.5) {
      tD.subVectors(this.tip, this.prevTip).multiplyScalar(1 / dt);
      if (!this.finished && Math.random() < dt * 45) this.fx.shed(this.tip, tD, 2, 1.4);
    }
    this.prevTip.copy(this.tip);
    this.tipInit = true;
    if (p >= 1 && !this.finished) {
      this.finished = true;
      this.collapseT = 0;
      // The crack at full stretch: water snaps off the tip.
      if (o.ice < 0.5) this.fx.crown(this.tip, o.style === 'overhead' ? 0.8 : 0.5, tD.copy(this.f));
      o.onFinish?.(this.tip.clone(), cast);
    }
    // ---- Collapse / snap back -------------------------------------------------
    let head = 1;
    let radiusMul = 1;
    if (this.finished) {
      this.collapseT += dt;
      // Snaps back visibly (the water is pulled home), the slam spreads out.
      const c = clamp01(this.collapseT / (o.style === 'overhead' ? 0.26 : 0.34));
      if (o.style === 'overhead') {
        radiusMul = 1 - c;
      } else {
        head = 1 - easeIn(c) * 0.95;
        radiusMul = 1 - 0.4 * c;
      }
      if (c >= 1) {
        this.endWater();
        return false;
      }
    }
    const pinch = o.style === 'overhead' ? 1.1 : 1.25;
    this.whip.tail = 0;
    this.whip.head = head;
    const R = o.radius * radiusMul;
    this.whip.profile = (u) => (0.7 + 0.3 * u + (pinch - 1) * Math.max(0, (u - 0.75) / 0.25)) * capTaper(u, 0.02, 0.07) * (R / o.radius);
    this.whip.build(WHIP_PTS);
    return true;
  }

  private applyHit(c: PathContact): void {
    const cast = this.cast;
    const o = this.o;
    const kb = tD.copy(c.point).sub(this.pivot).setY(0);
    if (kb.lengthSq() < 1e-4) kb.copy(this.f);
    kb.normalize().multiplyScalar(o.knockback);
    const res = cast.hit(c.e, {
      damage: o.damage,
      knockback: kb.clone(),
      launch: o.launch,
      stagger: o.stagger,
      stun: o.stun,
      knockdown: o.knockdown,
      status: o.status ?? [{ type: 'soaked', duration: 6 }],
      point: c.point.clone(),
    });
    if (!res) return;
    this.hitThisFrame.push(c.e.id);
    this.hits.push({ id: c.e.id, frame: cast.ctx.time.frame, point: c.point.toArray() });
    douse(cast, c.e);
    this.fx.splash(c.point, o.style === 'overhead' ? 1.1 : 0.75, { ice: o.ice > 0.5, volume: 0.6 });
    o.onHit?.(c.e, c.point, cast, res);
  }

  private endWater(): void {
    const cast = this.cast;
    const amount = cast.water.amount;
    const back = returnToReserve(cast, amount * this.o.returnFrac);
    const fallen = amount - back;
    // The rest falls: droplets along the whip, a splash where it lands.
    this.fx.droplets(this.whip.path, this.whip.path.length * 0.4, this.whip.path.length, 5, this.o.ice > 0.5);
    const g = cast.ctx.world.groundAt(this.tip.x, this.tip.z, this.tip.y + 1);
    tB.set(this.tip.x, g.y + 0.05, this.tip.z);
    if (this.o.style !== 'overhead' && this.tip.y - g.y < 2.5) this.fx.splash(tB, 0.45, { sound: false, ring: false });
    spill(cast, tB, fallen);
  }

  trace(): Record<string, unknown> {
    const phase = this.aborted ? 'aborted' : this.relT < 0 || this.t < this.relT ? 'gather' : this.finished ? 'collapse' : 'swing';
    return {
      phase,
      start: this.origin.toArray(),
      feedStart: this.feed.path.length > 0 ? this.feed.path.at(this.feed.path.length * this.feed.tail, tA).toArray() : null,
      hand: this.hand.toArray(),
      tip: this.tip.toArray(),
      samples: this.lastSamples,
      hitRadius: this.o.radius + 0.28,
      hitIds: this.hitThisFrame,
    };
  }

  dispose(): void {
    this.gone = true;
    this.feed.dispose();
    this.whip.dispose();
  }
}

// ---------------------------------------------------------------------------
// Water Whip — 3-step basic combo
// ---------------------------------------------------------------------------

const STEPS: Array<Pick<WhipOptions, 'style' | 'hand' | 'range' | 'swing' | 'radius' | 'damage' | 'knockback' | 'stagger' | 'launch' | 'delay'> & { clip: string }> = [
  { style: 'right', hand: 'handR', range: 9.5, swing: 0.26, radius: 0.28, damage: 8, knockback: 4, stagger: 12, clip: 'water_whip_r' },
  { style: 'left', hand: 'handL', range: 9.5, swing: 0.26, radius: 0.29, damage: 9, knockback: 5, stagger: 14, clip: 'water_whip_l' },
  { style: 'overhead', hand: 'hands', range: 10.5, swing: 0.3, radius: 0.37, damage: 15, knockback: 8, stagger: 30, launch: 3, delay: 0.06, clip: 'water_whip_slam' },
];

registerTechnique({
  id: 'water_whip',
  name: 'Water Whip',
  element: 'water',
  kind: 'basic',
  tier: 1,
  description:
    'Pull a ribbon of water from a river, the sea or a pond — or peel it off the water orbiting you — and lash it at foes. A flowing three-step combo; the third strike cracks down from overhead. Part of the water snaps back to you after each lash.',
  usage: 'Primary attack. Chain up to three lashes. Needs real water nearby or in your reserve.',
  icon: 'water',
  chiCost: 4,
  cooldown: 0,
  water: { amount: 4 },
  windup: 0.13,
  recovery: 0.24,
  movement: 'free',
  airborne: true,
  interruptible: false,
  range: 10,
  starter: true,
  comboLength: 3,
  begin(cast) {
    const step = STEPS[cast.comboIndex % 3];
    cast.caster.humanoid?.animator.play(step.clip, { speed: step.style === 'overhead' ? 1.15 : 1.1, fadeIn: 0.05 });
    const fx = fxOf(cast);
    cast.data.whip = fx.add(
      new WhipEffect(cast, {
        ...step,
        ice: cast.water.frozen ? 0.35 : 0,
        returnFrac: 0.4,
        status: [{ type: 'soaked', duration: 6 }],
        onFinish:
          step.style === 'overhead'
            ? (tip, c) => {
                // The crack lands: a splash burst that hits around the impact point.
                const g = c.ctx.world.groundAt(tip.x, tip.z, tip.y + 1.5);
                const at = tC.set(tip.x, Math.max(g.y + 0.3, Math.min(tip.y, g.y + 1.2)), tip.z);
                c.areaHit({ center: at.clone(), radius: 1.9, height: 1.6, damage: 5, knockback: 6, knockDir: 'radial', stagger: 15, status: [{ type: 'soaked', duration: 6 }] });
                fxOf(c).splash(tA.set(tip.x, g.y + 0.1, tip.z), 1.5, { volume: 0.8 });
                c.ctx.world.fx.wet(tA, 2.2);
                c.ctx.world.fx.disturb(tA, 3, 0.6);
                shake(c, 0.16, 0.18);
              }
            : undefined,
      }),
    );
  },
  release(cast) {
    const step = STEPS[cast.comboIndex % 3];
    (cast.data.whip as WhipEffect | undefined)?.release();
    const h = handPos(cast.caster, step.hand, tA);
    cast.ctx.audio.play('water_whip', { position: h, volume: 0.75, pitch: 1.05 - cast.comboIndex * 0.08 });
    if (cast.isPlayer) cast.ctx.events.emit('combo:advanced', { element: 'water', index: cast.comboIndex });
  },
  end(cast, interrupted) {
    if (interrupted) (cast.data.whip as WhipEffect | undefined)?.abort();
  },
  aiScore(_caster, _target, dist) {
    return dist < 9 ? 0.85 : dist < 12 ? 0.35 : 0;
  },
});
