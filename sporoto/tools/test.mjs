import { TRACKS } from '../js/data/tracks.js';
import { CARS } from '../js/data/cars.js';
import { buildTrack } from '../js/trackgeo.js';
import { Simulator, rng } from '../js/physics.js';
const fmt = t => `${Math.floor(t/60)}:${(t%60).toFixed(3).padStart(6,'0')}`;
const parse = s => { const [m, r] = s.split(':'); return +m*60 + +r; };
const env = { weather: 'dry', intensity: 0, night: false, windSpeed: 0, windDir: 0, airTemp: 22, trackTemp: 32, surface: 'asphalt' };
const cars = (process.argv[2] || 'F1').split(',');
const only = process.argv[3] ? process.argv[3].split(',') : null;
const laps = +(process.argv[4] || 3);
for (const ck of cars) {
  const errs = [];
  for (const def of TRACKS) {
    if (only && !only.includes(def.id)) continue;
    const car = { ...CARS[ck], consistency: 0, ...(process.env.OV ? JSON.parse(process.env.OV) : {}) };
    const tr = buildTrack(def, { ds: 5, carWidth: car.width });
    const sim = new Simulator(tr, car, env);
    const st = sim.initState(); const R = rng(1);
    const t0 = performance.now(); const res = [];
    for (let l = 0; l < laps; l++) res.push(sim.simulateLap(st, { random: R }));
    const ms = (performance.now() - t0) / laps;
    const best = Math.min(...res.map(r => r.time));
    const ref = def.ref[ck]; const err = ref ? (best / parse(ref) - 1) * 100 : null;
    if (err != null) errs.push(err);
    const L = res.at(-1);
    console.log(ck.padEnd(8), def.id.padEnd(12), fmt(best), ref ? ref.padEnd(9) : '   -     ', err != null ? (err >= 0 ? '+' : '') + err.toFixed(1) + '%' : '', ` vmax ${(L.vmax*3.6).toFixed(0)} vmin ${(L.vmin*3.6).toFixed(0)} fuel ${L.fuelUsed.toFixed(2)}L T ${L.tires.map(x=>x.T.toFixed(0)).join('/')} W ${L.tires.map(x=>(x.wear*100).toFixed(1)).join('/')} B ${L.brakes.map(x=>x.toFixed(0)).join('/')} len ${tr.length.toFixed(0)} ${ms.toFixed(0)}ms`);
  }
  if (errs.length) console.log(ck, 'mean err', (errs.reduce((a, b) => a + b) / errs.length).toFixed(2), '% sd', Math.sqrt(errs.reduce((a, b) => a + b * b, 0) / errs.length).toFixed(2));
}
