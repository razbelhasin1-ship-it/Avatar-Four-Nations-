import * as THREE from 'three';
import type { GameContext } from '../../../../core/GameContext';
import type { Interactable } from '../../../Interactables';
import { turtleDuckGeo } from '../geom';
import { CALDERA, atPolar } from './layout';

/**
 * The turtle-duck family on the palace garden's pond (two parents, three ducklings), and the
 * garden's interaction: feeding them brings the family paddling over to the bank for a while.
 */
export class TurtleDucks {
  readonly group = new THREE.Group();
  private readonly meshes: THREE.InstancedMesh[] = [];
  private readonly geos: THREE.BufferGeometry[] = [];
  private readonly mats: THREE.Material[] = [];
  private readonly ducks: Array<{ a: number; r: number; speed: number; phase: number; s: number; x: number; z: number }> = [];
  private readonly obj = new THREE.Object3D();
  private readonly pond = atPolar(CALDERA.garden.phi, CALDERA.garden.r);
  private readonly level = CALDERA.lakeLevel;
  private lure = { x: 0, z: 0, until: -1 };
  readonly interactable: Interactable;

  constructor(parent: THREE.Object3D, private readonly now: () => number) {
    this.group.name = 'fnc_turtleducks';
    parent.add(this.group);
    const g = turtleDuckGeo();
    this.geos.push(g.shell, g.body);
    const shell = new THREE.MeshStandardMaterial({ color: '#5a7a3a', roughness: 0.6 });
    const body = new THREE.MeshStandardMaterial({ color: '#e8c25a', roughness: 0.7 });
    this.mats.push(shell, body);
    for (const [geo, mat] of [[g.shell, shell], [g.body, body]] as const) {
      const im = new THREE.InstancedMesh(geo, mat, 5);
      im.frustumCulled = false;
      this.group.add(im);
      this.meshes.push(im);
    }
    for (let i = 0; i < 5; i++) {
      const a = (i / 5) * Math.PI * 2;
      this.ducks.push({ a, r: 2.6 + (i % 3) * 1.5, speed: 0.12 + (i % 2) * 0.05, phase: i * 1.7, s: i < 2 ? 1 : 0.55, x: this.pond.x, z: this.pond.z });
    }
    const R = CALDERA.garden.pondR;
    // The bank on the villa's far side (the villa stands toward the palace).
    const toV = Math.atan2(-(this.pond.x - atPolar(0, 0).x), -(this.pond.z - atPolar(0, 0).z));
    const bank = new THREE.Vector3(this.pond.x - Math.sin(toV) * (R + 1.2), this.level + 1.6, this.pond.z - Math.cos(toV) * (R + 1.2));
    this.interactable = {
      id: 'fn_feed_turtleducks',
      position: bank,
      radius: R + 4,
      label: 'Feed the turtle-ducks',
      enabled: () => this.now() > this.lure.until,
      interact: (ctx: GameContext) => {
        const p = ctx.player?.position;
        if (!p) return;
        this.lure = { x: p.x, z: p.z, until: this.now() + 12 };
        ctx.audio.play('creature.turtleduck.quack', { position: new THREE.Vector3(this.pond.x, this.level + 0.3, this.pond.z), volume: 0.8 });
        ctx.events.emit('ui:notify', { text: 'The turtle-ducks paddle over, quacking for bread.', kind: 'info', duration: 3 });
      },
    };
    this.update(0, 0);
  }

  update(_dt: number, t: number): void {
    const P = this.pond, R = CALDERA.garden.pondR;
    const lured = t < this.lure.until;
    for (let i = 0; i < this.ducks.length; i++) {
      const d = this.ducks[i];
      d.a += d.speed * _dt;
      const wob = Math.sin(t * 0.4 + d.phase) * 0.6;
      let x = P.x + Math.cos(d.a) * (d.r + wob);
      let z = P.z + Math.sin(d.a) * (d.r + wob);
      if (lured) {
        const la = Math.atan2(this.lure.z - P.z, this.lure.x - P.x);
        const rr = R - 1.4 - (d.phase % 1.2);
        const tx = P.x + Math.cos(la + (d.phase - 3) * 0.12) * rr, tz = P.z + Math.sin(la + (d.phase - 3) * 0.12) * rr;
        const k = Math.min(1, this.lure.until - t > 10 ? (12 - (this.lure.until - t)) / 2 : 1);
        x += (tx - x) * k;
        z += (tz - z) * k;
      }
      const dx = x - d.x, dz = z - d.z;
      d.x = x;
      d.z = z;
      const o = this.obj;
      o.position.set(x, this.level + Math.sin(t * 2 + d.phase) * 0.02, z);
      if (dx * dx + dz * dz > 1e-8) o.rotation.y = Math.atan2(dx, dz) + Math.PI;
      o.scale.setScalar(d.s);
      o.updateMatrix();
      for (const m of this.meshes) m.setMatrixAt(i, o.matrix);
    }
    for (const m of this.meshes) m.instanceMatrix.needsUpdate = true;
  }

  dispose(): void {
    this.group.removeFromParent();
    for (const m of this.meshes) m.dispose();
    for (const g of this.geos) g.dispose();
    for (const m of this.mats) m.dispose();
  }
}
