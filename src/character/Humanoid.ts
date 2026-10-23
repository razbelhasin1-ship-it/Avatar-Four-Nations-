import * as THREE from 'three';
import { Animator, BONE_NAMES, type BoneName } from './Animator';
import type { Appearance } from './Appearance';
import { PAL } from './CharMesh';
import { CharMaterial, blankAtlas } from './CharMaterial';
import { BONE_PARENT, HEAD_CY, mixHex, rigLayout, scaleHex, skinPalette } from './CharShape';
import { buildCache, buildCharacter, shapeKey, type BuildResult } from './CharacterBuild';
import { atlasCache, atlasKey, makeAtlasTexture } from './ClothAtlas';
import { SecondaryMotion } from './Secondary';
import { tattooUniforms } from './Tattoo';
import { resolveItem } from './buildUtil';

/**
 * Procedural stylized humanoid used for the player, NPCs, masters and enemies.
 *
 * The whole character (body, face, hair, clothing, props) is ONE skinned mesh
 * with ONE material (CharMaterial) driven by a THREE.Bone skeleton, so a crowd
 * costs one draw call per character. Geometry is cached by shape and shared;
 * colours are material uniforms (instant recolour); a cheaper LOD is swapped in
 * by camera distance.
 *
 * Public contract (other systems rely on it):
 *  - root: place at the feet; rotation.y = facing yaw.
 *  - bones: Record<BoneName, Object3D> driven by `animator` (THREE.Bone instances).
 *  - anchors: attach VFX/props (handL, handR, head, eyes, chest, back, hips, footL, footR).
 *  - setAppearance(a): rebuilds visuals; keeps bones/animator intact.
 *  - setGlow(eyes, tattoos, color?): Avatar State glow 0..1 (emissive, bloom-friendly).
 *    Characters without tattoos get blazing eyes plus a luminous rim; (0,0) restores exactly.
 *  - flash(color, dur): brief hit flash.  - height: standing height in metres.
 */

export type AnchorName = 'handL' | 'handR' | 'head' | 'eyes' | 'chest' | 'back' | 'hips' | 'footL' | 'footR';

export interface HumanoidOptions {
  castShadow?: boolean;
  /** 'auto' swaps to the low LOD beyond Humanoid.lodDistance (default). */
  lod?: 'auto' | 'high' | 'low';
  /** Cape / hair / sash spring simulation (default true). */
  secondaryMotion?: boolean;
}

const _wp = new THREE.Vector3();

export class Humanoid {
  /** Camera distance (m) beyond which 'auto' humanoids use the low LOD. */
  static lodDistance = 22;
  /** Beyond this camera distance humanoids stop casting shadows. */
  static shadowDistance = 55;
  /** Beyond this distance the animator updates at a reduced rate. */
  static animLodDistance = 30;
  /**
   * LOD rebuild budget (ms of mesh building per 1/60 s, token bucket shared by all
   * humanoids). 'auto' humanoids are built at the cheap LOD first and upgraded when the
   * camera comes close, so streaming in a crowd never stalls a frame for long.
   */
  static lodBuildBudgetMs = 10;
  private static bucket = 0;
  private static bucketT = 0;
  private static lodBudget(): boolean {
    const now = performance.now();
    const elapsed = Math.min(100, Math.max(0, now - Humanoid.bucketT));
    Humanoid.bucketT = now;
    Humanoid.bucket = Math.min(Humanoid.lodBuildBudgetMs * 3, Humanoid.bucket + (elapsed * Humanoid.lodBuildBudgetMs) / 16.7);
    return Humanoid.bucket > 0;
  }

  readonly root = new THREE.Group();
  readonly bones = {} as Record<BoneName, THREE.Object3D>;
  readonly anchors = {} as Record<AnchorName, THREE.Object3D>;
  readonly animator: Animator;
  appearance: Appearance;
  height = 1.75;
  castShadow: boolean;

  private readonly boneList: THREE.Bone[] = [];
  private extraBones: THREE.Bone[] = [];
  private skeleton: THREE.Skeleton | null = null;
  private mesh: THREE.SkinnedMesh | null = null;
  private readonly material = new CharMaterial();
  private build: BuildResult | null = null;
  private atlasKeyStr = '';
  private secondary: SecondaryMotion | null = null;
  private readonly secondaryEnabled: boolean;
  private readonly lodMode: 'auto' | 'high' | 'low';
  private lod: 0 | 1;
  private wantLod: 0 | 1;
  private camDist = 0;
  private animAccum = 0;
  private eyeGlow = 0;
  private tattooGlow = 0;
  private readonly glowColor = new THREE.Color('#bfe8ff');
  private flashTime = 0;
  private flashDur = 0.12;
  private readonly flashColor = new THREE.Color();
  private blink = 0;
  private blinkTimer = 1.5 + Math.random() * 3;
  private lidClosed = 0;
  private disposed = false;

  constructor(appearance: Appearance, opts: HumanoidOptions = {}) {
    this.appearance = appearance;
    this.castShadow = opts.castShadow ?? true;
    this.lodMode = opts.lod ?? 'auto';
    this.secondaryEnabled = opts.secondaryMotion ?? true;
    // 'auto' starts at the cheap LOD and upgrades once the camera distance is known.
    this.lod = this.lodMode === 'high' ? 0 : 1;
    this.wantLod = this.lod;
    this.root.name = 'humanoid';
    for (const name of BONE_NAMES) {
      const b = new THREE.Bone();
      b.name = name;
      this.bones[name] = b;
      this.boneList.push(b);
    }
    for (const name of BONE_NAMES) {
      const p = BONE_PARENT[name];
      (p ? this.bones[p] : this.root).add(this.bones[name]);
    }
    const anchor = (name: AnchorName, parent: BoneName) => {
      const a = new THREE.Object3D();
      a.name = 'anchor_' + name;
      this.bones[parent].add(a);
      this.anchors[name] = a;
    };
    anchor('handL', 'handL');
    anchor('handR', 'handR');
    anchor('head', 'head');
    anchor('eyes', 'head');
    anchor('chest', 'chest');
    anchor('back', 'chest');
    anchor('hips', 'hips');
    anchor('footL', 'footL');
    anchor('footR', 'footR');
    this.applyRig(appearance);
    this.animator = new Animator(this.bones);
    this.rebuild();
    this.applyColors();
  }

  // ---------------------------------------------------------------------------
  // Appearance
  // ---------------------------------------------------------------------------

  setAppearance(a: Appearance): void {
    this.appearance = a;
    this.rebuild();
    this.applyColors();
    this.setGlow(this.eyeGlow, this.tattooGlow);
  }

  /** Initial bone rest positions (the hips rest position never changes after the Animator captures it). */
  private applyRig(a: Appearance): void {
    this.root.scale.setScalar(Math.min(1.25, Math.max(0.55, a.height)));
    const rig = rigLayout(a.frame);
    for (const name of BONE_NAMES) {
      const o = rig.offset[name];
      this.bones[name].position.set(o[0], o[1], o[2]);
    }
  }

  private rebuild(): void {
    const a = this.appearance;
    this.root.scale.setScalar(Math.min(1.25, Math.max(0.55, a.height)));
    const key = shapeKey(a, this.lod);
    if (this.build && this.build.key === key && this.mesh) return;
    const next = buildCache.acquire(key, () => buildCharacter(a, this.lod));
    if (this.build) buildCache.release(this.build.key);
    this.build = next;
    const rig = next.rig;
    for (const name of BONE_NAMES) {
      if (name === 'hips') continue;
      const o = rig.offset[name];
      this.bones[name].position.set(o[0], o[1], o[2]);
    }
    // Extra bones (fingers, thumbs, lids, chains).
    for (const b of this.extraBones) b.removeFromParent();
    this.extraBones = [];
    const all: THREE.Bone[] = [...this.boneList];
    const modelPos: THREE.Vector3[] = BONE_NAMES.map((n) => new THREE.Vector3(...rig.pos[n]));
    for (const e of next.extra) {
      const b = new THREE.Bone();
      b.name = e.name;
      const parent = all[e.parent];
      const pp = modelPos[e.parent];
      b.position.set(e.pos[0] - pp.x, e.pos[1] - pp.y, e.pos[2] - pp.z);
      parent.add(b);
      all[e.index] = b;
      modelPos[e.index] = new THREE.Vector3(...e.pos);
      this.extraBones.push(b);
    }
    const inverses = modelPos.map((p) => new THREE.Matrix4().makeTranslation(-p.x, -p.y, -p.z));
    this.skeleton?.dispose();
    this.skeleton = new THREE.Skeleton(all, inverses);
    if (this.mesh) this.root.remove(this.mesh);
    const mesh = new THREE.SkinnedMesh(next.geometry, this.material);
    mesh.name = 'humanoid_mesh';
    mesh.bind(this.skeleton, new THREE.Matrix4());
    mesh.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, 1.0, 0), 1.45);
    mesh.castShadow = this.castShadow;
    mesh.receiveShadow = false;
    mesh.onBeforeRender = (_r, _s, camera) => {
      _wp.setFromMatrixPosition(mesh.matrixWorld);
      this.camDist = _wp.distanceTo(camera.position);
    };
    this.mesh = mesh;
    this.root.add(mesh);
    // Atlas texture (shared).
    const ak = atlasKey(next.atlas);
    if (ak !== this.atlasKeyStr) {
      if (this.atlasKeyStr) atlasCache.release(this.atlasKeyStr);
      const hasAtlas = Object.keys(next.atlas).length > 0;
      this.material.map = hasAtlas ? atlasCache.acquire(ak, () => makeAtlasTexture(next.atlas)) : (atlasCache.acquire(ak, () => blankAtlas()), blankAtlas());
      this.atlasKeyStr = ak;
    }
    // Secondary motion.
    this.secondary = this.secondaryEnabled && next.chains.length ? new SecondaryMotion(next.chains, all, this.root) : null;
    // Anchors adjusted to geometry.
    const hp = rig.pos.head;
    const eye = { x: (next.eyeL[0] + next.eyeR[0]) / 2, y: (next.eyeL[1] + next.eyeR[1]) / 2, z: (next.eyeL[2] + next.eyeR[2]) / 2 };
    this.anchors.handL.position.set(0.004, -0.075, 0.012);
    this.anchors.handR.position.set(-0.004, -0.075, 0.012);
    this.anchors.head.position.set(0, HEAD_CY + 0.035, 0);
    this.anchors.eyes.position.set(eye.x - hp[0], eye.y - hp[1], eye.z - hp[2] + 0.012);
    this.anchors.chest.position.set(0, 0.1, 0.14);
    this.anchors.back.position.set(0, 0.12, -0.16);
    this.anchors.hips.position.set(0, 0, 0);
    this.anchors.footL.position.set(0, -0.05, 0.05);
    this.anchors.footR.position.set(0, -0.05, 0.05);
    this.height = next.crownY * Math.min(1.25, Math.max(0.55, a.height));
  }

  private applyColors(): void {
    const a = this.appearance;
    const m = this.material;
    const sp = skinPalette(a.skinTone);
    m.setPal(PAL.SKIN, sp.skin);
    m.setPal(PAL.SKIN_SHADE, sp.shade);
    m.setPal(PAL.LIP, sp.lip);
    m.setPal(PAL.MOUTH, sp.mouth);
    m.setPal(PAL.SCAR, sp.scar);
    m.setPal(PAL.BURN, sp.burn);
    m.setPal(PAL.HAIR, a.hair.color);
    m.setPal(PAL.HAIR_DARK, scaleHex(a.hair.color, 0.6));
    m.setPal(PAL.STUBBLE, mixHex(a.skinTone, a.hair.color, 0.42));
    m.setPal(PAL.BROW, a.brows.color);
    m.setPal(PAL.EYE_WHITE, '#f2eee6');
    m.setPal(PAL.IRIS, a.eyes.color);
    m.setPal(PAL.PUPIL, '#0d0908');
    m.setPal(PAL.LASH, mixHex('#140e0c', a.brows.color, 0.25));
    m.setPal(PAL.PRIMARY, a.colors.primary);
    m.setPal(PAL.SECONDARY, a.colors.secondary);
    m.setPal(PAL.ACCENT, a.colors.accent);
    m.setPal(PAL.TRIM, a.colors.trim);
    m.setPal(PAL.FUR, '#ede7da');
    m.setPal(PAL.FUR_DARK, '#9a8670');
    m.setPal(PAL.LEATHER, '#6e4a2e');
    m.setPal(PAL.LEATHER_DARK, '#2b2321');
    m.setPal(PAL.WOOD, '#8d5c30');
    m.setPal(PAL.BONE, '#ece2cb');
    m.setPal(PAL.STRAW, '#d8bd78');
    m.setPal(PAL.WRAP, '#e6dbc2');
    m.setPal(PAL.GOLD, '#e0b450');
    m.setPal(PAL.STEEL, '#9aa0a8');
    m.setPal(PAL.METAL_DARK, '#3c3734');
    const neck = resolveItem(a.outfit.necklace);
    const stone = neck?.shape.stone;
    m.setPal(PAL.STONE, typeof stone === 'string' ? stone : '#4a8fd6');
    const hw = resolveItem(a.outfit.headwear);
    m.setPal(PAL.STONE2, hw?.shape.style === 'hairpin' ? '#3f9f5a' : '#3a78c8');
    const c = m.cu.uCloth.value;
    c[0].set(a.colors.primary);
    c[1].set(a.colors.secondary);
    c[2].set(a.colors.accent);
    c[3].set(a.colors.trim);
    m.cu.uTatColor.value.set(a.tattooColor);
    const tu = tattooUniforms(a.tattoos, this.build!.tat);
    for (let i = 0; i < tu.A.length; i++) {
      m.cu.uTatA.value[i].fromArray(tu.A[i]);
      m.cu.uTatB.value[i].fromArray(tu.B[i]);
      m.cu.uTatC.value[i].fromArray(tu.C[i]);
    }
  }

  // ---------------------------------------------------------------------------
  // Glow & flash
  // ---------------------------------------------------------------------------

  /** Avatar State glow (0..1 each). Eyes blaze white-blue; tattoos glow if present; untattooed bodies get a luminous rim. */
  setGlow(eyes: number, tattoos: number, color?: THREE.ColorRepresentation): void {
    this.eyeGlow = Math.max(0, eyes);
    this.tattooGlow = Math.max(0, tattoos);
    if (color !== undefined) this.glowColor.set(color);
    const cu = this.material.cu;
    cu.uGlowColor.value.copy(this.glowColor);
    cu.uEyeGlow.value = this.eyeGlow;
    cu.uTatGlow.value = this.hasTattoos ? this.tattooGlow : 0;
    const g = Math.max(this.eyeGlow, this.tattooGlow);
    cu.uRim.value = g * (this.hasTattoos ? 0.35 : 0.9);
  }

  get hasTattoos(): boolean {
    return this.appearance.tattoos !== 'none';
  }

  /** Brief additive colour flash (hit feedback). */
  flash(color: THREE.ColorRepresentation = '#ffffff', duration = 0.12): void {
    this.flashColor.set(color);
    this.flashTime = duration;
    this.flashDur = Math.max(0.01, duration);
  }

  // ---------------------------------------------------------------------------
  // Per-frame
  // ---------------------------------------------------------------------------

  update(dt: number): void {
    if (this.disposed) return;
    // LOD by camera distance (measured during the last render).
    if (this.lodMode === 'auto' && this.camDist > 0) {
      const d = Humanoid.lodDistance;
      if (this.lod === 0 && this.camDist > d + 3) this.wantLod = 1;
      else if (this.lod === 1 && this.camDist < d - 3) this.wantLod = 0;
      // Close-ups (the player, dialogue partners) upgrade immediately; the rest share the budget.
      if (this.wantLod !== this.lod && (this.camDist < 6 || Humanoid.lodBudget())) {
        const t0 = performance.now();
        this.lod = this.wantLod;
        this.rebuild();
        this.applyColors();
        Humanoid.bucket -= performance.now() - t0;
      }
      if (this.mesh) this.mesh.castShadow = this.castShadow && this.camDist < Humanoid.shadowDistance;
    }
    // Animation (reduced rate when far away).
    const far = this.camDist > Humanoid.animLodDistance;
    this.animAccum += dt;
    if (!far || this.animAccum >= 1 / 15) {
      this.animator.update(this.animAccum);
      this.animAccum = 0;
    }
    const an = this.animator;
    // Hands: curl fingers/thumbs.
    const fist = an.fist;
    const ex = this.extraBones;
    if (ex.length >= 6) {
      const cL = 0.22 + fist[0] * 1.45, cR = 0.22 + fist[1] * 1.45;
      ex[0].rotation.set(0, 0, -cL);
      ex[1].rotation.set(0, -(0.15 + fist[0] * 0.75), 0);
      ex[2].rotation.set(0, 0, cR);
      ex[3].rotation.set(0, 0.15 + fist[1] * 0.75, 0);
      // Lids: blink, close for meditation/knockdown, wide open when glowing.
      this.blinkTimer -= dt;
      if (this.blinkTimer <= 0) {
        this.blink = 1;
        this.blinkTimer = 2.2 + Math.random() * 3.8;
      }
      this.blink = Math.max(0, this.blink - dt * 7);
      const wantClosed = an.eyesClosed ? 0.94 : 0;
      this.lidClosed += (wantClosed - this.lidClosed) * Math.min(1, dt * 6);
      const b = this.eyeGlow > 0.3 ? 0 : Math.sin(this.blink * Math.PI) * 0.97;
      const close = Math.max(b, this.lidClosed) * (this.build?.lidClose ?? 0.9);
      ex[4].rotation.set(close - this.eyeGlow * 0.12, 0, 0);
      ex[5].rotation.set(close - this.eyeGlow * 0.12, 0, 0);
    }
    if (this.secondary && this.lod === 0 && !far) this.secondary.update(dt);
    // Flash decay.
    const fl = this.material.cu.uFlash.value;
    if (this.flashTime > 0) {
      this.flashTime = Math.max(0, this.flashTime - dt);
      const k = Math.min(1.2, (this.flashTime / this.flashDur) * 1.2);
      fl.copy(this.flashColor).multiplyScalar(k);
    } else if (fl.r || fl.g || fl.b) fl.setRGB(0, 0, 0);
  }

  /** Stats for profiling/debug. */
  get stats(): { vertices: number; triangles: number; lod: number; bones: number; chains: number } {
    return {
      vertices: this.build?.vertexCount ?? 0,
      triangles: this.build?.triangleCount ?? 0,
      lod: this.lod,
      bones: this.skeleton?.bones.length ?? 0,
      chains: this.secondary?.count ?? 0,
    };
  }

  /** Force a LOD level (debug / previews). */
  forceLod(level: 0 | 1): void {
    if (this.lod === level) return;
    this.lod = level;
    this.wantLod = level;
    this.rebuild();
    this.applyColors();
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    if (this.mesh) this.root.remove(this.mesh);
    this.mesh = null;
    if (this.build) buildCache.release(this.build.key);
    this.build = null;
    if (this.atlasKeyStr) atlasCache.release(this.atlasKeyStr);
    this.atlasKeyStr = '';
    this.skeleton?.dispose();
    this.skeleton = null;
    this.material.dispose();
  }

  static boneNames(): readonly BoneName[] {
    return BONE_NAMES;
  }
}
