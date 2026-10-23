import * as THREE from 'three';

/**
 * Low-level geometry helpers for the Earth Kingdom regions.
 *
 * GeoBuilder accumulates indexed triangles (position / normal / uv) in local
 * space so archetypes (houses, stalls, roofs) can be authored once and then
 * stamped many times into merged per-chunk batches (see MergeBatch).
 *
 * UV rects are normalised atlas coordinates with v0 = bottom, v1 = top.
 */

export interface UVRect {
  u0: number;
  v0: number;
  u1: number;
  v1: number;
}

export type V3 = [number, number, number];

const _a = new THREE.Vector3();
const _b = new THREE.Vector3();
const _c = new THREE.Vector3();

export class GeoBuilder {
  readonly pos: number[] = [];
  readonly nrm: number[] = [];
  readonly uv: number[] = [];
  readonly idx: number[] = [];

  get vertexCount(): number {
    return this.pos.length / 3;
  }

  vertex(x: number, y: number, z: number, nx: number, ny: number, nz: number, u: number, v: number): number {
    this.pos.push(x, y, z);
    this.nrm.push(nx, ny, nz);
    this.uv.push(u, v);
    return this.pos.length / 3 - 1;
  }

  /**
   * Quad from four corners in counter-clockwise order seen from the front:
   * bl, br, tr, tl. UVs map bl→(u0,v0), br→(u1,v0), tr→(u1,v1), tl→(u0,v1).
   */
  quad(bl: V3, br: V3, tr: V3, tl: V3, r: UVRect, flatNormal = true): void {
    _a.set(br[0] - bl[0], br[1] - bl[1], br[2] - bl[2]);
    _b.set(tl[0] - bl[0], tl[1] - bl[1], tl[2] - bl[2]);
    _c.crossVectors(_a, _b);
    if (_c.lengthSq() < 1e-12) {
      _a.set(tr[0] - br[0], tr[1] - br[1], tr[2] - br[2]);
      _b.set(tl[0] - tr[0], tl[1] - tr[1], tl[2] - tr[2]);
      _c.crossVectors(_a, _b);
    }
    _c.normalize();
    void flatNormal;
    const i0 = this.vertex(bl[0], bl[1], bl[2], _c.x, _c.y, _c.z, r.u0, r.v0);
    const i1 = this.vertex(br[0], br[1], br[2], _c.x, _c.y, _c.z, r.u1, r.v0);
    const i2 = this.vertex(tr[0], tr[1], tr[2], _c.x, _c.y, _c.z, r.u1, r.v1);
    const i3 = this.vertex(tl[0], tl[1], tl[2], _c.x, _c.y, _c.z, r.u0, r.v1);
    this.idx.push(i0, i1, i2, i0, i2, i3);
  }

  tri(a: V3, b: V3, c: V3, ua: [number, number], ub: [number, number], uc: [number, number]): void {
    _a.set(b[0] - a[0], b[1] - a[1], b[2] - a[2]);
    _b.set(c[0] - a[0], c[1] - a[1], c[2] - a[2]);
    _c.crossVectors(_a, _b).normalize();
    const i0 = this.vertex(a[0], a[1], a[2], _c.x, _c.y, _c.z, ua[0], ua[1]);
    const i1 = this.vertex(b[0], b[1], b[2], _c.x, _c.y, _c.z, ub[0], ub[1]);
    const i2 = this.vertex(c[0], c[1], c[2], _c.x, _c.y, _c.z, uc[0], uc[1]);
    this.idx.push(i0, i1, i2);
  }

  /**
   * Axis-aligned box (local space) with a UV rect per face. Faces set to null
   * are skipped (e.g. hidden bottoms/tops). Keys: px nx py ny pz nz.
   */
  box(cx: number, cy: number, cz: number, sx: number, sy: number, sz: number, faces: Partial<Record<'px' | 'nx' | 'py' | 'ny' | 'pz' | 'nz', UVRect | null>>): void {
    const x0 = cx - sx / 2, x1 = cx + sx / 2;
    const y0 = cy - sy / 2, y1 = cy + sy / 2;
    const z0 = cz - sz / 2, z1 = cz + sz / 2;
    if (faces.pz) this.quad([x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1], faces.pz);
    if (faces.nz) this.quad([x1, y0, z0], [x0, y0, z0], [x0, y1, z0], [x1, y1, z0], faces.nz);
    if (faces.px) this.quad([x1, y0, z1], [x1, y0, z0], [x1, y1, z0], [x1, y1, z1], faces.px);
    if (faces.nx) this.quad([x0, y0, z0], [x0, y0, z1], [x0, y1, z1], [x0, y1, z0], faces.nx);
    if (faces.py) this.quad([x0, y1, z1], [x1, y1, z1], [x1, y1, z0], [x0, y1, z0], faces.py);
    if (faces.ny) this.quad([x0, y0, z0], [x1, y0, z0], [x1, y0, z1], [x0, y0, z1], faces.ny);
  }

  /** Append another builder's triangles transformed by a matrix. */
  append(o: GeoBuilder, m?: THREE.Matrix4): void {
    const base = this.vertexCount;
    const nm = m ? new THREE.Matrix3().getNormalMatrix(m) : null;
    const v = new THREE.Vector3();
    for (let i = 0; i < o.pos.length; i += 3) {
      v.set(o.pos[i], o.pos[i + 1], o.pos[i + 2]);
      if (m) v.applyMatrix4(m);
      this.pos.push(v.x, v.y, v.z);
      v.set(o.nrm[i], o.nrm[i + 1], o.nrm[i + 2]);
      if (nm) v.applyMatrix3(nm).normalize();
      this.nrm.push(v.x, v.y, v.z);
    }
    for (const u of o.uv) this.uv.push(u);
    for (const i of o.idx) this.idx.push(i + base);
  }

  build(): THREE.BufferGeometry {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.nrm, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(this.uv, 2));
    g.setIndex(this.vertexCount > 65535 ? new THREE.Uint32BufferAttribute(this.idx, 1) : new THREE.Uint16BufferAttribute(this.idx, 1));
    g.computeBoundingSphere();
    return g;
  }
}

/** Sub-rect of a UV rect (fractions 0..1 of its width/height). */
export function subRect(r: UVRect, fu0: number, fv0: number, fu1: number, fv1: number): UVRect {
  const du = r.u1 - r.u0, dv = r.v1 - r.v0;
  return { u0: r.u0 + du * fu0, v0: r.v0 + dv * fv0, u1: r.u0 + du * fu1, v1: r.v0 + dv * fv1 };
}

export interface RoofOpts {
  /** Centre of the eave rectangle (local space). */
  cx: number;
  cy: number;
  cz: number;
  /** Eave footprint (already including overhang): w along X, d along Z. */
  w: number;
  d: number;
  /** Ridge height above the eaves. */
  h: number;
  style: 'hip' | 'gable';
  /** Corner upturn (m). */
  curve: number;
  /** Atlas rect for tiles and the metres it represents (keeps tile size constant). */
  tiles: UVRect;
  tileW: number;
  tileH: number;
  /** Underside of the overhang (wood). */
  soffit?: UVRect;
  /** Overhang width used for the soffit band. */
  overhang?: number;
  /** Gable end walls. */
  gable?: UVRect;
  /** Ridge cap. */
  ridge?: UVRect;
  segU?: number;
  segT?: number;
}

/**
 * East-Asian roof with concave slopes and upturned corners, low poly enough to
 * be stamped hundreds of times. Eaves at cy, ridge at cy + h.
 */
export function roofInto(g: GeoBuilder, o: RoofOpts): void {
  const segU = o.segU ?? 4;
  const segT = o.segT ?? 3;
  const hw = o.w / 2, hd = o.d / 2;
  const ridgeHalf = o.style === 'gable' ? hw : Math.max(0, hw - hd);
  const lift = (t: number, corner: number) => o.h * Math.pow(t, 1.45) + o.curve * (1 - t) * (1 - t) * corner;
  const tu = (m: number) => o.tiles.u0 + (o.tiles.u1 - o.tiles.u0) * Math.min(1, m / o.tileW);
  const tv = (m: number) => o.tiles.v0 + (o.tiles.v1 - o.tiles.v0) * Math.min(1, m / o.tileH);
  // `abc`: triangle order (a, b, c) faces outward for this slope, else (a, c, b).
  const grid = (fn: (u: number, t: number) => V3, uLen: number, vLen: number, abc: boolean) => {
    const base = g.vertexCount;
    const pts: V3[] = [];
    for (let j = 0; j <= segT; j++) {
      for (let i = 0; i <= segU; i++) {
        const u = i / segU, t = j / segT;
        const p = fn(u, t);
        pts.push(p);
        g.vertex(p[0], p[1], p[2], 0, 1, 0, tu(u * uLen), tv(t * vLen));
      }
    }
    // Normals per vertex from the grid (finite differences).
    const W = segU + 1;
    for (let j = 0; j <= segT; j++) {
      for (let i = 0; i <= segU; i++) {
        const a = pts[j * W + Math.min(segU, i + 1)], b = pts[j * W + Math.max(0, i - 1)];
        const c = pts[Math.min(segT, j + 1) * W + i], d = pts[Math.max(0, j - 1) * W + i];
        _a.set(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
        _b.set(c[0] - d[0], c[1] - d[1], c[2] - d[2]);
        _c.crossVectors(_a, _b).normalize();
        if (_c.y < 0) _c.negate();
        const k = (base + j * W + i) * 3;
        g.nrm[k] = _c.x;
        g.nrm[k + 1] = _c.y;
        g.nrm[k + 2] = _c.z;
      }
    }
    for (let j = 0; j < segT; j++) {
      for (let i = 0; i < segU; i++) {
        const a = base + j * W + i, b = a + 1, c = a + W, d = c + 1;
        if (abc) g.idx.push(a, b, c, b, d, c);
        else g.idx.push(a, c, b, b, c, d);
      }
    }
  };
  // Long sides (+Z front and -Z back).
  for (const side of [1, -1]) {
    grid(
      (u, t) => {
        const xe = -hw + u * o.w;
        const xr = Math.max(-ridgeHalf, Math.min(ridgeHalf, xe));
        const corner = Math.pow(Math.abs(u - 0.5) * 2, 4);
        return [o.cx + xe + (xr - xe) * t, o.cy + lift(t, corner), o.cz + side * hd * (1 - t)];
      },
      o.w,
      Math.hypot(hd, o.h),
      side > 0,
    );
  }
  if (o.style === 'hip') {
    for (const side of [1, -1]) {
      grid(
        (u, t) => {
          const ze = -hd + u * o.d;
          const corner = Math.pow(Math.abs(u - 0.5) * 2, 4);
          return [o.cx + side * (hw + (ridgeHalf - hw) * t), o.cy + lift(t, corner), o.cz + ze * (1 - t)];
        },
        o.d,
        Math.hypot(hw - ridgeHalf, o.h),
        side < 0,
      );
    }
  } else if (o.gable) {
    // Vertical gable triangles slightly inside the eave line.
    const inset = o.overhang ?? 0.6;
    for (const side of [1, -1]) {
      const x = o.cx + side * (hw - inset);
      const a: V3 = [x, o.cy, o.cz - hd + inset];
      const b: V3 = [x, o.cy, o.cz + hd - inset];
      const c: V3 = [x, o.cy + o.h * 0.97, o.cz];
      const r = o.gable;
      if (side > 0) g.tri(b, a, c, [r.u0, r.v0], [r.u1, r.v0], [(r.u0 + r.u1) / 2, r.v1]);
      else g.tri(a, b, c, [r.u0, r.v0], [r.u1, r.v0], [(r.u0 + r.u1) / 2, r.v1]);
    }
  }
  // Soffit: flat band under the overhang so eaves read solid from below.
  if (o.soffit && o.overhang) {
    const ov = o.overhang;
    const y = o.cy + 0.02;
    const s = o.soffit;
    const x0 = o.cx - hw, x1 = o.cx + hw, z0 = o.cz - hd, z1 = o.cz + hd;
    // Facing down: front, back, left, right bands.
    g.quad([x0, y, z1], [x0 + ov, y, z1 - ov], [x1 - ov, y, z1 - ov], [x1, y, z1], s);
    g.quad([x1, y, z0], [x1 - ov, y, z0 + ov], [x0 + ov, y, z0 + ov], [x0, y, z0], s);
    if (o.style === 'hip') {
      g.quad([x0, y, z0], [x0 + ov, y, z0 + ov], [x0 + ov, y, z1 - ov], [x0, y, z1], s);
      g.quad([x1, y, z1], [x1 - ov, y, z1 - ov], [x1 - ov, y, z0 + ov], [x1, y, z0], s);
    }
  }
  if (o.ridge) {
    const len = o.style === 'gable' ? o.w : Math.max(0.6, ridgeHalf * 2 + 0.4);
    const ry = o.cy + o.h + 0.08;
    g.box(o.cx, ry, o.cz, len, 0.26, 0.34, { pz: o.ridge, nz: o.ridge, py: o.ridge, px: o.ridge, nx: o.ridge });
    // Upturned ridge-end ornaments.
    for (const s of [-1, 1]) {
      g.box(o.cx + s * (len / 2 - 0.1), ry + 0.22, o.cz, 0.3, 0.4, 0.3, { pz: o.ridge, nz: o.ridge, px: o.ridge, nx: o.ridge, py: o.ridge });
    }
  }
}

/**
 * A solid block with an arched tunnel through it (gatehouses, viaduct spans).
 * Local frame: width along X (centred), height along Y from 0, depth along Z (centred).
 * The arch opening has width `aw`, straight sides up to `spring`, then a semicircle.
 */
export function archBlockGeometry(width: number, height: number, depth: number, aw: number, spring: number, segs = 12): THREE.BufferGeometry {
  const shape = new THREE.Shape();
  shape.moveTo(-width / 2, 0);
  shape.lineTo(-aw / 2, 0);
  shape.lineTo(-aw / 2, spring);
  for (let i = 1; i < segs; i++) {
    const a = Math.PI - (i / segs) * Math.PI;
    shape.lineTo(Math.cos(a) * (aw / 2), spring + Math.sin(a) * (aw / 2));
  }
  shape.lineTo(aw / 2, spring);
  shape.lineTo(aw / 2, 0);
  shape.lineTo(width / 2, 0);
  shape.lineTo(width / 2, height);
  shape.lineTo(-width / 2, height);
  shape.closePath();
  const g = new THREE.ExtrudeGeometry(shape, { depth, bevelEnabled: false, steps: 1, curveSegments: segs });
  g.translate(0, 0, -depth / 2);
  return g;
}

/** Spandrel for a viaduct span: rectangle with a semicircular arch cut from its bottom. */
export function spandrelGeometry(span: number, height: number, depth: number, segs = 10): THREE.BufferGeometry {
  // Arch radius = span/2, springing at y=0; the block spans y in [0, height] (height >= span/2).
  const r = span / 2;
  const shape = new THREE.Shape();
  shape.moveTo(-r, 0);
  for (let i = 1; i < segs; i++) {
    const a = Math.PI - (i / segs) * Math.PI;
    shape.lineTo(Math.cos(a) * r, Math.sin(a) * r);
  }
  shape.lineTo(r, 0);
  shape.lineTo(r, height);
  shape.lineTo(-r, height);
  shape.closePath();
  const g = new THREE.ExtrudeGeometry(shape, { depth, bevelEnabled: false, steps: 1, curveSegments: segs });
  g.translate(0, 0, -depth / 2);
  return g;
}

/** Box geometry whose bottom face is wider (battered wall). Centre-bottom origin. */
export function batteredBox(w: number, h: number, dTop: number, dBottom: number): THREE.BufferGeometry {
  const g = new THREE.BoxGeometry(w, h, 1);
  const p = g.getAttribute('position') as THREE.BufferAttribute;
  for (let i = 0; i < p.count; i++) {
    const y = p.getY(i);
    const z = p.getZ(i);
    const d = y > 0 ? dTop : dBottom;
    p.setZ(i, Math.sign(z) * d / 2);
    p.setY(i, y + h / 2);
  }
  p.needsUpdate = true;
  g.computeVertexNormals();
  return g;
}

/** Ring (annulus) as a flat mesh in XZ with planar world UVs (u = x / tile, v = z / tile). */
export function annulusGeometry(cx: number, cz: number, rIn: (a: number) => number, rOut: (a: number) => number, y: number, tile: number, segs = 128, radial = 1): THREE.BufferGeometry {
  const pos: number[] = [];
  const uv: number[] = [];
  const nrm: number[] = [];
  const idx: number[] = [];
  for (let i = 0; i <= segs; i++) {
    const a = (i / segs) * Math.PI * 2;
    const ri = rIn(a), ro = rOut(a);
    for (let j = 0; j <= radial; j++) {
      const r = ri + (ro - ri) * (j / radial);
      const x = cx + Math.cos(a) * r, z = cz + Math.sin(a) * r;
      pos.push(x, y, z);
      nrm.push(0, 1, 0);
      uv.push(x / tile, -z / tile);
    }
  }
  const W = radial + 1;
  for (let i = 0; i < segs; i++) {
    for (let j = 0; j < radial; j++) {
      const a = i * W + j, b = a + 1, c = a + W, d = c + 1;
      idx.push(a, c, b, b, c, d);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nrm, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.computeBoundingSphere();
  return g;
}

/** Flat polygon (convex or simple) in XZ at height y with planar UVs. */
export function flatPolygon(points: Array<{ x: number; z: number }>, y: number, tile: number): THREE.BufferGeometry {
  const shape = new THREE.Shape(points.map((p) => new THREE.Vector2(p.x, -p.z)));
  const g = new THREE.ShapeGeometry(shape);
  // ShapeGeometry is in XY; rotate so +Y of the shape maps to -Z of the world.
  g.rotateX(-Math.PI / 2);
  g.translate(0, y, 0);
  const p = g.getAttribute('position') as THREE.BufferAttribute;
  const uv = g.getAttribute('uv') as THREE.BufferAttribute;
  for (let i = 0; i < p.count; i++) uv.setXY(i, p.getX(i) / tile, -p.getZ(i) / tile);
  uv.needsUpdate = true;
  g.computeVertexNormals();
  return g;
}

/** Thin horizontal strip following a polyline (roads, paths) at height y, with planar UVs. */
export function stripGeometry(points: Array<{ x: number; z: number }>, halfWidth: number, y: number | ((x: number, z: number) => number), tile: number): THREE.BufferGeometry {
  const pos: number[] = [];
  const uv: number[] = [];
  const nrm: number[] = [];
  const idx: number[] = [];
  const n = points.length;
  for (let i = 0; i < n; i++) {
    const p = points[i];
    const a = points[Math.max(0, i - 1)], b = points[Math.min(n - 1, i + 1)];
    let tx = b.x - a.x, tz = b.z - a.z;
    const l = Math.hypot(tx, tz) || 1;
    tx /= l;
    tz /= l;
    const nx = -tz, nz = tx;
    for (const s of [-1, 1]) {
      const x = p.x + nx * halfWidth * s, z = p.z + nz * halfWidth * s;
      const yy = typeof y === 'function' ? y(x, z) : y;
      pos.push(x, yy, z);
      nrm.push(0, 1, 0);
      uv.push(x / tile, -z / tile);
    }
  }
  for (let i = 0; i < n - 1; i++) {
    const a = i * 2, b = a + 1, c = a + 2, d = a + 3;
    idx.push(a, c, b, b, c, d);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nrm, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  // Make sure faces point up.
  g.computeVertexNormals();
  const nr = g.getAttribute('normal') as THREE.BufferAttribute;
  if (nr.count && nr.getY(0) < 0) {
    for (let i = 0; i < idx.length; i += 3) {
      const t = idx[i + 1];
      idx[i + 1] = idx[i + 2];
      idx[i + 2] = t;
    }
    g.setIndex(idx);
    g.computeVertexNormals();
  }
  g.computeBoundingSphere();
  return g;
}
