import { TRACKS } from '../js/data/tracks.js';
import { CARS } from '../js/data/cars.js';
import { buildTrack } from '../js/trackgeo.js';
import { Simulator, rng } from '../js/physics.js';
const [ck='F1', tid='silverstone', laps='15'] = process.argv.slice(2);
const env = { weather: 'dry', intensity: 0, night: false, windSpeed: 0, windDir: 0, airTemp: 22, trackTemp: 32, surface: 'asphalt', ...(process.env.ENV ? JSON.parse(process.env.ENV) : {}) };
const car = { ...CARS[ck], consistency: 0, ...(process.env.OV ? JSON.parse(process.env.OV) : {}) };
const def = TRACKS.find(t => t.id === tid);
const tr = buildTrack(def, { ds: 5, carWidth: car.width });
const sim = new Simulator(tr, car, env); const st = sim.initState(); const R = rng(1);
for (let l = 1; l <= +laps; l++) {
  const r = sim.simulateLap(st, { random: R });
  if (l <= 3 || l % Math.max(1, Math.floor(laps / 12)) === 0) console.log(String(l).padStart(3), r.time.toFixed(3), 'T', r.tires.map(x => x.T.toFixed(0)).join('/'), 'W%', r.tires.map(x => (x.wear * 100).toFixed(0)).join('/'), 'P', r.tires.map(x => x.p.toFixed(1)).join('/'), 'B', r.brakes.map(x => x.toFixed(0)).join('/'), 'fuel', r.fuel.toFixed(1), 'used', r.fuelUsed.toFixed(2), 'm', r.mgmt.toFixed(3), 'u', r.util.map(x=>x.toFixed(2)).join('/'));
}
const T = sim.trace; let mx=[0,0]; for (let i=0;i<tr.N;i++){mx[0]=Math.max(mx[0],T.bT[i*2]);mx[1]=Math.max(mx[1],T.bT[i*2+1]);}
console.log('brake peak', mx.map(x=>x.toFixed(0)).join('/'), 'tyre T range lap', Math.min(...T.tT).toFixed(0), Math.max(...T.tT).toFixed(0));
