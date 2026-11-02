import * as THREE from 'three';
import type { WaterSourceDef } from '../../../../combat/WaterSources';
import type { GameContext } from '../../../../core/GameContext';
import { WC, WC_LANDING, WC_WRECK } from '../../../landforms/wolfCove';
import { defineSpots } from '../../../Spots';
import { WaterRegion } from '../base';
import { wtMat, wtWater } from '../materials';
import { V, WaterSheets } from '../parts';
import { furnishInteriors } from './interiors';
import { APUT_DOOR, C, CHIEF, dwellings, FLOOR, GREAT, HEARTH, PLAZA, POND, POND_HOLE, TOWER_ANGLES, TRADER, TRAINING } from './layout';
import { buildShore, SHORE } from './shore';
import { buildVillage, type VillageInfo } from './village';
import { buildWall } from './wall';

/**
 * Southern Water Tribe — Wolf Cove, the tribe's main village as it stood ~40 years into the war
 * (image 1): a circular village on a raised ice terrace inside a great ice wall, the gate facing the
 * shore to the north, the open tundra to the south. Terrain: landforms/wolfCove.ts; layout:
 * swt/layout.ts; the wall (wall.ts), village (village.ts), interiors (interiors.ts), the shore,
 * shipwreck, sled run and tundra (shore.ts).
 *
 * Gameplay hooks kept from the old village: the region content id `swt_village`, Hunter Akka on the
 * hunting ice (now the cove's shore ice), the water sources `swt:sea_ice` and `swt:fishing_hole_*`,
 * the spots the tribe's named NPCs stand at (chief, trader, canoe landing, watchtower, village fire,
 * the otter penguins' floes).
 */

const R = 'southern_water_tribe';
const R_TOWER = WC.R - WC.wallT / 2;
const towerAt = (a: number) => ({ x: C.x + Math.sin(a) * R_TOWER, z: C.z - Math.cos(a) * R_TOWER });

defineSpots({
  // The tribe's named people and services (data/npcs_life.ts, shop/stock.ts).
  giver_swt_chief: { x: CHIEF.x, z: CHIEF.z, y: FLOOR, yaw: Math.PI / 2, r: 2, label: 'Chief Hakoda', region: R },
  merchant_swt_1: { x: TRADER.x, z: TRADER.z, y: FLOOR, yaw: -Math.PI / 2, r: 2, label: 'Trader', region: R },
  shrine_swt_firepit: { x: HEARTH.x, z: HEARTH.z + 3.2, y: FLOOR, r: 4, label: 'Hearth Plaza', region: R },
  viewpoint_swt_tower: { x: towerAt(TOWER_ANGLES[0]).x, z: towerAt(TOWER_ANGLES[0]).z, y: WC.wallTop, r: 3, label: 'Wall Lookout', region: R },
  // Masters: Hunter Akka on the hunting ice (the cove's shore ice), Master Aput by the Frozen Pond.
  master_akka: { x: SHORE.akka.x, z: SHORE.akka.z + 11, y: SHORE.iceY, yaw: Math.PI, r: 2, label: 'Hunter Akka', region: R },
  training_akka: { x: SHORE.akka.x, z: SHORE.akka.z, y: SHORE.iceY, r: 11, label: 'Hunting Ice', region: R },
  master_aput: { x: TRAINING.x - TRAINING.r - 1.4, z: TRAINING.z, y: FLOOR, yaw: Math.PI / 2, r: 2, label: 'Master Aput', region: R },
  training_aput: { x: TRAINING.x, z: TRAINING.z, y: FLOOR, r: TRAINING.r, label: 'Training Circle', region: R },
  // The shore: canoe landing and the otter penguins' floes by the sled run.
  dock_swt_ice: { x: WC_LANDING.x, z: WC_LANDING.z, y: SHORE.beachY, yaw: Math.PI, r: 3, label: 'Canoe Landing', region: R },
  habitat_otter_penguin_2: { x: SHORE.penguins.x, z: SHORE.penguins.z, y: SHORE.penguins.y, r: 9, label: 'Penguin Slope', region: R },
  // Quest anchors.
  swt_great_igloo: { x: GREAT.x, z: GREAT.z, y: FLOOR, r: GREAT.r - 1, label: 'Great Igloo', region: R },
  swt_aput_door: { x: APUT_DOOR.x, z: APUT_DOOR.z, y: FLOOR, r: 2, label: 'Great Igloo entrance', region: R },
  swt_frozen_pond: { x: POND.x, z: POND.z, y: FLOOR, r: POND.r, label: 'Frozen Pond', region: R },
  swt_shipwreck: { x: WC_WRECK.x, z: WC_WRECK.z, y: 1, r: 12, label: 'Fire Navy Wreck', region: R },
});

export class WolfCove extends WaterRegion {
  private village: VillageInfo | null = null;
  private interiorLight: THREE.PointLight | null = null;
  private lightTimer = 0;

  constructor() {
    super('swt_village', { x: C.x, z: C.z - 80 }, 480);
  }

  protected construct(ctx: GameContext): void {
    const low = ctx.vfx.quality === 'low';
    const b = this.builder(this.main);
    const p = this.builder(this.props);
    const sheets = new WaterSheets();
    buildWall(b, p, low);
    const list = dwellings();
    this.village = buildVillage(b, p, list, low);
    furnishInteriors(b, p, this.village, low);
    buildShore(this, b, p, sheets, low);
    this.waterSources(sheets);
    this.fires();
    sheets.flush(b);
    // One warm light for whichever interior the player is in (or near): fire inside the domes.
    if (ctx.settings.data.graphics.dynamicLights) {
      this.interiorLight = new THREE.PointLight('#ffb070', 0, 16, 1.6);
      this.interiorLight.name = 'swt_interior_light';
      this.main.add(this.interiorLight);
    }
  }

  /** Register a source (the shore module calls this too). */
  addWater(def: WaterSourceDef): void {
    this.registerWater(def);
  }

  private waterSources(sheets: WaterSheets): void {
    // The Frozen Pond: the ice sheet and its one thawed hole (liquid).
    sheets.disc(wtWater('pond'), POND_HOLE.x, POND_HOLE.z, POND_HOLE.r, FLOOR - 0.12, 20);
    this.registerWater({ id: 'swt:pond_hole', type: 'pond', label: 'Frozen Pond (thawed hole)', x: POND_HOLE.x, y: FLOOR - 0.12, z: POND_HOLE.z, r: POND_HOLE.r, capacity: 160, regen: 6, size: 'small' });
    this.registerWater({ id: 'swt:pond_ice', type: 'ice', label: 'Frozen Pond', x: POND.x, y: FLOOR + 0.03, z: POND.z, r: POND.r, capacity: 220, regen: 4, frozen: true });
    // Melt barrels by the hearth: water within reach of the start.
    const barrels = [
      [HEARTH.x + 3.6, HEARTH.z - 3.9],
      [HEARTH.x + 4.4, HEARTH.z - 3.1],
      [HEARTH.x - 3.9, HEARTH.z - 3.6],
    ];
    barrels.forEach(([x, z], i) => {
      sheets.disc(wtWater('pool'), x, z, 0.36, FLOOR + 0.98, 12);
      this.registerWater({ id: `swt:melt_barrel_${i}`, type: 'fountain', label: 'Melt Barrel', x, y: FLOOR + 0.98, z, r: 0.4, capacity: 45, regen: 2.5, size: 'small' });
    });
  }

  private fires(): void {
    if (!this.village) return;
    for (const f of this.village.fires) {
      this.ambientEmitter('flame', f.big ? 10 : 5, V(f.x, f.y + 0.35, f.z), { radius: f.big ? 0.35 : 0.2, size: f.big ? 1.1 : 0.75 }, 90, false);
      this.ambientEmitter('embers', f.big ? 3 : 1.5, V(f.x, f.y + 0.8, f.z), { radius: 0.3 }, 70, true);
      this.ambientEmitter('smoke', f.big ? 1.2 : 0.6, V(f.x, f.y + 2, f.z), { radius: 0.3, size: 0.8, speed: 0.6 }, 90, true);
    }
  }

  override update(dt: number, ctx: GameContext): void {
    super.update(dt, ctx);
    const light = this.interiorLight;
    if (!light || !this.village) return;
    this.lightTimer -= dt;
    if (this.lightTimer > 0) return;
    this.lightTimer = 0.25;
    const p = ctx.player?.position;
    if (!p) return;
    // The nearest interior within reach gets the warm firelight (off when nobody is near).
    let best: VillageInfo['interiors'][number] | null = null;
    let bd = 1e9;
    for (const it of this.village.interiors) {
      const d = Math.hypot(p.x - it.x, p.z - it.z) - it.r;
      if (d < bd) {
        bd = d;
        best = it;
      }
    }
    if (best && bd < 6 && Math.abs(p.y - FLOOR) < 4) {
      light.position.set(best.x, FLOOR + Math.min(2.6, best.r * 0.55), best.z);
      light.distance = best.r * 2.6;
      light.intensity = best.kind === 'great' ? 26 : 10;
    } else light.intensity = 0;
  }

  override dispose(ctx: GameContext): void {
    if (this.interiorLight) {
      this.interiorLight.removeFromParent();
      this.interiorLight.dispose();
      this.interiorLight = null;
    }
    super.dispose(ctx);
  }
}

export function createSouthernWaterTribe(): WolfCove {
  return new WolfCove();
}

void wtMat;
void PLAZA;
