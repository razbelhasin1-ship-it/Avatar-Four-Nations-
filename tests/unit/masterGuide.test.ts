import { describe, expect, it } from 'vitest';
import { MASTERS } from '../../src/data/masters';
import { buildMasterGuideQuests, clueOf, isGuideQuest, learnQuestId, ROUTE_HINTS, seekQuestId } from '../../src/data/quests_masters';
import { QUEST_PROPS } from '../../src/data/quests_props';
import { nextWaypoint, planRoute, routeLength } from '../../src/quests/RoutePlanner';
import { heightAt } from '../../src/world/Heightfield';

/** Finding the masters: a guide to every master and every ability, and road routes that make sense. */

const quests = buildMasterGuideQuests((id) => `T(${id})`);
const ids = new Set(MASTERS.map((m) => m.id));

describe('master guides', () => {
  it('one "Seek" guide per master and one "Learn" guide per ability, all unique', () => {
    expect(new Set(quests.map((q) => q.id)).size).toBe(quests.length);
    for (const m of MASTERS) {
      expect(quests.some((q) => q.id === seekQuestId(m.id)), m.id).toBe(true);
      for (const l of m.lessons) expect(quests.some((q) => q.id === learnQuestId(l.id)), l.id).toBe(true);
    }
    expect(quests.length).toBe(MASTERS.length + MASTERS.reduce((n, m) => n + m.lessons.length, 0));
    for (const q of quests) expect(isGuideQuest(q.id), q.id).toBe(true);
  });

  it('every guide leads somewhere real: master NPCs, their lessons, a way there in words', () => {
    for (const m of MASTERS) expect(ROUTE_HINTS[m.region], m.region).toBeTruthy();
    for (const q of quests) {
      expect(q.steps.length).toBeGreaterThan(1);
      for (const s of q.steps)
        for (const o of s.objectives) {
          if (o.type === 'talk') expect(ids.has(o.npc), `${q.id} talks to ${o.npc}`).toBe(true);
          if (o.type === 'training' && o.master) expect(ids.has(o.master), `${q.id} trains with ${o.master}`).toBe(true);
          if (o.type === 'reach') expect(o.spot || o.landmark || (o.x !== undefined && o.z !== undefined), `${q.id} reach has a place`).toBeTruthy();
        }
      // The last step is meeting the master or learning the ability.
      const last = q.steps[q.steps.length - 1];
      expect(last.objectives.some((o) => o.type === 'talk' || o.type === 'learn'), q.id).toBe(true);
    }
  });

  it('a hidden master\'s guide starts with the clue that reveals them', () => {
    for (const m of MASTERS.filter((x) => x.hidden)) {
      const c = clueOf(m);
      expect(c, m.id).not.toBeNull();
      expect(QUEST_PROPS.some((p) => p.at.spot === c!.spot && p.flag === m.hidden!.flag), m.id).toBe(true);
      const q = quests.find((x) => x.id === seekQuestId(m.id))!;
      expect(q.steps[0].id).toBe('rumour');
      // Reading the clue is the whole step (an already-read clue skips it), and it is located at the clue.
      expect(q.steps[0].objectives).toEqual([expect.objectContaining({ type: 'flag', flag: m.hidden!.flag, spot: c!.spot })]);
    }
  });

  it('an ability that builds on another lesson asks for that one first', () => {
    const withReq = MASTERS.flatMap((m) => m.lessons.filter((l) => l.requires?.length));
    expect(withReq.length).toBeGreaterThan(0);
    for (const l of withReq) {
      const q = quests.find((x) => x.id === learnQuestId(l.id))!;
      for (const r of l.requires!) expect(q.steps.some((s) => s.id === `prereq_${r}`), `${l.id} needs ${r}`).toBe(true);
    }
  });
});

describe('road routes', () => {
  // Metres of sea walked (the Western Causeway bridge span does not count: it is a bridge).
  const water = (r: Array<{ x: number; z: number }>) => {
    let w = 0;
    for (let i = 1; i < r.length; i++) {
      const bridge = Math.hypot(r[i - 1].x + 780, r[i - 1].z - 700) < 1 && Math.hypot(r[i].x + 940, r[i].z - 960) < 1;
      if (bridge) continue;
      const n = Math.ceil(Math.hypot(r[i].x - r[i - 1].x, r[i].z - r[i - 1].z) / 20);
      for (let k = 0; k < n; k++) if (heightAt(r[i - 1].x + ((r[i].x - r[i - 1].x) * k) / n, r[i - 1].z + ((r[i].z - r[i - 1].z) * k) / n) < 0) w += 20;
    }
    return w;
  };
  const via = (r: Array<{ x: number; z: number }>, x: number, z: number) => r.some((p) => Math.hypot(p.x - x, p.z - z) < 1);

  it('the Fire Nation is reached over the Western Causeway, not across the sea', () => {
    for (const from of [{ x: -220, z: -1600 }, { x: 230, z: 1585 }, { x: 850, z: -50 }]) {
      const r = planRoute(from, { x: -1290, z: 1558 });
      expect(via(r, -780, 700) && via(r, -940, 960), JSON.stringify(r)).toBe(true);
      expect(water(r), 'metres of sea on the way').toBeLessThan(120);
    }
  });

  it('long trips follow the roads; short ones go straight', () => {
    const sat = planRoute({ x: 850, z: -50 }, { x: 1418, z: 1217 });
    expect(via(sat, 1300, 250) && via(sat, 1210, 980)).toBe(true); // the Eastern Road
    const near = planRoute({ x: 700, z: 30 }, { x: 710, z: 40 });
    expect(near.length).toBe(2);
    expect(routeLength(near)).toBeLessThan(20);
  });

  it('every master can be routed to from the four corners of the world', () => {
    for (const m of MASTERS) {
      for (const from of [{ x: -220, z: -1600 }, { x: 230, z: 1585 }, { x: 1418, z: 1217 }, { x: -1290, z: 1558 }]) {
        const r = planRoute(from, { x: m.fallback.x, z: m.fallback.z });
        expect(r.length).toBeGreaterThanOrEqual(2);
        expect(routeLength(r)).toBeLessThan(Math.hypot(from.x - m.fallback.x, from.z - m.fallback.z) * 2.2 + 50);
      }
    }
  });

  it('the next waypoint is the next road point ahead', () => {
    const r = planRoute({ x: 850, z: -50 }, { x: 1418, z: 1217 });
    const n = nextWaypoint(r, { x: 850, z: -50 });
    expect(n).toEqual({ x: 1260, z: -50 });
    const later = nextWaypoint(r, { x: 1280, z: 100 });
    expect(later).toEqual({ x: 1300, z: 250 });
  });
});
