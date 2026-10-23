/**
 * Fire Nation layout constants (metres, world coordinates). Shared by the
 * region builders and the spot definitions so they always agree.
 *
 * The capital sits on the 'fire_caldera' plateau (centre -1330,1150, r 170,
 * y 42). North = -Z. The palace terrace is at y 50, the plaza at y 43.2.
 */
export const CAPITAL = {
  cx: -1330,
  cz: 1150,
  floor: 42,
  /** Flat caldera floor radius (terrain rises steeply beyond ~172 m). */
  floorR: 170,
  plaza: {
    y: 43.2,
    x0: -1392,
    x1: -1268,
    z0: 1142,
    z1: 1292,
    canals: [
      { id: 'canal_west', x0: -1374, x1: -1366 },
      { id: 'canal_east', x0: -1294, x1: -1286 },
    ],
    canalZ0: 1190,
    canalZ1: 1282,
    canalWater: 42.62,
    paradeX0: -1366,
    paradeX1: -1294,
    galleryW: 14,
    bridgeZ: 1236,
    stairBase: 1162.4,
    emblemZ: 1250,
  },
  terrace: { y: 50, x0: -1420, x1: -1264, z0: 1012, z1: 1142, stairW: 24 },
  gate: { z: 1135, w: 44, d: 12, passage: 14, h: 15, passH: 10 },
  forecourt: { x0: -1359, x1: -1301, z0: 1104, z1: 1129 },
  throne: { z: 1080, y: 52.5, podW: 64, podD: 34, stairRun: 6.5, w: 50, d: 22, h: 10 },
  tower: {
    x: -1330,
    z: 1040,
    stages: [
      { w: 24, d: 20, h: 22 },
      { w: 19, d: 16, h: 16 },
      { w: 14, d: 12, h: 12 },
    ],
  },
  pagodas: [
    { x: -1390, z: 1040 },
    { x: -1274, z: 1040 },
  ],
  eastWing: { x: -1280, z: 1091, len: 64 },
  garden: { x0: -1418, x1: -1366, z0: 1054, z1: 1140, moonZ: 1100, pavilion: { x: -1412, z: 1063 } },
  pond: { x: -1397, z: 1072, r: 9.5, y: 49.6 },
  arena: { x: -1230, z: 1180, y: 43.6, dais: 30, hall: 44, colH: 15 },
  temple: { x: -1448, z: 1233, podX: 26, podZ: 34, court: { x: -1412, z: 1233, w: 36, d: 38 }, spire: { x: -1470, z: 1233 } },
  boulevard: { a: { x: -1178, z: 1102 }, b: { x: -1258, z: 1129 }, width: 12, square: { x: -1249, z: 1138, w: 28, d: 28 }, segments: 11, stallSegments: [1, 3] },
  landmarks: {
    plaza: { x: -1330, z: 1200 },
    palace: { x: -1330, z: 1110 },
    arena: { x: -1230, z: 1180 },
    pond: { x: -1390, z: 1090 },
  },
  spawn: { x: -1310, z: 1230 },
  elder: { x: -1318, z: 1214 },
  /** Rim gate on the pass of the causeway road. */
  rimGate: { x: -1071, z: 1059 },
} as const;

/**
 * Market stall on the south side of the boulevard at segment k (pure, shared
 * by the builder and the merchant spots). Returns the stall centre, its yaw
 * (front facing the avenue) and where the merchant stands behind the counter.
 */
export function boulevardStall(k: number): { x: number; z: number; yaw: number; mx: number; mz: number } {
  const bv = CAPITAL.boulevard;
  const t = k / bv.segments;
  const px = bv.a.x + (bv.b.x - bv.a.x) * t, pz = bv.a.z + (bv.b.z - bv.a.z) * t;
  const yaw = Math.atan2(-(bv.b.z - bv.a.z), bv.b.x - bv.a.x);
  const dist = bv.width / 2 + 3;
  const x = px - Math.sin(yaw) * dist, z = pz - Math.cos(yaw) * dist;
  const face = Math.atan2(px - x, pz - z);
  return { x, z, yaw: face, mx: x - Math.sin(face) * 0.15, mz: z - Math.cos(face) * 0.15 };
}
