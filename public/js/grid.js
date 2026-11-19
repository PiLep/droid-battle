// Grille néon "élastique" en fond d'arène : se déforme sous les explosions et les passages.
export class SpringGrid {
  constructor(w, h, spacing = 50) {
    this.w = w;
    this.h = h;
    this.cols = Math.round(w / spacing) + 1;
    this.rows = Math.round(h / spacing) + 1;
    this.sx = w / (this.cols - 1);
    this.sy = h / (this.rows - 1);
    const n = this.cols * this.rows;
    this.ox = new Float32Array(n);
    this.oy = new Float32Array(n);
    this.vx = new Float32Array(n);
    this.vy = new Float32Array(n);
    this.acc = 0;
    this.energy = 0;
  }

  reset() {
    this.ox.fill(0);
    this.oy.fill(0);
    this.vx.fill(0);
    this.vy.fill(0);
  }

  // force radiale (strength > 0 : repousse, < 0 : aspire)
  impulse(x, y, radius, strength) {
    const { cols, rows, sx, sy } = this;
    const c0 = Math.max(1, Math.floor((x - radius) / sx));
    const c1 = Math.min(cols - 2, Math.ceil((x + radius) / sx));
    const r0 = Math.max(1, Math.floor((y - radius) / sy));
    const r1 = Math.min(rows - 2, Math.ceil((y + radius) / sy));
    const r2 = radius * radius;
    for (let r = r0; r <= r1; r++) {
      for (let c = c0; c <= c1; c++) {
        const i = r * cols + c;
        const px = c * sx + this.ox[i];
        const py = r * sy + this.oy[i];
        const dx = px - x;
        const dy = py - y;
        const d2 = dx * dx + dy * dy;
        if (d2 >= r2 || d2 < 1) continue;
        const d = Math.sqrt(d2);
        const f = strength * (1 - d / radius) ** 2;
        this.vx[i] += (dx / d) * f;
        this.vy[i] += (dy / d) * f;
      }
    }
  }

  update(dt) {
    this.acc = Math.min(this.acc + dt, 0.1);
    const step = 1 / 60;
    const { cols, rows, ox, oy, vx, vy } = this;
    while (this.acc >= step) {
      this.acc -= step;
      const k = 70; // rappel vers la position de repos
      const c = 40; // couplage avec les voisins
      const damp = Math.exp(-5.5 * step);
      for (let r = 1; r < rows - 1; r++) {
        for (let col = 1; col < cols - 1; col++) {
          const i = r * cols + col;
          const ax = (ox[i - 1] + ox[i + 1] + ox[i - cols] + ox[i + cols]) * 0.25 - ox[i];
          const ay = (oy[i - 1] + oy[i + 1] + oy[i - cols] + oy[i + cols]) * 0.25 - oy[i];
          vx[i] = (vx[i] + (-k * ox[i] + c * ax) * step) * damp;
          vy[i] = (vy[i] + (-k * oy[i] + c * ay) * step) * damp;
        }
      }
      for (let i = 0; i < ox.length; i++) {
        ox[i] += vx[i] * step;
        oy[i] += vy[i] * step;
      }
    }
  }

  draw(ctx, color, alpha) {
    const { cols, rows, sx, sy, ox, oy } = this;
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    ctx.strokeStyle = color;
    for (let pass = 0; pass < 2; pass++) {
      // passe 0 : lignes fines, passe 1 : lignes majeures (une sur 4)
      ctx.globalAlpha = pass === 0 ? alpha : alpha * 1.6;
      ctx.lineWidth = pass === 0 ? 1 : 1.6;
      ctx.beginPath();
      for (let r = 0; r < rows; r++) {
        if ((r % 4 === 0) !== (pass === 1)) continue;
        for (let c = 0; c < cols; c++) {
          const i = r * cols + c;
          const x = c * sx + ox[i];
          const y = r * sy + oy[i];
          if (c === 0) ctx.moveTo(x, y);
          else ctx.lineTo(x, y);
        }
      }
      for (let c = 0; c < cols; c++) {
        if ((c % 4 === 0) !== (pass === 1)) continue;
        for (let r = 0; r < rows; r++) {
          const i = r * cols + c;
          const x = c * sx + ox[i];
          const y = r * sy + oy[i];
          if (r === 0) ctx.moveTo(x, y);
          else ctx.lineTo(x, y);
        }
      }
      ctx.stroke();
    }
    // points d'intersection qui brillent quand la grille est déformée
    ctx.fillStyle = '#ffffff';
    for (let i = 0; i < ox.length; i++) {
      const d = Math.abs(ox[i]) + Math.abs(oy[i]);
      if (d < 3) continue;
      const c = i % cols;
      const r = (i / cols) | 0;
      ctx.globalAlpha = Math.min(0.5, d / 60);
      ctx.fillRect(c * sx + ox[i] - 1.5, r * sy + oy[i] - 1.5, 3, 3);
    }
    ctx.restore();
  }
}
