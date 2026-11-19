// Moteur audio 100 % synthétisé (Web Audio) : SFX + musique synthwave procédurale.
import { ARENA } from './config.js';
import { clamp, rand } from './utils.js';

const NOTE = (n) => 440 * 2 ** ((n - 69) / 12); // MIDI -> Hz

// Progression : Am - F - C - G (une mesure chacun)
const CHORDS = [
  [57, 60, 64],
  [53, 57, 60],
  [48, 52, 55],
  [55, 59, 62],
];

const THROTTLE = {
  smg: 0.045,
  blaster: 0.05,
  hit: 0.035,
  enemyShot: 0.05,
  spark: 0.04,
  explodeSmall: 0.04,
  pickup: 0.05,
  uiMove: 0.03,
};

class AudioEngine {
  constructor() {
    this.ctx = null;
    this.sfxVolume = 0.8;
    this.musicVolume = 0.5;
    this.muted = false;
    this.last = {};
    this.voices = 0;
    this.music = { playing: false, step: 0, nextTime: 0, intensity: 'menu', timer: null };
  }

  // Doit être appelé suite à un geste utilisateur
  unlock() {
    if (!this.ctx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return;
      this.ctx = new AC();
      const ctx = this.ctx;
      this.comp = ctx.createDynamicsCompressor();
      this.comp.threshold.value = -14;
      this.comp.knee.value = 18;
      this.comp.ratio.value = 4;
      this.comp.attack.value = 0.003;
      this.comp.release.value = 0.2;
      this.master = ctx.createGain();
      this.master.gain.value = 0.9;
      this.sfx = ctx.createGain();
      this.musicBus = ctx.createGain();
      this.sfx.connect(this.master);
      this.musicBus.connect(this.master);
      this.master.connect(this.comp).connect(ctx.destination);
      this.noiseBuf = this.makeNoise(2);
      this.layers = {};
      for (const name of ['pad', 'bass', 'drums', 'arp', 'lead']) {
        const g = ctx.createGain();
        g.gain.value = 0;
        g.connect(this.musicBus);
        this.layers[name] = g;
      }
      this.applyVolumes();
    }
    if (this.ctx.state === 'suspended') this.ctx.resume();
  }

  makeNoise(seconds) {
    const ctx = this.ctx;
    const buf = ctx.createBuffer(1, ctx.sampleRate * seconds, ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    return buf;
  }

  setVolumes(sfx, music) {
    this.sfxVolume = sfx;
    this.musicVolume = music;
    this.applyVolumes();
  }

  applyVolumes() {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    this.sfx.gain.setTargetAtTime(this.muted ? 0 : this.sfxVolume, t, 0.02);
    this.musicBus.gain.setTargetAtTime(this.muted ? 0 : this.musicVolume * 0.55, t, 0.05);
  }

  suspend() {
    this.ctx?.suspend();
  }

  resume() {
    if (this.ctx && this.ctx.state === 'suspended') this.ctx.resume();
  }

  // ---- primitives -----------------------------------------------------------
  out(x) {
    if (x === undefined || !this.ctx.createStereoPanner) return this.sfx;
    const p = this.ctx.createStereoPanner();
    p.pan.value = clamp((x / ARENA.w) * 2 - 1, -1, 1) * 0.65;
    p.connect(this.sfx);
    return p;
  }

  env(gainNode, t, attack, peak, decay, end = 0.0001) {
    const g = gainNode.gain;
    g.setValueAtTime(0.0001, t);
    g.exponentialRampToValueAtTime(Math.max(peak, 0.0002), t + attack);
    g.exponentialRampToValueAtTime(end, t + attack + decay);
  }

  tone({ type = 'sine', f0, f1 = f0, dur, vol, out, t, attack = 0.004, detune = 0, filter }) {
    const ctx = this.ctx;
    const o = ctx.createOscillator();
    o.type = type;
    o.detune.value = detune;
    o.frequency.setValueAtTime(f0, t);
    if (f1 !== f0) o.frequency.exponentialRampToValueAtTime(Math.max(f1, 1), t + dur);
    const g = ctx.createGain();
    this.env(g, t, attack, vol, dur);
    let node = o;
    if (filter) {
      const f = ctx.createBiquadFilter();
      f.type = filter.type || 'lowpass';
      f.frequency.setValueAtTime(filter.f0, t);
      if (filter.f1) f.frequency.exponentialRampToValueAtTime(filter.f1, t + dur);
      f.Q.value = filter.q ?? 1;
      o.connect(f);
      node = f;
    }
    node.connect(g).connect(out);
    o.start(t);
    o.stop(t + attack + dur + 0.05);
    this.track(o);
  }

  noise({ dur, vol, out, t, type = 'lowpass', f0 = 4000, f1 = f0, q = 1, attack = 0.002 }) {
    const ctx = this.ctx;
    const s = ctx.createBufferSource();
    s.buffer = this.noiseBuf;
    s.playbackRate.value = rand(0.9, 1.1);
    const f = ctx.createBiquadFilter();
    f.type = type;
    f.frequency.setValueAtTime(f0, t);
    if (f1 !== f0) f.frequency.exponentialRampToValueAtTime(Math.max(f1, 20), t + dur);
    f.Q.value = q;
    const g = ctx.createGain();
    this.env(g, t, attack, vol, dur);
    s.connect(f).connect(g).connect(out);
    s.start(t, rand(0, 1));
    s.stop(t + attack + dur + 0.05);
    this.track(s);
  }

  track(node) {
    this.voices++;
    node.onended = () => this.voices--;
  }

  // ---- SFX ------------------------------------------------------------------
  play(name, opts = {}) {
    if (!this.ctx || this.muted || this.ctx.state !== 'running') return;
    const now = this.ctx.currentTime;
    const th = THROTTLE[name];
    if (th && this.last[name] && now - this.last[name] < th) return;
    if (this.voices > 90 && !opts.force) return;
    this.last[name] = now;
    const fn = SFX[name];
    if (fn) fn(this, now, this.out(opts.x), opts.vol ?? 1, opts.pitch ?? 1);
  }

  // ---- Musique --------------------------------------------------------------
  startMusic() {
    if (!this.ctx || this.music.playing) return;
    this.music.playing = true;
    this.music.step = 0;
    this.music.nextTime = this.ctx.currentTime + 0.1;
    this.music.timer = setInterval(() => this.schedule(), 25);
    this.setIntensity(this.music.intensity, true);
  }

  stopMusic() {
    clearInterval(this.music.timer);
    this.music.playing = false;
  }

  setIntensity(level, force) {
    if (!this.ctx) {
      this.music.intensity = level;
      return;
    }
    if (!force && this.music.intensity === level) return;
    this.music.intensity = level;
    const mix = {
      menu: { pad: 0.5, bass: 0.55, drums: 0.25, arp: 0.18, lead: 0 },
      game: { pad: 0.35, bass: 0.8, drums: 0.85, arp: 0.35, lead: 0 },
      boss: { pad: 0.3, bass: 0.95, drums: 1, arp: 0.45, lead: 0.4 },
      calm: { pad: 0.45, bass: 0.3, drums: 0, arp: 0.15, lead: 0 },
    }[level];
    const t = this.ctx.currentTime;
    for (const k in mix) this.layers[k].gain.setTargetAtTime(mix[k], t, 0.6);
  }

  schedule() {
    const ctx = this.ctx;
    const spb = 60 / 116 / 4; // durée d'une double croche
    while (this.music.nextTime < ctx.currentTime + 0.15) {
      this.playStep(this.music.step, this.music.nextTime, spb);
      this.music.nextTime += spb;
      this.music.step = (this.music.step + 1) % 64;
    }
  }

  playStep(step, t, spb) {
    const bar = Math.floor(step / 16);
    const s = step % 16;
    const chord = CHORDS[bar];
    const L = this.layers;
    // Pad : accord tenu en début de mesure
    if (s === 0) {
      for (const n of chord) {
        for (const det of [-9, 9]) {
          this.tone({ type: 'sawtooth', f0: NOTE(n), dur: spb * 16, vol: 0.035, out: L.pad, t, attack: 0.5, detune: det, filter: { f0: 900, q: 0.7 } });
        }
      }
    }
    // Basse : croches octaviées
    if (s % 2 === 0) {
      const root = chord[0] - 24 + (s % 8 === 6 ? 12 : 0);
      this.tone({ type: 'sawtooth', f0: NOTE(root), dur: spb * 1.7, vol: 0.16, out: L.bass, t, filter: { f0: 1400, f1: 180, q: 6 } });
    }
    // Batterie
    if (s % 4 === 0) {
      this.tone({ type: 'sine', f0: 140, f1: 38, dur: 0.22, vol: 0.55, out: L.drums, t });
    }
    if (s === 4 || s === 12) {
      this.noise({ dur: 0.16, vol: 0.22, out: L.drums, t, type: 'bandpass', f0: 1800, q: 0.8 });
      this.tone({ type: 'triangle', f0: 220, f1: 120, dur: 0.08, vol: 0.12, out: L.drums, t });
    }
    if (s % 2 === 1 || (this.music.intensity === 'boss' && s % 1 === 0)) {
      this.noise({ dur: 0.035, vol: s % 4 === 2 ? 0.08 : 0.05, out: L.drums, t, type: 'highpass', f0: 7500 });
    }
    // Arpège
    const arpNotes = [...chord, chord[0] + 12];
    const pattern = [0, 1, 2, 3, 2, 1, 0, 2];
    const n = arpNotes[pattern[s % 8]] + 12;
    this.tone({ type: 'square', f0: NOTE(n), dur: spb * 0.9, vol: 0.03, out: L.arp, t, filter: { f0: 2600, f1: 900, q: 2 } });
    // Lead (boss) : motif menaçant
    if (s % 8 === 0) {
      const leadN = chord[s === 0 ? 2 : 1] + 12;
      this.tone({ type: 'sawtooth', f0: NOTE(leadN), f1: NOTE(leadN - 1), dur: spb * 6, vol: 0.05, out: L.lead, t, attack: 0.05, filter: { f0: 2200, q: 3 } });
    }
  }
}

// Bibliothèque de sons : (audio, t, out, vol, pitch)
const SFX = {
  blaster(a, t, out, v, p) {
    a.tone({ type: 'square', f0: 1250 * p, f1: 210 * p, dur: 0.09, vol: 0.09 * v, out, t, filter: { f0: 4000, f1: 900 } });
    a.tone({ type: 'sine', f0: 320 * p, f1: 90, dur: 0.07, vol: 0.12 * v, out, t });
  },
  smg(a, t, out, v, p) {
    const pp = p * rand(0.92, 1.08);
    a.tone({ type: 'triangle', f0: 1700 * pp, f1: 520 * pp, dur: 0.045, vol: 0.075 * v, out, t });
    a.noise({ dur: 0.03, vol: 0.05 * v, out, t, type: 'highpass', f0: 3000 });
  },
  scatter(a, t, out, v) {
    a.noise({ dur: 0.26, vol: 0.32 * v, out, t, f0: 3500, f1: 250, q: 0.8 });
    a.tone({ type: 'sine', f0: 150, f1: 38, dur: 0.24, vol: 0.4 * v, out, t });
    a.tone({ type: 'square', f0: 420, f1: 90, dur: 0.07, vol: 0.06 * v, out, t });
  },
  enemyShot(a, t, out, v, p) {
    a.tone({ type: 'sine', f0: 640 * p, f1: 260 * p, dur: 0.1, vol: 0.07 * v, out, t });
  },
  lancerCharge(a, t, out, v) {
    a.tone({ type: 'sawtooth', f0: 180, f1: 1300, dur: 0.9, vol: 0.04 * v, out, t, attack: 0.05, filter: { f0: 600, f1: 3500, q: 4 } });
  },
  lancerShot(a, t, out, v) {
    a.tone({ type: 'sawtooth', f0: 2400, f1: 300, dur: 0.18, vol: 0.12 * v, out, t, filter: { f0: 5000, f1: 800 } });
    a.noise({ dur: 0.1, vol: 0.1 * v, out, t, type: 'highpass', f0: 2500 });
  },
  hit(a, t, out, v, p) {
    a.noise({ dur: 0.045, vol: 0.12 * v, out, t, type: 'bandpass', f0: 2600 * p, q: 1.5 });
    a.tone({ type: 'square', f0: 260 * p, f1: 120, dur: 0.04, vol: 0.05 * v, out, t });
  },
  spark(a, t, out, v) {
    a.noise({ dur: 0.04, vol: 0.05 * v, out, t, type: 'highpass', f0: 5000 });
  },
  hurt(a, t, out, v) {
    a.tone({ type: 'sawtooth', f0: 260, f1: 70, dur: 0.18, vol: 0.18 * v, out, t, filter: { f0: 1800, f1: 300 } });
    a.noise({ dur: 0.12, vol: 0.16 * v, out, t, f0: 2500, f1: 400 });
  },
  shieldHit(a, t, out, v) {
    a.tone({ type: 'sine', f0: 1800, f1: 900, dur: 0.12, vol: 0.08 * v, out, t });
  },
  explodeSmall(a, t, out, v) {
    a.noise({ dur: 0.45, vol: 0.4 * v, out, t, f0: 2600, f1: 120, q: 0.9 });
    a.tone({ type: 'sine', f0: 120, f1: 32, dur: 0.4, vol: 0.45 * v, out, t });
  },
  explodeBig(a, t, out, v) {
    a.noise({ dur: 1.3, vol: 0.6 * v, out, t, f0: 3200, f1: 60, q: 0.7 });
    a.noise({ dur: 0.25, vol: 0.3 * v, out, t, type: 'highpass', f0: 2500 });
    a.tone({ type: 'sine', f0: 95, f1: 22, dur: 1.1, vol: 0.75 * v, out, t });
    a.tone({ type: 'sawtooth', f0: 70, f1: 25, dur: 0.6, vol: 0.12 * v, out, t, filter: { f0: 400 } });
  },
  dash(a, t, out, v) {
    a.noise({ dur: 0.2, vol: 0.2 * v, out, t, type: 'bandpass', f0: 500, f1: 3200, q: 1.2, attack: 0.02 });
    a.tone({ type: 'sine', f0: 300, f1: 700, dur: 0.12, vol: 0.06 * v, out, t });
  },
  specialReady(a, t, out, v) {
    [0, 4, 7, 12].forEach((s, i) => a.tone({ type: 'triangle', f0: NOTE(76 + s), dur: 0.14, vol: 0.08 * v, out, t: t + i * 0.055 }));
  },
  nova(a, t, out, v) {
    a.tone({ type: 'sine', f0: 60, f1: 18, dur: 1.2, vol: 0.9 * v, out, t });
    a.noise({ dur: 0.9, vol: 0.5 * v, out, t, f0: 6000, f1: 150, q: 0.6 });
    a.tone({ type: 'sawtooth', f0: 1600, f1: 80, dur: 0.6, vol: 0.12 * v, out, t, filter: { f0: 3000, f1: 200 } });
  },
  railCharge(a, t, out, v) {
    a.tone({ type: 'sawtooth', f0: 220, f1: 2400, dur: 0.38, vol: 0.12 * v, out, t, attack: 0.02, filter: { f0: 800, f1: 6000, q: 6 } });
    a.tone({ type: 'sine', f0: 110, f1: 880, dur: 0.38, vol: 0.12 * v, out, t });
  },
  railFire(a, t, out, v) {
    a.noise({ dur: 0.7, vol: 0.55 * v, out, t, f0: 9000, f1: 200, q: 0.5 });
    a.tone({ type: 'sawtooth', f0: 3000, f1: 60, dur: 0.5, vol: 0.2 * v, out, t, filter: { f0: 7000, f1: 300 } });
    a.tone({ type: 'sine', f0: 80, f1: 25, dur: 0.6, vol: 0.6 * v, out, t });
  },
  missile(a, t, out, v) {
    a.noise({ dur: 0.18, vol: 0.1 * v, out, t, type: 'bandpass', f0: 1200, f1: 400, q: 2 });
    a.tone({ type: 'square', f0: 600, f1: 1100, dur: 0.08, vol: 0.03 * v, out, t });
  },
  pickup(a, t, out, v) {
    [0, 7, 12].forEach((s, i) => a.tone({ type: 'sine', f0: NOTE(79 + s), dur: 0.12, vol: 0.12 * v, out, t: t + i * 0.05 }));
  },
  warp(a, t, out, v) {
    a.tone({ type: 'sine', f0: 140, f1: 900, dur: 0.6, vol: 0.05 * v, out, t, attack: 0.1 });
  },
  kamikaze(a, t, out, v) {
    a.tone({ type: 'square', f0: 1400, dur: 0.05, vol: 0.04 * v, out, t });
  },
  waveStart(a, t, out, v) {
    [57, 64, 69].forEach((n) => a.tone({ type: 'sawtooth', f0: NOTE(n), dur: 0.9, vol: 0.06 * v, out, t, attack: 0.02, filter: { f0: 3000, f1: 400 } }));
    a.tone({ type: 'sine', f0: 110, f1: 40, dur: 0.5, vol: 0.4 * v, out, t });
  },
  waveClear(a, t, out, v) {
    [69, 72, 76, 81].forEach((n, i) => a.tone({ type: 'triangle', f0: NOTE(n), dur: 0.25, vol: 0.09 * v, out, t: t + i * 0.08 }));
  },
  bossAlarm(a, t, out, v) {
    for (let i = 0; i < 3; i++) {
      a.tone({ type: 'sawtooth', f0: 330, f1: 220, dur: 0.38, vol: 0.12 * v, out, t: t + i * 0.45, filter: { f0: 1600 } });
    }
  },
  countdown(a, t, out, v) {
    a.tone({ type: 'square', f0: 660, dur: 0.12, vol: 0.08 * v, out, t, filter: { f0: 2500 } });
  },
  fight(a, t, out, v) {
    [69, 73, 76].forEach((n) => a.tone({ type: 'sawtooth', f0: NOTE(n), dur: 0.6, vol: 0.08 * v, out, t, filter: { f0: 4000, f1: 600 } }));
    a.tone({ type: 'sine', f0: 160, f1: 40, dur: 0.4, vol: 0.5 * v, out, t });
  },
  ko(a, t, out, v) {
    a.tone({ type: 'sawtooth', f0: 400, f1: 50, dur: 1.4, vol: 0.18 * v, out, t, filter: { f0: 2000, f1: 100 } });
  },
  comboUp(a, t, out, v, p) {
    a.tone({ type: 'triangle', f0: 880 * p, f1: 1320 * p, dur: 0.12, vol: 0.08 * v, out, t });
  },
  uiMove(a, t, out, v) {
    a.tone({ type: 'square', f0: 900, dur: 0.03, vol: 0.03 * v, out, t, filter: { f0: 3000 } });
  },
  uiSelect(a, t, out, v) {
    a.tone({ type: 'square', f0: 660, f1: 1320, dur: 0.09, vol: 0.05 * v, out, t, filter: { f0: 4000 } });
  },
  uiBack(a, t, out, v) {
    a.tone({ type: 'square', f0: 700, f1: 350, dur: 0.08, vol: 0.04 * v, out, t, filter: { f0: 3000 } });
  },
};

export const audio = new AudioEngine();
