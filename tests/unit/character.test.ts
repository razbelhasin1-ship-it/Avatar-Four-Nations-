import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { getClip, solveLegIK } from '../../src/character/Animator';
import { cloneAppearance, DEFAULT_APPEARANCE, HAIRSTYLES, sanitizeAppearance, withBodyType, type Appearance } from '../../src/character/Appearance';
import { shapeKey } from '../../src/character/CharacterBuild';
import { rigLayout } from '../../src/character/CharShape';
import { legAt, mirrorPose, stance } from '../../src/character/combatClips';
import '../../src/character/clips';
import { creatorPresets, isSuggestedName, npcLook, OUTFIT_PRESETS, normalizeName, randomLook, suggestName, validateName, withPreset } from '../../src/character/looks';
import { Random } from '../../src/core/Random';
import { cosmeticById, EMPTY_SLOT_IDS } from '../../src/data/cosmetics';

const water = DEFAULT_APPEARANCE.water;

function outfitValid(a: Appearance): void {
  for (const [slot, id] of Object.entries(a.outfit)) {
    if (EMPTY_SLOT_IDS.has(id)) continue;
    const def = cosmeticById(id);
    expect(def, `${slot}=${id}`).toBeDefined();
    expect(def!.slot).toBe(slot);
  }
}

describe('body type', () => {
  it('female refits the look, keeps colours and outfit, and survives a save round trip', () => {
    const f = withBodyType(DEFAULT_APPEARANCE.water, 'female', 'water');
    expect(f.body).toBe('female');
    expect(f.facialHair).toBe('none');
    expect(f.hair.style).not.toBe(DEFAULT_APPEARANCE.water.hair.style);
    expect(f.outfit).toEqual(DEFAULT_APPEARANCE.water.outfit);
    expect(f.skinTone).toBe(DEFAULT_APPEARANCE.water.skinTone);
    expect(sanitizeAppearance(JSON.parse(JSON.stringify(f)), water)).toEqual(f);
    expect(withBodyType(f, 'male', 'water').hair.style).toBe(DEFAULT_APPEARANCE.water.hair.style);
    expect(sanitizeAppearance({ body: 'robot' }, water).body).toBe('male');
  });

  it('female rig has narrower shoulders and wider hips; geometry differs', () => {
    const m = rigLayout('average', 'male');
    const f = rigLayout('average', 'female');
    expect(f.dims.shoulder).toBeLessThan(m.dims.shoulder);
    expect(f.dims.hipW).toBeGreaterThan(m.dims.hipW);
    expect(f.pos.upperArmL[0]).toBeLessThan(m.pos.upperArmL[0]);
    const fa = withBodyType(water, 'female', 'water');
    expect(shapeKey(fa, 0)).not.toBe(shapeKey({ ...fa, body: 'male' }, 0));
  });

  it('name suggestions follow the body type', () => {
    const rng = new Random(5);
    for (let i = 0; i < 20; i++) {
      const n = suggestName('fire', rng, 'female');
      expect(isSuggestedName(n)).toBe(true);
      expect(['Riku', 'Hiro', 'Kenji', 'Ren', 'Daichi', 'Haru', 'Takeo', 'Kaito']).not.toContain(n);
    }
    expect(isSuggestedName('Zuko-ish')).toBe(false);
  });
});

describe('sanitizeAppearance', () => {
  it('returns a clone of the fallback for missing or garbage data', () => {
    for (const raw of [undefined, null, 42, 'x', []]) {
      const a = sanitizeAppearance(raw, water);
      expect(a).toEqual(water);
      expect(a).not.toBe(water);
    }
  });

  it('round-trips every default look unchanged', () => {
    for (const a of Object.values(DEFAULT_APPEARANCE)) expect(sanitizeAppearance(JSON.parse(JSON.stringify(a)), water)).toEqual(a);
  });

  it('clamps numbers and rejects non-finite values', () => {
    const a = sanitizeAppearance({ height: 9, build: -3, face: { preset: 17.4, jaw: 5, cheeks: NaN, nose: -Infinity, eyeSpacing: '1' }, brows: { style: 2.6, thickness: 4 } }, water);
    expect(a.height).toBe(1.12);
    expect(a.build).toBe(0);
    expect(a.face.preset).toBe(5);
    expect(a.face.jaw).toBe(1);
    expect(a.face.cheeks).toBe(water.face.cheeks);
    expect(a.face.nose).toBe(water.face.nose);
    expect(a.face.eyeSpacing).toBe(water.face.eyeSpacing);
    expect(a.brows.style).toBe(3);
    expect(a.brows.thickness).toBe(1);
  });

  it('accepts only hex colours', () => {
    const a = sanitizeAppearance({ skinTone: 'red', hair: { color: '#ABC' }, eyes: { color: 'url(x)' }, colors: { primary: '#123456', trim: 7 }, tattooColor: '#zzzzzz' }, water);
    expect(a.skinTone).toBe(water.skinTone);
    expect(a.hair.color).toBe('#abc');
    expect(a.eyes.color).toBe(water.eyes.color);
    expect(a.colors.primary).toBe('#123456');
    expect(a.colors.trim).toBe(water.colors.trim);
    expect(a.tattooColor).toBe(water.tattooColor);
  });

  it('rejects unknown styles and ids', () => {
    const a = sanitizeAppearance({ frame: 'giant', hair: { style: 'mohawk' }, facialHair: 'braids', tattoos: 'tribal', eyes: { shape: 'square' }, scars: ['chin', 'chin', 'nope', 3, 'brow_l'] }, water);
    expect(a.frame).toBe(water.frame);
    expect(a.hair.style).toBe(water.hair.style);
    expect(a.facialHair).toBe(water.facialHair);
    expect(a.tattoos).toBe(water.tattoos);
    expect(a.eyes.shape).toBe(water.eyes.shape);
    expect(a.scars).toEqual(['chin', 'brow_l']);
  });

  it('keeps valid outfit ids and rejects ids from the wrong slot', () => {
    const a = sanitizeAppearance({ outfit: { top: 'fire_tunic', bottom: 'air_glider', headwear: 'none_head', necklace: 'does_not_exist', outer: 'none' } }, water);
    expect(a.outfit.top).toBe('fire_tunic');
    expect(a.outfit.bottom).toBe(water.outfit.bottom);
    expect(a.outfit.headwear).toBe('none_head');
    expect(a.outfit.necklace).toBe(water.outfit.necklace);
    expect(a.outfit.outer).toBe('none');
  });

  it('tolerates partial data', () => {
    const a = sanitizeAppearance({ hair: { style: 'spiky' } }, water);
    expect(a.hair.style).toBe('spiky');
    expect(a.hair.color).toBe(water.hair.color);
    expect(a.outfit).toEqual(water.outfit);
  });
});

describe('names', () => {
  it('validates player names', () => {
    expect(validateName('Tenzin')).toBeNull();
    expect(validateName("Ta'ar Lin-Su")).toBeNull();
    expect(validateName('Ōma')).toBeNull();
    expect(validateName('A')).not.toBeNull();
    expect(validateName('   ')).not.toBeNull();
    expect(validateName('x'.repeat(21))).not.toBeNull();
    expect(validateName('Zuko!!')).not.toBeNull();
    expect(validateName('1Aang')).not.toBeNull();
    expect(validateName('Ka  Ya')).not.toBeNull();
    expect(validateName('Kaya-')).not.toBeNull();
  });
  it('normalises names', () => {
    expect(normalizeName('  tenzin   of  air ')).toBe('Tenzin of air');
  });
});

describe('looks', () => {
  it('creator presets only use creator-available items and cover every nation', () => {
    for (const n of ['air', 'water', 'earth', 'fire'] as const) {
      const ps = creatorPresets(n);
      expect(ps.length).toBeGreaterThanOrEqual(2);
      for (const p of ps) {
        const a = withPreset(water, p.id);
        outfitValid(a);
        for (const id of Object.values(p.outfit)) if (!EMPTY_SLOT_IDS.has(id)) expect(cosmeticById(id)!.unlock, id).toBe('start');
      }
    }
    for (const p of OUTFIT_PRESETS) outfitValid(withPreset(water, p.id));
  });

  it('random creator looks are valid appearances', () => {
    const rng = new Random(7);
    for (let i = 0; i < 40; i++) {
      const n = (['air', 'water', 'earth', 'fire'] as const)[i % 4];
      const a = randomLook(n, rng);
      expect(sanitizeAppearance(JSON.parse(JSON.stringify(a)), water)).toEqual(a);
    }
  });

  it('NPC looks are deterministic, valid, varied and nation-appropriate', () => {
    expect(npcLook(123, 'fire', 'villager')).toEqual(npcLook(123, 'fire', 'villager'));
    const keys = new Set<string>();
    for (let i = 0; i < 40; i++) {
      const nation = ['water', 'earth', 'fire', 'air'][i % 4];
      const a = npcLook(1000 + i * 17, nation, 'villager');
      expect(sanitizeAppearance(JSON.parse(JSON.stringify(a)), water)).toEqual(a);
      outfitValid(a);
      keys.add(JSON.stringify([a.hair, a.skinTone, a.outfit.top, a.colors.primary, a.face.preset]));
    }
    expect(keys.size).toBeGreaterThan(30);
    const monk = npcLook(5, 'air', 'monk');
    expect(monk.hair.style).toBe('bald');
    expect(monk.tattoos).toBe('arrows');
    expect(npcLook(9, 'fire', 'guard').outfit.top).toBe('fire_armor_light');
    expect(npcLook(9, 'earth', 'soldier').outfit.top).toBe('earth_soldier_armor');
    expect(npcLook(3, 'water', 'villager').outfit.top.startsWith('water_')).toBe(true);
    const child = npcLook(11, 'earth', 'child');
    expect(child.height).toBeLessThan(0.8);
    expect(HAIRSTYLES.some((h) => h.id === npcLook(4, 'neutral', 'merchant').hair.style)).toBe(true);
  });
});

describe('animation helpers', () => {
  const HIP_Y = 0.905, HIP_X = 0.093, THIGH = 0.425, SHIN = 0.415;
  /** Forward kinematics of a posed leg (hips unrotated) → ankle position in root space. */
  function ankle(side: 'L' | 'R', pose: Record<string, unknown>): THREE.Vector3 {
    const s = side === 'L' ? 1 : -1;
    const hy = (pose.hipsY as number) ?? 0, hz = (pose.hipsZ as number) ?? 0, hx = (pose.hipsX as number) ?? 0;
    const th = pose[`thigh${side}`] as [number, number, number];
    const sh = pose[`shin${side}`] as [number, number, number];
    const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(...th));
    const p = new THREE.Vector3(s * HIP_X + hx, HIP_Y + hy, hz);
    p.add(new THREE.Vector3(0, -THIGH, 0).applyQuaternion(q));
    q.multiply(new THREE.Quaternion().setFromEuler(new THREE.Euler(...sh)));
    p.add(new THREE.Vector3(0, -SHIN, 0).applyQuaternion(q));
    return p;
  }

  it('solveLegIK reaches reachable targets', () => {
    const ik = solveLegIK(0.05, -0.7, 0.2, THIGH, SHIN);
    const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(ik.thighX, 0, ik.thighZ));
    const p = new THREE.Vector3(0, -THIGH, 0).applyQuaternion(q);
    q.multiply(new THREE.Quaternion().setFromEuler(new THREE.Euler(ik.shin, 0, 0)));
    p.add(new THREE.Vector3(0, -SHIN, 0).applyQuaternion(q));
    expect(p.distanceTo(new THREE.Vector3(0.05, -0.7, 0.2))).toBeLessThan(0.01);
  });

  it('legAt / stance plant the ankles on the ground', () => {
    const p = { ...stance(0.24, 0.1, -0.3, 0.04), hipsY: -0.3, hipsZ: 0.04 };
    for (const side of ['L', 'R'] as const) {
      const a = ankle(side, p);
      expect(a.y).toBeCloseTo(0.065, 2);
      expect(Math.abs(a.x)).toBeCloseTo(0.24, 1);
    }
    const one = legAt('R', 0.2, 0.15, -0.2);
    const a = ankle('R', { ...one, hipsY: -0.2 });
    expect(a.distanceTo(new THREE.Vector3(-0.2, 0.065, 0.15))).toBeLessThan(0.02);
  });

  it('mirrorPose swaps sides and is an involution', () => {
    const p = { upperArmR: [-1.5, 0.2, 0.1] as [number, number, number], spine: [0.1, 0.3, 0.05] as [number, number, number], fistR: 1, hipsX: 0.02, hipsY: -0.1 };
    const m = mirrorPose(p);
    expect(m.upperArmL).toEqual([-1.5, -0.2, -0.1]);
    expect(m.upperArmR).toBeUndefined();
    expect(m.spine).toEqual([0.1, -0.3, -0.05]);
    expect(m.fistL).toBe(1);
    expect(m.hipsX).toBe(-0.02);
    expect(m.hipsY).toBe(-0.1);
    expect(mirrorPose(m)).toEqual(p);
  });

  it('registers the combat motion library with release events inside each clip', () => {
    const ids = ['strike_r', 'strike_l', 'kick_front', 'kick_spin', 'sweep_low', 'push_two', 'stomp', 'lift_up', 'slam_down', 'circle_arms', 'whip_r', 'whip_l', 'raise_two', 'spin_360', 'release_forward', 'breath', 'leap_strike', 'block_cross'];
    for (const id of ids) {
      const c = getClip(id);
      expect(c, id).toBeDefined();
      const rel = c!.events?.find((e) => e.name === 'release');
      expect(rel, id).toBeDefined();
      expect(rel!.t).toBeGreaterThan(0);
      expect(rel!.t).toBeLessThan(c!.duration);
      for (const k of c!.keys) expect(k.t).toBeLessThanOrEqual(c!.duration);
    }
    expect(getClip('charge_hold')?.loop).toBe(true);
    for (const id of ['dodge_air', 'dodge_water', 'dodge_earth', 'dodge_fire']) expect(getClip(id)?.mask).toBe('full');
  });
});

describe('cloneAppearance', () => {
  it('deep-copies', () => {
    const a = cloneAppearance(water);
    a.outfit.top = 'x';
    a.scars.push('chin');
    expect(water.outfit.top).not.toBe('x');
    expect(water.scars).toEqual([]);
  });
});

describe('Animator feet planting', () => {
  it('keeps planted feet on the ground while an upper-body clip crouches and lunges', async () => {
    const { Animator, BONE_NAMES } = await import('../../src/character/Animator');
    const { BONE_PARENT, rigLayout } = await import('../../src/character/CharShape');
    const root = new THREE.Group();
    const bones = {} as Record<string, THREE.Object3D>;
    const rig = rigLayout('average');
    for (const n of BONE_NAMES) {
      bones[n] = new THREE.Object3D();
      bones[n].position.set(...rig.offset[n]);
    }
    for (const n of BONE_NAMES) (BONE_PARENT[n] ? bones[BONE_PARENT[n]!] : root).add(bones[n]);
    const an = new Animator(bones as never);
    const feet = () => {
      root.updateMatrixWorld(true);
      return (['footL', 'footR'] as const).map((f) => bones[f].getWorldPosition(new THREE.Vector3()));
    };
    for (let i = 0; i < 30; i++) an.update(1 / 30);
    const idle = feet();
    for (const p of idle) expect(p.y).toBeCloseTo(0.065, 2);
    an.play('push_two', { fadeIn: 0 });
    for (let i = 0; i < 8; i++) an.update(0.03); // t = 0.24: deepest lunge (hipsY -0.12, hipsZ +0.08)
    expect(bones.hips.position.y).toBeLessThan(0.95 - 0.08);
    const lunge = feet();
    for (let k = 0; k < 2; k++) expect(lunge[k].distanceTo(idle[k])).toBeLessThan(0.02);
  });
});
