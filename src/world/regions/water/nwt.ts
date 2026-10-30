import type { GameContext } from '../../../core/GameContext';
import { Random } from '../../../core/Random';
import type { NPCDef } from '../../../npc/NPCTypes';
import { buildCity } from './agnaCity';
import { LanternLights } from './agnaLights';
import type { DistrictPlan } from './agnaPlan';
import { WaterRegion } from './base';
import { AX, CANAL_QUAY_E, CANAL_QUAY_W, COURT_C, GATE_TOP, GATE_Z, HARBOR_QUAY_E, HARBOR_QUAY_W, L1, L2, L4, PLAZA_C } from './nwtLayout';
import type { NwtKit } from './nwtKit';
import { buildCaves } from './nwtCaves';
import { WaterSheets } from './parts';

/**
 * Agna Qel'a, the Northern Water Tribe capital: a city of carved ice in a
 * cove of colossal cliffs (layout in nwtLayout.ts, street maze in
 * agnaPlan.ts, construction in agnaCity.ts / agnaBuildings.ts /
 * agnaCliffs.ts), plus the Glacier Caves outside it (nwtCaves.ts).
 */
export class NorthernWaterTribe extends WaterRegion {
  private readonly ticks: Array<(t: number, dt: number) => void> = [];
  /** Real point lights that follow the lanterns nearest the camera at night. */
  lanternLights: LanternLights | null = null;
  /** Walk-test waypoints published on the debug hook. */
  readonly routes: Record<string, Array<[number, number]>> = {};

  constructor() {
    super('nwt_city', { x: AX, z: -1640 }, 600);
  }

  protected construct(ctx: GameContext): void {
    const core = this.builder(this.main);
    const wet = this.builder(this.main);
    const props = this.builder(this.props);
    const sheets = new WaterSheets();
    const g = ctx.settings.data.graphics;
    const k: NwtKit = {
      ctx,
      core,
      wet,
      props,
      sheets,
      rnd: new Random(4207),
      density: Math.max(0.3, Math.min(1.5, g.foliageDensity)),
      mainBuilder: () => this.builder(this.main),
      layer: (name, x, z, range) => this.builder(this.district(name, x, z, range)),
      water: (d) => this.registerWater(d),
      emitter: (p, rate, pos, o, range, amb) => this.ambientEmitter(p, rate, pos, o, range, amb),
      interact: (i) => this.interactable(i),
      npc: (d) => this.ambientNPC(d),
      own: (x) => this.own(x),
      onTick: (fn) => this.ticks.push(fn),
      addProp: (o) => this.props.add(o),
    };
    const { plans, glow } = buildCity(k);
    this.lanternLights = new LanternLights(this.props, new Float32Array(glow), 6);
    buildCaves(k);
    sheets.flush(wet);
    this.citizens(k, plans);
    this.walkRoutes();
  }

  protected override tick(dt: number, ctx: GameContext): void {
    const t = ctx.time.elapsed;
    for (const f of this.ticks) f(t, dt);
    this.lanternLights?.update(dt, ctx);
  }

  override setDetail(level: 'full' | 'far' | 'hidden'): void {
    super.setDetail(level);
    if (level !== 'full') this.lanternLights?.off();
  }

  protected override offSession(): void {
    this.lanternLights?.off();
  }

  override dispose(ctx: GameContext): void {
    super.dispose(ctx);
    this.ticks.length = 0;
    this.lanternLights?.dispose();
    this.lanternLights = null;
  }

  /** Guards, plaza life, students and townsfolk walking the district lanes. */
  private citizens(k: NwtKit, plans: DistrictPlan[]): void {
    const R = 'northern_water_tribe';
    const npc = (id: string, name: string, role: NPCDef['role'], x: number, z: number, yaw: number, behavior: NPCDef['behavior'], seed: number, y?: number) =>
      k.npc({ id: `nwt_amb_${id}`, name, role, nation: 'water', x, z, y, yaw, behavior, appearanceSeed: seed, region: R, marker: 'none' });
    npc('gate_w', 'Gate Warden', 'guard', AX - 24, GATE_Z - 3, Math.PI, { type: 'idle', variant: 'guard' }, 9101, GATE_TOP);
    npc('gate_e', 'Gate Warden', 'guard', AX + 30, GATE_Z - 3, Math.PI, { type: 'idle', variant: 'guard' }, 9102, GATE_TOP);
    npc('palace_w', 'Palace Guard', 'guard', AX - 8, -1472, Math.PI, { type: 'idle', variant: 'guard' }, 9103, L4);
    npc('palace_e', 'Palace Guard', 'guard', AX + 8, -1472, Math.PI, { type: 'idle', variant: 'guard' }, 9104, L4);
    npc('fisher', 'Fisherman', 'villager', HARBOR_QUAY_E[0] + 2, -1832, -Math.PI / 2, { type: 'idle', variant: 'work' }, 9105, L1);
    npc('plaza_1', 'Villager', 'villager', PLAZA_C.x + 10, PLAZA_C.z + 4, 0, { type: 'wander', radius: 9 }, 9106, L2);
    npc('plaza_2', 'Villager', 'villager', PLAZA_C.x - 14, PLAZA_C.z + 18, 0, { type: 'wander', radius: 8 }, 9107, L2);
    npc('children', 'Child', 'villager', PLAZA_C.x + 16, PLAZA_C.z - 20, 0, { type: 'wander', radius: 7 }, 9108, L2);
    npc('student_1', 'Waterbending Student', 'villager', COURT_C.x + 4, COURT_C.z - 6, -Math.PI / 2, { type: 'train' }, 9109, L2);
    npc('student_2', 'Waterbending Student', 'villager', COURT_C.x + 4, COURT_C.z + 6, -Math.PI / 2, { type: 'train' }, 9110, L2);
    const quayW = (CANAL_QUAY_W[0] + CANAL_QUAY_W[2]) / 2 - 0.8, quayE = (CANAL_QUAY_E[0] + CANAL_QUAY_E[2]) / 2 + 0.8;
    npc('quay_w', 'Canal Poler', 'villager', quayW, -1720, 0, { type: 'patrol', path: [{ x: quayW, z: -1765 }, { x: quayW, z: -1680 }], loop: true }, 9111, L1);
    npc('quay_e', 'Lamplighter', 'villager', quayE, -1720, Math.PI, { type: 'patrol', path: [{ x: quayE, z: -1680 }, { x: quayE, z: -1765 }], loop: true }, 9112, L1);
    npc('harbor_w', 'Dock Hand', 'villager', (HARBOR_QUAY_W[0] + HARBOR_QUAY_W[2]) / 2, -1830, 0, { type: 'patrol', path: [{ x: -262, z: -1852 }, { x: -262, z: -1806 }], loop: true }, 9113, L1);
    // Townsfolk on the longest lanes of every district (homes mid-route, routes kept short of the 60 m leash).
    const rnd = new Random(733);
    let n = 0;
    for (const p of plans) {
      const lanes = [...p.routes].sort((a, b) => routeLen(b) - routeLen(a)).slice(0, 2);
      for (const r of lanes) {
        const [[ax, az], [bx, bz]] = r;
        const len = Math.hypot(bx - ax, bz - az);
        const f = Math.min(1, 96 / len);
        const mx = (ax + bx) / 2, mz = (az + bz) / 2;
        const a = { x: mx + ((ax - mx) * f), z: mz + ((az - mz) * f) }, b = { x: mx + ((bx - mx) * f), z: mz + ((bz - mz) * f) };
        const role: NPCDef['role'] = rnd.chance(0.15) ? 'guard' : 'villager';
        npc(`lane_${p.id}_${n++}`, role === 'guard' ? 'City Watch' : 'Townsperson', role, mx, mz, 0, { type: 'patrol', path: [a, b], loop: true }, 9200 + n, p.spec.y);
      }
    }
  }

  /** Waypoints for walk tests: spawn → palace → oasis, harbor → plaza, district lanes. */
  private walkRoutes(): void {
    this.routes.spawn_palace = [[-236, -1606], [-236, -1590], [-250, -1575], [-250, -1562], [-250, -1550], [-220, -1540], [-220, -1500], [-220, -1478], [-220, -1466]];
    this.routes.palace_oasis = [[-220, -1478], [-259, -1478], [-259, -1440], [-259.5, -1410], [-259.5, -1394], [-240, -1384], [-224, -1372]];
    this.routes.harbor_plaza = [[-262, -1840], [-262, -1806], [-250, -1797], [-237, -1797], [-222, -1797], [-220, -1700], [-220, -1668], [-220, -1652], [-220, -1630]];
    this.routes.pass_out = [[-200, -1480], [-150, -1468], [-111, -1468], [-111, -1420], [-111, -1380], [-111, -1340]];
  }
}

function routeLen(r: Array<[number, number]>): number {
  let l = 0;
  for (let i = 1; i < r.length; i++) l += Math.hypot(r[i][0] - r[i - 1][0], r[i][1] - r[i - 1][1]);
  return l;
}

export function createNorthernWaterTribe(): NorthernWaterTribe {
  return new NorthernWaterTribe();
}
