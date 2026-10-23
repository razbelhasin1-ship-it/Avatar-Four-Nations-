import * as THREE from 'three';
import type { Appearance } from '../character/Appearance';
import type { Humanoid } from '../character/Humanoid';
import { npcLook } from '../character/looks';
import { Random } from '../core/Random';
import type { EnemyLook, PropId } from '../data/enemies';

/**
 * Enemy appearances (built on the character module's NPC look generator, so
 * every foe is a real procedural humanoid with nation-coherent clothing) and
 * the few props the cosmetic catalogue does not have: Fire Nation helmets with
 * skull face plates, Dai Li conical hats and stone gloves, spears, bows,
 * cutlasses, dao swords and bandanas. Props attach to Humanoid anchors and own
 * their geometry/materials (disposed with the enemy).
 */

type Palette = Appearance['colors'];

const BANDIT_PALETTES: Palette[] = [
  { primary: '#5a5a2e', secondary: '#4a3524', accent: '#8a7a50', trim: '#2a2016' },
  { primary: '#6b4a2a', secondary: '#3f4a26', accent: '#9a8458', trim: '#2a1e12' },
  { primary: '#4a5a34', secondary: '#5e4630', accent: '#7f7350', trim: '#22261a' },
  { primary: '#7a6440', secondary: '#384028', accent: '#a08a5a', trim: '#2e2414' },
];

const PIRATE_PALETTES: Palette[] = [
  { primary: '#3c4e62', secondary: '#24282e', accent: '#a8b0b8', trim: '#5a2a20' },
  { primary: '#2e4a5e', secondary: '#3a3a3e', accent: '#c8c0a8', trim: '#1c2026' },
  { primary: '#4a5866', secondary: '#1e2a36', accent: '#d0c8b0', trim: '#6a3a24' },
];

const DAI_LI: Palette = { primary: '#1d3a26', secondary: '#0f1712', accent: '#a8905a', trim: '#0b120d' };

/** Deterministic appearance for an enemy look (same seed → same face). */
export function enemyAppearance(look: EnemyLook, seed: number): Appearance {
  const rng = new Random(seed * 31 + 7);
  let a: Appearance;
  switch (look) {
    case 'fire_soldier':
      a = npcLook(seed, 'fire', 'soldier');
      a.outfit.headwear = 'none_head';
      a.hair.style = 'short_crop';
      break;
    case 'fire_archer':
      a = npcLook(seed, 'fire', 'soldier');
      a.outfit.outer = 'none';
      a.outfit.headwear = 'none_head';
      a.colors = { primary: '#3a1512', secondary: '#141012', accent: '#8a2018', trim: '#0e0a0a' };
      a.hair.style = rng.pick(['topknot', 'high_ponytail', 'short_crop']);
      break;
    case 'fire_elite':
      a = npcLook(seed, 'fire', 'student');
      Object.assign(a.outfit, { top: 'fire_training', bottom: 'fire_trousers', footwear: 'fire_boots', gloves: 'fire_bracers', belt: 'fire_belt', headwear: 'fire_hair_crown', outer: 'none', necklace: 'none_neck', accessory: 'none_acc' });
      a.colors = { primary: '#9a1c14', secondary: '#1a1212', accent: '#d8a040', trim: '#4a0e0a' };
      a.hair.style = 'topknot';
      a.frame = 'athletic';
      a.build = 0.7;
      break;
    case 'fire_commander':
      a = npcLook(seed, 'fire', 'soldier');
      a.outfit.outer = 'fire_cloak';
      a.outfit.headwear = 'none_head';
      a.colors = { primary: '#6a120e', secondary: '#141010', accent: '#c8a040', trim: '#2a0806' };
      a.facialHair = 'sideburns';
      a.frame = 'broad';
      a.build = 0.85;
      break;
    case 'bandit':
    case 'bandit_spear':
    case 'bandit_archer':
      a = npcLook(seed, 'earth', 'villager');
      Object.assign(a.outfit, { headwear: 'none_head', necklace: 'none_neck', accessory: 'none_acc', gloves: rng.chance(0.5) ? 'earth_wraps' : 'fingerless', belt: 'rope_belt' });
      a.outfit.top = rng.pick(['earth_tunic', 'earth_traveler']);
      a.outfit.outer = look === 'bandit_spear' && rng.chance(0.6) ? 'earth_shoulder_guard' : rng.chance(0.45) ? 'earth_vest' : 'none';
      a.colors = { ...rng.pick(BANDIT_PALETTES) };
      a.hair.style = rng.pick(['messy_short', 'wolf_tail', 'spiky', 'side_shave', 'long_loose']);
      if (rng.chance(0.4)) a.facialHair = rng.pick(['stubble', 'goatee', 'beard_short', 'mustache']);
      if (rng.chance(0.3)) a.scars = [rng.pick(['cheek_r', 'brow_l', 'chin'])];
      break;
    case 'dai_li':
    case 'dai_li_captain':
      a = npcLook(seed, 'earth', 'noble');
      Object.assign(a.outfit, { top: 'earth_basingse_robe', bottom: 'earth_robe_skirt', footwear: 'earth_boots', belt: 'earth_belt', gloves: 'none_gloves', headwear: 'none_head', necklace: 'none_neck', accessory: 'none_acc', outer: look === 'dai_li_captain' ? 'earth_shoulder_guard' : 'none' });
      a.colors = look === 'dai_li_captain' ? { ...DAI_LI, accent: '#d0b060', trim: '#3a2e14' } : { ...DAI_LI };
      a.hair.style = rng.pick(['short_crop', 'long_braid', 'bun']);
      a.facialHair = look === 'dai_li_captain' ? 'mustache' : 'none';
      a.frame = 'athletic';
      break;
    case 'water_pirate':
      a = npcLook(seed, 'water', 'default');
      Object.assign(a.outfit, { top: 'water_tunic', bottom: 'water_trousers', footwear: 'water_fur_boots', gloves: 'fingerless', belt: 'rope_belt', headwear: 'none_head', accessory: 'none_acc', outer: 'none' });
      a.outfit.necklace = rng.chance(0.4) ? 'water_shell' : 'none_neck';
      a.colors = { ...rng.pick(PIRATE_PALETTES) };
      a.hair.style = rng.pick(['wolf_tail', 'messy_short', 'long_loose', 'side_shave']);
      break;
    case 'pirate':
      a = npcLook(seed, 'earth', 'villager');
      Object.assign(a.outfit, { top: rng.pick(['earth_traveler', 'earth_tunic']), bottom: 'earth_trousers', footwear: 'earth_boots', gloves: 'fingerless', belt: 'rope_belt', headwear: 'none_head', necklace: 'none_neck', accessory: 'none_acc', outer: rng.chance(0.4) ? 'earth_vest' : 'none' });
      a.colors = { ...rng.pick(PIRATE_PALETTES) };
      a.hair.style = rng.pick(['messy_short', 'spiky', 'side_shave', 'bald']);
      if (rng.chance(0.5)) a.facialHair = rng.pick(['stubble', 'goatee', 'beard_short', 'mustache']);
      if (rng.chance(0.35)) a.scars = [rng.pick(['cheek_r', 'brow_l', 'chin'])];
      break;
    case 'pirate_captain':
    default:
      a = npcLook(seed, 'earth', 'villager');
      Object.assign(a.outfit, { top: 'earth_traveler', bottom: 'earth_trousers', footwear: 'earth_boots', gloves: 'fingerless', belt: 'earth_belt', headwear: 'none_head', necklace: 'none_neck', accessory: 'none_acc', outer: 'fire_cloak' });
      a.colors = { primary: '#1c2a3a', secondary: '#0e1014', accent: '#c8a040', trim: '#5a1a14' };
      a.hair.style = 'long_loose';
      a.facialHair = 'mustache';
      a.scars = ['cheek_r'];
      a.frame = 'broad';
      break;
  }
  return a;
}

// -----------------------------------------------------------------------------
// Props
// -----------------------------------------------------------------------------

export interface PropSet {
  objects: THREE.Object3D[];
  dispose(): void;
}

function std(color: string, rough = 0.8, metal = 0): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({ color, roughness: rough, metalness: metal });
}

/** Attach props to a humanoid's anchors. `tint` is the faction trim colour (bandanas, hat bands). */
export function attachProps(h: Humanoid, props: readonly PropId[], tint: string, accent: string): PropSet {
  const geos: THREE.BufferGeometry[] = [];
  const mats: THREE.Material[] = [];
  const objects: THREE.Object3D[] = [];
  const mesh = (g: THREE.BufferGeometry, m: THREE.Material, parent: THREE.Object3D, p?: [number, number, number], r?: [number, number, number]): THREE.Mesh => {
    geos.push(g);
    const o = new THREE.Mesh(g, m);
    o.castShadow = true;
    if (p) o.position.set(p[0], p[1], p[2]);
    if (r) o.rotation.set(r[0], r[1], r[2]);
    parent.add(o);
    return o;
  };
  const mat = (m: THREE.Material): THREE.Material => {
    mats.push(m);
    return m;
  };
  const group = (parent: THREE.Object3D): THREE.Group => {
    const g = new THREE.Group();
    parent.add(g);
    objects.push(g);
    return g;
  };
  const head = h.anchors.head;
  for (const p of props) {
    switch (p) {
      case 'helmet':
      case 'helmet_crest': {
        const g = group(head);
        const shell = mat(std(p === 'helmet_crest' ? '#4a0c08' : '#3a1210', 0.5, 0.35));
        const plate = mat(std('#cfc8bc', 0.55, 0.1));
        mesh(new THREE.SphereGeometry(0.148, 14, 8, 0, Math.PI * 2, 0, Math.PI * 0.55), shell, g, [0, -0.012, -0.004]);
        mesh(new THREE.TorusGeometry(0.15, 0.014, 5, 18), shell, g, [0, -0.03, -0.004], [Math.PI / 2, 0, 0]);
        // Skull-like face plate with eye slits (dark inset boxes).
        mesh(new THREE.BoxGeometry(0.15, 0.09, 0.03), plate, g, [0, -0.07, 0.118], [0.12, 0, 0]);
        const dark = mat(std('#120a08', 0.9));
        mesh(new THREE.BoxGeometry(0.045, 0.016, 0.012), dark, g, [0.035, -0.05, 0.134], [0.12, 0, 0]);
        mesh(new THREE.BoxGeometry(0.045, 0.016, 0.012), dark, g, [-0.035, -0.05, 0.134], [0.12, 0, 0]);
        // Neck guard flap.
        mesh(new THREE.BoxGeometry(0.2, 0.08, 0.02), shell, g, [0, -0.1, -0.13], [-0.25, 0, 0]);
        if (p === 'helmet_crest') {
          const gold = mat(std(accent, 0.35, 0.7));
          mesh(new THREE.BoxGeometry(0.02, 0.12, 0.22), gold, g, [0, 0.13, -0.01]);
          mesh(new THREE.ConeGeometry(0.03, 0.12, 6), gold, g, [0, 0.2, 0.08], [0.6, 0, 0]);
        } else {
          const red = mat(std('#8a1a12', 0.6));
          mesh(new THREE.ConeGeometry(0.022, 0.07, 6), red, g, [0, 0.135, 0.02]);
        }
        break;
      }
      case 'conical_hat': {
        const g = group(head);
        const hat = mat(std('#16241a', 0.85));
        const band = mat(std(accent, 0.5, 0.3));
        mesh(new THREE.ConeGeometry(0.34, 0.17, 18, 1, true), hat, g, [0, 0.1, 0]);
        mesh(new THREE.CylinderGeometry(0.335, 0.335, 0.012, 18, 1, true), band, g, [0, 0.018, 0]);
        (hat as THREE.MeshStandardMaterial).side = THREE.DoubleSide;
        break;
      }
      case 'stone_gloves': {
        const stone = mat(std('#6e6658', 0.95));
        for (const a of [h.anchors.handL, h.anchors.handR]) {
          const g = group(a);
          mesh(new THREE.DodecahedronGeometry(0.068, 0), stone, g, [0, 0.0, 0.004]);
          mesh(new THREE.DodecahedronGeometry(0.05, 0), stone, g, [0, 0.06, 0.0], [0.4, 0.3, 0]);
        }
        break;
      }
      case 'spear': {
        const g = group(h.anchors.handR);
        const wood = mat(std('#6a4a2a', 0.85));
        const steel = mat(std('#b8bcc4', 0.3, 0.8));
        mesh(new THREE.CylinderGeometry(0.016, 0.018, 2.2, 6), wood, g, [0, 0, 0.35], [Math.PI / 2, 0, 0]);
        mesh(new THREE.ConeGeometry(0.04, 0.24, 6), steel, g, [0, 0, 1.56], [Math.PI / 2, 0, 0]);
        mesh(new THREE.TorusGeometry(0.03, 0.01, 4, 8), mat(std(tint, 0.8)), g, [0, 0, 1.4]);
        break;
      }
      case 'bow': {
        const g = group(h.anchors.handL);
        const wood = mat(std('#4a2e18', 0.7));
        const arc = Math.PI * 0.7;
        const bow = mesh(new THREE.TorusGeometry(0.62, 0.015, 4, 16, arc), wood, g, [0, 0, -0.5], [0, Math.PI / 2, Math.PI / 2 - arc / 2]);
        void bow;
        const sl = 2 * 0.62 * Math.sin(arc / 2);
        mesh(new THREE.CylinderGeometry(0.003, 0.003, sl, 3), mat(std('#e8e0d0', 0.9)), g, [0, 0, -0.5 + 0.62 * Math.cos(arc / 2)], [Math.PI / 2, 0, 0]);
        break;
      }
      case 'quiver': {
        const g = group(h.anchors.back);
        const leather = mat(std('#3a2416', 0.9));
        const fl = mat(std('#d8d0c0', 0.9));
        mesh(new THREE.CylinderGeometry(0.06, 0.05, 0.5, 8), leather, g, [0.08, 0.05, -0.02], [0, 0, 0.35]);
        for (let i = 0; i < 4; i++) mesh(new THREE.ConeGeometry(0.018, 0.08, 4), fl, g, [0.16 + i * 0.012, 0.3 + (i % 2) * 0.02, -0.02 + (i - 1.5) * 0.015], [0, 0, 0.35]);
        break;
      }
      case 'club': {
        const g = group(h.anchors.handR);
        const steel = mat(std('#a8acb4', 0.35, 0.75));
        const grip = mat(std('#2a1a10', 0.9));
        mesh(new THREE.BoxGeometry(0.05, 0.012, 0.62), steel, g, [0, 0, 0.42], [0, 0, 0]);
        mesh(new THREE.BoxGeometry(0.11, 0.025, 0.03), grip, g, [0, 0, 0.1]);
        mesh(new THREE.CylinderGeometry(0.018, 0.018, 0.14, 6), grip, g, [0, 0, 0.02], [Math.PI / 2, 0, 0]);
        break;
      }
      case 'dao': {
        const steel = mat(std('#c4c8d0', 0.28, 0.85));
        const grip = mat(std(tint, 0.8));
        for (const a of [h.anchors.handL, h.anchors.handR]) {
          const g = group(a);
          mesh(new THREE.BoxGeometry(0.07, 0.012, 0.66), steel, g, [0, 0, 0.44]);
          mesh(new THREE.CylinderGeometry(0.05, 0.05, 0.015, 10), mat(std(accent, 0.4, 0.6)), g, [0, 0, 0.1], [Math.PI / 2, 0, 0]);
          mesh(new THREE.CylinderGeometry(0.018, 0.018, 0.16, 6), grip, g, [0, 0, 0.02], [Math.PI / 2, 0, 0]);
        }
        break;
      }
      case 'bandana': {
        const g = group(head);
        const cloth = mat(std(tint, 0.95));
        mesh(new THREE.SphereGeometry(0.128, 12, 6, 0, Math.PI * 2, 0, Math.PI * 0.42), cloth, g, [0, 0.0, -0.01]);
        mesh(new THREE.BoxGeometry(0.05, 0.07, 0.03), cloth, g, [0, -0.02, -0.13], [0.3, 0, 0]);
        break;
      }
      case 'staff': {
        const g = group(h.anchors.back);
        mesh(new THREE.CylinderGeometry(0.02, 0.02, 1.5, 6), mat(std('#5a3c22', 0.85)), g, [0, 0.05, -0.05], [0, 0, 0.6]);
        break;
      }
    }
  }
  return {
    objects,
    dispose() {
      for (const o of objects) o.parent?.remove(o);
      for (const g of geos) g.dispose();
      for (const m of mats) m.dispose();
    },
  };
}
