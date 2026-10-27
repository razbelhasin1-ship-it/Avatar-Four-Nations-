import * as THREE from 'three';
import type { GameContext } from '../../core/GameContext';
import type { Entity } from '../../entities/Entity';
import type { Player } from '../Player';
import './clips';
import { aimRay, type PlayInteraction, type PlayKind } from './common';
import { PalmFlame } from './PalmFlame';
import { findLiftTarget, liftRock, type HeavyTarget, type LiftTarget } from './RockLift';
import { LooseStones } from './Stones';
import { findWaterTarget, ORB_UNITS, WaterOrb, type WaterTarget } from './WaterOrb';

/**
 * Playful bending while exploring (Water, Earth and Fire — never Air): hold the ordinary
 * attack to float a water orb drawn from the water you look at, lift the rock you look at
 * (or tear a stone out of the ground in front of you), or kindle a small flame in the right palm.
 *
 * Input contract (the existing attack is never weakened):
 *  - In combat — a locked or crosshair target, a hostile within reach, a fight a moment
 *    ago, a technique in progress — the attack fires on press exactly as before.
 *  - Exploring with something to play with in view (bendable water; a liftable rock or earth
 *    to tear one from; for fire just the open hand), the press is held back for HOLD_TIME:
 *    let go sooner and the normal attack fires at once on release; keep holding and the
 *    interaction starts.
 *  - It lasts while the attack stays held and ends on release; abilities, the heavy attack,
 *    dodging, an element switch, being hit, menus, mounting, defeat, travel and session end
 *    all end it. Released things finish on their own (the orb falls and splashes, the rock
 *    settles, the flame dies) — nothing is left floating or burning.
 */

/** Seconds the attack must be held before it becomes a play interaction. */
export const HOLD_TIME = 0.28;
/** Seconds after combat activity (own casts, being hit) before play may start. */
const COMBAT_COOLDOWN = 0.8;

type Pending =
  | { kind: 'water'; t: number; target: WaterTarget }
  | { kind: 'earth'; t: number; target: LiftTarget | HeavyTarget }
  | { kind: 'fire'; t: number; target: null };

const tO = new THREE.Vector3();
const tD = new THREE.Vector3();
const tA = new THREE.Vector3();
const near: Entity[] = [];

export class ElementPlay {
  private pending: Pending | null = null;
  private current: PlayInteraction | null = null;
  /** Counters for tests/debugging. */
  readonly stats = { taps: 0, started: 0, released: 0, cancelled: 0, refused: 0 };
  private lastEnd = '';
  /** Stones torn from the ground and set down: they stay and can be lifted again. */
  readonly stones: LooseStones;

  constructor(private readonly ctx: GameContext, private readonly player: Player) {
    this.stones = new LooseStones(ctx);
    const ev = ctx.events;
    const end = (): void => {
      this.stop('dispose');
      this.stones.clear();
    };
    ev.on('session:ending', end);
    ev.on('session:ended', end);
    ev.on('player:defeated', () => this.stop('cancel'));
    ev.on('player:damaged', (e) => {
      if (e.amount >= 2) this.stop('cancel');
    });
    ev.on('element:switched', () => this.stop('cancel'));
    ev.on('mount:changed', () => this.stop('cancel'));
    ev.on('session:started', () => this.installDebug());
    queueMicrotask(() => this.installDebug());
  }

  get active(): PlayKind | null {
    return this.current?.kind ?? null;
  }

  /** Movement speed multiplier while playing (1 otherwise). */
  get moveFactor(): number {
    return this.current?.moveFactor ?? 1;
  }

  /** The bender turns toward the aim while holding an orb or a rock. */
  get facesAim(): boolean {
    return !!this.current?.facesAim;
  }

  private kindFor(): PlayKind | null {
    const e = this.player.element;
    return e === 'water' || e === 'earth' || e === 'fire' ? e : null;
  }

  /** Exploring, not fighting: nothing targeted, nothing hostile close, no fight a moment ago. */
  inCombat(): boolean {
    const p = this.player;
    const ctx = this.ctx;
    if (p.lockTarget?.alive) return true;
    if (p.sinceCombat < COMBAT_COOLDOWN) return true;
    if (ctx.combat.isBusy(p) || p.charging > 0) return true;
    aimRay(ctx, p, tO, tD);
    for (const e of ctx.entities.queryRadius(p.position, 30, undefined, near)) {
      if (e === p || !e.alive || !ctx.combat.canHarm(p, e)) continue;
      if (e.team === 'hostile' && e.position.distanceTo(p.position) < 16) return true;
      // Anything you could hit right under the crosshair is a target, not scenery.
      const to = e.aimPoint(tA).sub(tO);
      const d = to.length();
      if (d < 30 && d > 0.01 && to.multiplyScalar(1 / d).angleTo(tD) < 0.2) return true;
    }
    return false;
  }

  private canPlay(): boolean {
    const p = this.player;
    const ctx = this.ctx;
    if (p.defeated || !p.alive || p.mountAnchor || ctx.companions.mounted || p.controlLock > 0 || ctx.ui.blocksGameplay) return false;
    if (p.body?.swimming || p.gliding) return false;
    return !this.inCombat();
  }

  /** What a hold would play with right now, for hints (null = nothing; the press would attack). */
  hintFor(): PlayKind | null {
    const kind = this.kindFor();
    if (!kind || this.current || this.pending || !this.canPlay()) return null;
    if (kind === 'water') {
      const t = findWaterTarget(this.ctx, this.player);
      return t && (!t.finite || t.available >= ORB_UNITS) ? 'water' : null;
    }
    if (kind === 'earth') {
      // A rock in view; bare earth only once the bender has been exploring a while (like fire).
      const t = findLiftTarget(this.ctx, this.player, this.stones);
      return t && t.source !== 'heavy' && (t.source !== 'ground' || this.player.sinceCombat > 12) ? 'earth' : null;
    }
    return this.player.sinceCombat > 12 ? 'fire' : null;
  }

  /**
   * The attack was pressed. True = the press is held back (exploring with something to play
   * with): the caller must not attack now — update() reports a tap when it should.
   */
  pressAttack(): boolean {
    if (this.current || this.pending) return true;
    const kind = this.kindFor();
    if (!kind || !this.canPlay()) return false;
    if (kind === 'water') {
      const target = findWaterTarget(this.ctx, this.player);
      if (!target) return false;
      this.pending = { kind, t: 0, target };
    } else if (kind === 'earth') {
      const target = findLiftTarget(this.ctx, this.player, this.stones);
      if (!target) return false;
      this.pending = { kind, t: 0, target };
    } else {
      this.pending = { kind, t: 0, target: null };
    }
    return true;
  }

  /**
   * Per frame. `gameplay` = the bender may act (no menu, not locked). Returns true when a
   * held-back press turned out to be a tap: the caller fires the normal attack now.
   */
  update(dt: number, gameplay: boolean): boolean {
    const input = this.ctx.input;
    this.stones.update(dt, this.player.position);
    if (this.pending) {
      if (!gameplay) {
        this.pending = null;
        return false;
      }
      if (!input.isDown('attack')) {
        this.pending = null;
        this.stats.taps++;
        return true;
      }
      this.pending.t += dt;
      if (this.pending.t < HOLD_TIME) return false;
      const p = this.pending;
      this.pending = null;
      // Things changed during the hold (an enemy showed up...): it is an attack after all.
      if (!this.canPlay() || this.kindFor() !== p.kind) return true;
      return !this.begin(p);
    }
    if (!this.current) return false;
    const interrupted =
      !gameplay ||
      !input.isDown('attack') ||
      input.wasPressed('aim') ||
      input.wasPressed('dodge') ||
      input.wasPressed('ability1') ||
      input.wasPressed('ability2') ||
      input.wasPressed('ability3') ||
      input.wasPressed('ability4') ||
      input.wasPressed('ability5');
    if (interrupted) {
      this.stop(input.isDown('attack') ? 'cancel' : 'release');
      return false;
    }
    let ok = false;
    try {
      ok = this.current.update(dt);
    } catch (err) {
      console.error('[ElementPlay] update failed', err);
    }
    if (!ok) this.stop('release');
    return false;
  }

  /** Start the interaction for a confirmed hold. False = nothing could start (attack instead). */
  private begin(p: Pending): boolean {
    const ctx = this.ctx;
    const player = this.player;
    try {
      if (p.kind === 'water') {
        // Re-aim: the bender may have turned during the hold.
        const target = findWaterTarget(ctx, player) ?? p.target;
        if (target.finite && target.available < ORB_UNITS) {
          // Looking at an empty jar or a drained pool: say so instead of attacking.
          this.refuse(`${target.label} is ${target.available < 0.5 ? 'empty' : 'nearly empty'} — there is not enough water to bend.`);
          return true;
        }
        const drawn = ctx.water.drawFrom(player, target.id, target.point, ORB_UNITS);
        if (!drawn) {
          this.refuse(ctx.water.lastFailure?.message ?? 'The water will not answer.');
          return true;
        }
        this.current = new WaterOrb(ctx, player, target);
      } else if (p.kind === 'earth') {
        if (p.target.source === 'heavy') {
          // A boulder or rock face too big to lift, or ice: say so instead of attacking.
          const s = p.target.spot;
          const msg = p.target.reason === 'ice' ? "That's ice, not stone. Earthbending can't move it." : 'That rock is too big to lift. Try a smaller one.';
          this.refuse(msg, 'earth', tA.set(s.x, s.y, s.z));
          return true;
        }
        const lift = liftRock(ctx, player, p.target, this.stones);
        if (!lift) return false;
        this.current = lift;
      } else {
        this.current = new PalmFlame(ctx, player);
      }
    } catch (err) {
      console.error('[ElementPlay] could not start', err);
      this.current = null;
      return false;
    }
    this.stats.started++;
    return true;
  }

  private refuse(message: string, kind: 'water' | 'earth' = 'water', at?: THREE.Vector3): void {
    const ctx = this.ctx;
    this.stats.refused++;
    if (kind === 'earth' && at) {
      // The bender strains, the rock only shudders: a little dust and grit at its foot.
      const foot = tA.set(at.x, ctx.world.groundAt(at.x, at.z, at.y + 0.5).y + 0.1, at.z);
      ctx.vfx.burst('dust', foot, { count: 8, radius: 1.2, speed: 0.6 });
      ctx.audio.play('bend_earth_crumble', { position: foot, volume: 0.5 });
      this.player.humanoid.animator.play('play_earth_drop', { fadeIn: 0.08 });
    } else {
      const h = this.player.castOrigin('hands', tA);
      ctx.vfx.burst('mist', h, { count: 4, size: 0.4 });
      ctx.audio.play('water_fizzle', { position: h, volume: 0.5 });
      this.player.humanoid.animator.play('water_fizzle', { fadeIn: 0.05 });
    }
    ctx.events.emit('ui:notify', { text: message, kind: 'info', duration: 2.5 });
  }

  /**
   * End the running interaction: 'release' (let go: falls/settles/fades), 'cancel'
   * (interrupted: the same, never stuck) or 'dispose' (session end: removed at once).
   */
  stop(how: 'release' | 'cancel' | 'dispose' = 'cancel'): void {
    this.pending = null;
    const cur = this.current;
    if (!cur) return;
    this.current = null;
    this.lastEnd = how;
    try {
      if (how === 'dispose') cur.dispose();
      else cur.release();
    } catch (err) {
      console.error('[ElementPlay] stop failed', err);
      try {
        cur.dispose();
      } catch {
        /* already gone */
      }
    }
    if (how === 'release') this.stats.released++;
    else this.stats.cancelled++;
  }

  private installDebug(): void {
    const g = (window as unknown as { __game?: { debug: Record<string, unknown> } }).__game;
    if (!g) return;
    g.debug.play = {
      state: () => ({
        element: this.player.element,
        pending: this.pending ? { kind: this.pending.kind, t: +this.pending.t.toFixed(2) } : null,
        active: this.active,
        current: this.current?.debug() ?? null,
        inCombat: this.inCombat(),
        lastEnd: this.lastEnd,
        stats: { ...this.stats },
        stones: this.stones.debug(),
      }),
      /** What a hold would play with right now (null = nothing: the press attacks). */
      target: () => {
        const kind = this.kindFor();
        if (!kind) return null;
        if (kind === 'water') {
          const t = findWaterTarget(this.ctx, this.player);
          return t ? { kind, id: t.id, type: t.type, label: t.label, available: Number.isFinite(t.available) ? +t.available.toFixed(1) : 'unlimited', point: t.point.toArray().map((v) => +v.toFixed(2)) } : null;
        }
        if (kind === 'earth') {
          const t = findLiftTarget(this.ctx, this.player, this.stones);
          if (!t) return null;
          const s = t.spot;
          return { kind, source: t.source, size: +s.radius.toFixed(2), pos: [+s.x.toFixed(2), +s.y.toFixed(2), +s.z.toFixed(2)] };
        }
        return { kind };
      },
      /** Point the camera (and the bender) at a world point, like a player aiming there. */
      aimAt: (x: number, y: number, z: number) => {
        const rig = this.ctx.cameraRig as unknown as { yaw: number; pitch: number; update(dt: number): void };
        const p = this.player.position;
        // The crosshair ray runs through the over-the-shoulder pivot (0.55 m right of the head).
        let yaw = Math.atan2(x - p.x, z - p.z) + Math.PI;
        let pitch = 0;
        for (let i = 0; i < 3; i++) {
          const pivot = tA.set(p.x + Math.cos(yaw) * 0.55, p.y + 1.55 * (this.player.height / 1.75), p.z - Math.sin(yaw) * 0.55);
          const dx = x - pivot.x, dy = y - pivot.y, dz = z - pivot.z;
          yaw = Math.atan2(dx, dz) + Math.PI;
          pitch = Math.max(-0.55, Math.min(1.2, -Math.atan2(dy, Math.hypot(dx, dz))));
        }
        rig.yaw = yaw;
        rig.pitch = pitch;
        this.player.yaw = yaw - Math.PI;
        rig.update(0);
        return { yaw: rig.yaw, pitch: rig.pitch };
      },
      stop: (how: 'release' | 'cancel' | 'dispose' = 'release') => this.stop(how),
    };
  }
}
