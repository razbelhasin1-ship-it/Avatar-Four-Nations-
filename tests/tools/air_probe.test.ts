/**
 * Dev tool: prints terrain heights around the Southern Air Temple site.
 * Runs only when AIR_PROBE is set:  AIR_PROBE=1 npx vitest run tests/tools/air_probe.test.ts
 */
import { writeFileSync } from 'node:fs';
import { describe, it } from 'vitest';
import { heightAt, waterAt, initHeightfield } from '../../src/world/Heightfield';

describe.skipIf(!process.env.AIR_PROBE)('air probe', () => {
  it('prints', () => {
    initHeightfield();
    const mode = process.env.AIR_PROBE;
    const out: string[] = [];
    if (mode === 'polar' || mode === '1') {
      const C = { x: 1450, z: 1250 };
      const rs = [0, 30, 60, 80, 90, 95, 100, 105, 110, 115, 120, 130, 140, 160];
      out.push('ang\\r ' + rs.map((r) => String(r).padStart(5)).join(''));
      for (let a = 0; a < 360; a += 15) {
        const row = rs.map((r) => heightAt(C.x + Math.cos((a * Math.PI) / 180) * r, C.z + Math.sin((a * Math.PI) / 180) * r).toFixed(0).padStart(5));
        out.push(String(a).padStart(6) + ' ' + row.join(''));
      }
    }
    if (mode === 'pts' || mode === '1') {
      const pts = (process.env.AIR_PTS ?? '1210,980;1250,1060;1330,1110;1290,1150;1370,1170;1330,1200;1375,1215;1340,1080;1360,1110;1580,1350').split(';');
      for (const p of pts) {
        const [x, z] = p.split(',').map(Number);
        const h = heightAt(x, z);
        const w = waterAt(x, z, h);
        out.push(`${x},${z}: h=${h.toFixed(2)}${w ? ` water=${JSON.stringify(w)}` : ''}`);
      }
    }
    if (mode === 'grid') {
      const [x0, z0, x1, z1, step] = (process.env.AIR_GRID ?? '1180,950,1400,1240,10').split(',').map(Number);
      const xs: number[] = [];
      for (let x = x0; x <= x1; x += step) xs.push(x);
      out.push('z\\x   ' + xs.map((x) => String(x).padStart(5)).join(''));
      for (let z = z0; z <= z1; z += step) out.push(String(z).padStart(6) + ' ' + xs.map((x) => heightAt(x, z).toFixed(0).padStart(5)).join(''));
    }
    writeFileSync(process.env.AIR_OUT ?? "air_probe.txt", out.join("\n"));
  });
});
