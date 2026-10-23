import * as THREE from 'three';
import { cosmeticById, EMPTY_SLOT_IDS } from '../data/cosmetics';
import { Animator, BONE_NAMES, type BoneName } from './Animator';
import type { Appearance } from './Appearance';

/**
 * Procedural stylized humanoid built from smooth primitives parented to a bone
 * hierarchy (rigid skinning). Used for the player, NPCs, masters and enemies.
 *
 * Public contract (other systems rely on it):
 *  - root: place at the feet; rotation.y = facing yaw.
 *  - bones: Record<BoneName, Object3D> driven by `animator`.
 *  - anchors: attach VFX/props (handL, handR, head, eyes, chest, back, hips, footL, footR).
 *  - setAppearance(a): rebuilds visuals; keeps bones/animator intact.
 *  - setGlow(eyes, tattoos): Avatar State glow, 0..1 each (emissive, bloom-friendly).
 *  - flash(): brief hit flash.
 *  - height: approximate standing height in metres.
 */

export type AnchorName = 'handL' | 'handR' | 'head' | 'eyes' | 'chest' | 'back' | 'hips' | 'footL' | 'footR';

const FRAME_SCALE: Record<Appearance['frame'], { sx: number; sy: number }> = {
  slim: { sx: 0.9, sy: 1.0 },
  average: { sx: 1.0, sy: 1.0 },
  athletic: { sx: 1.07, sy: 1.0 },
  broad: { sx: 1.16, sy: 0.99 },
};

interface PartOpts {
  color?: THREE.ColorRepresentation;
  material?: THREE.Material;
  castShadow?: boolean;
}

function capsule(radius: number, length: number, segs = 8): THREE.BufferGeometry {
  const g = new THREE.CapsuleGeometry(radius, Math.max(0.001, length), 4, segs);
  return g;
}

/** Shared tattoo texture painter (head arrow, limb arrows) on a canvas in UV space. */
function paintHeadTattoo(style: Appearance['tattoos'], color: string, glow: boolean): THREE.CanvasTexture | null {
  if (style === 'none' || style === 'arrows_limbs' || style === 'wind_bands') return null;
  const c = document.createElement('canvas');
  c.width = 256;
  c.height = 128;
  const g = c.getContext('2d')!;
  g.fillStyle = glow ? '#000000' : '#ffffff';
  g.fillRect(0, 0, 256, 128);
  g.fillStyle = glow ? '#ffffff' : color;
  // SphereGeometry UV: u=0.25 faces +Z (front), u=0.75 back; v=1 top (canvas y=0).
  const strip = (u: number, v0: number, v1: number, w: number) => {
    for (let y = Math.min(v0, v1); y <= Math.max(v0, v1); y += 0.005) {
      const theta = (1 - y) * Math.PI;
      const width = Math.min(0.2, w / Math.max(0.12, Math.sin(theta)));
      g.fillRect((u - width / 2) * 256, (1 - y) * 128 - 1, width * 256, 2);
    }
  };
  if (style === 'spirit_marks') {
    for (let i = -2; i <= 2; i++) {
      g.beginPath();
      g.arc((0.25 + i * 0.025) * 256, (1 - 0.6) * 128, 2.2, 0, Math.PI * 2);
      g.fill();
    }
  } else {
    const back0 = style === 'arrow_partial' ? 0.72 : 0.38;
    strip(0.75, back0, 1.0, 0.035);
    strip(0.25, 1.0, 0.66, 0.035);
    // Arrowhead pointing down onto the forehead.
    const ax = 0.25 * 256, ay = (1 - 0.6) * 128;
    g.beginPath();
    g.moveTo(ax - 13, ay - 12);
    g.lineTo(ax + 13, ay - 12);
    g.lineTo(ax, ay + 6);
    g.closePath();
    g.fill();
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = glow ? THREE.NoColorSpace : THREE.SRGBColorSpace;
  return tex;
}

function paintLimbTattoo(color: string, glow: boolean, bands: boolean): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = 64;
  c.height = 128;
  const g = c.getContext('2d')!;
  g.fillStyle = glow ? '#000000' : '#ffffff';
  g.fillRect(0, 0, 64, 128);
  g.fillStyle = glow ? '#ffffff' : color;
  if (bands) {
    g.fillRect(0, 40, 64, 7);
    g.fillRect(0, 54, 64, 4);
  } else {
    // CapsuleGeometry UV: u around (0.75 ≈ back side for limbs pointing down), v along length.
    g.fillRect(64 * 0.75 - 4, 0, 8, 128);
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = glow ? THREE.NoColorSpace : THREE.SRGBColorSpace;
  return tex;
}

export class Humanoid {
  readonly root = new THREE.Group();
  readonly bones = {} as Record<BoneName, THREE.Object3D>;
  readonly anchors = {} as Record<AnchorName, THREE.Object3D>;
  readonly animator: Animator;
  appearance: Appearance;
  height = 1.75;
  /** Visual parts container per bone (cleared on appearance change). */
  private readonly parts = new Map<BoneName, THREE.Group>();
  private readonly ownedMaterials: THREE.Material[] = [];
  private readonly ownedGeometries: THREE.BufferGeometry[] = [];
  private readonly ownedTextures: THREE.Texture[] = [];
  private eyeMaterial: THREE.MeshStandardMaterial | null = null;
  private skinMaterial: THREE.MeshStandardMaterial | null = null;
  private tattooMaterials: THREE.MeshStandardMaterial[] = [];
  private flashMats: THREE.MeshStandardMaterial[] = [];
  private flashTime = 0;
  private readonly flashColor = new THREE.Color();
  private eyeGlow = 0;
  private tattooGlow = 0;
  private readonly glowColor = new THREE.Color('#bfe8ff');
  castShadow: boolean;

  constructor(appearance: Appearance, opts: { castShadow?: boolean } = {}) {
    this.appearance = appearance;
    this.castShadow = opts.castShadow ?? true;
    this.root.name = 'humanoid';
    this.buildSkeleton();
    this.animator = new Animator(this.bones);
    this.buildVisuals();
  }

  private buildSkeleton(): void {
    const mk = (name: BoneName, parent: THREE.Object3D, x: number, y: number, z: number) => {
      const b = new THREE.Group();
      b.name = name;
      b.position.set(x, y, z);
      parent.add(b);
      this.bones[name] = b;
      const vis = new THREE.Group();
      vis.name = name + '_vis';
      b.add(vis);
      this.parts.set(name, vis);
      return b;
    };
    const hips = mk('hips', this.root, 0, 0.95, 0);
    const spine = mk('spine', hips, 0, 0.1, 0);
    const chest = mk('chest', spine, 0, 0.2, 0);
    const neck = mk('neck', chest, 0, 0.24, 0);
    mk('head', neck, 0, 0.09, 0.01);
    const shL = mk('shoulderL', chest, 0.17, 0.17, 0);
    const uaL = mk('upperArmL', shL, 0.04, 0, 0);
    const faL = mk('foreArmL', uaL, 0, -0.28, 0);
    mk('handL', faL, 0, -0.25, 0);
    const shR = mk('shoulderR', chest, -0.17, 0.17, 0);
    const uaR = mk('upperArmR', shR, -0.04, 0, 0);
    const faR = mk('foreArmR', uaR, 0, -0.28, 0);
    mk('handR', faR, 0, -0.25, 0);
    const thL = mk('thighL', hips, 0.095, -0.04, 0);
    const shinL = mk('shinL', thL, 0, -0.43, 0);
    mk('footL', shinL, 0, -0.42, 0);
    const thR = mk('thighR', hips, -0.095, -0.04, 0);
    const shinR = mk('shinR', thR, 0, -0.43, 0);
    mk('footR', shinR, 0, -0.42, 0);

    const anchor = (name: AnchorName, parent: THREE.Object3D, x: number, y: number, z: number) => {
      const a = new THREE.Object3D();
      a.name = 'anchor_' + name;
      a.position.set(x, y, z);
      parent.add(a);
      this.anchors[name] = a;
    };
    anchor('handL', this.bones.handL, 0, -0.07, 0.01);
    anchor('handR', this.bones.handR, 0, -0.07, 0.01);
    anchor('head', this.bones.head, 0, 0.12, 0);
    anchor('eyes', this.bones.head, 0, 0.1, 0.11);
    anchor('chest', chest, 0, 0.1, 0.14);
    anchor('back', chest, 0, 0.12, -0.16);
    anchor('hips', hips, 0, 0, 0);
    anchor('footL', this.bones.footL, 0, -0.05, 0.05);
    anchor('footR', this.bones.footR, 0, -0.05, 0.05);
  }

  private mat(color: THREE.ColorRepresentation, rough = 0.85, extra: Partial<THREE.MeshStandardMaterialParameters> = {}): THREE.MeshStandardMaterial {
    const m = new THREE.MeshStandardMaterial({ color, roughness: rough, metalness: 0, ...extra });
    this.ownedMaterials.push(m);
    this.flashMats.push(m);
    return m;
  }

  private geo<T extends THREE.BufferGeometry>(g: T): T {
    this.ownedGeometries.push(g);
    return g;
  }

  private add(bone: BoneName, geom: THREE.BufferGeometry, material: THREE.Material, pos: [number, number, number], rot?: [number, number, number], scale?: [number, number, number]): THREE.Mesh {
    const m = new THREE.Mesh(geom, material);
    m.position.set(pos[0], pos[1], pos[2]);
    if (rot) m.rotation.set(rot[0], rot[1], rot[2]);
    if (scale) m.scale.set(scale[0], scale[1], scale[2]);
    m.castShadow = this.castShadow;
    m.receiveShadow = false;
    this.parts.get(bone)!.add(m);
    return m;
  }

  private clearVisuals(): void {
    for (const g of this.parts.values()) {
      while (g.children.length) g.remove(g.children[0]);
    }
    // Remove accessory children from anchors (props attached by the renderer).
    for (const a of Object.values(this.anchors)) {
      for (const ch of [...a.children]) if (ch.userData.fromAppearance) a.remove(ch);
    }
    this.ownedMaterials.forEach((m) => m.dispose());
    this.ownedGeometries.forEach((g) => g.dispose());
    this.ownedTextures.forEach((t) => t.dispose());
    this.ownedMaterials.length = 0;
    this.ownedGeometries.length = 0;
    this.ownedTextures.length = 0;
    this.tattooMaterials = [];
    this.flashMats = [];
    this.eyeMaterial = null;
    this.skinMaterial = null;
  }

  setAppearance(a: Appearance): void {
    this.appearance = a;
    this.clearVisuals();
    this.buildVisuals();
    this.setGlow(this.eyeGlow, this.tattooGlow);
  }

  private buildVisuals(): void {
    const a = this.appearance;
    const fs = FRAME_SCALE[a.frame];
    const muscle = 0.9 + a.build * 0.25;
    this.root.scale.setScalar(a.height);
    this.height = 1.75 * a.height;
    const col = a.colors;

    const skin = this.mat(a.skinTone, 0.7);
    this.skinMaterial = skin;
    const top = cosmeticById(a.outfit.top);
    const bottom = cosmeticById(a.outfit.bottom);
    const foot = cosmeticById(a.outfit.footwear);
    const topShape = top?.shape ?? { sleeves: 'long', length: 'hip', collar: 'round' };
    const clothA = this.mat(col.primary, 0.9);
    const clothB = this.mat(col.secondary, 0.9);
    const trim = this.mat(col.trim, 0.8);
    const accent = this.mat(col.accent, 0.75);
    const fur = this.mat('#ece6da', 1.0);

    // ---- Head ----
    const headGeo = this.geo(new THREE.SphereGeometry(0.115, 24, 18));
    const tattooStyle = a.tattoos;
    const headTex = paintHeadTattoo(tattooStyle, a.tattooColor, false);
    const headGlowTex = paintHeadTattoo(tattooStyle, a.tattooColor, true);
    let headMat = skin;
    if (headTex && headGlowTex) {
      this.ownedTextures.push(headTex, headGlowTex);
      headMat = this.mat(a.skinTone, 0.7, { map: headTex, emissiveMap: headGlowTex, emissive: new THREE.Color(0x000000) });
      this.tattooMaterials.push(headMat);
    }
    const jaw = 1 + a.face.jaw * 0.08;
    this.add('head', headGeo, headMat, [0, 0.1, 0], undefined, [0.95 * jaw, 1.08, 1.0]);
    // Jaw / chin
    this.add('head', this.geo(new THREE.SphereGeometry(0.085, 16, 12)), skin, [0, 0.04, 0.03], undefined, [jaw, 0.8, 0.95]);
    // Nose
    this.add('head', this.geo(new THREE.ConeGeometry(0.018 * (1 + a.face.nose * 0.3), 0.045, 8)), skin, [0, 0.085, 0.115], [Math.PI / 2 + 0.25, 0, 0]);
    // Ears
    const ear = this.geo(new THREE.SphereGeometry(0.028, 8, 8));
    this.add('head', ear, skin, [0.11, 0.09, -0.005], undefined, [0.45, 1, 0.8]);
    this.add('head', ear, skin, [-0.11, 0.09, -0.005], undefined, [0.45, 1, 0.8]);
    // Eyes
    const eyeWhite = this.mat('#f4f1ea', 0.4);
    this.eyeMaterial = this.mat(a.eyes.color, 0.3, { emissive: new THREE.Color(0x000000) });
    const spacing = 0.04 + a.face.eyeSpacing * 0.006;
    const eyeScaleY = a.eyes.shape === 'narrow' ? 0.55 : a.eyes.shape === 'almond' ? 0.75 : a.eyes.shape === 'wide' ? 1.1 : 0.95;
    const eyeG = this.geo(new THREE.SphereGeometry(0.019, 12, 10));
    const irisG = this.geo(new THREE.SphereGeometry(0.0115, 10, 8));
    for (const sx of [1, -1]) {
      this.add('head', eyeG, eyeWhite, [sx * spacing, 0.115, 0.093], undefined, [1.2, eyeScaleY, 0.6]);
      this.add('head', irisG, this.eyeMaterial, [sx * spacing, 0.115, 0.104], undefined, [1, eyeScaleY * 1.05, 0.5]);
    }
    // Brows
    const browMat = this.mat(a.brows.color, 0.9);
    const browG = this.geo(new THREE.BoxGeometry(0.038, 0.007 + a.brows.thickness * 0.008, 0.01));
    for (const sx of [1, -1]) this.add('head', browG, browMat, [sx * spacing, 0.142, 0.103], [0, 0, sx * (0.08 + a.brows.style * 0.04)]);
    // Mouth
    this.add('head', this.geo(new THREE.BoxGeometry(0.035, 0.005, 0.005)), this.mat('#8a4a40', 0.8), [0, 0.048, 0.103]);

    this.buildHair(a);

    // ---- Neck & torso ----
    this.add('neck', this.geo(capsule(0.045, 0.06)), skin, [0, 0.03, 0]);
    const torsoW = 0.165 * fs.sx * muscle;
    // Chest (cloth)
    const chestGeo = this.geo(capsule(torsoW, 0.12, 12));
    const chestMesh = this.add('chest', chestGeo, clothA, [0, 0.1, 0], undefined, [1, 1, 0.66]);
    chestMesh.name = 'top_chest';
    // Abdomen
    this.add('spine', this.geo(capsule(torsoW * 0.88, 0.08, 12)), clothA, [0, 0.06, 0], undefined, [1, 1, 0.66]);
    // Collar
    if (topShape.collar === 'high') this.add('chest', this.geo(new THREE.CylinderGeometry(0.075, 0.09, 0.07, 14, 1, true)), trim, [0, 0.27, 0]);
    if (topShape.fur) this.add('chest', this.geo(new THREE.TorusGeometry(0.1, 0.035, 8, 16)), fur, [0, 0.25, 0], [Math.PI / 2, 0, 0]);
    // Wrap/trim diagonal across chest
    if (topShape.collar === 'wrap') this.add('chest', this.geo(new THREE.BoxGeometry(0.05, 0.36, 0.02)), trim, [0.02, 0.1, 0.105], [0, 0, 0.6]);

    // Hem / robe skirt from hips according to top length.
    const len = String(topShape.length ?? 'hip');
    const hemLen = len === 'waist' ? 0.05 : len === 'hip' ? 0.18 : len === 'thigh' ? 0.32 : len === 'knee' ? 0.48 : 0.82;
    const hemGeo = this.geo(new THREE.CylinderGeometry(torsoW * 0.95, torsoW * (1.15 + hemLen * 0.5), hemLen, 16, 1, true));
    this.add('hips', hemGeo, clothA, [0, 0.06 - hemLen / 2, 0], undefined, [1, 1, 0.72]);
    if (topShape.fur) this.add('hips', this.geo(new THREE.TorusGeometry(torsoW * (1.15 + hemLen * 0.5), 0.025, 6, 18)), fur, [0, 0.06 - hemLen, 0], [Math.PI / 2, 0, 0], [1, 0.72, 1]);
    else this.add('hips', this.geo(new THREE.TorusGeometry(torsoW * (1.15 + hemLen * 0.5), 0.012, 6, 18)), trim, [0, 0.06 - hemLen, 0], [Math.PI / 2, 0, 0], [1, 0.72, 1]);
    // Pelvis
    this.add('hips', this.geo(capsule(0.13 * fs.sx, 0.06, 10)), clothB, [0, 0.0, 0], undefined, [1.05, 1, 0.75]);

    // Belt
    const belt = cosmeticById(a.outfit.belt);
    if (belt && !EMPTY_SLOT_IDS.has(belt.id)) {
      const style = belt.shape.style;
      const bw = style === 'sash' || style === 'obi' ? 0.06 : 0.035;
      this.add('hips', this.geo(new THREE.CylinderGeometry(torsoW * 0.98, torsoW * 0.98, bw, 18, 1, true)), style === 'sash' ? accent : trim, [0, 0.08, 0], undefined, [1.02, 1, 0.74]);
      if (style === 'sash' || style === 'obi') this.add('hips', this.geo(new THREE.BoxGeometry(0.05, 0.16, 0.015)), accent, [-0.07, 0.0, 0.12], [0, 0, 0.15]);
    }

    // ---- Arms ----
    const sleeves = String(topShape.sleeves ?? 'long');
    const armR = 0.042 * muscle;
    for (const side of ['L', 'R'] as const) {
      const sx = side === 'L' ? 1 : -1;
      const ua = `upperArm${side}` as BoneName;
      const fa = `foreArm${side}` as BoneName;
      const hd = `hand${side}` as BoneName;
      // Shoulder cap
      this.add(ua, this.geo(new THREE.SphereGeometry(armR * 1.35, 10, 8)), sleeves === 'none' ? skin : clothA, [0, 0, 0]);
      const upperSleeve = sleeves !== 'none';
      const tattooLimb = a.tattoos === 'arrows' || a.tattoos === 'arrows_limbs' || a.tattoos === 'wind_bands';
      let limbSkin: THREE.MeshStandardMaterial = skin;
      if (tattooLimb) {
        const bands = a.tattoos === 'wind_bands';
        const t1 = paintLimbTattoo(a.tattooColor, false, bands);
        const t2 = paintLimbTattoo(a.tattooColor, true, bands);
        this.ownedTextures.push(t1, t2);
        limbSkin = this.mat(a.skinTone, 0.7, { map: t1, emissiveMap: t2, emissive: new THREE.Color(0x000000) });
        this.tattooMaterials.push(limbSkin);
      }
      this.add(ua, this.geo(capsule(armR * (upperSleeve ? 1.18 : 1), 0.2)), upperSleeve ? clothA : limbSkin, [0, -0.14, 0]);
      const longSleeve = sleeves === 'long' || sleeves === 'wide';
      this.add(fa, this.geo(capsule(armR * 0.88 * (longSleeve ? 1.2 : 1), 0.18)), longSleeve ? clothA : limbSkin, [0, -0.12, 0]);
      if (sleeves === 'wide') this.add(fa, this.geo(new THREE.CylinderGeometry(0.05, 0.085, 0.16, 12, 1, true)), clothA, [0, -0.2, 0]);
      if (sleeves === 'elbow' || sleeves === 'short') this.add(ua, this.geo(new THREE.TorusGeometry(armR * 1.2, 0.01, 6, 12)), trim, [0, sleeves === 'short' ? -0.12 : -0.24, 0], [Math.PI / 2, 0, 0]);
      // Hands / gloves
      const gloves = cosmeticById(a.outfit.gloves);
      const gloveStyle = gloves && !EMPTY_SLOT_IDS.has(gloves.id) ? String(gloves.shape.style) : null;
      const handMat = gloveStyle === 'mittens' ? fur : gloveStyle === 'wraps' || gloveStyle === 'fingerless' ? this.mat('#d9cfb8', 0.9) : skin;
      this.add(hd, this.geo(new THREE.SphereGeometry(0.042, 10, 8)), handMat, [0, -0.045, 0.005], undefined, [0.85, 1.15, 0.6]);
      this.add(hd, this.geo(new THREE.SphereGeometry(0.018, 8, 6)), skin, [sx * 0.035, -0.035, 0.02]);
      if (gloveStyle === 'bracers') this.add(fa, this.geo(new THREE.CylinderGeometry(armR * 1.15, armR * 1.25, 0.12, 10)), trim, [0, -0.2, 0]);
      void sx;
    }

    // ---- Legs ----
    const pantsStyle = String(bottom?.shape.style ?? 'trousers');
    const legR = 0.058 * (0.95 + a.build * 0.15);
    const wide = !!bottom?.shape.wide;
    for (const side of ['L', 'R'] as const) {
      const th = `thigh${side}` as BoneName;
      const sh = `shin${side}` as BoneName;
      const ft = `foot${side}` as BoneName;
      this.add(th, this.geo(capsule(legR * (wide ? 1.25 : 1.05), 0.3)), clothB, [0, -0.2, 0]);
      this.add(sh, this.geo(capsule(legR * (wide ? 1.12 : 0.9), 0.3)), clothB, [0, -0.2, 0]);
      if (pantsStyle === 'wrapped') this.add(sh, this.geo(new THREE.CylinderGeometry(legR * 1.0, legR * 0.95, 0.14, 10)), trim, [0, -0.33, 0]);
      // Footwear
      const fstyle = String(foot?.shape.style ?? 'boots');
      const bootH = Number(foot?.shape.height ?? 0.6);
      const bootMat = fstyle === 'fur_boots' ? fur : fstyle === 'sandals' || fstyle === 'wraps' ? this.mat('#c8b48a', 0.9) : this.mat(fstyle === 'armored' ? '#3a3330' : '#2b2420', 0.75);
      if (fstyle !== 'sandals') this.add(sh, this.geo(capsule(legR * 1.02, 0.12 * bootH)), bootMat, [0, -0.36 + 0.06 * (1 - bootH), 0]);
      this.add(ft, this.geo(new THREE.BoxGeometry(0.085, 0.06, 0.2)), bootMat, [0, -0.02, 0.045]);
      if (fstyle === 'sandals') this.add(ft, this.geo(new THREE.BoxGeometry(0.075, 0.04, 0.18)), skin, [0, 0.015, 0.04]);
    }
    if (pantsStyle === 'skirt' || pantsStyle === 'robe') {
      const skirtLen = pantsStyle === 'robe' ? 0.75 : 0.62;
      this.add('hips', this.geo(new THREE.CylinderGeometry(torsoW * 0.98, torsoW * 1.5, skirtLen, 18, 1, true)), clothB, [0, 0.02 - skirtLen / 2, 0], undefined, [1, 1, 0.8]);
    }

    // ---- Outer layer ----
    const outer = cosmeticById(a.outfit.outer);
    if (outer && !EMPTY_SLOT_IDS.has(outer.id)) {
      const st = String(outer.shape.style);
      if (st === 'mantle' || st === 'shawl') {
        this.add('chest', this.geo(new THREE.CylinderGeometry(0.11, 0.24 * fs.sx, 0.16, 18, 1, true)), st === 'mantle' ? accent : clothB, [0, 0.2, 0], undefined, [1, 1, 0.75]);
      } else if (st === 'cape' || st === 'cloak') {
        this.add('chest', this.geo(new THREE.PlaneGeometry(0.42, st === 'cloak' ? 1.05 : 0.95, 1, 4)), clothB, [0, -0.25, -0.13], [0.08, 0, 0]).material = this.mat(col.secondary, 0.9, { side: THREE.DoubleSide });
      } else if (st === 'fur_coat') {
        this.add('chest', this.geo(capsule(torsoW * 1.12, 0.16, 12)), fur, [0, 0.08, 0], undefined, [1, 1, 0.72]);
      } else if (st === 'vest') {
        this.add('chest', this.geo(capsule(torsoW * 1.06, 0.12, 12)), clothB, [0, 0.08, -0.005], undefined, [1, 1, 0.68]);
      } else if (st === 'shoulder_armor') {
        for (const sx of [1, -1]) this.add('chest', this.geo(new THREE.SphereGeometry(0.075, 10, 8, 0, Math.PI * 2, 0, Math.PI / 2)), trim, [sx * 0.2, 0.2, 0], [0, 0, -sx * 0.4]);
      }
    }
    if (topShape.armor) for (const sx of [1, -1]) this.add('chest', this.geo(new THREE.BoxGeometry(0.1, 0.03, 0.12)), trim, [sx * 0.19, 0.23, 0], [0, 0, -sx * 0.35]);

    // ---- Necklace ----
    const neck = cosmeticById(a.outfit.necklace);
    if (neck && !EMPTY_SLOT_IDS.has(neck.id)) {
      const st = String(neck.shape.style);
      const stone = this.mat(String(neck.shape.stone ?? '#4a8fd6'), 0.35, { metalness: 0.1 });
      if (st === 'choker') {
        this.add('neck', this.geo(new THREE.TorusGeometry(0.048, 0.008, 6, 18)), this.mat('#2f5fae', 0.6), [0, 0.0, 0.005], [Math.PI / 2, 0, 0]);
        this.add('neck', this.geo(new THREE.CylinderGeometry(0.016, 0.016, 0.006, 12)), stone, [0, -0.012, 0.052], [Math.PI / 2, 0, 0]);
      } else if (st === 'beads') {
        for (let i = 0; i < 14; i++) {
          const ang = (i / 14) * Math.PI * 2;
          this.add('chest', this.geo(new THREE.SphereGeometry(0.016, 8, 6)), stone, [Math.sin(ang) * 0.12, 0.2 - Math.max(0, Math.cos(ang)) * 0.09, Math.cos(ang) * 0.1 + 0.01]);
        }
      } else {
        this.add('neck', this.geo(new THREE.TorusGeometry(0.06, 0.004, 4, 18)), this.mat('#6a4a2a', 0.8), [0, -0.02, 0.01], [Math.PI / 2 + 0.5, 0, 0]);
        const pg = st === 'torc' ? new THREE.TorusGeometry(0.03, 0.008, 6, 12, Math.PI) : new THREE.OctahedronGeometry(0.022);
        this.add('chest', this.geo(pg), stone, [0, 0.19, 0.115]);
      }
    }

    // ---- Accessories ----
    const acc = cosmeticById(a.outfit.accessory);
    if (acc && !EMPTY_SLOT_IDS.has(acc.id)) {
      const st = String(acc.shape.style);
      if (st === 'glider_staff') {
        this.add('chest', this.geo(new THREE.CylinderGeometry(0.018, 0.018, 1.5, 8)), this.mat('#8a5a2a', 0.7), [0.06, 0.1, -0.2], [0, 0, 0.5]);
      } else if (st === 'flask') {
        this.add('hips', this.geo(new THREE.SphereGeometry(0.06, 10, 8)), this.mat('#7a5232', 0.7), [-0.17, -0.06, 0.04], undefined, [0.8, 1.2, 0.6]);
      } else if (st === 'swords') {
        for (const sx of [1, -1]) this.add('chest', this.geo(new THREE.BoxGeometry(0.03, 0.75, 0.02)), this.mat('#3a2a20', 0.6), [sx * 0.06, 0.05, -0.17], [0, 0, sx * 0.25]);
      } else if (st === 'satchel') {
        this.add('hips', this.geo(new THREE.BoxGeometry(0.16, 0.12, 0.06)), this.mat('#7a5a3a', 0.85), [0.18, -0.05, -0.02]);
      }
    }

    // ---- Facial hair / scars ----
    if (a.facialHair !== 'none') {
      const fh = this.mat(a.hair.color, 0.95);
      if (a.facialHair === 'goatee' || a.facialHair.startsWith('beard')) {
        const long = a.facialHair === 'beard_long';
        this.add('head', this.geo(new THREE.ConeGeometry(0.035, long ? 0.16 : 0.07, 10)), fh, [0, long ? -0.03 : 0.0, 0.085], [Math.PI, 0, 0]);
      }
      if (a.facialHair === 'mustache') for (const sx of [1, -1]) this.add('head', this.geo(capsule(0.006, 0.06)), fh, [sx * 0.03, 0.045, 0.105], [0, 0, sx * 0.9]);
    }
    for (const s of a.scars) {
      if (s === 'eye_burn_l') this.add('head', this.geo(new THREE.CircleGeometry(0.03, 12)), this.mat('#b0584a', 0.9), [0.045, 0.12, 0.108], [0, 0.35, 0]);
      if (s === 'cheek_r') this.add('head', this.geo(new THREE.BoxGeometry(0.004, 0.035, 0.004)), this.mat('#b07a6a', 0.9), [-0.06, 0.07, 0.1], [0, 0, 0.5]);
    }

    for (const g of this.parts.values()) g.traverse((o) => ((o as THREE.Mesh).castShadow = this.castShadow));
  }

  private buildHair(a: Appearance): void {
    const style = a.hair.style;
    if (style === 'bald') return;
    const hm = this.mat(a.hair.color, 0.95);
    const cap = this.geo(new THREE.SphereGeometry(0.122, 20, 14, 0, Math.PI * 2, 0, style === 'short_crop' ? Math.PI * 0.42 : Math.PI * 0.55));
    this.add('head', cap, hm, [0, 0.11, -0.008], [-0.25, 0, 0], [0.98, 1.08, 1.04]);
    const add = (geo: THREE.BufferGeometry, pos: [number, number, number], rot?: [number, number, number], scale?: [number, number, number]) => this.add('head', this.geo(geo), hm, pos, rot, scale);
    switch (style) {
      case 'topknot':
      case 'topknot_crown':
        add(new THREE.SphereGeometry(0.04, 12, 10), [0, 0.24, -0.02]);
        break;
      case 'wolf_tail':
        add(new THREE.SphereGeometry(0.03, 10, 8), [0, 0.2, -0.09]);
        add(new THREE.ConeGeometry(0.025, 0.12, 8), [0, 0.16, -0.14], [-2.2, 0, 0]);
        break;
      case 'hair_loops':
        add(new THREE.TorusGeometry(0.03, 0.009, 6, 12), [0.08, 0.06, 0.08], [0, Math.PI / 2, 0]);
        add(new THREE.TorusGeometry(0.03, 0.009, 6, 12), [-0.08, 0.06, 0.08], [0, Math.PI / 2, 0]);
        add(new THREE.CylinderGeometry(0.03, 0.012, 0.42, 8), [0, -0.1, -0.12], [0.2, 0, 0]);
        break;
      case 'long_braid':
        add(new THREE.CylinderGeometry(0.028, 0.012, 0.5, 8), [0, -0.12, -0.12], [0.15, 0, 0]);
        break;
      case 'twin_braids':
        add(new THREE.CylinderGeometry(0.022, 0.01, 0.35, 8), [0.07, -0.06, -0.08], [0.15, 0, 0.1]);
        add(new THREE.CylinderGeometry(0.022, 0.01, 0.35, 8), [-0.07, -0.06, -0.08], [0.15, 0, -0.1]);
        break;
      case 'high_ponytail':
        add(new THREE.ConeGeometry(0.035, 0.32, 8), [0, 0.12, -0.16], [-2.6, 0, 0]);
        break;
      case 'bun':
        add(new THREE.SphereGeometry(0.05, 12, 10), [0, 0.2, -0.08]);
        break;
      case 'double_buns':
        add(new THREE.SphereGeometry(0.04, 12, 10), [0.08, 0.2, -0.04]);
        add(new THREE.SphereGeometry(0.04, 12, 10), [-0.08, 0.2, -0.04]);
        break;
      case 'long_loose':
        add(new THREE.BoxGeometry(0.22, 0.34, 0.05), [0, -0.04, -0.1], [0.12, 0, 0]);
        break;
      case 'bob':
        add(new THREE.CylinderGeometry(0.13, 0.135, 0.13, 16, 1, true), [0, 0.06, -0.01]);
        break;
      case 'spiky':
        for (let i = 0; i < 7; i++) add(new THREE.ConeGeometry(0.03, 0.09, 6), [Math.sin(i) * 0.06, 0.2, Math.cos(i * 1.7) * 0.05 - 0.02], [Math.sin(i) * 0.6, 0, Math.cos(i) * 0.6]);
        break;
      case 'side_shave':
        add(new THREE.BoxGeometry(0.06, 0.05, 0.22), [0.04, 0.22, -0.01]);
        break;
      default:
        break;
    }
  }

  /** Avatar State glow (0..1 each). Eye glow is strong white-blue; tattoos glow if present. */
  setGlow(eyes: number, tattoos: number, color?: THREE.ColorRepresentation): void {
    this.eyeGlow = eyes;
    this.tattooGlow = tattoos;
    if (color !== undefined) this.glowColor.set(color);
    if (this.eyeMaterial) {
      this.eyeMaterial.emissive.copy(this.glowColor).multiplyScalar(eyes * 6);
      this.eyeMaterial.color.set(eyes > 0.5 ? '#ffffff' : this.appearance.eyes.color);
    }
    for (const m of this.tattooMaterials) {
      m.emissive.copy(this.glowColor).multiplyScalar(tattoos * 5);
    }
  }

  get hasTattoos(): boolean {
    return this.tattooMaterials.length > 0;
  }

  /** Brief additive colour flash on all owned materials (hit feedback). */
  flash(color: THREE.ColorRepresentation = '#ffffff', duration = 0.12): void {
    this.flashColor.set(color);
    this.flashTime = duration;
  }

  update(dt: number): void {
    this.animator.update(dt);
    if (this.flashTime > 0) {
      this.flashTime -= dt;
      const k = Math.max(0, this.flashTime) * 8;
      for (const m of this.flashMats) {
        if (this.tattooMaterials.includes(m) || m === this.eyeMaterial) continue;
        m.emissive.copy(this.flashColor).multiplyScalar(k);
      }
    }
  }

  dispose(): void {
    this.clearVisuals();
  }

  static boneNames(): readonly BoneName[] {
    return BONE_NAMES;
  }
}
