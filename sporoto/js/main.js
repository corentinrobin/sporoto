// Sporoto — point d'entrée : garage (configuration), lancement des simulations, import/export.
import { TRACKS } from './data/tracks.js';
import { CARS, CAR_ORDER, PARAMS, PARAM_GROUPS, COMPOUNDS } from './data/cars.js';
import { t, setLang, getLang, applyI18n } from './i18n.js';
import { drawTrackMap, drawElevation, carProfileSVG } from './draw.js';
import { Session, getTrack, fmtTime } from './session.js';
import { Simulator } from './physics.js';
import { LiveRun } from './hud.js';
import { DriveRun } from './drive.js';
import { runBatch, showReport } from './results.js';

const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const STEPS = ['track', 'car', 'setup', 'cond', 'session'];
const CAR_NUMBERS = { F1: 1, F2: 5, F3: 12, HYPERCAR: 7, LMP2: 22, LMP3: 17, GT3: 92, LIBRE: 99 };
const CAT_COLORS = { F1: '#e8202a', F2: '#1e6fff', F3: '#e9eef5', HYPERCAR: '#ff3b2f', LMP2: '#1ec8ff', LMP3: '#ffb627', GT3: '#2ee88c', LIBRE: '#b37bff' };

const DEFAULT = {
  step: 'track', trackId: 'spa', carType: 'F1', car: { ...CARS.F1 },
  env: { weather: 'dry', intensity: 0.5, night: false, windSpeed: 10, windDir: 250, airTemp: 22, trackTemp: 32, surface: 'asphalt' },
  session: { laps: 10, standing: true, seed: 42, autoPit: true, pitWear: 75 },
  cfgVersion: 2,
};
export const app = JSON.parse(JSON.stringify(DEFAULT));
try {
  const saved = JSON.parse(localStorage.getItem('sporoto.cfg') || 'null');
  if (saved && CARS[saved.carType] && TRACKS.find(x => x.id === saved.trackId)) {
    Object.assign(app, saved);
    app.car = { ...CARS[saved.carType], ...saved.car };
    app.env = { ...DEFAULT.env, ...saved.env }; app.session = { ...DEFAULT.session, ...saved.session };
    // v2 : le départ arrêté devient le réglage par défaut (l'ancien défaut « lancé » surprenait)
    if ((saved.cfgVersion || 1) < 2) { app.session.standing = true; app.cfgVersion = 2; }
  }
} catch (e) { /* configuration locale indisponible */ }
function save() { try { localStorage.setItem('sporoto.cfg', JSON.stringify(app)); } catch (e) { /* ignore */ } }

export function toast(msg) {
  const el = $('#toast'); el.textContent = msg; el.classList.add('show');
  clearTimeout(toast._t); toast._t = setTimeout(() => el.classList.remove('show'), 2600);
}
export function loader(on, text = '') { $('#loader').classList.toggle('show', on); $('#loaderText').textContent = text; }
export function showScreen(id) {
  $$('.screen').forEach(s => s.classList.toggle('active', s.id === id));
  document.body.classList.toggle('in-sim', id === 'sim');
  $('#steps').style.visibility = id === 'garage' ? '' : 'hidden';
}
const nextFrame = () => new Promise(r => requestAnimationFrame(() => setTimeout(r, 0)));
const fmt = (v, d = 0) => Number(v).toLocaleString(getLang() === 'es' ? 'es-ES' : 'fr-FR', { minimumFractionDigits: d, maximumFractionDigits: d });
const trackName = def => def.name;

// ---------------------------------------------------------------- étapes
function renderSteps() {
  $('#steps').innerHTML = STEPS.map((s, k) => `<button data-step="${s}" class="${app.step === s ? 'active' : ''} ${STEPS.indexOf(app.step) > k ? 'done' : ''}"><span class="n">0${k + 1}</span>${t('step_' + s)}</button>`).join('');
  $$('#steps button').forEach(b => b.onclick = () => goStep(b.dataset.step));
  $$('.step-panel').forEach(p => p.classList.toggle('active', p.dataset.step === app.step));
  const k = STEPS.indexOf(app.step);
  $('#btnPrev').style.visibility = k ? '' : 'hidden';
  $('#btnNext').style.visibility = k < STEPS.length - 1 ? '' : 'hidden';
}
function goStep(s) {
  app.step = s; save(); renderSteps();
  if (s === 'track') renderTrackStep();
  if (s === 'car') renderCarStep();
  if (s === 'setup') renderSetupStep();
  if (s === 'cond') renderCondStep();
  if (s === 'session') renderSessionStep();
}
$('#btnPrev').onclick = () => goStep(STEPS[Math.max(0, STEPS.indexOf(app.step) - 1)]);
$('#btnNext').onclick = () => goStep(STEPS[Math.min(STEPS.length - 1, STEPS.indexOf(app.step) + 1)]);

// ---------------------------------------------------------------- circuits
function countTurns(tr) {
  let n = 0, inTurn = false, acc = 0, sign = 0;
  for (let i = 0; i < tr.N; i++) {
    const k = tr.kappa[i];
    if (Math.abs(k) > 1 / 180) {
      const sg = Math.sign(k);
      if (!inTurn || sg !== sign) { if (inTurn && Math.abs(acc) > 0.35) n++; inTurn = true; acc = 0; sign = sg; }
      acc += k * tr.rds[i];
    } else if (inTurn) { if (Math.abs(acc) > 0.35) n++; inTurn = false; }
  }
  return n;
}
function renderTrackStep() {
  const grid = $('#trackGrid');
  if (!grid.dataset.built) {
    grid.innerHTML = TRACKS.map(d => `<button class="tcard" data-id="${d.id}"><span class="flag">${d.flag}</span><canvas></canvas><div class="tn">${d.name}</div><div class="tm"><span>${fmt(d.length / 1000, 3)} km</span><span>Δ ${fmt(d.elevDelta, 0)} m</span></div></button>`).join('');
    grid.dataset.built = 1;
    $$('.tcard', grid).forEach(c => {
      c.onclick = () => { app.trackId = c.dataset.id; save(); renderTrackStep(); renderSummary(); };
      requestAnimationFrame(() => drawTrackMap($('canvas', c), TRACKS.find(x => x.id === c.dataset.id).points, { lw: 2.2, arrow: false }));
    });
  }
  $$('.tcard', grid).forEach(c => c.classList.toggle('sel', c.dataset.id === app.trackId));
  const def = TRACKS.find(x => x.id === app.trackId);
  const tr = getTrack(def.id, app.car.width);
  const ref = def.ref || {};
  $('#trackDetail').innerHTML = `
    <div><div class="td-title">${def.flag} ${def.full}</div><div class="td-sub">${t('cc_' + def.cc)} · ${t('track_data')}</div></div>
    <canvas class="td-map" id="tdMap"></canvas>
    <div class="stats">
      <div class="stat"><div class="k">${t('track_length')}</div><div class="v">${fmt(def.length / 1000, 3)}<small>km</small></div></div>
      <div class="stat"><div class="k">${t('track_delta')}</div><div class="v">${fmt(def.elevDelta, 1)}<small>m</small></div></div>
      <div class="stat"><div class="k">${t('track_alt')}</div><div class="v">${fmt(def.alt0, 0)}<small>m</small></div></div>
      <div class="stat"><div class="k">${t('track_width')}</div><div class="v">${def.width}<small>m</small></div></div>
      <div class="stat"><div class="k">${t('track_turns')}</div><div class="v">${countTurns(tr)}</div></div>
      <div class="stat"><div class="k">${t('pit_loss')}</div><div class="v">${def.pit}<small>s</small></div></div>
    </div>
    <div><h2 class="sec">${t('elevation_profile')}</h2><canvas class="td-elev" id="tdElev"></canvas></div>
    ${Object.keys(ref).length ? `<div class="sum-tags">${Object.entries(ref).map(([k, v]) => `<span class="tag">${t('track_ref')} ${t('cat_' + k)} · ${v}</span>`).join('')}</div>` : ''}`;
  requestAnimationFrame(() => {
    drawTrackMap($('#tdMap'), def.points, { lw: 4, pad: 18 });
    drawElevation($('#tdElev'), tr, { axis: true });
  });
}

// ---------------------------------------------------------------- voitures
// Vitesse de pointe au niveau de la mer, 20 °C, sans vent (puissance maxi = traînée + roulement)
function vPowerApprox(c) {
  const rho = 1.204, S = c.width * c.height * c.areaFactor, P = c.power * 735.5 * c.driveEff + c.hybridKW * 950;
  let lo = 10, hi = 200;
  for (let k = 0; k < 50; k++) { const v = (lo + hi) / 2; ((0.5 * rho * c.cx * S * v * v + 0.012 * (c.mass * 9.81 + 0.5 * rho * c.cz * S * v * v)) * v < P) ? lo = v : hi = v; }
  return Math.min(lo * 3.6, c.autoGear === false ? c.vTop : 1e9);
}
function renderCarStep() {
  $('#carGrid').innerHTML = CAR_ORDER.map(k => {
    const c = CARS[k];
    const S = c.width * c.height * c.areaFactor;
    const pw = (c.mass / c.power);
    return `<button class="ccard ${app.carType === k ? 'sel' : ''}" data-k="${k}">
      <div class="stripe" style="background:${CAT_COLORS[k]}"></div>
      <div class="cat">${t('cat_' + k)}</div><div class="model">${c.model}</div>
      ${carProfileSVG(k, CAT_COLORS[k], { number: CAR_NUMBERS[k] })}
      <div class="specs">
        <div><span>${t('power')}</span><b>${c.power + Math.round(c.hybridKW * 1.36)} ch</b></div>
        <div><span>${t('mass')}</span><b>${c.mass} kg</b></div>
        <div><span>S·Cx</span><b>${fmt(S * c.cx, 2)}</b></div>
        <div><span>S·Cz</span><b>${fmt(S * c.cz, 2)}</b></div>
        <div><span>kg/ch</span><b>${fmt(pw, 2)}</b></div>
        <div><span>${t('top_speed')}</span><b>${Math.round(vPowerApprox(c))} km/h</b></div>
      </div></button>`;
  }).join('');
  $$('.ccard').forEach(b => b.onclick = () => {
    if (app.carType !== b.dataset.k) { app.carType = b.dataset.k; app.car = { ...CARS[app.carType] }; save(); }
    renderCarStep(); renderSummary();
  });
}

// ---------------------------------------------------------------- réglages
function paramLabel(p) {
  if (p.t === 'select') return (v) => p.key === 'compound' ? t('c_' + v) : t('o_' + v);
  return null;
}
function renderSetupStep() {
  const preset = CARS[app.carType];
  $('#setupGroups').innerHTML = PARAM_GROUPS.map(g => `<div class="card pgroup"><h2 class="sec">${t('g_' + g)}</h2>${PARAMS.filter(p => p.g === g).map(p => {
    const v = app.car[p.key];
    const changed = v !== preset[p.key] ? 'changed' : '';
    if (p.t === 'bool') return `<div class="prow ${changed}" data-k="${p.key}"><label>${t('p_' + p.key)}</label><div class="ctl"><div class="toggle"><button data-v="1" class="${v ? 'on' : ''}">${t('yes')}</button><button data-v="0" class="${!v ? 'on' : ''}">${t('no')}</button></div></div></div>`;
    if (p.t === 'select') return `<div class="prow ${changed}" data-k="${p.key}"><label>${t('p_' + p.key)}</label><div class="ctl"><select>${p.o.map(o => `<option value="${o}" ${o === v ? 'selected' : ''}>${paramLabel(p)(o)}</option>`).join('')}</select></div></div>`;
    const [mn, mx, st] = p.r;
    return `<div class="prow ${changed}" data-k="${p.key}"><label for="p_${p.key}">${t('p_' + p.key)}</label><div class="ctl"><input type="number" id="p_${p.key}" min="${mn}" max="${mx}" step="${st}" value="${v}"><span class="u">${p.u}</span></div><input type="range" min="${mn}" max="${mx}" step="${st}" value="${v}"></div>`;
  }).join('')}</div>`).join('');
  $$('#setupGroups .prow').forEach(row => {
    const k = row.dataset.k, p = PARAMS.find(x => x.key === k);
    const setV = (v) => {
      if (p.r) { v = Math.max(p.r[0], Math.min(p.r[1], +v)); if (!isFinite(v)) return; }
      app.car[k] = v;
      if (k === 'fuel') app.car.fuel = Math.min(app.car.fuel, app.car.tank);
      row.classList.toggle('changed', app.car[k] !== preset[k]);
      save(); renderDerived(); renderSummary(); scheduleEstimate();
    };
    const num = $('input[type=number]', row), rng = $('input[type=range]', row);
    if (num) { num.onchange = () => { setV(num.value); num.value = app.car[k]; rng.value = app.car[k]; }; rng.oninput = () => { num.value = rng.value; setV(rng.value); }; }
    const sel = $('select', row); if (sel) sel.onchange = () => setV(sel.value);
    $$('.toggle button', row).forEach(b => b.onclick = () => { setV(b.dataset.v === '1'); $$('.toggle button', row).forEach(x => x.classList.toggle('on', x === b)); });
  });
  $('#btnReset').onclick = () => { app.car = { ...CARS[app.carType] }; save(); renderSetupStep(); renderSummary(); };
  renderDerived();
  scheduleEstimate(0);
}
function currentCfg() { return { trackId: app.trackId, carType: app.carType, car: { ...app.car }, env: { ...app.env }, session: { ...app.session } }; }
function renderDerived() {
  const tr = getTrack(app.trackId, app.car.width);
  const sim = new Simulator(tr, app.car, app.env);
  const d = sim.d, c = app.car;
  const df = v => 0.5 * d.rho * d.ClA * (v / 3.6) ** 2 / 9.81;
  const rows = [
    ['d_S', fmt(d.S, 2) + ' m²'], ['d_CdA', fmt(d.CdA, 3) + ' m²'], ['d_ClA', fmt(d.ClA, 3) + ' m²'], ['d_ld', fmt(d.ClA / d.CdA, 2)],
    ['aeroBalanceEff', fmt(100 * d.ClAf / d.ClA, 1) + ' %'],
    ['d_rho', fmt(d.rho, 3) + ' kg/m³'], ['d_power_eff', fmt(d.Pmax / 735.5, 0) + ' ch' + (d.Pers ? ' + ' + fmt(d.Pers / 735.5, 0) : '')],
    ['d_pw', fmt((c.mass + c.fuel * c.fuelDensity) / ((d.Pmax + d.Pers) / 735.5), 2) + ' kg/ch'],
    ['d_df200', fmt(df(200), 0) + ' kg'], ['d_df300', fmt(df(300), 0) + ' kg'],
    ['d_vpower', fmt(d.vPower * 3.6, 0) + ' km/h'], ['d_vgear', fmt(d.vTop, 0) + ' km/h'], ['d_vmax', fmt(Math.min(d.vPower * 3.6, d.vTop), 0) + ' km/h'],
  ];
  $('#derivedCard').innerHTML = `<h2 class="sec">${t('derived')}</h2>` + rows.map(([k, v]) => `<div class="drow"><span>${k === 'aeroBalanceEff' ? t('p_aeroBalance') : t(k)}</span><b>${v}</b></div>`).join('')
    + (d.vTop < d.vPower * 3.6 ? `<p class="note" style="color:var(--amber)">⚠ ${t('limiter_warn')}</p>` : '')
    + (d.flowLimited ? `<p class="note" style="color:var(--amber)">⚠ ${t('flow_warn').replace('{p}', fmt(d.Praw / 735.5, 0)).replace('{f}', c.fuelFlow).replace('{c}', fmt(d.Pflow / 735.5, 0))}</p><button class="btn ghost small" id="btnFlow">${t('flow_lift')}</button>` : '');
  const bf = $('#btnFlow');
  if (bf) bf.onclick = () => { app.car.fuelFlow = 0; save(); renderSetupStep(); renderSummary(); };
  // V. max au rupteur : calculée en étagement automatique
  const vt = $('.prow[data-k=vTop]');
  if (vt) {
    const auto = c.autoGear !== false;
    vt.querySelectorAll('input').forEach(inp => { inp.disabled = auto; if (auto) inp.value = Math.round(d.vTop); });
    vt.style.opacity = auto ? 0.55 : 1;
  }
}
// Estimation du tour recalculée automatiquement à chaque modification (anti-rebond pendant le glissement des curseurs)
let estTimer = null, estPrev = null, estKey = null;
function scheduleEstimate(delay = 180) {
  clearTimeout(estTimer);
  const out = $('#estOut'); if (!out) return;
  out.classList.add('busy');
  estTimer = setTimeout(estimate, delay);
}
function estimate() {
  const out = $('#estOut');
  if (!out || app.step !== 'setup') return;
  const cfg = currentCfg(); cfg.session = { ...cfg.session, laps: 3, autoPit: false, standing: false };
  cfg.car.consistency = 0;
  const key = JSON.stringify([cfg.trackId, cfg.carType, cfg.env]);
  if (key !== estKey) { estPrev = null; estKey = key; }   // autre circuit / conditions : pas de comparaison
  const s = new Session(cfg);
  while (!s.done) s.nextLap();
  const best = s.stats().best;
  const ref = TRACKS.find(x => x.id === app.trackId).ref?.[app.carType];
  let delta = '';
  if (estPrev != null && Math.abs(best - estPrev) >= 0.0005) {
    const d = best - estPrev;
    delta = `<span class="est-delta ${d < 0 ? 'faster' : 'slower'}">${d < 0 ? '−' : '+'}${Math.abs(d).toFixed(3)} s</span>`;
  }
  estPrev = best;
  out.classList.remove('busy');
  out.innerHTML = `${fmtTime(best)}${delta}<small>${cfg.car.fuel} L · ${t('c_' + cfg.car.compound)}${ref ? ` · ${t('track_ref')} ${ref}` : ''}</small>`;
}

// ---------------------------------------------------------------- conditions
const ICONS = {
  dry: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="4.5"/><path d="M12 2v2.5M12 19.5V22M2 12h2.5M19.5 12H22M4.9 4.9l1.8 1.8M17.3 17.3l1.8 1.8M4.9 19.1l1.8-1.8M17.3 6.7l1.8-1.8"/></svg>',
  rain: '<svg viewBox="0 0 24 24"><path d="M7 15a4.5 4.5 0 1 1 1.2-8.8A5.5 5.5 0 0 1 18.5 8 3.5 3.5 0 0 1 18 15H7z"/><path d="M8 18l-1 3M12 18l-1 3M16 18l-1 3"/></svg>',
  snow: '<svg viewBox="0 0 24 24"><path d="M12 2v20M4 7l16 10M20 7L4 17"/><path d="M9 3.5l3 2 3-2M9 20.5l3-2 3 2"/></svg>',
  day: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="5"/><path d="M12 1.5v3M12 19.5v3M1.5 12h3M19.5 12h3"/></svg>',
  night: '<svg viewBox="0 0 24 24"><path d="M20 14.5A8 8 0 1 1 9.5 4a6.5 6.5 0 0 0 10.5 10.5z"/></svg>',
  asphalt: '<svg viewBox="0 0 24 24"><path d="M8 3L4 21M16 3l4 18M12 4v3M12 10v4M12 17v3"/></svg>',
  ice: '<svg viewBox="0 0 24 24"><path d="M12 2l3 6 6 1-4.5 4.5 1 6.5L12 17l-5.5 3 1-6.5L3 9l6-1z"/></svg>',
  dirt: '<svg viewBox="0 0 24 24"><path d="M2 18c3-4 5-4 8-2s5 2 12-4"/><circle cx="7" cy="10" r="1.2"/><circle cx="15" cy="7" r="1.2"/><circle cx="18" cy="15" r="1.2"/></svg>',
  grass: '<svg viewBox="0 0 24 24"><path d="M3 21c1-5 2-8 4-10M7 21c0-6 1-10 3-14M12 21c0-5 1-9 4-12M17 21c0-3 1-6 4-8"/></svg>',
};
function choice(key, opts, cur, labelFn, on) {
  return `<div class="choice" data-key="${key}">${opts.map(o => `<button data-v="${o}" class="${o === cur ? 'on' : ''}">${ICONS[o] || ''}<span>${labelFn(o)}</span></button>`).join('')}</div>`;
}
function slider(id, label, min, max, step, val, unit) {
  return `<div class="slider-row"><div class="top"><span>${label}</span><b id="${id}_v">${val} ${unit}</b></div><input type="range" id="${id}" min="${min}" max="${max}" step="${step}" value="${val}"></div>`;
}
function compassSVG(dir, speed) {
  const a = (dir - 90) * Math.PI / 180;
  const tip = [65 + Math.cos(a) * 44, 65 + Math.sin(a) * 44];
  const ticks = Array.from({ length: 36 }, (_, k) => { const b = k * 10 * Math.PI / 180 - Math.PI / 2, r1 = k % 9 ? 56 : 50; return `<line x1="${65 + Math.cos(b) * r1}" y1="${65 + Math.sin(b) * r1}" x2="${65 + Math.cos(b) * 60}" y2="${65 + Math.sin(b) * 60}" stroke="#3a4656" stroke-width="${k % 9 ? 1 : 2}"/>`; }).join('');
  return `<svg class="compass" id="compass" viewBox="0 0 130 130"><circle cx="65" cy="65" r="61" fill="#0a0e14" stroke="#2f3a49"/>${ticks}
    <text x="65" y="22" fill="#e9eef5" font-size="12" text-anchor="middle" font-family="Rajdhani">${t('wind_n')}</text><text x="112" y="69" fill="#8593a6" font-size="11" text-anchor="middle" font-family="Rajdhani">${t('wind_e')}</text>
    <text x="65" y="116" fill="#8593a6" font-size="11" text-anchor="middle" font-family="Rajdhani">${t('wind_s')}</text><text x="18" y="69" fill="#8593a6" font-size="11" text-anchor="middle" font-family="Rajdhani">${t('wind_w')}</text>
    <line x1="${tip[0]}" y1="${tip[1]}" x2="${65 - Math.cos(a) * 30}" y2="${65 - Math.sin(a) * 30}" stroke="#2ad4ff" stroke-width="3" stroke-linecap="round"/>
    <circle cx="${tip[0]}" cy="${tip[1]}" r="5" fill="#2ad4ff"/><polygon points="${65 - Math.cos(a) * 30},${65 - Math.sin(a) * 30} ${65 - Math.cos(a) * 20 + Math.cos(a + 1.57) * 7},${65 - Math.sin(a) * 20 + Math.sin(a + 1.57) * 7} ${65 - Math.cos(a) * 20 - Math.cos(a + 1.57) * 7},${65 - Math.sin(a) * 20 - Math.sin(a + 1.57) * 7}" fill="#2ad4ff"/>
    <text x="65" y="70" fill="#e9eef5" font-size="13" text-anchor="middle" font-family="ShareTech">${dir}°</text></svg>`;
}
function renderCondStep() {
  const e = app.env;
  const rec = e.weather === 'rain' ? (e.intensity > 0.55 ? 'wet' : 'inter') : e.weather === 'snow' || e.surface === 'ice' ? 'studs' : null;
  $('#condGrid').innerHTML = `
    <div class="card cbox"><h2 class="sec">${t('weather')}</h2>${choice('weather', ['dry', 'rain', 'snow'], e.weather, o => t('w_' + o))}
      ${e.weather !== 'dry' ? slider('intensity', t('intensity'), 0, 100, 5, Math.round(e.intensity * 100), '%') : ''}
      ${rec && app.car.compound !== rec ? `<p class="note">→ ${t('p_compound')} : <b>${t('c_' + rec)}</b></p>` : ''}</div>
    <div class="card cbox"><h2 class="sec">${t('time_of_day')}</h2>${choice('night', ['day', 'night'], e.night ? 'night' : 'day', o => t(o))}</div>
    <div class="card cbox"><h2 class="sec">${t('wind')}</h2>
      <div class="compass-wrap">${compassSVG(e.windDir, e.windSpeed)}<div style="flex:1">${slider('windSpeed', t('wind_speed'), 0, 120, 1, e.windSpeed, 'km/h')}
      ${slider('windDir', t('wind_dir'), 0, 355, 5, e.windDir, '°')}</div></div></div>
    <div class="card cbox"><h2 class="sec">${t('air_temp')} · ${t('track_temp')}</h2>
      ${slider('airTemp', t('air_temp'), -25, 50, 1, e.airTemp, '°C')}${slider('trackTemp', t('track_temp'), -25, 70, 1, e.trackTemp, '°C')}</div>
    <div class="card cbox"><h2 class="sec">${t('surface')} <span class="tag">${t('surface_fun')}</span></h2>${choice('surface', ['asphalt', 'ice', 'dirt', 'grass'], e.surface, o => t('s_' + o))}</div>`;
  $$('#condGrid .choice').forEach(ch => $$('button', ch).forEach(b => b.onclick = () => {
    const k = ch.dataset.key, v = b.dataset.v;
    if (k === 'night') e.night = v === 'night';
    else e[k] = v;
    if (k === 'weather') {
      if (v === 'snow') { e.airTemp = Math.min(e.airTemp, -2); e.trackTemp = Math.min(e.trackTemp, -1); }
      if (v === 'rain') { e.trackTemp = Math.min(e.trackTemp, e.airTemp + 3); }
    }
    if (k === 'surface' && v === 'ice') { e.airTemp = Math.min(e.airTemp, -3); e.trackTemp = Math.min(e.trackTemp, -4); }
    if (k === 'night' && e.night) e.trackTemp = Math.min(e.trackTemp, e.airTemp + 2);
    save(); renderCondStep(); renderSummary();
  }));
  const bind = (id, fn, unit) => { const el = $('#' + id); if (!el) return; el.oninput = () => { fn(+el.value); $('#' + id + '_v').textContent = el.value + ' ' + unit; save(); renderSummary(); if (id.startsWith('wind')) $('#compass').outerHTML = compassSVG(e.windDir, e.windSpeed), bindCompass(); }; };
  bind('intensity', v => e.intensity = v / 100, '%'); bind('windSpeed', v => e.windSpeed = v, 'km/h'); bind('windDir', v => e.windDir = v, '°');
  bind('airTemp', v => e.airTemp = v, '°C'); bind('trackTemp', v => e.trackTemp = v, '°C');
  function bindCompass() {
    const cp = $('#compass');
    const setFrom = (ev) => {
      const r = cp.getBoundingClientRect();
      const a = Math.atan2(ev.clientY - r.top - r.height / 2, ev.clientX - r.left - r.width / 2) * 180 / Math.PI + 90;
      e.windDir = (Math.round(((a + 360) % 360) / 5) * 5) % 360;
      $('#windDir').value = e.windDir; $('#windDir_v').textContent = e.windDir + ' °';
      cp.outerHTML = compassSVG(e.windDir, e.windSpeed); bindCompass(); save(); renderSummary();
    };
    cp.onpointerdown = setFrom;
  }
  bindCompass();
}

// ---------------------------------------------------------------- session
function renderSessionStep() {
  const s = app.session;
  $('#sessionGrid').innerHTML = `
    <div class="card cbox"><h2 class="sec">${t('step_session')}</h2>
      <div class="prow"><label>${t('laps')}</label><div class="ctl"><input type="number" id="sLaps" min="1" max="2000" step="1" value="${s.laps}"><span class="u">${t('lap').toLowerCase()}</span></div></div>
      <div class="prow"><label>${t('start')}</label><div class="ctl"><div class="toggle" id="sStart"><button data-v="0" class="${!s.standing ? 'on' : ''}">${t('flying')}</button><button data-v="1" class="${s.standing ? 'on' : ''}">${t('standing')}</button></div></div></div>
      <div class="prow"><label>${t('seed')}</label><div class="ctl"><input type="number" id="sSeed" min="1" max="999999" step="1" value="${s.seed}"></div></div>
    </div>
    <div class="card cbox"><h2 class="sec">${t('pit_stop')}</h2>
      <div class="prow"><label>${t('auto_pit')}</label><div class="ctl"><div class="toggle" id="sPit"><button data-v="1" class="${s.autoPit ? 'on' : ''}">${t('yes')}</button><button data-v="0" class="${!s.autoPit ? 'on' : ''}">${t('no')}</button></div></div></div>
      ${slider('sWear', t('pit_wear'), 30, 100, 1, s.pitWear, '%')}
      <p class="note">${t('pit_loss')} : ${TRACKS.find(x => x.id === app.trackId).pit} s · ${t('p_refuelRate')} : ${app.car.refuelRate} L/s · ${t('p_tireChange')} : ${app.car.tireChange} s</p>
    </div>
    <div class="big-launch">
      <button class="launch rt" id="goRT"><svg viewBox="0 0 24 24"><path d="M6 4l14 8-14 8z" fill="#fff"/></svg><div><div class="lt">${t('run_rt')}</div><div class="ls">${t('run_rt_sub')}</div></div></button>
      <button class="launch drive" id="goDrive"><svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="2.2"/><path d="M3.5 10.5h6.3M14.2 10.5h6.3M12 14.2V21"/></svg><div><div class="lt">${t('run_drive')}</div><div class="ls">${t('run_drive_sub')}</div></div></button>
      <button class="launch batch" id="goBatch"><svg viewBox="0 0 24 24"><path d="M4 12h4l3-7 4 14 3-7h2"/></svg><div><div class="lt">${t('run_batch')}</div><div class="ls">${t('run_batch_sub')}</div></div></button>
      <button class="btn ghost" id="goImport">${t('import_json')}</button>
    </div>`;
  $('#sLaps').onchange = e => { s.laps = Math.max(1, Math.min(2000, Math.round(+e.target.value || 1))); e.target.value = s.laps; save(); renderSummary(); };
  $('#sSeed').onchange = e => { s.seed = Math.max(1, Math.round(+e.target.value || 1)); save(); };
  $$('#sStart button').forEach(b => b.onclick = () => { s.standing = b.dataset.v === '1'; save(); renderSessionStep(); });
  $$('#sPit button').forEach(b => b.onclick = () => { s.autoPit = b.dataset.v === '1'; save(); renderSessionStep(); });
  $('#sWear').oninput = e => { s.pitWear = +e.target.value; $('#sWear_v').textContent = s.pitWear + ' %'; save(); };
  $('#goRT').onclick = launchRT; $('#goDrive').onclick = launchDrive; $('#goBatch').onclick = launchBatch; $('#goImport').onclick = () => $('#fileInput').click();
}

// ---------------------------------------------------------------- synthèse
function renderSummary() {
  const def = TRACKS.find(x => x.id === app.trackId), c = app.car, e = app.env, s = app.session;
  const w = e.weather === 'dry' ? t('w_dry') : `${t('w_' + e.weather)} ${Math.round(e.intensity * 100)} %`;
  $('#summary').innerHTML = `
    <h2 class="sec">${t('summary')}</h2>
    <div class="sum-block"><div class="sum-k">${t('step_track')}</div><div class="sum-v">${def.flag} ${def.name}<small>${fmt(def.length / 1000, 3)} km</small></div><canvas class="sum-map" id="sumMap"></canvas></div>
    <div class="sum-block"><div class="sum-k">${t('step_car')}</div><div class="sum-v" style="color:${CAT_COLORS[app.carType]}">${t('cat_' + app.carType)}<small>${c.power} ch · ${c.mass} kg</small></div>
      <div class="sum-tags"><span class="tag">${t('c_' + c.compound)}</span><span class="tag">${c.fuel} L</span><span class="tag">Cx ${c.cx} · Cz ${c.cz}</span><span class="tag">${t('wings')} ${c.wingFront}° / ${c.wingRear}°</span></div></div>
    <div class="sum-block"><div class="sum-k">${t('step_cond')}</div>
      <div class="sum-tags"><span class="tag">${w}</span><span class="tag">${e.night ? t('night') : t('day')}</span><span class="tag">${t('wind')} ${e.windSpeed} km/h · ${e.windDir}°</span><span class="tag">${t('air')} ${e.airTemp} °C</span><span class="tag">${t('s_' + e.surface)} ${e.trackTemp} °C</span></div></div>
    <div class="sum-block"><div class="sum-k">${t('step_session')}</div><div class="sum-v">${s.laps}<small>${t('lap').toLowerCase()} · ${s.standing ? t('standing') : t('flying')}</small></div></div>
    <button class="btn" id="sumRT">${t('run_rt')}</button>
    <button class="btn ghost" id="sumDrive">${t('run_drive')}</button>
    <button class="btn ghost" id="sumBatch">${t('run_batch')}</button>
    <button class="btn ghost small" id="sumImport">${t('import_json')}</button>`;
  requestAnimationFrame(() => drawTrackMap($('#sumMap'), def.points, { lw: 2.5 }));
  $('#sumRT').onclick = launchRT; $('#sumDrive').onclick = launchDrive; $('#sumBatch').onclick = launchBatch; $('#sumImport').onclick = () => $('#fileInput').click();
}

// ---------------------------------------------------------------- lancements
let live = null;
async function launchRT() {
  loader(true, t('loading'));
  await nextFrame();
  try {
    live = new LiveRun(currentCfg(), { onExit: backToGarage, onResults: (rep) => { live = null; showScreen('results'); showReport(rep, { onBack: backToGarage, onRelaunch: launchRT, relaunchLabel: t('run_rt') }); } });
    showScreen('sim');
    await live.start();
  } catch (err) { console.error(err); toast(String(err.message || err)); backToGarage(); }
  loader(false);
}
async function launchDrive() {
  loader(true, t('loading'));
  await nextFrame();
  try {
    live = new DriveRun(currentCfg(), { onExit: backToGarage, onResults: (rep) => { live = null; showScreen('results'); showReport(rep, { onBack: backToGarage, onRelaunch: launchDrive, relaunchLabel: t('run_drive') }); } });
    showScreen('sim');
    await live.start();
  } catch (err) { console.error(err); toast(String(err.message || err)); backToGarage(); }
  loader(false);
}
async function launchBatch() {
  showScreen('results');
  await runBatch(currentCfg(), { onBack: backToGarage, onRelaunch: launchBatch });
}
export function backToGarage() {
  if (live) { live.destroy(); live = null; }
  showScreen('garage'); goStep(app.step); renderSummary();
}

// ---------------------------------------------------------------- import JSON
$('#fileInput').onchange = async (ev) => {
  const f = ev.target.files[0]; ev.target.value = '';
  if (!f) return;
  try {
    const rep = JSON.parse(await f.text());
    if (rep.app !== 'Sporoto' || !rep.config || !Array.isArray(rep.laps)) throw new Error('format');
    const c = rep.config;
    if (!CARS[c.carType] || !TRACKS.find(x => x.id === c.trackId)) throw new Error('format');
    app.trackId = c.trackId; app.carType = c.carType; app.car = { ...CARS[c.carType], ...c.car };
    app.env = { ...DEFAULT.env, ...c.env }; app.session = { ...DEFAULT.session, ...c.session };
    save();
    toast(t('imported'));
    showScreen('results');
    showReport(rep, { onBack: backToGarage, onRelaunch: launchBatch, imported: true });
  } catch (e) { toast(t('import_error')); }
};

// ---------------------------------------------------------------- langue
function refreshLang() {
  $$('.lang button').forEach(b => b.classList.toggle('active', b.dataset.lang === getLang()));
  applyI18n();
  const grid = $('#trackGrid'); delete grid.dataset.built;
  if ($('#garage').classList.contains('active')) goStep(app.step);
  renderSummary();
  if (live) live.relabel();
  document.dispatchEvent(new Event('sporoto:lang'));
}
$$('.lang button').forEach(b => b.onclick = () => { setLang(b.dataset.lang); refreshLang(); });

refreshLang();
