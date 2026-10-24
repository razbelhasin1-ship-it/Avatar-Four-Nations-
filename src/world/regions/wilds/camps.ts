import * as THREE from 'three';
import type { GameContext } from '../../../core/GameContext';
import { CAMPS, type CampStyle } from './layout';
import { W, bannerPole, barrel, boat, crate, firePit, ground, lanternPost, palisade, rng, rock, tent, v3, yawFacing } from './parts';
import { WildsSite } from './WildsSite';

/**
 * Enemy camps (camp_* spots; enemies are spawned by the encounter director in
 * src/ai/EncounterDirector.ts — this only builds the set dressing). The camp
 * centre stays open (r ≈ 6 m) for the fight; props ring it at 7–15 m.
 *  - bandit:  hide tents, fire pit, crates, a rough palisade arc, weapon rack
 *  - fire:    red Fire Nation tents, iron braziers, spiked palisade, banners, watchtower
 *  - pirate:  patched tents, beached boats, barrels, bonfire, black banner
 *  - dai_li:  green stone posts and lanterns, a stone hut, Dai Li banner
 */
export class CampSite extends WildsSite {
  readonly id: string;
  readonly center: { x: number; z: number };
  override readonly loadRadius = 240;
  private readonly def: (typeof CAMPS)[number];

  constructor(idx: number) {
    super();
    this.def = CAMPS[idx];
    this.id = `wilds_${this.def.id}`;
    this.center = { x: this.def.x, z: this.def.z };
  }

  protected construct(_ctx: GameContext): void {
    const c = this.def;
    const style: CampStyle = c.style;
    const M = this.major, D = this.detail, Cl = this.clutter;
    const r = rng(Math.abs(Math.round(c.x * 7 + c.z * 13)) + 5);
    const P = (a: number, rr: number) => ({ x: c.x + Math.cos(a) * rr, z: c.z + Math.sin(a) * rr });
    // Seaward / downhill direction: lowest ground around the camp (open side of the palisade).
    let open = 0, low = Infinity;
    for (let i = 0; i < 12; i++) {
      const a = (i / 12) * Math.PI * 2;
      const p = P(a, 20);
      const h = ground(p.x, p.z);
      if (h < low) {
        low = h;
        open = a;
      }
    }
    const faceIn = (p: { x: number; z: number }) => yawFacing(c.x - p.x, c.z - p.z);
    const tentMat = style === 'fire' ? 'cloth_red' : style === 'pirate' ? 'cloth_white' : style === 'dai_li' ? 'cloth_green' : W('fur');
    // Fire at the side of the open centre.
    const fp = P(open + Math.PI, 4.5);
    if (style === 'fire') {
      for (const a of [open + Math.PI * 0.7, open - Math.PI * 0.7]) {
        const b = P(a, 6.5);
        const y = ground(b.x, b.z);
        D.cylinder('iron', { x: b.x, y, z: b.z, r: 0.12, h: 1.1, segments: 6 }, { collide: true, walkable: false });
        D.cylinder('iron', { x: b.x, y: y + 1.1, z: b.z, r: 0.55, rTop: 0.7, h: 0.4, segments: 10 });
        D.cylinder('glow_fire', { x: b.x, y: y + 1.45, z: b.z, r: 0.5, rTop: 0.1, h: 0.4, segments: 8 });
        this.addFire(b.x, y + 1.6, b.z, 0.7);
      }
    } else {
      firePit(D, fp.x, fp.z);
      this.addFire(fp.x, ground(fp.x, fp.z) + 0.3, fp.z, style === 'pirate' ? 1.3 : 1);
    }
    // Tents around the back half.
    const nT = style === 'dai_li' ? 1 : 3 + Math.floor(r() * 2);
    for (let i = 0; i < nT; i++) {
      const a = open + Math.PI + (i - (nT - 1) / 2) * 0.75;
      const p = P(a, 10.5 + r() * 1.5);
      tent(M, p.x, p.z, faceIn(p), { w: 3 + r() * 0.6, d: 3.4 + r() * 0.8, h: 2.2 + r() * 0.4, mat: tentMat });
    }
    // Crates and barrels.
    for (let i = 0; i < 6; i++) {
      const a = open + Math.PI * 0.4 + r() * Math.PI * 1.2;
      const p = P(a, 8 + r() * 4);
      if (r() < 0.5) crate(D, p.x, p.z, 0.7 + r() * 0.4, r() * 3);
      else barrel(D, p.x, p.z);
    }
    // Palisade arc behind the camp (leaves the open side and the flanks free).
    if (style !== 'pirate') {
      const pts: Array<{ x: number; z: number }> = [];
      for (let i = 0; i <= 8; i++) pts.push(P(open + Math.PI - 1.1 + (i / 8) * 2.2, 15));
      palisade(M, pts, style === 'fire' ? 3.4 : 2.6);
    }

    switch (style) {
      case 'bandit': {
        const rk = P(open + Math.PI / 2, 9);
        D.box('wood_dark', { x: rk.x, y: ground(rk.x, rk.z) + 0.9, z: rk.z, sx: 2.2, sy: 1.8, sz: 0.3, yaw: faceIn(rk) }, { collide: true, walkable: false });
        for (let k = 0; k < 4; k++) D.box('iron', { x: rk.x + Math.cos(faceIn(rk)) * (k - 1.5) * 0.45, y: ground(rk.x, rk.z) + 1.2, z: rk.z - Math.sin(faceIn(rk)) * (k - 1.5) * 0.45, sx: 0.06, sy: 1.6, sz: 0.06, yaw: faceIn(rk), roll: 0.15 });
        for (let i = 0; i < 4; i++) {
          const p = P(r() * Math.PI * 2, 17 + r() * 5);
          rock(Cl, W('rock'), p.x, p.z, 2 + r() * 2, 1.4 + r(), 2 + r() * 2, { variant: i, collide: false });
        }
        break;
      }
      case 'fire': {
        for (const a of [open + 0.45, open - 0.45]) {
          const p = P(a, 14);
          bannerPole(D, p.x, p.z, faceIn(p), W('banner_fire'), { h: 6 });
        }
        // Small watchtower.
        const t = P(open + Math.PI + 1.35, 13);
        const ty = ground(t.x, t.z);
        for (const sx of [-1, 1]) for (const sz of [-1, 1]) D.box('wood_dark', { x: t.x + sx * 1.3, y: ty + 2.5, z: t.z + sz * 1.3, sx: 0.25, sy: 5, sz: 0.25 }, { collide: true, walkable: false });
        M.box('wood', { x: t.x, y: ty + 5, z: t.z, sx: 3.2, sy: 0.3, sz: 3.2 }, { collide: true, surface: 'wood' });
        M.roof('roof_red', { x: t.x, y: ty + 7, z: t.z, w: 3, d: 3, height: 1.3, style: 'pagoda', overhang: 0.6, ridge: null });
        for (const sx of [-1, 1]) for (const sz of [-1, 1]) D.box('wood_dark', { x: t.x + sx * 1.3, y: ty + 6, z: t.z + sz * 1.3, sx: 0.18, sy: 2, sz: 0.18 });
        break;
      }
      case 'pirate': {
        for (let i = 0; i < 2; i++) {
          const p = P(open + (i - 0.5) * 0.7, 13);
          const gy = Math.max(0, ground(p.x, p.z));
          boat(D, p.x, gy + 0.15, p.z, -(open + (i - 0.5) * 0.7) + 0.3, 6.5 + i * 1.5, { mast: i === 1, sail: 'cloth_white', collide: true });
        }
        const b = P(open + Math.PI + 0.9, 13);
        bannerPole(D, b.x, b.z, faceIn(b), W('banner_pirate'), { h: 6.5 });
        for (let i = 0; i < 5; i++) {
          const p = P(open + Math.PI - 0.9 + i * 0.45, 13.5);
          barrel(D, p.x, p.z);
        }
        break;
      }
      case 'dai_li': {
        const hut = P(open + Math.PI, 11);
        const hy = ground(hut.x, hut.z);
        M.block('stone_dark', { x: hut.x, y: hy - 0.3, z: hut.z, sx: 5.5, sy: 3.4, sz: 4.5, yaw: faceIn(hut) }, { collide: true });
        M.roof('roof_green', { x: hut.x, y: hy + 3.1, z: hut.z, w: 5.5, d: 4.5, height: 1.6, yaw: faceIn(hut), style: 'hip', ridge: 'gold' });
        M.box(W('dark'), { x: hut.x + Math.sin(faceIn(hut)) * 2.27, y: hy + 1.1, z: hut.z + Math.cos(faceIn(hut)) * 2.27, sx: 1.2, sy: 2, sz: 0.05, yaw: faceIn(hut) });
        for (let i = 0; i < 6; i++) {
          const p = P(open + Math.PI * 0.5 + i * 0.42, 13);
          const y = ground(p.x, p.z);
          M.block('stone_green', { x: p.x, y: y - 0.3, z: p.z, sx: 0.9, sy: 3.4, sz: 0.9, yaw: faceIn(p) }, { collide: true, walkable: false });
          D.lantern(v3(p.x, y + 3.5, p.z), { color: 'blue' });
        }
        for (const a of [open + 0.5, open - 0.5]) {
          const p = P(a, 12);
          bannerPole(D, p.x, p.z, faceIn(p), W('banner_dai_li'), { h: 5 });
        }
        break;
      }
    }
    if (style !== 'dai_li') lanternPost(D, P(open + 1.2, 9).x, P(open + 1.2, 9).z, style === 'fire' ? 'red' : 'warm');
    // Bedrolls near the tents.
    for (let i = 0; i < 4; i++) {
      const p = P(open + Math.PI + (r() - 0.5) * 2.4, 7 + r() * 1.5);
      const m = new THREE.Matrix4().compose(v3(p.x, ground(p.x, p.z) + 0.08, p.z), new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), r() * 3), v3(1, 1, 1));
      Cl.instance('bedroll', () => new THREE.BoxGeometry(0.9, 0.16, 2), style === 'fire' ? 'cloth_red' : 'cloth_white', m, false);
    }
    this.mark('centre', c.x, ground(c.x, c.z), c.z);
    this.mark('open', Math.cos(open), 0, Math.sin(open));
  }
}
