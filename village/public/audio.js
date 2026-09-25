// 効果音・どうぶつ語っぽいおしゃべり・時間で変わるBGMを、すべて WebAudio で合成する。
import { mulberry32 } from './world.js';

const NOTE = (n) => 440 * Math.pow(2, (n - 69) / 12);

export class Sound {
  constructor() {
    this.ctx = null;
    this.bgmOn = true;
    this.seOn = true;
  }

  init() {
    if (this.ctx) { this.ctx.resume(); return; }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    const ctx = this.ctx = new AC();
    this.master = ctx.createGain();
    this.master.gain.value = 0.9;
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -18;
    this.master.connect(comp).connect(ctx.destination);
    this.se = ctx.createGain();
    this.se.gain.value = this.seOn ? 1 : 0;
    this.se.connect(this.master);
    this.music = ctx.createGain();
    this.music.gain.value = this.bgmOn ? 0.55 : 0;
    // ほんのり響き
    const delay = ctx.createDelay();
    delay.delayTime.value = 0.23;
    const fb = ctx.createGain();
    fb.gain.value = 0.22;
    const wet = ctx.createGain();
    wet.gain.value = 0.22;
    this.music.connect(this.master);
    this.music.connect(delay);
    delay.connect(fb).connect(delay);
    delay.connect(wet).connect(this.master);
    const len = ctx.sampleRate;
    this.noise = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = this.noise.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    this._startBgm();
  }

  setBgm(on) {
    this.bgmOn = on;
    if (this.music) this.music.gain.setTargetAtTime(on ? 0.55 : 0, this.ctx.currentTime, 0.3);
  }
  setSe(on) {
    this.seOn = on;
    if (this.se) this.se.gain.setTargetAtTime(on ? 1 : 0, this.ctx.currentTime, 0.05);
  }

  _tone({ type = 'sine', freq, t, dur, vol, attack = 0.005, out, filter, glide }) {
    const ctx = this.ctx;
    const o = ctx.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(freq, t);
    if (glide) o.frequency.exponentialRampToValueAtTime(glide, t + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(vol, t + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    let node = o;
    if (filter) {
      const f = ctx.createBiquadFilter();
      f.type = filter.type || 'bandpass';
      f.frequency.value = filter.freq;
      f.Q.value = filter.q || 1;
      o.connect(f);
      node = f;
    }
    node.connect(g).connect(out || this.se);
    o.start(t);
    o.stop(t + dur + 0.02);
  }

  _noise({ t, dur, vol, freq = 2000, q = 0.8, type = 'bandpass', out }) {
    const ctx = this.ctx;
    const s = ctx.createBufferSource();
    s.buffer = this.noise;
    const f = ctx.createBiquadFilter();
    f.type = type;
    f.frequency.value = freq;
    f.Q.value = q;
    const g = ctx.createGain();
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    s.connect(f).connect(g).connect(out || this.se);
    s.start(t, Math.random() * 0.5);
    s.stop(t + dur + 0.02);
  }

  // どうぶつ語：一文字ずつ短い「ぷ」「ぴ」を鳴らす
  speak(text, pitch = 1, vol = 1, robot = false) {
    if (!this.ctx || vol <= 0.01) return;
    const ctx = this.ctx;
    let t = ctx.currentTime + 0.03;
    const base = 330 * pitch;
    const formants = [720, 1050, 1350, 1900, 2500];
    const chars = [...text].slice(0, 60);
    chars.forEach((ch, i) => {
      if (/[\s、。,.…・ー〜~]/.test(ch)) { t += 0.07; return; }
      const code = ch.codePointAt(0);
      const step = ((code * 7) % 9) - 4;
      let f = base * Math.pow(2, step / 18);
      if (/[!！]/.test(ch)) f *= 1.25;
      if (/[?？]/.test(ch)) f *= 1.35;
      if (i === chars.length - 1) f *= 0.94;
      const fm = formants[code % formants.length];
      if (robot) {
        // ロボットは「ピポ」っぽい電子音
        const q = base * 1.6 * Math.pow(2, Math.round(step / 2) * 2 / 12);
        this._tone({ type: 'square', freq: q, t, dur: 0.06, vol: 0.06 * vol, filter: { type: 'lowpass', freq: 2600, q: 0.7 } });
        this._tone({ type: 'sine', freq: q * 2, t, dur: 0.05, vol: 0.05 * vol });
        t += 0.058;
        return;
      }
      this._tone({ type: 'sawtooth', freq: f, t, dur: 0.075, vol: 0.14 * vol, filter: { freq: fm, q: 3.5 }, glide: f * 0.93 });
      this._tone({ type: 'triangle', freq: f, t, dur: 0.07, vol: 0.12 * vol });
      t += 0.058;
    });
  }

  step(vol = 1, surface = 'grass') {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    if (surface === 'stone') {
      this._noise({ t, dur: 0.06, vol: 0.05 * vol, freq: 900, q: 1.2 });
      this._tone({ type: 'sine', freq: 140 + Math.random() * 20, glide: 90, t, dur: 0.05, vol: 0.06 * vol });
      return;
    }
    if (surface === 'wood') {
      this._tone({ type: 'sine', freq: 190 + Math.random() * 30, glide: 120, t, dur: 0.07, vol: 0.12 * vol });
      this._noise({ t, dur: 0.04, vol: 0.03 * vol, freq: 1200, q: 2 });
      return;
    }
    const sand = surface === 'sand';
    this._noise({ t, dur: 0.07, vol: 0.05 * vol, freq: sand ? 1400 : 2600, q: sand ? 0.6 : 1.4 });
  }
  ladder() {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    for (let i = 0; i < 4; i++) this._tone({ type: 'sine', freq: 230 - i * 18, glide: 150, t: t + i * 0.09, dur: 0.07, vol: 0.12 });
  }
  drip() {
    if (!this.ctx) return;
    const t = this.ctx.currentTime, f = 1300 + Math.random() * 900;
    this._tone({ type: 'sine', freq: f, glide: f * 1.9, t, dur: 0.09, vol: 0.05 });
    this._tone({ type: 'sine', freq: f * 0.7, glide: f * 1.2, t: t + 0.23, dur: 0.07, vol: 0.02 });
  }
  door() {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    this._tone({ type: 'sine', freq: 170, glide: 110, t, dur: 0.12, vol: 0.2 });
    [76, 81, 88].forEach((n, i) => this._tone({ type: 'triangle', freq: NOTE(n), t: t + 0.12 + i * 0.09, dur: 0.35, vol: 0.1 }));
  }
  rustle() {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    for (let i = 0; i < 6; i++) this._noise({ t: t + i * 0.07, dur: 0.14, vol: 0.12, freq: 3200 + Math.random() * 1500, q: 0.7 });
  }
  thud() {
    if (!this.ctx) return;
    this._tone({ type: 'sine', freq: 180, glide: 90, t: this.ctx.currentTime, dur: 0.14, vol: 0.25 });
  }
  pop() {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    this._tone({ type: 'triangle', freq: NOTE(79), t, dur: 0.12, vol: 0.2 });
    this._tone({ type: 'triangle', freq: NOTE(86), t: t + 0.08, dur: 0.22, vol: 0.2 });
  }
  coins() {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    [88, 91, 95, 100].forEach((n, i) => this._tone({ type: 'sine', freq: NOTE(n), t: t + i * 0.06, dur: 0.35, vol: 0.14 }));
  }
  open() {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    [72, 76, 79, 84].forEach((n, i) => this._tone({ type: 'triangle', freq: NOTE(n), t: t + i * 0.07, dur: 0.3, vol: 0.12 }));
  }
  click() {
    if (!this.ctx) return;
    this._tone({ type: 'triangle', freq: NOTE(84), t: this.ctx.currentTime, dur: 0.06, vol: 0.12 });
  }

  // ---------- BGM ----------
  // 一時間ごとにメロディと調が変わる、ゆったりしたループ。
  _composeForHour(hour) {
    const rnd = mulberry32(hour * 7919 + 17);
    const roots = [65, 62, 67, 60, 64, 69, 63, 66];
    const night = hour >= 20 || hour < 5;
    const root = roots[hour % roots.length] - (night ? 5 : 0);
    const bpm = night ? 66 + (hour % 3) * 3 : 80 + (hour % 4) * 5;
    // Imaj7 - vi7 - ii7 - V7 （たまに IVmaj7 - iii7 - ii7 - V7）
    const progs = [
      [[0, 4, 7, 11], [9, 12, 16, 19], [2, 5, 9, 12], [7, 11, 14, 17]],
      [[5, 9, 12, 16], [4, 7, 11, 14], [2, 5, 9, 12], [7, 11, 14, 17]],
      [[0, 4, 7, 11], [5, 9, 12, 16], [9, 12, 16, 19], [7, 11, 14, 17]],
    ];
    const prog = progs[Math.floor(rnd() * progs.length)];
    const scale = [];
    for (const o of [0, 12, 24]) for (const s of [0, 2, 4, 7, 9]) scale.push(root + 12 + o + s);
    const melody = []; // 8小節 × 8分音符
    let idx = 5 + Math.floor(rnd() * 4);
    const rhythm = [
      [1, 0, 1, 1, 0, 1, 0, 0], [1, 0, 0, 1, 1, 0, 1, 0], [1, 1, 0, 1, 0, 0, 1, 0], [1, 0, 1, 0, 1, 0, 0, 0],
    ];
    for (let bar = 0; bar < 8; bar++) {
      const r = rhythm[Math.floor(rnd() * rhythm.length)];
      const chord = prog[bar % 4].map((c) => c + root + 12);
      for (let s = 0; s < 8; s++) {
        const play = bar % 4 === 3 && s > 3 ? 0 : r[s] && (!night || rnd() < 0.7);
        if (!play) { melody.push(null); continue; }
        idx = Math.max(0, Math.min(scale.length - 1, idx + Math.round((rnd() - 0.5) * 3.2)));
        let n = scale[idx];
        if (s === 0) {
          // 小節の頭はコードの音に寄せる
          let best = n, bd = 99;
          for (const c of chord) for (const o of [0, 12, 24]) {
            const cand = c + o;
            if (Math.abs(cand - n) < bd) { bd = Math.abs(cand - n); best = cand; }
          }
          n = best;
        }
        melody.push(n);
      }
    }
    return { root, bpm, prog, melody, night };
  }

  _startBgm() {
    const ctx = this.ctx;
    let song = null, songHour = -1;
    let step = 0;
    let next = ctx.currentTime + 0.3;
    const tick = () => {
      if (!this.bgmOn) { next = ctx.currentTime + 0.1; return; }
      const hour = new Date().getHours();
      if (hour !== songHour) { song = this._composeForHour(hour); songHour = hour; step = 0; }
      const eighth = 60 / song.bpm / 2;
      while (next < ctx.currentTime + 0.25) {
        this._playStep(song, step, next, eighth);
        step = (step + 1) % 64;
        next += eighth * (step % 2 === 1 ? 1.12 : 0.88); // ゆるいスウィング
      }
    };
    setInterval(tick, 60);
  }

  _playStep(song, step, t, eighth) {
    const bar = Math.floor(step / 8), s = step % 8;
    const chord = song.prog[bar % 4];
    const out = this.music;
    // エレピ風の和音
    if (s === 0 || s === 5) {
      chord.forEach((c, i) => {
        const f = NOTE(song.root + c);
        this._tone({ type: 'sine', freq: f, t: t + i * 0.012, dur: eighth * 5, vol: 0.045, attack: 0.02, out });
        this._tone({ type: 'sine', freq: f * 2, t: t + i * 0.012, dur: eighth * 1.5, vol: 0.012, out });
      });
    }
    // ベース
    if (s === 0 || s === 4 || (s === 7 && !song.night)) {
      const n = song.root - 12 + (s === 4 ? chord[2] : s === 7 ? chord[1] : chord[0]);
      this._tone({ type: 'triangle', freq: NOTE(n), t, dur: eighth * 1.8, vol: 0.16, attack: 0.01, out });
    }
    // メロディ（木琴っぽい音）
    const m = song.melody[step];
    if (m) {
      this._tone({ type: 'sine', freq: NOTE(m), t, dur: eighth * 2.4, vol: 0.075, attack: 0.004, out });
      this._tone({ type: 'sine', freq: NOTE(m) * 4, t, dur: 0.08, vol: 0.018, attack: 0.002, out });
    }
    // シェイカー
    if (!song.night) this._noise({ t, dur: 0.05, vol: s % 2 ? 0.012 : 0.022, freq: 7000, q: 1, type: 'highpass', out });
  }
}
