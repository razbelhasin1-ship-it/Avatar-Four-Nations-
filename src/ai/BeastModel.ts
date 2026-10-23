import * as THREE from 'three';

/**
 * Procedural hostile-beast models (platypus bear, sabertooth moose lion):
 * primitive-built bodies with a small hand-rolled rig (4 leg pivots, head,
 * jaw, tail) animated procedurally — gait synced to ground speed, rearing
 * swipes, head-down charge, roar with an open jaw, cower when subdued.
 * Self-contained so the companions module can evolve independently.
 */

export type BeastAction = 'none' | 'tell_swipe' | 'swipe' | 'tell_charge' | 'charge' | 'tell_roar' | 'roar' | 'stagger' | 'cower';

interface Leg {
  pivot: THREE.Group;
  phase: number;
  front: boolean;
}

export interface BeastSpec {
  kind: 'platypus_bear' | 'moose_lion';
}

export class BeastModel {
  readonly root = new THREE.Group();
  /** Pitch/bob carrier. */
  private readonly torso = new THREE.Group();
  private readonly head = new THREE.Group();
  private readonly jaw = new THREE.Group();
  private readonly tail = new THREE.Group();
  private readonly legs: Leg[] = [];
  /** Breath/roar origin (world position via getWorldPosition). */
  readonly mouth = new THREE.Object3D();
  readonly chest = new THREE.Object3D();
  readonly height: number;
  readonly radius: number;
  private readonly geos: THREE.BufferGeometry[] = [];
  private readonly mats: THREE.MeshStandardMaterial[] = [];
  private gait = 0;
  private flashT = 0;
  private readonly flashColor = new THREE.Color();
  private pitch = 0;
  private rear = 0;
  private jawOpen = 0;
  private lower = 0;
  private swipeArm = 0;
  private time = Math.random() * 10;
  private readonly legLen: number;

  constructor(readonly kind: BeastSpec['kind']) {
    this.root.add(this.torso);
    const bear = kind === 'platypus_bear';
    const furC = bear ? '#6b4a2e' : '#b8894e';
    const darkC = bear ? '#3e2a1a' : '#4a2c16';
    const accentC = bear ? '#e0a040' : '#efe6d4';
    const fur = this.mat(furC, 0.95);
    const dark = this.mat(darkC, 0.95);
    const accent = this.mat(accentC, 0.6);
    const eye = this.mat('#120c08', 0.3);
    const s = bear ? 1 : 1.12;
    this.legLen = 0.78 * s;
    const bodyY = this.legLen + 0.32 * s;
    this.height = bear ? 1.9 : 2.2;
    this.radius = bear ? 0.85 : 0.95;
    this.torso.position.y = 0;
    // Body
    this.add(new THREE.SphereGeometry(0.72 * s, 16, 12), fur, this.torso, [0, bodyY, 0], [1, 0.82, 1.38]);
    if (!bear) this.add(new THREE.SphereGeometry(0.62 * s, 14, 10), dark, this.torso, [0, bodyY + 0.22, 0.62], [1.15, 1.05, 0.9]); // mane
    else this.add(new THREE.SphereGeometry(0.5, 12, 10), dark, this.torso, [0, bodyY - 0.1, 0.1], [1.1, 0.8, 1.2]); // belly shade
    this.chest.position.set(0, bodyY + 0.1, 0.6 * s);
    this.torso.add(this.chest);
    // Head
    this.head.position.set(0, bodyY + (bear ? 0.42 : 0.5), 0.98 * s);
    this.torso.add(this.head);
    this.add(new THREE.SphereGeometry(0.36 * s, 14, 10), fur, this.head, [0, 0, 0.05], [1, 0.95, 1.1]);
    this.add(new THREE.SphereGeometry(0.05, 8, 6), eye, this.head, [0.17 * s, 0.1, 0.3 * s]);
    this.add(new THREE.SphereGeometry(0.05, 8, 6), eye, this.head, [-0.17 * s, 0.1, 0.3 * s]);
    this.add(new THREE.SphereGeometry(0.1, 8, 6), fur, this.head, [0.24 * s, 0.3, -0.02]);
    this.add(new THREE.SphereGeometry(0.1, 8, 6), fur, this.head, [-0.24 * s, 0.3, -0.02]);
    this.jaw.position.set(0, -0.08, 0.28 * s);
    this.head.add(this.jaw);
    if (bear) {
      // Duck bill: upper half fixed on the head, lower half on the jaw.
      this.add(new THREE.SphereGeometry(0.3, 14, 6), accent, this.head, [0, -0.02, 0.48], [0.95, 0.22, 1.35]);
      this.add(new THREE.SphereGeometry(0.28, 14, 6), accent, this.jaw, [0, -0.05, 0.18], [0.9, 0.18, 1.25]);
    } else {
      // Muzzle, sabre teeth and moose antlers.
      this.add(new THREE.SphereGeometry(0.22, 12, 8), fur, this.head, [0, -0.06, 0.36], [1, 0.8, 1.1]);
      this.add(new THREE.SphereGeometry(0.17, 10, 6), dark, this.jaw, [0, -0.06, 0.08], [1, 0.6, 1.1]);
      for (const sx of [1, -1]) {
        this.add(new THREE.ConeGeometry(0.035, 0.34, 6), accent, this.head, [0.08 * sx, -0.26, 0.42], [Math.PI, 0, 0]);
        const antler = new THREE.Group();
        antler.position.set(0.22 * sx, 0.3, -0.05);
        antler.rotation.set(-0.2, 0, -0.5 * sx);
        this.head.add(antler);
        this.add(new THREE.CylinderGeometry(0.035, 0.05, 0.4, 6), accent, antler, [0, 0.2, 0]);
        this.add(new THREE.BoxGeometry(0.62, 0.05, 0.34), accent, antler, [0.26 * sx, 0.42, 0], [0, 0, 0.25 * sx]);
        for (let i = 0; i < 4; i++) this.add(new THREE.ConeGeometry(0.03, 0.22, 5), accent, antler, [(0.06 + i * 0.15) * sx, 0.56, (i % 2 ? 0.1 : -0.1)], [0, 0, 0.2 * sx]);
      }
    }
    this.mouth.position.set(0, -0.05, 0.62 * s);
    this.head.add(this.mouth);
    // Legs (pivot at the hip/shoulder).
    const lx = 0.42 * s, lzF = 0.62 * s, lzB = -0.58 * s;
    const legDefs: Array<[number, number, number, boolean]> = [
      [lx, lzF, 0, true],
      [-lx, lzF, Math.PI, true],
      [lx, lzB, Math.PI, false],
      [-lx, lzB, 0, false],
    ];
    for (const [x, z, ph, front] of legDefs) {
      const pivot = new THREE.Group();
      pivot.position.set(x, this.legLen + 0.08, z);
      this.torso.add(pivot);
      this.add(new THREE.CylinderGeometry(0.17 * s, 0.13 * s, this.legLen, 8), fur, pivot, [0, -this.legLen / 2, 0]);
      this.add(new THREE.SphereGeometry(0.16 * s, 8, 6), bear ? accent : dark, pivot, [0, -this.legLen + 0.04, 0.08], bear ? [1.3, 0.35, 1.6] : [1, 0.6, 1.3]);
      this.legs.push({ pivot, phase: ph, front });
    }
    // Tail
    this.tail.position.set(0, bodyY + 0.05, -0.95 * s);
    this.torso.add(this.tail);
    if (bear) this.add(new THREE.BoxGeometry(0.42, 0.07, 0.6), dark, this.tail, [0, -0.05, -0.28], [0.35, 0, 0]);
    else {
      this.add(new THREE.CylinderGeometry(0.04, 0.06, 0.8, 6), fur, this.tail, [0, -0.25, -0.3], [-0.9, 0, 0]);
      this.add(new THREE.SphereGeometry(0.1, 8, 6), dark, this.tail, [0, -0.52, -0.62]);
    }
    this.root.traverse((o) => {
      if ((o as THREE.Mesh).isMesh) o.castShadow = true;
    });
  }

  private mat(color: string, rough: number): THREE.MeshStandardMaterial {
    const m = new THREE.MeshStandardMaterial({ color, roughness: rough });
    this.mats.push(m);
    return m;
  }

  private add(g: THREE.BufferGeometry, m: THREE.Material, parent: THREE.Object3D, p: [number, number, number], scaleOrRot?: [number, number, number]): THREE.Mesh {
    this.geos.push(g);
    const o = new THREE.Mesh(g, m);
    o.position.set(p[0], p[1], p[2]);
    if (scaleOrRot) {
      // Spheres take a scale; everything else a rotation.
      if (g instanceof THREE.SphereGeometry) o.scale.set(scaleOrRot[0], scaleOrRot[1], scaleOrRot[2]);
      else o.rotation.set(scaleOrRot[0], scaleOrRot[1], scaleOrRot[2]);
    }
    parent.add(o);
    return o;
  }

  flash(color: THREE.ColorRepresentation, dur = 0.12): void {
    this.flashColor.set(color);
    this.flashT = dur;
  }

  /**
   * Pose for this frame. `speed` is ground speed (m/s); `action` + `actionT`
   * (seconds since the action began) drive attack/roar/cower poses.
   */
  update(dt: number, speed: number, action: BeastAction, actionT: number): void {
    this.time += dt;
    const stride = this.kind === 'platypus_bear' ? 1.5 : 1.9;
    this.gait += (speed / stride) * Math.PI * dt;
    const run = Math.min(1, speed / 6);
    const amp = Math.min(0.75, speed * 0.16);
    let wantPitch = 0;
    let wantRear = 0;
    let wantJaw = 0;
    let wantLower = 0;
    let wantSwipe = 0;
    switch (action) {
      case 'tell_swipe':
        wantRear = 0.55;
        wantSwipe = -0.6;
        wantJaw = 0.3;
        break;
      case 'swipe':
        wantRear = 0.35;
        wantSwipe = actionT < 0.18 ? 1.2 : 0.3;
        wantJaw = 0.4;
        break;
      case 'tell_charge':
        wantPitch = 0.25;
        wantLower = 0.15;
        wantJaw = 0.2;
        break;
      case 'charge':
        wantPitch = 0.2;
        wantJaw = 0.3;
        break;
      case 'tell_roar':
        wantPitch = -0.15;
        wantJaw = 0.4;
        break;
      case 'roar':
        wantPitch = -0.3;
        wantRear = 0.2;
        wantJaw = 1;
        break;
      case 'stagger':
        wantPitch = -0.2;
        wantJaw = 0.5;
        break;
      case 'cower':
        wantLower = 0.38;
        wantPitch = 0.15;
        break;
    }
    const k = 1 - Math.exp(-14 * dt);
    this.pitch += (wantPitch - this.pitch) * k;
    this.rear += (wantRear - this.rear) * k;
    this.jawOpen += (wantJaw - this.jawOpen) * k;
    this.lower += (wantLower - this.lower) * k;
    this.swipeArm += (wantSwipe - this.swipeArm) * Math.min(1, k * 1.6);
    const bob = Math.abs(Math.sin(this.gait)) * 0.06 * run + Math.sin(this.time * 1.7) * 0.012;
    this.torso.position.y = bob - this.lower * this.legLen;
    this.torso.rotation.x = this.pitch - this.rear;
    // Rearing lifts the front: rotate around the hind legs (approximation: move up).
    this.torso.position.y += this.rear * 0.45;
    for (const l of this.legs) {
      let a = Math.sin(this.gait + l.phase) * amp;
      if (l.front && this.rear > 0.05) a = -this.rear * 1.4 + (l.phase === 0 ? -this.swipeArm : 0);
      if (!l.front) a += this.rear * 0.6;
      if (this.lower > 0.05) a = l.front ? -this.lower * 1.6 : this.lower * 1.6;
      l.pivot.rotation.x = a;
    }
    this.head.rotation.x = -this.pitch * 0.6 + Math.sin(this.time * 2.1) * 0.03;
    this.jaw.rotation.x = this.jawOpen * 0.55;
    this.tail.rotation.y = Math.sin(this.time * (2 + run * 6)) * (0.15 + run * 0.25);
    // Hit flash via emissive.
    if (this.flashT > 0) {
      this.flashT = Math.max(0, this.flashT - dt);
      const f = this.flashT > 0 ? 0.8 : 0;
      for (const m of this.mats) m.emissive.copy(this.flashColor).multiplyScalar(f);
    }
  }

  dispose(): void {
    for (const g of this.geos) g.dispose();
    for (const m of this.mats) m.dispose();
  }
}
