import * as THREE from 'three';
import type { GameContext } from '../../../core/GameContext';
import { pagoda } from '../../kit/Builder';
import { OMASHU } from './layout';
import { W, bannerPole, barrel, crate, drape, ekHouse, lanternPost, rampCollider, rng, rock, v3, yawAlong, yawFacing } from './parts';
import { WildsSite } from './WildsSite';

/**
 * Omashu — a vertical Earth Kingdom city on the mesa (plateau y = 95): a ring
 * wall with a great gate at the top of the omashu_ramp trail, three stacked
 * stone terraces with grand stairs, green-roofed houses, towers and spires,
 * the king's palace with its spire on the top terrace, two delivery chute
 * towers with spiralling stone chutes fed from the palace terrace, King
 * Bumo's boulder arena (training_bumo), market stalls and a fountain.
 */
export class OmashuSite extends WildsSite {
  readonly id = 'wilds_omashu';
  readonly center = { x: OMASHU.C.x, z: OMASHU.C.z };
  override readonly loadRadius = 420;

  protected construct(_ctx: GameContext): void {
    const O = OMASHU;
    const M = this.major, D = this.detail, Cl = this.clutter;
    const Y = O.Y;
    const tg = O.thetaG;
    const P = O.P;
    const r = rng(4501);
    const angDiff = (a: number, b: number) => Math.abs(Math.atan2(Math.sin(a - b), Math.cos(a - b)));

    // --- Terraces --------------------------------------------------------------------------
    let base = Y - 1;
    O.terraces.forEach((t, k) => {
      M.cylinder('stone_tan', { x: O.C.x, y: base, z: O.C.z, r: t.r, h: t.top - base, segments: 40 }, { collide: true, surface: 'stone' });
      M.cylinder('paving', { x: O.C.x, y: t.top - 0.02, z: O.C.z, r: t.r - 0.15, h: 0.06, segments: 40 });
      M.cylinder('stone_grey', { x: O.C.x, y: base, z: O.C.z, r: t.r + 0.5, h: 1.6 + 0.5, segments: 40 });
      M.cylinder('stone_light', { x: O.C.x, y: t.top - 0.7, z: O.C.z, r: t.r + 0.35, h: 0.45, segments: 40 });
      // Grand stairs on the gate axis and the opposite axis.
      const lower = k === 0 ? Y : O.terraces[k - 1].top;
      for (const th of [tg, tg + Math.PI]) {
        const run = O.stairsRun[k];
        // The flight reaches full height right at the terrace edge (+0.25 m) so the player steps onto the top.
        const from = P(th, t.r + 0.25 + run), to = P(th, t.r + 0.25);
        M.stairs({ from: v3(from.x, lower, from.z), to: v3(to.x, t.top, to.z), width: 7, material: 'stone_light' });
        // Stair cheek walls (decorative).
        const yaw = yawAlong(from.x, from.z, to.x, to.z);
        const len = Math.hypot(to.x - from.x, to.z - from.z);
        const pitch = Math.atan2(t.top - lower, len);
        for (const s of [-1, 1]) {
          const nx = -Math.sin(th) * s * 3.9, nz = Math.cos(th) * s * 3.9;
          M.box('stone_tan', { x: (from.x + to.x) / 2 + nx, y: (lower + t.top) / 2 + 0.3, z: (from.z + to.z) / 2 + nz, sx: Math.hypot(len, t.top - lower), sy: 1.1, sz: 0.8, yaw, roll: pitch });
          lanternPost(D, from.x + nx * 1.15, from.z + nz * 1.15, 'warm', lower);
        }
      }
      if (k === 0) this.mark('terrace1', O.C.x, t.top, O.C.z);
      base = t.top - 0.1;
    });

    // --- City wall and wall towers ----------------------------------------------------------
    const seg = 28;
    const wallPts: Array<{ x: number; z: number }> = [];
    const gap = 0.09;
    for (let i = 0; i <= seg; i++) {
      const th = tg + gap + ((Math.PI * 2 - 2 * gap) * i) / seg;
      wallPts.push(P(th, O.wallR));
    }
    const wallBase = (x: number, z: number) => Math.min(Y, this.ctx.world.heightAt(x, z));
    M.wall(wallPts, { baseY: wallBase, height: 11, thickness: 3.2, material: 'stone_tan', crenel: null, plinth: 'stone_grey', walkable: true });
    // Merlons (instanced: hundreds of them) along both faces of the walkway.
    {
      const m = new THREE.Matrix4();
      const q = new THREE.Quaternion();
      for (let i = 0; i < wallPts.length - 1; i++) {
        const a = wallPts[i], b = wallPts[i + 1];
        const len = Math.hypot(b.x - a.x, b.z - a.z);
        const yaw = yawAlong(a.x, a.z, b.x, b.z);
        const by = Math.min(wallBase(a.x, a.z), wallBase(b.x, b.z), wallBase((a.x + b.x) / 2, (a.z + b.z) / 2));
        const count = Math.floor(len / 2.2);
        const cxv = Math.cos(yaw), czv = -Math.sin(yaw);
        q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), yaw);
        for (let k = 0; k < count; k++) {
          const along = -len / 2 + (k + 0.5) * (len / count);
          for (const side of [-1, 1]) {
            const ox = -czv * side * 1.35, oz = cxv * side * 1.35;
            m.compose(v3((a.x + b.x) / 2 + cxv * along + ox, by + 11.45, (a.z + b.z) / 2 + czv * along + oz), q, v3(1, 1, 1));
            M.instance('omashu_merlon', () => new THREE.BoxGeometry(1.1, 0.9, 0.5), 'stone_tan', m);
          }
        }
      }
    }
    for (let i = 3; i < seg - 1; i += 4) {
      const p = wallPts[i];
      const th = Math.atan2(p.z - O.C.z, p.x - O.C.x);
      const yaw = yawFacing(Math.cos(th), Math.sin(th));
      M.block('stone_tan', { x: p.x, y: Y - 1, z: p.z, sx: 7, sy: 18, sz: 7, yaw }, { collide: true });
      M.block('stone_grey', { x: p.x, y: Y - 1, z: p.z, sx: 7.6, sy: 2.6, sz: 7.6, yaw });
      M.roof('roof_green', { x: p.x, y: Y + 17, z: p.z, w: 7, d: 7, height: 3.2, yaw, style: 'pagoda', overhang: 1.2, ridge: 'gold' });
    }

    // --- Great gate ----------------------------------------------------------------------------
    {
      const gy = yawFacing(Math.cos(tg), Math.sin(tg)); // front faces outward (down the ramp)
      for (const s of [-1, 1]) {
        const p = P(tg + s * 0.118, O.wallR);
        M.block('stone_tan', { x: p.x, y: Y - 2, z: p.z, sx: 9, sy: 23, sz: 9, yaw: gy }, { collide: true });
        M.block('stone_grey', { x: p.x, y: Y - 2, z: p.z, sx: 9.8, sy: 3.4, sz: 9.8, yaw: gy });
        pagoda(M, { x: p.x, y: Y + 21, z: p.z, size: 8.5, tiers: 2, yaw: gy, wall: 'stone_light', roof: 'roof_green', finial: 'gold' });
        const out = P(tg + s * 0.118, O.wallR + 4.6);
        bannerPole(D, out.x, out.z, gy, W('banner_earth'), { h: 9, y: Y + 1.5 });
      }
      const g = P(tg, O.wallR);
      // Lintel block spanning the gate (above head height), roof on top.
      M.box('stone_tan', { x: g.x, y: Y + 13.5, z: g.z, sx: 18, sy: 7, sz: 9, yaw: gy }, { collide: true });
      M.roof('roof_green', { x: g.x, y: Y + 17, z: g.z, w: 18, d: 7, height: 3, yaw: gy, style: 'hip', overhang: 1, ridge: 'gold' });
      const face = P(tg, O.wallR + 4.55);
      M.box(W('banner_earth'), { x: face.x, y: Y + 13.2, z: face.z, sx: 3.4, sy: 6, sz: 0.06, yaw: gy }, { castShadow: false });
      // Open gate leaves against the passage walls.
      for (const s of [-1, 1]) {
        const leaf = P(tg + s * 0.058, O.wallR - 3.2);
        M.box('wood_dark', { x: leaf.x, y: Y + 4.5, z: leaf.z, sx: 0.5, sy: 9, sz: 5, yaw: gy }, { collide: true, walkable: false });
      }
      this.mark('gate', g.x, Y, g.z);
      // Approach apron lanterns.
      for (const s of [-1, 1]) for (const rr of [80, 86]) {
        const p = P(tg + s * 0.075, rr);
        lanternPost(D, p.x, p.z, 'warm');
      }
    }

    // --- Main avenue paving, plaza, fountain, stalls --------------------------------------------
    {
      const a = P(tg, 74), c = P(tg, 44);
      drape(D, 'paving', (a.x + c.x) / 2, (a.z + c.z) / 2, 30, 8, { yaw: yawAlong(c.x, c.z, a.x, a.z), lift: 0.05, tile: 4 });
      for (let rr = 46; rr <= 72; rr += 6.5) for (const s of [-1, 1]) {
        const p = P(tg + (s * 5.2) / rr, rr);
        lanternPost(D, p.x, p.z, rr % 13 < 6.5 ? 'red' : 'warm');
      }
      // Fountain (registered water source).
      const f = P(tg + 0.27, 66);
      M.cylinder('stone_light', { x: f.x, y: Y - 0.2, z: f.z, r: 3.1, h: 0.95, segments: 24 }, { collide: true });
      M.cylinder('stone_grey', { x: f.x, y: Y + 0.7, z: f.z, r: 0.5, h: 1.7, segments: 10 });
      M.cylinder('stone_light', { x: f.x, y: Y + 2.3, z: f.z, r: 1.1, rTop: 0.6, h: 0.35, segments: 14 });
      this.waterSurface({ id: 'wilds:omashu_fountain', label: 'Omashu Fountain', x: f.x, z: f.z, y: Y + 0.78, w: 5.4, d: 5.4, circle: true, type: 'fountain', capacity: 90, regen: 2 });
      this.mark('fountain', f.x, Y + 0.78, f.z);
      // Market stalls: counter between the merchant and the avenue, awning over both.
      for (const [id, th, rr] of [['m1', tg + 0.135, 60], ['m2', tg - 0.135, 64]] as const) {
        const p = P(th, rr);
        const toAv = P(tg, rr);
        const dx = toAv.x - p.x, dz = toAv.z - p.z, dl = Math.hypot(dx, dz);
        const ux = dx / dl, uz = dz / dl;
        const yaw = yawFacing(ux, uz);
        const cx = p.x + ux * 1.3, cz = p.z + uz * 1.3;
        D.block('wood', { x: cx, y: Y, z: cz, sx: 3.4, sy: 1.05, sz: 0.9, yaw }, { collide: true, surface: 'wood' });
        for (let k = 0; k < 6; k++) {
          const m = new THREE.Matrix4().compose(v3(cx + Math.cos(yaw) * (k - 2.5) * 0.5, Y + 1.25, cz - Math.sin(yaw) * (k - 2.5) * 0.5), new THREE.Quaternion(), v3(1, 0.9, 1));
          D.instance(id === 'm1' ? 'cabbage' : 'stoneware', () => new THREE.IcosahedronGeometry(0.24, 1), id === 'm1' ? 'jade' : 'stone_grey', m);
        }
        for (const s of [-1, 1]) for (const f2 of [-0.4, 1.8]) {
          D.box('wood_dark', { x: p.x + Math.cos(yaw) * s * 1.7 + ux * f2, y: Y + 1.3, z: p.z - Math.sin(yaw) * s * 1.7 + uz * f2, sx: 0.12, sy: 2.6, sz: 0.12, yaw });
        }
        D.box('cloth_green', { x: p.x + ux * 0.7, y: Y + 2.65, z: p.z + uz * 0.7, sx: 4, sy: 0.06, sz: 3, yaw, pitch: 0.18 }, { castShadow: false });
        crate(D, p.x - ux * 1.2 + Math.cos(yaw) * 2.3, p.z - uz * 1.2 - Math.sin(yaw) * 2.3, 0.8, yaw, Y);
      }
      // Cabbage cart near the gate.
      const cart = P(tg - 0.2, 70);
      const cy = yawFacing(Math.cos(tg + Math.PI / 2), Math.sin(tg + Math.PI / 2));
      D.block('wood', { x: cart.x, y: Y + 0.7, z: cart.z, sx: 1.8, sy: 0.7, sz: 2.6, yaw: cy }, { collide: true, surface: 'wood' });
      for (const s of [-1, 1]) {
        const g = new THREE.CylinderGeometry(0.6, 0.6, 0.12, 12);
        g.rotateZ(Math.PI / 2);
        D.mesh('wood_dark', g, { x: cart.x + Math.cos(cy) * s * 1.0, y: Y + 0.6, z: cart.z - Math.sin(cy) * s * 1.0, yaw: cy });
        g.dispose();
      }
      for (let k = 0; k < 9; k++) {
        const m = new THREE.Matrix4().compose(v3(cart.x + (r() - 0.5) * 1.2, Y + 1.55 + r() * 0.25, cart.z + (r() - 0.5) * 1.8), new THREE.Quaternion(), v3(1.2, 1, 1.2));
        D.instance('cabbage', () => new THREE.IcosahedronGeometry(0.24, 1), 'jade', m);
      }
    }

    // --- Arena (Bumo) ------------------------------------------------------------------------
    {
      const A = O.arena;
      M.cylinder('paving_dark', { x: A.x, y: Y - 0.5, z: A.z, r: A.rim + 0.6, h: A.y - Y + 0.5, segments: 40 }, { collide: true, surface: 'stone' });
      M.cylinder('stone_grey', { x: A.x, y: A.y - 0.02, z: A.z, r: A.r + 0.2, h: 0.04, segments: 40 });
      // Boulder ring outside the open floor, with gaps toward the city centre and along the ring street.
      const toC = Math.atan2(O.C.z - A.z, O.C.x - A.x);
      for (let i = 0; i < 12; i++) {
        const a = toC + Math.PI / 12 + (i / 12) * Math.PI * 2;
        if (angDiff(a, toC) < 0.3 || angDiff(a, toC + Math.PI) < 0.3 || angDiff(a, toC + Math.PI / 2) < 0.25) continue;
        const s = 2.2 + r() * 1.3;
        rock(M, W('rock'), A.x + Math.cos(a) * (A.rim + 0.4), A.z + Math.sin(a) * (A.rim + 0.4), s * 1.1, s, s, { y: A.y - 0.2, yaw: r() * 6, variant: i });
      }
      // Loose training boulders and earth discs just outside the floor (benders throw these).
      for (let i = 0; i < 5; i++) {
        const a = toC + Math.PI * 0.75 + i * 0.22;
        rock(D, W('rock'), A.x + Math.cos(a) * (A.rim + 3.4), A.z + Math.sin(a) * (A.rim + 3.4), 1.2, 1.1, 1.2, { y: Y, variant: i + 2 });
      }
      // King's seat behind the master (outside the open radius).
      const seat = { x: A.x + Math.cos(toC) * (A.rim + 1.6), z: A.z + Math.sin(toC) * (A.rim + 1.6) };
      const sy = yawFacing(-Math.cos(toC), -Math.sin(toC));
      M.block('stone_light', { x: seat.x, y: A.y, z: seat.z, sx: 3.2, sy: 0.9, sz: 1.6, yaw: sy }, { collide: true });
      M.block('stone_light', { x: seat.x + Math.cos(toC) * 0.7, y: A.y, z: seat.z + Math.sin(toC) * 0.7, sx: 3.2, sy: 2.6, sz: 0.5, yaw: sy }, { collide: true });
      for (const s of [-1, 1]) {
        const b = { x: A.x + Math.cos(toC + s * 0.5) * (A.rim + 2.4), z: A.z + Math.sin(toC + s * 0.5) * (A.rim + 2.4) };
        bannerPole(D, b.x, b.z, sy, W('banner_earth'), { h: 6, y: Y });
      }
      this.mark('arena', A.x, A.y, A.z);
    }

    // --- Houses ----------------------------------------------------------------------------------
    const busy = (th: number, rr: number, half: number) => {
      const hw = half / rr;
      if (angDiff(th, tg) < 0.11 + hw) return true;
      if (angDiff(th, tg + Math.PI) < 0.09 + hw) return true;
      if (angDiff(th, O.arena.theta) < 0.31 + hw && rr > 40) return true;
      for (const c of O.chutes) if (angDiff(th, c) < 0.15 + hw) return true;
      if (rr > 40 && angDiff(th, tg + 0.27) < 0.07 + hw && rr < 70) return true; // fountain
      if (rr < 40 && angDiff(th, tg + Math.PI / 2) < 0.12 + hw) return true; // terrace shrine
      return false;
    };
    let houses = 0;
    const ring = (rr: number, step: number, y: number, floorsMax: number, w0: number) => {
      const n = Math.floor((Math.PI * 2 * rr) / step);
      for (let i = 0; i < n; i++) {
        const th = tg + ((i + 0.5) / n) * Math.PI * 2;
        const w = w0 + r() * 2.5, d = 5.5 + r() * 1.5;
        if (busy(th, rr, w / 2 + 1)) continue;
        const p = P(th, rr);
        const yaw = yawFacing(O.C.x - p.x, O.C.z - p.z);
        const floors = 1 + Math.floor(r() * floorsMax);
        const wall = r() < 0.5 ? 'plaster_cream' : r() < 0.6 ? 'plaster_tan' : 'plaster_green';
        ekHouse(M, p.x, p.z, yaw, { w, d, floors, y, wall, roof: 'roof_green', base: r() < 0.5 ? 'stone_grey' : 'stone_tan' });
        houses++;
      }
    };
    ring(50, 13.5, Y, 3, 7);
    ring(67.5, 12.5, Y, 2, 7.5);
    ring(34.5, 12, O.terraces[0].top, 2, 6);
    this.mark('houses', houses, 0, 0);

    // --- Towers and spires ------------------------------------------------------------------------
    for (const [th, rr, size, tiers] of [[tg + 0.62, 58, 6, 4], [tg - 0.65, 58.5, 6.5, 4], [tg + 2.75, 58, 6, 5], [tg - 2.35, 59, 5.5, 4], [tg + 3.6, 57, 5.5, 3]] as const) {
      if (busy(th, rr, size / 2 + 0.5)) continue;
      const p = P(th, rr);
      const yaw = yawFacing(O.C.x - p.x, O.C.z - p.z);
      M.block('stone_grey', { x: p.x, y: Y - 0.5, z: p.z, sx: size + 1, sy: 1.6, sz: size + 1, yaw }, { collide: true });
      pagoda(M, { x: p.x, y: Y + 1, z: p.z, size, tiers, yaw, wall: 'stone_tan', roof: 'roof_green', finial: 'gold' });
      M.collider({ shape: 'box', x: p.x, y: Y + 8, z: p.z, hx: size / 2, hy: 8, hz: size / 2, yaw, walkable: false, solid: true });
    }
    const spire = (x: number, z: number, y: number, rad: number, h: number) => {
      M.cylinder('stone_light', { x, y, z, r: rad, rTop: rad * 0.8, h, segments: 10 }, { collide: true, walkable: false });
      M.cylinder('roof_green', { x, y: y + h, z, r: rad * 1.6, rTop: 0.05, h: rad * 3.2, segments: 10 });
      M.cylinder('gold', { x, y: y + h + rad * 3.1, z, r: 0.12, rTop: 0.02, h: 2.2, segments: 6 });
      for (let k = 1; k <= 3; k++) M.cylinder('stone_tan', { x, y: y + (h * k) / 4, z, r: rad * 1.12, h: 0.35, segments: 10 });
    };
    for (const k of [0.25, 0.75, 1.25, 1.75]) {
      const p = P(tg + Math.PI * k, 21);
      spire(p.x, p.z, O.terraces[1].top, 1.5, 15);
    }

    // --- Palace on the top terrace (back half; the landmark centre stays an open courtyard) ---------
    {
      const top = O.terraces[2].top;
      const back = 9.5; // palace centre behind the terrace centre, away from the gate
      const p = P(tg + Math.PI, back);
      const yaw = yawFacing(Math.cos(tg), Math.sin(tg));
      const w = 11, d = 6.5;
      M.block('stone_light', { x: p.x, y: top - 0.05, z: p.z, sx: w + 1.5, sy: 0.9, sz: d + 1, yaw }, { collide: true });
      M.building({ x: p.x, y: top + 0.85, z: p.z, w, d, h: 9, yaw, wall: 'plaster_green', roof: 'roof_green', trim: 'wood_red', roofStyle: 'pagoda', floors: 2, plinth: null, roofHeight: 3.6 });
      // Steps up onto the palace plinth (full height at the plinth's front edge).
      const edge = back - (d + 1) / 2;
      const fr = P(tg + Math.PI, edge - 2.25), fr2 = P(tg + Math.PI, edge - 0.25);
      M.stairs({ from: v3(fr.x, top, fr.z), to: v3(fr2.x, top + 0.85, fr2.z), width: 5, material: 'stone_light' });
      // Palace spire and corner spires.
      spire(p.x, p.z, top + 12.5, 2, 16);
      for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
        const cx = p.x + Math.cos(yaw) * sx * (w / 2 + 0.4) + Math.sin(yaw) * sz * (d / 2 + 0.4);
        const cz = p.z - Math.sin(yaw) * sx * (w / 2 + 0.4) + Math.cos(yaw) * sz * (d / 2 + 0.4);
        spire(cx, cz, top + 0.85, 0.6, 8);
      }
      const door = P(tg + Math.PI, back - d / 2 - 0.06);
      M.box(W('banner_earth'), { x: door.x, y: top + 6.6, z: door.z, sx: 2.2, sy: 3.4, sz: 0.06, yaw }, { castShadow: false });
      // Courtyard: a ring of planters and lanterns around the open centre.
      for (const da of [-1.4, -0.9, -0.45, 0.45, 0.9, 1.4]) {
        const q = P(tg + da, 11.5);
        D.cylinder('stone_grey', { x: q.x, y: top, z: q.z, r: 0.6, h: 0.55, segments: 10 }, { collide: true });
        D.lantern(v3(q.x, top + 1.1, q.z), { color: 'warm' });
      }
      this.mark('palace', p.x, top, p.z);
    }

    // --- Delivery chutes ---------------------------------------------------------------------------
    const chuteSeg = (a: THREE.Vector3, c: THREE.Vector3) => {
      const len = Math.hypot(c.x - a.x, c.z - a.z);
      const yaw = yawAlong(a.x, a.z, c.x, c.z);
      const pitch = Math.atan2(c.y - a.y, len);
      const L = Math.hypot(len, c.y - a.y) + 0.06;
      const mx = (a.x + c.x) / 2, my = (a.y + c.y) / 2, mz = (a.z + c.z) / 2;
      M.box('stone_light', { x: mx, y: my - 0.15, z: mz, sx: L, sy: 0.3, sz: 1.9, yaw, roll: pitch });
      for (const s of [-1, 1]) {
        D.box('stone_tan', { x: mx - Math.sin(yaw) * s * 0.88, y: my + 0.18, z: mz - Math.cos(yaw) * s * 0.88, sx: L, sy: 0.55, sz: 0.18, yaw, roll: pitch });
      }
      rampCollider(M, a, c, 1.7, 'stone', 0.4);
    };
    for (const th of O.chutes) {
      const t = P(th, 56);
      const yaw = yawFacing(O.C.x - t.x, O.C.z - t.z);
      const topY = Y + 17;
      M.block('stone_grey', { x: t.x, y: Y - 0.5, z: t.z, sx: 6, sy: topY - Y + 0.5, sz: 6, yaw }, { collide: true });
      M.block('stone_tan', { x: t.x, y: topY, z: t.z, sx: 6.8, sy: 1.2, sz: 6.8, yaw }, { collide: true });
      M.roof('roof_green', { x: t.x, y: topY + 4.2, z: t.z, w: 4.5, d: 4.5, height: 2.4, yaw, style: 'pagoda', overhang: 0.9, ridge: 'gold' });
      for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
        M.box('wood_red', { x: t.x + Math.cos(yaw) * sx * 2.6 + Math.sin(yaw) * sz * 2.6, y: topY + 2.6, z: t.z - Math.sin(yaw) * sx * 2.6 + Math.cos(yaw) * sz * 2.6, sx: 0.3, sy: 3, sz: 0.3, yaw }, { collide: true, walkable: false });
      }
      // Long chute from the palace terrace down to the tower top.
      const s0 = P(th, 14.6), s1 = P(th, 52.6);
      const a = v3(s0.x, O.terraces[2].top - 0.35, s0.z), c = v3(s1.x, topY + 1.25, s1.z);
      const n = 6;
      for (let i = 0; i < n; i++) {
        const p0 = a.clone().lerp(c, i / n), p1 = a.clone().lerp(c, (i + 1) / n);
        chuteSeg(p0, p1);
      }
      for (const rr of [21, 34.5, 47]) {
        const q = P(th, rr);
        const lvl = rr < 27 ? O.terraces[1].top : rr < 42 ? O.terraces[0].top : Y;
        const ty = a.y + ((c.y - a.y) * (rr - 14.6)) / (52.6 - 14.6) - 0.3;
        M.box('stone_tan', { x: q.x, y: (lvl + ty) / 2, z: q.z, sx: 1.2, sy: ty - lvl, sz: 1.2, yaw: -th }, { collide: true, walkable: false });
      }
      // Spiral down around the tower: 1.6 turns from the top to just above the street.
      const turns = 1.6, steps = 30, R = 5.6;
      const start = Math.atan2(O.C.z - t.z, O.C.x - t.x);
      let prev: THREE.Vector3 | null = null;
      for (let i = 0; i <= steps; i++) {
        const f = i / steps;
        const ang = start + f * turns * Math.PI * 2;
        const pt = v3(t.x + Math.cos(ang) * R, topY - 0.3 - f * (topY - 0.3 - (Y + 1.9)), t.z + Math.sin(ang) * R);
        if (prev) chuteSeg(prev, pt);
        if (i % 5 === 2) M.cylinder('stone_tan', { x: pt.x, y: Y, z: pt.z, r: 0.35, h: pt.y - Y - 0.3, segments: 8 }, { collide: true, walkable: false });
        prev = pt;
      }
      // Delivery bins at the bottom.
      const end = prev!;
      crate(D, end.x + Math.cos(start) * 1.6, end.z + Math.sin(start) * 1.6, 1, 0.3, Y);
      barrel(D, end.x + Math.cos(start + 0.6) * 2.2, end.z + Math.sin(start + 0.6) * 2.2, Y);
      this.mark(`chute_${th.toFixed(2)}`, t.x, topY, t.z);
    }

    // --- Shrine on terrace 1 --------------------------------------------------------------------
    {
      const th = tg + Math.PI / 2;
      const p = P(th, 37.5);
      const y = O.terraces[0].top;
      const yaw = yawFacing(O.C.x - p.x, O.C.z - p.z);
      M.block('stone_light', { x: p.x, y, z: p.z, sx: 3, sy: 1.2, sz: 2, yaw }, { collide: true });
      M.roof('roof_green', { x: p.x, y: y + 3.4, z: p.z, w: 3.4, d: 2.6, height: 1.2, yaw, style: 'hip', ridge: 'gold' });
      for (const s of [-1, 1]) for (const f of [-1, 1]) M.box('wood_red', { x: p.x + Math.cos(yaw) * s * 1.6 + Math.sin(yaw) * f * 1.1, y: y + 1.7, z: p.z - Math.sin(yaw) * s * 1.6 + Math.cos(yaw) * f * 1.1, sx: 0.2, sy: 3.4, sz: 0.2, yaw });
      D.cylinder('jade', { x: p.x, y: y + 1.2, z: p.z, r: 0.45, rTop: 0.2, h: 1.1, segments: 8 });
      D.lantern(v3(p.x + Math.sin(yaw) * 2.2, y + 0.9, p.z + Math.cos(yaw) * 2.2), { color: 'red' });
    }

    // --- Clutter: crates, barrels, planters along the streets ---------------------------------------
    for (let i = 0; i < 26; i++) {
      const th = tg + r() * Math.PI * 2, rr = 57 + r() * 3;
      if (busy(th, rr, 2)) continue;
      const p = P(th, rr);
      if (r() < 0.5) crate(D, p.x, p.z, 0.7 + r() * 0.4, r() * 3, Y);
      else barrel(D, p.x, p.z, Y);
    }
    for (let i = 0; i < 18; i++) {
      const th = tg + r() * Math.PI * 2;
      const rr = 43.5;
      if (busy(th, rr, 1.5)) continue;
      const p = P(th, rr);
      Cl.cylinder('stone_grey', { x: p.x, y: Y, z: p.z, r: 0.7, h: 0.6, segments: 10 });
      const m = new THREE.Matrix4().compose(v3(p.x, Y + 1.1, p.z), new THREE.Quaternion(), v3(1, 0.9, 1));
      Cl.instance('planter_bush', () => new THREE.IcosahedronGeometry(0.75, 1), W('foliage'), m);
    }
  }
}
