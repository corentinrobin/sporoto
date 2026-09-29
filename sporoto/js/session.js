// Sporoto — gestion d'une session : enchaînement des tours, stratégie de stand, abandons, compte rendu JSON.
import { TRACKS } from './data/tracks.js';
import { buildTrack } from './trackgeo.js';
import { Simulator, rng } from './physics.js';

const trackCache = new Map();
export function getTrack(id, carWidth) {
  const key = id + '|' + carWidth.toFixed(2);
  if (!trackCache.has(key)) trackCache.set(key, buildTrack(TRACKS.find(t => t.id === id), { ds: 5, carWidth }));
  return trackCache.get(key);
}

export class Session {
  // cfg = { trackId, carType, car, env, session: { laps, standing, seed, autoPit, pitWear } }
  constructor(cfg) {
    this.cfg = JSON.parse(JSON.stringify(cfg));
    this.def = TRACKS.find(t => t.id === cfg.trackId);
    this.track = getTrack(cfg.trackId, cfg.car.width);
    this.sim = new Simulator(this.track, this.cfg.car, this.cfg.env);
    this.state = this.sim.initState();
    this.rand = rng(cfg.session.seed || 1);
    this.laps = [];
    this.totalTime = 0;
    this.dnf = null;
    this.pendingPit = null;
  }

  get done() { return !!this.dnf || this.laps.length >= this.cfg.session.laps; }

  // Simule le tour suivant ; sim.trace contient ensuite la télémétrie de ce tour.
  nextLap() {
    if (this.done) return null;
    const s = this.cfg.session, car = this.cfg.car, st = this.state;
    const n = this.laps.length + 1;
    const fuelStart = st.fuel;
    const wearStart = st.tires.map(x => x.wear);
    const r = this.sim.simulateLap(st, { random: this.rand, standing: n === 1 && s.standing });
    const rec = {
      lap: n, time: r.time, sectors: r.sectors, vmax: r.vmax * 3.6, vmin: r.vmin * 3.6,
      fuelStart, fuelEnd: r.fuel, fuelUsed: r.fuelUsed, ersUsedMJ: r.ersUsed / 1e6,
      tires: r.tires.map(x => ({ T: +x.T.toFixed(1), wear: +(x.wear * 100).toFixed(2), p: +x.p.toFixed(2) })),
      brakes: r.brakes.map(x => +x.toFixed(0)), mgmt: r.mgmt, util: r.util, pit: null,
    };
    rec.wearDelta = r.tires.map((x, k) => (x.wear - wearStart[k]) * 100);
    if (r.noFuel) this.dnf = 'fuel';
    else if (Math.max(...st.tires.map(x => x.wear)) >= 1) this.dnf = 'tires';
    // Stratégie : arrêt si le carburant ne suffit pas pour un tour de plus, ou si l'usure dépasse le seuil
    const remaining = s.laps - n;
    if (!this.dnf && s.autoPit && remaining > 0) {
      const perLap = r.fuelUsed * 1.03;
      const needFuel = st.fuel < perLap * 1.02;
      const maxWear = Math.max(...st.tires.map(x => x.wear)) * 100;
      const needTires = maxWear >= s.pitWear;
      if (needFuel || needTires) {
        const want = Math.min(car.tank, perLap * remaining + perLap * 0.5);
        const add = needFuel || st.fuel < want ? Math.max(0, want - st.fuel) : 0;
        const tFuel = add / car.refuelRate;
        const tTires = needTires ? car.tireChange : 0;
        const stop = Math.max(tFuel, tTires) + 2.0;          // 2 s : arrêt + redémarrage
        const loss = (this.def.pit || 22) + stop;
        rec.pit = { duration: +stop.toFixed(2), loss: +loss.toFixed(2), fuelAdded: +add.toFixed(1), tires: needTires };
        rec.time += loss;
        st.fuel += add;
        if (needTires) {
          const T0 = car.tireInit > 0 ? Math.max(car.tireInit, this.cfg.env.airTemp) : this.cfg.env.airTemp;
          st.tires.forEach(x => { x.T = T0; x.wear = 0; });
          this.sim.hasPrev = false;
        }
        st.vEnd = Math.min(st.vEnd, 22);   // sortie des stands
      }
    }
    this.totalTime += rec.time;
    this.laps.push(rec);
    return rec;
  }

  stats() {
    const L = this.laps;
    if (!L.length) return { laps: 0 };
    const times = L.map(l => l.time);
    const clean = L.filter(l => !l.pit && !(l.lap === 1 && this.cfg.session.standing)).map(l => l.time);
    const best = Math.min(...times);
    return {
      laps: L.length,
      best, bestLap: L[times.indexOf(best)].lap,
      avg: times.reduce((a, b) => a + b, 0) / times.length,
      avgClean: clean.length ? clean.reduce((a, b) => a + b, 0) / clean.length : null,
      total: this.totalTime,
      pits: L.filter(l => l.pit).length,
      fuelUsed: L.reduce((a, l) => a + l.fuelUsed, 0),
      dnf: this.dnf,
    };
  }

  report() {
    return {
      app: 'Sporoto', version: 1, generated: new Date().toISOString(),
      config: this.cfg,
      track: { id: this.def.id, name: this.def.full, length: +this.track.length.toFixed(1), elevDelta: this.def.elevDelta, alt0: this.def.alt0 },
      physics: { airDensity: +this.sim.d.rho.toFixed(4), frontalArea: +this.sim.d.S.toFixed(3), CdA: +this.sim.d.CdA.toFixed(3), ClA: +this.sim.d.ClA.toFixed(3), powerKW: +(this.sim.d.Pmax / 1000).toFixed(1) },
      summary: this.stats(),
      laps: this.laps.map(l => ({ ...l, time: +l.time.toFixed(3), sectors: l.sectors.map(x => +x.toFixed(3)), vmax: +l.vmax.toFixed(1), vmin: +l.vmin.toFixed(1), fuelStart: +l.fuelStart.toFixed(2), fuelEnd: +l.fuelEnd.toFixed(2), fuelUsed: +l.fuelUsed.toFixed(3), ersUsedMJ: +l.ersUsedMJ.toFixed(3), mgmt: +l.mgmt.toFixed(4), util: l.util.map(x => +x.toFixed(3)), wearDelta: l.wearDelta.map(x => +x.toFixed(3)) })),
    };
  }
}

export function fmtTime(t, dec = 3) {
  if (t == null || !isFinite(t)) return '–:––.–––';
  const m = Math.floor(t / 60), s = t - m * 60;
  const h = Math.floor(m / 60);
  const ss = s.toFixed(dec).padStart(dec ? 3 + dec : 2, '0');
  return h ? `${h}:${String(m % 60).padStart(2, '0')}:${ss}` : `${m}:${ss}`;
}
