import * as THREE from 'three';
import { getTechnique } from '../combat/CombatSystem';
import { TrainingDummy } from '../entities/TrainingDummy';
import { getSpot } from '../world/Spots';
import type { GameContext } from '../core/GameContext';
import type { GameEvents } from '../core/events';
import type { Element } from '../core/types';

/**
 * Tutorial lesson script. Each step shows an instruction and completes when its
 * condition is met through real play (events, input or state). Text uses
 * {action} placeholders that render as the player's current key bindings.
 */

export interface StepRuntime {
  ctx: GameContext;
  /** Per-step counters keyed by name. */
  counters: Record<string, number>;
  /** Seconds since the step started. */
  t: number;
  /** Data stash for the step (spawned dummy ids...). */
  data: Record<string, any>;
}

export interface TutorialStep {
  id: string;
  title: string;
  text: string;
  /** Wording for touch screens, when the keyboard/mouse text does not fit. */
  touch?: string;
  /** Optional element to switch to when the step starts. */
  element?: Element;
  /** Setup (spawn dummies, set reserve...). */
  enter?(rt: StepRuntime): void;
  /** Undo temporary setup when the step is left (next, previous, skip or the tutorial ends). */
  exit?(rt: StepRuntime): void;
  /** Events counted while this step is active. Return a counter name to increment. */
  onEvent?: Partial<{ [K in keyof GameEvents]: (rt: StepRuntime, p: GameEvents[K]) => string | null }>;
  /** Called every frame; return true when complete. */
  check(rt: StepRuntime): boolean;
  /** Progress label, e.g. "2 / 3". */
  progress?(rt: StepRuntime): string;
  /** Minimum seconds before the step may complete (lets people read). */
  minTime?: number;
}

const kindOf = (id: string) => getTechnique(id)?.kind;

function castCounter(element: Element | 'avatar' | null, kinds: string[] | null, name: string) {
  return (rt: StepRuntime, p: GameEvents['technique:cast']): string | null => {
    if (!p.isPlayer) return null;
    if (element && p.element !== element) return null;
    if (kinds && !kinds.includes(kindOf(p.id) ?? '')) return null;
    return name;
  };
}

function hitCounter(element: Element | 'avatar' | null, name: string) {
  return (_rt: StepRuntime, p: GameEvents['hit']): string | null => {
    if (!p.playerIsAttacker || p.targetKind !== 'target') return null;
    if (element && p.element !== element) return null;
    return name;
  };
}

const c = (rt: StepRuntime, k: string) => rt.counters[k] ?? 0;

export const TUTORIAL_STEPS: TutorialStep[] = [
  {
    id: 'welcome',
    title: 'Welcome, Avatar',
    text: 'This is Meditation Isle, a training ground between the worlds. Nothing you do here changes your journey. Follow the lessons — or skip any of them.',
    minTime: 3,
    check: (rt) => rt.t > 5,
  },
  {
    id: 'look',
    title: 'Look Around',
    text: 'Click the game to capture the mouse, then move it to look around. (Gamepad: right stick. Touch: drag on the right side.)',
    touch: 'Drag your finger on the right side of the screen to look around.',
    check: (rt) => c(rt, 'look') > 400,
    progress: (rt) => `${Math.min(100, Math.round(c(rt, 'look') / 4))}%`,
  },
  {
    id: 'move',
    title: 'Movement',
    text: 'Walk with {forward}{left}{back}{right}. Hold {sprint} to sprint.',
    touch: 'Walk with the stick on the left side of the screen. Push it all the way, or tap SPRINT, to run.',
    enter: (rt) => {
      const p = rt.ctx.player!;
      rt.data.start = p.position.clone();
    },
    check: (rt) => {
      const p = rt.ctx.player!;
      return p.position.distanceTo(rt.data.start) > 12;
    },
    progress: (rt) => `${Math.min(12, rt.ctx.player!.position.distanceTo(rt.data.start)).toFixed(0)} / 12 m`,
  },
  {
    id: 'jump',
    title: 'Jumping & Gliding',
    text: 'Press {jump} to jump. As an Airbender, press it again in the air for a wind-assisted jump, and hold it while falling to glide.',
    touch: 'Tap JUMP to jump. As an Airbender, tap it again in the air for a wind-assisted jump, and hold it while falling to glide.',
    element: 'air',
    onEvent: {
      'player:jumped': () => 'jump',
      'player:glide': (_rt, p) => (p.active ? 'glide' : null),
    },
    check: (rt) => c(rt, 'jump') >= 2,
    progress: (rt) => `${Math.min(2, c(rt, 'jump'))} / 2 jumps${c(rt, 'glide') ? ' · glided!' : ''}`,
  },
  {
    id: 'dodge',
    title: 'Evasion',
    text: 'Press {dodge} to dodge. Each element dodges differently — Airbenders dash on the wind. You are briefly untouchable while dodging.',
    touch: 'Tap DODGE to dodge. Each element dodges differently — Airbenders dash on the wind. You are briefly untouchable while dodging.',
    onEvent: { 'player:dodged': () => 'dodge' },
    check: (rt) => c(rt, 'dodge') >= 2,
    progress: (rt) => `${Math.min(2, c(rt, 'dodge'))} / 2`,
  },
  {
    id: 'air_basic',
    title: 'Airbending: Strikes',
    text: 'A training dummy appears ahead. Aim with the crosshair and press {attack} repeatedly — your strikes chain into a combo.',
    touch: 'A training dummy appears ahead. Aim with the crosshair and tap ATTACK repeatedly — your strikes chain into a combo.',
    element: 'air',
    enter: (rt) => {
      rt.data.dummy = spawnDummy(rt, 8, 0);
    },
    onEvent: { hit: hitCounter('air', 'hits') },
    check: (rt) => c(rt, 'hits') >= 3,
    progress: (rt) => `${Math.min(3, c(rt, 'hits'))} / 3 hits`,
  },
  {
    id: 'air_heavy',
    title: 'Charged Techniques',
    text: 'Hold {aim} to gather power, then release to unleash a heavy technique. A full charge hits much harder.',
    touch: 'Hold HEAVY to gather power, then release to unleash a heavy technique. A full charge hits much harder.',
    element: 'air',
    onEvent: { 'technique:cast': castCounter('air', ['heavy'], 'heavy') },
    check: (rt) => c(rt, 'heavy') >= 1,
  },
  {
    id: 'abilities',
    title: 'Techniques',
    text: 'Your learned techniques sit in slots {ability1}–{ability4}. Try one now. Open the Technique Library with {techniques} to change your loadout.',
    touch: 'Your techniques sit on the round technique buttons. Try one now. Every technique is unlocked here: change your loadout in MENU → Techniques.',
    element: 'air',
    onEvent: { 'technique:cast': castCounter(null, ['ability', 'movement', 'defense'], 'ability') },
    check: (rt) => c(rt, 'ability') >= 1,
  },
  {
    id: 'switch_fire',
    title: 'The Avatar Bends All Four',
    text: 'Press {elementNext} (or scroll) to switch elements. Switch to Fire and land a quick chain of fire punches on the dummy.',
    touch: 'Tap the element button on the left (it shows your element) to switch elements. Switch to Fire and land a quick chain of fire punches on the dummy.',
    onEvent: { hit: hitCounter('fire', 'fire') },
    check: (rt) => c(rt, 'fire') >= 3,
    progress: (rt) => `${Math.min(3, c(rt, 'fire'))} / 3 fire hits`,
  },
  {
    id: 'earth',
    title: 'Earthbending',
    text: 'Switch to Earth. Earthbending is slower but heavy — stones rise from the ground beneath you. Strike the dummy with earth.',
    onEvent: { hit: hitCounter('earth', 'earth') },
    check: (rt) => c(rt, 'earth') >= 2,
    progress: (rt) => `${Math.min(2, c(rt, 'earth'))} / 2 earth hits`,
  },
  {
    id: 'lock',
    title: 'Targeting',
    text: 'Press {lockOn} to lock onto the dummy. Your attacks and camera will follow it. Press again to release.',
    touch: 'Tap LOCK to lock onto the dummy. Your attacks and camera will follow it. Tap it again to release.',
    check: (rt) => !!rt.ctx.player?.lockTarget,
  },
  {
    id: 'water_none',
    title: 'Waterbending Needs Water',
    text: 'Switch to Water and try to attack. A Waterbender cannot create water from nothing — you need a river, the sea, a pond, ice or water you carry.',
    element: 'water',
    enter: (rt) => {
      rt.ctx.player!.waterReserve = 0;
    },
    onEvent: {
      'water:unavailable': () => 'none',
      'technique:cast': castCounter('water', null, 'cast'),
    },
    check: (rt) => c(rt, 'none') >= 1 || c(rt, 'cast') >= 1,
    minTime: 2,
  },
  {
    id: 'water_draw',
    title: 'Drawing Water',
    text: 'Walk to the pond or stream and hold {drawWater} to draw water to you. The water you carry swirls around you and powers your techniques anywhere — until it runs out, or until you switch elements and let it fall.',
    touch: 'Walk to the pond or stream and hold DRAW to pull water to you. The water you carry swirls around you and powers your techniques anywhere — until it runs out, or until you switch elements and let it fall.',
    element: 'water',
    onEvent: { 'water:drawn': () => 'drawn' },
    check: (rt) => c(rt, 'drawn') >= 1 && (rt.ctx.player?.waterReserve ?? 0) > 5,
    progress: (rt) => `Water held: ${Math.round(rt.ctx.player?.waterReserve ?? 0)}`,
  },
  {
    id: 'water_attack',
    title: 'Water Whip',
    text: 'Now strike the dummy with water. Near a source, water flows straight from it into your attacks.',
    element: 'water',
    onEvent: { hit: hitCounter('water', 'water') },
    check: (rt) => c(rt, 'water') >= 2,
    progress: (rt) => `${Math.min(2, c(rt, 'water'))} / 2 water hits`,
  },
  {
    id: 'defense',
    title: 'Defence',
    text: 'Defensive techniques block or deflect attacks. Use a defensive technique from your slots (for example a Water Shield), or dodge with {dodge}.',
    touch: 'Defensive techniques block or deflect attacks. Use a defensive technique from your buttons (for example a Water Shield), or tap DODGE.',
    onEvent: {
      'technique:cast': castCounter(null, ['defense'], 'def'),
      'player:dodged': () => 'dodge',
    },
    check: (rt) => c(rt, 'def') >= 1 || c(rt, 'dodge') >= 1,
  },
  {
    id: 'avatar_state',
    title: 'The Avatar State',
    text: 'Press {avatarState} to enter the Avatar State: your eyes and markings glow and every element grows stronger. Your spirit drains while it lasts. Press {avatarState} again to leave it.',
    touch: 'Tap AVATAR at the top of the screen to enter the Avatar State: your eyes and markings glow and every element grows stronger. Your spirit drains while it lasts. Tap AVATAR again to leave it.',
    // The sandbox has the Elements Sphere unlocked everywhere else; this lesson is about the plain Avatar State.
    enter: (rt) => {
      rt.data.sphereWas = rt.ctx.progression.elementsSphereUnlocked;
      rt.ctx.progression.elementsSphereUnlocked = false;
    },
    exit: (rt) => {
      if (rt.data.sphereWas) rt.ctx.progression.elementsSphereUnlocked = true;
    },
    onEvent: { 'avatarState:changed': (_rt, p) => (p.active ? 'on' : 'off') },
    check: (rt) => c(rt, 'on') >= 1 && c(rt, 'off') >= 1,
    progress: (rt) => (c(rt, 'on') ? (c(rt, 'off') ? 'Done' : 'Now leave the Avatar State') : 'Enter the Avatar State'),
  },
  {
    id: 'sphere',
    title: 'A Vision: The Elements Sphere',
    text: 'When you have MASTERED all four elements in your journey, the Avatar State awakens into the Elements Sphere. Here, as a vision, you may feel it: press {avatarState}, then unleash ultimates with {ability1}–{ability4} and {ability5}.',
    touch: 'When you have MASTERED all four elements in your journey, the Avatar State awakens into the Elements Sphere. Here, as a vision, you may feel it: tap AVATAR, then unleash ultimates with the technique buttons.',
    enter: (rt) => {
      rt.data.prevSphere = rt.ctx.progression.elementsSphereUnlocked;
      // Still in the plain Avatar State from the last lesson: end it quietly so the next press awakens the Sphere.
      if (rt.ctx.avatar.active && !rt.ctx.avatar.sphereActive) rt.ctx.avatar.deactivate(true);
      rt.ctx.avatar.spirit = rt.ctx.avatar.maxSpirit;
      // Sandbox-only preview: grants the sphere for this tutorial session (never saved).
      rt.ctx.progression.elementsSphereUnlocked = true;
      for (const id of ['ult_hurricane', 'ult_tsunami', 'ult_earthquake', 'ult_fire_tornado', 'ult_cataclysm']) if (getTechnique(id)) rt.ctx.progression.learn(id, 'debug', true);
    },
    onEvent: {
      'avatarState:changed': (_rt, p) => (p.active && p.sphere ? 'sphere' : null),
      'technique:cast': castCounter('avatar', null, 'ult'),
    },
    check: (rt) => c(rt, 'sphere') >= 1 && (c(rt, 'ult') >= 1 || !getTechnique('ult_hurricane')),
    progress: (rt) => (c(rt, 'sphere') ? 'Unleash an ultimate' : 'Enter the Avatar State'),
  },
  {
    id: 'menus',
    title: 'Your Journey',
    text: 'Open the World Map with {map} (fast travel to discovered places), the Journal with {journal} (quests, masters, mastery) and your Inventory with {inventory}. Find masters marked ✦ across the world to learn new techniques. Your journey autosaves; save manually from the pause menu ({pause}).',
    touch: 'Tap MAP for the World Map (fast travel to discovered places) or MENU for the Journal and Inventory. Masters marked ✦ teach new techniques. Your journey autosaves.',
    onEvent: { 'ui:screen': (_rt, p) => (p.screen === 'map' || p.screen === 'journal' || p.screen === 'inventory' ? 'opened' : null) },
    check: (rt) => c(rt, 'opened') >= 1,
  },
  {
    id: 'done',
    title: 'You Are Ready',
    text: 'Keep practising here as long as you like, or leave the tutorial from the pause menu. The Four Nations await.',
    touch: 'Keep practising here as long as you like, or leave the tutorial from MENU. The Four Nations await.',
    check: () => false,
  },
];

/** Place a sturdy training dummy (re-uses an existing one). Prefers the isle's authored dummy spots. */
export function spawnDummy(rt: StepRuntime, dist: number, side: number): number {
  const existing = rt.ctx.entities.byKind('target');
  if (existing.length) return existing[0].id;
  const ctx = rt.ctx;
  const p = ctx.player!;
  const spot = getSpot('tutorial_dummy_1');
  let pos: THREE.Vector3;
  if (spot) pos = new THREE.Vector3(spot.x, 0, spot.z);
  else {
    const f = new THREE.Vector3(Math.sin(p.yaw), 0, Math.cos(p.yaw));
    const r = new THREE.Vector3(-f.z, 0, f.x);
    pos = p.position.clone().addScaledVector(f, dist).addScaledVector(r, side);
  }
  pos.y = ctx.world.groundAt(pos.x, pos.z, pos.y + 20).y;
  const d = new TrainingDummy(400, { label: 'Spirit Training Dummy' });
  d.respawnTime = 1.5;
  d.position.copy(pos);
  ctx.entities.add(d);
  return d.id;
}
