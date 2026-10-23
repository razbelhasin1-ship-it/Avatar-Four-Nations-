import './ui/styles.css';
import { Game } from './core/Game';

function webglAvailable(): boolean {
  try {
    const c = document.createElement('canvas');
    return !!(c.getContext('webgl2') || c.getContext('webgl'));
  } catch {
    return false;
  }
}

async function main(): Promise<void> {
  const canvas = document.getElementById('game') as HTMLCanvasElement;
  const ui = document.getElementById('ui') as HTMLElement;
  if (!webglAvailable()) {
    ui.innerHTML = '<div class="loading"><h2 class="title">WebGL is not available</h2><p class="muted">This game needs a browser with WebGL enabled.</p></div>';
    return;
  }
  const game = new Game(canvas, ui);
  game.ui.showLoading('The Four Nations');
  await game.boot((f, label) => game.ui.setLoadingProgress(f, label));
  game.ui.hideLoading();
  (window as any).__ready = true;
}

main().catch((err) => {
  console.error(err);
  const ui = document.getElementById('ui');
  if (ui) ui.innerHTML = `<div class="loading"><h2 class="title">Something went wrong</h2><pre style="white-space:pre-wrap;max-width:80vw">${String(err?.stack ?? err)}</pre></div>`;
});
