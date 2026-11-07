import './styles/fonts.css';
import './styles/site.css';
import { initHero } from './hero/hero';
import { initAbout } from './pages/about';
import { initFeatures } from './pages/features';
import { initHome } from './pages/home';
import { initPhoneFirst } from './pages/phone';
import { initPlay } from './pages/play';
import { hydrateMedia } from './ui/media';
import { initMotion } from './ui/motion';
import { initMusic } from './ui/music';
import { initRouter, type Route } from './ui/router';

/** The developer's name under the letter on the About page. */
const OWNER_SIGNATURE = 'The developer';

// First: phones or a computer (the page shows what fits, and computers get a QR code).
const phone = initPhoneFirst();
const motion = initMotion();
const music = initMusic();
hydrateMedia();
initHome();
initFeatures();
const about = initAbout();
const hero = initHero();

const sig = document.getElementById('owner-signature');
if (sig) sig.textContent = OWNER_SIGNATURE;

const play = initPlay({
  onOpen() {
    hero.setPaused(true);
    about.setActive(false);
    motion.setEnabled(false);
    music.duck(true);
  },
  onClose() {
    hero.setPaused(false);
    about.setActive(router.current() === 'about');
    motion.setEnabled(true);
    music.duck(false);
  },
});

const router = initRouter({
  onRoute(route: Route) {
    hero.setActive(route === 'home');
    about.setActive(route === 'about');
  },
  scrollTo: (y, smooth) => motion.scrollTo(y, smooth),
});

// "Play now" buttons open the game straight away (the tap allows full screen on phones).
document.addEventListener(
  'click',
  (e) => {
    const a = (e.target as Element).closest?.('[data-play="start"]');
    if (!a || (e as MouseEvent).button !== 0) return;
    e.preventDefault();
    e.stopPropagation();
    // No page transition here: the game covers the page at once.
    const start = () => {
      if (router.current() !== 'play') router.go('play', false);
      play.open();
    };
    // The game is made for phones: on a computer, Play first offers the phone (QR code), with
    // "play on this computer anyway".
    if (phone.gate(start)) return;
    start();
  },
  true,
);

// Automation hooks for the site's own browser tests.
(window as unknown as { __site: unknown }).__site = {
  hero: hero.scene,
  mood: (i: number) => hero.select(i),
  route: () => router.current(),
  go: (name: string) => router.go(name),
  openGame: () => play.open(),
  touch: () => phone.touch,
  gameOpen: () => play.isOpen(),
};
