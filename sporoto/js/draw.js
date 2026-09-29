// Sporoto — dessins 2D (cartes de circuit, profils d'élévation, graphiques, profils des voitures).
import { SHAPES, airfoil } from './carshapes.js';

export function setupCanvas(cv, w, h) {
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  const W = w ?? cv.clientWidth, H = h ?? cv.clientHeight;
  if (cv.width !== Math.round(W * dpr) || cv.height !== Math.round(H * dpr)) { cv.width = Math.round(W * dpr); cv.height = Math.round(H * dpr); }
  const g = cv.getContext('2d');
  g.setTransform(dpr, 0, 0, dpr, 0, 0);
  return { g, W, H };
}

// Transformation monde → canvas pour une liste de points [x, z]
export function fitTransform(pts, W, H, pad = 10) {
  let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
  for (const p of pts) { x0 = Math.min(x0, p[0]); x1 = Math.max(x1, p[0]); z0 = Math.min(z0, p[1]); z1 = Math.max(z1, p[1]); }
  const s = Math.min((W - 2 * pad) / (x1 - x0 || 1), (H - 2 * pad) / (z1 - z0 || 1));
  const ox = (W - (x1 - x0) * s) / 2 - x0 * s, oz = (H - (z1 - z0) * s) / 2 - z0 * s;
  return { s, f: (x, z) => [ox + x * s, oz + z * s] };
}

// Couleur d'élévation (bas = bleu, haut = orange)
export function elevColor(f) {
  const a = [42, 212, 255], b = [255, 182, 39], c = [255, 59, 47];
  const m = f < 0.6 ? f / 0.6 : (f - 0.6) / 0.4;
  const A = f < 0.6 ? a : b, B = f < 0.6 ? b : c;
  return `rgb(${A.map((v, i) => Math.round(v + (B[i] - v) * m)).join(',')})`;
}

// Carte d'un circuit (points bruts [x,z,y]) avec coloration d'altitude
export function drawTrackMap(cv, points, opts = {}) {
  const { g, W, H } = setupCanvas(cv, opts.w, opts.h);
  g.clearRect(0, 0, W, H);
  const T = fitTransform(points, W, H, opts.pad ?? 8);
  let ymin = Infinity, ymax = -Infinity;
  for (const p of points) { ymin = Math.min(ymin, p[2]); ymax = Math.max(ymax, p[2]); }
  const n = points.length;
  g.lineCap = 'round'; g.lineJoin = 'round';
  g.strokeStyle = 'rgba(255,255,255,.08)'; g.lineWidth = (opts.lw || 3) + 4;
  g.beginPath();
  points.forEach((p, i) => { const [x, y] = T.f(p[0], p[1]); i ? g.lineTo(x, y) : g.moveTo(x, y); });
  g.closePath(); g.stroke();
  g.lineWidth = opts.lw || 3;
  for (let i = 0; i < n; i++) {
    const p = points[i], q = points[(i + 1) % n];
    const [x1, y1] = T.f(p[0], p[1]), [x2, y2] = T.f(q[0], q[1]);
    g.strokeStyle = opts.mono || elevColor(((p[2] + q[2]) / 2 - ymin) / (ymax - ymin || 1));
    g.beginPath(); g.moveTo(x1, y1); g.lineTo(x2, y2); g.stroke();
  }
  // ligne de départ + sens
  const [sx, sy] = T.f(points[0][0], points[0][1]);
  const [nx, ny] = T.f(points[2][0], points[2][1]);
  g.fillStyle = '#fff'; g.beginPath(); g.arc(sx, sy, (opts.lw || 3) + 1.5, 0, Math.PI * 2); g.fill();
  if (opts.arrow !== false) {
    const a = Math.atan2(ny - sy, nx - sx);
    g.fillStyle = '#ff3b2f';
    g.beginPath();
    g.moveTo(sx + Math.cos(a) * 14, sy + Math.sin(a) * 14);
    g.lineTo(sx + Math.cos(a + 2.5) * 7, sy + Math.sin(a + 2.5) * 7);
    g.lineTo(sx + Math.cos(a - 2.5) * 7, sy + Math.sin(a - 2.5) * 7);
    g.fill();
  }
  return T;
}

// Profil d'élévation depuis une piste construite (cy, rs)
export function drawElevation(cv, tr, opts = {}) {
  const { g, W, H } = setupCanvas(cv, opts.w, opts.h);
  g.clearRect(0, 0, W, H);
  const N = tr.N, L = tr.length;
  const pl = opts.axis ? 34 : 4, pr = 4, pt = 8, pb = opts.axis ? 16 : 4;
  const y0 = tr.ymin, y1 = tr.ymax;
  const X = i => pl + (tr.rs[i] / L) * (W - pl - pr);
  const Y = y => H - pb - ((y - y0) / (y1 - y0 || 1)) * (H - pt - pb);
  const grad = g.createLinearGradient(0, pt, 0, H - pb);
  grad.addColorStop(0, 'rgba(255,59,47,.45)'); grad.addColorStop(1, 'rgba(42,212,255,.05)');
  g.beginPath(); g.moveTo(X(0), H - pb);
  for (let i = 0; i < N; i++) g.lineTo(X(i), Y(tr.py[i]));
  g.lineTo(W - pr, H - pb); g.closePath(); g.fillStyle = grad; g.fill();
  g.beginPath();
  for (let i = 0; i < N; i++) i ? g.lineTo(X(i), Y(tr.py[i])) : g.moveTo(X(i), Y(tr.py[i]));
  g.strokeStyle = '#ff8a5c'; g.lineWidth = 1.6; g.stroke();
  if (opts.axis) {
    g.fillStyle = '#8593a6'; g.font = '10px ShareTech, monospace'; g.textAlign = 'right';
    g.fillText(`${(y1 - y0).toFixed(0)} m`, pl - 4, pt + 8);
    g.fillText('0', pl - 4, H - pb);
    g.textAlign = 'center';
    for (let k = 0; k <= 4; k++) g.fillText(`${(L * k / 4 / 1000).toFixed(1)} km`, pl + (W - pl - pr) * k / 4 + (k === 0 ? 14 : k === 4 ? -14 : 0), H - 3);
  }
  return { X, Y, pl, pr };
}

// Graphique de séries simples
export function drawLines(cv, series, opts = {}) {
  const { g, W, H } = setupCanvas(cv, opts.w, opts.h);
  g.clearRect(0, 0, W, H);
  const pl = opts.pl ?? 46, pr = 10, pt = 10, pb = 22;
  let xmin = Infinity, xmax = -Infinity, ymin = opts.ymin ?? Infinity, ymax = opts.ymax ?? -Infinity;
  for (const s of series) for (const [x, y] of s.pts) {
    if (!isFinite(y)) continue;
    xmin = Math.min(xmin, x); xmax = Math.max(xmax, x);
    if (opts.ymin == null) ymin = Math.min(ymin, y);
    if (opts.ymax == null) ymax = Math.max(ymax, y);
  }
  if (!isFinite(xmin)) return;
  if (ymax - ymin < 1e-6) { ymax += 1; ymin -= 1; }
  const padY = (ymax - ymin) * 0.08; if (opts.ymin == null) ymin -= padY; if (opts.ymax == null) ymax += padY;
  if (xmax === xmin) xmax = xmin + 1;
  const X = x => pl + (x - xmin) / (xmax - xmin) * (W - pl - pr);
  const Y = y => H - pb - (y - ymin) / (ymax - ymin) * (H - pt - pb);
  g.strokeStyle = 'rgba(255,255,255,.06)'; g.lineWidth = 1; g.fillStyle = '#8593a6'; g.font = '10px ShareTech, monospace';
  g.textAlign = 'right';
  for (let k = 0; k <= 4; k++) {
    const y = ymin + (ymax - ymin) * k / 4, yy = Y(y);
    g.beginPath(); g.moveTo(pl, yy); g.lineTo(W - pr, yy); g.stroke();
    g.fillText(opts.fmtY ? opts.fmtY(y) : y.toFixed(1), pl - 5, yy + 3);
  }
  g.textAlign = 'center';
  const nx = Math.min(8, Math.round(xmax - xmin));
  for (let k = 0; k <= nx; k++) { const x = xmin + (xmax - xmin) * k / nx; g.fillText(opts.fmtX ? opts.fmtX(x) : Math.round(x), X(x), H - 6); }
  for (const s of series) {
    g.strokeStyle = s.color; g.lineWidth = s.w || 1.8; g.setLineDash(s.dash || []);
    g.beginPath(); let st = false;
    for (const [x, y] of s.pts) { if (!isFinite(y)) { st = false; continue; } st ? g.lineTo(X(x), Y(y)) : g.moveTo(X(x), Y(y)); st = true; }
    g.stroke(); g.setLineDash([]);
    if (s.dots) { g.fillStyle = s.color; for (const [x, y, hl] of s.pts) { if (!isFinite(y)) continue; g.beginPath(); g.arc(X(x), Y(y), hl ? 4 : 2, 0, 7); g.fill(); } }
  }
  if (opts.legend) {
    let lx = pl + 6;
    g.textAlign = 'left'; g.font = '11px Outfit, sans-serif';
    for (const s of series) { if (!s.name) continue; g.fillStyle = s.color; g.fillRect(lx, pt + 2, 10, 3); g.fillStyle = '#c4cdd9'; g.fillText(s.name, lx + 14, pt + 7); lx += g.measureText(s.name).width + 30; }
  }
  return { X, Y };
}

// Vues de profil détaillées (même géométrie que les modèles 3D : js/carshapes.js)
export function carProfileSVG(type, color = '#ff3b2f', opts = {}) {
  const S = SHAPES[type] || SHAPES.LIBRE;
  const k = 43, ox = 8, gy = 70;
  const X = x => (ox + x * k).toFixed(1), Y = y => (gy - y * k).toFixed(1);
  const pts = a => a.map(([x, y]) => `${X(x)},${Y(y)}`).join(' ');
  const id = 'g' + type + Math.round(Math.random() * 1e6);
  const dark = '#14181f', carbon = '#1d232c';
  const out = [];
  out.push(`<defs>
    <linearGradient id="${id}b" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#fff" stop-opacity=".45"/><stop offset=".35" stop-color="#fff" stop-opacity="0"/><stop offset=".75" stop-color="#000" stop-opacity=".15"/><stop offset="1" stop-color="#000" stop-opacity=".55"/></linearGradient>
    <linearGradient id="${id}g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#5d7a99"/><stop offset=".45" stop-color="#101820"/><stop offset="1" stop-color="#05080c"/></linearGradient>
    <radialGradient id="${id}t" cx=".5" cy=".5" r=".5"><stop offset=".62" stop-color="#2a2f37"/><stop offset=".9" stop-color="#0c0e11"/><stop offset="1" stop-color="#000"/></radialGradient>
    <radialGradient id="${id}s" cx=".5" cy=".5" r=".5"><stop offset="0" stop-color="#000" stop-opacity=".6"/><stop offset="1" stop-color="#000" stop-opacity="0"/></radialGradient>
  </defs>`);
  out.push(`<ellipse cx="${X(S.len / 2)}" cy="${gy + 1}" rx="${(S.len / 2 + 0.2) * k}" ry="5" fill="url(#${id}s)"/>`);
  const wheel = (x, r, front) => {
    const cx = X(x), cy = Y(r), R = r * k;
    return `<g><circle cx="${cx}" cy="${cy}" r="${R}" fill="url(#${id}t)"/>
      <circle cx="${cx}" cy="${cy}" r="${R * 0.93}" fill="none" stroke="${opts.stripe || '#ffd12a'}" stroke-width="1.1" stroke-opacity=".85"/>
      <circle cx="${cx}" cy="${cy}" r="${R * 0.6}" fill="#3a414b"/><circle cx="${cx}" cy="${cy}" r="${R * 0.58}" fill="none" stroke="#8a94a2" stroke-width=".8"/>
      ${[0, 1, 2, 3, 4, 5].map(j => { const a = j * Math.PI / 3 + (front ? 0.3 : 0); return `<line x1="${cx}" y1="${cy}" x2="${(+cx + Math.cos(a) * R * 0.55).toFixed(1)}" y2="${(+cy + Math.sin(a) * R * 0.55).toFixed(1)}" stroke="#20252c" stroke-width="2"/>`; }).join('')}
      <circle cx="${cx}" cy="${cy}" r="${R * 0.16}" fill="${color}"/></g>`;
  };
  const wingEl = (x, y, chord, ang, fill) => {
    const af = airfoil(0.14, 0.08).map(([u, v]) => [u * chord, v * chord]);
    const c = Math.cos(-ang), sn = Math.sin(-ang);
    return `<polygon points="${pts(af.map(([u, v]) => [x + u * c - v * sn, y + u * sn + v * c]))}" fill="${fill}"/>`;
  };
  if (S.family === 'open') {
    const fw = S.frontWing, rw = S.rearWing;
    // suspension (triangles)
    for (const [xa, ra] of [[S.xf, S.rF], [S.xr, S.rR]]) {
      const dir = xa === S.xf ? -1 : 1;
      out.push(`<path d="M${X(xa)},${Y(ra)} L${X(xa + dir * 0.55)},${Y(ra + 0.08)} M${X(xa)},${Y(ra)} L${X(xa + dir * 0.5)},${Y(ra - 0.1)}" stroke="#0e1115" stroke-width="2.2"/>`);
    }
    // fond plat, diffuseur
    out.push(`<polygon points="${pts([[0.2, 0.05], [S.floor.x1, 0.035], [S.floor.x1, 0.065], [0.35, 0.09], [0.12, 0.3]])}" fill="${carbon}"/>`);
    out.push(`<polygon points="${pts(S.pods)}" fill="${color}"/><polygon points="${pts(S.pods)}" fill="url(#${id}b)"/>`);
    out.push(`<polygon points="${pts(S.body)}" fill="${color}"/><polygon points="${pts(S.body)}" fill="url(#${id}b)"/>`);
    // bande de livrée + prise d'air
    out.push(`<polyline points="${pts([[1.3, 0.5], [S.xf - 0.7, S.body[8][1] - 0.12], [S.len - 0.25, S.body[6][1] - 0.02]])}" fill="none" stroke="#fff" stroke-opacity=".75" stroke-width="2.2"/>`);
    out.push(`<polygon points="${pts([[S.head.x - 0.32, S.body[11][1] - 0.03], [S.head.x - 0.18, S.body[11][1] - 0.02], [S.head.x - 0.2, S.body[11][1] - 0.2]])}" fill="${dark}"/>`);
    // pilote + halo
    out.push(`<circle cx="${X(S.head.x)}" cy="${Y(S.head.y)}" r="${S.head.r * k}" fill="#f2f2f2"/><path d="M${X(S.head.x - 0.05)},${Y(S.head.y + 0.02)} h${0.17 * k}" stroke="#101418" stroke-width="3" stroke-linecap="round"/>`);
    if (S.halo) out.push(`<path d="M${X(S.head.x - 0.35)},${Y(S.body[9][1])} Q${X(S.head.x + 0.1)},${Y(S.head.y + 0.2)} ${X(S.head.x + 0.55)},${Y(S.body[8][1] + 0.02)}" fill="none" stroke="${dark}" stroke-width="3.2" stroke-linecap="round"/>`);
    // aileron avant (éléments étagés)
    for (let e = 0; e < fw.elems; e++) out.push(wingEl(fw.x + e * 0.1 - 0.05, fw.y + e * 0.045, fw.chord - e * 0.08, 0.05 + e * 0.12, e ? dark : color));
    out.push(`<rect x="${X(fw.x + 0.05)}" y="${Y(0.3)}" width="${0.45 * k}" height="${0.26 * k}" rx="2" fill="${dark}" opacity=".85"/>`);
    // aileron arrière + dérive + beam wing
    out.push(`<rect x="${X(rw.x)}" y="${Y(rw.y + 0.07)}" width="${0.62 * k}" height="${(rw.y - 0.52) * k}" rx="2" fill="${color}"/><rect x="${X(rw.x)}" y="${Y(rw.y + 0.07)}" width="${0.62 * k}" height="${(rw.y - 0.52) * k}" rx="2" fill="url(#${id}b)"/>`);
    out.push(`<line x1="${X(0.45)}" y1="${Y(rw.y - 0.45)}" x2="${X(0.75)}" y2="${Y(0.45)}" stroke="${dark}" stroke-width="3"/>`);
    out.push(wingEl(rw.x + 0.02, rw.y - 0.12, rw.chord, 0.12, dark), wingEl(rw.x + 0.3, rw.y - 0.02, rw.chord * 0.55, 0.45, dark));
    if (S.beamWing) out.push(wingEl(0.1, 0.36, 0.35, 0.15, dark));
    // roues extérieures à la caisse : dessinées par-dessus
    out.push(wheel(S.xr, S.rR, false), wheel(S.xf, S.rF, true));
  } else {
    out.push(wheel(S.xr, S.rR, false), wheel(S.xf, S.rF, true));
    out.push(`<polygon points="${pts(S.body)}" fill="${color}"/>`);
    if (S.cabin) out.push(`<polygon points="${pts(S.cabin)}" fill="${color}"/>`);
    out.push(`<polygon points="${pts(S.body)}" fill="url(#${id}b)"/>`);
    if (S.cabin) out.push(`<polygon points="${pts(S.cabin)}" fill="url(#${id}b)"/>`);
    out.push(`<polygon points="${pts(S.glass)}" fill="url(#${id}g)"/>`);
    if (S.side) out.push(`<polygon points="${pts(S.side)}" fill="url(#${id}g)"/>`);
    if (S.fin) out.push(`<polygon points="${pts(S.fin)}" fill="${color}"/><polygon points="${pts(S.fin)}" fill="url(#${id}b)"/>`);
    // bas de caisse, lame avant, diffuseur, bande
    out.push(`<polygon points="${pts([[0.02, 0.08], [0.45, 0.08], [0.3, 0.26], [0.02, 0.3]])}" fill="${dark}"/>`);
    out.push(`<polygon points="${pts([[S.len - 0.35, 0.06], [S.len + 0.04, 0.06], [S.len + 0.04, 0.1], [S.len - 0.35, 0.12]])}" fill="${dark}"/>`);
    const sy = S.family === 'gt' ? 0.55 : 0.5;
    out.push(`<line x1="${X(0.2)}" y1="${Y(sy)}" x2="${X(S.len - 0.3)}" y2="${Y(sy - 0.05)}" stroke="#fff" stroke-opacity=".7" stroke-width="2"/>`);
    // numéro
    const nx = (S.xr + S.xf) / 2 + 0.15;
    out.push(`<circle cx="${X(nx)}" cy="${Y(0.46)}" r="7" fill="#f2f2f2"/><text x="${X(nx)}" y="${(+Y(0.46) + 3.6).toFixed(1)}" font-size="10" font-family="Rajdhani, sans-serif" font-weight="700" text-anchor="middle" fill="#111">${opts.number || 7}</text>`);
    // feux
    const lf = S.lightsF;
    // phare posé sous la ligne de capot
    const topAt = (x) => { let best = 0; for (let j = 0; j < S.body.length - 1; j++) { const [x1, y1] = S.body[j], [x2, y2] = S.body[j + 1]; if (y1 > 0.2 && y2 > 0.2 && (x - x1) * (x - x2) <= 0) best = Math.max(best, y1 + (y2 - y1) * (x - x1) / (x2 - x1 || 1)); } return best; };
    const lx = S.len - 0.32, ly = topAt(lx) - 0.07;
    out.push(`<ellipse cx="${X(lx)}" cy="${Y(ly)}" rx="${0.16 * k}" ry="2.2" fill="#fff6d6" transform="rotate(-14 ${X(lx)} ${Y(ly)})"/>`);
    out.push(`<rect x="${X(S.lightsR.x) - 1}" y="${Y(S.lightsR.y)}" width="4" height="${0.12 * k}" fill="#ff2a2a"/>`);
    // aileron arrière
    const rw = S.rearWing;
    if (rw.pylons === 'swan') out.push(`<path d="M${X(rw.x + 0.3)},${Y(rw.y + 0.05)} C${X(rw.x + 0.45)},${Y(rw.y + 0.12)} ${X(rw.x + 0.55)},${Y(rw.y - 0.12)} ${X(rw.x + 0.5)},${Y(S.family === 'gt' ? 0.9 : 0.8)}" fill="none" stroke="${dark}" stroke-width="3"/>`);
    else out.push(`<rect x="${X(rw.x)}" y="${Y(rw.y + 0.08)}" width="${0.5 * k}" height="${(rw.y - 0.72) * k}" fill="${dark}"/>`);
    out.push(wingEl(rw.x, rw.y, rw.chord, 0.1, dark));
    out.push(`<rect x="${X(rw.x - 0.02)}" y="${Y(rw.y + 0.12)}" width="${0.5 * k}" height="${0.2 * k}" rx="2" fill="${color}" opacity=".9"/>`);
  }
  return `<svg class="sil" viewBox="0 0 260 76" aria-hidden="true">${out.join('')}</svg>`;
}
