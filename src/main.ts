import '@fontsource/chakra-petch/500.css';
import '@fontsource/chakra-petch/700.css';
import '@fontsource/chakra-petch/700-italic.css';
import '@fontsource/zen-kaku-gothic-new/500.css';
import '@fontsource/zen-kaku-gothic-new/700.css';
import '@fontsource/zen-kaku-gothic-new/900.css';
import './ui/styles.css';
import { Game } from './game';

function webglOk(): boolean {
  try {
    const c = document.createElement('canvas');
    return !!c.getContext('webgl2');
  } catch {
    return false;
  }
}

async function boot(): Promise<void> {
  const container = document.getElementById('game')!;
  if (!webglOk()) {
    container.innerHTML = '<div style="padding:40px;font-family:sans-serif;color:#f2efe6">Kaze Drift needs a browser with WebGL2 enabled.</div>';
    return;
  }
  // canvas textures draw text, so wait for the fonts first
  try {
    await Promise.race([document.fonts.ready, new Promise((r) => setTimeout(r, 2500))]);
    await Promise.all(['700 20px "Chakra Petch"', '700 20px "Zen Kaku Gothic New"', 'italic 700 20px "Chakra Petch"'].map((f) => document.fonts.load(f, '風A')));
  } catch {
    /* fonts are optional */
  }
  const game = new Game(container);
  (window as unknown as { __kaze: unknown }).__kaze = game.debugApi();
  game.start();
}

void boot();
