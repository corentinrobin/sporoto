// Diagnostic : points en ligne droite (R > 800 m) sans pleine charge ni freinage, classés par cause.
import { TRACKS } from '../js/data/tracks.js';
import { CARS } from '../js/data/cars.js';
import { buildTrack } from '../js/trackgeo.js';
import { Simulator, rng, G } from '../js/physics.js';
const [ck = 'F1', ids = 'spa,monza,lemans,silverstone'] = process.argv.slice(2);
const env = { weather: 'dry', intensity: 0, night: false, windSpeed: 0, windDir: 0, airTemp: 22, trackTemp: 32, surface: 'asphalt' };
for (const id of ids.split(',')) {
  const car = { ...CARS[ck], consistency: 0 };
  const tr = buildTrack(TRACKS.find(t => t.id === id), { ds: 5, carWidth: car.width });
  const sim = new Simulator(tr, car, env); const st = sim.initState(); const R = rng(1);
  sim.simulateLap(st, { random: R }); sim.simulateLap(st, { random: R });
  const T = sim.trace, N = tr.N, d = sim.d;
  const cause = {}; let straight = 0, dist = {};
  for (let i = 0; i < N; i++) {
    if (Math.abs(tr.kappa[i]) > 1 / 800) continue;
    straight++;
    if (T.thr[i] >= 0.98 || T.brk[i] > 0.01) continue;
    const v = T.v[i];
    let c;
    if (v >= d.vMax - 0.3) c = 'limiteur';
    else if (sim.vback[(i + 1) % N] <= T.v[i + 1] + 0.05 && sim.vlim[(i + 1) % N] < d.vMax - 0.5) c = 'vitesse limite latérale (courbure)';
    else if (sim.vback[(i + 1) % N] <= T.v[i + 1] + 0.05) c = 'anticipation freinage';
    else {
      const pw = sim.drivePower(v, 1e9), m = d.m0 + st.fuel * car.fuelDensity;
      const Fp = (pw.Pice + pw.Pers) / Math.max(v, 3), Ft = sim.tractionCap(i, v, 0.4 * G, m);
      c = Ft < Fp ? 'motricité' : 'passage de rapport / autre';
    }
    cause[c] = (cause[c] || 0) + 1;
    (dist[c] ||= []).push(Math.round(tr.rs[i]));
  }
  console.log(`${ck} ${id}: ${straight} pts en ligne droite`);
  for (const [c, n] of Object.entries(cause)) console.log(`   ${c.padEnd(36)} ${n} pts (${(n * tr.step).toFixed(0)} m)  ex. s=${dist[c].filter((_, k) => k % Math.ceil(dist[c].length / 6) === 0).join(',')}`);
}
