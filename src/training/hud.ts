import { h, clear } from '../ui/dom';

/**
 * Challenge HUD: lesson title, objective, counters, timer bar, hint and the
 * success / failure stamp. Lives in the HUD layer (hidden with the HUD).
 */

const CSS = `
.trn-hud{position:absolute;top:58px;left:50%;transform:translateX(-50%);min-width:min(340px,92vw);max-width:min(520px,92vw);
  padding:6px 14px 8px;border:1px solid var(--line);border-radius:10px;background:var(--panel);color:var(--text);
  font-family:var(--font-body);text-align:center;pointer-events:none;box-shadow:0 6px 24px rgba(0,0,0,.35);z-index:5}
.trn-hud.hidden{display:none}
#ui.touch-on .trn-hud{top:calc(64px + env(safe-area-inset-top,0px));min-width:0;max-width:min(420px,52vw);padding:4px 10px 6px;background:rgba(12,16,22,.72)}
#ui.touch-on .trn-hud .trn-say,#ui.touch-on .trn-hud .trn-hint{font-size:11px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
#ui.touch-on .trn-hud .trn-count{font-size:15px}
.trn-hud .trn-kind{font-family:var(--font-title);font-size:11px;letter-spacing:.18em;text-transform:uppercase;color:var(--muted)}
.trn-hud .trn-title{font-family:var(--font-title);font-size:15px;color:var(--gold-2);margin:1px 0 2px}
.trn-hud .trn-obj{font-size:14px}
.trn-hud .trn-count{font-family:var(--font-title);font-size:18px;margin:2px 0 0}
.trn-hud .trn-bar{height:6px;border-radius:3px;background:rgba(255,255,255,.12);overflow:hidden;margin-top:6px}
.trn-hud .trn-bar>div{height:100%;background:linear-gradient(90deg,var(--gold),var(--gold-2));transform-origin:left;transition:transform .15s}
.trn-hud .trn-time{height:3px;border-radius:2px;background:rgba(255,255,255,.08);overflow:hidden;margin-top:4px}
.trn-hud .trn-time>div{height:100%;background:#9fd8ff;transform-origin:left}
.trn-hud .trn-time.low>div{background:var(--danger)}
.trn-hud .trn-hint{font-size:12px;color:var(--muted);margin-top:4px;font-style:italic}
.trn-hud .trn-say{font-size:13px;color:var(--parchment);margin-top:4px}
.trn-hud .trn-stamp{font-family:var(--font-title);font-size:26px;letter-spacing:.06em;margin:2px 0}
.trn-hud.success{border-color:var(--ok)} .trn-hud.success .trn-stamp{color:var(--ok)}
.trn-hud.failed{border-color:var(--danger)} .trn-hud.failed .trn-stamp{color:var(--danger)}
.trn-journal .trn-m{display:flex;gap:12px;align-items:flex-start}
.trn-journal .trn-l{margin:2px 0;font-size:15px}
.trn-journal .trn-l.done{color:var(--ok)} .trn-journal .trn-l.locked{color:var(--muted)}
.trn-journal .trn-note{border-left:3px solid var(--gold);padding:6px 10px;margin:0 0 12px;background:rgba(214,178,94,.08)}
.shop-row{display:flex;align-items:center;gap:10px;padding:7px 8px;border-bottom:1px solid rgba(214,178,94,.15)}
.shop-row .shop-icon{font-size:22px;width:32px;text-align:center}
.shop-row .shop-name{flex:1;min-width:0}
.shop-row .shop-name small{display:block;color:var(--muted);font-size:13px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.shop-row.shop-beast .shop-name small{white-space:normal}
.shop-row .shop-price{font-family:var(--font-title);min-width:70px;text-align:right}
.shop-row .shop-price.poor{color:var(--danger)}
.shop-cols{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1fr);gap:16px}
.shop-cols>div{min-width:0}
@media (max-width:760px){.shop-cols{grid-template-columns:1fr}}
`;

let injected = false;
export function injectTrainingCSS(): void {
  if (injected || typeof document === 'undefined') return;
  injected = true;
  const s = document.createElement('style');
  s.dataset.module = 'training';
  s.textContent = CSS;
  document.head.appendChild(s);
}

export interface HUDView {
  kind: string;
  title: string;
  objective: string;
  counter: string;
  progress: number;
  timeLeft: number | null;
  timeFrac: number;
  hint: string;
  say?: string;
  stamp?: string;
  state: 'running' | 'success' | 'failed' | 'intro';
}

export class ChallengeHUD {
  readonly el: HTMLElement;
  private sig = '';
  constructor(parent: HTMLElement) {
    injectTrainingCSS();
    this.el = h('div.trn-hud.hidden');
    parent.appendChild(this.el);
  }

  show(v: HUDView): void {
    this.el.classList.remove('hidden');
    this.el.classList.toggle('success', v.state === 'success');
    this.el.classList.toggle('failed', v.state === 'failed');
    const t = v.timeLeft === null ? '' : `${Math.max(0, Math.ceil(v.timeLeft))}s`;
    const sig = [v.kind, v.title, v.objective, v.counter, v.progress.toFixed(2), t, v.timeFrac.toFixed(2), v.hint, v.say, v.stamp, v.state].join('|');
    if (sig === this.sig) return;
    this.sig = sig;
    clear(this.el);
    const parts: Array<HTMLElement | null> = [
      h('div.trn-kind', v.kind),
      h('div.trn-title', v.title),
      v.stamp ? h('div.trn-stamp', v.stamp) : null,
      h('div.trn-obj', v.objective),
      v.counter ? h('div.trn-count', v.counter + (t ? `   ·   ${t}` : '')) : null,
      h('div.trn-bar', h('div', { style: { transform: `scaleX(${Math.max(0, Math.min(1, v.progress)).toFixed(3)})` } })),
      v.timeLeft !== null ? h(`div.trn-time${v.timeFrac < 0.25 ? '.low' : ''}`, h('div', { style: { transform: `scaleX(${Math.max(0, Math.min(1, v.timeFrac)).toFixed(3)})` } })) : null,
      v.say ? h('div.trn-say', `“${v.say}”`) : null,
      v.hint ? h('div.trn-hint', v.hint) : null,
    ];
    for (const p of parts) if (p) this.el.appendChild(p);
  }

  hide(): void {
    this.el.classList.add('hidden');
    this.sig = '';
  }

  get visible(): boolean {
    return !this.el.classList.contains('hidden');
  }

  dispose(): void {
    this.el.remove();
  }
}
