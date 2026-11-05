/**
 * The moonlit koi pond behind the letter: two koi, one pale with a dark spot and one ink-dark with
 * a pale spot, circling each other forever. Canvas 2D; draws only while the About page is on screen.
 */
import { reducedMotion } from '../ui/dom';

interface Koi {
  pts: Array<[number, number]>;
  phase: number;
  body: string;
  spot: string;
  rim: string;
}

const SEGS = 18;

export function initAbout(): { setActive(on: boolean): void } {
  const canvas = document.getElementById('koi-canvas') as HTMLCanvasElement | null;
  const ctx = canvas?.getContext('2d');
  if (!canvas || !ctx) return { setActive: () => {} };

  let w = 0;
  let hgt = 0;
  let dpr = 1;
  let raf = 0;
  let active = false;
  let visible = true;
  let t = 0;
  let last = 0;
  const still = reducedMotion();

  const fish: Koi[] = [
    { pts: [], phase: 0, body: '#f3efe4', spot: '#16171b', rim: 'rgba(255,255,255,0.0)' },
    { pts: [], phase: Math.PI, body: '#141519', spot: '#f1ece0', rim: 'rgba(170,205,255,0.55)' },
  ];
  const ripples: Array<{ x: number; y: number; age: number }> = [];
  const pads = Array.from({ length: 7 }, (_, i) => ({ a: (i / 7) * Math.PI * 2 + 0.4, r: 0.9 + (i % 3) * 0.12, s: 0.55 + ((i * 37) % 10) / 20, rot: i * 1.7 }));

  const centre = () => {
    const wide = w > 860;
    return { cx: wide ? w * 0.72 : w * 0.56, cy: wide ? hgt * 0.3 : hgt * 0.16, R: wide ? Math.min(250, w * 0.17) : Math.min(140, w * 0.3) };
  };

  const resize = () => {
    dpr = Math.min(window.devicePixelRatio || 1, 1.5);
    w = canvas.clientWidth;
    hgt = canvas.clientHeight;
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(hgt * dpr);
    for (const f of fish) f.pts = [];
  };

  const headAt = (f: Koi, time: number): [number, number] => {
    const { cx, cy, R } = centre();
    const a = time * 0.32 + f.phase;
    const wob = 1 + 0.08 * Math.sin(time * 0.9 + f.phase);
    return [cx + Math.cos(a) * R * wob, cy + Math.sin(a) * R * 0.62 * wob];
  };

  const step = (f: Koi) => {
    const seg = segLen();
    const head = headAt(f, t);
    if (!f.pts.length) {
      // Lay the body along the path behind the head.
      for (let i = 0; i < SEGS; i++) f.pts.push(headAt(f, t - i * 0.06));
    }
    f.pts[0] = head;
    for (let i = 1; i < SEGS; i++) {
      const [px, py] = f.pts[i - 1];
      const [x, y] = f.pts[i];
      const dx = x - px;
      const dy = y - py;
      const d = Math.hypot(dx, dy) || 1;
      f.pts[i] = [px + (dx / d) * seg, py + (dy / d) * seg];
    }
  };

  /** Body segment length: the koi grow with the pond. */
  const segLen = () => Math.max(8, Math.min(16, w / 95));
  const widthAt = (i: number) => {
    const u = i / (SEGS - 1);
    return Math.max(0.6, 19 * (segLen() / 11) * Math.pow(Math.sin(Math.PI * Math.min(1, u * 0.95 + 0.12)), 0.85) * (1 - u * 0.6));
  };

  const drawKoi = (f: Koi) => {
    const P = f.pts;
    const left: Array<[number, number]> = [];
    const right: Array<[number, number]> = [];
    for (let i = 0; i < SEGS; i++) {
      const a = P[Math.max(0, i - 1)];
      const b = P[Math.min(SEGS - 1, i + 1)];
      let nx = -(b[1] - a[1]);
      let ny = b[0] - a[0];
      const nl = Math.hypot(nx, ny) || 1;
      nx /= nl;
      ny /= nl;
      const wd = widthAt(i);
      left.push([P[i][0] + nx * wd, P[i][1] + ny * wd]);
      right.push([P[i][0] - nx * wd, P[i][1] - ny * wd]);
    }
    const dir = (i: number) => Math.atan2(P[i][1] - P[i + 1][1], P[i][0] - P[i + 1][0]);
    const sway = Math.sin(t * 5 + f.phase) * 0.35;

    // Shadow on the pond floor.
    ctx.save();
    ctx.translate(10, 16);
    ctx.globalAlpha = 0.28;
    ctx.fillStyle = '#000';
    ctx.filter = 'blur(6px)';
    ctx.beginPath();
    left.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
    for (let i = right.length - 1; i >= 0; i--) ctx.lineTo(right[i][0], right[i][1]);
    ctx.fill();
    ctx.restore();

    // Fins: pectoral pair and a flowing tail.
    const fin = (i: number, side: number, len: number, wid: number, rot: number) => {
      const a = dir(i) + side * (1.9 + rot);
      ctx.save();
      ctx.translate(P[i][0], P[i][1]);
      ctx.rotate(a);
      ctx.beginPath();
      ctx.ellipse(len * 0.5, 0, len * 0.55, wid, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    };
    ctx.fillStyle = f.body === '#141519' ? 'rgba(40,44,56,0.75)' : 'rgba(246,238,222,0.55)';
    const k = segLen() / 11;
    fin(3, 1, 20 * k, 6 * k, sway * 0.4);
    fin(3, -1, 20 * k, 6 * k, -sway * 0.4);
    const tail = P[SEGS - 1];
    const ta = dir(SEGS - 2) + Math.PI;
    ctx.save();
    ctx.translate(tail[0], tail[1]);
    ctx.rotate(ta + sway);
    ctx.scale(k, k);
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.quadraticCurveTo(22, -16, 34, -10 + sway * 6);
    ctx.quadraticCurveTo(22, 0, 34, 10 + sway * 6);
    ctx.quadraticCurveTo(22, 16, 0, 0);
    ctx.fill();
    ctx.restore();

    // Body.
    ctx.beginPath();
    ctx.moveTo(left[0][0], left[0][1]);
    for (let i = 1; i < SEGS; i++) ctx.lineTo(left[i][0], left[i][1]);
    for (let i = SEGS - 1; i >= 0; i--) ctx.lineTo(right[i][0], right[i][1]);
    ctx.closePath();
    ctx.fillStyle = f.body;
    ctx.fill();
    if (f.rim !== 'rgba(255,255,255,0.0)') {
      ctx.strokeStyle = f.rim;
      ctx.lineWidth = 1.1;
      ctx.stroke();
    }
    // The spot (Tui's dark eye in the light, La's light eye in the dark).
    const sp = P[4];
    ctx.beginPath();
    ctx.arc(sp[0], sp[1], 5.2 * k, 0, Math.PI * 2);
    ctx.fillStyle = f.spot;
    ctx.fill();
    // Eyes.
    const hd = dir(0);
    for (const s of [-1, 1]) {
      ctx.beginPath();
      ctx.arc(P[1][0] + Math.cos(hd + s * 1.25) * 7 * k, P[1][1] + Math.sin(hd + s * 1.25) * 7 * k, 1.6 * k, 0, Math.PI * 2);
      ctx.fillStyle = f.body === '#141519' ? '#cfe3ff' : '#1a1a1a';
      ctx.fill();
    }
  };

  const draw = () => {
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    // Water.
    const g = ctx.createLinearGradient(0, 0, 0, hgt);
    g.addColorStop(0, '#071423');
    g.addColorStop(1, '#0a0c12');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, hgt);
    const { cx, cy, R } = centre();
    // Moonlight on the pond.
    const m = ctx.createRadialGradient(cx, cy, 0, cx, cy, R * 2.4);
    m.addColorStop(0, 'rgba(160,200,255,0.16)');
    m.addColorStop(1, 'rgba(160,200,255,0)');
    ctx.fillStyle = m;
    ctx.fillRect(0, 0, w, hgt);
    // Caustic shimmer.
    ctx.strokeStyle = 'rgba(150,200,255,0.05)';
    ctx.lineWidth = 1;
    for (let k = 0; k < 9; k++) {
      ctx.beginPath();
      for (let x = 0; x <= w; x += 24) {
        const y = (k + 1) * (hgt / 10) + Math.sin(x * 0.012 + t * 0.6 + k) * 8 + Math.sin(x * 0.031 - t * 0.4 + k * 2) * 4;
        if (x === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.stroke();
    }
    // Ripples.
    for (const r of ripples) {
      ctx.strokeStyle = `rgba(190,220,255,${0.22 * (1 - r.age / 4)})`;
      ctx.lineWidth = 1.2;
      ctx.beginPath();
      ctx.ellipse(r.x, r.y, r.age * 34, r.age * 22, 0, 0, Math.PI * 2);
      ctx.stroke();
    }
    for (const f of fish) drawKoi(f);
    // Lily pads drifting at the edge of the circle.
    for (const p of pads) {
      const a = p.a + t * 0.015;
      const x = cx + Math.cos(a) * R * 1.75 * p.r;
      const y = cy + Math.sin(a) * R * 1.05 * p.r;
      ctx.save();
      ctx.translate(x, y);
      ctx.rotate(p.rot + t * 0.02);
      ctx.beginPath();
      ctx.moveTo(0, 0);
      ctx.arc(0, 0, 16 * p.s, 0.35, Math.PI * 2 - 0.05);
      ctx.closePath();
      ctx.fillStyle = 'rgba(52,96,64,0.75)';
      ctx.fill();
      ctx.strokeStyle = 'rgba(120,170,120,0.35)';
      ctx.stroke();
      ctx.restore();
    }
  };

  const frame = (now: number) => {
    raf = 0;
    if (!active || !visible) return;
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    t += dt;
    // The page may have just been shown: size the canvas to its box.
    if (canvas.clientWidth !== w || canvas.clientHeight !== hgt) resize();
    if (!w || !hgt) {
      raf = requestAnimationFrame(frame);
      return;
    }
    for (const f of fish) step(f);
    for (const r of ripples) r.age += dt;
    while (ripples.length && ripples[0].age > 4) ripples.shift();
    if (Math.random() < dt * 0.35) {
      const { cx, cy, R } = centre();
      ripples.push({ x: cx + (Math.random() - 0.5) * R * 3, y: cy + (Math.random() - 0.5) * R * 1.6, age: 0 });
    }
    draw();
    if (!still) raf = requestAnimationFrame(frame);
  };

  const kick = () => {
    if (raf || !active || !visible) return;
    last = performance.now();
    raf = requestAnimationFrame(frame);
  };

  resize();
  addEventListener('resize', () => {
    resize();
    if (still) {
      for (const f of fish) step(f);
      draw();
    }
  });
  if ('IntersectionObserver' in window) {
    new IntersectionObserver((e) => {
      visible = e.some((x) => x.isIntersecting);
      kick();
    }).observe(canvas);
  }
  canvas.parentElement?.addEventListener('pointerdown', (e) => {
    const r = canvas.getBoundingClientRect();
    ripples.push({ x: e.clientX - r.left, y: e.clientY - r.top, age: 0 });
  });

  return {
    setActive(on: boolean) {
      active = on;
      if (on) {
        resize();
        kick();
      } else {
        cancelAnimationFrame(raf);
        raf = 0;
      }
    },
  };
}
