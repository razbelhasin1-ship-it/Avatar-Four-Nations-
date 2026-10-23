#!/usr/bin/env node
/**
 * Quick screenshot CLI.
 *   node scripts/shot.mjs --out /tmp/a.png --element water --wait 2000
 *   node scripts/shot.mjs --out /tmp/menu.png --menu
 *   node scripts/shot.mjs --out /tmp/x.png --element air --eval "g => g.teleport(1450,1250)" --eval "g => g.camera(2.5,0.3,8)"
 * Options: --width --height --preset low|medium|high --tutorial --menu --hideui --steps N
 */
import { launch } from './harness.mjs';

const args = process.argv.slice(2);
const opt = { evals: [] };
for (let i = 0; i < args.length; i++) {
  const a = args[i];
  const next = () => args[++i];
  if (a === '--out') opt.out = next();
  else if (a === '--element') opt.element = next();
  else if (a === '--wait') opt.wait = Number(next());
  else if (a === '--eval') opt.evals.push(next());
  else if (a === '--width') opt.width = Number(next());
  else if (a === '--height') opt.height = Number(next());
  else if (a === '--preset') opt.preset = next();
  else if (a === '--tutorial') opt.tutorial = true;
  else if (a === '--menu') opt.menu = true;
  else if (a === '--hideui') opt.hideui = true;
  else if (a === '--steps') opt.steps = Number(next());
}
const h = await launch({ width: opt.width ?? 1280, height: opt.height ?? 720, preset: opt.preset ?? 'low' });
try {
  if (opt.tutorial) await h.startTutorial();
  else if (!opt.menu) await h.newGame(opt.element ?? 'water');
  for (const src of opt.evals) {
    const r = await h.page.evaluate(([s]) => {
      const f = new Function('return (' + s + ')')();
      return f(window.__game);
    }, [src]);
    if (r !== undefined) console.log('eval →', JSON.stringify(r)?.slice(0, 2000));
  }
  if (opt.hideui) await h.eval((g) => g.hideUI(true));
  if (opt.steps) await h.step(opt.steps);
  await h.wait(opt.wait ?? 1500);
  await h.shot(opt.out ?? 'shot.png');
  const st = await h.state();
  console.log('state →', JSON.stringify({ mode: st.mode, player: st.player, region: st.region, fps: st.render.fps, calls: st.render.drawCalls, tris: st.render.triangles }));
  if (h.errors.length) console.log('ERRORS:\n' + h.errors.slice(0, 20).join('\n'));
  else console.log('no console errors');
  console.log('saved', opt.out ?? 'shot.png');
} finally {
  await h.close();
}
