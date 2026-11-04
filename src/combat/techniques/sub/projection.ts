import type { GameContext } from '../../../core/GameContext';
import { PROJECTION } from '../../../data/subskills';
import type { ProjectionSystem } from '../../../subskills/projection/Projection';
import { registerTechnique } from '../../CombatSystem';
import type { Combatant } from '../../types';
import { slotAction } from '../bending/util';
import { gate, SOURCE, subSys, type Pre } from './common';

/**
 * Spiritual projection (Air sub-skill): Project, Spirit Sight, Bond Lock, Call Out, Return.
 * Project is the move you slot and hold; the other four are used while your spirit is out (the
 * projection HUD shows their keys) and fail if you are not projecting. No move here can harm.
 * Runtime: src/subskills/projection/Projection.ts.
 */

const proj = (ctx: GameContext): ProjectionSystem | undefined => ctx.extra.get('projection') as ProjectionSystem | undefined;

const common = {
  element: 'air' as const,
  subSkill: 'projection' as const,
  tier: 4 as const,
  innate: SOURCE.projection,
  airborne: false,
  interruptible: true,
  windup: 0,
  recovery: 0.1,
  movement: 'free' as const,
  range: 0,
};

function whileProjecting(id: string) {
  return (c: Combatant, ctx: GameContext): Pre => gate(id, c, ctx) ?? (proj(ctx)?.state === 'projecting' ? null : { reason: 'state', message: 'Only while your spirit is out of your body (Project first).' });
}

registerTechnique({
  ...common,
  id: 'spirit_project',
  name: 'Project',
  kind: 'ability',
  description: 'Sit, breathe, and let go: your spirit leaves your body as a translucent figure that passes through walls and water and speaks with people. Your body stays behind, meditating — and defenseless.',
  usage: 'Hold in a quiet place (no enemies, no crowd, no noise) until the spirit rises. Fly with the movement keys; Jump/Dodge to rise and sink. No bending while projecting.',
  icon: '🧘',
  chiCost: PROJECTION.chi,
  cooldown: PROJECTION.cooldown,
  movement: 'root',
  precheck: (c, ctx) => gate('spirit_project', c, ctx) ?? (c.isPlayer ? (proj(ctx)?.quietCheck() ?? null) : { reason: 'state', message: 'Only the Avatar projects here.' }),
  release(cast) {
    const p = proj(cast.ctx);
    if (!p) return;
    const action = cast.isPlayer ? slotAction(cast.ctx, cast) : null;
    if (p.beginMeditation(action) && cast.isPlayer) subSys(cast.ctx)?.noteUse('projection', 'spirit_project');
  },
});

registerTechnique({
  ...common,
  id: 'spirit_sight',
  name: 'Spirit Sight',
  kind: 'ability',
  description: 'While projecting, open your spirit\'s eyes: hidden spirits, spirit traces and sealed doors glow through solid walls, and the closed spaces around you are mapped.',
  usage: 'While projecting: press (the projection HUD shows the key). Lasts a few seconds.',
  icon: '👁️',
  chiCost: 0,
  cooldown: 6,
  precheck: whileProjecting('spirit_sight'),
  release(cast) {
    proj(cast.ctx)?.spiritSight();
  },
});

registerTechnique({
  ...common,
  id: 'spirit_bond',
  name: 'Bond Lock',
  kind: 'ability',
  description: 'Reach for someone you share a strong bond with — a companion, a master who taught you — and your spirit crosses the distance to them in moments, even beyond your usual reach.',
  usage: 'While projecting: press to fly to the bonded character you face (costs focus).',
  icon: '🔗',
  chiCost: 0,
  cooldown: 8,
  precheck: whileProjecting('spirit_bond'),
  release(cast) {
    proj(cast.ctx)?.bondLock();
  },
});

registerTechnique({
  ...common,
  id: 'spirit_call',
  name: 'Call Out',
  kind: 'ability',
  description: 'Speak to a bonded character from afar. They hear you as if you stood beside them — a bonded companion comes to watch over your body.',
  usage: 'While projecting: press (costs focus).',
  icon: '🗣️',
  chiCost: 0,
  cooldown: 10,
  precheck: whileProjecting('spirit_call'),
  release(cast) {
    proj(cast.ctx)?.callOut();
  },
});

registerTechnique({
  ...common,
  id: 'spirit_return',
  name: 'Return',
  kind: 'ability',
  description: 'Follow the streak of light back to your body, wherever it is now.',
  usage: 'While projecting: press. It also happens on its own when your focus runs out or your body is struck.',
  icon: '↩️',
  chiCost: 0,
  cooldown: 0,
  precheck: whileProjecting('spirit_return'),
  release(cast) {
    proj(cast.ctx)?.end('return');
  },
});
