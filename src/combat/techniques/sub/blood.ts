import type { GameContext } from '../../../core/GameContext';
import { BLOOD } from '../../../data/subskills';
import type { BloodbendingSystem } from '../../../subskills/blood/Bloodbending';
import { registerTechnique } from '../../CombatSystem';
import type { Combatant } from '../../types';
import { gate, SOURCE, subSys, type Pre } from './common';

/**
 * Bloodbending (Water sub-skill): Hold, Puppet, Redirect, Second Hold (passive), Release, plus two
 * Legend of Korra extensions that exist only while their flags are on: Psychic Hold (subdue, no
 * hand motions) and Lift. Runtime and rules: src/subskills/blood/Bloodbending.ts.
 * No move here ever deals damage by itself; Redirect turns a held body's own attack on a hostile.
 */

const blood = (ctx: GameContext): BloodbendingSystem | undefined => ctx.extra.get('bloodbending') as BloodbendingSystem | undefined;

const common = {
  element: 'water' as const,
  subSkill: 'blood' as const,
  tier: 4 as const,
  innate: SOURCE.blood,
  airborne: false,
  interruptible: true,
  windup: 0,
  recovery: 0.2,
  movement: 'root' as const,
};

/** Branch gate + vow / strain lock / moon. */
function bloodGate(id: string, c: Combatant, ctx: GameContext): Pre {
  const g = gate(id, c, ctx);
  if (g) return g;
  if (!c.isPlayer) return null;
  return blood(ctx)?.playerGate() ?? null;
}

function needHold(id: string) {
  return (c: Combatant, ctx: GameContext): Pre => gate(id, c, ctx) ?? (blood(ctx)?.holding ? null : { reason: 'state', message: 'You are not holding anyone.' });
}

registerTechnique({
  ...common,
  id: 'blood_hold',
  name: 'Hold',
  kind: 'ability',
  description: 'Under the full moon, seize the water in a living body. Your target freezes — fully aware, unable to move or bend — while your curled hands hold the strings.',
  usage: 'Aim at (or lock on to) a person or animal in sight and press. Full moon only; every hold ends at sunrise. Drains chi while held; breaks if you are hurt. Press again at high Water mastery to seize a second body.',
  icon: '🌕',
  chiCost: BLOOD.hold.chi,
  cooldown: BLOOD.hold.cooldown,
  range: BLOOD.hold.range,
  precheck: (c, ctx) => {
    const g = bloodGate('blood_hold', c, ctx);
    if (g) return g;
    const b = blood(ctx);
    if (!b || !ctx.player || c !== ctx.player) return null;
    if (b.holding >= b.maxHolds(c)) return { reason: 'state', message: b.maxHolds(c) > 1 ? 'You cannot hold more than two.' : 'You can hold only one body (the Second Hold needs higher Water mastery).' };
    if (!b.pickTarget()) return { reason: 'target', message: 'No living body in sight to hold.' };
    return null;
  },
  release(cast) {
    const ctx = cast.ctx;
    const b = blood(ctx);
    if (!b || !cast.isPlayer) return;
    const s = subSys(ctx);
    // An emotional moment can break a vow (and it weighs heavily).
    if (s?.vow === 'kept') s.breakVow();
    const t = b.pickTarget();
    if (t) b.hold(cast.caster, t);
  },
});

registerTechnique({
  ...common,
  id: 'blood_puppet',
  name: 'Puppet',
  kind: 'ability',
  description: 'Work the strings: while you hold someone, your movement steers their body on a short leash — walk, turn, a stiff shove, a grip that opens and drops the weapon. Their bending stays locked.',
  usage: 'While holding: press to take or give back control. Move to walk them; Attack shoves; Aim makes them drop their weapon. You cannot walk an ally or innocent into harm.',
  icon: '🎭',
  chiCost: BLOOD.puppet.chi,
  cooldown: BLOOD.puppet.cooldown,
  range: BLOOD.hold.range,
  precheck: needHold('blood_puppet'),
  release(cast) {
    blood(cast.ctx)?.togglePuppet();
  },
});

registerTechnique({
  ...common,
  id: 'blood_redirect',
  name: 'Redirect',
  kind: 'ability',
  description: 'A held body\'s swing or blast is yours to aim: turn it on another hostile. It never lands on an ally or an innocent.',
  usage: 'While holding: press — the held foe strikes the nearest other hostile.',
  icon: '↪️',
  chiCost: BLOOD.redirect.chi,
  cooldown: BLOOD.redirect.cooldown,
  range: BLOOD.redirect.range,
  precheck: (c, ctx) => {
    const g = needHold('blood_redirect')(c, ctx);
    if (g) return g;
    const b = blood(ctx);
    const h = b?.holds.find((x) => x.holder === c && !x.subdue);
    if (!h || !h.hostile) return { reason: 'target', message: 'Only a hostile body\'s attack can be turned.' };
    return null;
  },
  release(cast) {
    const b = blood(cast.ctx);
    const victim = b?.redirect((e, dmg) => cast.hit(e, { damage: dmg, stagger: 50, knockback: e.position.clone().sub(cast.caster.position).setY(0).normalize().multiplyScalar(5) }));
    if (!victim) cast.ctx.events.emit('ui:notify', { text: 'No other hostile within reach to turn the attack on.', kind: 'warning', duration: 2.5 });
  },
});

registerTechnique({
  ...common,
  id: 'blood_second',
  name: 'Second Hold',
  kind: 'passive',
  description: 'At high Water mastery, hold two bodies at once — as Hama held Aang and Sokka.',
  usage: `Passive: once your Water proficiency reaches ${BLOOD.secondHoldProficiency}, Hold seizes a second body while you hold the first.`,
  icon: '🌕',
  chiCost: 0,
  cooldown: 0,
  range: BLOOD.hold.range,
  release() {
    /* passive */
  },
});

registerTechnique({
  ...common,
  id: 'blood_release',
  name: 'Release',
  kind: 'ability',
  description: 'Let go. The held bodies are their own again.',
  usage: 'Press to end every hold you have.',
  icon: '✋',
  chiCost: 0,
  cooldown: 0,
  movement: 'free',
  range: 0,
  precheck: needHold('blood_release'),
  release(cast) {
    blood(cast.ctx)?.releaseByPlayer('released');
  },
});

// ---- Legend of Korra extensions (flags default off) -----------------------------------------

registerTechnique({
  ...common,
  id: 'blood_psychic',
  name: 'Psychic Hold',
  kind: 'ability',
  description: 'Legend of Korra extension. Without a gesture, barely moving, bring a body to its knees. It can only subdue — no steering, no redirecting.',
  usage: 'Aim at a living body and press. Same moon, chi and strain rules as Hold.',
  icon: '🧠',
  chiCost: BLOOD.hold.chi,
  cooldown: BLOOD.hold.cooldown,
  range: BLOOD.hold.range,
  precheck: (c, ctx) => {
    const g = bloodGate('blood_psychic', c, ctx);
    if (g) return g;
    const b = blood(ctx);
    if (b && b.holding >= b.maxHolds(c)) return { reason: 'state', message: 'You cannot hold more.' };
    return b?.pickTarget() ? null : { reason: 'target', message: 'No living body in sight.' };
  },
  release(cast) {
    const b = blood(cast.ctx);
    const t = b?.pickTarget();
    if (b && t) b.hold(cast.caster, t, { subdue: true });
  },
});

registerTechnique({
  ...common,
  id: 'blood_lift',
  name: 'Lift',
  kind: 'ability',
  description: 'Legend of Korra extension. Raise a held body off its feet and send it a short distance. It lands unhurt.',
  usage: 'While holding: press.',
  icon: '⬆️',
  chiCost: BLOOD.lift.chi,
  cooldown: BLOOD.lift.cooldown,
  range: BLOOD.hold.range,
  precheck: needHold('blood_lift'),
  release(cast) {
    blood(cast.ctx)?.lift();
  },
});
