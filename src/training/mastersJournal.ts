import { getTechnique } from '../combat/CombatSystem';
import type { GameContext } from '../core/GameContext';
import { ELEMENT_INFO, ELEMENTS, type Element } from '../core/types';
import { MASTERS, type LessonDef, type MasterDef } from '../data/masters';
import { clueOf, learnQuestId, ROUTE_HINTS, seekQuestId } from '../data/quests_masters';
import { MASTERY_REQUIREMENTS } from '../progression/Progression';
import { clear, h } from '../ui/dom';
import { chip } from '../ui/screens/gsBase';
import type { MasterGuide } from './MasterGuide';

/**
 * Journal → Masters: every master of the four nations — where they are (place, distance and
 * direction, the way there), whether you have met them, what they teach and what you have learned
 * — with Track buttons for a master or for any single ability (src/training/MasterGuide.ts). An
 * "Abilities" view lists every ability a master teaches, for "who teaches this?".
 */

type View = 'masters' | 'abilities';
const state: { view: View; element: Element | 'all' } = { view: 'masters', element: 'all' };

export interface MastersJournalHost {
  /** Known masters (met, or their place discovered, or a hidden master's clue found). */
  isKnown(m: MasterDef): boolean;
}

const elLower = (e: Element) => ELEMENT_INFO[e].name.toLowerCase();

function hiddenUnknown(ctx: GameContext, m: MasterDef): boolean {
  return !!m.hidden && !ctx.quests.hasFlag(m.hidden.flag) && !ctx.quests.hasFlag(`met_${m.id}`);
}

export function renderMastersJournal(ctx: GameContext, host: MastersJournalHost, guide: MasterGuide, el: HTMLElement, note: HTMLElement | null = null): void {
  const rerender = () => renderMastersJournal(ctx, host, guide, el, note);
  const pr = ctx.progression;
  const wrap = h('div.mg');
  if (note) wrap.append(note);

  const toMap = (pos: { x: number; z: number }) => {
    ctx.ui.close('journal');
    ctx.ui.open('map', { focus: { x: pos.x, z: pos.z } });
  };
  // The guide announces what it tracks (one toast, whichever screen asked).
  const track = (fn: () => boolean, questId: string) => {
    if (guide.isTracked(questId)) guide.stop();
    else fn();
    ctx.audio.play('ui_click', { bus: 'ui' });
    rerender();
  };

  // Views and element filter.
  const views = h('div.gs-chips', { role: 'toolbar', 'aria-label': 'Masters view' });
  for (const [id, label] of [['masters', 'Masters'], ['abilities', 'Abilities']] as Array<[View, string]>)
    views.append(chip(label, state.view === id, () => ((state.view = id), rerender()), { 'data-mg-view': id }));
  const els = h('div.gs-chips', { role: 'toolbar', 'aria-label': 'Element' });
  for (const id of ['all', ...ELEMENTS] as Array<Element | 'all'>)
    els.append(chip(id === 'all' ? 'All' : ELEMENT_INFO[id].name, state.element === id, () => ((state.element = id), rerender()), { 'data-mg-el': id }));
  wrap.append(h('div.mg-bar', views, els));

  // What you are following now.
  const tg = guide.trackedGuide;
  if (tg) {
    const t = ctx.quests.trackedTarget();
    wrap.append(
      h(
        'div.mg-follow',
        h('span', '◆ Following ', h('b', ctx.quests.get(tg)?.title ?? ''), t ? ` — ${guide.where(t).text}` : ''),
        t
          ? h('button.btn.small', {
              type: 'button',
              'data-action': 'mg-follow-map',
              onclick: () => {
                ctx.ui.close('journal');
                ctx.ui.open('map', { fit: guide.trackedRoute() ?? [{ x: t.x, z: t.z }] });
              },
            }, 'Show road on map')
          : null,
        h('button.btn.small', { type: 'button', 'data-action': 'mg-stop', onclick: () => (guide.stop(), rerender()) }, 'Stop'),
      ),
    );
  } else wrap.append(h('p.muted.mg-intro', 'Every master of the four nations. Track a master — or just the ability you want — and follow ◆ on your compass; the map draws the road there.'));

  const elements = ELEMENTS.filter((e) => state.element === 'all' || state.element === e);
  if (state.view === 'abilities') {
    for (const e of elements) {
      wrap.append(h('h3.mg-el', { style: { color: ELEMENT_INFO[e].glow } }, `${ELEMENT_INFO[e].name} abilities`));
      const list = h('div.mg-list');
      for (const m of MASTERS.filter((x) => x.element === e)) {
        const secret = hiddenUnknown(ctx, m);
        for (const l of m.lessons) list.append(abilityRow(ctx, guide, m, l, secret, track, true));
      }
      wrap.append(list);
    }
  } else {
    for (const e of elements) {
      const ms = pr.mastery[e];
      const req = MASTERY_REQUIREMENTS[e];
      const status = ms.mastered ? 'mastered' : pr.canBend(e) ? `${ms.lessons.length}/${req.lessons} master lessons` : 'not yet awakened — any of these masters can awaken it';
      wrap.append(h('h3.mg-el', { style: { color: ELEMENT_INFO[e].glow } }, `${ELEMENT_INFO[e].name} — ${status}`));
      for (const m of MASTERS.filter((x) => x.element === e)) wrap.append(masterCard(ctx, host, guide, m, track, toMap));
    }
  }
  clear(el);
  el.append(wrap);
}

function abilityRow(
  ctx: GameContext,
  guide: MasterGuide,
  m: MasterDef,
  l: LessonDef,
  secret: boolean,
  track: (fn: () => boolean, questId: string) => void,
  withWho: boolean,
): HTMLElement {
  const st = guide.abilityStatus(l);
  const qid = learnQuestId(l.id);
  const tracked = guide.isTracked(qid);
  const name = secret ? 'A secret technique' : getTechnique(l.technique)?.name ?? l.technique;
  const detail = secret ? '' : ` — “${l.title}”`;
  const after = st === 'locked' ? guide.missing(l) : [];
  return h(
    `div.mg-ab.${st}${tracked ? '.tracked' : ''}`,
    { 'data-lesson': l.id },
    h('span.mg-ab-mark', st === 'learned' ? '✓' : tracked ? '◆' : st === 'locked' ? '🔒' : '◇'),
    h(
      'span.mg-ab-name',
      h('b', name),
      h('span.muted', detail),
      after.length ? h('span.mg-ab-after', ` · after ${after.join(', ')}`) : null,
      withWho ? h('span.mg-who', secret ? ` · a hidden ${elLower(m.element)} master` : ` · ${m.name}, ${m.location}`) : null,
    ),
    st === 'learned'
      ? h('span.mg-ab-done', 'Learned')
      : h('button.btn.small.mg-track', { type: 'button', 'data-action': 'mg-track-ability', 'data-lesson': l.id, onclick: () => track(() => guide.trackLesson(l.id), qid) }, tracked ? '◆ Tracking' : 'Track'),
  );
}

function masterCard(
  ctx: GameContext,
  host: MastersJournalHost,
  guide: MasterGuide,
  m: MasterDef,
  track: (fn: () => boolean, questId: string) => void,
  toMap: (pos: { x: number; z: number }) => void,
): HTMLElement {
  const q = ctx.quests;
  const pr = ctx.progression;
  const e = m.element;
  const glow = ELEMENT_INFO[e].glow;
  const secret = hiddenUnknown(ctx, m);
  const met = q.hasFlag(`met_${m.id}`);
  const clue = clueOf(m);
  const pos = secret ? guide.cluePosition(m) ?? guide.masterPosition(m) : guide.masterPosition(m);
  const w = guide.where(pos);
  const qid = seekQuestId(m.id);
  const tracked = guide.isTracked(qid);
  const card = h(`div.gs-card.mg-card${tracked ? '.tracked' : ''}`, { 'data-master': m.id, style: { borderLeftColor: glow } });
  card.append(
    h(
      'div.mg-head',
      h('span.mg-star', { style: { color: glow } }, secret ? '?' : '✦'),
      h('div.mg-name', h('h4', secret ? `A hidden master of ${elLower(e)}` : m.name), h('div.mg-title', secret ? 'Only a rumour so far' : `${m.title}${m.grandmaster ? ' · Grandmaster' : ''}`)),
      h(`span.gs-badge${met ? '.gold' : ''}`, met ? 'Met' : secret ? 'Hidden' : host.isKnown(m) ? 'Not met' : 'Far away'),
    ),
    h('div.mg-where', secret && clue ? `Clue ${clue.place} · ${w.text}` : `${m.location} · ${w.text}`),
    h('div.mg-route', secret ? m.hidden!.hint : ROUTE_HINTS[m.region] ?? ''),
  );
  const abil = h('div.mg-abs');
  if (!pr.canBend(e)) abil.append(h('div.mg-ab.available', h('span.mg-ab-mark', '◇'), h('span.mg-ab-name', h('b', `Awaken ${elLower(e)}bending`), h('span.muted', ` — ${secret ? 'this master' : m.name} can awaken it in you`))));
  for (const l of m.lessons) abil.append(abilityRow(ctx, guide, m, l, secret, track, false));
  if (m.trial && !secret) {
    const ms = pr.mastery[e];
    const ready = pr.trialAvailable(e);
    abil.append(h(`div.mg-ab.${ms.trialComplete ? 'learned' : ready ? 'available' : 'locked'}`, h('span.mg-ab-mark', ms.trialComplete ? '✓' : ready ? '◇' : '🔒'), h('span.mg-ab-name', h('b', MASTERY_REQUIREMENTS[e].trialName), h('span.muted', ms.trialComplete ? ' — passed' : ready ? ' — ready!' : ` — after ${MASTERY_REQUIREMENTS[e].lessons} master lessons and ${MASTERY_REQUIREMENTS[e].proficiency} proficiency`))));
  }
  card.append(abil);
  const ft = guide.nearestTravel(pos);
  if (ft) card.append(h('div.mg-travel', `⟡ Fast travel: ${ft.l.name} is ${ft.meters >= 1000 ? `${(ft.meters / 1000).toFixed(1)} km` : `${Math.round(ft.meters)} m`} from there (open the map to travel).`));
  card.append(
    h(
      'div.mg-actions',
      h(`button.btn.small${tracked ? '' : '.primary'}`, { type: 'button', 'data-action': 'mg-track-master', 'data-master': m.id, onclick: () => track(() => guide.trackMaster(m.id), qid) }, tracked ? '◆ Tracking — stop' : secret ? '◆ Follow the rumour' : `◆ Track ${m.name}`),
      h('button.btn.small', { type: 'button', 'data-action': 'mg-map', onclick: () => toMap(pos) }, 'Show on map'),
    ),
  );
  return card;
}

/** Styles for the page (appended once). */
export const MASTERS_JOURNAL_CSS = `
.mg-bar{display:flex;flex-wrap:wrap;gap:6px 16px;align-items:center;margin:0 0 10px}
.mg-intro{margin:0 0 10px}
.mg-follow{display:flex;align-items:center;gap:10px;flex-wrap:wrap;padding:8px 12px;margin:0 0 12px;border:1px solid rgba(255,204,51,.45);border-radius:10px;background:rgba(255,204,51,.08)}
.mg-follow b{color:#ffd76a}
.mg-el{margin:16px 0 6px;font-family:var(--font-title);letter-spacing:.06em}
.mg-card{border-left:3px solid;margin:0 0 10px;padding:10px 12px}
.mg-card.tracked{box-shadow:inset 0 0 0 1px rgba(255,204,51,.55)}
.mg-head{display:flex;align-items:center;gap:10px}
.mg-star{font-size:24px;line-height:1;width:26px;text-align:center;flex:none}
.mg-name{flex:1;min-width:0}
.mg-name h4{margin:0}
.mg-title{font-size:13px;opacity:.75}
.mg-where{margin:6px 0 2px;font-size:14px}
.mg-route{font-size:13px;font-style:italic;opacity:.75;margin:0 0 6px}
.mg-ab{display:flex;align-items:center;gap:8px;padding:3px 0;font-size:14px}
.mg-ab-mark{width:18px;text-align:center;flex:none}
.mg-ab-name{flex:1;min-width:0}
.mg-ab.learned{opacity:.62}
.mg-ab.tracked .mg-ab-mark{color:#ffd76a}
.mg-ab-after,.mg-who{font-size:12.5px;opacity:.75}
.mg-ab-done{font-size:12px;opacity:.7}
.mg-list .mg-ab{border-bottom:1px solid rgba(255,255,255,.06);padding:6px 0}
.mg-travel{font-size:13px;margin-top:6px;opacity:.85}
.mg-actions{display:flex;gap:8px;flex-wrap:wrap;margin-top:8px}
`;
