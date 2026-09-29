// Sporoto — géométrie des circuits : ré-échantillonnage, ponts, trajectoire de course,
// courbures horizontale et verticale, pente. Aucune dépendance (utilisable dans Node).
// Repère : x = est, z = -nord (m), y = altitude relative (m).

function gauss(src, sigma, closed = true) {
  const N = src.length, R = Math.ceil(sigma * 3), K = [];
  let ks = 0;
  for (let k = -R; k <= R; k++) { const w = Math.exp(-k * k / (2 * sigma * sigma)); K.push(w); ks += w; }
  const out = new Float64Array(N);
  for (let i = 0; i < N; i++) {
    let s = 0;
    for (let k = -R; k <= R; k++) s += src[closed ? (i + k + N) % N : Math.min(N - 1, Math.max(0, i + k))] * K[k + R];
    out[i] = s / ks;
  }
  return out;
}

// Catmull-Rom centripète (Barry-Goldman) sur une boucle fermée.
function catmull(P, step) {
  const n = P.length, out = [];
  const tj = (ti, a, b) => ti + Math.pow(Math.hypot(b[0] - a[0], b[1] - a[1]) + 1e-6, 0.5);
  for (let i = 0; i < n; i++) {
    const p0 = P[(i - 1 + n) % n], p1 = P[i], p2 = P[(i + 1) % n], p3 = P[(i + 2) % n];
    const t0 = 0, t1 = tj(t0, p0, p1), t2 = tj(t1, p1, p2), t3 = tj(t2, p2, p3);
    const seg = Math.hypot(p2[0] - p1[0], p2[1] - p1[1]);
    const m = Math.max(1, Math.ceil(seg / step));
    for (let k = 0; k < m; k++) {
      const t = t1 + (t2 - t1) * k / m, r = [];
      for (let d = 0; d < 3; d++) {
        const A1 = (t1 - t) / (t1 - t0) * p0[d] + (t - t0) / (t1 - t0) * p1[d];
        const A2 = (t2 - t) / (t2 - t1) * p1[d] + (t - t1) / (t2 - t1) * p2[d];
        const A3 = (t3 - t) / (t3 - t2) * p2[d] + (t - t2) / (t3 - t2) * p3[d];
        const B1 = (t2 - t) / (t2 - t0) * A1 + (t - t0) / (t2 - t0) * A2;
        const B2 = (t3 - t) / (t3 - t1) * A2 + (t - t1) / (t3 - t1) * A3;
        r.push((t2 - t) / (t2 - t1) * B1 + (t - t1) / (t2 - t1) * B2);
      }
      // altitude : interpolation linéaire (déjà lissée, évite les dépassements)
      r[2] = p1[2] + (p2[2] - p1[2]) * k / m;
      // dévers (°, 4e composante facultative) : interpolation linéaire
      r[3] = (p1[3] || 0) + ((p2[3] || 0) - (p1[3] || 0)) * k / m;
      out.push(r);
    }
  }
  return out;
}

function segInter(ax, az, bx, bz, cx, cz, dx, dz) {
  const d = (bx - ax) * (dz - cz) - (bz - az) * (dx - cx);
  if (Math.abs(d) < 1e-9) return false;
  const u = ((cx - ax) * (dz - cz) - (cz - az) * (dx - cx)) / d;
  const v = ((cx - ax) * (bz - az) - (cz - az) * (bx - ax)) / d;
  return u > 0 && u < 1 && v > 0 && v < 1;
}

export function buildTrack(def, opts = {}) {
  const ds = opts.ds || 5;
  const carWidth = opts.carWidth || 2.0;
  // 1. Ré-échantillonnage régulier
  const fine = catmull(def.points, 1.0);
  const cum = [0];
  for (let i = 1; i <= fine.length; i++) {
    const a = fine[i - 1], b = fine[i % fine.length];
    cum.push(cum[i - 1] + Math.hypot(b[0] - a[0], b[1] - a[1]));
  }
  const total = cum[fine.length];
  const N = Math.round(total / ds), step = total / N;
  const cx = new Float64Array(N), cz = new Float64Array(N);
  let cy = new Float64Array(N);
  let cb = new Float64Array(N);
  let j = 0;
  for (let i = 0; i < N; i++) {
    const s = i * step;
    while (cum[j + 1] < s) j++;
    const a = fine[j], b = fine[(j + 1) % fine.length], f = (s - cum[j]) / (cum[j + 1] - cum[j] || 1);
    cx[i] = a[0] + (b[0] - a[0]) * f; cz[i] = a[1] + (b[1] - a[1]) * f; cy[i] = a[2] + (b[2] - a[2]) * f; cb[i] = a[3] + (b[3] - a[3]) * f;
  }
  cy = gauss(cy, 2);
  cb = gauss(cb, 5);   // raccordements de dévers progressifs (≈ 25 m)
  {
    const cs = 2;   // lissage de la ligne médiane (σ = 10 m) : atténue les angles du tracé polygonal
    if (cs > 0) { const gx = gauss(cx, cs), gz = gauss(cz, cs); cx.set(gx); cz.set(gz); }
  }

  // 2. Croisements (Suzuka) : la branche la plus haute passe en pont (≥ 7,5 m de dégagement)
  const bridges = [];
  const minGap = Math.round(300 / step);
  for (let a = 0; a < N; a++) {
    for (let b = a + minGap; b < N; b++) {
      if (N - (b - a) < minGap) continue;
      if (Math.abs(cx[a] - cx[b]) > 3 * step || Math.abs(cz[a] - cz[b]) > 3 * step) continue;
      const a2 = (a + 1) % N, b2 = (b + 1) % N;
      if (!segInter(cx[a], cz[a], cx[a2], cz[a2], cx[b], cz[b], cx[b2], cz[b2])) continue;
      const up = cy[b] >= cy[a] ? b : a, low = up === b ? a : b;
      const need = cy[low] + 7.5 - cy[up];
      if (need > 0) {
        const W = Math.round(260 / step);
        for (let o = -W; o <= W; o++) cy[(up + o + N) % N] += need * 0.5 * (1 + Math.cos(Math.PI * o / W));
      }
      bridges.push({ up, low });
    }
  }

  // 3. Repères : tangente et normale gauche
  const tx = new Float64Array(N), tz = new Float64Array(N), nx = new Float64Array(N), nz = new Float64Array(N);
  for (let i = 0; i < N; i++) {
    const a = (i - 1 + N) % N, b = (i + 1) % N;
    const dx = cx[b] - cx[a], dz = cz[b] - cz[a], l = Math.hypot(dx, dz) || 1;
    tx[i] = dx / l; tz[i] = dz / l; nx[i] = tz[i]; nz[i] = -tx[i];
  }

  // 4. Trajectoire à courbure minimale (bande élastique multi-échelle, bornée par la largeur de piste)
  const width = def.width;
  const emax = Math.max(0.3, width / 2 - carWidth / 2 - 0.25);
  const e = new Float64Array(N);
  const px = new Float64Array(N), pz = new Float64Array(N);
  const upd = () => { for (let i = 0; i < N; i++) { px[i] = cx[i] + e[i] * nx[i]; pz[i] = cz[i] + e[i] * nz[i]; } };
  upd();
  // Minimisation de Σ|p(i+1) − 2p(i) + p(i−1)|² (courbure) par Gauss-Seidel multi-échelle :
  // point cible = (4(p[i−k] + p[i+k]) − (p[i−2k] + p[i+2k])) / 6, projeté sur la normale et borné.
  for (const [k, iters] of [[48, 150], [32, 150], [20, 200], [12, 250], [8, 300], [5, 300], [3, 300], [2, 300], [1, 400]]) {
    for (let it = 0; it < iters; it++) {
      for (let i = 0; i < N; i++) {
        const a = (i - k + N) % N, b = (i + k) % N, a2 = (i - 2 * k + N) % N, b2 = (i + 2 * k) % N;
        const mx = (4 * (px[a] + px[b]) - (px[a2] + px[b2])) / 6, mz = (4 * (pz[a] + pz[b]) - (pz[a2] + pz[b2])) / 6;
        let ne = (mx - cx[i]) * nx[i] + (mz - cz[i]) * nz[i];
        ne = Math.max(-emax, Math.min(emax, ne));
        e[i] += 0.9 * (ne - e[i]);
        px[i] = cx[i] + e[i] * nx[i]; pz[i] = cz[i] + e[i] * nz[i];
      }
    }
  }
  const off = gauss(e, 1.2);
  for (let i = 0; i < N; i++) off[i] = Math.max(-emax, Math.min(emax, off[i]));
  for (let i = 0; i < N; i++) { px[i] = cx[i] + off[i] * nx[i]; pz[i] = cz[i] + off[i] * nz[i]; }
  // Dévers signé (rad, + = piste inclinée vers la gauche) : toujours vers l'intérieur du virage.
  // Le sens du virage est pris sur la courbure large de la ligne médiane.
  const bank = new Float64Array(N);
  {
    const kc = new Float64Array(N);
    for (let i = 0; i < N; i++) { const a = (i - 4 + N) % N, b = (i + 4) % N; kc[i] = (tx[a] * tz[b] - tz[a] * tx[b]) * -1; }
    const kw = gauss(kc, 12);
    for (let i = 0; i < N; i++) bank[i] = cb[i] * Math.PI / 180 * (kw[i] >= 0 ? 1 : -1);
  }
  // hauteur de la trajectoire : centre de piste corrigé du dévers à l'écart latéral
  const py = new Float64Array(N);
  for (let i = 0; i < N; i++) py[i] = cy[i] - off[i] * Math.tan(bank[i]);

  // 5. Longueurs de segments (3D), courbure signée (+ = gauche), pente, courbure verticale
  const rds = new Float64Array(N), rs = new Float64Array(N + 1);
  for (let i = 0; i < N; i++) {
    const b = (i + 1) % N;
    rds[i] = Math.hypot(px[b] - px[i], pz[b] - pz[i], py[b] - py[i]);
    rs[i + 1] = rs[i] + rds[i];
  }
  const kap = new Float64Array(N);
  const K = 2;
  for (let i = 0; i < N; i++) {
    const a = (i - K + N) % N, b = (i + K) % N;
    const ax = px[a], az = pz[a], bx = px[i], bz = pz[i], qx = px[b], qz = pz[b];
    const cross = (bx - ax) * (qz - az) - (bz - az) * (qx - ax); // signe : z = -nord
    const la = Math.hypot(bx - ax, bz - az), lb = Math.hypot(qx - bx, qz - bz), lc = Math.hypot(qx - ax, qz - az);
    kap[i] = -2 * cross / (la * lb * lc + 1e-9);
  }
  const kappa = gauss(kap, 3);   // σ = 15 m, calibré sur les temps réels
  const gr = new Float64Array(N), vc = new Float64Array(N);
  for (let i = 0; i < N; i++) {
    const a = (i - 1 + N) % N, b = (i + 1) % N;
    gr[i] = (py[b] - py[a]) / (rds[a] + rds[i]);
  }
  const grade = gauss(gr, 2.5);
  for (let i = 0; i < N; i++) {
    const a = (i - 1 + N) % N, b = (i + 1) % N;
    vc[i] = (grade[b] - grade[a]) / (rds[a] + rds[i]);
  }
  const kv = gauss(vc, 3);
  for (let i = 0; i < N; i++) kv[i] = Math.max(-0.006, Math.min(0.006, kv[i]));
  // cap de la trajectoire (pour le vent)
  const hx = new Float64Array(N), hz = new Float64Array(N);
  for (let i = 0; i < N; i++) {
    const a = (i - 1 + N) % N, b = (i + 1) % N;
    const dx = px[b] - px[a], dz = pz[b] - pz[a], l = Math.hypot(dx, dz) || 1;
    hx[i] = dx / l; hz[i] = dz / l;
  }

  // tunnels : points de la ligne médiane à moins de 12 m d'un tracé de tunnel
  const tunnel = new Uint8Array(N);
  for (const tl of def.tunnels || []) {
    for (let i = 0; i < N; i++) {
      for (let k = 0; k < tl.length - 1; k++) {
        const [ax, az] = tl[k], [bx, bz] = tl[k + 1];
        const vx = bx - ax, vz = bz - az, L2 = vx * vx + vz * vz || 1;
        const u = Math.max(0, Math.min(1, ((cx[i] - ax) * vx + (cz[i] - az) * vz) / L2));
        if (Math.hypot(cx[i] - ax - u * vx, cz[i] - az - u * vz) < 12) { tunnel[i] = 1; break; }
      }
    }
  }

  let ymin = Infinity, ymax = -Infinity;
  for (let i = 0; i < N; i++) { ymin = Math.min(ymin, cy[i]); ymax = Math.max(ymax, cy[i]); }

  return {
    def, N, step, width, emax, bridges,
    cx, cz, cy, tx, tz, nx, nz,
    off, px, pz, py, rds, rs, length: rs[N], centerLength: total,
    kappa, grade, kv, hx, hz, ymin, ymax, bank, tunnel,
  };
}
