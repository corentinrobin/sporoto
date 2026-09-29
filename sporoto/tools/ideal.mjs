import { TRACKS } from '../js/data/tracks.js';
import { CARS } from '../js/data/cars.js';
import { buildTrack } from '../js/trackgeo.js';
import { Simulator } from '../js/physics.js';
const parse = s => { const [m, r] = s.split(':'); return +m*60 + +r; };
const ck = process.argv[2] || 'F1'; const muMul = +(process.argv[4] || 0.985);
const env = { weather: 'dry', intensity: 0, night: false, windSpeed: 0, windDir: 0, airTemp: 22, trackTemp: 32, surface: 'asphalt' };
const errs = []; let line = '';
for (const def of TRACKS) {
  const car = { ...CARS[ck], consistency: 0, ...(process.env.OV ? JSON.parse(process.env.OV) : {}) };
  const tr = buildTrack(def, { ds: 5, carWidth: car.width });
  const sim = new Simulator(tr, car, env);
  sim.prepareGrip = function () { this.muBase.fill(car.tireMu * muMul * (def.grip||1)); };
  const r = sim.simulateLap(sim.initState(), {});
  const ref = def.ref[ck]; const err = ref ? (r.time / parse(ref) - 1) * 100 : null;
  if (err != null) errs.push(err);
  line += `${def.id}:${r.time.toFixed(1)}${err!=null?'('+(err>=0?'+':'')+err.toFixed(1)+')':''} `;
}
console.log(line); console.log('mean', (errs.reduce((a,b)=>a+b)/errs.length).toFixed(2), 'sd', Math.sqrt(errs.reduce((a,b)=>a+b*b,0)/errs.length).toFixed(2));
