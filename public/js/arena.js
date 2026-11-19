// Arène : obstacles, collisions, ligne de vue et champ de navigation pour l'IA.
import { ARENA } from './config.js';
import { circleRect, rayRect, pick, pointInRect, rgba } from './utils.js';

const W = ARENA.w;
const H = ARENA.h;
const C = (cx, cy, w, h) => ({ x: cx - w / 2, y: cy - h / 2, w, h });

// Dispositions symétriques (équitables en duel)
export const LAYOUTS = [
  {
    name: 'Quatre Piliers',
    rects: [C(480, 290, 90, 90), C(1120, 290, 90, 90), C(480, 610, 90, 90), C(1120, 610, 90, 90)],
  },
  {
    name: 'Le Noyau',
    rects: [C(800, 450, 120, 120), C(380, 200, 160, 36), C(1220, 700, 160, 36), C(380, 700, 160, 36), C(1220, 200, 160, 36)],
  },
  {
    name: 'Couloirs',
    rects: [C(560, 250, 40, 230), C(1040, 650, 40, 230), C(1040, 250, 40, 230), C(560, 650, 40, 230), C(800, 450, 70, 70)],
  },
  {
    name: 'Croix',
    rects: [C(800, 260, 46, 170), C(800, 640, 46, 170), C(560, 450, 170, 46), C(1040, 450, 170, 46)],
  },
  {
    name: 'Bastions',
    rects: [C(330, 450, 46, 260), C(1270, 450, 46, 260), C(800, 200, 220, 40), C(800, 700, 220, 40)],
  },
];

export class Arena {
  constructor(layout = pick(LAYOUTS)) {
    this.layout = layout;
    this.rects = layout.rects;
    this.cell = 40;
    this.fcols = Math.ceil(W / this.cell);
    this.frows = Math.ceil(H / this.cell);
    this.blocked = new Uint8Array(this.fcols * this.frows);
    this.flows = new Map();
    this.queue = new Int32Array(this.fcols * this.frows);
    for (let r = 0; r < this.frows; r++) {
      for (let c = 0; c < this.fcols; c++) {
        const x = (c + 0.5) * this.cell;
        const y = (r + 0.5) * this.cell;
        this.blocked[r * this.fcols + c] = this.rects.some((rc) => pointInRect(x, y, rc, 24)) ? 1 : 0;
      }
    }
    this.sprites = null;
  }

  // Résout la collision d'un corps circulaire avec murs + obstacles. Renvoie true si contact.
  collideBody(b) {
    let hit = false;
    const r = b.r;
    if (b.x < r) {
      b.x = r;
      if (b.vx < 0) b.vx *= -0.2;
      hit = true;
    } else if (b.x > W - r) {
      b.x = W - r;
      if (b.vx > 0) b.vx *= -0.2;
      hit = true;
    }
    if (b.y < r) {
      b.y = r;
      if (b.vy < 0) b.vy *= -0.2;
      hit = true;
    } else if (b.y > H - r) {
      b.y = H - r;
      if (b.vy > 0) b.vy *= -0.2;
      hit = true;
    }
    for (const rc of this.rects) {
      const res = circleRect(b.x, b.y, r, rc);
      if (!res) continue;
      const [nx, ny, depth] = res;
      b.x += nx * depth;
      b.y += ny * depth;
      const vn = b.vx * nx + b.vy * ny;
      if (vn < 0) {
        b.vx -= vn * nx * 1.2;
        b.vy -= vn * ny * 1.2;
      }
      hit = true;
    }
    return hit;
  }

  // Un point (projectile) est-il dans un obstacle ou hors arène ?
  solidAt(x, y, pad = 0) {
    if (x < pad || y < pad || x > W - pad || y > H - pad) return 'wall';
    for (const rc of this.rects) if (pointInRect(x, y, rc, pad)) return rc;
    return null;
  }

  // Distance jusqu'au premier obstacle/mur le long d'un rayon
  raycast(ox, oy, dx, dy, maxDist = 4000) {
    let t = maxDist;
    if (dx > 1e-9) t = Math.min(t, (W - ox) / dx);
    else if (dx < -1e-9) t = Math.min(t, -ox / dx);
    if (dy > 1e-9) t = Math.min(t, (H - oy) / dy);
    else if (dy < -1e-9) t = Math.min(t, -oy / dy);
    for (const rc of this.rects) t = Math.min(t, rayRect(ox, oy, dx, dy, rc));
    return Math.max(0, t);
  }

  lineOfSight(ax, ay, bx, by, pad = 0) {
    const dx = bx - ax;
    const dy = by - ay;
    const d = Math.hypot(dx, dy);
    if (d < 1) return true;
    for (const rc of this.rects) {
      const grown = pad ? { x: rc.x - pad, y: rc.y - pad, w: rc.w + pad * 2, h: rc.h + pad * 2 } : rc;
      if (rayRect(ax, ay, dx / d, dy / d, grown) < d) return false;
    }
    return true;
  }

  // Trouve un point libre (loin des obstacles et éventuellement loin d'un point)
  freeSpot(margin = 60, avoid = null, minDist = 0) {
    for (let i = 0; i < 80; i++) {
      const x = margin + Math.random() * (W - margin * 2);
      const y = margin + Math.random() * (H - margin * 2);
      if (this.rects.some((rc) => pointInRect(x, y, rc, 50))) continue;
      if (avoid && avoid.some((p) => Math.hypot(p.x - x, p.y - y) < minDist)) continue;
      return { x, y };
    }
    return { x: W / 2, y: H / 2 };
  }

  // Point libre le plus proche (recherche en spirale)
  nearestFree(x, y, clearance = 40) {
    for (let r = 0; r < 600; r += 20) {
      const steps = Math.max(1, Math.round((r * Math.PI * 2) / 20));
      for (let i = 0; i < steps; i++) {
        const a = (i / steps) * Math.PI * 2 + Math.PI;
        const px = x + Math.cos(a) * r;
        const py = y + Math.sin(a) * r;
        if (!this.solidAt(px, py, clearance)) return { x: px, y: py };
      }
    }
    return { x, y };
  }

  // Champ de distance BFS vers la cible : les ennemis descendent le gradient.
  // Un champ par clé (ex. un par bot en duel), recalculé 4 fois par seconde.
  updateFlow(target, dt, key = 'default') {
    let f = this.flows.get(key);
    if (!f) {
      f = { flow: new Float32Array(this.fcols * this.frows), timer: 0 };
      this.flows.set(key, f);
    }
    f.timer -= dt;
    if (f.timer > 0) return;
    f.timer = 0.25;
    const { fcols, frows, blocked } = this;
    const flow = f.flow;
    flow.fill(Infinity);
    const queue = this.queue;
    let head = 0;
    let tail = 0;
    const tc = Math.min(fcols - 1, Math.max(0, Math.floor(target.x / this.cell)));
    const tr = Math.min(frows - 1, Math.max(0, Math.floor(target.y / this.cell)));
    const start = tr * fcols + tc;
    flow[start] = 0;
    queue[tail++] = start;
    while (head < tail) {
      const i = queue[head++];
      const c = i % fcols;
      const d = flow[i] + 1;
      if (c > 0) tail = this.visit(flow, queue, tail, i - 1, d, blocked);
      if (c < fcols - 1) tail = this.visit(flow, queue, tail, i + 1, d, blocked);
      if (i >= fcols) tail = this.visit(flow, queue, tail, i - fcols, d, blocked);
      if (i < fcols * (frows - 1)) tail = this.visit(flow, queue, tail, i + fcols, d, blocked);
    }
  }

  visit(flow, queue, tail, j, d, blocked) {
    if (blocked[j] || flow[j] <= d) return tail;
    flow[j] = d;
    queue[tail] = j;
    return tail + 1;
  }

  // Direction (normalisée) à suivre depuis (x, y) pour rejoindre la cible du flow field
  flowDir(x, y, key = 'default') {
    const f = this.flows.get(key);
    if (!f) return null;
    const { fcols, frows, cell } = this;
    const flow = f.flow;
    const c = Math.min(fcols - 1, Math.max(0, Math.floor(x / cell)));
    const r = Math.min(frows - 1, Math.max(0, Math.floor(y / cell)));
    let best = flow[r * fcols + c];
    let bx = 0;
    let by = 0;
    for (let dr = -1; dr <= 1; dr++) {
      for (let dc = -1; dc <= 1; dc++) {
        if (!dr && !dc) continue;
        const cc = c + dc;
        const rr = r + dr;
        if (cc < 0 || rr < 0 || cc >= fcols || rr >= frows) continue;
        // pas de coupe de coin en diagonale
        if (dr && dc && (this.blocked[r * fcols + cc] || this.blocked[rr * fcols + c])) continue;
        const v = flow[rr * fcols + cc] + (dr && dc ? 0.41 : 0);
        if (v < best) {
          best = v;
          bx = (cc + 0.5) * cell - x;
          by = (rr + 0.5) * cell - y;
        }
      }
    }
    const l = Math.hypot(bx, by);
    return l > 0 ? [bx / l, by / l] : null;
  }

  // Pré-rendu de chaque obstacle (petit sprite avec glow) : bien moins coûteux qu'un calque plein écran
  buildStatic(scale, color) {
    const pad = 34;
    this.wallColor = color;
    this.sprites = this.rects.map((rc) => {
      const cv = document.createElement('canvas');
      cv.width = Math.ceil((rc.w + pad * 2) * scale);
      cv.height = Math.ceil((rc.h + pad * 2) * scale);
      const g = cv.getContext('2d');
      g.scale(scale, scale);
      g.translate(pad - rc.x, pad - rc.y);
      g.save();
      g.fillStyle = '#090b18';
      g.shadowColor = color;
      g.shadowBlur = 30;
      g.fillRect(rc.x, rc.y, rc.w, rc.h);
      g.shadowBlur = 0;
      const grad = g.createLinearGradient(rc.x, rc.y, rc.x + rc.w, rc.y + rc.h);
      grad.addColorStop(0, '#151a33');
      grad.addColorStop(1, '#0a0c1a');
      g.fillStyle = grad;
      g.fillRect(rc.x + 5, rc.y + 5, rc.w - 10, rc.h - 10);
      // hachures
      g.beginPath();
      g.rect(rc.x + 5, rc.y + 5, rc.w - 10, rc.h - 10);
      g.clip();
      g.strokeStyle = rgba(color, 0.08);
      g.lineWidth = 6;
      for (let s = -rc.h; s < rc.w + rc.h; s += 22) {
        g.beginPath();
        g.moveTo(rc.x + s, rc.y);
        g.lineTo(rc.x + s + rc.h, rc.y + rc.h);
        g.stroke();
      }
      g.restore();
      g.shadowColor = color;
      g.shadowBlur = 14;
      g.strokeStyle = color;
      g.lineWidth = 2.5;
      g.strokeRect(rc.x + 1, rc.y + 1, rc.w - 2, rc.h - 2);
      g.shadowBlur = 0;
      g.strokeStyle = 'rgba(255,255,255,0.55)';
      g.lineWidth = 1;
      g.strokeRect(rc.x + 5, rc.y + 5, rc.w - 10, rc.h - 10);
      return { cv, x: rc.x - pad, y: rc.y - pad, w: rc.w + pad * 2, h: rc.h + pad * 2 };
    });
  }

  drawStatic(ctx) {
    const color = this.wallColor || '#2de2ff';
    // bordure de l'arène : traits superposés en mode additif pour le glow
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    ctx.strokeStyle = color;
    for (const [w, a] of [
      [14, 0.06],
      [7, 0.14],
      [3, 0.9],
    ]) {
      ctx.globalAlpha = a;
      ctx.lineWidth = w;
      ctx.strokeRect(1.5, 1.5, W - 3, H - 3);
    }
    ctx.globalAlpha = 0.3;
    ctx.lineWidth = 1;
    ctx.strokeRect(10, 10, W - 20, H - 20);
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 3;
    const k = 46;
    ctx.beginPath();
    for (const [x, y, sx, sy] of [
      [0, 0, 1, 1],
      [W, 0, -1, 1],
      [0, H, 1, -1],
      [W, H, -1, -1],
    ]) {
      ctx.moveTo(x + sx * 4, y + sy * k);
      ctx.lineTo(x + sx * 4, y + sy * 4);
      ctx.lineTo(x + sx * k, y + sy * 4);
    }
    ctx.stroke();
    ctx.restore();
    if (this.sprites) for (const s of this.sprites) ctx.drawImage(s.cv, s.x, s.y, s.w, s.h);
  }

}
