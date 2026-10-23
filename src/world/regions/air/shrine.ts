import * as THREE from 'three';
import type { GameContext } from '../../../core/GameContext';
import { heightAt } from '../../Heightfield';
import { AirRegion } from './AirRegion';
import * as G from './geom';
import * as P from './parts';
import { am } from './parts';
import { WIND_SHRINE } from './layout';

/**
 * The Shrine of the Four Winds (hidden landmark 'wind_shrine'): an ancient,
 * weathered ledge in the sea of clouds below the temple, home of the Hermit.
 * A round stone ledge (open flat area r = 12 for the hermit's trials) with
 * four carved wind pillars, a small shrine niche cut into the hillside, a
 * weathered wind-spiral inlay, broken columns and faded prayer flags.
 */
export class ShrineOfFourWinds extends AirRegion {
  readonly id = 'air_wind_shrine';
  readonly center = { x: WIND_SHRINE.x, z: WIND_SHRINE.z };
  readonly loadRadius = 240;

  protected parts(_ctx: GameContext): Array<[string, () => void]> {
    return [['shrine', () => this.buildShrine()]];
  }

  private buildShrine(): void {
    const c = { x: WIND_SHRINE.x, z: WIND_SHRINE.z };
    const y: number = WIND_SHRINE.y;
    const R: number = WIND_SHRINE.r;
    const k = this.zone('shrine', c, R + 6);
    // Ledge: weathered paving on a drum of grey stone sunk into the slope.
    let low: number = y;
    for (let i = 0; i < 12; i++) {
      const a = (i / 12) * Math.PI * 2;
      low = Math.min(low, heightAt(c.x + Math.cos(a) * R, c.z + Math.sin(a) * R));
    }
    k.main.cylinder('stone_grey', { x: c.x, z: c.z, y: low - 6, r: R + 0.6, rTop: R + 0.2, h: y - 0.5 - (low - 6), segments: 40 });
    k.main.cylinder('paving_dark', { x: c.x, z: c.z, y: y - 0.5, r: R, h: 0.5, segments: 48 }, { collide: true, walkable: true });
    k.main.cylinder('stone_grey', { x: c.x, z: c.z, y: y - 0.9, r: R + 0.4, h: 0.45, segments: 48 });
    // Wind-spiral inlay (four arms) in pale stone.
    for (let arm = 0; arm < 4; arm++) {
      for (let i = 0; i < 14; i++) {
        const t = i / 14;
        const a = arm * (Math.PI / 2) + t * 2.4;
        const r = 1.2 + t * 8.5;
        k.main.box('stone_light', { x: c.x + Math.cos(a) * r, y: y + 0.005, z: c.z + Math.sin(a) * r, sx: 0.9 + t * 0.6, sy: 0.03, sz: 0.32, yaw: P.alongYaw(-Math.sin(a), Math.cos(a)) });
      }
    }
    k.main.cylinder(am('paintTeal'), { x: c.x, z: c.z, y: y - 0.01, r: 1.1, h: 0.04, segments: 24 });
    // Four wind pillars at the cardinal points (beyond the trial circle).
    for (let i = 0; i < 4; i++) {
      const a = (i / 4) * Math.PI * 2 + Math.PI / 4;
      const px = c.x + Math.cos(a) * (R - 1.6), pz = c.z + Math.sin(a) * (R - 1.6);
      const h = 4.6 + (i % 2) * 0.8;
      k.main.box('stone_grey', { x: px, y: y + 0.3, z: pz, sx: 1.5, sy: 0.6, sz: 1.5, yaw: a }, { collide: true, walkable: false });
      k.main.cylinder('stone_light', { x: px, z: pz, y: y + 0.6, r: 0.45, rTop: 0.36, h, segments: 10 }, { collide: true, walkable: false });
      // Fan-shaped wind crest on top.
      const fan = G.annulusSector(0.1, 1.0, Math.PI * 0.05, Math.PI * 0.95, -0.12, 0.12, 6);
      fan.rotateX(Math.PI / 2);
      k.main.mesh('bronze', fan, { x: px, y: y + 0.6 + h, z: pz, yaw: P.faceYaw(c.x - px, c.z - pz) });
      fan.dispose();
    }
    // Shrine niche cut into the hillside (north-east), facing the ledge centre.
    const sa = Math.atan2(1345.6 - c.z, 1576.5 - c.x);
    const sx = c.x + Math.cos(sa) * (R - 2.2), sz = c.z + Math.sin(sa) * (R - 2.2);
    const yaw = P.faceYaw(c.x - sx, c.z - sz);
    const F = { x: sx, z: sz, yaw };
    k.main.box('stone_grey', { x: sx, y: y + 0.25, z: sz, sx: 4.4, sy: 0.5, sz: 3.2, yaw }, { collide: true, walkable: true });
    const back = P.fp(F, 0, -1.2);
    k.main.box('stone_dark', { x: back.x, y: y + 2.1, z: back.z, sx: 4.2, sy: 3.6, sz: 0.8, yaw }, { collide: true, walkable: false });
    for (const u of [-1.8, 1.8]) {
      const p = P.fp(F, u, -0.2);
      k.main.box('stone_grey', { x: p.x, y: y + 1.9, z: p.z, sx: 0.6, sy: 3.2, sz: 1.6, yaw }, { collide: true, walkable: false });
    }
    k.main.roof(am('roof'), { x: sx, y: y + 3.5, z: sz, w: 5.2, d: 3.4, height: 1.5, yaw, style: 'hip', overhang: 0.35, curve: 0.45, ridge: am('roofTrim') });
    const fin = G.finialGeometry(0.4);
    k.main.mesh('gold', fin, { x: sx, y: y + 4.95, z: sz });
    fin.dispose();
    // Altar with the four-winds emblem disc and an offering bowl.
    const alt = P.fp(F, 0, -0.5);
    k.main.box('stone_light', { x: alt.x, y: y + 0.95, z: alt.z, sx: 1.6, sy: 0.9, sz: 0.8, yaw }, { collide: true, walkable: false });
    const disc = new THREE.CylinderGeometry(0.62, 0.62, 0.08, 24).rotateX(Math.PI / 2);
    const em = P.fp(F, 0, -0.76);
    k.main.mesh('gold', disc, { x: em.x, y: y + 2.3, z: em.z, yaw });
    disc.dispose();
    P.monkStatue(k, P.fp(F, -1.2, -0.5).x, y + 0.5, P.fp(F, -1.2, -0.5).z, yaw, 0.55);
    P.monkStatue(k, P.fp(F, 1.2, -0.5).x, y + 0.5, P.fp(F, 1.2, -0.5).z, yaw, 0.55);
    // Broken columns and fallen drums along the outer edge (ruin feel).
    for (const [deg, h] of [[150, 2.4], [185, 1.2], [215, 3.1], [110, 0.9]] as Array<[number, number]>) {
      const a = (deg * Math.PI) / 180;
      const px = c.x + Math.cos(a) * (R - 1.0), pz = c.z + Math.sin(a) * (R - 1.0);
      k.main.cylinder('stone_grey', { x: px, z: pz, y, r: 0.4, rTop: 0.36, h, segments: 9 }, { collide: true, walkable: true });
    }
    const drum = new THREE.CylinderGeometry(0.4, 0.4, 1.3, 9).rotateZ(Math.PI / 2);
    k.main.mesh('stone_grey', drum, { x: c.x + Math.cos(2.9) * 12.6, y: y + 0.4, z: c.z + Math.sin(2.9) * 12.6, yaw: 0.7 });
    drum.dispose();
    // Low ruined parapet on the cloud side; the ledge is open toward the hill.
    P.arcRail(k, c.x, c.z, R - 0.35, sa + 0.75, sa + Math.PI * 2 - 0.75, y, { seg: 3, h: 0.75, solid: true });
    // Faded prayer flags from the shrine roof to the pillars.
    const top = new THREE.Vector3(sx, y + 4.6, sz);
    for (let i = 0; i < 4; i++) {
      const a = (i / 4) * Math.PI * 2 + Math.PI / 4;
      const px = c.x + Math.cos(a) * (R - 1.6), pz = c.z + Math.sin(a) * (R - 1.6);
      if (Math.hypot(px - sx, pz - sz) < 4) continue;
      P.prayerFlags(k, top, new THREE.Vector3(px, y + 5.0, pz), 1.4, 0.7);
    }
    // The four winds: wisps swirling round the ledge, an updraft below its lip.
    this.ambient({ x: c.x, y: y + 1.2, z: c.z, preset: 'air', rate: 3, range: 90, radius: 9, swirl: 1.4, speed: 3, spread: 0.4 });
    this.ambient({ x: 1594, y: 146, z: 1366, preset: 'mist', rate: 4, range: 140, dir: new THREE.Vector3(0, 1, 0), speed: 4, radius: 5, swirl: 0.8, size: 1.4 });
    P.stoneLantern(k, P.fp(F, 2.9, 0.8).x, y, P.fp(F, 2.9, 0.8).z);
    P.stoneLantern(k, P.fp(F, -2.9, 0.8).x, y, P.fp(F, -2.9, 0.8).z);
  }
}
