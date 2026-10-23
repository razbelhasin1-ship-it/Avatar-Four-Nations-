/**
 * Browser test harness (Playwright + headless Chromium with SwiftShader WebGL).
 *
 *   import { launch } from './harness.mjs';
 *   const h = await launch({ width: 1280, height: 720 });
 *   await h.newGame('water');                  // or h.startTutorial()
 *   await h.eval(g => g.teleport(-250, -1560));
 *   await h.wait(1500);
 *   await h.shot('out.png');
 *   console.log(h.errors);                     // console errors + page errors
 *   await h.close();
 *
 * Each launch starts its own Vite dev server on a free port unless `url` is given,
 * so several agents can run harnesses concurrently.
 */
import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import net from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function freePort() {
  return new Promise((resolve, reject) => {
    const s = net.createServer();
    s.unref();
    s.on('error', reject);
    s.listen(0, '127.0.0.1', () => {
      const { port } = s.address();
      s.close(() => resolve(port));
    });
  });
}

async function startVite() {
  const port = await freePort();
  const proc = spawn(process.execPath, [path.join(ROOT, 'node_modules/vite/bin/vite.js'), '--port', String(port), '--strictPort', '--host', '127.0.0.1'], {
    cwd: ROOT,
    stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, BROWSER: 'none', A4N_TEST_SERVER: '1' },
  });
  let out = '';
  proc.stdout.on('data', (d) => (out += d));
  proc.stderr.on('data', (d) => (out += d));
  const url = `http://127.0.0.1:${port}/`;
  const t0 = Date.now();
  while (Date.now() - t0 < 30000) {
    try {
      const r = await fetch(url);
      if (r.ok) return { url, proc };
    } catch {}
    await new Promise((r) => setTimeout(r, 200));
  }
  proc.kill();
  throw new Error('vite did not start: ' + out);
}

export async function launch(opts = {}) {
  const { width = 1280, height = 720, url: givenUrl, preset = 'low', query = '', timeout = 120000, deviceScaleFactor = 1 } = opts;
  let server = null;
  let url = givenUrl;
  if (!url) {
    server = await startVite();
    url = server.url;
  }
  const browser = await chromium.launch({
    args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--enable-webgl', '--autoplay-policy=no-user-gesture-required'],
  });
  const context = await browser.newContext({ viewport: { width, height }, deviceScaleFactor });
  // Seed settings before the app boots (low preset keeps SwiftShader usable).
  await context.addInitScript((p) => {
    try {
      if (p && !localStorage.getItem('a4n.settings.seeded')) {
        const presets = {
          low: { preset: 'low', renderScale: 0.75, maxPixelRatio: 1, shadows: 'off', drawDistance: 450, lodBias: 0.6, particleDensity: 0.4, grassDensity: 0, foliageDensity: 0.5, postProcessing: false, bloom: false, ambientEffects: false, effectsQuality: 'low', dynamicLights: false, antialias: false },
          medium: { preset: 'medium', renderScale: 1, maxPixelRatio: 1, shadows: 'low', drawDistance: 750, lodBias: 0.3, particleDensity: 0.7, grassDensity: 0.5, foliageDensity: 0.8, postProcessing: true, bloom: true, ambientEffects: true, effectsQuality: 'medium', dynamicLights: false, antialias: true },
          high: { preset: 'high', renderScale: 1, maxPixelRatio: 1, shadows: 'medium', drawDistance: 1100, lodBias: 0.1, particleDensity: 1, grassDensity: 1, foliageDensity: 1, postProcessing: true, bloom: true, ambientEffects: true, effectsQuality: 'high', dynamicLights: true, antialias: true },
        };
        const g = presets[p] ?? presets.low;
        localStorage.setItem('a4n.settings', JSON.stringify({ graphics: g, audio: { muted: true } }));
        localStorage.setItem('a4n.settings.seeded', '1');
      }
    } catch {}
  }, preset);
  const page = await context.newPage();
  const errors = [];
  const logs = [];
  page.on('console', (m) => {
    const t = m.text();
    logs.push(`[${m.type()}] ${t}`);
    if (m.type() === 'error') errors.push(t);
  });
  page.on('pageerror', (e) => errors.push('pageerror: ' + (e.stack || e.message)));
  await page.goto(url + (query ? `?${query}` : ''), { timeout });
  await page.waitForFunction(() => window.__ready === true, null, { timeout });

  const h = {
    page,
    url,
    errors,
    logs,
    /** Evaluate fn(window.__game, ...args) in the page. */
    async eval(fn, ...args) {
      return page.evaluate(([src, a]) => {
        // eslint-disable-next-line no-new-func
        const f = new Function('return (' + src + ')')();
        return f(window.__game, ...a);
      }, [fn.toString(), args]);
    },
    async state() {
      return page.evaluate(() => window.__game.state());
    },
    async wait(ms) {
      await page.waitForTimeout(ms);
    },
    /** Advance the simulation deterministically by n fixed steps of dt. */
    async step(n = 30, dt = 1 / 30) {
      return page.evaluate(([n, dt]) => window.__game.step(n, dt), [n, dt]);
    },
    async newGame(element = 'water', extra = {}) {
      return page.evaluate(([e, x]) => window.__game.newGame({ element: e, ...x }), [element, extra]);
    },
    async startTutorial() {
      return page.evaluate(() => window.__game.startTutorial());
    },
    async shot(file, opts = {}) {
      await page.screenshot({ path: file, ...opts });
      return file;
    },
    async click(selector) {
      await page.click(selector);
    },
    async close() {
      await browser.close().catch(() => {});
      if (server) server.proc.kill();
    },
  };
  return h;
}
