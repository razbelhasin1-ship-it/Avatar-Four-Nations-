import * as THREE from 'three';
import { Random } from '../../../core/Random';
import { heightAt } from '../../Heightfield';
import { boulder, crystal, crystalCluster, flatDisc, mergeParts, panelWithArches, pillow } from './geometry';
import { wtMat } from './materials';
import type { NwtKit } from './nwtKit';
import { iceSpikes, V } from './parts';

// -----------------------------------------------------------------------------
// Glacier caves (south-west, in the mountains)
// -----------------------------------------------------------------------------

/**
 * A walk-in ice cave on the shelf at (-520,-1340): an irregular vault of
 * glacier ice whose floor ramps up into the slope. Inside: icicles, crystal
 * formations, a frozen pool (ice source) and a small shrine at the back.
 */
export function buildCaves(k: NwtKit): void {
  const cb = k.core;
  const entrance = { x: -520, z: -1360 };
  const back = { x: -522, z: -1326 };
  const dx = back.x - entrance.x, dz = back.z - entrance.z;
  const len = Math.hypot(dx, dz);
  const ux = dx / len, uz = dz / len; // inward
  const nx = -uz, nz = ux; // across
  const yawIn = Math.atan2(ux, uz); // local +Z points inward
  const W = 13; // inner width
  const H = 8; // inner height
  const STEPS = 8;
  const floorAt = (t: number) => {
    // floor follows the terrain maximum across the width (+0.3) so the terrain never pokes through
    const px = entrance.x + ux * len * t, pz = entrance.z + uz * len * t;
    let m = -Infinity;
    for (let s = -W / 2 - 1; s <= W / 2 + 1; s += 1.5) m = Math.max(m, heightAt(px + nx * s, pz + nz * s));
    return m + 0.35;
  };
  const ys: number[] = [];
  for (let i = 0; i <= STEPS; i++) ys.push(floorAt(i / STEPS));
  // Make the floor monotonic (ramps up into the hill) and smooth.
  for (let i = 1; i <= STEPS; i++) ys[i] = Math.max(ys[i], ys[i - 1]);
  const segLen = len / STEPS;
  for (let i = 0; i < STEPS; i++) {
    const t0 = i / STEPS, t1 = (i + 1) / STEPS;
    const cx = entrance.x + ux * len * (t0 + t1) / 2, cz = entrance.z + uz * len * (t0 + t1) / 2;
    const y0 = ys[i], y1 = ys[i + 1];
    const rise = y1 - y0;
    // Ramp collider: local +X must point uphill (inward).
    const yaw = Math.atan2(-uz, ux);
    const bottom = Math.min(y0, y1) - 3;
    cb.collider({ shape: 'box', x: cx, y: (y1 + bottom) / 2, z: cz, hx: segLen / 2 + 0.05, hy: (y1 - bottom) / 2, hz: W / 2 + 0.5, yaw, slopeRise: rise > 0.01 ? rise : 0, walkable: true, solid: true, surface: 'ice' });
    const fl = new THREE.BoxGeometry(segLen + 0.3, 0.5, W + 1.2);
    cb.mesh(wtMat('snow'), fl, { x: cx, y: (y0 + y1) / 2 - 0.25, z: cz, yaw, roll: Math.atan2(rise, segLen) });
    fl.dispose();
    // Walls (solid) and a vaulted ceiling made of tilted slabs.
    for (const s of [-1, 1]) {
      const wx = cx + nx * s * (W / 2 + 1.2), wz = cz + nz * s * (W / 2 + 1.2);
      cb.box(wtMat('ice_massive'), { x: wx, y: (y0 + y1) / 2 + H / 2 - 1, z: wz, sx: segLen + 0.6, sy: H + 2, sz: 2.4, yaw }, { collide: true, walkable: true });
      const sl = new THREE.BoxGeometry(segLen + 0.6, 1.6, W / 2 + 2.6);
      cb.mesh(wtMat('ice_massive'), sl, { x: cx + nx * s * (W / 4 + 0.6), y: (y0 + y1) / 2 + H + 0.9, z: cz + nz * s * (W / 4 + 0.6), yaw, pitch: 0, roll: 0 });
      sl.dispose();
    }
    cb.box(wtMat('ice_clear'), { x: cx, y: (y0 + y1) / 2 + H + 1.9, z: cz, sx: segLen + 0.6, sy: 1.2, sz: W * 0.6, yaw });
    // Snow mound on top so the cave reads as a glacier snout from outside.
    const mound = pillow(segLen + 3, W + 7, 2.2, 1.0, 1);
    cb.mesh(wtMat('snow'), mound, { x: cx, y: (y0 + y1) / 2 + H + 1.6, z: cz, yaw }, { castShadow: false });
    mound.dispose();
    // Icicles from the ceiling.
    for (let j = 0; j < 4; j++) {
      const ox = (j - 1.5) * (W / 4.5);
      const icx = cx + nx * ox, icz = cz + nz * ox;
      k.props.instance('cave_icicle', () => {
        const c = new THREE.ConeGeometry(0.22, 1.6, 6);
        c.rotateX(Math.PI);
        c.translate(0, -0.8, 0);
        return c;
      }, wtMat('ice_clear'), new THREE.Matrix4().compose(V(icx, (y0 + y1) / 2 + H, icz), new THREE.Quaternion(), V(1, 0.6 + ((i * 7 + j * 3) % 5) * 0.25, 1)), false);
    }
  }
  // Back wall.
  const yb = ys[STEPS];
  cb.box(wtMat('ice_massive'), { x: back.x + ux * 1.2, y: yb + H / 2 - 1, z: back.z + uz * 1.2, sx: W + 5, sy: H + 3, sz: 2.4, yaw: Math.atan2(-uz, ux) + Math.PI / 2 }, { collide: true, walkable: true });
  // Entrance arch (facing out).
  const ya = ys[0];
  const arch = panelWithArches(W + 8, H + 4, 2.2, [{ x: 0, y: 0, w: W, h: H + 0.6 }], 10);
  cb.mesh(wtMat('ice_massive'), arch, { x: entrance.x - ux * 0.6, y: ya - 0.6, z: entrance.z - uz * 0.6, yaw: yawIn });
  arch.dispose();
  for (const s of [-1, 1]) {
    cb.collider({ shape: 'box', x: entrance.x - ux * 0.6 + nx * s * (W / 2 + 2), y: ya + H / 2, z: entrance.z - uz * 0.6 + nz * s * (W / 2 + 2), hx: 2, hy: H / 2 + 2, hz: 1.1, yaw: Math.atan2(-uz, ux) + Math.PI / 2, walkable: false, solid: true });
  }
  // Ice formations & glowing crystals.
  const rnd = new Random(88);
  for (let i = 0; i < 9; i++) {
    const t = rnd.range(0.2, 0.95);
    const s = (rnd.chance(0.5) ? -1 : 1) * rnd.range(W / 2 - 2.2, W / 2 - 0.8);
    const px = entrance.x + ux * len * t + nx * s, pz = entrance.z + uz * len * t + nz * s;
    const fy = ys[Math.min(STEPS, Math.round(t * STEPS))];
    const c = crystalCluster(700 + i, rnd.range(1.2, 2.4), 5);
    cb.mesh(wtMat(i % 3 === 0 ? 'lantern_blue' : 'ice_clear'), c, { x: px, y: fy - 0.2, z: pz, yaw: rnd.range(0, 6) });
    c.dispose();
    cb.collider({ shape: 'cylinder', x: px, y: fy + 0.8, z: pz, r: 0.9, hy: 0.9, walkable: false, solid: true });
  }
  // Frozen pool near the back (walkable ice; an ice source).
  const pt = 0.72;
  const pxp = entrance.x + ux * len * pt, pzp = entrance.z + uz * len * pt;
  const py = ys[Math.round(pt * STEPS)] + 0.05;
  const ice = flatDisc(3.2, 28);
  cb.mesh(wtMat('ice_clear'), ice, { x: pxp, y: py + 0.03, z: pzp }, { castShadow: false });
  ice.dispose();
  k.water({ id: 'nwt:cave_ice', type: 'ice', label: 'Frozen Cave Pool', x: pxp, y: py, z: pzp, r: 3.2, capacity: 200, regen: 4, frozen: true, size: 'medium' });
  // Tiny shrine at the back with a spirit light.
  const shx = back.x - ux * 2.5, shz = back.z - uz * 2.5;
  cb.cylinder(wtMat('ice_trim'), { x: shx, y: yb, z: shz, r: 0.6, rTop: 0.45, h: 1.2, segments: 8 }, { collide: true, walkable: true });
  const orb = new THREE.SphereGeometry(0.35, 12, 8);
  k.props.mesh(wtMat('spirit'), orb, { x: shx, y: yb + 1.6, z: shz }, { castShadow: false });
  orb.dispose();
  k.emitter('spirit', 1, V(shx, yb + 1.5, shz), { radius: 2 }, 40, true);
  k.emitter('snow', 1.5, V(entrance.x - ux * 3, ya + H, entrance.z - uz * 3), { radius: 5 }, 60, true);
  // Cairns marking the way up from the western shore below the city cliffs.
  const trail: Array<[number, number]> = [[-482, -1610], [-486, -1560], [-492, -1512], [-500, -1470], [-512, -1440], [-528, -1415], [-536, -1392], [-530, -1372]];
  for (const [tx, tz] of trail) {
    k.props.instance('cave_cairn', () => {
      const a = new THREE.DodecahedronGeometry(0.55, 0);
      a.translate(0, 0.35, 0);
      const b2 = new THREE.DodecahedronGeometry(0.38, 0);
      b2.translate(0.05, 0.95, 0);
      const c = new THREE.DodecahedronGeometry(0.24, 0);
      c.translate(0, 1.4, 0);
      return mergeParts([a, b2, c]);
    }, wtMat('ice_wall'), new THREE.Matrix4().makeTranslation(tx, heightAt(tx, tz) - 0.1, tz));
  }
  iceSpikes(k.props, entrance.x + nx * (W / 2 + 4), heightAt(entrance.x + nx * (W / 2 + 4), entrance.z), entrance.z + nz * (W / 2 + 4), 4, 61);
  iceSpikes(k.props, entrance.x - nx * (W / 2 + 4), heightAt(entrance.x - nx * (W / 2 + 4), entrance.z), entrance.z - nz * (W / 2 + 4), 3.5, 62);

  // Snow-buried entrance: a drift over the arch and ice boulders flanking it.
  {
    const ya2 = ys[0];
    const top = boulder(1300, W / 2 + 5, 2.6, 3.2, 1);
    cb.mesh(wtMat('snow'), top, { x: entrance.x - ux * 0.6, y: ya2 + H + 3.2, z: entrance.z - uz * 0.6, yaw: yawIn });
    top.dispose();
    for (const s of [-1, 1]) {
      const bx = entrance.x - ux * 1.2 + nx * s * (W / 2 + 4.5), bz = entrance.z - uz * 1.2 + nz * s * (W / 2 + 4.5);
      const b = boulder(1310 + (s > 0 ? 1 : 0), 3.2, 4.5, 3.0, 1);
      cb.mesh(wtMat('ice_massive'), b, { x: bx, y: ya2 + 1.2, z: bz, yaw: yawIn + s * 0.4 });
      b.dispose();
      cb.collider({ shape: 'cylinder', x: bx, y: ya2 + 2.5, z: bz, r: 2.7, hy: 3.2, walkable: false, solid: true });
    }
  }

  // Glacier cover: lumpy snow / ice mounds over and beside the tunnel so it reads
  // as a glacier snout from outside (kept outside the walls and the vault), plus
  // a walkable roof collider so nobody can drop through the vault from the slope.
  for (let i = 0; i < STEPS; i++) {
    const t = (i + 0.5) / STEPS;
    const px = entrance.x + ux * len * t, pz = entrance.z + uz * len * t;
    const fy = (ys[i] + ys[i + 1]) / 2;
    cb.collider({ shape: 'box', x: px, y: fy + H + 0.9, z: pz, hx: segLen / 2 + 0.3, hy: 0.8, hz: W / 2 + 2.5, yaw: Math.atan2(-uz, ux), walkable: true, solid: true, surface: 'snow' });
    if (i % 2 === 1) continue;
    const top = boulder(1200 + i, W / 2 + 6, 4.5, segLen * 1.7, 1);
    cb.mesh(wtMat('snow'), top, { x: px + ux * segLen * 0.5, y: fy + H + 4.6, z: pz + uz * segLen * 0.5, yaw: yawIn }, { castShadow: true });
    top.dispose();
    for (const s of [-1, 1]) {
      const side = boulder(1250 + i * 2 + (s > 0 ? 1 : 0), 4, H / 2 + 2.5, segLen * 1.4, 1);
      const off = W / 2 + 4.2;
      cb.mesh(wtMat(i % 4 === 0 ? 'ice_massive' : 'snow'), side, { x: px + ux * segLen * 0.5 + nx * s * off, y: fy + H / 2 - 0.5, z: pz + uz * segLen * 0.5 + nz * s * off, yaw: yawIn });
      side.dispose();
    }
  }

  // Organic ice breaking up the straight walls: boulders hugging the walls
  // (floor-level ones are solid), glowing veins high up, stalagmites and long
  // icicle curtains near the walls.
  const r2 = new Random(311);
  for (let i = 0; i < STEPS; i++) {
    const fy = (ys[i] + ys[i + 1]) / 2;
    for (const s of [-1, 1]) {
      for (let j = 0; j < 3; j++) {
        const t = (i + (j + 0.5) / 3) / STEPS;
        const off = W / 2 + r2.range(0.1, 0.8);
        const bx = entrance.x + ux * len * t + nx * s * off, bz = entrance.z + uz * len * t + nz * s * off;
        const sz = r2.range(1.3, 2.3);
        const low = j !== 1;
        const by = low ? fy + r2.range(-0.4, 0.3) : fy + r2.range(3.2, 5.8);
        const b = boulder(900 + i * 11 + j * 3 + (s > 0 ? 1 : 0), sz, sz * r2.range(0.8, 1.4), sz * 0.85, 1);
        cb.mesh(wtMat(r2.chance(0.35) ? 'ice_trim' : 'ice_massive'), b, { x: bx, y: by, z: bz, yaw: r2.range(0, 6) });
        b.dispose();
        if (low) cb.collider({ shape: 'cylinder', x: bx, y: by + sz * 0.5, z: bz, r: sz * 0.75, hy: sz * 0.9, walkable: false, solid: true });
        else if (r2.chance(0.6)) {
          const c = crystalCluster(950 + i * 5 + j + (s > 0 ? 2 : 0), r2.range(0.7, 1.2), 4);
          k.props.mesh(wtMat('lantern_blue'), c, { x: bx - nx * s * sz * 0.7, y: by - 0.4, z: bz - nz * s * sz * 0.7, yaw: r2.range(0, 6), roll: s * 0.9 }, { castShadow: false });
          c.dispose();
        }
      }
      // Stalagmites and an icicle curtain along this wall.
      const t = (i + 0.5) / STEPS;
      const off = W / 2 - 1.2;
      const gx = entrance.x + ux * len * t + nx * s * off, gz = entrance.z + uz * len * t + nz * s * off;
      for (let q = 0; q < 3; q++) {
        const h = r2.range(0.8, 2.2);
        k.props.instance('cave_stalagmite', () => crystal(0.32, 1, 0.5), wtMat('ice_clear'),
          new THREE.Matrix4().compose(V(gx + ux * (q - 1) * 1.3, fy - 0.1, gz + uz * (q - 1) * 1.3), new THREE.Quaternion().setFromEuler(new THREE.Euler(0, r2.range(0, 6), 0)), V(1, h, 1)));
      }
      cb.collider({ shape: 'box', x: gx, y: fy + 1, z: gz, hx: 1.9, hy: 1.1, hz: 0.45, yaw: Math.atan2(-uz, ux), walkable: false, solid: true });
      for (let q = 0; q < 5; q++) {
        const cx2 = gx + ux * (q - 2) * 0.9 + nx * s * 0.6, cz2 = gz + uz * (q - 2) * 0.9 + nz * s * 0.6;
        k.props.instance('cave_icicle', () => {
          const c = new THREE.ConeGeometry(0.22, 1.6, 6);
          c.rotateX(Math.PI);
          c.translate(0, -0.8, 0);
          return c;
        }, wtMat('ice_clear'), new THREE.Matrix4().compose(V(cx2, fy + H + 0.2, cz2), new THREE.Quaternion(), V(1.2, r2.range(1.2, 2.6), 1.2)), false);
      }
    }
  }
}
