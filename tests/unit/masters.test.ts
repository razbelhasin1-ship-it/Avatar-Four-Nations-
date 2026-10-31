import { describe, expect, it } from 'vitest';
import '../../src/combat/techniques';
import { allTechniques, getTechnique } from '../../src/combat/CombatSystem';
import { ACTION_LABELS, keyHints } from '../../src/core/Input';
import { ELEMENTS } from '../../src/core/types';
import { SPECIES } from '../../src/data/creatures';
import { cosmeticById } from '../../src/data/cosmetics';
import { DIALOGUES } from '../../src/data/dialogues';
import { itemById } from '../../src/data/items';
import { AWAKENINGS, FIRST_MASTER, GRANDMASTER, MASTERS, lessonById } from '../../src/data/masters';
import { NPCS } from '../../src/data/npcs';
import { LIFE_NPCS } from '../../src/data/npcs_life';
import { QUESTS } from '../../src/data/quests';
import { QUEST_PROPS } from '../../src/data/quests_props';
import { SHOPS } from '../../src/shop/stock';

const npcIds = new Set<string>([...NPCS.map((n) => n.id), ...LIFE_NPCS.map((n) => n.id), ...MASTERS.map((m) => m.id), ...SHOPS.map((s) => `merchant_${s.id}`)]);

describe('masters & curricula', () => {
  it('every master-taught technique is taught by exactly one lesson, and every lesson teaches a real technique', () => {
    const taught = new Map<string, number>();
    for (const m of MASTERS) for (const l of m.lessons) {
      const def = getTechnique(l.technique);
      expect(def, l.technique).toBeTruthy();
      expect(def!.element).toBe(m.element);
      taught.set(l.technique, (taught.get(l.technique) ?? 0) + 1);
    }
    const masterTechs = allTechniques().filter((t) => t.element !== 'avatar' && !t.starter && !t.innate && t.kind !== 'ultimate' && t.kind !== 'combined');
    for (const t of masterTechs) expect(taught.get(t.id), `${t.id} must be taught once`).toBe(1);
  });

  it('prerequisites exist, belong to the same element and form no cycles', () => {
    for (const m of MASTERS)
      for (const l of m.lessons) {
        for (const r of l.requires ?? []) {
          const f = lessonById(r);
          expect(f, `${l.id} requires ${r}`).toBeTruthy();
          expect(f!.master.element).toBe(m.element);
        }
      }
    const visit = (id: string, seen: Set<string>): void => {
      expect(seen.has(id), `cycle at ${id}`).toBe(false);
      const f = lessonById(id)!;
      for (const r of f.lesson.requires ?? []) visit(r, new Set([...seen, id]));
    };
    for (const m of MASTERS) for (const l of m.lessons) visit(l.id, new Set());
  });

  it('each element: 3 lessons reachable without hidden masters, a grandmaster trial, an awakening', () => {
    for (const e of ELEMENTS) {
      const open = MASTERS.filter((m) => m.element === e && !m.hidden).flatMap((m) => m.lessons);
      expect(open.length, e).toBeGreaterThanOrEqual(3);
      const gm = MASTERS.find((m) => m.id === GRANDMASTER[e])!;
      expect(gm.grandmaster && gm.trial && gm.trial.length >= 2).toBeTruthy();
      expect(MASTERS.find((m) => m.id === FIRST_MASTER[e])?.element).toBe(e);
      expect(getTechnique(AWAKENINGS[e].technique)?.starter).toBe(true);
    }
  });
});

describe('quests, NPCs, dialogues, props, shops', () => {
  it('quests reference existing NPCs, items, cosmetics and quests', () => {
    const qids = new Set(QUESTS.map((q) => q.id));
    expect(qids.size).toBe(QUESTS.length);
    const side = QUESTS.filter((q) => q.id.startsWith('sq_') && !['sq_hermit', 'sq_huu', 'sq_lin'].includes(q.id));
    expect(side.length).toBeGreaterThanOrEqual(12);
    for (const q of QUESTS) {
      for (const s of q.steps) {
        for (const o of s.objectives) {
          if (o.type === 'talk') expect(npcIds.has(o.npc), `${q.id}: npc ${o.npc}`).toBe(true);
          if (o.type === 'training' && o.master) expect(npcIds.has(o.master), `${q.id}: master ${o.master}`).toBe(true);
          if (o.type === 'collect') expect(itemById(o.item), `${q.id}: item ${o.item}`).toBeTruthy();
        }
        for (const a of [...(s.onStart ?? []), ...(s.onComplete ?? [])]) {
          if (a.type === 'startQuest') expect(qids.has(a.quest), `${q.id} starts ${a.quest}`).toBe(true);
          if (a.type === 'takeItem' || a.type === 'giveItem') expect(itemById(a.item)).toBeTruthy();
        }
      }
      for (const it of q.rewards?.items ?? []) expect(itemById(it.id), `${q.id} reward ${it.id}`).toBeTruthy();
      for (const c of q.rewards?.cosmetics ?? []) expect(cosmeticById(c), `${q.id} cosmetic ${c}`).toBeTruthy();
    }
  });

  it('main line: the seek quests start in Avatar-cycle order after the start element (the first is tracked)', () => {
    const cycle = ['water', 'earth', 'fire', 'air'];
    for (const e of ELEMENTS) {
      const q = QUESTS.find((x) => x.id === `mq_avatar_cycle_${e}`)!;
      const starts = q.steps.find((s) => s.id === 'nations')!.onStart!.map((a) => (a.type === 'startQuest' ? a.quest : ''));
      const i = cycle.indexOf(e);
      expect(starts, e).toEqual([1, 2, 3].map((k) => `mq_seek_${cycle[(i + k) % 4]}`));
    }
  });

  it('hints and ability texts name controls through {action} placeholders, never hard-coded keys (touch players see button names)', () => {
    const texts = [...Object.values(AWAKENINGS).map((a) => a.hint), ...MASTERS.flatMap((m) => m.lessons.map((l) => l.hint)), ...SPECIES.flatMap((sp) => sp.bondUnlocks.map((u) => u.description))];
    for (const t of texts) {
      expect(t, t).not.toMatch(/\b(LMB|RMB)\b|Hold Shift|Press [EFQT]\b|\((Q|E|F|T)\)/);
      for (const m of t.matchAll(/\{(\w+)\}/g)) expect(m[1] in ACTION_LABELS, `{${m[1]}} in "${t}"`).toBe(true);
    }
    expect(keyHints({ label: (a) => `<${a}>` }, 'Hold {sprint}, then {nope}')).toBe('Hold <sprint>, then {nope}');
  });

  it('NPC dialogues exist and dialogue quest actions reference real quests/items', () => {
    const dl = new Map(DIALOGUES.map((d) => [d.id, d]));
    const qids = new Set(QUESTS.map((q) => q.id));
    for (const n of [...NPCS, ...LIFE_NPCS]) if (n.dialogue) expect(dl.has(n.dialogue), `${n.id} → ${n.dialogue}`).toBe(true);
    for (const d of DIALOGUES)
      for (const node of Object.values(d.nodes))
        for (const c of node.choices ?? [])
          for (const a of c.actions ?? []) {
            if (a.type === 'startQuest') expect(qids.has(a.quest), `${d.id} → ${a.quest}`).toBe(true);
            if (a.type === 'giveItem') expect(itemById(a.item)).toBeTruthy();
          }
  });

  it('props and shops reference real quests, items and cosmetics with prices', () => {
    const qids = new Set(QUESTS.map((q) => q.id));
    for (const p of QUEST_PROPS) {
      if (p.quest) expect(qids.has(p.quest), p.id).toBe(true);
      if (p.startQuest) expect(qids.has(p.startQuest), p.id).toBe(true);
      if (p.item) expect(itemById(p.item), p.id).toBeTruthy();
      if (p.step) expect(QUESTS.find((q) => q.id === p.quest)!.steps.some((s) => s.id === p.step), `${p.id} step ${p.step}`).toBe(true);
    }
    for (const s of SHOPS) {
      for (const i of s.items) expect(itemById(i)?.price, `${s.id}: ${i}`).toBeGreaterThan(0);
      for (const c of s.cosmetics ?? []) expect(cosmeticById(c)?.price, `${s.id}: ${c}`).toBeGreaterThan(0);
    }
  });
});
