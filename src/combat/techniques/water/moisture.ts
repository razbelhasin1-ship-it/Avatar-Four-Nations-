import * as THREE from 'three';
import { registerTechnique } from '../../CombatSystem';
import { clamp01, easeOut } from '../../water/Curve';
import { capTaper } from '../../water/FlowTube';
import { humidity, humidityLabel, MoistureMap, MOISTURE_MAX_YIELD, MOISTURE_MIN_YIELD } from '../../water/humidity';
import type { WaterbendingSystem } from '../../water/WaterbendingSystem';
import { StreamBody, type WaterEffect, type WaterFX } from '../../water/WaterFX';
import { biomeAt, biomeWeights } from '../../../world/Heightfield';
import type { GameContext } from '../../../core/GameContext';
import type { Cast, Combatant } from '../../types';
import { fxOf, handPos, notifyPlayer, returnToReserve } from './shared';

/**
 * Moisture Extraction: pull a LIMITED amount of water out of plants and the
 * humid air into your reserve. Generous in the swamp, jungle, forests and
 * rain; nearly useless in deserts and on volcanic slopes. Every use drains the
 * area for a while and the technique has a long cooldown, so it never
 * replaces real sources. Threads of moisture visibly converge on the bender.
 *
 * Snow Gathering (water_snow_draw) is a passive: every waterbender can melt snow
 * and ice into water; knowing it draws water from them faster.
 */

const tA = new THREE.Vector3();
const fallbackMap = new MoistureMap();

function system(ctx: GameContext): WaterbendingSystem | undefined {
  return ctx.extra.get('waterbending') as WaterbendingSystem | undefined;
}

/** Yield (units) and humidity at the caster's position now. */
export function moistureAt(ctx: GameContext, c: Combatant): { units: number; humidity: number; drained: number; label: string } {
  const sys = system(ctx);
  if (sys) return sys.moistureYield(c);
  const p = c.position;
  const b = biomeWeights(p.x, p.z);
  const h = humidity({ biome: biomeAt(p.x, p.z), swamp: b.swamp, desert: b.desert, volcanic: b.volcanic, raining: ctx.water.raining });
  const drained = fallbackMap.drained(p.x, p.z, ctx.time.elapsed);
  return { units: MOISTURE_MAX_YIELD * h * (1 - drained), humidity: h, drained, label: humidityLabel(h) };
}

function drain(ctx: GameContext, c: Combatant): void {
  const map = system(ctx)?.moisture ?? fallbackMap;
  map.drain(c.position.x, c.position.z, ctx.time.elapsed, 0.65);
}

class MoistureEffect implements WaterEffect {
  readonly kind = 'moisture';
  castId: number;
  private readonly fx: WaterFX;
  private readonly threads: Array<{ body: StreamBody; from: THREE.Vector3; phase: number }> = [];
  private t = 0;
  private endT = -1;

  constructor(readonly cast: Cast, readonly strength: number) {
    this.fx = fxOf(cast);
    this.castId = cast.id;
    const c = cast.caster;
    const n = this.fx.quality === 'low' ? 4 : 6;
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2 + Math.random() * 0.5;
      const r = 4 + Math.random() * 3;
      const from = new THREE.Vector3(c.position.x + Math.cos(a) * r, 0, c.position.z + Math.sin(a) * r);
      from.y = cast.ctx.world.groundAt(from.x, from.z, c.position.y + 4).y + 0.4 + Math.random() * 1.2;
      const body = new StreamBody(this.fx, { flow: 7, opacity: 0.55 + 0.35 * strength, foam: 0.5 }, 1, 5);
      body.wobble = 0.08;
      this.threads.push({ body, from, phase: Math.random() * 6 });
    }
  }

  finish(): void {
    if (this.endT < 0) this.endT = 0;
  }

  update(dt: number): boolean {
    this.t += dt;
    const c = this.cast.caster;
    const hands = handPos(c, 'hands', tA);
    const time = this.fx.time;
    let tail = 0;
    if (this.endT >= 0) {
      this.endT += dt;
      tail = clamp01(this.endT / 0.3);
      if (tail >= 1) return false;
    }
    const head = easeOut(this.t / 0.7);
    for (const th of this.threads) {
      const b = th.body;
      const f = th.from;
      for (let i = 0; i < 5; i++) {
        const u = i / 4;
        // Spiral inward: swirl around the bender while closing in on the hands.
        const ang = (1 - u) * 1.6 + time * 1.5 + th.phase;
        const px = f.x + (hands.x - f.x) * u, pz = f.z + (hands.z - f.z) * u;
        const sw = (1 - u) * u * 2.2;
        b.pts[i].set(px + Math.cos(ang) * sw, f.y + (hands.y - f.y) * u + Math.sin(u * Math.PI) * 0.8, pz + Math.sin(ang) * sw);
      }
      b.radius = 0.03 + 0.05 * this.strength;
      b.tail = tail;
      b.head = head;
      b.profile = (u) => capTaper(u, 0.25, 0.05) * (0.35 + 0.65 * u);
      b.build(5);
      if (Math.random() < dt * 3) this.cast.ctx.vfx.burst('mist', f, { count: 1, size: 0.5 });
    }
    return this.t < 5;
  }

  dispose(): void {
    for (const th of this.threads) th.body.dispose();
  }
}

registerTechnique({
  id: 'water_moisture',
  name: 'Moisture Extraction',
  element: 'water',
  kind: 'ability',
  tier: 3,
  description: 'Draw the water out of plants and humid air into your reserve. Rich in swamps, jungles, forests and rain; almost nothing in deserts or on volcanic ground. Each use leaves the area dry for a while.',
  usage: 'Ability (channel ~1.6 s). Adds a limited amount of water to your reserve. Long cooldown.',
  icon: 'water',
  chiCost: 15,
  cooldown: 18,
  windup: 0.4,
  recovery: 0.3,
  movement: 'root',
  airborne: false,
  channel: 1.6,
  interruptible: true,
  range: 0,
  precheck(caster, ctx) {
    if (caster.waterReserve >= caster.maxWaterReserve - 1) {
      notifyPlayer(caster, ctx, 'Your water reserve is already full.');
      return { reason: 'state', message: 'Your water reserve is already full.' };
    }
    const m = moistureAt(ctx, caster);
    if (m.units < MOISTURE_MIN_YIELD) {
      const msg =
        m.humidity < 0.15
          ? 'The air here is bone-dry — there is no moisture to draw. Find real water.'
          : 'You have already drawn this place dry — move on, or let the plants recover.';
      notifyPlayer(caster, ctx, msg);
      return { reason: 'water', message: msg };
    }
    return null;
  },
  begin(cast) {
    const m = moistureAt(cast.ctx, cast.caster);
    cast.data.yield = Math.min(m.units, cast.caster.maxWaterReserve - cast.caster.waterReserve);
    cast.data.humidity = m.humidity;
    cast.data.given = 0;
    cast.caster.humanoid?.animator.play('water_moisture', { fadeIn: 0.15 });
    cast.data.fx = fxOf(cast).add(new MoistureEffect(cast, clamp01(m.humidity)));
    cast.ctx.audio.play('water_moisture', { position: cast.caster.position, volume: 0.8 });
    cast.ctx.world.fx.disturb(cast.caster.position, 7, 0.6);
  },
  release(cast) {
    cast.data.released = true;
    drain(cast.ctx, cast.caster);
  },
  channelUpdate(cast, dt) {
    const total: number = cast.data.yield;
    const per = (total / (cast.def.channel ?? 1.6)) * dt;
    const give = Math.min(per, total - cast.data.given);
    if (give > 0) cast.data.given += returnToReserve(cast, give);
    return cast.caster.alive;
  },
  end(cast) {
    cast.caster.humanoid?.animator.stop('water_moisture', 0.3);
    (cast.data.fx as MoistureEffect | undefined)?.finish();
    const got: number = cast.data.given ?? 0;
    if (got > 0.5 && cast.isPlayer) {
      const p = cast.caster.position;
      cast.ctx.events.emit('water:drawn', { sourceId: `moisture:${biomeAt(p.x, p.z)}`, sourceType: 'moisture', amount: got, position: { x: p.x, y: p.y, z: p.z } });
      cast.ctx.events.emit('ui:notify', { text: `Drew ${Math.round(got)} water from the ${humidityLabel(cast.data.humidity ?? 0)} air.`, kind: 'info', duration: 2 });
    }
    if (got > 0.5) {
      // The plants around wilt a little.
      for (let i = 0; i < 4; i++) {
        const a = Math.random() * Math.PI * 2;
        tA.set(cast.caster.position.x + Math.cos(a) * 3, cast.caster.position.y + 1.5, cast.caster.position.z + Math.sin(a) * 3);
        cast.ctx.vfx.burst('leaves', tA, { count: 2, color: '#8f8040', color2: '#6b5a2a' });
      }
    }
  },
  aiScore() {
    return 0;
  },
});

registerTechnique({
  id: 'water_snow_draw',
  name: 'Snow Gathering',
  element: 'water',
  kind: 'passive',
  tier: 2,
  description: 'Healer Yugoda’s teaching: snow is only water at rest. Any waterbender can melt snow and ice into water; knowing this, you draw it from snow and ice much faster.',
  usage: 'Passive. Hold Draw Water on snow or ice, or bend it straight into attacks.',
  icon: 'water',
  chiCost: 0,
  cooldown: 0,
  windup: 0,
  recovery: 0,
  movement: 'free',
  airborne: true,
  interruptible: false,
  range: 0,
  precheck(caster, ctx) {
    notifyPlayer(caster, ctx, 'Snow Gathering is always active — draw water on snowy ground.');
    return { reason: 'state', message: 'Snow Gathering is a passive technique.' };
  },
  release() {},
});
