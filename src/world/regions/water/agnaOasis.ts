import * as THREE from 'three';
import { Random } from '../../../core/Random';
import type { Detail } from './agnaBuildings';
import { block } from './agnaParts';
import { boulder, flatDisc, flatRing, koi, mergeParts, roundTree } from './geometry';
import { wtMat, wtWater } from './materials';
import { L4, MOON_GATE, OASIS, OASIS_FALL_POOL, OASIS_ISLAND, OASIS_POND, OASIS_SLOT, OASIS_STREAM, inRect, type Rect } from './nwtLayout';
import type { NwtKit } from './nwtKit';
import { drift, iceBridge, V } from './parts';
import { rasterRects } from './raster';

/**
 * The Spirit Oasis: a small secluded garden in a notch of the back cliff,
 * open to the sky, reached from the palace gardens through a narrow
 * lamp-lit crevasse and a round moon gate. Laid out like a small Chinese
 * garden: a lawn (snow only along the cliff feet), rockwork, trees, flowers
 * and lanterns along the path; a waterfall at the back feeds a pool and a
 * stream into the pond that rings a grassy island. An arched wooden moon
 * bridge leads to the island, where the black koi La and the white koi Tui
 * circle each other in their small round pond before a wooden spirit gate.
 */

const WATER_Y = L4 - 0.32;
/** Unsigned angle between two directions (radians). */
const angDist = (a: number, b: number) => Math.abs(Math.atan2(Math.sin(a - b), Math.cos(a - b)));
const BED_Y = L4 - 1.15;

/** Warm paper lantern on a wooden post (instanced), registered for the light pool. (x, y, z) = foot. */
function gardenLantern(det: Detail, k: NwtKit, x: number, y: number, z: number): void {
  det.put('oasis_lantern_post', () => {
    const post = new THREE.CylinderGeometry(0.08, 0.1, 1.7, 6);
    post.translate(0, 0.85, 0);
    const arm = new THREE.BoxGeometry(0.06, 0.06, 0.55);
    arm.translate(0, 1.66, 0.24);
    return mergeParts([post, arm]);
  }, 'wood', x, y, z, 0, 1, 1, 1, true);
  det.lantern(x, y + 1.18, z + 0.48);
  k.core.collider({ shape: 'cylinder', x, y: y + 0.85, z, r: 0.14, hy: 0.85, walkable: false, solid: true, surface: 'wood' });
}

function flowerMaterial(k: NwtKit, color: string): THREE.MeshStandardMaterial {
  return k.own(new THREE.MeshStandardMaterial({ color, roughness: 0.75, emissive: color, emissiveIntensity: 0.14 }));
}

export function buildOasis(k: NwtKit, det: Detail): void {
  const cb = k.mainBuilder();
  const props = k.props;
  const rnd = new Random(5150);
  const I = OASIS_ISLAND, K = OASIS_POND;
  const [ox0, oz0, ox1, oz1] = OASIS;
  const wallDist = (x: number, z: number) => Math.min(x - ox0, ox1 - x, z - oz0, oz1 - z);
  const ringHole = (x: number, z: number) => {
    const d = Math.hypot(x - I.x, z - I.z);
    return d > I.r - 0.75 && d < I.pond + 0.75;
  };
  const wet = (x: number, z: number) => ringHole(x, z) || inRect(OASIS_FALL_POOL, x, z) || inRect(OASIS_STREAM, x, z);

  // Floor: the crevasse passage, the lawn and a band of snow along the cliff feet.
  block(cb, OASIS_SLOT[0], OASIS_SLOT[1], OASIS_SLOT[2], OASIS_SLOT[3], L4, 'paving', 'ice');
  for (const snow of [false, true]) {
    for (const r of rasterRects(ox0, oz0, ox1, oz1, 1, (x, z) => !wet(x, z) && wallDist(x, z) < 2.5 === snow)) block(cb, r.x0, r.z0, r.x1, r.z1, L4, snow ? 'snow' : 'grass', snow ? 'snow' : 'grass');
  }

  // Pond ringing the island: rock walls, a dark bed, still water, a wading floor.
  const shell = (r: number, inward: boolean) => {
    const g = new THREE.CylinderGeometry(r, r, L4 + 0.02 - BED_Y, 56, 1, true);
    if (inward) g.scale(-1, 1, 1);
    cb.mesh(wtMat('rock'), g, { x: I.x, y: (L4 + 0.02 + BED_Y) / 2, z: I.z }, { castShadow: false });
    g.dispose();
  };
  shell(I.pond, true);
  shell(I.r, false);
  for (const [r0, r1] of [[I.r - 1, I.r], [I.pond, I.pond + 1]]) {
    const g = flatRing(r0, r1, 64);
    cb.mesh(wtMat('grass'), g, { x: I.x, y: L4 + 0.025, z: I.z }, { castShadow: false });
    g.dispose();
  }
  const pondBed = flatDisc(I.pond + 0.2, 48);
  cb.mesh(wtMat('canal_bed'), pondBed, { x: I.x, y: BED_Y, z: I.z }, { castShadow: false });
  pondBed.dispose();
  const water = flatRing(I.r - 0.05, I.pond + 0.05, 64);
  water.translate(I.x, WATER_Y, I.z);
  k.sheets.add(wtWater('pond'), water);
  cb.collider({ shape: 'cylinder', x: I.x, y: BED_Y - 0.3, z: I.z, r: I.pond + 0.2, hy: 0.3, walkable: true, solid: false, surface: 'water' });
  cb.collider({ shape: 'cylinder', x: I.x, y: (L4 + 3) / 2, z: I.z, r: I.r, hy: (L4 - 3) / 2, walkable: true, solid: true, surface: 'grass' });
  const N = 28;
  for (let i = 0; i < N; i++) {
    const a = ((i + 0.5) / N) * Math.PI * 2, rr = I.pond + 0.5;
    cb.collider({ shape: 'box', x: I.x + Math.cos(a) * rr, y: (L4 + 3) / 2, z: I.z + Math.sin(a) * rr, hx: 0.5, hy: (L4 - 3) / 2, hz: (Math.PI * 2 * rr) / (2 * N) + 0.2, yaw: -a, walkable: true, solid: true, surface: 'grass' });
  }
  k.water({ id: 'nwt:spirit_oasis', type: 'pond', label: 'Spirit Oasis Pond', x: I.x, y: WATER_Y, z: I.z, r: I.pond, capacity: 300, regen: 15, size: 'medium' });

  // The waterfall's pool at the back cliff and the stream into the pond.
  for (const [r, depth] of [[OASIS_FALL_POOL, 1.0], [OASIS_STREAM, 0.8]] as Array<[Rect, number]>) {
    const [x0, z0, x1, z1] = r;
    cb.box(wtMat('canal_bed'), { x: (x0 + x1) / 2, y: L4 - depth - 0.2, z: (z0 + z1) / 2, sx: x1 - x0, sy: 0.4, sz: z1 - z0 }, { castShadow: false });
    cb.collider({ shape: 'box', x: (x0 + x1) / 2, y: L4 - depth - 0.2, z: (z0 + z1) / 2, hx: (x1 - x0) / 2, hy: 0.2, hz: (z1 - z0) / 2, walkable: true, solid: false, surface: 'water' });
  }
  k.sheets.flow(wtWater('flow'), OASIS_FALL_POOL[0], OASIS_FALL_POOL[1], OASIS_FALL_POOL[2], OASIS_FALL_POOL[3], WATER_Y, '-z');
  k.sheets.flow(wtWater('flow'), OASIS_STREAM[0], OASIS_STREAM[1] - 0.6, OASIS_STREAM[2], OASIS_STREAM[3], WATER_Y + 0.01, '-z');
  k.water({ id: 'nwt:oasis_spring', type: 'fountain', label: 'Oasis Spring', x: (OASIS_FALL_POOL[0] + OASIS_FALL_POOL[2]) / 2, y: WATER_Y, z: (OASIS_FALL_POOL[1] + OASIS_FALL_POOL[3]) / 2, r: 3, capacity: 200, regen: 12, size: 'medium' });
  k.emitter('mist', 0.5, V((OASIS_FALL_POOL[0] + OASIS_FALL_POOL[2]) / 2, L4 + 0.6, OASIS_FALL_POOL[1] + 2), { radius: 2.5 }, 50, true);

  // Rockwork: stones edging the pond, the pool and the stream; tall weathered rocks by the paths.
  const stone = (x: number, z: number, s: number, tall = 1) => {
    const m = new THREE.Matrix4().compose(V(x, L4 - 0.25 + s * 0.3 * tall, z), new THREE.Quaternion().setFromEuler(new THREE.Euler(rnd.range(-0.2, 0.2), rnd.range(0, 6.28), rnd.range(-0.2, 0.2))), V(s, s * tall, s * 0.85));
    cb.rockInstance('oasis_stone', () => boulder(77, 1, 1, 1, 1), wtMat(rnd.chance(0.3) ? 'rock_dark' : 'rock'), m, undefined, true);
  };
  for (let i = 0; i < 22; i++) {
    const a = (i / 22) * Math.PI * 2 + rnd.range(-0.1, 0.1);
    if (angDist(a, Math.PI) < 0.25 || angDist(a, Math.PI / 2) < 0.18) continue; // bridge landing, stream mouth
    stone(I.x + Math.cos(a) * (I.pond + 0.4), I.z + Math.sin(a) * (I.pond + 0.4), rnd.range(0.45, 0.85));
  }
  for (let i = 0; i < 14; i++) {
    const a = (i / 14) * Math.PI * 2;
    if (angDist(a, Math.PI) < 0.35) continue;
    stone(I.x + Math.cos(a) * (I.r - 0.3), I.z + Math.sin(a) * (I.r - 0.3), rnd.range(0.35, 0.65));
  }
  for (const [x, z] of [[OASIS_FALL_POOL[0] - 0.4, -1348], [OASIS_FALL_POOL[2] + 0.4, -1347], [OASIS_FALL_POOL[0] + 1.2, OASIS_FALL_POOL[1] - 0.4], [OASIS_FALL_POOL[2] - 1.2, OASIS_FALL_POOL[1] - 0.4], [OASIS_STREAM[0] - 0.5, -1353], [OASIS_STREAM[2] + 0.5, -1354]]) stone(x, z, rnd.range(0.6, 1.0));
  const tallRock = (x: number, z: number, h: number) => {
    stone(x, z, 0.8, h);
    stone(x + rnd.range(-0.7, 0.7), z + rnd.range(-0.7, 0.7), 0.55, h * 0.6);
    k.core.collider({ shape: 'cylinder', x, y: L4 + h * 0.5, z, r: 0.75, hy: h * 0.5, walkable: false, solid: true, surface: 'rock' });
  };
  tallRock(MOON_GATE.x + 4.5, MOON_GATE.z + 3, 3.2);
  tallRock(I.x - 17, I.z - 11, 2.6);
  tallRock(I.x + 15, I.z + 8, 3.6);
  tallRock(I.x + 17, I.z - 10, 2.4);

  // The moon gate: a garden wall across the end of the crevasse with a round opening.
  {
    const wx0 = ox0, wx1 = MOON_GATE.x + 9.5, h = 3.9, t = 0.6;
    const s = new THREE.Shape();
    s.moveTo(wx0 - MOON_GATE.x, 0);
    s.lineTo(wx1 - MOON_GATE.x, 0);
    s.lineTo(wx1 - MOON_GATE.x, h);
    s.lineTo(wx0 - MOON_GATE.x, h);
    s.closePath();
    const hole = new THREE.Path();
    hole.absarc(0, MOON_GATE.r + 0.1, MOON_GATE.r, 0, Math.PI * 2, true);
    s.holes.push(hole);
    const g = new THREE.ExtrudeGeometry(s, { depth: t, bevelEnabled: false, curveSegments: 40 });
    g.translate(0, 0, -t / 2);
    cb.mesh(wtMat('ice_wall'), g, { x: MOON_GATE.x, y: L4, z: MOON_GATE.z });
    g.dispose();
    const ring = new THREE.RingGeometry(MOON_GATE.r - 0.02, MOON_GATE.r + 0.22, 48);
    for (const side of [-1, 1]) cb.mesh(wtMat('ice_trim'), ring, { x: MOON_GATE.x, y: L4 + MOON_GATE.r + 0.1, z: MOON_GATE.z + side * (t / 2 + 0.01), yaw: side > 0 ? 0 : Math.PI }, { castShadow: false });
    ring.dispose();
    cb.box(wtMat('roof_slate'), { x: (wx0 + wx1) / 2, y: L4 + h + 0.12, z: MOON_GATE.z, sx: wx1 - wx0 + 0.4, sy: 0.24, sz: t + 0.7 });
    cb.box(wtMat('roof_slate'), { x: (wx0 + wx1) / 2, y: L4 + h + 0.32, z: MOON_GATE.z, sx: wx1 - wx0 + 0.2, sy: 0.16, sz: 0.3 });
    const gx1 = MOON_GATE.x + MOON_GATE.r;
    cb.collider({ shape: 'box', x: (gx1 + wx1) / 2, y: L4 + h / 2, z: MOON_GATE.z, hx: (wx1 - gx1) / 2, hy: h / 2, hz: t / 2, walkable: false, solid: true, surface: 'ice' });
    cb.collider({ shape: 'box', x: MOON_GATE.x, y: L4 + h - 0.15, z: MOON_GATE.z, hx: MOON_GATE.r, hy: 0.3, hz: t / 2, walkable: false, solid: true, surface: 'ice' });
  }

  // Lanterns strung across the crevasse; stepping stones and lanterns to the bridge.
  for (const z of [OASIS_SLOT[1] + 3, OASIS_SLOT[1] + 8, OASIS_SLOT[1] + 13]) det.hang((OASIS_SLOT[0] + OASIS_SLOT[2]) / 2, L4 + 4.2, z, 0, OASIS_SLOT[2] - OASIS_SLOT[0] + 0.6);
  const bridgeA = V(I.x - I.pond - 3, L4, I.z), bridgeB = V(I.x - I.r + 1.8, L4, I.z);
  const path = new THREE.CatmullRomCurve3([V(MOON_GATE.x, L4, MOON_GATE.z + 1.5), V(MOON_GATE.x + 3, L4, MOON_GATE.z + 8), V(bridgeA.x - 8, L4, bridgeA.z - 6), V(bridgeA.x - 0.5, L4, bridgeA.z)]);
  const steps = Math.round(path.getLength() / 1.25);
  for (let i = 0; i <= steps; i++) {
    const p = path.getPointAt(i / steps);
    const st = flatDisc(rnd.range(0.42, 0.58), 9);
    cb.mesh(wtMat('stone_floor'), st, { x: p.x + rnd.range(-0.15, 0.15), y: L4 + 0.035, z: p.z + rnd.range(-0.15, 0.15), yaw: rnd.range(0, 6) }, { castShadow: false });
    st.dispose();
    if (i % 6 === 3) {
      const t = path.getTangentAt(i / steps);
      const side = (i / 6) % 2 < 1 ? 1 : -1;
      gardenLantern(det, k, p.x + -t.z * side * 1.6, L4, p.z + t.x * side * 1.6);
    }
  }

  // Arched wooden moon bridge to the island, lanterns at both ends.
  iceBridge(cb, { a: bridgeA, b: bridgeB, width: 2.4, arch: 1.5, baseY: BED_Y, parapet: 0.75, deck: 'wood', wall: 'lacquer', surface: 'wood' });
  for (const s of [-1, 1]) {
    gardenLantern(det, k, bridgeA.x - 0.8, L4, bridgeA.z + s * 1.9);
    gardenLantern(det, k, bridgeB.x + 1.0, L4, bridgeB.z + s * 1.9);
  }

  // The koi pond on the island: a stone-rimmed basin glowing softly, La and Tui circling.
  {
    const rim = new THREE.CylinderGeometry(K.r + 0.42, K.r + 0.48, 0.36, 40, 1, true);
    cb.mesh(wtMat('rock'), rim, { x: K.x, y: L4 + 0.18, z: K.z });
    rim.dispose();
    const inner = new THREE.CylinderGeometry(K.r + 0.02, K.r + 0.02, 0.36, 40, 1, true);
    inner.scale(-1, 1, 1);
    cb.mesh(wtMat('rock'), inner, { x: K.x, y: L4 + 0.18, z: K.z }, { castShadow: false });
    inner.dispose();
    const top = flatRing(K.r, K.r + 0.45, 40);
    cb.mesh(wtMat('rock'), top, { x: K.x, y: L4 + 0.36, z: K.z }, { castShadow: false });
    top.dispose();
    const kb = flatDisc(K.r + 0.05, 32);
    cb.mesh(wtMat('stone_floor'), kb, { x: K.x, y: L4 + 0.03, z: K.z }, { castShadow: false });
    kb.dispose();
    k.sheets.disc(wtWater('spirit'), K.x, K.z, K.r + 0.03, L4 + 0.27, 40);
    const n = 18;
    for (let i = 0; i < n; i++) {
      const a = ((i + 0.5) / n) * Math.PI * 2, rr = K.r + 0.23;
      cb.collider({ shape: 'box', x: K.x + Math.cos(a) * rr, y: L4 + 0.18, z: K.z + Math.sin(a) * rr, hx: 0.24, hy: 0.18, hz: (Math.PI * 2 * rr) / (2 * n) + 0.05, yaw: -a, walkable: true, solid: true, surface: 'rock' });
    }
    const fishGeo = k.own(koi(0.85));
    const tui = new THREE.Mesh(fishGeo, wtMat('koi_white'));
    const la = new THREE.Mesh(fishGeo, wtMat('koi_black'));
    tui.name = 'koi_tui';
    la.name = 'koi_la';
    for (const f of [tui, la]) {
      f.castShadow = false;
      k.addProp(f);
    }
    const fish = [tui, la];
    // Two fish chasing each other round the pond: opposite on one circle, the
    // radius swelling and shrinking in turn so the pair traces the yin-yang S.
    k.onTick((t) => {
      for (let i = 0; i < 2; i++) {
        const a = t * 0.6 + i * Math.PI;
        const r = 1.05 + 0.32 * Math.sin(2 * a);
        const r2 = 1.05 + 0.32 * Math.sin(2 * (a + 0.05));
        const x = K.x + Math.cos(a) * r, z = K.z + Math.sin(a) * r;
        const nx = K.x + Math.cos(a + 0.05) * r2, nz = K.z + Math.sin(a + 0.05) * r2;
        fish[i].position.set(x, L4 + 0.25 + 0.02 * Math.sin(t * 2 + i), z);
        fish[i].rotation.set(0, Math.atan2(nx - x, nz - z), 0.12 * Math.sin(t * 5 + i * 2));
      }
    });
    k.emitter('spirit', 0.5, V(K.x, L4 + 0.9, K.z), { radius: 2.4 }, 45, true);
  }

  // The wooden spirit gate behind the koi pond, facing the bridge side.
  {
    const gz = K.z + K.r + 1.6, gx = K.x, span = 3.0, h = 3.1;
    for (const s of [-1, 1]) {
      cb.cylinder(wtMat('lacquer'), { x: gx + s * span / 2, y: L4, z: gz, r: 0.15, rTop: 0.13, h, segments: 10 }, { collide: true, walkable: false });
      cb.cylinder(wtMat('rock_dark'), { x: gx + s * span / 2, y: L4, z: gz, r: 0.24, h: 0.32, segments: 10 });
    }
    cb.box(wtMat('lacquer'), { x: gx, y: L4 + h - 0.75, z: gz, sx: span + 0.5, sy: 0.18, sz: 0.2 });
    const lintel = new THREE.Shape();
    lintel.moveTo(-span / 2 - 0.9, 0.18);
    lintel.quadraticCurveTo(0, -0.08, span / 2 + 0.9, 0.18);
    lintel.lineTo(span / 2 + 0.9, 0.42);
    lintel.quadraticCurveTo(0, 0.16, -span / 2 - 0.9, 0.42);
    lintel.closePath();
    const lg = new THREE.ExtrudeGeometry(lintel, { depth: 0.32, bevelEnabled: false, curveSegments: 10 });
    lg.translate(0, 0, -0.16);
    cb.mesh(wtMat('wood'), lg, { x: gx, y: L4 + h - 0.1, z: gz });
    lg.dispose();
    cb.box(wtMat('wood'), { x: gx, y: L4 + h - 0.45, z: gz, sx: 0.32, sy: 0.55, sz: 0.12 });
  }

  // Trees: blossoms and maples round the lawn, one on the island; shrubs and flower beds.
  const blossom = flowerMaterial(k, '#f3b8cc'), maple = flowerMaterial(k, '#d8642e');
  const trees: Array<[number, number, number, THREE.Material | 'leaf']> = [
    [ox0 + 6, oz0 + 15, 7.5, 'leaf'], [ox0 + 6, oz1 - 9, 8, blossom], [ox0 + 19, oz1 - 6, 6.5, 'leaf'], [ox0 + 14, oz0 + 24, 6, maple],
    [ox1 - 8, oz1 - 9, 8.5, 'leaf'], [ox1 - 15, oz0 + 8, 7, blossom], [ox1 - 6, oz0 + 22, 6.5, maple], [ox1 - 22, oz1 - 5, 6, 'leaf'],
    [I.x + 4.2, I.z - 3.6, 4.8, blossom],
  ];
  trees.forEach(([x, z, h, foliage], i) => {
    const [trunk, crown] = roundTree(900 + i, h);
    cb.mesh(wtMat('wood'), trunk, { x, y: L4, z, yaw: rnd.range(0, 6) });
    cb.mesh(foliage === 'leaf' ? wtMat('leaf') : foliage, crown, { x, y: L4, z, yaw: rnd.range(0, 6) });
    trunk.dispose();
    crown.dispose();
    cb.collider({ shape: 'cylinder', x, y: L4 + h * 0.25, z, r: h * 0.06 + 0.1, hy: h * 0.25, walkable: false, solid: true, surface: 'wood' });
  });
  const flowers = ['#f7f2e8', '#f2c94c', '#e86f8e', '#b98ae6'].map((c) => flowerMaterial(k, c));
  const bed = (cx: number, cz: number, n: number, spread: number) => {
    for (let i = 0; i < n; i++) {
      const a = rnd.range(0, 6.28), r = spread * Math.sqrt(rnd.next());
      const x = cx + Math.cos(a) * r, z = cz + Math.sin(a) * r;
      if (wet(x, z) || wallDist(x, z) < 2.6) continue;
      const c = rnd.int(0, flowers.length - 1);
      props.instance(`oasis_flower_${c}`, () => {
        const head = new THREE.IcosahedronGeometry(0.11, 0);
        head.translate(0, 0.32, 0);
        return head;
      }, flowers[c], new THREE.Matrix4().compose(V(x, L4, z), new THREE.Quaternion(), V(1, rnd.range(0.7, 1.3), 1)), false);
      props.instance('oasis_stem', () => {
        const st = new THREE.CylinderGeometry(0.012, 0.016, 0.3, 4);
        st.translate(0, 0.15, 0);
        return st;
      }, wtMat('leaf'), new THREE.Matrix4().makeTranslation(x, L4, z), false);
    }
  };
  bed(I.x - 15.5, I.z + 4, 40, 2.6);
  bed(I.x + 15, I.z - 3, 40, 2.8);
  bed(MOON_GATE.x + 6, MOON_GATE.z + 4, 30, 2.2);
  bed(I.x + 3, I.z - 15, 34, 2.4);
  bed(I.x - 3, I.z + 2.8, 18, 1.4);
  for (let i = 0; i < 16; i++) {
    const x = rnd.range(ox0 + 4, ox1 - 4), z = rnd.range(oz0 + 4, oz1 - 4);
    if (wet(x, z) || Math.hypot(x - I.x, z - I.z) < I.pond + 2.5 || wallDist(x, z) < 3) continue;
    const s = rnd.range(0.6, 1.1);
    const g = new THREE.IcosahedronGeometry(s, 1);
    g.scale(1.25, 0.8, 1.1);
    cb.mesh(wtMat(i % 3 ? 'leaf' : 'moss'), g, { x, y: L4 + s * 0.55, z, yaw: rnd.range(0, 6) });
    g.dispose();
  }

  // Snow drifts against the cliff feet (the garden stays green inside).
  for (let i = 0; i < 18; i++) {
    const side = i % 4;
    const x = side === 0 ? ox0 + 1.2 : side === 1 ? ox1 - 1.2 : rnd.range(ox0 + 4, ox1 - 4);
    const z = side === 2 ? oz0 + 1.2 : side === 3 ? oz1 - 1.2 : rnd.range(oz0 + 4, oz1 - 4);
    if (inRect([MOON_GATE.x - 3, MOON_GATE.z - 3, MOON_GATE.x + 3, MOON_GATE.z + 3], x, z) || inRect(OASIS_FALL_POOL, x, z, 2)) continue;
    drift(cb, x, L4, z, rnd.range(3, 6), rnd.range(1.4, 2.4), rnd.range(0.4, 0.9), side < 2 ? Math.PI / 2 : 0);
  }
}
