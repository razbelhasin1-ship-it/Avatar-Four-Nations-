import type { Cap } from './FireCapital';
import { CALDERA, FNC, atAxis } from './layout';
import { slabRect } from './kit';

/**
 * Hari Bulkan, the Royal Caldera City, on the crater floor. (Phase 1: the avenue from the crater
 * gate and Hari Bulkan Square before the palace; the lakes are terrain lakes in WorldLayout.
 * Mansions, temples, academies, the Coronation Plaza and the garden villa come in phase 3.)
 */
export function* buildCaldera(cap: Cap): Generator<unknown, void, unknown> {
  const { env } = cap;
  const b = env.chunks.named('major', 'fnc_caldera').builder;
  const Y = CALDERA.y;
  const Sq = CALDERA.square;
  // Square (directly before the palace gate).
  const sc = atAxis(0, (Sq.s0 + Sq.s1) / 2);
  slabRect(b, 'stone_tan', { x: sc.x, z: sc.z, y: Y + 0.05, w: Sq.half * 2, d: Sq.s1 - Sq.s0, thick: 0.3 });
  // Avenue from the gate stair to the square.
  const a0 = Sq.s1, a1 = FNC.floorR - 2;
  const ac = atAxis(0, (a0 + a1) / 2);
  slabRect(b, 'paving', { x: ac.x, z: ac.z, y: Y + 0.05, w: 12, d: a1 - a0, thick: 0.3 });
  cap.mark('square', sc.x, Y, sc.z);
  yield;
}
