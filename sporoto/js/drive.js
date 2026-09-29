// Sporoto — mode conduite. Le joueur gère accélérateur, frein et direction ; la boîte, l'ABS et l'antipatinage
// sont automatiques. Dynamique transitoire « bicyclette » (dérive des pneus avant/arrière, lacet, transferts de charge)
// qui réutilise le moteur physique du simulateur : adhérence (conditions, température, usure, charge, carrossage),
// aérodynamique (appui, traînée, vent, talonnage), moteur et hybride, freins, pente, thermique des pneus et des freins.
import { LiveRun, CAMS } from './hud.js';
import { t } from './i18n.js';
import { fmtTime } from './session.js';
import { G } from './physics.js';

const $ = (s, r = document) => r.querySelector(s);
const DT = 1 / 240;          // pas d'intégration
const KERB = 1.2;            // largeur des vibreurs (m)
const WALL = 22;             // distance du mur au bord de piste (m)

export class DriveRun extends LiveRun {
  constructor(cfg, cb) {
    super({ ...cfg, session: { ...cfg.session, autoPit: false, standing: true, mode: 'drive' } }, cb);
    this.keys = {};
    this.onKeyUp = this.onKeyUp.bind(this);
    this.inp = { thr: 0, brk: 0, steer: 0 };
  }

  async start() {
    await super.start();
    this.phase = 'run';
    window.addEventListener('keyup', this.onKeyUp);
    const sim = this.session.sim, st = this.session.state;
    // tour de référence simulé (trajectoire idéale colorée + trace de vitesse de comparaison)
    const clone = JSON.parse(JSON.stringify(st));
    const ref = sim.simulateLap(clone, {});
    this.refTime = ref.time; this.refFuel = ref.fuelUsed;
    this.bestV = sim.trace.v.slice();
    this.r3d.colorLine(sim.trace);
    // état initial de la voiture : arrêtée juste après la ligne, sur la trajectoire
    const tr = this.tr, i0 = 2;
    this.car = { X: tr.px[i0], Z: tr.pz[i0], th: Math.atan2(tr.hx[i0], tr.hz[i0]), vx: 0, vy: 0, r: 0, ax: 0, ay: 0, idx: i0, delta: 0, gear: 1, shift: 0 };
    sim.hasPrev = false;
    this.refreshGrip();
    this.tctx = sim.thermalCtx(sim.d.m0 + st.fuel * this.cfg.car.fuelDensity);
    this.ers = sim.d.Eers;
    this.newLap();
    this.renderTiming();
  }

  destroy() { super.destroy(); window.removeEventListener('keyup', this.onKeyUp); }

  // Adhérence par point recalculée depuis l'état courant des pneus (températures, usure, pressions)
  refreshGrip() {
    const sim = this.session.sim, st = this.session.state, c = this.cfg.car, d = sim.d;
    sim.hasPrev = false;
    sim.prepareGrip(st, 1);
    const pAvg = [0, 1, 2, 3].reduce((s, k) => s + sim.pressHot(st, k), 0) / 4;
    sim.crrP = Math.pow(((c.pressOptF + c.pressOptR) / 2) / pAvg, 0.4) * (1 + 0.15 * d.wetness);
    this.gripT = 0;
  }

  // nouvelle télémétrie de tour, remplie au fil du roulage
  newLap() {
    const T = this.session.sim.trace, trace = {};
    for (const k of Object.keys(T)) trace[k] = new T[k].constructor(T[k].length);
    const n = this.session.laps.length + 1;
    this.cur = { rec: { lap: n, sectors: [Infinity, Infinity, Infinity], util: [0, 0, 0, 0], mgmt: 1, fuelUsed: this.refFuel || 2 }, trace, t: 0, idx: this.car ? this.car.idx : 0, lapTime: Infinity, fuel0: this.session.state.fuel, vmax: 0, vmin: 1e9, off: 0 };
  }

  startLap() { this.newLap(); return true; }
  doneLaps() { return this.session.laps; }

  renderTiming() {
    super.renderTiming();
    const rows = $('#timing .tim-rows');
    if (rows && this.refTime) rows.insertAdjacentHTML('beforeend', `<span>${t('ref_ai')}</span><b style="color:var(--green)">${fmtTime(this.refTime)}</b>`);
  }

  buildControls() {
    const el = $('#controls');
    el.innerHTML = `
      <div class="ctl-row"><button class="hbtn wide" id="cPlay">${this.paused ? '▶ ' + t('play') : '❚❚ ' + t('pause')}</button><button class="hbtn wide" id="cReset">${t('reset_car')}</button></div>
      <div class="ctl-row"><span class="lbl">${t('camera')}</span>${CAMS.map((c, k) => `<button class="hbtn ${k === this.camIdx ? 'on' : ''}" data-c="${k}">${t('cam_' + c)}</button>`).join('')}</div>
      <div class="ctl-row"><span class="lbl">${t('sound')}</span><button class="hbtn ${this.audio.constructor.enabled ? 'on' : ''}" id="cSound">${this.audio.constructor.enabled ? '🔊 ' + t('yes') : '🔇 ' + t('no')}</button><input type="range" id="cVol" min="0" max="1" step="0.05" value="${this.audio.constructor.volume}" style="flex:1"></div>
      <div class="ctl-row"><button class="hbtn wide" id="cExport">${t('export_json')}</button></div>
      <div class="ctl-row"><button class="hbtn wide" id="cStop">${t('stop')}</button><button class="hbtn wide" id="cBack">${t('back_garage')}</button></div>
      <div class="ctl-row" style="color:var(--dim);font-size:11px">${t('drive_keys')}</div>`;
    $('#cPlay').onclick = () => { this.paused = !this.paused; this.buildControls(); };
    $('#cReset').onclick = () => this.resetCar();
    el.querySelectorAll('[data-c]').forEach(b => b.onclick = () => { this.camIdx = +b.dataset.c; this.r3d.setCamMode(CAMS[this.camIdx]); this.buildControls(); });
    $('#cSound').onclick = () => { this.audio.setEnabled(!this.audio.constructor.enabled); this.buildControls(); };
    $('#cVol').oninput = e => this.audio.setVolume(+e.target.value);
    $('#cExport').onclick = () => import('./hud.js').then(m => { const rep = this.session.report(); m.download(m.reportName(rep), rep); });
    $('#cStop').onclick = () => { const rep = this.session.report(); this.destroy(); this.cb.onResults(rep); };
    $('#cBack').onclick = () => this.cb.onExit();
  }

  onKey(e) {
    if (e.target.tagName === 'INPUT') return;
    const k = e.code;
    if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space'].includes(k)) e.preventDefault();
    this.keys[k] = true;
    if (k === 'KeyP' || k === 'Escape') { this.paused = !this.paused; this.buildControls(); }
    else if (k === 'KeyC') { this.camIdx = (this.camIdx + 1) % CAMS.length; this.r3d.setCamMode(CAMS[this.camIdx]); this.buildControls(); }
    else if (k === 'KeyM') { this.audio.setEnabled(!this.audio.constructor.enabled); this.buildControls(); }
    else if (k === 'KeyR') this.resetCar();
  }
  onKeyUp(e) { this.keys[e.code] = false; }

  // Commandes : clavier (Z/W ↑ accélérer, S ↓ freiner, Q/A ← D → tourner) ou manette
  readInputs(dt) {
    const K = this.keys, inp = this.inp;
    let thrT = (K.ArrowUp || K.KeyW) ? 1 : 0, brkT = (K.ArrowDown || K.KeyS || K.Space) ? 1 : 0;
    let steerT = ((K.ArrowLeft || K.KeyA) ? 1 : 0) - ((K.ArrowRight || K.KeyD) ? 1 : 0);
    let analog = false;
    const pads = navigator.getGamepads ? navigator.getGamepads() : [];
    for (const p of pads) {
      if (!p) continue;
      const ax = p.axes[0] || 0, rt = p.buttons[7]?.value || 0, lt = p.buttons[6]?.value || 0;
      if (Math.abs(ax) > 0.08 || rt > 0.02 || lt > 0.02) {
        analog = true;
        steerT = -Math.sign(ax) * Math.pow(Math.max(0, Math.abs(ax) - 0.06) / 0.94, 1.4);
        thrT = Math.max(thrT, rt); brkT = Math.max(brkT, lt);
      }
    }
    const ramp = (cur, tgt, up, down) => cur < tgt ? Math.min(tgt, cur + up * dt) : Math.max(tgt, cur - down * dt);
    if (analog) { inp.thr = thrT; inp.brk = brkT; inp.steer = steerT; }
    else {
      inp.thr = ramp(inp.thr, thrT, 7, 10);
      inp.brk = ramp(inp.brk, brkT, 9, 12);
      // direction au clavier : progressive, retour au centre plus rapide
      const back = Math.sign(steerT) !== Math.sign(inp.steer) && inp.steer !== 0;
      inp.steer = ramp(inp.steer, steerT, back ? 6 : 2.6, back ? 6 : 2.6);
    }
  }

  nearest(X, Z, i0) {
    const tr = this.tr, N = tr.N;
    let best = Infinity, bi = i0;
    for (let o = -40; o <= 40; o++) {
      const i = (i0 + o + N) % N;
      const d = (tr.cx[i] - X) ** 2 + (tr.cz[i] - Z) ** 2;
      if (d < best) { best = d; bi = i; }
    }
    return bi;
  }

  // Position projetée sur la ligne médiane : fraction f entre les points i et i+1 (hauteur et pente interpolées)
  trackProj(X, Z, i) {
    const tr = this.tr, N = tr.N;
    let a = i, b = (i + 1) % N;
    const dx = tr.cx[b] - tr.cx[a], dz = tr.cz[b] - tr.cz[a];
    let f = ((X - tr.cx[a]) * dx + (Z - tr.cz[a]) * dz) / (dx * dx + dz * dz || 1);
    if (f < 0) { b = a; a = (i - 1 + N) % N; const ex = tr.cx[b] - tr.cx[a], ez = tr.cz[b] - tr.cz[a]; f = ((X - tr.cx[a]) * ex + (Z - tr.cz[a]) * ez) / (ex * ex + ez * ez || 1); }
    f = Math.max(0, Math.min(1, f));
    const bank = tr.bank ? tr.bank[a] + (tr.bank[b] - tr.bank[a]) * f : 0;
    return { y: tr.cy[a] + (tr.cy[b] - tr.cy[a]) * f, grade: tr.grade[a] + (tr.grade[b] - tr.grade[a]) * f, bank };
  }

  resetCar() {
    const tr = this.tr, c = this.car, i = c.idx;
    c.X = tr.px[i]; c.Z = tr.pz[i]; c.th = Math.atan2(tr.hx[i], tr.hz[i]);
    c.vx = Math.min(c.vx, 15); c.vy = 0; c.r = 0;
  }

  // Boîte automatique : passage montant au rupteur ou quand le rapport supérieur donne plus de puissance (+2 %),
  // rétrogradage quand le rapport inférieur donne nettement plus de puissance (+6 %) sans dépasser le rupteur
  autoGear(v, dt) {
    const d = this.session.sim.d, cfg = this.cfg.car, c = this.car, n = d.ratios.length;
    const rpmAt = g => Math.max(v / cfg.tireRadius * d.ratios[g - 1] * 60 / (2 * Math.PI), g === 1 ? cfg.rpmPeak * 0.62 : 0);
    const P = g => { const r = rpmAt(g); return r > cfg.rpmMax * 1.001 ? 0 : d.Pc(r); };
    let g = Math.min(n, Math.max(1, c.gear));
    if (g < n && (rpmAt(g) >= cfg.rpmMax * 0.995 || P(g + 1) > P(g) * 1.02)) { g++; c.shift = cfg.shiftMs / 1000; }
    else if (g > 1 && rpmAt(g - 1) < cfg.rpmMax * 0.97 && P(g - 1) > P(g) * 1.06) g--;
    c.gear = g;
    const rpm = Math.min(cfg.rpmMax, Math.max(rpmAt(g), cfg.rpmPeak * 0.3));
    return { P: rpmAt(g) > cfg.rpmMax * 1.001 ? 0 : d.Pc(rpm), rpm };
  }

  // Un pas de dynamique (DT)
  step(dt) {
    const sim = this.session.sim, d = sim.d, cfg = this.cfg.car, st = this.session.state, tr = this.tr, c = this.car, inp = this.inp;
    const cap = sim._cap || (sim._cap = { fz: new Float64Array(4), mu: new Float64Array(4) }), A = sim._A || (sim._A = new Float64Array(4));
    const i = c.idx = this.nearest(c.X, c.Z, c.idx);
    const hw = tr.width / 2;
    const e = (c.X - tr.cx[i]) * tr.nx[i] + (c.Z - tr.cz[i]) * tr.nz[i];
    c.e = e;
    const off = Math.abs(e) > hw + KERB;
    const gm = off ? 0.55 : 1;
    const m = d.m0 + st.fuel * cfg.fuelDensity;
    const vx = Math.max(0, c.vx), vxs = Math.max(vx, 2.5);
    // charges, adhérences et aéro (transferts avec les accélérations du pas précédent)
    sim.caps(i, vx, c.ax, m, cap, A, c.ayT ?? c.ay);
    const FzF = cap.Ff, FzR = cap.Fr;
    const capXF = cap.FxF * gm, capXR = cap.FxR * gm, capYF = cap.FyF * gm, capYR = cap.FyR * gm;
    // direction assistée : braquage maxi adapté à la vitesse (un peu au-delà de la limite d'adhérence)
    const muRef = (capYF + capYR) / Math.max(1, FzF + FzR);
    const ayMax = muRef * (FzF + FzR) / m;
    const aPk = this.cfg.car.family === 'gt' ? 0.11 : 0.095;
    const dMax = Math.max(0.05, Math.min(0.42, Math.atan(cfg.wheelbase * ayMax / Math.max(vxs, 6) ** 2) + 1.15 * aPk));
    // aide au contre-braquage : si l'arrière décroche (dérive des pneus arrière au-delà de leur optimum),
    // les roues avant contre-braquent automatiquement
    const a_ = cfg.wheelbase * (1 - d.wf), b_ = cfg.wheelbase * d.wf;
    const aR0 = -Math.atan2(c.vy - b_ * c.r, vxs), aPkR = aPk / 1.45;
    const slideR = Math.abs(aR0) > aPkR ? aR0 - Math.sign(aR0) * aPkR : 0;
    c.dMax = dMax;
    c.delta = Math.max(-0.45, Math.min(0.45, inp.steer * dMax - (vx > 5 ? 0.8 * slideR : 0)));
    const delta = c.delta;
    // moteur et boîte automatique avec hystérésis (évite de « chercher » le rapport), hybride
    const gearInfo = this.autoGear(vx, dt);
    const pw = { Pice: gearInfo.P * cfg.driveEff, Pers: this.ers > 0 && vx > 12 ? d.Pers * 0.95 : 0, rpm: gearInfo.rpm, gear: c.gear };
    const cut = c.shift > 0 ? 0 : 1; c.shift = Math.max(0, c.shift - dt);
    const latF = Math.min(0.98, Math.abs(c.FyF || 0) / Math.max(1, capYF)), latR = Math.min(0.98, Math.abs(c.FyR || 0) / Math.max(1, capYR));
    let Fdrive = inp.thr * (pw.Pice + pw.Pers) * cut / Math.max(vx, 3);
    // antipatinage : effort moteur limité à l'adhérence restante de l'essieu moteur
    const drv = cfg.drive;
    const tracCap = drv === 'FWD' ? capXF * Math.sqrt(1 - latF * latF) : drv === 'AWD' ? (capXF * Math.sqrt(1 - latF * latF) + capXR * Math.sqrt(1 - latR * latR)) : capXR * Math.sqrt(1 - latR * latR);
    Fdrive = Math.min(Fdrive, 0.96 * tracCap);
    // antipatinage : l'essieu moteur garde toujours une réserve d'adhérence latérale (usage combiné ≤ 92 %)
    if (drv !== 'FWD') Fdrive = Math.min(Fdrive, capXR * Math.sqrt(Math.max(0, 0.92 * 0.92 - latR * latR)) / (drv === 'AWD' ? 0.6 : 1));
    if (c.esc > 0) { c.esc -= dt; Fdrive *= 0.35; }     // ESP actif : couple réduit
    // freins + ABS par essieu
    const bBias = cfg.brakeBias / 100;
    const fade = Math.min(sim.brakeFade(st.brakes[0]), sim.brakeFade(st.brakes[1]));
    const Fb = inp.brk * cfg.brakeCap * 1000 * fade;
    // ABS directionnel : garde une réserve d'adhérence latérale proportionnelle au braquage demandé
    const want = Math.min(0.85, Math.abs(inp.steer) * 0.9);
    const resF = Math.max(latF, want), resR = Math.max(latR, Math.min(0.9, want * 1.05));
    const FbF = Math.min(Fb * bBias, 0.97 * capXF * Math.sqrt(Math.max(0, 1 - resF * resF)));
    const FbR = Math.min(Fb * (1 - bBias), 0.97 * capXR * Math.sqrt(Math.max(0, 1 - resR * resR)));
    const Feb = inp.thr < 0.05 && vx > 2 ? d.Pmax * 0.04 / Math.max(vx, 10) : 0;     // frein moteur
    let res = sim.resist(i, vx, m, A) + (off ? 0.05 * m * G : 0);
    if (vx < 0.3) res = Math.min(res, Fdrive);                                        // pas de recul à l'arrêt
    // efforts latéraux (formule magique simplifiée) limités par l'ellipse de friction
    // pic de dérive : ~6° à l'avant ; pneus arrière plus larges → plus rigides en dérive (voiture stable, sous-vireuse au lever de pied)
    const C = 1.45, B = 2.07 / aPk, BR = B * 1.45;
    const a = cfg.wheelbase * (1 - d.wf), b = cfg.wheelbase * d.wf;
    const alphaF = delta - Math.atan2(c.vy + a * c.r, vxs), alphaR = -Math.atan2(c.vy - b * c.r, vxs);
    const FxFront = (drv === 'FWD' ? Fdrive : drv === 'AWD' ? Fdrive * 0.4 : 0) - FbF;
    const FxRear = (drv === 'FWD' ? 0 : drv === 'AWD' ? Fdrive * 0.6 : Fdrive) - FbR - Feb;
    const DyF = capYF * Math.sqrt(Math.max(0.05, 1 - (FxFront / Math.max(1, capXF)) ** 2));
    const DyR = capYR * Math.sqrt(Math.max(0.05, 1 - (FxRear / Math.max(1, capXR)) ** 2));
    const FyF = DyF * Math.sin(C * Math.atan(B * alphaF)), FyR = DyR * Math.sin(C * Math.atan(BR * alphaR));
    c.FyF = FyF; c.FyR = FyR;
    if (globalThis.SPOROTO_DEBUG) c.dbg = { alphaF, alphaR, DyF, DyR, capYF, capYR, FxFront, FxRear, FzF, FzR, delta };
    // équations du mouvement (repère véhicule)
    const Iz = m * a * b * 1.05;
    // contrôle de stabilité (ESP) : si l'arrière glisse nettement au-delà de son optimum, moment de lacet
    // correcteur (freinage différentiel) et coupure partielle des gaz
    let Mz = 0;
    if (vx > 6 && Math.abs(alphaR) > 1.3 * aPkR) {
      // autorité ≈ freinage d'une roue avant extérieure à la limite d'adhérence
      const Mmax = 0.5 * capXF * cfg.trackWidth;
      const ex = alphaR - Math.sign(alphaR) * 1.3 * aPkR;
      Mz = Math.max(-Mmax, Math.min(Mmax, -Iz * 40 * ex - Iz * 2.5 * c.r * (Math.sign(c.r) === Math.sign(alphaR) ? 1 : 0)));
      c.esc = 0.3;
    }
    const Fx = FxFront * Math.cos(delta) + FxRear - FyF * Math.sin(delta) - res;
    const Fy = FyF * Math.cos(delta) + FxFront * Math.sin(delta) + FyR;
    // piste relevée : la composante de la gravité dans le plan de la piste pousse vers le bas du dévers
    const phi = tr.bank ? tr.bank[i] : 0;
    const axB = Fx / (m * d.m_eff), ayB = Fy / m + G * Math.sin(phi);
    c.vx += (axB + c.vy * c.r) * dt;
    c.vy += (ayB - c.vx * c.r) * dt;
    c.r += (a * (FyF * Math.cos(delta) + FxFront * Math.sin(delta)) - b * FyR + Mz) / Iz * dt;
    if (c.vx < 0) c.vx = 0;
    if (c.vx < 3) { const k = Math.exp(-dt * 6 * (3 - c.vx)); c.vy *= k; c.r *= k; }
    c.ax = axB; c.ay = ayB; c.ayT = Fy / m;
    // position
    const sn = Math.sin(c.th), cs = Math.cos(c.th);
    c.th += c.r * dt;
    c.X += (c.vx * sn + c.vy * cs) * dt;
    c.Z += (c.vx * cs - c.vy * sn) * dt;
    // mur : choc, la voiture est ralentie et réalignée
    if (Math.abs(e) > hw + WALL) {
      const sg = Math.sign(e), back = Math.abs(e) - (hw + WALL - 0.5);
      c.X -= sg * tr.nx[i] * back; c.Z -= sg * tr.nz[i] * back;
      c.vx *= 0.4; c.vy = 0; c.r = 0; c.th = Math.atan2(tr.hx[i], tr.hz[i]);
      this.hitT = 1.2;
    }
    // énergie : hybride puis thermique ; carburant
    const Pwheel = Math.max(0, Fdrive * vx);
    let Pers = 0;
    if (Pwheel > pw.Pice && this.ers > 0) { Pers = Math.min(Pwheel - pw.Pice, d.Pers * 0.95); this.ers -= Pers / 0.95 * dt; }
    const Pice = Math.max(0, Pwheel - Pers) / cfg.driveEff;
    const dm = (Pice > 0 ? Pice / cfg.bte : d.Pmax * 0.012) * dt / (cfg.lhv * 1e6);
    st.fuel = Math.max(0, st.fuel - dm / cfg.fuelDensity);
    // thermique pneus et freins (même modèle que le simulateur)
    sim.caps(i, vx, c.ax, m, cap, A, c.ayT ?? c.ay);
    const util = sim.thermalStep(st, this.tctx, cap, [Math.abs(FxFront), Math.abs(FxRear)], [Math.abs(FyF), Math.abs(FyR)], FbF + FbR, vx, dt);
    this.lastStep = { pw, Pwheel, Fb: FbF + FbR, util, i, A: [A[0], A[1], A[2], A[3]] };
    this.gripT += dt;
  }

  loop(now) {
    this.raf = requestAnimationFrame(this.loop);
    const dtReal = Math.min(0.05, (now - this.last) / 1000); this.last = now;
    const tr = this.tr, N = tr.N, c = this.car, cur = this.cur, T = cur.trace, st = this.session.state;
    const running = this.phase === 'run' && !this.paused;
    this.readInputs(dtReal);
    if (running) {
      const i0 = c.idx;
      for (let n = Math.round(dtReal / DT); n > 0; n--) this.step(DT);
      if (this.gripT > 0.5) this.refreshGrip();
      cur.t += dtReal;
      const i1 = c.idx;
      const v = Math.hypot(c.vx, c.vy);
      cur.vmax = Math.max(cur.vmax, v); if (cur.t > 3) cur.vmin = Math.min(cur.vmin, v);
      if (Math.abs(c.e) > tr.width / 2 + KERB) cur.off += dtReal;
      // télémétrie : remplit les points parcourus
      const fwd = ((i1 - i0 + N) % N);
      if (fwd > 0 && fwd < N / 2) {
        const L = this.lastStep;
        for (let k = 1; k <= fwd; k++) {
          const j = (i0 + k) % N;
          T.t[j] = cur.t; T.v[j] = v; T.gear[j] = c.gear; T.rpm[j] = L.pw.rpm; T.thr[j] = this.inp.thr; T.brk[j] = this.inp.brk;
          T.ax[j] = c.ax; T.ay[j] = c.ay; T.u[j] = L.util; T.df[j] = L.A[0] + L.A[1]; T.drag[j] = L.A[2]; T.ride[j] = L.A[3]; T.pw[j] = L.Pwheel;
          for (let q = 0; q < 4; q++) { T.tT[j * 4 + q] = st.tires[q].T; T.tW[j * 4 + q] = st.tires[q].wear; T.tP[j * 4 + q] = this.session.sim.pressHot(st, q); }
          T.bT[j * 2] = st.brakes[0]; T.bT[j * 2 + 1] = st.brakes[1]; T.fuel[j] = st.fuel; T.ers[j] = this.ers;
          // secteurs et ligne d'arrivée
          if (j === Math.floor(N / 3) && cur.rec.sectors[0] === Infinity) cur.rec.sectors[0] = cur.t;
          if (j === Math.floor(2 * N / 3) && cur.rec.sectors[0] !== Infinity && cur.rec.sectors[1] === Infinity) cur.rec.sectors[1] = cur.t - cur.rec.sectors[0];
          if (j === 0 && cur.rec.sectors[1] !== Infinity) { this.completeLap(); break; }
        }
      }
      if (st.fuel <= 0 && !this.session.dnf) { this.session.dnf = 'fuel'; this.completeLap(true); }
    }
    // rendu
    const i = c.idx, v = Math.hypot(c.vx, c.vy);
    const hw = tr.width / 2;
    // hauteur : piste interpolée, puis raccord progressif vers le relief au-delà des vibreurs
    const P = this.trackProj(c.X, c.Z, i);
    let y = P.y - (c.e || 0) * Math.tan(P.bank);          // dévers : hauteur selon l'écart latéral
    const out = Math.abs(c.e || 0) - (hw + KERB);
    if (out > 0) { const k = Math.min(1, out / 4); y = y + (Math.max(this.r3d.terrainHeight(c.X, c.Z), P.y - 3) - y) * k * k * (3 - 2 * k); }
    const dtVis = running ? dtReal : 0;
    // accélérations lissées pour la suspension visuelle (les coupures de passage de rapport durent quelques ms)
    const lp = 1 - Math.exp(-dtVis / 0.07);
    this.axV = (this.axV || 0) + (c.ax - (this.axV || 0)) * lp;
    this.ayV = (this.ayV || 0) + (c.ay - (this.ayV || 0)) * lp;
    this.carXZ = [c.X, c.Z];
    const L = this.lastStep || { A: [0, 0, 0, (this.cfg.car.rideFront + this.cfg.car.rideRear) / 2], pw: { rpm: this.cfg.car.rpmPeak * 0.35 }, util: 0 };
    this.r3d.place(c.X, y, c.Z, c.th, -Math.atan(P.grade), i, {
      v: c.vx, bank: -P.bank, ax: running ? this.axV : 0, ay: running ? this.ayV : 0, brk: this.inp.brk, ride: L.A[3], bT: st.brakes, steer: c.delta * 1.4,
      rain: this.cfg.env.weather !== 'dry',
    }, dtVis);
    // HUD : valeurs instantanées au point courant
    T.v[i] = v; T.gear[i] = c.gear; T.rpm[i] = c.vx < 1 ? this.cfg.car.rpmPeak * 0.35 : L.pw.rpm; T.thr[i] = this.inp.thr; T.brk[i] = this.inp.brk;
    T.ax[i] = c.ax; T.ay[i] = c.ay;
    if (this.audio) this.audio.update({ rpm: T.rpm[i], gear: c.gear, thr: this.inp.thr, brk: this.inp.brk, v, grip: L.util || 0, running, pit: false, cam: this.r3d.camMode, scale: 1 }, dtReal);
    this.hudT += dtReal;
    if (this.hitT > 0) { this.hitT -= dtReal; if (!this._hit) { this._hit = true; this.banner(t('wall_hit'), ''); } } else if (this._hit) { this._hit = false; $('#banner').classList.remove('show'); }
    if (this.hudT > 1 / 20) { this.hudT = 0; this.renderHUD(i, 0, v); this.driveBadge(); }
  }

  driveBadge() {
    const c = this.car, off = Math.abs(c.e || 0) > this.tr.width / 2 + KERB;
    const tc = $('#timCur');
    if (tc) tc.style.color = off ? 'var(--amber)' : '';
  }

  completeLap(dnf = false) {
    const cur = this.cur, s = this.session, st = s.state, T = cur.trace;
    const time = cur.t;
    const sec = cur.rec.sectors;
    if (sec[0] === Infinity) sec[0] = time;
    if (sec[1] === Infinity) sec[1] = Math.max(0, time - sec[0]);
    sec[2] = Math.max(0, time - sec[0] - sec[1]);
    const rec = {
      lap: cur.rec.lap, time, sectors: sec.slice(), vmax: cur.vmax * 3.6, vmin: (cur.vmin === 1e9 ? 0 : cur.vmin) * 3.6,
      fuelStart: cur.fuel0, fuelEnd: st.fuel, fuelUsed: cur.fuel0 - st.fuel, ersUsedMJ: 0,
      tires: st.tires.map((x, k) => ({ T: +x.T.toFixed(1), wear: +(x.wear * 100).toFixed(2), p: +s.sim.pressHot(st, k).toFixed(2) })),
      brakes: st.brakes.map(x => +x.toFixed(0)), mgmt: 1, util: [0, 0, 0, 0], pit: null, wearDelta: [0, 0, 0, 0],
      offTrack: +cur.off.toFixed(1), driver: 'human',
    };
    cur.rec = rec; cur.lapTime = time;
    s.laps.push(rec); s.totalTime += time;
    if (!dnf && Math.max(...st.tires.map(x => x.wear)) >= 1) s.dnf = 'tires';
    this.ers = s.sim.d.Eers;
    const carry = cur.t - time;
    this.finishLap();
    if (this.phase === 'run') { this.cur.t = carry; this.renderTiming(); }
  }
}

