// IA de duel : contrôle un droïde jouable comme le ferait un humain (même interface de commandes).
import { SPECIAL } from './config.js';
import { angleDiff, chance, clamp, rand, smoothNoise } from './utils.js';

const LEVELS = {
  easy: { reaction: 0.34, aimErr: 0.2, lead: 0.2, dodge: 0.2, trigger: 0.55, dashDodge: 0.1 },
  normal: { reaction: 0.2, aimErr: 0.09, lead: 0.55, dodge: 0.55, trigger: 0.8, dashDodge: 0.35 },
  hard: { reaction: 0.1, aimErr: 0.035, lead: 0.9, dodge: 0.85, trigger: 0.95, dashDodge: 0.7 },
};

const PREFERRED_RANGE = { striker: 330, titan: 210, viper: 400 };

export class BotController {
  constructor(level = 'normal') {
    this.level = level;
    this.p = LEVELS[level] || LEVELS.normal;
    this.human = false;
    this.think = 0;
    this.strafe = chance(0.5) ? 1 : -1;
    this.strafeT = rand(1, 2.5);
    this.move = [0, 0];
    this.dodge = null;
    this.dodgeT = 0;
    this.seed = rand(100);
    this.fireHold = 0;
    this.wantDash = false;
    this.goal = null;
  }

  read(me, g) {
    const dt = g.dt;
    const foe = g.opponentOf(me);
    const out = { mx: 0, my: 0, aim: null, aimDir: null, fire: false, dash: false, special: false };
    if (!foe || !foe.alive) return out;
    const p = this.p;
    const dx = foe.x - me.x;
    const dy = foe.y - me.y;
    const d = Math.hypot(dx, dy) || 1;
    const los = g.arena.lineOfSight(me.x, me.y, foe.x, foe.y, 5);

    // --- décisions (au rythme du temps de réaction) ---------------------------
    this.think -= dt;
    this.strafeT -= dt;
    if (this.strafeT <= 0) {
      this.strafe = -this.strafe;
      this.strafeT = rand(0.9, 2.6);
    }
    if (this.think <= 0) {
      this.think = p.reaction * rand(0.7, 1.3);
      this.decide(me, foe, g, d, dx, dy, los);
    }

    // --- esquive des projectiles ------------------------------------------------
    this.dodgeT -= dt;
    if (this.dodgeT <= 0) this.dodge = null;
    let threat = null;
    for (const b of g.bullets) {
      if (b.team === me.team) continue;
      const rx = me.x - b.x;
      const ry = me.y - b.y;
      const v2 = b.vx * b.vx + b.vy * b.vy;
      const t = (rx * b.vx + ry * b.vy) / v2;
      if (t < 0 || t > 0.5) continue;
      const cx = b.x + b.vx * t - me.x;
      const cy = b.y + b.vy * t - me.y;
      if (cx * cx + cy * cy < (me.r + b.r + 14) ** 2) {
        if (!threat || t < threat.t) threat = { b, t };
      }
    }
    for (const m of g.missiles) {
      if (m.team === me.team) continue;
      if (Math.hypot(m.x - me.x, m.y - me.y) < 140 && (!threat || threat.t > 0.2)) threat = { b: m, t: 0.2 };
    }
    if (threat && !this.dodge && chance(p.dodge * dt * 12)) {
      const b = threat.b;
      const l = Math.hypot(b.vx, b.vy) || 1;
      let px = -b.vy / l;
      let py = b.vx / l;
      if (px * (me.x - b.x) + py * (me.y - b.y) < 0) {
        px = -px;
        py = -py;
      }
      this.dodge = [px, py];
      this.dodgeT = 0.3;
      if (threat.t < 0.18 && chance(p.dashDodge) && me.dashCd <= 0) this.wantDash = true;
    }

    // --- mouvement ---------------------------------------------------------------
    let [mx, my] = this.dodge || this.move;
    // évite murs et obstacles
    [mx, my] = avoid(me, g, mx, my);
    out.mx = mx;
    out.my = my;
    if (this.wantDash) {
      out.dash = true;
      this.wantDash = false;
    }

    // --- visée avec anticipation et erreur --------------------------------------
    const bulletSpeed = me.cfg.weapon.speed;
    const tLead = (d / bulletSpeed) * p.lead;
    const ax = foe.x + foe.vx * tLead;
    const ay = foe.y + foe.vy * tLead;
    const err = smoothNoise(g.time * 1.7 + this.seed) * p.aimErr * 2;
    const baseA = Math.atan2(ay - me.y, ax - me.x) + err;
    out.aim = { x: me.x + Math.cos(baseA) * 300, y: me.y + Math.sin(baseA) * 300 };

    // --- tir ---------------------------------------------------------------------
    const range = me.cfg.weapon.speed * me.cfg.weapon.life;
    const facing = Math.abs(angleDiff(me.aim, baseA)) < 0.25;
    if (los && facing && d < range * 1.05) {
      this.fireHold -= dt;
      if (this.fireHold <= 0) {
        this.fireHold = 0.25;
        this.firing = chance(p.trigger);
      }
      out.fire = this.firing;
    }

    // --- spéciale ------------------------------------------------------------------
    if (me.special >= SPECIAL.max && foe.invuln <= 0) {
      const id = me.cfg.special.id;
      if (id === 'nova' && d < SPECIAL.nova.radius * 0.8) out.special = true;
      if (id === 'salvo' && los && d < 750) out.special = true;
      if (id === 'rail' && los && facing && d < 1100 && Math.hypot(foe.vx, foe.vy) < 200) out.special = true;
    }
    return out;
  }

  decide(me, foe, g, d, dx, dy, los) {
    const want = PREFERRED_RANGE[me.classId] || 320;
    const nx = dx / d;
    const ny = dy / d;
    // ramassage de bonus si besoin
    const needRepair = me.hp < me.maxHp * 0.5;
    const needEnergy = me.special < SPECIAL.max * 0.6;
    let goal = null;
    for (const pk of g.pickups) {
      if ((pk.type === 'repair' && needRepair) || (pk.type === 'energy' && needEnergy)) {
        const dd = Math.hypot(pk.x - me.x, pk.y - me.y);
        if (dd < 500 && (!goal || dd < goal.d)) goal = { x: pk.x, y: pk.y, d: dd };
      }
    }
    if (goal) {
      this.move = this.pathTo(me, g, goal);
      return;
    }
    if (!los) {
      g.arena.updateFlow(foe, 1, `bot-${me.team}`);
      this.move = g.arena.flowDir(me.x, me.y, `bot-${me.team}`) || [nx, ny];
      return;
    }
    // orbite autour de l'adversaire en gérant la distance
    const radial = clamp((d - want) / 150, -1, 1);
    const sx = -ny * this.strafe;
    const sy = nx * this.strafe;
    let mx = sx * (1 - Math.abs(radial) * 0.6) + nx * radial;
    let my = sy * (1 - Math.abs(radial) * 0.6) + ny * radial;
    const l = Math.hypot(mx, my) || 1;
    mx /= l;
    my /= l;
    this.move = [mx, my];
    // titan : fonce au contact
    if (me.classId === 'titan' && d > want + 120 && me.dashCd <= 0 && chance(0.25)) this.wantDash = true;
  }

  pathTo(me, g, goal) {
    if (g.arena.lineOfSight(me.x, me.y, goal.x, goal.y, me.r)) {
      const l = Math.hypot(goal.x - me.x, goal.y - me.y) || 1;
      return [(goal.x - me.x) / l, (goal.y - me.y) / l];
    }
    g.arena.updateFlow(goal, 1, `bot-goal-${me.team}`);
    return g.arena.flowDir(me.x, me.y, `bot-goal-${me.team}`) || [0, 0];
  }
}

// Dévie la direction pour ne pas foncer dans un obstacle ou coller aux murs
function avoid(me, g, mx, my) {
  if (!mx && !my) return [0, 0];
  const look = me.r + 46;
  const tries = [0, 0.6, -0.6, 1.2, -1.2, 1.8, -1.8];
  for (const a of tries) {
    const c = Math.cos(a);
    const s = Math.sin(a);
    const x = mx * c - my * s;
    const y = mx * s + my * c;
    if (!g.arena.solidAt(me.x + x * look, me.y + y * look, me.r * 0.6)) return [x, y];
  }
  return [-mx, -my];
}
