import * as THREE from 'three';
import { envGain, noiseSrc, oscSrc, registerSound } from '../../../audio/AudioEngine';
import type { GameContext, GameSystem } from '../../../core/GameContext';
import type { Entity } from '../../../entities/Entity';
import { effect } from '../../../vfx/effects/loop';
import { shared } from '../../../vfx/effects/shapes';
import { registerTechnique } from '../../CombatSystem';
import type { Cast, Combatant } from '../../types';
import { anchorPos, anim, enemiesNear, groundY, shake } from '../bending/util';
import { heat } from './common';

/**
 * Combustionbending: the rare firebending of those who bear the third eye (Combustion Man, P'Li).
 * The bender stands still while heat gathers behind the brow (the eye glows ever brighter), then
 * looses a thin streak of compressed energy from the forehead; it detonates where it strikes — a
 * blast that throws and burns everything round it. Struck at point blank, the blast catches the
 * bender too. Only a character with the Third Eye marking can use it (MarkingPerks grants it).
 */

export const COMBUSTION_ID = 'fire_combustion';
const RANGE = 42;
const SPEED = 95;

export function hasThirdEye(c: { humanoid: { appearance: { facePaint?: string } } | null }): boolean {
  return c.humanoid?.appearance.facePaint === 'fire_third_eye';
}

const tmp = new THREE.Vector3();
const tmp2 = new THREE.Vector3();

/** The third eye: just above the eyes, a little in front of the brow. */
function brow(c: Combatant, out: THREE.Vector3): THREE.Vector3 {
  anchorPos(c, 'eyes', out);
  out.y += 0.06;
  out.x += Math.sin(c.yaw) * 0.08;
  out.z += Math.cos(c.yaw) * 0.08;
  return out;
}

/** First harmable entity within `width` of the line, nearest first (in line of sight). */
function foeAlong(cast: Cast, origin: THREE.Vector3, dir: THREE.Vector3, range: number, width: number): { e: Entity; t: number } | null {
  let best: { e: Entity; t: number } | null = null;
  const mid = origin.clone().addScaledVector(dir, range / 2);
  for (const e of enemiesNear(cast, mid, range / 2 + 2)) {
    const ap = e.aimPoint(tmp);
    const t = tmp2.subVectors(ap, origin).dot(dir);
    if (t < 0 || t > range) continue;
    if (origin.clone().addScaledVector(dir, t).distanceTo(ap) > width + e.radius) continue;
    if ((!best || t < best.t) && cast.ctx.world.hasLineOfSight(origin, ap)) best = { e, t };
  }
  return best;
}

/** Focus: heat drawn in toward the brow while the third eye brightens. */
function focus(cast: Cast): { alive: boolean } {
  const ctx = cast.ctx;
  const c = cast.caster;
  const st = { alive: true };
  const p = new THREE.Vector3();
  let t = 0;
  let spark = 0;
  effect(
    (dt) => {
      if (!st.alive) return false;
      t += dt;
      const k = Math.min(1, t / cast.def.windup);
      c.humanoid?.setFaceGlow(0.2 + 0.8 * k + Math.sin(t * 34) * 0.1 * k);
      spark -= dt;
      if (spark <= 0) {
        spark = ctx.vfx.quality === 'low' ? 0.1 : 0.06;
        brow(c, p);
        const a = Math.random() * Math.PI * 2, r = 0.45 + Math.random() * 0.45;
        tmp.set(p.x + Math.cos(a) * r, p.y + (Math.random() - 0.35) * 0.5, p.z + Math.sin(a) * r);
        ctx.vfx.burst('sparks', tmp, { count: 1, color: '#ffd9a0', color2: '#ff6a2a', speed: 0.4 });
        if (k > 0.45) ctx.vfx.burst('glow', p, { color: '#ff7a3a', size: 0.2 + k * 0.3 });
      }
      return true;
    },
    () => {
      if (!st.alive) return;
      c.humanoid?.setFaceGlow(0);
    },
  );
  return st;
}

/** After the shot the eye flares, then cools. */
function afterglow(c: Combatant): void {
  let t = 0;
  effect(
    (dt) => {
      t += dt;
      c.humanoid?.setFaceGlow(Math.max(0, 1.5 * (1 - t / 0.7)));
      return t < 0.7;
    },
    () => c.humanoid?.setFaceGlow(0),
  );
}

/** The streak: a thin white-hot line racing from the brow to where it strikes, then fading. */
function streak(cast: Cast, from: THREE.Vector3, to: THREE.Vector3, onArrive: () => void): void {
  const ctx = cast.ctx;
  const len = from.distanceTo(to);
  const dir = new THREE.Vector3().subVectors(to, from).normalize();
  const geo = new THREE.CylinderGeometry(1, 1, 1, 6, 1, true);
  geo.rotateX(Math.PI / 2);
  geo.translate(0, 0, 0.5);
  const mat = new THREE.MeshBasicMaterial({ color: '#fff0d2', transparent: true, opacity: 0.95, blending: THREE.AdditiveBlending, depthWrite: false });
  const glowMat = new THREE.MeshBasicMaterial({ color: '#ff8a3c', transparent: true, opacity: 0.35, blending: THREE.AdditiveBlending, depthWrite: false });
  const core = new THREE.Mesh(geo, mat);
  const halo = new THREE.Mesh(geo, glowMat);
  const headMat = new THREE.MeshBasicMaterial({ color: '#ffe2b0', transparent: true, opacity: 1, blending: THREE.AdditiveBlending, depthWrite: false });
  const head = new THREE.Mesh(shared('fx_sphere_small', () => new THREE.SphereGeometry(1, 12, 8)), headMat);
  head.scale.setScalar(0.14);
  for (const m of [core, halo]) {
    m.position.copy(from);
    m.lookAt(to);
    ctx.vfx.group.add(m);
  }
  ctx.vfx.group.add(head);
  let t = 0;
  let arrived = false;
  let fade = 0;
  effect(
    (dt) => {
      t += dt;
      const d = Math.min(len, t * SPEED);
      core.scale.set(0.03, 0.03, Math.max(0.01, d));
      halo.scale.set(0.11, 0.11, Math.max(0.01, d));
      head.position.copy(from).addScaledVector(dir, d);
      if (!arrived) {
        ctx.vfx.burst('sparks', head.position, { count: 1, color: '#fff2c8', color2: '#ff7a30', speed: 0.3 });
        if (d >= len) {
          arrived = true;
          head.visible = false;
          onArrive();
        }
        return true;
      }
      fade += dt;
      mat.opacity = Math.max(0, 0.95 * (1 - fade / 0.3));
      glowMat.opacity = Math.max(0, 0.35 * (1 - fade / 0.3));
      return fade < 0.3;
    },
    () => {
      core.removeFromParent();
      halo.removeFromParent();
      head.removeFromParent();
      geo.dispose();
      mat.dispose();
      glowMat.dispose();
      headMat.dispose();
    },
  );
}

/** The blast: the core strikes hardest, the wider ring throws and burns; point blank catches the bender. */
function detonate(cast: Cast, at: THREE.Vector3): void {
  const ctx = cast.ctx;
  const c = cast.caster;
  ctx.vfx.flash(at, '#ffb36a', 16, 0.4, 34);
  ctx.vfx.burst('fireball', at, { count: 24, radius: 2.2, size: 3 });
  ctx.vfx.burst('fire', at, { count: 28, radius: 3 });
  ctx.vfx.burst('smoke', at, { count: 16, radius: 3.4 });
  ctx.vfx.burst('debris', at, { count: 14, radius: 2.4 });
  ctx.vfx.burst('sparks', at, { count: 28, color: '#ffe0a0', color2: '#ff5a1a', speed: 3 });
  ctx.vfx.ring(at, '#ffcf9a', 7.5, 0.55, { opacity: 0.75 });
  ctx.audio.play('bend_explosion', { position: at, volume: 1.2 });
  shake(ctx, at, 0.85, 0.6);
  ctx.events.emit('camera:impulse', { fovKick: 5, pullback: 0.6, duration: 0.45 });
  const g = tmp.copy(at);
  g.y = groundY(ctx, g.x, g.z, g.y + 1);
  if (at.y - g.y < 2.5) {
    ctx.world.fx.scorch(g, 2.6);
    ctx.world.fx.crack(g, 2.2);
  }
  // Each foe is struck once (per cast), by the nearer ring.
  cast.areaHit({ center: at, radius: 2.4, height: 2.6, damage: 58, knockback: 13, knockDir: 'radial', launch: 5, stagger: 180, stun: 0.7, knockdown: true, status: [{ type: 'burn', duration: 2.5 }] });
  cast.areaHit({ center: at, radius: 5.2, height: 3.5, damage: 30, knockback: 9, knockDir: 'radial', launch: 2.5, stagger: 120, stun: 0.3, status: [{ type: 'burn', duration: 1.5 }] });
  heat(ctx, at, 4, 1.4, c.id);
  // Point blank, the backlash catches the bender. It has no attacker: nobody is their own foe,
  // but the blast does not care whose brow it came from.
  const self = c.position.distanceTo(at);
  if (self < 3.2) {
    const away = new THREE.Vector3().subVectors(c.position, at).setY(0);
    if (away.lengthSq() < 1e-4) away.set(-Math.sin(c.yaw), 0, -Math.cos(c.yaw));
    ctx.combat.applyHit(null, c, {
      attacker: null,
      damage: 6 + 14 * (1 - self / 3.2),
      element: 'fire',
      techniqueId: COMBUSTION_ID,
      knockback: away.normalize().multiplyScalar(9),
      launch: 2,
      stagger: 90,
      point: at.clone(),
    });
  }
}

registerTechnique({
  id: COMBUSTION_ID,
  name: 'Combustionbending',
  element: 'fire',
  kind: 'ability',
  tier: 4,
  description: 'Gather heat behind the third eye and loose it from your brow as a thin streak that explodes where it strikes.',
  usage: 'Only for those who bear the third eye. Stand still while the eye gathers (a hit breaks the focus); the streak flies where you aim and detonates — a huge blast that throws and burns everything near it. At point blank it catches you too.',
  icon: 'fire',
  chiCost: 38,
  cooldown: 7,
  windup: 0.95,
  recovery: 0.55,
  movement: 'root',
  airborne: false,
  interruptible: true,
  range: 40,
  innate: 'Innate to those who bear the Third Eye (a Fire Nation marking chosen in the character creator)',
  precheck(caster) {
    return hasThirdEye(caster) ? null : { reason: 'locked', message: 'Combustionbending needs the third eye.' };
  },
  begin(cast) {
    anim(cast.caster, 'fire_charge', { fadeIn: 0.1 });
    cast.data.focus = focus(cast);
    cast.ctx.audio.play('bend_combustion_focus', { position: cast.caster.position, volume: 0.75 });
  },
  release(cast) {
    const ctx = cast.ctx;
    const c = cast.caster;
    (cast.data.focus as { alive: boolean }).alive = false;
    anim(c, 'fire_push', { fadeIn: 0.04 });
    afterglow(c);
    const origin = brow(c, new THREE.Vector3());
    const aim = new THREE.Vector3().subVectors(cast.aimPoint, origin).normalize();
    if (!Number.isFinite(aim.x) || aim.lengthSq() < 0.5) aim.copy(cast.aimDir);
    const wall = ctx.world.raycast(origin, aim, RANGE);
    let dist = wall ? wall.distance : RANGE;
    const foe = foeAlong(cast, origin, aim, dist, 0.9);
    if (foe && foe.t < dist) dist = Math.max(0.6, foe.t);
    const end = origin.clone().addScaledVector(aim, dist);
    ctx.vfx.flash(origin, '#ffc58a', 5, 0.18, 10);
    ctx.audio.play('bend_combustion_shot', { position: origin, volume: 1 });
    streak(cast, origin, end, () => detonate(cast, end));
  },
  end(cast) {
    const f = cast.data.focus as { alive: boolean } | undefined;
    if (f && f.alive) {
      f.alive = false;
      cast.caster.humanoid?.setFaceGlow(0);
    }
  },
});

/**
 * The Third Eye marking grants combustionbending: at the start of a journey (or on loading one)
 * a Fire Nation character who bears the eye learns it, and it goes into a free slot.
 */
export class MarkingPerks implements GameSystem {
  private ctx: GameContext | null = null;

  init(ctx: GameContext): void {
    this.ctx = ctx;
    ctx.events.on('appearance:changed', () => this.check(false));
  }

  onSessionStart(ctx: GameContext): void {
    this.ctx = ctx;
    this.check(true);
  }

  private check(quiet: boolean): void {
    const ctx = this.ctx;
    const p = ctx?.player;
    if (!ctx || !p || !ctx.session.active || ctx.session.kind !== 'campaign') return;
    const pr = ctx.progression;
    if (p.appearance.facePaint === 'fire_third_eye' && pr.canBend('fire') && !pr.learned.has(COMBUSTION_ID)) {
      pr.learn(COMBUSTION_ID, 'start', quiet);
      if (!quiet) ctx.events.emit('ui:notify', { text: 'The third eye opens: you can combustionbend.', kind: 'success', duration: 4 });
    }
  }
}

// --- Sounds ----------------------------------------------------------------------

/** Focus: a breath drawn in under a thin whine that climbs. */
registerSound('bend_combustion_focus', (ac, out, t, o) => {
  const s = oscSrc(ac, t, 1.0, 'sine', 320 * o.pitch);
  s.frequency.exponentialRampToValueAtTime(1250 * o.pitch, t + 0.95);
  const g = envGain(ac, t, 0.35, 0.4, 0.25, 0.07 * o.volume);
  s.connect(g).connect(out);
  const { filter } = noiseSrc(ac, o.noise, t, 1.0, 'bandpass', 700 * o.pitch, 0.9);
  filter.frequency.exponentialRampToValueAtTime(1800 * o.pitch, t + 0.9);
  const g2 = envGain(ac, t, 0.4, 0.3, 0.3, 0.12 * o.volume);
  filter.connect(g2).connect(out);
  return 1.05;
});

/** The shot: a sharp crack and a whistle racing away. */
registerSound('bend_combustion_shot', (ac, out, t, o) => {
  const { filter } = noiseSrc(ac, o.noise, t, 0.18, 'highpass', 2600 * o.pitch, 0.7);
  const g = envGain(ac, t, 0.002, 0.03, 0.12, 0.5 * o.volume);
  filter.connect(g).connect(out);
  const w = oscSrc(ac, t, 0.42, 'sine', 2600 * o.pitch);
  w.frequency.exponentialRampToValueAtTime(700 * o.pitch, t + 0.4);
  const g2 = envGain(ac, t, 0.005, 0.08, 0.3, 0.12 * o.volume);
  w.connect(g2).connect(out);
  return 0.45;
});
