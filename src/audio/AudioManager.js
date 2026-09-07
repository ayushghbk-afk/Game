// AudioManager — 100% synthesized WebAudio (zero audio downloads).
// Engine hum, boost, UI clicks, scanner, mining laser, mission chimes,
// alarms + a generative ambient pad. Every channel can be muted.
export class AudioManager {
  constructor() {
    this.ctx = null;
    this.enabled = true;
    this.musicVolume = 0.5;
    this.sfxVolume = 0.7;
    this._engineNodes = null;
    this._musicTimer = null;
    this._warnTimer = null;
    this._mineOsc = null;
  }

  /** Must be called from a user gesture (browser autoplay policy). */
  init() {
    if (this.ctx) { if (this.ctx.state === 'suspended') this.ctx.resume(); return; }
    try {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) { this.enabled = false; return; }
      this.ctx = new AC();
      this.master = this.ctx.createGain();
      this.master.connect(this.ctx.destination);
      this.sfxBus = this.ctx.createGain();
      this.musicBus = this.ctx.createGain();
      this.sfxBus.connect(this.master);
      this.musicBus.connect(this.master);
      this.applyVolumes();
      document.addEventListener('visibilitychange', () => {
        if (!this.ctx) return;
        if (document.hidden) this.ctx.suspend(); else this.ctx.resume();
      });
    } catch (e) {
      console.warn('Audio unavailable', e);
      this.enabled = false;
    }
  }

  applyVolumes() {
    if (!this.ctx) return;
    this.master.gain.value = this.enabled ? 1 : 0;
    this.musicBus.gain.value = this.musicVolume * 0.5;
    this.sfxBus.gain.value = this.sfxVolume;
  }

  setVolumes(music, sfx) { this.musicVolume = music; this.sfxVolume = sfx; this.applyVolumes(); }
  setEnabled(on) { this.enabled = on; this.applyVolumes(); }

  _env(gainNode, t0, attack, peak, decay) {
    const g = gainNode.gain;
    g.setValueAtTime(0.0001, t0);
    g.linearRampToValueAtTime(peak, t0 + attack);
    g.exponentialRampToValueAtTime(0.0001, t0 + attack + decay);
  }

  _osc(type, freq, t0, dur, peak = 0.2, dest = null, detune = 0) {
    if (!this.ctx) return;
    const o = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    o.type = type; o.frequency.value = freq; o.detune.value = detune;
    o.connect(g); g.connect(dest || this.sfxBus);
    this._env(g, t0, 0.01, peak, dur);
    o.start(t0); o.stop(t0 + dur + 0.1);
  }

  _noise(dur = 0.5, filterFreq = 800, type = 'lowpass', peak = 0.25) {
    if (!this.ctx) return null;
    const len = this.ctx.sampleRate * dur;
    const buf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    const src = this.ctx.createBufferSource();
    src.buffer = buf;
    const f = this.ctx.createBiquadFilter();
    f.type = type; f.frequency.value = filterFreq;
    const g = this.ctx.createGain();
    src.connect(f); f.connect(g); g.connect(this.sfxBus);
    const t0 = this.ctx.currentTime;
    this._env(g, t0, 0.02, peak, dur);
    src.start(t0);
    return { src, f, g };
  }

  // ---- continuous engine hum, tied to throttle ----
  setEngine(intensity, boosting) {
    if (!this.ctx || !this.enabled) return;
    if (!this._engineNodes) {
      const o1 = this.ctx.createOscillator(); o1.type = 'sawtooth'; o1.frequency.value = 48;
      const o2 = this.ctx.createOscillator(); o2.type = 'triangle'; o2.frequency.value = 73;
      const noiseSrc = this.ctx.createBufferSource();
      const buf = this.ctx.createBuffer(1, this.ctx.sampleRate, this.ctx.sampleRate);
      const d = buf.getChannelData(0);
      for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
      noiseSrc.buffer = buf; noiseSrc.loop = true;
      const filter = this.ctx.createBiquadFilter(); filter.type = 'lowpass'; filter.frequency.value = 220;
      const g = this.ctx.createGain(); g.gain.value = 0;
      o1.connect(filter); o2.connect(filter); noiseSrc.connect(filter);
      filter.connect(g); g.connect(this.sfxBus);
      o1.start(); o2.start(); noiseSrc.start();
      this._engineNodes = { o1, o2, filter, g };
    }
    const n = this._engineNodes;
    const t = this.ctx.currentTime;
    const target = Math.min(0.16, intensity * 0.16) * (boosting ? 1.7 : 1);
    n.g.gain.setTargetAtTime(target, t, 0.08);
    n.o1.frequency.setTargetAtTime(44 + intensity * 40 + (boosting ? 30 : 0), t, 0.12);
    n.o2.frequency.setTargetAtTime(66 + intensity * 60 + (boosting ? 40 : 0), t, 0.12);
    n.filter.frequency.setTargetAtTime(180 + intensity * 500 + (boosting ? 500 : 0), t, 0.15);
  }

  // ---- one-shots ----
  click() { if (this.ctx) this._osc('square', 1600, this.ctx.currentTime, 0.06, 0.08); }
  uiOpen() { if (this.ctx) this._osc('sine', 520, this.ctx.currentTime, 0.14, 0.1); }
  scan(duration = 1.6) {
    if (!this.ctx) return;
    const t0 = this.ctx.currentTime;
    const o = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    o.type = 'sine';
    o.frequency.setValueAtTime(300, t0);
    o.frequency.exponentialRampToValueAtTime(1400, t0 + duration);
    g.gain.setValueAtTime(0.06, t0);
    g.gain.setValueAtTime(0.06, t0 + duration - 0.05);
    g.gain.linearRampToValueAtTime(0.0001, t0 + duration);
    o.connect(g); g.connect(this.sfxBus);
    o.start(t0); o.stop(t0 + duration + 0.05);
    this._osc('sine', 1760, t0 + duration, 0.25, 0.12);
  }
  missionComplete() {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    [523, 659, 784, 1047].forEach((f, i) => this._osc('triangle', f, t + i * 0.12, 0.4, 0.14));
  }
  arrival() {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    [220, 277, 330].forEach((f, i) => this._osc('sine', f, t + i * 0.03, 1.4, 0.1));
    this._noise(1.0, 600, 'lowpass', 0.06);
  }
  dock() {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    this._osc('sine', 392, t, 0.3, 0.12);
    this._osc('sine', 494, t + 0.15, 0.4, 0.12);
  }
  levelUp() {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    [440, 554, 659, 880].forEach((f, i) => this._osc('sine', f, t + i * 0.09, 0.35, 0.12));
  }
  error() { if (this.ctx) this._osc('square', 160, this.ctx.currentTime, 0.18, 0.1); }

  startMining() {
    if (!this.ctx || this._mineOsc) return;
    const o = this.ctx.createOscillator();
    const lfo = this.ctx.createOscillator();
    const lfoG = this.ctx.createGain();
    const g = this.ctx.createGain();
    o.type = 'sawtooth'; o.frequency.value = 90;
    lfo.frequency.value = 14; lfoG.gain.value = 30;
    lfo.connect(lfoG); lfoG.connect(o.frequency);
    g.gain.value = 0.08;
    o.connect(g); g.connect(this.sfxBus);
    o.start(); lfo.start();
    this._mineOsc = { o, lfo, g };
  }
  stopMining() {
    if (!this._mineOsc) return;
    const { o, lfo, g } = this._mineOsc;
    g.gain.setTargetAtTime(0, this.ctx.currentTime, 0.05);
    setTimeout(() => { try { o.stop(); lfo.stop(); } catch { /* already stopped */ } }, 300);
    this._mineOsc = null;
  }

  boostBurst() {
    const n = this._noise(0.7, 1200, 'bandpass', 0.22);
    if (n && this.ctx) {
      n.f.frequency.setValueAtTime(400, this.ctx.currentTime);
      n.f.frequency.exponentialRampToValueAtTime(2400, this.ctx.currentTime + 0.6);
    }
  }

  setWarning(on) {
    if (on && !this._warnTimer && this.ctx) {
      const beep = () => {
        this._osc('square', 880, this.ctx.currentTime, 0.1, 0.07);
        this._osc('square', 660, this.ctx.currentTime + 0.16, 0.1, 0.07);
      };
      beep();
      this._warnTimer = setInterval(beep, 1100);
    } else if (!on && this._warnTimer) {
      clearInterval(this._warnTimer);
      this._warnTimer = null;
    }
  }

  // ---- generative ambient music: slow evolving pads ----
  startMusic() {
    if (!this.ctx || this._musicTimer) return;
    const chords = [
      [146.8, 174.6, 220.0],  // D minor
      [116.5, 146.8, 174.6],  // Bb major
      [130.8, 164.8, 196.0],  // C major-ish
      [110.0, 130.8, 164.8]   // A minor
    ];
    let idx = 0;
    const playChord = () => {
      if (!this.ctx || document.hidden) return;
      const t = this.ctx.currentTime;
      const chord = chords[idx % chords.length];
      idx++;
      chord.forEach((f, i) => {
        for (const det of [-4, 4]) {
          const o = this.ctx.createOscillator();
          const g = this.ctx.createGain();
          const fl = this.ctx.createBiquadFilter();
          fl.type = 'lowpass'; fl.frequency.value = 700;
          o.type = 'sawtooth'; o.frequency.value = f * (i === 2 ? 2 : 1); o.detune.value = det;
          g.gain.setValueAtTime(0.0001, t);
          g.gain.linearRampToValueAtTime(0.018, t + 2.5);
          g.gain.linearRampToValueAtTime(0.0001, t + 7.5);
          o.connect(fl); fl.connect(g); g.connect(this.musicBus);
          o.start(t); o.stop(t + 8);
        }
      });
    };
    playChord();
    this._musicTimer = setInterval(playChord, 7000);
  }

  stopMusic() {
    if (this._musicTimer) { clearInterval(this._musicTimer); this._musicTimer = null; }
  }
}
