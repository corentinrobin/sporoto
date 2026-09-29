// Sporoto — géométrie des voitures (profils latéraux en mètres), partagée par les vues 2D (SVG) et 3D (extrusions).
// Repère du profil : x = longitudinal (0 = arrière de la voiture, vers l'avant), y = hauteur au-dessus du sol.

// Contour avec passages de roues : bas de caisse à yb, arches (rayon r + jeu) autour des roues, puis ligne haute
function withArches(top, yb, axles, gap = 0.05) {
  // top : points [x, y] de l'avant vers l'arrière ; le bas va de l'arrière vers l'avant
  const xr = top[top.length - 1][0], xf = top[0][0];
  const pts = [[xr, yb]];
  for (const a of [...axles].sort((p, q) => p.x - q.x)) {
    const R = a.r + gap, dy = a.r - yb, dx = Math.sqrt(Math.max(0, R * R - dy * dy));
    const tr = Math.atan2(yb - a.r, -dx) + 2 * Math.PI, tf = Math.atan2(yb - a.r, dx);
    for (let k = 0; k <= 14; k++) { const th = tr + (tf - tr) * k / 14; pts.push([a.x + Math.cos(th) * R, a.r + Math.sin(th) * R]); }
  }
  pts.push([xf, yb]);
  return pts.concat(top);
}

// Profil d'aile (corde 1, épaisseur relative e, cambrure c) : liste de points fermée
export function airfoil(e = 0.12, c = 0.06, n = 10) {
  const up = [], lo = [];
  for (let k = 0; k <= n; k++) {
    const x = 1 - k / n, t = 5 * e * (0.2969 * Math.sqrt(x) - 0.126 * x - 0.3516 * x * x + 0.2843 * x ** 3 - 0.1036 * x ** 4);
    const yc = c * 4 * x * (1 - x);
    up.push([x, yc + t]); lo.unshift([x, yc - t]);
  }
  return up.concat(lo.slice(1));
}

const OPEN = (o) => {
  const L = o.len, xr = o.xr, xf = xr + o.wb, r = o.r, rr = o.rr || r;
  return {
    family: 'open', len: L, wb: o.wb, xr, xf, rF: r, rR: rr, wF: o.wF, wR: o.wR, track: o.track, width: o.width,
    // monocoque, nez, capot moteur (largeur o.bodyW)
    body: [[0.25, 0.30], [0.32, 0.09], [1.3, 0.06], [xf + 0.2, 0.08], [L - 0.06, o.noseLow], [L, o.noseLow + 0.07],
      [L - 0.2, o.noseLow + 0.15], [xf + 0.15, o.cockpitY - 0.12], [xf - 0.75, o.cockpitY], [o.xHead + 0.3, o.cockpitY + 0.03],
      [o.xHead - 0.05, o.cockpitY + 0.05], [o.xHead - 0.3, o.airbox], [o.xHead - 0.55, o.airbox + 0.01], [o.xHead - 0.75, o.airbox - 0.12],
      [1.3, 0.62], [0.55, 0.46]],
    bodyW: o.bodyW,
    // pontons
    pods: [[xr + 0.25, 0.12], [xf - 1.15, 0.12], [xf - 1.15, 0.52], [xf - 1.4, 0.6], [xr + 0.9, 0.46], [xr + 0.3, 0.3]], podsW: o.podsW,
    floor: { x0: 0.3, x1: xf - 0.6, y: 0.045, w: o.width - 0.1 },
    head: { x: o.xHead, y: o.cockpitY + 0.16, r: 0.125 },
    frontWing: { x: L - 0.55, y: 0.09, chord: 0.5, span: o.width - 0.05, elems: o.fwElems },
    rearWing: { x: 0.02, y: o.rwY, chord: 0.52, span: o.rwSpan, elems: 2, plateH: o.rwY - 0.3 },
    beamWing: o.beam,
    halo: o.halo,
  };
};

const CLOSED = (o) => {
  const L = o.len, xr = o.xr, xf = xr + o.wb, r = o.r;
  const axles = [{ x: xr, r }, { x: xf, r }];
  return {
    family: o.family, len: L, wb: o.wb, xr, xf, rF: r, rR: r, wF: o.wF, wR: o.wR, track: o.track, width: o.width,
    body: withArches(o.top, o.yb, axles), bodyW: o.width,
    cabin: o.cabin, cabinW: o.cabinW,
    glass: o.glass,
    fin: o.fin,
    rearWing: o.rearWing,
    splitter: { x0: L - 0.25, x1: L + 0.03, y: o.yb + 0.01 },
    lightsF: o.lightsF, lightsR: o.lightsR,
  };
};

export const SHAPES = {
  F1: OPEN({ len: 5.6, wb: 3.6, xr: 0.95, r: 0.36, wF: 0.305, wR: 0.405, track: 1.6, width: 2.0, bodyW: 0.62, podsW: 1.55, xHead: 3.05,
    cockpitY: 0.66, airbox: 0.98, noseLow: 0.14, fwElems: 4, rwY: 0.93, rwSpan: 1.0, beam: true, halo: true }),
  F2: OPEN({ len: 5.22, wb: 3.135, xr: 0.9, r: 0.36, wF: 0.3, wR: 0.38, track: 1.52, width: 1.9, bodyW: 0.6, podsW: 1.45, xHead: 2.75,
    cockpitY: 0.68, airbox: 1.05, noseLow: 0.18, fwElems: 3, rwY: 0.98, rwSpan: 0.95, beam: false, halo: true }),
  F3: OPEN({ len: 4.97, wb: 2.9, xr: 0.85, r: 0.33, wF: 0.27, wR: 0.34, track: 1.5, width: 1.885, bodyW: 0.58, podsW: 1.35, xHead: 2.55,
    cockpitY: 0.66, airbox: 1.0, noseLow: 0.19, fwElems: 2, rwY: 0.95, rwSpan: 0.9, beam: false, halo: true }),
  HYPERCAR: CLOSED({ family: 'proto', len: 5.1, wb: 3.15, xr: 0.95, r: 0.355, wF: 0.31, wR: 0.34, track: 1.7, width: 2.0, yb: 0.08,
    top: [[5.1, 0.24], [4.95, 0.42], [4.55, 0.62], [4.3, 0.8], [4.1, 0.83], [3.85, 0.8], [3.6, 0.72], [3.3, 0.76], [1.8, 0.82], [1.2, 0.86], [0.55, 0.82], [0.05, 0.72], [0, 0.4]],
    cabin: [[3.65, 0.72], [3.0, 1.02], [2.2, 1.07], [1.75, 0.98], [1.5, 0.8]], cabinW: 1.25,
    glass: [[3.58, 0.74], [3.02, 0.99], [2.6, 1.0], [2.75, 0.76]],
    fin: [[2.1, 1.0], [0.55, 0.98], [0.35, 1.0], [0.55, 0.82], [1.8, 0.84]],
    rearWing: { x: 0.0, y: 1.02, chord: 0.45, span: 1.9, pylons: 'swan' },
    lightsF: { x: 4.62, y: 0.6, w: 0.35 }, lightsR: { x: 0.02, y: 0.66 } }),
  LMP2: CLOSED({ family: 'proto', len: 4.75, wb: 3.005, xr: 0.85, r: 0.345, wF: 0.3, wR: 0.33, track: 1.66, width: 1.9, yb: 0.08,
    top: [[4.75, 0.22], [4.6, 0.4], [4.25, 0.6], [4.05, 0.78], [3.85, 0.8], [3.6, 0.76], [3.3, 0.68], [3.1, 0.7], [1.7, 0.78], [1.1, 0.82], [0.5, 0.8], [0.05, 0.72], [0, 0.4]],
    cabin: [[3.4, 0.68], [2.85, 1.0], [2.05, 1.045], [1.65, 0.95], [1.4, 0.78]], cabinW: 1.2,
    glass: [[3.33, 0.7], [2.87, 0.97], [2.45, 0.98], [2.6, 0.72]],
    fin: [[1.95, 0.98], [0.5, 0.97], [0.3, 1.0], [0.5, 0.8], [1.7, 0.8]],
    rearWing: { x: 0.0, y: 1.0, chord: 0.42, span: 1.8, pylons: 'swan' },
    lightsF: { x: 4.3, y: 0.58, w: 0.3 }, lightsR: { x: 0.02, y: 0.64 } }),
  LMP3: CLOSED({ family: 'proto', len: 4.6, wb: 2.85, xr: 0.85, r: 0.34, wF: 0.29, wR: 0.32, track: 1.64, width: 1.9, yb: 0.09,
    top: [[4.6, 0.26], [4.45, 0.46], [4.1, 0.64], [3.9, 0.78], [3.7, 0.8], [3.45, 0.76], [3.3, 0.7], [2.9, 0.74], [1.6, 0.8], [1.0, 0.84], [0.45, 0.82], [0.05, 0.74], [0, 0.42]],
    cabin: [[3.25, 0.72], [2.7, 1.02], [1.95, 1.05], [1.55, 0.96], [1.35, 0.8]], cabinW: 1.22,
    glass: [[3.18, 0.74], [2.72, 0.99], [2.3, 1.0], [2.45, 0.76]],
    fin: [[1.85, 1.0], [0.6, 0.98], [0.45, 1.0], [0.6, 0.82], [1.6, 0.82]],
    rearWing: { x: 0.02, y: 0.98, chord: 0.4, span: 1.75, pylons: 'plates' },
    lightsF: { x: 4.15, y: 0.62, w: 0.28 }, lightsR: { x: 0.02, y: 0.66 } }),
  GT3: CLOSED({ family: 'gt', len: 4.65, wb: 2.65, xr: 0.95, r: 0.35, wF: 0.3, wR: 0.33, track: 1.7, width: 2.04, yb: 0.1,
    top: [[4.65, 0.3], [4.6, 0.52], [4.35, 0.7], [3.6, 0.83], [3.2, 0.84], [2.5, 1.2], [1.6, 1.25], [0.9, 1.05], [0.35, 0.96], [0.05, 0.9], [0, 0.45]],
    cabin: null, cabinW: 0,
    glass: [[3.12, 0.86], [2.5, 1.17], [2.2, 1.18], [2.35, 0.92]],
    side: [[2.3, 0.92], [2.2, 1.16], [1.65, 1.2], [1.1, 1.0]],
    rearWing: { x: 0.05, y: 1.32, chord: 0.38, span: 1.9, pylons: 'swan' },
    lightsF: { x: 4.4, y: 0.66, w: 0.4 }, lightsR: { x: 0.03, y: 0.8 } }),
};
SHAPES.LIBRE = { ...SHAPES.HYPERCAR, family: 'proto' };
