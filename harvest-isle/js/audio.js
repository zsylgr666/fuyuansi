// 全部音效与音乐都用 WebAudio 实时合成，不依赖音频文件
const NOTE = (n) => 440 * Math.pow(2, (n - 69) / 12);
const CHORDS = [[48, 52, 55], [45, 48, 52], [41, 45, 48], [43, 47, 50]];
const SCALE = [72, 74, 76, 79, 81, 84, 86, 88];

class Sound {
  constructor() {
    this.ctx = null;
    this.sfxOn = true;
    this.musicOn = true;
  }
  init() {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') this.ctx.resume();
      return;
    }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    const ctx = (this.ctx = new AC());
    this.master = ctx.createGain();
    this.master.gain.value = 0.85;
    const comp = ctx.createDynamicsCompressor();
    this.master.connect(comp).connect(ctx.destination);
    this.sfx = ctx.createGain();
    this.sfx.gain.value = this.sfxOn ? 0.7 : 0;
    this.sfx.connect(this.master);
    this.music = ctx.createGain();
    this.music.gain.value = this.musicOn ? 0.22 : 0;
    this.music.connect(this.master);
    this.amb = ctx.createGain();
    this.amb.gain.value = this.sfxOn ? 0.5 : 0;
    this.amb.connect(this.master);
    const len = ctx.sampleRate * 2;
    this.noiseBuf = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = this.noiseBuf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    this.rainGain = this.loopNoise('lowpass', 1400, 0);
    this.waveGain = this.loopNoise('lowpass', 420, 0.12);
    this.step = 0;
    this.nextT = ctx.currentTime + 0.3;
    this.melody = this.makeMelody();
    this.timer = setInterval(() => this.schedule(), 60);
    this.night = 0;
    this.rain = 0;
    this.ambT = 0;
  }
  setSfx(on) {
    this.sfxOn = on;
    if (this.ctx) {
      this.sfx.gain.setTargetAtTime(on ? 0.7 : 0, this.ctx.currentTime, 0.05);
      this.amb.gain.setTargetAtTime(on ? 0.5 : 0, this.ctx.currentTime, 0.05);
    }
  }
  setMusic(on) {
    this.musicOn = on;
    if (this.ctx) this.music.gain.setTargetAtTime(on ? 0.22 : 0, this.ctx.currentTime, 0.1);
  }
  loopNoise(type, freq, vol) {
    const src = this.ctx.createBufferSource();
    src.buffer = this.noiseBuf;
    src.loop = true;
    const f = this.ctx.createBiquadFilter();
    f.type = type;
    f.frequency.value = freq;
    const g = this.ctx.createGain();
    g.gain.value = vol;
    src.connect(f).connect(g).connect(this.amb);
    src.start();
    return g;
  }
  tone(freq, dur, o = {}) {
    if (!this.ctx) return;
    const { type = 'sine', vol = 0.3, at = 0.005, slide = null, delay = 0, out = this.sfx, curve = 'exp' } = o;
    const t = this.ctx.currentTime + delay;
    const osc = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t);
    if (slide) osc.frequency.exponentialRampToValueAtTime(slide, t + dur);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(vol, t + at);
    if (curve === 'exp') g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    else g.gain.linearRampToValueAtTime(0, t + dur);
    osc.connect(g).connect(out);
    osc.start(t);
    osc.stop(t + dur + 0.05);
  }
  noise(dur, o = {}) {
    if (!this.ctx) return;
    const { freq = 1200, q = 1, type = 'bandpass', vol = 0.3, slide = null, delay = 0, out = this.sfx } = o;
    const t = this.ctx.currentTime + delay;
    const src = this.ctx.createBufferSource();
    src.buffer = this.noiseBuf;
    const f = this.ctx.createBiquadFilter();
    f.type = type;
    f.Q.value = q;
    f.frequency.setValueAtTime(freq, t);
    if (slide) f.frequency.exponentialRampToValueAtTime(slide, t + dur);
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(f).connect(g).connect(out);
    src.start(t, Math.random());
    src.stop(t + dur + 0.05);
  }

  /* ---------- 音效 ---------- */
  play(name) {
    if (!this.ctx || !this.sfxOn) return;
    const T = (f, d, o) => this.tone(f, d, o);
    switch (name) {
      case 'click': T(880, 0.06, { type: 'triangle', vol: 0.18 }); break;
      case 'open': T(520, 0.08, { type: 'triangle', vol: 0.18, slide: 900 }); T(1040, 0.1, { type: 'sine', vol: 0.08, delay: 0.05 }); break;
      case 'close': T(700, 0.08, { type: 'triangle', vol: 0.15, slide: 420 }); break;
      case 'plant': T(320, 0.12, { vol: 0.35, slide: 140 }); this.noise(0.1, { freq: 900, vol: 0.12, delay: 0.02 }); T(660, 0.08, { type: 'triangle', vol: 0.1, delay: 0.08 }); break;
      case 'harvest': [72, 76, 79, 84].forEach((n, i) => T(NOTE(n), 0.22, { type: 'triangle', vol: 0.2, delay: i * 0.06 })); T(NOTE(96), 0.3, { vol: 0.06, delay: 0.24 }); break;
      case 'coin': T(1318, 0.07, { type: 'square', vol: 0.06 }); T(1975, 0.22, { type: 'square', vol: 0.05, delay: 0.07 }); break;
      case 'water': this.noise(0.6, { freq: 2400, q: 0.8, vol: 0.18, slide: 900 }); for (let i = 0; i < 5; i++) T(1200 + Math.random() * 1400, 0.05, { vol: 0.05, delay: 0.1 + i * 0.09 }); break;
      case 'weed': this.noise(0.12, { freq: 3200, q: 0.6, vol: 0.22, type: 'highpass' }); this.noise(0.14, { freq: 2600, q: 0.6, vol: 0.18, type: 'highpass', delay: 0.18 }); break;
      case 'bug': this.noise(0.5, { freq: 5000, q: 0.5, vol: 0.12, type: 'highpass' }); T(900, 0.25, { type: 'sawtooth', vol: 0.05, slide: 120, delay: 0.3 }); break;
      case 'fert': [64, 67, 71, 76, 79].forEach((n, i) => T(NOTE(n + 12), 0.25, { vol: 0.08, delay: i * 0.05 })); this.noise(0.3, { freq: 6000, vol: 0.05, type: 'highpass', delay: 0.1 }); break;
      case 'shovel': this.noise(0.18, { freq: 500, q: 1.2, vol: 0.35 }); T(180, 0.15, { vol: 0.25, slide: 90 }); break;
      case 'error': T(220, 0.14, { type: 'square', vol: 0.08 }); T(180, 0.18, { type: 'square', vol: 0.08, delay: 0.1 }); break;
      case 'tick': T(1600, 0.03, { type: 'square', vol: 0.05 }); break;
      case 'unlock': [60, 64, 67, 72, 76].forEach((n, i) => T(NOTE(n), 0.3, { type: 'triangle', vol: 0.16, delay: i * 0.07 })); this.noise(0.4, { freq: 400, vol: 0.2 }); break;
      case 'levelup':
        [60, 64, 67, 72].forEach((n, i) => T(NOTE(n), 0.18, { type: 'square', vol: 0.06, delay: i * 0.1 }));
        [72, 76, 79, 84].forEach((n) => T(NOTE(n), 1.2, { type: 'triangle', vol: 0.12, delay: 0.42, at: 0.02 }));
        T(NOTE(96), 0.9, { vol: 0.05, delay: 0.5 });
        break;
      case 'reward': [76, 79, 83, 88].forEach((n, i) => T(NOTE(n), 0.35, { type: 'triangle', vol: 0.14, delay: i * 0.08 })); break;
      case 'bark':
        for (let i = 0; i < 2; i++) {
          T(520, 0.12, { type: 'sawtooth', vol: 0.12, slide: 260, delay: i * 0.2 });
          this.noise(0.1, { freq: 900, q: 2, vol: 0.12, delay: i * 0.2 });
        }
        break;
      case 'steal': [79, 76, 72].forEach((n, i) => T(NOTE(n), 0.12, { type: 'triangle', vol: 0.14, delay: i * 0.09 })); T(NOTE(84), 0.2, { vol: 0.08, delay: 0.3 }); break;
      case 'bite': this.play('bark'); T(160, 0.3, { type: 'square', vol: 0.08, slide: 80, delay: 0.3 }); break;
      case 'whoosh': this.noise(0.45, { freq: 300, q: 0.7, vol: 0.25, slide: 2400 }); break;
      case 'pop': T(600, 0.08, { vol: 0.2, slide: 1200 }); break;
    }
  }

  /* ---------- 背景音乐 ---------- */
  makeMelody() {
    const out = [];
    let idx = 3;
    for (let i = 0; i < 32; i++) {
      if (i % 2 === 1 && Math.random() < 0.45) { out.push(null); continue; }
      idx = Math.max(0, Math.min(SCALE.length - 1, idx + Math.floor(Math.random() * 5) - 2));
      out.push(SCALE[idx]);
    }
    return out;
  }
  schedule() {
    const ctx = this.ctx;
    if (!ctx || ctx.state !== 'running') return;
    const eighth = 60 / 96 / 2;
    while (this.nextT < ctx.currentTime + 0.25) {
      const s = this.step % 32, t = this.nextT - ctx.currentTime;
      const chord = CHORDS[Math.floor(s / 8) % 4];
      if (this.musicOn) {
        if (s % 8 === 0) chord.forEach((n) => this.tone(NOTE(n), 2.6, { type: 'triangle', vol: 0.045, at: 0.25, delay: t, out: this.music, curve: 'lin' }));
        if (s % 4 === 0) this.tone(NOTE(chord[0] - 12), 0.5, { vol: 0.16, delay: t, out: this.music });
        const m = this.melody[s];
        if (m && !(this.night > 0.6 && s % 4 !== 0)) {
          this.tone(NOTE(m), 0.42, { vol: 0.09, delay: t, out: this.music });
          this.tone(NOTE(m + 24), 0.07, { vol: 0.012, delay: t, out: this.music });
        }
        if (s % 2 === 1) this.noise(0.04, { freq: 8000, type: 'highpass', vol: 0.025, delay: t, out: this.music });
      }
      this.step++;
      if (this.step % 64 === 0) this.melody = this.makeMelody();
      this.nextT += eighth;
    }
  }

  /* ---------- 环境声 ---------- */
  setAmbience(dt, night, rain) {
    if (!this.ctx) return;
    this.night = night;
    const now = this.ctx.currentTime;
    if (Math.abs(rain - this.rain) > 0.02) {
      this.rain = rain;
      this.rainGain.gain.setTargetAtTime(rain * 0.35, now, 0.3);
    }
    this.ambT -= dt;
    if (this.ambT > 0 || !this.sfxOn) return;
    if (night < 0.4 && rain < 0.4) {
      this.ambT = 1.5 + Math.random() * 4;
      const base = 2400 + Math.random() * 1600, n = 2 + Math.floor(Math.random() * 3);
      for (let i = 0; i < n; i++) this.tone(base, 0.07, { vol: 0.035, slide: base * 1.35, delay: i * 0.11, out: this.amb });
    } else if (night > 0.6 && rain < 0.4) {
      this.ambT = 0.8 + Math.random() * 1.5;
      for (let i = 0; i < 6; i++) this.tone(4300, 0.03, { type: 'triangle', vol: 0.018, delay: i * 0.05, out: this.amb });
    } else {
      this.ambT = 2;
    }
  }
}

export const audio = new Sound();
