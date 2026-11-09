import * as THREE from 'three';
import { clamp, lerp, rand, pick, chance, smooth, windU, damp } from './util.js';
import * as T from './terrain.js';
import { camoTex, flagTex } from './textures.js';
import { buildGun, buildKnife, Weapon, ReloadAnim, OverheatAnim } from './weapons.js';

const SKINS = [0xf0c8a8, 0xe6b592, 0xd49d74, 0xb27a52, 0x8a5a38, 0x5e3a22];
const EYES = [[0x3a2210, 'braun'], [0x3f78b8, 'blau'], [0x4a8a4a, 'grün']];
const HAIRS = [0x0e0c0b, 0x2a1b12, 0x4a3020, 0x8a6a3a, 0xc9a85a, 0x7a3a1c, 0x8d8d8a];

// ---------- shared resources
let R = null;
function res() {
  if (R) return R;
  const sph = new THREE.SphereGeometry(1, 10, 8);
  const mk = (c, r = 0.85, m = 0.05) => new THREE.MeshStandardMaterial({ color: c, roughness: r, metalness: m });
  R = {
    sph, box: new THREE.BoxGeometry(1, 1, 1),
    uni: [null, 1, 2].map((t) => (t ? new THREE.MeshStandardMaterial({ map: R2(t), roughness: 0.92, side: THREE.DoubleSide }) : null)),
    boot: mk(0x111111, 0.85, 0.0), glove: mk(0x151515, 0.8), black: mk(0x0a0a0a, 1.0, 0), white: mk(0xf2f2f2, 0.3),
    helm: [null, mk(0x2c3a26, 0.7), mk(0x070707, 1.0, 0)],
    pack: [null, mk(0x3d4429, 0.95), mk(0x2e2423, 0.95)],
    vest: { light: mk(0x4e4a3a, 0.9), medium: mk(0x2a2c2b, 0.85), heavy: mk(0x1c1e1f, 0.8) },
    flag: [null, new THREE.MeshStandardMaterial({ map: flagTex('usa'), roughness: 0.8 }), new THREE.MeshStandardMaterial({ map: flagTex('rus'), roughness: 0.8 })],
    goggle: new THREE.MeshStandardMaterial({ color: 0x1b2a30, roughness: 0.1, metalness: 0.6 }),
    mouth: mk(0x6a2a2a, 0.6), irisGeo: new THREE.CircleGeometry(0.0078, 12), eyeGeo: new THREE.SphereGeometry(0.0125, 8, 6),
    helmGeo: new THREE.SphereGeometry(0.126, 16, 10, 0, Math.PI * 2, 0, Math.PI * 0.62),
    collarGeo: new THREE.SphereGeometry(0.108, 14, 8, 0, Math.PI * 2, Math.PI * 0.55, Math.PI * 0.32),
    capGeo: new THREE.SphereGeometry(0.11, 14, 8, 0, Math.PI * 2, 0, Math.PI * 0.55),
    skinMats: new Map(), irisMats: new Map(), hairMats: new Map(),
  };
  return R;
}
export const uniMat = (team) => res().uni[team];
export const gloveMat = () => res().glove;
const CAMO_CACHE = {};
function R2(t) { return CAMO_CACHE[t] || (CAMO_CACHE[t] = camoTex(t)); }
const skinMat = (c) => { const r = res(); if (!r.skinMats.has(c)) r.skinMats.set(c, new THREE.MeshStandardMaterial({ color: c, roughness: 0.62, metalness: 0 })); return r.skinMats.get(c); };
const irisMat = (c) => { const r = res(); if (!r.irisMats.has(c)) r.irisMats.set(c, new THREE.MeshStandardMaterial({ color: c, roughness: 0.2, side: THREE.DoubleSide })); return r.irisMats.get(c); };
const hairMat = (c) => { const r = res(); if (!r.hairMats.has(c)) r.hairMats.set(c, new THREE.MeshStandardMaterial({ color: c, roughness: 0.55 })); return r.hairMats.get(c); };

const UP = new THREE.Vector3(0, 1, 0);
const _a = new THREE.Vector3(), _b = new THREE.Vector3(), _c = new THREE.Vector3(), _d = new THREE.Vector3(), _p1 = new THREE.Vector3(), _p2 = new THREE.Vector3(), _vd = new THREE.Vector3(), _m = new THREE.Matrix4();
const _q = new THREE.Quaternion(), _e = new THREE.Euler(0, 0, 0, 'YXZ');

export function place(mesh, a, b, r, k = 0.56) {
  _d.subVectors(b, a); const len = Math.max(1e-4, _d.length());
  mesh.position.addVectors(a, b).multiplyScalar(0.5);
  mesh.quaternion.setFromUnitVectors(UP, _d.multiplyScalar(1 / len));
  mesh.scale.set(r, len * k, r);
}
// two-bone IK: returns knee/elbow position
export function ik2(a, t, l1, l2, pole, out, outTarget) {
  _a.subVectors(t, a); let dist = _a.length(); const maxd = (l1 + l2) * 0.998;
  if (dist > maxd) dist = maxd; if (dist < 0.05) dist = 0.05;
  _a.normalize();
  const x = (l1 * l1 + dist * dist - l2 * l2) / (2 * dist), y = Math.sqrt(Math.max(l1 * l1 - x * x, 0));
  _b.copy(pole).addScaledVector(_a, -pole.dot(_a)); if (_b.lengthSq() < 1e-6) _b.set(0, 0, 1); _b.normalize();
  out.copy(a).addScaledVector(_a, x).addScaledVector(_b, y);
  if (outTarget) outTarget.copy(a).addScaledVector(_a, dist);
  return out;
}

export function randomAppearance(team, female) {
  const tall = chance(0.38);
  const height = female ? rand(1.7, 1.8) : tall ? rand(1.88, 1.92) : rand(1.7, 1.88);
  const eye = pick(EYES);
  const hairStyle = female ? pick(['long', 'ponytail', 'long', 'medium']) : pick(['short', 'short', 'buzz', 'medium', 'long']);
  const skin = pick(SKINS);
  const hairColor = skin < 0x8a5a38 + 1 && skin >= 0x5e3a22 ? pick([HAIRS[0], HAIRS[1]]) : pick(HAIRS);
  return { height, skin, eye: eye[0], hairStyle, hairColor, equip: pick(['light', 'medium', 'heavy', 'light']), mask: pick(['none', 'none', 'goggles', 'balaclava']) };
}

let cid = 1;
export class Character {
  constructor(o) {
    const r = res();
    this.id = cid++; this.team = o.team; this.name = o.name; this.female = !!o.female; this.isPlayer = !!o.isPlayer;
    this.app = o.app; this.s = o.app.height / 1.8; this.traits = o.traits || {};
    this.pos = new THREE.Vector3(); this.vel = new THREE.Vector3(); this.yaw = 0; this.aimPitch = 0; this.bodyYaw = 0;
    this.hp = 100; this.maxHp = 100; this.alive = true; this.crouch = 0; this.crouchT = 0; this.onGround = true;
    this.armor = { light: 1.0, medium: 0.95, heavy: 0.9 }[o.app.equip];
    this.weapons = { primary: null, pistol: null }; this.cur = 'primary'; this.ammo = { mg: 0, shotgun: 0, pistol: 0, rpg: 0 };
    this.hasKnife = true; this.grenades = 1; this.knifeModel = null;
    this.phase = Math.random() * 6; this.stumble = 0; this.flinch = 0; this.recoil = 0; this.aimBlend = 0.2; this.reload = null; this.overheat = null;
    this.swing = 0; this.stepDist = 0; this.moveSpeed = 0; this.ragdoll = null; this.deadT = 0; this.lastDamageT = 0;
    this.radius = 0.38; this.stamina = 1; this.flashOn = false;
    // rig
    const g = this.group = new THREE.Group(); g.visible = true;
    const skin = skinMat(o.app.skin), uni = r.uni[this.team];
    this.limbs = {};
    const L = (name, mat, rad) => { const m = new THREE.Mesh(r.sph, mat); m.castShadow = true; m.userData.r = rad * this.s * (this.female ? 0.9 : 1); g.add(m); this.limbs[name] = m; return m; };
    L('uaL', uni, 0.058); L('uaR', uni, 0.058); L('faL', uni, 0.048); L('faR', uni, 0.048);
    L('thL', uni, 0.085); L('thR', uni, 0.085); L('shL', uni, 0.064); L('shR', uni, 0.064);
    this.handL = new THREE.Mesh(r.box, r.glove); this.handR = new THREE.Mesh(r.box, r.glove); this.handL.scale.set(0.085, 0.05, 0.1).multiplyScalar(this.s); this.handR.scale.copy(this.handL.scale);
    this.bootL = new THREE.Mesh(r.box, r.boot); this.bootR = new THREE.Mesh(r.box, r.boot); this.bootL.scale.set(0.105, 0.11, 0.28).multiplyScalar(this.s); this.bootR.scale.copy(this.bootL.scale);
    for (const m of [this.handL, this.handR, this.bootL, this.bootR]) { m.castShadow = true; g.add(m); }
    // torso group (local: x right, y up, z back)
    const tg = this.torsoG = new THREE.Group(); g.add(tg); const s = this.s, fw = this.female ? 0.92 : 1;
    const torso = new THREE.Mesh(r.box, uni); torso.scale.set(0.36 * fw * s, 0.56 * s, 0.2 * s); torso.castShadow = true; tg.add(torso);
    const pelv = new THREE.Mesh(r.box, uni); pelv.scale.set(0.33 * fw * s, 0.2 * s, 0.19 * s); pelv.position.y = -0.34 * s; pelv.castShadow = true; tg.add(pelv);
    const neck = new THREE.Mesh(r.sph, skin); neck.scale.set(0.05 * s, 0.07 * s, 0.05 * s); neck.position.y = 0.31 * s; tg.add(neck);
    const vm = r.vest[o.app.equip], eq = o.app.equip;
    const vest = new THREE.Mesh(r.box, vm); vest.scale.set((eq === 'heavy' ? 0.42 : 0.4) * fw * s, (eq === 'light' ? 0.34 : 0.44) * s, 0.25 * s); vest.position.set(0, 0.04 * s, -0.01 * s); vest.castShadow = true; tg.add(vest);
    for (let i = -1; i <= 1; i++) { const p = new THREE.Mesh(r.box, vm); p.scale.set(0.09 * s, 0.11 * s, 0.05 * s); p.position.set(i * 0.11 * s, -0.07 * s, -0.14 * s); tg.add(p); }
    if (eq !== 'light') { for (const sx of [-1, 1]) { const pad = new THREE.Mesh(r.sph, vm); pad.scale.set(0.085 * s, 0.06 * s, 0.09 * s); pad.position.set(sx * 0.2 * fw * s, 0.26 * s, 0); tg.add(pad); } }
    if (eq === 'heavy') { const col = new THREE.Mesh(r.box, vm); col.scale.set(0.2 * s, 0.07 * s, 0.14 * s); col.position.set(0, 0.29 * s, -0.01 * s); tg.add(col); }
    const belt = new THREE.Mesh(r.box, r.black); belt.scale.set(0.35 * fw * s, 0.05 * s, 0.215 * s); belt.position.y = -0.24 * s; tg.add(belt);
    // military backpack
    const pk = new THREE.Mesh(r.box, r.pack[this.team]); pk.scale.set(0.3 * s, 0.4 * s, 0.17 * s); pk.position.set(0, 0.0, 0.18 * s); pk.castShadow = true; tg.add(pk);
    const roll = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 0.3, 10), r.pack[this.team]); roll.rotation.z = Math.PI / 2; roll.scale.setScalar(s); roll.position.set(0, 0.22 * s, 0.2 * s); tg.add(roll);
    for (const sx of [-1, 1]) { const pouch = new THREE.Mesh(r.box, r.pack[this.team]); pouch.scale.set(0.07 * s, 0.14 * s, 0.07 * s); pouch.position.set(sx * 0.175 * s, -0.05 * s, 0.2 * s); tg.add(pouch); }
    // wind-driven cloth: coat tails + backpack flaps
    this.cloth = [];
    for (const [x, w] of [[-0.09, 0.15], [0.09, 0.15]]) {
      const geo = new THREE.PlaneGeometry(w * s, 0.34 * s); geo.translate(0, -0.17 * s, 0);
      const c = new THREE.Mesh(geo, uni); c.position.set(x * s, -0.43 * s, 0.07 * s); c.castShadow = true; tg.add(c); this.cloth.push({ m: c, ph: Math.random() * 6 });
    }
    // head group
    const hg = this.headG = new THREE.Group(); g.add(hg);
    const head = new THREE.Mesh(r.sph, skin); head.scale.set(0.095 * s, 0.115 * s, 0.105 * s); head.castShadow = true; hg.add(head);
    const nose = new THREE.Mesh(r.box, skin); nose.scale.set(0.02 * s, 0.032 * s, 0.022 * s); nose.position.set(0, -0.012 * s, -0.103 * s); hg.add(nose);
    const mouth = new THREE.Mesh(r.box, r.mouth); mouth.scale.set(0.034 * s, 0.005 * s, 0.004 * s); mouth.position.set(0, -0.05 * s, -0.098 * s); hg.add(mouth);
    for (const sx of [-1, 1]) {
      const eye = new THREE.Mesh(r.eyeGeo, r.white); eye.position.set(sx * 0.037 * s, 0.014 * s, -0.093 * s); eye.scale.setScalar(s); hg.add(eye);
      const iris = new THREE.Mesh(r.irisGeo, irisMat(o.app.eye)); iris.position.set(sx * 0.037 * s, 0.014 * s, -0.1055 * s); iris.rotation.y = Math.PI; iris.scale.setScalar(s); hg.add(iris);
      const brow = new THREE.Mesh(r.box, hairMat(o.app.hairColor)); brow.scale.set(0.03 * s, 0.006 * s, 0.006 * s); brow.position.set(sx * 0.037 * s, 0.034 * s, -0.1 * s); hg.add(brow);
    }
    if (o.app.mask === 'balaclava') { const bc = new THREE.Mesh(r.collarGeo, r.black); bc.scale.set(0.95 * s, 1.1 * s, 1.0 * s); bc.rotation.y = 0; hg.add(bc); }
    if (o.app.mask === 'goggles') { const gg = new THREE.Mesh(r.box, r.goggle); gg.scale.set(0.2 * s, 0.045 * s, 0.03 * s); gg.position.set(0, 0.016 * s, -0.104 * s); hg.add(gg); const st = new THREE.Mesh(r.box, r.black); st.scale.set(0.215 * s, 0.03 * s, 0.2 * s); st.position.set(0, 0.016 * s, -0.01 * s); hg.add(st); }
    const hm = new THREE.Mesh(r.helmGeo, r.helm[this.team]); hm.scale.set(1.0 * s, 0.92 * s, 1.1 * s); hm.position.set(0, 0.022 * s, 0.006 * s); hm.castShadow = true; hg.add(hm);
    const brim = new THREE.Mesh(new THREE.CylinderGeometry(0.128, 0.132, 0.018, 18, 1, true), r.helm[this.team]); brim.scale.set(s, s, 1.1 * s); brim.position.set(0, -0.02 * s, 0.01 * s); hg.add(brim);
    const flare = new THREE.Mesh(r.box, r.helm[this.team]); flare.scale.set(0.2 * s, 0.07 * s, 0.05 * s); flare.position.set(0, -0.045 * s, 0.13 * s); hg.add(flare);
    for (const sx of [-1, 1]) {
      const fl = new THREE.Mesh(new THREE.PlaneGeometry(0.075 * s, 0.048 * s), r.flag[this.team]); fl.position.set(sx * 0.1285 * s, 0.03 * s, -0.012 * s); fl.rotation.y = sx * Math.PI / 2; hg.add(fl);
    }
    const cap = new THREE.Mesh(r.capGeo, hairMat(o.app.hairColor)); cap.scale.set(0.95 * s, 1.02 * s, 1.02 * s); cap.position.y = 0.006 * s; if (o.app.hairStyle !== 'buzz') hg.add(cap);
    this.hair = this._makeHair(o.app.hairStyle, o.app.hairColor);
    g.add(this.hair.lines);
    // weapon models (lazy)
    this.gunG = new THREE.Group(); g.add(this.gunG);
    this.joints = {}; for (const k of ['neck', 'pelvis', 'chest', 'head', 'shL', 'shR', 'elL', 'elR', 'haL', 'haR', 'hipL', 'hipR', 'knL', 'knR', 'ftL', 'ftR']) this.joints[k] = new THREE.Vector3();
    this.torsoUp = new THREE.Vector3(0, 1, 0); this.torsoRight = new THREE.Vector3(1, 0, 0); this.torsoBack = new THREE.Vector3(0, 0, 1);
    if (this.isPlayer) g.visible = false;
  }

  _makeHair(style, color) {
    const s = this.s, strands = [];
    const nS = { buzz: 0, short: 8, medium: 14, long: 22, ponytail: 12 }[style], len = { short: 0.05, medium: 0.12, long: 0.3, ponytail: 0.32 }[style] || 0, seg = 4;
    for (let i = 0; i < nS; i++) {
      let root;
      if (style === 'ponytail') root = new THREE.Vector3((Math.random() - 0.5) * 0.03, 0.03 + (Math.random() - 0.5) * 0.02, 0.1);
      else { const ph = (Math.random() * 2 - 1) * 1.9; root = new THREE.Vector3(Math.sin(ph) * 0.1, -0.02 + Math.random() * 0.06, Math.cos(ph) * 0.1); }
      root.multiplyScalar(s);
      const pts = [], prev = []; for (let k = 0; k <= seg; k++) { pts.push(new THREE.Vector3()); prev.push(new THREE.Vector3()); }
      strands.push({ root, pts, prev, L: (len * s * (0.8 + Math.random() * 0.4)) / seg, init: false, stiff: style === 'short' ? 0.7 : 0.25 });
    }
    const geo = new THREE.BufferGeometry(); const arr = new Float32Array(Math.max(1, nS) * seg * 2 * 3);
    geo.setAttribute('position', new THREE.BufferAttribute(arr, 3)); geo.setDrawRange(0, nS * seg * 2);
    const lines = new THREE.LineSegments(geo, new THREE.LineBasicMaterial({ color }));
    lines.frustumCulled = false;
    return { strands, seg, lines, arr, style };
  }

  // ---------------- weapons
  giveLoadout(primaryType, sup = false) {
    this.weapons.primary = new Weapon(primaryType, { sup });
    this.weapons.pistol = new Weapon('pistol');
    this.ammo = { mg: 0, shotgun: 0, pistol: 16, rpg: 0 };
    if (primaryType === 'mg') this.ammo.mg = this.weapons.primary.cap * 2 + Math.floor(rand(0, 8));
    if (primaryType === 'shotgun') this.ammo.shotgun = 12;
    if (primaryType === 'rpg') this.ammo.rpg = 1;
    this.hasKnife = true; this.grenades = 1; this.cur = 'primary'; this.reload = null; this.overheat = null;
    this.rebuildGunModels();
  }
  rebuildGunModels() {
    for (const k of ['primary', 'pistol']) { const w = this.weapons[k]; if (w?.model) w.model.group.parent?.remove(w.model.group); }
    if (this.knifeModel) this.knifeModel.group.parent?.remove(this.knifeModel.group);
    while (this.gunG.children.length) this.gunG.remove(this.gunG.children[0]);
    for (const k of ['primary', 'pistol']) {
      const w = this.weapons[k]; if (!w) continue;
      w.model = buildGun(w); w.model.group.visible = false; this.gunG.add(w.model.group);
      w.model.group.traverse((c) => { if (c.isMesh) c.castShadow = false; });
    }
    this.knifeModel = buildKnife(); this.knifeModel.group.visible = false; this.gunG.add(this.knifeModel.group);
  }
  get weapon() { return this.cur === 'knife' ? null : this.weapons[this.cur]; }
  curModel() { return this.cur === 'knife' ? this.knifeModel : this.weapons[this.cur]?.model; }

  // ---------------- pose
  setPoseState(dt, windStr) {
    const s = this.s;
    this.crouch = damp(this.crouch, this.crouchT, 9, dt);
    // horizontal speed relative to body
    const sp = Math.hypot(this.vel.x, this.vel.z); this.moveSpeed = sp;
    this.phase += sp * dt * (3.0 / s) * 0.62;
    this.stumble = Math.max(0, this.stumble - dt); this.flinch = Math.max(0, this.flinch - dt * 3); this.recoil = Math.max(0, this.recoil - dt * 7);
    this.swing = Math.max(0, this.swing - dt * 2.4);
  }

  updateRig(dt, time, wind) {
    const s = this.s, J = this.joints, g = this.group;
    if (this.ragdoll) { this._poseFromPoints(dt, time, wind); return; }
    this.setPoseState(dt, wind);
    // body yaw follows aim with lag when moving
    const f = _a.set(-Math.sin(this.yaw), 0, -Math.cos(this.yaw)).clone(), rt = new THREE.Vector3(Math.cos(this.yaw), 0, -Math.sin(this.yaw));
    const sp = this.moveSpeed, run = clamp(sp / 5, 0, 1), cr = this.crouch;
    const st = this.stumble > 0 ? Math.sin(this.stumble * 14) * Math.min(1, this.stumble) : 0;
    const bob = Math.abs(Math.sin(this.phase)) * 0.035 * s * clamp(sp / 3, 0, 1);
    const pelvisH = (0.93 - 0.34 * cr) * s - bob - (this.stumble > 0 ? 0.04 * s : 0);
    const pel = J.pelvis.set(this.pos.x, this.pos.y + pelvisH, this.pos.z).addScaledVector(rt, st * 0.05 * s);
    // lean: forward when running, back on flinch, sideways on stumble
    const lean = 0.06 + run * 0.14 + cr * 0.15 - this.flinch * 0.35 + this.recoil * -0.03;
    const up = this.torsoUp.copy(UP).multiplyScalar(Math.cos(lean)).addScaledVector(f, Math.sin(lean)).addScaledVector(rt, st * 0.18).normalize();
    const back = this.torsoBack.copy(f).negate();
    this.torsoRight.crossVectors(up, back).normalize(); back.crossVectors(this.torsoRight, up).normalize();
    const right = this.torsoRight;
    J.neck.copy(pel).addScaledVector(up, 0.56 * s); J.chest.copy(pel).addScaledVector(up, 0.3 * s);
    const sw = (this.female ? 0.165 : 0.19) * s;
    J.shL.copy(J.neck).addScaledVector(up, -0.06 * s).addScaledVector(right, -sw); J.shR.copy(J.neck).addScaledVector(up, -0.06 * s).addScaledVector(right, sw);
    J.hipL.copy(pel).addScaledVector(right, -0.095 * s).addScaledVector(up, -0.03 * s); J.hipR.copy(pel).addScaledVector(right, 0.095 * s).addScaledVector(up, -0.03 * s);
    _m.makeBasis(right, up, back); this.torsoG.quaternion.setFromRotationMatrix(_m); this.torsoG.position.copy(J.chest);
    // head
    _e.set(clamp(this.aimPitch, -1.2, 1.2) * 0.9 - this.flinch * 0.3, this.yaw, 0); this.headG.quaternion.setFromEuler(_e);
    J.head.copy(J.neck).addScaledVector(up, 0.17 * s).addScaledVector(f, 0.02 * s); this.headG.position.copy(J.head);
    // legs with gait
    const vd = _vd.set(this.vel.x, 0, this.vel.z); const speed = vd.length(); if (speed > 0.05) vd.multiplyScalar(1 / speed); else vd.set(0, 0, 0);
    const amp = clamp(speed * 0.1, 0, 0.42) * s, lift = 0.11 * s * clamp(speed / 2.5, 0, 1);
    const L1 = 0.44 * s, L2 = 0.44 * s, kPole = _c.copy(f).multiplyScalar(1).addScaledVector(UP, 0.2);
    const stagger = this.stumble > 0 ? 1 : 0;
    for (const side of [-1, 1]) {
      const ph = this.phase + (side < 0 ? 0 : Math.PI), sn = Math.sin(ph), cs = Math.cos(ph);
      const hip = side < 0 ? J.hipL : J.hipR, foot = side < 0 ? J.ftL : J.ftR, knee = side < 0 ? J.knL : J.knR;
      const wide = (0.1 + cr * 0.05 + stagger * 0.06) * s;
      foot.set(pel.x + rt.x * side * wide + vd.x * amp * sn, 0, pel.z + rt.z * side * wide + vd.z * amp * sn);
      if (speed < 0.3) { foot.x += f.x * (side < 0 ? 0.0 : 0.12 * s) * (0.4 + cr * 0.6); foot.z += f.z * (side < 0 ? 0.0 : 0.12 * s) * (0.4 + cr * 0.6); }
      foot.y = Math.max(T.h(foot.x, foot.z), this.pos.y - 0.9) + 0.07 * s + Math.max(0, cs) * lift * (speed > 0.3 ? 1 : 0);
      ik2(hip, foot, L1, L2, kPole, knee, foot);
      const kk = side < 0 ? this.limbs.thL : this.limbs.thR;
      place(kk, hip, knee, kk.userData.r);
      const sh = side < 0 ? this.limbs.shL : this.limbs.shR; place(sh, knee, foot, sh.userData.r * 0.8);
      const boot = side < 0 ? this.bootL : this.bootR; boot.position.copy(foot).addScaledVector(f, 0.05 * s); boot.position.y -= 0.03 * s;
      _e.set(0, this.yaw + (vd.lengthSq() > 0 ? 0 : 0), 0); boot.quaternion.setFromEuler(_e);
    }
    this._poseArms(dt, time, f, rt, up);
    this._poseHair(dt, time, wind);
    this._poseCloth(time, wind, speed);
  }

  _poseArms(dt, time, f, rt, up) {
    const s = this.s, J = this.joints, model = this.curModel(), gg = this.gunG;
    const aim = this.aimBlend;
    // weapon anchor: shoulder-high in front of the chest
    const pitch = this.aimPitch * aim + (1 - aim) * -0.55 + this.recoil * 0.08;
    const sw = Math.sin(this.phase) * 0.012 * clamp(this.moveSpeed / 3, 0, 1);
    const anchor = _c.copy(J.neck).addScaledVector(f, (0.26 - this.recoil * 0.05) * s).addScaledVector(rt, (0.075 - (1 - aim) * 0.02) * s).addScaledVector(UP, (-0.19 + (1 - aim) * 0.03 - this.crouch * 0.03) * s);
    anchor.y += sw;
    let roll = 0, kx = 0, ky = 0, kz = 0, pitchAdd = 0;
    let handL = null;
    const rl = this.reload, oh = this.overheat;
    if (model) {
      if (rl) { const sm = rl.sample(rl.t); handL = sm.hand; roll = sm.roll; pitchAdd = sm.pitch; kx = sm.x; ky = sm.y; kz = sm.z; }
      else if (oh) { const sm = oh.sample(); handL = sm.hand; roll = sm.roll; pitchAdd = sm.pitch; }
    }
    gg.position.copy(anchor); _e.set(pitch + pitchAdd, this.yaw, 0); gg.quaternion.setFromEuler(_e); const q2 = _q.setFromAxisAngle(_a.set(0, 0, 1), roll); gg.quaternion.multiply(q2);
    gg.scale.setScalar(this.s * 0.95);
    for (const k of ['primary', 'pistol']) { const w = this.weapons[k]; if (w?.model) w.model.group.visible = (this.cur === k); }
    if (this.knifeModel) this.knifeModel.group.visible = this.cur === 'knife';
    if (model) { model.group.position.set(kx, ky, kz + this.recoil * 0.05); if (this.cur === 'knife') { const ks = this.swing; model.group.position.z += -0.3 * Math.sin(ks * Math.PI); } }
    if (model) {
      if (model.pump) model.pump.position.z = model.pumpRest + (this.pumpOff || 0);
      if (model.bolt && model.boltRest !== undefined) model.bolt.position.z = model.boltRest + this.recoil * 0.04;
      if (model.slide) model.slide.position.z = model.slideRest + this.recoil * 0.04;
    }
    gg.updateMatrixWorld(true);
    if (model) model.group.updateMatrixWorld(true);
    // right hand on the grip
    const gR = model ? model.gripR : _d.set(0, 0, 0); const hR = this.joints.haR;
    if (model) hR.copy(gR).applyMatrix4(model.group.matrixWorld); else hR.copy(J.shR).addScaledVector(f, 0.2).addScaledVector(UP, -0.4 * s);
    const hL = this.joints.haL;
    if (model && this.cur !== 'knife') {
      const gl = handL || model.gripL; const w = this.weapons[this.cur];
      let loc = gl.clone(); if (!handL && model.pump && this.pumpOff) loc.z += this.pumpOff;
      hL.copy(loc).applyMatrix4(model.group.matrixWorld);
      // magazine follows the hand during a reload
      if (rl && model.mag) { const ms = rl.magState; const m = model.mag.group; if (ms === 'in') { m.position.copy(model.magRest); m.rotation.x = this.cur === 'pistol' ? 0.16 : 0; m.visible = true; } else if (ms === 'held' || ms === 'new') { m.position.copy(loc).add(_a.set(0, 0.05, 0)); m.visible = true; m.rotation.x = 0; } else m.visible = false; }
      else if (model.mag) { model.mag.group.visible = true; model.mag.group.position.copy(model.magRest); model.mag.group.rotation.x = this.cur === 'pistol' ? 0.16 : 0; }
      if (rl && model.handShell) { model.handShell.visible = rl.shellInHand; model.handShell.position.copy(loc).add(_a.set(0, 0.01, 0)); }
      else if (model.handShell) model.handShell.visible = false;
      if (rl && model.rocket) { model.rocket.visible = rl.magState === 'in' || rl.magState === 'new'; }
    } else if (model && this.cur === 'knife') hL.copy(J.chest).addScaledVector(f, 0.2 * s).addScaledVector(rt, -0.1 * s).addScaledVector(UP, -0.05 * s);
    else hL.copy(J.shL).addScaledVector(f, 0.2 * s).addScaledVector(UP, -0.4 * s);
    // hand burn shake feedback tint is done by game
    const pR = _p1.set(0, 0, 0).addScaledVector(rt, 0.7).addScaledVector(UP, -1).addScaledVector(f, -0.2), pL = _p2.set(0, 0, 0).addScaledVector(rt, -0.6).addScaledVector(UP, -1).addScaledVector(f, -0.1);
    const U1 = 0.29 * s, U2 = 0.27 * s, ex = new THREE.Vector3();
    ik2(J.shR, hR, U1, U2, pR, J.elR, hR); place(this.limbs.uaR, J.shR, J.elR, this.limbs.uaR.userData.r); place(this.limbs.faR, J.elR, hR, this.limbs.faR.userData.r * 0.85);
    ik2(J.shL, hL, U1, U2, pL, J.elL, hL); place(this.limbs.uaL, J.shL, J.elL, this.limbs.uaL.userData.r); place(this.limbs.faL, J.elL, hL, this.limbs.faL.userData.r * 0.85);
    this.handR.position.copy(hR); this.handL.position.copy(hL);
    this.handR.quaternion.copy(gg.quaternion); this.handL.quaternion.copy(gg.quaternion);
  }

  _poseHair(dt, time, wind) {
    const H = this.hair; if (!H.strands.length) return;
    this.headG.updateMatrixWorld(true);
    const m = this.headG.matrixWorld, arr = H.arr, seg = H.seg;
    const wd = windU.uWindDir.value, wx = wd.x * wind * 0.9, wz = wd.y * wind * 0.9;
    const dt2 = Math.min(dt, 0.033) ** 2; let o = 0;
    for (const st of H.strands) {
      _a.copy(st.root).applyMatrix4(m); st.pts[0].copy(_a);
      if (!st.init) { for (let k = 1; k <= seg; k++) { st.pts[k].copy(_a).y -= st.L * k; st.prev[k].copy(st.pts[k]); } st.init = true; }
      for (let k = 1; k <= seg; k++) {
        const p = st.pts[k], pv = st.prev[k];
        const vx = (p.x - pv.x) * 0.93, vy = (p.y - pv.y) * 0.93, vz = (p.z - pv.z) * 0.93;
        pv.copy(p);
        p.x += vx + (wx + Math.sin(time * 3 + k + st.L * 40) * 0.25 * wind) * dt2 * 3; p.y += vy - 9.8 * dt2 * 0.5; p.z += vz + (wz) * dt2 * 3;
        const a = st.pts[k - 1];
        _d.subVectors(p, a); const l = _d.length() || 1e-4;
        // stiffness: pull toward head's down direction
        if (st.stiff) { _e2.set(0, -1, 0); p.addScaledVector(_e2, 0.0); }
        p.copy(a).addScaledVector(_d, st.L / l);
      }
      for (let k = 0; k < seg; k++) { const a = st.pts[k], b = st.pts[k + 1]; arr[o++] = a.x; arr[o++] = a.y; arr[o++] = a.z; arr[o++] = b.x; arr[o++] = b.y; arr[o++] = b.z; }
    }
    H.lines.geometry.attributes.position.needsUpdate = true;
  }

  _poseCloth(time, wind, speed) {
    const wd = windU.uWindDir.value;
    for (const c of this.cloth) {
      const a = 0.12 + speed * 0.07 + Math.sin(time * 4.2 + c.ph) * (0.06 + wind * 0.2);
      c.m.rotation.x = a; c.m.rotation.z = Math.sin(time * 3.1 + c.ph) * wind * 0.12 + wd.x * wind * 0.1;
    }
  }

  // ---------------- ragdoll (verlet particles joined by distance constraints)
  startRagdoll(impulse, hitPart, hitPoint) {
    const J = this.joints, names = ['head', 'neck', 'pelvis', 'shL', 'shR', 'elL', 'elR', 'haL', 'haR', 'hipL', 'hipR', 'knL', 'knR', 'ftL', 'ftR'];
    const pts = {}, prev = {};
    for (const n of names) { pts[n] = J[n].clone(); prev[n] = J[n].clone().addScaledVector(this.vel, -1 / 60); }
    const links = [['head', 'neck'], ['neck', 'pelvis'], ['neck', 'shL'], ['neck', 'shR'], ['shL', 'elL'], ['elL', 'haL'], ['shR', 'elR'], ['elR', 'haR'], ['pelvis', 'hipL'], ['pelvis', 'hipR'], ['hipL', 'knL'], ['knL', 'ftL'], ['hipR', 'knR'], ['knR', 'ftR'],
      ['shL', 'shR'], ['hipL', 'hipR'], ['shL', 'hipR'], ['shR', 'hipL'], ['shL', 'pelvis'], ['shR', 'pelvis'], ['head', 'shL'], ['head', 'shR'], ['neck', 'hipL'], ['neck', 'hipR']];
    const cons = links.map(([a, b]) => ({ a, b, d: pts[a].distanceTo(pts[b]) }));
    const mins = [['hipL', 'ftL', 0.28 * this.s * 1.0], ['hipR', 'ftR', 0.28 * this.s], ['shL', 'haL', 0.12 * this.s], ['shR', 'haR', 0.12 * this.s]];
    const tgt = hitPart === 'head' ? 'head' : hitPart === 'leg' ? (Math.random() < 0.5 ? 'knL' : 'knR') : 'neck';
    prev[tgt].addScaledVector(impulse, -1 / 60 * 1.0);
    for (const n of names) prev[n].addScaledVector(impulse, -1 / 60 * 0.35);
    this.ragdoll = { pts, prev, cons, mins, names, t: 0, sleep: false, still: 0 };
    this.gunG.visible = false; this.hair.strands.forEach((s) => (s.init = false));
  }
  _stepRagdoll(dt) {
    const Rg = this.ragdoll; if (Rg.sleep) return;
    const h = 1 / 60, steps = Math.min(3, Math.max(1, Math.round(dt / h))); let moved = 0;
    for (let st = 0; st < steps; st++) {
      for (const n of Rg.names) {
        const p = Rg.pts[n], pv = Rg.prev[n];
        const vx = (p.x - pv.x) * 0.985, vy = (p.y - pv.y) * 0.995, vz = (p.z - pv.z) * 0.985;
        pv.copy(p); p.x += vx; p.y += vy - 24 * h * h; p.z += vz; moved += Math.abs(vx) + Math.abs(vz) + Math.abs(vy);
      }
      for (let it = 0; it < 5; it++) {
        for (const c of Rg.cons) {
          const a = Rg.pts[c.a], b = Rg.pts[c.b]; _d.subVectors(b, a); const l = _d.length() || 1e-4, k = (l - c.d) / l * 0.5; a.addScaledVector(_d, k); b.addScaledVector(_d, -k);
        }
        for (const [a, b, mn] of Rg.mins) { const A = Rg.pts[a], B = Rg.pts[b]; _d.subVectors(B, A); const l = _d.length(); if (l < mn) { const k = (l - mn) / (l || 1e-4) * 0.5; A.addScaledVector(_d, k); B.addScaledVector(_d, -k); } }
        for (const n of Rg.names) {
          const p = Rg.pts[n], gy = T.h(p.x, p.z) + (n === 'head' ? 0.1 : n.startsWith('ft') ? 0.05 : 0.09) * this.s;
          if (p.y < gy) { p.y = gy; const pv = Rg.prev[n]; pv.x += (p.x - pv.x) * 0.35; pv.z += (p.z - pv.z) * 0.35; if (pv.y < p.y) pv.y = p.y; }
        }
      }
    }
    Rg.t += dt; if (moved < 0.02 * Rg.names.length) Rg.still += dt; else Rg.still = 0;
    if (Rg.still > 0.6 || Rg.t > 6) Rg.sleep = true;
  }
  _poseFromPoints(dt, time, wind) {
    const Rg = this.ragdoll, P = Rg.pts, s = this.s; this._stepRagdoll(dt);
    const J = this.joints; for (const n of Rg.names) J[n].copy(P[n]);
    J.chest.copy(P.pelvis).lerp(P.neck, 0.5);
    place(this.limbs.uaL, P.shL, P.elL, this.limbs.uaL.userData.r); place(this.limbs.faL, P.elL, P.haL, this.limbs.faL.userData.r * 0.85);
    place(this.limbs.uaR, P.shR, P.elR, this.limbs.uaR.userData.r); place(this.limbs.faR, P.elR, P.haR, this.limbs.faR.userData.r * 0.85);
    place(this.limbs.thL, P.hipL, P.knL, this.limbs.thL.userData.r); place(this.limbs.shL, P.knL, P.ftL, this.limbs.shL.userData.r * 0.8);
    place(this.limbs.thR, P.hipR, P.knR, this.limbs.thR.userData.r); place(this.limbs.shR, P.knR, P.ftR, this.limbs.shR.userData.r * 0.8);
    this.handL.position.copy(P.haL); this.handR.position.copy(P.haR); this.bootL.position.copy(P.ftL); this.bootR.position.copy(P.ftR);
    // torso frame from points
    const up = _a.subVectors(P.neck, P.pelvis).normalize(), right = _b.subVectors(P.shR, P.shL).normalize();
    const back = _c.crossVectors(right, up).normalize(); const r2 = new THREE.Vector3().crossVectors(up, back).normalize();
    _m.makeBasis(r2, up, back); this.torsoG.quaternion.setFromRotationMatrix(_m); this.torsoG.position.copy(J.chest);
    this.handL.quaternion.copy(this.torsoG.quaternion); this.handR.quaternion.copy(this.torsoG.quaternion);
    const q = this.torsoG.quaternion; this.bootL.quaternion.copy(q); this.bootR.quaternion.copy(q);
    this.headG.position.copy(P.head); this.headG.quaternion.copy(q);
    this.torsoUp.copy(up); this.torsoRight.copy(r2); this.torsoBack.copy(back);
    this._poseHair(dt, time, wind * 0.5);
    this.pos.set(P.pelvis.x, T.h(P.pelvis.x, P.pelvis.z), P.pelvis.z);
  }
  stopRagdoll() { this.ragdoll = null; this.gunG.visible = true; this.hair.strands.forEach((s) => (s.init = false)); }
}
const _e2 = new THREE.Vector3();
