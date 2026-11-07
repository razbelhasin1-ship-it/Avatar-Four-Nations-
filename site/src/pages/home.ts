import {
  COMPANIONS,
  ELEMENT_NAMES,
  ELEMENT_STYLE,
  KIND_LABEL,
  MASTERS,
  NATIONS,
  SIDE_QUESTS,
  TECHNIQUE_COUNT,
  TECHNIQUES,
  ULTIMATES,
  WEATHER,
  type ElementId,
} from '../data/catalogue';
import { finePointer, h, icon, reducedMotion } from '../ui/dom';
import { applyMedia, mediaImg } from '../ui/media';

const NATION_MEDIA: Record<ElementId, { key: string; alt: string }> = {
  water: { key: 'swt_aurora', alt: 'The aurora over Wolf Cove, the Southern Water Tribe, on a festival night' },
  earth: { key: 'place_bss', alt: 'Ba Sing Se, its walls and rings in the afternoon haze' },
  fire: { key: 'place_fnc', alt: 'The Fire Nation Capital in its volcanic caldera at sunset' },
  air: { key: 'place_sat', alt: 'The Southern Air Temple on its mountain above the clouds' },
};

const SHOWCASE: Record<ElementId, { key: string; caption: string; signature: string[] }> = {
  water: { key: 'phone_water', caption: 'A Water Whip drawn from Lake Hiari', signature: ['water_whip', 'octopus_form', 'water_spout', 'ice_prison'] },
  earth: { key: 'phone_earth', caption: 'A Pillar Charge into Fire Nation soldiers outside Ba Sing Se', signature: ['rock_armor', 'earth_surf', 'boulder_roll', 'seismic_sense'] },
  fire: { key: 'phone_fire', caption: 'A Fire Stream across the Royal Plaza at dusk', signature: ['dancing_dragon', 'fire_lightning', 'fire_stream', 'fire_shield'] },
  air: { key: 'phone_air', caption: 'Gliding to the Southern Air Temple on the glider staff', signature: ['air_scooter', 'air_vortex', 'air_redirect', 'air_jump'] },
};

const GALLERY: Array<{ key: string; title: string; text: string }> = [
  { key: 'place_sat', title: 'The Southern Air Temple', text: 'On its mountain above the sea of clouds' },
  { key: 'nwt_canal_night', title: 'Agna Qel’a', text: 'The Northern Water Tribe’s canals by lamplight' },
  { key: 'place_bss', title: 'Ba Sing Se', text: 'The rings and walls of the Earth Kingdom’s capital' },
  { key: 'fire_stream', title: 'Harbor City', text: 'Firebending at dusk in the Fire Nation Capital' },
  { key: 'swt_aurora', title: 'Wolf Cove', text: 'The aurora over the Southern Water Tribe’s festival' },
  { key: 'ki_village', title: 'Kyoshi Island', text: 'The village street, its thatch and lit paper lanterns' },
  { key: 'bss_train', title: 'Ba Sing Se', text: 'A monorail train on its viaduct' },
  { key: 'water_spout', title: 'Lake Hiari', text: 'Riding a water spout at sunset' },
  { key: 'nwt_oasis', title: 'The Spirit Oasis', text: 'The koi pond at the heart of Agna Qel’a' },
  { key: 'sat_statues', title: 'The sanctuary', text: 'The Air Temple’s statue room, glowing' },
  { key: 'place_fnc', title: 'The Fire Nation Capital', text: 'The royal caldera at sunset' },
  { key: 'ki_falls', title: 'Kyoshi Island', text: 'The Crescent Bridge and Crystal Falls' },
  { key: 'lightning', title: 'Hari Bulkan', text: 'Lightning Generation at night' },
  { key: 'swt_lamps', title: 'Wolf Cove', text: 'Igloos by lamplight' },
  { key: 'fnc_throne', title: 'The royal palace', text: 'The throne room behind its wall of fire' },
  { key: 'ki_beach', title: 'Kyoshi Island', text: 'The bay below the village' },
  { key: 'ki_hall', title: 'Kyoshi Island', text: 'The Meeting Hall, its elders seated on the porch benches' },
];

const ELEMENTS: ElementId[] = ['water', 'earth', 'fire', 'air'];
const techById = (id: string) => Object.values(TECHNIQUES).flat().find((t) => t.id === id)!;

function nations(): void {
  const root = document.getElementById('nation-cards');
  if (!root) return;
  const cards = NATIONS.map((n, i) => {
    const img = mediaImg(NATION_MEDIA[n.id].key, NATION_MEDIA[n.id].alt, '(max-width: 860px) 100vw, 60vw');
    const card = h(
      'article',
      { class: `nation${i === 0 ? ' is-open' : ''}`, 'data-el': n.id, tabindex: 0, 'aria-label': n.name },
      h('div', { class: 'nation__img' }, img),
      h('div', { class: 'nation__glyph' }, icon(`g-${n.id}`)),
      h(
        'div',
        { class: 'nation__body' },
        h('h3', { class: 'nation__name' }, n.name),
        h('p', { class: 'nation__capital' }, n.capital),
        h(
          'div',
          { class: 'nation__more' },
          h('p', { class: 'nation__start' }, n.start),
          h('ul', { class: 'nation__places', 'aria-label': `Places in the ${n.name}` }, ...n.places.slice(0, 6).map((p) => h('li', null, p))),
        ),
      ),
    );
    return card;
  });
  root.append(...cards);
  const open = (card: HTMLElement) => cards.forEach((c) => c.classList.toggle('is-open', c === card));
  for (const c of cards) {
    c.addEventListener('pointerenter', (e) => {
      if ((e as PointerEvent).pointerType === 'mouse') open(c);
    });
    c.addEventListener('focus', () => open(c));
    c.addEventListener('click', () => open(c));
  }
}

function showcase(): void {
  const root = document.getElementById('showcase');
  if (!root) return;
  const tabs = root.querySelector('.showcase__tabs')!;
  const media = root.querySelector('.showcase__media')!;
  const text = root.querySelector('.showcase__text')!;
  const band = root.closest<HTMLElement>('.band--bending');
  const imgs = new Map<ElementId, HTMLImageElement>();
  // The picture plays inside a phone; its caption sits under the phone.
  const caption = document.getElementById('showcase-caption') ?? h('p');
  const buttons = ELEMENTS.map((el) => {
    const b = h(
      'button',
      { class: 'show-tab', type: 'button', role: 'tab', 'aria-selected': 'false', 'data-el': el, id: `show-tab-${el}`, 'aria-controls': 'showcase-panel' },
      icon(`g-${el}`),
      h('span', null, h('b', null, ELEMENT_NAMES[el]), h('small', null, ELEMENT_STYLE[el].motto)),
    );
    b.style.setProperty('--el', `var(--${el}-glow)`);
    return b;
  });
  tabs.append(...buttons);
  text.id = 'showcase-panel';
  text.setAttribute('role', 'tabpanel');

  const select = (el: ElementId, focus = false) => {
    buttons.forEach((b) => b.setAttribute('aria-selected', String(b.dataset.el === el)));
    if (focus) buttons.find((b) => b.dataset.el === el)?.focus();
    band?.style.setProperty('--el', `var(--${el}-glow)`);
    root.style.setProperty('--el', `var(--${el}-glow)`);
    let img = imgs.get(el);
    if (!img) {
      img = mediaImg(SHOWCASE[el].key, SHOWCASE[el].caption, '(max-width: 1080px) 94vw, 56vw');
      imgs.set(el, img);
      media.append(img);
    }
    for (const [k, v] of imgs) v.classList.toggle('is-on', k === el);
    caption.textContent = SHOWCASE[el].caption;
    const count = TECHNIQUES[el].length;
    text.replaceChildren(
      h('p', { class: 'showcase__motto' }, ELEMENT_STYLE[el].motto),
      h('p', { class: 'showcase__style' }, ELEMENT_STYLE[el].style),
      h(
        'ul',
        { class: 'sig-list' },
        ...SHOWCASE[el].signature.map((id) => {
          const t = techById(id);
          return h('li', null, h('b', null, t.name, h('span', { class: 'badge' }, KIND_LABEL[t.kind])), h('span', null, t.text));
        }),
      ),
      h('a', { class: 'text-link', href: '#bending' }, `All ${count} ${ELEMENT_NAMES[el].toLowerCase()}bending techniques`, icon('i-right')),
    );
    text.setAttribute('aria-labelledby', `show-tab-${el}`);
  };
  buttons.forEach((b, i) => {
    b.addEventListener('click', () => select(b.dataset.el as ElementId));
    b.addEventListener('keydown', (e) => {
      const k = (e as KeyboardEvent).key;
      if (k !== 'ArrowRight' && k !== 'ArrowLeft') return;
      e.preventDefault();
      const next = (i + (k === 'ArrowRight' ? 1 : 3)) % 4;
      select(ELEMENTS[next], true);
    });
  });
  select('water');
  // Preload the other three once the first is shown.
  setTimeout(() => ELEMENTS.slice(1).forEach((el) => {
    if (!imgs.has(el)) {
      const img = mediaImg(SHOWCASE[el].key, SHOWCASE[el].caption, '(max-width: 1080px) 94vw, 56vw');
      imgs.set(el, img);
      media.append(img);
    }
  }), 2500);
}

function ultimates(): void {
  const root = document.getElementById('ultimates');
  if (!root) return;
  root.append(
    ...ULTIMATES.map((u, i) => h('li', null, h('kbd', { 'aria-label': `Technique slot ${i + 1}` }, i + 1), h('div', null, h('b', null, u.name), h('span', null, u.text)))),
  );
}

function companions(): void {
  const root = document.getElementById('companion-list');
  if (!root) return;
  root.append(
    ...COMPANIONS.map((c) =>
      h(
        'li',
        { class: 'mate' },
        h('h3', null, c.name, ' ', h('span', { class: 'badge' }, c.kind)),
        h('p', null, c.how),
        h('ul', { class: 'mate__perks', 'aria-label': `${c.name} bond perks` }, ...c.perks.map((p) => h('li', null, p))),
      ),
    ),
  );
}

function gallery(): void {
  const root = document.getElementById('gallery');
  if (!root) return;
  const slides = GALLERY.map((g, i) =>
    h('figure', { class: 'slide' }, mediaImg(g.key, `${g.title}: ${g.text}`, '(max-width: 520px) 86vw, min(80vw, 980px)', i < 2), h('figcaption', null, h('b', null, g.title), h('span', null, g.text))),
  );
  root.append(...slides);

  // Depth: slides away from the centre shrink and dim a little; images drift (parallax).
  let ticking = false;
  const update = () => {
    ticking = false;
    const r = root.getBoundingClientRect();
    const cx = r.left + r.width / 2;
    for (const s of slides) {
      const b = s.getBoundingClientRect();
      const d = (b.left + b.width / 2 - cx) / r.width;
      s.style.setProperty('--d', Math.min(1, Math.abs(d) * 1.4).toFixed(3));
      s.style.setProperty('--p', Math.max(-1, Math.min(1, d)).toFixed(3));
    }
  };
  const onScroll = () => {
    if (!ticking) {
      ticking = true;
      requestAnimationFrame(update);
    }
  };
  root.addEventListener('scroll', onScroll, { passive: true });
  addEventListener('resize', onScroll);
  update();

  const step = (dir: number) => {
    const w = slides[0].getBoundingClientRect().width + 20;
    root.scrollBy({ left: dir * w, behavior: reducedMotion() ? 'auto' : 'smooth' });
  };
  document.querySelector('[data-gallery="prev"]')?.addEventListener('click', () => step(-1));
  document.querySelector('[data-gallery="next"]')?.addEventListener('click', () => step(1));
  root.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowRight') step(1);
    if (e.key === 'ArrowLeft') step(-1);
  });

  // Drag to scroll with a mouse, with a little momentum.
  if (!finePointer()) return;
  let down = false;
  let moved = 0;
  let startX = 0;
  let startLeft = 0;
  let vel = 0;
  let lastX = 0;
  let lastT = 0;
  root.addEventListener('pointerdown', (e) => {
    if (e.pointerType !== 'mouse' || e.button !== 0) return;
    down = true;
    moved = 0;
    startX = lastX = e.clientX;
    startLeft = root.scrollLeft;
    lastT = performance.now();
    vel = 0;
  });
  addEventListener('pointermove', (e) => {
    if (!down) return;
    const dx = e.clientX - startX;
    moved = Math.max(moved, Math.abs(dx));
    if (moved > 4) root.classList.add('is-dragging');
    root.scrollLeft = startLeft - dx;
    const now = performance.now();
    vel = (e.clientX - lastX) / Math.max(1, now - lastT);
    lastX = e.clientX;
    lastT = now;
  });
  addEventListener('pointerup', () => {
    if (!down) return;
    down = false;
    root.classList.remove('is-dragging');
    if (Math.abs(vel) > 0.2 && !reducedMotion()) root.scrollBy({ left: -vel * 320, behavior: 'smooth' });
  });
}

function numbers(): void {
  const root = document.getElementById('numbers');
  if (!root) return;
  const stats: Array<{ n: number; suffix?: string; label: string }> = [
    { n: TECHNIQUE_COUNT, label: 'Techniques' },
    { n: MASTERS.length, label: 'Masters' },
    { n: COMPANIONS.length, label: 'Companions' },
    { n: SIDE_QUESTS.length, label: 'Side quests' },
    { n: WEATHER.length, label: 'Kinds of weather' },
    { n: 4, suffix: ' km', label: 'Wide world' },
  ];
  const els = stats.map((s) => {
    const b = h('b', null, `${s.n}${s.suffix ?? ''}`);
    root.append(h('div', { class: 'stat' }, b, h('span', null, s.label)));
    return { b, s };
  });
  if (reducedMotion() || !('IntersectionObserver' in window)) return;
  // Count up once when the band comes into view (the final numbers are already in place).
  const io = new IntersectionObserver(
    (entries) => {
      if (!entries.some((e) => e.isIntersecting)) return;
      io.disconnect();
      const t0 = performance.now();
      const tick = (now: number) => {
        const t = Math.min(1, (now - t0) / 1600);
        const e = 1 - Math.pow(1 - t, 4);
        for (const { b, s } of els) b.textContent = `${Math.round(s.n * e)}${s.suffix ?? ''}`;
        if (t < 1) requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
    },
    { threshold: 0.4 },
  );
  io.observe(root);
}

export function initHome(): void {
  nations();
  showcase();
  ultimates();
  companions();
  gallery();
  numbers();
  document.querySelectorAll<HTMLImageElement>('.avatar-bg img').forEach((img) => applyMedia(img, img.dataset.media!, '100vw'));
}
