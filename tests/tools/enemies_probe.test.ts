/**
 * Dev tool: terrain probe for enemy boss/camp/test-arena placement.
 * Runs only when ENEMY_PROBE is set:  ENEMY_PROBE=1 npx vitest run tests/tools/enemies_probe.test.ts
 * Output: $ENEMY_OUT (default <tmpdir>/a4n-enemy-probe.txt).
 */
import { writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, it } from 'vitest';
import { heightAt, initHeightfield, normalAt, waterAt } from '../../src/world/Heightfield';

describe.skipIf(!process.env.ENEMY_PROBE)('enemy probe', () => {
  it('prints', () => {
    initHeightfield();
    const out: string[] = [];
    const info = (x: number, z: number) => {
      const h = heightAt(x, z);
      const w = waterAt(x, z, h);
      const n = normalAt(x, z, 1);
      return `${x},${z}: h=${h.toFixed(1)} ny=${n.y.toFixed(2)}${w ? ` water(${w.kind},lvl ${w.level.toFixed(1)}${w.frozen ? ',frozen' : ''})` : ''}`;
    };
    const pts = (process.env.ENEMY_PTS ?? '-772,691;-738,652;1060,170;1118,184;500,1380').split(';');
    for (const p of pts) {
      const [x, z] = p.split(',').map(Number);
      out.push(info(x, z));
    }
    // Southern coast candidates: dry, gentle land within 22 m of liquid ocean.
    const cands: string[] = [];
    for (let x = -700; x <= 1200; x += 40) {
      for (let z = 1100; z <= 1800; z += 40) {
        const h = heightAt(x, z);
        if (h < 1 || h > 8) continue;
        if (Math.hypot(x - 220, z - 1600) < 330 || Math.hypot(x - 1450, z - 1250) < 450) continue;
        if (normalAt(x, z, 1).y < 0.95) continue;
        let ocean = false;
        for (let a = 0; a < 8 && !ocean; a++) {
          const w = waterAt(x + Math.cos((a * Math.PI) / 4) * 22, z + Math.sin((a * Math.PI) / 4) * 22);
          if (w && w.kind === 'ocean' && !w.frozen) ocean = true;
        }
        if (ocean) cands.push(`${x},${z} h=${h.toFixed(1)}`);
      }
    }
    out.push('south coast: ' + cands.slice(0, 40).join(' | '));
    // Arena candidates: flatness within 25 m and distance to the nearest liquid water (rings up to 80 m).
    for (const a of (process.env.ENEMY_ARENAS ?? '1220,-340;700,400;200,-250').split(';')) {
      const [x, z] = a.split(',').map(Number);
      const h0 = heightAt(x, z);
      let maxd = 0;
      for (let r = 5; r <= 25; r += 5) for (let k = 0; k < 12; k++) maxd = Math.max(maxd, Math.abs(heightAt(x + Math.cos((k / 12) * Math.PI * 2) * r, z + Math.sin((k / 12) * Math.PI * 2) * r) - h0));
      let wd = -1;
      for (let r = 0; r <= 80 && wd < 0; r += 4) {
        for (let k = 0; k < 24; k++) {
          const w = waterAt(x + Math.cos((k / 24) * Math.PI * 2) * r, z + Math.sin((k / 24) * Math.PI * 2) * r);
          if (w && !w.frozen) {
            wd = r;
            break;
          }
        }
      }
      out.push(`arena ${x},${z}: h=${h0.toFixed(1)} maxdiff25=${maxd.toFixed(1)} water@${wd < 0 ? '>80' : wd}`);
    }
    writeFileSync(process.env.ENEMY_OUT ?? path.join(os.tmpdir(), 'a4n-enemy-probe.txt'), out.join('\n'));
  });
});
