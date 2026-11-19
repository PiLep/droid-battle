// Effets visuels : particules (étincelles, glow, fumée, débris), anneaux, textes flottants, décalques au sol.
import { ARENA } from './config.js';
import { TAU, rand, pick, chance } from './utils.js';

const MAX_PARTICLES = 3200;
const glowCache = new Map();

// Sprite radial pré-rendu, dessiné en mode additif => glow peu coûteux
export function glowSprite(color, soft = false) {
  const key = color + (soft ? 's' : '');
  let c = glowCache.get(key);
  if (c) return c;
  c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d');
  const grad = g.createRadialGradient(64, 64, 0, 64, 64, 64);
  if (soft) {
    grad.addColorStop(0, color);
    grad.addColorStop(0.4, hexA(color, 0.35));
    grad.addColorStop(1, hexA(color, 0));
  } else {
    grad.addColorStop(0, '#ffffff');
    grad.addColorStop(0.12, color);
    grad.addColorStop(0.35, hexA(color, 0.35));
    grad.addColorStop(1, hexA(color, 0));
  }
  g.fillStyle = grad;
  g.fillRect(0, 0, 128, 128);
  glowCache.set(key, c);
  return c;
}

function hexA(hex, a) {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
}

let scorchCanvas = null;
function scorchSprite() {
  if (scorchCanvas) return scorchCanvas;
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d');
  const grad = g.createRadialGradient(64, 64, 0, 64, 64, 64);
  grad.addColorStop(0, 'rgba(0,0,0,0.6)');
  grad.addColorStop(0.55, 'rgba(10,6,20,0.3)');
  grad.addColorStop(1, 'rgba(0,0,0,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, 128, 128);
  g.fillStyle = 'rgba(255,120,40,0.18)';
  for (let i = 0; i < 9; i++) {
    g.beginPath();
    g.arc(64 + rand(-28, 28), 64 + rand(-28, 28), rand(1, 2.6), 0, TAU);
    g.fill();
  }
  scorchCanvas = c;
  return c;
}

export function drawGlow(ctx, color, x, y, size, alpha = 1, soft = false) {
  if (alpha <= 0.01) return;
  ctx.globalAlpha = alpha;
  ctx.drawImage(glowSprite(color, soft), x - size / 2, y - size / 2, size, size);
}

export class FX {
  constructor() {
    this.parts = [];
    this.texts = [];
    this.intensity = 1; // réglage qualité / densité
    this.scorches = [];
  }

  clear() {
    this.parts.length = 0;
    this.texts.length = 0;
    this.scorches.length = 0;
  }

  add(p) {
    if (this.parts.length >= MAX_PARTICLES) {
      this.parts[Math.floor(Math.random() * this.parts.length)] = p;
    } else this.parts.push(p);
    return p;
  }

  n(count) {
    return Math.max(1, Math.round(count * this.intensity));
  }

  // ---- presets -------------------------------------------------------------
  sparks(x, y, count, color, speed = 400, angle = null, spread = TAU, opts = {}) {
    for (let i = 0, c = this.n(count); i < c; i++) {
      const a = angle === null ? rand(TAU) : angle + rand(-spread / 2, spread / 2);
      const s = speed * rand(0.35, 1.15);
      const life = rand(0.18, 0.5) * (opts.life ?? 1);
      this.add({
        t: 'spark',
        x,
        y,
        vx: Math.cos(a) * s,
        vy: Math.sin(a) * s,
        life,
        max: life,
        color: chance(0.25) ? '#ffffff' : color,
        w: opts.width ?? rand(1.2, 2.6),
        len: opts.len ?? 0.035,
        drag: opts.drag ?? 3.5,
      });
    }
  }

  glow(x, y, size, color, life = 0.25, opts = {}) {
    return this.add({ t: 'glow', x, y, vx: opts.vx ?? 0, vy: opts.vy ?? 0, size, grow: opts.grow ?? 0, life, max: life, color, a: opts.alpha ?? 1, drag: opts.drag ?? 2, soft: opts.soft });
  }

  embers(x, y, count, color, speed = 160) {
    for (let i = 0, c = this.n(count); i < c; i++) {
      const a = rand(TAU);
      const s = speed * rand(0.2, 1);
      const life = rand(0.5, 1.4);
      this.add({ t: 'glow', x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s, size: rand(6, 14), grow: -4, life, max: life, color, a: 0.9, drag: 1.6, flicker: true });
    }
  }

  smoke(x, y, count, size = 26, speed = 60, color = '#1a1d2b') {
    for (let i = 0, c = this.n(count); i < c; i++) {
      const a = rand(TAU);
      const s = speed * rand(0.2, 1);
      const life = rand(0.6, 1.4);
      this.add({ t: 'smoke', x: x + rand(-6, 6), y: y + rand(-6, 6), vx: Math.cos(a) * s, vy: Math.sin(a) * s, size: size * rand(0.6, 1.2), grow: size * 0.9, life, max: life, color, a: rand(0.35, 0.6), drag: 1.8 });
    }
  }

  debris(x, y, count, color, speed = 380, size = 7) {
    for (let i = 0, c = this.n(count); i < c; i++) {
      const a = rand(TAU);
      const s = speed * rand(0.3, 1.1);
      const life = rand(0.7, 1.6);
      const k = rand(0.5, 1.3) * size;
      const pts = [];
      const sides = pick([3, 4, 4, 5]);
      for (let j = 0; j < sides; j++) {
        const aa = (j / sides) * TAU + rand(-0.3, 0.3);
        pts.push(Math.cos(aa) * k * rand(0.6, 1.2), Math.sin(aa) * k * rand(0.6, 1.2));
      }
      this.add({ t: 'debris', x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s, rot: rand(TAU), vr: rand(-14, 14), pts, life, max: life, color, drag: 2.6, trail: chance(0.4) });
    }
  }

  ring(x, y, r0, r1, dur, color, width = 4, opts = {}) {
    return this.add({ t: 'ring', x, y, r0, r1, life: dur, max: dur, color, w: width, fill: opts.fill ?? false });
  }

  muzzle(x, y, angle, color, size = 1) {
    this.glow(x, y, 46 * size, color, 0.07);
    this.sparks(x, y, 3 * size, color, 520, angle, 0.7, { life: 0.4 });
  }

  impact(x, y, angle, color, power = 1) {
    this.glow(x, y, 40 * power, color, 0.12);
    this.sparks(x, y, 6 * power, color, 380 * Math.min(power, 1.6), angle, 1.8);
  }

  explosion(x, y, size, color, opts = {}) {
    const s = size;
    this.glow(x, y, s * 7, '#ffffff', 0.09);
    this.glow(x, y, s * 5.5, color, 0.35, { grow: s * 2 });
    this.glow(x, y, s * 3, '#ffd9a0', 0.25, { soft: true });
    this.ring(x, y, s * 0.4, s * 3.2, 0.38, color, Math.max(2, s / 7));
    this.ring(x, y, s * 0.2, s * 2.1, 0.25, '#ffffff', 2);
    this.sparks(x, y, 10 + s * 0.7, color, 300 + s * 12, null, TAU, { len: 0.04 });
    this.sparks(x, y, 6 + s * 0.3, '#ffe2a8', 200 + s * 8);
    this.embers(x, y, 4 + s * 0.35, opts.emberColor ?? '#ff9a3d', 120 + s * 4);
    this.smoke(x, y, 3 + s * 0.15, s * 0.9, 40 + s * 2);
    if (opts.debris !== false) this.debris(x, y, Math.round(3 + s * 0.2), opts.debrisColor ?? color, 220 + s * 6, Math.max(4, s * 0.22));
    this.scorch(x, y, s * 1.6);
  }

  text(x, y, str, color, size = 22, opts = {}) {
    this.texts.push({ x, y, str, color, size, life: opts.life ?? 0.9, max: opts.life ?? 0.9, vy: opts.vy ?? -70, pop: 0 });
  }

  // trace de brûlure au sol (s'estompe lentement)
  scorch(x, y, r) {
    if (this.scorches.length >= 60) this.scorches.shift();
    this.scorches.push({ x, y, r, life: 14, max: 14, rot: rand(TAU) });
  }

  // ---- boucle ---------------------------------------------------------------
  update(dt) {
    const P = this.parts;
    for (let i = P.length - 1; i >= 0; i--) {
      const p = P[i];
      p.life -= dt;
      if (p.life <= 0) {
        P[i] = P[P.length - 1];
        P.pop();
        continue;
      }
      const d = Math.exp(-(p.drag ?? 0) * dt);
      if (p.vx !== undefined) {
        p.vx *= d;
        p.vy *= d;
        p.x += p.vx * dt;
        p.y += p.vy * dt;
      }
      if (p.t === 'debris') {
        p.rot += p.vr * dt;
        p.vr *= d;
        if (p.x < 0 || p.x > ARENA.w) p.vx *= -0.6;
        if (p.y < 0 || p.y > ARENA.h) p.vy *= -0.6;
        if (p.trail && Math.random() < 0.5) this.glow(p.x, p.y, 10, '#ff9a3d', 0.2, { alpha: 0.5 });
      } else if (p.t === 'glow' || p.t === 'smoke') {
        p.size = Math.max(0, p.size + p.grow * dt);
      }
    }
    for (let i = this.texts.length - 1; i >= 0; i--) {
      const t = this.texts[i];
      t.life -= dt;
      t.pop = Math.min(1, t.pop + dt * 8);
      t.y += t.vy * dt;
      t.vy *= Math.exp(-3 * dt);
      if (t.life <= 0) this.texts.splice(i, 1);
    }
    for (let i = this.scorches.length - 1; i >= 0; i--) {
      this.scorches[i].life -= dt;
      if (this.scorches[i].life <= 0) this.scorches.splice(i, 1);
    }
  }

  drawDecals(ctx) {
    const spr = scorchSprite();
    for (const d of this.scorches) {
      ctx.globalAlpha = Math.min(1, d.life / 3) * 0.9;
      ctx.drawImage(spr, d.x - d.r, d.y - d.r, d.r * 2, d.r * 2);
    }
    ctx.globalAlpha = 1;
  }

  // passe "normale" : fumée et débris
  drawBase(ctx) {
    for (const p of this.parts) {
      const k = p.life / p.max;
      if (p.t === 'smoke') {
        ctx.globalAlpha = p.a * k;
        ctx.fillStyle = p.color;
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.size, 0, TAU);
        ctx.fill();
      } else if (p.t === 'debris') {
        ctx.globalAlpha = Math.min(1, k * 2);
        ctx.save();
        ctx.translate(p.x, p.y);
        ctx.rotate(p.rot);
        ctx.beginPath();
        ctx.moveTo(p.pts[0], p.pts[1]);
        for (let j = 2; j < p.pts.length; j += 2) ctx.lineTo(p.pts[j], p.pts[j + 1]);
        ctx.closePath();
        ctx.fillStyle = '#121525';
        ctx.fill();
        ctx.strokeStyle = p.color;
        ctx.lineWidth = 1.6;
        ctx.stroke();
        ctx.restore();
      }
    }
    ctx.globalAlpha = 1;
  }

  // passe additive : tout ce qui brille
  drawGlow(ctx) {
    ctx.globalCompositeOperation = 'lighter';
    ctx.lineCap = 'round';
    for (const p of this.parts) {
      const k = p.life / p.max;
      if (p.t === 'spark') {
        ctx.globalAlpha = Math.min(1, k * 1.6);
        ctx.strokeStyle = p.color;
        ctx.lineWidth = p.w;
        ctx.beginPath();
        ctx.moveTo(p.x, p.y);
        ctx.lineTo(p.x - p.vx * p.len, p.y - p.vy * p.len);
        ctx.stroke();
      } else if (p.t === 'glow') {
        let a = p.a * k;
        if (p.flicker) a *= 0.6 + Math.random() * 0.4;
        drawGlow(ctx, p.color, p.x, p.y, p.size, a, p.soft);
      } else if (p.t === 'ring') {
        const e = 1 - k ** 3; // easeOut
        const r = p.r0 + (p.r1 - p.r0) * e;
        ctx.globalAlpha = k * 0.9;
        ctx.strokeStyle = p.color;
        ctx.lineWidth = p.w * (0.4 + k);
        ctx.beginPath();
        ctx.arc(p.x, p.y, Math.max(0.1, r), 0, TAU);
        ctx.stroke();
        if (p.fill) {
          ctx.globalAlpha = k * 0.12 * e;
          ctx.fillStyle = p.color;
          ctx.fill();
        }
      }
    }
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';
  }

  drawTexts(ctx) {
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    for (const t of this.texts) {
      const k = t.life / t.max;
      const scale = 0.6 + 0.6 * Math.sin(t.pop * Math.PI * 0.5) - (t.pop >= 1 ? 0.2 : 0);
      ctx.globalAlpha = Math.min(1, k * 2.5);
      ctx.font = `800 ${Math.round(t.size * scale)}px Orbitron, sans-serif`;
      ctx.lineWidth = 4;
      ctx.strokeStyle = 'rgba(0,0,0,0.7)';
      ctx.strokeText(t.str, t.x, t.y);
      ctx.fillStyle = t.color;
      ctx.fillText(t.str, t.x, t.y);
    }
    ctx.globalAlpha = 1;
  }
}
