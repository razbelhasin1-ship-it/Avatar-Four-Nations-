import * as THREE from 'three';
import type { LoopHandle } from '../../../audio/AudioEngine';
import { registerTechnique } from '../../CombatSystem';
import { clamp01, easeOut } from '../../water/Curve';
import { capTaper } from '../../water/FlowTube';
import { StreamBody, type WaterEffect, type WaterFX } from '../../water/WaterFX';
import type { Cast } from '../../types';
import { fxOf, GatherStream, handPos, notifyPlayer, refundWater } from './shared';

/**
 * Healing Waters: water drawn into the hands begins to glow, then spirals
 * around the bender's body, knitting wounds over a few seconds (allies close
 * by are soothed too). Needs real water; being staggered breaks the
 * concentration. The water is spent (it evaporates as light).
 */

const tA = new THREE.Vector3();
export const HEAL = { perSec: 11, allyPerSec: 6, allyRadius: 3.5 };

class HealEffect implements WaterEffect {
  readonly kind = 'heal';
  castId: number;
  private readonly fx: WaterFX;
  private readonly spiral: StreamBody;
  private readonly orb: StreamBody;
  private t = 0;
  private on = false;
  private offT = -1;
  private loop: LoopHandle | null = null;

  constructor(readonly cast: Cast) {
    this.fx = fxOf(cast);
    this.castId = cast.id;
    this.spiral = new StreamBody(this.fx, { flow: 4, glow: 0.9, opacity: 0.85 }, 1.4, 16);
    this.spiral.wobble = 0.02;
    this.orb = new StreamBody(this.fx, { flow: 6, glow: 0.6 }, 0.6, 8);
  }

  start(): void {
    this.on = true;
    this.loop = this.cast.ctx.audio.loop('water_swirl', { position: this.cast.caster.position, volume: 0.35 });
  }

  stop(): void {
    if (this.offT >= 0) return;
    this.offT = 0;
    this.loop?.stop(0.4);
    const c = this.cast.caster;
    this.cast.ctx.vfx.burst('heal', c.aimPoint(tA), { count: 24, speed: 1.2, radius: 0.6 });
  }

  update(dt: number): boolean {
    this.t += dt;
    const c = this.cast.caster;
    const time = this.fx.time;
    const hands = handPos(c, 'hands', tA);
    // Glowing orb cupped in the hands during the windup.
    const og = this.on ? Math.max(0, 1 - this.t * 2) : easeOut(this.t / Math.max(0.05, this.cast.def.windup));
    for (let i = 0; i < 8; i++) {
      const a = time * 6 + (i / 8) * Math.PI * 2;
      this.orb.pts[i].set(hands.x + Math.cos(a) * 0.2, hands.y + Math.sin(a * 2) * 0.05, hands.z + Math.sin(a) * 0.2);
    }
    this.orb.radius = 0.08 * og;
    this.orb.head = 0.9;
    this.orb.build(8, true);
    if (!this.on) {
      this.spiral.hide();
      return this.t < 4;
    }
    let k = 1;
    if (this.offT >= 0) {
      this.offT += dt;
      k = 1 - clamp01(this.offT / 0.4);
      if (k <= 0) return false;
    }
    // Rising helix around the body.
    const rise = (time * 0.9) % 1;
    for (let i = 0; i < 16; i++) {
      const u = i / 15;
      const a = time * 4 + u * Math.PI * 5;
      const r = 0.55 + 0.12 * Math.sin(u * 7 + time * 3);
      this.spiral.pts[i].set(c.position.x + Math.cos(a) * r, c.position.y + 0.15 + u * (c.height + 0.1), c.position.z + Math.sin(a) * r);
    }
    this.spiral.radius = 0.06 * k;
    this.spiral.tail = 0;
    this.spiral.head = 1;
    this.spiral.profile = (u) => capTaper(u, 0.12, 0.2) * (0.6 + 0.4 * Math.sin((u - rise) * Math.PI * 4) ** 2);
    this.spiral.setLook({ glow: 0.8 + 0.4 * Math.sin(time * 5) });
    this.spiral.build(16);
    if (Math.random() < dt * 14) this.cast.ctx.vfx.burst('heal', tA.set(c.position.x + (Math.random() - 0.5), c.position.y + Math.random() * c.height, c.position.z + (Math.random() - 0.5)), { count: 1, speed: 0.6 });
    this.loop?.setPosition(c.position);
    return true;
  }

  dispose(): void {
    this.spiral.dispose();
    this.orb.dispose();
    this.loop?.stop(0.1);
  }
}

registerTechnique({
  id: 'water_heal',
  name: 'Healing Waters',
  element: 'water',
  kind: 'ability',
  tier: 2,
  description: 'Draw water into your hands until it glows, then let it flow around you to knit wounds. Allies at your side are soothed as well. Needs real water; a heavy blow breaks your focus.',
  usage: 'Ability (channel ~3 s). Heals about 33 health over time. Needs water.',
  icon: 'water',
  chiCost: 18,
  cooldown: 7,
  water: { amount: 15 },
  windup: 0.35,
  recovery: 0.3,
  movement: 'slow',
  airborne: false,
  channel: 3,
  interruptible: true,
  range: 0,
  precheck(caster, ctx) {
    const h = caster.health;
    if (h && h.hp >= h.maxHp - 0.5) {
      notifyPlayer(caster, ctx, 'You are not wounded.', 'info');
      return { reason: 'state', message: 'You are not wounded.' };
    }
    return null;
  },
  begin(cast) {
    cast.caster.humanoid?.animator.play('water_heal', { fadeIn: 0.1 });
    cast.data.fx = fxOf(cast).add(new HealEffect(cast));
    cast.data.gather = fxOf(cast).add(new GatherStream(cast, { hand: 'hands', duration: cast.def.windup * 0.9, radius: 0.12, look: { glow: 0.5 } }));
    cast.ctx.audio.play('water_heal', { position: cast.caster.position, volume: 0.8 });
  },
  release(cast) {
    cast.data.released = true;
    (cast.data.gather as GatherStream | undefined)?.absorb();
    (cast.data.fx as HealEffect).start();
    cast.caster.removeStatus('burn');
    cast.data.healed = 0;
    cast.data.healAcc = 0;
  },
  channelUpdate(cast, dt) {
    const c = cast.caster;
    if (!c.alive || !c.health) return false;
    const got = c.health.heal(HEAL.perSec * dt);
    cast.data.healed += got;
    cast.data.healAcc += got;
    if (cast.data.healAcc >= 3 && c.isPlayer) {
      cast.ctx.events.emit('player:healed', { amount: cast.data.healAcc });
      cast.data.healAcc = 0;
    }
    for (const e of cast.ctx.entities.queryRadius(c.position, HEAL.allyRadius)) {
      if (e === c || !e.health || !e.alive) continue;
      if (e.team === c.team || (c.team === 'player' && e.team === 'ally')) e.health.heal(HEAL.allyPerSec * dt);
    }
    return true;
  },
  end(cast, interrupted) {
    cast.caster.humanoid?.animator.stop('water_heal', 0.3);
    const fx = cast.data.fx as HealEffect | undefined;
    fx?.stop();
    if (cast.data.released && cast.caster.isPlayer && cast.data.healAcc > 0) {
      cast.ctx.events.emit('player:healed', { amount: cast.data.healAcc });
      cast.data.healAcc = 0;
    }
    if (!cast.data.released && interrupted) {
      (cast.data.gather as GatherStream | undefined)?.drop();
      refundWater(cast);
    }
    // A short regeneration lingers after a completed channel.
    if (cast.data.released && !interrupted) cast.caster.addStatus('regen', 4, 1);
  },
  aiScore(caster) {
    const h = caster.health;
    return h && h.hp / h.maxHp < 0.45 ? 0.7 : 0;
  },
});
