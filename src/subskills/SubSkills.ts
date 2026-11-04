import * as THREE from 'three';
import type { LoopHandle } from '../audio/AudioEngine';
import { getTechnique } from '../combat/CombatSystem';
import type { Combatant, TechniqueDef } from '../combat/types';
import type { GameContext, GameSystem } from '../core/GameContext';
import { FEATURES, type FeatureName } from '../core/features';
import type { Persistable } from '../core/Save';
import type { TechniqueFailReason } from '../core/types';
import { KORRA_TECHNIQUES, MOON, REACTIONS, STRAIN, STRAIN_STAGES, SUB_SKILL_IDS, SUB_SKILLS, type SubSkillId } from '../data/subskills';
import { h } from '../ui/dom';
import type { MoonSystem } from './Moon';
import './sounds';

export type StrainStage = 'calm' | 'unease' | 'dark' | 'breaking';
export type VowState = 'none' | 'kept' | 'broken';
type Gate = { reason: TechniqueFailReason; message: string } | null;
const tmpA = new THREE.Vector3();
const tmpB = new THREE.Vector3();

/**
 * Specialized bending: which branches are unlocked, the bloodbending vow and Moral Strain.
 *
 * - A branch stays locked until its parent element is mastered AND its unlock quest is done
 *   (never XP alone). Mastering the parent only makes the quest available (flag
 *   `subskill_<id>_eligible`, which auto-starts it: src/data/quests_subskills.ts).
 * - Moral Strain (0-100) rises with every bloodbending use, faster against people who are not
 *   hostile, and falls slowly with rest, meditation and good deeds. Unease -> faint whispers and a
 *   slight desaturation; Dark -> people fear you; Breaking -> bloodbending locks until you meditate
 *   with an elder. It only changes dialogue, reactions and a few audio-visual cues (the game has
 *   no reputation system). The meter appears after the first use.
 * - Story flags mirror the state for dialogue conditions: subskill_<id>, strain_unease /
 *   strain_dark / strain_breaking, blood_vow, blood_vow_broken, blood_witnessed.
 *
 * Persistent (saveKey 'subskills'); old saves load with everything locked.
 * Debug: window.__game.debug.subskills.
 */
export class SubSkillSystem implements GameSystem, Persistable {
  readonly saveKey = 'subskills';
  private ctx!: GameContext;
  readonly unlocked = new Set<SubSkillId>();
  vow: VowState = 'none';
  strain = 0;
  /** The first bloodbending use has happened (shows the meter). */
  strainSeen = false;
  /** Breaking: bloodbending locked until an elder meditation. */
  breakingLock = false;
  /** NPC ids that saw you bloodbend someone. */
  readonly witnesses = new Set<string>();
  /** Legend of Korra extension: moonless bloodbending training finished (needs its flag too). */
  moonlessTrained = false;
  /** Moves lent by a quest before its branch unlocks (the lava wave teaches Melt and Divert and Cool). */
  readonly taught = new Set<string>();
  readonly uses: Record<SubSkillId, number> = { lava: 0, projection: 0, blood: 0 };
  private stageNow: StrainStage = 'calm';
  private lastHour = -1;
  private reactT = 0;
  private reactCooldown = 0;
  private meter: HTMLElement | null = null;
  private meterFill: HTMLElement | null = null;
  private meterLabel: HTMLElement | null = null;
  private whisper: LoopHandle | null = null;
  /** Scripted story beats can open the window in which the vow may be broken. */
  emotionalMomentUntil = -1;

  init(ctx: GameContext): void {
    this.ctx = ctx;
    ctx.events.on('mastery:achieved', () => this.checkEligibility());
    ctx.events.on('quest:completed', (e) => {
      // Bloodbending: only the player who really bent Hama's blood leaves "The Puppetmaster" a
      // bloodbender; refusing leaves it locked (Hama can still teach it in custody).
      if (e.questId === 'sq_puppetmaster') {
        if (ctx.quests.hasFlag('pm_bloodbender')) this.unlock('blood', 'quest');
      } else if (e.questId === 'sq_hama_custody') this.unlock('blood', 'quest');
      else if (e.questId === 'sq_tide_without_moon') this.moonlessTrained = true;
      else for (const id of SUB_SKILL_IDS) if (SUB_SKILLS[id].unlockQuest === e.questId) this.unlock(id, 'quest');
      if (!e.questId.startsWith('mq_awakening')) this.relieve(STRAIN.goodDeed);
    });
    ctx.events.on('world:interact', (e) => {
      if (e.kind === 'quest_meditate' || e.kind === 'meditate') this.relieve(STRAIN.meditation);
    });
    ctx.events.on('settings:changed', () => this.applyCues(true));
    this.buildMeter();
    this.installDebug();
  }

  onSessionStart(ctx: GameContext): void {
    this.lastHour = -1;
    this.checkEligibility();
    this.syncKorraTechniques();
    this.syncFlags();
    this.applyCues(true);
    void ctx;
  }

  onSessionEnd(): void {
    this.stopWhisper();
    this.setCanvasFilter('');
  }

  // ---------------------------------------------------------------------------
  // Unlocks
  // ---------------------------------------------------------------------------

  isUnlocked(id: SubSkillId): boolean {
    return this.unlocked.has(id);
  }

  /** Parent mastered: the unlock quest becomes available. */
  eligible(id: SubSkillId): boolean {
    return !!this.ctx.progression.mastery[SUB_SKILLS[id].parent]?.mastered;
  }

  private checkEligibility(): void {
    if (this.ctx.session.kind !== 'campaign') return;
    let any = false;
    for (const id of SUB_SKILL_IDS) {
      const f = `subskill_${id}_eligible`;
      if (this.eligible(id) && !this.ctx.quests.hasFlag(f)) {
        this.ctx.quests.setFlag(f);
        any = true;
      }
    }
    // Quest auto-start conditions are only re-checked at session start and on quest completion.
    if (any) this.ctx.quests.checkAutoStart();
  }

  /** Unlock a branch: learn its moves (quests call this on completion; debug may force it). */
  unlock(id: SubSkillId, source: 'quest' | 'debug' = 'quest'): boolean {
    const def = SUB_SKILLS[id];
    if (!def) return false;
    const fresh = !this.unlocked.has(id);
    this.unlocked.add(id);
    for (const a of def.abilities) this.ctx.progression.learn(a.technique, source === 'debug' ? 'debug' : 'quest', !fresh);
    this.syncKorraTechniques();
    this.ctx.quests.setFlag(def.unlockedFlag);
    if (fresh) {
      this.ctx.events.emit('subskill:unlocked', { id });
      this.ctx.events.emit('ui:notify', { text: `${def.name} awakened — a new branch of ${def.parent}bending (Technique Library, K).`, kind: 'learn', duration: 5 });
    }
    return fresh;
  }

  /** Debug/tests: lock a branch again and forget its moves. */
  lock(id: SubSkillId): void {
    this.unlocked.delete(id);
    const pr = this.ctx.progression;
    for (const t of [...SUB_SKILLS[id].abilities.map((a) => a.technique), ...Object.keys(KORRA_TECHNIQUES)]) {
      if (getTechnique(t)?.subSkill !== id) continue;
      pr.learned.delete(t);
      for (const slots of Object.values(pr.equipped)) for (let i = 0; i < slots.length; i++) if (slots[i] === t) slots[i] = null;
    }
    this.ctx.quests.flags.delete(SUB_SKILLS[id].unlockedFlag);
  }

  /** A quest lends one move before the branch unlocks (learned and usable; kept after unlocking). */
  teach(techniqueId: string): void {
    this.taught.add(techniqueId);
    this.ctx.progression.learn(techniqueId, 'quest', true);
  }

  korraFlag(name: FeatureName): boolean {
    return !!FEATURES[name];
  }

  /** Legend of Korra moves exist only while their flag is on. */
  korraAvailable(techniqueId: string): boolean {
    const f = KORRA_TECHNIQUES[techniqueId];
    return !f || this.korraFlag(f);
  }

  /** Learn flagged Korra moves when their branch is unlocked and the flag is on; forget them when off. */
  syncKorraTechniques(): void {
    const pr = this.ctx.progression;
    for (const [tech, flag] of Object.entries(KORRA_TECHNIQUES)) {
      const def = getTechnique(tech);
      if (!def?.subSkill) continue;
      if (this.unlocked.has(def.subSkill) && this.korraFlag(flag)) pr.learn(tech, 'quest', true);
      else if (pr.learned.has(tech)) {
        pr.learned.delete(tech);
        for (const slots of Object.values(pr.equipped)) for (let i = 0; i < slots.length; i++) if (slots[i] === tech) slots[i] = null;
      }
    }
  }

  /** Toggle a Korra flag at runtime (debug). */
  setKorraFlag(name: FeatureName, on: boolean): void {
    (FEATURES as Record<string, boolean>)[name] = on;
    this.syncKorraTechniques();
  }

  /**
   * Shared gate for every sub-skill move (TechniqueDef.precheck): the player must have the
   * branch; Korra moves need their flag. NPC casters (Hama) are not gated here.
   */
  gate(def: TechniqueDef, caster: Combatant): Gate {
    if (!def.subSkill) return null;
    if (!this.korraAvailable(def.id)) return { reason: 'locked', message: 'A Legend of Korra extension that is switched off.' };
    if (!caster.isPlayer) return null;
    if (!this.unlocked.has(def.subSkill) && !this.taught.has(def.id)) return { reason: 'locked', message: `${SUB_SKILLS[def.subSkill].name} is not unlocked.` };
    return null;
  }

  noteUse(id: SubSkillId, technique: string): void {
    this.uses[id]++;
    this.ctx.events.emit('subskill:used', { id, technique });
  }

  // ---------------------------------------------------------------------------
  // Moral Strain
  // ---------------------------------------------------------------------------

  get stage(): StrainStage {
    return this.stageNow;
  }

  static stageOf(v: number): StrainStage {
    return v >= STRAIN.breaking ? 'breaking' : v >= STRAIN.dark ? 'dark' : v >= STRAIN.unease ? 'unease' : 'calm';
  }

  addStrain(n: number): void {
    if (n <= 0) return;
    this.strainSeen = true;
    this.setStrain(this.strain + n);
  }

  relieve(n: number): void {
    if (n <= 0 || this.strain <= 0) return;
    this.setStrain(this.strain - n);
  }

  setStrain(v: number): void {
    const prev = this.stageNow;
    this.strain = Math.max(0, Math.min(STRAIN.max, v));
    this.stageNow = SubSkillSystem.stageOf(this.strain);
    if (this.stageNow === 'breaking') this.breakingLock = true;
    if (this.stageNow !== prev) {
      this.ctx.events.emit('strain:changed', { value: this.strain, stage: this.stageNow });
      const order: StrainStage[] = ['calm', 'unease', 'dark', 'breaking'];
      if (order.indexOf(this.stageNow) > order.indexOf(prev) && this.ctx.session.active) {
        const st = STRAIN_STAGES.find((s) => s.id === this.stageNow)!;
        this.ctx.events.emit('ui:notify', { text: `Moral Strain: ${st.label}. ${st.note}`, kind: this.stageNow === 'breaking' ? 'error' : 'warning', duration: 5 });
      }
      this.syncFlags();
      this.applyCues(false);
    }
    this.updateMeter();
  }

  /** Meditating with a Water Tribe elder: lifts the Breaking lock and eases the mind. */
  elderMeditation(): void {
    this.breakingLock = false;
    this.setStrain(Math.min(this.strain, STRAIN.elderFloor));
    this.ctx.events.emit('ui:notify', { text: 'You meditate with the elder. The whispers fade.', kind: 'success', duration: 4 });
  }

  // ---------------------------------------------------------------------------
  // Vow
  // ---------------------------------------------------------------------------

  takeVow(): void {
    this.vow = 'kept';
    this.ctx.quests.setFlag('blood_vow');
    this.ctx.events.emit('subskill:vow', { state: 'kept' });
    this.ctx.events.emit('ui:notify', { text: 'You vow never to bloodbend again. Bloodbending is sealed.', kind: 'info', duration: 5 });
  }

  /** A vowed player may break the vow only in an emotional story moment. */
  get emotionalMoment(): boolean {
    const ctx = this.ctx;
    if (ctx.time.elapsed < this.emotionalMomentUntil) return true;
    const p = ctx.player;
    const moon = ctx.extra.get('moon') as MoonSystem | undefined;
    // Cornered under the full moon: badly hurt with a foe close by.
    if (!p?.health || !moon?.fullMoonUp) return false;
    if (p.health.fraction > 0.25) return false;
    for (const e of ctx.entities.queryRadius(p.position, 12)) if (e.team === 'hostile' && e.alive) return true;
    return false;
  }

  breakVow(): void {
    if (this.vow !== 'kept') return;
    this.vow = 'broken';
    this.ctx.quests.setFlag('blood_vow_broken');
    this.ctx.events.emit('subskill:vow', { state: 'broken' });
    this.addStrain(STRAIN.vowBroken);
    this.ctx.ui.showBanner('You broke your vow.', 'The moon pulls at something you swore to leave alone.');
  }

  // ---------------------------------------------------------------------------
  // Witnesses & reactions
  // ---------------------------------------------------------------------------

  /** People who can see the held body react with fear (and remember); enemies turn hostile. */
  witnessHold(x: number, z: number): number {
    const ctx = this.ctx;
    let n = 0;
    const r = STRAIN.witnessRadius;
    for (const npc of ctx.npcs.liveNPCs()) {
      const d = Math.hypot(npc.position.x - x, npc.position.z - z);
      if (d > r || npc.talking) continue;
      if (!this.canSee(npc.position.x, npc.position.y + 1.6, npc.position.z, x, z)) continue;
      this.witnesses.add(npc.def.id);
      n++;
    }
    if (n > 0) {
      ctx.quests.setFlag('blood_witnessed');
      ctx.npcs.alarm(x, z, r);
      const lines = REACTIONS.find((rr) => rr.trigger === 'bloodHold' && rr.who === 'npc')?.lines ?? [];
      if (lines.length) ctx.events.emit('ui:notify', { text: `“${lines[Math.floor(Math.random() * lines.length)]}”`, kind: 'warning', duration: 3 });
    }
    return n;
  }

  private canSee(ax: number, ay: number, az: number, bx: number, bz: number): boolean {
    const by = this.ctx.world.heightAt(bx, bz) + 1.2;
    const dx = bx - ax, dy = by - ay, dz = bz - az;
    const len = Math.hypot(dx, dy, dz);
    if (len < 1) return true;
    const hit = this.ctx.world.raycast(tmpA.set(ax, ay, az), tmpB.set(dx / len, dy / len, dz / len), len - 0.5);
    return !hit;
  }

  // ---------------------------------------------------------------------------
  // Frame
  // ---------------------------------------------------------------------------

  update(dt: number, ctx: GameContext): void {
    if (ctx.session.kind !== 'campaign') return;
    // Rest: strain falls slowly with every in-game hour without bloodbending.
    const hr = ctx.world.sky?.timeOfDay ?? 12;
    if (this.lastHour >= 0 && this.strain > 0) {
      let dh = hr - this.lastHour;
      if (dh < -12) dh += 24;
      if (dh > 0 && dh < 12 && !this.holdingNow()) this.relieve(dh * STRAIN.restPerHour);
    }
    this.lastHour = hr;
    // Dark: people near you shrink back.
    this.reactCooldown -= dt;
    this.reactT -= dt;
    if (this.reactT <= 0) {
      this.reactT = 1.2;
      if ((this.stageNow === 'dark' || this.stageNow === 'breaking') && ctx.player) this.darkReactions(ctx);
    }
  }

  private holdingNow(): boolean {
    const blood = this.ctx.extra.get('bloodbending') as { holding?: number } | undefined;
    return !!blood?.holding;
  }

  private darkReactions(ctx: GameContext): void {
    const p = ctx.player!.position;
    const rx = REACTIONS.find((r) => r.trigger === 'strainDark');
    if (!rx) return;
    let near = false;
    for (const npc of ctx.npcs.liveNPCs()) {
      if (npc.talking || npc.def.role === 'master') continue;
      if (Math.hypot(npc.position.x - p.x, npc.position.z - p.z) < rx.radius) {
        near = true;
        break;
      }
    }
    if (!near) return;
    ctx.npcs.alarm(p.x, p.z, rx.radius);
    if (this.reactCooldown <= 0 && rx.lines?.length) {
      this.reactCooldown = 25;
      ctx.events.emit('ui:notify', { text: `“${rx.lines[Math.floor(Math.random() * rx.lines.length)]}”`, kind: 'info', duration: 2.5 });
    }
  }

  // ---------------------------------------------------------------------------
  // Cues: desaturation, whispers, meter
  // ---------------------------------------------------------------------------

  private setCanvasFilter(f: string): void {
    const c = this.ctx.render?.renderer?.domElement as HTMLCanvasElement | undefined;
    if (c && c.style.filter !== f) c.style.filter = f;
  }

  private applyCues(force: boolean): void {
    if (!this.ctx.session.active || this.ctx.session.kind !== 'campaign') {
      this.setCanvasFilter('');
      this.stopWhisper();
      return;
    }
    const calm = this.ctx.settings.data.gameplay.reduceIntenseEffects;
    const st = this.stageNow;
    const sat = st === 'unease' ? 0.88 : st === 'dark' ? 0.74 : st === 'breaking' ? 0.62 : 1;
    const eff = calm ? 1 - (1 - sat) * 0.5 : sat;
    this.setCanvasFilter(eff < 1 ? `saturate(${eff.toFixed(2)})` : '');
    if (st === 'calm') this.stopWhisper();
    else if (!this.whisper || force) {
      this.stopWhisper();
      const vol = st === 'unease' ? 0.08 : st === 'dark' ? 0.14 : 0.2;
      try {
        this.whisper = this.ctx.audio.loop('sub.strain.whisper', { volume: calm ? vol * 0.6 : vol });
      } catch {
        this.whisper = null;
      }
    }
    this.updateMeter();
  }

  private stopWhisper(): void {
    try {
      this.whisper?.stop(0.8);
    } catch {
      /* already stopped */
    }
    this.whisper = null;
  }

  private buildMeter(): void {
    if (typeof document === 'undefined' || !this.ctx.ui?.layers) return;
    injectCSS();
    this.meterFill = h('div.strain-fill');
    this.meterLabel = h('span.strain-lb', 'Calm');
    this.meter = h('div.strain-meter.hidden', { title: 'Moral Strain — bloodbending weighs on the mind' }, h('div.strain-top', h('span', 'Strain'), this.meterLabel), h('div.strain-bar', this.meterFill, h('i.t1'), h('i.t2'), h('i.t3')));
    this.ctx.ui.layers.hud.appendChild(this.meter);
  }

  private updateMeter(): void {
    if (!this.meter) return;
    const show = this.strainSeen && this.ctx.session.active && this.ctx.session.kind === 'campaign';
    this.meter.classList.toggle('hidden', !show);
    if (!show) return;
    this.meterFill!.style.transform = `scaleX(${(this.strain / STRAIN.max).toFixed(3)})`;
    const st = STRAIN_STAGES.find((s) => s.id === this.stageNow)!;
    this.meterLabel!.textContent = st.label + (this.breakingLock && this.stageNow !== 'breaking' ? ' · locked' : '');
    this.meter.dataset.stage = this.stageNow;
  }

  private syncFlags(): void {
    const q = this.ctx.quests;
    const set = (f: string, on: boolean) => (on ? q.setFlag(f) : q.flags.delete(f));
    const order: StrainStage[] = ['calm', 'unease', 'dark', 'breaking'];
    const i = order.indexOf(this.stageNow);
    set('strain_unease', i >= 1);
    set('strain_dark', i >= 2);
    set('strain_breaking', i >= 3 || this.breakingLock);
    for (const id of SUB_SKILL_IDS) if (this.unlocked.has(id)) q.setFlag(SUB_SKILLS[id].unlockedFlag);
  }

  // ---------------------------------------------------------------------------
  // Persistence
  // ---------------------------------------------------------------------------

  serialize(): unknown {
    return {
      v: 1,
      unlocked: [...this.unlocked],
      vow: this.vow,
      strain: this.strain,
      strainSeen: this.strainSeen,
      breakingLock: this.breakingLock,
      witnesses: [...this.witnesses],
      moonlessTrained: this.moonlessTrained,
      taught: [...this.taught],
      uses: { ...this.uses },
    };
  }

  deserialize(data: unknown): void {
    const d = (data ?? {}) as Record<string, unknown>;
    if (Array.isArray(d.unlocked)) for (const id of d.unlocked) if (SUB_SKILL_IDS.includes(id as SubSkillId)) this.unlocked.add(id as SubSkillId);
    if (d.vow === 'kept' || d.vow === 'broken') this.vow = d.vow;
    if (typeof d.strain === 'number' && Number.isFinite(d.strain)) this.strain = Math.max(0, Math.min(STRAIN.max, d.strain));
    this.strainSeen = d.strainSeen === true;
    this.breakingLock = d.breakingLock === true;
    if (Array.isArray(d.witnesses)) for (const w of d.witnesses) if (typeof w === 'string') this.witnesses.add(w);
    this.moonlessTrained = d.moonlessTrained === true;
    if (Array.isArray(d.taught)) for (const t of d.taught) if (typeof t === 'string') this.taught.add(t);
    const u = d.uses as Record<string, unknown> | undefined;
    if (u) for (const id of SUB_SKILL_IDS) if (typeof u[id] === 'number') this.uses[id] = u[id] as number;
    this.stageNow = SubSkillSystem.stageOf(this.strain);
  }

  reset(): void {
    this.unlocked.clear();
    this.vow = 'none';
    this.strain = 0;
    this.strainSeen = false;
    this.breakingLock = false;
    this.witnesses.clear();
    this.moonlessTrained = false;
    this.taught.clear();
    for (const id of SUB_SKILL_IDS) this.uses[id] = 0;
    this.stageNow = 'calm';
    this.emotionalMomentUntil = -1;
    this.lastHour = -1;
  }

  // ---------------------------------------------------------------------------
  // Debug (dev only)
  // ---------------------------------------------------------------------------

  private installDebug(): void {
    if (typeof window === 'undefined') return;
    const w = window as unknown as { __game?: { debug: Record<string, unknown> } };
    const install = (): boolean => {
      if (!w.__game) return false;
      const ctx = this.ctx;
      const moon = () => ctx.extra.get('moon') as MoonSystem | undefined;
      w.__game.debug.subskills = {
        sys: this,
        /** Unlock a branch (lava | projection | blood), skipping its quest. */
        unlock: (id: SubSkillId) => this.unlock(id, 'debug'),
        lock: (id: SubSkillId) => this.lock(id),
        state: () => ({
          unlocked: [...this.unlocked],
          eligible: SUB_SKILL_IDS.filter((id) => this.eligible(id)),
          vow: this.vow,
          strain: +this.strain.toFixed(2),
          stage: this.stageNow,
          strainSeen: this.strainSeen,
          breakingLock: this.breakingLock,
          witnesses: [...this.witnesses],
          uses: { ...this.uses },
          korra: { moonless: this.korraFlag('ENABLE_MOONLESS_BLOODBENDING'), psychic: this.korraFlag('ENABLE_PSYCHIC_BLOODBENDING'), lift: this.korraFlag('ENABLE_BLOODBENDING_LIFT') },
          moon: moon() ? { day: moon()!.day, night: moon()!.nightIndex(), phase: moon()!.phaseIndex(), name: moon()!.phaseName(), full: moon()!.isFullMoonNight, up: moon()!.moonUp, fullUp: moon()!.fullMoonUp, boost: moon()!.waterBoost(), nightsToFull: moon()!.nightsToFull(), solstice: moon()!.isSolstice } : null,
        }),
        /** 0 new .. 4 full .. 7. */
        setMoonPhase: (i: number) => {
          moon()?.setPhase(i);
          return moon()?.phaseName();
        },
        /** Jump the clock (hours, 0-24); a forward jump past midnight counts a new day. */
        setHour: (hour: number) => {
          const sky = ctx.world.sky;
          sky.timeOfDay = ((hour % 24) + 24) % 24;
        },
        /** Full moon, risen: set the phase and the hour (default 22:00). */
        fullMoonNight: (hour = 22) => {
          ctx.world.sky.timeOfDay = hour;
          moon()?.setPhase(4);
          return moon()?.fullMoonUp;
        },
        setStrain: (v: number) => {
          if (v > 0) this.strainSeen = true;
          this.breakingLock = v >= STRAIN.breaking ? true : this.breakingLock && v >= STRAIN.breaking;
          this.setStrain(v);
          return this.stageNow;
        },
        elderMeditation: () => this.elderMeditation(),
        vow: () => this.takeVow(),
        breakVow: () => {
          this.emotionalMomentUntil = ctx.time.elapsed + 30;
          this.breakVow();
          return this.vow;
        },
        emotionalMoment: (seconds = 30) => (this.emotionalMomentUntil = ctx.time.elapsed + seconds),
        korra: (name: FeatureName, on: boolean) => this.setKorraFlag(name, on),
        moonCycleNights: () => MOON.cycleNights,
      };
      return true;
    };
    if (!install()) {
      const t = setInterval(() => {
        if (install()) clearInterval(t);
      }, 200);
    }
  }
}

const CSS = `
.strain-meter{position:absolute;top:150px;left:16px;width:150px;padding:4px 8px 6px;border-radius:8px;background:rgba(10,14,22,.55);
  border:1px solid rgba(255,255,255,.1);color:#d9dbe6;font:11px var(--font-body,sans-serif);pointer-events:none;z-index:4}
.strain-meter.hidden{display:none}
.strain-meter .strain-top{display:flex;justify-content:space-between;letter-spacing:.06em;text-transform:uppercase;font-size:10px;color:#aab0c4}
.strain-meter .strain-lb{color:#e6e8f2}
.strain-meter .strain-bar{position:relative;height:5px;margin-top:3px;border-radius:3px;background:rgba(255,255,255,.1);overflow:hidden}
.strain-meter .strain-fill{position:absolute;inset:0;transform-origin:left;transform:scaleX(0);background:linear-gradient(90deg,#8fa6c8,#6a5c9a 55%,#4a2f63);transition:transform .25s}
.strain-meter .strain-bar i{position:absolute;top:0;bottom:0;width:1px;background:rgba(255,255,255,.35)}
.strain-meter .strain-bar i.t1{left:${STRAIN.unease}%} .strain-meter .strain-bar i.t2{left:${STRAIN.dark}%} .strain-meter .strain-bar i.t3{left:${STRAIN.breaking}%}
.strain-meter[data-stage="dark"]{border-color:rgba(140,110,190,.45)}
.strain-meter[data-stage="breaking"]{border-color:rgba(190,90,120,.6)}
#ui.touch-on .strain-meter{top:calc(128px + env(safe-area-inset-top,0px));left:calc(12px + env(safe-area-inset-left,0px));width:120px}
`;

let injected = false;
function injectCSS(): void {
  if (injected || typeof document === 'undefined') return;
  injected = true;
  const s = document.createElement('style');
  s.dataset.module = 'subskills';
  s.textContent = CSS;
  document.head.appendChild(s);
}
