import * as THREE from 'three';
import { ctx } from './ctx.js';
import * as T from './terrain.js';
import { clamp, rand, gauss } from './util.js';

const _n = new THREE.Vector3(), _p = new THREE.Vector3(), _q = new THREE.Vector3();

function rayAABB(o, d, b, maxT, out) {
  let t0 = 0, t1 = maxT, nx = 0, ny = 0, nz = 0;
  const ax = [[o.x, d.x, b.minx, b.maxx, 0], [o.y, d.y, b.miny, b.maxy, 1], [o.z, d.z, b.minz, b.maxz, 2]];
  for (const [oo, dd, mn, mx, k] of ax) {
    if (Math.abs(dd) < 1e-9) { if (oo < mn || oo > mx) return -1; continue; }
    let ta = (mn - oo) / dd, tb = (mx - oo) / dd, sign = -1;
    if (ta > tb) { const t = ta; ta = tb; tb = t; sign = 1; }
    if (ta > t0) { t0 = ta; nx = ny = nz = 0; if (k === 0) nx = sign; else if (k === 1) ny = sign; else nz = sign; }
    if (tb < t1) t1 = tb; if (t0 > t1) return -1;
  }
  if (t0 <= 0) return -1; out.set(nx, ny, nz); return t0;
}
function raySphere(o, d, c, r) {
  const ox = o.x - c.x, oy = o.y - c.y, oz = o.z - c.z, b = ox * d.x + oy * d.y + oz * d.z, cc = ox * ox + oy * oy + oz * oz - r * r, h = b * b - cc;
  if (h < 0) return -1; const t = -b - Math.sqrt(h); return t > 0 ? t : (-b + Math.sqrt(h) > 0 && cc < 0 ? 0.001 : -1);
}
const ba = new THREE.Vector3(), oa = new THREE.Vector3();
function rayCapsule(o, d, a, b, r) {
  ba.subVectors(b, a); oa.subVectors(o, a);
  const baba = ba.dot(ba), bard = ba.dot(d), baoa = ba.dot(oa), rdoa = d.dot(oa), oaoa = oa.dot(oa);
  const A = baba - bard * bard, B = baba * rdoa - baoa * bard, C = baba * oaoa - baoa * baoa - r * r * baba;
  if (A > 1e-7) {
    const h = B * B - A * C;
    if (h >= 0) { const t = (-B - Math.sqrt(h)) / A, y = baoa + t * bard; if (y > 0 && y < baba && t > 0) return t; }
  }
  const s1 = raySphere(o, d, a, r), s2 = raySphere(o, d, b, r);
  if (s1 > 0 && s2 > 0) return Math.min(s1, s2); return s1 > 0 ? s1 : s2 > 0 ? s2 : -1;
}

export function bodyVolumes(c) {
  const s = c.s, H = 1.8 * s * (1 - 0.25 * c.crouch), x = c.pos.x, y = c.pos.y, z = c.pos.z;
  return {
    head: { c: new THREE.Vector3(x, y + H * 0.94, z), r: 0.15 * s },
    torso: { a: new THREE.Vector3(x, y + H * 0.56, z), b: new THREE.Vector3(x, y + H * 0.82, z), r: 0.23 * s },
    leg: { a: new THREE.Vector3(x, y + 0.08, z), b: new THREE.Vector3(x, y + H * 0.5, z), r: 0.17 * s },
  };
}

export function terrainRay(o, d, maxT) {
  let t = 0.1; let prevT = 0;
  while (t < maxT) {
    const x = o.x + d.x * t, z = o.z + d.z * t, y = o.y + d.y * t, gap = y - T.h(x, z);
    if (gap < 0) {
      let a = prevT, b = t;
      for (let i = 0; i < 7; i++) { const m = (a + b) / 2; if (o.y + d.y * m < T.h(o.x + d.x * m, o.z + d.z * m)) b = m; else a = m; }
      return b;
    }
    prevT = t; t += clamp(gap * 0.6 + 0.2, 0.2, 2.5);
    if (Math.abs(x) > T.HALF + 30 || Math.abs(z) > T.HALF + 30) break;
  }
  return -1;
}

// returns {t, point, normal, kind, obj, part, mat}
export function castRay(o, d, maxT, opt = {}) {
  const W = ctx.world; let origin = o, remain = maxT, accum = 0;
  for (let iter = 0; iter < 5; iter++) {
    let best = null, bt = remain;
    const tt = terrainRay(origin, d, bt);
    if (tt > 0 && tt < bt) { bt = tt; best = { kind: 'terrain', mat: 'dirt' }; }
    if (W) {
      for (const b of W.colliders) {
        if (b.broken) continue;
        // quick reject on distance to box center vs ray
        const t = rayAABB(origin, d, b, bt, _n);
        if (t > 0 && t < bt) { bt = t; best = { kind: 'box', obj: b, mat: b.mat, normal: _n.clone() }; }
      }
      if (!opt.noGlass) for (const g of W.glass) {
        if (g.broken) continue; const t = rayAABB(origin, d, g, bt, _n);
        if (t > 0 && t < bt) { bt = t; best = { kind: 'glass', obj: g, mat: 'glass', normal: _n.clone() }; }
      }
      for (const tr of W.trees) {
        if (!tr.alive || tr.falling) continue;
        const ox = origin.x - tr.x, oz = origin.z - tr.z, a = d.x * d.x + d.z * d.z; if (a < 1e-8) continue;
        const b = ox * d.x + oz * d.z, c = ox * ox + oz * oz - tr.r * tr.r, h = b * b - a * c; if (h < 0) continue;
        const t = (-b - Math.sqrt(h)) / a; if (t <= 0 || t >= bt) continue;
        const y = origin.y + d.y * t - T.h(tr.x, tr.z); if (y < 0 || y > tr.h) continue;
        bt = t; best = { kind: 'tree', obj: tr, mat: 'wood', normal: new THREE.Vector3(ox + d.x * t, 0, oz + d.z * t).normalize() };
      }
    }
    if (!opt.noChars) for (const c of ctx.chars) {
      if (!c.alive || c === opt.ignore || (opt.ignoreTeam && c.team === opt.ignoreTeam)) continue;
      if (Math.abs(c.pos.x - origin.x) > remain + 2 || Math.abs(c.pos.z - origin.z) > remain + 2) continue;
      const v = bodyVolumes(c);
      let t = raySphere(origin, d, v.head.c, v.head.r), part = 'head';
      const t2 = rayCapsule(origin, d, v.torso.a, v.torso.b, v.torso.r); if (t2 > 0 && (t < 0 || t2 < t)) { t = t2; part = 'torso'; }
      const t3 = rayCapsule(origin, d, v.leg.a, v.leg.b, v.leg.r); if (t3 > 0 && (t < 0 || t3 < t)) { t = t3; part = 'leg'; }
      if (t > 0 && t < bt) { bt = t; best = { kind: 'char', obj: c, part, mat: 'flesh', normal: new THREE.Vector3().copy(d).negate() }; }
    }
    if (!best) return null;
    best.t = accum + bt; best.point = new THREE.Vector3().copy(origin).addScaledVector(d, bt);
    if (best.kind === 'terrain') best.normal = T.normalAt(best.point.x, best.point.z, new THREE.Vector3());
    if (best.kind === 'glass' && opt.breakGlass) {
      breakGlass(best.obj, best.point);
      origin = best.point.clone().addScaledVector(d, 0.05); remain = remain - bt - 0.05; accum += bt + 0.05; if (remain <= 0) return null; continue;
    }
    return best;
  }
  return null;
}

export function breakGlass(g, point) {
  if (g.broken) return; g.broken = true; if (g.mesh) g.mesh.visible = false;
  ctx.audio.impact('glass', point);
  const c = new THREE.Vector3((g.minx + g.maxx) / 2, (g.miny + g.maxy) / 2, (g.minz + g.maxz) / 2);
  for (let i = 0; i < 26; i++) ctx.fx.emit(c.x + rand(-0.4, 0.4), c.y + rand(-0.4, 0.4), c.z + rand(-0.1, 0.1), rand(-2, 2), rand(0, 2), rand(-2, 2), { c: [0.8, 0.92, 0.95], a: 1, life: rand(0.5, 1), size: 0.05, grow: 0.3, grav: 9, drag: 0.5, add: 0.3 });
}

const WCOL = { dirt: [0.4, 0.33, 0.25], wood: [0.6, 0.45, 0.3], concrete: [0.55, 0.55, 0.52], sand: [0.6, 0.52, 0.35], metal: [0.5, 0.5, 0.5], flesh: [0.4, 0.05, 0.05] };
export function impactFx(hit, dir, size = 0.07, quiet = false) {
  const fx = ctx.fx, p = hit.point, n = hit.normal || _q.set(0, 1, 0);
  switch (hit.kind) {
    case 'terrain': fx.dust(p, 4, WCOL.dirt, 1, 0.6); fx.decal(p, n, size * 1.3, 'hole', [0.35, 0.28, 0.2]); if (!quiet) ctx.audio.impact('dirt', p); break;
    case 'tree': fx.splinters(p, n, 7); fx.decal(p, n, size * 1.5, 'hole', [0.5, 0.4, 0.3]); fx.dust(p, 2, [0.5, 0.4, 0.3], 0.5, 0.3); if (!quiet) ctx.audio.impact('wood', p); break;
    case 'box': {
      const m = hit.mat; if (m === 'wood') { fx.splinters(p, n, 8); fx.decal(p, n, size * 1.6, 'hole', [0.6, 0.5, 0.4]); } else if (m === 'sand') { fx.dust(p, 5, WCOL.sand, 0.8, 0.5); } else { fx.sparks(p, m === 'metal' ? 10 : 5, n); fx.dust(p, 3, WCOL.concrete, 0.5, 0.3); fx.decal(p, n, size * 1.4, 'hole', [0.6, 0.6, 0.6]); }
      if (!quiet) ctx.audio.impact(m === 'sand' ? 'dirt' : m === 'metal' ? 'concrete' : m, p); break;
    }
    case 'char': ctx.fx.blood(p, dir, 6); if (!quiet) ctx.audio.impact('flesh', p); break;
  }
}

export function fireBullet(shooter, origin, dir, def, opts = {}) {
  const pellet = opts.pellet; let dmg = def.dmg;
  const hit = castRay(origin, dir, def.range, { ignoreTeam: shooter.team, ignore: shooter, breakGlass: true });
  const endPoint = hit ? hit.point : _p.copy(origin).addScaledVector(dir, Math.min(def.range, 120)).clone();
  if (opts.tracer !== false && ctx.fx) ctx.fx.tracer(opts.muzzle || origin, endPoint);
  // bullet whizzing past the player's ears
  const pl = ctx.player;
  if (pl && pl !== shooter && pl.alive && shooter.team !== pl.team && !opts.noWhiz) {
    const to = _q.set(pl.pos.x - origin.x, pl.pos.y + 1.4 - origin.y, pl.pos.z - origin.z), tp = to.dot(dir), len = hit ? hit.t : def.range;
    if (tp > 0 && tp < len) { const cx = origin.x + dir.x * tp, cy = origin.y + dir.y * tp, cz = origin.z + dir.z * tp; const d = Math.hypot(cx - pl.pos.x, cy - pl.pos.y - 1.4, cz - pl.pos.z); if (d < 2.6 && !(hit && hit.obj === pl)) { ctx.audio.whiz({ x: cx, y: cy, z: cz }); ctx.game?.suppress?.(1 - d / 2.6); } }
  }
  if (!hit) return null;
  if (hit.kind === 'char') {
    const c = hit.obj;
    let f = 1;
    if (pellet) f = clamp(1 - (hit.t - 6) / 22, 0.12, 1); else f = clamp(1 - Math.max(0, hit.t - 40) / 400, 0.92, 1);
    hurt(c, dmg * f, hit.part, dir, shooter, hit.point, pellet ? 'pellet' : def.sound, pellet);
  }
  if (!opts.quiet) impactFx(hit, dir, pellet ? 0.04 : 0.065);
  return hit;
}

export function hurt(c, dmg, part, dir, attacker, point, kind, pellet = false) {
  if (!c.alive) return;
  let mult = 1;
  if (part === 'head') mult = pellet ? 3 : 1000; else if (part === 'leg') mult = 0.85;
  const total = part === 'head' && !pellet ? 1000 : dmg * mult * (part === 'head' ? 1 : c.armor);
  c.hp -= total; c.lastHit = ctx.time; c.lastAttacker = attacker;
  if (part === 'leg') { c.stumble = Math.max(c.stumble, 1.4); }
  c.flinch = Math.min(1, c.flinch + 0.5);
  if (point) ctx.fx.blood(point, dir, 4);
  if (c.isPlayer) ctx.game.onPlayerHurt(attacker, dir, total, part);
  else if (c.brain) c.brain.onHurt(attacker, dir);
  if (attacker === ctx.player && attacker && !c.isPlayer) ctx.game.hitMarker(c.hp <= 0, part === 'head');
  if (c.hp <= 0) kill(c, attacker, dir, part, kind);
}

export function kill(c, attacker, dir, part, kind, boom = 0) {
  if (!c.alive) return; c.alive = false; c.hp = 0; c.deadT = 0;
  const imp = dir.clone().multiplyScalar((kind === 'shotgun' || kind === 'pellet' ? 13 : kind === 'rpg' || boom ? 14 : 8) * (part === 'head' ? 1.2 : 1)); imp.y += boom ? 7 : 1.5;
  ctx.game.onKill(c, attacker, kind, part);
  if (!c.isPlayer) c.startRagdoll(imp, part, c.pos);
  ctx.game.dropWeapons(c, imp.clone().multiplyScalar(0.15));
  ctx.audio.impact('flesh', c.pos);
}

export function explode(pos, radius, dmg, owner, kind = 'grenade') {
  const fx = ctx.fx, W = ctx.world;
  fx.explosion(pos, radius); ctx.audio.explosion(pos, kind === 'rpg' ? 1.3 : 1);
  const n = T.normalAt(pos.x, pos.z, new THREE.Vector3()); fx.decal(new THREE.Vector3(pos.x, T.h(pos.x, pos.z), pos.z), n, radius * 1.1, 'crater');
  ctx.game.explosionFlash(pos, radius);
  const hq = pos.clone(); hq.y += 0.3;
  for (const c of ctx.chars) {
    if (!c.alive) continue; if (owner && c.team === owner.team && c !== owner) continue; if (owner && c === owner && c.isPlayer === false && false) continue;
    const ctr = new THREE.Vector3(c.pos.x, c.pos.y + 1.0 * c.s, c.pos.z), d = ctr.distanceTo(hq); if (d > radius) continue;
    const dir = ctr.clone().sub(hq).normalize();
    let f = 1 - d / radius; f = f * f * 0.5 + f * 0.5;
    const blocked = castRay(hq, dir, d - 0.1, { noChars: true, noGlass: true });
    const dm = dmg * f * (blocked ? 0.35 : 1);
    if (dm > 1) { c.stumble = Math.max(c.stumble, 1.0); hurt(c, dm, 'torso', dir, owner, null, kind); if (c.hp <= 0 && !c.isPlayer && c.ragdoll) { /* ragdoll gets extra launch */ for (const k of c.ragdoll.names) c.ragdoll.prev[k].addScaledVector(dir, -0.2 * f).y -= 0.2 * f; } }
  }
  if (W) {
    for (const t of W.trees) if (t.alive && !t.falling) { const d = Math.hypot(t.x - pos.x, t.z - pos.z); if (d < radius + t.r) W.fellTree(t, new THREE.Vector3(t.x - pos.x, 0, t.z - pos.z).normalize()); }
    for (const g of W.glass) if (!g.broken) { const cx = (g.minx + g.maxx) / 2, cz = (g.minz + g.maxz) / 2; if (Math.hypot(cx - pos.x, cz - pos.z) < radius * 2.5) breakGlass(g, new THREE.Vector3(cx, (g.miny + g.maxy) / 2, cz)); }
  }
  for (const p of ctx.fx.props) { const d = p.pos.distanceTo(hq); if (d < radius * 1.6 && p.vel) { const k = (1 - d / (radius * 1.6)) * 9; const dir = p.pos.clone().sub(hq).normalize(); p.vel.addScaledVector(dir, k); p.vel.y += k * 0.6; p.sleep = false; p.tvx += rand(-6, 6); p.tvz += rand(-6, 6); } }
  fx.pebbles.mesh; // physics bodies get shoved
  const bs = [fx.casings, fx.loose, fx.pebbles];
  for (const b of bs) for (let i = 0; i < b.n; i++) { const dx = b.p[i * 3] - pos.x, dz = b.p[i * 3 + 2] - pos.z, d = Math.hypot(dx, dz); if (d < radius * 2 && b.sleep[i]) { b.sleep[i] = 0; b.v[i * 3] = dx / (d + 0.1) * 6; b.v[i * 3 + 1] = rand(2, 6); b.v[i * 3 + 2] = dz / (d + 0.1) * 6; } }
  const sh = clamp(1 - pos.distanceTo(ctx.camera.position) / 40, 0, 1); if (sh > 0) ctx.game.shake(sh * 1.4);
}
