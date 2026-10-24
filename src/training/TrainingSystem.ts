import * as THREE from 'three';
import type { Appearance, OutfitSlots } from '../character/Appearance';
import { npcLook, withPreset } from '../character/looks';
import { allTechniques, getTechnique } from '../combat/CombatSystem';
import type { GameContext, GameSystem } from '../core/GameContext';
import { keyHints } from '../core/Input';
import { ELEMENT_INFO, ELEMENTS, type Element } from '../core/types';
import { cosmeticById } from '../data/cosmetics';
import { AWAKENINGS, GRANDMASTER, MASTERS, lessonById, masterById, type ChallengeDef, type LessonDef, type MasterDef, type MasterLook } from '../data/masters';
import type { NPC } from '../npc/NPCSystem';
import type { NPCDef } from '../npc/NPCTypes';
import { MASTERY_REQUIREMENTS, SLOT_COUNT } from '../progression/Progression';
import type { QuestMarker } from '../quests/QuestSystem';
import { clear, h } from '../ui/dom';
import { getSpot } from '../world/Spots';
import { LANDMARKS } from '../world/WorldLayout';
import { challengeKind, createChallenge, TrainingTarget, type Challenge, type ChallengeEnv } from './challenges';
import { ChallengeHUD, injectTrainingCSS } from './hud';

/**
 * Masters & training (module `training`, ctx.extra.get('training')).
 *
 *  - Spawns every master of docs/TECHNIQUES.md as an interactive NPC at
 *    getSpot('master_<name>') (fallback positions for regions without spots),
 *    with a distinct look, personality and a code-driven conversation menu.
 *  - Lessons: the master demonstrates (real CombatSystem cast), then an
 *    interactive challenge at training_<name> (src/training/challenges.ts). The
 *    technique is provisionally usable during the challenge; on success it is
 *    learned for good (progression.learn + completeLesson), equipped, saved.
 *  - Element awakening at the first master of an element you cannot bend.
 *  - Grandmasters' multi-stage Mastery Trials (only when trialAvailable).
 *  - Elements Sphere story moment (spirit vision + journal note).
 *  - Master ✦ markers (map/compass) once known; journal "Known Masters" page.
 *
 * Debug: window.__game.debug.training (see installDebug()).
 */

type RunKind = 'lesson' | 'awaken' | 'trial';

interface Run {
  kind: RunKind;
  master: MasterDef;
  npc: NPC | null;
  lesson: LessonDef | null;
  stages: Array<{ title: string; challenge: ChallengeDef }>;
  stage: number;
  phase: 'demo' | 'countdown' | 'running' | 'stageDone' | 'success' | 'failed';
  timer: number;
  challenge: Challenge | null;
  env: ChallengeEnv;
  slotBackup: { element: Element; slots: Array<string | null> } | null;
  provisionalSlot: number;
  demoTarget: TrainingTarget | null;
  say: string;
  failReason: string;
  /** Result of the master's demonstration cast ('cast' when CombatSystem accepted it). */
  demo: string | null;
}

interface Placement {
  x: number;
  y: number | undefined;
  z: number;
  yaw: number;
  tx: number;
  ty: number | undefined;
  tz: number;
  r: number;
  fromSpot: boolean;
}

const SLOT_KINDS = new Set(['ability', 'defense', 'movement']);

/** Cosmetics granted with each Mastery Trial. */
const TRIAL_REWARDS: Record<Element, string[]> = {
  air: ['air_elder_robe', 'air_monk_hat'],
  water: ['water_shawl'],
  earth: ['earth_dojo'],
  fire: ['fire_pauldrons'],
};

const SPIRITS: Array<{ speaker: string; text: string }> = [
  { speaker: 'Spirit Vision · Avatar Yangchen', text: 'The air grows still around you, and four figures stand where there was no one. "You have listened to the wind, young one. You did not command it — you understood it."' },
  { speaker: 'Spirit Vision · Avatar Kuruk', text: '"Water, earth, fire and air — you mastered each the hard way, from people who loved their element. That is why the four now answer as one."' },
  { speaker: 'Spirit Vision · Avatar Kyoshi', text: '"Do not mistake this for an ending. The Elements Sphere is a responsibility. Call on it when the world needs every element at once — and not before."' },
  { speaker: 'Spirit Vision · Avatar Roku', text: '"When you enter the Avatar State now, the four elements will circle you as a sphere. We will be with you. We always have been."' },
];

export class TrainingSystem implements GameSystem {
  private ctx!: GameContext;
  readonly lastCast = new Map<string, number>();
  /** Provisional access during a challenge (lesson technique / awakening element). */
  readonly grantTech = new Set<string>();
  readonly grantElem = new Set<Element>();
  run: Run | null = null;
  private hud: ChallengeHUD | null = null;
  private placements = new Map<string, Placement>();
  readonly missingSpots: string[] = [];
  private visionQueued = false;
  private visionDelay = 0;
  private flagPoll = 0;
  private hudLinger = 0;
  private lingerView: Parameters<ChallengeHUD['show']>[0] | null = null;
  private saveAfter = 0;
  /** Sim-time scheduler (pauses with the game, deterministic under debug.step). */
  private timers: Array<{ t: number; fn: () => void }> = [];

  private after(sec: number, fn: () => void): void {
    this.timers.push({ t: sec, fn });
  }

  private tickTimers(dt: number): void {
    if (!this.timers.length) return;
    const due: Array<() => void> = [];
    this.timers = this.timers.filter((x) => {
      x.t -= dt;
      if (x.t <= 0) {
        due.push(x.fn);
        return false;
      }
      return true;
    });
    for (const fn of due) {
      try {
        fn();
      } catch (err) {
        console.error('[training] timer failed', err);
      }
    }
  }

  init(ctx: GameContext): void {
    this.ctx = ctx;
    injectTrainingCSS();
    this.patchProgression();
    for (const m of MASTERS) {
      const pl = this.place(m);
      ctx.npcs.addDef(this.npcDef(m, pl));
      ctx.npcs.onTalk(m.id, (npc) => this.talk(npc, m));
    }
    ctx.npcs.onAction('train', (_c, a, npc) => {
      if (a.type !== 'train') return;
      const m = masterById(a.master);
      const l = a.lesson === 'awaken' && m ? AWAKENINGS[m.element] : lessonById(a.lesson)?.lesson;
      if (m && l) this.startLesson(m, l, npc);
    });
    ctx.npcs.onAction('trial', (_c, a, npc) => {
      if (a.type !== 'trial') return;
      const m = masterById(GRANDMASTER[a.element]);
      if (m) this.startTrial(m, npc);
    });
    ctx.events.on('technique:cast', (e) => {
      if (e.isPlayer) this.lastCast.set(e.id, ctx.time.elapsed);
    });
    ctx.events.on('quest:completed', (e) => this.onQuestCompleted(e.questId));
    ctx.events.on('elementsSphere:unlocked', () => {
      if (!ctx.session.active || ctx.session.kind !== 'campaign' || ctx.quests.hasFlag('sphere_vision')) return;
      this.visionQueued = true;
      this.visionDelay = 1.6;
    });
    ctx.quests.addMarkerProvider(() => this.markers());
    this.installDebug();
  }

  // ---------------------------------------------------------------------------
  // Setup
  // ---------------------------------------------------------------------------

  /** Provisional technique/element access while a challenge runs (no persistence side effects). */
  private patchProgression(): void {
    const pr = this.ctx.progression;
    const knows = pr.knows.bind(pr);
    const canBend = pr.canBend.bind(pr);
    pr.knows = (id: string) => knows(id) || this.grantTech.has(id);
    pr.canBend = (e: Element) => canBend(e) || this.grantElem.has(e);
  }

  private place(m: MasterDef): Placement {
    const ms = getSpot(`master_${m.spot}`);
    const ts = getSpot(`training_${m.spot}`);
    if (!ms && !this.missingSpots.includes(`master_${m.spot}`)) this.missingSpots.push(`master_${m.spot}`);
    if (!ts && !this.missingSpots.includes(`training_${m.spot}`)) this.missingSpots.push(`training_${m.spot}`);
    const f = m.fallback;
    const x = ms?.x ?? f.x, z = ms?.z ?? f.z;
    const tx = ts?.x ?? f.tx, tz = ts?.z ?? f.tz;
    const yaw = ms?.yaw ?? (Math.hypot(tx - x, tz - z) > 0.5 ? Math.atan2(tx - x, tz - z) : f.yaw);
    const pl: Placement = { x, y: ms?.y, z, yaw, tx, ty: ts?.y ?? ms?.y, tz, r: ts?.r ?? 12, fromSpot: !!ms };
    this.placements.set(m.id, pl);
    return pl;
  }

  private npcDef(m: MasterDef, pl: Placement): NPCDef {
    return {
      id: m.id,
      name: m.name,
      title: m.title,
      role: 'master',
      nation: m.nation,
      element: m.element,
      appearance: buildMasterLook(m.look, m.nation),
      x: pl.x,
      z: pl.z,
      y: pl.y,
      yaw: pl.yaw,
      behavior: m.behavior,
      region: m.region,
      condition: m.hidden ? { flag: m.hidden.flag } : m.condition,
    };
  }

  onSessionStart(): void {
    const ctx = this.ctx;
    this.endRun(true);
    this.grantTech.clear();
    this.grantElem.clear();
    if (!this.hud) this.hud = new ChallengeHUD(ctx.ui.layers.hud);
    this.hud.hide();
    if (ctx.session.kind !== 'campaign') return;
    // Re-resolve spots (regions may publish them lazily) and relocate opening-quest elders.
    for (const m of MASTERS) {
      const pl = this.place(m);
      const d = ctx.npcs.getDef(m.id);
      if (d) Object.assign(d, { x: pl.x, z: pl.z, y: pl.y, yaw: pl.yaw });
    }
    this.syncStoryFlags();
  }

  onSessionEnd(): void {
    this.timers = [];
    this.endRun(true);
    this.grantTech.clear();
    this.grantElem.clear();
    this.hud?.hide();
    this.visionQueued = false;
  }

  /** Opening-quest elders move to their teaching posts; the main line starts after the awakening. */
  private syncStoryFlags(): void {
    const q = this.ctx.quests;
    const pr = this.ctx.progression;
    if (pr.startingElement !== 'air' || q.isComplete('mq_awakening_air')) q.setFlag('tenzo_in_courtyard');
    if (pr.startingElement !== 'fire' || q.isComplete('mq_awakening_fire')) q.setFlag('hira_at_temple');
    if (ELEMENTS.some((e) => q.isComplete(`mq_awakening_${e}`))) q.setFlag('avatar_awakened');
    for (const e of ELEMENTS) if (pr.canBend(e)) q.setFlag(`can_bend_${e}`);
    q.checkAutoStart();
  }

  private onQuestCompleted(id: string): void {
    if (!id.startsWith('mq_awakening_')) return;
    const q = this.ctx.quests;
    if (id === 'mq_awakening_air') q.setFlag('tenzo_in_courtyard');
    if (id === 'mq_awakening_fire') q.setFlag('hira_at_temple');
    q.setFlag('avatar_awakened');
  }

  // ---------------------------------------------------------------------------
  // Knowledge helpers
  // ---------------------------------------------------------------------------

  lessonDone(id: string): boolean {
    return this.ctx.quests.hasFlag(`lesson_${id}`);
  }

  missingRequirements(l: LessonDef): string[] {
    return (l.requires ?? []).filter((r) => !this.lessonDone(r));
  }

  describeLesson(id: string): string {
    const f = lessonById(id);
    return f ? `${f.master.name}: “${f.lesson.title}”` : id;
  }

  isKnown(m: MasterDef): boolean {
    const q = this.ctx.quests;
    if (q.hasFlag(`met_${m.id}`) || q.hasFlag(`known_${m.id}`)) return true;
    if (m.hidden) return q.hasFlag(m.hidden.flag);
    return LANDMARKS.some((l) => l.regionId === m.region && this.ctx.world.discovered.has(l.id));
  }

  masterPosition(id: string): THREE.Vector3 | null {
    return this.ctx.npcs.positionOf(id);
  }

  private markers(): QuestMarker[] {
    const ctx = this.ctx;
    if (!ctx.session.active || ctx.session.kind !== 'campaign') return [];
    const p = ctx.player;
    const out: QuestMarker[] = [];
    for (const m of MASTERS) {
      if (!this.isKnown(m)) continue;
      const d = ctx.npcs.getDef(m.id);
      if (!d) continue;
      if (m.condition && !ctx.npcs.checkCondition(m.condition)) continue;
      const pos = new THREE.Vector3(d.x, d.y ?? ctx.world.heightAt(d.x, d.z), d.z);
      const dist = p ? Math.hypot(pos.x - p.position.x, pos.z - p.position.z) : 0;
      out.push({ questId: `master:${m.id}`, title: m.name, text: `✦ ${m.name} — ${m.location}`, position: pos, tracked: false, icon: '✦', color: ELEMENT_INFO[m.element].glow, compass: dist < 420 && dist > 6 });
    }
    return out;
  }

  // ---------------------------------------------------------------------------
  // Conversation
  // ---------------------------------------------------------------------------

  private speaker(m: MasterDef): string {
    return `${m.name} · ${m.title}`;
  }

  private say(m: MasterDef, text: string, choices: Array<{ text: string; onSelect: () => void }>): void {
    this.ctx.ui.showDialogue({ speaker: this.speaker(m), text, choices });
  }

  private end(): void {
    if (this.ctx.npcs.talkingTo) this.ctx.npcs.endConversation();
    else this.ctx.ui.hideDialogue();
  }

  talk(npc: NPC | null, m: MasterDef): void {
    const q = this.ctx.quests;
    const first = !q.hasFlag(`met_${m.id}`);
    if (first) {
      q.setFlag(`met_${m.id}`);
      this.ctx.events.emit('master:discovered', { masterId: m.id });
    }
    if (this.run) {
      this.say(m, this.run.phase === 'running' ? 'Focus! The lesson is not over.' : 'Patience.', [
        { text: 'Abandon the lesson', onSelect: () => { this.end(); this.abandon(); } },
        { text: 'Continue', onSelect: () => this.end() },
      ]);
      return;
    }
    this.menu(npc, m, first ? m.greeting : m.philosophy);
  }

  private menu(npc: NPC | null, m: MasterDef, text: string): void {
    const pr = this.ctx.progression;
    const e = m.element;
    const choices: Array<{ text: string; onSelect: () => void }> = [];
    const notes: string[] = [];
    if (!pr.canBend(e)) {
      const aw = AWAKENINGS[e];
      notes.push(`You cannot bend ${ELEMENT_INFO[e].name.toLowerCase()} yet. ${m.name} can awaken it in you.`);
      choices.push({ text: `Awaken ${ELEMENT_INFO[e].name.toLowerCase()}bending in me`, onSelect: () => this.say(m, m.awaken + `\n\n${aw.intro}`, [{ text: 'I am ready.', onSelect: () => this.startLesson(m, aw, npc) }, { text: 'Not yet.', onSelect: () => this.end() }]) });
    } else {
      for (const l of m.lessons) {
        if (this.lessonDone(l.id)) continue;
        const missing = this.missingRequirements(l);
        const tech = getTechnique(l.technique)?.name ?? l.technique;
        if (missing.length) {
          notes.push(`🔒 “${l.title}” (${tech}) — first complete ${missing.map((r) => this.describeLesson(r)).join(' and ')}.`);
          continue;
        }
        choices.push({ text: `Lesson: ${l.title} — learn ${tech}`, onSelect: () => this.say(m, l.intro, [{ text: 'Show me.', onSelect: () => this.startLesson(m, l, npc) }, { text: 'Later.', onSelect: () => this.end() }]) });
      }
      if (m.trial) {
        const req = MASTERY_REQUIREMENTS[e];
        const ms = pr.mastery[e];
        if (ms.mastered) notes.push(`You have mastered ${ELEMENT_INFO[e].name.toLowerCase()}bending. ${m.name} bows to you.`);
        else if (pr.trialAvailable(e)) choices.push({ text: `Begin the ${req.trialName}`, onSelect: () => this.say(m, m.trialIntro ?? req.trialName, [{ text: 'I am ready.', onSelect: () => this.startTrial(m, npc) }, { text: 'Not yet.', onSelect: () => this.end() }]) });
        else
          choices.push({
            text: `Ask about the ${req.trialName}`,
            onSelect: () =>
              this.say(m, `${m.trialIntro ?? ''}\n\nNot yet. Come back when you have completed ${req.lessons} master lessons (${ms.lessons.length}/${req.lessons}) and your ${ELEMENT_INFO[e].name.toLowerCase()}bending proficiency reaches ${req.proficiency} (${Math.floor(ms.proficiency)}/${req.proficiency}). Proficiency grows whenever you bend in earnest.`, [{ text: 'I understand.', onSelect: () => this.end() }]),
          });
      }
      if (!choices.length && !m.trial && m.lessons.every((l) => this.lessonDone(l.id))) notes.push('“I have taught you everything I know. The rest you must find on the road.”');
    }
    for (const c of this.clueChoices(m)) choices.push(c);
    choices.push({ text: 'Tell me about yourself.', onSelect: () => this.say(m, `${m.philosophy}\n\n(${m.location})`, [{ text: 'Back', onSelect: () => this.menu(npc, m, m.philosophy) }, { text: 'Farewell', onSelect: () => this.end() }]) });
    choices.push({ text: 'Farewell.', onSelect: () => { this.say(m, m.farewell, [{ text: 'Leave', onSelect: () => this.end() }]); } });
    this.say(m, [text, ...notes].join('\n\n'), choices);
  }

  /** Masters point the way to the hidden masters (discovery quests). */
  private clueChoices(m: MasterDef): Array<{ text: string; onSelect: () => void }> {
    const q = this.ctx.quests;
    const out: Array<{ text: string; onSelect: () => void }> = [];
    const clue = (quest: string, hidden: string, text: string) => {
      const hm = masterById(hidden);
      if (!hm?.hidden || q.hasFlag(hm.hidden.flag) || q.isActive(quest) || q.isComplete(quest)) return;
      out.push({ text: 'Is there anyone else who could teach me?', onSelect: () => this.say(m, text, [{ text: 'I will find them.', onSelect: () => { q.start(quest); this.end(); } }]) });
    };
    if (m.id === 'master_iio' && this.lessonDone('iio_air_scooter')) clue('sq_hermit', 'master_hermit', 'There is... someone. A hermit, beyond the east wall, where the four winds meet. The elders say he carved his teachings into a tablet by the trail so only the curious would find him. Look for the wind-worn tablet near the temple gate.');
    if (m.id === 'master_yugoda' && this.lessonDone('yugoda_water_heal')) clue('sq_huu', 'master_huu', 'Long ago a waterbender came north from the Foggy Swamp — he bent the water inside living plants! A merchant in Riverbend Village keeps his old journal, I believe. Ask there.');
    if (m.id === 'master_lien' && this.lessonDone('lien_stone_wall')) clue('sq_lin', 'master_lin', 'If you want to learn to truly feel the earth, there is a girl in Gaoling who fights in the Earth Rumble. Blind, they say — and undefeated. Find a poster in the Gaoling market.');
    return out;
  }

  // ---------------------------------------------------------------------------
  // Lessons, awakenings and trials
  // ---------------------------------------------------------------------------

  startLesson(m: MasterDef, l: LessonDef, npc: NPC | null = null): boolean {
    const pr = this.ctx.progression;
    const awaken = l.id.startsWith('awaken_');
    if (this.run || !this.ctx.session.active || this.ctx.session.kind !== 'campaign') return false;
    if (awaken ? pr.canBend(m.element) : !pr.canBend(m.element)) return false;
    if (!awaken && (this.lessonDone(l.id) || this.missingRequirements(l).length)) return false;
    this.end();
    this.begin(awaken ? 'awaken' : 'lesson', m, l, [{ title: l.title, challenge: l.challenge }], npc);
    return true;
  }

  startTrial(m: MasterDef, npc: NPC | null = null): boolean {
    if (this.run || !m.trial || !this.ctx.progression.trialAvailable(m.element)) return false;
    this.end();
    this.begin('trial', m, null, m.trial, npc);
    return true;
  }

  private begin(kind: RunKind, m: MasterDef, l: LessonDef | null, stages: Run['stages'], npc: NPC | null): void {
    const ctx = this.ctx;
    const p = ctx.player!;
    const pl = this.placements.get(m.id) ?? this.place(m);
    const ty = pl.ty ?? ctx.world.groundAt(pl.tx, pl.tz).y;
    const center = new THREE.Vector3(pl.tx, ctx.world.groundAt(pl.tx, pl.tz, ty + 2.5).y, pl.tz);
    if (Math.abs(center.y - ty) > 2.5) center.y = ty;
    const live = npc ?? ctx.npcs.get(m.id) ?? null;
    const mp = live?.position ?? new THREE.Vector3(pl.x, pl.y ?? center.y, pl.z);
    const forward = new THREE.Vector3(center.x - mp.x, 0, center.z - mp.z);
    if (forward.lengthSq() < 0.25) forward.set(Math.sin(pl.yaw), 0, Math.cos(pl.yaw));
    forward.normalize();
    const r = Math.max(8, Math.min(14, pl.r));
    const start = center.clone().addScaledVector(forward, -r * 0.55);
    start.y = ctx.world.groundAt(start.x, start.z, center.y + 2.5).y;
    if (Math.abs(start.y - center.y) > 2.5) start.y = center.y;
    const tech = kind === 'lesson' && l ? l.technique : null;
    const env: ChallengeEnv = { ctx, center, radius: r, start, forward, element: m.element, technique: tech, lastCast: this.lastCast, masterName: m.name };
    const run: Run = { kind, master: m, npc: live, lesson: l, stages, stage: 0, phase: 'demo', timer: 3.6, challenge: null, env, slotBackup: null, provisionalSlot: -1, demoTarget: null, say: l?.demo.line ?? m.trialIntro ?? '', failReason: '', demo: null };
    this.run = run;
    this.grant(run);
    // Lead the player onto the training ground.
    p.teleport(start.clone().setY(start.y + 0.05), Math.atan2(forward.x, forward.z));
    ctx.cameraRig.snapBehind();
    if (p.health) p.health.hp = p.health.maxHp;
    p.chi = p.maxChi;
    if (p.element !== m.element) p.switchElement(m.element);
    ctx.events.emit('training:started', { masterId: m.id, lessonId: l?.id ?? MASTERY_REQUIREMENTS[m.element].trialId, techniqueId: tech ?? '' });
    if (kind === 'trial') {
      run.phase = 'countdown';
      run.timer = 2.5;
      this.buildStage(run);
    } else this.demonstrate(run);
  }

  /** Provisional technique/element access + a slot to practise with. */
  private grant(run: Run): void {
    const pr = this.ctx.progression;
    const e = run.master.element;
    if (run.kind === 'awaken') {
      this.grantElem.add(e);
      const starters = allTechniques().filter((d) => d.element === e && d.starter);
      for (const d of starters) this.grantTech.add(d.id);
      run.slotBackup = { element: e, slots: [...pr.equipped[e]] };
      pr.equipped[e] = starters.filter((d) => SLOT_KINDS.has(d.kind)).map((d) => d.id).slice(0, SLOT_COUNT);
    } else if (run.kind === 'lesson' && run.lesson) {
      const id = run.lesson.technique;
      this.grantTech.add(id);
      const def = getTechnique(id);
      if (def && SLOT_KINDS.has(def.kind) && !pr.slotsFor(e).includes(id)) {
        run.slotBackup = { element: e, slots: [...pr.equipped[e]] };
        const slots = pr.slotsFor(e);
        const free = slots.indexOf(null);
        run.provisionalSlot = free >= 0 ? free : SLOT_COUNT - 1;
        pr.equip(e, run.provisionalSlot, id);
      }
    }
  }

  private release(run: Run): void {
    const pr = this.ctx.progression;
    if (run.slotBackup) pr.equipped[run.slotBackup.element] = run.slotBackup.slots;
    run.slotBackup = null;
    this.grantTech.clear();
    this.grantElem.clear();
    // A failed awakening must not leave the player holding an element they cannot bend.
    const p = this.ctx.player;
    if (p && run.kind === 'awaken' && !pr.canBend(p.element) && !pr.unlocked.has(run.master.element)) {
      const back = pr.canBend(pr.startingElement) ? pr.startingElement : ELEMENTS.find((e) => pr.canBend(e));
      if (back) p.switchElement(back, true);
    }
  }

  private demonstrate(run: Run): void {
    const ctx = this.ctx;
    const npc = run.npc;
    const l = run.lesson!;
    run.phase = 'demo';
    run.timer = 3.8;
    if (!npc) return;
    const m = run.master;
    // A demonstration post beside the field, so the master's strike has a real target.
    const side = new THREE.Vector3(-run.env.forward.z, 0, run.env.forward.x);
    const dp = npc.position.clone().addScaledVector(run.env.forward, 5).addScaledVector(side, 2.5);
    const dummy = new TrainingTarget('normal', 400, () => true);
    dummy.position.set(dp.x, ctx.world.groundAt(dp.x, dp.z, npc.position.y + 2.5).y, dp.z);
    if (Math.abs(dummy.position.y - npc.position.y) > 2.5) dummy.position.y = npc.position.y;
    dummy.yaw = Math.atan2(npc.position.x - dp.x, npc.position.z - dp.z);
    dummy.root.rotation.y = dummy.yaw;
    ctx.entities.add(dummy);
    run.demoTarget = dummy;
    npc.lookAt = dummy.position.clone();
    npc.yaw = Math.atan2(dp.x - npc.position.x, dp.z - npc.position.z);
    npc.root.rotation.y = npc.yaw;
    const cast = l.demo.cast;
    const fx = l.demo.fx;
    const prevTeam = npc.team;
    npc.team = 'ally';
    npc.chi = npc.maxChi;
    npc.waterReserve = npc.maxWaterReserve; // masters carry a full water skin for demonstrations
    if (fx === 'jump' && npc.body) {
      npc.body.velocity.y = 9.5;
      npc.body.grounded = false;
      ctx.vfx.burst('swirl', npc.position, { count: 18 });
      for (const t of [0.38, 0.76]) {
        this.after(t, () => {
          if (npc.body && !npc.disposed) {
            npc.body.velocity.y = 8.5;
            ctx.vfx.burst(t < 0.5 ? 'swirl' : 'air', npc.position, { count: 16 });
          }
        });
      }
    }
    if (fx === 'stomp') ctx.vfx.ring(npc.position.clone(), '#b9a07a', 9, 0.8);
    if (fx === 'glow' || fx === 'meditate') ctx.vfx.burst('spirit', npc.aimPoint(new THREE.Vector3()), { count: 20 });
    const doCast = () => {
      if (!cast || npc.disposed) return;
      const res = ctx.combat.tryCast(npc, cast, { target: dummy, aimPoint: dummy.aimPoint(new THREE.Vector3()), force: true, free: true, charge: 1 });
      run.demo = res.ok ? 'cast' : res.reason ?? 'failed';
      if (!res.ok) {
        // Fallback flourish (e.g. no water near a fallback site): still show the form.
        npc.humanoid.animator.play(`${m.element}_form`, { fadeIn: 0.15 });
        ctx.vfx.burst(m.element === 'fire' ? 'fire' : m.element === 'water' ? 'splash' : m.element === 'earth' ? 'dust' : 'air', npc.aimPoint(new THREE.Vector3()), { count: 16 });
      }
      run.say = l.demo.line;
    };
    this.after(fx === 'jump' ? 1.1 : 0.35, doCast);
    this.after(4.2, () => {
      if (!npc.disposed) {
        npc.team = prevTeam;
        npc.lookAt = null;
      }
    });
  }

  private buildStage(run: Run): void {
    const st = run.stages[run.stage];
    run.challenge?.dispose();
    run.challenge = createChallenge(st.challenge, run.env);
    run.challenge.start();
  }

  update(dt: number): void {
    const ctx = this.ctx;
    if (!ctx.session.active) return;
    this.tickTimers(dt);
    this.flagPoll -= dt;
    if (this.flagPoll <= 0 && ctx.session.kind === 'campaign') {
      this.flagPoll = 1;
      for (const e of ELEMENTS) {
        const pr = ctx.progression;
        if (pr.canBend(e) && !this.grantElem.has(e)) ctx.quests.setFlag(`can_bend_${e}`);
        if (pr.trialAvailable(e)) ctx.quests.setFlag(`trial_ready_${e}`);
        const req = MASTERY_REQUIREMENTS[e];
        if (pr.mastery[e].lessons.length >= req.lessons) ctx.quests.setFlag(`lessons3_${e}`);
        if (pr.mastery[e].proficiency >= req.proficiency) ctx.quests.setFlag(`proficient_${e}`);
      }
    }
    if (this.saveAfter > 0) {
      this.saveAfter -= dt;
      if (this.saveAfter <= 0) ctx.game.requestAutosave(true);
    }
    if (this.visionQueued && !this.run && !ctx.ui.dialogueOpen) {
      this.visionDelay -= dt;
      if (this.visionDelay <= 0) this.showVision();
    }
    const run = this.run;
    if (!run) {
      if (this.hudLinger > 0 && this.lingerView) {
        this.hudLinger -= dt;
        if (this.hudLinger <= 0) {
          this.hud?.hide();
          this.lingerView = null;
        }
      }
      return;
    }
    run.timer -= dt;
    const c = run.challenge;
    const p = ctx.player!;
    switch (run.phase) {
      case 'demo':
        if (run.timer <= 0) {
          this.removeDemoTarget(run);
          run.phase = 'countdown';
          run.timer = 2.4;
          this.buildStage(run);
        }
        break;
      case 'countdown':
        if (run.timer <= 0) {
          run.phase = 'running';
          ctx.audio.play('notify', { bus: 'ui', volume: 0.5 });
        }
        break;
      case 'running': {
        c!.update(dt);
        const away = Math.hypot(p.position.x - run.env.center.x, p.position.z - run.env.center.z) > run.env.radius + 40;
        if (away) c!.status === 'running' && this.failRun(run, 'You left the training ground.');
        else if (c!.status === 'success') {
          if (run.stage < run.stages.length - 1) {
            run.phase = 'stageDone';
            run.timer = 2.5;
            ctx.vfx.burst('spirit', p.aimPoint(new THREE.Vector3()), { count: 14 });
            ctx.audio.play('notify', { bus: 'ui', volume: 0.6 });
          } else this.succeed(run);
        } else if (c!.status === 'failed') this.failRun(run, c!.failReason);
        break;
      }
      case 'stageDone':
        if (run.timer <= 0) {
          run.stage++;
          if (p.health) p.health.hp = p.health.maxHp;
          p.chi = p.maxChi;
          run.phase = 'countdown';
          run.timer = 2.4;
          this.buildStage(run);
        }
        break;
      case 'success':
      case 'failed':
        if (run.timer <= 0) this.endRun(false);
        break;
    }
    this.renderHUD();
  }

  private removeDemoTarget(run: Run): void {
    if (run.demoTarget) {
      if (!run.demoTarget.disposed) this.ctx.entities.remove(run.demoTarget);
      run.demoTarget = null;
    }
  }

  private renderHUD(): void {
    const run = this.run;
    if (!run || !this.hud) return;
    const c = run.challenge;
    const st = run.stages[run.stage];
    const kindLabel = run.kind === 'trial' ? `${MASTERY_REQUIREMENTS[run.master.element].trialName} · stage ${run.stage + 1}/${run.stages.length}` : run.kind === 'awaken' ? 'Element awakening' : `${run.master.name} · ${challengeKind(st.challenge)}`;
    const title = run.kind === 'trial' ? st.title : run.lesson?.title ?? st.title;
    let hint = c?.hint() ?? '';
    const tech = run.lesson?.technique;
    if (tech && run.kind === 'lesson') {
      const slot = this.ctx.progression.slotsFor(run.master.element).indexOf(tech);
      if (slot >= 0) hint += `  ·  key [${this.ctx.input.label(`ability${slot + 1}` as never)}]`;
      else if (getTechnique(tech)?.kind === 'passive') hint += '  ·  (passive — always active)';
    }
    const base = { kind: kindLabel, title, hint, say: run.phase === 'demo' || run.phase === 'countdown' ? run.say || undefined : undefined };
    if (run.phase === 'demo') this.hud.show({ ...base, objective: `${run.master.name} demonstrates — watch closely.`, counter: '', progress: 0, timeLeft: null, timeFrac: 1, state: 'intro', hint: '' });
    else if (run.phase === 'countdown') this.hud.show({ ...base, objective: c?.objective() ?? '', counter: '', progress: 0, timeLeft: null, timeFrac: 1, state: 'intro', stamp: String(Math.max(1, Math.ceil(run.timer))) });
    else if (run.phase === 'running' && c) this.hud.show({ ...base, objective: c.objective(), counter: c.counter(), progress: c.progress(), timeLeft: c.limit - c.time, timeFrac: 1 - c.time / c.limit, state: 'running' });
    else if (run.phase === 'stageDone') this.hud.show({ ...base, objective: 'Stage complete — prepare for the next.', counter: '', progress: 1, timeLeft: null, timeFrac: 1, state: 'success', stamp: 'Well done' });
  }

  private succeed(run: Run): void {
    const ctx = this.ctx;
    const p = ctx.player!;
    const m = run.master;
    const e = m.element;
    const pr = ctx.progression;
    run.challenge?.dispose();
    run.challenge = null;
    this.release(run);
    run.phase = 'success';
    run.timer = 3.2;
    // Learning sequence: bow, glow, banner.
    if (run.npc && !run.npc.disposed) {
      run.npc.lookAt = p.position.clone();
      run.npc.humanoid.animator.play('bow', { fadeIn: 0.15 });
      this.after(3, () => run.npc && (run.npc.lookAt = null));
    }
    p.humanoid?.animator.play('bow', { fadeIn: 0.15 });
    const glowColor = ELEMENT_INFO[e].glow;
    ctx.vfx.burst('spirit', p.aimPoint(new THREE.Vector3()), { count: 30, color: glowColor });
    ctx.vfx.ring(p.position.clone(), glowColor, 3.5, 0.9);
    ctx.vfx.flash(p.aimPoint(new THREE.Vector3()), glowColor, 4, 0.5);
    this.glowPlayer(glowColor);
    ctx.audio.play('notify', { bus: 'ui', volume: 0.8 });
    let banner = '';
    let sub = '';
    if (run.kind === 'lesson' && run.lesson) {
      const l = run.lesson;
      const def = getTechnique(l.technique);
      ctx.quests.setFlag(`lesson_${l.id}`);
      pr.completeLesson(e, l.id);
      pr.learn(l.technique, 'master');
      if (def && SLOT_KINDS.has(def.kind) && !pr.slotsFor(e).includes(l.technique)) {
        const slot = run.provisionalSlot >= 0 ? run.provisionalSlot : SLOT_COUNT - 1;
        const prev = pr.slotsFor(e)[slot];
        pr.equip(e, slot, l.technique);
        if (prev) ctx.events.emit('ui:notify', { text: `${def.name} equipped in slot ${slot + 1} (replaced ${getTechnique(prev)?.name ?? prev}). Change it in Techniques [${ctx.input.label('techniques')}].`, kind: 'info', duration: 6 });
      }
      banner = `Technique learned: ${def?.name ?? l.technique}`;
      sub = keyHints(ctx.input, l.hint);
      const slotIdx = pr.slotsFor(e).indexOf(l.technique);
      if (slotIdx >= 0) sub += `  [slot ${slotIdx + 1} · ${ctx.input.label(`ability${slotIdx + 1}` as never)}]`;
      ctx.events.emit('ui:notify', { text: keyHints(ctx.input, l.hint), kind: 'learn', duration: 8 });
      ctx.events.emit('training:completed', { masterId: m.id, lessonId: l.id, techniqueId: l.technique, success: true });
    } else if (run.kind === 'awaken') {
      pr.unlockElement(e);
      p.switchElement(e);
      ctx.quests.setFlag(`awakened_${e}`);
      ctx.quests.setFlag(`can_bend_${e}`);
      banner = `${ELEMENT_INFO[e].name}bending Awakened`;
      sub = keyHints(ctx.input, AWAKENINGS[e].hint);
      ctx.events.emit('ui:notify', { text: sub, kind: 'learn', duration: 8 });
      ctx.events.emit('training:completed', { masterId: m.id, lessonId: AWAKENINGS[e].id, techniqueId: AWAKENINGS[e].technique, success: true });
    } else {
      pr.completeTrial(e);
      ctx.quests.setFlag(`trial_done_${e}`);
      for (const c of TRIAL_REWARDS[e]) if (cosmeticById(c)) ctx.inventory.unlockCosmetic(c);
      banner = `${MASTERY_REQUIREMENTS[e].trialName} — complete`;
      sub = pr.mastery[e].mastered ? `${m.name} names you a master of ${ELEMENT_INFO[e].name.toLowerCase()}bending.` : 'The trial is passed.';
      ctx.events.emit('training:completed', { masterId: m.id, lessonId: MASTERY_REQUIREMENTS[e].trialId, techniqueId: '', success: true });
    }
    ctx.ui.showBanner(banner, sub);
    run.say = run.kind === 'trial' ? m.farewell : 'Good. Again tomorrow — but good.';
    this.lingerView = { kind: run.kind === 'trial' ? 'Mastery Trial' : 'Lesson complete', title: banner, objective: sub, counter: '', progress: 1, timeLeft: null, timeFrac: 1, hint: '', state: 'success', stamp: '✦ Success ✦' };
    this.hud?.show(this.lingerView);
    ctx.game.requestAutosave(true);
    // The technique:learned autosave fired mid-sequence; save again once everything (slots, flags) settled.
    this.saveAfter = 3.4;
  }

  private glowPlayer(color: string): void {
    const hm = this.ctx.player?.humanoid;
    if (!hm || this.ctx.avatar.active) return;
    for (let i = 1; i <= 32; i++) {
      const t = i * 0.05;
      this.after(t, () => {
        if (this.ctx.avatar.active) return;
        const k = i === 32 ? 0 : Math.max(0, Math.sin((t / 1.6) * Math.PI));
        hm.setGlow(k, k, color);
      });
    }
  }

  private failRun(run: Run, reason: string): void {
    const ctx = this.ctx;
    run.challenge?.dispose();
    run.challenge = null;
    this.release(run);
    run.phase = 'failed';
    run.failReason = reason;
    run.timer = 1.6;
    const p = ctx.player;
    if (p?.health) p.health.hp = Math.max(p.health.hp, p.health.maxHp * 0.6);
    ctx.events.emit('training:completed', { masterId: run.master.id, lessonId: run.lesson?.id ?? MASTERY_REQUIREMENTS[run.master.element].trialId, techniqueId: run.lesson?.technique ?? '', success: false });
    this.lingerView = { kind: 'Challenge failed', title: run.lesson?.title ?? run.stages[run.stage].title, objective: reason, counter: '', progress: 0, timeLeft: null, timeFrac: 0, hint: `Talk to ${run.master.name} to try again.`, state: 'failed', stamp: 'Failed' };
    this.hud?.show(this.lingerView);
    ctx.audio.play('ui_click', { bus: 'ui', volume: 0.6, pitch: 0.6 });
    const m = run.master;
    const kind = run.kind;
    const lesson = run.lesson;
    const npc = run.npc;
    this.after(1.8, () => {
      if (this.run || !ctx.session.active) return;
      this.say(m, `${reason} ${kind === 'trial' ? 'A trial is not passed by wishing. ' : ''}Again?`, [
        { text: 'Try again', onSelect: () => (kind === 'trial' ? this.startTrial(m, npc) : lesson && this.startLesson(m, lesson, npc)) },
        { text: 'Not now', onSelect: () => this.end() },
      ]);
    });
  }

  /** Abort the current run (player request / session end). */
  abandon(): void {
    const run = this.run;
    if (!run) return;
    this.failRun(run, 'Lesson abandoned.');
  }

  private endRun(silent: boolean): void {
    const run = this.run;
    if (!run) return;
    run.challenge?.dispose();
    run.challenge = null;
    this.removeDemoTarget(run);
    this.release(run);
    this.run = null;
    if (silent) {
      this.hud?.hide();
      this.lingerView = null;
    } else if (this.lingerView) {
      this.hudLinger = 3;
      this.hud?.show(this.lingerView);
    } else this.hud?.hide();
  }

  // ---------------------------------------------------------------------------
  // Elements Sphere story moment
  // ---------------------------------------------------------------------------

  private showVision(): void {
    const ctx = this.ctx;
    this.visionQueued = false;
    const p = ctx.player;
    if (p) {
      ctx.vfx.burst('spirit', p.aimPoint(new THREE.Vector3()), { count: 40 });
      ctx.vfx.sphereWave(p.aimPoint(new THREE.Vector3()), '#cfefff', 6, 1.2, 0.3);
    }
    const key = ctx.input.label('avatarState');
    const step = (i: number) => {
      const s = SPIRITS[i];
      if (!s) {
        ctx.ui.hideDialogue();
        ctx.quests.setFlag('sphere_vision');
        ctx.quests.setFlag('note_sphere');
        ctx.ui.showBanner('The Elements Sphere', `Press ${key} (Avatar State) to summon all four elements at once.`);
        ctx.events.emit('ui:notify', { text: `Journal: The Elements Sphere — press ${key} to enter the Avatar State; the four elements now circle you.`, kind: 'avatar', duration: 8 });
        return;
      }
      ctx.ui.showDialogue({ speaker: s.speaker, text: s.text, choices: [{ text: i < SPIRITS.length - 1 ? 'Continue' : 'I understand.', onSelect: () => step(i + 1) }] });
    };
    step(0);
  }

  // ---------------------------------------------------------------------------
  // Journal: Known Masters page
  // ---------------------------------------------------------------------------

  renderJournal(el: HTMLElement): void {
    const ctx = this.ctx;
    const pr = ctx.progression;
    const wrap = h('div.trn-journal');
    if (ctx.quests.hasFlag('note_sphere'))
      wrap.append(h('div.trn-note', h('h4', { style: { margin: '0 0 4px' } }, '✦ The Elements Sphere'), h('div', `In a spirit vision the past Avatars spoke: all four elements now answer as one. Press ${ctx.input.label('avatarState')} to enter the Avatar State — it now summons the Elements Sphere, with Hurricane, Tsunami, Earthquake, Fire Tornado and the Avatar Cataclysm on slots 1–5.`)));
    let shown = 0;
    for (const e of ELEMENTS) {
      const list = MASTERS.filter((m) => m.element === e);
      const known = list.filter((m) => this.isKnown(m));
      const hiddenCount = list.filter((m) => m.hidden && !this.isKnown(m)).length;
      wrap.append(h('h3', { style: { margin: '14px 0 6px', color: ELEMENT_INFO[e].glow } }, `${ELEMENT_INFO[e].name} — ${pr.mastery[e].mastered ? 'mastered' : pr.canBend(e) ? `${pr.mastery[e].lessons.length}/${MASTERY_REQUIREMENTS[e].lessons} lessons` : 'not yet awakened'}`));
      for (const m of known) {
        shown++;
        const lessons = m.lessons.map((l) => {
          const done = this.lessonDone(l.id);
          const missing = this.missingRequirements(l);
          const tn = getTechnique(l.technique)?.name ?? l.technique;
          return h(`div.trn-l${done ? '.done' : missing.length ? '.locked' : ''}`, `${done ? '✓' : missing.length ? '🔒' : '◇'} ${l.title} — ${tn}${missing.length && !done ? ` (after ${missing.map((r) => this.describeLesson(r)).join(', ')})` : ''}`);
        });
        if (m.trial) lessons.push(h(`div.trn-l${pr.mastery[e].trialComplete ? '.done' : pr.trialAvailable(e) ? '' : '.locked'}`, `${pr.mastery[e].trialComplete ? '✓' : pr.trialAvailable(e) ? '◇' : '🔒'} ${MASTERY_REQUIREMENTS[e].trialName}${pr.trialAvailable(e) ? ' — ready!' : ''}`));
        if (!pr.canBend(e)) lessons.unshift(h('div.trn-l', `◇ Can awaken ${ELEMENT_INFO[e].name.toLowerCase()}bending in you`));
        wrap.append(
          h(
            'div.card',
            { style: { marginBottom: '8px' } },
            h('div.trn-m', h('div', { style: { fontSize: '26px', color: ELEMENT_INFO[e].glow } }, '✦'), h('div', { style: { flex: '1' } }, h('h4', `${m.name} — ${m.title}${m.grandmaster ? ' (grandmaster)' : ''}`), h('div.muted', { style: { marginBottom: '4px' } }, m.location), ...lessons)),
          ),
        );
      }
      if (hiddenCount) wrap.append(h('div.muted', { style: { fontStyle: 'italic', margin: '2px 0 6px' } }, `${hiddenCount} master${hiddenCount > 1 ? 's' : ''} of ${ELEMENT_INFO[e].name.toLowerCase()} remain${hiddenCount > 1 ? '' : 's'} hidden. ${list.filter((m) => m.hidden && !this.isKnown(m)).map((m) => m.hidden!.hint).join(' ')}`));
    }
    if (!shown) wrap.prepend(h('p.muted', 'No masters known yet. Visit the great cities and temples — masters are marked ✦.'));
    clear(el);
    el.append(wrap);
  }

  // ---------------------------------------------------------------------------
  // Debug / automation
  // ---------------------------------------------------------------------------

  private installDebug(): void {
    const w = window as unknown as { __game?: { debug: Record<string, unknown> } };
    const install = () => {
      if (!w.__game) return false;
      w.__game.debug.training = {
        sys: this,
        masters: () =>
          MASTERS.map((m) => {
            const d = this.ctx.npcs.getDef(m.id);
            const live = this.ctx.npcs.get(m.id);
            const pl = this.placements.get(m.id);
            return { id: m.id, name: m.name, element: m.element, known: this.isKnown(m), spawned: !!live, fromSpot: pl?.fromSpot ?? false, x: d?.x, y: d?.y, z: d?.z, training: pl ? { x: pl.tx, y: pl.ty, z: pl.tz, r: pl.r } : null, lessons: m.lessons.map((l) => ({ id: l.id, technique: l.technique, done: this.lessonDone(l.id), missing: this.missingRequirements(l) })) };
          }),
        missingSpots: () => [...this.missingSpots],
        /** Teleport next to a master (and its streaming), returns its live NPC id. */
        goto: (id: string) => {
          const m = masterById(id);
          const d = this.ctx.npcs.getDef(id);
          if (!m || !d) return null;
          const pl = this.placements.get(id)!;
          const dx = pl.tx - d.x, dz = pl.tz - d.z;
          const l = Math.hypot(dx, dz) || 1;
          const x = d.x + (dx / l) * 2.2, z = d.z + (dz / l) * 2.2;
          const y = d.y ?? this.ctx.world.groundAt(x, z).y;
          this.ctx.player!.teleport(new THREE.Vector3(x, this.ctx.world.groundAt(x, z, y + 2).y + 0.05, z), Math.atan2(d.x - x, d.z - z));
          this.ctx.cameraRig.snapBehind();
          (this.ctx.npcs as unknown as { stream(): void }).stream?.();
          return { x, z };
        },
        talk: (id: string) => {
          const npc = this.ctx.npcs.get(id);
          if (!npc) return false;
          this.ctx.npcs.talk(npc);
          return true;
        },
        dialogue: () => {
          const el = document.querySelector('.dialogue');
          if (!el) return null;
          return { speaker: el.querySelector('.speaker')?.textContent ?? '', text: el.querySelector('.text')?.textContent ?? '', choices: [...el.querySelectorAll('.choice')].map((b) => (b.textContent ?? '').replace(/^\d+\s*/, '')) };
        },
        choose: (match: string | number) => {
          const btns = [...document.querySelectorAll('.dialogue .choice')] as HTMLButtonElement[];
          const b = typeof match === 'number' ? btns[match] : btns.find((x) => (x.textContent ?? '').includes(match));
          if (!b) return false;
          b.click();
          return true;
        },
        startLesson: (masterId: string, lessonId: string) => {
          const m = masterById(masterId);
          if (!m) return false;
          const l = lessonId === 'awaken' ? AWAKENINGS[m.element] : m.lessons.find((x) => x.id === lessonId);
          return !!l && this.startLesson(m, l, this.ctx.npcs.get(masterId) ?? null);
        },
        startTrial: (e: Element) => {
          const m = masterById(GRANDMASTER[e]);
          return !!m && this.startTrial(m, this.ctx.npcs.get(m.id) ?? null);
        },
        skipDemo: () => {
          if (this.run && (this.run.phase === 'demo' || this.run.phase === 'countdown' || this.run.phase === 'stageDone')) this.run.timer = 0;
        },
        state: () => {
          const r = this.run;
          if (!r) return null;
          return { demo: r.demo, kind: r.kind, master: r.master.id, lesson: r.lesson?.id ?? null, stage: r.stage, stages: r.stages.length, phase: r.phase, timer: r.timer, failReason: r.failReason, status: r.challenge?.status ?? null, objective: r.challenge?.objective() ?? null, counter: r.challenge?.counter() ?? null, time: r.challenge?.time ?? 0, info: r.challenge?.debugInfo() ?? null, center: r.env.center.toArray(), forward: r.env.forward.toArray(), grants: [...this.grantTech] };
        },
        forceSuccess: () => {
          const r = this.run;
          if (!r || !r.challenge) return false;
          r.challenge.status = 'success';
          return true;
        },
        abandon: () => this.abandon(),
        /** End any run silently and close dialogue (test isolation). */
        cancel: () => {
          this.endRun(true);
          this.ctx.ui.hideDialogue();
          if (this.ctx.npcs.talkingTo) this.ctx.npcs.endConversation();
        },
        /** Mark a lesson completed without the challenge (setup for other tests). */
        completeLesson: (lessonId: string) => {
          const f = lessonById(lessonId);
          if (!f) return false;
          this.ctx.quests.setFlag(`lesson_${lessonId}`);
          this.ctx.progression.learn(f.lesson.technique, 'debug', true);
          this.ctx.progression.completeLesson(f.master.element, lessonId);
          return true;
        },
        /**
         * Build every lesson / awakening / trial-stage challenge around the player, run it for a
         * second of simulated time and dispose it (catches runtime errors in all challenge types).
         */
        probeAll: () => {
          const ctx = this.ctx;
          const p = ctx.player!;
          const out: Array<{ id: string; type: string; ok: boolean; status?: string; error?: string }> = [];
          const forward = new THREE.Vector3(Math.sin(p.yaw), 0, Math.cos(p.yaw));
          const all: Array<{ id: string; m: MasterDef; def: ChallengeDef; tech: string | null }> = [];
          for (const m of MASTERS) {
            for (const l of m.lessons) all.push({ id: l.id, m, def: l.challenge, tech: l.technique });
            (m.trial ?? []).forEach((st, i) => all.push({ id: `${m.id}:trial${i}`, m, def: st.challenge, tech: null }));
          }
          for (const e of ELEMENTS) all.push({ id: AWAKENINGS[e].id, m: MASTERS.find((x) => x.element === e)!, def: AWAKENINGS[e].challenge, tech: null });
          const hp = p.health?.hp ?? 0;
          for (const it of all) {
            const env: ChallengeEnv = { ctx, center: p.position.clone().addScaledVector(forward, 6), radius: 12, start: p.position.clone(), forward: forward.clone(), element: it.m.element, technique: it.tech, lastCast: this.lastCast, masterName: it.m.name };
            let c: Challenge | null = null;
            try {
              c = createChallenge(it.def, env);
              c.start();
              for (let i = 0; i < 10; i++) {
                c.update(0.1);
                c.objective();
                c.counter();
                c.progress();
                c.hint();
              }
              out.push({ id: it.id, type: it.def.type, ok: true, status: c.status });
            } catch (err) {
              out.push({ id: it.id, type: it.def.type, ok: false, error: String((err as Error)?.stack ?? err).slice(0, 300) });
            } finally {
              try {
                c?.dispose();
              } catch (err) {
                out.push({ id: `${it.id}:dispose`, type: it.def.type, ok: false, error: String(err) });
              }
            }
          }
          if (p.health) p.health.hp = Math.max(hp, p.health.hp);
          return out;
        },
        revealHidden: () => {
          for (const m of MASTERS) if (m.hidden) this.ctx.quests.setFlag(m.hidden.flag);
        },
        vision: () => this.showVision(),
      };
      return true;
    };
    if (!install()) {
      const iv = setInterval(() => install() && clearInterval(iv), 200);
    }
  }
}

/** Distinct procedural look for a master (seeded citizen look + explicit traits). */
export function buildMasterLook(l: MasterLook, nation: string): Appearance {
  let a = npcLook(l.seed, nation === 'neutral' ? 'water' : nation, l.role);
  if (l.preset) a = withPreset(a, l.preset);
  if (l.frame) a.frame = l.frame;
  if (l.height) a.height = l.height;
  if (l.build !== undefined) a.build = l.build;
  if (l.skin) a.skinTone = l.skin;
  if (l.hair) a.hair.style = l.hair;
  if (l.hairColor) {
    a.hair.color = l.hairColor;
    a.brows.color = l.hairColor;
  }
  if (l.facialHair) a.facialHair = l.facialHair;
  if (l.eyes) a.eyes.color = l.eyes;
  if (l.tattoos) a.tattoos = l.tattoos;
  if (l.tattooColor) a.tattooColor = l.tattooColor;
  if (l.scars) a.scars = [...l.scars];
  if (l.colors) a.colors = { ...l.colors };
  if (l.outfit) for (const [k, v] of Object.entries(l.outfit)) if (cosmeticById(v)) (a.outfit as unknown as Record<string, string>)[k as keyof OutfitSlots] = v;
  return a;
}
