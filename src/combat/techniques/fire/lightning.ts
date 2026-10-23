import * as THREE from 'three';
import type { Entity } from '../../../entities/Entity';
import { LightningBolt, strikeBolt } from '../../../vfx/effects/lightning';
import { effect } from '../../../vfx/effects/loop';
import { flameMaterial, setOpacity } from '../../../vfx/effects/materials';
import { shared } from '../../../vfx/effects/shapes';
import { registerTechnique } from '../../CombatSystem';
import type { Cast } from '../../types';
import { anchorPos, anim, enemiesNear, groundY, hitSphere, push, resolveTarget, shake } from '../bending/util';
import { heat } from './common';

/**
 * Lightning Generation: a long, interruptible gathering (circular arm sweeps,
 * crackling arcs between the hands) followed by a near-instant bolt that leaps
 * to up to three further enemies. Soaked targets conduct: more damage, longer
 * chain reach.
 */

const tmp = new THREE.Vector3();
const tmp2 = new THREE.Vector3();

interface ChargeArcs {
  alive: boolean;
}

function chargeArcs(cast: Cast): ChargeArcs {
  const ctx = cast.ctx;
  const c = cast.caster;
  const state: ChargeArcs = { alive: true };
  const low = ctx.vfx.quality === 'low';
  const bolts = [new LightningBolt({ maxSegments: 40, core: '#ffffff', glow: '#7fb8ff' }), new LightningBolt({ maxSegments: 40, core: '#ffffff', glow: '#9a8cff' })];
  for (const b of bolts) ctx.vfx.group.add(b.mesh);
  const glowMat = flameMaterial({ mode: 'volume', palette: 'blue', intensity: 2.6, heat: 0.4, scale: [2.5, 2.5], scroll: [1, -3] });
  const glow = new THREE.Mesh(shared('fx_sphere_small', () => new THREE.SphereGeometry(1, 12, 8)), glowMat);
  ctx.vfx.group.add(glow);
  let t = 0;
  let regen = 0;
  const hl = new THREE.Vector3(), hr = new THREE.Vector3();
  effect(
    (dt) => {
      t += dt;
      if (!state.alive) return false;
      c.castOrigin('handL', hl);
      c.castOrigin('handR', hr);
      regen -= dt;
      if (regen <= 0) {
        regen = low ? 0.08 : 0.05;
        const k = Math.min(1, t / 0.8);
        // Arc between the hands + one stray arc reaching out from a fingertip.
        bolts[0].generate(hl, hr, { width: 0.1 + k * 0.12, branches: 1, jag: 0.35, depth: 3 });
        const stray = tmp.set(Math.random() - 0.5, Math.random() - 0.2, Math.random() - 0.5).normalize().multiplyScalar(0.5 + k * 0.6);
        const from = Math.random() < 0.5 ? hl : hr;
        bolts[1].generate(from, tmp2.copy(from).add(stray), { width: 0.08 + k * 0.08, branches: 1, jag: 0.4, depth: 3 });
        if (Math.random() < 0.5) ctx.vfx.burst('sparks', from, { count: 2, color: '#cfe4ff', color2: '#6f9cff', speed: 0.8 });
      }
      for (const b of bolts) {
        b.opacity = 0.6 + Math.random() * 0.4;
        b.update(ctx.camera.position);
      }
      glow.position.copy(hr);
      glow.scale.setScalar(0.06 + Math.min(1, t / 0.8) * 0.1 + Math.random() * 0.03);
      setOpacity(glowMat, 0.9);
      return true;
    },
    () => {
      for (const b of bolts) {
        b.mesh.removeFromParent();
        b.dispose();
      }
      glow.removeFromParent();
      glowMat.dispose();
    },
  );
  return state;
}

/** First harmable entity along a ray (within `width` of the line), nearest first. */
function entityAlongRay(cast: Cast, origin: THREE.Vector3, dir: THREE.Vector3, range: number, width: number): Entity | null {
  let best: Entity | null = null;
  let bestT = Infinity;
  const mid = origin.clone().addScaledVector(dir, range / 2);
  for (const e of enemiesNear(cast, mid, range / 2 + 2)) {
    const ap = e.aimPoint(tmp);
    const t = tmp2.subVectors(ap, origin).dot(dir);
    if (t < 0 || t > range) continue;
    const closest = origin.clone().addScaledVector(dir, t);
    if (closest.distanceTo(ap) > width + e.radius) continue;
    if (t < bestT && cast.ctx.world.hasLineOfSight(origin, ap)) {
      bestT = t;
      best = e;
    }
  }
  return best;
}

registerTechnique({
  id: 'fire_lightning',
  name: 'Lightning Generation',
  element: 'fire',
  kind: 'ability',
  tier: 4,
  description: 'Separate the energies within you and release them as a near-instant bolt of lightning that leaps from foe to foe.',
  usage: 'A long, interruptible wind-up — then an instant, devastating strike that chains to up to three nearby enemies. Soaked targets take extra damage and conduct further.',
  icon: 'fire',
  chiCost: 40,
  cooldown: 14,
  windup: 0.85,
  recovery: 0.6,
  movement: 'root',
  airborne: false,
  interruptible: true,
  range: 36,
  begin(cast) {
    anim(cast.caster, 'fire_lightning_charge', { fadeIn: 0.08 });
    cast.data.arcs = chargeArcs(cast);
    cast.ctx.audio.play('bend_lightning_charge', { position: cast.caster.position, volume: 0.8 });
  },
  release(cast) {
    const ctx = cast.ctx;
    const c = cast.caster;
    (cast.data.arcs as ChargeArcs).alive = false;
    anim(c, 'fire_lightning_release', { fadeIn: 0.03 });
    const origin = anchorPos(c, 'handR', new THREE.Vector3());
    const dir = tmp.subVectors(cast.aimPoint, origin).normalize();
    if (!Number.isFinite(dir.x)) dir.copy(cast.aimDir);
    const aim = dir.clone();
    let target: Entity | null = resolveTarget(cast, 3) ?? entityAlongRay(cast, origin, aim, 36, 1.4);
    if (target && !ctx.world.hasLineOfSight(origin, target.aimPoint(tmp))) target = null;

    ctx.vfx.flash(origin, '#bfe0ff', 8, 0.3, 26);
    ctx.audio.play('bend_lightning_strike', { position: origin, volume: 1 });
    shake(ctx, origin, 0.45, 0.35);
    ctx.events.emit('camera:impulse', { fovKick: 4, pullback: 0.4, duration: 0.35 });

    if (!target) {
      // Strike the world point under the aim.
      const hit = ctx.world.raycast(origin, aim, 36);
      const end = hit ? hit.point : origin.clone().addScaledVector(aim, 36);
      strikeBolt(ctx, origin, end, { width: 0.55, life: 0.35 });
      ctx.vfx.burst('sparks', end, { count: 24, color: '#e6f2ff', color2: '#5f9cff', speed: 1.8 });
      ctx.vfx.flash(end, '#a8d0ff', 6, 0.25, 14);
      if (hit) {
        ctx.world.fx.scorch(end, 1.2);
        ctx.world.fx.crack(end, 1.2);
        hitSphere(cast, end, 1.8, 1.6, (_e, away) => ({ damage: 18, knockback: push(away, 6), stun: 0.5, stagger: 50 }));
        heat(ctx, end, 1.5, 0.6, c.id);
      }
      return;
    }

    // Chain: up to 4 targets, each hop weaker.
    const struck: Entity[] = [];
    let from = origin.clone();
    let dmg = 46;
    for (let hop = 0; hop < 4 && target; hop++) {
      const cur: Entity = target;
      const to = cur.aimPoint(new THREE.Vector3());
      strikeBolt(ctx, from, to, { width: hop === 0 ? 0.6 : 0.4, life: 0.34 + hop * 0.04, branches: hop === 0 ? 4 : 2 });
      const soaked: boolean = !!cur.hasStatus('soaked');
      const kb = tmp.subVectors(to, from).setY(0);
      cast.hit(cur, {
        damage: dmg * (soaked ? 1.4 : 1),
        stun: hop === 0 ? 0.9 : 0.6,
        stagger: 110,
        knockback: push(kb.lengthSq() > 0 ? kb : aim, hop === 0 ? 7 : 4),
        launch: hop === 0 ? 2.5 : 1,
        status: [{ type: 'burn', duration: 1 }],
        point: to.clone(),
      });
      ctx.vfx.burst('sparks', to, { count: 18, color: '#eaf4ff', color2: '#6fa4ff', speed: 1.6 });
      ctx.vfx.burst('glow', to, { color: '#a8d0ff', size: 2.2 });
      ctx.vfx.flash(to, '#a8d0ff', 5, 0.22, 12);
      if (soaked) {
        ctx.vfx.burst('steam', to, { count: 6 });
        cur.removeStatus('soaked');
      }
      struck.push(cur);
      from = to;
      dmg *= 0.62;
      const reach: number = 9 + (soaked ? 4 : 0);
      let next: Entity | null = null;
      let nd = Infinity;
      for (const e of enemiesNear(cast, to, reach)) {
        if (struck.includes(e)) continue;
        const d = e.position.distanceTo(cur.position);
        if (d < nd && d < reach && ctx.world.hasLineOfSight(to, e.aimPoint(tmp2))) {
          nd = d;
          next = e;
        }
      }
      target = next;
    }
    // Ground scorch under the first target.
    const first = struck[0];
    if (first) {
      const g = tmp.copy(first.position);
      g.y = groundY(ctx, g.x, g.z, g.y);
      ctx.world.fx.scorch(g, 1.1);
    }
  },
  end(cast) {
    const arcs = cast.data.arcs as ChargeArcs | undefined;
    if (arcs) arcs.alive = false;
  },
  aiScore: (_c, _t, dist) => (dist > 6 && dist < 30 ? 0.3 : 0),
});
