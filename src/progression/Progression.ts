import type { GameContext, GameSystem } from '../core/GameContext';
import type { Persistable } from '../core/Save';
import { ELEMENTS, ELEMENT_INFO, type Element } from '../core/types';
import { allTechniques, getTechnique } from '../combat/CombatSystem';
import { defaultOrigin, isOrigin, startOption, type OriginId } from '../data/starts';

/**
 * Avatar progression:
 *  - which elements the Avatar can bend (start element + those learned from masters)
 *  - learned techniques and per-element loadouts (4 slots each)
 *  - per-element mastery: proficiency (earned by bending), master lessons and the
 *    element's Mastery Trial. Mastery is distinct from knowing techniques.
 *  - Elements Sphere awakens as soon as the Avatar can bend all four elements (mastery is a
 *    separate, longer road and does not gate it).
 */

export interface MasteryState {
  proficiency: number;
  /** Completed master lesson ids for this element. */
  lessons: string[];
  trialComplete: boolean;
  mastered: boolean;
}

export const MASTERY_REQUIREMENTS: Record<Element, { proficiency: number; lessons: number; trialId: string; trialName: string }> = {
  air: { proficiency: 320, lessons: 3, trialId: 'trial_air', trialName: 'Trial of the Four Winds' },
  water: { proficiency: 320, lessons: 3, trialId: 'trial_water', trialName: 'Trial of the Ocean and Moon' },
  earth: { proficiency: 320, lessons: 3, trialId: 'trial_earth', trialName: 'Trial of the Unmoving Mountain' },
  fire: { proficiency: 320, lessons: 3, trialId: 'trial_fire', trialName: 'Trial of the Eternal Flame' },
};

export const SPHERE_TECHNIQUES = ['ult_hurricane', 'ult_tsunami', 'ult_fire_tornado', 'ult_earthquake', 'ult_cataclysm'];

export const SLOT_COUNT = 4;

function emptyMastery(): MasteryState {
  return { proficiency: 0, lessons: [], trialComplete: false, mastered: false };
}

export class Progression implements Persistable, GameSystem {
  readonly saveKey = 'progression';
  private ctx: GameContext | null = null;
  startingElement: Element = 'air';
  private chosenOrigin: OriginId = 'air';
  readonly unlocked = new Set<Element>();
  readonly learned = new Map<string, { source: string; at: number }>();
  readonly equipped: Record<Element, Array<string | null>> = { air: [], water: [], earth: [], fire: [] };
  readonly mastery: Record<Element, MasteryState> = { air: emptyMastery(), water: emptyMastery(), earth: emptyMastery(), fire: emptyMastery() };
  level = 1;
  xp = 0;
  avatarStateUnlocked = true;
  elementsSphereUnlocked = false;
  /** Sandbox mode (tutorial): everything usable, nothing persists. */
  sandbox = false;

  init(ctx: GameContext): void {
    this.ctx = ctx;
  }

  /**
   * Where the journey began (data/starts.ts): the element's start, or a Water homeland. Always
   * consistent with the starting element (an origin of another element reads as its default).
   */
  get origin(): OriginId {
    return startOption(this.chosenOrigin).element === this.startingElement ? this.chosenOrigin : defaultOrigin(this.startingElement);
  }

  set origin(o: OriginId) {
    this.chosenOrigin = o;
  }

  // ---------------------------------------------------------------------------
  // New game
  // ---------------------------------------------------------------------------

  setupNewGame(start: Element, origin?: OriginId): void {
    this.reset();
    this.startingElement = start;
    this.origin = origin && startOption(origin).element === start ? origin : defaultOrigin(start);
    this.unlockElement(start, true);
  }

  /** Tutorial sandbox: all elements and starter techniques, no persistence. */
  /**
   * Tutorial sandbox: all four elements, every bending technique and the Elements Sphere with its
   * ultimates (never saved, never touches the journey). Starters fill the slots first; the rest go
   * into free slots and the Technique Library. The Avatar State lesson switches the Sphere off
   * while it runs, so that lesson still enters the plain Avatar State.
   */
  setupSandbox(): void {
    this.reset();
    this.sandbox = true;
    for (const e of ELEMENTS) this.unlockElement(e, true);
    // Sub-skill moves (lava, projection, bloodbending) come only from their unlock quests.
    for (const def of allTechniques()) if (!def.subSkill) this.learn(def.id, 'debug', true);
    this.elementsSphereUnlocked = true;
  }

  // ---------------------------------------------------------------------------
  // Queries
  // ---------------------------------------------------------------------------

  knows(id: string): boolean {
    if (this.learned.has(id)) return true;
    const def = getTechnique(id);
    return !!def && this.sandbox && def.kind !== 'ultimate' && def.kind !== 'combined' && !!def.starter;
  }

  canBend(e: Element): boolean {
    return this.unlocked.has(e);
  }

  learnedFor(e: Element): string[] {
    return [...this.learned.keys()].filter((id) => getTechnique(id)?.element === e);
  }

  /** Mastery progress 0..1 combining the three requirements. */
  masteryProgress(e: Element): number {
    const m = this.mastery[e];
    if (m.mastered) return 1;
    const req = MASTERY_REQUIREMENTS[e];
    const p = Math.min(1, m.proficiency / req.proficiency);
    const l = Math.min(1, m.lessons.length / req.lessons);
    const t = m.trialComplete ? 1 : 0;
    return p * 0.4 + l * 0.4 + t * 0.2;
  }

  /** Requirements met except the trial (the grandmaster offers the trial then). */
  trialAvailable(e: Element): boolean {
    const m = this.mastery[e];
    const req = MASTERY_REQUIREMENTS[e];
    return this.unlocked.has(e) && !m.trialComplete && m.proficiency >= req.proficiency && m.lessons.length >= req.lessons;
  }

  get masteredCount(): number {
    return ELEMENTS.filter((e) => this.mastery[e].mastered).length;
  }

  // ---------------------------------------------------------------------------
  // Mutations
  // ---------------------------------------------------------------------------

  unlockElement(e: Element, silent = false): void {
    if (this.unlocked.has(e)) return;
    this.unlocked.add(e);
    for (const def of allTechniques()) {
      if (def.element === e && def.starter) this.learn(def.id, 'start', true);
    }
    if (!silent) {
      this.ctx?.events.emit('element:unlocked', { element: e });
      this.ctx?.events.emit('ui:notify', { text: `You can now bend ${ELEMENT_INFO[e].name}!`, kind: 'avatar', duration: 5 });
    }
    // The fourth element awakens the Elements Sphere.
    this.checkSphere();
  }

  learn(id: string, source: 'start' | 'master' | 'mastery' | 'sphere' | 'quest' | 'debug', silent = false): boolean {
    const def = getTechnique(id);
    if (!def) {
      console.warn(`[Progression] unknown technique ${id}`);
      return false;
    }
    if (this.learned.has(id)) return false;
    this.learned.set(id, { source, at: Date.now() });
    // Auto-equip abilities into a free slot.
    if (def.element !== 'avatar' && (def.kind === 'ability' || def.kind === 'defense' || def.kind === 'movement')) {
      const slots = this.equipped[def.element];
      const free = slots.indexOf(null);
      if (slots.length < SLOT_COUNT) slots.push(id);
      else if (free >= 0) slots[free] = id;
    }
    if (!silent) {
      this.ctx?.events.emit('technique:learned', { id, element: def.element, source });
    }
    return true;
  }

  equip(e: Element, slot: number, id: string | null): void {
    if (slot < 0 || slot >= SLOT_COUNT) return;
    const slots = this.equipped[e];
    while (slots.length < SLOT_COUNT) slots.push(null);
    if (id) {
      const prev = slots.indexOf(id);
      if (prev >= 0) slots[prev] = null;
    }
    slots[slot] = id;
  }

  slotsFor(e: Element): Array<string | null> {
    const s = this.equipped[e];
    const out: Array<string | null> = [];
    for (let i = 0; i < SLOT_COUNT; i++) out.push(s[i] ?? null);
    return out;
  }

  addProficiency(e: Element, amount: number): void {
    if (!this.unlocked.has(e) || amount <= 0) return;
    const m = this.mastery[e];
    const before = Math.floor(this.masteryProgress(e) * 100);
    m.proficiency += amount;
    const after = Math.floor(this.masteryProgress(e) * 100);
    if (after !== before) this.ctx?.events.emit('mastery:progress', { element: e, progress: this.masteryProgress(e) });
    this.addXP(amount * 0.5);
  }

  completeLesson(e: Element, lessonId: string): void {
    const m = this.mastery[e];
    if (m.lessons.includes(lessonId)) return;
    m.lessons.push(lessonId);
    this.ctx?.events.emit('mastery:progress', { element: e, progress: this.masteryProgress(e) });
    this.addXP(60);
    this.checkMastery(e);
  }

  completeTrial(e: Element): void {
    const m = this.mastery[e];
    m.trialComplete = true;
    this.checkMastery(e);
  }

  checkMastery(e: Element): boolean {
    const m = this.mastery[e];
    if (m.mastered) return true;
    const req = MASTERY_REQUIREMENTS[e];
    if (m.proficiency >= req.proficiency && m.lessons.length >= req.lessons && m.trialComplete) {
      m.mastered = true;
      this.ctx?.events.emit('mastery:achieved', { element: e });
      this.ctx?.events.emit('ui:notify', { text: `${ELEMENT_INFO[e].name}bending Mastered`, kind: 'avatar', duration: 6 });
      return true;
    }
    return false;
  }

  /** Unlock the Elements Sphere once the Avatar can bend all four elements (mastered or not). */
  checkSphere(silent = false): boolean {
    if (this.elementsSphereUnlocked) return true;
    if (!ELEMENTS.every((e) => this.unlocked.has(e))) return false;
    this.elementsSphereUnlocked = true;
    for (const id of SPHERE_TECHNIQUES) if (getTechnique(id)) this.learn(id, 'sphere', true);
    if (!silent) this.ctx?.events.emit('elementsSphere:unlocked', {});
    return true;
  }

  addXP(amount: number): void {
    this.xp += amount;
    let need = this.xpForLevel(this.level + 1);
    while (this.xp >= need && this.level < 50) {
      this.level++;
      this.ctx?.events.emit('level:up', { level: this.level });
      need = this.xpForLevel(this.level + 1);
    }
    this.ctx?.events.emit('xp:gained', { amount, total: this.xp });
  }

  xpForLevel(l: number): number {
    return Math.round(120 * Math.pow(l - 1, 1.6));
  }

  /** Debug / acceptance testing: master everything. */
  debugMasterAll(): void {
    for (const e of ELEMENTS) {
      this.unlockElement(e, true);
      const m = this.mastery[e];
      m.proficiency = Math.max(m.proficiency, MASTERY_REQUIREMENTS[e].proficiency);
      while (m.lessons.length < MASTERY_REQUIREMENTS[e].lessons) m.lessons.push(`debug_${e}_${m.lessons.length}`);
      m.trialComplete = true;
      for (const def of allTechniques()) if (def.element === e && !def.subSkill) this.learn(def.id, 'debug', true);
      this.checkMastery(e);
    }
  }

  // ---------------------------------------------------------------------------
  // Persistence
  // ---------------------------------------------------------------------------

  serialize(): unknown {
    if (this.sandbox) return undefined;
    return {
      v: 1,
      start: this.startingElement,
      origin: this.origin,
      unlocked: [...this.unlocked],
      learned: [...this.learned.entries()],
      equipped: this.equipped,
      mastery: this.mastery,
      level: this.level,
      xp: this.xp,
      avatarState: this.avatarStateUnlocked,
      sphere: this.elementsSphereUnlocked,
    };
  }

  deserialize(data: any): void {
    if (!data || typeof data !== 'object') return;
    if (ELEMENTS.includes(data.start)) this.startingElement = data.start;
    // Journeys from before the Water homelands began in the Northern Water Tribe.
    this.origin = isOrigin(data.origin) && startOption(data.origin).element === this.startingElement ? data.origin : defaultOrigin(this.startingElement);
    if (Array.isArray(data.unlocked)) for (const e of data.unlocked) if (ELEMENTS.includes(e)) this.unlocked.add(e);
    if (Array.isArray(data.learned)) {
      for (const entry of data.learned) {
        if (Array.isArray(entry) && typeof entry[0] === 'string') this.learned.set(entry[0], entry[1] ?? { source: 'start', at: 0 });
      }
    }
    // Starter techniques added in newer versions get granted retroactively.
    for (const e of this.unlocked) for (const def of allTechniques()) if (def.element === e && def.starter && !this.learned.has(def.id)) this.learned.set(def.id, { source: 'start', at: 0 });
    if (data.equipped && typeof data.equipped === 'object') {
      for (const e of ELEMENTS) {
        const arr = data.equipped[e];
        if (Array.isArray(arr)) this.equipped[e] = arr.slice(0, SLOT_COUNT).map((x: any) => (typeof x === 'string' && this.learned.has(x) ? x : null));
      }
    }
    if (data.mastery && typeof data.mastery === 'object') {
      for (const e of ELEMENTS) {
        const m = data.mastery[e];
        if (!m) continue;
        this.mastery[e] = {
          proficiency: typeof m.proficiency === 'number' ? m.proficiency : 0,
          lessons: Array.isArray(m.lessons) ? m.lessons.filter((x: any) => typeof x === 'string') : [],
          trialComplete: !!m.trialComplete,
          mastered: !!m.mastered,
        };
      }
    }
    if (typeof data.level === 'number') this.level = Math.max(1, Math.min(50, Math.floor(data.level)));
    if (typeof data.xp === 'number') this.xp = data.xp;
    this.avatarStateUnlocked = data.avatarState !== false;
    this.elementsSphereUnlocked = !!data.sphere;
    if (this.elementsSphereUnlocked) {
      for (const id of SPHERE_TECHNIQUES) if (getTechnique(id) && !this.learned.has(id)) this.learned.set(id, { source: 'sphere', at: 0 });
    } else {
      // Journeys saved when the Sphere still waited for four masteries: bending all four now awakens
      // it (quietly here; the spirit vision plays when the journey resumes).
      this.checkSphere(true);
    }
  }

  reset(): void {
    this.sandbox = false;
    this.startingElement = 'air';
    this.origin = 'air';
    this.unlocked.clear();
    this.learned.clear();
    for (const e of ELEMENTS) {
      this.equipped[e] = [];
      this.mastery[e] = emptyMastery();
    }
    this.level = 1;
    this.xp = 0;
    this.avatarStateUnlocked = true;
    this.elementsSphereUnlocked = false;
  }
}
