import * as THREE from 'three';
import type { GameContext } from '../../../core/GameContext';
import type { ContentBuilder } from '../../kit/Builder';
import { BANYAN } from './layout';
import { W, barrel, crate, ground, rampCollider, rng, v3, yawAlong, yawFacing } from './parts';
import { WildsSite } from './WildsSite';

/**
 * The Great Banyan Tree in the heart of the Foggy Swamp: a colossal trunk
 * rising from the swamp lake, a walkable root mound, root bridges radiating to
 * the landmark platform on the levee, the hermit's hut platform, the training
 * root platform (training_huu) next to open swamp water (registered source)
 * and the eastern shore; a vast canopy with hanging vines and prop roots,
 * lanterns and drifting fireflies.
 */
export class BanyanSite extends WildsSite {
  readonly id = 'wilds_banyan_tree';
  readonly center = { x: BANYAN.T.x, z: BANYAN.T.z };
  override readonly loadRadius = 330;
  private flies: THREE.Points | null = null;
  private flyBase: Float32Array | null = null;
  private flyPhase: Float32Array | null = null;
  private t = 0;

  protected construct(ctx: GameContext): void {
    const B = BANYAN;
    const M = this.major, D = this.detail, Cl = this.clutter;
    const T = B.T;
    const r = rng(1150);
    const bark = W('bark');

    // --- Trunk, buttresses, root mound -----------------------------------------------------------
    M.cylinder(bark, { x: T.x, y: -5, z: T.z, r: B.trunkR, rTop: 4.6, h: 36, segments: 18 }, { collide: true, walkable: false, surface: 'wood' });
    M.cylinder(bark, { x: T.x, y: 30, z: T.z, r: 4.6, rTop: 3, h: 8, segments: 14 });
    for (let i = 0; i < 9; i++) {
      const a = (i / 9) * Math.PI * 2 + 0.2;
      const len = 3 + r() * 0.8;
      const c = B.trunkR + len / 2 - 0.8; // outer end <= 10.5 m: the mound ring stays walkable all around
      M.box(bark, { x: T.x + Math.cos(a) * c, y: 2, z: T.z + Math.sin(a) * c, sx: len, sy: 9, sz: 1.5, yaw: -a }, { collide: true, walkable: false, surface: 'wood' });
    }
    M.cylinder(bark, { x: T.x, y: -4, z: T.z, r: B.mound.r, rTop: B.mound.r - 1, h: B.mound.top + 4, segments: 24 }, { collide: true, surface: 'wood' });
    M.cylinder(W('moss'), { x: T.x, y: B.mound.top - 0.04, z: T.z, r: B.mound.r - 1.05, h: 0.1, segments: 24 });
    this.mark('mound', T.x, B.mound.top, T.z);

    // --- Platforms ---------------------------------------------------------------------------------
    const platform = (c: { x: number; z: number }, p: { r: number; top: number }, deck: 'wood' | 'moss') => {
      M.cylinder(bark, { x: c.x, y: -4, z: c.z, r: p.r, rTop: p.r - 0.3, h: p.top + 4 - 0.1, segments: 22 });
      M.cylinder(deck === 'wood' ? 'wood' : W('moss'), { x: c.x, y: p.top - 0.12, z: c.z, r: p.r - 0.35, h: 0.14, segments: 22 });
      M.collider({ shape: 'cylinder', x: c.x, y: (p.top - 4) / 2, z: c.z, r: p.r, hy: (p.top + 4) / 2, walkable: true, solid: true, surface: deck === 'wood' ? 'wood' : 'grass' });
    };
    platform(B.L, B.lp, 'moss');
    platform(B.TP, B.tp, 'wood');
    platform(B.HP, B.hp, 'moss');
    this.mark('landmarkPlatform', B.L.x, B.lp.top, B.L.z);
    this.mark('training', B.TP.x, B.tp.top, B.TP.z);
    this.mark('hutPlatform', B.HP.x, B.hp.top, B.HP.z);

    // --- Root bridges (walkable ramps) ------------------------------------------------------------------
    const towards = (a: { x: number; z: number }, b: { x: number; z: number }, d: number) => {
      const dx = b.x - a.x, dz = b.z - a.z, l = Math.hypot(dx, dz);
      return { x: a.x + (dx / l) * d, z: a.z + (dz / l) * d };
    };
    const routes: Record<string, [THREE.Vector3, THREE.Vector3]> = {};
    const root = (name: string, a: THREE.Vector3, c: THREE.Vector3, w: number) => {
      this.rootLog(M, a, c, w);
      rampCollider(M, a, c, w * 0.85, 'wood', 0.5);
      routes[name] = [a, c];
      this.mark(`route_${name}_a`, a.x, a.y, a.z);
      this.mark(`route_${name}_b`, c.x, c.y, c.z);
    };
    // Mound ↔ landmark platform, training platform, hut platform.
    for (const [name, target, p] of [['landmark', B.L, B.lp], ['training', B.TP, B.tp], ['hut', B.HP, B.hp]] as const) {
      const a = towards(T, target, B.mound.r - 1.2);
      const c = towards(target, T, p.r - 1.2);
      root(name, v3(a.x, B.mound.top, a.z), v3(c.x, p.top, c.z), name === 'training' ? 4.2 : 3.4);
    }
    // Training platform → east shore; hut platform → south shore.
    {
      const a = { x: B.TP.x + B.tp.r - 1, z: B.TP.z }, c = { x: B.TP.x + B.tp.r + 9, z: B.TP.z + 1 };
      root('east', v3(a.x, B.tp.top, a.z), v3(c.x, ground(c.x, c.z) + 0.15, c.z), 3.4);
      const h0 = { x: B.HP.x, z: B.HP.z + B.hp.r - 1 }, h1 = { x: B.HP.x - 2, z: B.HP.z + B.hp.r + 18 };
      root('south', v3(h0.x, B.hp.top, h0.z), v3(h1.x, Math.max(ground(h1.x, h1.z), B.waterY) + 0.15, h1.z), 3);
    }
    // Decorative roots arching into the water (walkable until they dive under).
    for (let i = 0; i < 7; i++) {
      const a = (i / 7) * Math.PI * 2 + 0.45;
      const tgt = { x: T.x + Math.cos(a) * 26, z: T.z + Math.sin(a) * 26 };
      if (Math.hypot(tgt.x - B.L.x, tgt.z - B.L.z) < 12 || Math.hypot(tgt.x - B.TP.x, tgt.z - B.TP.z) < 17 || Math.hypot(tgt.x - B.HP.x, tgt.z - B.HP.z) < 10) continue;
      const s = towards(T, tgt, B.mound.r - 1);
      root(`dive_${i}`, v3(s.x, B.mound.top, s.z), v3(tgt.x, B.waterY - 0.6, tgt.z), 2.4 + r());
    }
    this.mark('routes', Object.keys(routes).length, 0, 0);

    // --- Water: murky pool beside the training platform (registered source) -------------------------
    this.water({ id: 'wilds:banyan_pool', type: 'pond', label: 'Banyan murky pool', x: B.pool.x, y: B.waterY, z: B.pool.z, r: 5, capacity: 400, regen: 8, size: 'large' });
    this.mark('pool', B.pool.x, B.waterY, B.pool.z);

    // --- Hermit's hut ----------------------------------------------------------------------------------
    {
      const h = B.HP;
      const yaw = yawFacing(T.x - h.x, T.z - h.z);
      const y = B.hp.top;
      D.block('wood', { x: h.x, y, z: h.z, sx: 4.4, sy: 2.6, sz: 3.8, yaw }, { collide: true, surface: 'wood' });
      D.roof(W('thatch'), { x: h.x, y: y + 2.6, z: h.z, w: 4.4, d: 3.8, height: 1.8, yaw, style: 'hip', overhang: 0.7, ridge: null });
      D.box(W('dark'), { x: h.x + Math.sin(yaw) * 1.92, y: y + 1, z: h.z + Math.cos(yaw) * 1.92, sx: 1, sy: 1.9, sz: 0.04, yaw });
      D.cylinder('iron', { x: h.x + Math.sin(yaw) * 3.2 + Math.cos(yaw) * 1.6, y, z: h.z + Math.cos(yaw) * 3.2 - Math.sin(yaw) * 1.6, r: 0.45, rTop: 0.55, h: 0.6, segments: 10 });
      this.addFire(h.x + Math.sin(yaw) * 3.2 + Math.cos(yaw) * 1.6, y + 0.3, h.z + Math.cos(yaw) * 3.2 - Math.sin(yaw) * 1.6, 0.5);
      barrel(D, h.x - Math.sin(yaw) * 2.6 + Math.cos(yaw) * 2.6, h.z - Math.cos(yaw) * 2.6 - Math.sin(yaw) * 2.6, y);
      crate(D, h.x + Math.cos(yaw) * 3.2, h.z - Math.sin(yaw) * 3.2, 0.7, yaw, y);
    }

    // --- Canopy: branches, foliage, vines, prop roots ---------------------------------------------------
    const branchTips: THREE.Vector3[] = [];
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2 + r() * 0.4;
      const len = 22 + r() * 12;
      const from = v3(T.x, 24 + r() * 8, T.z);
      const to = v3(T.x + Math.cos(a) * len, 32 + r() * 9, T.z + Math.sin(a) * len);
      this.rootLog(M, from, to, 3 - r() * 0.8, true);
      branchTips.push(to);
      // Secondary branch.
      const b2 = v3(to.x + Math.cos(a + 0.8) * 9, to.y + 3, to.z + Math.sin(a + 0.8) * 9);
      this.rootLog(M, to, b2, 1.4, true);
      branchTips.push(b2);
    }
    const leaf = [W('swamp_leaf'), W('foliage_dark')];
    for (let i = 0; i < 30; i++) {
      const tip = branchTips[i % branchTips.length];
      const s = 8 + r() * 8;
      const p = v3(tip.x + (r() - 0.5) * 10, tip.y + 2 + r() * 6, tip.z + (r() - 0.5) * 10);
      const g = new THREE.IcosahedronGeometry(1, 1);
      M.mesh(leaf[i % 2], g, { x: p.x, y: p.y, z: p.z, sx: s, sy: s * 0.55, sz: s, yaw: r() * 6 });
      g.dispose();
    }
    for (let i = 0; i < 6; i++) {
      const g = new THREE.IcosahedronGeometry(1, 1);
      M.mesh(leaf[i % 2], g, { x: T.x + (r() - 0.5) * 14, y: 44 + r() * 6, z: T.z + (r() - 0.5) * 14, sx: 15, sy: 8, sz: 15, yaw: r() * 6 });
      g.dispose();
    }
    const vm = new THREE.Matrix4();
    for (let i = 0; i < 70; i++) {
      const tip = branchTips[Math.floor(r() * branchTips.length)];
      const base = v3(T.x + (tip.x - T.x) * (0.35 + r() * 0.65), 0, T.z + (tip.z - T.z) * (0.35 + r() * 0.65));
      const top = 25 + r() * 10;
      const bottom = 3 + r() * 9;
      vm.compose(v3(base.x + (r() - 0.5) * 4, bottom, base.z + (r() - 0.5) * 4), new THREE.Quaternion(), v3(1, top - bottom, 1));
      Cl.instance('vine', () => {
        const g = new THREE.CylinderGeometry(0.06, 0.1, 1, 5);
        g.translate(0, 0.5, 0);
        return g;
      }, W('vine'), vm, false);
    }
    // Prop roots dropping into the water (solid).
    for (let i = 0; i < 10; i++) {
      const tip = branchTips[(i * 3) % branchTips.length];
      const x = T.x + (tip.x - T.x) * 0.7, z = T.z + (tip.z - T.z) * 0.7;
      if (Math.hypot(x - B.L.x, z - B.L.z) < B.lp.r + 3 || Math.hypot(x - B.TP.x, z - B.TP.z) < B.tp.r + 3 || Math.hypot(x - B.HP.x, z - B.HP.z) < B.hp.r + 3) continue;
      let blocked = false;
      for (const [a, c] of Object.values(routes)) {
        const t = Math.max(0, Math.min(1, ((x - a.x) * (c.x - a.x) + (z - a.z) * (c.z - a.z)) / ((c.x - a.x) ** 2 + (c.z - a.z) ** 2)));
        if (Math.hypot(x - (a.x + (c.x - a.x) * t), z - (a.z + (c.z - a.z) * t)) < 4) blocked = true;
      }
      if (blocked) continue;
      const h = tip.y * 0.85;
      M.cylinder(bark, { x, y: -3, z, r: 0.55 + r() * 0.4, rTop: 0.35, h: h + 3, segments: 8 }, { collide: true, walkable: false, surface: 'wood' });
    }

    // --- Lanterns hanging from the roots and branches ------------------------------------------------
    const lanterns = [
      towards(B.L, T, 2), towards(B.TP, T, 6), towards(B.HP, T, 1), { x: B.TP.x + 6, z: B.TP.z - 9 }, { x: B.TP.x - 4, z: B.TP.z + 10 },
      { x: T.x + 10, z: T.z + 6 }, { x: T.x - 9, z: T.z + 7 }, { x: T.x + 2, z: T.z - 11 },
    ];
    for (const p of lanterns) {
      const y = 4.2 + r() * 1.5;
      D.lantern(v3(p.x, y, p.z), { color: 'warm', hanging: true });
      D.box(W('vine'), { x: p.x, y: y + 6, z: p.z, sx: 0.05, sy: 11.6, sz: 0.05 }, { castShadow: false });
    }

    // --- Fireflies -----------------------------------------------------------------------------------------
    const N = 150;
    const pos = new Float32Array(N * 3);
    this.flyBase = new Float32Array(N * 3);
    this.flyPhase = new Float32Array(N);
    for (let i = 0; i < N; i++) {
      const a = r() * Math.PI * 2, rr = 6 + r() * 34;
      this.flyBase[i * 3] = T.x + Math.cos(a) * rr;
      this.flyBase[i * 3 + 1] = 1.6 + r() * 7;
      this.flyBase[i * 3 + 2] = T.z + Math.sin(a) * rr;
      this.flyPhase[i] = r() * 100;
    }
    pos.set(this.flyBase);
    const fg = new THREE.BufferGeometry();
    fg.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    const fm = new THREE.PointsMaterial({ color: '#e6ff8a', size: 0.32, sizeAttenuation: true, transparent: true, opacity: 0.95, blending: THREE.AdditiveBlending, depthWrite: false });
    this.flies = new THREE.Points(fg, fm);
    this.flies.frustumCulled = false;
    this.flies.name = 'banyan_fireflies';
    this.clutterGroup.add(this.flies);
    this.owned.push(fg, fm);
    void ctx;
  }

  /** A root/branch log between two points (tapered cylinder, top flattened for walking). */
  private rootLog(b: ContentBuilder, a: THREE.Vector3, c: THREE.Vector3, w: number, round = false): void {
    const len = a.distanceTo(c);
    const hl = Math.hypot(c.x - a.x, c.z - a.z);
    const g = new THREE.CylinderGeometry(w * 0.42, w * 0.55, len + 0.6, 10);
    g.rotateZ(-Math.PI / 2); // axis along +X, thick end toward a
    const mid = a.clone().add(c).multiplyScalar(0.5);
    // Walk roots are flattened vertically so their top matches the ramp collider.
    b.mesh(W('bark'), g, { x: mid.x, y: mid.y - (round ? 0 : w * 0.22), z: mid.z, yaw: yawAlong(a.x, a.z, c.x, c.z), roll: Math.atan2(c.y - a.y, Math.max(0.01, hl)), sy: round ? 1 : 0.62 });
    g.dispose();
  }

  protected override tick(_dt: number, ctx: GameContext): void {
    this.t += _dt;
    const f = this.flies;
    if (!f || !this.flyBase || !this.flyPhase || this.detailLevel !== 'full' || !this.clutterGroup.visible) return;
    const p = ctx.player?.position;
    if (p && Math.hypot(p.x - BANYAN.T.x, p.z - BANYAN.T.z) > 160) return;
    const arr = (f.geometry.getAttribute('position') as THREE.BufferAttribute).array as Float32Array;
    const t = this.t;
    for (let i = 0; i < this.flyPhase.length; i++) {
      const ph = this.flyPhase[i];
      arr[i * 3] = this.flyBase[i * 3] + Math.sin(t * 0.37 + ph) * 1.6;
      arr[i * 3 + 1] = this.flyBase[i * 3 + 1] + Math.sin(t * 0.83 + ph * 1.7) * 0.6;
      arr[i * 3 + 2] = this.flyBase[i * 3 + 2] + Math.cos(t * 0.29 + ph * 0.6) * 1.6;
    }
    f.geometry.getAttribute('position').needsUpdate = true;
    (f.material as THREE.PointsMaterial).opacity = 0.65 + 0.3 * Math.sin(t * 2.1);
  }
}
