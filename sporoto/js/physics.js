// Sporoto — moteur physique du véhicule. Aucune dépendance (utilisable dans Node pour les tests).
//
// Méthode : simulation de tour « quasi-statique transitoire » utilisée en ingénierie de course.
//  1. vitesse limite en chaque point de la trajectoire (équilibre latéral des deux essieux,
//     transferts de charge latéral / longitudinal, appui aéro avant / arrière, compression verticale) ;
//  2. passe arrière : freinage limite (ellipse de friction par essieu, répartiteur, capacité des freins,
//     traînée, pente) ;
//  3. passe avant intégrée dans le temps : motricité, courbe de puissance, rapports, limiteur, débit
//     carburant, hybride, et intégration de l'état : températures et usure des 4 pneus, pressions à chaud,
//     températures des freins, carburant, masse, énergie hybride.
// L'état d'un tour (températures, usure) alimente l'adhérence du tour suivant.

export const G = 9.80665;
const HP = 735.49875;          // 1 ch (W)
const PSI = 6894.757;
const SIGMA_SB = 5.670374e-8;
// Constantes thermiques calibrées (cf. tools/stint.mjs) : F1 ≈ 90–105 °C en régime établi,
// tendres à la « falaise » vers 16–20 tours à Barcelone/Silverstone.
const HEAT_K = 0.85;
const WEAR_K = 2.6e-8;

import { COMPOUNDS } from './data/cars.js';

export function airDensity(altitude, tempC, humidity = 0.5) {
  const p = 101325 * Math.pow(1 - 2.25577e-5 * altitude, 5.25588);
  const T = tempC + 273.15;
  const psat = 610.78 * Math.exp(17.27 * tempC / (tempC + 237.3));
  const pv = humidity * psat;
  return (p - pv) / (287.058 * T) + pv / (461.495 * T);
}

// Générateur pseudo-aléatoire reproductible
export function rng(seed) {
  let a = seed >>> 0;
  const f = () => { a |= 0; a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  f.gauss = () => { const u = Math.max(1e-9, f()), v = f(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v); };
  return f;
}

const SURF = {
  //            µ sec, rés. roulement, abrasivité
  asphalt: { mu: 1.00, crr: 0.012, abr: 1.0 },
  dirt:    { mu: 0.62, crr: 0.040, abr: 1.6 },
  grass:   { mu: 0.48, crr: 0.060, abr: 0.7 },
  ice:     { mu: 0.11, crr: 0.010, abr: 0.3 },
};
// multiplicateurs de gomme selon la surface (sec)
const SURF_COMP = {
  asphalt: { soft: 1, medium: 1, hard: 1, inter: 1, wet: 1, studs: 1 },
  dirt:    { soft: 0.88, medium: 0.88, hard: 0.88, inter: 1.12, wet: 1.20, studs: 1.35 },
  grass:   { soft: 0.85, medium: 0.85, hard: 0.85, inter: 1.10, wet: 1.18, studs: 1.35 },
  ice:     { soft: 0.95, medium: 0.95, hard: 0.95, inter: 1.25, wet: 1.40, studs: 6.0 },
};

// Adhérence « conditions » (hors température/usure/charge) pour une gomme, une surface, une météo.
function conditionMu(comp, surface, weather, I) {
  const c = COMPOUNDS[comp];
  if (surface === 'asphalt') {
    if (weather === 'rain') return { soft: 0.62 - 0.26 * I, medium: 0.61 - 0.26 * I, hard: 0.60 - 0.26 * I, inter: 0.80 - 0.14 * I, wet: 0.76 - 0.05 * I, studs: 0.62 - 0.06 * I }[comp];
    if (weather === 'snow') return { soft: 0.22, medium: 0.22, hard: 0.21, inter: 0.31, wet: 0.34, studs: 0.47 }[comp] * (1 - 0.18 * I);
    return c.mu;
  }
  let mu = SURF[surface].mu * SURF_COMP[surface][comp];
  if (weather === 'rain') mu *= { dirt: 0.68, grass: 0.58, ice: 0.50 }[surface] * (1 - 0.15 * I);
  else if (weather === 'snow') mu *= { dirt: 0.55, grass: 0.50, ice: 1.1 }[surface] * (1 - 0.18 * I);
  return mu;
}

export class Simulator {
  constructor(track, car, env) {
    this.tr = track; this.car = car; this.env = env;
    this.derive();
    const N = track.N;
    this.vlim = new Float64Array(N); this.vback = new Float64Array(N);
    this.muBase = new Float64Array(N * 4);      // adhérence par pneu (hors charge), tour courant
    this.prevT = new Float64Array(N * 4);       // températures pneus du tour précédent
    this.hasPrev = false;
    // traces du tour (lecture temps réel)
    this.trace = {
      t: new Float64Array(N + 1), v: new Float32Array(N + 1), gear: new Uint8Array(N + 1), rpm: new Float32Array(N + 1),
      thr: new Float32Array(N + 1), brk: new Float32Array(N + 1), ax: new Float32Array(N + 1), ay: new Float32Array(N + 1),
      tT: new Float32Array((N + 1) * 4), tW: new Float32Array((N + 1) * 4), tP: new Float32Array((N + 1) * 4),
      bT: new Float32Array((N + 1) * 2), fuel: new Float32Array(N + 1), ers: new Float32Array(N + 1),
      u: new Float32Array(N + 1), df: new Float32Array(N + 1), drag: new Float32Array(N + 1), ride: new Float32Array(N + 1), pw: new Float32Array(N + 1),
    };
  }

  // Grandeurs dérivées des réglages
  derive() {
    const c = this.car, e = this.env, tr = this.tr;
    const d = this.d = {};
    const alt = (tr.def.alt0 || 0) + (tr.ymax + tr.ymin) / 2;
    d.rho = airDensity(alt, e.airTemp, e.weather === 'rain' ? 0.95 : 0.55);
    const sigma = d.rho / 1.184;
    d.S = c.width * c.height * c.areaFactor;
    const dF = c.wingFront - c.wingFrontRef, dR = c.wingRear - c.wingRearRef;
    // Ailerons : ~3 %/° d'appui sur l'essieu concerné, traînée surtout à l'arrière
    let bal = c.aeroBalance / 100 + 0.0012 * ((c.rideRear - c.rideFront) - c.rakeRef);
    const ClA = c.cz * d.S;
    let ClAf = ClA * bal * Math.max(0.1, 1 + 0.035 * dF);
    let ClAr = ClA * (1 - bal) * Math.max(0.1, 1 + 0.030 * dR);
    // Effet de sol : plus bas = plus d'appui (jusqu'au talonnage)
    const hAvg = (c.rideFront + c.rideRear) / 2;
    const ge = Math.max(0.6, Math.min(1.35, 1 + c.groundEffect * (c.rideRef - hAvg) / c.rideRef));
    ClAf *= ge; ClAr *= ge;
    d.ClAf = ClAf; d.ClAr = ClAr; d.ClA = ClAf + ClAr;
    d.CdA = c.cx * d.S * (1 + 0.004 * dF + 0.012 * dR + 0.06 * (ge - 1)) + 0.012 * d.S * (c.brakeDuct / 100);
    d.hAvg = hAvg;
    d.kHeave = c.heaveK * (0.45 + 1.1 * c.stiffness / 100) * 1000; // N/m
    // Masse, géométrie
    d.m0 = c.mass; d.wf = c.weightFront / 100; d.h = c.cgHeight; d.L = c.wheelbase; d.tw = c.trackWidth;
    d.lltd = c.lltd / 100;
    // Moteur
    const powerAir = c.turbo ? Math.min(1.0, Math.pow(sigma, 0.18)) * (1 - Math.max(0, e.airTemp - 30) * 0.001)
                             : Math.pow(sigma, 0.95);
    d.Pmax = c.power * HP * powerAir;
    // plafond réglementaire de débit carburant (F1 : 100 kg/h) : puissance thermique maxi = débit × PCI × rendement
    d.Praw = d.Pmax;
    d.Pflow = c.fuelFlow > 0 ? c.fuelFlow / 3600 * c.lhv * 1e6 * c.bte : Infinity;
    d.flowLimited = d.Praw > d.Pflow;
    d.Pmax = Math.min(d.Pmax, d.Pflow);
    d.Pers = c.hybridKW * 1000; d.Eers = c.hybridMJ * 1e6;
    // Vitesse de pointe permise par la puissance (plat, sans vent) : puissance maxi = traînée + roulement
    {
      const mTot = c.mass + c.fuel * c.fuelDensity, Pw = d.Pmax * c.driveEff + d.Pers * 0.95;
      let lo = 10, hi = 200;
      for (let it = 0; it < 50; it++) {
        const v = (lo + hi) / 2;
        const need = (0.5 * d.rho * d.CdA * v * v + 0.012 * (mTot * G + 0.5 * d.rho * d.ClA * v * v)) * v;
        if (need < Pw) lo = v; else hi = v;
      }
      d.vPower = lo;
    }
    // Rapports : pont calé sur la V. max au rupteur en dernier rapport, étagement géométrique (écart 1re/dernière ≈ 3,1).
    // Étagement automatique : le rupteur en dernier rapport est placé 3 % au-dessus de la vitesse de pointe
    // permise par la puissance (le moteur est alors proche de son régime de puissance maxi en bout de ligne droite).
    d.vTop = c.autoGear === false ? c.vTop : Math.min(450, Math.max(120, d.vPower * 3.6 * 1.03));
    const r = c.tireRadius;
    const wTop = c.rpmMax * 2 * Math.PI / 60;
    const nG = Math.max(1, Math.round(c.gears));
    const gTop = wTop * r / (d.vTop / 3.6);
    const spread = 3.1;
    d.ratios = [];
    for (let k = 0; k < nG; k++) d.ratios.push(gTop * Math.pow(spread, 1 - (nG === 1 ? 1 : k / (nG - 1))));
    d.vMax = d.vTop / 3.6;
    // Table puissance/rapport vs vitesse (pas 0,25 m/s)
    d.dv = 0.25; const nv = Math.ceil(d.vMax / d.dv) + 2;
    d.Ptab = new Float64Array(nv); d.Gtab = new Uint8Array(nv); d.Rtab = new Float32Array(nv);
    const Pc = (rpm) => {
      const x = rpm / c.rpmPeak;
      if (x <= 1) return d.Pmax * Math.max(0.05, x + x * x - x * x * x);
      return d.Pmax * Math.max(0, 1 - 1.6 * (x - 1) * (x - 1));
    };
    d.Pc = Pc;
    for (let i = 0; i < nv; i++) {
      const v = i * d.dv; let best = 0, bg = 0, brpm = 0;
      for (let k = 0; k < nG; k++) {
        let rpm = v / r * d.ratios[k] * 60 / (2 * Math.PI);
        if (rpm > c.rpmMax * 1.0001) continue;
        const rpmEff = Math.max(rpm, k === 0 ? c.rpmPeak * 0.62 : rpm); // patinage d'embrayage au départ
        const P = Pc(rpmEff);
        if (P > best + 1) { best = P; bg = k; brpm = rpm; }
      }
      if (best === 0) { bg = nG - 1; brpm = c.rpmMax; }
      d.Ptab[i] = best; d.Gtab[i] = bg + 1; d.Rtab[i] = Math.max(brpm, c.rpmPeak * 0.3);
    }
    // Pneus
    d.comp = COMPOUNDS[c.compound];
    d.surf = SURF[e.surface];
    d.condMu = conditionMu(c.compound, e.surface, e.weather, e.weather === 'dry' ? 0 : e.intensity);
    // sous un tunnel, la piste reste sèche : rapport d'adhérence sec / conditions du jour
    d.tunnelDry = e.weather !== 'dry' ? conditionMu(c.compound, e.surface, 'dry', 0) / d.condMu : 1;
    d.trackGrip = e.surface === 'asphalt' ? (tr.def.grip || 1) : 1;
    d.vAq = 0;
    if (e.weather === 'rain' && e.surface === 'asphalt') {
      const p = (c.pressOptF + c.pressOptR) / 2;
      d.vAq = 4.63 * Math.sqrt(p) * d.comp.drain / Math.sqrt(0.15 + e.intensity);
    }
    d.wetness = e.weather === 'rain' ? 0.3 + 0.7 * e.intensity : e.weather === 'snow' ? 0.4 : 0;
    // Carrossage : gain latéral jusqu'à l'optimum, perte longitudinale
    const camL = (cam) => { const a = Math.abs(cam); return 1 + 0.012 * Math.min(a, c.camberOpt) - 0.025 * Math.max(0, a - c.camberOpt); };
    const camX = (cam) => 1 - 0.007 * Math.abs(cam);
    d.camY = [camL(c.camberF), camL(c.camberF), camL(c.camberR), camL(c.camberR)];
    d.camX = [camX(c.camberF), camX(c.camberF), camX(c.camberR), camX(c.camberR)];
    // Mécanique : suspension ferme sur piste bosselée = moins de grip mécanique
    const bump = tr.def.bump ?? 0.4;
    d.mech = 1 - 0.05 * bump * (c.stiffness / 100 - 0.35);
    d.diffTrac = 1 + 0.05 * (c.diffLock / 100);
    d.diffLat = 1 - 0.02 * (c.diffLock / 100);
    d.tcTrac = c.tc ? 1.0 : (e.weather === 'dry' ? 0.975 : 0.93);
    d.absBrk = c.abs ? 1.0 : (e.weather === 'dry' ? 0.985 : 0.95);
    d.night = e.night ? 0.997 : 1;
    // Vent : composante dans le repère de la piste (direction d'où vient le vent, degrés depuis le nord)
    const wd = (e.windDir || 0) * Math.PI / 180, ws = (e.windSpeed || 0) / 3.6;
    d.wx = -ws * Math.sin(wd); d.wz = ws * Math.cos(wd);  // vecteur vitesse de l'air (x est, z -nord)
    // Thermique pneus (valeurs calibrées : F1 ≈ 100 °C en régime établi, 1 à 2 tours de mise en température)
    d.tireSz = Math.sqrt(c.mass / 800);           // taille relative des pneus
    d.tireC = 11000 * d.tireSz;                   // J/K par pneu avant
    d.rearSize = c.family === 'open' ? 1.35 : 1.15; // pneus arrière plus larges (masse thermique, surface)
    d.brakeC = 5200 * (c.mass / 800) ** 0.8 * (c.brakeType === 'carbon' ? 1 : 1.6);
    d.m_eff = 1.04;
    d.crr = d.surf.crr;
  }

  // État initial (carburant, pneus, freins)
  initState() {
    const c = this.car, e = this.env;
    const T0 = c.tireInit > 0 ? Math.max(c.tireInit, e.airTemp) : e.airTemp;
    return {
      fuel: Math.min(c.fuel, c.tank),
      tires: [0, 1, 2, 3].map(() => ({ T: T0, wear: 0 })),
      tireSetT: e.airTemp,          // température de gonflage (pour la loi des gaz)
      brakes: [e.airTemp + 30, e.airTemp + 30],
      vEnd: null, lap: 0, dist: 0, time: 0,
    };
  }

  pressHot(state, k) {
    const c = this.car;
    const p0 = k < 2 ? c.pressF : c.pressR;
    return p0 * (state.tires[k].T + 273.15) / (state.tireSetT + 273.15);
  }

  // Adhérence de base par point et par pneu (température du tour précédent, usure et pression courantes)
  prepareGrip(state, lapFactor) {
    const N = this.tr.N, c = this.car, d = this.d, comp = d.comp;
    if (state.mgmt == null) state.mgmt = 1;
    const base = c.tireMu * d.condMu * d.trackGrip * d.mech * d.night * lapFactor * state.mgmt;
    const fW = [], fP = [];
    for (let k = 0; k < 4; k++) {
      const w = state.tires[k].wear;
      let f = 1 - 0.10 * w;
      if (w > comp.cliff) f -= 1.6 * (w - comp.cliff) ** 2 + 0.25 * (w - comp.cliff);
      fW.push(Math.max(0.35, f));
      const ph = this.pressHot(state, k), po = k < 2 ? c.pressOptF : c.pressOptR;
      fP.push(Math.max(0.8, 1 - 0.0028 * (ph - po) ** 2));
    }
    for (let i = 0; i < N; i++) {
      for (let k = 0; k < 4; k++) {
        const T = this.hasPrev ? this.prevT[i * 4 + k] : state.tires[k].T;
        const x = (T - comp.Topt) / comp.dT;
        const fT = Math.max(0.8, 1 - 0.045 * x * x) * (T < comp.Topt - 2.5 * comp.dT ? 0.95 : 1);
        this.muBase[i * 4 + k] = base * fT * fW[k] * fP[k] * (this.tr.tunnel && this.tr.tunnel[i] ? d.tunnelDry : 1);
      }
    }
  }

  // Aéro au point i pour la vitesse v : [appui avant, appui arrière, traînée, hauteur dyn.]
  aero(i, v, out) {
    const d = this.d, tr = this.tr;
    const wt = d.wx * tr.hx[i] + d.wz * tr.hz[i];           // vent arrière (+) le long du trajet
    const wc = -d.wx * tr.hz[i] + d.wz * tr.hx[i];
    const va = v - wt;
    const q = 0.5 * d.rho * (va * va + wc * wc);
    const yawLoss = 1 - 0.35 * (wc * wc) / (va * va + wc * wc + 1);
    let Lf = q * d.ClAf * yawLoss, Lr = q * d.ClAr * yawLoss;
    // talonnage : hauteur dynamique sous charge aéro
    const hDyn = d.hAvg - (Lf + Lr) / d.kHeave * 1000;
    let stall = 1;
    if (hDyn < this.car.rideMin) stall = 1 - 0.3 * Math.min(1, (this.car.rideMin - hDyn) / 12);
    Lf *= stall; Lr *= stall;
    out[0] = Lf; out[1] = Lr;
    out[2] = 0.5 * d.rho * d.CdA * va * Math.sqrt(va * va + wc * wc) * (stall < 1 ? 1.03 : 1);
    out[3] = hDyn;
    return out;
  }

  // Capacités des essieux au point i, vitesse v, accélération longitudinale ax.
  // Retourne dans cap : [FyF, FyR, FxF, FxR, Fz0..3, Fztot]
  // ayOv : accélération latérale imposée (mode conduite) ; sinon celle de la trajectoire (v²·κ)
  caps(i, v, ax, m, cap, A, ayOv) {
    const d = this.d, tr = this.tr, c = this.car;
    this.aero(i, v, A);
    const k = tr.kappa[i];
    const phi = tr.bank ? tr.bank[i] : 0;            // dévers (+ = incliné vers la gauche)
    const cosT = 1 / Math.sqrt(1 + tr.grade[i] * tr.grade[i]);
    const ayH = ayOv ?? v * v * k;                   // accélération latérale (plan horizontal, + = gauche)
    // piste relevée : la gravité fournit une part de l'effort latéral et la charge normale augmente
    const W = Math.max(0.25 * m * G, m * (G * cosT * Math.cos(phi) + v * v * tr.kv[i] + ayH * Math.sin(phi)));
    const dLon = m * ax * d.h / d.L;
    let Ff = W * d.wf + A[0] - dLon, Fr = W * (1 - d.wf) + A[1] + dLon;
    Ff = Math.max(50, Ff); Fr = Math.max(50, Fr);
    const ay = ayOv != null ? ayH : ayH * Math.cos(phi) - G * cosT * Math.sin(phi);   // effort latéral demandé aux pneus
    const dLat = m * Math.abs(ay) * d.h / d.tw;
    const dF = dLat * d.lltd, dR = dLat * (1 - d.lltd);
    // pneus : 0 AVG, 1 AVD, 2 ARG, 3 ARD ; virage à gauche (k>0) → extérieur à droite
    const left = ay > 0;
    const fz = cap.fz;
    fz[0] = Math.max(0, Ff / 2 + (left ? -dF : dF)); fz[1] = Math.max(0, Ff / 2 + (left ? dF : -dF));
    fz[2] = Math.max(0, Fr / 2 + (left ? -dR : dR)); fz[3] = Math.max(0, Fr / 2 + (left ? dR : -dR));
    const Fz0 = m * G / 4, n = c.loadSens;
    let aq = 1;
    if (d.vAq && !(tr.tunnel && tr.tunnel[i])) { const x = Math.min(1, Math.max(0, (v - 0.75 * d.vAq) / (0.45 * d.vAq))); aq = 1 - 0.7 * x * x * (3 - 2 * x); }
    let yF = 0, yR = 0, xF = 0, xR = 0;
    for (let t = 0; t < 4; t++) {
      if (fz[t] <= 0) { cap.mu[t] = 0; continue; }
      const mu = aq * this.muBase[i * 4 + t] * Math.pow(fz[t] / Fz0, -n);
      cap.mu[t] = mu;
      const F = mu * fz[t];
      if (t < 2) { yF += F * d.camY[t]; xF += F * d.camX[t]; } else { yR += F * d.camY[t]; xR += F * d.camX[t]; }
    }
    cap.FyF = yF * d.diffLat; cap.FyR = yR; cap.FxF = xF; cap.FxR = xR;
    cap.ay = ay; cap.Ff = Ff; cap.Fr = Fr;
    return cap;
  }

  resist(i, v, m, A) {
    const tr = this.tr;
    const sinT = tr.grade[i] / Math.sqrt(1 + tr.grade[i] * tr.grade[i]);
    return A[2] + this.d.crr * this.crrP * (m * G + A[0] + A[1]) + m * G * sinT;
  }

  // Marge latérale (≥ 0 : faisable) à vitesse constante
  latMargin(i, v, m, cap, A) {
    const d = this.d;
    this.caps(i, v, 0, m, cap, A);
    const Fy = m * Math.abs(cap.ay);
    const needF = Fy * d.wf, needR = Fy * (1 - d.wf);
    // l'essieu moteur doit aussi vaincre les résistances
    const res = Math.max(0, this.resist(i, v, m, A));
    const drive = this.car.drive;
    const xr = drive === 'FWD' ? 0 : drive === 'AWD' ? res * 0.5 : res;
    const xf = res - xr;
    const uR = needR / cap.FyR, uF = needF / cap.FyF;
    const exR = xr / cap.FxR, exF = xf / cap.FxF;
    return Math.min(1 - Math.hypot(uF, exF), 1 - Math.hypot(uR, exR));
  }

  computeVlim(m) {
    const N = this.tr.N, vl = this.vlim, vMax = this.d.vMax;
    const cap = this._cap || (this._cap = { fz: new Float64Array(4), mu: new Float64Array(4) });
    const A = this._A || (this._A = new Float64Array(4));
    for (let i = 0; i < N; i++) {
      if (this.latMargin(i, vMax, m, cap, A) >= 0) { vl[i] = vMax; continue; }
      // premier point infaisable en montant (évite la solution « haute » des voitures à fort appui)
      let lo = 1, hi = vMax;
      for (let v = 8; v < vMax; v += 8) { if (this.latMargin(i, v, m, cap, A) < 0) { hi = v; break; } lo = v; }
      for (let it = 0; it < 14; it++) {
        const mid = (lo + hi) / 2;
        if (this.latMargin(i, mid, m, cap, A) >= 0) lo = mid; else hi = mid;
      }
      vl[i] = lo;
    }
  }

  // Décélération maximale au point i à la vitesse v (m/s²)
  maxDecel(i, v, m, brakeCapF) {
    const d = this.d, c = this.car, cap = this._cap, A = this._A;
    let a = 1.5 * G;
    let Fb = 0;
    for (let it = 0; it < 3; it++) {
      this.caps(i, v, -a, m, cap, A);
      const Fy = m * Math.abs(cap.ay);
      const rf = Math.min(1, Fy * d.wf / cap.FyF), rr = Math.min(1, Fy * (1 - d.wf) / cap.FyR);
      const xF = cap.FxF * Math.sqrt(1 - rf * rf), xR = cap.FxR * Math.sqrt(1 - rr * rr);
      const beta = c.brakeBias / 100;
      Fb = Math.min(xF / beta, xR / (1 - beta)) * d.absBrk;
      Fb = Math.min(Fb, brakeCapF);
      a = (Fb + this.resist(i, v, m, A)) / (m * d.m_eff);
    }
    return Math.max(0.5, a);
  }

  brakeFade(T) {
    if (this.car.brakeType === 'carbon') {
      if (T < 250) return 0.72 + 0.28 * Math.max(0, T) / 250;
      if (T > 1100) return Math.max(0.5, 1 - (T - 1100) * 0.0012);
      return 1;
    }
    if (T < 80) return 0.92;
    if (T > 700) return Math.max(0.45, 1 - (T - 700) * 0.0015);
    return 1;
  }

  // Simule un tour complet. Modifie state. Retourne le résultat du tour.
  simulateLap(state, opts = {}) {
    const tr = this.tr, N = tr.N, d = this.d, c = this.car, e = this.env, comp = d.comp;
    const R = opts.random || Math.random;
    const lapFactor = (c.skill / 100) * (1 - Math.abs(R.gauss ? R.gauss() : 0) * c.consistency / 100);
    this.prepareGrip(state, lapFactor);
    // pression : résistance au roulement
    const pAvg = [0, 1, 2, 3].reduce((s, k) => s + this.pressHot(state, k), 0) / 4;
    const pOpt = (c.pressOptF + c.pressOptR) / 2;
    this.crrP = Math.pow(pOpt / pAvg, 0.4) * (1 + 0.15 * d.wetness);
    const fuelMass0 = state.fuel * c.fuelDensity;
    const m = d.m0 + fuelMass0;
    this.computeVlim(m);
    const vl = this.vlim, vb = this.vback;
    // capacité des freins (température du tour en cours ≈ moyenne précédente)
    const bcap = c.brakeCap * 1000 * Math.min(this.brakeFade(state.brakes[0]), this.brakeFade(state.brakes[1]));
    // passe arrière sur deux tours (bouclage)
    for (let i = 0; i < N; i++) vb[i] = vl[i];
    let vn = vl[0];
    for (let q = 2 * N - 1; q >= 0; q--) {
      const i = q % N;
      const ds = tr.rds[i];
      const a1 = this.maxDecel(i, vn, m, bcap);
      let v = Math.sqrt(vn * vn + 2 * ds * a1);
      const a2 = this.maxDecel(i, (v + vn) / 2, m, bcap);
      v = Math.sqrt(vn * vn + 2 * ds * a2);
      v = Math.min(v, vl[i]);
      if (q < N || v < vb[i]) vb[i] = Math.min(vb[i], v);
      vn = vb[i];
    }
    // vitesse de départ
    let v0;
    if (opts.standing) v0 = 0.5;
    else if (state.vEnd != null) v0 = state.vEnd;
    else {
      // tour de lancement virtuel pour obtenir la vitesse de passage sur la ligne
      const clone = JSON.parse(JSON.stringify(state));
      v0 = this.forwardIntegrate(clone, m, vb[0], opts).vEnd;
      // le tour de lancement chauffe pneus et freins (à ~85 % du rythme) ; ni usure ni carburant comptés
      state.tires.forEach((x, k) => { x.T = state.tires[k].T + 0.85 * (clone.tires[k].T - state.tires[k].T); });
      state.brakes = state.brakes.map((b, k) => b + 0.85 * (clone.brakes[k] - b));
      this.prepareGrip(state, lapFactor);
    }
    const res = this.forwardIntegrate(state, m, Math.min(v0, vb[0]), opts);
    return res;
  }

  // Force motrice disponible (roues) à la vitesse v, avec l'hybride si disponible
  drivePower(v, ersLeft) {
    const d = this.d;
    const idx = Math.min(d.Ptab.length - 1, Math.round(v / d.dv));
    const Pice = d.Ptab[idx] * this.car.driveEff;
    const Pers = ersLeft > 0 && v > 12 ? d.Pers * 0.95 : 0;
    return { Pice, Pers, gear: d.Gtab[idx], rpm: d.Rtab[idx] };
  }

  tractionCap(i, v, a, m) {
    const d = this.d, c = this.car, cap = this._cap, A = this._A;
    this.caps(i, v, a, m, cap, A);
    const Fy = m * Math.abs(cap.ay);
    const rf = Math.min(1, Fy * d.wf / cap.FyF), rr = Math.min(1, Fy * (1 - d.wf) / cap.FyR);
    const xF = cap.FxF * Math.sqrt(1 - rf * rf), xR = cap.FxR * Math.sqrt(1 - rr * rr);
    const k = d.diffTrac * d.tcTrac;
    if (c.drive === 'RWD') return xR * k;
    if (c.drive === 'FWD') return xF * k;
    return (xF + xR) * k * 0.98;
  }

  // Constantes thermiques d'un tour (pneus et freins)
  thermalCtx(m0) {
    const c = this.car, e = this.env, d = this.d, comp = d.comp, wet = d.wetness;
    return {
      Tair: e.airTemp, Ttrack: e.trackTemp,
      hTrack: 38 * (1 + 2.2 * wet),
      tyreHeat: comp.heat * (1 - 0.55 * wet) * (e.surface === 'ice' ? 0.4 : 1),
      abr: (this.tr.def.abr || 1) * d.surf.abr * comp.wear,
      Fz0: m0 * G / 4, beta: c.brakeBias / 100, ductF: 0.35 + 0.65 * c.brakeDuct / 100,
      u: [0, 0, 0, 0],
    };
  }

  // Un pas thermique : échauffement / refroidissement et usure des 4 pneus, températures des freins.
  // cap : charges et adhérences par pneu (caps) ; FxAx, FyAx : efforts par essieu ; Fbrake : effort de freinage total.
  thermalStep(state, x, cap, FxAx, FyAx, Fbrake, vm, dt) {
    const c = this.car, d = this.d, comp = d.comp, tires = state.tires, brakes = state.brakes;
    let maxU = 0;
    for (let k = 0; k < 4; k++) {
      const ax2 = k < 2 ? 0 : 1;
      // partage des efforts d'un essieu au prorata de l'adhérence disponible de chaque pneu
      const c0 = k < 2 ? 0 : 2;
      const capA = cap.mu[c0] * cap.fz[c0] + cap.mu[c0 + 1] * cap.fz[c0 + 1];
      const share = capA > 0 ? cap.mu[k] * cap.fz[k] / capA : 0.5;
      const Fx = FxAx[ax2] * share, Fyt = FyAx[ax2] * share;
      const F = Math.hypot(Fx, Fyt);
      const lim = Math.max(1, cap.mu[k] * cap.fz[k]);
      const u = Math.min(1.2, F / lim);
      x.u[k] = u; maxU = Math.max(maxU, u);
      // puissance de glissement : dérive latérale (≈ 0,075 à la limite) et taux de glissement longitudinal (≈ 0,045)
      const Pslide = u * u * (0.075 * Math.abs(Fyt) + 0.045 * Math.abs(Fx)) * vm;
      const po = k < 2 ? c.pressOptF : c.pressOptR;
      const ph = this.pressHot(state, k);
      const flex = 0.0045 * cap.fz[k] * vm * Math.pow(po / ph, 1.2);
      const camHeat = 1 + 0.02 * Math.abs(k < 2 ? c.camberF : c.camberR);
      const Qin = HEAT_K * (c.tireHeat || 1) * x.tyreHeat * camHeat * (Pslide + flex);
      const sz = (k < 2 ? 1 : d.rearSize) * d.tireSz;
      const hAir = (9 + 3.2 * Math.pow(vm, 0.8)) * sz;
      const tk = tires[k];
      tk.T += dt * (Qin - hAir * (tk.T - x.Tair) - x.hTrack * sz * (tk.T - x.Ttrack)) / (11000 * sz);
      // usure : énergie de glissement × abrasivité × surchauffe
      const over = tk.T - (comp.Topt + comp.dT);
      const fTw = 1 + (over > 0 ? (over / 14) ** 2 : 0) + (tk.T < comp.Topt - 1.5 * comp.dT ? 0.25 : 0);
      tk.wear += WEAR_K * x.abr * Pslide * dt * fTw / Math.pow(x.Fz0 / 2000, 0.3);
    }
    // freins : énergie dissipée par essieu, refroidissement convectif + rayonnement
    for (let b = 0; b < 2; b++) {
      const Pin = Fbrake * (b === 0 ? x.beta : 1 - x.beta) * vm * 0.92;
      const Tb = brakes[b];
      const hb = (10 + 4.0 * Math.pow(vm, 0.85)) * x.ductF * (c.brakeType === 'carbon' ? 1 : 1.3);
      const rad = 0.8 * SIGMA_SB * 0.12 * ((Tb + 273.15) ** 4 - (x.Tair + 273.15) ** 4);
      brakes[b] += dt * (Pin - hb * (Tb - x.Tair) - rad) / d.brakeC;
    }
    return maxU;
  }

  forwardIntegrate(state, m0, v, opts) {
    const tr = this.tr, N = tr.N, d = this.d, c = this.car, e = this.env, comp = d.comp, T = this.trace;
    const cap = this._cap, A = this._A;
    const lhv = c.lhv * 1e6;
    let t = 0, ers = d.Eers, fuel = state.fuel, m = m0;
    let shiftTimer = 0, lastGear = 0;
    const sectors = [0, 0, 0];
    const sb1 = Math.floor(N / 3), sb2 = Math.floor(2 * N / 3);
    let vmax = 0, vmin = 1e9, fuelUsed = 0, ersUsed = 0;
    const tires = state.tires, brakes = state.brakes;
    const Tair = e.airTemp;
    const tctx = this.thermalCtx(m0);
    const beta = tctx.beta;
    const noFuel = { flag: false };
    const uSum = [0, 0, 0, 0], uT = [0, 0, 0, 0], tAvg = [0, 0, 0, 0];
    const record = (i, thr, brk, gear, rpm, ax, ay, A0, pw, u = 0) => {
      T.t[i] = t; T.u[i] = u; T.v[i] = v; T.gear[i] = gear; T.rpm[i] = rpm; T.thr[i] = thr; T.brk[i] = brk; T.ax[i] = ax; T.ay[i] = ay;
      for (let k = 0; k < 4; k++) { T.tT[i * 4 + k] = tires[k].T; T.tW[i * 4 + k] = tires[k].wear; T.tP[i * 4 + k] = this.pressHot(state, k); }
      T.bT[i * 2] = brakes[0]; T.bT[i * 2 + 1] = brakes[1]; T.fuel[i] = fuel; T.ers[i] = ers;
      T.df[i] = A0[0] + A0[1]; T.drag[i] = A0[2]; T.ride[i] = A0[3]; T.pw[i] = pw;
    };
    for (let i = 0; i < N; i++) {
      const ds = tr.rds[i], j = (i + 1) % N;
      const pw = this.drivePower(v, ers);
      // changement de rapport : coupure de couple
      if (lastGear && pw.gear > lastGear) shiftTimer = c.shiftMs / 1000;
      lastGear = pw.gear;
      const cut = shiftTimer > 0 ? Math.max(0, 1 - shiftTimer / Math.max(0.001, ds / Math.max(v, 1))) : 1;
      const Fp = (pw.Pice + pw.Pers) * cut / Math.max(v, 3);
      const Ft = this.tractionCap(i, v, 0.4 * G, m);
      const res = this.resist(i, v, m, A);
      const aAcc = (Math.min(Fp, Ft) - res) / (m * d.m_eff);
      const vAcc = Math.sqrt(Math.max(0.01, v * v + 2 * aAcc * ds));
      let vn = Math.min(vAcc, this.vback[j], d.vMax);
      // pilote pied au plancher : accélération libre (y compris pendant la coupure d'un passage de rapport) ou rupteur
      const fullThrottle = vn >= vAcc - 1e-6 || vn >= d.vMax - 1e-6;
      const dt = 2 * ds / (v + vn);
      shiftTimer = Math.max(0, shiftTimer - dt);
      const ax = (vn * vn - v * v) / (2 * ds);
      const vm = (v + vn) / 2;
      const Flong = m * d.m_eff * ax + res;
      // forces
      let Fdrive = 0, Fbrake = 0, thr = 0, brk = 0, Pwheel = 0;
      if (Flong >= 0) {
        Fdrive = Flong; Pwheel = Flong * vm;
        // en motricité limitée, le pilote dose ; sinon pleine charge ; à l'approche d'un virage, charge partielle
        if (fullThrottle) thr = Ft < Fp ? Math.max(0.3, Ft / Math.max(1, Fp / Math.max(cut, 1e-3))) : 1;
        else thr = Math.min(1, Pwheel / Math.max(1, (pw.Pice + pw.Pers)));
      } else {
        Fbrake = -Flong; brk = Math.min(1, Fbrake / (c.brakeCap * 1000));
      }
      // énergie : hybride d'abord à pleine charge, puis moteur thermique
      let Pers = 0;
      if (Pwheel > pw.Pice && ers > 0) { Pers = Math.min(Pwheel - pw.Pice, d.Pers * 0.95); ers -= Pers / 0.95 * dt; ersUsed += Pers / 0.95 * dt; }
      const Pice = Math.max(0, Pwheel - Pers) / c.driveEff;
      const Pfuel = Pice > 0 ? Pice / c.bte : d.Pmax * 0.012;   // frein moteur / ralenti
      const dm = Pfuel * dt / lhv;
      const dL = dm / c.fuelDensity;
      fuel -= dL; fuelUsed += dL; m -= dm;
      if (fuel <= 0) { fuel = 0; noFuel.flag = true; }
      // charges et forces par pneu (au point milieu)
      this.caps(i, vm, ax, m, cap, A);
      const ay = cap.ay;
      const Fy = m * Math.abs(ay);
      const FyAx = [Fy * d.wf, Fy * (1 - d.wf)];
      const drvF = c.drive === 'FWD' ? 1 : c.drive === 'AWD' ? 0.4 : 0;
      const FxAx = [Fdrive * drvF + Fbrake * beta, Fdrive * (1 - drvF) + Fbrake * (1 - beta)];
      const maxU = this.thermalStep(state, tctx, cap, FxAx, FyAx, Fbrake, vm, dt);
      for (let k = 0; k < 4; k++) {
        this.prevT[i * 4 + k] = tires[k].T;
        tAvg[k] += tires[k].T * dt;
        if (Math.abs(ay) > 8) { uSum[k] += tctx.u[k] * dt; uT[k] += dt; }
      }
      record(i, thr, brk, pw.gear, v <= 0.6 ? c.rpmPeak * 0.4 : pw.rpm, ax, ay, A, Pwheel, maxU);
      t += dt;
      if (i === sb1 - 1) sectors[0] = t;
      if (i === sb2 - 1) sectors[1] = t - sectors[0];
      v = vn; vmax = Math.max(vmax, v); vmin = Math.min(vmin, v);
    }
    sectors[2] = t - sectors[0] - sectors[1];
    record(N, 0, 0, lastGear, this.trace.rpm[N - 1], 0, 0, A, 0);
    this.hasPrev = true;
    state.fuel = fuel; state.vEnd = v;
    // gestion des pneus par le pilote : si un pneu dépasse durablement sa fenêtre, il lève le pied
    const Tlim = comp.Topt + comp.dT;
    let hot = 0;
    for (let k = 0; k < 4; k++) hot = Math.max(hot, tAvg[k] / t - Tlim);
    if (hot > 0) state.mgmt = Math.max(0.96, state.mgmt - Math.min(0.012, 0.001 * hot));
    else state.mgmt = Math.min(1, state.mgmt + 0.005);
    return {
      time: t, vEnd: v, mgmt: state.mgmt, util: uSum.map((x, k) => x / Math.max(1e-6, uT[k])), sectors, vmax, vmin, fuelUsed, ersUsed, noFuel: noFuel.flag,
      fuel, tires: tires.map((x, k) => ({ T: x.T, wear: x.wear, p: this.pressHot(state, k) })), brakes: brakes.slice(),
    };
  }
}
