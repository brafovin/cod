import * as THREE from 'three';
import { ctx } from './ctx.js';
import * as T from './terrain.js';
import { clamp, rand, chance, gauss, lerp } from './util.js';
import { Weapon, DEFS, ReloadAnim, OverheatAnim, buildGun, buildKnife, buildGrenadeMesh } from './weapons.js';
import { fireBullet, castRay, explode, hurt, impactFx } from './combat.js';
import * as TX from './textures.js';

const _v = new THREE.Vector3(), _d = new THREE.Vector3(), _q = new THREE.Quaternion(), _e = new THREE.Euler();
const LYING = new THREE.Quaternion().setFromEuler(new THREE.Euler(0, 0, Math.PI / 2));

// ---------------------------------------------------------------- prop meshes
let ammoMats = null;
function ammoBoxMesh(type) {
  ammoMats ||= { mg: new THREE.MeshStandardMaterial({ map: TX.crateTex(), roughness: 0.7 }), shotgun: new THREE.MeshStandardMaterial({ color: 0x7a2a1a, roughness: 0.7 }), pistol: new THREE.MeshStandardMaterial({ color: 0x3a4a5a, roughness: 0.7 }), rpg: new THREE.MeshStandardMaterial({ color: 0x4a4a2a, roughness: 0.7 }) };
  const g = new THREE.Group(), m = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.17, 0.2), ammoMats[type]); m.castShadow = true; g.add(m);
  const hnd = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.02, 0.02), new THREE.MeshStandardMaterial({ color: 0x222222 })); hnd.position.y = 0.1; g.add(hnd);
  return g;
}
export function makeWeaponProp(w, pos, vel, reserve = 0) {
  if (!w.model) w.model = buildGun(w); else w.model.update(w);
  const wrap = new THREE.Group(); const g = w.model.group; g.visible = true; g.position.set(0, 0, w.type === 'pistol' ? 0.0 : 0.3); g.rotation.set(0, 0, 0); g.scale.setScalar(1);
  if (w.model.mag) { w.model.mag.group.visible = true; w.model.mag.group.position.copy(w.model.magRest); }
  w.model.group.traverse((c) => { if (c.isMesh) c.castShadow = true; });
  wrap.add(g);
  const mesh = wrap; const p = ctx.fx.addProp({ kind: 'weapon', mesh, pos: pos.clone(), vel: vel.clone(), rest: 0.05, size: w.type === 'pistol' ? 0.2 : 0.45, lying: LYING, data: { weapon: w, reserve }, pickable: true, label: DEFS[w.type].name });
  return p;
}
export function makeAmmoProp(type, amount, pos, vel = new THREE.Vector3()) {
  return ctx.fx.addProp({ kind: 'ammo', mesh: ammoBoxMesh(type), pos: pos.clone(), vel, rest: 0.085, size: 0.3, data: { type, amount }, pickable: true, label: { mg: 'MG-Munition', shotgun: 'Schrotpatronen', pistol: 'Pistolenmunition', rpg: 'Rakete' }[type] });
}
const attMat = new THREE.MeshStandardMaterial({ color: 0x1a1a1a, roughness: 0.5, metalness: 0.8 });
export function makeAttachmentProp(kind, pos, vel = new THREE.Vector3()) {
  const g = new THREE.Group();
  const m = new THREE.Mesh(kind === 'sup' ? new THREE.CylinderGeometry(0.024, 0.024, 0.24, 12) : new THREE.CylinderGeometry(0.014, 0.014, 0.3, 12), kind === 'sup' ? attMat : new THREE.MeshStandardMaterial({ color: 0x6a6e70, roughness: 0.3, metalness: 0.9 }));
  m.rotation.z = Math.PI / 2; m.castShadow = true; g.add(m);
  return ctx.fx.addProp({ kind: 'att', mesh: g, pos: pos.clone(), vel, rest: 0.03, size: 0.3, data: { kind }, pickable: true, label: kind === 'sup' ? 'Schalldämpfer' : 'Langer Lauf' });
}
export function makeMagProp(cap, count, pos, vel) {
  const mv = buildMagVis(cap, count); const g = new THREE.Group(); g.add(mv.group); mv.group.position.y = mv.H * 0.5;
  return ctx.fx.addProp({ kind: 'mag', mesh: g, pos: pos.clone(), vel: vel.clone(), rest: 0.03, size: 0.2, lying: new THREE.Quaternion().setFromEuler(new THREE.Euler(0, 0, Math.PI / 2 * 0.98)), data: { count } });
}
function buildMagVis(cap, count) { const w = { type: 'mg', cap, mag: count, heat: 0 }; const m = buildGun(w); const mv = m.mag; mv.setCount(count); return mv; }
export function makeKnifeProp(pos, vel = new THREE.Vector3(), stuck = null) {
  const k = buildKnife(); const wrap = new THREE.Group(); k.group.position.z = 0.1; wrap.add(k.group);
  return ctx.fx.addProp({ kind: 'knife', mesh: wrap, pos: pos.clone(), vel, rest: 0.02, size: 0.3, lying: LYING, data: {}, pickable: true, label: 'Messer' });
}

// ---------------------------------------------------------------- weapon handling
export function curWeapon(c) { return c.cur === 'knife' ? null : c.weapons[c.cur]; }
export function totalAmmo(c, w) { return w ? w.mag + c.ammo[w.ammoType] : 0; }

export function switchWeapon(c, slot) {
  if (c.cur === slot || c.swapT > 0) return false;
  if (slot === 'knife' && !c.hasKnife) return false; if (slot !== 'knife' && !c.weapons[slot]) return false;
  c.reload = null; c.overheat = null; c.cur = slot; c.swapT = 0.45; c.swapAnim = 1; ctx.audio.mech('swap', c.pos, 0.5);
  return true;
}

export function startReload(c, speedMult = 1) {
  const w = curWeapon(c); if (!w || c.reload || c.overheat) return false;
  const need = w.cap - w.mag; if (need <= 0 || c.ammo[w.ammoType] <= 0) return false;
  const model = w.model || (w.model = buildGun(w));
  const t = c.traits || {};
  const anim = new ReloadAnim(model, w, (w.type === 'shotgun' ? 1 : (DEFS[w.type].reload / 2.7) / 0.95) * (t.reloadMult || 1) / speedMult, t.fumble ?? (c.isPlayer ? 0.22 : 0.2));
  anim.type = w.type; anim.magState = w.type === 'shotgun' ? 'in' : 'in'; anim.shellInHand = false; anim.oldCount = w.mag; anim.newCount = 0; anim.firstShell = true;
  if (w.type === 'shotgun') anim.magState = 'in';
  c.reload = anim; return true;
}

export function updateReload(c, dt) {
  const a = c.reload; if (!a) return; const w = curWeapon(c); if (!w) { c.reload = null; return; }
  const evs = a.advance(dt), pos = c.pos;
  const ep = _v.set(c.pos.x, c.pos.y + 1.1 * c.s, c.pos.z), pitch = (c.traits?.soundPitch) || 1;
  for (const e of evs) {
    switch (e) {
      case 'magout': ctx.audio.mech('magout', ep, c.isPlayer ? 1.3 : 1, pitch); if (w.type === 'rpg') { a.magState = 'held'; w.mag = 0; } else a.magState = 'held'; break;
      case 'drop': {
        // old magazine falls to the ground (with its leftover rounds)
        const old = a.oldCount; c.ammo[w.ammoType] += old; w.mag = 0;
        const mp = _v.copy(c.pos); mp.y += 0.8 * c.s; if (w.type !== 'rpg') makeMagProp(w.cap, old, mp, new THREE.Vector3(rand(-0.3, 0.3), 0.2, rand(-0.3, 0.3)));
        a.magState = 'out'; break;
      }
      case 'take': a.newCount = Math.min(w.cap, c.ammo[w.ammoType]); if (w.type === 'shotgun') { a.shellInHand = true; ctx.audio.mech('shell', ep, 0.6, pitch); } else { a.magState = 'new'; ctx.audio.mech('click', ep, 0.8, pitch); } break;
      case 'fumble': ctx.audio.mech('fumble', ep, 1, pitch); break;
      case 'dropnew': { const mp = _v.copy(c.pos); mp.y += 0.9 * c.s; makeMagProp(w.cap, a.newCount, mp, new THREE.Vector3(rand(-0.4, 0.4), 0.1, rand(-0.4, 0.4))); ctx.audio.mech('clink', ep, 0.8); a.magState = 'out'; break; }
      case 'magin': {
        ctx.audio.mech('magin', ep, c.isPlayer ? 1.3 : 1, pitch); const n = Math.min(w.cap, c.ammo[w.ammoType]); w.mag = n; c.ammo[w.ammoType] -= n; a.magState = 'in'; break;
      }
      case 'bolt': ctx.audio.mech(w.type === 'rpg' ? 'click' : 'bolt', ep, c.isPlayer ? 1.2 : 1, pitch); c.recoil = Math.max(c.recoil, 0.4); break;
      case 'load': ctx.audio.mech('shell', ep, 0.9, pitch); if (c.ammo.shotgun > 0 && w.mag < w.cap) { w.mag++; c.ammo.shotgun--; } a.shellInHand = false; break;
      case 'dropshell': { a.shellInHand = false; const sp = _v.copy(c.pos); sp.y += 0.9 * c.s; ctx.fx.casing(sp, new THREE.Vector3(rand(-0.3, 0.3), 0, rand(-0.3, 0.3)), 'shell'); ctx.audio.mech('clink', ep, 0.5); break; }
    }
  }
  if (w.model?.update) w.model.update(w);
  if (a.t >= a.dur) {
    c.reload = null;
    if (w.type === 'shotgun' && w.mag < w.cap && c.ammo.shotgun > 0 && !a.cancel) startReload(c);
  }
}

export function updateWeaponState(c, dt) {
  c.fireCd = Math.max(0, (c.fireCd || 0) - dt); c.swapT = Math.max(0, (c.swapT || 0) - dt); c.throwT = Math.max(0, (c.throwT || 0) - dt);
  c.pumpOff = Math.max(0, (c.pumpOff || 0) - dt * 0.55); c.knifeT = Math.max(0, (c.knifeT || 0) - dt);
  for (const k of ['primary', 'pistol']) { const w = c.weapons[k]; if (!w) continue; w.heat = Math.max(0, w.heat - dt * (w.heatLock > 0 ? 0.12 : 0.07)); w.heatLock = Math.max(0, w.heatLock - dt); }
  const w = curWeapon(c);
  if (c.overheat) {
    const evs = c.overheat.advance(dt); for (const e of evs) if (e === 'overheat') { ctx.audio.mech('overheat', _v.set(c.pos.x, c.pos.y + 1.2, c.pos.z), 1.2); ctx.fx.smoke(c.weaponMuzzle ? c.weaponMuzzle(_v) : _v, 4, 0.2, 2, [0.6, 0.6, 0.6]); }
    if (c.overheat.t >= c.overheat.dur) { c.overheat = null; if (w) w.heat = Math.min(w.heat, 0.45); }
  }
  if (c.reload) updateReload(c, dt);
  if (w && w.model) {
    w.model.update(w);
  }
}

// player view models live in camera space: convert to world space
export function vmToWorld(c, v) { if (c.isPlayer) v.applyQuaternion(ctx.camera.quaternion).add(ctx.camera.position); return v; }
export function muzzleWorld(c, out) {
  const w = curWeapon(c); const m = c.cur === 'knife' ? c.knifeModel : w?.model; if (!m) return out.set(c.pos.x, c.pos.y + 1.3, c.pos.z);
  m.group.updateWorldMatrix(true, false); m.muzzle.getWorldPosition(out); return vmToWorld(c, out);
}

// returns true if the shot was fired
export function fireWeapon(c, origin, dir, opts = {}) {
  const w = curWeapon(c); if (!w || c.reload || c.overheat || c.swapT > 0 || c.fireCd > 0 || w.heatLock > 0.01) return false;
  if (w.mag <= 0) { if (!c.dryT || ctx.time - c.dryT > 0.35) { c.dryT = ctx.time; ctx.audio.mech('dry', _v.set(c.pos.x, c.pos.y + 1.2, c.pos.z), 0.9); } return false; }
  const def = w.def; w.mag--; c.fireCd = def.interval * (c.traits?.rof || 1); c.lastFireT = ctx.time;
  // heat build-up; some barrels overheat after long strings of fire
  w.heat += def.heat * (w.sup ? 1.35 : 1);
  if (def.heat > 0 && w.heat > 0.8 && (w.heat >= 1 || (w.hotProne && chance(0.12)))) { c.overheat = new OverheatAnim(w.model || (w.model = buildGun(w))); w.heatLock = 2.2; w.heat = Math.max(w.heat, 0.95); }
  const mpos = muzzleWorld(c, new THREE.Vector3());
  const aimDir = _d.copy(dir);
  const spreadBase = (opts.spread ?? (opts.ads ? def.ads : def.spread)) * (w.barrel ? 0.65 : 1);
  const ownerPos = _v.set(c.pos.x, c.pos.y + 1.2, c.pos.z);
  if (def.pellets) {
    for (let i = 0; i < def.pellets; i++) {
      const dd = aimDir.clone(); dd.x += gauss() * spreadBase * 0.55; dd.y += gauss() * spreadBase * 0.55; dd.z += gauss() * spreadBase * 0.55; dd.normalize();
      fireBullet(c, origin, dd, { ...def, range: def.range }, { pellet: true, muzzle: mpos, noWhiz: i > 0 });
    }
    c.pumpOff = 0.12; setTimeout(() => { if (c.alive) ctx.audio.mech('pump', ownerPos, c.isPlayer ? 1.2 : 0.8); }, 380);
    ctx.fx.casing(mpos.clone().add(new THREE.Vector3(0, 0.05, 0)), new THREE.Vector3(rand(0.5, 1.5), rand(1.5, 2.5), rand(-0.5, 0.5)), 'shell');
  } else if (w.type === 'rpg') {
    launchRocket(c, mpos, aimDir);
  } else {
    const dd = aimDir.clone(); dd.x += gauss() * spreadBase; dd.y += gauss() * spreadBase; dd.z += gauss() * spreadBase; dd.normalize();
    fireBullet(c, origin, dd, def, { muzzle: mpos });
    const m = w.model; if (m) { m.group.updateWorldMatrix(true, false); const ej = vmToWorld(c, m.eject.getWorldPosition(new THREE.Vector3())); const rt = new THREE.Vector3(Math.cos(c.yaw), 0, -Math.sin(c.yaw)); ctx.fx.casing(ej, rt.multiplyScalar(rand(1.5, 2.8)).add(new THREE.Vector3(0, rand(1.2, 2.2), 0)).addScaledVector(dd, -0.4), w.type === 'pistol' ? 'pistol' : 'rifle'); }
  }
  c.recoil = 1;
  // sound, muzzle flash
  ctx.audio.shot(def.sound, mpos, { suppressed: w.sup, vol: c.isPlayer ? 1 : 0.9 });
  ctx.fx.muzzle(mpos, aimDir, w.sup, def.sound === 'shotgun' ? 1.5 : def.sound === 'rpg' ? 2 : 1);
  ctx.game.muzzleFlash(c, mpos, w.sup, def.sound);
  ctx.game.noise(c.pos, w.sup ? 22 : def.sound === 'shotgun' ? 110 : 90, c.team, c);
  return true;
}

export function launchRocket(c, pos, dir) {
  const g = new THREE.Group();
  const body = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 0.4, 8), new THREE.MeshStandardMaterial({ color: 0x3b4326, roughness: 0.6, metalness: 0.4 })); body.rotation.x = Math.PI / 2; g.add(body);
  const cone = new THREE.Mesh(new THREE.ConeGeometry(0.03, 0.12, 8), new THREE.MeshStandardMaterial({ color: 0x5b5240, roughness: 0.5 })); cone.rotation.x = -Math.PI / 2; cone.position.z = -0.26; g.add(cone);
  g.lookAt(dir); const p = { kind: 'rocket', mesh: g, pos: pos.clone(), vel: dir.clone().multiplyScalar(48), owner: c, life: 6, prev: pos.clone() };
  g.position.copy(pos); g.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, -1), dir);
  ctx.fx.scene.add(g); ctx.fx.props.push(Object.assign(p, { vel: p.vel, tx: 0, tz: 0, tvx: 0, tvz: 0, lying: new THREE.Quaternion(), yaw: 0 }));
}

export function throwGrenade(c, origin, vel) {
  if (c.grenades <= 0) return false; c.grenades--;
  const mesh = buildGrenadeMesh(); mesh.traverse((m) => { if (m.isMesh) m.castShadow = true; });
  const p = ctx.fx.addProp({ kind: 'grenade', mesh, pos: origin.clone(), vel: vel.clone(), rest: 0.04, bounce: 0.38, fric: 0.62, size: 0.15, fuse: 3.0, owner: c, data: {} });
  ctx.audio.mech('pin', origin, 1);
  return true;
}
// launch velocity so a grenade lands near target (fixed 45° arc)
export function grenadeVelocity(from, to, err = 0) {
  const dx = to.x - from.x, dz = to.z - from.z, d = Math.hypot(dx, dz), dy = to.y - from.y, th = 0.78, g = 9.8;
  const denom = 2 * Math.cos(th) ** 2 * (d * Math.tan(th) - dy); const v = denom > 0.1 ? Math.sqrt(g * d * d / denom) : 12;
  const dir = new THREE.Vector3(dx / d, 0, dz / d); const a = rand(-err, err); dir.applyAxisAngle(new THREE.Vector3(0, 1, 0), a);
  return new THREE.Vector3(dir.x * Math.cos(th) * v * (1 + rand(-err, err)), Math.sin(th) * v, dir.z * Math.cos(th) * v * (1 + rand(-err, err)));
}

export function meleeAttack(c, origin, dir) {
  if (c.knifeT > 0 || c.cur !== 'knife') return false;
  c.knifeT = 0.6; c.swing = 1; ctx.audio.mech('knife', origin, 1);
  const hit = castRay(origin, dir, 1.9, { ignoreTeam: c.team, ignore: c, breakGlass: false, noGlass: true });
  if (hit) {
    if (hit.kind === 'char') { const t = hit.obj; const back = (Math.sin(t.yaw) * dir.x * -1 + Math.cos(t.yaw) * dir.z * -1) > 0.3; ctx.audio.mech('stab', hit.point, 1.2); hurt(t, back ? 200 : 75, hit.part === 'head' ? 'torso' : hit.part, dir, c, hit.point, 'knife'); }
    else impactFx(hit, dir, 0.04);
  }
  return true;
}
export function throwKnife(c, origin, dir) {
  if (!c.hasKnife) return false; c.hasKnife = false; c.knifeT = 0.8;
  const k = buildKnife(); k.group.traverse((m) => { if (m.isMesh) m.castShadow = true; }); const wrap = new THREE.Group(); wrap.add(k.group);
  const p = { kind: 'knife_fly', mesh: wrap, pos: origin.clone(), vel: dir.clone().multiplyScalar(26), owner: c, life: 4, spin: 0, tx: 0, tz: 0, tvx: 0, tvz: 0, lying: new THREE.Quaternion(), yaw: 0 };
  ctx.fx.scene.add(wrap); ctx.fx.props.push(p); ctx.audio.mech('knife', origin, 1);
  if (c.cur === 'knife') { c.cur = c.weapons.pistol ? 'pistol' : 'primary'; }
  return true;
}

// called for 'rocket' and 'knife_fly' props
export function flightStep(p, dt, k) {
  const fx = ctx.fx; p.life -= dt;
  const step = p.vel.length() * dt; const dir = p.vel.clone().normalize();
  const g = p.kind === 'rocket' ? 1.2 : 9.8; p.vel.y -= g * dt;
  const hit = castRay(p.pos, dir, step + 0.05, { ignoreTeam: p.kind === 'rocket' ? 0 : p.owner.team, ignore: p.owner, breakGlass: true });
  if (p.kind === 'rocket') fx.emit(p.pos.x, p.pos.y, p.pos.z, rand(-0.2, 0.2), rand(-0.2, 0.2), rand(-0.2, 0.2), { c: [0.7, 0.7, 0.7], a: 0.4, life: 1.2, size: 0.15, grow: 4, drag: 1 }), fx.emit(p.pos.x, p.pos.y, p.pos.z, 0, 0, 0, { c: [1, 0.6, 0.2], a: 1, life: 0.1, size: 0.18, add: 1 });
  if (hit || p.life <= 0) {
    const at = hit ? hit.point : p.pos;
    if (p.kind === 'rocket') { fx.scene.remove(p.mesh); const i = fx.props.indexOf(p); if (i >= 0) fx.props.splice(i, 1); explode(at.clone(), 4, 220, p.owner, 'rpg'); return; }
    // thrown knife
    if (hit && hit.kind === 'char') { hurt(hit.obj, 70, hit.part === 'head' ? 'torso' : hit.part, dir, p.owner, hit.point, 'knife'); ctx.audio.mech('stab', hit.point, 1.2); }
    fx.scene.remove(p.mesh); const i = fx.props.indexOf(p); if (i >= 0) fx.props.splice(i, 1);
    const sp = at.clone(); if (hit && hit.kind !== 'char') impactFx(hit, dir, 0.04, true);
    const kp = makeKnifeProp(new THREE.Vector3(sp.x, Math.max(T.h(sp.x, sp.z) + 0.05, sp.y), sp.z), new THREE.Vector3(0, 0.5, 0));
    p.owner.knifeProp = kp; return;
  }
  p.pos.addScaledVector(dir, step);
  p.mesh.position.copy(p.pos);
  if (p.kind === 'rocket') p.mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, -1), p.vel.clone().normalize());
  else { p.spin += dt * 24; p.mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, -1), dir); p.mesh.rotateX(p.spin); }
}

export function dropWeapons(c, vel) {
  const base = new THREE.Vector3(c.pos.x, c.pos.y + 1.0, c.pos.z);
  const w = c.weapons.primary; if (w) { makeWeaponProp(w, base, vel.clone().add(new THREE.Vector3(rand(-0.5, 0.5), 1, rand(-0.5, 0.5))), 0); c.weapons.primary = null; }
  const p = c.weapons.pistol; if (p && chance(0.5)) { makeWeaponProp(p, base.clone().add(new THREE.Vector3(0.3, 0, 0)), vel.clone().add(new THREE.Vector3(rand(-1, 1), 1, rand(-1, 1))), 0); }
  c.weapons.pistol = null; c.reload = null; c.overheat = null;
}
