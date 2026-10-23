import type { P2 } from '../../WorldLayout';
import { GROUND, MID, MID_GATES, UP, UP_GATES } from './bssLayout';
import { buildLowerRing } from './bssLower';
import { buildAgrarian, buildRail, railExclusions } from './bssOuter';
import { buildMiddleRing, buildPalace, buildUpperRing } from './bssRings';
import { buildInnerWall, buildOuterWall, buildTerrace, makeWallRecord, type TerraceRecord, type WallRecord } from './bssWalls';
import { EarthRegion } from './EarthRegion';
import type { BuildEnv } from './env';

/**
 * Ba Sing Se, the impenetrable city (Earth start). Outer Wall with three
 * gatehouses, the Agrarian Zone and Lake Laogai, the Inner Wall, the Lower
 * Ring, the raised Middle Ring (Stone Fist Dojo, tea shop, university,
 * gardens) and Upper Ring with the Earth King's Palace, and the monorail
 * viaducts. See bssLayout.ts for the master plan.
 */
export class BaSingSe extends EarthRegion {
  readonly id = 'ba_sing_se';
  readonly center: P2 = { x: 850, z: -50 };
  readonly loadRadius = 760;
  protected readonly seed = 4417;
  protected override readonly cell = 128;
  walls!: WallRecord;
  middle!: TerraceRecord;
  upper!: TerraceRecord;

  protected *construct(env: BuildEnv): Generator<unknown, void, unknown> {
    this.walls = makeWallRecord();
    buildOuterWall(env, this.walls);
    yield;
    buildInnerWall(env, this.walls);
    yield;
    this.middle = buildTerrace(env, {
      key: 'mid_terrace',
      c: { x: MID.x, z: MID.z },
      r: MID.r,
      thick: MID.wallT,
      base: GROUND,
      level: MID.level,
      body: 'stone_light',
      trim: 'stone_tan',
      ground: env.mats.groundMiddle,
      parapetH: 1.4,
      gates: MID_GATES.map((g) => ({ ...g, width: g.id === 'west' ? 16 : 12 })),
      arcs: 4,
    });
    yield;
    this.upper = buildTerrace(env, {
      key: 'up_terrace',
      c: { x: UP.x, z: UP.z },
      r: UP.r,
      thick: UP.wallT,
      base: MID.level,
      level: UP.level,
      body: 'stone_white',
      trim: 'stone_light',
      ground: env.mats.groundUpper,
      parapetH: 1.5,
      gates: UP_GATES.map((g) => ({ ...g, width: g.id === 'west' ? 16 : 12 })),
      arcs: 2,
    });
    yield;
    buildPalace(env, this);
    yield;
    railExclusions(env);
    yield* buildLowerRing(env, this);
    yield* buildMiddleRing(env, this);
    yield* buildUpperRing(env, this);
    yield* buildAgrarian(env, this);
    yield* buildRail(env, this);
  }
}
