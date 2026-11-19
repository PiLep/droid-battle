// Application : écrans, navigation (souris / clavier / manette), boucle principale.
import { COLORS, DROIDS, DROID_ORDER } from './config.js';
import { BotController } from './ai.js';
import { api } from './api.js';
import { audio } from './audio.js';
import { drawBody } from './droid.js';
import { drawGlow } from './fx.js';
import { Game } from './game.js';
import { HumanController, KEYMAPS, input } from './input.js';
import { TAU, fmt, formatTime } from './utils.js';

const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
const canvas = $('#game');
input.attach(canvas);

// ---- Préférences ------------------------------------------------------------------
const store = {
  get(key, fallback) {
    try {
      const v = localStorage.getItem(`droidbattle.${key}`);
      return v === null ? fallback : JSON.parse(v);
    } catch {
      return fallback;
    }
  },
  set(key, value) {
    try {
      localStorage.setItem(`droidbattle.${key}`, JSON.stringify(value));
    } catch {
      /* stockage indisponible */
    }
  },
};

const settings = Object.assign({ sfx: 0.8, music: 0.5, shake: 1, fx: 1 }, store.get('settings', {}));

const app = {
  state: 'menu', // menu | playing | paused | ended
  screen: null,
  history: [],
  game: null,
  demo: null,
  droid: store.get('droid', 'striker'),
  run: null,
  result: null,
  duel: { p1: 'striker', p2: 'viper', p2Type: 'normal', padOf: [0, 1] },
  view: { w: 1, h: 1, dpr: 1 },
  previews: [],
  pauseFrom: null,
};

const P2_TYPES = [
  { id: 'human', label: 'Humain' },
  { id: 'easy', label: 'CPU facile' },
  { id: 'normal', label: 'CPU normal' },
  { id: 'hard', label: 'CPU difficile' },
];

// ---- Démo en fond de menu -------------------------------------------------------------
function makeDemo() {
  const pick2 = () => DROID_ORDER[Math.floor(Math.random() * 3)];
  const g = new Game(canvas, {
    mode: 'demo',
    settings,
    players: [
      { droid: pick2(), controller: new BotController('hard') },
      { droid: pick2(), controller: new BotController('hard') },
    ],
  });
  g.fx.intensity = settings.fx;
  g.resize(app.view.w, app.view.h, app.view.dpr);
  return g;
}

function current() {
  return app.state === 'menu' ? app.demo : app.game;
}

// ---- Écrans -----------------------------------------------------------------------------
function show(name, { push = true } = {}) {
  if (app.screen && push && app.screen !== name) app.history.push(app.screen);
  app.screen = name;
  $$('.screen').forEach((s) => s.classList.toggle('active', s.id === `screen-${name}`));
  const el = $(`#screen-${name}`);
  ENTER[name]?.(el);
  setTimeout(() => focusFirst(el), 0);
}

function hideScreens() {
  app.screen = null;
  $$('.screen').forEach((s) => s.classList.remove('active'));
}

function back() {
  const el = $(`#screen-${app.screen}`);
  const target = el?.dataset.back;
  if (target === 'resume') return resume();
  if (target === 'menu') return toMenu();
  if (!target) return;
  audio.play('uiBack');
  const prev = app.history.pop() || target;
  show(prev, { push: false });
}

function focusables(el) {
  return $$('button:not([disabled]), input:not([disabled]), [tabindex="0"]', el).filter((n) => n.offsetParent !== null);
}

function focusFirst(el) {
  if (!el) return;
  const sel = el.querySelector('.card.selected') || el.querySelector('[autofocus]') || focusables(el)[0];
  sel?.focus({ preventScroll: true });
}

function moveFocus(dir) {
  const el = $(`#screen-${app.screen}`);
  const list = focusables(el);
  if (!list.length) return;
  const i = list.indexOf(document.activeElement);
  const step = dir === 'up' || dir === 'left' ? -1 : 1;
  const next = list[(i + step + list.length) % list.length] || list[0];
  next.focus({ preventScroll: true });
  audio.play('uiMove');
}

const ENTER = {
  title() {
    const best = store.get('best', 0);
    $('#best-score').textContent = best ? `Record perso : ${fmt(best)}` : '';
    audio.setIntensity('menu');
  },
  select: buildArcadeCards,
  duel: buildDuel,
  leaderboard() {
    loadBoard($('.tab.active')?.dataset.period || 'all');
  },
  controls: buildControls,
  settings: syncSettingsUI,
};

// ---- Aperçus de droïdes animés ---------------------------------------------------------
function makePreview(container, classId, color) {
  const cv = document.createElement('canvas');
  container.prepend(cv);
  const p = { cv, classId, color, t: Math.random() * 10 };
  app.previews.push(p);
  return p;
}

function drawPreviews(dt) {
  for (const p of app.previews) {
    if (!p.cv.isConnected || !p.cv.offsetParent) continue;
    const w = p.cv.clientWidth;
    const h = p.cv.clientHeight;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    if (p.cv.width !== Math.round(w * dpr)) {
      p.cv.width = Math.round(w * dpr);
      p.cv.height = Math.round(h * dpr);
    }
    p.t += dt;
    const ctx = p.cv.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);
    const r = DROIDS[p.classId].radius * 1.9;
    const cx = w / 2;
    const cy = h / 2 + 4;
    ctx.globalCompositeOperation = 'lighter';
    drawGlow(ctx, p.color, cx, cy, r * 7, 0.35, true);
    ctx.globalCompositeOperation = 'source-over';
    ctx.globalAlpha = 1;
    // socle holographique
    ctx.strokeStyle = p.color;
    ctx.globalAlpha = 0.35;
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.ellipse(cx, cy + r * 1.3, r * 1.8, r * 0.45, 0, 0, TAU);
    ctx.stroke();
    ctx.globalAlpha = 1;
    const body = -Math.PI / 2 + Math.sin(p.t * 0.7) * 0.3;
    const aim = -Math.PI / 2 + Math.sin(p.t * 1.3) * 0.9;
    drawBody(ctx, p.classId, cx, cy + Math.sin(p.t * 2) * 3, r, body, aim, p.color, 0, false, p.t, 0);
  }
}

// ---- Sélection arcade ------------------------------------------------------------------
function statPips(n) {
  return `<span class="pips">${[1, 2, 3, 4, 5].map((i) => `<i class="${i <= n ? 'on' : ''}"></i>`).join('')}</span>`;
}

function cardHTML(d) {
  return `
    <h3>${d.name}</h3>
    <p class="role">${d.role}</p>
    <div class="stat"><span>Puissance</span>${statPips(d.stats.power)}</div>
    <div class="stat"><span>Vitesse</span>${statPips(d.stats.speed)}</div>
    <div class="stat"><span>Blindage</span>${statPips(d.stats.armor)}</div>
    <p class="weapon"><b>${d.weapon.name}</b><br><span class="sp">${d.special.name}</span> · ${d.special.desc}</p>`;
}

function buildArcadeCards() {
  const wrap = $('#arcade-cards');
  wrap.innerHTML = '';
  app.previews = [];
  for (const id of DROID_ORDER) {
    const d = DROIDS[id];
    const card = document.createElement('button');
    card.className = `card${id === app.droid ? ' selected' : ''}`;
    card.dataset.droid = id;
    card.innerHTML = cardHTML(d);
    makePreview(card, id, COLORS.player);
    // clavier/manette : le focus sélectionne ; souris : 1er clic sélectionne, 2e clic lance
    card.addEventListener('pointerdown', () => (card.wasSelected = app.droid === id));
    card.addEventListener('focus', () => {
      if (card.wasSelected === undefined) selectDroid(id);
    });
    card.addEventListener('click', () => {
      const was = card.wasSelected ?? true;
      card.wasSelected = undefined;
      if (was && app.droid === id) startArcade();
      else selectDroid(id);
    });
    wrap.append(card);
  }
}

function selectDroid(id) {
  if (app.droid === id) return;
  app.droid = id;
  store.set('droid', id);
  $$('#arcade-cards .card').forEach((c) => c.classList.toggle('selected', c.dataset.droid === id));
  audio.play('uiMove');
}

// ---- Sélection duel ---------------------------------------------------------------------
function buildDuel() {
  app.previews = [];
  // affectation des manettes connectées
  const n = input.pads.length;
  if (n === 1 && app.duel.padOf[0] === 0 && app.duel.padOf[1] === 1) app.duel.padOf = [0, null];
  if (n >= 2 && (app.duel.padOf[0] === null || app.duel.padOf[1] === null)) app.duel.padOf = [0, 1];
  renderDuelCol(0);
  renderDuelCol(1);
}

function renderDuelCol(i) {
  const col = $(i === 0 ? '#duel-p1' : '#duel-p2');
  const key = i === 0 ? 'p1' : 'p2';
  const id = app.duel[key];
  const d = DROIDS[id];
  const isBot = i === 1 && app.duel.p2Type !== 'human';
  const km = i === 0 ? KEYMAPS.p1 : KEYMAPS.p2;
  const L = (c) => input.keyLabel(c);
  const pad = app.duel.padOf[i];
  col.innerHTML = `
    <h3>${i === 0 ? 'JOUEUR 1' : isBot ? 'CPU' : 'JOUEUR 2'}</h3>
    <div class="picker">
      <button class="arrow" data-dir="-1" aria-label="Droïde précédent">‹</button>
      <span class="name" style="color:var(--pc)">${d.name}</span>
      <button class="arrow" data-dir="1" aria-label="Droïde suivant">›</button>
    </div>
    <p class="desc">${d.role} · ${d.weapon.name}<br><span style="color:var(--gold)">${d.special.name}</span> · ${d.special.desc}</p>
    ${
      i === 1
        ? `<div class="seg" id="p2-type">${P2_TYPES.map((t) => `<button data-t="${t.id}" class="${t.id === app.duel.p2Type ? 'on' : ''}">${t.label}</button>`).join('')}</div>`
        : ''
    }
    <p class="keys">${
      isBot
        ? `Changer : ${L('ArrowUp')} / ${L('ArrowDown')}`
        : `Choisir : ${i === 0 ? `${L('KeyA')} / ${L('KeyD')}` : `${L('ArrowLeft')} / ${L('ArrowRight')}`} · Tir ${L(km.fire[0])} · Dash ${L(km.dash[0])} · Spé ${L(km.special[0])}`
    }<br>${!isBot ? (pad !== null && pad !== undefined && input.pad(pad) ? `🎮 Manette ${pad + 1} + clavier` : 'Clavier') : ''}</p>
    ${i === 1 && !isBot && input.pads.length ? '<button class="ready-badge" data-swap>Inverser les manettes</button>' : ''}`;
  app.previews = app.previews.filter((p) => p.cv.isConnected);
  makePreview(col, id, i === 0 ? COLORS.p1 : COLORS.p2);
  $$('.arrow', col).forEach((b) => b.addEventListener('click', () => cycleDuel(i, Number(b.dataset.dir))));
  $$('#p2-type button', col).forEach((b) =>
    b.addEventListener('click', () => {
      app.duel.p2Type = b.dataset.t;
      audio.play('uiMove');
      renderDuelCol(1);
    }),
  );
  $('[data-swap]', col)?.addEventListener('click', () => {
    app.duel.padOf = [app.duel.padOf[1], app.duel.padOf[0]];
    audio.play('uiSelect');
    renderDuelCol(0);
    renderDuelCol(1);
  });
}

function cycleDuel(i, dir) {
  const key = i === 0 ? 'p1' : 'p2';
  const idx = DROID_ORDER.indexOf(app.duel[key]);
  app.duel[key] = DROID_ORDER[(idx + dir + DROID_ORDER.length) % DROID_ORDER.length];
  audio.play('uiMove');
  renderDuelCol(i);
}

function cycleP2Type(dir) {
  const idx = P2_TYPES.findIndex((t) => t.id === app.duel.p2Type);
  app.duel.p2Type = P2_TYPES[(idx + dir + P2_TYPES.length) % P2_TYPES.length].id;
  audio.play('uiMove');
  renderDuelCol(1);
}

function duelScreenInput(dt) {
  if (input.hit(['KeyA'])) cycleDuel(0, -1);
  if (input.hit(['KeyD'])) cycleDuel(0, 1);
  if (input.hit(['ArrowLeft'])) cycleDuel(1, -1);
  if (input.hit(['ArrowRight'])) cycleDuel(1, 1);
  if (input.hit(['ArrowUp'])) cycleP2Type(-1);
  if (input.hit(['ArrowDown'])) cycleP2Type(1);
  app.duel.padNav = app.duel.padNav || [0, 0];
  for (let i = 0; i < 2; i++) {
    const pi = app.duel.padOf[i];
    if (pi === null || pi === undefined || !input.pad(pi)) continue;
    const [sx, sy] = input.stick(pi, 'left');
    app.duel.padNav[i] -= dt;
    if (Math.abs(sx) > 0.6 && app.duel.padNav[i] <= 0) {
      cycleDuel(i, Math.sign(sx));
      app.duel.padNav[i] = 0.3;
    } else if (i === 1 && Math.abs(sy) > 0.6 && app.duel.padNav[i] <= 0) {
      cycleP2Type(Math.sign(sy));
      app.duel.padNav[i] = 0.3;
    } else if (Math.abs(sx) < 0.3 && Math.abs(sy) < 0.3) app.duel.padNav[i] = 0;
    if (input.padHit(pi, [0, 9])) startDuel();
    if (input.padHit(pi, [1])) back();
  }
  if (input.hit(['Enter', 'NumpadEnter'])) startDuel();
  if (input.hit(['Escape'])) back();
}

// ---- Lancement des parties --------------------------------------------------------------
function launch(game) {
  goFullscreen();
  game.fx.intensity = settings.fx;
  game.resize(app.view.w, app.view.h, app.view.dpr);
  app.game = game;
  app.state = 'playing';
  hideScreens();
  document.body.classList.add('playing');
  document.activeElement?.blur?.();
}

async function startArcade() {
  audio.play('uiSelect');
  app.run = null;
  app.result = null;
  const controller = new HumanController({ keymap: KEYMAPS.solo, padIndex: 0, mouse: true, toWorld: (x, y) => app.game.toWorld(x, y) });
  const game = new Game(canvas, { mode: 'arcade', droid: app.droid, controller, settings, onEnd: onArcadeEnd });
  launch(game);
  try {
    app.run = await api.startRun();
  } catch (err) {
    console.warn('Classement indisponible :', err.message);
  }
}

function startDuel() {
  audio.play('uiSelect');
  const d = app.duel;
  const p2Human = d.p2Type === 'human';
  const players = [
    { droid: d.p1, label: 'J1', padIndex: d.padOf[0], controller: new HumanController({ keymap: KEYMAPS.p1, padIndex: d.padOf[0] ?? null }) },
    p2Human
      ? { droid: d.p2, label: 'J2', padIndex: d.padOf[1], controller: new HumanController({ keymap: KEYMAPS.p2, padIndex: d.padOf[1] ?? null }) }
      : { droid: d.p2, label: 'CPU', padIndex: null, controller: new BotController(d.p2Type) },
  ];
  launch(new Game(canvas, { mode: 'duel', players, settings, onEnd: onDuelEnd }));
}

function toMenu() {
  app.state = 'menu';
  app.game = null;
  document.body.classList.remove('playing');
  app.history = [];
  show('title', { push: false });
}

function pause() {
  if (app.state !== 'playing') return;
  app.state = 'paused';
  app.game.paused = true;
  document.body.classList.remove('playing');
  audio.play('uiBack');
  show('pause', { push: false });
}

function resume() {
  if (app.state !== 'paused') return;
  app.state = 'playing';
  app.game.paused = false;
  document.body.classList.add('playing');
  audio.play('uiSelect');
  hideScreens();
  document.activeElement?.blur?.();
}

function restart() {
  if (!app.game) return;
  if (app.game.mode === 'arcade') startArcade();
  else startDuel();
}

// ---- Fin de partie ------------------------------------------------------------------------
function onArcadeEnd(result) {
  app.state = 'ended';
  app.result = result;
  document.body.classList.remove('playing');
  const best = store.get('best', 0);
  const isBest = result.score > best;
  if (isBest) store.set('best', result.score);
  $('#go-score').textContent = fmt(result.score);
  $('#go-best').textContent = isBest && result.score > 0 ? '★ NOUVEAU RECORD PERSO ★' : best ? `Record perso : ${fmt(best)}` : '';
  $('#go-stats').innerHTML = [
    ['Vague', result.wave],
    ['Éliminations', result.kills],
    ['Combo max', result.maxCombo],
    ['Durée', formatTime(result.durationMs)],
    ['Droïde', DROIDS[result.droid].name],
  ]
    .map(([k, v]) => `<div><b>${v}</b><span>${k}</span></div>`)
    .join('');
  const form = $('#score-form');
  const msg = $('#form-msg');
  const inputName = $('#player-name');
  inputName.value = store.get('name', '');
  msg.textContent = '';
  msg.className = 'form-msg';
  const canSubmit = !!app.run && result.score > 0;
  form.querySelectorAll('input, button').forEach((n) => (n.disabled = !canSubmit));
  if (!app.run) {
    msg.textContent = 'Classement indisponible (serveur injoignable au lancement).';
    msg.className = 'form-msg err';
  } else if (result.score <= 0) msg.textContent = 'Marque des points pour entrer au classement !';
  show('gameover', { push: false });
  if (canSubmit) setTimeout(() => inputName.focus(), 50);
  renderMiniBoard();
}

async function submitScore(e) {
  e.preventDefault();
  const name = $('#player-name').value.trim();
  const msg = $('#form-msg');
  const btn = $('#submit-btn');
  if (!app.run || !app.result) return;
  if (!/^[\p{L}\p{N} _.\-]{2,16}$/u.test(name)) {
    msg.textContent = 'Pseudo : 2 à 16 caractères (lettres, chiffres, espace, _ . -)';
    msg.className = 'form-msg err';
    return;
  }
  store.set('name', name);
  btn.disabled = true;
  msg.textContent = 'Transmission…';
  msg.className = 'form-msg';
  try {
    const r = app.result;
    const res = await api.submitScore({ ...app.run, name, score: r.score, wave: r.wave, kills: r.kills, droid: r.droid, durationMs: r.durationMs });
    msg.textContent = `Score enregistré : tu es ${res.rank === 1 ? '1er' : `${res.rank}e`} au classement !`;
    msg.className = 'form-msg ok';
    $('#player-name').disabled = true;
    audio.play('waveClear');
    app.run = null;
    renderMiniBoard({ name, score: r.score });
  } catch (err) {
    msg.textContent = err.message;
    msg.className = 'form-msg err';
    btn.disabled = false;
  }
}

function onDuelEnd(result) {
  app.state = 'ended';
  document.body.classList.remove('playing');
  const w = result.players[result.winner];
  const title = $('#duel-winner');
  title.textContent = w.label === 'CPU' ? 'Le CPU gagne' : `${w.label} gagne !`;
  title.style.textShadow = `0 0 24px ${w.color}, 0 0 2px #fff`;
  $('#duel-score').innerHTML = `<span style="color:${result.players[0].color}">${result.wins[0]}</span> — <span style="color:${result.players[1].color}">${result.wins[1]}</span>`;
  show('duel-end', { push: false });
}

// ---- Classement ------------------------------------------------------------------------------
function escapeHTML(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
}

function boardTable(scores, me, full = true) {
  if (!scores.length) return '<div class="empty">Aucun score pour l\'instant. À toi de jouer !</div>';
  let meMarked = false;
  const rows = scores
    .map((s, i) => {
      const isMe = !meMarked && me && s.name === me.name && s.score === me.score;
      if (isMe) meMarked = true;
      const d = DROIDS[s.droid];
      return `<tr class="${i < 3 ? `top${i + 1}` : ''} ${isMe ? 'me' : ''}">
        <td class="rank">${i + 1}</td>
        <td>${escapeHTML(s.name)}</td>
        <td class="score">${fmt(s.score)}</td>
        <td>${s.wave}</td>
        ${full ? `<td><span class="droid-tag">${d ? d.name : s.droid}</span></td><td>${new Date(s.createdAt).toLocaleDateString('fr-FR')}</td>` : ''}
      </tr>`;
    })
    .join('');
  return `<table><thead><tr><th>#</th><th>Pilote</th><th>Score</th><th>Vague</th>${full ? '<th>Droïde</th><th>Date</th>' : ''}</tr></thead><tbody>${rows}</tbody></table>`;
}

async function loadBoard(period) {
  const el = $('#board');
  el.innerHTML = '<div class="empty">Chargement…</div>';
  try {
    const { scores } = await api.topScores(period, 20);
    el.innerHTML = boardTable(scores, null, true);
  } catch (err) {
    el.innerHTML = `<div class="empty">Classement indisponible : ${escapeHTML(err.message)}</div>`;
  }
}

async function renderMiniBoard(me = null) {
  const el = $('#go-board');
  try {
    const { scores } = await api.topScores('all', 5);
    el.innerHTML = boardTable(scores, me, false);
  } catch {
    el.innerHTML = '';
  }
}

// ---- Commandes & réglages ------------------------------------------------------------------
function buildControls() {
  const L = (codes) => codes.map((c) => `<span class="kbd">${input.keyLabel(c)}</span>`).join(' ');
  const box = (title, rows) => `<div class="ctrl-box"><h3>${title}</h3><dl>${rows.map(([k, v]) => `<dt>${k}</dt><dd>${v}</dd>`).join('')}</dl></div>`;
  const s = KEYMAPS.solo;
  const p1 = KEYMAPS.p1;
  const p2 = KEYMAPS.p2;
  $('#controls-grid').innerHTML = [
    box('Arcade · clavier + souris', [
      [L([s.up[0], s.left[0], s.down[0], s.right[0]]), 'Se déplacer'],
      ['<span class="kbd">Souris</span>', 'Viser'],
      [L(s.fire), 'Tirer (maintenir)'],
      [L(s.dash), 'Dash (invulnérable)'],
      [L(s.special), 'Spéciale'],
      [L(['Escape']), 'Pause'],
    ]),
    box('Duel · Joueur 1', [
      [L([p1.up[0], p1.left[0], p1.down[0], p1.right[0]]), 'Se déplacer'],
      [L(p1.fire), 'Tirer'],
      [L(p1.dash), 'Dash'],
      [L(p1.special), 'Spéciale'],
      ['', 'Visée automatique'],
    ]),
    box('Duel · Joueur 2', [
      [L(['ArrowUp', 'ArrowLeft', 'ArrowDown', 'ArrowRight']), 'Se déplacer'],
      [L(p2.fire), 'Tirer'],
      [L(p2.dash), 'Dash'],
      [L(p2.special), 'Spéciale'],
      ['', 'Visée automatique'],
    ]),
    box('Manette', [
      ['<span class="kbd">Stick G</span>', 'Se déplacer'],
      ['<span class="kbd">Stick D</span>', 'Viser (sinon auto)'],
      ['<span class="kbd">RT</span> <span class="kbd">RB</span>', 'Tirer'],
      ['<span class="kbd">A</span> <span class="kbd">LB</span>', 'Dash'],
      ['<span class="kbd">B</span> <span class="kbd">Y</span>', 'Spéciale'],
      ['<span class="kbd">Start</span>', 'Pause'],
    ]),
    box('Astuces', [
      ['⚡', 'La spéciale se charge en infligeant et en encaissant des dégâts'],
      ['💨', 'Le dash rend invulnérable : traverse les tirs !'],
      ['✖', 'Enchaîne les éliminations pour monter le multiplicateur (jusqu\'à ×8)'],
      ['♥', 'Une vague sans dégât rapporte un bonus PARFAIT'],
    ]),
  ].join('');
}

function syncSettingsUI() {
  $('#set-sfx').value = settings.sfx;
  $('#set-music').value = settings.music;
  $$('#set-shake button').forEach((b) => b.classList.toggle('on', Number(b.dataset.v) === settings.shake));
  $$('#set-fx button').forEach((b) => b.classList.toggle('on', Number(b.dataset.v) === settings.fx));
}

function applySettings() {
  audio.setVolumes(settings.sfx, settings.music);
  for (const g of [app.demo, app.game]) if (g) g.fx.intensity = settings.fx;
  store.set('settings', settings);
}

// ---- Événements DOM ---------------------------------------------------------------------------
const ACTIONS = {
  arcade: () => show('select'),
  duel: () => show('duel', { push: app.state === 'menu' }),
  leaderboard: () => show('leaderboard'),
  controls: () => show('controls'),
  settings: () => show('settings'),
  'settings-from-pause': () => show('settings'),
  back,
  'start-arcade': startArcade,
  'start-duel': startDuel,
  resume,
  restart,
  quit: toMenu,
  menu: toMenu,
  replay: startArcade,
  'change-droid': () => {
    app.state = 'menu';
    app.game = null;
    app.history = ['title'];
    show('select', { push: false });
  },
  rematch: startDuel,
};

document.addEventListener('click', (e) => {
  const btn = e.target.closest('[data-action]');
  if (!btn) return;
  const fn = ACTIONS[btn.dataset.action];
  if (!fn) return;
  if (btn.dataset.action !== 'back') audio.play('uiSelect');
  if (btn.dataset.action === 'duel' && app.state !== 'menu') {
    app.state = 'menu';
    app.game = null;
    app.history = ['title'];
    app.screen = null;
  }
  fn();
});

$$('.tab').forEach((t) =>
  t.addEventListener('click', () => {
    $$('.tab').forEach((x) => x.classList.toggle('active', x === t));
    audio.play('uiMove');
    loadBoard(t.dataset.period);
  }),
);

$('#score-form').addEventListener('submit', submitScore);

$('#set-sfx').addEventListener('input', (e) => {
  settings.sfx = Number(e.target.value);
  applySettings();
  audio.play('blaster');
});
$('#set-music').addEventListener('input', (e) => {
  settings.music = Number(e.target.value);
  applySettings();
});
for (const [id, key] of [
  ['#set-shake', 'shake'],
  ['#set-fx', 'fx'],
]) {
  $$(`${id} button`).forEach((b) =>
    b.addEventListener('click', () => {
      settings[key] = Number(b.dataset.v);
      applySettings();
      syncSettingsUI();
      if (key === 'shake') current()?.addShake(0.6);
    }),
  );
}

// le premier geste utilisateur débloque l'audio
function unlockAudio() {
  audio.unlock();
  audio.setVolumes(settings.sfx, settings.music);
  audio.startMusic();
}
window.addEventListener('pointerdown', unlockAudio);
window.addEventListener('keydown', unlockAudio);

document.addEventListener('visibilitychange', () => {
  if (document.hidden) {
    pause();
    audio.suspend();
  } else audio.resume();
});

// la souris survole un élément de menu => focus (cohérent avec la navigation clavier)
document.addEventListener('mouseover', (e) => {
  const el = e.target.closest('.screen.active .btn');
  if (el && document.activeElement !== el && !(document.activeElement instanceof HTMLInputElement)) el.focus({ preventScroll: true });
});

// ---- Redimensionnement ----------------------------------------------------------------------
function resize() {
  const w = window.innerWidth;
  const h = window.innerHeight;
  let dpr = Math.min(window.devicePixelRatio || 1, 2);
  if (w * dpr > 2560) dpr = 2560 / w;
  canvas.width = Math.round(w * dpr);
  canvas.height = Math.round(h * dpr);
  app.view = { w, h, dpr };
  app.demo?.resize(w, h, dpr);
  app.game?.resize(w, h, dpr);
}
window.addEventListener('resize', resize);

// ---- Boucle ------------------------------------------------------------------------------------
function globalInput(dt) {
  if (app.state === 'playing') {
    if (input.pausePressed()) pause();
    return;
  }
  if (app.state === 'paused' && app.screen === 'pause' && (input.hit(['KeyP']) || input.anyPadHit([9]))) {
    resume();
    return;
  }
  if (!app.screen) return;
  if (app.screen === 'duel') return duelScreenInput(dt);
  const typing = document.activeElement instanceof HTMLInputElement && document.activeElement.type === 'text';
  const nav = input.menuNav(dt);
  if (!typing && nav.move) {
    const range = document.activeElement instanceof HTMLInputElement && document.activeElement.type === 'range';
    if (range && (nav.move === 'left' || nav.move === 'right')) {
      // les flèches clavier sont gérées nativement ; ajuste pour la manette
      if (input.lastDevice === 'gamepad') {
        const el = document.activeElement;
        el.value = Number(el.value) + (nav.move === 'right' ? 0.05 : -0.05);
        el.dispatchEvent(new Event('input'));
      }
    } else moveFocus(nav.move);
  }
  if (input.anyPadHit([0])) document.activeElement?.click?.();
  if (nav.back && !typing) back();
}

function drawCrosshair() {
  const g = app.game;
  if (!g || g.mode !== 'arcade' || app.state !== 'playing' || input.lastDevice !== 'keyboard') return;
  const ctx = canvas.getContext('2d');
  const { dpr } = app.view;
  const { x, y } = input.mouse;
  const p = g.players[0];
  const ready = p && p.fireCd <= 0;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.globalCompositeOperation = 'lighter';
  drawGlow(ctx, COLORS.player, x, y, 40, 0.4);
  ctx.globalCompositeOperation = 'source-over';
  ctx.globalAlpha = 1;
  ctx.strokeStyle = ready ? '#ffffff' : COLORS.player;
  ctx.lineWidth = 2;
  const r = 9 + (p ? p.recoilK * 5 : 0);
  ctx.beginPath();
  ctx.arc(x, y, r, 0, TAU);
  ctx.stroke();
  ctx.beginPath();
  for (const [dx, dy] of [
    [1, 0],
    [-1, 0],
    [0, 1],
    [0, -1],
  ]) {
    ctx.moveTo(x + dx * (r + 3), y + dy * (r + 3));
    ctx.lineTo(x + dx * (r + 9), y + dy * (r + 9));
  }
  ctx.stroke();
  ctx.fillStyle = COLORS.player;
  ctx.fillRect(x - 1.5, y - 1.5, 3, 3);
}

let last = performance.now();
function frame(now) {
  const dt = Math.min(0.05, Math.max(0, (now - last) / 1000));
  last = now;
  input.poll();
  globalInput(dt);
  const g = current();
  if (g) {
    g.update(dt);
    g.render();
  }
  drawCrosshair();
  if (app.screen === 'select' || app.screen === 'duel') drawPreviews(dt);
  input.endFrame();
  requestAnimationFrame(frame);
}

// ---- Tactile (mobile) ----------------------------------------------------------------------
function setupTouch() {
  const coarse = window.matchMedia('(pointer: coarse)').matches || 'ontouchstart' in window;
  const enable = () => document.body.classList.add('touch');
  if (coarse) enable();
  window.addEventListener('touchstart', enable, { passive: true, once: true });
  if (coarse) {
    const p = document.createElement('p');
    p.className = 'rotate-hint';
    p.textContent = '↻ Tourne ton téléphone en paysage pour jouer';
    $('.title-wrap').append(p);
  }

  const zone = $('#stick-zone');
  const base = $('#stick-base');
  const knob = $('#stick-knob');
  const R = 60;
  let id = null;
  let ox = 0;
  let oy = 0;
  const move = (e) => {
    let dx = e.clientX - ox;
    let dy = e.clientY - oy;
    const d = Math.hypot(dx, dy);
    if (d > R) {
      dx = (dx / d) * R;
      dy = (dy / d) * R;
    }
    knob.style.transform = `translate(${dx}px, ${dy}px)`;
    const m = Math.min(1, d / R);
    input.touch.mx = d > 8 ? (dx / R) * (m > 0.95 ? 1 / m : 1) : 0;
    input.touch.my = d > 8 ? (dy / R) * (m > 0.95 ? 1 / m : 1) : 0;
  };
  zone.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    if (id !== null) return;
    id = e.pointerId;
    zone.setPointerCapture(id);
    const r = zone.getBoundingClientRect();
    ox = e.clientX;
    oy = e.clientY;
    base.style.left = `${e.clientX - r.left}px`;
    base.style.top = `${e.clientY - r.top}px`;
    base.style.bottom = 'auto';
    base.style.transform = 'none';
    base.classList.add('on');
    input.touch.active = true;
    input.lastDevice = 'touch';
    move(e);
  });
  zone.addEventListener('pointermove', (e) => {
    if (e.pointerId === id) move(e);
  });
  const end = (e) => {
    if (e.pointerId !== id) return;
    id = null;
    input.touch.active = false;
    input.touch.mx = input.touch.my = 0;
    knob.style.transform = '';
    base.classList.remove('on');
  };
  zone.addEventListener('pointerup', end);
  zone.addEventListener('pointercancel', end);

  $$('[data-vcode]').forEach((b) => {
    const code = b.dataset.vcode;
    b.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      input.virtualDown(code);
      b.classList.add('down');
    });
    const up = () => {
      input.virtualUp(code);
      b.classList.remove('down');
    };
    b.addEventListener('pointerup', up);
    b.addEventListener('pointercancel', up);
    b.addEventListener('pointerleave', up);
  });
  $('#t-pause').addEventListener('pointerdown', (e) => {
    e.preventDefault();
    pause();
  });
}

function goFullscreen() {
  if (!document.body.classList.contains('touch') || document.fullscreenElement) return;
  const el = document.documentElement;
  el.requestFullscreen?.({ navigationUI: 'hide' })
    .then(() => screen.orientation?.lock?.('landscape').catch(() => {}))
    .catch(() => {});
}

// ---- Démarrage ------------------------------------------------------------------------------------
async function boot() {
  setupTouch();
  resize();
  app.demo = makeDemo();
  try {
    await Promise.race([document.fonts.load('800 20px Orbitron'), new Promise((r) => setTimeout(r, 1500))]);
  } catch {
    /* police indisponible : repli système */
  }
  show('title', { push: false });
  $('#loader').classList.add('hidden');
  requestAnimationFrame(frame);
}

if (new URLSearchParams(location.search).has('debug')) window.__app = app;

boot();
