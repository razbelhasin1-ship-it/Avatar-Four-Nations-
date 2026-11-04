import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import '../../src/combat/techniques';
import { CombatSystem, getTechnique } from '../../src/combat/CombatSystem';
import { EventBus } from '../../src/core/EventBus';
import { FEATURES } from '../../src/core/features';
import type { SurfaceType } from '../../src/core/types';
import { BLOOD, LAVA, MOON, STRAIN, SUB_SKILLS } from '../../src/data/subskills';
import { Entity, Health } from '../../src/entities/Entity';
import { Progression } from '../../src/progression/Progression';
import { BloodbendingSystem } from '../../src/subskills/blood/Bloodbending';
import { LavaSystem } from '../../src/subskills/lava/LavaSystem';
import { MoonSystem } from '../../src/subskills/Moon';
import { ProjectionSystem } from '../../src/subskills/projection/Projection';
import { SubSkillSystem } from '../../src/subskills/SubSkills';

/** A living body for tests. */
class Body extends Entity {
  readonly kind = 'enemy' as const;
  chi = 100;
  maxChi = 100;
  element: string | undefined;
  level = 1;
  readonly isPlayer: boolean;
  constructor(isPlayer = false, element?: string, level = 1) {
    super();
    this.isPlayer = isPlayer;
    this.element = element;
    this.level = level;
    this.health = new Health(100);
    this.body = null;
  }
  castOrigin(_w: string, out: THREE.Vector3): THREE.Vector3 {
    return out.copy(this.position).setY(this.position.y + 1.4);
  }
  update(): void {}
}

/** Minimal game context: enough for the sub-skill systems to run headless. */
function fakeCtx(o: { surface?: (x: number, z: number) => SurfaceType; water?: (x: number, z: number) => boolean } = {}) {
  const events = new EventBus();
  const flags = new Set<string>();
  const progression = new Progression();
  progression.setupNewGame('water');
  const extra = new Map<string, unknown>();
  const sky = { timeOfDay: 12, moonPhase: 0.5, secondsPerHour: 0 };
  const ctx: Record<string, unknown> = {
    events,
    extra,
    progression,
    session: { active: true, kind: 'campaign' },
    time: { elapsed: 0 },
    settings: { data: { gameplay: { reduceIntenseEffects: false, difficulty: 'balanced' }, graphics: { particleDensity: 1, dynamicLights: false } } },
    quests: { flags, setFlag: (f: string) => flags.add(f), hasFlag: (f: string) => flags.has(f), checkAutoStart: () => {}, isActive: () => false },
    world: {
      sky,
      heightAt: () => 0,
      groundAt: (x: number, z: number) => ({ y: 0, surface: o.surface?.(x, z) ?? 'grass', nx: 0, ny: 1, nz: 0, colliderId: 0 }),
      liquidAt: (x: number, z: number) => (o.water?.(x, z) ? { level: 1 } : null),
      raycast: () => null,
      collision: { add: () => 1, remove: () => {} },
      rocks: { nearest: () => null },
      landmark: () => undefined,
      discovered: new Set<string>(),
    },
    scene: new THREE.Scene(),
    audio: { play: () => null, loop: () => ({ stop: () => {}, setPosition: () => {}, setVolume: () => {}, setPitch: () => {}, setParam: () => {} }), duck: () => {} },
    vfx: { burst: () => {}, ring: () => {}, flash: () => {}, group: new THREE.Group() },
    entities: { queryRadius: () => [], get: () => undefined },
    npcs: { liveNPCs: () => [][Symbol.iterator](), alarm: () => {} },
    combat: null as unknown,
    avatar: { active: false },
    player: null,
    cameraRig: { follow: null, isScripted: false },
    interactions: { focus: null },
    input: { move: { x: 0, y: 0 }, isDown: () => false, wasPressed: () => false, label: (a: string) => a },
    ui: undefined,
    camera: new THREE.PerspectiveCamera(),
  };
  const combat = new CombatSystem();
  ctx.combat = combat;
  combat.init(ctx as never);
  return { ctx: ctx as never as import('../../src/core/GameContext').GameContext & { world: { sky: typeof sky } }, events, flags, progression, sky, extra };
}

function setup() {
  const f = fakeCtx();
  const moon = new MoonSystem();
  const subs = new SubSkillSystem();
  const blood = new BloodbendingSystem();
  f.extra.set('moon', moon);
  f.extra.set('subskills', subs);
  f.extra.set('bloodbending', blood);
  moon.init(f.ctx);
  subs.init(f.ctx);
  blood.init(f.ctx);
  return { ...f, moon, subs, blood };
}

describe('lunar cycle', () => {
  it('eight phases, exactly one full-moon night per cycle, moon up from moonrise to sunrise', () => {
    const { moon, sky } = setup();
    sky.timeOfDay = 22;
    let fulls = 0;
    for (let d = 0; d < MOON.cycleNights * 2; d++) {
      moon.day = d;
      if (moon.isFullMoonNight) fulls++;
      expect(moon.phaseIndex()).toBeGreaterThanOrEqual(0);
    }
    expect(fulls).toBe(2);
    moon.day = MOON.firstFullNight;
    expect(moon.isFullMoonNight).toBe(true);
    expect(moon.moonUp).toBe(true);
    sky.timeOfDay = 12;
    expect(moon.moonUp).toBe(false);
    sky.timeOfDay = 5.5;
    moon.day = MOON.firstFullNight + 1; // early morning still belongs to last night
    expect(moon.isFullMoonNight).toBe(true);
    expect(moon.fullMoonUp).toBe(true);
  });

  it('waterbending is boosted under the moon, more on the full moon', () => {
    const { moon, sky } = setup();
    sky.timeOfDay = 22;
    moon.setPhase(4);
    expect(moon.waterBoost()).toBe(MOON.boostFullMoon);
    moon.setPhase(2);
    expect(moon.waterBoost()).toBe(MOON.boostMoonUp);
    sky.timeOfDay = 12;
    expect(moon.waterBoost()).toBe(1);
  });

  it('counts days across midnight and announces sunrise', () => {
    const { moon, sky, events, ctx } = setup();
    let sunrise = 0;
    events.on('moon:sunrise', () => sunrise++);
    sky.timeOfDay = 23.9;
    moon.update(0.1, ctx);
    sky.timeOfDay = 0.2;
    moon.update(0.1, ctx);
    expect(moon.day).toBe(1);
    sky.timeOfDay = 5.9;
    moon.update(0.1, ctx);
    sky.timeOfDay = 6.1;
    moon.update(0.1, ctx);
    expect(sunrise).toBe(1);
  });

  it('saves and loads its day and phase; an old save starts the cycle fresh', () => {
    const { moon } = setup();
    moon.day = 13;
    moon.setPhase(4);
    const data = JSON.parse(JSON.stringify(moon.serialize()));
    const m2 = new MoonSystem();
    m2.reset();
    m2.deserialize(data);
    expect(m2.day).toBe(13);
    expect(m2.offset).toBe(moon.offset);
    const m3 = new MoonSystem();
    m3.reset();
    m3.deserialize(undefined);
    expect(m3.day).toBe(0);
  });
});

describe('sub-skill branches', () => {
  it('locked until unlocked; unlocking learns the moves; the gate opens', () => {
    const { subs, progression } = setup();
    const p = new Body(true);
    const hold = getTechnique('blood_hold')!;
    expect(subs.gate(hold, p as never)?.reason).toBe('locked');
    subs.unlock('blood', 'quest');
    for (const a of SUB_SKILLS.blood.abilities) expect(progression.knows(a.technique)).toBe(true);
    expect(subs.gate(hold, p as never)).toBeNull();
  });

  it('the sandbox and "master everything" never teach sub-skill moves', () => {
    const pr = new Progression();
    pr.setupSandbox();
    expect(pr.learned.has('lava_melt')).toBe(false);
    pr.debugMasterAll();
    expect(pr.learned.has('blood_hold')).toBe(false);
    expect(pr.learned.has('spirit_project')).toBe(false);
  });

  it('with the Legend of Korra flags off, their moves are absent and refused', () => {
    const { subs, progression } = setup();
    FEATURES.ENABLE_PSYCHIC_BLOODBENDING = false;
    FEATURES.ENABLE_BLOODBENDING_LIFT = false;
    FEATURES.ENABLE_MOONLESS_BLOODBENDING = false;
    subs.unlock('blood', 'quest');
    expect(progression.knows('blood_psychic')).toBe(false);
    expect(progression.knows('blood_lift')).toBe(false);
    expect(subs.gate(getTechnique('blood_lift')!, new Body(true) as never)?.reason).toBe('locked');
    subs.setKorraFlag('ENABLE_BLOODBENDING_LIFT', true);
    expect(progression.knows('blood_lift')).toBe(true);
    subs.setKorraFlag('ENABLE_BLOODBENDING_LIFT', false);
    expect(progression.knows('blood_lift')).toBe(false);
  });

  it('Moral Strain stages; Breaking locks bloodbending until an elder; the vow locks it', () => {
    const { subs, blood, moon, sky } = setup();
    subs.unlock('blood', 'quest');
    sky.timeOfDay = 22;
    moon.setPhase(4);
    expect(blood.playerGate()).toBeNull();
    subs.setStrain(STRAIN.unease + 1);
    expect(subs.stage).toBe('unease');
    subs.setStrain(STRAIN.dark + 1);
    expect(subs.stage).toBe('dark');
    subs.setStrain(STRAIN.breaking + 1);
    expect(subs.stage).toBe('breaking');
    expect(blood.playerGate()?.reason).toBe('locked');
    subs.elderMeditation();
    expect(subs.strain).toBeLessThanOrEqual(STRAIN.elderFloor);
    expect(blood.playerGate()).toBeNull();
    subs.takeVow();
    expect(blood.playerGate()?.reason).toBe('locked');
  });

  it('saves and loads unlocks, strain and the vow; an old save loads with everything locked', () => {
    const { subs } = setup();
    subs.unlock('lava', 'quest');
    subs.addStrain(30);
    subs.takeVow();
    const data = JSON.parse(JSON.stringify(subs.serialize()));
    const s2 = new SubSkillSystem();
    s2.reset();
    s2.deserialize(data);
    expect([...s2.unlocked]).toEqual(['lava']);
    expect(s2.vow).toBe('kept');
    expect(s2.strain).toBeCloseTo(30, 3);
    expect(s2.strainSeen).toBe(true);
    const old = new SubSkillSystem();
    old.reset();
    old.deserialize(undefined);
    expect(old.unlocked.size).toBe(0);
    expect(old.vow).toBe('none');
    expect(old.strain).toBe(0);
  });
});

describe('bloodbending', () => {
  function scene() {
    const s = setup();
    const player = new Body(true, 'water');
    (s.ctx as unknown as { player: Body }).player = player;
    // A bloodbender is a water master.
    s.progression.addProficiency('water', 400);
    s.subs.unlock('blood', 'quest');
    s.sky.timeOfDay = 22;
    s.moon.setPhase(4);
    return { ...s, player };
  }

  it('only on the full-moon night with the moon up; every hold ends at sunrise', () => {
    const { blood, moon, sky, events, player } = scene();
    expect(blood.playerGate()).toBeNull();
    moon.setPhase(2);
    expect(blood.playerGate()?.reason).toBe('state');
    moon.setPhase(4);
    const t = new Body(false);
    t.team = 'hostile';
    t.position.set(4, 0, 0);
    expect(blood.hold(player, t)).not.toBeNull();
    expect(t.held).not.toBeNull();
    sky.timeOfDay = 6.2;
    events.emit('moon:sunrise', { night: 0 });
    expect(t.held).toBeNull();
    expect(blood.holds.length).toBe(0);
  });

  it('a held body cannot bend', () => {
    const { blood, ctx, player } = scene();
    const t = new Body(false, 'fire');
    t.position.set(4, 0, 0);
    blood.hold(player, t);
    const r = ctx.combat.tryCast(t as never, 'fire_jab', { force: true });
    expect(r.ok).toBe(false);
    expect(r.reason).toBe('state');
  });

  it('a waterbender of equal or greater skill breaks free; a weaker one does not', () => {
    const { blood, ctx, player } = scene();
    const strong = new Body(false, 'water', 60);
    strong.position.set(4, 0, 0);
    strong.team = 'hostile';
    const h = blood.hold(player, strong)!;
    expect(h.resist).toBeGreaterThan(0);
    for (let i = 0; i < 40; i++) blood.update(0.1, ctx);
    expect(strong.held).toBeNull();
    expect(blood.stats.released.resisted).toBe(1);
    const weak = new Body(false, 'water', 1);
    weak.position.set(4, 0, 2);
    const h2 = blood.hold(player, weak)!;
    expect(h2.resist).toBe(0);
  });

  it('the Avatar State breaks a hold on the Avatar; hurting the bender breaks theirs', () => {
    const { blood, ctx, events, player } = scene();
    const hama = new Body(false, 'water', 9);
    hama.position.set(3, 0, 0);
    blood.hold(hama, player);
    expect(player.held).not.toBeNull();
    (ctx as unknown as { avatar: { active: boolean } }).avatar.active = true;
    events.emit('avatarState:changed', { active: true, sphere: false });
    expect(player.held).toBeNull();
    (ctx as unknown as { avatar: { active: boolean } }).avatar.active = false;
    const t = new Body(false);
    t.position.set(4, 0, 0);
    blood.hold(player, t);
    events.emit('player:damaged', { amount: 5 });
    expect(t.held).toBeNull();
  });

  it('never harms by itself and drains chi while held', () => {
    const { blood, ctx, player } = scene();
    const t = new Body(false);
    t.position.set(4, 0, 0);
    blood.hold(player, t);
    const hp = t.health!.hp;
    for (let i = 0; i < 10; i++) blood.update(0.1, ctx);
    expect(t.health!.hp).toBe(hp);
    expect(player.chi).toBeLessThan(100 - BLOOD.chiPerSecond * 0.9 + 0.01);
  });
});

describe('lavabending', () => {
  function lavaCtx() {
    const surfaces: Record<string, SurfaceType> = {};
    const f = fakeCtx({ surface: (x) => (x >= 100 && x < 110 ? 'metal' : x >= 110 && x < 120 ? 'ice' : x >= 120 && x < 130 ? 'snow' : x >= 130 && x < 140 ? 'wood' : 'grass'), water: (x) => x >= 200 });
    void surfaces;
    const lava = new LavaSystem();
    lava.init(f.ctx);
    return { ...f, lava };
  }

  it('needs earth: never metal, ice, snow, wood or water', () => {
    const { lava } = lavaCtx();
    expect(lava.meltable(0, 0).ok).toBe(true);
    expect(lava.meltable(105, 0).ok).toBe(false);
    expect(lava.meltable(115, 0).ok).toBe(false);
    expect(lava.meltable(125, 0).ok).toBe(false);
    expect(lava.meltable(135, 0).ok).toBe(false);
    expect(lava.meltable(250, 0).ok).toBe(false);
  });

  it('expires into stone, or cools at once; world lava never expires on its own', () => {
    const { lava, ctx } = lavaCtx();
    const p = lava.spawnPatch({ x: 0, z: 0, r: 2, life: 2, spread: 0 })!;
    expect(p.state).toBe('molten');
    for (let i = 0; i < 30; i++) lava.update(0.1, ctx);
    expect(p.state).toBe('stone');
    const q = lava.spawnPatch({ x: 20, z: 0, r: 2, spread: 0 })!;
    expect(lava.coolAt(20, 0, 3).length).toBe(1);
    expect(q.state).toBe('stone');
    const w = lava.spawnPatch({ x: 40, z: 0, r: 2, source: 'world', spread: 0 })!;
    for (let i = 0; i < 300; i++) lava.update(0.1, ctx);
    expect(w.state).toBe('molten');
  });

  it('caps live player lava (the oldest crusts over first) and caps spreading', () => {
    const { lava, ctx } = lavaCtx();
    const ps = [0, 1, 2, 3].map((i) => lava.spawnPatch({ x: i * 10, z: 50, r: 1.5 })!);
    expect(ps[0].state).toBe('stone');
    expect(ps.slice(1).every((p) => p.state === 'molten')).toBe(true);
    for (let i = 0; i < 60; i++) lava.update(0.1, ctx);
    for (const p of ps) expect(p.cells.length).toBeLessThanOrEqual(1 + LAVA.maxSpreadCells);
  });
});

describe('spiritual projection', () => {
  function projCtx() {
    const f = fakeCtx();
    const player = new Body(true, 'air');
    player.position.set(0, 0, 0);
    Object.assign(player, { appearance: {}, poseOverride: null, controlLock: 0, mountAnchor: null, aimPoint3: new THREE.Vector3() });
    (f.ctx as unknown as { player: Body }).player = player;
    const proj = new ProjectionSystem();
    proj.init(f.ctx);
    return { ...f, proj, player };
  }

  it('no bending or attacks while the spirit is out', () => {
    const { proj, ctx, player } = projCtx();
    proj.state = 'projecting';
    const r = ctx.combat.tryCast(player as never, 'air_palm', { force: true });
    expect(r.ok).toBe(false);
    expect(r.message).toMatch(/spirit/i);
  });

  it('a hit on the body sends the spirit back (and the hit still lands)', () => {
    const { proj, events } = projCtx();
    proj.state = 'projecting';
    events.emit('player:damaged', { amount: 10 });
    expect(proj.state).toBe('idle');
    expect(proj.lastEnd).toBe('struck');
  });
});
