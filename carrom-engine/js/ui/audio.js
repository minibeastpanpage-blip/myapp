/** audio.js — tiny WebAudio synth for collisions / pockets / shots. */
export class Sfx {
  constructor() { this.ctx = null; this.enabled = true; this.lastHit = 0; }
  ensure() {
    if (!this.ctx) {
      try { this.ctx = new (window.AudioContext || window.webkitAudioContext)(); }
      catch { this.enabled = false; }
    }
    if (this.ctx?.state === 'suspended') this.ctx.resume().catch(() => {});
  }
  hit(mag) {
    if (!this.enabled || !this.ctx || mag < 6) return;
    const now = performance.now();
    if (now - this.lastHit < 22) return;
    this.lastHit = now;
    const t = this.ctx.currentTime;
    const o = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    o.type = 'triangle';
    o.frequency.setValueAtTime(150 + Math.min(520, mag * 2.4), t);
    o.frequency.exponentialRampToValueAtTime(70, t + 0.06);
    const v = Math.min(0.28, mag / 480);
    g.gain.setValueAtTime(v, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.07);
    o.connect(g).connect(this.ctx.destination);
    o.start(t); o.stop(t + 0.08);
  }
  pocket() {
    if (!this.enabled || !this.ctx) return;
    const t = this.ctx.currentTime;
    const o = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    o.type = 'sine';
    o.frequency.setValueAtTime(190, t);
    o.frequency.exponentialRampToValueAtTime(70, t + 0.16);
    g.gain.setValueAtTime(0.22, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.2);
    o.connect(g).connect(this.ctx.destination);
    o.start(t); o.stop(t + 0.22);
  }
  shoot(pwr) {
    if (!this.enabled || !this.ctx) return;
    const t = this.ctx.currentTime;
    const buf = this.ctx.createBuffer(1, 1200, this.ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / d.length);
    const src = this.ctx.createBufferSource();
    src.buffer = buf;
    const f = this.ctx.createBiquadFilter();
    f.type = 'bandpass'; f.frequency.value = 900 + pwr * 900; f.Q.value = 0.8;
    const g = this.ctx.createGain();
    g.gain.value = 0.10 + pwr * 0.16;
    src.connect(f).connect(g).connect(this.ctx.destination);
    src.start(t);
  }
}
