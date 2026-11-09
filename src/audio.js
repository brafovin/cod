import { clamp, rand, lerp } from './util.js';

// Fully procedural audio. Gun sounds adapt to the listener's surroundings
// (open field / trench / building / forest / rain / night).
export class AudioSys {
  constructor() {
    this.ac = null; this.voices = 0;
    this.env = { trench: 0, building: 0, dense: 0, rain: 0, night: 0, wind: 0.4 };
    this.lx = 0; this.ly = 0; this.lz = 0;
    this.turn = 0;
  }

  init() {
    if (this.ac) { if (this.ac.state === 'suspended') this.ac.resume(); return; }
    const ac = this.ac = new (window.AudioContext || window.webkitAudioContext)({ latencyHint: 'interactive' });
    this.master = ac.createGain(); this.master.gain.value = 0.9;
    this.envLP = ac.createBiquadFilter(); this.envLP.type = 'lowpass'; this.envLP.frequency.value = 20000;
    const comp = ac.createDynamicsCompressor(); comp.threshold.value = -14; comp.knee.value = 18; comp.ratio.value = 5; comp.attack.value = 0.004; comp.release.value = 0.2;
    this.master.connect(this.envLP); this.envLP.connect(comp); comp.connect(ac.destination);
    this.dry = ac.createGain(); this.dry.connect(this.master);
    this.send = ac.createGain(); this.send.gain.value = 1;
    this.rev = {};
    const mk = (name, ir) => {
      const c = ac.createConvolver(); c.buffer = ir; const g = ac.createGain(); g.gain.value = 0;
      this.send.connect(c); c.connect(g); g.connect(this.master); this.rev[name] = g;
    };
    mk('open', this._ir(3.0, 2.0, [[0.32, 0.25], [0.71, 0.18], [1.2, 0.1]], 0.6));
    mk('trench', this._ir(0.75, 6.5, [[0.006, 0.7], [0.012, 0.55], [0.021, 0.45], [0.034, 0.3]], 0.3));
    mk('build', this._ir(1.9, 3.2, [[0.01, 0.5], [0.023, 0.45], [0.041, 0.35]], 0.15));
    // noise buffers
    const len = ac.sampleRate * 3;
    this.noise = ac.createBuffer(1, len, ac.sampleRate);
    const d = this.noise.getChannelData(0); for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    this.pink = ac.createBuffer(1, len, ac.sampleRate);
    const p = this.pink.getChannelData(0); let b0 = 0, b1 = 0, b2 = 0;
    for (let i = 0; i < len; i++) { const w = Math.random() * 2 - 1; b0 = 0.99765 * b0 + w * 0.099046; b1 = 0.963 * b1 + w * 0.2965164; b2 = 0.57 * b2 + w * 1.0526913; p[i] = (b0 + b1 + b2 + w * 0.1848) * 0.2; }
    this._startLoops();
  }

  _ir(dur, decay, taps, lpEnd) {
    const ac = this.ac, n = Math.floor(ac.sampleRate * dur), buf = ac.createBuffer(2, n, ac.sampleRate);
    for (let c = 0; c < 2; c++) {
      const d = buf.getChannelData(c); let lp = 0;
      for (let i = 0; i < n; i++) {
        const t = i / ac.sampleRate, k = lerp(0.9, lpEnd, Math.min(1, t / dur));
        lp += (Math.random() * 2 - 1 - lp) * (1 - k * 0.95);
        d[i] = lp * Math.exp(-t * decay) * 1.6 * (t < 0.004 ? t / 0.004 : 1);
      }
      for (const [tt, a] of taps) { const i = Math.floor((tt + (c ? 0.0013 : 0)) * ac.sampleRate); for (let k = 0; k < 40 && i + k < n; k++) d[i + k] += (Math.random() * 2 - 1) * a * (1 - k / 40); }
    }
    return buf;
  }

  _startLoops() {
    const ac = this.ac;
    const loop = (buf) => { const s = ac.createBufferSource(); s.buffer = buf; s.loop = true; s.loopStart = 0; s.start(0, Math.random() * 2); return s; };
    // wind: low body + high "air" that swells when the head turns
    const w1 = loop(this.pink), f1 = ac.createBiquadFilter(); f1.type = 'bandpass'; f1.frequency.value = 380; f1.Q.value = 0.6;
    this.windBody = ac.createGain(); this.windBody.gain.value = 0.0; w1.connect(f1); f1.connect(this.windBody); this.windBody.connect(this.master);
    this.windF = f1;
    const w2 = loop(this.noise), f2 = ac.createBiquadFilter(); f2.type = 'bandpass'; f2.frequency.value = 1800; f2.Q.value = 0.9;
    this.windAir = ac.createGain(); this.windAir.gain.value = 0; this.windPan = ac.createStereoPanner();
    w2.connect(f2); f2.connect(this.windAir); this.windAir.connect(this.windPan); this.windPan.connect(this.master);
    this.windF2 = f2;
    // rain
    const r = loop(this.noise), rf = ac.createBiquadFilter(); rf.type = 'highpass'; rf.frequency.value = 1400;
    const rl = ac.createBiquadFilter(); rl.type = 'lowpass'; rl.frequency.value = 9000;
    this.rainG = ac.createGain(); this.rainG.gain.value = 0; r.connect(rf); rf.connect(rl); rl.connect(this.rainG); this.rainG.connect(this.master);
    // low room tone / heartbeat bus
    this.nextAmb = 4; this.hbT = 0;
  }

  // called every frame
  update(dt, cam, env, turnRate, health) {
    if (!this.ac) return;
    const ac = this.ac, t = ac.currentTime, L = ac.listener;
    this.lx = cam.position.x; this.ly = cam.position.y; this.lz = cam.position.z;
    const fx = -Math.sin(cam.rotation.y) * Math.cos(cam.rotation.x), fy = Math.sin(cam.rotation.x), fz = -Math.cos(cam.rotation.y) * Math.cos(cam.rotation.x);
    if (L.positionX) {
      L.positionX.value = this.lx; L.positionY.value = this.ly; L.positionZ.value = this.lz;
      L.forwardX.value = fx; L.forwardY.value = fy; L.forwardZ.value = fz; L.upX.value = 0; L.upY.value = 1; L.upZ.value = 0;
    } else { L.setPosition(this.lx, this.ly, this.lz); L.setOrientation(fx, fy, fz, 0, 1, 0); }
    Object.assign(this.env, env);
    const e = this.env;
    const open = clamp(1 - Math.max(e.trench, e.building), 0, 1);
    this.rev.open.gain.setTargetAtTime(0.55 * open * (1 - 0.55 * e.dense) * (1 + 0.35 * e.night) * (1 - 0.3 * e.rain), t, 0.2);
    this.rev.trench.gain.setTargetAtTime(0.95 * e.trench, t, 0.2);
    this.rev.build.gain.setTargetAtTime(1.15 * e.building, t, 0.2);
    this.envLP.frequency.setTargetAtTime(20000 - e.rain * 5000 - e.dense * 2500 - e.building * 1500, t, 0.4);
    const turn = Math.min(1, Math.abs(turnRate) / 4.0);
    this.turn += (turn - this.turn) * Math.min(1, dt * 8);
    const gust = e.wind;
    this.windBody.gain.setTargetAtTime((0.035 + 0.11 * gust) * (1 - 0.5 * e.building) * (1 - 0.35 * e.trench), t, 0.3);
    this.windF.frequency.setTargetAtTime(260 + gust * 520, t, 0.3);
    this.windAir.gain.setTargetAtTime((0.004 + 0.02 * gust + this.turn * (0.06 + 0.05 * gust)) * (1 - 0.6 * e.building), t, 0.06);
    this.windF2.frequency.setTargetAtTime(1200 + this.turn * 1800 + gust * 800, t, 0.08);
    this.windPan.pan.setTargetAtTime(clamp(-Math.sign(turnRate) * this.turn * 0.8, -0.8, 0.8), t, 0.1);
    this.rainG.gain.setTargetAtTime(e.rain * 0.16 * (1 - 0.6 * e.building), t, 0.5);
    // ambience
    this.nextAmb -= dt;
    if (this.nextAmb <= 0) {
      this.nextAmb = rand(5, 14);
      const r = Math.random();
      if (r < 0.4) this._distantBoom();
      else if (e.night > 0.6) this._cricket(); else if (e.night < 0.5 && e.rain < 0.2) this._bird();
    }
    if (health < 35) {
      this.hbT -= dt;
      if (this.hbT <= 0) { this.hbT = lerp(0.45, 1.0, health / 35); this._heart(0.5 + (35 - health) / 35); }
    }
  }

  // ---------- helpers
  _node(pos, opts = {}) {
    const ac = this.ac; if (!ac || this.voices > 70) return null;
    const dx = pos.x - this.lx, dy = pos.y - this.ly, dz = pos.z - this.lz, d = Math.sqrt(dx * dx + dy * dy + dz * dz);
    const out = ac.createGain(); out.gain.value = opts.gain ?? 1;
    const lp = ac.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = clamp((opts.lp ?? 20000) / (1 + d / (opts.lpd ?? 30)), 700, 20000);
    out.connect(lp);
    let last = lp;
    if (d > 0.5) {
      const pn = new PannerNode(ac, { panningModel: d < 50 ? 'HRTF' : 'equalpower', distanceModel: 'linear', refDistance: 1, maxDistance: 1, rolloffFactor: 0, positionX: pos.x, positionY: pos.y, positionZ: pos.z });
      lp.connect(pn); last = pn;
    }
    last.connect(this.dry);
    let sg = null;
    if (opts.send) { sg = ac.createGain(); sg.gain.value = opts.send; last.connect(sg); sg.connect(this.send); }
    return { out, d, delay: opts.delay === false ? 0 : Math.min(0.8, d / 340) };
  }
  _noise(dest, t, dur, o) {
    const ac = this.ac, s = ac.createBufferSource(); s.buffer = o.pink ? this.pink : this.noise;
    const f = ac.createBiquadFilter(); f.type = o.type || 'bandpass'; f.frequency.setValueAtTime(o.f, t); if (o.f2) f.frequency.exponentialRampToValueAtTime(o.f2, t + dur); f.Q.value = o.q ?? 0.8;
    const g = ac.createGain(), a = o.attack ?? 0.002;
    g.gain.setValueAtTime(0.0001, t); g.gain.linearRampToValueAtTime(o.gain, t + a); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    s.connect(f); f.connect(g); g.connect(dest);
    s.start(t, Math.random() * 2, dur + 0.05); this.voices++; s.onended = () => this.voices--;
  }
  _tone(dest, t, dur, o) {
    const ac = this.ac, os = ac.createOscillator(); os.type = o.type || 'sine';
    os.frequency.setValueAtTime(o.f, t); os.frequency.exponentialRampToValueAtTime(Math.max(10, o.f2 ?? o.f), t + dur);
    const g = ac.createGain(); g.gain.setValueAtTime(0.0001, t); g.gain.linearRampToValueAtTime(o.gain, t + (o.attack ?? 0.003)); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    os.connect(g); g.connect(dest); os.start(t); os.stop(t + dur + 0.02); this.voices++; os.onended = () => this.voices--;
  }

  // ---------- weapons
  shot(kind, pos, o = {}) {
    if (!this.ac) return;
    const sup = !!o.suppressed;
    const dist0 = Math.hypot(pos.x - this.lx, pos.z - this.lz);
    const n = this._node(pos, { gain: (o.vol ?? 1) * clamp(14 / (14 + dist0 * 0.9) * 1.25, 0, 1.2), lp: 20000, lpd: 40, send: sup ? 0.5 : 1.0 });
    if (!n) return;
    const t = this.ac.currentTime + n.delay, d = n.out;
    const P = {
      pistol: { c: [2200, 0.7], b: [1100, 0.55, 0.12], th: [190, 70, 0.14, 0.45] },
      mg: { c: [1500, 1.0], b: [650, 0.85, 0.2], th: [120, 42, 0.24, 0.95] },
      shotgun: { c: [1100, 1.0], b: [380, 1.15, 0.38], th: [85, 30, 0.42, 1.25] },
      rpg: { c: [900, 0.9], b: [300, 1.3, 0.6], th: [70, 25, 0.7, 1.4] },
    }[kind] || { c: [1500, 1], b: [650, 0.8, 0.2], th: [120, 42, 0.24, 0.9] };
    const k = sup ? 0.22 : 1;
    this._noise(d, t, 0.045, { type: 'highpass', f: sup ? 1200 : P.c[0], gain: P.c[1] * k * 1.2, q: 0.5 });
    this._noise(d, t, P.b[2] * (sup ? 0.7 : 1), { f: P.b[0] * (sup ? 0.7 : 1), f2: P.b[0] * 0.4, gain: P.b[1] * (sup ? 0.4 : 1), q: 0.7, pink: true, attack: 0.003 });
    this._tone(d, t, P.th[2], { f: P.th[0], f2: P.th[1], gain: P.th[3] * (sup ? 0.45 : 1) });
    if (sup) this._noise(d, t, 0.05, { f: 2600, gain: 0.25, q: 2 });
    // environment dependent reflections (slap-back in trench / echo from tree line)
    const e = this.env;
    if (e.trench > 0.3 && !sup) this._noise(d, t + 0.022, 0.1, { f: 1600, gain: 0.35 * e.trench, q: 0.5 });
    if (kind === 'rpg') this._noise(d, t, 0.5, { type: 'lowpass', f: 1200, f2: 200, gain: 0.8, pink: true });
  }

  explosion(pos, big = 1) {
    if (!this.ac) return;
    const dist0 = Math.hypot(pos.x - this.lx, pos.z - this.lz);
    const n = this._node(pos, { gain: clamp(30 / (30 + dist0), 0, 1) * 1.5 * big, lp: 20000, lpd: 25, send: 1.2 });
    if (!n) return; const t = this.ac.currentTime + n.delay, d = n.out;
    this._noise(d, t, 0.08, { type: 'highpass', f: 900, gain: 1.4 });
    this._noise(d, t, 1.4, { type: 'lowpass', f: 900, f2: 90, gain: 1.6, pink: true, attack: 0.004 });
    this._tone(d, t, 1.1, { f: 62, f2: 22, gain: 1.8 });
    this._noise(d, t + 0.12, 0.8, { f: 2500, f2: 400, gain: 0.35, q: 0.4 });
    for (let i = 0; i < 6; i++) this._noise(d, t + 0.5 + i * rand(0.1, 0.25), 0.12, { f: rand(900, 3500), gain: 0.1 + Math.random() * 0.1, q: 1.2 }); // debris
  }

  footstep(surface, pos, vol = 1, pitch = 1, hard = 1) {
    if (!this.ac) return;
    const d = Math.hypot(pos.x - this.lx, pos.z - this.lz);
    // steps are only heard within 2 m; 2–6 m extremely faint; beyond 6 m silent
    let g = d <= 2 ? 1 : d < 6 ? 0.035 * (1 - (d - 2) / 4) : 0;
    if (g <= 0.001) return;
    const n = this._node(pos, { gain: g * vol * 0.7, lp: 9000, lpd: 6, delay: false, send: 0.08 });
    if (!n) return; const t = this.ac.currentTime, o = n.out, p = pitch;
    switch (surface) {
      case 'grass': this._noise(o, t, 0.13, { f: 3200 * p, f2: 1800 * p, gain: 0.35, q: 0.7 }); this._noise(o, t, 0.07, { type: 'lowpass', f: 300 * p, gain: 0.45 * hard }); break;
      case 'mud': this._noise(o, t, 0.16, { type: 'lowpass', f: 520 * p, f2: 200, gain: 0.7 * hard, pink: true }); this._tone(o, t, 0.12, { f: 220 * p, f2: 90, gain: 0.18 }); break;
      case 'leaves': for (let i = 0; i < 5; i++) this._noise(o, t + i * rand(0.01, 0.03), 0.05, { f: rand(3500, 7500) * p, gain: rand(0.1, 0.25), q: 2 }); this._noise(o, t, 0.06, { type: 'lowpass', f: 400 * p, gain: 0.3 }); break;
      case 'wood': this._tone(o, t, 0.1, { f: 170 * p, f2: 95, gain: 0.5 }); this._noise(o, t, 0.06, { f: 900 * p, gain: 0.5, q: 1 }); break;
      case 'concrete': this._noise(o, t, 0.05, { f: 2200 * p, gain: 0.5, q: 1.2 }); this._noise(o, t, 0.08, { type: 'lowpass', f: 600, gain: 0.35 }); break;
      default: this._noise(o, t, 0.09, { type: 'lowpass', f: 900 * p, f2: 300, gain: 0.7 * hard, pink: true }); this._noise(o, t, 0.05, { f: 2600 * p, gain: 0.18, q: 1.5 });
    }
  }
  rustle(pos, vol = 1, pitch = 1) {
    if (!this.ac) return; const d = Math.hypot(pos.x - this.lx, pos.z - this.lz);
    const g = d <= 2 ? 1 : d < 6 ? 0.03 * (1 - (d - 2) / 4) : 0; if (g <= 0.001) return;
    const n = this._node(pos, { gain: g * vol * 0.22, lp: 6000, delay: false }); if (!n) return;
    this._noise(n.out, this.ac.currentTime, 0.14, { f: 2400 * pitch, q: 0.5, gain: 0.7 });
  }
  land(pos, surface) { this.footstep(surface, pos, 1.6, 0.8, 1.6); }

  // mechanical sounds: magout, magin, bolt, pump, shell, dry, click, fumble, pin, clink, knife, throw
  mech(kind, pos, vol = 1, pitch = 1) {
    if (!this.ac) return;
    const d0 = Math.hypot(pos.x - this.lx, pos.z - this.lz); if (d0 > 22) return;
    const n = this._node(pos, { gain: vol * 0.8 / (1 + d0 * d0 * 0.06), lp: 14000, lpd: 12, delay: false, send: 0.12 }); if (!n) return;
    const t = this.ac.currentTime, o = n.out, p = pitch;
    const click = (dt, f, g) => { this._noise(o, t + dt, 0.025, { f: f * p, gain: g, q: 3 }); this._tone(o, t + dt, 0.03, { f: f * 0.55 * p, f2: f * 0.4 * p, gain: g * 0.5, type: 'triangle' }); };
    switch (kind) {
      case 'magout': click(0, 3400, 0.6); this._tone(o, t + 0.05, 0.08, { f: 160 * p, f2: 110, gain: 0.5 }); this._noise(o, t + 0.04, 0.1, { f: 1200, gain: 0.3, q: 0.6 }); break;
      case 'magin': this._tone(o, t, 0.07, { f: 190 * p, f2: 120, gain: 0.7 }); click(0.05, 4200, 0.8); click(0.09, 2800, 0.4); break;
      case 'fumble': this._tone(o, t, 0.06, { f: 260 * p, f2: 170, gain: 0.4 }); this._noise(o, t, 0.08, { f: 1500, gain: 0.35, q: 0.5 }); break;
      case 'bolt': click(0, 2500, 0.8); click(0.09, 3600, 0.9); this._noise(o, t + 0.01, 0.1, { f: 1000, f2: 600, gain: 0.3 }); break;
      case 'pump': click(0, 1800, 0.9); this._tone(o, t, 0.1, { f: 140 * p, f2: 90, gain: 0.5 }); click(0.16, 2400, 1); break;
      case 'shell': click(0, 2800, 0.5); this._tone(o, t, 0.05, { f: 400 * p, f2: 300, gain: 0.25 }); break;
      case 'dry': click(0, 2200, 0.5); break;
      case 'click': click(0, 3000, 0.4); break;
      case 'pin': click(0, 3600, 0.5); this._tone(o, t + 0.08, 0.2, { f: 1800 * p, f2: 1700 * p, gain: 0.12, type: 'sine' }); break;
      case 'clink': this._tone(o, t, 0.25, { f: rand(2800, 4200) * p, f2: rand(2600, 3800) * p, gain: 0.18 }); break;
      case 'knife': this._noise(o, t, 0.18, { f: 4000, f2: 1500, gain: 0.5, q: 0.5 }); break;
      case 'stab': this._tone(o, t, 0.1, { f: 110, f2: 60, gain: 0.8 }); this._noise(o, t, 0.1, { f: 700, gain: 0.5 }); break;
      case 'overheat': this._noise(o, t, 0.9, { type: 'highpass', f: 3500, f2: 5000, gain: 0.35, q: 0.3 }); this._noise(o, t, 0.5, { f: 6000, gain: 0.2, q: 3 }); break;
      case 'pickup': click(0, 2400, 0.5); click(0.07, 3200, 0.4); this._tone(o, t + 0.05, 0.12, { f: 400, f2: 600, gain: 0.15, type: 'triangle' }); break;
      case 'attach': click(0, 1800, 0.7); click(0.1, 2600, 0.8); break;
      case 'swap': this._noise(o, t, 0.15, { f: 1800, f2: 900, gain: 0.35, q: 0.5 }); click(0.1, 2200, 0.4); break;
    }
  }

  impact(surface, pos) {
    if (!this.ac) return; const d0 = Math.hypot(pos.x - this.lx, pos.z - this.lz); if (d0 > 80) return;
    const n = this._node(pos, { gain: 0.8 / (1 + d0 * 0.12), lp: 12000, send: 0.3 }); if (!n) return;
    const t = this.ac.currentTime + n.delay, o = n.out;
    switch (surface) {
      case 'wood': this._tone(o, t, 0.1, { f: 240, f2: 110, gain: 0.7 }); this._noise(o, t, 0.08, { f: 1400, gain: 0.6, q: 0.8 }); break;
      case 'concrete': this._noise(o, t, 0.05, { f: 3000, gain: 0.7, q: 1 }); this._noise(o, t, 0.09, { f: 900, gain: 0.4 }); this._noise(o, t + 0.03, 0.4, { f: 4500, f2: 2500, gain: 0.15, q: 6 }); break; // ricochet whine
      case 'flesh': this._tone(o, t, 0.12, { f: 130, f2: 60, gain: 0.9 }); this._noise(o, t, 0.1, { type: 'lowpass', f: 700, gain: 0.6 }); break;
      case 'glass': for (let i = 0; i < 14; i++) this._tone(o, t + i * rand(0.01, 0.04), 0.2, { f: rand(2500, 7000), f2: rand(2000, 5000), gain: rand(0.06, 0.2) }); this._noise(o, t, 0.18, { type: 'highpass', f: 3000, gain: 0.6 }); break;
      default: this._noise(o, t, 0.08, { type: 'lowpass', f: 700, gain: 0.7, pink: true }); this._noise(o, t, 0.04, { f: 2000, gain: 0.25 });
    }
  }
  treeCrash(pos) {
    if (!this.ac) return; const d0 = Math.hypot(pos.x - this.lx, pos.z - this.lz);
    const n = this._node(pos, { gain: 1.2 * clamp(25 / (25 + d0), 0, 1), lp: 9000, lpd: 40, send: 0.8 }); if (!n) return;
    const t = this.ac.currentTime + n.delay + 0.05, o = n.out;
    for (let i = 0; i < 7; i++) this._noise(o, t + i * rand(0.03, 0.1), 0.12, { f: rand(300, 1400), gain: rand(0.4, 0.9), q: 1.5 }); // splintering
    this._noise(o, t + 0.9, 0.9, { type: 'lowpass', f: 400, f2: 90, gain: 1.1, pink: true }); this._tone(o, t + 0.9, 0.7, { f: 70, f2: 28, gain: 1.0 });
    this._noise(o, t + 0.9, 0.6, { f: 2500, f2: 800, gain: 0.35, q: 0.4 });
  }
  whiz(pos) {
    if (!this.ac) return; const n = this._node(pos, { gain: 0.8, delay: false, lp: 20000 }); if (!n) return;
    const t = this.ac.currentTime; this._noise(n.out, t, 0.2, { f: 5200, f2: 1400, gain: 0.7, q: 2.5, attack: 0.02 });
  }
  hitMarker() { if (!this.ac) return; const o = this.ac.createGain(); o.gain.value = 0.5; o.connect(this.master); this._tone(o, this.ac.currentTime, 0.05, { f: 1800, f2: 1400, gain: 0.6, type: 'square' }); }
  killSound() { if (!this.ac) return; const o = this.ac.createGain(); o.gain.value = 0.35; o.connect(this.master); this._tone(o, this.ac.currentTime, 0.12, { f: 900, f2: 700, gain: 0.6, type: 'square' }); this._tone(o, this.ac.currentTime + 0.08, 0.15, { f: 1200, f2: 900, gain: 0.5, type: 'square' }); }
  hurt() { if (!this.ac) return; const o = this.ac.createGain(); o.gain.value = 0.8; o.connect(this.master); this._tone(o, this.ac.currentTime, 0.16, { f: 120, f2: 50, gain: 0.8 }); this._noise(o, this.ac.currentTime, 0.12, { type: 'lowpass', f: 800, gain: 0.5 }); }
  beep(f = 800, dur = 0.12) { if (!this.ac) return; const o = this.ac.createGain(); o.gain.value = 0.25; o.connect(this.master); this._tone(o, this.ac.currentTime, dur, { f, f2: f, gain: 0.8, type: 'square' }); }
  _heart(a) { const o = this.ac.createGain(); o.gain.value = 0.45 * Math.min(1.4, a); o.connect(this.master); const t = this.ac.currentTime; this._tone(o, t, 0.12, { f: 58, f2: 38, gain: 1 }); this._tone(o, t + 0.17, 0.12, { f: 52, f2: 34, gain: 0.7 }); }
  _distantBoom() { const p = { x: this.lx + rand(-1, 1) * 400, y: 5, z: this.lz + rand(-1, 1) * 400 }; const n = this._node(p, { gain: 0.55, lp: 800, lpd: 100, send: 1.2, delay: false }); if (!n) return; const t = this.ac.currentTime; this._noise(n.out, t, 1.6, { type: 'lowpass', f: 300, f2: 60, gain: 1, pink: true, attack: 0.05 }); this._tone(n.out, t, 1.4, { f: 50, f2: 25, gain: 0.8, attack: 0.05 }); }
  _bird() { const p = { x: this.lx + rand(-30, 30), y: 8 + rand(0, 6), z: this.lz + rand(-30, 30) }; const n = this._node(p, { gain: 0.25, delay: false, lp: 12000, lpd: 80 }); if (!n) return; const t = this.ac.currentTime; const f = rand(2200, 3800); for (let i = 0; i < 2 + Math.floor(Math.random() * 4); i++) this._tone(n.out, t + i * 0.13, 0.09, { f: f * rand(0.9, 1.1), f2: f * rand(1.2, 1.5), gain: 0.5 }); }
  _cricket() { const p = { x: this.lx + rand(-12, 12), y: 0.3, z: this.lz + rand(-12, 12) }; const n = this._node(p, { gain: 0.12, delay: false }); if (!n) return; const t = this.ac.currentTime; for (let i = 0; i < 24; i++) this._tone(n.out, t + i * 0.05, 0.03, { f: 4300, f2: 4300, gain: 0.35 }); }
}
