// Sporoto — sons de la voiture uniquement, synthétisés en Web Audio (aucun fichier externe).
// Moteur selon le régime et la charge, turbo, rupteur, passages de rapports, freinage, pneus, roulement.

// nombre de cylindres (fréquence d'allumage = tr/min / 60 × cyl / 2) et timbre
const ENGINE = {
  F1: { cyl: 6, bright: 1.0, turbo: 0.5 }, F2: { cyl: 6, bright: 0.85, turbo: 0.7 }, F3: { cyl: 6, bright: 0.8, turbo: 0 },
  HYPERCAR: { cyl: 6, bright: 0.75, turbo: 0.6 }, LMP2: { cyl: 8, bright: 0.8, turbo: 0 }, LMP3: { cyl: 8, bright: 0.6, turbo: 0 },
  GT3: { cyl: 8, bright: 0.65, turbo: 0.5 }, LIBRE: { cyl: 10, bright: 1.0, turbo: 0.4 },
};

let enabled = true, volume = 0.7;
try { enabled = localStorage.getItem('sporoto.sound') !== '0'; const v = parseFloat(localStorage.getItem('sporoto.volume')); if (isFinite(v)) volume = v; } catch (e) { /* stockage indisponible */ }

export class CarAudio {
  constructor(carType, car) {
    this.spec = ENGINE[carType] || ENGINE.LIBRE;
    this.car = car;
    this.turbo = car.turbo ? this.spec.turbo || 0.5 : 0;
    this.lastGear = 0; this.lastThr = 0; this.shiftT = 0; this.limT = 0;
    this.ctx = null;
  }

  static get enabled() { return enabled; }
  static get volume() { return volume; }

  start() {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC || this.ctx) return;
    const c = this.ctx = new AC();
    this.master = c.createGain(); this.master.gain.value = enabled ? volume : 0;
    const comp = c.createDynamicsCompressor(); comp.threshold.value = -14; comp.ratio.value = 4;
    this.master.connect(comp); comp.connect(c.destination);
    // bruit blanc réutilisable
    const len = c.sampleRate * 2, buf = c.createBuffer(1, len, c.sampleRate), d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    this.noiseBuf = buf;
    const noise = () => { const s = c.createBufferSource(); s.buffer = buf; s.loop = true; s.start(); return s; };
    const gain = (v, dst) => { const g = c.createGain(); g.gain.value = v; g.connect(dst); return g; };
    const filt = (type, f, q, dst) => { const b = c.createBiquadFilter(); b.type = type; b.frequency.value = f; b.Q.value = q; b.connect(dst); return b; };

    // --- moteur : harmoniques de la fréquence d'allumage → saturation → filtre passe-bas (charge)
    this.eng = gain(0, this.master);
    this.engLP = filt('lowpass', 1200, 1.6, this.eng);
    const shaper = c.createWaveShaper();
    const curve = new Float32Array(2048); for (let i = 0; i < 2048; i++) { const x = i / 1024 - 1; curve[i] = Math.tanh(x * 2.6); }
    shaper.curve = curve; shaper.connect(this.engLP);
    const mix = gain(0.55, shaper);
    this.osc = [
      { type: 'sawtooth', mul: 1, g: 0.55 }, { type: 'square', mul: 0.5, g: 0.35 },
      { type: 'sawtooth', mul: 2.003, g: 0.22 * this.spec.bright }, { type: 'triangle', mul: 3.01, g: 0.12 * this.spec.bright },
    ].map(o => { const n = c.createOscillator(); n.type = o.type; n.frequency.value = 100; const g = gain(o.g, mix); n.connect(g); n.start(); return { n, mul: o.mul }; });
    // grain / rugosité de l'échappement
    this.rasp = gain(0, this.master); this.raspBP = filt('bandpass', 600, 2.5, this.rasp); noise().connect(this.raspBP);
    // --- turbo : sifflement + décharge à la levée de pied
    if (this.turbo) {
      this.whist = c.createOscillator(); this.whist.type = 'sine'; this.whist.frequency.value = 2000; this.whist.start();
      this.whistG = gain(0, this.master); this.whist.connect(this.whistG);
    }
    // --- pneus : roulement (grave) et crissement (bande étroite)
    this.roll = gain(0, this.master); this.rollLP = filt('lowpass', 220, 0.7, this.roll); noise().connect(this.rollLP);
    this.squeal = gain(0, this.master); this.squealBP = filt('bandpass', 1150, 14, this.squeal); noise().connect(this.squealBP);
    // --- freins : souffle des disques
    this.brake = gain(0, this.master); this.brakeBP = filt('bandpass', 3200, 1.2, this.brake); noise().connect(this.brakeBP);
  }

  // bref bruit filtré (claquement de boîte, pétarade, décharge du turbo)
  burst(type, freq, q, dur, level) {
    const c = this.ctx, t = c.currentTime;
    const s = c.createBufferSource(); s.buffer = this.noiseBuf;
    const f = c.createBiquadFilter(); f.type = type; f.frequency.value = freq; f.Q.value = q;
    const g = c.createGain(); g.gain.setValueAtTime(level, t); g.gain.exponentialRampToValueAtTime(0.0005, t + dur);
    s.connect(f); f.connect(g); g.connect(this.master);
    s.start(t, Math.random()); s.stop(t + dur + 0.02);
  }

  setEnabled(on) {
    enabled = on;
    try { localStorage.setItem('sporoto.sound', on ? '1' : '0'); } catch (e) { /* ignore */ }
    if (this.ctx) { this.master.gain.setTargetAtTime(on ? volume : 0, this.ctx.currentTime, 0.05); if (on) this.ctx.resume(); }
  }
  setVolume(v) {
    volume = v;
    try { localStorage.setItem('sporoto.volume', String(v)); } catch (e) { /* ignore */ }
    if (this.ctx && enabled) this.master.gain.setTargetAtTime(v, this.ctx.currentTime, 0.05);
  }

  // p = { rpm, gear, thr, brk, v (m/s), ax, ay (m/s²), grip (0..1 utilisation), running, cam, scale }
  update(p, dtReal) {
    if (!this.ctx) return;
    const c = this.ctx, t = c.currentTime, car = this.car;
    if (!p.running) {
      // pause : silence ; au stand : ralenti
      const idle = p.pit;
      this.setEng(idle ? car.rpmPeak * 0.3 : 0, idle ? 0.15 : 0, idle ? 0.035 : 0, t);
      for (const g of [this.roll, this.squeal, this.brake, this.rasp]) g.gain.setTargetAtTime(0, t, 0.05);
      if (this.whistG) this.whistG.gain.setTargetAtTime(0, t, 0.05);
      this.lastGear = 0;
      return;
    }
    const camMul = p.cam === 'onboard' ? 1.15 : p.cam === 'top' ? 0.45 : p.cam === 'tv' ? 0.7 : p.cam === 'heli' ? 0.55 : 1;
    const x = Math.min(1.05, p.rpm / car.rpmMax);
    // passage de rapport : coupure brève + claquement ; rétrogradage : pétarade
    if (this.lastGear && p.gear !== this.lastGear && p.scale <= 10) {
      if (p.gear > this.lastGear) { this.shiftT = Math.max(0.045, car.shiftMs / 1000 * 1.5); this.burst('lowpass', 900, 1, 0.06, 0.25 * camMul); }
      else { this.burst('bandpass', 180 + Math.random() * 120, 1.2, 0.09, 0.35 * camMul); if (Math.random() < 0.5) setTimeout(() => this.ctx && this.burst('bandpass', 240, 1.5, 0.05, 0.25 * camMul), 60); }
    }
    this.lastGear = p.gear;
    // levée de pied à haut régime : décharge du turbo / pétarades
    if (this.lastThr > 0.8 && p.thr < 0.2 && x > 0.6 && p.scale <= 10) {
      if (this.turbo) this.burst('highpass', 2500, 0.7, 0.35, 0.12 * this.turbo * camMul);
      this.burst('bandpass', 150, 1, 0.07, 0.3 * camMul);
    }
    this.lastThr = p.thr;
    // rupteur : hachage du son
    let lim = 1;
    if (x > 0.985 && p.thr > 0.9) { this.limT += dtReal; lim = Math.sin(this.limT * 2 * Math.PI * 16) > 0 ? 1 : 0.35; }
    let cut = 1;
    if (this.shiftT > 0) { this.shiftT -= dtReal; cut = 0.25; }
    const load = 0.25 + 0.75 * p.thr;
    this.setEng(p.rpm, (0.06 + 0.16 * load) * lim * cut * camMul * (0.6 + 0.4 * x), 300 + (900 + 3200 * this.spec.bright) * load * (0.4 + 0.6 * x), t);
    this.raspBP.frequency.setTargetAtTime(p.rpm / 60 * this.spec.cyl * 1.5, t, 0.03);
    this.rasp.gain.setTargetAtTime(0.05 * p.thr * cut * camMul, t, 0.04);
    if (this.whistG) {
      const boost = p.thr * Math.min(1, x * 1.2);
      this.whist.frequency.setTargetAtTime(1800 + 4200 * boost, t, 0.15);
      this.whistG.gain.setTargetAtTime(0.012 * this.turbo * boost * camMul, t, 0.15);
    }
    const kmh = p.v * 3.6;
    this.roll.gain.setTargetAtTime(Math.min(0.12, kmh / 2500) * camMul, t, 0.05);
    this.rollLP.frequency.setTargetAtTime(120 + kmh * 1.4, t, 0.05);
    // crissement quand les pneus travaillent près de la limite (virage appuyé ou gros freinage)
    const sq = Math.max(0, (p.grip - 0.86) / 0.14);
    this.squeal.gain.setTargetAtTime(Math.min(1, sq) ** 1.5 * 0.1 * (kmh > 20 ? 1 : 0) * camMul, t, 0.04);
    this.squealBP.frequency.setTargetAtTime(950 + 350 * sq + Math.random() * 60, t, 0.05);
    this.brake.gain.setTargetAtTime(p.brk * Math.min(1, kmh / 150) * 0.05 * camMul, t, 0.03);
  }

  setEng(rpm, g, lp, t) {
    const f = Math.max(8, rpm / 60 * this.spec.cyl / 2);
    for (const o of this.osc) o.n.frequency.setTargetAtTime(f * o.mul, t, 0.012);
    this.eng.gain.setTargetAtTime(g, t, 0.025);
    this.engLP.frequency.setTargetAtTime(Math.max(150, lp), t, 0.03);
  }

  suspend() { if (this.ctx && this.ctx.state === 'running') this.ctx.suspend(); }
  resume() { if (this.ctx && this.ctx.state === 'suspended' && enabled) this.ctx.resume(); }
  destroy() { if (this.ctx) { this.ctx.close(); this.ctx = null; } }
}
