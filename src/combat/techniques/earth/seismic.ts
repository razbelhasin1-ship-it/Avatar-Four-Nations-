import * as THREE from 'three';
import type { GameContext } from '../../../core/GameContext';
import type { Entity } from '../../../entities/Entity';
import { effect } from '../../../vfx/effects/loop';
import { beamMaterial, setOpacity } from '../../../vfx/effects/materials';
import { flatRing, ringWall, shared } from '../../../vfx/effects/shapes';
import { registerTechnique } from '../../CombatSystem';
import { bending } from '../bending/runtime';

/**
 * Seismic Sense (passive): stomps and hard landings send a vibration through
 * the ground; nearby enemies, creatures and things tagged 'hidden' light up
 * with markers visible through walls for a few seconds. Emits 'seismic:pulse'.
 */

const REVEAL_KINDS = new Set(['enemy', 'creature', 'target', 'npc']);

registerTechnique({
  id: 'seismic_sense',
  name: 'Seismic Sense',
  element: 'earth',
  kind: 'passive',
  tier: 3,
  description: 'Feel the vibrations of the earth. Every stomp and hard landing reveals nearby enemies and hidden things — even through walls.',
  usage: 'Passive while earthbending: stomping techniques and heavy landings send out a pulse; revealed creatures glow for a few seconds.',
  icon: 'earth',
  chiCost: 0,
  cooldown: 0,
  windup: 0,
  recovery: 0,
  movement: 'free',
  airborne: true,
  interruptible: false,
  range: 0,
  release() {
    /* passive: never cast */
  },
});

function markerColor(e: Entity, ctx: GameContext): string {
  if (e.tags.has('hidden') || e.tags.has('buried')) return '#b9f08a';
  const p = ctx.player;
  if (p && ctx.combat.canHarm(e, p)) return '#ff7a4a';
  if (e.kind === 'creature') return '#ffd27a';
  return '#f0e2b8';
}

function marker(ctx: GameContext, e: Entity, color: string, life: number): void {
  const beamGeo = shared('fx_seismic_beam', () => ringWall(1, 1, 16, 'up'));
  const ringGeo = shared('fx_seismic_ring', () => flatRing(0.75, 1, Math.PI * 2, 32, 'out'));
  const m1 = beamMaterial(color);
  const m2 = beamMaterial(color);
  const beam = new THREE.Mesh(beamGeo, m1);
  const ring = new THREE.Mesh(ringGeo, m2);
  beam.renderOrder = 30;
  ring.renderOrder = 30;
  ctx.vfx.group.add(beam, ring);
  const h = Math.max(1.6, e.height * 1.5);
  let t = 0;
  effect(
    (dt) => {
      t += dt;
      const k = t < 0.15 ? t / 0.15 : t > life - 0.6 ? Math.max(0, (life - t) / 0.6) : 1;
      beam.position.copy(e.position);
      beam.scale.set(e.radius + 0.25, h, e.radius + 0.25);
      ring.position.copy(e.position).setY(e.position.y + 0.05);
      ring.scale.setScalar(e.radius + 0.6 + Math.sin(t * 6) * 0.08);
      setOpacity(m1, 0.75 * k);
      setOpacity(m2, 0.9 * k);
      return t < life && !e.disposed;
    },
    () => {
      beam.removeFromParent();
      ring.removeFromParent();
      m1.dispose();
      m2.dispose();
    },
  );
}

/**
 * Send a seismic pulse from `pos` if the bender has Seismic Sense (player: learned
 * technique; AI: tag 'seismic'). Returns the revealed entities.
 */
export function seismicPulse(ctx: GameContext, caster: Entity, pos: THREE.Vector3, radius: number): Entity[] {
  const isPlayer = caster === ctx.player;
  if (isPlayer ? !ctx.progression.knows('seismic_sense') : !caster.tags.has('seismic')) return [];
  const s = bending.state(caster);
  if (ctx.time.elapsed < s.seismicReady) return [];
  s.seismicReady = ctx.time.elapsed + 1.0;
  const revealed: Entity[] = [];
  for (const e of ctx.entities.queryRadius(pos, radius)) {
    if (e === caster || !e.alive) continue;
    if (!REVEAL_KINDS.has(e.kind) && !e.tags.has('hidden') && !e.tags.has('buried')) continue;
    revealed.push(e);
  }
  if (isPlayer) {
    const ground = pos.clone().setY(pos.y + 0.1);
    ctx.vfx.ring(ground, '#e8cf8a', radius, 0.9, { opacity: 0.35 });
    ctx.vfx.ring(ground, '#fff1c8', radius * 0.6, 0.6, { opacity: 0.3 });
    revealed.forEach((e, i) => {
      // Markers appear as the wave front reaches them.
      const d = e.position.distanceTo(pos);
      const delay = (d / radius) * 0.55;
      let w = 0;
      effect((dt) => {
        w += dt;
        if (w < delay) return true;
        marker(ctx, e, markerColor(e, ctx), 3.2 - i * 0.01);
        return false;
      });
    });
    ctx.audio.play('bend_seismic_pulse', { position: pos, volume: 0.7 });
  }
  ctx.events.emit('seismic:pulse', { position: { x: pos.x, y: pos.y, z: pos.z }, radius, casterId: caster.id, revealed: revealed.map((e) => e.id) });
  return revealed;
}

// Hard landings while earthbending pulse too.
bending.hook({
  init: (ctx) => {
    ctx.events.on('player:landed', (e) => {
      const p = ctx.player;
      if (!p || p.element !== 'earth' || e.speed < 7) return;
      seismicPulse(ctx, p, new THREE.Vector3(e.position.x, e.position.y, e.position.z), Math.min(36, 16 + e.speed));
    });
  },
});
