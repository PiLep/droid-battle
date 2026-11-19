// Entrées : clavier (codes physiques => AZERTY/QWERTY), souris, manettes (Gamepad API).

export const KEYMAPS = {
  solo: {
    up: ['KeyW', 'ArrowUp'],
    down: ['KeyS', 'ArrowDown'],
    left: ['KeyA', 'ArrowLeft'],
    right: ['KeyD', 'ArrowRight'],
    fire: ['Mouse0'],
    dash: ['Space', 'ShiftLeft', 'TouchDash'],
    special: ['Mouse2', 'KeyE', 'TouchSpecial'],
  },
  p1: {
    up: ['KeyW'],
    down: ['KeyS'],
    left: ['KeyA'],
    right: ['KeyD'],
    fire: ['KeyF'],
    dash: ['KeyG', 'TouchDash'],
    special: ['KeyH', 'TouchSpecial'],
  },
  p2: {
    up: ['ArrowUp'],
    down: ['ArrowDown'],
    left: ['ArrowLeft'],
    right: ['ArrowRight'],
    fire: ['KeyK', 'Numpad1'],
    dash: ['KeyL', 'Numpad2'],
    special: ['Semicolon', 'Numpad3'],
  },
};

const PAD = { fire: [7, 5, 2], dash: [0, 6, 4], special: [1, 3], pause: [9], back: [1, 8] };
const GAME_KEYS = new Set(['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Tab']);

// Libellés de touches selon la disposition réelle du clavier
const AZERTY = { KeyW: 'Z', KeyA: 'Q', KeyQ: 'A', KeyZ: 'W', Semicolon: 'M', KeyM: ',' };
const NAMES = {
  Space: 'Espace',
  ShiftLeft: 'Maj',
  ArrowUp: '↑',
  ArrowDown: '↓',
  ArrowLeft: '←',
  ArrowRight: '→',
  Mouse0: 'Clic G',
  Mouse2: 'Clic D',
  Escape: 'Échap',
  Enter: 'Entrée',
};

class Input {
  constructor() {
    this.keys = new Set();
    this.pressed = new Set();
    this.mouse = { x: window.innerWidth / 2, y: window.innerHeight / 2, moved: 0 };
    this.pads = [];
    this.prevPadButtons = [];
    this.padPressed = [];
    this.layout = null;
    this.lastDevice = 'keyboard';
    this.navRepeat = { dir: null, t: 0 };
    this.touch = { mx: 0, my: 0, active: false };
    this.lastTouch = 0;
    this.guessAzerty = (navigator.language || '').toLowerCase().startsWith('fr');
  }

  attach(target) {
    window.addEventListener('keydown', (e) => {
      if (e.target instanceof HTMLInputElement) return;
      if (GAME_KEYS.has(e.code)) e.preventDefault();
      if (!e.repeat) this.pressed.add(e.code);
      this.keys.add(e.code);
      this.lastDevice = 'keyboard';
    });
    window.addEventListener('keyup', (e) => this.keys.delete(e.code));
    window.addEventListener('blur', () => this.keys.clear());
    const fromTouch = () => performance.now() - this.lastTouch < 1000;
    window.addEventListener(
      'touchstart',
      () => {
        this.lastTouch = performance.now();
        this.lastDevice = 'touch';
      },
      { passive: true, capture: true },
    );
    target.addEventListener('mousemove', (e) => {
      if (fromTouch()) return;
      this.mouse.x = e.clientX;
      this.mouse.y = e.clientY;
      this.mouse.moved = performance.now();
      this.lastDevice = 'keyboard';
    });
    target.addEventListener('mousedown', (e) => {
      if (fromTouch()) return;
      const code = `Mouse${e.button}`;
      this.keys.add(code);
      this.pressed.add(code);
      this.lastDevice = 'keyboard';
    });
    window.addEventListener('mouseup', (e) => this.keys.delete(`Mouse${e.button}`));
    target.addEventListener('contextmenu', (e) => e.preventDefault());
    navigator.keyboard?.getLayoutMap?.().then((m) => (this.layout = m)).catch(() => {});
  }

  // Boutons tactiles virtuels (codes 'TouchDash', 'TouchSpecial'…)
  virtualDown(code) {
    this.keys.add(code);
    this.pressed.add(code);
    this.lastDevice = 'touch';
  }

  virtualUp(code) {
    this.keys.delete(code);
  }

  // À appeler en début de frame
  poll() {
    const raw = navigator.getGamepads ? navigator.getGamepads() : [];
    const pads = [];
    for (const p of raw) if (p && p.connected) pads.push(p);
    this.pads = pads;
    this.padPressed = pads.map((p, i) => {
      const prev = this.prevPadButtons[i] || [];
      const now = p.buttons.map((b) => b.pressed || b.value > 0.35);
      if (now.some(Boolean) || Math.hypot(p.axes[0] || 0, p.axes[1] || 0) > 0.5) this.lastDevice = 'gamepad';
      const edges = now.map((v, j) => v && !prev[j]);
      this.prevPadButtons[i] = now;
      return edges;
    });
  }

  // À appeler en fin de frame
  endFrame() {
    this.pressed.clear();
  }

  down(codes) {
    return codes.some((c) => this.keys.has(c));
  }

  hit(codes) {
    return codes.some((c) => this.pressed.has(c));
  }

  pad(i) {
    return this.pads[i] || null;
  }

  padDown(i, buttons) {
    const p = this.pads[i];
    return !!p && buttons.some((b) => p.buttons[b] && (p.buttons[b].pressed || p.buttons[b].value > 0.35));
  }

  padHit(i, buttons) {
    const e = this.padPressed[i];
    return !!e && buttons.some((b) => e[b]);
  }

  stick(i, which) {
    const p = this.pads[i];
    if (!p) return [0, 0];
    const ax = which === 'left' ? 0 : 2;
    let x = p.axes[ax] || 0;
    let y = p.axes[ax + 1] || 0;
    const dz = which === 'left' ? 0.18 : 0.3;
    const m = Math.hypot(x, y);
    if (m < dz) return [0, 0];
    const k = Math.min(1, (m - dz) / (1 - dz)) / m;
    x *= k;
    y *= k;
    // d-pad en renfort du stick gauche
    if (which === 'left') {
      const b = p.buttons;
      if (b[12]?.pressed) y = -1;
      if (b[13]?.pressed) y = 1;
      if (b[14]?.pressed) x = -1;
      if (b[15]?.pressed) x = 1;
    }
    return [x, y];
  }

  dpad(i) {
    const p = this.pads[i];
    if (!p) return [0, 0];
    const b = p.buttons;
    return [(b[15]?.pressed ? 1 : 0) - (b[14]?.pressed ? 1 : 0), (b[13]?.pressed ? 1 : 0) - (b[12]?.pressed ? 1 : 0)];
  }

  anyPadHit(buttons) {
    return this.pads.some((_, i) => this.padHit(i, buttons));
  }

  pausePressed() {
    return this.hit(['Escape', 'KeyP']) || this.anyPadHit(PAD.pause);
  }

  rumble(i, strong = 0.5, weak = 0.5, ms = 120) {
    const p = this.pads[i];
    const act = p?.vibrationActuator;
    if (!act?.playEffect) return;
    act.playEffect('dual-rumble', { duration: ms, strongMagnitude: Math.min(1, strong), weakMagnitude: Math.min(1, weak) }).catch(() => {});
  }

  // Navigation dans les menus (flèches/ZQSD, Entrée, Échap, manette)
  menuNav(dt) {
    const dirOf = (k) =>
      k.has('ArrowUp') || k.has('KeyW')
        ? 'up'
        : k.has('ArrowDown') || k.has('KeyS')
          ? 'down'
          : k.has('ArrowLeft') || k.has('KeyA')
            ? 'left'
            : k.has('ArrowRight') || k.has('KeyD')
              ? 'right'
              : null;
    // un appui bref (relâché avant la frame suivante) compte aussi
    const tapped = dirOf(this.pressed);
    if (tapped) {
      this.navRepeat = { dir: tapped, t: 0.38 };
      return { move: tapped, ...this.menuButtons() };
    }
    let dir = dirOf(this.keys);
    for (let i = 0; i < this.pads.length && !dir; i++) {
      const [sx, sy] = this.stick(i, 'left');
      if (sy < -0.6) dir = 'up';
      else if (sy > 0.6) dir = 'down';
      else if (sx < -0.6) dir = 'left';
      else if (sx > 0.6) dir = 'right';
    }
    let move = null;
    if (dir) {
      if (this.navRepeat.dir !== dir) {
        move = dir;
        this.navRepeat = { dir, t: 0.38 };
      } else {
        this.navRepeat.t -= dt;
        if (this.navRepeat.t <= 0) {
          move = dir;
          this.navRepeat.t = 0.11;
        }
      }
    } else this.navRepeat.dir = null;
    return { move, ...this.menuButtons() };
  }

  menuButtons() {
    return {
      confirm: this.hit(['Enter', 'NumpadEnter']) || this.anyPadHit([0]),
      back: this.hit(['Escape', 'Backspace']) || this.anyPadHit([1]),
    };
  }

  keyLabel(code) {
    if (NAMES[code]) return NAMES[code];
    if (code.startsWith('Numpad')) return `Pavé ${code.slice(6)}`;
    const fromLayout = this.layout?.get?.(code);
    if (fromLayout) return fromLayout.toUpperCase();
    if (this.guessAzerty && AZERTY[code]) return AZERTY[code];
    if (code.startsWith('Key')) return code.slice(3);
    if (code === 'Semicolon') return ';';
    return code;
  }
}

export const input = new Input();
export { PAD };

// ---- Contrôleurs : produisent un état de commande commun -----------------------
// { mx, my, aim: {x,y}|null (point monde), aimDir: [x,y]|null, fire, dash, special }

export class HumanController {
  constructor({ keymap, padIndex = null, mouse = false, toWorld = null }) {
    this.keymap = keymap;
    this.padIndex = padIndex;
    this.mouse = mouse;
    this.toWorld = toWorld;
    this.human = true;
  }

  read(me, g) {
    const km = this.keymap;
    let mx = 0;
    let my = 0;
    let fire = false;
    let dash = false;
    let special = false;
    let aim = null;
    let aimDir = null;
    if (km) {
      mx = (input.down(km.right) ? 1 : 0) - (input.down(km.left) ? 1 : 0);
      my = (input.down(km.down) ? 1 : 0) - (input.down(km.up) ? 1 : 0);
      fire = input.down(km.fire);
      dash = input.hit(km.dash);
      special = input.hit(km.special);
    }
    const pi = this.padIndex;
    if (pi !== null && input.pad(pi)) {
      const [lx, ly] = input.stick(pi, 'left');
      if (lx || ly) {
        mx = lx;
        my = ly;
      }
      const [rx, ry] = input.stick(pi, 'right');
      if (rx || ry) aimDir = [rx, ry];
      fire = fire || input.padDown(pi, PAD.fire);
      dash = dash || input.padHit(pi, PAD.dash);
      special = special || input.padHit(pi, PAD.special);
    }
    // tactile : joystick virtuel + tir automatique (visée auto)
    if (input.lastDevice === 'touch' && this.keymap?.dash?.includes('TouchDash')) {
      if (input.touch.active) {
        mx = input.touch.mx;
        my = input.touch.my;
      }
      fire = fire || !!(me && g && g.autoAimTarget(me));
      return { mx, my, aim: null, aimDir: null, fire, dash, special };
    }
    const usingPad = pi !== null && input.pad(pi) && input.lastDevice === 'gamepad';
    if (this.mouse && this.toWorld && !usingPad) aim = this.toWorld(input.mouse.x, input.mouse.y);
    const m = Math.hypot(mx, my);
    if (m > 1) {
      mx /= m;
      my /= m;
    }
    return { mx, my, aim, aimDir, fire, dash, special };
  }
}
