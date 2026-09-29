// Sporoto — simulation rapide (sans rendu 3D) et écran de résultats / compte rendu.
import { Session, fmtTime } from './session.js';
import { TRACKS } from './data/tracks.js';
import { t, getLang } from './i18n.js';
import { drawLines } from './draw.js';
import { COMPOUNDS } from './data/cars.js';
import { download, reportName } from './hud.js';

const $ = (s, r = document) => r.querySelector(s);
const fmt = (v, d = 0) => Number(v).toLocaleString(getLang() === 'es' ? 'es-ES' : 'fr-FR', { minimumFractionDigits: d, maximumFractionDigits: d });

let cancel = false;
export async function runBatch(cfg, cb) {
  cancel = false;
  const wrap = $('#resultsWrap');
  const def = TRACKS.find(x => x.id === cfg.trackId);
  wrap.innerHTML = `<div class="res-head"><div><div class="res-title">${t('batch_running')}</div><div class="res-sub">${def.flag} ${def.full} · ${t('cat_' + cfg.carType)} · ${cfg.session.laps} ${t('lap').toLowerCase()}</div></div>
    <button class="btn ghost" id="bCancel">${t('back_garage')}</button></div>
    <div class="progress"><i id="bProg"></i></div><div class="res-sub" id="bInfo"></div>`;
  $('#bCancel').onclick = () => { cancel = true; cb.onBack(); };
  await new Promise(r => setTimeout(r, 30));
  const s = new Session(cfg);
  const t0 = performance.now();
  let lastYield = performance.now();
  while (!s.done) {
    s.nextLap();
    if (performance.now() - lastYield > 40) {
      const st = s.stats();
      $('#bProg').style.width = (100 * s.laps.length / cfg.session.laps) + '%';
      $('#bInfo').textContent = `${s.laps.length} / ${cfg.session.laps} ${t('laps_done')} · ${t('avg_lap')} ${fmtTime(st.avg)}`;
      await new Promise(r => setTimeout(r, 0));
      lastYield = performance.now();
      if (cancel) return;
    }
  }
  const rep = s.report();
  rep.computeMs = Math.round(performance.now() - t0);
  showReport(rep, cb);
}

// Couleur d'une température de pneu selon la fenêtre de la gomme
function tCol(T, comp) {
  const x = (T - comp.Topt) / comp.dT;
  return x < -1 ? '#2a8cff' : x < -0.4 ? '#2ad4ff' : x <= 0.6 ? '#2ee88c' : x <= 1.1 ? '#ffb627' : '#ff3b2f';
}
function bCol(T, carbon) {
  return T > (carbon ? 1050 : 650) ? '#ff3b2f' : T < (carbon ? 250 : 80) ? '#2ad4ff' : '#ffb627';
}

export function showReport(rep, cb) {
  const wrap = $('#resultsWrap');
  const c = rep.config, sm = rep.summary, L = rep.laps;
  const def = TRACKS.find(x => x.id === c.trackId);
  const e = c.env;
  const comp = COMPOUNDS[c.car.compound] || COMPOUNDS.soft;
  const carbon = c.car.brakeType === 'carbon';
  const status = sm.dnf === 'fuel' ? t('dnf_fuel') : sm.dnf === 'tires' ? t('dnf_tires') : sm.laps < c.session.laps ? t('stopped') : t('ok');
  const best = sm.best;
  const isBest = l => Math.abs(l.time - best) < 5e-4;   // temps arrondis au millième dans le compte rendu
  const head = `
    <div class="res-head">
      <div><div class="res-title">${t('results')}</div>
        <div class="res-sub">${def.flag} ${def.full} · ${t('cat_' + c.carType)} · ${t('c_' + c.car.compound)} · ${e.weather === 'dry' ? t('w_dry') : t('w_' + e.weather) + ' ' + Math.round(e.intensity * 100) + ' %'} · ${e.night ? t('night') : t('day')} · ${t('s_' + e.surface)} · ${e.airTemp}/${e.trackTemp} °C · ${t('wind')} ${e.windSpeed} km/h ${e.windDir}°${rep.computeMs ? ` · ${rep.computeMs} ms` : ''}</div></div>
      <div style="display:flex;gap:8px;flex-wrap:wrap">
        <button class="btn" id="rExport">${t('export_json')}</button>
        <button class="btn ghost" id="rRelaunch">${cb.relaunchLabel || t('run_batch')}</button>
        <button class="btn ghost" id="rBack">${t('back_garage')}</button>
      </div>
    </div>`;
  if (!L.length) {
    wrap.innerHTML = head + `<div class="card" style="padding:40px;text-align:center;color:var(--muted)">${t('no_laps')}</div>`;
  } else {
    const bs = [0, 1, 2].map(k => Math.min(...L.filter(l => !l.pit || k < 2).map(l => l.sectors[k])));
    const theo = bs.reduce((a, b) => a + b, 0);
    const last = L[L.length - 1];
    const tyreNames = ['tfl', 'tfr', 'trl', 'trr'].map(k => t(k));
    const tyreCard = (x, k) => `<div class="fin-tyre" style="border-left-color:${tCol(x.T, comp)}"><div class="fn">${tyreNames[k]}</div><div class="ft" style="color:${tCol(x.T, comp)}">${Math.round(x.T)}°C</div><div class="fs">${t('wear')} ${x.wear.toFixed(1)} %</div><div class="fs">${x.p.toFixed(1)} psi · ${(x.p * 0.0689476).toFixed(2)} bar</div><div class="wbar"><i style="width:${Math.max(0, 100 - x.wear)}%;background:${x.wear > comp.cliff * 100 ? 'var(--red)' : x.wear > comp.cliff * 70 ? 'var(--amber)' : 'var(--text)'}"></i></div></div>`;
    const note = l => [l.pit ? `${t('pit_short')} ${l.pit.duration.toFixed(1)} s${l.pit.fuelAdded ? ' +' + l.pit.fuelAdded + ' L' : ''}${l.pit.tires ? ' · ' + t('tires').toLowerCase() : ''}` : '', l.offTrack ? `${t('off_short')} ${l.offTrack} s` : ''].filter(Boolean).join(' · ');
    wrap.innerHTML = head + `
    <div class="res-kpis">
      <div class="card kpi hl"><div class="k">${t('avg_lap')}</div><div class="v">${fmtTime(sm.avg)}</div></div>
      <div class="card kpi"><div class="k">${t('best_lap')}</div><div class="v" style="color:var(--violet)">${fmtTime(best)}</div><div class="res-sub">${t('lap')} ${sm.bestLap}</div></div>
      <div class="card kpi"><div class="k">${t('theo_best')}</div><div class="v">${fmtTime(theo)}</div><div class="res-sub">S1 ${bs[0].toFixed(3)} · S2 ${bs[1].toFixed(3)} · S3 ${bs[2].toFixed(3)}</div></div>
      <div class="card kpi"><div class="k">${t('total_time')}</div><div class="v">${fmtTime(sm.total, 1)}</div></div>
      <div class="card kpi"><div class="k">${t('laps_done')}</div><div class="v">${sm.laps} / ${c.session.laps}</div></div>
      <div class="card kpi"><div class="k">${t('fuel_used')}</div><div class="v">${fmt(sm.fuelUsed, 1)} L</div><div class="res-sub">${fmt(sm.fuelUsed / sm.laps, 2)} L / ${t('lap').toLowerCase()} · ${t('pits')} ${sm.pits}</div></div>
      <div class="card kpi"><div class="k">${t('status')}</div><div class="v" style="font-size:18px;color:${sm.dnf ? 'var(--red)' : 'var(--green)'}">${status}</div></div>
    </div>
    <div class="res-final card">
      <h2 class="sec">${t('final_state')}</h2>
      <div class="fin-grid">
        <div class="fin-tyres">${last.tires.map(tyreCard).join('')}</div>
        <div class="fin-side">
          <div class="fin-brk" style="border-left-color:${bCol(last.brakes[0], carbon)}"><span>${t('brakes')} ${t('front').toLowerCase()}</span><b>${last.brakes[0]} °C</b></div>
          <div class="fin-brk" style="border-left-color:${bCol(last.brakes[1], carbon)}"><span>${t('brakes')} ${t('rear').toLowerCase()}</span><b>${last.brakes[1]} °C</b></div>
          <div class="fin-brk" style="border-left-color:var(--amber)"><span>${t('fuel')}</span><b>${last.fuelEnd.toFixed(1)} L</b></div>
          <div class="fin-brk" style="border-left-color:var(--cyan)"><span>V. max</span><b>${Math.round(Math.max(...L.map(l => l.vmax)))} km/h</b></div>
        </div>
      </div>
    </div>
    <div class="res-charts">
      <div class="card"><h2 class="sec">${t('lap_chart')}</h2><canvas id="chLaps"></canvas></div>
      <div class="card"><h2 class="sec">${t('wear_chart')}</h2><canvas id="chWear"></canvas></div>
      <div class="card"><h2 class="sec">${t('fuel_chart')}</h2><canvas id="chFuel"></canvas></div>
    </div>
    <div class="res-tabs"><button class="on" data-tab="times">${t('tab_times')}</button><button data-tab="tires">${t('tab_tires')}</button></div>
    <div class="card table-card" data-pane="times"><table class="res-table"><thead><tr>
      <th>${t('col_lap')}</th><th>${t('col_time')}</th><th>${t('col_gap')}</th><th>S1</th><th>S2</th><th>S3</th><th>${t('col_vmax')}</th><th>${t('col_used')}</th><th>${t('col_fuel')}</th><th>${t('col_note')}</th>
    </tr></thead><tbody>${L.map(l => `<tr class="${isBest(l) ? 'best' : ''}">
      <td>${l.lap}</td><td class="strong">${fmtTime(l.time)}</td><td class="muted">${isBest(l) ? '–' : '+' + (l.time - best).toFixed(3)}</td>
      ${l.sectors.map((x, k) => `<td class="${Math.abs(x - bs[k]) < 1e-6 ? 'pb' : ''}">${x.toFixed(3)}</td>`).join('')}
      <td>${Math.round(l.vmax)}</td><td>${l.fuelUsed.toFixed(2)}</td><td>${l.fuelEnd.toFixed(1)}</td><td class="note">${note(l)}</td></tr>`).join('')}</tbody></table></div>
    <div class="card table-card" data-pane="tires" hidden><table class="res-table tyre-table"><thead>
      <tr><th rowspan="2">${t('col_lap')}</th><th colspan="4">${t('temp')} (°C)</th><th colspan="4">${t('wear')} (%)</th><th colspan="4">${t('pressure')} (psi)</th><th colspan="2">${t('brakes')} (°C)</th></tr>
      <tr>${[0, 1, 2].map(() => tyreNames.map(n => `<th>${n}</th>`).join('')).join('')}<th>${t('front')}</th><th>${t('rear')}</th></tr>
    </thead><tbody>${L.map(l => `<tr>
      <td>${l.lap}${l.pit && l.pit.tires ? ' <span class="pitb">P</span>' : ''}</td>
      ${l.tires.map(x => `<td><span class="chip" style="background:${tCol(x.T, comp)}22;color:${tCol(x.T, comp)}">${Math.round(x.T)}</span></td>`).join('')}
      ${l.tires.map(x => `<td class="${x.wear > comp.cliff * 100 ? 'hot' : ''}">${x.wear.toFixed(1)}</td>`).join('')}
      ${l.tires.map(x => `<td>${x.p.toFixed(1)}</td>`).join('')}
      ${l.brakes.map(b => `<td><span class="chip" style="background:${bCol(b, carbon)}22;color:${bCol(b, carbon)}">${b}</span></td>`).join('')}
    </tr>`).join('')}</tbody></table></div>`;
    wrap.querySelectorAll('.res-tabs button').forEach(b => b.onclick = () => {
      wrap.querySelectorAll('.res-tabs button').forEach(x => x.classList.toggle('on', x === b));
      wrap.querySelectorAll('[data-pane]').forEach(p => { p.hidden = p.dataset.pane !== b.dataset.tab; });
    });
    requestAnimationFrame(() => {
      drawLines($('#chLaps'), [
        { pts: L.map(l => [l.lap, l.time, isBest(l)]), color: '#ff3b2f', dots: true },
        { pts: L.map(l => [l.lap, sm.avg]), color: '#2ad4ff', dash: [5, 4], w: 1.2 },
      ], { fmtY: y => fmtTime(y, 1), pl: 56 });
      const cols = ['#ff3b2f', '#ffb627', '#2ad4ff', '#2ee88c'];
      drawLines($('#chWear'), [0, 1, 2, 3].map(k => ({ pts: L.map(l => [l.lap, l.tires[k].wear]), color: cols[k], name: tyreNames[k] })), { ymin: 0, legend: true, pl: 34 });
      drawLines($('#chFuel'), [{ pts: L.map(l => [l.lap, l.fuelEnd]), color: '#ffb627' }], { ymin: 0, pl: 34 });
    });
  }
  $('#rExport').onclick = () => download(reportName(rep), rep);
  $('#rBack').onclick = cb.onBack;
  $('#rRelaunch').onclick = cb.onRelaunch;
  wrap.scrollTop = 0; wrap.parentElement.scrollTop = 0;
}
