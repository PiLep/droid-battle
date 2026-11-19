// Droïde jouable (humain ou bot) : déplacement, dash, tir, spéciales, rendu néon.
import { DASH, DROIDS, SPECIAL } from './config.js';
import { drawGlow } from './fx.js';
import { TAU, clamp, damp, rand, rotateTowards } from './utils.js';

export class Droid {
  constructor(game, classId, { team, color, x, y, controller, label = '', padIndex = null }) {
    this.game = game;
    this.cfg = DROIDS[classId];
    this.classId = classId;
    this.kind = 'droid';
    this.team = team;
    this.color = color;
    this.label = label;
    this.controller = controller;
    this.padIndex = padIndex;
    this.x = x;
    this.y = y;
    this.vx = 0;
    this.vy = 0;
    this.r = this.cfg.radius;
    this.mass = this.cfg.id === 'titan' ? 2 : 1;
    this.maxHp = this.cfg.hp;
    this.hp = this.maxHp;
    this.bodyAngle = x < 800 ? 0 : Math.PI;
    this.aim = this.bodyAngle;
    this.fireCd = 0;
    this.dashCd = 0;
    this.dashT = 0;
    this.dashDir = [1, 0];
    this.dashBuf = 0;
    this.special = 30;
    this.specialWasFull = false;
    this.invuln = 0;
    this.flash = 0;
    this.alive = true;
    this.barrel = 1;
    this.recoilK = 0;
    this.railCharge = 0;
    this.salvoLeft = 0;
    this.salvoT = 0;
    this.thrustT = 0;
    this.smokeT = 0;
    this.ghostT = 0;
    this.ghosts = [];
    this.t = rand(10);
    this.spawnT = 0.5; // anim d'apparition
    this.controls = { mx: 0, my: 0, fire: false };
    this.stunned = 0;
  }

  setClass(classId) {
    this.classId = classId;
    this.cfg = DROIDS[classId];
    this.r = this.cfg.radius;
    this.mass = classId === 'titan' ? 2 : 1;
    this.maxHp = this.cfg.hp;
    this.hp = this.maxHp;
  }

  get speedMul() {
    return this.railCharge > 0 ? 0.35 : 1;
  }

  update(dt) {
    const g = this.game;
    this.t += dt;
    this.spawnT = Math.max(0, this.spawnT - dt);
    this.flash = Math.max(0, this.flash - dt * 5);
    this.invuln = Math.max(0, this.invuln - dt);
    this.recoilK = damp(this.recoilK, 0, 14, dt);
    this.fireCd -= dt;
    this.dashCd -= dt;
    this.stunned = Math.max(0, this.stunned - dt);

    const c = g.inputLocked ? { mx: 0, my: 0, fire: false, dash: false, special: false } : this.controller.read(this, g);
    this.controls = c;

    // --- visée -------------------------------------------------------------
    let target = null;
    if (c.aim) target = Math.atan2(c.aim.y - this.y, c.aim.x - this.x);
    else if (c.aimDir) target = Math.atan2(c.aimDir[1], c.aimDir[0]);
    else {
      const foe = g.autoAimTarget(this);
      if (foe) target = Math.atan2(foe.y - this.y, foe.x - this.x);
      else if (Math.hypot(c.mx, c.my) > 0.2) target = Math.atan2(c.my, c.mx);
    }
    if (target !== null) {
      const turn = this.railCharge > 0 ? 2.2 : 16;
      this.aim = rotateTowards(this.aim, target, turn * dt);
    }

    // --- dash ----------------------------------------------------------------
    if (c.dash) this.dashBuf = DASH.buffer;
    this.dashBuf -= dt;
    if (this.dashBuf > 0 && this.dashCd <= 0 && this.dashT <= 0 && this.railCharge <= 0) this.startDash(c);

    // --- déplacement -----------------------------------------------------------
    if (this.dashT > 0) {
      this.dashT -= dt;
      this.vx = this.dashDir[0] * DASH.speed;
      this.vy = this.dashDir[1] * DASH.speed;
      this.ghostT -= dt;
      if (this.ghostT <= 0) {
        this.ghostT = 0.018;
        this.ghosts.push({ x: this.x, y: this.y, ba: this.bodyAngle, aa: this.aim, life: 0.22 });
      }
      if (this.dashT <= 0) {
        this.vx *= 0.35;
        this.vy *= 0.35;
      }
    } else {
      const sp = this.cfg.speed * this.speedMul * (this.stunned > 0 ? 0.4 : 1);
      const k = 1 - Math.exp(-this.cfg.accel * dt);
      this.vx += (c.mx * sp - this.vx) * k;
      this.vy += (c.my * sp - this.vy) * k;
    }
    this.x += this.vx * dt;
    this.y += this.vy * dt;
    g.arena.collideBody(this);

    const speed = Math.hypot(this.vx, this.vy);
    if (speed > 30) {
      const target2 = Math.atan2(this.vy, this.vx);
      this.bodyAngle = rotateTowards(this.bodyAngle, target2, 9 * dt);
    }

    // traînée des propulseurs + vague dans la grille
    this.thrustT -= dt;
    if (speed > 60 && this.thrustT <= 0) {
      this.thrustT = 0.03;
      const back = this.bodyAngle + Math.PI;
      const bx = this.x + Math.cos(back) * this.r * 0.9;
      const by = this.y + Math.sin(back) * this.r * 0.9;
      g.fx.glow(bx, by, 18 + speed * 0.03, this.color, 0.28, { vx: Math.cos(back) * 60, vy: Math.sin(back) * 60, grow: -20, alpha: 0.7 });
      g.grid.impulse(this.x, this.y, 60, speed * 0.004);
    }
    for (let i = this.ghosts.length - 1; i >= 0; i--) {
      this.ghosts[i].life -= dt;
      if (this.ghosts[i].life <= 0) this.ghosts.splice(i, 1);
    }

    // dégâts visibles quand les PV sont bas
    if (this.hp < this.maxHp * 0.35) {
      this.smokeT -= dt;
      if (this.smokeT <= 0) {
        this.smokeT = this.hp < this.maxHp * 0.15 ? 0.06 : 0.14;
        g.fx.smoke(this.x + rand(-8, 8), this.y + rand(-8, 8), 1, 9, 30, '#2a2d3a');
        if (Math.random() < 0.3) g.fx.sparks(this.x, this.y, 3, '#ffb347', 220);
      }
    }

    // --- tir -----------------------------------------------------------------
    if (c.fire && this.fireCd <= 0 && this.railCharge <= 0 && !g.inputLocked) this.shoot();

    // --- spéciale ---------------------------------------------------------------
    this.special = Math.min(SPECIAL.max, this.special + SPECIAL.passive * dt);
    const full = this.special >= SPECIAL.max;
    if (full && !this.specialWasFull && this.controller.human) {
      g.sfx('specialReady', { x: this.x });
      g.fx.ring(this.x, this.y, this.r, this.r * 3, 0.5, '#ffd23d', 3);
    }
    this.specialWasFull = full;
    if (c.special && full && this.railCharge <= 0 && this.salvoLeft <= 0) this.useSpecial();

    if (this.railCharge > 0) {
      this.railCharge -= dt;
      if (Math.random() < 0.6) {
        const a = rand(TAU);
        const mx = this.x + Math.cos(this.aim) * (this.r + 14);
        const my = this.y + Math.sin(this.aim) * (this.r + 14);
        g.fx.add({ t: 'spark', x: mx + Math.cos(a) * 40, y: my + Math.sin(a) * 40, vx: -Math.cos(a) * 300, vy: -Math.sin(a) * 300, life: 0.12, max: 0.12, color: '#ffffff', w: 1.5, len: 0.03, drag: 0 });
      }
      if (this.railCharge <= 0) g.fireRail(this);
    }
    if (this.salvoLeft > 0) {
      this.salvoT -= dt;
      if (this.salvoT <= 0) {
        this.salvoT = SPECIAL.salvo.interval;
        this.salvoLeft--;
        const side = this.salvoLeft % 2 ? 1 : -1;
        const a = this.aim + side * rand(0.9, 1.6);
        const ox = this.x + Math.cos(this.aim + side * 1.57) * 14;
        const oy = this.y + Math.sin(this.aim + side * 1.57) * 14;
        g.spawnMissile(this, ox, oy, a);
      }
    }
  }

  startDash(c) {
    const g = this.game;
    let dx = c.mx;
    let dy = c.my;
    if (Math.hypot(dx, dy) < 0.2) {
      dx = Math.cos(this.aim);
      dy = Math.sin(this.aim);
    }
    const l = Math.hypot(dx, dy);
    this.dashDir = [dx / l, dy / l];
    this.dashT = DASH.duration;
    this.dashCd = this.cfg.dashCd;
    this.dashBuf = 0;
    this.invuln = Math.max(this.invuln, DASH.duration + 0.06);
    g.sfx('dash', { x: this.x });
    g.fx.ring(this.x, this.y, this.r * 0.8, this.r * 2.4, 0.25, this.color, 2.5);
    g.fx.sparks(this.x, this.y, 8, this.color, 300, Math.atan2(-dy, -dx), 1.2);
    g.grid.impulse(this.x, this.y, 120, 14);
    g.rumble(this, 0.1, 0.4, 70);
  }

  shoot() {
    const g = this.game;
    const w = this.cfg.weapon;
    this.fireCd = w.interval;
    const a0 = this.aim;
    const cos = Math.cos(a0);
    const sin = Math.sin(a0);
    let ox = 0;
    let oy = 0;
    if (w.twin) {
      this.barrel = -this.barrel;
      ox = -sin * 7 * this.barrel;
      oy = cos * 7 * this.barrel;
    }
    const muzzle = this.r + 14;
    const mx = this.x + cos * muzzle + ox;
    const my = this.y + sin * muzzle + oy;
    for (let i = 0; i < w.count; i++) {
      const spread = w.count > 1 ? -w.spread / 2 + (w.spread * i) / (w.count - 1) + rand(-0.03, 0.03) : rand(-w.spread, w.spread) / 2;
      const a = a0 + spread;
      const sp = w.speed * (w.count > 1 ? rand(0.85, 1.1) : 1);
      g.spawnBullet({
        x: mx,
        y: my,
        vx: Math.cos(a) * sp + this.vx * 0.2,
        vy: Math.sin(a) * sp + this.vy * 0.2,
        r: w.radius,
        damage: w.damage,
        team: this.team,
        owner: this,
        life: w.life * (w.count > 1 ? rand(0.85, 1.1) : 1),
        color: this.color,
        knock: w.knock,
        kind: 'player',
        falloff: w.falloff || 0,
      });
    }
    this.vx -= cos * w.recoil * 12;
    this.vy -= sin * w.recoil * 12;
    this.recoilK = 1;
    g.fx.muzzle(mx, my, a0, this.color, w.count > 1 ? 1.8 : 1);
    g.sfx(w.sound, { x: this.x });
    if (w.count > 1) {
      g.addShake(0.12, this);
      g.grid.impulse(mx, my, 90, 10);
      g.rumble(this, 0.35, 0.2, 80);
    }
  }

  useSpecial() {
    const g = this.game;
    this.special = 0;
    const id = this.cfg.special.id;
    if (id === 'nova') g.spawnNova(this);
    else if (id === 'salvo') {
      this.salvoLeft = SPECIAL.salvo.count;
      this.salvoT = 0;
      g.sfx('missile', { x: this.x });
    } else if (id === 'rail') {
      this.railCharge = SPECIAL.rail.charge;
      g.sfx('railCharge', { x: this.x });
      g.fx.ring(this.x, this.y, 80, this.r, SPECIAL.rail.charge, '#ffffff', 2);
    }
    g.onSpecial?.(this);
  }

  // ---- rendu ---------------------------------------------------------------
  draw(ctx) {
    const g = this.game;
    const sp = this.spawnT > 0 ? 1 - this.spawnT / 0.5 : 1;
    const scale = sp < 1 ? 0.4 + 0.6 * sp + Math.sin(sp * Math.PI) * 0.25 : 1;

    // images rémanentes du dash
    ctx.globalCompositeOperation = 'lighter';
    for (const gh of this.ghosts) {
      ctx.globalAlpha = (gh.life / 0.22) * 0.35;
      drawBody(ctx, this.classId, gh.x, gh.y, this.r, gh.ba, gh.aa, this.color, 0, true, this.t);
    }
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';

    // ombre
    ctx.fillStyle = 'rgba(0,0,0,0.45)';
    ctx.beginPath();
    ctx.ellipse(this.x + 5, this.y + 9, this.r * 1.1 * scale, this.r * 0.8 * scale, 0, 0, TAU);
    ctx.fill();

    // halo
    ctx.globalCompositeOperation = 'lighter';
    const pulse = 0.8 + Math.sin(this.t * 4) * 0.1;
    drawGlow(ctx, this.color, this.x, this.y, this.r * 6 * scale, 0.22 * pulse, true);
    if (this.invuln > 0 && this.dashT <= 0) drawGlow(ctx, '#ffffff', this.x, this.y, this.r * 4, 0.25);
    ctx.globalCompositeOperation = 'source-over';
    ctx.globalAlpha = 1;

    // ligne de visée (télégraphe du rail)
    if (this.railCharge > 0) {
      const k = 1 - this.railCharge / SPECIAL.rail.charge;
      const len = g.arena.raycast(this.x, this.y, Math.cos(this.aim), Math.sin(this.aim));
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      ctx.strokeStyle = this.color;
      ctx.globalAlpha = 0.25 + k * 0.6 + Math.sin(this.t * 60) * 0.1;
      ctx.lineWidth = 1 + k * 4;
      ctx.setLineDash([18, 10]);
      ctx.lineDashOffset = -this.t * 300;
      ctx.beginPath();
      ctx.moveTo(this.x, this.y);
      ctx.lineTo(this.x + Math.cos(this.aim) * len, this.y + Math.sin(this.aim) * len);
      ctx.stroke();
      ctx.restore();
      drawGlow(ctx, '#ffffff', this.x + Math.cos(this.aim) * (this.r + 14), this.y + Math.sin(this.aim) * (this.r + 14), 30 + k * 60, 0.8);
    }

    const flash = this.flash > 0 ? this.flash : 0;
    drawBody(ctx, this.classId, this.x, this.y, this.r * scale, this.bodyAngle, this.aim, this.color, flash, false, this.t, this.recoilK);

    // indicateur d'équipe en duel
    if (this.label && g.mode !== 'arcade') {
      ctx.font = '700 13px Orbitron, sans-serif';
      ctx.textAlign = 'center';
      ctx.fillStyle = this.color;
      ctx.globalAlpha = 0.85;
      ctx.fillText(this.label, this.x, this.y - this.r - 18);
      ctx.globalAlpha = 1;
    }
    // mini-barres sous le droïde
    if (g.mode !== 'demo') {
      const w = this.r * 2.2;
      const x0 = this.x - w / 2;
      const y0 = this.y + this.r + 12;
      ctx.fillStyle = 'rgba(0,0,0,0.5)';
      ctx.fillRect(x0 - 1, y0 - 1, w + 2, 5);
      ctx.fillStyle = this.hp < this.maxHp * 0.3 ? '#ff4d5e' : '#3dff9a';
      ctx.fillRect(x0, y0, (w * this.hp) / this.maxHp, 3);
      const dashReady = clamp(1 - this.dashCd / this.cfg.dashCd, 0, 1);
      ctx.fillStyle = dashReady >= 1 ? this.color : 'rgba(255,255,255,0.3)';
      ctx.fillRect(x0, y0 + 5, w * dashReady, 2);
    }
  }
}

// Dessin vectoriel des châssis (partagé avec l'écran de sélection)
export function drawBody(ctx, classId, x, y, r, bodyAngle, aim, color, flash = 0, ghost = false, t = 0, recoil = 0) {
  ctx.save();
  ctx.translate(x, y);
  ctx.lineJoin = 'round';
  const dark = ghost ? color : '#0b0e1f';
  const lw = ghost ? 1.5 : 2.4;

  // --- châssis ---
  ctx.save();
  ctx.rotate(bodyAngle);
  ctx.fillStyle = dark;
  ctx.strokeStyle = color;
  ctx.lineWidth = lw;
  if (classId === 'titan') {
    // chenilles
    for (const s of [-1, 1]) {
      ctx.beginPath();
      ctx.roundRect(-r * 1.05, s * r * 0.62 - r * 0.28, r * 2.1, r * 0.56, 4);
      ctx.fill();
      ctx.stroke();
      if (!ghost) {
        ctx.save();
        ctx.globalAlpha = 0.5;
        ctx.lineWidth = 1.2;
        const off = (t * 40) % 8;
        for (let k = -r + off; k < r; k += 8) {
          ctx.beginPath();
          ctx.moveTo(k, s * r * 0.62 - r * 0.22);
          ctx.lineTo(k, s * r * 0.62 + r * 0.22);
          ctx.stroke();
        }
        ctx.restore();
      }
    }
    ctx.beginPath();
    ctx.roundRect(-r * 0.8, -r * 0.55, r * 1.6, r * 1.1, 6);
    ctx.fill();
    ctx.stroke();
  } else if (classId === 'viper') {
    ctx.beginPath();
    ctx.moveTo(r * 1.25, 0);
    ctx.lineTo(-r * 0.85, r * 0.95);
    ctx.lineTo(-r * 0.45, 0);
    ctx.lineTo(-r * 0.85, -r * 0.95);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    if (!ghost) {
      ctx.globalAlpha = 0.55;
      ctx.lineWidth = 1.2;
      ctx.beginPath();
      ctx.moveTo(r * 0.7, 0);
      ctx.lineTo(-r * 0.55, r * 0.6);
      ctx.moveTo(r * 0.7, 0);
      ctx.lineTo(-r * 0.55, -r * 0.6);
      ctx.stroke();
      ctx.globalAlpha = 1;
    }
  } else {
    // striker : hexagone + pods
    for (const s of [-1, 1]) {
      ctx.beginPath();
      ctx.roundRect(-r * 0.7, s * r * 0.95 - r * 0.22, r * 1.2, r * 0.44, 3);
      ctx.fill();
      ctx.stroke();
    }
    ctx.beginPath();
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * TAU;
      ctx.lineTo(Math.cos(a) * r * 0.95, Math.sin(a) * r * 0.95);
    }
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
  }
  // propulseurs
  if (!ghost) {
    ctx.globalCompositeOperation = 'lighter';
    const fl = 0.7 + Math.sin(t * 40) * 0.3;
    drawGlow(ctx, color, -r * 0.95, classId === 'viper' ? 0 : -r * 0.35, r * 1.1 * fl, 0.7);
    if (classId !== 'viper') drawGlow(ctx, color, -r * 0.95, r * 0.35, r * 1.1 * fl, 0.7);
    ctx.globalCompositeOperation = 'source-over';
    ctx.globalAlpha = 1;
  }
  ctx.restore();

  // --- tourelle ---
  ctx.save();
  ctx.rotate(aim);
  ctx.translate(-recoil * 4, 0);
  ctx.fillStyle = dark;
  ctx.strokeStyle = color;
  ctx.lineWidth = lw;
  if (classId === 'titan') {
    for (const s of [-1, 1]) {
      ctx.beginPath();
      ctx.roundRect(r * 0.2, s * 6 - 4.5, r * 0.95, 9, 2);
      ctx.fill();
      ctx.stroke();
    }
    ctx.beginPath();
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * TAU + Math.PI / 8;
      ctx.lineTo(Math.cos(a) * r * 0.55, Math.sin(a) * r * 0.55);
    }
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
  } else if (classId === 'viper') {
    for (const s of [-1, 1]) {
      ctx.beginPath();
      ctx.rect(r * 0.1, s * 7 - 2, r * 1.15, 4);
      ctx.fill();
      ctx.stroke();
    }
    ctx.beginPath();
    ctx.moveTo(r * 0.55, 0);
    ctx.lineTo(0, r * 0.42);
    ctx.lineTo(-r * 0.4, 0);
    ctx.lineTo(0, -r * 0.42);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
  } else {
    ctx.beginPath();
    ctx.roundRect(r * 0.15, -4, r * 1.3, 8, 2);
    ctx.fill();
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(0, 0, r * 0.52, 0, TAU);
    ctx.fill();
    ctx.stroke();
  }
  // œil / cœur lumineux
  if (!ghost) {
    ctx.globalCompositeOperation = 'lighter';
    drawGlow(ctx, color, r * 0.12, 0, r * 1.6, 0.9);
    ctx.globalCompositeOperation = 'source-over';
    ctx.globalAlpha = 1;
    ctx.fillStyle = '#ffffff';
    ctx.beginPath();
    ctx.arc(r * 0.12, 0, Math.max(2, r * 0.13), 0, TAU);
    ctx.fill();
  }
  ctx.restore();

  // flash d'impact
  if (flash > 0) {
    ctx.globalCompositeOperation = 'lighter';
    drawGlow(ctx, '#ffffff', 0, 0, r * 4, flash * 0.9);
    ctx.globalCompositeOperation = 'source-over';
    ctx.globalAlpha = flash * 0.8;
    ctx.fillStyle = '#ffffff';
    ctx.beginPath();
    ctx.arc(0, 0, r * 0.95, 0, TAU);
    ctx.fill();
    ctx.globalAlpha = 1;
  }
  ctx.restore();
}
