// HUD dessiné sur le canvas (espace écran).
import { DUEL, SCORING, SPECIAL } from './config.js';
import { input, KEYMAPS } from './input.js';
import { clamp, damp, easeOutBack, fmt, rgba } from './utils.js';

const FONT = 'Orbitron, sans-serif';
const BODY = 'Rajdhani, sans-serif';

export function drawHud(g, ctx) {
  const v = g.view;
  const hs = clamp(Math.min(v.w / 1366, v.h / 768), 0.55, 1.6);
  ctx.save();
  ctx.setTransform(v.dpr * hs, 0, 0, v.dpr * hs, 0, 0);
  const W = v.w / hs;
  const H = v.h / hs;
  ctx.textBaseline = 'alphabetic';
  if (g.mode === 'arcade') arcadeHud(g, ctx, W, H);
  else duelHud(g, ctx, W, H);
  drawBanner(g, ctx, W, H);
  ctx.restore();
}

function panel(ctx, x, y, w, h, color, flip = false) {
  const k = 14;
  ctx.save();
  ctx.beginPath();
  if (!flip) {
    ctx.moveTo(x, y);
    ctx.lineTo(x + w, y);
    ctx.lineTo(x + w - k, y + h);
    ctx.lineTo(x, y + h);
  } else {
    ctx.moveTo(x, y);
    ctx.lineTo(x + w, y);
    ctx.lineTo(x + w, y + h);
    ctx.lineTo(x + k, y + h);
  }
  ctx.closePath();
  ctx.fillStyle = 'rgba(5,8,20,0.62)';
  ctx.fill();
  ctx.strokeStyle = rgba(color, 0.45);
  ctx.lineWidth = 1;
  ctx.stroke();
  ctx.restore();
}

// Barre avec "fantôme" de dégâts qui se résorbe
function bar(ctx, x, y, w, h, ratio, ghost, color, flip = false) {
  ratio = clamp(ratio, 0, 1);
  ghost = clamp(ghost, 0, 1);
  ctx.fillStyle = 'rgba(255,255,255,0.08)';
  ctx.fillRect(x, y, w, h);
  const gx = flip ? x + w - w * ghost : x;
  ctx.fillStyle = 'rgba(255,255,255,0.75)';
  ctx.fillRect(gx, y, w * ghost, h);
  const fx = flip ? x + w - w * ratio : x;
  const grad = ctx.createLinearGradient(x, y, x, y + h);
  grad.addColorStop(0, '#ffffff');
  grad.addColorStop(0.25, color);
  grad.addColorStop(1, rgba(color, 0.7));
  ctx.fillStyle = grad;
  ctx.fillRect(fx, y, w * ratio, h);
  // liseré lumineux (moins coûteux qu'un shadowBlur)
  ctx.fillStyle = rgba(color, 0.35);
  ctx.fillRect(fx, y - 2, w * ratio, 2);
  ctx.fillRect(fx, y + h, w * ratio, 2);
  // graduations
  ctx.fillStyle = 'rgba(0,0,0,0.35)';
  for (let i = 1; i < 10; i++) ctx.fillRect(x + (w * i) / 10, y, 1, h);
}

function ghostOf(obj, key, value, dt) {
  const k = `_${key}Ghost`;
  if (obj[k] === undefined || value > obj[k]) obj[k] = value;
  else obj[k] = damp(obj[k], value, 3, dt);
  return obj[k];
}

function droidBlock(g, ctx, d, x, y, flip, title) {
  const dt = g.realDt || 0.016;
  const w = 360;
  panel(ctx, flip ? x - w : x, y, w, 92, d.color, flip);
  const left = flip ? x - w + 24 : x + 16;
  const right = flip ? x - 16 : x + w - 30;
  ctx.font = `700 15px ${FONT}`;
  ctx.fillStyle = d.color;
  ctx.textAlign = flip ? 'right' : 'left';
  ctx.fillText(title, flip ? right : left, y + 24);
  ctx.font = `600 15px ${BODY}`;
  ctx.fillStyle = 'rgba(255,255,255,0.75)';
  ctx.textAlign = flip ? 'left' : 'right';
  ctx.fillText(`${Math.ceil(d.hp)} / ${d.maxHp}`, flip ? left : right, y + 24);

  const bw = right - left;
  const hpColor = d.hp < d.maxHp * 0.3 ? '#ff4d5e' : '#3dff9a';
  bar(ctx, left, y + 34, bw, 15, d.hp / d.maxHp, ghostOf(d, 'hp', d.hp / d.maxHp, dt), hpColor, flip);

  const full = d.special >= SPECIAL.max;
  const pulse = full ? 0.6 + Math.sin(g.time * 8) * 0.4 : 1;
  ctx.globalAlpha = pulse;
  bar(ctx, left, y + 56, bw, 8, d.special / SPECIAL.max, d.special / SPECIAL.max, full ? '#ffd23d' : '#c9a52a', flip);
  ctx.globalAlpha = 1;
  ctx.font = `700 12px ${FONT}`;
  ctx.textAlign = flip ? 'right' : 'left';
  ctx.fillStyle = full ? '#ffd23d' : 'rgba(255,255,255,0.5)';
  const key = specialKey(g, d);
  ctx.fillText(full ? `${d.cfg.special.name} PRÊTE · ${key}` : d.cfg.special.name, flip ? right : left, y + 82);
  // dash
  const ready = clamp(1 - d.dashCd / d.cfg.dashCd, 0, 1);
  ctx.textAlign = flip ? 'left' : 'right';
  ctx.fillStyle = ready >= 1 ? d.color : 'rgba(255,255,255,0.35)';
  ctx.fillText(ready >= 1 ? 'DASH ✓' : `DASH ${Math.round(ready * 100)}%`, flip ? left : right, y + 82);
}

function specialKey(g, d) {
  if (d.controller && !d.controller.human) return 'CPU';
  if (input.lastDevice === 'gamepad' && d.padIndex !== null && input.pad(d.padIndex)) return 'B';
  const km = d.controller?.keymap;
  if (!km) return '';
  return km.special.map((c) => input.keyLabel(c)).join(' / ');
}

function arcadeHud(g, ctx, W, H) {
  const p = g.players[0];
  droidBlock(g, ctx, p, 22, 18, false, p.cfg.name);

  // score
  ctx.textAlign = 'right';
  ctx.font = `600 14px ${FONT}`;
  ctx.fillStyle = 'rgba(255,255,255,0.55)';
  ctx.fillText('SCORE', W - 24, 32);
  ctx.font = `800 40px ${FONT}`;
  ctx.fillStyle = '#ffffff';
  ctx.shadowColor = '#2de2ff';
  ctx.shadowBlur = 16;
  ctx.fillText(fmt(g.displayScore), W - 24, 72);
  ctx.shadowBlur = 0;
  if (g.mult > 1 || g.combo > 0) {
    const bump = 1 + Math.max(0, (g.comboT - SCORING.comboWindow + 0.2) * 1.5);
    ctx.save();
    ctx.translate(W - 24, 112);
    ctx.scale(bump, bump);
    ctx.font = `900 30px ${FONT}`;
    ctx.fillStyle = '#ffd23d';
    ctx.shadowColor = '#ffd23d';
    ctx.shadowBlur = 18;
    ctx.fillText(`×${g.mult}`, 0, 0);
    ctx.restore();
    ctx.font = `700 14px ${FONT}`;
    ctx.fillStyle = 'rgba(255,255,255,0.7)';
    ctx.fillText(`COMBO ${g.combo}`, W - 100, 108);
    const cw = 150;
    ctx.fillStyle = 'rgba(255,255,255,0.1)';
    ctx.fillRect(W - 24 - cw, 122, cw, 4);
    ctx.fillStyle = '#ffd23d';
    ctx.fillRect(W - 24 - cw, 122, cw * clamp(g.comboT / SCORING.comboWindow, 0, 1), 4);
  }

  // vague
  ctx.textAlign = 'center';
  ctx.font = `800 22px ${FONT}`;
  ctx.fillStyle = '#ffffff';
  ctx.fillText(`VAGUE ${Math.max(1, g.wave)}`, W / 2, 38);
  const remaining = g.enemies.filter((e) => e.alive).length + g.queue.length;
  ctx.font = `600 15px ${BODY}`;
  ctx.fillStyle = 'rgba(255,255,255,0.6)';
  ctx.fillText(g.waveState === 'fight' ? `${remaining} ennemi${remaining > 1 ? 's' : ''} restant${remaining > 1 ? 's' : ''}` : '', W / 2, 58);

  // boss
  if (g.boss && g.boss.alive && g.boss.active) {
    const b = g.boss;
    const bw = Math.min(620, W * 0.5);
    const x = W / 2 - bw / 2;
    const y = 76;
    ctx.font = `800 14px ${FONT}`;
    ctx.fillStyle = '#ff2e6a';
    ctx.textAlign = 'left';
    ctx.fillText(`OVERLORD · NIV. ${b.bossLevel}`, x, y);
    ctx.textAlign = 'right';
    ctx.fillStyle = 'rgba(255,255,255,0.6)';
    ctx.fillText(b.hp < b.maxHp * 0.5 ? 'PHASE 2' : 'PHASE 1', x + bw, y);
    bar(ctx, x, y + 8, bw, 14, b.hp / b.maxHp, ghostOf(b, 'hp', b.hp / b.maxHp, g.realDt || 0.016), '#ff2e6a');
  }

  // aide aux commandes pendant la première vague
  if (g.wave <= 1 && g.durationMs < 14000) {
    const a = clamp((14000 - g.durationMs) / 2000, 0, 1);
    const pad = input.lastDevice === 'gamepad';
    const km = KEYMAPS.solo;
    const L = (codes) => codes.map((c) => input.keyLabel(c)).join('/');
    const hint = pad
      ? 'Stick G : bouger · Stick D : viser · RT : tirer · A : dash · B : spéciale · Start : pause'
      : `${L([km.up[0], km.left[0], km.down[0], km.right[0]])} : bouger · Souris : viser · Clic G : tirer · ${L(km.dash)} : dash · ${L(km.special)} : spéciale · Échap : pause`;
    hintBar(ctx, W, H, hint, a);
  }
}

function hintBar(ctx, W, H, text, a) {
  ctx.globalAlpha = a;
  ctx.font = `600 17px ${BODY}`;
  const tw = ctx.measureText(text).width + 40;
  ctx.fillStyle = 'rgba(5,8,20,0.7)';
  ctx.fillRect(W / 2 - tw / 2, H - 52, tw, 32);
  ctx.strokeStyle = 'rgba(45,226,255,0.35)';
  ctx.strokeRect(W / 2 - tw / 2, H - 52, tw, 32);
  ctx.fillStyle = '#e6f6ff';
  ctx.textAlign = 'center';
  ctx.fillText(text, W / 2, H - 30);
  ctx.globalAlpha = 1;
}

function duelHud(g, ctx, W, H) {
  const [a, b] = g.players;
  droidBlock(g, ctx, a, 22, 18, false, `${a.label} · ${a.cfg.name}`);
  droidBlock(g, ctx, b, W - 22, 18, true, `${b.label} · ${b.cfg.name}`);
  // manches gagnées
  for (let pi = 0; pi < 2; pi++) {
    for (let i = 0; i < DUEL.roundsToWin; i++) {
      const won = g.wins[pi] > i;
      const x = pi === 0 ? 34 + i * 26 : W - 34 - i * 26;
      const y = 126;
      ctx.save();
      ctx.translate(x, y);
      ctx.rotate(Math.PI / 4);
      ctx.fillStyle = won ? g.players[pi].color : 'rgba(255,255,255,0.08)';
      ctx.strokeStyle = g.players[pi].color;
      ctx.lineWidth = 1.5;
      if (won) {
        ctx.shadowColor = g.players[pi].color;
        ctx.shadowBlur = 12;
      }
      ctx.fillRect(-7, -7, 14, 14);
      ctx.shadowBlur = 0;
      ctx.strokeRect(-7, -7, 14, 14);
      ctx.restore();
    }
  }
  // chrono
  const t = Math.max(0, Math.ceil(g.roundTime));
  ctx.textAlign = 'center';
  ctx.font = `900 44px ${FONT}`;
  ctx.fillStyle = t <= 10 && g.roundState === 'fight' ? (Math.sin(g.time * 10) > 0 ? '#ff4d5e' : '#ffffff') : '#ffffff';
  ctx.shadowColor = '#b06bff';
  ctx.shadowBlur = 14;
  ctx.fillText(String(t), W / 2, 62);
  ctx.shadowBlur = 0;
  ctx.font = `700 13px ${FONT}`;
  ctx.fillStyle = 'rgba(255,255,255,0.55)';
  ctx.fillText(`MANCHE ${g.round}`, W / 2, 84);

  if (g.round === 1 && g.roundTime > DUEL.roundTime - 7) {
    const k = clamp((g.roundTime - (DUEL.roundTime - 7)) / 1.5, 0, 1);
    const L = (km) =>
      `${[km.up[0], km.left[0], km.down[0], km.right[0]].map((c) => input.keyLabel(c)).join('')} · tir ${input.keyLabel(km.fire[0])} · dash ${input.keyLabel(km.dash[0])} · spé ${input.keyLabel(km.special[0])}`;
    const parts = [];
    if (a.controller.human) parts.push(`J1 : ${L(KEYMAPS.p1)}`);
    if (b.controller.human) parts.push(`J2 : ${L(KEYMAPS.p2)}`);
    if (parts.length) hintBar(ctx, W, H, `${parts.join('    |    ')}    (ou manettes)`, k);
  }
}

function drawBanner(g, ctx, W, H) {
  const b = g.banner;
  if (!b) return;
  const inT = clamp(b.t / 0.35, 0, 1);
  const outT = clamp((b.dur - b.t) / 0.35, 0, 1);
  const a = Math.min(inT, outT);
  const s = 0.6 + 0.4 * easeOutBack(inT);
  const big = b.text.length <= 2;
  ctx.save();
  ctx.translate(W / 2, H * 0.42);
  // traits lumineux
  ctx.globalAlpha = a * 0.5;
  const lw = W * 0.5 * inT;
  const grad = ctx.createLinearGradient(-lw, 0, lw, 0);
  grad.addColorStop(0, 'rgba(0,0,0,0)');
  grad.addColorStop(0.5, b.color);
  grad.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = grad;
  ctx.fillRect(-lw, -62, lw * 2, 2);
  ctx.fillRect(-lw, b.sub ? 62 : 30, lw * 2, 2);
  ctx.globalAlpha = a;
  ctx.scale(s, s);
  ctx.textAlign = 'center';
  ctx.font = `900 ${big ? 120 : 64}px ${FONT}`;
  // aberration chromatique légère
  ctx.globalCompositeOperation = 'lighter';
  const jitter = (1 - inT) * 10 + 2;
  ctx.fillStyle = 'rgba(255,0,80,0.6)';
  ctx.fillText(b.text, -jitter, big ? 30 : 8);
  ctx.fillStyle = 'rgba(0,200,255,0.6)';
  ctx.fillText(b.text, jitter, big ? 30 : 8);
  ctx.globalCompositeOperation = 'source-over';
  ctx.fillStyle = '#ffffff';
  ctx.shadowColor = b.color;
  ctx.shadowBlur = 30;
  ctx.fillText(b.text, 0, big ? 30 : 8);
  ctx.shadowBlur = 0;
  if (b.sub) {
    ctx.font = `700 26px ${FONT}`;
    ctx.fillStyle = b.color;
    ctx.fillText(b.sub, 0, 46);
  }
  ctx.restore();
}
