// Sporoto — modèles 3D des voitures (extrusions des profils de js/carshapes.js) et mouvements de caisse.
// La caisse est montée sur une suspension visuelle (ressort + amortisseur, 2e ordre) : tangage au freinage
// et à l'accélération, roulis en virage, écrasement sous l'appui aérodynamique. Les roues avant braquent.
import * as THREE from './lib/three.module.js';
import { SHAPES, airfoil } from './carshapes.js';
import { COMPOUNDS } from './data/cars.js';

const G = 9.81, DEG = Math.PI / 180;
// amplification visuelle des mouvements réels (sinon quelques dixièmes de degré, imperceptibles à l'écran)
const EXAG = 2.2;
// gradients de roulis et de tangage (° par g) selon la famille, à raideur moyenne
const GRAD = { open: { roll: 0.55, pitch: 0.4 }, proto: { roll: 0.85, pitch: 0.6 }, gt: { roll: 1.5, pitch: 0.95 } };

function mat(color, rough = 0.4, metal = 0.2, extra = {}) { return new THREE.MeshStandardMaterial({ color, roughness: rough, metalness: metal, ...extra }); }

export class CarModel {
  constructor(type, car, color, env) {
    const S = this.S = SHAPES[type] || SHAPES.LIBRE;
    this.car = car; this.env = env;
    this.xc = (S.xr + S.xf) / 2;                  // origine : milieu de l'empattement
    this.root = new THREE.Group();
    this.bodyPivot = new THREE.Group();          // pivot au centre de gravité
    this.bodyPivot.position.y = car.cgHeight;
    this.body = new THREE.Group(); this.body.position.y = -car.cgHeight;
    this.bodyPivot.add(this.body); this.root.add(this.bodyPivot);
    this.M = {
      paint: mat(color, 0.28, 0.45, { envMapIntensity: 1 }),
      carbon: mat(0x1a1e24, 0.45, 0.35),
      dark: mat(0x0d0f12, 0.6, 0.2),
      glass: mat(0x0a1016, 0.06, 0.85, { polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1 }),
      white: mat(0xf2f2f2, 0.35, 0.1),
      tyre: mat(0x121315, 0.92, 0),
      rim: mat(0x2b3038, 0.3, 0.85),
      headL: mat(0xffffff, 0.2, 0, { emissive: 0xfff2cc, emissiveIntensity: env.night ? 5 : 0.8 }),
      tail: mat(0x300000, 0.4, 0, { emissive: 0xff1a1a, emissiveIntensity: 0.5 }),
      rain: mat(0x300000, 0.4, 0, { emissive: 0xff1a1a, emissiveIntensity: 0 }),
      disc: mat(0x3a3a3a, 0.5, 0.6, { emissive: 0xff5a14, emissiveIntensity: 0 }),
    };
    if (S.family === 'open') this.buildOpen(); else this.buildClosed();
    this.buildWheels();
    this.root.traverse(o => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = false; } });
    // états de la suspension visuelle
    this.st = { pitch: 0, pv: 0, roll: 0, rv: 0, heave: 0, hv: 0 };
    const k = 1.4 - 0.8 * (car.stiffness ?? 50) / 100;
    const gr = GRAD[S.family] || GRAD.proto;
    this.rollGain = gr.roll * k * EXAG * DEG; this.pitchGain = gr.pitch * k * EXAG * DEG;
    this.omega = 2 * Math.PI * (1.4 + 1.2 * (car.stiffness ?? 50) / 100);   // fréquence propre (rad/s)
    this.zeta = 0.42;
  }

  // Extrusion d'un profil latéral sur une largeur donnée (centrée), dans le repère voiture (+z avant)
  extrude(pts, width, material, bevel = 0.02, yLift = 0, xOff = 0) {
    const sh = new THREE.Shape(pts.map(([x, y]) => new THREE.Vector2(x - this.xc, y + yLift)));
    const b = Math.min(bevel, width / 4);
    const g = new THREE.ExtrudeGeometry(sh, { depth: Math.max(0.005, width - 2 * b), bevelEnabled: b > 0, bevelThickness: b, bevelSize: b, bevelOffset: -b, bevelSegments: 3, curveSegments: 6 });
    g.translate(0, 0, -(width - 2 * b) / 2);
    g.rotateY(-Math.PI / 2);
    if (xOff) g.translate(xOff, 0, 0);
    const m = new THREE.Mesh(g, material);
    this.body.add(m);
    return m;
  }

  // Élément d'aileron : profil NACA extrudé sur l'envergure, incidence en degrés
  wing(x, y, chord, span, angDeg, material, parent = this.body) {
    // profil inversé (cambrure vers le bas), bord d'attaque vers l'avant à x
    const af = airfoil(0.13, 0.07).map(([u, v]) => new THREE.Vector2(-u * chord, -v * chord));
    const g = new THREE.ExtrudeGeometry(new THREE.Shape(af), { depth: span, bevelEnabled: false });
    g.translate(0, 0, -span / 2);
    g.rotateY(-Math.PI / 2);
    const m = new THREE.Mesh(g, material);
    m.position.set(0, y, x - this.xc);
    m.rotation.x = angDeg * DEG;                     // incidence : bord de fuite relevé
    parent.add(m);
    return m;
  }

  box(w, h, d, x, y, z, material, parent = this.body) {
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), material);
    m.position.set(x, y, z - this.xc); parent.add(m); return m;
  }

  buildOpen() {
    const S = this.S, M = this.M, c = this.car;
    this.extrude(S.body, S.bodyW, M.paint, 0.08);
    this.extrude(S.pods, S.podsW, M.paint, 0.1);
    // fond plat et diffuseur
    this.box(S.floor.w, 0.025, S.floor.x1 - S.floor.x0, 0, S.floor.y, (S.floor.x0 + S.floor.x1) / 2, M.carbon);
    const dif = this.box(S.floor.w * 0.8, 0.02, 0.5, 0, 0.14, 0.35, M.carbon); dif.rotation.x = 0.35;
    // pilote
    const helmet = new THREE.Mesh(new THREE.SphereGeometry(S.head.r, 18, 14), M.white);
    helmet.position.set(0, S.head.y, S.head.x - this.xc); this.body.add(helmet);
    const visor = new THREE.Mesh(new THREE.SphereGeometry(S.head.r * 1.02, 18, 8, -0.9, 1.8, 1.1, 0.55), M.glass);
    visor.position.copy(helmet.position); this.body.add(visor);
    // prise d'air au-dessus de la tête
    this.box(0.2, 0.16, 0.08, 0, S.body[11][1] - 0.1, S.head.x - 0.22, M.dark);
    // halo
    if (S.halo) {
      const yb = S.body[9][1] + 0.02, zh = S.head.x - this.xc;
      const curve = new THREE.CatmullRomCurve3([
        new THREE.Vector3(-0.3, yb, zh - 0.32), new THREE.Vector3(-0.32, yb + 0.12, zh + 0.1), new THREE.Vector3(0, yb + 0.17, zh + 0.46),
        new THREE.Vector3(0.32, yb + 0.12, zh + 0.1), new THREE.Vector3(0.3, yb, zh - 0.32)]);
      this.body.add(new THREE.Mesh(new THREE.TubeGeometry(curve, 40, 0.025, 8), M.carbon));
      const pil = new THREE.Mesh(new THREE.CylinderGeometry(0.022, 0.03, 0.26, 8), M.carbon);
      pil.position.set(0, yb + 0.05, zh + 0.55); pil.rotation.x = 0.7; this.body.add(pil);
    }
    // rétroviseurs
    for (const sx of [-1, 1]) this.box(0.12, 0.06, 0.04, sx * 0.42, S.body[8][1] + 0.08, S.xf - 1.05, M.paint);
    // aileron avant : éléments étagés (incidence liée au réglage)
    const fw = S.frontWing, dF = (c.wingFront - c.wingFrontRef);
    for (let e = 0; e < fw.elems; e++) this.wing(fw.x + fw.chord - e * 0.1, fw.y + e * 0.045, fw.chord - e * 0.08, fw.span, 3 + e * 7 + dF * 0.8, e ? M.carbon : M.paint);
    for (const sx of [-1, 1]) this.box(0.02, 0.26, 0.5, sx * fw.span / 2, 0.17, fw.x + 0.25, M.carbon);
    // aileron arrière : deux éléments + dérives + mât
    const rw = S.rearWing, dR = (c.wingRear - c.wingRearRef);
    this.wing(rw.x + rw.chord, rw.y - 0.12, rw.chord, rw.span, 6 + dR * 1.0, M.carbon);
    this.wing(rw.x + rw.chord * 0.9, rw.y - 0.02, rw.chord * 0.55, rw.span, 24 + dR * 1.5, M.carbon);
    for (const sx of [-1, 1]) this.box(0.025, rw.y - 0.5, 0.62, sx * (rw.span / 2 + 0.012), (rw.y + 0.52) / 2 + 0.04, rw.x + 0.31, M.paint);
    this.box(0.05, rw.y - 0.35, 0.08, 0, (rw.y + 0.3) / 2, rw.x + 0.35, M.carbon);
    if (S.beamWing) this.wing(0.45, 0.36, 0.35, 0.9, 8, M.carbon);
    // feu arrière (pluie / freinage)
    this.rainLight = this.box(0.14, 0.08, 0.03, 0, 0.42, 0.18, M.rain);
    this.tailLights = [];
    // bras de suspension (fixés au châssis, visuellement)
    this.arms = [];
    for (const [xa, r, w] of [[S.xf, S.rF, S.wF], [S.xr, S.rR, S.wR]]) for (const sx of [-1, 1]) {
      for (const [dy, dz] of [[0.07, 0.25], [0.07, -0.25], [-0.07, 0.2], [-0.07, -0.2]]) {
        const a = new THREE.Vector3(sx * S.bodyW * 0.45, r + dy * 1.4, xa - this.xc + dz), b = new THREE.Vector3(sx * (S.track / 2 - w / 2 + 0.02), r + dy, xa - this.xc);
        const len = a.distanceTo(b);
        const arm = new THREE.Mesh(new THREE.CylinderGeometry(0.014, 0.014, len, 5), M.carbon);
        arm.position.copy(a).add(b).multiplyScalar(0.5); arm.lookAt(b); arm.rotateX(Math.PI / 2);
        this.root.add(arm);
      }
    }
  }

  buildClosed() {
    const S = this.S, M = this.M, c = this.car;
    if (S.family === 'proto') {
      // ailes (au-dessus des roues) + fuselage central plus bas, comme sur un prototype
      const fw = 0.56;
      for (const sx of [-1, 1]) this.extrude(S.body, fw, M.paint, 0.06, 0, sx * (S.width / 2 - fw / 2));
      const top = S.body.slice(S.body.findIndex(([x, y]) => x >= S.len - 1e-6 && y > 0.15));
      const topAt = (x) => { for (let j = 0; j < top.length - 1; j++) { const [x1, y1] = top[j], [x2, y2] = top[j + 1]; if ((x - x1) * (x - x2) <= 0) return y1 + (y2 - y1) * (x - x1) / (x2 - x1 || 1); } return top[top.length - 1][1]; };
      const yb = S.body[0][1], ctr = [];
      for (let k = 0; k <= 40; k++) {
        const x = S.len * (1 - k / 40);
        const lim = x > S.xf - 0.2 ? 0.5 : x < S.xr + 0.5 ? 0.66 : 0.58;
        ctr.push([x, Math.max(yb + 0.1, Math.min(topAt(x), lim))]);
      }
      this.extrude([[0, yb], [S.len, yb], ...ctr], S.width - 2 * fw + 0.1, M.paint, 0.05);
    } else {
      // GT : bas de caisse pleine largeur jusqu'à la ceinture de caisse, pavillon plus étroit et arrondi
      const belt = 0.9, top = S.body.slice(S.body.findIndex(([x, y]) => x >= S.len - 1e-6 && y > 0.15));
      const topAt = (x) => { for (let j = 0; j < top.length - 1; j++) { const [x1, y1] = top[j], [x2, y2] = top[j + 1]; if ((x - x1) * (x - x2) <= 0) return y1 + (y2 - y1) * (x - x1) / (x2 - x1 || 1); } return top[top.length - 1][1]; };
      const n = S.body.length - top.length;
      this.extrude(S.body.slice(0, n).concat(top.map(([x, y]) => [x, Math.min(y, belt)])), S.width, M.paint, 0.07);
      const roof = [];
      for (let k = 0; k <= 30; k++) { const x = 3.35 - k / 30 * 2.7; roof.push([x, Math.max(belt - 0.04, topAt(x))]); }
      this.greenW = 1.55;
      this.extrude([[0.65, belt - 0.04], [3.35, belt - 0.04], ...roof], this.greenW, M.paint, 0.12);
    }
    if (S.cabin) this.extrude(S.cabin, S.cabinW, M.paint, 0.08);
    // vitrages légèrement en surépaisseur pour affleurer
    const lift = pts => pts.map(([x, y]) => [x, y > 0.85 ? y + 0.025 : y]);
    this.extrude(lift(S.glass), (S.cabin ? S.cabinW : this.greenW) + 0.04, M.glass, 0.03);
    if (S.side) this.extrude(S.side, this.greenW + 0.03, M.glass, 0.02);
    if (S.fin) this.extrude(S.fin, 0.035, M.paint, 0.008);
    // lame avant, diffuseur, fond
    this.box(S.width - 0.1, 0.03, 0.4, 0, 0.07, S.len - 0.15, M.carbon);
    const dif = this.box(S.width - 0.3, 0.02, 0.55, 0, 0.16, 0.3, M.carbon); dif.rotation.x = 0.3;
    // aileron arrière et supports
    const rw = S.rearWing, dR = (c.wingRear - c.wingRearRef);
    this.wing(rw.x + rw.chord, rw.y, rw.chord, rw.span, 5 + dR * 1.2, M.carbon);
    for (const sx of [-1, 1]) this.box(0.02, 0.24, rw.chord + 0.1, sx * (rw.span / 2 + 0.01), rw.y + 0.03, rw.x + rw.chord / 2, M.paint);
    const topRear = Math.max(...S.body.filter(([x]) => x < 0.8).map(([, y]) => y));
    if (rw.pylons === 'swan') for (const sx of [-0.35, 0.35]) {
      const curve = new THREE.CatmullRomCurve3([new THREE.Vector3(sx, rw.y + 0.04, rw.x + 0.25 - this.xc), new THREE.Vector3(sx, rw.y + 0.1, rw.x + 0.45 - this.xc), new THREE.Vector3(sx, topRear - 0.02, rw.x + 0.6 - this.xc)]);
      this.body.add(new THREE.Mesh(new THREE.TubeGeometry(curve, 12, 0.018, 6), M.carbon));
    } else for (const sx of [-1, 1]) this.box(0.02, rw.y - topRear + 0.05, 0.4, sx * (rw.span / 2 - 0.05), (rw.y + topRear) / 2, rw.x + 0.25, M.carbon);
    // phares et feux
    const topAt = (x) => { let best = 0; for (let j = 0; j < S.body.length - 1; j++) { const [x1, y1] = S.body[j], [x2, y2] = S.body[j + 1]; if (y1 > 0.2 && y2 > 0.2 && (x - x1) * (x - x2) <= 0) best = Math.max(best, y1 + (y2 - y1) * (x - x1) / (x2 - x1 || 1)); } return best; };
    const lx = S.len - 0.3;
    for (const sx of [-1, 1]) {
      const h = this.box(0.34, 0.05, 0.24, sx * (S.width / 2 - 0.32), topAt(lx) - 0.01, lx, M.headL);
      h.rotation.x = 0.3;
    }
    this.tailLights = [this.box(S.width - 0.4, 0.04, 0.03, 0, S.lightsR.y, 0.01, M.tail)];
    this.rainLight = this.box(0.16, 0.08, 0.03, 0, S.lightsR.y - 0.12, 0.01, M.rain);
    this.arms = [];
    // phares de nuit
    if (this.env.night) {
      const sp = new THREE.SpotLight(0xfff4e0, 5000, 0, 0.5, 0.5, 2);
      sp.position.set(0, 0.6, S.len - this.xc); sp.target.position.set(0, 0, S.len - this.xc + 30);
      this.body.add(sp, sp.target);
    }
  }

  buildWheels() {
    const S = this.S, M = this.M, comp = COMPOUNDS[this.car.compound] || COMPOUNDS.soft;
    const stripe = mat(new THREE.Color(comp.color), 0.5, 0);
    this.wheels = [];
    for (const [z, r, w, front] of [[S.xf - this.xc, S.rF, S.wF, true], [S.xr - this.xc, S.rR, S.wR, false]]) {
      for (const sx of [1, -1]) {
        const steer = new THREE.Group(); steer.position.set(sx * (S.track / 2), r, z);
        const spin = new THREE.Group(); steer.add(spin);
        // pneu : profil arrondi en révolution
        const prof = [], rc = Math.min(0.06, w * 0.25);
        prof.push(new THREE.Vector2(r * 0.66, -w / 2));
        for (let k = 0; k <= 6; k++) { const a = -Math.PI / 2 + Math.PI / 2 * k / 6; prof.push(new THREE.Vector2(r - rc + rc * Math.cos(a), -w / 2 + rc + rc * Math.sin(a))); }
        for (let k = 0; k <= 6; k++) { const a = Math.PI / 2 * k / 6; prof.push(new THREE.Vector2(r - rc + rc * Math.cos(a), w / 2 - rc + rc * Math.sin(a))); }
        prof.push(new THREE.Vector2(r * 0.66, w / 2));
        const tg = new THREE.LatheGeometry(prof, 28); tg.rotateZ(Math.PI / 2);
        spin.add(new THREE.Mesh(tg, M.tyre));
        // jante, rayons, bande de couleur de la gomme, disque de frein
        const rim = new THREE.Mesh(new THREE.CylinderGeometry(r * 0.66, r * 0.66, w - 0.06, 24, 1, true), M.rim); rim.rotation.z = Math.PI / 2; spin.add(rim);
        const face = new THREE.Mesh(new THREE.CircleGeometry(r * 0.64, 24), M.dark); face.rotation.y = sx * Math.PI / 2; face.position.x = sx * (w / 2 - 0.05); spin.add(face);
        for (let k = 0; k < 5; k++) {
          const sp = new THREE.Mesh(new THREE.BoxGeometry(0.03, r * 1.2, 0.05), M.rim);
          sp.position.x = sx * (w / 2 - 0.035); sp.rotation.x = k * Math.PI / 5; spin.add(sp);
        }
        const ring = new THREE.Mesh(new THREE.TorusGeometry(r * 0.86, 0.012, 6, 36), stripe);
        ring.rotation.y = Math.PI / 2; ring.position.x = sx * (w / 2 - 0.005); spin.add(ring);
        const disc = new THREE.Mesh(new THREE.CylinderGeometry(r * 0.52, r * 0.52, 0.035, 20), M.disc);
        disc.rotation.z = Math.PI / 2; disc.position.x = -sx * 0.06; steer.add(disc);
        this.root.add(steer);
        this.wheels.push({ steer, spin, front, r });
      }
    }
  }

  // info = { v, ax, ay, brk, ride, bT: [avant, arrière], kappa, rain }
  update(info, dt) {
    const c = this.car, st = this.st;
    // cibles : tangage (freinage → piqué), roulis (vers l'extérieur du virage), écrasement aéro
    const pitchT = Math.max(-0.12, Math.min(0.12, -info.ax / G * this.pitchGain));
    const rollT = Math.max(-0.16, Math.min(0.16, info.ay / G * this.rollGain));
    const rideStatic = (c.rideFront + c.rideRear) / 2;
    const heaveT = Math.max(-0.08, Math.min(0.02, (info.ride - rideStatic) / 1000 * EXAG));
    // ressort-amortisseur du 2e ordre, sous-pas pour la stabilité
    const w = this.omega, z = this.zeta;
    let h = Math.min(0.1, Math.max(0, dt));
    const n = Math.max(1, Math.ceil(h / 0.004)); h /= n;
    for (let s = 0; s < n; s++) {
      st.pv += (w * w * (pitchT - st.pitch) - 2 * z * w * st.pv) * h; st.pitch += st.pv * h;
      st.rv += (w * w * (rollT - st.roll) - 2 * z * w * st.rv) * h; st.roll += st.rv * h;
      st.hv += (w * w * (heaveT - st.heave) - 2 * z * w * st.hv) * h; st.heave += st.hv * h;
    }
    this.bodyPivot.rotation.set(st.pitch, 0, st.roll, 'XZY');
    this.bodyPivot.position.y = c.cgHeight + st.heave;
    // roues : rotation et braquage (géométrie d'Ackermann, légèrement accentuée)
    const spin = info.v * dt;
    const steer = info.steer ?? Math.max(-0.5, Math.min(0.5, Math.atan(c.wheelbase * (info.kappa || 0)) * 1.6));
    for (const wh of this.wheels) {
      wh.spin.rotation.x += spin / wh.r;
      if (wh.front) wh.steer.rotation.y = steer;
    }
    // freins incandescents, feux stop, feu de pluie
    const hot = (T, carbon) => Math.max(0, Math.min(1, (T - (carbon ? 550 : 400)) / (carbon ? 450 : 350)));
    const carbon = c.brakeType === 'carbon';
    this.M.disc.emissiveIntensity = 2.5 * hot((info.bT[0] + info.bT[1]) / 2, carbon) ** 1.5;
    for (const tl of this.tailLights) tl.material.emissiveIntensity = info.brk > 0.05 ? 4 : 0.5;
    if (this.rainLight) this.rainLight.material.emissiveIntensity = info.rain ? (Math.floor(performance.now() / 180) % 2 ? 4 : 0.3) : (info.brk > 0.05 && !this.tailLights.length ? 3 : 0);
  }
}
