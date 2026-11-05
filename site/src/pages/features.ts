import {
  ART_QUESTS,
  BOSSES,
  CATEGORIES,
  COMPANIONS,
  CREATOR,
  DISCOVERY_QUESTS,
  ELEMENT_NAMES,
  ELEMENT_STYLE,
  ENEMIES,
  KIND_LABEL,
  MAIN_QUEST,
  MASTERS,
  NATIONS,
  SIDE_QUESTS,
  SUB_ARTS,
  TECHNIQUE_COUNT,
  TECHNIQUES,
  ULTIMATES,
  WEATHER,
  WILDLIFE,
  type ElementId,
  type FeatureCategory,
  type Technique,
} from '../data/catalogue';
import { h, icon } from '../ui/dom';

const ELEMENTS: ElementId[] = ['water', 'earth', 'fire', 'air'];

const CAT_ICON: Record<string, [string, string?]> = {
  bending: ['i-emblem', '0 0 40 40'],
  avatar: ['i-arrow'],
  arts: ['i-moon'],
  masters: ['i-tea'],
  world: ['i-map'],
  living: ['i-sun'],
  quests: ['i-compass'],
  combat: ['i-sword'],
  companions: ['i-paw'],
  character: ['i-mask'],
  sound: ['i-music'],
  controls: ['i-pad'],
  platforms: ['i-device'],
};

const TINT: Record<FeatureCategory['tint'], string> = {
  water: 'var(--water-glow)',
  earth: 'var(--earth-glow)',
  fire: 'var(--fire-glow)',
  air: 'var(--air-glow)',
  avatar: 'var(--avatar)',
  gold: 'var(--gold-2)',
};

/** Elements whose text can be highlighted by the search (original text kept in a data attribute). */
const hl = (tag: 'h3' | 'p' | 'b' | 'span' | 'em' | 'small' | 'h4', text: string, cls?: string) => h(tag, { class: cls, 'data-hl': '' }, text);

function techItem(t: Technique, el: string): HTMLElement {
  const li = h(
    'li',
    { class: 'tech', 'data-unit': '' },
    h('div', { class: 'tech__top' }, hl('span', t.name, 'tech__name'), h('span', { class: 'badge' }, KIND_LABEL[t.kind])),
    hl('p', t.text),
    t.note ? hl('span', t.note, 'tech__note') : null,
  );
  li.style.setProperty('--el', el);
  return li;
}

function techniquesDetail(): HTMLElement {
  const wrap = h('div', { class: 'detail detail--tech' });
  const tabs = h('div', { class: 'el-tabs', role: 'tablist', 'aria-label': 'Element' });
  const groups = ELEMENTS.map((el) => {
    const g = h(
      'section',
      { class: 'tech-group', 'data-el': el, id: `tech-${el}`, role: 'tabpanel', 'aria-labelledby': `tech-tab-${el}` },
      h('h4', { class: 'tech-group__name', hidden: true }, icon(`g-${el}`), `${ELEMENT_NAMES[el]}bending`),
      h('p', { class: 'style-line' }, ELEMENT_STYLE[el].style),
      h('ul', { class: 'tech-list' }, ...TECHNIQUES[el].map((t) => techItem(t, `var(--${el}-glow)`))),
    );
    g.style.setProperty('--el', `var(--${el}-glow)`);
    return g;
  });
  const buttons = ELEMENTS.map((el, i) => {
    const b = h(
      'button',
      { class: 'el-tab', type: 'button', role: 'tab', id: `tech-tab-${el}`, 'aria-controls': `tech-${el}`, 'aria-selected': String(i === 0) },
      icon(`g-${el}`),
      ELEMENT_NAMES[el],
      h('em', null, TECHNIQUES[el].length),
    );
    b.style.setProperty('--el', `var(--${el}-glow)`);
    b.addEventListener('click', () => select(i));
    b.addEventListener('keydown', (e) => {
      const k = (e as KeyboardEvent).key;
      if (k === 'ArrowRight' || k === 'ArrowLeft') {
        e.preventDefault();
        const n = (i + (k === 'ArrowRight' ? 1 : 3)) % 4;
        select(n);
        buttons[n].focus();
      }
    });
    return b;
  });
  const select = (i: number) => {
    buttons.forEach((b, j) => b.setAttribute('aria-selected', String(i === j)));
    groups.forEach((g, j) => (g.hidden = i !== j));
    wrap.dataset.selected = String(i);
  };
  tabs.append(...buttons);
  wrap.append(tabs, ...groups);
  select(0);
  return wrap;
}

function ultimatesDetail(): HTMLElement {
  return h(
    'div',
    { class: 'detail' },
    h('p', { class: 'detail__title' }, 'The Elements Sphere: five ultimates'),
    h('ul', { class: 'tech-list' }, ...ULTIMATES.map((t) => techItem(t, 'var(--avatar)'))),
  );
}

function artsDetail(): HTMLElement {
  return h(
    'div',
    { class: 'arts' },
    ...SUB_ARTS.map((a) => {
      const el = `var(--${a.parent}-glow)`;
      const card = h(
        'article',
        { class: 'art', 'data-unit': '' },
        h('h4', null, icon(`g-${a.parent}`), hl('span', a.name)),
        hl('p', a.unlock, 'art__unlock'),
        hl('p', a.text),
        h('ul', null, ...a.moves.map((m) => h('li', null, hl('b', m.name), hl('span', m.text), m.note ? hl('em', m.note) : null))),
      );
      card.style.setProperty('--el', el);
      return card;
    }),
  );
}

function mastersDetail(): HTMLElement {
  return h(
    'div',
    { class: 'detail' },
    h(
      'div',
      { class: 'masters' },
      ...ELEMENTS.map((el) => {
        const col = h(
          'div',
          { class: 'master-col' },
          h('h4', null, icon(`g-${el}`), ELEMENT_NAMES[el]),
          ...MASTERS.filter((m) => m.element === el).map((m) =>
            h(
              'div',
              { class: 'master', 'data-unit': '' },
              hl('b', m.name),
              hl('small', `${m.title}${m.grandmaster && !/grandmaster/i.test(m.title) ? ' · grandmaster' : ''}${m.hidden ? ' · found by clues' : ''}`),
              hl('span', m.place),
              hl('span', `Teaches: ${m.teaches.join(', ')}`, 'teach'),
            ),
          ),
        );
        col.style.setProperty('--el', `var(--${el}-glow)`);
        return col;
      }),
    ),
  );
}

function companionsDetail(): HTMLElement {
  return h(
    'div',
    { class: 'detail' },
    h(
      'ul',
      { class: 'tech-list' },
      ...COMPANIONS.map((c) => {
        const li = h(
          'li',
          { class: 'tech', 'data-unit': '' },
          h('div', { class: 'tech__top' }, hl('span', c.name, 'tech__name'), h('span', { class: 'badge' }, c.kind)),
          hl('p', c.how),
          hl('span', `Bond perks: ${c.perks.join(', ')}`, 'tech__note'),
        );
        li.style.setProperty('--el', 'var(--air-glow)');
        return li;
      }),
    ),
    h('p', { class: 'detail__title', style: 'margin-top:22px' }, 'Wildlife you will meet'),
    h('ul', { class: 'pill-list' }, ...WILDLIFE.map((w) => h('li', { 'data-unit': '' }, hl('span', w)))),
  );
}

function worldDetail(): HTMLElement {
  return h(
    'div',
    { class: 'detail' },
    h(
      'div',
      { class: 'list-cols' },
      ...NATIONS.map((n) => {
        const col = h('div', null, h('h4', null, icon(`g-${n.id}`), n.name), h('ul', { class: 'pill-list' }, ...n.places.map((p) => h('li', { 'data-unit': '' }, hl('span', p)))));
        col.style.setProperty('--el', `var(--${n.id}-glow)`);
        return col;
      }),
      h('div', null, h('h4', null, icon('i-map'), 'Between the nations'), h('ul', { class: 'pill-list' }, ...['Meditation Isle', 'The tundra', 'Roads, bridges and inns', 'Farms and signposts'].map((p) => h('li', { 'data-unit': '' }, hl('span', p))))),
    ),
  );
}

function questsDetail(): HTMLElement {
  const col = (title: string, items: string[], ic: string) => h('div', null, h('h4', null, icon(ic), title), h('ul', { class: 'pill-list' }, ...items.map((q) => h('li', { 'data-unit': '' }, hl('span', q)))));
  return h(
    'div',
    { class: 'detail' },
    h(
      'div',
      { class: 'list-cols' },
      col('Main story', [MAIN_QUEST, 'Seek each nation', 'The path of each master', 'The Avatar Awakens'], 'i-compass'),
      col('Hidden masters', DISCOVERY_QUESTS, 'i-tea'),
      col('Rare arts', ART_QUESTS, 'i-moon'),
      col('Side quests', SIDE_QUESTS, 'i-scroll'),
    ),
  );
}

function enemiesDetail(): HTMLElement {
  return h(
    'div',
    { class: 'detail' },
    h(
      'div',
      { class: 'list-cols' },
      h('div', null, h('h4', null, icon('i-sword'), 'Foes'), h('ul', { class: 'pill-list' }, ...ENEMIES.map((e) => h('li', { 'data-unit': '' }, hl('span', e))))),
      h('div', null, h('h4', null, icon('i-sword'), 'Bosses'), h('ul', { class: 'pill-list' }, ...BOSSES.map((b) => h('li', { 'data-unit': '' }, hl('span', `${b.name}, ${b.title}`))))),
    ),
  );
}

function creatorDetail(): HTMLElement {
  const col = (title: string, items: string[]) => h('div', null, h('h4', null, icon('i-mask'), title), h('ul', { class: 'pill-list' }, ...items.map((q) => h('li', { 'data-unit': '' }, hl('span', q)))));
  return h(
    'div',
    { class: 'detail' },
    h('p', { class: 'detail__title' }, `${CREATOR.hairstyles} hairstyles · ${CREATOR.hairColors} hair colours · ${CREATOR.clothingPieces} pieces of clothing and jewellery`),
    h(
      'div',
      { class: 'list-cols' },
      col('Air Nomad arrows', CREATOR.arrowDesigns),
      col('Face paints and marks', CREATOR.facePaints),
      col('Facial hair', CREATOR.facialHair),
      col('Scars', CREATOR.scars),
    ),
  );
}

const DETAILS: Record<NonNullable<FeatureCategory['detail']>, () => HTMLElement> = {
  techniques: techniquesDetail,
  ultimates: ultimatesDetail,
  arts: artsDetail,
  masters: mastersDetail,
  companions: companionsDetail,
  world: worldDetail,
  quests: questsDetail,
  enemies: enemiesDetail,
  creator: creatorDetail,
};

/** Feature cards in a grid whose column count the items fill (4 or 8 → 4 columns; 5 or 6 → 3, the first of five wide). */
function cards(c: FeatureCategory): HTMLElement {
  const n = c.items.length;
  const grid = h('div', { class: 'cards' }, ...c.items.map((it, i) => h('article', { class: `card${n === 5 && i === 0 ? ' card--wide' : ''}`, 'data-unit': '' }, hl('h3', it.title), hl('p', it.text))));
  grid.style.setProperty('--cols', String(n % 4 === 0 ? 4 : 3));
  return grid;
}

function category(c: FeatureCategory): HTMLElement {
  const [ic, vb] = CAT_ICON[c.id] ?? ['i-emblem', '0 0 40 40'];
  const emblem = h('div', { class: 'cat__emblem' }, icon(ic, undefined, vb));
  emblem.style.setProperty('--el', TINT[c.tint]);
  const sec = h(
    'section',
    { class: 'cat', id: c.id, 'aria-labelledby': `cat-${c.id}-title`, 'data-cat': c.id },
    h('header', { class: 'cat__head' }, emblem, h('div', null, h('p', { class: 'kicker' }, c.kicker), h('h2', { class: 'cat__title', id: `cat-${c.id}-title`, 'data-hl': '' }, c.title), h('p', { class: 'cat__intro', 'data-hl': '' }, c.intro))),
    cards(c),
    c.detail ? DETAILS[c.detail]() : null,
  );
  return sec;
}

const esc = (s: string) => s.replace(/[&<>"]/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[ch]!);
const fold = (s: string) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[’']/g, "'");

export function initFeatures(): void {
  const root = document.getElementById('features-root');
  const chipsTrack = document.querySelector<HTMLElement>('#feature-chips .chips__track');
  const input = document.getElementById('feature-search') as HTMLInputElement | null;
  const count = document.getElementById('feature-count');
  const empty = document.getElementById('features-empty');
  if (!root || !chipsTrack || !input || !count || !empty) return;

  const sections = CATEGORIES.map(category);
  root.append(...sections);
  const chips = CATEGORIES.map((c) => h('a', { class: 'chip', href: `#${c.id}`, 'data-chip': c.id }, c.kicker));
  chipsTrack.append(...chips);

  const defaultCount = `${CATEGORIES.length} categories · ${TECHNIQUE_COUNT} techniques · ${MASTERS.length} masters · ${COMPANIONS.length} companions · ${WEATHER.length} kinds of weather`;
  count.textContent = defaultCount;

  // Remember every highlightable text once.
  const hlNodes = Array.from(root.querySelectorAll<HTMLElement>('[data-hl]'));
  for (const n of hlNodes) n.dataset.hl = n.textContent ?? '';

  const highlight = (q: string) => {
    for (const n of hlNodes) {
      const text = n.dataset.hl ?? '';
      if (!q) {
        if (n.childElementCount) n.textContent = text;
        continue;
      }
      const i = fold(text).indexOf(q);
      if (i < 0) {
        if (n.childElementCount) n.textContent = text;
        continue;
      }
      n.innerHTML = `${esc(text.slice(0, i))}<mark>${esc(text.slice(i, i + q.length))}</mark>${esc(text.slice(i + q.length))}`;
    }
  };

  let timer = 0;
  const run = () => {
    const q = fold(input.value.trim());
    root.classList.toggle('is-searching', !!q);
    highlight(q);
    let total = 0;
    let visibleCats = 0;
    for (const sec of sections) {
      const units = Array.from(sec.querySelectorAll<HTMLElement>('[data-unit]'));
      const head = fold(sec.querySelector('.cat__head')?.textContent ?? '');
      const headHit = !!q && head.includes(q);
      let hits = 0;
      for (const u of units) {
        const ok = !q || headHit || fold(u.textContent ?? '').includes(q);
        u.hidden = !ok;
        if (ok) hits++;
      }
      // Technique groups: show every element with a match while searching; tabs otherwise.
      const tech = sec.querySelector<HTMLElement>('.detail--tech');
      if (tech) {
        const groups = Array.from(tech.querySelectorAll<HTMLElement>('.tech-group'));
        const sel = Number(tech.dataset.selected ?? 0);
        tech.querySelectorAll<HTMLElement>('.el-tab').forEach((b) => b.classList.toggle('is-searching', !!q));
        groups.forEach((g, j) => {
          const any = Array.from(g.querySelectorAll<HTMLElement>('[data-unit]')).some((u) => !u.hidden);
          g.hidden = q ? !any : j !== sel;
          const name = g.querySelector<HTMLElement>('.tech-group__name');
          if (name) name.hidden = !q;
          const style = g.querySelector<HTMLElement>('.style-line');
          if (style) style.hidden = !!q;
        });
      }
      sec.querySelectorAll<HTMLElement>('.detail, .arts').forEach((d) => {
        d.hidden = !!q && !Array.from(d.querySelectorAll<HTMLElement>('[data-unit]')).some((u) => !u.hidden);
      });
      sec.querySelectorAll<HTMLElement>('.list-cols > div, .master-col').forEach((col) => {
        col.hidden = !!q && !Array.from(col.querySelectorAll<HTMLElement>('[data-unit]')).some((u) => !u.hidden);
      });
      const show = !q || hits > 0;
      sec.hidden = !show;
      if (show) visibleCats++;
      total += q ? hits : 0;
      chips.find((c) => c.dataset.chip === sec.dataset.cat)?.classList.toggle('is-empty', !show);
    }
    count.textContent = q ? (total ? `${total} match${total === 1 ? '' : 'es'} in ${visibleCats} categor${visibleCats === 1 ? 'y' : 'ies'}` : 'No matches') : defaultCount;
    empty.hidden = !q || visibleCats > 0;
  };
  input.addEventListener('input', () => {
    clearTimeout(timer);
    timer = window.setTimeout(run, 90);
  });
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      input.value = '';
      run();
    }
  });

  // Scroll-spy: highlight the category in view and keep its chip visible.
  if ('IntersectionObserver' in window) {
    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          if (!e.isIntersecting) continue;
          const id = (e.target as HTMLElement).dataset.cat;
          chips.forEach((c) => c.classList.toggle('is-active', c.dataset.chip === id));
          const chip = chips.find((c) => c.dataset.chip === id);
          if (chip) {
            const left = chip.offsetLeft - chipsTrack.clientWidth / 2 + chip.clientWidth / 2;
            chipsTrack.scrollTo({ left, behavior: 'smooth' });
          }
        }
      },
      { rootMargin: '-35% 0px -60% 0px' },
    );
    sections.forEach((s) => io.observe(s));
  }
}
