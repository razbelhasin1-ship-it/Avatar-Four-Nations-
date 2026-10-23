import * as THREE from 'three';
import type { GameContext } from '../core/GameContext';
import { habitatById, SUN_STONE_SHARDS, SUN_STONES_NEEDED } from '../data/creatures';
import { getSpot } from '../world/Spots';
import type { Creature } from './Creature';
import type { CompanionSystem } from './CompanionSystem';

/**
 * The dragon of the Sun Warrior ruins — a gated, multi-step experience:
 *
 *  1. Find the three Sun Stone fragments scattered around the ruins.
 *  2. Set them in the Altar of the Eternal Flame — only a firebender can then
 *     rekindle the stone (cast fire at the altar within 30 s).
 *  3. The last dragon answers: it circles in from the caldera and settles on
 *     its perch above the ruins (flag `dragon_called`; at most one dragon).
 *  4. Approach: it descends to the plaza and waits. Stand before it (E).
 *  5. The test of fearlessness: it circles you breathing fire *around* you.
 *     Hold your ground (stay within 4.5 m, no dodging, no sprinting, no other
 *     bending) and bend fire with it at least twice. Pass → it bows → bond.
 *     Fail → it returns to its perch; you may try again after a while.
 */

const TEST_TIME = 18;
const HOLD_RADIUS = 4.5;

export class DragonTrial {
  private props: THREE.Object3D[] = [];
  private unreg: Array<() => void> = [];
  private built = false;
  private kindleUntil = 0;
  private geo: THREE.BufferGeometry | null = null;
  private mat: THREE.Material | null = null;
  private altarGlow: THREE.Mesh | null = null;
  private dragonUnreg: (() => void) | null = null;
  phase: 'dormant' | 'arriving' | 'perched' | 'descending' | 'waiting' | 'test' | 'returning' | 'done' = 'dormant';
  private test: { t: number; start: THREE.Vector3; fire: number; angle: number; failed: string | null; breathT: number } | null = null;
  private retryAt = 0;
  private phaseT = 0;

  constructor(private readonly sys: CompanionSystem, private readonly ctx: GameContext) {
    ctx.events.on('technique:cast', (e) => {
      if (!e.isPlayer) return;
      if (e.element === 'fire' && this.sys.flags.has('sun_stone_set') && !this.sys.flags.has('dragon_called') && ctx.time.elapsed < this.kindleUntil) {
        const a = this.altar();
        if (Math.hypot(e.position.x - a.x, e.position.z - a.z) < 14) this.callDragon();
      }
      if (this.test && !this.test.failed) {
        if (e.element === 'fire') this.test.fire++;
        else this.test.failed = 'You bent against the dragon\'s fire — it does not trust a fighter.';
      }
    });
    ctx.events.on('player:dodged', () => {
      if (this.test && !this.test.failed) this.test.failed = 'You flinched and dodged. The dragon sees fear.';
    });
  }

  /** Ruins centre (landmark), altar and perch positions. */
  ruins(): THREE.Vector3 {
    const lm = this.ctx.world.landmark('dragon_bone_caldera');
    const x = lm?.x ?? -1560, z = lm?.z ?? 940;
    return new THREE.Vector3(x, this.ctx.world.groundAt(x, z).y, z);
  }

  altar(): THREE.Vector3 {
    const s = getSpot('shrine_eternal_flame');
    if (s) return new THREE.Vector3(s.x, s.y ?? this.ctx.world.groundAt(s.x, s.z).y, s.z);
    return this.ruins();
  }

  plaza(): THREE.Vector3 {
    const s = getSpot('training_ahkon');
    if (s) return new THREE.Vector3(s.x, s.y ?? this.ctx.world.groundAt(s.x, s.z).y, s.z);
    const r = this.ruins();
    return r.add(new THREE.Vector3(10, 0, 10));
  }

  perch(): THREE.Vector3 {
    const s = getSpot('habitat_dragon_1');
    if (s) return new THREE.Vector3(s.x, s.y ?? this.ctx.world.groundAt(s.x, s.z).y, s.z);
    const h = habitatById('sun_warrior_ruins')!;
    return new THREE.Vector3(h.x, this.ctx.world.groundAt(h.x, h.z).y, h.z);
  }

  shardPos(i: number): THREE.Vector3 {
    const r = this.ruins();
    const s = SUN_STONE_SHARDS[i];
    const x = r.x + s.dx, z = r.z + s.dz;
    return new THREE.Vector3(x, this.ctx.world.groundAt(x, z, r.y + 60).y, z);
  }

  requirements(): { firebender: boolean; shards: number; shardsInBag: number; stoneSet: boolean; called: boolean; bonded: boolean; phase: string } {
    const ctx = this.ctx;
    return {
      firebender: ctx.progression.canBend('fire'),
      shards: SUN_STONE_SHARDS.filter((s) => this.sys.flags.has(`shard:${s.id}`)).length,
      shardsInBag: ctx.inventory.count('sun_stone'),
      stoneSet: this.sys.flags.has('sun_stone_set'),
      called: this.sys.flags.has('dragon_called'),
      bonded: this.sys.bondedCount('dragon') > 0,
      phase: this.phase,
    };
  }

  update(dt: number): void {
    const p = this.ctx.player;
    if (!p) return;
    const r = this.ruins();
    const d = Math.hypot(p.position.x - r.x, p.position.z - r.z);
    if (d < 260 && !this.built) this.build();
    else if (d > 320 && this.built) this.teardown();
    if (this.altarGlow) {
      const lit = this.sys.flags.has('dragon_called');
      const set = this.sys.flags.has('sun_stone_set');
      this.altarGlow.visible = set || lit;
      (this.altarGlow.material as THREE.MeshStandardMaterial).emissiveIntensity = lit ? 2.5 + Math.sin(this.ctx.time.elapsed * 3) * 0.5 : 0.6;
    }
    this.updateDragon(dt);
  }

  private dragon(): Creature | null {
    const c = this.sys.creatureByUid('sun_warrior_ruins#0');
    return c && c.mode !== 'companion' ? c : null;
  }

  // ---------------------------------------------------------------- props

  private build(): void {
    this.built = true;
    const ctx = this.ctx;
    this.geo = new THREE.OctahedronGeometry(0.35, 0);
    this.mat = new THREE.MeshStandardMaterial({ color: '#ff9a30', emissive: '#ff6a00', emissiveIntensity: 1.6, roughness: 0.3 });
    SUN_STONE_SHARDS.forEach((s, i) => {
      if (this.sys.flags.has(`shard:${s.id}`)) return;
      const pos = this.shardPos(i);
      const m = new THREE.Mesh(this.geo!, this.mat!);
      m.position.copy(pos).setY(pos.y + 0.6);
      m.scale.set(1, 1.6, 1);
      ctx.scene.add(m);
      this.props.push(m);
      const off = ctx.interactions.register({
        id: `sunstone:${s.id}`,
        position: pos,
        radius: 3,
        label: 'Take the Sun Stone fragment',
        priority: 2,
        enabled: () => !this.sys.flags.has(`shard:${s.id}`),
        interact: (c) => {
          this.sys.flags.add(`shard:${s.id}`);
          c.inventory.add('sun_stone', 1);
          m.visible = false;
          const n = SUN_STONE_SHARDS.filter((q) => this.sys.flags.has(`shard:${q.id}`)).length;
          c.events.emit('ui:notify', { text: `Sun Stone fragment ${n}/${SUN_STONES_NEEDED}. It is warm, like a heartbeat.`, kind: 'discovery', duration: 4, icon: '🔶' });
        },
      });
      this.unreg.push(off);
    });
    // Altar socket glow.
    const a = this.altar();
    const glowGeo = new THREE.SphereGeometry(0.55, 16, 12);
    const glowMat = new THREE.MeshStandardMaterial({ color: '#ffb040', emissive: '#ff7a10', emissiveIntensity: 0.6 });
    this.altarGlow = new THREE.Mesh(glowGeo, glowMat);
    this.altarGlow.position.copy(a).setY(a.y + 1.4);
    ctx.scene.add(this.altarGlow);
    this.props.push(this.altarGlow);
    this.unreg.push(
      ctx.interactions.register({
        id: 'sunstone:altar',
        position: a,
        radius: 4,
        label: 'Altar of the Eternal Flame — set the Sun Stone',
        priority: 1,
        enabled: () => !this.sys.flags.has('dragon_called'),
        interact: () => this.useAltar(),
      }),
    );
  }

  private teardown(): void {
    this.built = false;
    for (const u of this.unreg) u();
    this.unreg = [];
    for (const o of this.props) {
      o.removeFromParent();
      if (o === this.altarGlow) {
        (o as THREE.Mesh).geometry.dispose();
        ((o as THREE.Mesh).material as THREE.Material).dispose();
      }
    }
    this.props = [];
    this.altarGlow = null;
    this.geo?.dispose();
    this.mat?.dispose();
    this.geo = null;
    this.mat = null;
  }

  /** The altar: requires every fragment, then firebending. */
  useAltar(): boolean {
    const ctx = this.ctx;
    const say = (text: string, kind: 'info' | 'warning' | 'discovery' = 'info') => ctx.events.emit('ui:notify', { text, kind, duration: 5, icon: '🔥' });
    if (this.sys.flags.has('dragon_called')) return false;
    if (!this.sys.flags.has('sun_stone_set')) {
      const have = ctx.inventory.count('sun_stone');
      if (have < SUN_STONES_NEEDED) {
        say(`Three hollows are carved into the altar, shaped like broken suns. (${have}/${SUN_STONES_NEEDED} Sun Stone fragments)`);
        return false;
      }
      ctx.inventory.remove('sun_stone', SUN_STONES_NEEDED);
      this.sys.flags.add('sun_stone_set');
      ctx.audio.play('ui.discovery', { volume: 0.8 });
    }
    if (!ctx.progression.canBend('fire')) {
      say('The Sun Stone sits whole again, but cold. Only a firebender could rekindle it.', 'warning');
      return false;
    }
    this.kindleUntil = ctx.time.elapsed + 30;
    say('The fragments lock together. Breathe your fire into the Sun Stone — bend fire at the altar!', 'discovery');
    return true;
  }

  private callDragon(): void {
    const ctx = this.ctx;
    this.sys.flags.add('dragon_called');
    this.phase = 'arriving';
    this.phaseT = 0;
    const a = this.altar();
    ctx.vfx.flash(a.clone().setY(a.y + 1.5), '#ffaa40', 12, 0.8, 30);
    ctx.vfx.burst('fire', a.clone().setY(a.y + 1.5), { count: 40, speed: 6 });
    ctx.events.emit('camera:shake', { intensity: 0.4, duration: 1.2 });
    ctx.events.emit('ui:notify', { text: 'The Sun Stone blazes! Far off, something vast answers with a roar…', kind: 'discovery', duration: 6, icon: '🐉' });
    // The habitat now qualifies; spawn immediately and fly it in from the caldera.
    this.sys.habitats.update(1);
    const c = this.dragon();
    if (c) {
      const pr = this.perch();
      const from = pr.clone().add(new THREE.Vector3(-160, 90, -120));
      c.placeAt(from, Math.atan2(pr.x - from.x, pr.z - from.z));
      c.setState('scripted');
      c.takeOff(pr.y + 25);
      ctx.audio.play('creature.dragon.roar', { position: from, volume: 1, range: 600 });
    }
  }

  // ---------------------------------------------------------------- dragon behaviour

  private updateDragon(dt: number): void {
    const c = this.dragon();
    const p = this.ctx.player!;
    this.phaseT += dt;
    if (!c) {
      if (this.phase !== 'done' && this.phase !== 'dormant' && this.sys.bondedCount('dragon') > 0) this.phase = 'done';
      return;
    }
    if (!this.dragonUnreg) {
      this.dragonUnreg = this.ctx.interactions.register({
        id: 'dragon:face',
        position: c.root.position,
        radius: c.radius + 9,
        label: 'Stand before the dragon',
        priority: 4,
        enabled: () => this.phase === 'waiting' && this.ctx.time.elapsed >= this.retryAt && !c.disposed,
        interact: () => this.startTest(),
      });
    }
    if (c.disposed) {
      this.dragonUnreg?.();
      this.dragonUnreg = null;
      return;
    }
    const pr = this.perch();
    const pl = this.plaza();
    const toPlayer = Math.hypot(p.position.x - c.position.x, p.position.z - c.position.z);
    switch (this.phase) {
      case 'dormant':
        // Spawned from a save after it was called: start perched.
        this.phase = 'perched';
        c.setState('scripted');
        break;
      case 'arriving':
      case 'returning':
        c.setState('scripted');
        // Touched down short of the perch (overshoot, obstacle): take off again.
        if (!c.flying && Math.hypot(c.position.x - pr.x, c.position.z - pr.z) > 8) c.takeOff(Math.max(pr.y, c.position.y) + 10);
        c.wantAlt = pr.y + (Math.hypot(c.position.x - pr.x, c.position.z - pr.z) > 30 ? 25 : 0);
        c.moveTo(pr.x, pr.z, c.def.fly!.cruise * 0.8);
        if (Math.hypot(c.position.x - pr.x, c.position.z - pr.z) < 6) {
          c.land();
          if (!c.flying) {
            this.phase = 'perched';
            c.stopMoving();
          }
        }
        if (this.phaseT > 60 && !c.flying) this.phase = 'perched';
        break;
      case 'perched':
        c.setState('scripted');
        c.stopMoving();
        c.forcedAction = toPlayer < 80 ? 'alert' : 'rest';
        if ((toPlayer < 110 || Math.hypot(p.position.x - pl.x, p.position.z - pl.z) < 45) && this.ctx.time.elapsed >= this.retryAt) {
          this.phase = 'descending';
          this.phaseT = 0;
          c.forcedAction = 'roar';
          this.ctx.audio.play('creature.dragon.roar', { position: c.position, volume: 1, range: 300 });
          this.ctx.events.emit('ui:notify', { text: 'The dragon uncoils and glides down to the plaza. It is waiting for you.', kind: 'discovery', duration: 5, icon: '🐉' });
        }
        break;
      case 'descending':
        c.forcedAction = null;
        if (!c.flying && Math.hypot(c.position.x - pl.x, c.position.z - pl.z) > 10) c.takeOff(Math.max(pl.y, c.position.y) + 8);
        c.wantAlt = pl.y + 6;
        c.moveTo(pl.x, pl.z, c.def.fly!.cruise * 0.6);
        if (Math.hypot(c.position.x - pl.x, c.position.z - pl.z) < 8) {
          c.land();
          if (!c.flying) {
            this.phase = 'waiting';
            c.stopMoving();
          }
        }
        if (this.phaseT > 40) {
          // Never get stuck: settle wherever it is.
          c.land();
          if (!c.flying) this.phase = 'waiting';
        }
        break;
      case 'waiting':
        c.stopMoving();
        c.wantYaw = Math.atan2(p.position.x - c.position.x, p.position.z - c.position.z);
        c.forcedAction = 'alert';
        if (toPlayer > 160) {
          this.phase = 'returning';
          this.phaseT = 0;
          c.forcedAction = null;
          c.takeOff(pr.y + 25);
        }
        break;
      case 'test':
        this.updateTest(c, dt);
        break;
      default:
        break;
    }
  }

  startTest(): boolean {
    const c = this.dragon();
    const p = this.ctx.player;
    if (!c || !p || this.phase !== 'waiting') return false;
    if (!this.ctx.progression.canBend('fire')) {
      this.ctx.events.emit('ui:notify', { text: 'The dragon snorts smoke and turns away. It only tests those who carry fire.', kind: 'warning', duration: 4 });
      return false;
    }
    this.phase = 'test';
    this.test = { t: 0, start: p.position.clone(), fire: 0, angle: Math.atan2(c.position.x - p.position.x, c.position.z - p.position.z), failed: null, breathT: 0 };
    c.forcedAction = 'roar';
    c.takeOff(p.position.y + 5);
    this.ctx.audio.play('creature.dragon.roar', { position: c.position, volume: 1 });
    this.ctx.events.emit('ui:notify', { text: 'The test of fearlessness: hold your ground inside the dragon\'s fire. Do not flinch — and when it dances, bend fire with it.', kind: 'discovery', duration: 7, icon: '🐉' });
    return true;
  }

  private updateTest(c: Creature, dt: number): void {
    const T = this.test!;
    const p = this.ctx.player!;
    T.t += dt;
    // Circle the player, breathing fire along the circle (around — never at — them).
    T.angle += dt * 0.55;
    const R = 11 + c.radius;
    const tx = T.start.x + Math.sin(T.angle) * R, tz = T.start.z + Math.cos(T.angle) * R;
    c.wantAlt = T.start.y + 4.5;
    c.moveTo(tx, tz, 9);
    c.forcedAction = null;
    T.breathT -= dt;
    if (T.breathT <= 0 && T.t > 2) {
      T.breathT = 0.25;
      const mouth = c.model.mouth.getWorldPosition(new THREE.Vector3());
      // Tangent to the circle, angled away from the centre.
      const tan = new THREE.Vector3(Math.cos(T.angle), -0.15, -Math.sin(T.angle)).normalize();
      this.ctx.vfx.burst('flame', mouth, { count: 8, dir: tan, spread: 0.25, speed: 10, size: 1.6 });
      if (Math.random() < 0.3) this.ctx.vfx.flash(mouth, '#ff8a30', 5, 0.2, 18);
    }
    if (Math.floor(T.t) === 6 && Math.floor(T.t - dt) === 5) this.ctx.events.emit('ui:notify', { text: 'The dragon dances around you. Bend fire with it!', kind: 'info', duration: 4, icon: '🔥' });
    const moved = Math.hypot(p.position.x - T.start.x, p.position.z - T.start.z);
    if (!T.failed && moved > HOLD_RADIUS) T.failed = 'You stepped out of the fire. The dragon sees fear.';
    if (!T.failed && (p.body?.horizontalSpeed ?? 0) > 7.8) T.failed = 'You ran. The dragon sees fear.';
    if (T.failed) {
      this.ctx.events.emit('ui:notify', { text: `${T.failed} It returns to its perch — come back and try again.`, kind: 'warning', duration: 6, icon: '🐉' });
      this.test = null;
      this.phase = 'returning';
      this.phaseT = 0;
      this.retryAt = this.ctx.time.elapsed + 30;
      c.takeOff(this.perch().y + 25);
      return;
    }
    if (T.t >= TEST_TIME) {
      if (T.fire >= 2) {
        this.test = null;
        this.phase = 'done';
        c.land();
        c.forcedAction = 'bow';
        this.ctx.events.emit('ui:notify', { text: 'The fire swirls around you in every colour of the sun. The dragon lowers its great head and bows. You are worthy.', kind: 'success', duration: 7, icon: '🐉' });
        this.sys.taming.trust.set(c.uid, 100);
        this.dragonUnreg?.();
        this.dragonUnreg = null;
        setTimeout(() => {
          if (c.forcedAction === 'bow') c.forcedAction = null;
        }, 2500);
        this.sys.bondCreature(c);
      } else {
        T.failed = 'You stood firm, but never showed the dragon your fire.';
        this.updateTest(c, 0);
      }
    }
  }

  /** Debug / tests: progress snapshot. */
  snapshot(): Record<string, unknown> {
    return { ...this.requirements(), test: this.test ? { t: +this.test.t.toFixed(2), fire: this.test.fire, failed: this.test.failed } : null };
  }

  clear(): void {
    this.teardown();
    this.dragonUnreg?.();
    this.dragonUnreg = null;
    this.test = null;
    this.phase = 'dormant';
  }
}
