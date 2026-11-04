import * as THREE from 'three';
import type { EncounterDirector } from '../../ai/EncounterDirector';
import { Enemy } from '../../ai/Enemy';
import type { GameContext, GameSystem } from '../../core/GameContext';
import { FEATURES } from '../../core/features';
import type { Action } from '../../core/Input';
import type { Element } from '../../core/types';
import { HAMA_LOOK, STRAIN_DIALOGUE_NODES, SUBSKILL_DIALOGUES, SUBSKILL_NPCS } from '../../data/dialogues_subskills';
import { SUB_SITES } from '../../data/quests_subskills';
import { TrainingDummy } from '../../entities/TrainingDummy';
import type { DialogueDef, NPCDef } from '../../npc/NPCTypes';
import { buildMasterLook } from '../../training/TrainingSystem';
import { lavaMat } from '../../world/regions/fire/materials';
import { getSpot } from '../../world/Spots';
import type { BloodbendingSystem } from '../blood/Bloodbending';
import type { LavaPatch, LavaSystem } from '../lava/LavaSystem';
import type { MoonSystem } from '../Moon';
import type { ProjectionSystem } from '../projection/Projection';
import type { SubSkillSystem } from '../SubSkills';
import { SITES } from './sites';
import { guardHud } from '../hudGuard';

/**
 * Scripts for the specialized-bending quests (data: data/quests_subskills.ts; places: sites.ts).
 * Each beat watches game events and sets the flags its quest step waits on.
 *
 *  The Heart of the Mountain — Lien's legends (after talking to him), the descent, the lava flow
 *    walled off and bridged with ordinary earthbending, the lava wave that wakes lavabending
 *    (Melt + Divert and Cool are lent on the spot), the rock plug melted, the trial chamber.
 *  The Silent Mind — Tenzo's words (Mangal), the hold-to-focus mat in the Avatar sanctuary (only
 *    quiet fills it), the first projection there, the sealed vault with a hidden spirit.
 *  The Puppetmaster — Hama's inn and lessons, resting until the full moon, the night in the woods:
 *    the "ultimate technique", Hama holds you (break free by drawing on the moon), then two
 *    villagers she makes attack you; stop her with bloodbending (the forced first use) or, refusing,
 *    beat her another way (Water mastery or the Avatar State) — the skill then stays locked and she
 *    can teach it later from her cell. The cave prison, the vow.
 * Moves a trial needs are lent and slotted for the trial and the previous loadout comes back after.
 */
const tA = new THREE.Vector3();
const T = SUB_SITES.tunnels;

type Line = [speaker: string, text: string];

export class SubskillQuestScripts implements GameSystem {
  private ctx!: GameContext;
  /** Loadouts saved while a trial lends its moves. */
  private readonly saved = new Map<Element, Array<string | null>>();
  private patched = false;
  // Heart of the Mountain
  private hmLava = false;
  private flowCasts = 0;
  private dam: THREE.Mesh | null = null;
  private wave: { mesh: THREE.Mesh; u: number; state: 'idle' | 'rolling' | 'stone' | 'reset'; t: number; lastCell: number } | null = null;
  private dummies: TrainingDummy[] = [];
  // Silent Mind
  private matHold = 0;
  private matActive = false;
  private matBar: HTMLElement | null = null;
  private matFill: HTMLElement | null = null;
  private vault: { group: THREE.Group; cols: number[]; spirit: THREE.Sprite; x: number; y: number; z: number } | null = null;
  // Puppetmaster
  private scene: 'none' | 'reveal' | 'heldPlayer' | 'allies' | 'resolved' = 'none';
  private hama: Enemy | null = null;
  private allies: Array<{ id: string; t: number }> = [];
  private hamaPassive = true;
  private afterShown = false;
  private unreg: Array<() => void> = [];
  private newMoonT = 0;
  readonly log: string[] = [];

  init(ctx: GameContext): void {
    this.ctx = ctx;
    for (const spec of SUBSKILL_NPCS) {
      const { look, ...def } = spec;
      if (look) (def as NPCDef).appearance = buildMasterLook(look, 'fire');
      ctx.npcs.addDef(def as NPCDef);
    }
    // Villagers freed from the cave prison come home.
    const freed: Array<[string, string, number, number]> = [['sq_freed_1', 'Lien Hua', -6, 18], ['sq_freed_2', 'Old Bo', 4, 19], ['sq_freed_3', 'Kenji', 10, 9]];
    for (const [id, name, dx, dz] of freed) ctx.npcs.addDef({ id, name, title: 'Freed villager', role: 'villager', nation: 'fire', appearanceSeed: 9300 + dx, x: SUB_SITES.village.x + dx, z: SUB_SITES.village.z + dz, behavior: { type: 'converse' }, dialogue: 'dlg_pm_villager', region: 'fire_nation_capital', condition: { flag: 'pm_freed' } });
    for (const d of SUBSKILL_DIALOGUES) ctx.npcs.addDialogue(d);
    for (const id of ['hama_lesson', 'rest_full_moon', 'hama_custody_teach', 'elder_meditate']) ctx.npcs.onAction(id, () => this.onCustom(id));
    ctx.events.on('dialogue:ended', (e) => this.onDialogueEnded(e.npcId));
    ctx.events.on('technique:cast', (e) => this.onCast(e.id, e.element, e.isPlayer));
    ctx.events.on('lava:formed', (e) => this.onLavaFormed(e.x, e.z));
    ctx.events.on('quest:completed', (e) => this.onQuestCompleted(e.questId));
    ctx.events.on('projection:changed', (e) => this.onProjection(e.active, e.reason));
    ctx.events.on('bloodbending:hold', (e) => this.onHold(e.targetId, e.active, e.byPlayer, e.reason));
    ctx.events.on('avatarState:changed', (e) => {
      if (e.active && (this.scene === 'heldPlayer' || this.scene === 'allies')) this.refusalWin('The Avatar State breaks Hama\'s grip on everyone at once.');
    });
    // Hama stays still while she works the strings (until you fight her).
    Enemy.thinkHooks.push((e) => {
      if (e !== this.hama || !this.hamaPassive) return;
      e.moveMode = 'stop';
      e.attackToken = false;
    });
    this.buildMatBar();
    this.installDebug();
  }

  onSessionStart(ctx: GameContext): void {
    this.hmLava = false;
    this.flowCasts = 0;
    this.scene = 'none';
    this.afterShown = false;
    this.registerInteractions(ctx);
    if (!this.patched) this.patchWaterDialogues();
    if (FEATURES.ENABLE_MOONLESS_BLOODBENDING && this.subs()?.isUnlocked('blood')) ctx.quests.setFlag('korra_moonless_available');
  }

  /** World interactions: the cave prison's slab and a bed at the inn. */
  private registerInteractions(ctx: GameContext): void {
    for (const u of this.unreg) u();
    this.unreg = [];
    const P = SUB_SITES.prison;
    const slabPos = new THREE.Vector3(P.x + 1, ctx.world.heightAt(P.x, P.z) + 1.2, P.z);
    this.unreg.push(
      ctx.interactions.register({
        id: 'sq_prison_slab',
        position: slabPos,
        radius: 3.5,
        label: 'Break open the cave prison',
        priority: 2,
        enabled: () => this.step('sq_puppetmaster') === 'free' && !!SITES.slab?.col,
        interact: () => this.openPrison(),
      }),
    );
    const I = SUB_SITES.inn;
    this.unreg.push(
      ctx.interactions.register({
        id: 'sq_inn_rest',
        position: new THREE.Vector3(I.x - 3, ctx.world.heightAt(I.x - 3, I.z + 5.5) + 1, I.z + 5.5),
        radius: 2.5,
        label: 'Rest at the inn until the full moon',
        priority: 1,
        enabled: () => this.step('sq_puppetmaster') === 'fullmoon' && !this.moon()?.fullMoonUp,
        interact: () => this.restUntilFullMoon(),
      }),
    );
  }

  onSessionEnd(ctx: GameContext): void {
    for (const u of this.unreg) u();
    this.unreg = [];
    this.lava()?.removeTag('hm');
    this.lava()?.removeTag('hm_wave');
    this.wave?.mesh.removeFromParent();
    this.wave = null;
    this.dam?.removeFromParent();
    this.dam = null;
    for (const d of this.dummies) if (!d.disposed) ctx.entities.remove(d);
    this.dummies = [];
    this.removeVault();
    this.endScene();
  }

  // ---------------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------------

  private subs(): SubSkillSystem | undefined {
    return this.ctx.extra.get('subskills') as SubSkillSystem | undefined;
  }
  private lava(): LavaSystem | undefined {
    return this.ctx.extra.get('lava') as LavaSystem | undefined;
  }
  private moon(): MoonSystem | undefined {
    return this.ctx.extra.get('moon') as MoonSystem | undefined;
  }
  private blood(): BloodbendingSystem | undefined {
    return this.ctx.extra.get('bloodbending') as BloodbendingSystem | undefined;
  }
  private proj(): ProjectionSystem | undefined {
    return this.ctx.extra.get('projection') as ProjectionSystem | undefined;
  }

  /** The id of a quest's current step (null when not active). */
  step(q: string): string | null {
    const prog = this.ctx.quests.active.get(q);
    if (!prog) return null;
    return this.ctx.quests.get(q)?.steps[prog.step]?.id ?? null;
  }

  private flag(f: string): void {
    this.ctx.quests.setFlag(f);
    this.log.push(f);
  }

  /** Show lines one after another (dialogue box), then run `done`. */
  say(lines: Line[], done?: () => void, choices?: Array<{ text: string; onSelect: () => void }>): void {
    const ui = this.ctx.ui;
    const show = (i: number) => {
      const [speaker, text] = lines[i];
      const last = i === lines.length - 1;
      ui.showDialogue({
        speaker,
        text,
        choices: last && choices ? choices.map((c) => ({ text: c.text, onSelect: () => (ui.hideDialogue(), c.onSelect()) })) : [{ text: last ? 'Continue' : '…', onSelect: () => (last ? (ui.hideDialogue(), done?.()) : show(i + 1)) }],
      });
    };
    if (lines.length) show(0);
  }

  /** Put these moves in an element's slots for a trial (the old loadout is saved). */
  private lendSlots(e: Element, ids: string[]): void {
    const pr = this.ctx.progression;
    if (!this.saved.has(e)) this.saved.set(e, [...pr.slotsFor(e)]);
    ids.forEach((id, i) => pr.equip(e, i, id));
  }

  private restoreSlots(e: Element): void {
    const prev = this.saved.get(e);
    if (!prev) return;
    this.saved.delete(e);
    const pr = this.ctx.progression;
    for (let i = 0; i < 4; i++) pr.equip(e, i, prev[i] ?? null);
  }

  private label(a: Action): string {
    return this.ctx.input.label(a);
  }

  // ---------------------------------------------------------------------------
  // Frame
  // ---------------------------------------------------------------------------

  /** Open what the save says is open (plug melted, flow bridged, prison opened), once per session/build. */
  private syncedStamp = -1;
  private syncSites(): void {
    if (!SITES.built || this.syncedStamp === SITES.sessionStamp) return;
    this.syncedStamp = SITES.sessionStamp;
    const q = this.ctx.quests;
    if (q.hasFlag('hm_melted')) this.removePlug(false);
    if (q.hasFlag('hm_bridged') && SITES.heatBlock) {
      this.ctx.world.collision.remove(SITES.heatBlock);
      SITES.heatBlock = 0;
    }
    if (q.hasFlag('pm_freed') && SITES.slab?.col) {
      this.ctx.world.collision.remove(SITES.slab.col);
      SITES.slab.col = 0;
      SITES.slab.mesh.visible = false;
    }
  }

  update(dt: number, ctx: GameContext): void {
    if (ctx.session.kind !== 'campaign' || !ctx.player) return;
    this.syncSites();
    this.updateHeart(dt);
    this.updateSilent(dt);
    this.updatePuppet(dt);
    this.updateMoonless(dt);
  }

  // ---------------------------------------------------------------------------
  // The Heart of the Mountain
  // ---------------------------------------------------------------------------

  /** Player position in the tunnel frame (u along +X, v along +Z), or null outside. */
  private tunnelLocal(): { u: number; v: number } | null {
    const tf = SITES.tunnel;
    const p = this.ctx.player!.position;
    if (!tf) return null;
    const u = p.x - T.x, v = p.z - T.z;
    if (Math.abs(u) > 37 || Math.abs(v) > 10 || Math.abs(p.y - tf.F) > 4) return null;
    return { u, v };
  }

  private spawnTunnelLava(): void {
    const tf = SITES.tunnel;
    const lava = this.lava();
    if (!tf || !lava || this.hmLava) return;
    this.hmLava = true;
    const F = tf.F;
    const at = (u: number, v: number) => tf.at(u, v);
    const pool = (u: number, v: number, r: number) => {
      const p = at(u, v);
      lava.spawnPatch({ x: p.x, z: p.z, r, source: 'world', kind: 'world', tag: 'hm', y: F, spread: 0 });
    };
    // Glowing pools along the walls.
    pool(30, -3.6, 1.0);
    pool(-6, 6.4, 1.5);
    pool(2, -6.6, 1.3);
    pool(-33, 5.2, 1.3);
    pool(-24, -5.4, 1.1);
    // The flow across the passage (a bridge once cooled).
    const cells = [-2, 0, 2].map((v) => ({ ...(({ x, z }) => ({ x, z }))(at(13.7, v)), r: 1.45 }));
    const flow = lava.spawnPatch({ x: cells[1].x, z: cells[1].z, cells, source: 'world', kind: 'world', tag: 'hm', y: F, floorY: F + 0.05, flowX: 0, flowZ: 1, spread: 0 });
    if (flow && this.ctx.quests.hasFlag('hm_bridged')) this.bridgeFlow(flow, false);
    if (this.ctx.quests.hasFlag('hm_bridged') && SITES.heatBlock) {
      this.ctx.world.collision.remove(SITES.heatBlock);
      SITES.heatBlock = 0;
    }
    if (this.ctx.quests.hasFlag('hm_melted')) this.removePlug(false);
  }

  private flowPatch(): LavaPatch | null {
    const tf = SITES.tunnel;
    if (!tf) return null;
    const c = tf.at(13.7, 0);
    for (const p of this.lava()?.patches ?? []) if (p.tag === 'hm' && p.cells.length === 3 && Math.hypot(p.cells[1].x - c.x, p.cells[1].z - c.z) < 1) return p;
    return null;
  }

  private bridgeFlow(p: LavaPatch, loud: boolean): void {
    this.lava()?.cool(p, false, loud);
    if (SITES.heatBlock) {
      this.ctx.world.collision.remove(SITES.heatBlock);
      SITES.heatBlock = 0;
    }
  }

  private removePlug(loud: boolean): void {
    const plug = SITES.plug;
    if (!plug) return;
    if (plug.col) this.ctx.world.collision.remove(plug.col);
    plug.col = 0;
    plug.mesh.visible = false;
    if (loud) {
      this.ctx.audio.play('sub.lava.melt', { position: plug.mesh.position, volume: 1 });
      this.ctx.vfx.burst('embers', plug.mesh.position, { count: 24, speed: 4, radius: 1.6 });
    }
  }

  private updateHeart(dt: number): void {
    const ctx = this.ctx;
    const st = this.step('sq_heart_of_the_mountain');
    if (!st) return;
    if (SITES.tunnel && Math.hypot(ctx.player!.position.x - T.x, ctx.player!.position.z - T.z) < 120) this.spawnTunnelLava();
    const loc = this.tunnelLocal();
    if (st === 'descend' && loc && loc.u > 18) {
      this.flag('hm_inside');
      ctx.events.emit('ui:notify', { text: 'The air shimmers with heat. Somewhere ahead, lava moves like slow water.', kind: 'info', duration: 4 });
    }
    if (st === 'wave' && loc && loc.u < 4 && !this.wave) this.startWave();
    if (this.wave) this.updateWave(dt);
    if (st === 'trial' && loc && loc.u < -19 && !this.dummies.length) this.startLavaTrial();
  }

  private startWave(): void {
    const ctx = this.ctx;
    const tf = SITES.tunnel!;
    const subs = this.subs();
    subs?.teach('lava_melt');
    subs?.teach('lava_cool');
    this.lendSlots('earth', ['lava_cool', 'lava_melt']);
    const geo = new THREE.BoxGeometry(1.2, 2.8, 15);
    const mesh = new THREE.Mesh(geo, lavaMat());
    mesh.position.copy(tf.at(-14, 0, 1.4));
    ctx.scene.add(mesh);
    this.wave = { mesh, u: -14, state: 'rolling', t: 0, lastCell: -14 };
    const lava = this.lava();
    lava?.diverters.push({
      near: (x, z) => !!this.wave && this.wave.state === 'rolling' && Math.abs(x - (T.x + this.wave.u)) < 7 && Math.abs(z - T.z) < 9,
      divert: () => this.divertWave(),
    });
    ctx.audio.play('sub.lava.rumble', { position: mesh.position, volume: 1 });
    ctx.events.emit('camera:shake', { intensity: 0.35, duration: 1 });
    this.say([
      ['', 'The mountain groans. A wave of lava pours out of the far wall and rolls toward you.'],
      ['', `Your earthbending answers it differently now — the rock is soft, alive. Turn it aside and cool it: Divert and Cool (${this.label('ability1')}).`],
    ]);
  }

  private divertWave(): boolean {
    const w = this.wave;
    if (!w || w.state !== 'rolling') return false;
    const ctx = this.ctx;
    w.state = 'stone';
    (w.mesh.material as THREE.Material) = new THREE.MeshStandardMaterial({ color: '#3a3330', roughness: 1, flatShading: true });
    w.mesh.scale.y = 0.18;
    w.mesh.position.y = SITES.tunnel!.F + 0.25;
    for (const p of [...(this.lava()?.patches ?? [])]) if (p.tag === 'hm_wave') this.lava()?.cool(p, false, true);
    ctx.vfx.burst('steam', w.mesh.position, { count: 30, radius: 6, speed: 3, size: 2 });
    ctx.audio.play('sub.lava.cool', { position: w.mesh.position, volume: 1 });
    this.flag('hm_wave_cooled');
    this.say([
      ['', 'The wave bends aside, slows... and sets into solid earth at your feet.'],
      ['', 'Like Bolin, under pressure, you have found it: lavabending. A plug of rock seals the way deeper — Melt it.'],
    ]);
    return true;
  }

  private updateWave(dt: number): void {
    const w = this.wave!;
    const ctx = this.ctx;
    const tf = SITES.tunnel;
    if (!tf || w.state === 'stone') return;
    if (w.state === 'reset') {
      w.t -= dt;
      if (w.t <= 0) {
        w.state = 'rolling';
        w.u = -14;
        w.lastCell = -14;
        this.lava()?.removeTag('hm_wave');
      }
      return;
    }
    w.u += dt * 1.6;
    w.mesh.position.copy(tf.at(w.u, 0, 1.4));
    // Lava left behind the front.
    if (w.u - w.lastCell > 3) {
      w.lastCell = w.u;
      const cells = [-5, 0, 5].map((v) => ({ x: T.x + w.u - 1.5, z: T.z + v, r: 2.5 }));
      this.lava()?.spawnPatch({ x: cells[1].x, z: cells[1].z, cells, source: 'world', kind: 'world', tag: 'hm_wave', y: tf.F, life: 30, spread: 0, flowX: 1, flowZ: 0 });
    }
    // It catches you: a burning shove, and it rolls back to come again.
    const p = ctx.player!;
    if (p.position.x - T.x < w.u + 0.9 && Math.abs(p.position.z - T.z) < 8) {
      const hp = p.health!.hp;
      ctx.combat.applyHit(null, p, { attacker: null, damage: Math.min(10, hp - 1), element: 'earth', techniqueId: 'lava_melt', knockback: new THREE.Vector3(9, 0, 0), stagger: 40 });
      w.state = 'reset';
      w.t = 4;
      ctx.events.emit('ui:notify', { text: `The wave catches you and pulls back... it will come again. Divert and Cool (${this.label('ability1')})!`, kind: 'warning', duration: 4 });
    } else if (w.u > 5) {
      w.state = 'reset';
      w.t = 3;
    }
  }

  private startLavaTrial(): void {
    const ctx = this.ctx;
    const tf = SITES.tunnel!;
    const subs = this.subs();
    for (const t of ['lava_disc', 'lava_pool', 'lava_stream', 'lava_moat']) subs?.teach(t);
    this.lendSlots('earth', ['lava_disc', 'lava_pool', 'lava_stream', 'lava_moat']);
    for (const [u, v] of [[-30, 3.5], [-31, -3.5], [-26, 0]] as const) {
      const d = new TrainingDummy(400, { label: 'Stone target' });
      d.position.copy(tf.at(u, v));
      ctx.entities.add(d);
      this.dummies.push(d);
    }
    this.say([
      ['', 'The deepest chamber. Here the molten earth is yours to shape.'],
      ['', `Throw a Lava Disc, open a Lava Pool, send a Lava Stream and ring yourself in a Lava Moat (${this.label('ability1')}–${this.label('ability4')}).`],
    ]);
  }

  private onLavaFormed(x: number, z: number): void {
    if (this.step('sq_heart_of_the_mountain') !== 'melt' || !SITES.plug?.col) return;
    const pp = SITES.plug.mesh.position;
    if (Math.hypot(x - pp.x, z - pp.z) < 4.5) {
      this.removePlug(true);
      this.flag('hm_melted');
      this.ctx.events.emit('ui:notify', { text: 'The plug of rock slumps into glowing lava. The way deeper is open.', kind: 'success', duration: 4 });
    }
  }

  // ---------------------------------------------------------------------------
  // The Silent Mind
  // ---------------------------------------------------------------------------

  private sanctuary(): { x: number; y: number; z: number } | null {
    const s = getSpot('shrine_air_avatars');
    if (!s) return null;
    return { x: s.x, y: (s as { y?: number }).y ?? this.ctx.world.groundAt(s.x, s.z, Infinity).y, z: s.z };
  }

  private updateSilent(dt: number): void {
    const ctx = this.ctx;
    const st = this.step('sq_silent_mind');
    if (!st) {
      this.showMat(false);
      return;
    }
    const s = this.sanctuary();
    if (st === 'focus' && s) this.updateMat(dt, s);
    else this.showMat(false);
    if (st === 'project' && !this.subs()?.taught.has('spirit_project')) {
      const subs = this.subs();
      for (const t of ['spirit_project', 'spirit_sight', 'spirit_return']) subs?.teach(t);
      this.lendSlots('air', ['spirit_project']);
      ctx.events.emit('ui:notify', { text: `Hold ${this.label('ability1')} in the sanctuary to Project.`, kind: 'info', duration: 5 });
    }
    if (st === 'trial' && s && !this.vault) this.buildVault(s);
    if (this.vault) {
      const pr = this.proj();
      const sight = !!pr && pr.state === 'projecting' && (pr as unknown as { sightT: number }).sightT > 0;
      const v = this.vault;
      v.spirit.visible = sight || ctx.quests.hasFlag('sm_spirit_found');
      (v.spirit.material as THREE.SpriteMaterial).opacity = 0.65 + 0.25 * Math.sin(ctx.time.elapsed * 3);
    }
  }

  private buildMatBar(): void {
    if (typeof document === 'undefined' || !this.ctx.ui?.layers) return;
    const css = document.createElement('style');
    css.dataset.module = 'subskill_quests';
    css.textContent = `.sq-mat{position:absolute;top:58px;left:50%;transform:translateX(-50%);min-width:min(320px,88vw);padding:6px 12px 8px;border-radius:10px;
      background:rgba(14,22,36,.62);border:1px solid rgba(190,220,255,.35);color:#e6f0ff;font:12px var(--font-body,sans-serif);text-align:center;pointer-events:none;z-index:6}
      .sq-mat.hidden{display:none}.sq-mat .bar{height:6px;margin-top:5px;border-radius:3px;background:rgba(255,255,255,.12);overflow:hidden}
      .sq-mat .fill{height:100%;transform-origin:left;transform:scaleX(0);background:linear-gradient(90deg,#9cc8ff,#eaf4ff)}`;
    document.head.appendChild(css);
    this.matFill = document.createElement('div');
    this.matFill.className = 'fill';
    const bar = document.createElement('div');
    bar.className = 'bar';
    bar.appendChild(this.matFill);
    this.matBar = document.createElement('div');
    this.matBar.className = 'sq-mat hidden';
    this.matBar.textContent = 'Focus — keep holding, keep still. Only quiet fills it.';
    this.matBar.appendChild(bar);
    this.ctx.ui.layers.hud.appendChild(this.matBar);
    guardHud(this.ctx, this.matBar);
  }

  private showMat(on: boolean): void {
    this.matBar?.classList.toggle('hidden', !on);
  }

  /** The hold-to-focus mat: fills only in quiet; noise, movement, enemies and crowds break it. */
  private updateMat(dt: number, s: { x: number; y: number; z: number }): void {
    const ctx = this.ctx;
    const p = ctx.player!;
    const near = Math.hypot(p.position.x - s.x, p.position.z - s.z) < 4 && Math.abs(p.position.y - s.y) < 3;
    const input = ctx.input;
    if (!near) {
      this.matActive = false;
      this.showMat(false);
      return;
    }
    if (!this.matActive && input.wasPressed('interact')) {
      this.matActive = true;
      this.matHold = 0;
    }
    if (!this.matActive) {
      ctx.events.emit('ui:notify', { text: `Hold ${this.label('interact')} on the mat to meditate.`, kind: 'info', duration: 0.6 });
      return;
    }
    this.showMat(true);
    const pr = this.proj();
    const quiet = pr?.quietCheck();
    let broke: string | null = null;
    if (!input.isDown('interact')) broke = 'You let go. Hold to focus.';
    else if (Math.hypot(input.move.x, input.move.y) > 0.3) broke = 'You moved — the focus scatters.';
    else if (quiet && quiet.reason !== 'busy') broke = quiet.message;
    if (broke) {
      if (this.matHold > 0.05) ctx.events.emit('ui:notify', { text: broke, kind: 'warning', duration: 2.5 });
      this.matActive = false;
      this.matHold = 0;
      if (this.matFill) this.matFill.style.transform = 'scaleX(0)';
      return;
    }
    p.controlLock = Math.max(p.controlLock, 0.2);
    p.poseOverride = 'meditate';
    this.matHold += dt / 6;
    if (this.matFill) this.matFill.style.transform = `scaleX(${Math.min(1, this.matHold).toFixed(3)})`;
    if (this.matHold >= 1) {
      p.poseOverride = null;
      this.matActive = false;
      this.showMat(false);
      this.flag('sm_focused');
      this.say([['Monk Tenzo', 'Good. You felt it — the moment the world went quiet and you were still there. Now let go of the body, the way Mangal did. Here, where the spirit world is near.']]);
    }
  }

  private buildVault(s: { x: number; y: number; z: number }): void {
    const ctx = this.ctx;
    // A free spot beside the sanctuary at the same level, for a sealed stone vault.
    let spot: { x: number; z: number } | null = null;
    for (let r = 9; r <= 15 && !spot; r += 3) {
      for (let k = 0; k < 12; k++) {
        const a = (k / 12) * Math.PI * 2;
        const x = s.x + Math.cos(a) * r, z = s.z + Math.sin(a) * r;
        const g = ctx.world.groundAt(x, z, s.y + 2).y;
        if (Math.abs(g - s.y) > 0.8) continue;
        if (ctx.world.collision.overlapSphere(tA.set(x, s.y + 1.5, z), 2.2)) continue;
        spot = { x, z };
        break;
      }
    }
    spot ??= { x: s.x + 9, z: s.z };
    const y = ctx.world.groundAt(spot.x, spot.z, s.y + 2).y;
    const group = new THREE.Group();
    const mat = new THREE.MeshStandardMaterial({ color: '#d9d0bf', roughness: 0.9 });
    const box = (sx: number, sy: number, sz: number, x: number, yy: number, z: number) => {
      const m = new THREE.Mesh(new THREE.BoxGeometry(sx, sy, sz), mat);
      m.position.set(x, yy, z);
      group.add(m);
    };
    const W = 4, H = 3.2, t = 0.4;
    box(W, t, W, spot.x, y + H, spot.z);
    box(W, H, t, spot.x, y + H / 2, spot.z - W / 2);
    box(W, H, t, spot.x, y + H / 2, spot.z + W / 2);
    box(t, H, W, spot.x - W / 2, y + H / 2, spot.z);
    box(t, H, W, spot.x + W / 2, y + H / 2, spot.z);
    ctx.scene.add(group);
    const cols = [ctx.world.collision.add({ shape: 'box', x: spot.x, y: y + H / 2, z: spot.z, hx: W / 2, hy: H / 2, hz: W / 2, yaw: 0, solid: true, walkable: true, surface: 'stone', tag: 'subskill_vault' })];
    const tex = (() => {
      const c = document.createElement('canvas');
      c.width = c.height = 64;
      const g2 = c.getContext('2d')!;
      const grd = g2.createRadialGradient(32, 32, 0, 32, 32, 32);
      grd.addColorStop(0, '#f2fbff');
      grd.addColorStop(0.4, 'rgba(160,230,255,0.6)');
      grd.addColorStop(1, 'rgba(160,230,255,0)');
      g2.fillStyle = grd;
      g2.fillRect(0, 0, 64, 64);
      return new THREE.CanvasTexture(c);
    })();
    const spirit = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, color: '#bff4ff', transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }));
    spirit.position.set(spot.x, y + 1.3, spot.z);
    spirit.scale.set(1.2, 1.6, 1);
    spirit.visible = false;
    ctx.scene.add(spirit);
    this.vault = { group, cols, spirit, x: spot.x, y, z: spot.z };
    const pr = this.proj();
    pr?.sealed.push({ x: spot.x, y: y + 1.5, z: spot.z, label: 'Sealed alcove' });
    pr?.watchers.push((pos, sight) => {
      if (!this.vault || this.ctx.quests.hasFlag('sm_spirit_found')) return;
      if (sight && Math.hypot(pos.x - this.vault.x, pos.z - this.vault.z) < 2.6) {
        this.flag('sm_spirit_found');
        this.ctx.events.emit('ui:notify', { text: 'A small spirit, curled in the dark of the sealed alcove, opens its eyes at you. Now return before your focus runs out.', kind: 'success', duration: 5 });
      }
    });
    ctx.events.emit('ui:notify', { text: 'A sealed alcove beside the sanctuary. No door — only a spirit could enter.', kind: 'info', duration: 4 });
  }

  private removeVault(): void {
    const v = this.vault;
    if (!v) return;
    for (const c of v.cols) this.ctx.world.collision.remove(c);
    v.group.removeFromParent();
    v.group.traverse((o) => (o as THREE.Mesh).geometry?.dispose?.());
    v.spirit.removeFromParent();
    (v.spirit.material as THREE.SpriteMaterial).map?.dispose();
    (v.spirit.material as THREE.SpriteMaterial).dispose();
    this.vault = null;
  }

  private onProjection(active: boolean, reason?: string): void {
    if (active || this.step('sq_silent_mind') !== 'trial') return;
    const q = this.ctx.quests;
    if (q.hasFlag('sm_spirit_found') && reason === 'return') this.flag('sm_returned');
    else if (q.hasFlag('sm_spirit_found')) {
      q.flags.delete('sm_spirit_found');
      this.ctx.events.emit('ui:notify', { text: 'Your focus failed before you returned. Meditate and try again.', kind: 'warning', duration: 4 });
    }
  }

  // ---------------------------------------------------------------------------
  // The Puppetmaster
  // ---------------------------------------------------------------------------

  private director(): EncounterDirector | undefined {
    return this.ctx.extra.get('encounters') as EncounterDirector | undefined;
  }

  private updatePuppet(dt: number): void {
    const ctx = this.ctx;
    const st = this.step('sq_puppetmaster');
    const p = ctx.player!;
    if (st === 'fullmoon' && this.scene === 'none') {
      const m = this.moon();
      const C = SUB_SITES.clearing;
      if (m?.fullMoonUp && Math.hypot(p.position.x - C.x, p.position.z - C.z) < 14) this.startNight();
    }
    if (this.scene === 'allies') this.updateAllies(dt);
    if ((this.scene === 'heldPlayer' || this.scene === 'allies') && this.hama) {
      if (!this.hama.alive || this.hama.defeated || (this.hama.health && this.hama.health.fraction < 0.25)) this.refusalWin('Hama falls to her knees, beaten without the art she wanted to give you.');
    }
    if (st === 'after' && !this.afterShown && !ctx.ui.blocksGameplay) {
      this.afterShown = true;
      this.scene = 'none';
      this.aftermath();
    }
  }

  private startNight(): void {
    const ctx = this.ctx;
    const C = SUB_SITES.clearing;
    this.flag('pm_night');
    this.flag('pm_hama_scene');
    this.scene = 'reveal';
    const y = ctx.world.groundAt(C.x, C.z, Infinity).y;
    const hama = this.director()?.spawnEnemy('water_pirate', { x: C.x + 6, y, z: C.z }, { level: 9, name: 'Hama', appearance: buildMasterLook(HAMA_LOOK, 'fire'), yaw: -Math.PI / 2, leash: 40 }) ?? null;
    if (hama) {
      hama.tags.add('hama');
      this.hama = hama;
      this.hamaPassive = true;
    }
    // Two villagers who came along to help.
    for (const [id, name, dz] of [['sq_ally_toma', 'Toma', 3], ['sq_ally_ren', 'Ren', -3]] as const) {
      ctx.npcs.addDef({ id, name, title: 'Villager', role: 'villager', nation: 'fire', appearanceSeed: id.length * 77, x: C.x - 3, z: C.z + dz, behavior: { type: 'idle', variant: 'stand' }, region: 'fire_nation_capital', condition: { flag: 'pm_hama_scene', notFlag: 'pm_stopped' } });
      if (!ctx.npcs.get(id)) ctx.npcs.spawn(ctx.npcs.getDef(id)!);
    }
    const blood = this.blood();
    if (blood) blood.scriptedOk = true;
    this.say(
      [
        ['Hama', 'You came. Good. Look at the moon, child — feel how it pulls at the water in everything. In every living thing.'],
        ['Hama', 'In my prison, under the full moon, I learned to take hold of the water inside a body. Rats, at first. Then my guard. I walked out of that cell.'],
        ['Hama', 'Bloodbending. The ultimate technique. I can teach you. Together we will make them pay for what they did to our people.'],
      ],
      undefined,
      [
        { text: 'Teach me.', onSelect: () => this.hamaHolds(true) },
        { text: 'No. Where are the villagers, Hama?', onSelect: () => this.hamaHolds(false) },
      ],
    );
  }

  private hamaHolds(accepted: boolean): void {
    const ctx = this.ctx;
    const blood = this.blood();
    const p = ctx.player!;
    if (!this.hama || !blood) return;
    this.scene = 'heldPlayer';
    blood.hold(this.hama, p);
    this.hama.humanoid?.animator.play('blood_bend_rigid', { fadeIn: 0.1, hold: true });
    ctx.events.emit('ui:notify', { text: accepted ? 'Hama: "First, feel it for yourself."' : 'Hama: "Then you will learn it the hard way!"', kind: 'warning', duration: 3 });
  }

  /** After the player broke free: Hama seizes the two villagers and sends them at you. */
  private hamaHoldsAllies(): void {
    const ctx = this.ctx;
    const blood = this.blood();
    if (!this.hama || !blood) return;
    this.scene = 'allies';
    this.allies = [];
    for (const id of ['sq_ally_toma', 'sq_ally_ren']) {
      const n = ctx.npcs.get(id);
      if (n && blood.hold(this.hama, n)) this.allies.push({ id, t: 0 });
    }
    const subs = this.subs();
    subs?.teach('blood_hold');
    subs?.teach('blood_release');
    this.lendSlots('water', ['blood_hold', 'blood_release']);
    if (ctx.player!.element !== 'water') ctx.player!.switchElement('water', true);
    this.say([
      ['Hama', 'Strong. Stronger than I was. But can you stop me from doing this?'],
      ['', `Toma and Ren jerk toward you like puppets on strings. Under this moon, only one thing can stop her — Hold her (${this.label('ability1')}).`],
    ]);
  }

  private updateAllies(dt: number): void {
    const ctx = this.ctx;
    const p = ctx.player!;
    for (const a of this.allies) {
      const n = ctx.npcs.get(a.id);
      if (!n?.held) continue;
      const to = tA.copy(p.position).sub(n.position).setY(0);
      const d = to.length();
      n.held.move.copy(d > 1.4 ? to.normalize().multiplyScalar(2) : to.set(0, 0, 0));
      n.held.yaw = Math.atan2(p.position.x - n.position.x, p.position.z - n.position.z);
      a.t -= dt;
      if (d < 1.8 && a.t <= 0) {
        a.t = 1.6;
        n.humanoid.animator.play('blood_shove', { fadeIn: 0.03 });
        const hp = p.health!.hp;
        if (hp > 2) ctx.combat.applyHit(null, p, { attacker: null, damage: Math.min(4, hp - 1), element: 'water', techniqueId: 'blood_puppet', knockback: to.set(p.position.x - n.position.x, 0, p.position.z - n.position.z).normalize().multiplyScalar(4) });
      }
    }
  }

  private onHold(targetId: number, active: boolean, byPlayer: boolean, reason?: string): void {
    const ctx = this.ctx;
    // The player broke Hama's hold.
    if (!active && this.scene === 'heldPlayer' && targetId === ctx.player?.id && reason === 'brokeFree') {
      this.hamaHoldsAllies();
      return;
    }
    // The forced first use: the player holds Hama.
    if (active && byPlayer && this.hama && targetId === this.hama.id && (this.scene === 'allies' || this.scene === 'heldPlayer')) {
      this.flag('pm_bloodbender');
      const blood = this.blood();
      for (const h of [...(blood?.holds ?? [])]) if (h.holder === this.hama) blood!.release(h, 'released');
      this.scene = 'resolved';
      this.say(
        [
          ['', 'Hama freezes mid-gesture. Her arms drop. Toma and Ren stumble free.'],
          ['Hama', '...So. You did it. My work is done.'],
          ['Hama', 'Congratulations. You are a bloodbender.'],
          ['', 'The villagers come running with torches and rope. They lead Hama away.'],
        ],
        () => this.resolveScene(true),
      );
    }
    // Remember the full moons on which a hold was made (Korra extension training).
    if (active && byPlayer && ctx.quests.isActive('sq_tide_without_moon')) {
      const night = this.moon()?.nightIndex() ?? 0;
      ctx.quests.setFlag(`mb_moon_${night}`);
      const moons = [...ctx.quests.flags].filter((f) => f.startsWith('mb_moon_')).length;
      if (moons >= 3) this.flag('mb_three_moons');
    }
  }

  private refusalWin(text: string): void {
    if (this.scene === 'resolved' || this.scene === 'none') return;
    const blood = this.blood();
    for (const h of [...(blood?.holds ?? [])]) if (h.holder === this.hama) blood!.release(h, 'released');
    this.flag('pm_refused');
    this.scene = 'resolved';
    this.say(
      [
        ['', text],
        ['Hama', 'You could have had it all... and you refused. Fool.'],
        ['', 'The villagers come running with torches and rope. They lead Hama to the lockup.'],
      ],
      () => this.resolveScene(false),
    );
  }

  private resolveScene(bloodbender: boolean): void {
    const ctx = this.ctx;
    this.flag('pm_stopped');
    this.flag('pm_hama_gone');
    ctx.quests.flags.delete('pm_hama_scene');
    this.endScene();
    this.restoreSlots('water');
    if (bloodbender) ctx.events.emit('ui:notify', { text: 'The moon is high. Something in you feels heavier.', kind: 'info', duration: 4 });
  }

  private endScene(): void {
    const blood = this.blood();
    if (blood) {
      for (const h of [...blood.holds]) if (h.holder === this.hama) blood.release(h, 'scene');
      blood.scriptedOk = false;
    }
    if (this.hama) {
      this.director()?.release(this.hama);
      this.hama = null;
    }
    for (const id of ['sq_ally_toma', 'sq_ally_ren']) if (this.ctx.npcs.get(id)) this.ctx.npcs.despawn(id);
    this.allies = [];
  }

  /** The cave prison slab (quest step 'free'). */
  private openPrison(): void {
    const slab = SITES.slab;
    if (!slab || !slab.col) return;
    this.ctx.world.collision.remove(slab.col);
    slab.col = 0;
    slab.mesh.visible = false;
    this.ctx.audio.play('bend_earth_slam', { position: slab.mesh.position, volume: 0.8 });
    this.ctx.vfx.burst('dust', slab.mesh.position, { count: 20, radius: 1.5, speed: 2 });
    this.flag('pm_freed');
    this.ctx.events.emit('ui:notify', { text: 'The slab grinds aside. Pale, blinking villagers stumble out into the moonlight — free.', kind: 'success', duration: 5 });
  }

  private aftermath(): void {
    const ctx = this.ctx;
    if (!ctx.quests.hasFlag('pm_bloodbender')) {
      this.say([['', 'You stopped her without becoming what she wanted. The art stays sealed — though Hama, in her cell, would still teach it on a full-moon night.']], () => this.flag('pm_after'));
      return;
    }
    const subs = this.subs();
    this.say(
      [
        ['', 'Your hands still remember the feeling — the water in someone else\'s body, answering you instead of them.'],
        ['', `Moral Strain: ${subs ? Math.round(subs.strain) : 0} / 100. It is the only bending art known to endanger the bender's own mind.`],
      ],
      undefined,
      [
        { text: 'Vow never to bloodbend again.', onSelect: () => (subs?.takeVow(), this.flag('pm_after')) },
        { text: 'Keep the art. Use it only if I must.', onSelect: () => this.flag('pm_after') },
      ],
    );
  }

  // ---------------------------------------------------------------------------
  // Dialogue actions, casts, talks
  // ---------------------------------------------------------------------------

  private onCustom(id: string): void {
    const ctx = this.ctx;
    switch (id) {
      case 'hama_lesson': {
        const pr = ctx.progression;
        if (!pr.knows('water_moisture')) pr.learn('water_moisture', 'quest');
        this.say([
          ['Hama', 'In the South there is ice and snow everywhere — water for the taking. Here, it hides. But it is never truly gone.'],
          ['Hama', 'Feel the wet in the air on a warm night... and in the plants. Pull it out. Gently. (Moisture Extraction — try it now.)'],
        ]);
        if (!ctx.quests.hasFlag('pm_lesson_ready')) ctx.quests.setFlag('pm_lesson_ready');
        break;
      }
      case 'rest_full_moon':
        this.restUntilFullMoon();
        break;
      case 'hama_custody_teach': {
        if (!this.moon()?.fullMoonUp) {
          this.say([['Hama', 'Not now. Come back when the moon is full — then I will show you.']]);
          break;
        }
        this.flag('pm_custody_taught');
        this.say([['Hama', 'Feel the moon... now reach into the water inside a living thing. There. You have it. Use it well — or don\'t. It is yours now.']]);
        break;
      }
      case 'elder_meditate':
        this.subs()?.elderMeditation();
        break;
    }
  }

  /** Rest at the inn until the evening of the next full-moon night. */
  restUntilFullMoon(): void {
    const ctx = this.ctx;
    const m = this.moon();
    if (!m) return;
    const sky = ctx.world.sky;
    let n = m.nightsToFull();
    if (n === 0 && sky.timeOfDay >= 6 && sky.timeOfDay < 12) n = 0;
    m.day += n + (sky.timeOfDay < 12 && n > 0 ? -1 : 0);
    sky.timeOfDay = 20.6;
    ctx.ui.showBanner('You rest at the inn...', `${m.phaseName()} — ${Math.floor(sky.timeOfDay)}:${String(Math.floor((sky.timeOfDay % 1) * 60)).padStart(2, '0')}`);
    ctx.events.emit('ui:notify', { text: m.isFullMoonNight ? 'The full moon rises over the village. Go to the woods by the hill.' : 'You rest.', kind: 'info', duration: 5 });
  }

  private onDialogueEnded(npcId: string): void {
    if (npcId === 'master_lien' && this.step('sq_heart_of_the_mountain') === 'legends') {
      this.say(
        [
          ['Master Lien', 'Melting the earth itself? There are only legends. Avatar Szeto raised four volcanoes at once. Avatar Kyoshi split her people\'s peninsula from the mainland with fissures and lava.'],
          ['Master Lien', 'And Avatar Roku turned a river of lava aside to save the people of his island. No living master can teach you that. If it is in you, it will wake under pressure — where the earth is already burning.'],
          ['Master Lien', 'They say there are natural tunnels at the north-west foot of the Fire Nation capital\'s volcano, full of lava rivers. Go carefully.'],
        ],
        () => this.flag('hm_legends'),
      );
    }
    if (npcId === 'master_tenzo' && this.step('sq_silent_mind') === 'tenzo') {
      this.say(
        [
          ['Monk Tenzo', 'So you have mastered the wind. Then you are ready to hear this: the greatest of us could leave the body behind altogether.'],
          ['Monk Tenzo', 'In the time of Avatar Kyoshi, a nun named Mangal could send her spirit across the world while her body sat in meditation. She needed a silent place and a silent mind — nothing else.'],
          ['Monk Tenzo', 'Begin with the silence. Sit on the mat in the Avatar sanctuary, where the spirit world is near, and hold your focus.'],
        ],
        () => this.flag('sm_tenzo'),
      );
    }
    if (npcId === 'sq_hama' && this.step('sq_puppetmaster') === 'lessons' && this.ctx.quests.hasFlag('pm_lesson_ready') && this.ctx.progression.knows('water_moisture')) {
      // Lesson continues when the player tries the technique.
    }
  }

  private onCast(id: string, element: string, isPlayer: boolean): void {
    if (!isPlayer) return;
    const ctx = this.ctx;
    // Hama's lesson: drawing water from the air and plants.
    if (id === 'water_moisture' && this.step('sq_puppetmaster') === 'lessons' && ctx.quests.hasFlag('pm_lesson_ready')) {
      this.flag('pm_lesson_done');
      this.say([['Hama', 'Yes! Just like that. You learn quickly, dear... very quickly.']]);
    }
    // The flow: wall it off, then bridge it, with ordinary earthbending.
    if (element === 'earth' && !id.startsWith('lava_') && this.step('sq_heart_of_the_mountain') === 'flow') {
      const tf = SITES.tunnel;
      const p = ctx.player!;
      if (!tf) return;
      const c = tf.at(13.7, 0);
      if (Math.hypot(p.position.x - c.x, p.position.z - c.z) > 10) return;
      this.flowCasts++;
      if (this.flowCasts === 1) {
        const geo = new THREE.BoxGeometry(3, 1.6, 0.8);
        const dam = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ color: '#6b5a4a', roughness: 1, flatShading: true }));
        dam.position.copy(tf.at(13.7, 2.2, 0.8));
        ctx.scene.add(dam);
        this.dam = dam;
        ctx.events.emit('ui:notify', { text: 'Your wall dams the flow at the wall. Now raise earth over it — bridge it.', kind: 'info', duration: 4 });
      } else {
        const flow = this.flowPatch();
        if (flow) this.bridgeFlow(flow, true);
        this.flag('hm_bridged');
        ctx.events.emit('ui:notify', { text: 'Earth crusts over the lava: a bridge, still warm underfoot.', kind: 'success', duration: 4 });
      }
    }
  }

  private onQuestCompleted(q: string): void {
    if (q === 'sq_heart_of_the_mountain') {
      this.restoreSlots('earth');
      for (const d of this.dummies) if (!d.disposed) this.ctx.entities.remove(d);
      this.dummies = [];
    }
    if (q === 'sq_silent_mind') {
      this.restoreSlots('air');
      this.removeVault();
    }
  }

  // ---------------------------------------------------------------------------
  // Strain reactions in Water Tribe dialogue (data: STRAIN_DIALOGUE_NODES)
  // ---------------------------------------------------------------------------

  private patchWaterDialogues(): void {
    this.patched = true;
    const npcs = this.ctx.npcs;
    const map = (npcs as unknown as { dialogues: Map<string, DialogueDef> }).dialogues;
    if (!map) return;
    const ids = new Set<string>();
    for (const d of npcs.allDefs()) if (d.nation === 'water' && (d.role === 'elder' || d.role === 'guard') && d.dialogue) ids.add(d.dialogue);
    for (const id of ids) {
      const def = map.get(id);
      if (!def || def.nodes.strain_breaking) continue;
      const copy: DialogueDef = {
        ...def,
        start: [
          { node: 'strain_breaking', condition: { flag: 'strain_breaking' } },
          { node: 'strain_dark', condition: { flag: 'strain_dark' } },
          { node: 'strain_witnessed', condition: { flag: 'blood_witnessed', notFlag: 'strain_unease' } },
          ...def.start,
        ],
        nodes: { ...def.nodes, strain_breaking: STRAIN_DIALOGUE_NODES.breaking, strain_dark: STRAIN_DIALOGUE_NODES.dark, strain_witnessed: STRAIN_DIALOGUE_NODES.witnessed },
      };
      npcs.addDialogue(copy);
    }
  }

  // ---------------------------------------------------------------------------
  // Korra extension: moonless training
  // ---------------------------------------------------------------------------

  private updateMoonless(dt: number): void {
    const ctx = this.ctx;
    if (this.step('sq_tide_without_moon') !== 'newmoon') return;
    const m = this.moon();
    const oasis = ctx.world.landmark('spirit_oasis') ?? { x: -220, z: -1372 };
    const p = ctx.player!;
    const near = Math.hypot(p.position.x - oasis.x, p.position.z - oasis.z) < 30;
    const still = Math.hypot(ctx.input.move.x, ctx.input.move.y) < 0.1;
    if (near && still && m?.moonUp && m.phaseIndex() === 0) {
      this.newMoonT += dt;
      if (this.newMoonT > 6) this.flag('mb_newmoon');
    } else this.newMoonT = 0;
  }

  // ---------------------------------------------------------------------------
  // Debug
  // ---------------------------------------------------------------------------

  private installDebug(): void {
    if (typeof window === 'undefined') return;
    const w = window as unknown as { __game?: { debug: Record<string, unknown> } };
    const install = (): boolean => {
      if (!w.__game) return false;
      w.__game.debug.subquests = {
        sys: this,
        step: (q: string) => this.step(q),
        state: () => ({
          heart: this.step('sq_heart_of_the_mountain'),
          silent: this.step('sq_silent_mind'),
          puppet: this.step('sq_puppetmaster'),
          custody: this.step('sq_hama_custody'),
          scene: this.scene,
          hama: this.hama ? { id: this.hama.id, hp: this.hama.health?.hp, held: !!this.hama.held } : null,
          allies: this.allies.map((a) => ({ id: a.id, held: !!this.ctx.npcs.get(a.id)?.held })),
          wave: this.wave ? { u: +this.wave.u.toFixed(2), state: this.wave.state } : null,
          tunnelF: SITES.tunnel?.F ?? null,
          plug: !!SITES.plug?.col,
          slab: !!SITES.slab?.col,
          vault: this.vault ? { x: this.vault.x, y: this.vault.y, z: this.vault.z } : null,
          log: [...this.log],
        }),
        /** World position of a named place (for teleport tests). */
        place: (name: 'tunnelMouth' | 'flow' | 'wave' | 'plug' | 'trial' | 'inn' | 'clearing' | 'prison' | 'lockup' | 'sanctuary' | 'vault') => {
          const tf = SITES.tunnel;
          const tun: Record<string, [number, number]> = { tunnelMouth: [33, 0], flow: [17.5, 0], wave: [2, 0], plug: [-14.5, 0], trial: [-27, 0] };
          if (tun[name] && tf) return tf.at(tun[name][0], tun[name][1]);
          if (name === 'sanctuary') return this.sanctuary();
          if (name === 'vault') return this.vault ? { x: this.vault.x, y: this.vault.y, z: this.vault.z } : null;
          const s = (SUB_SITES as Record<string, { x: number; z: number }>)[name];
          return s ? { x: s.x, y: this.ctx.world.groundAt(s.x, s.z, Infinity).y, z: s.z } : null;
        },
        rest: () => this.restUntilFullMoon(),
        openPrison: () => this.openPrison(),
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

