import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { rand, chance, clamp, smooth, lerp } from './util.js';

export const DEFS = {
  pistol: { name: 'P-9 Pistole', slot: 'pistol', dmg: 45, interval: 0.24, auto: false, cap: 8, spread: 0.012, ads: 0.004, kick: { p: 1.3, y: 0.5, z: 0.035 }, reload: 1.9, heat: 0.02, range: 70, sound: 'pistol', ammo: 'pistol' },
  mg: { name: 'MG-27 Maschinengewehr', slot: 'primary', dmg: 42, interval: 0.105, auto: true, capR: [25, 30], spread: 0.024, ads: 0.008, kick: { p: 1.05, y: 0.55, z: 0.05 }, reload: 2.7, heat: 0.034, range: 150, sound: 'mg', ammo: 'mg' },
  shotgun: { name: 'SG-12 Schrotflinte', slot: 'primary', dmg: 15, pellets: 8, interval: 0.95, auto: false, cap: 6, spread: 0.06, ads: 0.04, kick: { p: 4.2, y: 1.2, z: 0.1 }, reload: 0.62, heat: 0.14, range: 40, sound: 'shotgun', ammo: 'shotgun' },
  rpg: { name: 'RPG-7 Raketenwerfer', slot: 'primary', dmg: 220, interval: 1.2, auto: false, cap: 1, spread: 0.004, ads: 0.002, kick: { p: 5, y: 1, z: 0.14 }, reload: 3.4, heat: 0, range: 200, sound: 'rpg', ammo: 'rpg' },
};

let wid = 1;
export class Weapon {
  constructor(type, o = {}) {
    this.id = wid++; this.type = type; this.def = DEFS[type];
    this.cap = this.def.cap || Math.floor(rand(this.def.capR[0], this.def.capR[1] + 1));
    this.mag = o.mag ?? this.cap; this.sup = !!o.sup; this.barrel = !!o.barrel;
    this.heat = 0; this.heatLock = 0; this.model = null; this.cool = 0; this.hotProne = Math.random() < 0.6;
  }
  get ammoType() { return this.def.ammo; }
  get slot() { return this.def.slot; }
}

// ---------- shared materials
const M = {};
function mats() {
  if (M.metal) return M;
  M.metal = new THREE.MeshStandardMaterial({ color: 0x4a4e50, roughness: 0.5, metalness: 0.7 });
  M.poly = new THREE.MeshStandardMaterial({ color: 0x2c2d2c, roughness: 0.7, metalness: 0.05 });
  M.wood = new THREE.MeshStandardMaterial({ color: 0x5a3a22, roughness: 0.55, metalness: 0.0 });
  M.tan = new THREE.MeshStandardMaterial({ color: 0x5b5240, roughness: 0.8, metalness: 0.1 });
  M.steel = new THREE.MeshStandardMaterial({ color: 0x8a8e90, roughness: 0.4, metalness: 0.85 });
  M.bullet = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.3, metalness: 0.95 });
  M.shell = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.5, metalness: 0.4 });
  M.glassTube = new THREE.MeshStandardMaterial({ color: 0x9fb0b8, roughness: 0.1, metalness: 0.1, transparent: true, opacity: 0.2, depthWrite: false });
  M.lens = new THREE.MeshBasicMaterial({ color: 0xfff2c0 });
  M.olive = new THREE.MeshStandardMaterial({ color: 0x3b4326, roughness: 0.6, metalness: 0.3 });
  M.blade = new THREE.MeshStandardMaterial({ color: 0xb9bdc0, roughness: 0.25, metalness: 1.0 });
  return M;
}
const _box = (w, h, d, mat, x = 0, y = 0, z = 0, p = null) => { const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat); m.position.set(x, y, z); if (p) p.add(m); return m; };
const _cyl = (r, len, mat, x, y, z, p, r2 = null) => { const m = new THREE.Mesh(new THREE.CylinderGeometry(r, r2 ?? r, len, 14), mat); m.rotation.x = Math.PI / 2; m.position.set(x, y, z); if (p) p.add(m); return m; };

let bulletGeo, shellGeo;
function bulletGeometry() {
  if (bulletGeo) return bulletGeo;
  const col = (g, c) => { const n = g.attributes.position.count, a = new Float32Array(n * 3); for (let i = 0; i < n; i++) { a[i * 3] = c[0]; a[i * 3 + 1] = c[1]; a[i * 3 + 2] = c[2]; } g.setAttribute('color', new THREE.BufferAttribute(a, 3)); return g; };
  const casing = new THREE.CylinderGeometry(0.0046, 0.0052, 0.034, 8); casing.rotateX(Math.PI / 2); casing.translate(0, 0, 0.008);
  const tip = new THREE.CylinderGeometry(0.0012, 0.0046, 0.017, 8); tip.rotateX(Math.PI / 2); tip.translate(0, 0, -0.0175);
  bulletGeo = mergeGeometries([col(casing, [0.8, 0.6, 0.2]), col(tip, [0.62, 0.34, 0.2])]);
  const sc = new THREE.CylinderGeometry(0.0095, 0.0095, 0.05, 10); sc.rotateX(Math.PI / 2); sc.translate(0, 0, -0.01);
  const base = new THREE.CylinderGeometry(0.0098, 0.0098, 0.018, 10); base.rotateX(Math.PI / 2); base.translate(0, 0, 0.024);
  shellGeo = mergeGeometries([col(sc, [0.75, 0.1, 0.08]), col(base, [0.78, 0.62, 0.25])]);
  return bulletGeo;
}
export function bulletGeo9() { bulletGeometry(); return bulletGeo; }

// Magazine with open side walls so the rounds are really visible.
function buildMag(kind, cap) {
  mats(); bulletGeometry();
  const g = new THREE.Group();
  const rifle = kind === 'rifle';
  const w = rifle ? 0.036 : 0.022, d = rifle ? 0.056 : 0.034, sp = rifle ? 0.0068 : 0.0108;
  const H = cap * sp + 0.02;
  _box(w, H, 0.004, M.metal, 0, -H / 2, d / 2, g); _box(w, H, 0.004, M.metal, 0, -H / 2, -d / 2, g); // spine plates
  _box(w + 0.004, 0.008, d + 0.004, M.metal, 0, -H, 0, g); // base plate
  _box(0.003, H, d, M.metal, w / 2, -H / 2, 0, g).visible = kind === 'rifle' ? false : true; // pistol: right side wall only
  const im = new THREE.InstancedMesh(rifle ? bulletGeo : bulletGeo, M.bullet, cap);
  const m = new THREE.Matrix4();
  for (let i = 0; i < cap; i++) { m.makeTranslation((i % 2 ? 1 : -1) * (rifle ? 0.0045 : 0.003), -H + 0.012 + i * sp, rifle ? -0.004 : -0.006); const s = rifle ? 1 : 0.8; m.scale(new THREE.Vector3(s, s, s)); im.setMatrixAt(i, m); }
  im.instanceMatrix.needsUpdate = true; im.frustumCulled = false; im.count = cap;
  g.add(im);
  return { group: g, bullets: im, cap, H, setCount(n) { im.count = clamp(Math.floor(n), 0, cap); } };
}

// ---------- gun model builders (forward = -Z, origin near trigger / pistol grip)
export function buildGun(weapon) {
  mats(); bulletGeometry();
  const type = weapon.type, g = new THREE.Group(), o = { group: g, type };
  o.muzzle = new THREE.Object3D(); o.eject = new THREE.Object3D(); g.add(o.muzzle, o.eject);
  o.flashPos = new THREE.Vector3(); o.flashlight = new THREE.Object3D(); g.add(o.flashlight);
  if (type === 'mg') {
    _box(0.052, 0.082, 0.4, M.metal, 0, 0.012, -0.1, g); _box(0.056, 0.058, 0.3, M.poly, 0, 0.004, -0.42, g); _box(0.03, 0.02, 0.3, M.metal, 0, 0.06, -0.3, g);
    const barrel = _cyl(0.011, 0.34, M.steel, 0, 0.01, -0.74, g); o.barrelMat = barrel.material = M.steel.clone();
    _cyl(0.015, 0.06, M.metal, 0, 0.01, -0.9, g);
    _cyl(0.007, 0.28, M.metal, 0, 0.052, -0.5, g);
    _box(0.042, 0.092, 0.24, M.poly, 0, -0.005, 0.28, g); _box(0.044, 0.1, 0.02, M.poly, 0, -0.005, 0.4, g);
    const gr = _box(0.034, 0.105, 0.046, M.poly, 0, -0.085, 0.07, g); gr.rotation.x = 0.28;
    _box(0.03, 0.012, 0.09, M.metal, 0, -0.042, -0.0, g); // trigger guard
    _box(0.004, 0.032, 0.004, M.metal, 0, 0.082, -0.84, g); // front sight
    _box(0.004, 0.022, 0.004, M.metal, -0.012, 0.075, 0.03, g); _box(0.004, 0.022, 0.004, M.metal, 0.012, 0.075, 0.03, g); // rear sight
    o.bolt = _box(0.022, 0.02, 0.05, M.metal, 0.036, 0.03, -0.09, g); o.boltRest = o.bolt.position.z;
    o.mag = buildMag('rifle', weapon.cap); o.magRest = new THREE.Vector3(0, -0.04, -0.12); o.mag.group.position.copy(o.magRest); g.add(o.mag.group);
    o.gripR = new THREE.Vector3(0, -0.085, 0.07); o.gripL = new THREE.Vector3(0, -0.035, -0.38); o.magWell = new THREE.Vector3(0, -0.07, -0.12);
    o.sight = new THREE.Vector3(0, 0.086, 0.03); o.muzzleBase = -0.93; o.boltPos = new THREE.Vector3(0.04, 0.03, -0.09);
    o.supp = _cyl(0.024, 0.24, M.poly, 0, 0.01, -1.04, g); o.long = _cyl(0.014, 0.2, M.steel, 0, 0.01, -1.02, g); o.suppLen = -0.25; o.longLen = -0.2;
    _box(0.026, 0.024, 0.07, M.poly, 0, -0.03, -0.46, g); const lens = _cyl(0.009, 0.01, M.lens, 0, -0.03, -0.5, g); o.flashlight.position.set(0, -0.03, -0.5);
  } else if (type === 'pistol') {
    o.slide = _box(0.03, 0.034, 0.2, M.metal, 0, 0.034, -0.07, g); o.slideRest = o.slide.position.z; o.bolt = o.slide;
    _box(0.027, 0.02, 0.17, M.poly, 0, 0.008, -0.06, g);
    const br = _cyl(0.007, 0.03, M.steel, 0, 0.034, -0.185, g); o.barrelMat = br.material = M.steel.clone();
    const gr = _box(0.03, 0.105, 0.046, M.poly, 0, -0.055, 0.025, g); gr.rotation.x = 0.16;
    _box(0.022, 0.012, 0.06, M.poly, 0, -0.012, -0.03, g);
    _box(0.004, 0.012, 0.004, M.metal, 0, 0.056, -0.165, g); _box(0.016, 0.01, 0.004, M.metal, 0, 0.056, 0.02, g);
    o.mag = buildMag('pistol', weapon.cap); o.magRest = new THREE.Vector3(0, -0.01, 0.025); o.mag.group.position.copy(o.magRest); o.mag.group.rotation.x = 0.16; g.add(o.mag.group);
    o.gripR = new THREE.Vector3(0.005, -0.03, 0.03); o.gripL = new THREE.Vector3(-0.025, -0.07, 0.02); o.magWell = new THREE.Vector3(0, -0.13, 0.04);
    o.sight = new THREE.Vector3(0, 0.062, 0.02); o.muzzleBase = -0.19; o.boltPos = new THREE.Vector3(0.02, 0.04, -0.05);
    o.supp = _cyl(0.0165, 0.17, M.poly, 0, 0.034, -0.265, g); o.long = null; o.suppLen = -0.17; o.longLen = 0;
  } else if (type === 'shotgun') {
    _box(0.046, 0.072, 0.24, M.metal, 0, 0.012, -0.05, g);
    const barrel = _cyl(0.0135, 0.55, M.steel, 0, 0.028, -0.44, g); o.barrelMat = barrel.material = M.steel.clone();
    const tube = _cyl(0.0125, 0.5, M.glassTube, 0, -0.004, -0.46, g); // see-through magazine tube
    _cyl(0.003, 0.5, M.metal, 0, 0.012, -0.46, g);
    o.pump = _box(0.054, 0.048, 0.15, M.wood, 0, -0.01, -0.4, g); o.pumpRest = o.pump.position.z;
    _box(0.042, 0.095, 0.25, M.wood, 0, -0.02, 0.2, g); const gr = _box(0.034, 0.1, 0.045, M.wood, 0, -0.075, 0.07, g); gr.rotation.x = 0.3;
    _box(0.003, 0.012, 0.003, M.metal, 0, 0.05, -0.72, g); _box(0.012, 0.006, 0.02, M.metal, 0, 0.052, 0.03, g);
    o.bolt = null;
    const sh = new THREE.InstancedMesh(shellGeo, M.shell, 6); const m = new THREE.Matrix4();
    for (let i = 0; i < 6; i++) { m.makeTranslation(0, -0.004, -0.66 + i * 0.062 + 0.0); sh.setMatrixAt(i, m); }
    sh.frustumCulled = false; sh.count = weapon.mag; g.add(sh); o.shells = sh;
    o.handShell = new THREE.Mesh(shellGeo, M.shell); o.handShell.visible = false; g.add(o.handShell);
    o.gripR = new THREE.Vector3(0, -0.075, 0.07); o.gripL = new THREE.Vector3(0, -0.04, -0.4); o.magWell = new THREE.Vector3(0, -0.05, -0.1);
    o.sight = new THREE.Vector3(0, 0.056, 0.03); o.muzzleBase = -0.72; o.boltPos = new THREE.Vector3(0.03, 0.02, -0.1);
    o.supp = _cyl(0.022, 0.2, M.poly, 0, 0.028, -0.82, g); o.long = null; o.suppLen = -0.2; o.longLen = 0;
    _box(0.026, 0.024, 0.07, M.poly, 0, -0.045, -0.26, g); o.flashlight.position.set(0, -0.045, -0.3);
  } else if (type === 'rpg') {
    const tube = _cyl(0.046, 0.95, M.olive, 0, 0.02, -0.25, g); o.barrelMat = null;
    _cyl(0.06, 0.1, M.olive, 0, 0.02, 0.26, g, 0.036); _cyl(0.05, 0.08, M.metal, 0, 0.02, -0.74, g, 0.048);
    _box(0.034, 0.1, 0.05, M.poly, 0, -0.07, 0.0, g); _box(0.03, 0.09, 0.04, M.poly, 0, -0.08, -0.28, g);
    _box(0.03, 0.05, 0.12, M.metal, 0.05, 0.08, -0.05, g);
    o.rocket = new THREE.Group();
    _cyl(0.033, 0.3, M.olive, 0, 0.02, -0.86, o.rocket); const cone = _cyl(0.001, 0.14, M.tan, 0, 0.02, -1.08, o.rocket, 0.033); cone.rotation.x = -Math.PI / 2;
    g.add(o.rocket);
    o.gripR = new THREE.Vector3(0, -0.07, 0.0); o.gripL = new THREE.Vector3(0, -0.08, -0.28); o.magWell = new THREE.Vector3(0, 0.02, -0.72);
    o.sight = new THREE.Vector3(0.05, 0.12, -0.05); o.muzzleBase = -0.75; o.boltPos = new THREE.Vector3(0, 0.02, -0.7);
    o.supp = null; o.long = null; o.mag = null; o.suppLen = 0; o.longLen = 0;
  }
  if (o.supp) { o.supp.visible = false; o.supp.material = M.poly; }
  if (o.long) o.long.visible = false;
  o.update = (w) => {
    if (o.supp) o.supp.visible = !!w.sup;
    if (o.long) o.long.visible = !!w.barrel && !w.sup;
    o.muzzle.position.set(0, type === 'pistol' ? 0.034 : type === 'rpg' ? 0.02 : type === 'shotgun' ? 0.028 : 0.01, o.muzzleBase + (w.sup ? o.suppLen : 0) + (w.barrel && !w.sup ? o.longLen : 0));
    o.eject.position.set(0.03, 0.035, type === 'pistol' ? -0.05 : -0.1);
    if (o.mag) o.mag.setCount(w.mag);
    if (o.shells) o.shells.count = w.mag;
    if (o.rocket) o.rocket.visible = w.mag > 0;
    if (o.barrelMat) { const h = clamp(w.heat, 0, 1); o.barrelMat.emissive.setRGB(h * h * 1.6, h * h * 0.45, h * h * 0.05); o.barrelMat.emissiveIntensity = 1; }
  };
  o.update(weapon);
  g.traverse((c) => { if (c.isMesh || c.isInstancedMesh) { c.castShadow = false; c.receiveShadow = false; } });
  return o;
}

export function buildKnife() {
  mats();
  const g = new THREE.Group();
  _box(0.024, 0.026, 0.11, M.poly, 0, 0, 0.02, g); _box(0.012, 0.05, 0.012, M.metal, 0, 0, -0.04, g);
  const s = new THREE.Shape(); s.moveTo(0, -0.012); s.lineTo(0.17, -0.012); s.lineTo(0.2, 0.0); s.lineTo(0.17, 0.014); s.lineTo(0, 0.014); s.closePath();
  const bl = new THREE.Mesh(new THREE.ExtrudeGeometry(s, { depth: 0.004, bevelEnabled: false }), M.blade);
  bl.rotation.y = Math.PI / 2; bl.rotation.z = Math.PI / 2; bl.position.set(0.002, 0, -0.045); g.add(bl);
  const o = { group: g, type: 'knife', gripR: new THREE.Vector3(0, 0, 0.02), gripL: new THREE.Vector3(-0.1, -0.05, 0.05), muzzle: new THREE.Object3D(), tip: new THREE.Vector3(0, 0, -0.25) };
  o.muzzle.position.copy(o.tip); g.add(o.muzzle);
  return o;
}

export function buildGrenadeMesh() {
  mats(); const g = new THREE.Group();
  const b = new THREE.Mesh(new THREE.SphereGeometry(0.036, 12, 10), M.olive); b.scale.set(1, 1.2, 1); g.add(b);
  _box(0.018, 0.02, 0.018, M.metal, 0, 0.05, 0, g); _box(0.008, 0.05, 0.012, M.metal, 0.02, 0.04, 0, g);
  for (let i = 0; i < 3; i++) { const r = new THREE.Mesh(new THREE.TorusGeometry(0.0365, 0.002, 4, 14), M.metal); r.rotation.x = Math.PI / 2; r.position.y = -0.02 + i * 0.02; g.add(r); }
  return g;
}

// ---------- Reload / action animation timelines (shared by player view model and NPCs)
const V = (x, y, z) => new THREE.Vector3(x, y, z);
function keyLerp(keys, t) {
  if (t <= keys[0][0]) return keys[0][1].clone();
  for (let i = 1; i < keys.length; i++) {
    if (t <= keys[i][0]) {
      const [t0, a] = keys[i - 1], [t1, b] = keys[i]; let u = (t - t0) / Math.max(1e-4, t1 - t0); u = u * u * (3 - 2 * u);
      return a.clone().lerp(b, u);
    }
  }
  return keys[keys.length - 1][1].clone();
}
const bump = (t, a, b, r) => smooth(a, a + r, t) * (1 - smooth(b - r, b, t));

export class ReloadAnim {
  // variant: 'normal' | 'fumble' | 'dropmag'
  constructor(gun, weapon, speed = 1, fumbleChance = 0.22, loadAmount = 0) {
    this.type = weapon.type; this.gun = gun; this.t = 0; this.events = []; this.fired = new Set(); this.loadAmount = loadAmount;
    this.variant = 'normal'; this.cancel = false;
    const s = speed, g = gun;
    const fore = g.gripL.clone(), mw = g.magWell.clone();
    if (this.type === 'shotgun') {
      this.pouch = V(-0.2, -0.22, 0.12); const port = V(0, -0.045, -0.13);
      const f = chance(fumbleChance);
      this.variant = f ? 'fumble' : 'normal';
      const T = 0.64 * s;
      if (!f) { this.keys = [[0, fore], [0.2 * s, this.pouch], [0.36 * s, this.pouch.clone().add(V(0.01, 0.0, 0))], [0.52 * s, port], [T, fore]]; this.events = [[0.2 * s, 'take'], [0.52 * s, 'load']]; this.dur = T; }
      else { this.keys = [[0, fore], [0.2 * s, this.pouch], [0.34 * s, port.clone().add(V(0.03, -0.03, 0))], [0.44 * s, port.clone().add(V(0.04, -0.16, 0.0))], [0.62 * s, this.pouch], [0.8 * s, port], [0.95 * s, fore]]; this.events = [[0.2 * s, 'take'], [0.4 * s, 'dropshell'], [0.62 * s, 'take'], [0.8 * s, 'load']]; this.dur = 0.96 * s; }
      this.tilt = { pitch: 0.12, roll: -0.18, x: 0, y: 0, z: 0 };
      this.tiltRange = [0, this.dur, 0.1];
    } else if (this.type === 'rpg') {
      this.pouch = V(-0.25, -0.3, 0.3);
      this.keys = [[0, fore], [0.6 * s, mw.clone().add(V(0, 0, 0.0))], [1.0 * s, this.pouch], [1.5 * s, this.pouch.clone().add(V(0, 0, 0.0))], [2.1 * s, mw.clone().add(V(0, 0, 0.12))], [2.6 * s, mw], [3.0 * s, fore]];
      this.events = [[0.6 * s, 'magout'], [1.5 * s, 'take'], [2.3 * s, 'magin']]; this.dur = 3.1 * s;
      this.tilt = { pitch: -0.15, roll: -0.12, x: 0, y: 0.03, z: 0 }; this.tiltRange = [0.2 * s, 2.9 * s, 0.35];
    } else {
      const pistol = this.type === 'pistol';
      this.pouch = pistol ? V(-0.1, -0.2, 0.15) : V(-0.21, -0.28, 0.22);
      const bolt = g.boltPos.clone(), pull = mw.clone().add(V(0, -0.09, 0.0));
      const r = Math.random();
      this.variant = r < fumbleChance * 0.35 ? 'dropmag' : r < fumbleChance ? 'fumble' : 'normal';
      const k = pistol ? 0.7 : 1; // pistol faster
      let K, E;
      const near = mw.clone().add(V(0, -0.02, 0));
      if (this.variant === 'normal') {
        K = [[0, fore], [0.3, near], [0.5, pull], [0.8, this.pouch], [1.2, this.pouch], [1.6, mw.clone().add(V(0, -0.1, 0))], [1.78, mw], [2.0, mw], [2.2, bolt], [2.38, bolt.clone().add(V(0, 0, 0.05))], [2.6, fore]];
        E = [[0.42, 'magout'], [0.58, 'drop'], [1.18, 'take'], [1.8, 'magin'], [2.25, 'bolt']]; this.dur = 2.7;
      } else if (this.variant === 'fumble') { // first insertion misses
        K = [[0, fore], [0.3, near], [0.5, pull], [0.8, this.pouch], [1.2, this.pouch], [1.55, mw.clone().add(V(0.03, -0.1, 0))], [1.7, mw.clone().add(V(0.035, -0.04, 0.01))], [1.95, mw.clone().add(V(0.0, -0.2, 0.0))], [2.35, mw.clone().add(V(0, -0.09, 0))], [2.55, mw], [2.8, mw], [3.0, bolt], [3.2, bolt.clone().add(V(0, 0, 0.05))], [3.45, fore]];
        E = [[0.42, 'magout'], [0.58, 'drop'], [1.18, 'take'], [1.72, 'fumble'], [2.58, 'magin'], [3.05, 'bolt']]; this.dur = 3.55;
      } else { // new mag slips out of the hand and falls
        K = [[0, fore], [0.3, near], [0.5, pull], [0.8, this.pouch], [1.2, this.pouch], [1.6, mw.clone().add(V(0, -0.1, 0))], [1.8, mw.clone().add(V(0.02, -0.04, 0))], [2.1, this.pouch.clone().add(V(0, 0.03, 0))], [2.5, this.pouch], [2.95, mw.clone().add(V(0, -0.1, 0))], [3.15, mw], [3.4, mw], [3.6, bolt], [3.8, bolt.clone().add(V(0, 0, 0.05))], [4.05, fore]];
        E = [[0.42, 'magout'], [0.58, 'drop'], [1.18, 'take'], [1.85, 'dropnew'], [2.5, 'take'], [3.18, 'magin'], [3.65, 'bolt']]; this.dur = 4.15;
      }
      const sc = s * k;
      this.keys = K.map(([t, v]) => [t * sc, v]); this.events = E.map(([t, e]) => [t * sc, e]); this.dur *= sc;
      this.tilt = pistol ? { pitch: 0.28, roll: -0.5, x: -0.02, y: 0.03, z: 0.02 } : { pitch: 0.2, roll: -0.42, x: -0.02, y: 0.03, z: 0.04 };
      this.tiltRange = [0.05, this.dur - 0.3 * sc, 0.28];
    }
    this.magState = 'in'; this.magCount = 0;
  }
  // returns { hand: Vector3 gun-local, tilt:{pitch,roll,x,y,z}, done }
  sample(t) {
    const hand = keyLerp(this.keys, t);
    const [a, b, r] = this.tiltRange, w = bump(t, a, b, r);
    const T = this.tilt;
    return { hand, w, pitch: T.pitch * w, roll: T.roll * w, x: T.x * w, y: T.y * w, z: T.z * w, done: t >= this.dur };
  }
  // call each frame; returns list of events newly passed
  advance(dt) {
    const prev = this.t; this.t += dt; const out = [];
    for (const [te, e] of this.events) if (te > prev && te <= this.t) out.push(e);
    return out;
  }
}

// Overheating: the supporting hand jerks away from the hot handguard, shakes, then goes back.
export class OverheatAnim {
  constructor(gun) { this.t = 0; this.dur = 2.1; this.gun = gun; this.fore = gun.gripL.clone(); }
  advance(dt) { const p = this.t; this.t += dt; return p < 0.01 && this.t >= 0.01 ? ['overheat'] : []; }
  sample() {
    const t = this.t, f = this.fore, away = f.clone().add(V(-0.13, 0.08, 0.2));
    let hand;
    if (t < 0.18) hand = f.clone().lerp(away, smooth(0, 0.18, t));
    else if (t < 1.6) { const k = t - 0.18; hand = away.clone().add(V(Math.sin(k * 38) * 0.018, Math.sin(k * 31 + 1) * 0.026, Math.sin(k * 24) * 0.018)); }
    else hand = away.clone().lerp(f, smooth(1.6, 2.1, t));
    const w = bump(t, 0, this.dur, 0.2);
    return { hand, shake: t > 0.18 && t < 1.6, w, pitch: -0.06 * w, roll: 0.05 * w, done: t >= this.dur };
  }
}
export const knifeSwing = (t) => { // t 0..1 stab/slash
  const a = Math.sin(clamp(t, 0, 1) * Math.PI);
  return { z: -0.32 * a, x: -0.12 * a, y: 0.05 * a, roll: 0.9 * a, pitch: 0.5 * a * (t < 0.5 ? 1 : 0) };
};
