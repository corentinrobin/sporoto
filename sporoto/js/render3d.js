// Sporoto — rendu 3D (three.js local). Le rendu est volontairement simple : l'essentiel est la physique.
import * as THREE from './lib/three.module.js';
import { TERRAIN } from './data/terrain.js';
import { CarModel } from './car3d.js';

const SURF_COLORS = { asphalt: 0x3b3f45, ice: 0xcfe6f2, dirt: 0x8a6440, grass: 0x4f8a3a };
// Décor par circuit : végétation (densité, essence), sol, bâti, gradins. Sans information fiable : pas de décor.
//  trees : densité 0..1 ; kind : 'conifer' | 'broad' | 'mixed' ; ground : couleur du sol ; city : immeubles le long du tracé ;
//  stands : 'straight' (gradins face aux stands sur la ligne droite de départ) | 'oval' (gradins tout autour, côté extérieur) | null
const THEMES = {
  spa: { trees: 1, kind: 'conifer', stands: 'straight' },
  nordschleife: { trees: 1, kind: 'conifer', stands: 'straight' },
  nurburgring: { trees: 0.7, kind: 'conifer', stands: 'straight' },
  watkinsglen: { trees: 0.9, kind: 'mixed', stands: 'straight' },
  mugello: { trees: 0.6, kind: 'mixed', stands: 'straight' },
  brandshatch: { trees: 0.7, kind: 'broad', stands: 'straight' },
  lemans: { trees: 0.7, kind: 'mixed', stands: 'straight' },
  monza: { trees: 0.8, kind: 'broad', stands: 'straight' },
  imola: { trees: 0.5, kind: 'broad', stands: 'straight' },
  montreal: { trees: 0.6, kind: 'broad', stands: 'straight' },
  suzuka: { trees: 0.5, kind: 'mixed', stands: 'straight' },
  redbullring: { trees: 0.35, kind: 'conifer', stands: 'straight' },
  silverstone: { trees: 0.15, kind: 'broad', stands: 'straight' },
  hungaroring: { trees: 0.2, kind: 'broad', stands: 'straight', ground: 0x7d8f4e },
  barcelona: { trees: 0.15, kind: 'broad', stands: 'straight', ground: 0x8c9459 },
  portimao: { trees: 0.1, kind: 'broad', stands: 'straight', ground: 0x9a9660 },
  cota: { trees: 0.03, kind: 'broad', stands: 'straight', ground: 0x7f9a4e },
  interlagos: { trees: 0.15, kind: 'broad', stands: 'straight', city: 'suburb' },
  mexico: { trees: 0.25, kind: 'broad', stands: 'straight', city: 'suburb' },
  monaco: { trees: 0.03, kind: 'broad', stands: null, city: 'dense', ground: 0x9a968c },
  zandvoort: { trees: 0.05, kind: 'conifer', stands: 'straight', ground: 0xc9bd8e },
  bahrain: { trees: 0, kind: 'broad', stands: 'straight', ground: 0xcdb183 },
  indyoval: { trees: 0.05, kind: 'broad', stands: 'oval' },
  indyroad: { trees: 0.05, kind: 'broad', stands: 'straight' },
};

const CAR_COLORS = { F1: 0xe8202a, F2: 0x1e6fff, F3: 0xf2f2f2, HYPERCAR: 0xff3b2f, LMP2: 0x1ec8ff, LMP3: 0xffb627, GT3: 0x2ee88c, LIBRE: 0xb37bff };

function noiseTexture(base, amp, size = 256, lines = false) {
  const cv = document.createElement('canvas'); cv.width = cv.height = size;
  const g = cv.getContext('2d');
  const cr = (base >> 16) & 255, cg = (base >> 8) & 255, cb = base & 255;
  const img = g.createImageData(size, size);
  for (let i = 0; i < size * size; i++) {
    const n = (Math.random() - 0.5) * amp;
    img.data[i * 4] = Math.max(0, Math.min(255, cr + n));
    img.data[i * 4 + 1] = Math.max(0, Math.min(255, cg + n));
    img.data[i * 4 + 2] = Math.max(0, Math.min(255, cb + n));
    img.data[i * 4 + 3] = 255;
  }
  g.putImageData(img, 0, 0);
  if (lines) {
    g.fillStyle = 'rgba(255,255,255,0.85)';
    g.fillRect(0, 0, 5, size); g.fillRect(size - 5, 0, 5, size);
  }
  const tex = new THREE.CanvasTexture(cv);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  return tex;
}

export class Renderer3D {
  constructor(container) {
    this.container = container;
    this.renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    container.appendChild(this.renderer.domElement);
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(60, 1, 0.3, 30000);
    this.camMode = 'chase';
    this.camPos = new THREE.Vector3(); this.camLook = new THREE.Vector3();
    this.resize = this.resize.bind(this);
    window.addEventListener('resize', this.resize);
    this.resize();
    this.bindOrbit();
  }

  resize() {
    const w = this.container.clientWidth || window.innerWidth, h = this.container.clientHeight || window.innerHeight;
    this.renderer.setSize(w, h);
    this.camera.aspect = w / h; this.camera.updateProjectionMatrix();
  }

  dispose() {
    window.removeEventListener('resize', this.resize);
    this.scene.traverse(o => { if (o.geometry) o.geometry.dispose(); if (o.material) [].concat(o.material).forEach(m => { if (m.map) m.map.dispose(); m.dispose(); }); });
    this.renderer.dispose();
    this.renderer.domElement.remove();
  }

  build(tr, cfg) {
    const S = this.scene, env = cfg.env;
    this.tr = tr; this.cfg = cfg;
    const night = env.night, rain = env.weather === 'rain', snow = env.weather === 'snow';
    // Ciel et brouillard
    const sky = night ? 0x070b16 : rain ? 0x7d8792 : snow ? 0xc9d2dc : 0x8fbbe6;
    S.background = new THREE.Color(sky);
    S.fog = this.fog = new THREE.Fog(sky, rain || snow ? 60 : 300, rain || snow ? 900 : night ? 2200 : 5000);
    this.renderer.toneMappingExposure = night ? 1.25 : 1.0;
    // Lumières
    const hemi = new THREE.HemisphereLight(night ? 0x28324a : 0xdfeeff, night ? 0x0a0c10 : 0x4a5a3a, night ? 0.35 : rain ? 1.2 : 1.5);
    S.add(hemi);
    const sun = this.sun = new THREE.DirectionalLight(night ? 0x8fa6d8 : 0xfff2dd, night ? 0.25 : rain || snow ? 0.8 : 2.2);
    sun.position.set(300, 500, 200); sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    const sc = sun.shadow.camera; sc.left = -60; sc.right = 60; sc.top = 60; sc.bottom = -60; sc.near = 10; sc.far = 1500;
    sun.shadow.bias = -0.0005;
    S.add(sun); S.add(sun.target);

    this.buildTerrain(tr, cfg);
    this.buildTrack(tr, cfg);
    this.buildScenery(tr, cfg);
    this.buildTunnels(tr, cfg);
    this.buildLandmarks(tr, cfg);
    this.buildCar(cfg);
    this.buildWeather(env);
    if (night) this.buildNight(tr);
  }

  // Hauteur du terrain (grille réelle ré-échantillonnée), aplani au voisinage de la piste
  buildTerrain(tr, cfg) {
    const T = TERRAIN[tr.def.id];
    const N = tr.N;
    // index spatial de la ligne médiane
    const cell = 50, grid = new Map();
    const key = (i, j) => i * 100003 + j;
    for (let i = 0; i < N; i++) {
      const k = key(Math.floor(tr.cx[i] / cell), Math.floor(tr.cz[i] / cell));
      if (!grid.has(k)) grid.set(k, []); grid.get(k).push(i);
    }
    // hauteur maximale autorisée pour le relief : sous toutes les portions de piste à moins de « reach » m
    this.capBelowTrack = (x, z, h, reach) => {
      const ci = Math.floor(x / cell), cj = Math.floor(z / cell), r = Math.ceil(reach / cell);
      for (let a = -r; a <= r; a++) for (let b = -r; b <= r; b++) {
        const l = grid.get(key(ci + a, cj + b)); if (!l) continue;
        for (const i of l) {
          const d = Math.hypot(tr.cx[i] - x, tr.cz[i] - z);
          if (d < reach) h = Math.min(h, tr.cy[i] - 0.5 - (tr.width / 2) * Math.abs(Math.tan(tr.bank ? tr.bank[i] : 0)) - Math.max(0, d - tr.width / 2) * 0.03);
        }
      }
      return h;
    };
    this.nearest = (x, z, r = 2) => {
      const ci = Math.floor(x / cell), cj = Math.floor(z / cell);
      let best = Infinity, bi = -1;
      for (let a = -r; a <= r; a++) for (let b = -r; b <= r; b++) {
        const l = grid.get(key(ci + a, cj + b)); if (!l) continue;
        for (const i of l) { const d = (tr.cx[i] - x) ** 2 + (tr.cz[i] - z) ** 2; if (d < best) { best = d; bi = i; } }
      }
      return [Math.sqrt(best), bi];
    };
    const hw = tr.width / 2;
    const raw = (x, z) => {
      if (!T) return null;
      const fx = (x - T.x0) / (T.x1 - T.x0) * (T.n - 1), fz = (z - T.z0) / (T.z1 - T.z0) * (T.n - 1);
      const i = Math.max(0, Math.min(T.n - 2, Math.floor(fx))), j = Math.max(0, Math.min(T.n - 2, Math.floor(fz)));
      const u = Math.max(0, Math.min(1, fx - i)), v = Math.max(0, Math.min(1, fz - j));
      const h = (a, b) => { const q = T.h[b * T.n + a]; return q == null ? -8 : q; };
      return h(i, j) * (1 - u) * (1 - v) + h(i + 1, j) * u * (1 - v) + h(i, j + 1) * (1 - u) * v + h(i + 1, j + 1) * u * v;
    };
    let x0, x1, z0, z1;
    if (T) { x0 = T.x0; x1 = T.x1; z0 = T.z0; z1 = T.z1; }
    else { x0 = Math.min(...tr.cx) - 800; x1 = Math.max(...tr.cx) + 800; z0 = Math.min(...tr.cz) - 800; z1 = Math.max(...tr.cz) + 800; }
    // maillage assez fin pour qu'aucun triangle du relief ne traverse la piste
    const R = Math.round(Math.max(220, Math.min(420, Math.max(x1 - x0, z1 - z0) / 14)));
    const FL = Math.max(x1 - x0, z1 - z0) / R * 1.5 + 4;
    const geo = new THREE.PlaneGeometry(x1 - x0, z1 - z0, R, R);
    geo.rotateX(-Math.PI / 2);
    geo.translate((x0 + x1) / 2, 0, (z0 + z1) / 2);
    const pos = geo.attributes.position;
    const colors = new Float32Array(pos.count * 3);
    const th = THEMES[tr.def.id] || {};
    const cGrass = new THREE.Color(cfg.env.weather === 'snow' ? 0xe8eef3 : th.ground || 0x4d7a36), cHigh = new THREE.Color(cfg.env.weather === 'snow' ? 0xf5f8fb : th.ground ? th.ground : 0x6f7f4a), cWater = new THREE.Color(0x1f4f78);
    const hasSea = T && T.h.some(v => v == null);
    let hmin = Infinity;
    for (let k = 0; k < pos.count; k++) {
      const x = pos.getX(k), z = pos.getZ(k);
      let h = raw(x, z); if (h == null) h = tr.ymin - 2;
      const [d, i] = this.nearest(x, z, 3);
      if (i >= 0 && d < hw + FL + 70) {
        const f = Math.max(0, Math.min(1, (d - hw - FL) / 70));
        const s = f * f * (3 - 2 * f);
        h = (tr.cy[i] - 0.5 - hw * Math.abs(Math.tan(tr.bank ? tr.bank[i] : 0)) - Math.max(0, d - hw) * 0.015) * (1 - s) + h * s;
        h = this.capBelowTrack(x, z, h, hw + FL);
      }
      pos.setY(k, h); hmin = Math.min(hmin, h);
      const c = h < -3 && hasSea ? cWater : cGrass.clone().lerp(cHigh, Math.max(0, Math.min(1, (h - tr.ymin) / (tr.ymax - tr.ymin + 30))));
      const jit = 0.94 + Math.random() * 0.1;
      colors[k * 3] = c.r * jit; colors[k * 3 + 1] = c.g * jit; colors[k * 3 + 2] = c.b * jit;
    }
    geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    geo.computeVertexNormals();
    const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.95, metalness: 0 });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.receiveShadow = true;
    this.scene.add(mesh);
    this.rawHeight = raw;
    this.terrainHeight = (x, z) => {
      let h = raw(x, z); if (h == null) h = tr.ymin - 2;
      const [d, i] = this.nearest(x, z, 3);
      if (i >= 0 && d < hw + FL + 70) { const f = Math.max(0, Math.min(1, (d - hw - FL) / 70)); const s = f * f * (3 - 2 * f); h = (tr.cy[i] - 0.5 - hw * Math.abs(Math.tan(tr.bank ? tr.bank[i] : 0))) * (1 - s) + h * s; h = this.capBelowTrack(x, z, h, hw + FL); }
      return h;
    };
    if (hasSea) {
      const w = new THREE.Mesh(new THREE.PlaneGeometry(40000, 40000), new THREE.MeshStandardMaterial({ color: 0x1d4a70, roughness: 0.3, metalness: 0.1 }));
      w.rotation.x = -Math.PI / 2; w.position.y = -3.5; this.scene.add(w);
    }
    // sol lointain
    const far = new THREE.Mesh(new THREE.PlaneGeometry(60000, 60000), new THREE.MeshStandardMaterial({ color: cGrass.clone().multiplyScalar(0.8), roughness: 1 }));
    far.rotation.x = -Math.PI / 2; far.position.y = hmin - 4; this.scene.add(far);
  }

  buildTrack(tr, cfg) {
    const N = tr.N, hw = tr.width / 2, env = cfg.env;
    const surf = env.surface;
    const wet = env.weather === 'rain';
    const baseCol = SURF_COLORS[surf];
    const tex = noiseTexture(wet && surf === 'asphalt' ? 0x2c2f33 : baseCol, surf === 'ice' ? 18 : 34, 256, surf === 'asphalt');
    tex.repeat.set(1, 1);
    const kerbW = 1.2;
    // ruban de piste
    const pos = [], uv = [], idx = [];
    for (let i = 0; i <= N; i++) {
      const k = i % N;
      const y = tr.cy[k] + 0.02, tb = hw * Math.tan(tr.bank ? tr.bank[k] : 0);   // dévers : bord gauche abaissé si > 0
      pos.push(tr.cx[k] + tr.nx[k] * hw, y - tb, tr.cz[k] + tr.nz[k] * hw);
      pos.push(tr.cx[k] - tr.nx[k] * hw, y + tb, tr.cz[k] - tr.nz[k] * hw);
      const v = i * tr.step / (tr.width * 1.2);
      uv.push(0, v, 1, v);
      if (i < N) { const a = i * 2; idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); }
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    geo.setIndex(idx); geo.computeVertexNormals();
    const mat = new THREE.MeshStandardMaterial({
      map: tex, roughness: surf === 'ice' ? 0.12 : wet ? 0.28 : surf === 'asphalt' ? 0.88 : 1, metalness: surf === 'ice' ? 0.15 : wet ? 0.25 : 0,
      color: env.weather === 'snow' && surf === 'asphalt' ? 0xdfe6ec : 0xffffff,
      polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2,
    });
    const mesh = new THREE.Mesh(geo, mat); mesh.receiveShadow = true; this.scene.add(mesh);
    // vibreurs aux virages (courbure de la ligne médiane)
    const kp = [], kc = [], ki = [];
    let vcount = 0;
    const red = new THREE.Color(0xd8262a), white = new THREE.Color(0xf2f2f2);
    for (let side = -1; side <= 1; side += 2) {
      let run = false;
      for (let i = 0; i <= N; i++) {
        const k = i % N;
        const on = Math.abs(tr.kappa[k]) > 1 / 220;
        if (on) {
          const y = tr.cy[k] + 0.04;
          const o1 = hw * side, o2 = (hw + kerbW) * side;
          kp.push(tr.cx[k] + tr.nx[k] * o1, y, tr.cz[k] + tr.nz[k] * o1, tr.cx[k] + tr.nx[k] * o2, y + 0.05, tr.cz[k] + tr.nz[k] * o2);
          const c = Math.floor(i * tr.step / 3) % 2 ? red : white;
          kc.push(c.r, c.g, c.b, c.r, c.g, c.b);
          if (run) { const a = vcount - 2; ki.push(a, a + 2, a + 1, a + 1, a + 2, a + 3); }
          vcount += 2; run = true;
        } else run = false;
      }
    }
    const kg = new THREE.BufferGeometry();
    kg.setAttribute('position', new THREE.Float32BufferAttribute(kp, 3));
    kg.setAttribute('color', new THREE.Float32BufferAttribute(kc, 3));
    kg.setIndex(ki); kg.computeVertexNormals();
    this.scene.add(new THREE.Mesh(kg, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.7, side: THREE.DoubleSide })));
    // ligne de départ (damier) : quadrilatère posé sur la piste, perpendiculaire au tracé au point 0
    {
      const cv = document.createElement('canvas'); cv.width = 128; cv.height = 8;
      const g = cv.getContext('2d');
      for (let a = 0; a < 32; a++) for (let b = 0; b < 2; b++) { g.fillStyle = (a + b) % 2 ? '#111' : '#fff'; g.fillRect(a * 4, b * 4, 4, 4); }
      const ct = new THREE.CanvasTexture(cv); ct.magFilter = THREE.NearestFilter; ct.colorSpace = THREE.SRGBColorSpace;
      const i0 = 0, cx = tr.cx[i0], cz = tr.cz[i0], nx = tr.nx[i0], nz = tr.nz[i0], tx = tr.tx[i0], tz = tr.tz[i0];
      const tb = hw * Math.tan(tr.bank ? tr.bank[i0] : 0), y = tr.cy[i0] + 0.06, L = 0.9;
      const P = (e, l, dy) => [cx + nx * e + tx * l, y + dy, cz + nz * e + tz * l];
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.Float32BufferAttribute([...P(hw, -L, -tb), ...P(-hw, -L, tb), ...P(hw, L, -tb), ...P(-hw, L, tb)], 3));
      geo.setAttribute('uv', new THREE.Float32BufferAttribute([0, 0, 1, 0, 0, 1, 1, 1], 2));
      geo.setIndex([0, 1, 2, 1, 3, 2]); geo.computeVertexNormals();
      this.scene.add(new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ map: ct, roughness: 0.8, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4 })));
      // portique : poutre dans l'axe de la normale (en travers de la piste)
      const gm = new THREE.MeshStandardMaterial({ color: 0x20252d, roughness: 0.6, metalness: 0.4 });
      const gantry = new THREE.Group();
      const postL = new THREE.Mesh(new THREE.BoxGeometry(0.6, 8, 0.6), gm), postR = postL.clone();
      postL.position.set(hw + 1.5, 4, 0); postR.position.set(-hw - 1.5, 4, 0);
      const beam = new THREE.Mesh(new THREE.BoxGeometry(tr.width + 4, 1.4, 0.8), new THREE.MeshStandardMaterial({ color: 0xff3b2f, emissive: 0x551010, roughness: 0.5 }));
      beam.position.y = 8;
      gantry.add(postL, postR, beam);
      gantry.position.set(cx, tr.cy[i0], cz);
      gantry.rotation.y = Math.atan2(-nz, nx);          // axe x local → normale de la piste
      gantry.traverse(o => { if (o.isMesh) o.castShadow = true; });
      this.scene.add(gantry);
    }
    // ruban de trajectoire (coloré à chaque tour par les phases gaz / frein)
    const rp = [], rc = [], ri = [];
    for (let i = 0; i <= N; i++) {
      const k = i % N, w = 0.18, y = tr.py[k] + 0.07;
      const hx = tr.hx[k], hz = tr.hz[k];
      rp.push(tr.px[k] + hz * w, y, tr.pz[k] - hx * w, tr.px[k] - hz * w, y, tr.pz[k] + hx * w);
      rc.push(0.2, 0.9, 0.5, 0.2, 0.9, 0.5);
      if (i < N) { const a = i * 2; ri.push(a, a + 2, a + 1, a + 1, a + 2, a + 3); }
    }
    const rg = new THREE.BufferGeometry();
    rg.setAttribute('position', new THREE.Float32BufferAttribute(rp, 3));
    this.lineColors = new THREE.Float32BufferAttribute(rc, 3);
    rg.setAttribute('color', this.lineColors);
    rg.setIndex(ri);
    this.lineMesh = new THREE.Mesh(rg, new THREE.MeshBasicMaterial({ vertexColors: true, transparent: true, opacity: 0.55, side: THREE.DoubleSide, depthWrite: false }));
    this.scene.add(this.lineMesh);
  }

  // Colore la trajectoire : vert = gaz, rouge = freinage, jaune = transition
  colorLine(trace) {
    const N = this.tr.N, c = this.lineColors.array;
    for (let i = 0; i <= N; i++) {
      const k = i % N;
      let r = 1, g = 0.85, b = 0.2;
      if (trace.brk[k] > 0.05) { r = 1; g = 0.18; b = 0.15; }
      else if (trace.thr[k] > 0.97) { r = 0.18; g = 0.95; b = 0.5; }
      c.set([r, g, b, r, g, b], i * 6);
    }
    this.lineColors.needsUpdate = true;
  }

  // Éléments remarquables : passerelle du Mans (ex-Dunlop, aujourd'hui Goodyear), arche en forme de pneu au-dessus de la piste
  buildLandmarks(tr, cfg) {
    for (const lm of tr.def.landmarks || []) {
      if (lm.type !== 'dunlop') continue;
      const [ax, az] = lm.a, [bx, bz] = lm.b;
      const mx = (ax + bx) / 2, mz = (az + bz) / 2;
      const [, i] = this.nearest(mx, mz, 3);
      const y0 = tr.cy[i];
      const span = Math.hypot(bx - ax, bz - az);
      const X = new THREE.Vector3(bx - ax, 0, bz - az).normalize(), Y = new THREE.Vector3(0, 1, 0);
      const Z = new THREE.Vector3().crossVectors(X, Y);
      const g = new THREE.Group();
      const R = span / 2 - 1.5, tube = 1.9;
      // l'arche : demi-tore aplati dans l'axe de la piste (flanc + bande de roulement d'un pneu)
      const tyre = new THREE.Mesh(new THREE.TorusGeometry(R, tube, 18, 72, Math.PI), new THREE.MeshStandardMaterial({ color: 0x141416, roughness: 0.85 }));
      tyre.scale.set(1, 0.85, 1.7);
      const rim = new THREE.Mesh(new THREE.TorusGeometry(R - tube * 0.95, 0.35, 8, 72, Math.PI), new THREE.MeshStandardMaterial({ color: 0xf2c200, roughness: 0.5, metalness: 0.3 }));
      rim.scale.set(1, 0.85, 1);
      // sculptures de la bande de roulement
      const tread = new THREE.InstancedMesh(new THREE.BoxGeometry(0.35, 0.5, tube * 3.1), new THREE.MeshStandardMaterial({ color: 0x0a0a0b, roughness: 1 }), 40);
      const m4 = new THREE.Matrix4(), q = new THREE.Quaternion();
      for (let k = 0; k < 40; k++) {
        const t = Math.PI * (k + 0.5) / 40;
        q.setFromAxisAngle(new THREE.Vector3(0, 0, 1), t - Math.PI / 2);
        m4.compose(new THREE.Vector3(Math.cos(t) * (R + tube * 0.95), Math.sin(t) * (R + tube * 0.95) * 0.85, 0), q, new THREE.Vector3(1, 1, 1));
        tread.setMatrixAt(k, m4);
      }
      // tablier de la passerelle et escaliers aux deux extrémités
      const deckM = new THREE.MeshStandardMaterial({ color: 0x6f7780, roughness: 0.6, metalness: 0.5 });
      const deck = new THREE.Mesh(new THREE.BoxGeometry(span + 6, 0.6, 3), deckM); deck.position.y = 6.2;
      const railL = new THREE.Mesh(new THREE.BoxGeometry(span + 6, 1.1, 0.08), deckM); railL.position.set(0, 7.05, 1.45);
      const railR = railL.clone(); railR.position.z = -1.45;
      const towerA = new THREE.Mesh(new THREE.BoxGeometry(3.5, 6.8, 4), deckM); towerA.position.set(span / 2 + 3, 3.1, 0);
      const towerB = towerA.clone(); towerB.position.x = -span / 2 - 3;
      // enseigne Goodyear (nom actuel de la passerelle) : lettres jaunes sur fond bleu, lisible dans les deux sens, éclairée la nuit
      const cv = document.createElement('canvas'); cv.width = 1024; cv.height = 192;
      const c2 = cv.getContext('2d');
      c2.fillStyle = '#0a3a86'; c2.fillRect(0, 0, 1024, 192);
      c2.fillStyle = '#f5c400'; c2.fillRect(0, 0, 1024, 10); c2.fillRect(0, 182, 1024, 10);
      c2.fillStyle = '#f5c400'; c2.textAlign = 'center'; c2.textBaseline = 'middle';
      let fs = 150; c2.font = `italic 900 ${fs}px Arial Black, Arial, sans-serif`;
      while (c2.measureText('GOODYEAR').width > 940 && fs > 60) { fs -= 4; c2.font = `italic 900 ${fs}px Arial Black, Arial, sans-serif`; }
      c2.fillText('GOODYEAR', 512, 102);
      const tex = new THREE.CanvasTexture(cv); tex.colorSpace = THREE.SRGBColorSpace; tex.anisotropy = 8;
      const signM = new THREE.MeshStandardMaterial({ map: tex, emissive: 0xffffff, emissiveMap: tex, emissiveIntensity: cfg.env.night ? 1.4 : 0.25, roughness: 0.6 });
      const sw = R * 1.05, sh = sw * 192 / 1024;
      const front = new THREE.Mesh(new THREE.PlaneGeometry(sw, sh), signM); front.position.set(0, R * 0.85 - sh * 0.15, tube * 1.75);
      const back = front.clone(); back.rotation.y = Math.PI; back.position.z = -tube * 1.75;
      g.add(tyre, rim, tread, deck, railL, railR, towerA, towerB, front, back);
      g.traverse(o => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
      const basis = new THREE.Matrix4().makeBasis(X, Y, Z);
      g.quaternion.setFromRotationMatrix(basis);
      g.position.set(mx, y0 - 0.3, mz);
      this.scene.add(g);
    }
  }

  // Tunnels (Monaco) : parois, voûte éclairée, dalle et bâtiments au-dessus ; ouverts aux deux bouts
  buildTunnels(tr, cfg) {
    if (!tr.tunnel || !tr.tunnel.some(v => v)) return;
    const N = tr.N, hw = tr.width / 2, H = 6.2, wall = hw + 1.2, slab = hw + 16;
    const runs = [];
    for (let i = 0; i < N; i++) if (tr.tunnel[i] && !tr.tunnel[(i - 1 + N) % N]) { let j = i; while (tr.tunnel[(j + 1) % N] && j - i < N) j++; runs.push([i, j]); }
    const concrete = new THREE.MeshStandardMaterial({ color: 0x8c8a84, roughness: 0.9, side: THREE.DoubleSide });
    const ceilingM = new THREE.MeshStandardMaterial({ color: 0x3a3c40, roughness: 0.95, side: THREE.DoubleSide });
    const lampM = new THREE.MeshStandardMaterial({ color: 0xfff1d0, emissive: 0xffd9a0, emissiveIntensity: 2.2 });
    const strip = (a, b, fn) => {          // ruban entre deux profils (e, y) le long de la ligne médiane
      const pos = [], idx = [];
      for (let k = a, n = 0; k <= b; k++, n++) {
        const i = (k + N) % N;
        for (const [e, dy] of fn) pos.push(tr.cx[i] + tr.nx[i] * e, tr.cy[i] + dy, tr.cz[i] + tr.nz[i] * e);
        if (k < b) { const q = n * 2; idx.push(q, q + 1, q + 2, q + 1, q + 3, q + 2); }
      }
      const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setIndex(idx); g.computeVertexNormals();
      return g;
    };
    for (const [a0, b0] of runs) {
      const a = a0, b = b0;
      const add = (g, m, shadow = true) => { const o = new THREE.Mesh(g, m); o.castShadow = shadow; o.receiveShadow = true; this.scene.add(o); return o; };
      add(strip(a, b, [[wall, -0.6], [wall, H]]), concrete);            // paroi gauche
      add(strip(a, b, [[-wall, -0.6], [-wall, H]]), concrete);          // paroi droite (côté mer : ouvertures non modélisées)
      add(strip(a, b, [[wall, H], [-wall, H]]), ceilingM);              // voûte
      add(strip(a, b, [[slab, H + 0.1], [-slab, H + 0.1]]), concrete);  // dalle au-dessus
      add(strip(a, b, [[slab, H + 0.1], [slab, -1.5]]), concrete);      // flancs de la dalle
      add(strip(a, b, [[-slab, H + 0.1], [-slab, -1.5]]), concrete);
      add(strip(a, b, [[0.35, H - 0.05], [-0.35, H - 0.05]]), lampM, false);   // rampe d'éclairage
      // bâtiments posés sur la dalle (hôtel au-dessus du tunnel)
      const im = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshStandardMaterial({ color: 0xe9e2d4, roughness: 0.8 }), 8);
      const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), up = new THREE.Vector3(0, 1, 0);
      let n = 0;
      for (let k = a + 6; k < b - 4 && n < 8; k += Math.max(8, Math.round(45 / tr.step))) {
        const i = k % N, h = 14 + Math.random() * 12;
        q.setFromAxisAngle(up, Math.atan2(tr.tx[i], tr.tz[i]));
        m4.compose(new THREE.Vector3(tr.cx[i], tr.cy[i] + H + h / 2, tr.cz[i]), q, new THREE.Vector3(slab * 1.6, h, 36));
        im.setMatrixAt(n++, m4);
      }
      im.count = n; im.castShadow = true; this.scene.add(im);
    }
    // les caméras TV à l'intérieur du tunnel : placées au plafond, dans l'axe
    for (const c of this.tvCams || []) if (tr.tunnel[c.i]) c.pos.set(tr.cx[c.i], tr.cy[c.i] + H - 0.6, tr.cz[c.i]);
  }

  // Une empreinte rectangulaire (centre, axe long a, demi-longueur, demi-profondeur) est-elle à plus de « clear » m
  // de l'axe de toute portion de piste, et hors de la mer ?
  footprintFree(cx, cz, ax, az, hl, hd, clear) {
    for (let u = -1; u <= 1; u += 0.5) for (let v = -1; v <= 1; v += 0.5) {
      const x = cx + ax * hl * u - az * hd * v, z = cz + az * hl * u + ax * hd * v;
      const [d] = this.nearest(x, z, 3);
      if (d < clear) return false;
      if (this.rawHeight && this.rawHeight(x, z) == null) return false;   // pas dans la mer
    }
    return true;
  }

  buildScenery(tr, cfg) {
    const th = THEMES[tr.def.id] || { trees: 0.3, kind: 'broad', stands: null };
    const snow = cfg.env.weather === 'snow';
    const N = tr.N, hw = tr.width / 2;
    const T = TERRAIN[tr.def.id];
    const hasSea = T && T.h.some(v => v == null);
    const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), sc = new THREE.Vector3(), p = new THREE.Vector3(), up = new THREE.Vector3(0, 1, 0);
    const occupied = [];                     // empreintes déjà prises (bâtiments, gradins) : les arbres les évitent
    const isOccupied = (x, z) => occupied.some(o => Math.abs((x - o.x) * o.ax + (z - o.z) * o.az) < o.hl + 4 && Math.abs(-(x - o.x) * o.az + (z - o.z) * o.ax) < o.hd + 4);

    // --- ligne droite de départ : indices [s0, s1] où la piste est quasi rectiligne autour du point 0
    const straightLim = 1 / 900;
    let s0 = 0, s1 = 0;
    while (s0 > -N / 4 && Math.abs(tr.kappa[(s0 - 1 + N) % N]) < straightLim) s0--;
    while (s1 < N / 4 && Math.abs(tr.kappa[(s1 + 1) % N]) < straightLim) s1++;
    // côté intérieur du circuit (vers le barycentre) : les stands y sont généralement
    let gx = 0, gz = 0; for (let i = 0; i < N; i++) { gx += tr.cx[i]; gz += tr.cz[i]; } gx /= N; gz /= N;
    const inSide = ((gx - tr.cx[0]) * tr.nx[0] + (gz - tr.cz[0]) * tr.nz[0]) > 0 ? 1 : -1;

    // --- modules de tribune (instanciés) : 6 gradins + dos + toit ; x le long de la piste, z en s'éloignant
    const standSlots = [];
    const addStandsAlong = (from, to, side, off, maxLen) => {
      let len = 0;
      for (let k = from; k <= to && len < maxLen; k += Math.round(22 / tr.step)) {
        const i = (k + N) % N, ax = tr.tx[i], az = tr.tz[i];
        const ox = tr.nx[i] * side, oz = tr.nz[i] * side;
        const tb = hw * Math.abs(Math.tan(tr.bank ? tr.bank[i] : 0));
        const cx = tr.cx[i] + ox * (off + 9), cz = tr.cz[i] + oz * (off + 9);
        if (!this.footprintFree(cx, cz, ax, az, 10.5, 9.5, off - 3)) continue;
        standSlots.push({ x: tr.cx[i] + ox * off, z: tr.cz[i] + oz * off, y: tr.cy[i] + tb * (side * (tr.bank ? Math.sign(tr.bank[i]) : 0) < 0 ? 1 : 0) - 0.3, ax, az, ox, oz });
        occupied.push({ x: cx, z: cz, ax, az, hl: 11, hd: 10 });
        len += 22;
      }
    };
    if (th.stands === 'oval') {
      // ovale : tribunes quasi continues côté extérieur (hors virages très courts), stands et tour côté intérieur
      addStandsAlong(0, N - 1, -inSide, hw + 7, 1e9);
    } else if (th.stands === 'straight' && (s1 - s0) * tr.step > 120) {
      addStandsAlong(s0 + 4, s1 - 4, -inSide, hw + 10, 420);
    }
    if (standSlots.length) {
      const n = standSlots.length;
      const stepMat = new THREE.MeshStandardMaterial({ color: 0x9aa4b2, roughness: 0.85 });
      const seatMats = [0xd8262a, 0x1e6fff, 0xf2f2f2].map(c => new THREE.MeshStandardMaterial({ color: c, roughness: 0.7 }));
      const roofMat = new THREE.MeshStandardMaterial({ color: 0x1b2230, roughness: 0.5, metalness: 0.3 });
      const parts = [];
      for (let r = 0; r < 7; r++) parts.push({ geo: new THREE.BoxGeometry(20, 0.9, 2.4), pos: [0, 0.45 + r * 0.95, 1.2 + r * 2.3], mat: r % 2 ? stepMat : seatMats[r % 3] });
      parts.push({ geo: new THREE.BoxGeometry(20, 4, 17.5), pos: [0, -2, 8.75], mat: stepMat });   // socle jusqu'au sol
      parts.push({ geo: new THREE.BoxGeometry(20, 8.5, 0.5), pos: [0, 4.25, 17.2], mat: stepMat });
      parts.push({ geo: new THREE.BoxGeometry(20.4, 0.35, 15), pos: [0, 11.5, 9.5], mat: roofMat });
      for (const [px2] of [[-9.8], [9.8]]) parts.push({ geo: new THREE.BoxGeometry(0.4, 11.5, 0.4), pos: [px2, 5.75, 16.8], mat: roofMat });
      for (const part of parts) {
        const im = new THREE.InstancedMesh(part.geo, part.mat, n);
        standSlots.forEach((st, k) => {
          // base : X = le long de la piste, Y = haut, Z = en s'éloignant de la piste (repère direct)
          const Z = new THREE.Vector3(st.ox, 0, st.oz), X = new THREE.Vector3().crossVectors(up, Z);
          m4.makeBasis(X, up, Z);
          const lp = new THREE.Vector3(...part.pos).applyMatrix4(m4);
          m4.setPosition(st.x + lp.x, st.y + lp.y, st.z + lp.z);
          im.setMatrixAt(k, m4);
        });
        im.castShadow = true; im.receiveShadow = true;
        this.scene.add(im);
      }
    }

    // --- bâtiment des stands : blocs successifs le long de la ligne droite, côté intérieur, si la place est libre
    if (th.stands && (s1 - s0) * tr.step > 150) {
      const blocks = [];
      const pitOff = hw + (th.stands === 'oval' ? 34 : 22);
      for (let k = s0 + 6; k <= s1 - 6 && blocks.length < 12; k += Math.round(24 / tr.step)) {
        const i = (k + N) % N, ax = tr.tx[i], az = tr.tz[i];
        const cx = tr.cx[i] + tr.nx[i] * inSide * (pitOff + 7), cz = tr.cz[i] + tr.nz[i] * inSide * (pitOff + 7);
        if (!this.footprintFree(cx, cz, ax, az, 12, 7, pitOff - 2)) continue;
        blocks.push({ cx, cz, ax, az, y: this.terrainHeight(cx, cz) });
        occupied.push({ x: cx, z: cz, ax, az, hl: 12, hd: 7 });
      }
      if (blocks.length) {
        const im = new THREE.InstancedMesh(new THREE.BoxGeometry(24, 8, 14), new THREE.MeshStandardMaterial({ color: 0xe9eef5, roughness: 0.6 }), blocks.length);
        const glass = new THREE.InstancedMesh(new THREE.BoxGeometry(24.2, 2.2, 14.2), new THREE.MeshStandardMaterial({ color: 0x1a2735, roughness: 0.15, metalness: 0.6 }), blocks.length);
        blocks.forEach((bk, k) => {
          q.setFromAxisAngle(up, Math.atan2(bk.ax, bk.az) + Math.PI / 2);
          m4.compose(p.set(bk.cx, bk.y + 4, bk.cz), q, sc.set(1, 1, 1)); im.setMatrixAt(k, m4);
          m4.compose(p.set(bk.cx, bk.y + 6.2, bk.cz), q, sc.set(1, 1, 1)); glass.setMatrixAt(k, m4);
        });
        im.castShadow = true;
        this.scene.add(im, glass);
      }
      // Indianapolis : tour « Pagoda » au centre de la ligne droite
      if (th.stands === 'oval' && blocks.length) {
        const bk = blocks[Math.floor(blocks.length / 2)];
        const pag = new THREE.Group();
        for (let f = 0; f < 9; f++) {
          const fl = new THREE.Mesh(new THREE.BoxGeometry(16 - f * 0.6, 3.6, 16 - f * 0.6), new THREE.MeshStandardMaterial({ color: f % 2 ? 0x1a2735 : 0xdfe6ee, roughness: 0.4, metalness: f % 2 ? 0.6 : 0.1 }));
          fl.position.y = 1.8 + f * 3.6; pag.add(fl);
        }
        pag.position.set(bk.cx + inSide * 0, bk.y + 8, bk.cz); pag.traverse(o => { if (o.isMesh) o.castShadow = true; });
        this.scene.add(pag);
      }
    }

    // --- ville : immeubles le long du tracé (Monaco : dense ; Interlagos, Mexico : faubourgs bas et plus éloignés)
    if (th.city) {
      const dense = th.city === 'dense';
      const pal = dense ? [0xe8d3b0, 0xf0c9a8, 0xd9b99b, 0xf3e6c8, 0xe6b8a2, 0xcfd6d9, 0xf5efe0] : [0xc9c3b6, 0xb7aea0, 0xd9d2c4, 0xa9a39a];
      const list = [];
      const every = Math.max(1, Math.round((dense ? 9 : 16) / tr.step));
      for (let i = 0; i < N; i += every) for (const side of [-1, 1]) {
        if (tr.tunnel && tr.tunnel[i]) continue;          // la dalle du tunnel porte ses propres bâtiments
        const off = hw + (dense ? 7 : 55) + Math.random() * (dense ? 30 : 120);
        const cx = tr.cx[i] + tr.nx[i] * side * off, cz = tr.cz[i] + tr.nz[i] * side * off;
        const ax = tr.tx[i], az = tr.tz[i];
        const w = (dense ? 10 : 8) + Math.random() * 10, dpt = (dense ? 10 : 8) + Math.random() * 10;
        if (!this.footprintFree(cx, cz, ax, az, w / 2 + 1, dpt / 2 + 1, hw + (dense ? 4 : 30))) continue;
        if (isOccupied(cx, cz) || list.some(o => Math.hypot(o.cx - cx, o.cz - cz) < (w + o.w) / 2)) continue;
        const h = dense ? 12 + Math.random() * 38 : 5 + Math.random() * 8;
        list.push({ cx, cz, ax, az, w, dpt, h, y: this.terrainHeight(cx, cz) - 1, col: pal[Math.floor(Math.random() * pal.length)] });
      }
      if (list.length) {
        const im = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshStandardMaterial({ roughness: 0.85 }), list.length);
        const col = new THREE.Color();
        list.forEach((bd, k) => {
          q.setFromAxisAngle(up, Math.atan2(bd.ax, bd.az));
          m4.compose(p.set(bd.cx, bd.y + bd.h / 2, bd.cz), q, sc.set(bd.dpt, bd.h, bd.w));
          im.setMatrixAt(k, m4); im.setColorAt(k, col.setHex(bd.col));
          occupied.push({ x: bd.cx, z: bd.cz, ax: bd.ax, az: bd.az, hl: bd.w / 2, hd: bd.dpt / 2 });
        });
        im.castShadow = true; im.receiveShadow = true;
        this.scene.add(im);
      }
    }

    // --- végétation selon le thème (bosquets), à l'écart de la piste, des bâtiments et de la mer
    const count = Math.round(2600 * th.trees);
    if (count > 0) {
      const trunkG = new THREE.CylinderGeometry(0.25, 0.35, 2.4, 5); trunkG.translate(0, 1.2, 0);
      const coneG = new THREE.ConeGeometry(2.4, 7, 7); coneG.translate(0, 5.5, 0);
      const ballG = new THREE.IcosahedronGeometry(3.2, 1); ballG.translate(0, 5.2, 0);
      const leafC = snow ? 0xdde6ea : 0x2f5a2a, leafB = snow ? 0xe3eaee : 0x3f6e2e;
      const tm = new THREE.InstancedMesh(trunkG, new THREE.MeshStandardMaterial({ color: 0x4a3526, roughness: 1 }), count);
      const cm = new THREE.InstancedMesh(coneG, new THREE.MeshStandardMaterial({ color: leafC, roughness: 0.95 }), count);
      const bm = new THREE.InstancedMesh(ballG, new THREE.MeshStandardMaterial({ color: leafB, roughness: 0.95, flatShading: true }), count);
      let nc = 0, nb = 0, placed = 0, tries = 0;
      const xr = T ? [T.x0, T.x1] : [-3000, 3000], zr = T ? [T.z0, T.z1] : [-3000, 3000];
      while (placed < count && tries < count * 8) {
        tries++;
        const cx = xr[0] + Math.random() * (xr[1] - xr[0]), cz = zr[0] + Math.random() * (zr[1] - zr[0]);
        const nclu = 1 + Math.floor(Math.random() * 7);
        for (let c = 0; c < nclu && placed < count; c++) {
          const x = cx + (Math.random() - 0.5) * 60, z = cz + (Math.random() - 0.5) * 60;
          const [d] = this.nearest(x, z, 1);
          if (d < hw + 28 || isOccupied(x, z)) continue;
          if (hasSea && this.rawHeight(x, z) == null) continue;
          const h = this.terrainHeight(x, z);
          const s2 = 0.7 + Math.random() * 0.8;
          p.set(x, h - 0.2, z); sc.set(s2, s2 * (0.8 + Math.random() * 0.5), s2);
          q.setFromAxisAngle(up, Math.random() * 6.28);
          m4.compose(p, q, sc);
          tm.setMatrixAt(placed, m4);
          const conifer = th.kind === 'conifer' || (th.kind === 'mixed' && Math.random() < 0.5);
          if (conifer) cm.setMatrixAt(nc++, m4); else bm.setMatrixAt(nb++, m4);
          placed++;
        }
      }
      tm.count = placed; cm.count = nc; bm.count = nb;
      cm.castShadow = bm.castShadow = true;
      this.scene.add(tm, cm, bm);
    }

    // caméras TV : positions fixes le long du tracé
    this.tvCams = [];
    const spacing = Math.max(12, Math.round(260 / tr.step));
    for (let i = 0; i < N; i += spacing) {
      const side = tr.kappa[i] > 0 ? -1 : 1;
      const o2 = (hw + 18) * side;
      const x = tr.cx[i] + tr.nx[i] * o2, z = tr.cz[i] + tr.nz[i] * o2;
      this.tvCams.push({ i, pos: new THREE.Vector3(x, tr.cy[i] + 7, z) });
    }
  }

  buildNight(tr) {
    // mâts d'éclairage (émissifs) + projecteurs de la voiture
    const N = tr.N, geo = new THREE.CylinderGeometry(0.15, 0.2, 12, 5); geo.translate(0, 6, 0);
    const head = new THREE.BoxGeometry(1.6, 0.5, 0.8); head.translate(0, 12.2, 0);
    const pm = new THREE.MeshStandardMaterial({ color: 0x333a44 });
    const hm = new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0xfff4d6, emissiveIntensity: 3 });
    const every = Math.max(8, Math.round(90 / tr.step));
    const cnt = Math.ceil(N / every);
    const im1 = new THREE.InstancedMesh(geo, pm, cnt), im2 = new THREE.InstancedMesh(head, hm, cnt);
    const m = new THREE.Matrix4();
    let n = 0;
    for (let i = 0; i < N; i += every) {
      const side = (n % 2) ? 1 : -1, o = (tr.width / 2 + 6) * side;
      m.makeRotationY(Math.atan2(tr.nx[i], tr.nz[i]));
      m.setPosition(tr.cx[i] + tr.nx[i] * o, tr.cy[i], tr.cz[i] + tr.nz[i] * o);
      im1.setMatrixAt(n, m); im2.setMatrixAt(n, m); n++;
    }
    im1.count = im2.count = n;
    this.scene.add(im1, im2);
    // halo lumineux sur la piste : éclairage d'appoint suivant la caméra
    this.nightFill = new THREE.PointLight(0xfff0d8, 2200, 0, 2);
    this.scene.add(this.nightFill);
  }

  buildCar(cfg) {
    this.model = new CarModel(cfg.carType, cfg.car, CAR_COLORS[cfg.carType] ?? 0xff3b2f, cfg.env);
    this.car = this.model.root;
    this.scene.add(this.car);
    // gros point visible en vue aérienne (taille constante à l'écran, toujours au premier plan)
    const cv = document.createElement('canvas'); cv.width = cv.height = 128;
    const g = cv.getContext('2d');
    g.fillStyle = 'rgba(255,59,47,.28)'; g.beginPath(); g.arc(64, 64, 62, 0, 7); g.fill();
    g.fillStyle = '#ff3b2f'; g.beginPath(); g.arc(64, 64, 40, 0, 7); g.fill();
    g.lineWidth = 10; g.strokeStyle = '#fff'; g.stroke();
    const tex = new THREE.CanvasTexture(cv); tex.colorSpace = THREE.SRGBColorSpace;
    this.marker = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, sizeAttenuation: false, depthTest: false, depthWrite: false, transparent: true }));
    this.marker.renderOrder = 999; this.marker.visible = false;
    this.scene.add(this.marker);
  }

  buildWeather(env) {
    this.precip = null;
    if (env.weather === 'dry') return;
    const snow = env.weather === 'snow';
    const n = Math.round((snow ? 5000 : 7000) * (0.4 + env.intensity));
    const pos = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) { pos[i * 3] = (Math.random() - 0.5) * 120; pos[i * 3 + 1] = Math.random() * 50; pos[i * 3 + 2] = (Math.random() - 0.5) * 120; }
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    const m = new THREE.PointsMaterial({ color: snow ? 0xffffff : 0xaec4d8, size: snow ? 0.22 : 0.08, transparent: true, opacity: snow ? 0.9 : 0.6, depthWrite: false });
    this.precip = new THREE.Points(g, m); this.precip.frustumCulled = false;
    this.precipSnow = snow;
    this.scene.add(this.precip);
  }

  // Place la voiture : i = index de trajectoire, f = fraction, v (m/s), ax, ay (m/s²)
  // Place la voiture : i = index de trajectoire, f = fraction ; info = { v, ax, ay, brk, ride, bT, rain }
  update(i, f, info, dt) {
    const tr = this.tr, N = tr.N, j = (i + 1) % N;
    const x = tr.px[i] + (tr.px[j] - tr.px[i]) * f, z = tr.pz[i] + (tr.pz[j] - tr.pz[i]) * f;
    const y = tr.py[i] + (tr.py[j] - tr.py[i]) * f;
    const hx = tr.hx[i] + (tr.hx[j] - tr.hx[i]) * f, hz = tr.hz[i] + (tr.hz[j] - tr.hz[i]) * f;
    const bank = tr.bank ? tr.bank[i] + (tr.bank[j] - tr.bank[i]) * f : 0;
    this.place(x, y, z, Math.atan2(hx, hz), -Math.atan(tr.grade[i]), i, { ...info, kappa: tr.kappa[i], bank: -bank }, dt);
  }

  // Place la voiture à une position libre (mode conduite) : yaw = cap, pitch = pente
  place(x, y, z, yaw, pitch, i, info, dt) {
    const v = info.v;
    const car = this.car;
    car.position.set(x, y + 0.01, z);
    car.rotation.order = 'YXZ';
    car.rotation.set(pitch, yaw, info.bank || 0);
    this.model.update(info, dt);
    // ombre portée : la lumière suit la voiture
    this.sun.position.set(x + 250, y + 420, z + 160); this.sun.target.position.set(x, y, z);
    if (this.nightFill) this.nightFill.position.set(x, y + 25, z);
    this.updateCamera(x, y, z, yaw, i, v, dt);
    if (this.precip) {
      const a = this.precip.geometry.attributes.position, arr = a.array, cp = this.camera.position;
      const fall = (this.precipSnow ? 2.5 : 22) * dt;
      for (let k = 0; k < arr.length; k += 3) {
        arr[k + 1] -= fall;
        if (this.precipSnow) arr[k] += Math.sin(k + performance.now() / 900) * 0.02;
        if (arr[k + 1] < cp.y - 15 || Math.abs(arr[k] - cp.x) > 60 || Math.abs(arr[k + 2] - cp.z) > 60) {
          arr[k] = cp.x + (Math.random() - 0.5) * 120; arr[k + 1] = cp.y + 10 + Math.random() * 40; arr[k + 2] = cp.z + (Math.random() - 0.5) * 120;
        }
      }
      a.needsUpdate = true;
    }
    this.renderer.render(this.scene, this.camera);
  }

  resetOrbit() {
    const tr = this.tr;
    let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
    for (let i = 0; i < tr.N; i++) { x0 = Math.min(x0, tr.cx[i]); x1 = Math.max(x1, tr.cx[i]); z0 = Math.min(z0, tr.cz[i]); z1 = Math.max(z1, tr.cz[i]); }
    const ext = Math.max(x1 - x0, z1 - z0);
    this.orbit = { target: new THREE.Vector3((x0 + x1) / 2, (tr.ymin + tr.ymax) / 2, (z0 + z1) / 2), dist: ext * 1.05, az: 0, el: 1.2, ext };
    return this.orbit;
  }

  // Souris : glisser = pivoter, clic droit / Maj + glisser = déplacer, molette = zoom, double-clic = recentrer
  bindOrbit() {
    const el = this.renderer.domElement;
    let drag = null;
    const active = () => this.camMode === 'top';
    el.addEventListener('contextmenu', e => { if (active()) e.preventDefault(); });
    el.addEventListener('pointerdown', e => {
      if (!active()) return;
      drag = { x: e.clientX, y: e.clientY, pan: e.button === 2 || e.shiftKey || e.button === 1 };
      el.setPointerCapture(e.pointerId);
      el.style.cursor = drag.pan ? 'move' : 'grabbing';
    });
    el.addEventListener('pointermove', e => {
      if (!drag || !active()) return;
      const o = this.orbit || this.resetOrbit();
      const dx = e.clientX - drag.x, dy = e.clientY - drag.y;
      drag.x = e.clientX; drag.y = e.clientY;
      if (drag.pan) {
        const k = o.dist / el.clientHeight * 1.1;
        const cx = Math.cos(o.az), sx = Math.sin(o.az);
        // déplacement dans le plan horizontal, relatif à l'orientation de la caméra
        o.target.x += (-dx * cx - dy * sx) * k;
        o.target.z += (dx * sx - dy * cx) * k;
      } else {
        o.az -= dx * 0.006;
        o.el = Math.max(0.08, Math.min(1.55, o.el + dy * 0.006));
      }
    });
    const end = e => { if (drag) { drag = null; el.style.cursor = active() ? 'grab' : ''; try { el.releasePointerCapture(e.pointerId); } catch (_) { /* déjà relâché */ } } };
    el.addEventListener('pointerup', end); el.addEventListener('pointercancel', end);
    el.addEventListener('wheel', e => {
      if (!active()) return;
      e.preventDefault();
      const o = this.orbit || this.resetOrbit();
      o.dist = Math.max(40, Math.min(o.ext * 3, o.dist * Math.exp(e.deltaY * 0.0012)));
    }, { passive: false });
    el.addEventListener('dblclick', () => { if (active()) this.resetOrbit(); });
  }

  setCamMode(m) {
    this.camMode = m;
    this.renderer.domElement.style.cursor = m === 'top' ? 'grab' : '';
  }

  // Cap et hauteur lissés (indépendants de la vitesse : pas de retard qui s'accumule)
  smoothFollow(yaw, y, dt, k) {
    if (this._sYaw == null || !isFinite(this._sYaw)) { this._sYaw = yaw; this._sY = y; }
    let d = yaw - this._sYaw;
    d = Math.atan2(Math.sin(d), Math.cos(d));
    const a = 1 - Math.exp(-dt * k);
    this._sYaw += d * a;
    // au-delà de ~35° d'écart (épingle en accéléré), on rattrape franchement
    if (Math.abs(d) > 0.6) this._sYaw = yaw - Math.sign(d) * 0.6;
    this._sY += (y - this._sY) * (1 - Math.exp(-dt * k * 1.5));
    if (Math.abs(y - this._sY) > 3) this._sY = y - Math.sign(y - this._sY) * 3;
    return [this._sY, Math.sin(this._sYaw), Math.cos(this._sYaw)];
  }

  updateCamera(x, y, z, yaw, i, v, dt) {
    const cam = this.camera, fx = Math.sin(yaw), fz = Math.cos(yaw);
    const lerp = 1 - Math.exp(-dt * 6);
    let fov = 60;
    const target = new THREE.Vector3(), look = new THREE.Vector3(x, y + 1, z);
    switch (this.camMode) {
      case 'onboard':
        // caméra « T-cam » au-dessus de la cellule
        const fam = this.cfg.car.family, hc = fam === 'open' ? 1.15 : fam === 'gt' ? 1.62 : 1.32;
        target.set(x - fx * 0.4, y + hc, z - fz * 0.4);
        look.set(x + fx * 30, y + hc - 0.5 + (this.tr.py[(i + 6) % this.tr.N] - y) * 0.9, z + fz * 30);
        cam.position.copy(target); this.camLook.copy(look); fov = 75;
        break;
      case 'tv': {
        let best = null, bd = Infinity;
        for (const c of this.tvCams) { const d = c.pos.distanceToSquared(new THREE.Vector3(x, y, z)); if (d < bd) { bd = d; best = c; } }
        cam.position.copy(best.pos);
        this.camLook.lerp(look, 1 - Math.exp(-dt * 12));
        fov = Math.max(8, Math.min(55, 2 * Math.atan(9 / Math.sqrt(bd)) * 180 / Math.PI));
        break;
      }
      case 'heli': {
        const [cy2, sx, sz] = this.smoothFollow(yaw, y, dt, 1.5);
        cam.position.set(x - sx * 60, cy2 + 45, z - sz * 60);
        this.camLook.set(x, y + 1, z);
        fov = 50;
        break;
      }
      case 'top': {
        // vue aérienne libre : orbite à la souris autour d'un point cible
        const o = this.orbit || this.resetOrbit();
        const ce = Math.cos(o.el);
        cam.position.set(o.target.x + Math.sin(o.az) * ce * o.dist, o.target.y + Math.sin(o.el) * o.dist, o.target.z + Math.cos(o.az) * ce * o.dist);
        this.camLook.copy(o.target);
        fov = 50;
        break;
      }
      default: { // poursuite : caméra attachée à la voiture, seuls le cap et la hauteur sont lissés
        // dans un tunnel : caméra plus proche, plus basse et plus réactive (les parois sont à 2–3 m)
        const inTun = this.tr.tunnel && this.tr.tunnel[i];
        const [cy2, sx, sz] = this.smoothFollow(yaw, y, dt, inTun ? 14 : 5);
        const back = inTun ? 6 : 9, high = inTun ? 2.4 : 3.2;
        cam.position.set(x - sx * back, cy2 + high, z - sz * back);
        this.camLook.set(x + sx * 6, cy2 + 1.2 + (y - cy2) * 0.5, z + sz * 6);
        fov = 58 + Math.min(14, v * 0.12);
      }
    }
    this.scene.fog = this.camMode === 'top' ? null : this.fog;
    const near = this.camMode === 'top' ? Math.max(0.5, this.orbit.dist / 400) : 0.3;
    if (cam.near !== near) { cam.near = near; cam.updateProjectionMatrix(); }
    if (this.marker) {
      this.marker.visible = this.camMode === 'top';
      if (this.marker.visible) {
        this.marker.position.set(x, y + 2, z);
        const pulse = 1 + 0.12 * Math.sin(performance.now() / 180);
        this.marker.scale.set(0.034 * pulse, 0.034 * pulse, 1);
      }
    }
    if (Math.abs(cam.fov - fov) > 0.05) { cam.fov += (fov - cam.fov) * (this.camMode === 'tv' ? 1 : lerp); cam.updateProjectionMatrix(); }
    // la caméra ne passe pas sous le relief
    if (this.camMode === 'chase' || this.camMode === 'heli') {
      const hg = this.terrainHeight(cam.position.x, cam.position.z);
      if (cam.position.y < hg + 1.2) cam.position.y = hg + 1.2;
    }
    cam.lookAt(this.camLook);
  }
}
