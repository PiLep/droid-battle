// Cœur du jeu : simulation, combats, modes (arcade / duel / démo), caméra et rendu.
import { ARENA, COLORS, DROID_ORDER, DUEL, PICKUPS, SCORING, SPECIAL } from './config.js';
import { Arena, LAYOUTS } from './arena.js';
import { audio } from './audio.js';
import { Droid } from './droid.js';
import { Enemy } from './enemies.js';
import { FX, drawGlow } from './fx.js';
import { SpringGrid } from './grid.js';
import { drawHud } from './hud.js';
import { input } from './input.js';
import { TAU, chance, clamp, damp, dist, pick, rand, segPointDist2, smoothNoise } from './utils.js';

export class Game {
  constructor(canvas, opts) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.mode = opts.mode; // 'arcade' | 'duel' | 'demo'
    this.opts = opts;
    this.silent = opts.mode === 'demo';
    this.settings = opts.settings || { shake: 1 };
    this.fx = new FX();
    this.grid = new SpringGrid(ARENA.w, ARENA.h, 50);
    this.arena = new Arena(opts.layout || pick(LAYOUTS));
    this.view = { w: 1, h: 1, dpr: 1, scale: 1, cx: 0, cy: 0 };
    this.cam = { x: ARENA.w / 2, y: ARENA.h / 2, zoom: 1, tx: ARENA.w / 2, ty: ARENA.h / 2, tzoom: 1, trauma: 0, kx: 0, ky: 0 };
    this.time = 0;
    this.dt = 0;
    this.timeScale = 1;
    this.slow = null;
    this.freeze = 0;
    this.flash = { a: 0, color: '#ffffff' };
    this.hurtA = 0;
    this.banner = null;
    this.players = [];
    this.enemies = [];
    this.bullets = [];
    this.missiles = [];
    this.novas = [];
    this.beams = [];
    this.pickups = [];
    this.inputLocked = false;
    this.over = false;
    this.paused = false;
    this.onEnd = opts.onEnd || (() => {});
    this.gridColor = this.mode === 'arcade' ? '#2d6bff' : '#7a3dff';
    this.wallColor = this.mode === 'arcade' ? '#2de2ff' : '#b06bff';

    if (this.mode === 'arcade') this.initArcade(opts);
    else this.initDuel(opts);
  }

  // ---- mise en place -----------------------------------------------------------
  initArcade(opts) {
    const spawn = this.arena.nearestFree(ARENA.w / 2, ARENA.h / 2, 40);
    const p = new Droid(this, opts.droid, {
      team: 'player',
      color: COLORS.player,
      x: spawn.x,
      y: spawn.y,
      controller: opts.controller,
      padIndex: 0,
    });
    this.players.push(p);
    this.wave = 0;
    this.score = 0;
    this.displayScore = 0;
    this.kills = 0;
    this.combo = 0;
    this.comboT = 0;
    this.maxCombo = 0;
    this.mult = 1;
    this.durationMs = 0;
    this.queue = [];
    this.spawnT = 0;
    this.waveState = 'pre';
    this.waveT = 1.2;
    this.perfect = true;
    this.boss = null;
    audio.setIntensity('game');
  }

  initDuel(opts) {
    const spec = opts.players;
    this.wins = [0, 0];
    this.round = 0;
    this.players = spec.map((s, i) => {
      const d = new Droid(this, s.droid, {
        team: `p${i + 1}`,
        color: i === 0 ? COLORS.p1 : COLORS.p2,
        x: 0,
        y: 0,
        controller: s.controller,
        label: this.mode === 'demo' ? '' : s.label,
        padIndex: s.padIndex ?? null,
      });
      return d;
    });
    this.pickupT = DUEL.pickupEvery;
    this.startRound();
    if (this.mode === 'duel') audio.setIntensity('game');
  }

  startRound() {
    this.round++;
    this.roundTime = DUEL.roundTime;
    this.bullets.length = 0;
    this.missiles.length = 0;
    this.novas.length = 0;
    this.pickups.length = 0;
    const spots = [
      [180, ARENA.h / 2],
      [ARENA.w - 180, ARENA.h / 2],
    ];
    this.players.forEach((d, i) => {
      d.x = spots[i][0];
      d.y = spots[i][1];
      d.vx = d.vy = 0;
      d.hp = d.maxHp;
      d.alive = true;
      d.special = 30;
      d.invuln = 0;
      d.railCharge = 0;
      d.salvoLeft = 0;
      d.bodyAngle = d.aim = i === 0 ? 0 : Math.PI;
      d.spawnT = 0.5;
      d.ghosts.length = 0;
    });
    this.cam.tzoom = 1;
    this.cam.tx = ARENA.w / 2;
    this.cam.ty = ARENA.h / 2;
    this.roundState = 'countdown';
    this.roundT = this.mode === 'demo' ? 0.8 : 4.2;
    this.inputLocked = true;
    this.lastCount = 4;
    if (this.mode === 'duel') this.showBanner(`MANCHE ${this.round}`, this.round === 1 ? 'Premier à 2 manches' : '', '#ffffff', 1);
  }

  resize(w, h, dpr) {
    const v = this.view;
    v.w = w;
    v.h = h;
    v.dpr = dpr;
    v.scale = Math.min(w / (ARENA.w + 40), h / (ARENA.h + 40));
    v.cx = w / 2;
    v.cy = h / 2;
    this.arena.buildStatic(Math.min(2, v.scale * dpr), this.wallColor);
    this.vignette = null;
  }

  toWorld(sx, sy) {
    const rect = this.canvas.getBoundingClientRect();
    const s = this.view.scale * this.cam.zoom;
    return {
      x: (sx - rect.left - this.view.cx) / s + this.cam.x,
      y: (sy - rect.top - this.view.cy) / s + this.cam.y,
    };
  }

  // ---- API de combat (utilisée par les entités) ------------------------------------
  sfx(name, opts) {
    if (!this.silent) audio.play(name, opts);
  }

  rumble(d, strong, weak, ms) {
    if (!this.silent && d && d.controller?.human && d.padIndex !== null) input.rumble(d.padIndex, strong, weak, ms);
  }

  addShake(amount, src) {
    if (this.mode === 'demo') amount *= 0.3;
    this.cam.trauma = Math.min(1, this.cam.trauma + amount * (this.settings.shake ?? 1));
    if (src && src.kind === 'droid' && this.mode === 'arcade') {
      this.cam.kx += Math.cos(src.aim) * 4;
      this.cam.ky += Math.sin(src.aim) * 4;
    }
  }

  flashScreen(color, a) {
    if (this.mode === 'demo') a *= 0.4;
    this.flash.color = color;
    this.flash.a = Math.max(this.flash.a, a);
  }

  hitStop(t) {
    this.freeze = Math.max(this.freeze, t);
  }

  slowMo(scale, duration) {
    this.slow = { scale, t: duration };
  }

  showBanner(text, sub = '', color = '#ffffff', dur = 2) {
    if (this.mode === 'demo') return;
    this.banner = { text, sub, color, t: 0, dur };
  }

  get combatants() {
    return this.enemies.length ? this.players.concat(this.enemies) : this.players;
  }

  isTarget(t, team) {
    return t.alive && t.team !== team && (t.kind !== 'enemy' || t.active);
  }

  nearestPlayer(x, y) {
    let best = null;
    let bd = Infinity;
    for (const p of this.players) {
      if (!p.alive) continue;
      const d = (p.x - x) ** 2 + (p.y - y) ** 2;
      if (d < bd) {
        bd = d;
        best = p;
      }
    }
    return best;
  }

  opponentOf(me) {
    return this.players.find((p) => p !== me && p.alive) || null;
  }

  autoAimTarget(me) {
    if (this.mode !== 'arcade') return this.opponentOf(me);
    let best = null;
    let bs = Infinity;
    for (const e of this.enemies) {
      if (!e.alive || !e.active) continue;
      const d = dist(me.x, me.y, e.x, e.y);
      if (d > 750) continue;
      const score = d + (this.arena.lineOfSight(me.x, me.y, e.x, e.y) ? 0 : 600);
      if (score < bs) {
        bs = score;
        best = e;
      }
    }
    return best;
  }

  spawnBullet(b) {
    b.max = b.life;
    this.bullets.push(b);
  }

  spawnMissile(owner, x, y, angle) {
    this.missiles.push({ x, y, angle, speed: 160, vx: 0, vy: 0, life: 2.8, age: 0, team: owner.team, owner, color: owner.color, target: null, trailT: 0 });
    this.sfx('missile', { x, vol: 0.6 });
  }

  spawnNova(d) {
    const c = SPECIAL.nova;
    this.novas.push({ x: d.x, y: d.y, r: d.r, max: c.radius, team: d.team, owner: d, hit: new Set(), color: d.color });
    this.fx.glow(d.x, d.y, 500, d.color, 0.3, { soft: true });
    this.fx.glow(d.x, d.y, 200, '#ffffff', 0.12);
    this.fx.ring(d.x, d.y, d.r, c.radius * 1.15, 0.6, '#ffffff', 3);
    this.fx.sparks(d.x, d.y, 50, d.color, 900, null, TAU, { len: 0.05, width: 2.5 });
    this.grid.impulse(d.x, d.y, c.radius * 1.3, 90);
    this.addShake(0.6);
    this.flashScreen(d.color, 0.25);
    this.hitStop(0.06);
    this.sfx('nova', { x: d.x });
    this.rumble(d, 0.9, 0.6, 300);
  }

  fireRail(d) {
    const c = SPECIAL.rail;
    const dx = Math.cos(d.aim);
    const dy = Math.sin(d.aim);
    const x1 = d.x + dx * (d.r + 10);
    const y1 = d.y + dy * (d.r + 10);
    const len = this.arena.raycast(x1, y1, dx, dy);
    const x2 = x1 + dx * len;
    const y2 = y1 + dy * len;
    let hits = 0;
    for (const t of this.combatants) {
      if (!this.isTarget(t, d.team)) continue;
      const [, d2] = segPointDist2(x1, y1, x2, y2, t.x, t.y);
      if (d2 < (t.r + c.width / 2) ** 2) {
        if (this.damage(t, c.damage, d, { kx: dx * 700, ky: dy * 700, big: true })) hits++;
      }
    }
    this.beams.push({ x1, y1, x2, y2, life: 0.5, max: 0.5, color: d.color, w: c.width });
    for (let s = 0; s < len; s += 34) {
      const px = x1 + dx * s;
      const py = y1 + dy * s;
      const side = chance(0.5) ? 1 : -1;
      this.fx.sparks(px, py, 2, chance(0.5) ? '#ffffff' : d.color, 420, Math.atan2(dx * side, -dy * side), 0.8);
      if (s % 102 < 34) this.grid.impulse(px, py, 90, 40);
    }
    this.fx.explosion(x2, y2, 22, d.color, { debris: false });
    this.fx.glow(x1, y1, 160, '#ffffff', 0.15);
    d.vx -= dx * 600;
    d.vy -= dy * 600;
    this.addShake(0.7);
    this.flashScreen(d.color, 0.2);
    this.hitStop(hits ? 0.09 : 0.04);
    this.sfx('railFire', { x: d.x });
    this.rumble(d, 1, 0.8, 250);
  }

  explode(x, y, radius, damage, team, owner, opts = {}) {
    for (const t of this.combatants) {
      if (!this.isTarget(t, team)) continue;
      const d = dist(x, y, t.x, t.y);
      if (d > radius + t.r) continue;
      const k = 1 - 0.5 * clamp(d / radius, 0, 1);
      const nx = (t.x - x) / (d || 1);
      const ny = (t.y - y) / (d || 1);
      this.damage(t, damage * k, owner, { kx: nx * 500, ky: ny * 500 });
    }
    const size = opts.size ?? radius / 3;
    this.fx.explosion(x, y, size, opts.color ?? '#ff8a3d');
    this.grid.impulse(x, y, radius * 2.2, size * 3.5);
    this.addShake(Math.min(0.5, size / 50));
    this.sfx(size > 30 ? 'explodeBig' : 'explodeSmall', { x });
  }

  // Applique des dégâts ; renvoie true si touché
  damage(t, amount, src, { kx = 0, ky = 0, big = false } = {}) {
    if (!t.alive || this.over) return false;
    if (t.kind === 'enemy' && !t.active) return false;
    if (t.invuln > 0) {
      if (t.kind === 'droid' && t.dashT > 0 && chance(0.5)) this.fx.text(t.x, t.y - 30, 'ESQUIVE', '#ffffff', 14, { life: 0.5 });
      return false;
    }
    t.hp -= amount;
    t.flash = 1;
    t.vx += kx / t.mass;
    t.vy += ky / t.mass;
    if (src && src.kind === 'droid' && src !== t) src.special = Math.min(SPECIAL.max, src.special + amount * SPECIAL.perDamageDealt);
    if (t.kind === 'droid') {
      t.special = Math.min(SPECIAL.max, t.special + amount * SPECIAL.perDamageTaken);
      this.sfx('hurt', { x: t.x });
      this.rumble(t, 0.6, 0.9, 140);
      if (this.mode === 'arcade') {
        this.hurtA = Math.min(1, this.hurtA + 0.35 + amount / 60);
        this.addShake(0.22 + amount / 80);
        this.perfect = false;
        if (this.combo > 0) {
          this.combo = Math.floor(this.combo / 2);
          this.updateMultiplier(true);
        }
        t.invuln = Math.max(t.invuln, 0.12);
      } else this.addShake(0.08 + amount / 120);
    } else {
      this.sfx('hit', { x: t.x, pitch: rand(0.85, 1.15) });
    }
    if (big) this.fx.text(t.x, t.y - t.r - 10, `${Math.round(amount)}`, '#ffffff', 26);
    if (t.hp <= 0) {
      t.hp = 0;
      if (t.kind === 'enemy') this.killEnemy(t, src);
      else this.killDroid(t, src);
    }
    return true;
  }

  spawnEnemy(type, x, y) {
    if (!x) {
      const p = this.players[0];
      const spot = this.arena.freeSpot(type === 'boss' ? 140 : 70, p ? [p] : null, type === 'boss' ? 380 : 320);
      x = spot.x;
      y = spot.y;
    }
    const e = new Enemy(this, type, x, y, this.wave);
    this.enemies.push(e);
    this.sfx('warp', { x, vol: type === 'boss' ? 2 : 0.6 });
    if (type === 'boss') this.boss = e;
    return e;
  }

  killEnemy(e, killer, selfDestruct = false) {
    if (!e.alive) return;
    e.alive = false;
    const big = e.type === 'boss';
    if (!selfDestruct) {
      this.kills++;
      this.combo++;
      this.comboT = SCORING.comboWindow;
      this.maxCombo = Math.max(this.maxCombo, this.combo);
      this.updateMultiplier();
      const pts = e.points * this.mult;
      this.score += pts;
      this.fx.text(e.x, e.y - e.r - 6, `+${pts}`, this.mult > 1 ? '#ffd23d' : '#ffffff', big ? 40 : 18 + Math.min(10, this.mult * 2));
      // butin
      const roll = Math.random();
      if (big) {
        this.spawnPickup('repair', e.x - 40, e.y);
        this.spawnPickup('energy', e.x + 40, e.y);
      } else if (roll < 0.09 + (e.type === 'brute' ? 0.3 : 0)) this.spawnPickup('repair', e.x, e.y);
      else if (roll < 0.17 + (e.type === 'brute' ? 0.3 : 0)) this.spawnPickup('energy', e.x, e.y);
    }
    const size = { scarab: 14, gunner: 20, lancer: 18, brute: 34, boss: 70 }[e.type];
    if (!selfDestruct) {
      this.fx.explosion(e.x, e.y, size, e.color);
      this.grid.impulse(e.x, e.y, size * 6, size * 2.2);
      this.addShake(big ? 1 : Math.min(0.35, size / 70));
      this.sfx(size > 30 ? 'explodeBig' : 'explodeSmall', { x: e.x });
    }
    if (big) {
      this.boss = null;
      this.hitStop(0.15);
      this.slowMo(0.25, 1.4);
      this.flashScreen('#ffffff', 0.7);
      this.bossDeath = { x: e.x, y: e.y, t: 1.2, next: 0 };
      // les projectiles ennemis disparaissent
      for (const b of this.bullets) if (b.team === 'enemy') b.life = 0;
      audio.setIntensity('game');
      this.showBanner('OVERLORD DÉTRUIT', `+${e.points * this.mult}`, '#ffd23d', 2.2);
    } else if (e.type === 'brute') this.hitStop(0.05);
  }

  killDroid(d, killer) {
    if (!d.alive) return;
    d.alive = false;
    d.railCharge = 0;
    d.salvoLeft = 0;
    this.fx.explosion(d.x, d.y, 48, d.color);
    this.fx.explosion(d.x, d.y, 30, '#ffffff', { debris: false });
    this.fx.debris(d.x, d.y, 16, d.color, 520, 9);
    this.grid.impulse(d.x, d.y, 420, 120);
    this.addShake(1);
    this.flashScreen(d.color, 0.55);
    this.hitStop(0.14);
    this.slowMo(0.22, 1.3);
    this.cam.tx = d.x;
    this.cam.ty = d.y;
    this.cam.tzoom = 1.35;
    this.sfx('explodeBig', { x: d.x });
    this.sfx('ko', { x: d.x });
    this.rumble(d, 1, 1, 500);

    if (this.mode === 'arcade') {
      this.over = true;
      this.endT = 2.4;
      this.showBanner('SYSTÈME DÉTRUIT', '', '#ff4d5e', 2.4);
      audio.setIntensity('calm');
    } else {
      this.roundState = 'ko';
      this.roundT = this.mode === 'demo' ? 2.2 : 3.2;
      const winner = this.players.indexOf(killer);
      if (winner >= 0) this.wins[winner]++;
      if (this.mode === 'duel') this.showBanner('K.O.', killer ? `${killer.label} remporte la manche` : '', killer?.color || '#fff', 2.6);
    }
  }

  spawnPickup(type, x, y) {
    this.pickups.push({ type, x, y, vx: rand(-60, 60), vy: rand(-60, 60), life: 12, t: rand(10), r: 15 });
  }

  updateMultiplier(silent) {
    const steps = SCORING.multiplierSteps;
    let m = 1;
    for (let i = 0; i < steps.length; i++) if (this.combo >= steps[i]) m = i + 1;
    if (m > this.mult && !silent) {
      this.sfx('comboUp', { pitch: 1 + m * 0.08 });
      const p = this.players[0];
      this.fx.text(p.x, p.y - 50, `×${m}`, '#ffd23d', 30, { life: 1.1 });
    }
    this.mult = m;
  }

  // ---- boucle -------------------------------------------------------------------
  update(realDt) {
    if (this.paused) return;
    this.realDt = realDt;
    if (this.slow) {
      this.slow.t -= realDt;
      if (this.slow.t <= 0) this.slow = null;
    }
    const targetScale = this.slow ? this.slow.scale : 1;
    this.timeScale = damp(this.timeScale, targetScale, this.slow ? 30 : 4, realDt);
    this.updateCamera(realDt);
    this.flash.a = Math.max(0, this.flash.a - realDt * 2.5);
    this.hurtA = Math.max(0, this.hurtA - realDt * 1.6);
    if (this.banner) {
      this.banner.t += realDt;
      if (this.banner.t > this.banner.dur) this.banner = null;
    }
    if (this.freeze > 0) {
      this.freeze -= realDt;
      return;
    }
    const dt = realDt * this.timeScale;
    this.dt = dt;
    this.time += dt;

    if (this.mode === 'arcade') this.updateArcade(dt, realDt);
    else this.updateDuel(dt, realDt);

    for (const p of this.players) if (p.alive) p.update(dt);
    if (this.enemies.length) {
      const target = this.nearestPlayer(ARENA.w / 2, ARENA.h / 2);
      if (target) this.arena.updateFlow(target, dt);
      for (const e of this.enemies) if (e.alive) e.update(dt);
    }
    this.separate();
    this.updateBullets(dt);
    this.updateMissiles(dt);
    this.updateNovas(dt);
    this.updatePickups(dt);
    for (let i = this.beams.length - 1; i >= 0; i--) {
      this.beams[i].life -= dt;
      if (this.beams[i].life <= 0) this.beams.splice(i, 1);
    }
    if (this.enemies.length) this.enemies = this.enemies.filter((e) => e.alive);
    this.fx.update(dt);
    this.grid.update(dt);
  }

  updateCamera(dt) {
    const c = this.cam;
    c.x = damp(c.x, c.tx, 5, dt);
    c.y = damp(c.y, c.ty, 5, dt);
    c.zoom = damp(c.zoom, c.tzoom, 4, dt);
    // garde la vue dans l'arène quand on zoome
    const v = this.view;
    const hw = v.w / 2 / (v.scale * c.zoom);
    const hh = v.h / 2 / (v.scale * c.zoom);
    c.x = hw * 2 >= ARENA.w ? ARENA.w / 2 : clamp(c.x, hw, ARENA.w - hw);
    c.y = hh * 2 >= ARENA.h ? ARENA.h / 2 : clamp(c.y, hh, ARENA.h - hh);
    c.trauma = Math.max(0, c.trauma - dt * 1.4);
    c.kx = damp(c.kx, 0, 10, dt);
    c.ky = damp(c.ky, 0, 10, dt);
    if (!this.slow && !this.over && this.roundState !== 'ko') {
      c.tzoom = 1;
      c.tx = ARENA.w / 2;
      c.ty = ARENA.h / 2;
    }
  }

  updateArcade(dt, realDt) {
    const p = this.players[0];
    if (!this.over) this.durationMs += realDt * 1000;
    if (this.comboT > 0) {
      this.comboT -= dt;
      if (this.comboT <= 0) {
        this.combo = 0;
        this.updateMultiplier(true);
      }
    }
    this.displayScore = damp(this.displayScore, this.score, 8, realDt);
    if (Math.abs(this.displayScore - this.score) < 1) this.displayScore = this.score;

    if (this.over) {
      this.endT -= realDt;
      if (this.endT <= 0 && !this.ended) {
        this.ended = true;
        this.onEnd({
          mode: 'arcade',
          score: this.score,
          wave: this.wave,
          kills: this.kills,
          maxCombo: this.maxCombo,
          durationMs: Math.round(this.durationMs),
          droid: p.classId,
        });
      }
      return;
    }

    // explosions en chaîne à la mort du boss
    if (this.bossDeath) {
      const b = this.bossDeath;
      b.t -= dt;
      b.next -= dt;
      if (b.next <= 0) {
        b.next = 0.12;
        this.fx.explosion(b.x + rand(-60, 60), b.y + rand(-60, 60), rand(20, 36), pick(['#ff2e6a', '#ffd23d', '#ffffff']));
        this.sfx('explodeSmall', { x: b.x });
        this.addShake(0.2);
      }
      if (b.t <= 0) {
        this.fx.explosion(b.x, b.y, 90, '#ff2e6a');
        this.grid.impulse(b.x, b.y, 600, 160);
        this.sfx('explodeBig', { x: b.x });
        this.addShake(1);
        this.flashScreen('#ffffff', 0.6);
        this.bossDeath = null;
      }
    }

    if (this.waveState === 'pre' || this.waveState === 'clear') {
      this.waveT -= realDt;
      if (this.waveT <= 0) this.startWave(this.wave + 1);
      return;
    }

    // apparition progressive
    const alive = this.enemies.filter((e) => e.alive).length;
    const cap = Math.min(16, 4 + Math.floor(this.wave * 1.2));
    this.spawnT -= dt;
    if (this.queue.length && this.spawnT <= 0 && alive < cap) {
      const type = this.queue.shift();
      this.spawnEnemy(type);
      this.spawnT = Math.max(0.35, 1.25 - this.wave * 0.05) * (type === 'brute' ? 1.6 : 1);
    }
    if (!this.queue.length && alive === 0 && !this.bossDeath) this.clearWave();
  }

  startWave(n) {
    this.wave = n;
    this.waveState = 'fight';
    this.perfect = true;
    const bossWave = n % 5 === 0;
    const q = [];
    let budget = (5 + n * 2.6) * (bossWave ? 0.3 : 1);
    const cost = { scarab: 1, gunner: 2, lancer: 3, brute: 5 };
    const pool = ['scarab', 'scarab', 'gunner'];
    if (n >= 2) pool.push('gunner');
    // escorte du boss : uniquement des ennemis légers
    if (n >= 3 && !bossWave) pool.push('lancer');
    if (n >= 4 && !bossWave) pool.push('brute');
    if (n >= 6 && !bossWave) pool.push('lancer', 'brute');
    while (budget > 0) {
      const t = pick(pool);
      q.push(t);
      budget -= cost[t];
    }
    if (bossWave) {
      q.unshift('boss');
      // ravitaillement avant le boss
      const p = this.players[0];
      for (const [type, dx] of [
        ['repair', -70],
        ['energy', 70],
      ]) {
        const spot = this.arena.nearestFree(clamp(p.x + dx, 80, ARENA.w - 80), clamp(p.y - 90, 80, ARENA.h - 80), 30);
        this.spawnPickup(type, spot.x, spot.y);
        this.fx.ring(spot.x, spot.y, 10, 70, 0.5, PICKUPS[type].color, 3);
      }
      this.showBanner('ALERTE', 'OVERLORD EN APPROCHE', '#ff2e6a', 2.6);
      this.sfx('bossAlarm');
      audio.setIntensity('boss');
      this.spawnT = 0;
    } else {
      this.showBanner(`VAGUE ${n}`, n === 1 ? 'Détruisez tous les droïdes ennemis' : '', '#2de2ff', 1.8);
      this.sfx('waveStart');
      this.spawnT = 0.6;
    }
    this.queue = q;
  }

  clearWave() {
    this.waveState = 'clear';
    this.waveT = 2.8;
    const bonus = SCORING.waveBonus * this.wave + (this.perfect ? SCORING.perfectBonus * this.wave + 500 : 0);
    this.score += bonus;
    const p = this.players[0];
    p.hp = Math.min(p.maxHp, p.hp + p.maxHp * 0.2);
    this.showBanner(`VAGUE ${this.wave} TERMINÉE`, `${this.perfect ? 'PARFAIT ! ' : ''}+${bonus}`, this.perfect ? '#ffd23d' : '#3dff9a', 2.4);
    this.sfx('waveClear');
    this.fx.ring(p.x, p.y, p.r, 200, 0.6, '#3dff9a', 3);
  }

  updateDuel(dt, realDt) {
    if (this.roundState === 'countdown') {
      this.roundT -= realDt;
      const n = Math.ceil(this.roundT - 0.2);
      if (this.mode === 'duel' && n !== this.lastCount && n <= 3 && n >= 1) {
        this.lastCount = n;
        this.sfx('countdown');
        this.showBanner(String(n), '', '#ffffff', 0.9);
      }
      if (this.roundT <= 0.2) {
        this.roundState = 'fight';
        this.inputLocked = false;
        if (this.mode === 'duel') {
          this.showBanner('COMBAT !', '', '#ffd23d', 1);
          this.sfx('fight');
        }
      }
    } else if (this.roundState === 'fight') {
      this.roundTime -= dt;
      this.pickupT -= dt;
      if (this.pickupT <= 0 && this.pickups.length < 2) {
        this.pickupT = DUEL.pickupEvery;
        const spot = this.arena.freeSpot(120, this.players, 160);
        this.spawnPickup(chance(0.5) ? 'repair' : 'energy', spot.x, spot.y);
        this.fx.ring(spot.x, spot.y, 10, 60, 0.4, '#ffffff', 2);
      }
      if (this.roundTime <= 0) {
        // temps écoulé : le plus en forme gagne
        const [a, b] = this.players;
        const ra = a.hp / a.maxHp;
        const rb = b.hp / b.maxHp;
        if (Math.abs(ra - rb) < 0.001) {
          this.roundState = 'ko';
          this.roundT = 3;
          this.showBanner('TEMPS ÉCOULÉ', 'Égalité', '#ffffff', 2.6);
        } else this.killDroid(ra > rb ? b : a, ra > rb ? a : b);
      }
    } else if (this.roundState === 'ko') {
      this.roundT -= realDt;
      this.inputLocked = this.roundT < 1.5;
      if (this.roundT <= 0) {
        const champ = this.wins.findIndex((w) => w >= DUEL.roundsToWin);
        if (this.mode === 'demo') {
          this.wins = [0, 0];
          this.round = 0;
          this.players.forEach((d) => d.setClass(pick(DROID_ORDER)));
          this.startRound();
        } else if (champ >= 0) {
          this.roundState = 'end';
          if (!this.ended) {
            this.ended = true;
            this.onEnd({ mode: 'duel', winner: champ, wins: this.wins.slice(), players: this.players.map((p) => ({ label: p.label, droid: p.classId, color: p.color })) });
          }
        } else this.startRound();
      }
    }
  }

  separate() {
    const list = this.combatants;
    for (let i = 0; i < list.length; i++) {
      const a = list[i];
      if (!a.alive || (a.kind === 'enemy' && !a.active)) continue;
      for (let j = i + 1; j < list.length; j++) {
        const b = list[j];
        if (!b.alive || (b.kind === 'enemy' && !b.active)) continue;
        const dx = b.x - a.x;
        const dy = b.y - a.y;
        const rr = a.r + b.r;
        const d2 = dx * dx + dy * dy;
        if (d2 >= rr * rr || d2 < 1e-6) continue;
        const d = Math.sqrt(d2);
        const over = rr - d;
        const nx = dx / d;
        const ny = dy / d;
        const wa = b.mass / (a.mass + b.mass);
        const wb = 1 - wa;
        a.x -= nx * over * wa;
        a.y -= ny * over * wa;
        b.x += nx * over * wb;
        b.y += ny * over * wb;
      }
    }
  }

  updateBullets(dt) {
    const B = this.bullets;
    const list = this.combatants;
    for (let i = B.length - 1; i >= 0; i--) {
      const b = B[i];
      const px = b.x;
      const py = b.y;
      b.x += b.vx * dt;
      b.y += b.vy * dt;
      b.life -= dt;
      let dead = b.life <= 0;
      if (!dead) {
        const solid = this.arena.solidAt(b.x, b.y);
        if (solid) {
          dead = true;
          const a = Math.atan2(-b.vy, -b.vx);
          this.fx.impact(b.x, b.y, a, b.color, b.kind === 'player' ? 0.8 : 0.6);
          if (b.kind === 'player') this.sfx('spark', { x: b.x });
        }
      }
      if (!dead) {
        for (const t of list) {
          if (!this.isTarget(t, b.team)) continue;
          const [, d2] = segPointDist2(px, py, b.x, b.y, t.x, t.y);
          const rr = t.r + b.r;
          if (d2 > rr * rr) continue;
          const l = Math.hypot(b.vx, b.vy) || 1;
          const dmg = b.falloff ? b.damage * (1 - b.falloff * (1 - b.life / b.max)) : b.damage;
          const hit = this.damage(t, dmg, b.owner, { kx: (b.vx / l) * b.knock, ky: (b.vy / l) * b.knock });
          if (hit) {
            dead = true;
            this.fx.impact(b.x, b.y, Math.atan2(-b.vy, -b.vx) + rand(-0.5, 0.5), b.color, b.kind === 'bolt' ? 1.6 : 1);
            this.grid.impulse(b.x, b.y, 50, 6);
            break;
          }
        }
      }
      if (dead) {
        if (b.life <= 0) this.fx.glow(b.x, b.y, b.r * 5, b.color, 0.12);
        B[i] = B[B.length - 1];
        B.pop();
      }
    }
  }

  updateMissiles(dt) {
    const S = SPECIAL.salvo;
    const M = this.missiles;
    for (let i = M.length - 1; i >= 0; i--) {
      const m = M[i];
      m.age += dt;
      m.life -= dt;
      m.speed = Math.min(S.speed, m.speed + 900 * dt);
      if (!m.target || !this.isTarget(m.target, m.team)) {
        let best = null;
        let bd = Infinity;
        for (const t of this.combatants) {
          if (!this.isTarget(t, m.team)) continue;
          const d = dist(m.x, m.y, t.x, t.y);
          if (d < bd) {
            bd = d;
            best = t;
          }
        }
        m.target = best;
      }
      if (m.target && m.age > 0.12) {
        const want = Math.atan2(m.target.y - m.y, m.target.x - m.x);
        let diff = (want - m.angle) % TAU;
        if (diff > Math.PI) diff -= TAU;
        if (diff < -Math.PI) diff += TAU;
        m.angle += clamp(diff, -S.turn * dt, S.turn * dt);
      }
      m.vx = Math.cos(m.angle) * m.speed;
      m.vy = Math.sin(m.angle) * m.speed;
      m.x += m.vx * dt;
      m.y += m.vy * dt;
      m.trailT -= dt;
      if (m.trailT <= 0) {
        m.trailT = 0.016;
        const bx = m.x - Math.cos(m.angle) * 8;
        const by = m.y - Math.sin(m.angle) * 8;
        this.fx.glow(bx, by, 16, '#ffb347', 0.22, { grow: -30, alpha: 0.9 });
        if (chance(0.5)) this.fx.smoke(bx, by, 1, 6, 20, '#3a3d4d');
      }
      let boom = m.life <= 0 || this.arena.solidAt(m.x, m.y);
      if (!boom) {
        for (const t of this.combatants) {
          if (!this.isTarget(t, m.team)) continue;
          if (dist(m.x, m.y, t.x, t.y) < t.r + 6) {
            boom = true;
            break;
          }
        }
      }
      if (boom) {
        this.explode(m.x, m.y, S.radius, S.damage, m.team, m.owner, { size: 18, color: m.color });
        M[i] = M[M.length - 1];
        M.pop();
      }
    }
  }

  updateNovas(dt) {
    const c = SPECIAL.nova;
    for (let i = this.novas.length - 1; i >= 0; i--) {
      const n = this.novas[i];
      n.r += c.speed * dt;
      for (const t of this.combatants) {
        if (n.hit.has(t) || !this.isTarget(t, n.team)) continue;
        const d = dist(n.x, n.y, t.x, t.y);
        if (d < n.r + t.r) {
          n.hit.add(t);
          const k = 1 - 0.5 * clamp(d / c.radius, 0, 1);
          const nx = (t.x - n.x) / (d || 1);
          const ny = (t.y - n.y) / (d || 1);
          this.damage(t, c.damage * k, n.owner, { kx: nx * c.knock, ky: ny * c.knock, big: true });
          t.stunned = 0.5;
        }
      }
      for (const b of this.bullets) {
        if (b.team === n.team || b.life <= 0) continue;
        if (dist(n.x, n.y, b.x, b.y) < n.r) {
          b.life = 0;
          this.fx.sparks(b.x, b.y, 3, b.color, 250);
        }
      }
      if (n.r >= n.max) this.novas.splice(i, 1);
    }
  }

  updatePickups(dt) {
    for (let i = this.pickups.length - 1; i >= 0; i--) {
      const pk = this.pickups[i];
      pk.t += dt;
      pk.life -= dt;
      pk.vx *= Math.exp(-3 * dt);
      pk.vy *= Math.exp(-3 * dt);
      const p = this.nearestPlayer(pk.x, pk.y);
      if (p) {
        const d = dist(pk.x, pk.y, p.x, p.y);
        if (d < 140) {
          const pull = (1 - d / 140) * 900 * dt;
          pk.vx += ((p.x - pk.x) / d) * pull;
          pk.vy += ((p.y - pk.y) / d) * pull;
        }
        if (d < pk.r + p.r) {
          const info = PICKUPS[pk.type];
          if (pk.type === 'repair') p.hp = Math.min(p.maxHp, p.hp + info.amount);
          else p.special = Math.min(SPECIAL.max, p.special + info.amount);
          this.fx.text(p.x, p.y - 40, info.label, info.color, 18);
          this.fx.ring(p.x, p.y, p.r, p.r * 3, 0.4, info.color, 3);
          this.fx.sparks(pk.x, pk.y, 14, info.color, 260);
          this.sfx('pickup', { x: p.x });
          this.pickups.splice(i, 1);
          continue;
        }
      }
      pk.x += pk.vx * dt;
      pk.y += pk.vy * dt;
      if (pk.life <= 0) {
        this.fx.glow(pk.x, pk.y, 40, PICKUPS[pk.type].color, 0.25);
        this.pickups.splice(i, 1);
      }
    }
  }

  // ---- rendu -----------------------------------------------------------------------
  render() {
    const ctx = this.ctx;
    const v = this.view;
    const c = this.cam;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';
    ctx.fillStyle = COLORS.bg;
    ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);

    // caméra + tremblement (bruit lissé, amplitude = trauma²)
    const sh = c.trauma * c.trauma;
    const t = performance.now() / 1000;
    const sx = smoothNoise(t * 28) * 22 * sh + c.kx;
    const sy = smoothNoise(t * 28 + 50) * 22 * sh + c.ky;
    const rot = smoothNoise(t * 20 + 99) * 0.025 * sh;
    ctx.setTransform(v.dpr, 0, 0, v.dpr, 0, 0);
    ctx.translate(v.cx + sx, v.cy + sy);
    ctx.rotate(rot);
    ctx.scale(v.scale * c.zoom, v.scale * c.zoom);
    ctx.translate(-c.x, -c.y);

    // sol
    if (!this.floor) this.floor = makeFloor();
    ctx.drawImage(this.floor, 0, 0, ARENA.w, ARENA.h);
    this.grid.draw(ctx, this.gridColor, 0.13);
    this.fx.drawDecals(ctx);
    this.arena.drawStatic(ctx);

    this.drawPickups(ctx);
    this.fx.drawBase(ctx);
    for (const e of this.enemies) if (e.alive) e.draw(ctx);
    for (const p of this.players) if (p.alive) p.draw(ctx);
    this.drawMissiles(ctx);
    this.drawBullets(ctx);
    this.drawNovas(ctx);
    this.drawBeams(ctx);
    this.fx.drawGlow(ctx);
    this.fx.drawTexts(ctx);

    // post-effets écran
    ctx.setTransform(v.dpr, 0, 0, v.dpr, 0, 0);
    if (this.flash.a > 0.01) {
      ctx.globalCompositeOperation = 'lighter';
      ctx.globalAlpha = this.flash.a * 0.6;
      ctx.fillStyle = this.flash.color;
      ctx.fillRect(0, 0, v.w, v.h);
      ctx.globalCompositeOperation = 'source-over';
      ctx.globalAlpha = 1;
    }
    this.drawVignette(ctx);
    if (this.mode !== 'demo') drawHud(this, ctx);
  }

  drawVignette(ctx) {
    const v = this.view;
    if (!this.vignette) {
      const cv = document.createElement('canvas');
      cv.width = 512;
      cv.height = 288;
      const g = cv.getContext('2d');
      const grad = g.createRadialGradient(256, 144, 90, 256, 144, 320);
      grad.addColorStop(0, 'rgba(0,0,0,0)');
      grad.addColorStop(1, 'rgba(0,0,0,0.75)');
      g.fillStyle = grad;
      g.fillRect(0, 0, 512, 288);
      this.vignette = cv;
    }
    ctx.globalAlpha = 1;
    ctx.drawImage(this.vignette, 0, 0, v.w, v.h);
    // vignette rouge quand on prend des coups / PV bas
    const p = this.mode === 'arcade' ? this.players[0] : null;
    let red = this.hurtA * 0.5;
    if (p && p.alive && p.hp < p.maxHp * 0.3) red = Math.max(red, 0.25 + Math.sin(this.time * 6) * 0.12);
    if (red > 0.01) {
      const g = ctx.createRadialGradient(v.w / 2, v.h / 2, Math.min(v.w, v.h) * 0.3, v.w / 2, v.h / 2, Math.max(v.w, v.h) * 0.7);
      g.addColorStop(0, 'rgba(255,0,40,0)');
      g.addColorStop(1, `rgba(255,0,40,${red})`);
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, v.w, v.h);
    }
  }

  drawBullets(ctx) {
    ctx.globalCompositeOperation = 'lighter';
    ctx.lineCap = 'round';
    for (const b of this.bullets) {
      const fade = Math.min(1, b.life / 0.08);
      if (b.kind === 'player') {
        const tl = b.r * 7;
        const l = Math.hypot(b.vx, b.vy) || 1;
        const tx = b.x - (b.vx / l) * tl;
        const ty = b.y - (b.vy / l) * tl;
        drawGlow(ctx, b.color, b.x, b.y, b.r * 9, 0.55 * fade);
        ctx.globalAlpha = 0.6 * fade;
        ctx.strokeStyle = b.color;
        ctx.lineWidth = b.r * 2.2;
        ctx.beginPath();
        ctx.moveTo(tx, ty);
        ctx.lineTo(b.x, b.y);
        ctx.stroke();
        ctx.globalAlpha = fade;
        ctx.strokeStyle = '#ffffff';
        ctx.lineWidth = b.r * 0.9;
        ctx.stroke();
      } else if (b.kind === 'bolt') {
        const l = Math.hypot(b.vx, b.vy) || 1;
        const tx = b.x - (b.vx / l) * 60;
        const ty = b.y - (b.vy / l) * 60;
        drawGlow(ctx, b.color, b.x, b.y, 60, 0.8);
        ctx.globalAlpha = 0.8;
        ctx.strokeStyle = '#b45cff';
        ctx.lineWidth = 9;
        ctx.beginPath();
        ctx.moveTo(tx, ty);
        ctx.lineTo(b.x, b.y);
        ctx.stroke();
        ctx.globalAlpha = 1;
        ctx.strokeStyle = '#ffffff';
        ctx.lineWidth = 3;
        ctx.stroke();
      } else {
        // orbe ennemi : très lisible (cœur blanc + anneau coloré)
        drawGlow(ctx, b.color, b.x, b.y, b.r * 7, 0.6 * fade);
        ctx.globalAlpha = fade;
        ctx.fillStyle = b.color;
        ctx.beginPath();
        ctx.arc(b.x, b.y, b.r, 0, TAU);
        ctx.fill();
        ctx.fillStyle = '#ffffff';
        ctx.beginPath();
        ctx.arc(b.x, b.y, b.r * 0.55, 0, TAU);
        ctx.fill();
      }
    }
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';
  }

  drawMissiles(ctx) {
    for (const m of this.missiles) {
      ctx.save();
      ctx.translate(m.x, m.y);
      ctx.rotate(m.angle);
      ctx.globalCompositeOperation = 'lighter';
      drawGlow(ctx, '#ffb347', -10, 0, 30 + Math.random() * 10, 0.9);
      drawGlow(ctx, m.color, 0, 0, 34, 0.5);
      ctx.globalCompositeOperation = 'source-over';
      ctx.globalAlpha = 1;
      ctx.fillStyle = '#0b0e1f';
      ctx.strokeStyle = m.color;
      ctx.lineWidth = 1.8;
      ctx.beginPath();
      ctx.moveTo(10, 0);
      ctx.lineTo(-7, 5);
      ctx.lineTo(-4, 0);
      ctx.lineTo(-7, -5);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
      ctx.restore();
    }
  }

  drawNovas(ctx) {
    ctx.globalCompositeOperation = 'lighter';
    for (const n of this.novas) {
      const k = n.r / n.max;
      ctx.globalAlpha = (1 - k) * 0.9;
      ctx.strokeStyle = n.color;
      ctx.lineWidth = 26 * (1 - k) + 3;
      ctx.beginPath();
      ctx.arc(n.x, n.y, n.r, 0, TAU);
      ctx.stroke();
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = 4 * (1 - k) + 1;
      ctx.stroke();
      ctx.globalAlpha = (1 - k) * 0.12;
      ctx.fillStyle = n.color;
      ctx.fill();
    }
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';
  }

  drawBeams(ctx) {
    ctx.globalCompositeOperation = 'lighter';
    ctx.lineCap = 'round';
    for (const b of this.beams) {
      const k = b.life / b.max;
      const w = b.w * (0.3 + 0.7 * k) * (1 + Math.sin(this.time * 80) * 0.1);
      ctx.globalAlpha = 0.35 * k;
      ctx.strokeStyle = b.color;
      ctx.lineWidth = w * 2.6;
      ctx.beginPath();
      ctx.moveTo(b.x1, b.y1);
      ctx.lineTo(b.x2, b.y2);
      ctx.stroke();
      ctx.globalAlpha = 0.8 * k;
      ctx.lineWidth = w;
      ctx.stroke();
      ctx.globalAlpha = k;
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = w * 0.35;
      ctx.stroke();
      drawGlow(ctx, b.color, b.x1, b.y1, 120 * k, k);
      drawGlow(ctx, '#ffffff', b.x2, b.y2, 140 * k, k);
    }
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';
  }

  drawPickups(ctx) {
    for (const pk of this.pickups) {
      const info = PICKUPS[pk.type];
      if (pk.life < 3 && Math.sin(pk.life * 20) < 0) continue;
      const bob = Math.sin(pk.t * 4) * 3;
      ctx.save();
      ctx.translate(pk.x, pk.y + bob);
      ctx.globalCompositeOperation = 'lighter';
      drawGlow(ctx, info.color, 0, 0, 70, 0.5 + Math.sin(pk.t * 6) * 0.15, true);
      ctx.globalCompositeOperation = 'source-over';
      ctx.globalAlpha = 1;
      ctx.rotate(pk.t * 1.5);
      ctx.fillStyle = '#0b0e1f';
      ctx.strokeStyle = info.color;
      ctx.lineWidth = 2.5;
      ctx.beginPath();
      ctx.moveTo(0, -pk.r);
      ctx.lineTo(pk.r, 0);
      ctx.lineTo(0, pk.r);
      ctx.lineTo(-pk.r, 0);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
      ctx.rotate(-pk.t * 1.5);
      ctx.fillStyle = info.color;
      if (pk.type === 'repair') {
        ctx.fillRect(-2.5, -7, 5, 14);
        ctx.fillRect(-7, -2.5, 14, 5);
      } else {
        ctx.beginPath();
        ctx.moveTo(2, -8);
        ctx.lineTo(-5, 1);
        ctx.lineTo(0, 1);
        ctx.lineTo(-2, 8);
        ctx.lineTo(5, -1);
        ctx.lineTo(0, -1);
        ctx.closePath();
        ctx.fill();
      }
      ctx.restore();
    }
  }
}

// Sol pré-rendu (dégradé radial) : évite un gros remplissage par frame
function makeFloor() {
  const cv = document.createElement('canvas');
  cv.width = 480;
  cv.height = 270;
  const g = cv.getContext('2d');
  const grad = g.createRadialGradient(240, 135, 30, 240, 135, 340);
  grad.addColorStop(0, '#0b0f24');
  grad.addColorStop(1, '#05060f');
  g.fillStyle = grad;
  g.fillRect(0, 0, 480, 270);
  return cv;
}
