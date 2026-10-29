import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { drape, sculpt, sdEllipsoid, sdRoundCone, smin, surfaceHit, SurfacePath } from '../../src/companions/models/Sculpt';

describe('creature sculpting', () => {
  it('meshes a closed, outward-facing surface on the field', () => {
    const f = (x: number, y: number, z: number) => smin(sdEllipsoid(x, y, z, 0, 0, 0, 1, 0.7, 1.2), sdRoundCone(x, y, z, 0, 0, 1, 0, 0.3, 2.2, 0.4, 0.2), 0.3);
    const g = sculpt(f, { min: [-1.4, -1, -1.6], max: [1.4, 1.2, 2.8], cell: 0.08 });
    const pos = g.attributes.position as THREE.BufferAttribute;
    const nrm = g.attributes.normal as THREE.BufferAttribute;
    const idx = g.index!.array;
    expect(pos.count).toBeGreaterThan(500);
    // Vertices lie on the surface.
    let worst = 0;
    for (let i = 0; i < pos.count; i++) worst = Math.max(worst, Math.abs(f(pos.getX(i), pos.getY(i), pos.getZ(i))));
    expect(worst).toBeLessThan(0.01);
    // Watertight: every edge is shared by exactly two triangles, in opposite directions.
    const edges = new Map<string, number>();
    for (let t = 0; t < idx.length; t += 3) {
      for (let e = 0; e < 3; e++) {
        const a = idx[t + e], b = idx[t + ((e + 1) % 3)];
        edges.set(`${a},${b}`, (edges.get(`${a},${b}`) ?? 0) + 1);
      }
    }
    for (const [k, n] of edges) {
      const [a, b] = k.split(',');
      expect(n).toBe(1);
      expect(edges.get(`${b},${a}`)).toBe(1);
    }
    // Faces wind outward, agreeing with the field normals.
    const va = new THREE.Vector3(), vb = new THREE.Vector3(), vc = new THREE.Vector3(), n = new THREE.Vector3();
    let agree = 0;
    for (let t = 0; t < idx.length; t += 3) {
      va.fromBufferAttribute(pos, idx[t]);
      vb.fromBufferAttribute(pos, idx[t + 1]).sub(va);
      vc.fromBufferAttribute(pos, idx[t + 2]).sub(va);
      n.fromBufferAttribute(nrm, idx[t]);
      if (vb.cross(vc).dot(n) > 0) agree++;
    }
    expect(agree / (idx.length / 3)).toBeGreaterThan(0.99);
  });

  it('drapes a layer along a surface path', () => {
    const f = (x: number, y: number, z: number) => sdEllipsoid(x, y, z, 0, 0, 0, 1, 0.8, 2);
    const pts: THREE.Vector3[] = [];
    for (let z = 1.6; z >= -1.6; z -= 0.1) pts.push(surfaceHit(f, new THREE.Vector3(0, 3, z), new THREE.Vector3(0, -1, 0))!);
    const path = new SurfacePath(pts);
    expect(path.length).toBeGreaterThan(3);
    const rows = Array.from({ length: 20 }, (_, i) => (i / 19) * path.length);
    const g = drape(f, path, { rows, halfWidth: () => 0.3, cols: 4, lift: 0.02, outward: () => new THREE.Vector3(0, 1, 0) });
    const pos = g.attributes.position as THREE.BufferAttribute;
    for (let i = 0; i < pos.count; i++) {
      const d = f(pos.getX(i), pos.getY(i), pos.getZ(i));
      expect(d).toBeGreaterThan(0.005);
      expect(d).toBeLessThan(0.04);
    }
    // Top layer faces up.
    g.computeVertexNormals();
    const nrm = g.attributes.normal as THREE.BufferAttribute;
    expect(nrm.getY(Math.floor(pos.count / 2))).toBeGreaterThan(0.5);
  });
});
