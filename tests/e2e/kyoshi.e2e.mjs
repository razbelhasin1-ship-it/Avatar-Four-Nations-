// Kyoshi Island travel test: from each of the four cities, three round trips to the island and back.
// Checks: arrival on the island (its own map), the origin is remembered, coming home puts you at the
// city's travel point with quests, inventory, weather unchanged and the clock a few minutes on;
// saving and loading on the island; the island's people/boats/landmarks exist; a cinematic trip
// can be skipped; no console errors; no memory growth over the round trips.
//   node tests/e2e/kyoshi.e2e.mjs
import { launch } from '../../scripts/harness.mjs';

const h = await launch({ width: 640, height: 360, preset: 'low' });
let failed = 0;
const ok = (cond, msg, extra = '') => {
  console.log(`${cond ? 'PASS' : 'FAIL'} ${msg}${extra ? ' ' + extra : ''}`);
  if (!cond) failed++;
};

try {
  await h.newGame('earth');
  await h.eval((g) => { g.debug.enemies?.clear?.(); g.debug.enemies?.camps?.(false); });
  await h.step(10);
  ok(await h.eval((g) => !!g.debug.travel), 'travel debug API installed');
  const routes = await h.eval((g) => g.debug.travel.routes());
  ok(routes.length === 8, 'routes table has the 8 routes', JSON.stringify(routes));

  const snapshot = () =>
    h.eval((g) => {
      const q = [...g.ctx.quests.active.entries()].map(([id, p]) => `${id}:${p.step}`).sort().join(',');
      const inv = JSON.stringify(g.ctx.inventory.serialize?.() ?? null);
      const env = g.ctx.extra.get('environment');
      const m = g.ctx.render.renderer.info.memory;
      return { q, inv, weather: env?.weather?.state?.().weather ?? null, hour: g.ctx.world.sky.timeOfDay, geo: m.geometries, tex: m.textures };
    });

  let baseMem = null;
  for (const city of ['bss', 'nwt', 'fnc', 'sat']) {
    // Walk up to the city's travel point (streamed in like a fast travel).
    await h.eval(async (g, city) => {
      const p = g.debug.travel.points()[city].stand;
      const v = g.ctx.player.position.clone();
      v.set(p.x, 0, p.z);
      await g.ctx.world.preload(v);
      g.teleport(p.x, p.z, p.y);
    }, city);
    await h.step(30);
    const before = await snapshot();
    if (!baseMem) baseMem = before;
    const pt = await h.eval((g, city) => g.ctx.world.getRegionContent('travel_' + city)?.info?.(), city);
    ok(!!pt?.built && pt.npcs.length >= 3, `${city}: travel point built with staff and travellers`, JSON.stringify(pt?.npcs ?? []));
    for (let trip = 1; trip <= 3; trip++) {
      const there = await h.eval(async (g, city) => {
        const r = await g.debug.travel.go(`${city}_to_kyoshi`, true);
        for (let i = 0; i < 20; i++) g.step(1);
        const p = g.state().player;
        return { r, s: g.debug.travel.status(), region: g.ctx.world.regionAt(p.x, p.z)?.name, ready: g.ctx.world.getRegionContent('kyoshi_isle')?.ready, x: p.x };
      }, city);
      ok(there.r && there.s.onIsland && there.region === 'Kyoshi Island' && there.ready && there.s.origin === city, `${city} trip ${trip}: arrived on Kyoshi Island`, JSON.stringify(there.s));
      const home = await h.eval(async (g, city) => {
        const r = await g.debug.travel.back(true);
        for (let i = 0; i < 20; i++) g.step(1);
        const p = g.state().player, st = g.debug.travel.points()[city].stand;
        return { r, s: g.debug.travel.status(), d: Math.hypot(p.x - st.x, p.z - st.z), islandBuilt: !!g.ctx.world.getRegionContent('kyoshi_isle')?.ready };
      }, city);
      ok(home.r && !home.s.onIsland && home.d < 4 && home.s.origin === null, `${city} trip ${trip}: home at the travel point`, `d=${home.d.toFixed(2)}`);
      ok(!home.islandBuilt, `${city} trip ${trip}: island freed after leaving`);
    }
    const after = await snapshot();
    ok(after.q === before.q, `${city}: quests unchanged`);
    ok(after.inv === before.inv, `${city}: inventory unchanged`);
    ok(after.weather === before.weather, `${city}: weather as left`, `${before.weather} -> ${after.weather}`);
    const dh = ((after.hour - before.hour) + 24) % 24;
    ok(dh > 0.1 && dh < 1.2, `${city}: clock moved on a few minutes per trip`, `+${(dh * 60).toFixed(0)} min over 6 legs`);
  }
  const end = await snapshot();
  ok(end.geo - baseMem.geo < 120 && end.tex - baseMem.tex < 12, 'no memory growth over 12 round trips', `geometries ${baseMem.geo}->${end.geo}, textures ${baseMem.tex}->${end.tex}`);

  // On the island: people, boats, landmarks; save and load there.
  const isl = await h.eval(async (g) => {
    await g.debug.travel.go('fnc_to_kyoshi', true);
    for (let i = 0; i < 40; i++) g.step(1);
    const k = g.debug.kyoshi;
    return { marks: Object.keys(k?.marks() ?? {}), life: k?.life?.() ?? null, sea: k?.sea?.() ?? null };
  });
  for (const m of ['statue', 'meeting_hall', 'dojo', 'shrine', 'mural', 'bridge', 'harbor_pier', 'bay_beach', 'meadow']) ok(isl.marks.includes(m), `island landmark: ${m}`);
  // About 180 islanders (the Low preset, which this test runs, thins crowds to 70%).
  if (isl.life) ok(isl.life.total >= 120, 'islanders simulated (180, 126 on Low)', JSON.stringify(isl.life));
  if (isl.sea) ok(isl.sea.fishing >= 10 && isl.sea.traders >= 2, 'boats in the bay', JSON.stringify(isl.sea));
  const saved = await h.eval((g) => g.ctx.game.saveGame('slot3'));
  const loaded = await h.eval(async (g) => g.ctx.game.loadGame('slot3'));
  await h.step(20);
  const after = await h.eval((g) => ({ s: g.debug.travel.status(), region: g.ctx.world.regionAt(g.state().player.x, g.state().player.z)?.name }));
  ok(saved && loaded && after.s.onIsland && after.region === 'Kyoshi Island' && after.s.origin === 'fnc', 'save and load on the island', JSON.stringify(after.s));

  // A cinematic journey home, skipped half-way.
  const cine = await h.eval(async (g) => {
    const p = g.debug.travel.back(false);
    for (let i = 0; i < 45; i++) g.step(1);
    const mid = g.debug.travel.status().journey.phase;
    g.debug.travel.skip();
    for (let i = 0; i < 600 && g.debug.travel.status().busy; i++) {
      g.step(1);
      await new Promise((r) => setTimeout(r, 0));
    }
    const r = await p;
    return { r, mid, s: g.debug.travel.status() };
  });
  ok(cine.r && !cine.s.busy && !cine.s.onIsland, 'cinematic journey runs and can be skipped', `phase mid-way: ${cine.mid}`);

  // The open sea between the maps turns you back.
  const b = await h.eval((g) => {
    g.teleport(2600, 0);
    for (let i = 0; i < 4; i++) g.step(1);
    return g.state().player.x;
  });
  ok(b < 2250, 'currents turn swimmers back at the edge of the map', `x=${b.toFixed(0)}`);

  ok(h.errors.length === 0, 'no console errors', h.errors.slice(0, 3).join(' | '));
} catch (e) {
  console.log('FAIL exception', e?.message ?? e);
  failed++;
} finally {
  await h.close();
}
console.log(failed ? `kyoshi e2e: ${failed} FAILED` : 'kyoshi e2e: ALL PASSED');
process.exit(failed ? 1 : 0);
