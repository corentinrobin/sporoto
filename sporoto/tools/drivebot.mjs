// Validation du mode conduite sans affichage : un pilote automatique (suivi de trajectoire + vitesse cible)
// conduit la voiture via les mêmes commandes qu'un joueur (gaz, frein, direction).
import { Session } from '../js/session.js';
import { CARS } from '../js/data/cars.js';
import { DriveRun } from '../js/drive.js';
globalThis.SPOROTO_DEBUG = true;
const [ck = 'F1', tid = 'spa', pace = '0.97'] = process.argv.slice(2);
const cfg = { trackId: tid, carType: ck, car: { ...CARS[ck], consistency: 0 }, env: { weather: 'dry', intensity: 0, night: false, windSpeed: 0, windDir: 0, airTemp: 22, trackTemp: 32, surface: 'asphalt' }, session: { laps: 3, standing: true, seed: 1, autoPit: false, pitWear: 75 } };
const R = Object.create(DriveRun.prototype);
R.cfg = cfg; R.session = new Session(cfg); R.tr = R.session.track; R.inp = { thr: 0, brk: 0, steer: 0 };
const sim = R.session.sim, st = R.session.state, tr = R.tr, N = tr.N;
const ref = sim.simulateLap(JSON.parse(JSON.stringify(st)), {});
const vref = sim.vback.slice();
R.car = { X: tr.px[2], Z: tr.pz[2], th: Math.atan2(tr.hx[2], tr.hz[2]), vx: 0, vy: 0, r: 0, ax: 0, ay: 0, idx: 2, delta: 0, gear: 1, shift: 0 };
R.refreshGrip(); R.tctx = sim.thermalCtx(sim.d.m0 + st.fuel * cfg.car.fuelDensity); R.ers = sim.d.Eers;
const c = R.car; let t = 0, lapStart = 0, laps = [], passed = 0, maxBeta = 0, maxE = 0, last = 2, off = 0;
const DT = 1 / 240;
let lastPrint = -1;
while (laps.length < 3 && t < (+process.env.TMAX || 900)) {
  // pilote auto (contrôleur de Stanley) : anticipation de courbure + cap + écart à la trajectoire idéale
  const i = c.idx, ia = (i + Math.round((2 + c.vx * 0.12) / tr.step)) % N;
  const thL = Math.atan2(tr.hx[i], tr.hz[i]);
  let err = thL - c.th; err = Math.atan2(Math.sin(err), Math.cos(err));
  const eL = (c.X - tr.px[i]) * tr.hz[i] - (c.Z - tr.pz[i]) * tr.hx[i];      // > 0 : à gauche de la trajectoire
  const dCmd = Math.atan(cfg.car.wheelbase * tr.kappa[ia]) + err - Math.atan(2.2 * eL / (c.vx + 2)) - 0.25 * c.r / Math.max(c.vx, 5);
  R.inp.steer = Math.max(-1, Math.min(1, dCmd / (c.dMax || 0.1)));
  const vt = vref[(i + 2) % N] * +pace;
  const dv = vt - c.vx;
  R.inp.thr = Math.max(0, Math.min(1, dv * 0.6 + 0.2)); R.inp.brk = Math.max(0, Math.min(1, -dv * 0.25));
  if (R.inp.brk > 0) R.inp.thr = 0;
  R.step(DT); t += DT;
  const bNow = Math.abs(Math.atan2(c.vy, Math.max(c.vx, 5)));
  if (process.env.SPIN && bNow > 0.12 && t - (globalThis._lastSpin || -9) > 3) { globalThis._lastSpin = t; console.log('dérive', (bNow * 57.3).toFixed(0) + '°', 't', t.toFixed(1), 's=', Math.round(tr.rs[c.idx]), 'm  v', (c.vx * 3.6).toFixed(0), 'vt', (vt * 3.6).toFixed(0), 'κ', (tr.kappa[c.idx] * 1000).toFixed(1), 'thr', R.inp.thr.toFixed(2), 'brk', R.inp.brk.toFixed(2), 'st', R.inp.steer.toFixed(2), 'e', c.e.toFixed(1)); }
  if (process.env.DBG && t > +process.env.DBG && t < +process.env.DBG + 3 && Math.floor(t * 20) !== globalThis._lp) { globalThis._lp = Math.floor(t * 20); const g = c.dbg; console.log(t.toFixed(2), 'v', (c.vx * 3.6).toFixed(0), 'β', (Math.atan2(c.vy, Math.max(c.vx, 5)) * 57.3).toFixed(1), 'r', c.r.toFixed(2), 'st', R.inp.steer.toFixed(2), 'thr', R.inp.thr.toFixed(2), 'brk', R.inp.brk.toFixed(2), 'δ', (g.delta * 57.3).toFixed(1), 'αF', (g.alphaF * 57.3).toFixed(1), 'αR', (g.alphaR * 57.3).toFixed(1), 'FyF/Dy', (c.FyF / g.DyF).toFixed(2), 'FyR/Dy', (c.FyR / g.DyR).toFixed(2), 'DyR/capY', (g.DyR / g.capYR).toFixed(2), 'FxR', g.FxRear.toFixed(0), 'FzF', g.FzF.toFixed(0), 'FzR', g.FzR.toFixed(0), 'κ', (tr.kappa[c.idx] * 1000).toFixed(0), 'e', c.e.toFixed(1)); }
  if (process.env.TRACE && Math.floor(t * 2) !== lastPrint) { lastPrint = Math.floor(t * 2); console.log(t.toFixed(1), 'i', c.idx, 'e', c.e.toFixed(1), 'v', (c.vx * 3.6).toFixed(0), 'vt', (vt * 3.6).toFixed(0), 'β', (Math.atan2(c.vy, Math.max(c.vx, 5)) * 57.3).toFixed(1), 'r', c.r.toFixed(2), 'err', (err * 57.3).toFixed(1), 'st', R.inp.steer.toFixed(2), 'thr', R.inp.thr.toFixed(2), 'brk', R.inp.brk.toFixed(2), 'κ', (tr.kappa[c.idx]*1000).toFixed(1)); } R.gripT > 0.5 && R.refreshGrip();
  maxBeta = Math.max(maxBeta, Math.abs(Math.atan2(c.vy, Math.max(c.vx, 5))));
  maxE = Math.max(maxE, Math.abs(c.e)); if (Math.abs(c.e) > tr.width / 2 + 1.2) off += DT;
  const fwd = (c.idx - last + N) % N; if (fwd > 0 && fwd < N / 2) { passed += fwd; last = c.idx; }
  if (passed >= N) { laps.push(t - lapStart); lapStart = t; passed -= N; }
}
const f = x => `${Math.floor(x / 60)}:${(x % 60).toFixed(3).padStart(6, '0')}`;
console.log(`${ck} ${tid} rythme ${pace} | réf. simulée ${f(ref.time)} | tours pilote auto : ${laps.map(f).join(' ')} | dérive max ${(maxBeta * 57.3).toFixed(1)}° | écart latéral max ${maxE.toFixed(1)} m | hors-piste ${off.toFixed(1)} s | pneus ${st.tires.map(x => x.T.toFixed(0)).join('/')} °C`);
