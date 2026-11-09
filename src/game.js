import * as THREE from 'three';
import { ctx } from './ctx.js';
import * as T from './terrain.js';
import { clamp, rand, randi, pick, chance, lerp, smooth, damp, windU, angDiff } from './util.js';
import { AudioSys } from './audio.js';
import { Sky } from './sky.js';
import { Post } from './post.js';
import { FX } from './fx.js';
import { buildWorld, physStep, BUILD_SPOTS } from './world.js';
import { Character, randomAppearance, ik2, place, uniMat } from './character.js';
import { Nav, Brain, randomTraits } from './ai.js';
import { DEFS, Weapon, buildGrenadeMesh } from './weapons.js';
import * as A from './actions.js';
import * as C from './combat.js';

const $ = (id) => document.getElementById(id);
const _v = new THREE.Vector3(), _w = new THREE.Vector3(), _e = new THREE.Euler(0, 0, 0, 'YXZ'), _q = new THREE.Quaternion();

const NPCS = {
  1: [{ name: 'Hayes', f: false }, { name: 'Rivera', f: true }, { name: 'Brandt', f: false }],
  2: [{ name: 'Orlov', f: false }, { name: 'Petrova', f: true }, { name: 'Volkov', f: false }, { name: 'Sokolov', f: false }],
};
const KILL_LIMIT = 100;
const WNAME = { pistol: 'Pistole', mg: 'MG', shotgun: 'Schrot', rpg: 'RPG', knife: 'Messer', grenade: 'Granate', mine: 'Mine', pellet: 'Schrot' };

// =====================================================================================================
class ViewModel {
  constructor(game) {
    this.g = game; this.scene = game.vmScene; this.holder = new THREE.Group(); this.scene.add(this.holder);
    this.glove = new THREE.MeshStandardMaterial({ color: 0x141414, roughness: 0.8 });
    const sph = new THREE.SphereGeometry(1, 12, 10), box = new THREE.BoxGeometry(1, 1, 1);
    const uni = uniMat(1);
    this.arm = {};
    for (const s of ['L', 'R']) {
      const ua = new THREE.Mesh(sph, uni), fa = new THREE.Mesh(sph, uni), hand = new THREE.Mesh(box, this.glove), thumb = new THREE.Mesh(box, this.glove);
      hand.scale.set(0.085, 0.045, 0.1); thumb.scale.set(0.03, 0.03, 0.06);
      this.holder.add(ua, fa, hand, thumb); this.arm[s] = { ua, fa, hand, thumb, el: new THREE.Vector3(), sh: new THREE.Vector3(s === 'L' ? -0.2 : 0.2, -0.3, 0.12) };
    }
    this.grenade = buildGrenadeMesh(); this.grenade.scale.setScalar(1.3); this.grenade.visible = false; this.holder.add(this.grenade);
    // muzzle flash billboard
    const c = document.createElement('canvas'); c.width = c.height = 128; const g = c.getContext('2d');
    const gr = g.createRadialGradient(64, 64, 0, 64, 64, 64); gr.addColorStop(0, 'rgba(255,255,230,1)'); gr.addColorStop(0.2, 'rgba(255,200,90,0.9)'); gr.addColorStop(1, 'rgba(255,120,20,0)'); g.fillStyle = gr; g.fillRect(0, 0, 128, 128);
    g.strokeStyle = 'rgba(255,220,140,0.9)'; g.lineWidth = 4; for (let i = 0; i < 7; i++) { const a = i / 7 * 6.28 + Math.random(); g.beginPath(); g.moveTo(64, 64); g.lineTo(64 + Math.cos(a) * 62, 64 + Math.sin(a) * 62); g.stroke(); }
    this.flash = new THREE.Mesh(new THREE.PlaneGeometry(0.22, 0.22), new THREE.MeshBasicMaterial({ map: new THREE.CanvasTexture(c), transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, depthTest: false }));
    this.flash.visible = false; this.flash.renderOrder = 10; this.holder.add(this.flash); this.flashT = 0;
    this.ads = 0; this.sprint = 0; this.kick = { z: 0, p: 0, y: 0, vz: 0, vp: 0, vy: 0 }; this.sway = new THREE.Vector2(); this.swayV = new THREE.Vector2(); this.bobT = 0; this.shown = null; this.heatTint = 0;
    this.pos = new THREE.Vector3(); this.lastYaw = 0; this.lastPitch = 0; this.throwK = 0;
  }
  fire(def) { const k = this.kick; k.vz += def.kick.z * 9; k.vp += def.kick.p * 0.012 * 9; k.vy += (Math.random() - 0.5) * def.kick.y * 0.012 * 9; this.flashT = 0.045; }

  update(dt, c, st) {
    const model = c.curModel(), slotNow = c.cur;
    if (c.swapT < 0.23 || !this.shown) this.shown = slotNow;
    const shownModel = this.shown === 'knife' ? c.knifeModel : c.weapons[this.shown]?.model;
    for (const k of ['primary', 'pistol']) { const w = c.weapons[k]; if (w?.model) { if (w.model.group.parent !== this.holder) this.holder.add(w.model.group); w.model.group.visible = (this.shown === k) && c.alive; } }
    if (c.knifeModel) { if (c.knifeModel.group.parent !== this.holder) this.holder.add(c.knifeModel.group); c.knifeModel.group.visible = this.shown === 'knife' && c.alive; }
    const m = shownModel; if (!m) { for (const s of ['L', 'R']) { const a = this.arm[s]; a.ua.visible = a.fa.visible = a.hand.visible = a.thumb.visible = false; } return; }
    for (const s of ['L', 'R']) { const a = this.arm[s]; a.ua.visible = a.fa.visible = a.hand.visible = a.thumb.visible = c.alive; }
    const w = c.weapons[this.shown];
    const kind = this.shown === 'knife' ? 'knife' : w.type;
    // ---- target pose
    const HIP = { mg: [0.17, -0.165, -0.47], pistol: [0.13, -0.125, -0.46], shotgun: [0.17, -0.165, -0.47], rpg: [0.23, -0.2, -0.42], knife: [0.15, -0.2, -0.42] }[kind];
    const canAds = st.ads && !c.reload && !c.overheat && kind !== 'knife' && st.sprintK < 0.1 && c.swapT <= 0;
    this.ads = damp(this.ads, canAds ? 1 : 0, 12, dt); this.sprint = damp(this.sprint, st.sprintK, 9, dt);
    const S = m.sight || new THREE.Vector3(0, 0.08, 0.03);
    const ADS = kind === 'knife' ? HIP : [-S.x, -S.y, -0.4 - S.z];
    const p = this.pos.set(lerp(HIP[0], ADS[0], this.ads), lerp(HIP[1], ADS[1], this.ads), lerp(HIP[2], ADS[2], this.ads));
    let rx = 0, ry = 0, rz = 0;
    // sprint pose
    p.x += 0.07 * this.sprint; p.y += -0.09 * this.sprint; p.z += 0.02 * this.sprint; ry += -0.55 * this.sprint; rx += 0.25 * this.sprint; rz += 0.2 * this.sprint;
    // bobbing
    this.bobT += st.speed * dt * (st.sprintK > 0.5 ? 1.5 : 1.2);
    const bobA = clamp(st.speed / 5, 0, 1) * (1 - this.ads * 0.85);
    p.x += Math.sin(this.bobT) * 0.012 * bobA; p.y += Math.abs(Math.cos(this.bobT)) * 0.012 * bobA - 0.004 * bobA; rz += Math.sin(this.bobT) * 0.02 * bobA;
    // idle breathing
    p.y += Math.sin(ctx.time * 1.4) * 0.0025; p.x += Math.sin(ctx.time * 0.9) * 0.0015;
    // view-lag sway (heavy weapons lag more)
    const dy = angDiff(this.lastYaw, st.yaw), dp = st.pitch - this.lastPitch; this.lastYaw = st.yaw; this.lastPitch = st.pitch;
    this.swayV.x += (-dy * 7 - this.sway.x * 90 - this.swayV.x * 11) * dt * 1; this.swayV.y += (dp * 7 - this.sway.y * 90 - this.swayV.y * 11) * dt * 1;
    this.sway.x += this.swayV.x * dt * 60 * 0.016; this.sway.y += this.swayV.y * dt * 60 * 0.016;
    this.sway.x = clamp(this.sway.x, -0.08, 0.08); this.sway.y = clamp(this.sway.y, -0.06, 0.06);
    p.x += this.sway.x * (1 - this.ads * 0.7); p.y += this.sway.y * (1 - this.ads * 0.7); ry += this.sway.x * 1.4; rx += this.sway.y * 1.4;
    // recoil springs
    const k = this.kick; k.vz += (-k.z * 140 - k.vz * 16) * dt; k.vp += (-k.p * 140 - k.vp * 16) * dt; k.vy += (-k.y * 140 - k.vy * 16) * dt; k.z += k.vz * dt; k.p += k.vp * dt; k.y += k.vy * dt;
    p.z += clamp(k.z, 0, 0.14); rx += k.p; ry += k.y; p.y += k.p * 0.08;
    // weapon switching: dip down & back up
    if (c.swapT > 0) { const u = clamp(c.swapT / 0.45, 0, 1), dip = Math.sin(u * Math.PI); p.y -= 0.26 * dip; rx -= 0.7 * dip; p.x += 0.05 * dip; }
    // grenade throw: gun lowers
    if (c.throwT > 0) { const u = clamp(c.throwT / 0.8, 0, 1), dip = Math.sin(clamp(u * 1.4, 0, 1) * Math.PI); p.y -= 0.22 * dip; rx -= 0.3 * dip; }
    // ---- reload / overheat / knife
    let handL = null, tiltx = 0, tilty = 0, tiltz = 0;
    if (c.reload && !c.reload.cancelled) { const sm = c.reload.sample(c.reload.t); handL = sm.hand; rz += sm.roll; rx += sm.pitch; tiltx = sm.x; tilty = sm.y; tiltz = sm.z; }
    else if (c.overheat) { const sm = c.overheat.sample(); handL = sm.hand; rz += sm.roll; rx += sm.pitch; this.heatTint = damp(this.heatTint, sm.shake ? 1 : 0.4, 12, dt); if (sm.shake) { p.x += Math.sin(ctx.time * 40) * 0.003; p.y -= 0.02; } }
    else this.heatTint = damp(this.heatTint, 0, 3, dt);
    this.glove.emissive.setRGB(0.55 * this.heatTint, 0.08 * this.heatTint, 0);
    if (kind === 'knife') { const sw = c.swing; if (sw > 0) { p.z -= 0.26 * Math.sin(sw * Math.PI); p.x -= 0.14 * Math.sin(sw * Math.PI) * (sw > 0.5 ? 1 : -1); ry += 1.0 * (sw - 0.5); rz += 0.8 * Math.sin(sw * Math.PI); } rx += -0.35; }
    p.x += tiltx; p.y += tilty; p.z += tiltz;
    m.group.position.copy(p); _e.set(rx, ry, rz); m.group.quaternion.setFromEuler(_e); m.group.scale.setScalar(1);
    if (m.pump) m.pump.position.z = m.pumpRest + (c.pumpOff || 0); if (m.bolt && m.boltRest !== undefined) m.bolt.position.z = m.boltRest + clamp(k.z * 0.35, 0, 0.04); if (m.slide) m.slide.position.z = m.slideRest + clamp(k.z * 0.6, 0, 0.05);
    m.group.updateMatrixWorld(true);
    // magazine / shell / rocket visuals during reload
    const rl = c.reload;
    if (m.mag) {
      const mg = m.mag.group;
      if (rl && this.shown === c.cur) { const ms = rl.magState; if (ms === 'in') { mg.position.copy(m.magRest); mg.rotation.x = kind === 'pistol' ? 0.16 : 0; mg.visible = true; if (rl.t > 0) m.mag.setCount(w.mag); } else if (ms === 'held') { mg.position.copy(handL || m.magRest).add(_v.set(0, 0.05, 0)); mg.rotation.x = 0; mg.visible = true; m.mag.setCount(rl.oldCount); } else if (ms === 'new') { mg.position.copy(handL || m.magRest).add(_v.set(0, 0.05, 0)); mg.visible = true; mg.rotation.x = 0; m.mag.setCount(rl.newCount); } else mg.visible = false; }
      else { mg.visible = true; mg.position.copy(m.magRest); mg.rotation.x = kind === 'pistol' ? 0.16 : 0; }
    }
    if (m.handShell) { m.handShell.visible = !!(rl && rl.shellInHand); if (handL) m.handShell.position.copy(handL).add(_v.set(0, 0.01, 0)); }
    if (m.rocket && rl) m.rocket.visible = rl.magState === 'in' || rl.magState === 'new';
    // ---- arms (2-bone IK from shoulders to grips)
    const gR = m.gripR; const hRw = gR.clone().applyMatrix4(m.group.matrixWorld);
    let lLoc = handL || m.gripL; if (!handL && m.pump) lLoc = m.gripL.clone().setZ(m.gripL.z + (c.pumpOff || 0));
    let hLw;
    if (kind === 'knife') hLw = new THREE.Vector3(-0.2, -0.3, -0.18); else hLw = lLoc.clone().applyMatrix4(m.group.matrixWorld);
    const poleR = _v.set(0.6, -1, 0.2), poleL = _w.set(-0.6, -1, 0.2);
    this._arm('R', hRw, poleR.clone(), m.group.quaternion); this._arm('L', hLw, poleL.clone(), m.group.quaternion);
    // grenade in hand while throwing
    this.grenade.visible = c.throwT > 0.05 && c.throwT < 0.7; if (this.grenade.visible) { const u = 1 - c.throwT / 0.7; this.grenade.position.set(0.12 + u * 0.05, -0.2 + Math.sin(u * 3) * 0.12, -0.3 - u * 0.35); }
    // muzzle flash
    this.flashT = Math.max(0, this.flashT - dt); this.flash.visible = this.flashT > 0 && kind !== 'knife';
    if (this.flash.visible) { m.muzzle.getWorldPosition(this.flash.position); this.flash.scale.setScalar(0.8 + Math.random() * 0.8 * (w?.type === 'shotgun' ? 1.6 : 1)); this.flash.rotation.z = Math.random() * 6; if (w?.sup) this.flash.scale.multiplyScalar(0.3); }
    // flashlight cone origin for main scene
    st.muzzleVM = m;
  }
  _arm(s, hand, pole, q) {
    const a = this.arm[s]; ik2(a.sh, hand, 0.3, 0.29, pole, a.el, hand);
    place(a.ua, a.sh, a.el, 0.062); place(a.fa, a.el, hand, 0.05);
    a.hand.position.copy(hand); a.hand.quaternion.copy(q); a.thumb.position.copy(hand).add(_v.set(s === 'R' ? -0.04 : 0.04, 0.025, 0.0).applyQuaternion(q)); a.thumb.quaternion.copy(q);
  }
}

// =====================================================================================================
export class Game {
  constructor() {
    this.state = 'loading'; this.keys = {}; this.mouse = { l: false, lPressed: false, r: false, dx: 0, dy: 0 }; this.yaw = 0; this.pitch = 0;
    this.recoilP = 0; this.recoilY = 0; this.roll = 0; this.trauma = 0; this.suppressK = 0; this.damageK = 0; this.flashK = 0; this.hitT = 0; this.msgT = 0;
    this.bobT = 0; this.stepDist = 0; this.landDip = 0; this.regenT = 0; this.deadT = 0; this.countT = 0; this.quality = 'auto'; this.frame = 0; this.envT = 0; this.focus = false; this.noiseQ = [];
    this.flashLightManual = null; this.menuT = 0; this.markEls = []; this.mmT = 0; this.throwQ = null; this.fpsAcc = 0; this.fpsN = 0; this.prompt = null; this.glintT = 0;
    ctx.game = this;
  }

  // ---------------------------------------------------------------- setup
  async init(progress) {
    const canvas = $('game');
    let q = new URLSearchParams(location.search).get('q'); if (!q) { try { q = localStorage.getItem('ron_q'); } catch (e) {} } if (q) { this.quality = q; $('qsel').value = q; }
    const renderer = this.renderer = ctx.renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance', stencil: false });
    this.pr = Math.min(window.devicePixelRatio || 1, 1.5);
    renderer.setPixelRatio(this.pr); renderer.setSize(innerWidth, innerHeight, false);
    renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    const scene = this.scene = ctx.scene = new THREE.Scene();
    const cam = this.camera = ctx.camera = new THREE.PerspectiveCamera(75, innerWidth / innerHeight, 0.07, 1500); cam.rotation.order = 'YXZ'; scene.add(cam);
    this.vmScene = new THREE.Scene(); this.vmCam = new THREE.PerspectiveCamera(58, innerWidth / innerHeight, 0.01, 6);
    this.vmHemi = new THREE.HemisphereLight(0xffffff, 0x444444, 1); this.vmSun = new THREE.DirectionalLight(0xffffff, 2); this.vmSun.position.set(0.5, 1, 0.6); this.vmScene.add(this.vmHemi, this.vmSun);
    this.vmMuzzle = new THREE.PointLight(0xffb060, 0, 3, 2); this.vmScene.add(this.vmMuzzle);
    this.post = new Post(renderer); this.post.resize(Math.floor(innerWidth * this.pr), Math.floor(innerHeight * this.pr)); this.post.setMode(this.quality);
    this.audio = ctx.audio = new AudioSys();
    await progress(0.05, 'Himmel & Wetter');
    this.sky = ctx.sky = new Sky(renderer, scene);
    this.sky.onEnv = (t) => { this.vmScene.environment = t; };
    this.vmScene.environment = scene.environment;
    this.fx = ctx.fx = new FX(scene, this.audio);
    this.fx.scene = scene;
    await progress(0.15, 'Gelände, Schützengräben & Vegetation');
    const wq = this.quality === 'low' ? 'low' : this.quality === 'medium' ? 'medium' : 'high';
    this.world = buildWorld(scene, this.fx, wq);
    await progress(0.65, 'Navigationsnetz');
    this.nav = new Nav(); this.nav.build();
    await progress(0.8, 'Ausrüstung verteilen');
    this.spawnPickups();
    await progress(0.9, 'Minimap');
    this.buildMiniMap();
    // lights
    this.muzzleLight = new THREE.PointLight(0xffa850, 0, 18, 2); scene.add(this.muzzleLight); this.muzzleT = 0;
    this.torch = new THREE.SpotLight(0xfff2d0, 0, 55, 0.38, 0.6, 1.6); this.torch.castShadow = false; scene.add(this.torch, this.torch.target);
    this.npcTorch = []; for (let i = 0; i < 3; i++) { const l = new THREE.SpotLight(0xfff2d0, 0, 40, 0.4, 0.6, 1.8); scene.add(l, l.target); this.npcTorch.push(l); }
    this.vm = new ViewModel(this); this.vm.holder.visible = false;
    this.bindInput(); window.addEventListener('resize', () => this.resize());
    this.state = 'menu'; await progress(1, 'Bereit');
    renderer.setAnimationLoop((t) => this.loop(t));
  }

  resize() {
    this.renderer.setSize(innerWidth, innerHeight, false); this.camera.aspect = innerWidth / innerHeight; this.camera.updateProjectionMatrix();
    this.vmCam.aspect = innerWidth / innerHeight; this.vmCam.updateProjectionMatrix(); this.post.resize(Math.floor(innerWidth * this.pr), Math.floor(innerHeight * this.pr));
  }

  setQuality(q) { try { localStorage.setItem('ron_q', q); } catch (e) {} location.href = location.pathname + '?q=' + q; }

  spawnPickups() {
    const W = this.world, drop = (fn) => { const s = fn.spot; const p = new THREE.Vector3(s.x, T.h(s.x, s.z) + 0.5, s.z); return p; };
    const place = (kind, spot) => { const pos = new THREE.Vector3(spot.x, T.h(spot.x, spot.z) + 0.3, spot.z); const yaw = Math.random() * 6; return pos; };
    const spots = [];
    const near = (b, dx, dz) => ({ x: b.cx + dx, z: b.cz + dz });
    const bA = W.buildings[0], bB = W.buildings[1];
    const weaponList = [['mg', near(bA, -1, 0)], ['shotgun', near(bA, 3, 2)], ['mg', near(bB, 3, 0.5)], ['rpg', near(bB, -3, -1.5)], ['shotgun', near(bB, 5, 2)]];
    for (let i = 0; i < 4; i++) weaponList.push(['mg', W.randSpot({ minTd: 2, maxTd: 8 })]);
    for (let i = 0; i < 3; i++) weaponList.push(['shotgun', W.randSpot({ minTd: 2, maxTd: 8 })]);
    for (let i = 0; i < 3; i++) weaponList.push(['pistol', W.randSpot({ minTd: 1.5, maxTd: 8 })]);
    weaponList.push(['rpg', W.randSpot({ minTd: 3, zAbs: [20, 70] })]);
    for (const [type, s] of weaponList) { const w = new Weapon(type, { mag: Math.ceil((DEFS[type].cap || 28) * rand(0.4, 1)) }); A.makeWeaponProp(w, new THREE.Vector3(s.x, T.h(s.x, s.z) + 0.3, s.z), new THREE.Vector3(), 0); }
    // ammunition is rare
    const ammo = [['mg', 30], ['mg', 30], ['mg', 25], ['shotgun', 8], ['shotgun', 8], ['pistol', 16], ['pistol', 16], ['mg', 30], ['rpg', 1], ['shotgun', 6]];
    for (const [t, n] of ammo) { const s = W.randSpot({ minTd: 1.8, maxTd: 10 }); A.makeAmmoProp(t, n, new THREE.Vector3(s.x, T.h(s.x, s.z) + 0.3, s.z)); }
    for (let i = 0; i < 3; i++) { const s = W.randSpot({ minTd: 2 }); A.makeAttachmentProp('sup', new THREE.Vector3(s.x, T.h(s.x, s.z) + 0.2, s.z)); }
    for (let i = 0; i < 2; i++) { const s = W.randSpot({ minTd: 2 }); A.makeAttachmentProp('long', new THREE.Vector3(s.x, T.h(s.x, s.z) + 0.2, s.z)); }
  }

  // ---------------------------------------------------------------- minimap
  buildMiniMap() {
    const S = 2, size = (T.PLAY + 20) * 2 * S, c = document.createElement('canvas'); c.width = c.height = size; const g = c.getContext('2d');
    const img = g.createImageData(size, size), half = T.PLAY + 20;
    for (let j = 0; j < size; j++) for (let i = 0; i < size; i++) {
      const x = i / S - half, z = j / S - half, h = T.h(x, z), td = T.trenchDist(x, z), gr = T.grassAt(x, z), o = (j * size + i) * 4;
      let r = 62 + h * 6, gg = 60 + h * 6 + gr * 22, b = 44 + h * 4;
      if (td < T.TRENCH_HW + 0.4) { r = 28; gg = 22; b = 16; }
      if (Math.max(Math.abs(x), Math.abs(z)) > T.PLAY) { r *= 0.5; gg *= 0.4; b *= 0.4; r += 30; }
      img.data[o] = r; img.data[o + 1] = gg; img.data[o + 2] = b; img.data[o + 3] = 255;
    }
    g.putImageData(img, 0, 0);
    g.strokeStyle = '#d02020'; g.lineWidth = 3; g.strokeRect(20 * S, 20 * S, T.PLAY * 2 * S, T.PLAY * 2 * S);
    g.fillStyle = '#9a9a92'; for (const b of this.world.buildings) g.fillRect((b.cx - b.hx + half) * S, (b.cz - b.hz + half) * S, b.hx * 2 * S, b.hz * 2 * S);
    g.fillStyle = 'rgba(20,45,15,0.9)'; for (const t of this.world.trees) { g.beginPath(); g.arc((t.x + half) * S, (t.z + half) * S, 2.2, 0, 7); g.fill(); }
    this.mmBase = c; this.mmHalf = half; this.mmS = S; this.mmCtx = $('minimap').getContext('2d');
  }
  drawMiniMap() {
    const g = this.mmCtx, W = 420, R = 75, sc = W / 2 / R, pl = ctx.player;
    g.setTransform(1, 0, 0, 1, 0, 0); g.clearRect(0, 0, W, W); g.fillStyle = '#0b0c0a'; g.fillRect(0, 0, W, W);
    g.translate(W / 2, W / 2); g.rotate(pl.alive ? this.yaw : this.yaw);
    const k = sc / this.mmS; g.save(); g.scale(k, k); g.drawImage(this.mmBase, -(pl.pos.x + this.mmHalf) * this.mmS, -(pl.pos.z + this.mmHalf) * this.mmS); g.restore();
    for (const c of ctx.chars) {
      if (c === pl || !c.alive) continue;
      let dx = (c.pos.x - pl.pos.x) * sc, dz = (c.pos.z - pl.pos.z) * sc; const d = Math.hypot(dx, dz), lim = W / 2 - 14; if (d > lim) { dx *= lim / d; dz *= lim / d; }
      const ally = c.team === pl.team; g.save(); g.translate(dx, dz); g.rotate(-c.yaw);
      g.fillStyle = ally ? '#3d9bff' : '#ff3b3b'; g.strokeStyle = ally ? '#d6ecff' : '#ffd0d0'; g.lineWidth = 2;
      if (ally) { g.beginPath(); g.arc(0, 0, 8, 0, 7); g.fill(); g.stroke(); g.beginPath(); g.moveTo(0, -14); g.lineTo(5, -6); g.lineTo(-5, -6); g.fill(); }
      else { g.beginPath(); g.moveTo(0, -10); g.lineTo(9, 7); g.lineTo(-9, 7); g.closePath(); g.fill(); g.stroke(); }
      g.restore();
    }
    g.setTransform(1, 0, 0, 1, 0, 0); g.translate(W / 2, W / 2); g.fillStyle = '#fff'; g.strokeStyle = '#000'; g.lineWidth = 2; g.beginPath(); g.moveTo(0, -13); g.lineTo(9, 10); g.lineTo(0, 5); g.lineTo(-9, 10); g.closePath(); g.fill(); g.stroke();
  }

  // ---------------------------------------------------------------- input
  bindInput() {
    const down = (e) => {
      if (this.state !== 'play' && this.state !== 'countdown') return;
      this.keys[e.code] = true;
      const c = ctx.player; if (!c) return;
      if (e.code === 'KeyR' && c.alive && this.state === 'play') A.startReload(c);
      if (e.code === 'Digit1' && c.alive) this.switchTo('primary'); if (e.code === 'Digit2' && c.alive) this.switchTo('pistol'); if (e.code === 'Digit3' && c.alive) this.switchTo('knife');
      if (e.code === 'KeyG' && c.alive && this.state === 'play') this.tryGrenade();
      if (e.code === 'KeyE' && c.alive && this.state === 'play') this.doPickup();
      if (e.code === 'KeyL') this.flashLightManual = this.flashLightManual === null ? !(this.sky.dark > 0.55) : !this.flashLightManual;
      if (['Space', 'ArrowUp', 'ArrowDown'].includes(e.code)) e.preventDefault();
    };
    addEventListener('keydown', down); addEventListener('keyup', (e) => { this.keys[e.code] = false; });
    addEventListener('mousedown', (e) => { if (this.state !== 'play' || !document.pointerLockElement) return; if (e.button === 0) { this.mouse.l = true; this.mouse.lPressed = true; } if (e.button === 2) { this.mouse.r = true; this.mouse.rPressed = true; } });
    addEventListener('mouseup', (e) => { if (e.button === 0) this.mouse.l = false; if (e.button === 2) this.mouse.r = false; });
    addEventListener('contextmenu', (e) => e.preventDefault());
    addEventListener('mousemove', (e) => { if (document.pointerLockElement) { this.mouse.dx += e.movementX; this.mouse.dy += e.movementY; } });
    addEventListener('wheel', (e) => { const c = ctx.player; if (this.state !== 'play' || !c?.alive) return; const order = ['primary', 'pistol', 'knife'], i = order.indexOf(c.cur), d = e.deltaY > 0 ? 1 : -1; for (let k = 1; k <= 3; k++) { const s = order[(i + d * k + 9) % 3]; if (this.switchTo(s)) break; } });
    document.addEventListener('pointerlockchange', () => {
      const locked = !!document.pointerLockElement;
      if (!locked && (this.state === 'play' || this.state === 'countdown')) { this.prevState = this.state; this.state = 'paused'; $('pause').classList.remove('hidden'); this.mouse.l = this.mouse.r = false; }
    });
    $('pause').addEventListener('click', () => { $('game').requestPointerLock(); });
    document.addEventListener('pointerlockchange', () => { if (document.pointerLockElement && this.state === 'paused') { this.state = this.prevState || 'play'; $('pause').classList.add('hidden'); this.audio.init(); } });
    $('playBtn').addEventListener('click', () => { this.audio.init(); $('mainbtns').classList.add('hidden'); $('modeScreen').classList.remove('hidden'); this.audio.beep(600, 0.06); });
    $('backBtn').addEventListener('click', () => { $('mainbtns').classList.remove('hidden'); $('modeScreen').classList.add('hidden'); });
    $('tdm').addEventListener('click', () => { this.audio.init(); $('game').requestPointerLock(); this.startMatch(); });
    $('qsel').addEventListener('change', (e) => this.setQuality(e.target.value));
    $('againBtn').addEventListener('click', () => location.reload());
  }
  switchTo(slot) { const c = ctx.player; if (A.switchWeapon(c, slot)) { c.reload = null; this.mouse.r = false; return true; } return false; }

  // ---------------------------------------------------------------- characters / match
  makeChar(team, def, isPlayer) {
    const app = randomAppearance(team, def.f); if (isPlayer) { app.height = 1.8; app.equip = 'medium'; app.mask = 'none'; }
    const c = new Character({ team, name: def.name, female: def.f, app, isPlayer, traits: isPlayer ? { reloadMult: 1, fumble: 0.22, soundPitch: 1, stepLoud: 1 } : randomTraits() });
    c.strideLen = rand(1.65, 2.1); c.crouchT = 0; c.wish = { x: 0, z: 0, speed: 0 };
    this.scene.add(c.group);
    if (!isPlayer) {
      c.brain = new Brain(c, this.nav);
      // flashlight beam (visible at night)
      const geo = new THREE.ConeGeometry(1.3, 13, 14, 1, true); geo.translate(0, -6.5, 0); geo.rotateX(Math.PI / 2);
      c.beam = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ color: 0xfff0c8, transparent: true, opacity: 0.0, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide, fog: false })); c.beam.frustumCulled = false; this.scene.add(c.beam);
    }
    return c;
  }
  randomLoadout(c) {
    const t = pick(['mg', 'shotgun', 'mg']); c.giveLoadout(t, !c.isPlayer && chance(0.25));
    if (!c.isPlayer && chance(0.3) && t === 'mg') c.weapons.primary.barrel = true;
    c.fireCd = 0; c.swapT = 0; c.throwT = 0; c.pumpOff = 0; c.overheat = null; c.reload = null;
    for (const k of ['primary', 'pistol']) if (c.weapons[k]) c.weapons[k].model.update(c.weapons[k]);
  }
  findRespawn(c) {
    const sign = c.team === 1 ? 1 : -1; let best = null, bs = -1e9;
    const enemies = ctx.chars.filter((e) => e.alive && e.team !== c.team), allies = ctx.chars.filter((e) => e.alive && e.team === c.team && e !== c);
    for (let i = 0; i < 60; i++) {
      let x, z;
      if (allies.length && chance(0.55)) { const a = pick(allies); x = a.pos.x + rand(-14, 14); z = a.pos.z + rand(-14, 14); } else { x = rand(-110, 110); z = sign * rand(60, 138); }
      if (Math.abs(x) > 140 || Math.abs(z) > 140) continue; const n = this.nav.idx(x, z); if (n < 0 || this.nav.blocked[n]) continue;
      if (Math.sign(z) !== sign && Math.abs(z) > 5) continue; // stay on own side of the map
      let dmin = 1e9; for (const e of enemies) dmin = Math.min(dmin, Math.hypot(e.pos.x - x, e.pos.z - z)); if (dmin < 45) continue;
      let amin = 1e9; for (const a of allies) amin = Math.min(amin, Math.hypot(a.pos.x - x, a.pos.z - z));
      let nearAny = 1e9; for (const o of ctx.chars) if (o !== c && o.alive) nearAny = Math.min(nearAny, Math.hypot(o.pos.x - x, o.pos.z - z));
      const s = Math.min(dmin, 120) / 40 + (amin < 18 ? 2 : 0) + (nearAny > 8 ? 1 : -3) + Math.random() * 0.4 - (T.trenchDist(x, z) < 0.5 ? -0.5 : 0);
      if (s > bs) { bs = s; best = { x, z }; }
    }
    return best || { x: rand(-20, 20), z: sign * 135 };
  }
  respawn(c, first = false) {
    const sign = c.team === 1 ? 1 : -1, idx = ctx.chars.indexOf(c);
    c.stopRagdoll(); c.alive = true; c.hp = 100; c.deadT = 0; c.stumble = 0; c.flinch = 0; c.crouch = 0; c.crouchT = 0; c.stamina = 1; c.exhausted = false; c.vel.set(0, 0, 0); c.recoil = 0; c.onGround = true; c.group.visible = !c.isPlayer;
    let s; if (first) { const mates = ctx.chars.filter((o) => o.team === c.team), i = mates.indexOf(c); s = { x: (i - (mates.length - 1) / 2) * 6, z: sign * 138 }; } else s = this.findRespawn(c);
    c.pos.set(s.x, T.h(s.x, s.z) + 0.02, s.z); c.yaw = c.team === 1 ? 0 : Math.PI; c.aimPitch = 0; c.aimBlend = 0.2;
    if (c.isPlayer) { this.yaw = c.yaw; this.pitch = 0; this.recoilP = this.recoilY = 0; this.damageK = 0; }
    c.grenades = 1; c.hasKnife = true; this.randomLoadout(c);
    if (c.brain) { c.brain.reset(); c.brain.aimYaw = c.yaw; c.brain.lastPos.copy(c.pos); }
    if (!c.isPlayer && c.gunG) c.gunG.visible = true;
    if (c.isPlayer) { this.mouse.l = this.mouse.r = false; }
  }
  startMatch() {
    $('menu').classList.add('hidden'); $('hud').classList.remove('hidden'); this.vm.holder.visible = true;
    ctx.chars.length = 0; ctx.score[1] = ctx.score[2] = 0;
    const pl = this.makeChar(1, { name: 'DU', f: false }, true); ctx.player = pl; ctx.chars.push(pl);
    for (const d of NPCS[1]) ctx.chars.push(this.makeChar(1, d, false)); for (const d of NPCS[2]) ctx.chars.push(this.makeChar(2, d, false));
    for (const c of ctx.chars) this.respawn(c, true);
    this.state = 'countdown'; this.countT = 3.999; this.lastCount = 4; this.updateScore(); this.post.u.uFlash.value = 0; this.lastTarget = null;
    this.showMsg('TEAMDEATHMATCH · NATO gegen RUS', 3);
  }

  // ---------------------------------------------------------------- game callbacks
  updateScore() { $('s1').textContent = ctx.score[1]; $('s2').textContent = ctx.score[2]; }
  showMsg(t, s = 2.5, warn = false) { const m = $('msg'); m.textContent = t; m.className = warn ? 'warn' : ''; this.msgT = s; }
  onPlayerHurt(att, dir, dmg, part) {
    const pl = ctx.player; this.damageK = Math.min(1, this.damageK + dmg / 60); this.regenT = 5; this.audio.hurt(); this.trauma = Math.min(1, this.trauma + 0.3 + (part === 'head' ? 0.4 : 0));
    pl.lastHit = ctx.time; if (part === 'leg') { this.trauma = Math.min(1, this.trauma + 0.25); this.roll += rand(-0.07, 0.07); }
    if (att) { const dx = att.pos.x - pl.pos.x, dz = att.pos.z - pl.pos.z, a = Math.atan2(dx, -dz) - (-this.yaw) - 0; this.dmgArc(Math.atan2(-dx, -dz) - this.yaw); }
  }
  dmgArc(ang) { const d = document.createElement('div'); d.className = 'dmgarc'; d.innerHTML = '<i></i>'; d.style.transform = `rotate(${-ang}rad)`; $('dmg').appendChild(d); d.style.transition = 'opacity 1.2s'; requestAnimationFrame(() => (d.style.opacity = 0)); setTimeout(() => d.remove(), 1300); }
  hitMarker(kill, head) { const h = $('hitm'); h.className = kill ? 'kill' : head ? 'head' : ''; h.style.opacity = 1; clearTimeout(this._hm); this._hm = setTimeout(() => (h.style.opacity = 0), 140); if (kill) this.audio.killSound(); else this.audio.hitMarker(); }
  onKill(victim, attacker, kind, part) {
    if (attacker && attacker.team !== victim.team) ctx.score[attacker.team]++;
    this.updateScore();
    const f = $('feed'), d = document.createElement('div');
    const nm = (c) => `<span class="c${c.team}">${c.name}</span>`;
    d.innerHTML = attacker && attacker !== victim ? `${nm(attacker)} [${WNAME[kind] || kind}${part === 'head' ? ' · Kopf' : ''}] ${nm(victim)}` : `${nm(victim)} ✖ ${kind === 'mine' ? 'Mine' : ''}`; f.prepend(d); setTimeout(() => d.remove(), 6000); while (f.children.length > 6) f.lastChild.remove();
    victim.respawnT = victim.isPlayer ? 3.2 : rand(2.2, 3.6);
    if (victim.isPlayer) { this.deadT = 0; $('deadinfo').classList.remove('hidden'); $('deadinfo').innerHTML = attacker && attacker !== victim ? `ELIMINIERT VON <span class="c${attacker.team}">${attacker.name}</span>` : 'DU BIST GESTORBEN'; this.deathPos = victim.pos.clone(); this.deathYaw = this.yaw; }
    if (attacker === ctx.player && victim !== attacker) this.showMsg(part === 'head' ? 'KOPFSCHUSS' : 'ELIMINIERT', 1.2);
    for (const t of [1, 2]) if (ctx.score[t] >= KILL_LIMIT && this.state === 'play') this.endMatch(t);
  }
  endMatch(winner) {
    this.state = 'ended'; document.exitPointerLock?.(); const win = winner === ctx.player.team;
    $('end').classList.remove('hidden'); $('endt').textContent = win ? 'SIEG' : 'NIEDERLAGE'; $('endt').style.color = win ? '#6fc36f' : '#e0583f'; $('ends').textContent = `NATO ${ctx.score[1]}  ·  RUS ${ctx.score[2]}`;
  }
  dropWeapons(c, vel) { A.dropWeapons(c, vel); }
  explosionFlash(pos, r) { this.muzzleLight.position.copy(pos).setY(pos.y + 1.5); this.muzzleLight.color.setRGB(1, 0.6, 0.25); this.muzzleLight.intensity = 400; this.muzzleLight.distance = 40; this.muzzleT = 0.35; const d = pos.distanceTo(this.camera.position); if (d < 8) this.flashK = Math.max(this.flashK, 0.6 * (1 - d / 8)); }
  shake(a) { this.trauma = Math.min(1, this.trauma + a); }
  suppress(k) { this.suppressK = Math.min(1, this.suppressK + k * 0.35); }
  muzzleFlash(c, pos, sup, kind) {
    if (sup) return; this.muzzleLight.position.copy(pos); this.muzzleLight.color.setRGB(1, 0.65, 0.3); this.muzzleLight.intensity = kind === 'shotgun' ? 90 : 55; this.muzzleLight.distance = 18; this.muzzleT = 0.05;
    if (c.isPlayer) { this.vm.fire(DEFS[c.weapon.type]); this.vmMuzzle.intensity = 6; this.vmMuzzleT = 0.05; }
  }
  noise(pos, radius, team, src) { for (const c of ctx.chars) { if (!c.alive || !c.brain || c.team === team) continue; const d = c.pos.distanceTo(pos); if (d < radius && (d < radius * 0.5 || chance(0.5))) c.brain.hear(pos, team); } }

  tryGrenade() { const c = ctx.player; if (c.grenades <= 0 || c.throwT > 0 || c.reload || c.swapT > 0) return; c.throwT = 0.8; this.throwQ = { t: 0.45 }; this.audio.mech('pin', c.pos, 1); }
  doPickup() {
    const c = ctx.player, p = this.prompt; if (!p) return; const d = p.data;
    if (p.kind === 'weapon') {
      const w = d.weapon; const slot = w.def.slot;
      const old = c.weapons[slot]; const pos = c.pos.clone().add(new THREE.Vector3(0, 0.8, 0));
      if (old) { A.makeWeaponProp(old, pos.add(new THREE.Vector3(-Math.sin(this.yaw) * 0.5, 0, -Math.cos(this.yaw) * 0.5)), new THREE.Vector3(-Math.sin(this.yaw) * 1.2, 1.5, -Math.cos(this.yaw) * 1.2), 0); }
      c.weapons[slot] = w; w.model = null; c.rebuildGunModels(); c.ammo[w.ammoType] += w.type === 'rpg' ? 1 : w.type === 'shotgun' ? 6 : w.type === 'pistol' ? 8 : w.cap;
      c.reload = null; c.cur = slot; c.swapT = 0.45; this.showMsg(`${DEFS[w.type].name} aufgenommen`, 1.5);
    } else if (p.kind === 'ammo') { c.ammo[d.type] += d.amount; this.showMsg(`+${d.amount} ${p.label}`, 1.5); }
    else if (p.kind === 'att') {
      if (d.kind === 'sup') { const w = c.weapons.primary && c.weapons.primary.type !== 'rpg' && !c.weapons.primary.sup ? c.weapons.primary : (c.weapons.pistol && !c.weapons.pistol.sup ? c.weapons.pistol : null); if (!w) { this.showMsg('Kein passender Anbau-Platz', 1.5); return; } w.sup = true; w.model.update(w); this.showMsg(`Schalldämpfer an ${DEFS[w.type].name}`, 1.8); this.audio.mech('attach', c.pos, 1); }
      else { const w = c.weapons.primary; if (!w || w.type !== 'mg' || w.barrel) { this.showMsg('Langer Lauf passt nur auf das MG', 1.8); return; } w.barrel = true; w.model.update(w); this.showMsg('Langer Lauf montiert · präziser', 1.8); this.audio.mech('attach', c.pos, 1); }
    } else if (p.kind === 'knife') { c.hasKnife = true; this.showMsg('Messer aufgenommen', 1.2); }
    else return;
    this.audio.mech('pickup', c.pos, 1); this.fx.removeProp(p); this.prompt = null;
  }

  // ---------------------------------------------------------------- environment helpers
  surfaceFor(c) {
    for (const b of this.world.buildings) if (Math.abs(c.pos.x - b.cx) < b.hx - 0.3 && Math.abs(c.pos.z - b.cz) < b.hz - 0.3) return b.name === 'A' ? 'concrete' : 'wood';
    const s = T.surfaceAt(c.pos.x, c.pos.z);
    if (s !== 'mud') for (const t of this.world.trees) { if (t.leafy && Math.abs(t.x - c.pos.x) < 5 && Math.abs(t.z - c.pos.z) < 5 && Math.random() < 0.6) return 'leaves'; }
    return s;
  }
  computeEnv(p) {
    const base = T.h(p.x, p.z), avg = (T.h(p.x + 3.5, p.z) + T.h(p.x - 3.5, p.z) + T.h(p.x, p.z + 3.5) + T.h(p.x, p.z - 3.5)) / 4;
    const trench = smooth(0.25, 1.1, avg - base) * (T.trenchDist(p.x, p.z) < 2.2 ? 1 : 0.3);
    let building = 0; for (const b of this.world.buildings) if (Math.abs(p.x - b.cx) < b.hx - 0.4 && Math.abs(p.z - b.cz) < b.hz - 0.4) building = 1;
    let dense = 0; for (const t of this.world.trees) if (t.alive && Math.hypot(t.x - p.x, t.z - p.z) < 16) dense++;
    return { trench, building, dense: clamp(dense / 6, 0, 1), rain: this.sky.rain, night: this.sky.dark, wind: clamp(this.sky.wind / 1.2, 0, 1) };
  }

  // ---------------------------------------------------------------- per-frame
  loop(tms) {
    const t = tms / 1000; const dt = this.last ? Math.min(0.05, t - this.last) : 0.016; this.last = t;
    this.post.adaptScale(dt * 1000);
    if (this.state === 'paused') { this.renderFrame(dt); return; }
    this.tick(dt); this.renderFrame(dt);
  }
  // advance the simulation (also used by automated tests to fast-forward without rendering)
  tick(dt) {
    this.frame++; ctx.time += dt;
    const st = this.state; const live = st === 'play' || st === 'countdown' || st === 'ended';
    const camPos = this.camera.position;
    this.sky.update(dt, camPos); this.world.update(dt, camPos);
    this.fx.updateProps(dt, ctx.chars, { explode: (p) => C.explode(p.pos.clone().setY(p.pos.y + 0.1), 4, 170, p.owner, 'grenade'), flight: (p, d, k) => A.flightStep(p, d, k) });
    this.fx.update(dt, ctx.chars, this.camera, this.world.trees, this.post.rt.height);
    if (st === 'menu') this.menuCam(dt); else if (live) this.simulate(dt);
    this.updateLights(dt);
  }

  menuCam(dt) {
    this.menuT += dt; const a = this.menuT * 0.035 + 0.6, R = 58;
    const x = Math.cos(a) * R, z = Math.sin(a) * R - 15, y = Math.max(T.h(x, z), 0) + 7 + Math.sin(this.menuT * 0.1) * 2;
    this.camera.position.set(x, y, z); this.camera.lookAt(0, 2, -15); this.camera.fov = 60; this.camera.updateProjectionMatrix();
    this.audio.update(dt, this.camera, { trench: 0, building: 0, dense: 0.2, rain: this.sky.rain, night: this.sky.dark, wind: clamp(this.sky.wind / 1.2, 0, 1) }, 0, 100);
  }

  simulate(dt) {
    const pl = ctx.player, sky = this.sky;
    // countdown
    if (this.state === 'countdown') {
      this.countT -= dt; const n = Math.ceil(this.countT);
      if (n !== this.lastCount) { this.lastCount = n; if (n > 0) { $('count').textContent = n; this.audio.beep(520, 0.12); } }
      if (this.countT <= 0) { this.state = 'play'; $('count').textContent = 'LOS!'; this.audio.beep(900, 0.4); setTimeout(() => ($('count').textContent = ''), 900); }
    }
    const playing = this.state === 'play';
    // flashlights at night
    const dark = sky.dark > 0.55; for (const c of ctx.chars) c.flashOn = this.flashLightManual === null ? dark : (c.isPlayer ? this.flashLightManual : dark);
    // characters
    for (const c of ctx.chars) {
      if (c.isPlayer) this.updatePlayer(dt, playing); else this.updateNPC(c, dt, playing);
      if (!c.alive) {
        c.respawnT -= dt; if (c.respawnT <= 0 && this.state === 'play') { this.respawn(c); if (c.isPlayer) { $('deadinfo').classList.add('hidden'); } }
      }
    }
    // env
    this.envT -= dt; if (this.envT <= 0) { this.envT = 0.2; this.env = this.computeEnv(pl.pos); }
    if (this.msgT > 0) { this.msgT -= dt; if (this.msgT <= 0) $('msg').textContent = ''; }
    this.updateHUD(dt);
    this.mmT -= dt; if (this.mmT <= 0) { this.mmT = 0.05; this.drawMiniMap(); }
    this.updateMarkers();
    this.glintT -= dt; if (this.glintT <= 0) { this.glintT = 0.7; for (const p of this.fx.props) if (p.pickable && p.pos.distanceTo(this.camera.position) < 35) this.fx.emit(p.pos.x, p.pos.y + 0.2, p.pos.z, 0, 0.15, 0, { c: [1, 0.95, 0.7], a: 0.8, life: 0.9, size: 0.07, grow: 1.5, add: 1 }); }
  }

  // ---------------------------------------------------------------- NPC
  updateNPC(c, dt, playing) {
    if (c.alive) {
      if (playing) c.brain.update(dt);
      const w = c.wish, tx = w.x * w.speed, tz = w.z * w.speed, k = c.onGround ? Math.min(1, dt * 7) : Math.min(1, dt * 1.5);
      c.vel.x += (tx - c.vel.x) * k; c.vel.z += (tz - c.vel.z) * k;
      c.crouchT = c.crouchT; physStep(c, dt);
      A.updateWeaponState(c, dt);
      this.footsteps(c, dt);
      // pick up ammo that lies on the ground
      for (const p of this.fx.props) { if (p.kind === 'ammo' && Math.abs(p.pos.x - c.pos.x) < 1.2 && Math.abs(p.pos.z - c.pos.z) < 1.2) { const need = c.weapons.primary?.ammoType === p.data.type || p.data.type === 'pistol'; if (need) { c.ammo[p.data.type] += p.data.amount; this.audio.mech('pickup', c.pos, 0.8); this.fx.removeProp(p); break; } } }
      if (c.knifeProp && !c.hasKnife && Math.hypot(c.knifeProp.pos.x - c.pos.x, c.knifeProp.pos.z - c.pos.z) < 1.2) { c.hasKnife = true; this.fx.removeProp(c.knifeProp); c.knifeProp = null; }
      // gun light beam
    } else c.deadT += dt;
    c.updateRig(dt, ctx.time, this.sky.wind);
    // torch beam mesh (only visible at night)
    if (c.beam) {
      const on = c.alive && c.flashOn && c.cur !== 'knife'; const night = this.sky.dark;
      c.beam.visible = on && night > 0.4;
      if (c.beam.visible) { A.muzzleWorld(c, c.beam.position); _e.set(c.aimPitch, c.yaw, 0); c.beam.quaternion.setFromEuler(_e); c.beam.material.opacity = 0.022 * night; }
    }
  }

  footsteps(c, dt) {
    if (!c.onGround) return; const sp = c.moveSpeed; if (sp < 0.5) return;
    c.stepDist += sp * dt; const len = c.strideLen * (c.crouch > 0.5 ? 0.8 : 1) * (sp > 4 ? 1.25 : 1);
    if (c.stepDist >= len) {
      c.stepDist = 0; const tr = c.traits || {}; this.audio.footstep(this.surfaceFor(c), c.pos, (tr.stepLoud || 1) * (sp > 4 ? 1.3 : 1) * (c.crouch > 0.5 ? 0.5 : 1), tr.soundPitch || 1, sp > 4 ? 1.3 : 1);
      if (Math.random() < 0.5) this.audio.rustle(c.pos, 1, tr.soundPitch || 1);
      if (c !== ctx.player && Math.random() < 0.4) this.noise(c.pos, sp > 4 ? 12 : 5, c.team, c);
    }
  }

  // ---------------------------------------------------------------- Player
  updatePlayer(dt, playing) {
    const c = ctx.player, k = this.keys, m = this.mouse, sky = this.sky;
    // look
    const sens = 0.0022 * (this.vm.ads > 0.5 ? 0.62 : 1) * (c.reload ? 0.9 : 1);
    this.turnRate = 0;
    if (c.alive && (playing || this.state === 'countdown')) {
      const dyaw = -m.dx * sens, dp = -m.dy * sens; this.yaw += dyaw; this.pitch = clamp(this.pitch + dp, -1.45, 1.45); this.turnRate = dyaw / Math.max(dt, 1e-3);
    }
    m.dx = m.dy = 0;
    c.yaw = this.yaw; c.aimPitch = this.pitch + this.recoilP;
    if (!c.alive) { c.deadT += dt; c.updateRig(dt, ctx.time, sky.wind); this.regenT = 5; return; }
    // locomotion
    const fwd = (k.KeyW ? 1 : 0) - (k.KeyS ? 1 : 0), side = (k.KeyD ? 1 : 0) - (k.KeyA ? 1 : 0), can = playing;
    const moving = (fwd || side) && can;
    c.crouchT = can && (k.KeyC || k.ControlLeft) ? 1 : 0;
    // stamina: 6 seconds of sprint, then it has to recharge completely
    const wantSprint = can && k.ShiftLeft && fwd > 0 && !c.exhausted && c.crouchT < 0.5 && !this.mouse.r && !c.reload && c.onGround;
    const sprinting = wantSprint && c.stamina > 0;
    if (sprinting) { c.stamina = Math.max(0, c.stamina - dt / 6); if (c.stamina <= 0) { c.exhausted = true; this.showMsg('AUSDAUER ERSCHÖPFT', 1.5); } }
    else c.stamina = Math.min(1, c.stamina + dt / 8.5);
    if (c.exhausted && c.stamina >= 1) c.exhausted = false;
    let speed = 3.4; if (sprinting) speed = 5.6; else if (c.crouchT > 0.5) speed = 1.9; else if (this.vm.ads > 0.4) speed = 2.1;
    if (c.stumble > 0) speed *= 0.6; if (c.cur === 'primary' && c.weapons.primary?.type === 'rpg') speed *= 0.9;
    if (side && fwd) speed *= 0.93;
    const wx = (-Math.sin(this.yaw)) * fwd + Math.cos(this.yaw) * side, wz = (-Math.cos(this.yaw)) * fwd + (-Math.sin(this.yaw)) * side, wl = Math.hypot(wx, wz) || 1;
    const tx = moving ? wx / wl * speed : 0, tz = moving ? wz / wl * speed : 0;
    const acc = c.onGround ? (moving ? 11 : 13) : 1.6; // slightly heavy, weighty movement
    c.vel.x += (tx - c.vel.x) * Math.min(1, acc * dt); c.vel.z += (tz - c.vel.z) * Math.min(1, acc * dt);
    if (can && k.Space && c.onGround && !c.exhausted) { c.vel.y = 5.3; c.onGround = false; this.audio.footstep(this.surfaceFor(c), c.pos, 0.9, 0.9, 1.2); }
    c.sprinting = sprinting;
    const landed = physStep(c, dt);
    if (landed > 0) { this.audio.land(c.pos, this.surfaceFor(c)); this.landDip = Math.min(0.22, landed * 0.025); this.trauma = Math.min(1, this.trauma + Math.min(0.3, landed * 0.03)); }
    // mines beyond the border
    const lim = T.PLAY + 1.2;
    if (Math.abs(c.pos.x) > lim || Math.abs(c.pos.z) > lim) { this.mineDeath(c); return; }
    const edge = Math.max(Math.abs(c.pos.x), Math.abs(c.pos.z));
    if (edge > T.PLAY - 7 && this.msgT <= 0.2) this.showMsg('WARNUNG11 · MINENFELD · UMKEHREN', 0.6, true);
    // footsteps
    this.footsteps(c, dt);
    // weapon handling
    A.updateWeaponState(c, dt);
    const w = c.weapon, def = w?.def;
    const adsOn = m.r && c.cur !== 'knife' && !c.reload && !c.overheat && !sprinting;
    this.ads = adsOn;
    if (playing && w && !sprinting && !c.throwT) {
      const fire = def.auto ? m.l : m.lPressed;
      if (fire && c.swapT <= 0) {
        if (w.mag <= 0 && m.lPressed) { if (c.ammo[w.ammoType] > 0) A.startReload(c); else A.fireWeapon(c, this.camera.position, new THREE.Vector3(0, 0, -1)); }
        else if (!c.reload || (c.reload.type === 'shotgun' && w.mag > 0)) {
          if (c.reload) { c.reload.cancel = true; c.reload = null; w.model.update(w); }
          const dir = new THREE.Vector3(0, 0, -1).applyEuler(_e.set(this.pitch + this.recoilP, this.yaw + this.recoilY, 0));
          const spreadMul = 1 + clamp(c.moveSpeed / 4, 0, 1) * 1.1 + (c.onGround ? 0 : 2) + (c.crouch > 0.5 ? -0.25 : 0) + (c.stumble > 0 ? 1.2 : 0);
          const before = w.mag;
          if (A.fireWeapon(c, this.camera.position, dir, { ads: adsOn, spread: (adsOn ? def.ads : def.spread) * spreadMul })) this.playerRecoil(def, adsOn);
        }
      }
      if (c.reload && c.reload.type === 'shotgun' && fire && w.mag > 0) { c.reload.cancel = true; }
    } else if (playing && c.cur === 'knife' && m.lPressed) {
      A.meleeAttack(c, this.camera.position, new THREE.Vector3(0, 0, -1).applyEuler(_e.set(this.pitch, this.yaw, 0)));
    }
    if (playing && c.cur === 'knife' && m.rPressed && c.hasKnife) { A.throwKnife(c, this.camera.position.clone(), new THREE.Vector3(0, 0, -1).applyEuler(_e.set(this.pitch + 0.03, this.yaw, 0))); }
    if (playing && w && m.lPressed && c.reload && c.reload.type !== 'shotgun') { /* can't fire while reloading */ }
    if (w && w.mag === 0 && c.ammo[w.ammoType] > 0 && !c.reload && !c.overheat && playing && c.swapT <= 0 && c.cur !== 'knife' && !m.l) { if (this.autoReloadT === undefined) this.autoReloadT = 0.25; }
    if (this.throwQ) { this.throwQ.t -= dt; if (this.throwQ.t <= 0) { this.throwQ = null; const d = new THREE.Vector3(0, 0, -1).applyEuler(_e.set(this.pitch + 0.12, this.yaw, 0)); const v = d.multiplyScalar(15).add(new THREE.Vector3(0, 2, 0)).addScaledVector(c.vel, 0.7); A.throwGrenade(c, this.camera.position.clone().addScaledVector(d, 0.02).add(new THREE.Vector3(0, -0.1, 0)), v); } }
    m.lPressed = false; m.rPressed = false;
    // health regen after a pause without taking damage
    this.regenT -= dt; if (this.regenT <= 0 && c.hp < 100) c.hp = Math.min(100, c.hp + dt * 14);
    this.damageK = Math.max(0, this.damageK - dt * 0.5); this.suppressK = Math.max(0, this.suppressK - dt * 0.6);
    this.vmState = { ads: adsOn, speed: c.onGround ? c.moveSpeed : 0, sprintK: sprinting ? 1 : 0, yaw: this.yaw, pitch: this.pitch };
    // pickups in reach
    this.findPrompt();
    // keep body used for hit detection in sync
    c.updateRigPlayer = true; c.moveSpeed = Math.hypot(c.vel.x, c.vel.z); c.crouch = damp(c.crouch, c.crouchT, 9, dt);
    c.stumble = Math.max(0, c.stumble - dt); c.flinch = Math.max(0, c.flinch - dt * 3); c.recoil = Math.max(0, c.recoil - dt * 7);
  }
  playerRecoil(def, ads) {
    const c = ctx.player, f = ads ? 0.7 : 1, w = c.weapon;
    const kp = def.kick.p * 0.0175 * f * (w?.barrel ? 0.8 : 1) * (w?.sup ? 0.92 : 1);
    this.recoilP += kp; this.pitch += kp * 0.28; this.recoilY += (Math.random() - 0.5) * def.kick.y * 0.0175 * f * 1.4;
    this.trauma = Math.min(1, this.trauma + def.kick.z * 1.6 + (def.sound === 'shotgun' ? 0.18 : 0.05));
  }
  mineDeath(c) {
    const p = c.pos.clone(); C.explode(p, 3.5, 400, null, 'mine'); this.showMsg('MINE! · Du wurdest zurückgesetzt', 2.5, true);
    C.kill(c, null, new THREE.Vector3(0, 1, 0), 'torso', 'mine', 1);
  }
  findPrompt() {
    const c = ctx.player, cam = this.camera; let best = null, bs = 1e9;
    const fwd = _v.set(0, 0, -1).applyEuler(_e.set(this.pitch, this.yaw, 0));
    for (const p of this.fx.props) {
      if (!p.pickable) continue; const d = p.pos.distanceTo(cam.position); if (d > 2.6) continue;
      const dir = _w.copy(p.pos).sub(cam.position).normalize(), dot = dir.dot(fwd); const s = d * (2.2 - dot); if ((dot > 0.35 || d < 1.3) && s < bs) { bs = s; best = p; }
    }
    this.prompt = best; const el = $('prompt');
    if (best) { el.classList.remove('hidden'); const lbl = best.label + (best.kind === 'weapon' ? ` (${best.data.weapon.mag} Schuss)` : ''); el.innerHTML = `<b>[E]</b> ${lbl} aufheben`; } else el.classList.add('hidden');
  }

  // ---------------------------------------------------------------- HUD
  updateHUD(dt) {
    const c = ctx.player, w = c.weapon;
    $('hpn').textContent = Math.ceil(c.hp); $('hpbar').firstElementChild.style.width = c.hp + '%';
    $('stambar').firstElementChild.style.width = (c.stamina * 100) + '%'; $('stambar').classList.toggle('tired', !!c.exhausted);
    if (c.cur === 'knife') { $('wname').textContent = 'Messer' + (c.hasKnife ? '' : ' (geworfen)'); $('mag').textContent = '—'; $('res').textContent = ''; $('heat').firstElementChild.style.width = 0; }
    else if (w) {
      $('wname').textContent = w.def.name + (w.sup ? ' · Dämpfer' : '') + (w.barrel ? ' · Langlauf' : ''); $('mag').textContent = w.mag; $('res').textContent = '/ ' + c.ammo[w.ammoType];
      $('mag').parentElement.classList.toggle('low', w.mag <= Math.max(2, w.cap * 0.2)); const h = clamp(w.heat, 0, 1); $('heat').firstElementChild.style.width = (h * 100) + '%'; $('heat').style.opacity = h > 0.15 ? 1 : 0.25;
    }
    $('extras').textContent = `GRANATE ×${c.grenades}   ·   MESSER ${c.hasKnife ? '●' : '○'}`;
    $('slots').innerHTML = ['primary', 'pistol', 'knife'].map((k, i) => `<b class="${c.cur === k ? 'on' : ''}">${i + 1}</b>`).join('');
    $('clock').textContent = `${this.sky.clock()}  ·  ${this.sky.rain > 0.2 ? 'REGEN' : this.sky.dark > 0.5 ? 'NACHT' : this.sky.tod < 9 ? 'MORGEN' : this.sky.tod < 16.5 ? 'TAG' : 'ABEND'}`;
    // dynamic crosshair
    const w2 = c.weapon, base = w2 ? w2.def.spread * 900 : 8, gap = (this.vm.ads > 0.5 ? 2 : 6 + base * (1 + clamp(c.moveSpeed / 4, 0, 1))) + this.vm.kick.z * 120;
    const o = (id, tx, ty) => { $(id).style.transform = `translate(${tx}px,${ty}px)`; }; o('ch-l', -gap - 9, 0); o('ch-r', gap, 0); o('ch-t', 0, -gap - 9); o('ch-b', 0, gap);
    $('crosshair').style.opacity = this.vm.ads > 0.6 || !c.alive || c.cur === 'rpg' ? 0 : 0.9;
    if (this.state === 'play') $('count').textContent = $('count').textContent === 'LOS!' ? 'LOS!' : '';
    $('fps').textContent = `${Math.round(1000 / Math.max(1, this.post.ema))} FPS · ${(this.post.scale * 100) | 0}% Auflösung`;
    $('goal').textContent = `ZIEL ${KILL_LIMIT}`;
  }
  updateMarkers() {
    const pl = ctx.player, cam = this.camera; const wrap = $('marks'); let i = 0;
    for (const c of ctx.chars) {
      if (c === pl || c.team !== pl.team || !c.alive) continue;
      let el = this.markEls[i]; if (!el) { el = document.createElement('div'); el.className = 'mark'; wrap.appendChild(el); this.markEls[i] = el; } i++;
      _v.set(c.pos.x, c.pos.y + 2.15 * c.s, c.pos.z).project(cam);
      const d = c.pos.distanceTo(pl.pos); const vis = _v.z < 1 && Math.abs(_v.x) < 1.1 && Math.abs(_v.y) < 1.1 && d < 120;
      el.style.display = vis ? 'block' : 'none'; el.style.left = ((_v.x * 0.5 + 0.5) * innerWidth) + 'px'; el.style.top = ((-_v.y * 0.5 + 0.5) * innerHeight) + 'px'; el.textContent = `${c.name} · ${Math.round(d)}m`;
    }
    for (; i < this.markEls.length; i++) this.markEls[i].style.display = 'none';
  }

  // ---------------------------------------------------------------- lights, camera, render
  updateLights(dt) {
    const sky = this.sky, pl = ctx.player;
    this.muzzleT -= dt; if (this.muzzleT <= 0) this.muzzleLight.intensity = 0;
    this.vmMuzzleT = (this.vmMuzzleT || 0) - dt; if (this.vmMuzzleT <= 0) this.vmMuzzle.intensity = 0;
    // viewmodel lights mirror the world lighting
    this.vmHemi.color.copy(sky.hemi.color); this.vmHemi.groundColor.copy(sky.hemi.groundColor); this.vmHemi.intensity = sky.hemi.intensity * 1.1 + 0.05;
    const dayI = sky.sun.intensity, moonI = sky.moon.intensity, useSun = dayI > moonI * 2;
    this.vmSun.color.copy(useSun ? sky.sun.color : sky.moon.color); this.vmSun.intensity = Math.max(dayI, moonI * 1.5) * 0.6; _v.copy(useSun ? sky.sunDir : sky.moonDir).applyAxisAngle(new THREE.Vector3(0, 1, 0), -this.yaw); this.vmSun.position.copy(_v).multiplyScalar(3);
    this.vmScene.environmentIntensity = this.scene.environmentIntensity;
    // player torch
    const on = pl && pl.alive && pl.flashOn && this.state !== 'menu';
    if (pl && on) { this.torch.intensity = 260; this.torch.position.copy(this.camera.position).add(_v.set(0.15, -0.12, -0.2).applyQuaternion(this.camera.quaternion)); this.torch.target.position.copy(this.camera.position).add(_w.set(0, 0, -12).applyQuaternion(this.camera.quaternion)); this.torch.target.updateMatrixWorld(); } else this.torch.intensity = 0;
    // npc torches: three nearest
    const cands = ctx.chars.filter((c) => !c.isPlayer && c.alive && c.flashOn && c.cur !== 'knife').sort((a, b) => a.pos.distanceToSquared(this.camera.position) - b.pos.distanceToSquared(this.camera.position));
    this.npcTorch.forEach((l, i) => { const c = cands[i]; if (c) { l.intensity = 170; A.muzzleWorld(c, l.position); l.target.position.copy(l.position).add(_v.set(-Math.sin(c.yaw) * Math.cos(c.aimPitch), Math.sin(c.aimPitch), -Math.cos(c.yaw) * Math.cos(c.aimPitch)).multiplyScalar(10)); l.target.updateMatrixWorld(); } else l.intensity = 0; });
  }

  renderFrame(dt) {
    const cam = this.camera, pl = ctx.player, st = this.state;
    if (pl && (st === 'play' || st === 'countdown' || st === 'ended' || st === 'paused')) {
      const c = pl, crouchEye = 1 - 0.3 * c.crouch;
      this.landDip = damp(this.landDip, 0, 7, dt);
      const spd = c.onGround ? c.moveSpeed : 0; this.bobT += spd * dt * (c.sprinting ? 2.0 : 1.7);
      const bob = Math.sin(this.bobT * 2) * 0.022 * clamp(spd / 4, 0, 1) * (c.sprinting ? 1.4 : 1) * (this.vm.ads > 0.5 ? 0.25 : 1);
      let eye = 1.64 * crouchEye + bob - this.landDip;
      this.trauma = Math.max(0, this.trauma - dt * 1.3);
      const sh = this.trauma * this.trauma, tt = ctx.time * 40;
      this.recoilP = damp(this.recoilP, 0, 5.5, dt); this.recoilY = damp(this.recoilY, 0, 5, dt);
      this.roll = damp(this.roll, c.stumble > 0 ? Math.sin(ctx.time * 9) * 0.06 : 0, 6, dt);
      if (c.alive) {
        cam.position.set(c.pos.x, c.pos.y + eye, c.pos.z);
        _e.set(this.pitch + this.recoilP + Math.sin(tt) * 0.02 * sh, this.yaw + this.recoilY + Math.cos(tt * 1.3) * 0.02 * sh, this.roll + Math.sin(tt * 0.7) * 0.03 * sh + (-Math.sin(this.bobT) * 0.004 * clamp(spd / 4, 0, 1)));
        cam.quaternion.setFromEuler(_e);
      } else {
        // death: the view drops to the ground and turns toward the sky
        const k = clamp(this.deadT * 1.2, 0, 1); const gy = T.h(c.pos.x, c.pos.z);
        cam.position.set(c.pos.x, lerp(c.pos.y + 1.6, gy + 0.25, k * k), c.pos.z); _e.set(lerp(this.pitch, 0.6, k), this.yaw, lerp(0, 0.9, k)); cam.quaternion.setFromEuler(_e);
      }
      const fovT = 75 + (c.sprinting ? 7 : 0) - (this.vm.ads > 0 ? 18 * this.vm.ads : 0); cam.fov = damp(cam.fov, fovT, 12, dt); cam.updateProjectionMatrix();
      this.audio.update(dt, cam, this.env || {}, this.turnRate || 0, c.alive ? c.hp : 100);
      if (c.alive && this.vmState) this.vm.update(dt, c, this.vmState);
      else if (!c.alive) { for (const s of ['L', 'R']) { const a = this.vm.arm[s]; a.ua.visible = a.fa.visible = a.hand.visible = a.thumb.visible = false; } for (const k of ['primary', 'pistol']) if (c.weapons[k]?.model) c.weapons[k].model.group.visible = false; if (c.knifeModel) c.knifeModel.group.visible = false; }
    }
    // post uniforms
    const u = this.post.u; u.uExposure.value = damp(u.uExposure.value, this.sky.exposure, 2, dt);
    this.flashK = Math.max(0, this.flashK - dt * 0.9);
    u.uDamage.value = clamp(this.damageK * 0.8 + (pl && pl.hp < 30 ? (30 - pl.hp) / 60 : 0) + this.suppressK * 0.12, 0, 1); u.uFlash.value = this.flashK; u.uDark.value = this.sky.dark; u.uRain.value = this.sky.rain;
    this.vmCam.fov = 63 + (this.camera.fov < 70 ? -6 * (75 - this.camera.fov) / 18 : 0); this.vmCam.updateProjectionMatrix();
    const live = pl && (st === 'play' || st === 'countdown' || st === 'ended' || st === 'paused') && this.vm.holder.visible;
    this.post.render(this.scene, this.camera, live ? this.vmScene : null, this.vmCam, ctx.time);
  }
}
