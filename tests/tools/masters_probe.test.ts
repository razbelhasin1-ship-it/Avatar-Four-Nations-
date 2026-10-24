/**
 * Dev tool: terrain probe for master fallback sites (Omashu, Kyoshi Village, Foggy Swamp).
 * Runs only when MASTERS_PROBE is set:  MASTERS_PROBE=1 npx vitest run tests/tools/masters_probe.test.ts
 */
import { writeFileSync } from 'node:fs';
import { describe, it } from 'vitest';
import { heightAt, waterAt, initHeightfield } from '../../src/world/Heightfield';

describe.skipIf(!process.env.MASTERS_PROBE)('masters probe', () => {
  it('prints', () => {
    initHeightfield();
    const sites: Array<[string, number, number]> = [['omashu', -450, -650], ['kyoshi', 1820, -440], ['banyan', -1150, -140], ['misty', 160, 860], ['river', 120, -560]];
    for (const [name, cx, cz] of sites) {
      const out: string[] = [`== ${name} (${cx},${cz})`];
      for (const r of [0, 10, 20, 30, 45, 60, 75, 85, 95]) {
        const row: string[] = [];
        for (let a = 0; a < 360; a += 45) {
          const x = cx + Math.cos((a * Math.PI) / 180) * r, z = cz + Math.sin((a * Math.PI) / 180) * r;
          const h = heightAt(x, z);
          const w = waterAt(x, z, h);
          row.push(`${h.toFixed(1)}${w ? 'w' : ''}`.padStart(7));
        }
        out.push(`r${String(r).padStart(3)}:` + row.join(''));
      }
      (globalThis as any).__out = ((globalThis as any).__out ?? '') + out.join('\n') + '\n';
    }
    writeFileSync(process.env.MASTERS_PROBE_OUT ?? '/dev/stdout', (globalThis as any).__out);
  });
});
