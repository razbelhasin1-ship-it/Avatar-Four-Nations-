import * as THREE from 'three';
import type { GameContext } from '../../core/GameContext';
import { debris } from '../../vfx/effects/loop';
import { earthTint } from '../../vfx/effects/rocks';

/** Shared helpers for the Avatar State / Elements Sphere / ultimate visuals. */

export type FxQuality = 'low' | 'medium' | 'high';

export function fxQuality(ctx: GameContext): FxQuality {
  return ctx.vfx.quality;
}

/** Per-quality pick. */
export function byQuality<T>(ctx: GameContext, low: T, medium: T, high: T): T {
  const q = ctx.vfx.quality;
  return q === 'low' ? low : q === 'medium' ? medium : high;
}

export function dynamicLights(ctx: GameContext): boolean {
  return !!ctx.settings.data.graphics.dynamicLights;
}

const tA = new THREE.Vector3();
const tB = new THREE.Vector3();
const ROCKY = new Set(['rock', 'stone', 'gravel', 'dirt', 'cobble', 'grass', 'tallgrass', 'sand', 'mud', 'plaster', 'ash']);
const HOT = new Set(['ash', 'lava']);

/**
 * The surroundings react to an Avatar energy wave: foliage, snow, sand and dust
 * through world.fx.disturb (the environment module picks the right particles),
 * plus a dust ring, loose stones hopping, nearby water / ice / snow surfaces
 * spraying up and embers flaring on hot ground.
 */
export function environmentReact(ctx: GameContext, center: THREE.Vector3, radius: number, strength: number): void {
  ctx.world.fx.disturb(center, radius, strength);
  const g = ctx.world.groundAt(center.x, center.z, center.y + 1.5);
  const near = center.y - g.y < 3;
  const low = ctx.vfx.quality === 'low';
  if (near) {
    const n = low ? 6 : 12;
    const surface = g.surface as string | undefined;
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2 + Math.random() * 0.3;
      const r = radius * (0.25 + Math.random() * 0.3);
      const p = tA.set(center.x + Math.cos(a) * r, 0, center.z + Math.sin(a) * r);
      p.y = ctx.world.groundAt(p.x, p.z, center.y + 2).y + 0.15;
      ctx.vfx.burst(surface === 'snow' || surface === 'packedsnow' ? 'snowpuff' : 'dust', p, { count: 2, dir: tB.set(Math.cos(a), 0.35, Math.sin(a)), spread: 0.5, speed: 2.2 * strength });
    }
    if (surface && ROCKY.has(surface)) {
      debris(tA.set(center.x, g.y + 0.15, center.z), low ? 5 : 10, { spread: 1.1, speed: 3.5 * strength, size: 0.07, radius: radius * 0.35, color: earthTint(g.surface), life: 1.3 });
    }
    if (surface && HOT.has(surface)) ctx.vfx.burst('embers', tA.set(center.x, g.y + 0.3, center.z), { count: low ? 10 : 22, radius: radius * 0.3, speed: 2.5 });
  }
  // Water, ice and snow sources within reach shiver and spray.
  let k = 0;
  for (const h of ctx.water.findAll(center, radius * 0.8, { allowIce: true, allowSnow: true })) {
    if (k++ >= (low ? 2 : 4)) break;
    const p = tA.copy(h.point);
    if (h.type === 'snow') ctx.vfx.burst('snowpuff', p, { count: 6, radius: 1, speed: 1.5 });
    else if (h.frozen) ctx.vfx.burst('ice', p.setY(p.y + 0.2), { count: 6, radius: 0.8, speed: 1.2 });
    else {
      ctx.vfx.burst('splash', p.setY(p.y + 0.1), { count: 10, radius: 1.2, speed: 1.4 });
      ctx.vfx.ring(tB.copy(h.point).setY(h.point.y + 0.05), '#dff4ff', 3, 0.8, { opacity: 0.5 });
    }
  }
}
