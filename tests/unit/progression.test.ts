import { describe, expect, it } from 'vitest';
import '../../src/combat/techniques';
import { allTechniques } from '../../src/combat/CombatSystem';
import { ELEMENTS } from '../../src/core/types';
import { MASTERY_REQUIREMENTS, Progression, SPHERE_TECHNIQUES } from '../../src/progression/Progression';

describe('Progression', () => {
  it('starting element grants its starter techniques only', () => {
    const p = new Progression();
    p.setupNewGame('water');
    expect(p.canBend('water')).toBe(true);
    expect(p.canBend('fire')).toBe(false);
    const learned = [...p.learned.keys()];
    expect(learned.length).toBeGreaterThan(0);
    for (const id of learned) expect(allTechniques().find((t) => t.id === id)?.element).toBe('water');
  });

  it('the sphere awakens once all four elements can be bent; mastery is separate', () => {
    const p = new Progression();
    p.setupNewGame('earth');
    // Mastering one element (lessons, proficiency, trial) does not awaken it.
    p.addProficiency('earth', MASTERY_REQUIREMENTS.earth.proficiency);
    for (let i = 0; i < MASTERY_REQUIREMENTS.earth.lessons; i++) p.completeLesson('earth', `l${i}`);
    p.completeTrial('earth');
    expect(p.mastery.earth.mastered).toBe(true);
    expect(p.elementsSphereUnlocked).toBe(false);
    // Three elements are not enough...
    p.unlockElement('water', true);
    p.unlockElement('fire', true);
    expect(p.elementsSphereUnlocked).toBe(false);
    expect([...p.learned.keys()].some((id) => id.startsWith('ult_'))).toBe(false);
    // ...the fourth awakens it, with no other element mastered.
    p.unlockElement('air', true);
    expect(p.elementsSphereUnlocked).toBe(true);
    for (const id of SPHERE_TECHNIQUES) expect(p.knows(id), id).toBe(true);
    for (const e of ['water', 'fire', 'air'] as const) expect(p.mastery[e].mastered).toBe(false);
  });

  it('an older save that bends all four elements gets the sphere on load', () => {
    const p = new Progression();
    p.setupNewGame('water');
    const data = JSON.parse(JSON.stringify(p.serialize()));
    data.unlocked = [...ELEMENTS];
    data.sphere = false;
    const q = new Progression();
    q.reset();
    q.deserialize(data);
    expect(q.elementsSphereUnlocked).toBe(true);
    for (const id of SPHERE_TECHNIQUES) expect(q.knows(id), id).toBe(true);
    // ...and one that does not stays sealed.
    data.unlocked = ['water', 'earth', 'fire'];
    const r = new Progression();
    r.reset();
    r.deserialize(data);
    expect(r.elementsSphereUnlocked).toBe(false);
  });

  it('serialize/deserialize preserves masteries and the sphere', () => {
    const p = new Progression();
    p.setupNewGame('fire');
    p.debugMasterAll();
    const data = JSON.parse(JSON.stringify(p.serialize()));
    const q = new Progression();
    q.reset();
    q.deserialize(data);
    expect(q.elementsSphereUnlocked).toBe(true);
    for (const e of ELEMENTS) expect(q.mastery[e].mastered).toBe(true);
    expect(q.startingElement).toBe('fire');
  });

  it('every element has distinct basic and heavy techniques', () => {
    for (const e of ELEMENTS) {
      const defs = allTechniques().filter((t) => t.element === e);
      expect(defs.some((d) => d.kind === 'basic')).toBe(true);
      expect(defs.some((d) => d.kind === 'heavy')).toBe(true);
    }
  });
});
