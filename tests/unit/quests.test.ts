import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { EventBus } from '../../src/core/EventBus';
import type { Element } from '../../src/core/types';
import { QuestSystem } from '../../src/quests/QuestSystem';
import { LANDMARKS } from '../../src/world/WorldLayout';

/** QuestSystem on a minimal context (the systems it reads, stubbed). */
function harness(start: Element, bends: Element[] = [start]) {
  const events = new EventBus();
  const unlocked = new Set<Element>(bends);
  const player = { position: new THREE.Vector3(1e5, 0, 1e5) };
  const ctx = {
    events,
    session: { active: true, kind: 'campaign' },
    time: { elapsed: 0 },
    player,
    progression: {
      startingElement: start,
      canBend: (e: Element) => unlocked.has(e),
      knows: () => false,
      mastery: { air: { mastered: false }, water: { mastered: false }, earth: { mastered: false }, fire: { mastered: false } },
      addXP: () => {},
      learn: () => {},
      unlockElement: () => {},
    },
    inventory: { count: () => 0, addCurrency: () => {}, add: () => {}, remove: () => {}, unlockCosmetic: () => {} },
    companions: { bondedCount: () => 0 },
    world: { discovered: new Set<string>(), heightAt: () => 0 },
    npcs: { positionOf: () => new THREE.Vector3() },
  };
  const q = new QuestSystem();
  q.init(ctx as never);
  return { q, events, unlocked, player };
}

/** The water opening and Master Siku's first lesson, through the events gameplay emits. */
function finishWaterOpening(h: ReturnType<typeof harness>): void {
  const { q, events } = h;
  q.onSessionStart();
  expect(q.tracked).toBe('mq_awakening_water');
  events.emit('npc:interact', { npcId: 'nwt_elder' });
  events.emit('water:drawn', { sourceId: 's', sourceType: 'fountain', amount: 5, position: { x: 0, y: 0, z: 0 } });
  for (let i = 0; i < 3; i++) events.emit('technique:cast', { id: 'water_whip', casterId: 1, element: 'water', isPlayer: true, position: { x: 0, y: 0, z: 0 } });
  events.emit('avatarState:changed', { active: true, sphere: false });
  expect(q.isComplete('mq_awakening_water')).toBe(true);
  q.setFlag('avatar_awakened'); // set by the training module on the first Avatar State
  q.checkAutoStart();
  expect(q.tracked).toBe('mq_avatar_cycle_water');
  events.emit('npc:interact', { npcId: 'master_siku' });
  events.emit('training:completed', { masterId: 'master_siku', lessonId: 'siku_ice_wall', techniqueId: 'ice_wall', success: true });
}

describe('quest tracking along the main line', () => {
  it('after the first lesson the next nation of the Avatar cycle is tracked (not the last seek quest started)', () => {
    const h = harness('water');
    finishWaterOpening(h);
    for (const e of ['earth', 'fire', 'air']) expect(h.q.isActive(`mq_seek_${e}`), e).toBe(true);
    expect(h.q.tracked).toBe('mq_seek_earth');
  });

  it('finishing a tracked seek quest moves tracking to a main quest the compass can point at', () => {
    const h = harness('water');
    finishWaterOpening(h);
    const bss = LANDMARKS.find((l) => l.id === 'bss_lower_ring')!;
    h.player.position.set(bss.x, 0, bss.z);
    h.q.update(1);
    h.events.emit('npc:interact', { npcId: 'master_lien' });
    h.unlocked.add('earth');
    h.events.emit('element:unlocked', { element: 'earth' });
    expect(h.q.isComplete('mq_seek_earth')).toBe(true);
    // The Avatar Cycle's "nations" step has no located objective: the next seek quest is tracked instead.
    expect(h.q.tracked).toBe('mq_seek_fire');
  });

  it('a seek quest for an element already awakened elsewhere completes at once', () => {
    const h = harness('water', ['water', 'earth']);
    finishWaterOpening(h);
    expect(h.q.isComplete('mq_seek_earth')).toBe(true);
    expect(h.q.tracked).toBe('mq_seek_fire');
  });
});
