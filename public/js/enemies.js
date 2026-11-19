// Ennemis du mode arcade + boss OVERLORD.
import { ENEMIES } from './config.js';
import { drawGlow } from './fx.js';
import { TAU, chance, damp, dist, rand, rotateTowards, segPointDist2 } from './utils.js';

const WARP_TIME = 0.85;

export class Enemy {
  constructor(game, type, x, y, wave) {
    this.game = game;
    this.type = type;
    this.cfg = ENEMIES[type];
    this.kind = 'enemy';
    this.team = 'enemy';
    this.color = this.cfg.color;
    this.x = x;
    this.y = y;
    this.vx = 0;
    this.vy = 0;
    this.r = this.cfg.radius;
    this.mass = this.cfg.mass;
    const lvl = wave - 1;
    this.hpMul = 1 + 0.09 * lvl;
    this.dmgMul = 1 + 0.045 * lvl;
    this.spdMul = 1 + Math.min(0.3, 0.015 * lvl);
    this.bossLevel = Math.max(1, Math.floor(wave / 5));
    this.maxHp = type === 'boss' ? this.cfg.hp * (1 + 0.6 * (this.bossLevel - 1)) : this.cfg.hp * this.hpMul;
    this.hp = this.maxHp;
    this.points = type === 'boss' ? this.cfg.points * this.bossLevel : this.cfg.points;
    this.alive = true;
    this.angle = rand(TAU);
    this.aim = this.angle;
    this.t = rand(10);
    this.flash = 0;
    this.warp = type === 'boss' ? 2.2 : WARP_TIME;
    this.warpTotal = this.warp;
    this.state = 'idle';
    this.stateT = rand(0.5, 1.5);
    this.fireCd = rand(0.8, 1.6);
    this.strafe = chance(0.5) ? 1 : -1;
    this.burst = 0;
    this.goal = null;
    this.invuln = 0;
    this.stunned = 0;
    // boss
    this.pattern = null;
    this.patternT = 0;
    this.patternIdx = 0;
    this.spin = 0;
    this.laser = null;
  }

  get active() {
    return this.warp <= 0;
  }

  update(dt) {
    const g = this.game;
    this.t += dt;
    this.flash = Math.max(0, this.flash - dt * 6);
    this.stunned = Math.max(0, this.stunned - dt);
    if (this.warp > 0) {
      this.warp -= dt;
      if (Math.random() < 0.5) {
        const a = rand(TAU);
        const rr = this.r * 3.5 * (this.warp / this.warpTotal) + this.r;
        g.fx.add({ t: 'spark', x: this.x + Math.cos(a) * rr, y: this.y + Math.sin(a) * rr, vx: -Math.cos(a) * 200, vy: -Math.sin(a) * 200, life: 0.15, max: 0.15, color: this.color, w: 1.5, len: 0.04, drag: 0 });
      }
      if (this.warp <= 0) {
        const s = this.type === 'boss' ? 4 : 1;
        g.fx.glow(this.x, this.y, this.r * 8, '#ffffff', 0.15);
        g.fx.ring(this.x, this.y, this.r * 0.5, this.r * 3.5, 0.35, this.color, 3 * s);
        g.fx.sparks(this.x, this.y, 14 * s, this.color, 320 * s);
        g.grid.impulse(this.x, this.y, 140 * s, -18 * s);
        if (this.type === 'boss') {
          g.addShake(0.8);
          g.flashScreen(this.color, 0.35);
          g.sfx('explodeBig', { x: this.x });
        }
      }
      return;
    }

    const target = g.nearestPlayer(this.x, this.y);
    if (!target) {
      this.vx = damp(this.vx, 0, 4, dt);
      this.vy = damp(this.vy, 0, 4, dt);
    } else {
      const fn = BEHAVIOURS[this.type];
      fn(this, g, target, dt);
    }
    this.x += this.vx * dt;
    this.y += this.vy * dt;
    g.arena.collideBody(this);
  }

  // Déplacement lissé vers une vitesse souhaitée
  steer(dx, dy, speed, dt, accel = 6) {
    const sp = speed * this.spdMul * (this.stunned > 0 ? 0.3 : 1);
    const k = 1 - Math.exp(-accel * dt);
    this.vx += (dx * sp - this.vx) * k;
    this.vy += (dy * sp - this.vy) * k;
  }

  // Direction vers la cible : directe si ligne de vue, sinon champ de navigation
  pathTo(g, target) {
    if (g.arena.lineOfSight(this.x, this.y, target.x, target.y, this.r * 0.8)) {
      const d = dist(this.x, this.y, target.x, target.y) || 1;
      return [(target.x - this.x) / d, (target.y - this.y) / d];
    }
    return g.arena.flowDir(this.x, this.y) || [0, 0];
  }

  shootOrb(angle, speed, damage, opts = {}) {
    const g = this.game;
    const off = opts.offset ?? this.r + 6;
    g.spawnBullet({
      x: this.x + Math.cos(angle) * off,
      y: this.y + Math.sin(angle) * off,
      vx: Math.cos(angle) * speed,
      vy: Math.sin(angle) * speed,
      r: opts.r ?? 6,
      damage: damage * this.dmgMul,
      team: 'enemy',
      owner: this,
      life: opts.life ?? 4,
      color: opts.color ?? this.color,
      knock: opts.knock ?? 90,
      kind: opts.kind ?? 'orb',
    });
  }

  draw(ctx) {
    const g = this.game;
    const c = this.color;
    if (this.warp > 0) {
      const k = 1 - this.warp / this.warpTotal;
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      ctx.strokeStyle = c;
      ctx.lineWidth = 2;
      ctx.globalAlpha = 0.3 + k * 0.6;
      const rr = this.r * (1 + 3 * (1 - k));
      ctx.beginPath();
      ctx.arc(this.x, this.y, rr, 0, TAU);
      ctx.stroke();
      ctx.setLineDash([6, 8]);
      ctx.lineDashOffset = this.t * 40;
      ctx.beginPath();
      ctx.arc(this.x, this.y, rr * 1.4, 0, TAU);
      ctx.stroke();
      ctx.setLineDash([]);
      drawGlow(ctx, c, this.x, this.y, this.r * 4 * k, 0.6 * k);
      // croix de visée au sol
      ctx.globalAlpha = 0.5;
      ctx.beginPath();
      ctx.moveTo(this.x - rr * 1.6, this.y);
      ctx.lineTo(this.x - rr * 1.1, this.y);
      ctx.moveTo(this.x + rr * 1.1, this.y);
      ctx.lineTo(this.x + rr * 1.6, this.y);
      ctx.moveTo(this.x, this.y - rr * 1.6);
      ctx.lineTo(this.x, this.y - rr * 1.1);
      ctx.moveTo(this.x, this.y + rr * 1.1);
      ctx.lineTo(this.x, this.y + rr * 1.6);
      ctx.stroke();
      ctx.restore();
      return;
    }

    // ombre + halo
    ctx.fillStyle = 'rgba(0,0,0,0.45)';
    ctx.beginPath();
    ctx.ellipse(this.x + 5, this.y + 9, this.r * 1.1, this.r * 0.8, 0, 0, TAU);
    ctx.fill();
    ctx.globalCompositeOperation = 'lighter';
    drawGlow(ctx, c, this.x, this.y, this.r * 5.5, 0.22, true);
    ctx.globalCompositeOperation = 'source-over';
    ctx.globalAlpha = 1;

    // télégraphes
    if (this.type === 'lancer' && this.state === 'charge') {
      const k = 1 - this.stateT / 0.95;
      const len = g.arena.raycast(this.x, this.y, Math.cos(this.aim), Math.sin(this.aim));
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      ctx.strokeStyle = this.stateT < 0.25 ? '#ffffff' : c;
      ctx.globalAlpha = 0.25 + k * 0.6;
      ctx.lineWidth = 1 + k * 2.5;
      ctx.beginPath();
      ctx.moveTo(this.x, this.y);
      ctx.lineTo(this.x + Math.cos(this.aim) * len, this.y + Math.sin(this.aim) * len);
      ctx.stroke();
      ctx.restore();
    }
    if (this.type === 'brute' && this.state === 'windup') {
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      ctx.fillStyle = c;
      ctx.globalAlpha = 0.18 + Math.sin(this.t * 30) * 0.06;
      const len = 380;
      const w = this.r * 2;
      ctx.translate(this.x, this.y);
      ctx.rotate(this.aim);
      ctx.fillRect(0, -w / 2, len, w);
      ctx.restore();
    }
    if (this.type === 'boss' && this.laser) drawBossLaser(ctx, this, g);

    ctx.save();
    ctx.translate(this.x, this.y);
    ctx.lineJoin = 'round';
    ctx.fillStyle = '#100a14';
    ctx.strokeStyle = c;
    ctx.lineWidth = 2.4;
    const r = this.r;
    DRAW[this.type](ctx, this, r);
    if (this.flash > 0) {
      ctx.globalCompositeOperation = 'lighter';
      drawGlow(ctx, '#ffffff', 0, 0, r * 4, this.flash * 0.8);
      ctx.globalCompositeOperation = 'source-over';
      ctx.globalAlpha = this.flash * 0.7;
      ctx.fillStyle = '#ffffff';
      ctx.beginPath();
      ctx.arc(0, 0, r * 0.9, 0, TAU);
      ctx.fill();
      ctx.globalAlpha = 1;
    }
    ctx.restore();

    // barre de vie (si blessé, hors boss qui a sa barre dans le HUD)
    if (this.type !== 'boss' && this.hp < this.maxHp) {
      const w = r * 2;
      ctx.fillStyle = 'rgba(0,0,0,0.6)';
      ctx.fillRect(this.x - w / 2 - 1, this.y - r - 13, w + 2, 5);
      ctx.fillStyle = c;
      ctx.fillRect(this.x - w / 2, this.y - r - 12, (w * this.hp) / this.maxHp, 3);
    }
  }
}

// ---- Comportements --------------------------------------------------------------
const BEHAVIOURS = {
  scarab(e, g, target, dt) {
    const [dx, dy] = e.pathTo(g, target);
    const wob = Math.sin(e.t * 7) * 0.35;
    const c = Math.cos(wob);
    const s = Math.sin(wob);
    e.steer(dx * c - dy * s, dx * s + dy * c, e.cfg.speed, dt, 5);
    e.angle += dt * 9;
    const d = dist(e.x, e.y, target.x, target.y);
    if (d < 170 && e.state !== 'armed') {
      e.state = 'armed';
      g.sfx('kamikaze', { x: e.x });
    }
    if (d < e.r + target.r + 4) {
      g.explode(e.x, e.y, 75, e.cfg.contactDamage * e.dmgMul, 'enemy', e, { size: 16, color: e.color });
      g.killEnemy(e, null, true);
    }
  },

  gunner(e, g, target, dt) {
    const d = dist(e.x, e.y, target.x, target.y);
    const los = g.arena.lineOfSight(e.x, e.y, target.x, target.y, 4);
    const toX = (target.x - e.x) / (d || 1);
    const toY = (target.y - e.y) / (d || 1);
    e.stateT -= dt;
    if (e.stateT <= 0) {
      e.strafe = -e.strafe;
      e.stateT = rand(1.4, 2.8);
    }
    let mx;
    let my;
    if (!los || d > 440) [mx, my] = e.pathTo(g, target);
    else if (d < 250) [mx, my] = [-toX * 0.9 - toY * e.strafe * 0.4, -toY * 0.9 + toX * e.strafe * 0.4];
    else [mx, my] = [-toY * e.strafe, toX * e.strafe];
    e.steer(mx, my, e.cfg.speed, dt, 4);
    e.aim = rotateTowards(e.aim, Math.atan2(toY, toX), 5 * dt);
    e.angle = e.aim;
    e.fireCd -= dt;
    if (e.burst > 0) {
      e.burstT -= dt;
      if (e.burstT <= 0) {
        e.burst--;
        e.burstT = 0.13;
        e.shootOrb(e.aim + rand(-0.06, 0.06), 380 + g.wave * 6, e.cfg.damage);
        g.sfx('enemyShot', { x: e.x });
        g.fx.muzzle(e.x + Math.cos(e.aim) * (e.r + 6), e.y + Math.sin(e.aim) * (e.r + 6), e.aim, e.color, 0.8);
      }
    } else if (e.fireCd <= 0 && los && d < 650) {
      e.burst = 3;
      e.burstT = 0;
      e.fireCd = rand(1.6, 2.3);
    }
  },

  lancer(e, g, target, dt) {
    const d = dist(e.x, e.y, target.x, target.y);
    e.stateT -= dt;
    if (e.state === 'idle' || e.state === 'move') {
      if (!e.goal || e.stateT <= 0 || dist(e.x, e.y, e.goal.x, e.goal.y) < 20) {
        if (e.goal && e.state === 'move' && g.arena.lineOfSight(e.x, e.y, target.x, target.y, 4) && d < 900) {
          e.state = 'charge';
          e.stateT = 0.95;
          e.goal = null;
          g.sfx('lancerCharge', { x: e.x });
          return;
        }
        // nouvelle position de tir, à distance respectable
        let best = null;
        for (let i = 0; i < 12; i++) {
          const a = rand(TAU);
          const rr = rand(380, 620);
          const p = { x: target.x + Math.cos(a) * rr, y: target.y + Math.sin(a) * rr };
          if (g.arena.solidAt(p.x, p.y, 40)) continue;
          if (!g.arena.lineOfSight(p.x, p.y, target.x, target.y, 4)) continue;
          best = p;
          break;
        }
        e.goal = best || g.arena.freeSpot(60);
        e.state = 'move';
        e.stateT = rand(1.4, 2.4);
      }
      const [dx, dy] = e.pathTo(g, e.goal);
      e.steer(dx, dy, e.cfg.speed * 1.4, dt, 4);
      e.aim = rotateTowards(e.aim, Math.atan2(target.y - e.y, target.x - e.x), 4 * dt);
    } else if (e.state === 'charge') {
      e.steer(0, 0, 0, dt, 8);
      // suit la cible puis verrouille la visée juste avant le tir
      if (e.stateT > 0.25) e.aim = rotateTowards(e.aim, Math.atan2(target.y - e.y, target.x - e.x), 2.6 * dt);
      if (e.stateT <= 0) {
        e.shootOrb(e.aim, 1350, e.cfg.damage, { r: 5, kind: 'bolt', color: '#e6b3ff', knock: 220, life: 1.5 });
        g.sfx('lancerShot', { x: e.x });
        g.fx.muzzle(e.x + Math.cos(e.aim) * (e.r + 8), e.y + Math.sin(e.aim) * (e.r + 8), e.aim, e.color, 1.6);
        e.vx -= Math.cos(e.aim) * 200;
        e.vy -= Math.sin(e.aim) * 200;
        e.state = 'idle';
        e.stateT = rand(0.6, 1.2);
        e.goal = null;
      }
    }
    e.angle = e.aim;
  },

  brute(e, g, target, dt) {
    const d = dist(e.x, e.y, target.x, target.y);
    const los = g.arena.lineOfSight(e.x, e.y, target.x, target.y, 8);
    e.stateT -= dt;
    e.fireCd -= dt;
    const toA = Math.atan2(target.y - e.y, target.x - e.x);
    if (e.state === 'windup') {
      e.steer(0, 0, 0, dt, 10);
      e.aim = rotateTowards(e.aim, toA, 1.5 * dt);
      if (e.stateT <= 0) {
        e.state = 'charge';
        e.stateT = 0.55;
        g.sfx('dash', { x: e.x });
      }
    } else if (e.state === 'charge') {
      e.vx = Math.cos(e.aim) * 640;
      e.vy = Math.sin(e.aim) * 640;
      if (Math.random() < 0.7) g.fx.glow(e.x, e.y, e.r * 2.2, e.color, 0.25, { alpha: 0.5 });
      if (d < e.r + target.r + 6 && target.invuln <= 0) {
        g.damage(target, 26 * e.dmgMul, e, { kx: Math.cos(e.aim) * 900, ky: Math.sin(e.aim) * 900 });
        e.state = 'idle';
        e.stateT = 1.4;
      }
      if (e.stateT <= 0) {
        e.state = 'idle';
        e.stateT = rand(1.8, 3);
      }
    } else {
      const [dx, dy] = e.pathTo(g, target);
      e.steer(dx, dy, e.cfg.speed, dt, 3);
      e.aim = rotateTowards(e.aim, toA, 3 * dt);
      if (los && d < 340 && e.fireCd <= 0) {
        e.fireCd = rand(2, 2.6);
        for (let i = 0; i < 7; i++) e.shootOrb(e.aim - 0.45 + (0.9 * i) / 6, 300 + g.wave * 4, e.cfg.damage, { r: 7 });
        g.sfx('scatter', { x: e.x, vol: 0.7 });
        g.addShake(0.15);
      } else if (los && d > 220 && d < 480 && e.stateT <= 0 && chance(0.6 * dt * 5)) {
        e.state = 'windup';
        e.stateT = 0.65;
      }
    }
    e.angle = rotateTowards(e.angle, e.aim, 4 * dt);
  },

  boss(e, g, target, dt) {
    const toA = Math.atan2(target.y - e.y, target.x - e.x);
    const d = dist(e.x, e.y, target.x, target.y);
    const phase2 = e.hp < e.maxHp * 0.5;
    e.spin += dt * (phase2 ? 1.4 : 0.9);
    e.aim = rotateTowards(e.aim, toA, 2 * dt);
    // flotte en gardant ses distances
    const want = 360;
    const [px, py] = d > want + 80 ? e.pathTo(g, target) : d < want - 80 ? [-(target.x - e.x) / d, -(target.y - e.y) / d] : [Math.cos(e.t * 0.6), Math.sin(e.t * 0.8)];
    e.steer(px, py, e.cfg.speed * (e.laser ? 0.2 : 1), dt, 1.5);

    if (!e.pattern) {
      e.rest = (e.rest ?? 0.8) - dt;
      if (e.rest > 0) return;
      e.rest = phase2 ? 0.6 : 1.1;
      const pool = phase2 ? ['spiral', 'fan', 'ring', 'laser', 'summon', 'laser'] : ['spiral', 'fan', 'ring', 'summon'];
      let p = pool[e.patternIdx++ % pool.length];
      if (chance(0.3)) p = pool[Math.floor(rand(pool.length))];
      e.pattern = p;
      e.patternT = 0;
      e.fireCd = 0;
      e.count = 0;
      if (p === 'laser') {
        const sgn = chance(0.5) ? 1 : -1;
        e.laser = { a: toA - sgn, sweep: 2 * sgn, t: 0, warn: 1, dur: 2.2, tick: 0 };
        g.sfx('railCharge', { x: e.x });
      }
    }
    e.patternT += dt;
    e.fireCd -= dt;
    const spd = phase2 ? 1.2 : 1;
    switch (e.pattern) {
      case 'spiral':
        if (e.fireCd <= 0) {
          e.fireCd = 0.13 / spd;
          const arms = phase2 ? 4 : 3;
          for (let i = 0; i < arms; i++) e.shootOrb(e.spin * 2.2 + (i / arms) * TAU, 230, e.cfg.damage, { offset: e.r, r: 7, color: '#ff5fa0' });
          g.sfx('enemyShot', { x: e.x, pitch: 0.7 });
        }
        if (e.patternT > 3.2) e.pattern = null;
        break;
      case 'fan':
        if (e.fireCd <= 0 && e.count < 3) {
          e.fireCd = 0.6 / spd;
          e.count++;
          const n = phase2 ? 13 : 9;
          for (let i = 0; i < n; i++) e.shootOrb(toA - 0.7 + (1.4 * i) / (n - 1), 330, e.cfg.damage, { offset: e.r, r: 8, color: '#ffb03d' });
          g.sfx('scatter', { x: e.x, vol: 0.6 });
          g.addShake(0.15);
        }
        if (e.patternT > 2.2) e.pattern = null;
        break;
      case 'ring':
        if (e.fireCd <= 0 && e.count < 3) {
          e.fireCd = 0.7 / spd;
          const n = 26;
          const off = e.count * 0.12;
          e.count++;
          for (let i = 0; i < n; i++) e.shootOrb((i / n) * TAU + off, 260, e.cfg.damage, { offset: e.r, r: 7, color: '#ff2e6a' });
          g.fx.ring(e.x, e.y, e.r, e.r * 2.5, 0.3, e.color, 4);
          g.sfx('enemyShot', { x: e.x, pitch: 0.5, vol: 1.5 });
        }
        if (e.patternT > 2.6) e.pattern = null;
        break;
      case 'summon':
        if (e.patternT > 0.3 && e.count === 0) {
          e.count = 1;
          const n = 2 + e.bossLevel;
          for (let i = 0; i < n; i++) {
            const a = (i / n) * TAU + rand(0.5);
            g.spawnEnemy('scarab', e.x + Math.cos(a) * (e.r + 80), e.y + Math.sin(a) * (e.r + 80));
          }
          g.fx.ring(e.x, e.y, e.r, e.r * 4, 0.5, e.color, 5);
        }
        if (e.patternT > 1.6) e.pattern = null;
        break;
      case 'laser': {
        const L = e.laser;
        L.t += dt;
        if (L.t > L.warn) {
          const k = Math.min(1, (L.t - L.warn) / L.dur);
          L.cur = L.a + L.sweep * k;
          L.tick -= dt;
          const cx = Math.cos(L.cur);
          const cy = Math.sin(L.cur);
          L.len = g.arena.raycast(e.x, e.y, cx, cy);
          if (Math.random() < 0.8) g.fx.sparks(e.x + cx * L.len, e.y + cy * L.len, 2, '#ff9ac0', 300);
          if (L.tick <= 0) {
            for (const p of g.players) {
              if (!p.alive) continue;
              const [, d2] = segPointDist2(e.x, e.y, e.x + cx * L.len, e.y + cy * L.len, p.x, p.y);
              if (d2 < (p.r + 14) ** 2) {
                g.damage(p, 9 * e.dmgMul, e, { kx: -cy * 250 * Math.sign(L.sweep), ky: cx * 250 * Math.sign(L.sweep) });
                L.tick = 0.1;
              }
            }
          }
          if (!L.fired) {
            L.fired = true;
            g.sfx('railFire', { x: e.x, vol: 0.8 });
            g.addShake(0.5);
          }
          g.addShake(0.04);
        } else {
          L.cur = L.a;
          L.len = g.arena.raycast(e.x, e.y, Math.cos(L.a), Math.sin(L.a));
        }
        if (L.t > L.warn + L.dur) {
          e.laser = null;
          e.pattern = null;
        }
        break;
      }
      default:
        e.pattern = null;
    }
    e.angle = e.spin;
  },
};

function drawBossLaser(ctx, e, g) {
  const L = e.laser;
  const a = L.cur ?? L.a;
  const len = L.len ?? 800;
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  ctx.translate(e.x, e.y);
  ctx.rotate(a);
  if (L.t <= L.warn) {
    ctx.strokeStyle = '#ff5fa0';
    ctx.globalAlpha = 0.3 + Math.sin(g.time * 40) * 0.2;
    ctx.lineWidth = 2;
    ctx.setLineDash([14, 10]);
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.lineTo(len, 0);
    ctx.stroke();
    // zone balayée
    ctx.setLineDash([]);
    ctx.globalAlpha = 0.07;
    ctx.fillStyle = '#ff2e6a';
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.arc(0, 0, 700, 0, L.sweep, L.sweep < 0);
    ctx.closePath();
    ctx.fill();
  } else {
    const w = 16 + Math.sin(g.time * 50) * 3;
    ctx.globalAlpha = 0.35;
    ctx.fillStyle = '#ff2e6a';
    ctx.fillRect(0, -w, len, w * 2);
    ctx.globalAlpha = 0.7;
    ctx.fillStyle = '#ff8ab8';
    ctx.fillRect(0, -w * 0.45, len, w * 0.9);
    ctx.globalAlpha = 1;
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, -2.5, len, 5);
    drawGlow(ctx, '#ff2e6a', len, 0, 90, 0.9);
  }
  ctx.restore();
}

// ---- Rendus ---------------------------------------------------------------------
const DRAW = {
  scarab(ctx, e, r) {
    ctx.rotate(e.angle);
    ctx.beginPath();
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * TAU;
      const rr = i % 2 ? r * 0.55 : r * 1.15;
      ctx.lineTo(Math.cos(a) * rr, Math.sin(a) * rr);
    }
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    const blink = e.state === 'armed' ? Math.sin(e.t * 40) > 0 : Math.sin(e.t * 6) > 0;
    ctx.globalCompositeOperation = 'lighter';
    drawGlow(ctx, blink ? '#ffffff' : e.color, 0, 0, r * (e.state === 'armed' ? 3.2 : 2), 0.9);
    ctx.globalCompositeOperation = 'source-over';
    ctx.globalAlpha = 1;
  },
  gunner(ctx, e, r) {
    ctx.rotate(e.aim);
    ctx.beginPath();
    ctx.roundRect(r * 0.2, -4, r * 1.2, 8, 2);
    ctx.fill();
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(0, 0, r, 0, TAU);
    ctx.fill();
    ctx.stroke();
    ctx.globalAlpha = 0.5;
    ctx.beginPath();
    ctx.arc(0, 0, r * 0.62, 0, TAU);
    ctx.stroke();
    ctx.globalAlpha = 1;
    for (let i = 0; i < 3; i++) {
      const a = e.t * 2 + (i / 3) * TAU;
      ctx.fillStyle = e.color;
      ctx.fillRect(Math.cos(a) * r * 0.8 - 2, Math.sin(a) * r * 0.8 - 2, 4, 4);
    }
    ctx.globalCompositeOperation = 'lighter';
    drawGlow(ctx, e.color, r * 0.2, 0, r * 1.8, 0.9);
    ctx.globalCompositeOperation = 'source-over';
    ctx.globalAlpha = 1;
  },
  lancer(ctx, e, r) {
    ctx.rotate(e.aim);
    ctx.beginPath();
    ctx.rect(r * 0.3, -2.5, r * 1.6, 5);
    ctx.fill();
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(r * 1.1, 0);
    ctx.lineTo(0, r * 0.75);
    ctx.lineTo(-r * 1.2, 0);
    ctx.lineTo(0, -r * 0.75);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    const charging = e.state === 'charge';
    ctx.globalCompositeOperation = 'lighter';
    drawGlow(ctx, charging ? '#ffffff' : e.color, r * 0.1, 0, r * (charging ? 3 : 1.6), 0.9);
    ctx.globalCompositeOperation = 'source-over';
    ctx.globalAlpha = 1;
  },
  brute(ctx, e, r) {
    ctx.rotate(e.angle);
    for (const s of [-1, 1]) {
      ctx.beginPath();
      ctx.roundRect(r * 0.3, s * r * 0.45 - 6, r * 0.9, 12, 3);
      ctx.fill();
      ctx.stroke();
    }
    ctx.beginPath();
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * TAU + Math.PI / 8;
      ctx.lineTo(Math.cos(a) * r, Math.sin(a) * r);
    }
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    ctx.globalAlpha = 0.55;
    ctx.beginPath();
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * TAU + Math.PI / 8;
      ctx.lineTo(Math.cos(a) * r * 0.62, Math.sin(a) * r * 0.62);
    }
    ctx.closePath();
    ctx.stroke();
    ctx.globalAlpha = 1;
    const hot = e.state === 'windup' || e.state === 'charge';
    ctx.globalCompositeOperation = 'lighter';
    drawGlow(ctx, hot ? '#ffffff' : e.color, 0, 0, r * (hot ? 3 : 1.8), 0.9);
    ctx.globalCompositeOperation = 'source-over';
    ctx.globalAlpha = 1;
  },
  boss(ctx, e, r) {
    // anneau orbital de nœuds
    ctx.save();
    ctx.rotate(e.spin);
    ctx.globalAlpha = 0.6;
    ctx.beginPath();
    ctx.arc(0, 0, r * 1.25, 0, TAU);
    ctx.stroke();
    ctx.globalAlpha = 1;
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * TAU;
      ctx.save();
      ctx.translate(Math.cos(a) * r * 1.25, Math.sin(a) * r * 1.25);
      ctx.rotate(a);
      ctx.beginPath();
      ctx.moveTo(10, 0);
      ctx.lineTo(0, 8);
      ctx.lineTo(-10, 0);
      ctx.lineTo(0, -8);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
      ctx.restore();
    }
    ctx.restore();
    // coque
    ctx.save();
    ctx.rotate(-e.spin * 0.5);
    ctx.beginPath();
    for (let i = 0; i < 12; i++) {
      const a = (i / 12) * TAU;
      const rr = i % 2 ? r * 0.82 : r;
      ctx.lineTo(Math.cos(a) * rr, Math.sin(a) * rr);
    }
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    ctx.globalAlpha = 0.5;
    ctx.beginPath();
    ctx.arc(0, 0, r * 0.6, 0, TAU);
    ctx.stroke();
    ctx.restore();
    ctx.globalAlpha = 1;
    // œil qui suit la cible
    const pulse = 0.8 + Math.sin(e.t * 5) * 0.2;
    ctx.globalCompositeOperation = 'lighter';
    drawGlow(ctx, e.color, 0, 0, r * 2.6 * pulse, 0.8);
    drawGlow(ctx, '#ffffff', Math.cos(e.aim) * r * 0.2, Math.sin(e.aim) * r * 0.2, r * 0.9, 0.9);
    ctx.globalCompositeOperation = 'source-over';
    ctx.globalAlpha = 1;
    if (e.hp < e.maxHp * 0.5) {
      // fissures en phase 2
      ctx.strokeStyle = '#ffd23d';
      ctx.globalAlpha = 0.6 + Math.sin(e.t * 20) * 0.3;
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(-r * 0.5, -r * 0.2);
      ctx.lineTo(-r * 0.2, r * 0.1);
      ctx.lineTo(-r * 0.3, r * 0.5);
      ctx.moveTo(r * 0.4, -r * 0.5);
      ctx.lineTo(r * 0.15, -r * 0.15);
      ctx.stroke();
      ctx.globalAlpha = 1;
    }
  },
};
