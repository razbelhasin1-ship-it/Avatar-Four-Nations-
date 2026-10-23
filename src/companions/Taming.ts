import * as THREE from 'three';
import type { GameContext } from '../core/GameContext';
import type { GameEvents } from '../core/events';
import { foodValue, trustStage, type RescueKind } from '../data/creatures';
import { itemById } from '../data/items';
import type { Creature } from './Creature';
import type { CompanionSystem } from './CompanionSystem';

/**
 * Taming: per-individual trust with species-specific gains and losses.
 *
 *  - Calm presence (walking, out of combat, inside `calmRange`) builds trust
 *    up to `calmCap`; nervous animals back away from strangers closer than
 *    `comfort` until they trust you a little.
 *  - Food (E) from the inventory: preferred / liked values, a per-individual
 *    patience cooldown and a minimum trust before food is accepted at all.
 *  - Sprinting, bending and fighting nearby scare animals and cost trust.
 *  - Rescue variants: a bear-dog pup frozen in ice (bend fire / earth / water
 *    at the ice) and an injured sky bison (Healing Waters, or tend it with E).
 *  - Bond challenges: follow-the-leader flight (sky bison), a race (ostrich
 *    horse); the dragon's test lives in DragonTrial. Others bond at 100 trust.
 *
 * Wild trust persists in the save (so patience is never wasted); challenge
 * progress resets if you leave or fail.
 */

type CastEvent = GameEvents['technique:cast'];

interface Challenge {
  kind: 'follow_flight' | 'race';
  creature: Creature;
  t: number;
  stage: number;
  update(dt: number): 'running' | 'won' | 'lost';
  status(): string;
  dispose(): void;
}

const CALM_SPEED = 4.6;

export class TamingManager {
  get trust(): Map<string, number> {
    return this.sys.wildTrust;
  }
  private readonly feedReady = new Map<string, number>();
  private readonly tends = new Map<string, number>();
  private readonly iceHp = new Map<string, number>();
  private readonly unreg = new Map<string, () => void>();
  private readonly rescueFx = new Map<string, THREE.Object3D>();
  private readonly emitted = new Map<string, number>();
  private readonly retryAt = new Map<string, number>();
  challenge: Challenge | null = null;
  /** Tests: fly the follow-the-leader course automatically (through the real flight code). */
  autopilot = false;
  private msgT = 0;

  constructor(private readonly sys: CompanionSystem, private readonly ctx: GameContext) {
    ctx.events.on('technique:cast', (e) => this.onCast(e));
    ctx.events.on('bending:heat', (e) => {
      for (const c of this.sys.wildCreatures()) {
        if (c.state !== 'trapped') continue;
        const d = Math.hypot(c.position.x - e.position.x, c.position.z - e.position.z);
        if (d < e.radius + 2) this.damageIce(c, Math.max(1, Math.round(e.intensity)));
      }
    });
  }

  getTrust(uid: string): number {
    return this.trust.get(uid) ?? 0;
  }

  setTrust(c: Creature, v: number, announce = false): void {
    const prev = this.getTrust(c.uid);
    const next = Math.max(0, Math.min(100, v));
    this.trust.set(c.uid, next);
    const last = this.emitted.get(c.uid) ?? -100;
    if (announce || Math.abs(next - last) >= 5 || (next >= 100 && last < 100)) {
      this.emitted.set(c.uid, next);
      this.ctx.events.emit('creature:trust', { creatureId: c.uid, speciesId: c.def.id, trust: Math.round(next) });
    }
    if (prev < 100 && next >= 100 && c.def.taming?.challenge === 'none' && c.mode !== 'companion') this.sys.bondCreature(c);
  }

  // ---------------------------------------------------------------- interactables

  attach(c: Creature): void {
    if (!c.def.tameable || !c.def.taming || c.def.id === 'dragon') return;
    const self = this;
    const reach = c.def.taming.reach;
    const off = this.ctx.interactions.register({
      id: `tame:${c.uid}`,
      position: c.root.position,
      radius: c.radius + reach + 0.6,
      get label() {
        return self.label(c);
      },
      priority: 3,
      enabled: () => c.mode !== 'companion' && c.state !== 'burrowed' && c.state !== 'flee' && !this.challenge && !c.disposed,
      interact: () => this.interact(c),
    });
    this.unreg.set(c.uid, off);
  }

  detach(c: Creature): void {
    this.unreg.get(c.uid)?.();
    this.unreg.delete(c.uid);
    const fx = this.rescueFx.get(c.uid);
    if (fx) {
      c.model.removeExtra(fx);
      this.rescueFx.delete(c.uid);
    }
  }

  /** Visual dressing for rescue variants (ice block, wound). */
  decorateRescue(c: Creature, kind: RescueKind): void {
    if (kind === 'ice_trap') {
      const g = new THREE.IcosahedronGeometry(1, 1);
      const m = new THREE.MeshStandardMaterial({ color: '#bfe6f7', roughness: 0.15, metalness: 0.05, transparent: true, opacity: 0.62, emissive: '#2a5a70', emissiveIntensity: 0.25 });
      const ice = new THREE.Mesh(g, m);
      const s = c.def.size;
      ice.scale.set(s.width * 0.75, s.height * 0.55, s.length * 0.55);
      ice.position.set(0, s.height * 0.3, 0);
      c.model.attachExtra(ice);
      this.rescueFx.set(c.uid, ice);
      this.iceHp.set(c.uid, 3);
    } else {
      const g = new THREE.SphereGeometry(0.5, 8, 6);
      const m = new THREE.MeshStandardMaterial({ color: '#7a1c18', roughness: 0.6, emissive: '#2a0505' });
      const wound = new THREE.Mesh(g, m);
      wound.scale.set(1.3, 0.35, 0.9);
      wound.position.set(c.def.size.width * 0.42, c.def.size.height * 0.45, -0.4);
      c.model.attachExtra(wound);
      this.rescueFx.set(c.uid, wound);
      this.tends.set(c.uid, 0);
    }
  }

  private familyTrapped(c: Creature): Creature | null {
    const g = c.group;
    const members = g ? g.members : this.sys.wildCreatures().filter((o) => o.def.id === c.def.id && o.uid.split('#')[0] === c.uid.split('#')[0]);
    return members.find((o) => o !== c && o.state === 'trapped') ?? null;
  }

  label(c: Creature): string {
    const t = c.def.taming!;
    const tr = Math.round(this.getTrust(c.uid));
    const name = c.def.name;
    if (c.state === 'trapped') return `Free the ${name} pup — bend fire, earth or water at the ice`;
    if (c.state === 'injured') return `Tend the injured ${name} (${this.tends.get(c.uid) ?? 0}/3) · Trust ${tr}%`;
    if (t.challenge !== 'none' && tr >= t.challengeAt) return t.challenge === 'follow_flight' ? `Climb onto the ${name} — follow the herd leader` : `Challenge the ${name} to a race`;
    const food = this.bestFood(c);
    if (c.scale < 0.8) return `${name} pup · too young to tame`;
    if (!food) return `${name} · Trust ${tr}% (${trustStage(tr)}) — it wants ${this.wantText(c)}`;
    return `Offer ${itemById(food)?.name ?? food} · Trust ${tr}%`;
  }

  private wantText(c: Creature): string {
    const ids = c.def.diet.preferred.length ? c.def.diet.preferred : c.def.diet.liked;
    return ids.map((i) => itemById(i)?.name ?? i).join(' or ') || 'nothing you have';
  }

  private bestFood(c: Creature): string | null {
    for (const id of c.def.diet.preferred) if (this.ctx.inventory.has(id)) return id;
    for (const id of c.def.diet.liked) if (this.ctx.inventory.has(id)) return id;
    return null;
  }

  private say(text: string, kind: 'info' | 'success' | 'warning' | 'discovery' = 'info', duration = 3): void {
    this.ctx.events.emit('ui:notify', { text, kind, duration, icon: '🐾' });
  }

  /** E on a wild creature: tend / feed / start the bond challenge. */
  interact(c: Creature): boolean {
    const ctx = this.ctx;
    const t = c.def.taming;
    if (!t || c.mode === 'companion') return false;
    const now = ctx.time.elapsed;
    if (c.state === 'trapped') {
      this.say(`The pup is frozen fast in the ice. Bend fire, earth or water at it to break it free.`, 'info', 4);
      return false;
    }
    if (c.state === 'injured') return this.tend(c);
    if (c.scale < 0.8) {
      this.say(`The pup tumbles around your feet — it's too young to leave its family.`);
      return false;
    }
    const tr = this.getTrust(c.uid);
    if (t.challenge !== 'none' && tr >= t.challengeAt) {
      const retry = this.retryAt.get(c.uid) ?? 0;
      if (now < retry) {
        this.say(`It needs a moment before trying again (${Math.ceil(retry - now)}s).`);
        return false;
      }
      return this.startChallenge(c);
    }
    if (this.familyTrapped(c)) {
      c.setState('defend', 4);
      this.say(`She won't eat while her pup is trapped in the ice. Help the pup first.`, 'warning', 4);
      return false;
    }
    if (tr < t.feedMinTrust) {
      this.say(`The ${c.def.name} is too wary to take food from you yet. Stay calm nearby — walk, don't run.`, 'info', 4);
      return false;
    }
    const food = this.bestFood(c);
    if (!food) {
      this.say(`You have nothing a ${c.def.name.toLowerCase()} wants. It likes ${this.wantText(c)}.`, 'info', 4);
      return false;
    }
    const ready = this.feedReady.get(c.uid) ?? 0;
    if (now < ready) {
      this.say(`It sniffs the ${itemById(food)?.name ?? food} but isn't hungry yet. Be patient (${Math.ceil(ready - now)}s).`);
      return false;
    }
    const value = foodValue(c.def.id, food) === 'preferred' ? t.feedPreferred : t.feedLiked;
    ctx.inventory.remove(food, 1);
    ctx.events.emit('item:used', { itemId: food });
    this.feedReady.set(c.uid, now + t.feedCooldown);
    c.forcedAction = 'eat';
    c.happyT = 3;
    c.fear = 0;
    c.setState('idle', 4);
    c.stopMoving();
    setTimeout(() => {
      if (c.forcedAction === 'eat') c.forcedAction = null;
    }, 2200);
    ctx.audio.play(c.def.sounds.content ?? c.def.sounds.call, { position: c.aimPoint(), volume: 0.8 });
    ctx.vfx.burst('glow', c.aimPoint(), { count: 6, color: '#ffe6a0', size: 0.4 });
    const next = tr + value;
    this.setTrust(c, next, true);
    {
      const stage = trustStage(next);
      const extra = t.challenge !== 'none' && next >= t.challengeAt ? ' It seems ready to test you — interact again.' : '';
      this.say(`The ${c.def.name} eats from your hand. Trust ${Math.round(Math.min(100, next))}% (${stage}).${extra}`, 'success', 3.5);
    }
    return true;
  }

  private tend(c: Creature): boolean {
    const n = (this.tends.get(c.uid) ?? 0) + 1;
    this.tends.set(c.uid, n);
    this.ctx.vfx.burst('heal', c.aimPoint(), { count: 10, radius: 1.2 });
    this.setTrust(c, this.getTrust(c.uid) + 8, true);
    if (n >= 3) this.healInjured(c, 'tended');
    else this.say(`You clean and bind the wound. The great beast rumbles softly. (${n}/3)`, 'info', 3);
    return true;
  }

  private healInjured(c: Creature, how: 'tended' | 'water'): void {
    this.sys.flags.add(`rescued:${c.uid}`);
    const fx = this.rescueFx.get(c.uid);
    if (fx) {
      c.model.removeExtra(fx);
      this.rescueFx.delete(c.uid);
    }
    c.setState('idle', 3);
    c.happyT = 4;
    this.setTrust(c, this.getTrust(c.uid) + (how === 'water' ? 40 : 25), true);
    this.ctx.vfx.burst('heal', c.aimPoint(), { count: 30, radius: 2.5 });
    this.ctx.audio.play(c.def.sounds.content ?? c.def.sounds.call, { position: c.aimPoint() });
    this.say(how === 'water' ? `Healing water knits the wound closed. The ${c.def.name} nuzzles you gratefully.` : `The wound is clean and bound. The ${c.def.name} gets back to its feet and nuzzles you.`, 'success', 5);
  }

  private damageIce(c: Creature, n: number): void {
    const hp = (this.iceHp.get(c.uid) ?? 3) - n;
    this.iceHp.set(c.uid, hp);
    const p = c.aimPoint();
    this.ctx.vfx.burst('ice', p, { count: 18, speed: 4, radius: 0.8 });
    this.ctx.vfx.burst('steam', p, { count: 6 });
    this.ctx.audio.play('ice.crack', { position: p, volume: 0.9 });
    if (hp > 0) {
      this.say(`The ice cracks! (${3 - Math.max(0, hp)}/3)`, 'info', 2);
      return;
    }
    // Freed!
    this.sys.flags.add(`rescued:${c.uid}`);
    const fx = this.rescueFx.get(c.uid);
    if (fx) {
      c.model.removeExtra(fx);
      this.rescueFx.delete(c.uid);
    }
    c.setState('idle', 2);
    c.happyT = 5;
    this.ctx.audio.play(c.def.sounds.call, { position: p });
    // The family is grateful: every adult in the family trusts you much more.
    for (const o of this.sys.wildCreatures()) {
      if (o === c || o.def.id !== c.def.id || o.uid.split('#')[0] !== c.uid.split('#')[0]) continue;
      o.fear = 0;
      o.setState('idle', 3);
      this.setTrust(o, this.getTrust(o.uid) + 40, true);
    }
    this.say(`The ice shatters and the pup tumbles free, yipping, into its mother's paws. The family watches you with new eyes.`, 'success', 6);
  }

  // ---------------------------------------------------------------- per-frame trust

  update(dt: number): void {
    const ctx = this.ctx;
    const p = ctx.player;
    if (!p) return;
    this.msgT = Math.max(0, this.msgT - dt);
    if (this.challenge) {
      const r = this.challenge.update(dt);
      if (r !== 'running') this.endChallenge(r === 'won');
    }
    const speed = p.body?.horizontalSpeed ?? 0;
    const sprinting = speed > 7.8 || (ctx.input.isDown('sprint') && speed > CALM_SPEED);
    const calm = speed < CALM_SPEED && p.sinceCombat > 6 && !p.defeated && !this.sys.mounted;
    const earth = p.element === 'earth';
    const pp = p.position;
    for (const c of this.sys.wildCreatures()) {
      const t = c.def.taming;
      if (!t || !c.def.tameable || c.mode === 'companion' || c.state === 'scripted') continue;
      const d = Math.hypot(c.position.x - pp.x, c.position.z - pp.z);
      if (d > Math.max(t.hearing, t.calmRange) + 5) continue;
      const tr = this.getTrust(c.uid);
      if (sprinting && d < t.hearing && c.state !== 'trapped' && c.state !== 'injured') {
        this.setTrust(c, tr - t.scareSprint * dt);
        if (!this.familyTrapped(c) || d < t.comfort) c.scare(dt * 0.9 * (1 - d / t.hearing), pp);
        if (this.msgT <= 0 && d < t.calmRange && t.scareSprint > 0) {
          this.msgT = 8;
          this.say(`Running startles the ${c.def.plural.toLowerCase()} — walk to approach calmly.`, 'warning', 3);
        }
        continue;
      }
      if (calm && d < t.calmRange && c.state !== 'flee' && c.state !== 'burrowed' && tr < t.calmCap) {
        let gain = t.calmGain * dt;
        if (c.def.temperament === 'blind') gain *= earth ? 1.8 : speed < 2.6 ? 1 : 0.3; // senses footsteps: walk softly
        if (c.def.temperament === 'playful') gain *= speed < 0.4 ? 1.6 : 0.25; // stand still and let it come
        this.setTrust(c, Math.min(t.calmCap, tr + gain));
      }
      // Nervous animals back away from a stranger who comes too close.
      if (d < t.comfort && tr < 25 && (c.state === 'idle' || c.state === 'graze' || c.state === 'wander' || c.state === 'rest')) {
        if (c.def.temperament === 'wary' && this.familyTrapped(c) && d < t.comfort * 0.7) c.setState('defend', 4);
        else c.setState('wary', 3);
      }
      // Curious / friendly animals come to sniff when you carry their favourite food.
      if (calm && tr >= 25 && d < 16 && d > 4 && c.state === 'idle' && this.bestFood(c) && c.rand() < dt * 0.15) c.setState('investigate', 8);
    }
  }

  private onCast(e: CastEvent): void {
    if (!e.isPlayer) return;
    const p = this.ctx.player;
    if (!p) return;
    const pos = e.position;
    // Families watching you free one of their own are not frightened by it.
    const helping = new Set<string>();
    for (const c of this.sys.wildCreatures()) if (c.state === 'trapped' && Math.hypot(c.position.x - pos.x, c.position.z - pos.z) < 12) helping.add(`${c.def.id}:${c.uid.split('#')[0]}`);
    for (const c of this.sys.wildCreatures()) {
      const d = Math.hypot(c.position.x - pos.x, c.position.z - pos.z);
      if (c.state !== 'trapped' && helping.has(`${c.def.id}:${c.uid.split('#')[0]}`)) continue;
      // Rescues first.
      if (c.state === 'trapped' && d < 12) {
        const toward = new THREE.Vector3(c.position.x - p.position.x, 0, c.position.z - p.position.z).normalize();
        const facing = p.aimDir.x * toward.x + p.aimDir.z * toward.z;
        if (facing > 0.5 || d < 3) {
          if (e.element === 'air') this.say(`The gust whistles over the ice — it won't crack. Try fire, earth or water.`, 'info', 3);
          else this.damageIce(c, 1);
        }
        continue;
      }
      if (c.state === 'injured' && d < 9 && e.id === 'water_heal') {
        this.healInjured(c, 'water');
        continue;
      }
      const t = c.def.taming;
      if (!t || c.mode === 'companion' || c.state === 'injured' || c.state === 'scripted') continue;
      if (d < t.hearing) {
        const k = 1 - d / t.hearing;
        if (this.familyTrapped(c) && d > t.comfort) continue; // the family is focused on the rescue
        this.setTrust(c, this.getTrust(c.uid) - t.scareCombat * k);
        c.scare(0.7 * k + 0.1, p.position);
      }
    }
    // Ambient wildlife scatters too.
    for (const c of this.sys.ambientCreatures()) {
      const d = Math.hypot(c.position.x - pos.x, c.position.z - pos.z);
      if (d < 25) c.scare(0.8 * (1 - d / 25) + 0.2, p.position);
    }
  }

  // ---------------------------------------------------------------- challenges

  startChallenge(c: Creature): boolean {
    if (this.challenge) return false;
    const kind = c.def.taming?.challenge;
    if (kind === 'follow_flight') this.challenge = new FollowFlight(this.sys, this.ctx, c, this);
    else if (kind === 'race') this.challenge = new Race(this.sys, this.ctx, c);
    else return false;
    this.say(this.challenge.status(), 'discovery', 6);
    return true;
  }

  private endChallenge(won: boolean): void {
    const ch = this.challenge!;
    this.challenge = null;
    const c = ch.creature;
    if (won) {
      this.say(ch.kind === 'race' ? `You win the race! The ostrich horse trots back to you, head bowed.` : `You stayed with the herd leader through every ring. The sky bison rumbles happily — it has chosen you.`, 'success', 6);
      this.trust.set(c.uid, 100);
      // Bond first so the challenge cleanup keeps you in the saddle.
      this.sys.bondCreature(c);
      ch.dispose();
    } else {
      ch.dispose();
      this.retryAt.set(c.uid, this.ctx.time.elapsed + 20);
      this.setTrust(c, this.getTrust(c.uid) - 8, true);
      this.say(ch.kind === 'race' ? `The ostrich horse beats you to the flag and struts off. Try again soon.` : `You lost the herd leader. Your bison glides down to land — try again when it's rested.`, 'warning', 5);
    }
  }

  /** Abort (session end, travel). */
  cancel(): void {
    if (!this.challenge) return;
    const ch = this.challenge;
    this.challenge = null;
    ch.dispose();
  }

  clear(): void {
    this.cancel();
    for (const off of this.unreg.values()) off();
    this.unreg.clear();
    this.rescueFx.clear();
    this.feedReady.clear();
    this.tends.clear();
    this.iceHp.clear();
  }
}

// ------------------------------------------------------------------ follow-the-leader flight

class FollowFlight implements Challenge {
  readonly kind = 'follow_flight' as const;
  t = 0;
  stage = 0;
  private ringT = 0;
  private readonly rings: THREE.Vector3[] = [];
  private readonly meshes: THREE.Mesh[] = [];
  private readonly geo = new THREE.TorusGeometry(8, 0.45, 8, 32);
  private readonly mat = new THREE.MeshBasicMaterial({ color: '#fff3c8', transparent: true, opacity: 0.85, depthWrite: false });
  private readonly matDim = new THREE.MeshBasicMaterial({ color: '#ffffff', transparent: true, opacity: 0.25, depthWrite: false });
  private leader: Creature | null = null;
  private leaderStage = 0;
  private phase: 'boarding' | 'flying' | 'landing' = 'boarding';
  private result: 'won' | 'lost' | null = null;
  static readonly RING_TIME = 45;

  constructor(private readonly sys: CompanionSystem, private readonly ctx: GameContext, readonly creature: Creature, private readonly taming: TamingManager) {
    const c = creature;
    const home = c.group?.center ?? c.home;
    const w = ctx.world;
    const a0 = Math.atan2(c.position.x - home.x, c.position.z - home.z);
    // A loop around the meadow at a steady altitude above the highest ground on the course.
    const pts: Array<[number, number]> = [];
    let top = -1e9;
    for (let k = 0; k < 5; k++) {
      const a = a0 + 0.6 + k * ((Math.PI * 2) / 5);
      const r = 60 + (k % 2) * 12;
      const x = home.x + Math.sin(a) * r, z = home.z + Math.cos(a) * r;
      pts.push([x, z]);
      for (let f = 0; f <= 1; f += 0.25) {
        const px = THREE.MathUtils.lerp(home.x, x, f), pz = THREE.MathUtils.lerp(home.z, z, f);
        top = Math.max(top, w.heightAt(px, pz), w.liquidAt(px, pz)?.level ?? -1e9);
      }
    }
    pts.forEach(([x, z], k) => this.rings.push(new THREE.Vector3(x, top + 22 + (k % 2) * 6, z)));
    for (let k = 0; k < this.rings.length; k++) {
      const m = new THREE.Mesh(this.geo, k === 0 ? this.mat : this.matDim);
      m.position.copy(this.rings[k]);
      const next = this.rings[(k + 1) % this.rings.length];
      const prev = k === 0 ? c.position : this.rings[k - 1];
      m.lookAt(m.position.clone().add(next.clone().sub(prev)));
      ctx.scene.add(m);
      this.meshes.push(m);
    }
    // The herd leader shows the way.
    this.leader = (c.group?.members ?? []).find((o) => o !== c && o.state !== 'injured' && o.mode !== 'companion') ?? null;
    if (this.leader) {
      this.leader.setState('scripted');
      this.leader.takeOff(this.rings[0].y);
    }
    // Climb onto the bison.
    sys.riding.mountUp(c, { challenge: true });
    this.phase = 'boarding';
  }

  status(): string {
    if (this.phase === 'boarding') return `The sky bison lets you climb onto its back! Follow the herd leader through the 5 cloud rings. (Space climb · Q descend · steer with the camera)`;
    return `Cloud rings: ${this.stage}/${this.rings.length} · ${Math.max(0, Math.ceil(FollowFlight.RING_TIME - this.ringT))}s`;
  }

  get target(): THREE.Vector3 | null {
    return this.stage < this.rings.length ? this.rings[this.stage] : null;
  }

  update(dt: number): 'running' | 'won' | 'lost' {
    this.t += dt;
    const c = this.creature;
    const r = this.sys.riding;
    if (this.result) {
      // Landing after a failure.
      if (!c.flying || this.t > 60) {
        if (r.mount === c) r.dismount(true);
        return this.result;
      }
      c.land();
      return 'running';
    }
    if (this.phase === 'boarding') {
      if (r.mount === c && !r.transitioning) {
        this.phase = 'flying';
        if (!c.flying) c.takeOff(this.rings[0].y - 6);
      } else if (this.t > 5) return 'lost';
      return 'running';
    }
    if (r.mount !== c) return 'lost'; // jumped off
    this.ringT += dt;
    // Leader flies ahead through the rings.
    const L = this.leader;
    if (L && !L.disposed) {
      const lt = this.rings[Math.min(this.leaderStage, this.rings.length - 1)];
      L.wantAlt = lt.y;
      L.moveTo(lt.x, lt.z, (L.def.fly?.cruise ?? 14) * 0.75);
      if (Math.hypot(L.position.x - lt.x, L.position.z - lt.z) < 12 && this.leaderStage < this.rings.length - 1 && this.leaderStage <= this.stage + 1) this.leaderStage++;
    }
    // Autopilot (tests): steer the mount with the real flight model.
    const tgt = this.target;
    r.autopilot = this.taming.autopilot && tgt ? tgt : null;
    if (tgt && c.position.distanceTo(tgt) < 9) {
      this.meshes[this.stage].material = this.matDim;
      (this.meshes[this.stage].material as THREE.MeshBasicMaterial).opacity = 0.12;
      this.stage++;
      this.ringT = 0;
      this.ctx.vfx.ring(tgt, '#fff6d8', 9, 0.8, { vertical: true });
      this.ctx.audio.play('ui.confirm', { volume: 0.7 });
      if (this.stage >= this.rings.length) {
        r.autopilot = null;
        if (L) L.setState('home', 40);
        return 'won';
      }
      this.meshes[this.stage].material = this.mat;
      this.ctx.events.emit('ui:notify', { text: `Ring ${this.stage}/${this.rings.length}!`, kind: 'info', duration: 1.5 });
    }
    if (this.ringT > FollowFlight.RING_TIME) {
      this.result = 'lost';
      r.autopilot = null;
      if (L) L.setState('home', 40);
      c.land();
    }
    return 'running';
  }

  dispose(): void {
    this.sys.riding.autopilot = null;
    for (const m of this.meshes) m.removeFromParent();
    this.geo.dispose();
    this.mat.dispose();
    this.matDim.dispose();
    if (this.leader && this.leader.state === 'scripted') this.leader.setState('home', 40);
    if (this.creature.mode !== 'companion' && this.sys.riding.mount === this.creature) this.sys.riding.dismount(true);
    if (this.creature.mode !== 'companion' && this.creature.state === 'scripted') this.creature.setState('idle', 3);
  }
}

// ------------------------------------------------------------------ ostrich horse race

class Race implements Challenge {
  readonly kind = 'race' as const;
  t = 0;
  stage = 0;
  readonly finish = new THREE.Vector3();
  private readonly flag = new THREE.Group();
  private readonly geos: THREE.BufferGeometry[] = [];
  private readonly mats: THREE.Material[] = [];
  static readonly PACE = 8.2;

  constructor(private readonly sys: CompanionSystem, private readonly ctx: GameContext, readonly creature: Creature) {
    const c = creature;
    const w = ctx.world;
    const p = ctx.player!;
    // Finish line ~110 m away across open ground.
    let best = 0;
    for (let k = 0; k < 12; k++) {
      const a = p.yaw + (k % 2 ? 1 : -1) * Math.floor((k + 1) / 2) * 0.5;
      let ok = 0;
      for (let s = 10; s <= 110; s += 10) {
        const x = c.position.x + Math.sin(a) * s, z = c.position.z + Math.cos(a) * s;
        const g = w.groundAt(x, z);
        const wl = w.liquidAt(x, z);
        if ((wl && wl.level - g.y > 0.5) || (g.colliderId === 0 && g.ny < 0.8)) break;
        ok = s;
      }
      if (ok > best) {
        best = ok;
        this.finish.set(c.position.x + Math.sin(a) * ok, 0, c.position.z + Math.cos(a) * ok);
      }
      if (ok >= 110) break;
    }
    if (best < 40) this.finish.set(c.position.x + Math.sin(p.yaw) * 60, 0, c.position.z + Math.cos(p.yaw) * 60);
    this.finish.y = w.groundAt(this.finish.x, this.finish.z).y;
    const pole = new THREE.CylinderGeometry(0.06, 0.06, 4, 6);
    const cloth = new THREE.PlaneGeometry(1.4, 0.9);
    const m1 = new THREE.MeshStandardMaterial({ color: '#6b4a2a' });
    const m2 = new THREE.MeshStandardMaterial({ color: '#e0b030', side: THREE.DoubleSide, emissive: '#5a3a00' });
    this.geos.push(pole, cloth);
    this.mats.push(m1, m2);
    const pm = new THREE.Mesh(pole, m1);
    pm.position.y = 2;
    const cm = new THREE.Mesh(cloth, m2);
    cm.position.set(0.7, 3.4, 0);
    this.flag.add(pm, cm);
    this.flag.position.copy(this.finish);
    ctx.scene.add(this.flag);
    c.setState('scripted');
    c.stopMoving();
    c.wantYaw = Math.atan2(this.finish.x - c.position.x, this.finish.z - c.position.z);
  }

  status(): string {
    const d = Math.round(this.creature.position.distanceTo(this.finish));
    if (this.t < 3) return `Race to the golden flag (${d} m)! Ready… (sprint with Shift)`;
    return `Race to the golden flag!`;
  }

  update(dt: number): 'running' | 'won' | 'lost' {
    const prevT = this.t;
    this.t += dt;
    const c = this.creature;
    const p = this.ctx.player;
    if (!p) return 'lost';
    if (this.t < 3) {
      const n = 3 - Math.floor(this.t);
      if (Math.floor(prevT) !== Math.floor(this.t) || prevT === 0) this.ctx.events.emit('ui:notify', { text: `${n}…`, kind: 'info', duration: 0.9 });
      c.stopMoving();
      c.forcedAction = 'kick';
      return 'running';
    }
    if (prevT < 3) {
      this.ctx.events.emit('ui:notify', { text: 'GO!', kind: 'success', duration: 1.2 });
      c.forcedAction = null;
    }
    c.moveTo(this.finish.x, this.finish.z, Race.PACE);
    this.stage = 1;
    const pd = Math.hypot(p.position.x - this.finish.x, p.position.z - this.finish.z);
    const cd = Math.hypot(c.position.x - this.finish.x, c.position.z - this.finish.z);
    if (pd < 6) return 'won';
    if (cd < 3 || this.t > 45) return 'lost';
    return 'running';
  }

  dispose(): void {
    this.flag.removeFromParent();
    for (const g of this.geos) g.dispose();
    for (const m of this.mats) m.dispose();
    const c = this.creature;
    c.forcedAction = null;
    if (c.mode !== 'companion') c.setState('home', 30);
  }
}
