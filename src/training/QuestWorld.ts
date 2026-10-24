import * as THREE from 'three';
import type { GameContext, GameSystem } from '../core/GameContext';
import type { Element } from '../core/types';
import { itemById } from '../data/items';
import { CITY_LIFE, LIFE_NPCS, type At } from '../data/npcs_life';
import { QUEST_PROPS, type QuestPropDef } from '../data/quests_props';
import { Entity, Health, type HitInfo, type HitResult } from '../entities/Entity';
import type { NPCDef } from '../npc/NPCTypes';
import type { QuestMarker } from '../quests/QuestSystem';
import { getSpot } from '../world/Spots';
import { LANDMARKS } from '../world/WorldLayout';

/**
 * Quest world content (module `quest_world`):
 *  - places spot-relative NPCs (quest givers, city life) from src/data/npcs_life.ts
 *    once every region has published its spots;
 *  - streams quest props (src/data/quests_props.ts): pickups, readable tablets /
 *    posters / journals (hidden-master clues), meditation circles, bells rung with
 *    airbending and braziers lit with firebending. Props exist only while their
 *    quest needs them (or always, for clues) and give real items / flags / events;
 *  - map & compass markers for the active quests' props.
 * Debug: window.__game.debug.quests = { props, use, hitProp, ... }.
 */

interface LiveProp {
  def: QuestPropDef;
  pos: THREE.Vector3;
  group: THREE.Group;
  entity: PropTarget | null;
  unregister: (() => void) | null;
  mats: THREE.Material[];
}

const ELEMENT_FX: Record<Element, string> = { air: '#f4f8ff', water: '#9fd8ff', earth: '#b9a07a', fire: '#ffb070' };

export function resolveAt(at: At): { x: number; z: number; y: number | undefined } | null {
  let x: number | undefined, z: number | undefined, y: number | undefined;
  if (at.spot) {
    const s = getSpot(at.spot);
    if (s) {
      x = s.x;
      z = s.z;
      y = s.y;
    }
  }
  if (x === undefined && at.landmark) {
    const l = LANDMARKS.find((l) => l.id === at.landmark);
    if (l) {
      x = l.x;
      z = l.z;
    }
  }
  if (x === undefined && at.x !== undefined && at.z !== undefined) {
    x = at.x;
    z = at.z;
  }
  if (x === undefined || z === undefined) return null;
  return { x: x + (at.dx ?? 0), z: z + (at.dz ?? 0), y: at.y ?? y };
}

/** Bell / brazier: a quest object that reacts to a bending element. */
class PropTarget extends Entity {
  readonly kind = 'target' as const;
  done = false;
  constructor(
    readonly element: Element,
    private readonly onTrigger: () => void,
  ) {
    super();
    this.name = 'Quest Object';
    this.team = 'neutral';
    this.tags.add('quest_prop');
    this.health = new Health(1e6, 9999, 0);
    this.height = 2.2;
    this.radius = 0.7;
  }
  override receiveHit(hit: HitInfo, _ctx: GameContext): HitResult {
    if (!this.done && hit.element === this.element && hit.attacker?.kind === 'player') {
      this.done = true;
      this.onTrigger();
    }
    return { damage: 0.01, killed: false, blocked: false, staggered: false };
  }
  update(): void {}
}

export class QuestWorld implements GameSystem {
  private ctx!: GameContext;
  private live = new Map<string, LiveProp>();
  private timer = 0;
  private placed = false;
  readonly missing: string[] = [];

  init(ctx: GameContext): void {
    this.ctx = ctx;
    this.placeNPCs();
    this.applyCrowdDensity();
    ctx.events.on('settings:changed', () => this.applyCrowdDensity());
    ctx.quests.addMarkerProvider(() => this.markers());
    this.installDebug();
  }

  private placeNPCs(): void {
    if (this.placed) return;
    this.placed = true;
    for (const spec of LIFE_NPCS) {
      const p = resolveAt(spec.at);
      if (!p) {
        this.missing.push(spec.id);
        continue;
      }
      const { at: _at, ...rest } = spec;
      const def: NPCDef = { ...rest, x: p.x, z: p.z, y: p.y };
      this.ctx.npcs.addDef(def);
    }
  }

  /** City crowds scale with the graphics preset (quest givers, merchants and masters always stay). */
  private applyCrowdDensity(): void {
    const g = this.ctx.settings.data.graphics;
    const density = g.preset === 'low' ? 0.55 : g.preset === 'medium' ? 0.8 : 1;
    for (const spec of CITY_LIFE) {
      const d = this.ctx.npcs.getDef(spec.id);
      if (!d) continue;
      let h = 2166136261;
      for (let i = 0; i < spec.id.length; i++) h = Math.imul(h ^ spec.id.charCodeAt(i), 16777619);
      d.hidden = ((h >>> 0) % 1000) / 1000 >= density;
    }
  }

  // ---------------------------------------------------------------------------
  // Props
  // ---------------------------------------------------------------------------

  private done(d: QuestPropDef): boolean {
    return this.ctx.quests.hasFlag(`prop_${d.id}`);
  }

  private wanted(d: QuestPropDef): boolean {
    if (this.done(d)) return false;
    const q = this.ctx.quests;
    if (d.always) return !d.quest || !q.isComplete(d.quest);
    if (!d.quest || !q.isActive(d.quest)) return false;
    if (d.step) {
      const def = q.get(d.quest);
      const prog = q.active.get(d.quest);
      if (!def || !prog || def.steps[prog.step]?.id !== d.step) return false;
    }
    return true;
  }

  private propPos(d: QuestPropDef): THREE.Vector3 | null {
    const p = resolveAt(d.at);
    if (!p) return null;
    const y = p.y !== undefined ? this.ctx.world.groundAt(p.x, p.z, p.y + 2).y : this.ctx.world.groundAt(p.x, p.z).y;
    return new THREE.Vector3(p.x, p.y !== undefined && Math.abs(y - p.y) > 2.5 ? p.y : y, p.z);
  }

  update(dt: number): void {
    const ctx = this.ctx;
    if (!ctx.session.active || ctx.session.kind !== 'campaign') return;
    this.timer -= dt;
    for (const lp of this.live.values()) {
      lp.group.rotation.y += dt * (lp.def.kind === 'pickup' ? 1.2 : 0);
      const spark = lp.group.userData.spark as THREE.Object3D | undefined;
      if (spark) spark.position.y = 1.5 + Math.sin(ctx.time.elapsed * 2.5) * 0.12;
    }
    if (this.timer > 0) return;
    this.timer = 0.6;
    const p = ctx.player;
    if (!p) return;
    for (const d of QUEST_PROPS) {
      const lp = this.live.get(d.id);
      // Rung bells / lit braziers stay in the world while their quest is running.
      const want = this.wanted(d) || ((d.kind === 'bell' || d.kind === 'brazier') && !!d.quest && ctx.quests.isActive(d.quest));
      if (!want) {
        if (lp) this.despawn(d.id);
        continue;
      }
      const pos = lp?.pos ?? resolveAt(d.at);
      if (!pos) continue;
      const dist = Math.hypot(pos.x - p.position.x, pos.z - p.position.z);
      if (!lp && dist < 160) this.spawn(d);
      else if (lp && dist > 220) this.despawn(d.id);
    }
  }

  onSessionEnd(): void {
    for (const id of [...this.live.keys()]) this.despawn(id);
  }

  private spawn(d: QuestPropDef): void {
    const ctx = this.ctx;
    const pos = this.propPos(d);
    if (!pos) return;
    const g = new THREE.Group();
    g.position.copy(pos);
    const mats: THREE.Material[] = [];
    const mat = (c: string, e?: string): THREE.MeshStandardMaterial => {
      const m = new THREE.MeshStandardMaterial({ color: c, roughness: 0.75, emissive: e ?? '#000000', emissiveIntensity: e ? 0.6 : 0 });
      mats.push(m);
      return m;
    };
    const add = (geo: THREE.BufferGeometry, m: THREE.Material, x: number, y: number, z: number, parent: THREE.Object3D = g) => {
      const mesh = new THREE.Mesh(geo, m);
      mesh.position.set(x, y, z);
      mesh.castShadow = true;
      parent.add(mesh);
      return mesh;
    };
    let entity: PropTarget | null = null;
    switch (d.kind) {
      case 'pickup': {
        const look = d.look ?? 'bundle';
        if (look === 'cabbage') add(new THREE.IcosahedronGeometry(0.28, 1), mat('#7fae4a'), 0, 0.3, 0);
        else if (look === 'fan') add(new THREE.CylinderGeometry(0.4, 0.4, 0.04, 16, 1, false, 0, Math.PI), mat('#d8b040', '#3a2a08'), 0, 0.5, 0).rotation.x = Math.PI / 2;
        else if (look === 'scroll' || look === 'page' || look === 'letter') add(new THREE.CylinderGeometry(0.08, 0.08, 0.5, 10), mat('#efe3c8'), 0, 0.35, 0).rotation.z = Math.PI / 2;
        else if (look === 'crystal') add(new THREE.OctahedronGeometry(0.3), mat('#bfe6ff', '#4fb8ff'), 0, 0.55, 0);
        else if (look === 'peach') add(new THREE.SphereGeometry(0.18, 12, 10), mat('#f0a080'), 0, 0.25, 0);
        else if (look === 'duck') {
          add(new THREE.SphereGeometry(0.22, 12, 10), mat('#8a9a3a'), 0, 0.22, 0);
          add(new THREE.SphereGeometry(0.12, 10, 8), mat('#d8c040'), 0, 0.42, 0.18);
        } else add(new THREE.BoxGeometry(0.4, 0.3, 0.3), mat('#a8804a'), 0, 0.2, 0);
        break;
      }
      case 'read': {
        if (d.look === 'poster') {
          add(new THREE.BoxGeometry(0.08, 1.9, 0.08), mat('#6a4a2a'), -0.6, 0.95, 0);
          add(new THREE.BoxGeometry(0.08, 1.9, 0.08), mat('#6a4a2a'), 0.6, 0.95, 0);
          add(new THREE.BoxGeometry(1.3, 0.9, 0.04), mat('#d8b070', '#3a2008'), 0, 1.45, 0);
        } else if (d.look === 'book') {
          add(new THREE.CylinderGeometry(0.25, 0.3, 0.9, 8), mat('#7a6a5a'), 0, 0.45, 0);
          add(new THREE.BoxGeometry(0.45, 0.08, 0.35), mat('#5a3a2a', '#201008'), 0, 0.95, 0);
        } else {
          add(new THREE.BoxGeometry(1.1, 1.6, 0.3), mat('#9a9488'), 0, 0.8, 0);
          add(new THREE.BoxGeometry(0.9, 1.1, 0.05), mat('#c8c0b0', '#2a3a4a'), 0, 0.9, 0.16);
        }
        g.rotation.y = d.yaw ?? 0;
        break;
      }
      case 'meditate': {
        const ring = new THREE.Mesh(new THREE.RingGeometry(0.9, 1.05, 40), new THREE.MeshBasicMaterial({ color: '#cfefff', transparent: true, opacity: 0.8, side: THREE.DoubleSide, depthWrite: false }));
        mats.push(ring.material as THREE.Material);
        ring.rotation.x = -Math.PI / 2;
        ring.position.y = 0.05;
        g.add(ring);
        break;
      }
      case 'bell': {
        add(new THREE.BoxGeometry(0.12, 2.4, 0.12), mat('#6a3a1a'), -0.7, 1.2, 0);
        add(new THREE.BoxGeometry(0.12, 2.4, 0.12), mat('#6a3a1a'), 0.7, 1.2, 0);
        add(new THREE.BoxGeometry(1.6, 0.14, 0.16), mat('#6a3a1a'), 0, 2.35, 0);
        add(new THREE.CylinderGeometry(0.22, 0.42, 0.7, 14, 1, true), mat('#b08a3a', '#2a1a04'), 0, 1.85, 0);
        entity = new PropTarget('air', () => this.complete(d));
        entity.done = this.done(d);
        break;
      }
      case 'brazier': {
        add(new THREE.CylinderGeometry(0.15, 0.25, 1.0, 8), mat('#4a3a2a'), 0, 0.5, 0);
        add(new THREE.CylinderGeometry(0.55, 0.35, 0.3, 12), mat('#6a5040'), 0, 1.1, 0);
        entity = new PropTarget('fire', () => this.complete(d));
        entity.done = this.done(d);
        if (entity.done) this.addFlame(g, mats);
        break;
      }
    }
    if (d.kind !== 'bell' && d.kind !== 'brazier') {
      const sm = new THREE.SpriteMaterial({ map: this.ctx.npcs.markerTexture('quest'), depthTest: false, transparent: true, color: '#ffe8a0' });
      mats.push(sm);
      const spark = new THREE.Sprite(sm);
      spark.scale.setScalar(0.4);
      spark.position.y = 1.5;
      spark.renderOrder = 30;
      g.add(spark);
      g.userData.spark = spark;
    }
    ctx.scene.add(g);
    let unregister: (() => void) | null = null;
    if (entity) {
      entity.position.copy(pos);
      ctx.entities.add(entity);
    } else {
      unregister = ctx.interactions.register({
        id: `prop:${d.id}`,
        position: pos,
        radius: 2.8,
        label: d.label,
        priority: 2,
        interact: () => this.use(d.id),
      });
    }
    this.live.set(d.id, { def: d, pos, group: g, entity, unregister, mats });
  }

  private despawn(id: string): void {
    const lp = this.live.get(id);
    if (!lp) return;
    this.live.delete(id);
    lp.unregister?.();
    if (lp.entity && !lp.entity.disposed) this.ctx.entities.remove(lp.entity);
    lp.group.removeFromParent();
    lp.group.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.isMesh) m.geometry.dispose();
    });
    for (const m of lp.mats) m.dispose();
  }

  /** Interact with a prop (pickup / read / meditate). */
  use(id: string): boolean {
    const d = QUEST_PROPS.find((p) => p.id === id);
    if (!d || !this.wanted(d)) return false;
    const ctx = this.ctx;
    if (d.kind === 'read') {
      ctx.ui.showDialogue({ speaker: d.label.replace(/^Read /, ''), text: d.text ?? '', choices: [{ text: 'Close', onSelect: () => ctx.ui.hideDialogue() }] });
      this.complete(d);
      return true;
    }
    if (d.kind === 'meditate') {
      const p = ctx.player;
      if (p) {
        p.humanoid?.animator.play('breath', { fadeIn: 0.2 });
        ctx.vfx.burst('spirit', p.aimPoint(new THREE.Vector3()), { count: 30 });
      }
      if (d.text) ctx.ui.showDialogue({ speaker: 'Meditation', text: d.text, choices: [{ text: 'Open your eyes', onSelect: () => ctx.ui.hideDialogue() }] });
      this.complete(d);
      return true;
    }
    if (d.kind === 'pickup') {
      ctx.player?.humanoid?.animator.play('interact', { fadeIn: 0.1 });
      this.complete(d);
      return true;
    }
    return false;
  }

  private addFlame(g: THREE.Group, mats: THREE.Material[]): void {
    const fm = new THREE.MeshBasicMaterial({ color: '#ff8a2a', transparent: true, opacity: 0.85, blending: THREE.AdditiveBlending, depthWrite: false });
    mats.push(fm);
    const flame = new THREE.Mesh(new THREE.ConeGeometry(0.4, 1.0, 10, 1, true), fm);
    flame.position.y = 1.75;
    g.add(flame);
  }

  private complete(d: QuestPropDef): void {
    const ctx = this.ctx;
    const q = ctx.quests;
    if (this.done(d)) return;
    const lp = this.live.get(d.id);
    const pos = lp?.pos ?? this.propPos(d) ?? new THREE.Vector3();
    if (d.item) ctx.inventory.add(d.item, d.count ?? 1);
    if (d.reveal) {
      ctx.world.discovered.add(d.reveal);
      const l = LANDMARKS.find((x) => x.id === d.reveal);
      if (l) ctx.events.emit('ui:notify', { text: `Marked on your map: ${l.name}`, kind: 'discovery', duration: 4 });
    }
    if (d.flag) q.setFlag(d.flag);
    if (d.startQuest && !q.isActive(d.startQuest) && !q.isComplete(d.startQuest)) q.start(d.startQuest);
    if (d.kind === 'bell' || d.kind === 'brazier') {
      const el: Element = d.kind === 'bell' ? 'air' : 'fire';
      ctx.vfx.burst(d.kind === 'bell' ? 'swirl' : 'fire', pos.clone().setY(pos.y + 1.8), { count: 24, color: ELEMENT_FX[el] });
      ctx.vfx.ring(pos.clone().setY(pos.y + 1.8), ELEMENT_FX[el], 3, 0.8, { vertical: true });
      ctx.audio.play(d.kind === 'bell' ? 'notify' : 'whoosh', { position: pos, volume: 0.8, pitch: d.kind === 'bell' ? 0.6 : 1 });
      if (d.kind === 'brazier' && lp) this.addFlame(lp.group, lp.mats);
    } else if (lp) {
      ctx.vfx.burst('spirit', pos.clone().setY(pos.y + 0.6), { count: 14 });
    }
    ctx.events.emit('world:interact', { kind: d.event ?? `quest_${d.kind}`, id: d.id, position: { x: pos.x, y: pos.y, z: pos.z } });
    q.setFlag(`prop_${d.id}`);
    // Bells / braziers stay visible (rung / lit) until the quest moves on; pickups vanish.
    if (d.kind === 'pickup') this.despawn(d.id);
    else if (lp?.unregister) {
      lp.unregister();
      lp.unregister = null;
    }
  }

  private markers(): QuestMarker[] {
    const ctx = this.ctx;
    if (!ctx.session.active || ctx.session.kind !== 'campaign') return [];
    const out: QuestMarker[] = [];
    const q = ctx.quests;
    for (const d of QUEST_PROPS) {
      if (!d.quest || !q.isActive(d.quest) || !this.wanted(d)) continue;
      const p = this.live.get(d.id)?.pos ?? (() => {
        const r = resolveAt(d.at);
        return r ? new THREE.Vector3(r.x, r.y ?? ctx.world.heightAt(r.x, r.z), r.z) : null;
      })();
      if (!p) continue;
      out.push({ questId: d.quest, title: q.get(d.quest)?.title ?? '', text: d.label, position: p, tracked: q.tracked === d.quest, compass: q.tracked === d.quest });
    }
    return out;
  }

  private installDebug(): void {
    const w = window as unknown as { __game?: { debug: Record<string, unknown> } };
    const install = () => {
      if (!w.__game) return false;
      w.__game.debug.quests = {
        sys: this,
        props: () => QUEST_PROPS.map((d) => ({ id: d.id, kind: d.kind, quest: d.quest ?? null, wanted: this.wanted(d), done: this.done(d), live: this.live.has(d.id), pos: (this.live.get(d.id)?.pos ?? null)?.toArray() ?? resolveAt(d.at) })),
        use: (id: string) => this.use(id),
        /** Entity id of a live bell/brazier (tests hit it with real casts). */
        propEntity: (id: string) => this.live.get(id)?.entity?.id ?? null,
        missingNPCs: () => [...this.missing],
        start: (id: string) => this.ctx.quests.start(id),
        progress: (id: string) => {
          const p = this.ctx.quests.active.get(id);
          const def = this.ctx.quests.get(id);
          return p && def ? { step: def.steps[p.step]?.id, done: p.done, counts: p.counts } : this.ctx.quests.isComplete(id) ? 'complete' : null;
        },
      };
      return true;
    };
    if (!install()) {
      const iv = setInterval(() => install() && clearInterval(iv), 200);
    }
  }
}

export function itemName(id: string): string {
  return itemById(id)?.name ?? id;
}
