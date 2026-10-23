import { describe, expect, it } from 'vitest';
import '../../src/combat/techniques';
import { allTechniques } from '../../src/combat/CombatSystem';
import { ELEMENTS } from '../../src/core/types';
import { MASTERY_REQUIREMENTS, Progression } from '../../src/progression/Progression';

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

  it('knowing techniques is not mastery; the sphere needs all four masteries', () => {
    const p = new Progression();
    p.setupNewGame('earth');
    for (const e of ELEMENTS) p.unlockElement(e, true);
    expect(p.elementsSphereUnlocked).toBe(false);
    for (const e of ELEMENTS.slice(0, 3)) {
      p.addProficiency(e, MASTERY_REQUIREMENTS[e].proficiency);
      for (let i = 0; i < MASTERY_REQUIREMENTS[e].lessons; i++) p.completeLesson(e, `l${i}`);
      p.completeTrial(e);
      expect(p.mastery[e].mastered).toBe(true);
    }
    expect(p.elementsSphereUnlocked).toBe(false);
    const last = ELEMENTS[3];
    p.addProficiency(last, MASTERY_REQUIREMENTS[last].proficiency);
    for (let i = 0; i < MASTERY_REQUIREMENTS[last].lessons; i++) p.completeLesson(last, `l${i}`);
    expect(p.mastery[last].mastered).toBe(false); // trial still missing
    p.completeTrial(last);
    expect(p.elementsSphereUnlocked).toBe(true);
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
