// Sporoto — simulation en temps réel : lecture des tours calculés par le moteur physique, rendu 3D et HUD.
import { Session, fmtTime } from './session.js';
import { Renderer3D } from './render3d.js';
import { CarAudio } from './audio.js';
import { t } from './i18n.js';
import { COMPOUNDS } from './data/cars.js';
import { setupCanvas, fitTransform, drawElevation, elevColor } from './draw.js';

const $ = (s, r = document) => r.querySelector(s);
const SCALES = [0.25, 0.5, 1, 2, 5, 10, 20, 50, 100];
export const CAMS = ['chase', 'tv', 'onboard', 'heli', 'top'];

function tempColor(T, comp) {
  const x = (T - comp.Topt) / comp.dT;
  if (x < -1) return '#2a8cff';
  if (x < -0.4) return '#2ad4ff';
  if (x <= 0.6) return '#2ee88c';
  if (x <= 1.1) return '#ffb627';
  return '#ff3b2f';
}
function download(name, obj) {
  const blob = new Blob([JSON.stringify(obj, null, 2)], { type: 'application/json' });
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name;
  document.body.appendChild(a); a.click(); setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 500);
}
export function reportName(rep) {
  const d = new Date();
  const p = n => String(n).padStart(2, '0');
  return `sporoto_${rep.config.trackId}_${rep.config.carType}_${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}_${p(d.getHours())}${p(d.getMinutes())}.json`;
}
export { download };

export class LiveRun {
  constructor(cfg, cb) {
    this.cfg = cfg; this.cb = cb;
    this.scale = 1; this.paused = false; this.camIdx = 0;
    this.onKey = this.onKey.bind(this);
    this.loop = this.loop.bind(this);
  }

  async start() {
    this.session = new Session(this.cfg);
    this.tr = this.session.track;
    this.r3d = new Renderer3D($('#view3d'));
    this.r3d.build(this.tr, { ...this.cfg, car: this.cfg.car });
    this.bestV = null; this.bestSectors = [Infinity, Infinity, Infinity];
    this.audio = new CarAudio(this.cfg.carType, this.cfg.car);
    this.audio.start();
    this._resume = () => this.audio && this.audio.resume();
    window.addEventListener('pointerdown', this._resume);
    this.prepareMaps();
    this.buildControls();
    this.renderCond();
    this.startLap();
    this.phase = 'run';
    window.addEventListener('keydown', this.onKey);
    this.last = performance.now(); this.hudT = 0;
    this.raf = requestAnimationFrame(this.loop);
  }

  destroy() {
    cancelAnimationFrame(this.raf);
    window.removeEventListener('keydown', this.onKey);
    if (this.r3d) this.r3d.dispose();
    if (this.audio) this.audio.destroy();
    window.removeEventListener('pointerdown', this._resume);
    $('#banner').classList.remove('show');
  }

  // Calcule le tour suivant et copie sa télémétrie pour la lecture
  startLap() {
    const rec = this.session.nextLap();
    if (!rec) return false;
    const T = this.session.sim.trace;
    const copy = {};
    for (const k of Object.keys(T)) copy[k] = T[k].slice();
    this.cur = { rec, trace: copy, t: 0, idx: 0, lapTime: copy.t[this.tr.N] };
    this.r3d.colorLine(copy);
    return true;
  }

  finishLap() {
    const { rec, trace } = this.cur;
    const st = this.session.stats();
    if (rec.time <= st.best + 1e-9 && !rec.pit) this.bestV = trace.v;
    if (!this.bestV) this.bestV = trace.v;
    rec.sectors.forEach((s, k) => { if (!rec.pit || k < 2) this.bestSectors[k] = Math.min(this.bestSectors[k], s); });
    this.renderTiming(true);
    if (this.session.dnf) { this.banner(this.session.dnf === 'fuel' ? t('dnf_fuel') : t('dnf_tires'), ''); this.phase = 'end'; this.renderEnd(); return; }
    if (rec.pit) { this.phase = 'pit'; this.pitLeft = rec.pit.loss; this.banner(t('pit'), `${t('pit_stop')} · ${rec.pit.duration.toFixed(1)} s${rec.pit.fuelAdded ? ` · +${rec.pit.fuelAdded} L` : ''}${rec.pit.tires ? ' · ' + t('tires') : ''}`); }
    if (this.session.done) { this.phase = 'end'; this.banner(t('finished'), `${t('average')} ${fmtTime(st.avg)} · ${t('best')} ${fmtTime(st.best)}`); this.renderEnd(); return; }
    if (this.phase !== 'pit') this.startLap();
  }

  loop(now) {
    this.raf = requestAnimationFrame(this.loop);
    const dtReal = Math.min(0.1, (now - this.last) / 1000); this.last = now;
    let dt = this.paused || this.phase === 'end' ? 0 : dtReal * this.scale;
    if (this.phase === 'pit') {
      this.pitLeft -= dt; dt = 0;
      if (this.pitLeft <= 0) { $('#banner').classList.remove('show'); this.phase = 'run'; this.startLap(); }
    }
    const cur = this.cur, tr = this.tr, N = tr.N, T = cur.trace;
    if (this.phase === 'run') {
      cur.t += dt;
      if (cur.t >= cur.lapTime) {
        const over = cur.t - cur.lapTime;
        this.finishLap();
        if (this.phase === 'run' && this.cur !== cur) this.cur.t = Math.min(over, this.cur.lapTime * 0.5);
        return;
      }
      while (cur.idx < N - 1 && T.t[cur.idx + 1] <= cur.t) cur.idx++;
      while (cur.idx > 0 && T.t[cur.idx] > cur.t) cur.idx--;
    }
    const i = this.phase === 'run' ? cur.idx : (this.phase === 'pit' ? 0 : cur.idx);
    const t0 = T.t[i], t1 = T.t[i + 1];
    const f = this.phase === 'run' ? Math.max(0, Math.min(1, (cur.t - t0) / (t1 - t0 || 1))) : 0;
    const v = this.phase === 'run' ? T.v[i] + (T.v[i + 1] - T.v[i]) * f : 0;
    const running = this.phase === 'run' && !this.paused;
    this.r3d.update(i, f, {
      v, ax: running ? T.ax[i] : 0, ay: running ? T.ay[i] : 0, brk: running ? T.brk[i] : 0,
      ride: T.ride[i] || (this.cfg.car.rideFront + this.cfg.car.rideRear) / 2, bT: [T.bT[i * 2], T.bT[i * 2 + 1]], rain: this.cfg.env.weather !== 'dry',
    }, dtReal * (this.paused ? 0 : 1) * Math.min(this.scale, 2) * (this.phase === 'run' ? 1 : 0.4));
    if (this.audio) {
      this.audio.update({
        rpm: T.rpm[i] + (T.rpm[i + 1] - T.rpm[i]) * f, gear: T.gear[i], thr: T.thr[i], brk: T.brk[i], v,
        grip: T.u ? T.u[i] : 0, running, pit: this.phase === 'pit' && !this.paused, cam: this.r3d.camMode, scale: this.scale,
      }, dtReal);
    }
    this.hudT += dtReal;
    if (this.hudT > 1 / 20) { this.hudT = 0; this.renderHUD(i, f, v); }
  }

  // ------------------------------------------------------------ HUD
  prepareMaps() {
    const tr = this.tr;
    const mm = $('#miniMap');
    const { g, W, H } = setupCanvas(mm, 300, 220);
    const pts = []; for (let i = 0; i < tr.N; i++) pts.push([tr.cx[i], tr.cz[i]]);
    this.mapT = fitTransform(pts, W, H, 14);
    // fond de carte pré-rendu
    const off = document.createElement('canvas'); off.width = mm.width; off.height = mm.height;
    const og = off.getContext('2d'); og.setTransform(mm.width / W, 0, 0, mm.height / H, 0, 0);
    og.lineCap = og.lineJoin = 'round';
    og.strokeStyle = 'rgba(255,255,255,.12)'; og.lineWidth = 7; og.beginPath();
    pts.forEach((p, k) => { const [x, y] = this.mapT.f(p[0], p[1]); k ? og.lineTo(x, y) : og.moveTo(x, y); }); og.closePath(); og.stroke();
    og.lineWidth = 3;
    for (let k = 0; k < tr.N; k++) {
      const j = (k + 1) % tr.N, [x1, y1] = this.mapT.f(tr.cx[k], tr.cz[k]), [x2, y2] = this.mapT.f(tr.cx[j], tr.cz[j]);
      og.strokeStyle = elevColor((tr.cy[k] - tr.ymin) / (tr.ymax - tr.ymin || 1));
      og.beginPath(); og.moveTo(x1, y1); og.lineTo(x2, y2); og.stroke();
    }
    // limites de secteurs
    for (const s of [0, Math.floor(tr.N / 3), Math.floor(2 * tr.N / 3)]) {
      const [x, y] = this.mapT.f(tr.cx[s], tr.cz[s]);
      og.fillStyle = s ? '#ffb627' : '#fff'; og.beginPath(); og.arc(x, y, s ? 3 : 4.5, 0, 7); og.fill();
    }
    this.mapBg = off; this.mapG = g; this.mapWH = [W, H];
    // flèche du vent
    this.elevG = drawElevation($('#elevMini'), tr, { w: 300, h: 70 });
    const ec = $('#elevMini'); const eo = document.createElement('canvas'); eo.width = ec.width; eo.height = ec.height; eo.getContext('2d').drawImage(ec, 0, 0);
    this.elevBg = eo;
  }

  buildControls() {
    const el = $('#controls');
    el.innerHTML = `
      <div class="ctl-row"><button class="hbtn wide" id="cPlay"></button><button class="hbtn wide" id="cExport" data-i18n="export_json">${t('export_json')}</button></div>
      <div class="ctl-row"><span class="lbl">${t('time_scale')}</span>${SCALES.map(s => `<button class="hbtn ${s === this.scale ? 'on' : ''}" data-s="${s}">×${s < 1 ? (s === 0.25 ? '¼' : '½') : s}</button>`).join('')}</div>
      <div class="ctl-row"><span class="lbl">${t('camera')}</span>${CAMS.map((c, k) => `<button class="hbtn ${k === this.camIdx ? 'on' : ''}" data-c="${k}">${t('cam_' + c)}</button>`).join('')}</div>
      <div class="ctl-row"><span class="lbl">${t('sound')}</span><button class="hbtn ${CarAudio.enabled ? 'on' : ''}" id="cSound">${CarAudio.enabled ? '🔊 ' + t('yes') : '🔇 ' + t('no')}</button><input type="range" id="cVol" min="0" max="1" step="0.05" value="${CarAudio.volume}" style="flex:1" ${CarAudio.enabled ? '' : 'disabled'}></div>
      <div class="ctl-row"><button class="hbtn wide" id="cStop">${t('stop')}</button><button class="hbtn wide" id="cBack">${t('back_garage')}</button></div>
      <div class="ctl-row" style="color:var(--dim);font-size:11px">${CAMS[this.camIdx] === 'top' ? t('orbit_help') : t('keys')}</div>`;
    const play = $('#cPlay');
    play.textContent = this.paused ? '▶ ' + t('play') : '❚❚ ' + t('pause');
    play.onclick = () => { this.paused = !this.paused; this.buildControls(); };
    el.querySelectorAll('[data-s]').forEach(b => b.onclick = () => { this.scale = +b.dataset.s; this.buildControls(); });
    el.querySelectorAll('[data-c]').forEach(b => b.onclick = () => { this.camIdx = +b.dataset.c; this.r3d.setCamMode(CAMS[this.camIdx]); this.buildControls(); });
    $('#cSound').onclick = () => { this.audio.setEnabled(!CarAudio.enabled); this.buildControls(); };
    $('#cVol').oninput = e => this.audio.setVolume(+e.target.value);
    $('#cExport').onclick = () => { const rep = this.session.report(); download(reportName(rep), rep); };
    $('#cStop').onclick = () => { const rep = this.session.report(); this.destroy(); this.cb.onResults(rep); };
    $('#cBack').onclick = () => this.cb.onExit();
  }

  relabel() { this.buildControls(); this.renderCond(); this.renderTiming(true); $('.tele-title').textContent = t('speed_trace'); }

  onKey(e) {
    if (e.target.tagName === 'INPUT') return;
    if (e.code === 'Space') { e.preventDefault(); this.paused = !this.paused; this.buildControls(); }
    else if (e.key === 'm' || e.key === 'M') { this.audio.setEnabled(!CarAudio.enabled); this.buildControls(); }
    else if (e.key === 'c' || e.key === 'C') { this.camIdx = (this.camIdx + 1) % CAMS.length; this.r3d.setCamMode(CAMS[this.camIdx]); this.buildControls(); }
    else if (e.key === '+' || e.key === '=') { this.scale = SCALES[Math.min(SCALES.length - 1, SCALES.indexOf(this.scale) + 1)]; this.buildControls(); }
    else if (e.key === '-' || e.key === '_') { this.scale = SCALES[Math.max(0, SCALES.indexOf(this.scale) - 1)]; this.buildControls(); }
  }

  banner(title, sub) { const b = $('#banner'); b.innerHTML = `${title}<small>${sub}</small>`; b.classList.add('show'); }

  renderEnd() {
    const c = $('#controls');
    if (!c.querySelector('#cResults')) {
      const row = document.createElement('div'); row.className = 'ctl-row';
      row.innerHTML = `<button class="hbtn wide on" id="cResults">${t('results')}</button>`;
      c.prepend(row);
      row.querySelector('button').onclick = () => $('#cStop').click();
    }
  }

  renderCond() {
    const e = this.cfg.env, d = this.session.sim.d;
    $('#condBadge').innerHTML = [
      this.session.def.flag + ' ' + this.session.def.name,
      t('cat_' + this.cfg.carType),
      e.weather === 'dry' ? t('w_dry') : `${t('w_' + e.weather)} ${Math.round(e.intensity * 100)} %`,
      e.night ? t('night') : t('day'),
      `${t('wind')} ${e.windSpeed} km/h ${e.windDir}°`,
      `${e.airTemp}/${e.trackTemp} °C`,
      t('s_' + e.surface),
      `ρ ${d.rho.toFixed(3)}`,
    ].map(x => `<span class="tag">${x}</span>`).join('');
  }

  sectorsPassed() {
    const c = this.cur, s = c.rec.sectors;
    if (this.phase !== 'run') return 3;
    return (c.t >= s[0]) + (c.t >= s[0] + s[1]);
  }

  renderTiming() {
    const cur = this.cur, total = this.cfg.session.laps, done = this.doneLaps();
    const passed = this.sectorsPassed();
    const secs = cur.rec.sectors.map((x, k) => {
      const shown = k < passed;
      const cls = !shown ? '' : x <= this.bestSectors[k] + 1e-6 ? 'ob' : 'sl';
      return `<div class="${cls}">${t('sector')}${k + 1} ${shown ? x.toFixed(3) : '––.–––'}</div>`;
    }).join('');
    const last = done.length ? done[done.length - 1].time : null;
    const best = this.bestDone(), avg = this.avgDone();
    $('#timing').innerHTML = `
      <div class="tim-head"><div class="tim-lap">${t('lap').toUpperCase()} ${cur.rec.lap}<small>/${total}</small></div><div class="tim-track">${this.session.def.name}<br>${t('cat_' + this.cfg.carType)}</div></div>
      <div class="tim-cur" id="timCur">${fmtTime(cur.t)}</div>
      <div class="sectors">${secs}</div>
      <div class="tim-rows">
        <span>${t('last')}</span><b>${last ? fmtTime(last) : '–'}</b>
        <span>${t('best')}</span><b class="best">${best ? fmtTime(best) : '–'}</b>
        <span>${t('average')}</span><b class="avg">${avg ? fmtTime(avg) : '–'}</b>
        <span>${t('total')}</span><b id="timTot">${fmtTime(this.totalDone(), 1)}</b>
      </div>
      <div class="lap-list">${this.lapList()}</div>`;
  }
  // tours terminés (le tour en cours de lecture est déjà calculé mais pas encore affiché)
  doneLaps() { const L = this.session.laps; return this.phase === 'end' ? L : L.slice(0, -1).concat(this.phase === 'pit' ? [L[L.length - 1]] : []); }
  bestDone() { const d = this.doneLaps(); return d.length ? Math.min(...d.map(l => l.time)) : null; }
  avgDone() { const d = this.doneLaps(); return d.length ? d.reduce((a, l) => a + l.time, 0) / d.length : null; }
  totalDone() { const d = this.doneLaps(); return d.reduce((a, l) => a + l.time, 0) + (this.phase === 'run' ? this.cur.t : 0); }
  lapList() {
    const d = this.doneLaps(), best = this.bestDone();
    return d.slice().reverse().map(l => `<div class="${l.time === best ? 'best' : ''} ${l.pit ? 'pit' : ''}"><span class="n">${l.lap}</span><span class="t">${fmtTime(l.time)}</span><span class="d">${l.time !== best ? '+' + (l.time - best).toFixed(3) : ''}</span></div>`).join('');
  }

  renderHUD(i, f, v) {
    const cur = this.cur, T = cur.trace, tr = this.tr, car = this.cfg.car, comp = COMPOUNDS[car.compound];
    // chrono
    const key = cur.rec.lap + '|' + this.phase + '|' + this.sectorsPassed();
    if (key !== this._timKey) { this._timKey = key; this.renderTiming(); }
    const tc = $('#timCur'); if (tc) tc.textContent = this.phase === 'pit' ? t('pit') + ' ' + Math.max(0, this.pitLeft).toFixed(1) : fmtTime(cur.t);
    const tot = $('#timTot'); if (tot) tot.textContent = fmtTime(this.totalDone(), 1);
    // carte
    const g = this.mapG, [W, H] = this.mapWH;
    g.clearRect(0, 0, W, H);
    g.save(); g.setTransform(1, 0, 0, 1, 0, 0); g.drawImage(this.mapBg, 0, 0); g.restore();
    const j = (i + 1) % tr.N;
    const [x, z] = this.carXZ || [tr.px[i] + (tr.px[j] - tr.px[i]) * f, tr.pz[i] + (tr.pz[j] - tr.pz[i]) * f];
    const [mx, my] = this.mapT.f(x, z);
    g.fillStyle = '#ff3b2f'; g.strokeStyle = '#fff'; g.lineWidth = 2; g.beginPath(); g.arc(mx, my, 6, 0, 7); g.fill(); g.stroke();
    // vent
    const e = this.cfg.env;
    if (e.windSpeed > 0) {
      const a = (e.windDir + 180) * Math.PI / 180; // direction vers laquelle souffle le vent (écran : nord en haut)
      const cx0 = 24, cy0 = H - 24, L = 13;
      g.strokeStyle = '#2ad4ff'; g.fillStyle = '#2ad4ff'; g.lineWidth = 2;
      g.beginPath(); g.moveTo(cx0 - Math.sin(a) * L, cy0 + Math.cos(a) * L); g.lineTo(cx0 + Math.sin(a) * L, cy0 - Math.cos(a) * L); g.stroke();
      g.beginPath(); g.arc(cx0 + Math.sin(a) * L, cy0 - Math.cos(a) * L, 3, 0, 7); g.fill();
      g.font = '10px ShareTech, monospace'; g.fillText(`${e.windSpeed} km/h`, cx0 + 18, cy0 + 4);
    }
    // profil d'élévation
    const ec = $('#elevMini'), eg = ec.getContext('2d');
    eg.setTransform(1, 0, 0, 1, 0, 0); eg.clearRect(0, 0, ec.width, ec.height); eg.drawImage(this.elevBg, 0, 0);
    const dpr = ec.width / 300;
    eg.setTransform(dpr, 0, 0, dpr, 0, 0);
    const ex = this.elevG.X(i), ey = this.elevG.Y(tr.py[i]);
    eg.strokeStyle = 'rgba(255,255,255,.5)'; eg.beginPath(); eg.moveTo(ex, 0); eg.lineTo(ex, 70); eg.stroke();
    eg.fillStyle = '#fff'; eg.beginPath(); eg.arc(ex, ey, 3.5, 0, 7); eg.fill();
    eg.fillStyle = '#c4cdd9'; eg.font = '10px ShareTech, monospace'; eg.fillText(`${(tr.def.alt0 + tr.py[i]).toFixed(0)} m · ${(tr.grade[i] * 100).toFixed(1)} %`, 6, 12);
    // tableau de bord
    const kmh = v * 3.6, gear = T.gear[i], rpm = T.rpm[i];
    const nR = 16, on = Math.round(Math.min(1, rpm / car.rpmMax) * nR);
    const g2 = Math.sqrt(T.ax[i] ** 2 + T.ay[i] ** 2) / 9.81;
    $('#dash').innerHTML = `<div class="gear">${this.phase === 'pit' ? 'P' : gear}</div><div class="spd">${Math.round(kmh)}<small>${t('speed')}</small></div>
      <div class="rpmbar">${Array.from({ length: nR }, (_, k) => `<i class="${k < on ? 'on' : ''} ${k > nR * 0.7 ? 'y' : ''} ${k > nR * 0.87 ? 'r' : ''}"></i>`).join('')}</div>
      <div class="pedals"><div>${t('throttle')}<div class="bar"><i style="width:${Math.round(T.thr[i] * 100)}%;background:var(--green)"></i></div></div><div>${t('brake')}<div class="bar"><i style="width:${Math.round(T.brk[i] * 100)}%;background:var(--red)"></i></div></div></div>
      <div style="display:flex;justify-content:space-between;margin-top:8px;font-family:var(--f-mono);font-size:13px;color:#c4cdd9"><span>${Math.round(rpm)} ${t('rpm')}</span><span>${g2.toFixed(2)} g</span><span>${(T.ay[i] / 9.81).toFixed(1)} g lat</span></div>`;
    // état voiture
    const tyre = k => {
      const Tt = T.tT[i * 4 + k], w = T.tW[i * 4 + k], p = T.tP[i * 4 + k];
      const col = tempColor(Tt, comp);
      return `<div class="tyre" style="border-left-color:${col}"><div class="tt" style="color:${col}">${Tt.toFixed(0)}°</div><div class="tw">${t('wear')} ${(w * 100).toFixed(1)} %</div><div class="tp">${p.toFixed(1)} psi · ${(p * 0.0689476).toFixed(2)} bar</div><div class="wbar"><i style="width:${Math.max(0, 100 - w * 100)}%;background:${w > comp.cliff ? 'var(--red)' : w > comp.cliff * 0.7 ? 'var(--amber)' : 'var(--text)'}"></i></div></div>`;
    };
    const done = this.doneLaps();
    const fpl = done.length ? done.reduce((a, l) => a + l.fuelUsed, 0) / done.length : cur.rec.fuelUsed;
    const fuel = T.fuel[i];
    const util = done.length ? done[done.length - 1].util : cur.rec.util;
    const bal = (util[0] + util[1]) / 2 - (util[2] + util[3]) / 2;
    const balTxt = Math.abs(bal) < 0.03 ? t('neutral') : bal > 0 ? t('understeer') : t('oversteer');
    const bcol = Tb => Tb > (car.brakeType === 'carbon' ? 1050 : 650) ? 'var(--red)' : Tb < (car.brakeType === 'carbon' ? 250 : 80) ? 'var(--cyan)' : 'var(--amber)';
    const Bf = T.bT[i * 2], Br = T.bT[i * 2 + 1];
    const mgmt = cur.rec.mgmt;
    $('#carState').innerHTML = `
      <div class="cs-title"><span>${t('tires')} · ${t('c_' + car.compound)}</span><span style="color:${comp.color}">●</span></div>
      <div class="tyres">${tyre(0)}${tyre(1)}${tyre(2)}${tyre(3)}</div>
      <div class="cs-title"><span>${t('brakes')}</span></div>
      <div class="brk"><div style="border-left-color:${bcol(Bf)}"><span>${t('front')}</span>${Bf.toFixed(0)} °C</div><div style="border-left-color:${bcol(Br)}"><span>${t('rear')}</span>${Br.toFixed(0)} °C</div></div>
      <div class="cs-title"><span>${t('fuel')}</span><span>${fuel.toFixed(1)} L</span></div>
      <div class="bar"><i style="width:${Math.min(100, fuel / car.tank * 100)}%;background:linear-gradient(90deg,var(--amber),var(--green))"></i></div>
      <div class="kv"><span>${(fuel / Math.max(0.01, fpl)).toFixed(1)} ${t('fuel_laps')}</span><b>${fpl.toFixed(2)} L/${t('lap').toLowerCase()}</b></div>
      ${car.hybridMJ > 0 ? `<div class="kv"><span>${t('ers')}</span><b>${(T.ers[i] / 1e6).toFixed(2)} / ${car.hybridMJ} MJ</b></div>` : ''}
      <div class="cs-title"><span>${t('aero')}</span></div>
      <div class="kv"><span>${t('downforce')}</span><b>${(T.df[i] / 9.81).toFixed(0)} kg</b></div>
      <div class="kv"><span>${t('drag')}</span><b>${(T.drag[i]).toFixed(0)} N</b></div>
      <div class="kv"><span>${t('ride')}</span><b>${T.ride[i].toFixed(1)} mm</b></div>
      <div class="kv"><span>${t('balance')}</span><b>${balTxt}</b></div>
      <div class="kv"><span>${t('mgmt')}</span><b>${mgmt < 0.999 ? '−' + ((1 - mgmt) * 100).toFixed(1) + ' %' : '0 %'}</b></div>
      <div class="kv"><span>${t('power')}</span><b>${(T.pw[i] / 735.5).toFixed(0)} ch</b></div>`;
    // trace de vitesse
    const sc = $('#speedTrace');
    const { g: sg, W: SW, H: SH } = setupCanvas(sc, 520, 120);
    sg.clearRect(0, 0, SW, SH);
    const vmax = Math.max(90, ...(this.bestV ? [Math.max(...this.bestV)] : []), T.v.reduce((a, b) => Math.max(a, b), 0)) * 1.05;
    const X = k => (tr.rs[k] / tr.length) * SW, Y = vv => SH - 4 - (vv / vmax) * (SH - 10);
    sg.strokeStyle = 'rgba(255,255,255,.06)'; sg.lineWidth = 1;
    for (let k = 1; k < 4; k++) { sg.beginPath(); sg.moveTo(0, SH * k / 4); sg.lineTo(SW, SH * k / 4); sg.stroke(); }
    for (const s of [Math.floor(tr.N / 3), Math.floor(2 * tr.N / 3)]) { sg.strokeStyle = 'rgba(255,182,39,.3)'; sg.beginPath(); sg.moveTo(X(s), 0); sg.lineTo(X(s), SH); sg.stroke(); }
    if (this.bestV) {
      sg.strokeStyle = 'rgba(179,123,255,.75)'; sg.lineWidth = 1.2; sg.beginPath();
      for (let k = 0; k < tr.N; k += 2) k ? sg.lineTo(X(k), Y(this.bestV[k])) : sg.moveTo(X(k), Y(this.bestV[k]));
      sg.stroke();
    }
    sg.strokeStyle = '#ff3b2f'; sg.lineWidth = 1.8; sg.beginPath();
    const upto = this.phase === 'run' ? i : tr.N - 1;
    for (let k = 0; k <= upto; k += 2) k ? sg.lineTo(X(k), Y(T.v[k])) : sg.moveTo(X(k), Y(T.v[k]));
    sg.stroke();
    sg.fillStyle = '#8593a6'; sg.font = '10px ShareTech, monospace';
    sg.fillText(`${Math.round(vmax * 3.6)} km/h`, 4, 11);
  }
}
