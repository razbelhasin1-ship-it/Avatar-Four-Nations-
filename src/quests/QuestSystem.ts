import * as THREE from 'three';
import type { GameContext, GameSystem } from '../core/GameContext';
import type { GameEvents } from '../core/events';
import type { Persistable } from '../core/Save';
import { QUESTS } from '../data/quests';
import { LANDMARKS } from '../world/WorldLayout';
import type { ObjectiveDef, QuestAction, QuestDef, QuestProgress } from './QuestTypes';

export interface QuestMarker {
  questId: string;
  title: string;
  text: string;
  position: THREE.Vector3;
  tracked: boolean;
  // [additive: training] Non-quest markers (masters ✦, quest props): glyph, colour, compass visibility.
  icon?: string;
  color?: string;
  /** false = map only (not on the HUD compass). */
  compass?: boolean;
}

/**
 * Runs quests defined in data. Objectives progress from game events; reach
 * objectives are polled against the player position.
 */
export class QuestSystem implements GameSystem, Persistable {
  readonly saveKey = 'quests';
  private ctx!: GameContext;
  readonly defs = new Map<string, QuestDef>();
  readonly active = new Map<string, QuestProgress>();
  readonly completed = new Set<string>();
  readonly flags = new Set<string>();
  tracked: string | null = null;
  private pollTimer = 0;
  private subscribed = false;
  /** [additive: training] Extra map/compass markers (known masters, quest props). */
  private markerProviders: Array<() => QuestMarker[]> = [];

  addMarkerProvider(f: () => QuestMarker[]): void {
    this.markerProviders.push(f);
  }

  init(ctx: GameContext): void {
    this.ctx = ctx;
    for (const q of QUESTS) this.register(q);
    if (!this.subscribed) this.subscribe();
  }

  register(q: QuestDef): void {
    this.defs.set(q.id, q);
  }

  private subscribe(): void {
    this.subscribed = true;
    const ev = this.ctx.events;
    const names: Array<keyof GameEvents> = [
      'npc:interact',
      'entity:killed',
      'technique:learned',
      'element:unlocked',
      'mastery:achieved',
      'companion:bonded',
      'location:discovered',
      'item:acquired',
      'training:completed',
      'dialogue:flag',
      'technique:cast',
      'avatarState:changed',
      'water:drawn',
      'creature:trust',
      'region:entered',
      'player:glide',
      'player:dodged',
      'mount:changed',
      'quest:completed',
      // [additive: quests] quest props (bells, braziers, tablets) report through world:interact.
      'world:interact',
    ];
    // [additive: quests] also listen to any other event an `event` objective names.
    for (const q of this.defs.values())
      for (const st of q.steps) for (const o of st.objectives) if (o.type === 'event' && !names.includes(o.event)) names.push(o.event);
    for (const n of names) ev.on(n, (p: any) => this.onEvent(n, p));
  }

  get(id: string): QuestDef | undefined {
    return this.defs.get(id);
  }

  isActive(id: string): boolean {
    return this.active.has(id);
  }

  isComplete(id: string): boolean {
    return this.completed.has(id);
  }

  hasFlag(f: string): boolean {
    return this.flags.has(f);
  }

  setFlag(f: string): void {
    if (this.flags.has(f)) return;
    this.flags.add(f);
    this.ctx.events.emit('dialogue:flag', { flag: f });
  }

  start(id: string): boolean {
    const def = this.defs.get(id);
    if (!def || this.active.has(id) || this.completed.has(id)) return false;
    const prog: QuestProgress = { id, step: 0, counts: [], done: [], startedAt: this.ctx.time.elapsed };
    this.active.set(id, prog);
    this.enterStep(def, prog);
    if (!this.tracked || def.category === 'main') this.track(id);
    this.ctx.events.emit('quest:started', { questId: id });
    this.ctx.events.emit('ui:notify', { text: `New quest: ${def.title}`, kind: 'quest', duration: 4 });
    this.evaluateImmediate(def, prog);
    return true;
  }

  track(id: string | null): void {
    this.tracked = id;
    this.ctx.events.emit('quest:tracked', { questId: id });
  }

  private enterStep(def: QuestDef, prog: QuestProgress): void {
    const step = def.steps[prog.step];
    prog.counts = step.objectives.map(() => 0);
    prog.done = step.objectives.map(() => false);
    if (step.onStart) this.runActions(step.onStart);
  }

  /** Objectives that may already be satisfied (learned technique, etc.). */
  private evaluateImmediate(def: QuestDef, prog: QuestProgress): void {
    const step = def.steps[prog.step];
    if (!step) return;
    step.objectives.forEach((o, i) => {
      if (prog.done[i]) return;
      if (this.stateSatisfied(o)) prog.done[i] = true;
    });
    this.checkStep(def, prog);
  }

  private stateSatisfied(o: ObjectiveDef): boolean {
    const c = this.ctx;
    switch (o.type) {
      case 'learn':
        return c.progression.knows(o.technique);
      case 'element':
        return c.progression.canBend(o.element);
      case 'master':
        return c.progression.mastery[o.element].mastered;
      case 'discover':
        return c.world.discovered.has(o.location);
      case 'flag':
        return this.flags.has(o.flag);
      case 'collect':
        return c.inventory.count(o.item) >= o.count;
      case 'bond':
        return c.companions.bondedCount(o.species) > 0;
      default:
        return false;
    }
  }

  private objectivePosition(o: ObjectiveDef): THREE.Vector3 | null {
    if (o.type === 'reach') {
      if (o.landmark) {
        const l = LANDMARKS.find((l) => l.id === o.landmark);
        if (l) return new THREE.Vector3(l.x, this.ctx.world.heightAt(l.x, l.z), l.z);
      }
      if (o.x !== undefined && o.z !== undefined) return new THREE.Vector3(o.x, this.ctx.world.heightAt(o.x, o.z), o.z);
    }
    if (o.type === 'talk' || o.type === 'training') {
      const id = o.type === 'talk' ? o.npc : o.master;
      if (id) {
        const p = this.ctx.npcs.positionOf(id);
        if (p) return p.clone();
      }
    }
    if (o.type === 'discover') {
      const l = LANDMARKS.find((l) => l.id === o.location);
      if (l) return new THREE.Vector3(l.x, this.ctx.world.heightAt(l.x, l.z), l.z);
    }
    return null;
  }

  private onEvent(name: keyof GameEvents, payload: any): void {
    if (!this.ctx.session.active) return;
    for (const [id, prog] of [...this.active]) {
      const def = this.defs.get(id);
      if (!def) continue;
      const step = def.steps[prog.step];
      if (!step) continue;
      let changed = false;
      step.objectives.forEach((o, i) => {
        if (prog.done[i]) return;
        const inc = this.matches(o, name, payload);
        if (inc > 0) {
          prog.counts[i] += inc;
          const need = 'count' in o && typeof o.count === 'number' ? o.count : 1;
          if (prog.counts[i] >= need) prog.done[i] = true;
          changed = true;
        } else if (this.stateSatisfied(o)) {
          prog.done[i] = true;
          changed = true;
        }
      });
      if (changed) {
        this.ctx.events.emit('quest:updated', { questId: id, stepId: step.id });
        this.checkStep(def, prog);
      }
    }
  }

  private matches(o: ObjectiveDef, name: keyof GameEvents, p: any): number {
    switch (o.type) {
      case 'talk':
        return name === 'npc:interact' && p.npcId === o.npc ? 1 : 0;
      case 'event': {
        if (name !== o.event) return 0;
        if (o.where) for (const [k, v] of Object.entries(o.where)) if (p?.[k] !== v) return 0;
        return 1;
      }
      case 'defeat':
        return name === 'entity:killed' && Array.isArray(p.tags) && p.tags.includes(o.tag) ? 1 : 0;
      case 'learn':
        return name === 'technique:learned' && p.id === o.technique ? 1 : 0;
      case 'element':
        return name === 'element:unlocked' && p.element === o.element ? 1 : 0;
      case 'master':
        return name === 'mastery:achieved' && p.element === o.element ? 1 : 0;
      case 'bond':
        return name === 'companion:bonded' && (!o.species || p.speciesId === o.species) ? 1 : 0;
      case 'discover':
        return name === 'location:discovered' && p.locationId === o.location ? 1 : 0;
      case 'training':
        return name === 'training:completed' && p.success && (!o.master || p.masterId === o.master) && (!o.lesson || p.lessonId === o.lesson) ? 1 : 0;
      case 'flag':
        return name === 'dialogue:flag' && p.flag === o.flag ? 1 : 0;
      case 'cast':
        return name === 'technique:cast' && p.isPlayer && (!o.technique || p.id === o.technique) && (!o.element || p.element === o.element) ? 1 : 0;
      case 'avatarState':
        return name === 'avatarState:changed' && p.active && (!o.sphere || p.sphere) ? 1 : 0;
      case 'collect':
        return name === 'item:acquired' && p.itemId === o.item ? p.count : 0;
      default:
        return 0;
    }
  }

  private checkStep(def: QuestDef, prog: QuestProgress): void {
    const step = def.steps[prog.step];
    if (!step) return;
    const complete = step.any ? prog.done.some(Boolean) : prog.done.every(Boolean);
    if (!complete) return;
    if (step.onComplete) this.runActions(step.onComplete);
    prog.step++;
    if (prog.step >= def.steps.length) {
      this.finish(def);
      return;
    }
    this.enterStep(def, prog);
    this.ctx.events.emit('quest:updated', { questId: def.id, stepId: def.steps[prog.step].id });
    this.evaluateImmediate(def, prog);
  }

  private finish(def: QuestDef): void {
    this.active.delete(def.id);
    this.completed.add(def.id);
    const r = def.rewards;
    if (r) {
      if (r.xp) this.ctx.progression.addXP(r.xp);
      if (r.currency) this.ctx.inventory.addCurrency(r.currency);
      for (const it of r.items ?? []) this.ctx.inventory.add(it.id, it.count);
      for (const c of r.cosmetics ?? []) this.ctx.inventory.unlockCosmetic(c);
      for (const t of r.techniques ?? []) this.ctx.progression.learn(t, 'quest');
    }
    if (this.tracked === def.id) {
      const next = [...this.active.keys()].find((id) => this.defs.get(id)?.category === 'main') ?? [...this.active.keys()][0] ?? null;
      this.track(next);
    }
    this.ctx.events.emit('quest:completed', { questId: def.id });
    this.ctx.events.emit('ui:notify', { text: `Quest complete: ${def.title}`, kind: 'success', duration: 5 });
    this.checkAutoStart();
  }

  runActions(actions: QuestAction[]): void {
    for (const a of actions) {
      try {
        switch (a.type) {
          case 'startQuest':
            this.start(a.quest);
            break;
          case 'setFlag':
            this.setFlag(a.flag);
            break;
          case 'notify':
            this.ctx.events.emit('ui:notify', { text: a.text, kind: 'info' });
            break;
          case 'giveItem':
            this.ctx.inventory.add(a.item, a.count ?? 1);
            break;
          case 'giveCosmetic':
            this.ctx.inventory.unlockCosmetic(a.cosmetic);
            break;
          case 'learn':
            this.ctx.progression.learn(a.technique, 'quest');
            break;
          case 'unlockElement':
            this.ctx.progression.unlockElement(a.element);
            break;
          case 'currency':
            this.ctx.inventory.addCurrency(a.amount);
            break;
          case 'revealLocation':
            this.ctx.world.discovered.add(a.location);
            break;
          case 'takeItem':
            this.ctx.inventory.remove(a.item, a.count ?? 1);
            break;
        }
      } catch (err) {
        console.error('[Quests] action failed', a, err);
      }
    }
  }

  /** Start quests whose autoStart conditions hold. */
  checkAutoStart(): void {
    for (const def of this.defs.values()) {
      if (!def.autoStart || this.active.has(def.id) || this.completed.has(def.id)) continue;
      const a = def.autoStart;
      if (a.startingElement && a.startingElement !== this.ctx.progression.startingElement) continue;
      if (a.afterQuest && !this.completed.has(a.afterQuest)) continue;
      if (a.flag && !this.flags.has(a.flag)) continue;
      if (a.element && !this.ctx.progression.canBend(a.element)) continue;
      if (!a.startingElement && !a.afterQuest && !a.flag && !a.element && !a.always) continue;
      this.start(def.id);
    }
  }

  onSessionStart(): void {
    if (this.ctx.session.kind === 'campaign') this.checkAutoStart();
  }

  update(dt: number): void {
    this.pollTimer -= dt;
    if (this.pollTimer > 0) return;
    this.pollTimer = 0.25;
    const player = this.ctx.player;
    if (!player) return;
    const pos = player.position;
    for (const [id, prog] of [...this.active]) {
      const def = this.defs.get(id)!;
      const step = def.steps[prog.step];
      if (!step) continue;
      let changed = false;
      step.objectives.forEach((o, i) => {
        if (prog.done[i]) return;
        if (o.type === 'reach') {
          const p = this.objectivePosition(o);
          if (p && Math.hypot(p.x - pos.x, p.z - pos.z) < (o.radius ?? 25)) {
            prog.done[i] = true;
            changed = true;
          }
        } else if (this.stateSatisfied(o)) {
          prog.done[i] = true;
          changed = true;
        }
      });
      if (changed) {
        this.ctx.events.emit('quest:updated', { questId: id, stepId: step.id });
        this.checkStep(def, prog);
      }
    }
  }

  /** Current objective text for the HUD (tracked quest). */
  objectiveText(): { title: string; lines: Array<{ text: string; done: boolean; progress?: string }> } | null {
    const id = this.tracked;
    if (!id) return null;
    const def = this.defs.get(id);
    const prog = this.active.get(id);
    if (!def || !prog) return null;
    const step = def.steps[prog.step];
    if (!step) return null;
    return {
      title: def.title,
      lines: step.objectives.map((o, i) => {
        const need = 'count' in o && typeof o.count === 'number' && o.count > 1 ? o.count : 0;
        return { text: o.text, done: prog.done[i], progress: need ? `${Math.min(prog.counts[i], need)}/${need}` : undefined };
      }),
    };
  }

  /** World markers for the map/compass. */
  markers(): QuestMarker[] {
    const out: QuestMarker[] = [];
    for (const [id, prog] of this.active) {
      const def = this.defs.get(id);
      if (!def) continue;
      const step = def.steps[prog.step];
      if (!step) continue;
      step.objectives.forEach((o, i) => {
        if (prog.done[i]) return;
        const p = this.objectivePosition(o);
        if (p) out.push({ questId: id, title: def.title, text: o.text, position: p, tracked: id === this.tracked });
      });
    }
    for (const f of this.markerProviders) {
      try {
        out.push(...f());
      } catch (err) {
        console.error('[Quests] marker provider failed', err);
      }
    }
    return out;
  }

  serialize(): unknown {
    if (this.ctx?.session.kind === 'tutorial') return undefined;
    return { v: 1, active: [...this.active.values()], completed: [...this.completed], flags: [...this.flags], tracked: this.tracked };
  }

  deserialize(data: any): void {
    if (!data || typeof data !== 'object') return;
    if (Array.isArray(data.completed)) for (const id of data.completed) if (typeof id === 'string') this.completed.add(id);
    if (Array.isArray(data.flags)) for (const f of data.flags) if (typeof f === 'string') this.flags.add(f);
    if (Array.isArray(data.active)) {
      for (const p of data.active) {
        const def = p && this.defs.get(p.id);
        if (!def) continue;
        const step = Math.max(0, Math.min(def.steps.length - 1, Number(p.step) || 0));
        const n = def.steps[step].objectives.length;
        const counts = Array.isArray(p.counts) && p.counts.length === n ? p.counts.map(Number) : new Array(n).fill(0);
        const done = Array.isArray(p.done) && p.done.length === n ? p.done.map(Boolean) : new Array(n).fill(false);
        this.active.set(def.id, { id: def.id, step, counts, done, startedAt: 0 });
      }
    }
    this.tracked = typeof data.tracked === 'string' && this.active.has(data.tracked) ? data.tracked : [...this.active.keys()][0] ?? null;
  }

  reset(): void {
    this.active.clear();
    this.completed.clear();
    this.flags.clear();
    this.tracked = null;
  }
}
