import * as THREE from 'three';
import { ctx } from './ctx.js';
import * as T from './terrain.js';
import { clamp, rand, randi, chance, pick, angDiff, damp, gauss } from './util.js';
import { castRay } from './combat.js';
import { fireWeapon, startReload, switchWeapon, curWeapon, totalAmmo, meleeAttack, throwKnife, throwGrenade, grenadeVelocity, muzzleWorld } from './actions.js';

// ---------------------------------------------------------------- navigation grid (1 m cells)
export class Nav {
  constructor() { this.N = 310; this.o = -155; this.size = this.N * this.N; this.blocked = new Uint8Array(this.size); this.hs = new Float32Array(this.size); this.g = new Float32Array(this.size); this.par = new Int32Array(this.size); this.stamp = new Uint32Array(this.size); this.cur = 0; this.heapI = new Int32Array(this.size); this.heapF = new Float32Array(this.size); }
  idx(x, z) { const i = Math.floor(x - this.o), j = Math.floor(z - this.o); return i < 0 || j < 0 || i >= this.N || j >= this.N ? -1 : j * this.N + i; }
  pos(n, out) { out.x = (n % this.N) + this.o + 0.5; out.z = Math.floor(n / this.N) + this.o + 0.5; return out; }
  build() {
    const W = ctx.world, N = this.N;
    for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) { const x = i + this.o + 0.5, z = j + this.o + 0.5; this.hs[j * N + i] = T.h(x, z); }
    for (const t of W.trees) { const r = t.r + 0.55; for (let j = Math.floor(t.z - r - this.o); j <= Math.ceil(t.z + r - this.o); j++) for (let i = Math.floor(t.x - r - this.o); i <= Math.ceil(t.x + r - this.o); i++) { if (i < 0 || j < 0 || i >= N || j >= N) continue; if (Math.hypot(i + this.o + 0.5 - t.x, j + this.o + 0.5 - t.z) < r) this.blocked[j * N + i] = 1; } }
    for (const b of W.colliders) {
      const h0 = T.h((b.minx + b.maxx) / 2, (b.minz + b.maxz) / 2); if (b.maxy - h0 < 0.6) continue; if (b.maxy < h0) continue;
      const m = 0.5;
      for (let j = Math.floor(b.minz - m - this.o); j <= Math.ceil(b.maxz + m - this.o); j++) for (let i = Math.floor(b.minx - m - this.o); i <= Math.ceil(b.maxx + m - this.o); i++) { if (i < 0 || j < 0 || i >= N || j >= N) continue; const x = i + this.o + 0.5, z = j + this.o + 0.5; if (x > b.minx - m && x < b.maxx + m && z > b.minz - m && z < b.maxz + m) this.blocked[j * N + i] = 1; }
    }
    // never wander into the mine field
    for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) { const x = i + this.o + 0.5, z = j + this.o + 0.5; if (Math.abs(x) > T.PLAY - 4 || Math.abs(z) > T.PLAY - 4) this.blocked[j * N + i] = 1; }
  }
  _push(n, f, sz) { let i = sz[0]++; while (i > 0) { const p = (i - 1) >> 1; if (this.heapF[p] <= f) break; this.heapF[i] = this.heapF[p]; this.heapI[i] = this.heapI[p]; i = p; } this.heapF[i] = f; this.heapI[i] = n; }
  _pop(sz) { const top = this.heapI[0], n = --sz[0]; if (n > 0) { const f = this.heapF[n], id = this.heapI[n]; let i = 0; for (;;) { let c = i * 2 + 1; if (c >= n) break; if (c + 1 < n && this.heapF[c + 1] < this.heapF[c]) c++; if (this.heapF[c] >= f) break; this.heapF[i] = this.heapF[c]; this.heapI[i] = this.heapI[c]; i = c; } this.heapF[i] = f; this.heapI[i] = id; } return top; }
  nearestFree(x, z) { let n = this.idx(x, z); if (n >= 0 && !this.blocked[n]) return n; for (let r = 1; r < 8; r++) for (let dj = -r; dj <= r; dj++) for (let di = -r; di <= r; di++) { if (Math.max(Math.abs(di), Math.abs(dj)) !== r) continue; const m = this.idx(x + di, z + dj); if (m >= 0 && !this.blocked[m]) return m; } return -1; }
  find(sx, sz, gx, gz) {
    const s = this.nearestFree(sx, sz), e = this.nearestFree(gx, gz); if (s < 0 || e < 0) return null;
    const N = this.N; this.cur++; const cur = this.cur; const sz_ = [0];
    this.g[s] = 0; this.stamp[s] = cur; this.par[s] = -1; this._push(s, 0, sz_);
    const ex = e % N, ez = Math.floor(e / N); let best = s, bestH = 1e9, it = 0;
    const closed = new Uint8Array(0);
    const done = new Set();
    while (sz_[0] > 0 && it++ < 30000) {
      const n = this._pop(sz_); if (n === e) { best = e; break; }
      if (done.has(n)) continue; done.add(n);
      const nx = n % N, nz = (n / N) | 0, hn = this.hs[n];
      for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) {
        if (!di && !dj) continue; const i = nx + di, j = nz + dj; if (i < 0 || j < 0 || i >= N || j >= N) continue; const m = j * N + i; if (this.blocked[m]) continue;
        const diag = di && dj, dist = diag ? 1.414 : 1;
        if (diag && (this.blocked[nz * N + i] || this.blocked[j * N + nx])) continue;
        const dh = this.hs[m] - hn; if (dh > 0.82 * dist) continue; // too steep to climb (trench wall)
        let cost = dist; if (dh < -0.6 * dist) { if (dh < -2.1) continue; cost += 3.5; } // dropping down into a trench
        const ng = this.g[n] + cost;
        if (this.stamp[m] === cur && this.g[m] <= ng) continue;
        this.g[m] = ng; this.stamp[m] = cur; this.par[m] = n;
        const hx = Math.abs(i - ex), hz = Math.abs(j - ez), h = (hx + hz) + (1.414 - 2) * Math.min(hx, hz);
        this._push(m, ng + h, sz_); if (h < bestH) { bestH = h; best = m; }
      }
    }
    const path = []; for (let n = best; n >= 0; n = this.par[n]) { const p = { x: 0, z: 0 }; this.pos(n, p); path.push(p); if (this.stamp[n] !== cur) break; }
    path.reverse(); return path;
  }
}

// ---------------------------------------------------------------- personality
export function randomTraits() {
  return {
    reaction: rand(0.2, 0.55), turn: rand(4.5, 8.5), acc: rand(0.006, 0.015), aggression: rand(0.3, 1.0), walk: rand(2.9, 3.6), run: rand(4.6, 5.4),
    reloadMult: rand(0.85, 1.3), fumble: rand(0.1, 0.32), burstMin: randi(2, 3), burstMax: randi(4, 7), pause: rand(0.35, 1.0), grenadeBias: rand(0.5, 1.5),
    soundPitch: rand(0.85, 1.2), stepLoud: rand(0.8, 1.2), rof: rand(0.95, 1.15), courage: rand(0.3, 1.0), crouchy: rand(0.2, 0.7),
  };
}

const _a = new THREE.Vector3(), _b = new THREE.Vector3(), _o = new THREE.Vector3();

export class Brain {
  constructor(c, nav) {
    this.c = c; this.nav = nav; c.brain = this; this.t = c.traits;
    this.target = null; this.seenT = -99; this.lastSeen = null; this.reactT = 0; this.perceiveT = Math.random() * 0.3;
    this.path = null; this.pi = 0; this.goal = null; this.goalT = 0; this.repathT = 0; this.stuckT = 0; this.lastPos = new THREE.Vector3();
    this.burst = 0; this.burstCd = 0; this.strafe = 0; this.strafeT = 0; this.aimH = 0.7; this.wasHurtT = -99; this.mode = 'advance';
    this.aimYaw = c.yaw; this.aimPitch = 0; this.holdT = 0; this.grenT = 0; this.campT = 0; this.tgtLast = new THREE.Vector3(); this.tgtStillT = 0; this.retreatT = 0; this.alertDir = null;
    this.seekAmmo = null; this.noiseTarget = null; this.noiseT = 0; this.throwQ = null;
  }
  reset() { this.target = null; this.path = null; this.goal = null; this.lastSeen = null; this.reactT = 0; this.retreatT = 0; this.mode = 'advance'; this.burst = 0; this.throwQ = null; }

  enemies() { return ctx.chars.filter((e) => e.alive && e.team !== this.c.team); }
  allies() { return ctx.chars.filter((e) => e.alive && e.team === this.c.team && e !== this.c); }

  onHurt(attacker, dir) {
    this.wasHurtT = ctx.time;
    if (attacker && attacker.alive && attacker.team !== this.c.team) { this.lastSeen = attacker.pos.clone(); this.seenT = ctx.time; if (!this.target) { this.target = attacker; this.reactT = this.t.reaction * 0.5; } }
  }
  hear(pos, team) {
    if (team === this.c.team || !this.c.alive) return;
    this.noiseTarget = pos.clone(); this.noiseT = ctx.time;
    if (!this.target && (!this.lastSeen || ctx.time - this.seenT > 3)) { this.lastSeen = pos.clone(); this.seenT = ctx.time - 1.5; }
  }

  canSee(e) {
    const c = this.c, eye = _o.set(c.pos.x, c.pos.y + 1.55 * c.s * (1 - 0.25 * c.crouch), c.pos.z);
    const dx = e.pos.x - c.pos.x, dz = e.pos.z - c.pos.z, d = Math.hypot(dx, dz);
    const sky = ctx.sky, view = (sky.dark > 0.5 ? 60 + (e.flashOn ? 45 : 0) : 130) * (1 - 0.3 * sky.rain); if (d > view) return false;
    const fy = -Math.sin(c.yaw), fz = -Math.cos(c.yaw); const dot = (dx * fy + dz * fz) / (d || 1);
    if (dot < -0.15 && d > 9) return false;
    const tp = _a.set(e.pos.x, e.pos.y + 1.2 * e.s * (1 - 0.25 * e.crouch), e.pos.z), dir = _b.subVectors(tp, eye); const L = dir.length(); dir.multiplyScalar(1 / L);
    const hit = castRay(eye, dir, L - 0.3, { noChars: true, noGlass: true }); return !hit;
  }

  perceive(dt) {
    const c = this.c; this.perceiveT -= dt; if (this.perceiveT > 0) return; this.perceiveT = 0.18 + Math.random() * 0.1;
    let best = null, bd = 1e9;
    if (this.target && (!this.target.alive)) this.target = null;
    for (const e of this.enemies()) {
      const d = Math.hypot(e.pos.x - c.pos.x, e.pos.z - c.pos.z); if (d >= bd) continue;
      if (this.canSee(e)) { best = e; bd = d; }
    }
    if (best) {
      if (!this.target) this.reactT = this.t.reaction * (this.supportBonus ? 0.5 : 1);
      this.target = best; this.seenT = ctx.time; this.lastSeen = best.pos.clone();
      if (best.pos.distanceTo(this.tgtLast) < 1.0) this.tgtStillT += 0.2; else { this.tgtStillT = 0; this.tgtLast.copy(best.pos); }
    } else if (this.target && ctx.time - this.seenT > 0.6) { this.target = null; }
    // support teammates that are fighting within 5 m
    this.supportBonus = false;
    for (const a of this.allies()) {
      if (Math.hypot(a.pos.x - c.pos.x, a.pos.z - c.pos.z) > 5) continue;
      const fighting = a.isPlayer ? ctx.time - (a.lastFireT || -99) < 3 || ctx.time - (a.lastHit || -99) < 3 : (a.brain && (a.brain.target || ctx.time - a.brain.wasHurtT < 3));
      if (!fighting) continue;
      this.supportBonus = true;
      if (!this.target) {
        let t2 = a.brain?.target; if (!t2) { let bd2 = 1e9; for (const e of this.enemies()) { const d = e.pos.distanceTo(a.pos); if (d < bd2 && d < 90) { bd2 = d; t2 = e; } } }
        if (t2 && t2.alive) { this.lastSeen = t2.pos.clone(); this.seenT = ctx.time - 1; this.alertDir = t2.pos.clone(); if (this.canSee(t2)) { this.target = t2; this.reactT = this.t.reaction * 0.4; } }
      }
    }
  }

  pickGoal() {
    const c = this.c, all = [c, ...this.allies()];
    let cx = 0, cz = 0; for (const a of all) { cx += a.pos.x; cz += a.pos.z; } cx /= all.length; cz /= all.length;
    const ez = c.team === 1 ? -1 : 1;
    let gx, gz;
    const r = Math.random();
    if (this.retreatT > ctx.time) { gx = c.pos.x + rand(-10, 10); gz = c.pos.z - ez * rand(15, 30); }
    else if (r < 0.8 * (0.7 + this.t.aggression * 0.5)) { gx = cx + rand(-24, 24); gz = cz + ez * rand(24, 55); }
    else if (r < 0.9) { gx = cx + rand(-14, 14); gz = cz + rand(-8, 8); } // regroup / hold with the squad
    else { gx = c.pos.x + rand(-30, 30); gz = c.pos.z + ez * rand(0, 15); }
    // battlefield awareness: sometimes head for where the enemy squad probably is
    if (this.retreatT <= ctx.time && Math.random() < 0.65) { const es = this.enemies(); if (es.length) { const e = pick(es); gx = e.pos.x + rand(-28, 28); gz = e.pos.z + rand(-28, 28); } }
    gz = clamp(gz, -112, 112); gx = clamp(gx, -135, 135);
    // prefer trench floors near the candidate
    let bestS = -1, bx = gx, bz = gz;
    for (let i = 0; i < 14; i++) { const x = gx + rand(-14, 14), z = gz + rand(-14, 14); const n = this.nav.idx(x, z); if (n < 0 || this.nav.blocked[n]) continue; const td = T.trenchDist(x, z); const s = (td < T.TRENCH_HW ? 2 : 0) + rand(0, 1) - Math.abs(z - gz) * 0.02; if (s > bestS) { bestS = s; bx = x; bz = z; } }
    this.goal = { x: bx, z: bz }; this.goalT = rand(7, 14); this.requestPath();
  }
  requestPath(gx = this.goal?.x, gz = this.goal?.z) { if (gx === undefined) return; this.path = this.nav.find(this.c.pos.x, this.c.pos.z, gx, gz); this.pi = 0; this.repathT = 1.5; }

  update(dt) {
    const c = this.c, W = ctx.world, t = this.t, now = ctx.time;
    c.wish = c.wish || { x: 0, z: 0, speed: 0 }; c.wish.x = 0; c.wish.z = 0; c.wish.speed = 0;
    if (!c.alive || ctx.game.state !== 'play') return;
    this.perceive(dt);
    // ----- weapon choice: pistol only when the primary is completely empty, knife only when all firearms are empty
    const prim = c.weapons.primary, pist = c.weapons.pistol;
    const primAmmo = totalAmmo(c, prim), pistAmmo = totalAmmo(c, pist);
    const want = primAmmo > 0 ? 'primary' : pistAmmo > 0 ? 'pistol' : (c.hasKnife ? 'knife' : (pist ? 'pistol' : 'primary'));
    if (c.cur !== want && !c.reload && !c.overheat) switchWeapon(c, want);
    const w = curWeapon(c);
    if (w && w.mag === 0 && c.ammo[w.ammoType] > 0 && !c.reload && !c.overheat && c.swapT <= 0) startReload(c);
    // ----- ammo hunting when completely dry
    if (primAmmo === 0 && pistAmmo === 0 && !this.seekAmmo) {
      let bd = 60, bp = null; for (const p of ctx.fx.props) { if (p.kind !== 'ammo' || p.pos.distanceTo(c.pos) > bd) continue; if (c.weapons.primary && p.data.type !== c.weapons.primary.ammoType && p.data.type !== 'pistol') continue; bd = p.pos.distanceTo(c.pos); bp = p; }
      if (bp) { this.seekAmmo = bp; this.goal = { x: bp.pos.x, z: bp.pos.z }; this.requestPath(); }
    }
    if (this.seekAmmo && !ctx.fx.props.includes(this.seekAmmo)) { this.seekAmmo = null; this.goalT = 0; }
    if (this.reactT > 0) this.reactT -= dt;
    const tgt = this.target;
    let engaged = !!tgt;
    const eyeH = 1.45 * c.s * (1 - 0.25 * c.crouch);
    // ----- aim
    let desYaw = this.aimYaw, desPitch = 0, aimBlendT = 0.25;
    if (tgt) {
      const dx = tgt.pos.x - c.pos.x, dz = tgt.pos.z - c.pos.z, dist = Math.hypot(dx, dz);
      const ty = tgt.pos.y + tgt.s * (0.45 + 1.0 * this.aimH) * (1 - 0.25 * tgt.crouch);
      desYaw = Math.atan2(-dx, -dz); desPitch = Math.atan2(ty - (c.pos.y + eyeH), dist);
      aimBlendT = 1;
    } else if (this.lastSeen && now - this.seenT < 4) { const dx = this.lastSeen.x - c.pos.x, dz = this.lastSeen.z - c.pos.z; desYaw = Math.atan2(-dx, -dz); aimBlendT = 0.7; desPitch = 0; }
    // ----- movement
    let wishX = 0, wishZ = 0, speed = t.walk;
    const stumble = c.stumble > 0 ? 0.55 : 1;
    if (tgt && this.reactT <= 0 && ctx.time - this.seenT < 1) {
      const dx = tgt.pos.x - c.pos.x, dz = tgt.pos.z - c.pos.z, dist = Math.hypot(dx, dz), nx = dx / (dist || 1), nz = dz / (dist || 1);
      const range = !w ? 1.6 : w.type === 'shotgun' ? 16 : w.type === 'pistol' ? 24 : 55;
      this.strafeT -= dt; if (this.strafeT <= 0) { this.strafeT = rand(0.8, 2.4); this.strafe = pick([-1, 0, 1, 1, -1]); c.crouchT = dist > 22 && chance(t.crouchy) ? 1 : 0; }
      if (!w || dist > range) { // close the distance
        if (!this.path || this.repathT <= 0 || !this.chasing) { this.chasing = true; this.requestPath(tgt.pos.x, tgt.pos.z); }
        this.followPath(dt); wishX = c.wish.x; wishZ = c.wish.z; speed = t.walk * (c.crouch > 0.5 ? 0.6 : 1);
      } else { this.chasing = false; wishX = -nz * this.strafe; wishZ = nx * this.strafe; speed = 1.8; if (c.crouchT > 0.5) speed = 0.8; }
      if (this.retreatT > now) { wishX = -nx; wishZ = -nz; speed = t.walk; }
      // grenade logic: rare and only when it makes sense
      this.grenT -= dt;
      if (c.grenades > 0 && this.grenT <= 0 && dist > 11 && dist < 32 && c.throwT <= 0) {
        this.grenT = 0.8;
        const inTrench = T.trenchDist(tgt.pos.x, tgt.pos.z) < 1.25 && tgt.pos.y < T.h(tgt.pos.x, tgt.pos.z) - 0.2 + 0.01 ? true : (T.trenchDist(tgt.pos.x, tgt.pos.z) < 1.3);
        const camping = this.tgtStillT > 3;
        let cluster = 0; for (const e of this.enemies()) if (e !== tgt && e.pos.distanceTo(tgt.pos) < 5) cluster++;
        const friendlyNear = ctx.chars.some((a) => a.alive && a.team === c.team && a.pos.distanceTo(tgt.pos) < 7.5);
        const blocked = castRay(_a.set(c.pos.x, c.pos.y + 1.5, c.pos.z), _b.set(tgt.pos.x - c.pos.x, 3, tgt.pos.z - c.pos.z).normalize(), Math.min(dist, 12), { noChars: true, noGlass: true });
        if (!friendlyNear && !blocked && (inTrench || camping || cluster >= 1) && chance(0.07 * t.grenadeBias)) { this.startThrow(tgt); }
      }
      if (w && w.type !== 'pistol' && this.aimH && ctx.time % 3 < dt) this.aimH = 0.45 + Math.random() * 0.5;
      // low health: fall back
      if (c.hp < 35 && chance(0.002 * (1.2 - t.courage)) && this.retreatT < now) this.retreatT = now + rand(4, 8);
    } else {
      // no visible target: travel along the path, investigate last seen position
      this.goalT -= dt; this.repathT -= dt;
      if (this.lastSeen && now - this.seenT < 6 && !this.seekAmmo && !(this.noiseTarget && false)) {
        if (!this.goal || this.goal._seen !== this.lastSeen) { this.goal = { x: this.lastSeen.x, z: this.lastSeen.z, _seen: this.lastSeen }; this.requestPath(); }
      } else if (!this.goal || this.goalT <= 0 || (this.path && this.pi >= this.path.length && Math.hypot(this.goal.x - c.pos.x, this.goal.z - c.pos.z) < 3)) { if (!this.seekAmmo) this.pickGoal(); }
      if (this.repathT <= 0 && this.goal) this.requestPath();
      this.followPath(dt); wishX = c.wish.x; wishZ = c.wish.z;
      const far = this.goal ? Math.hypot(this.goal.x - c.pos.x, this.goal.z - c.pos.z) : 0;
      speed = far > 40 && !this.lastSeen ? t.run : t.walk; c.crouchT = 0;
      if (this.holdT > 0) { this.holdT -= dt; wishX = wishZ = 0; }
      else if (Math.random() < dt * 0.04) this.holdT = rand(1, 3);
      if (wishX || wishZ) { desYaw = Math.atan2(-wishX, -wishZ); }
    }
    // knife: stab when in range, throw sometimes at mid distance
    if (!w && tgt && c.cur === 'knife') {
      const d = Math.hypot(tgt.pos.x - c.pos.x, tgt.pos.z - c.pos.z);
      if (d < 1.9 && this.reactT <= 0) meleeAttack(c, _a.set(c.pos.x, c.pos.y + 1.4, c.pos.z), _b.set(-Math.sin(c.yaw), 0, -Math.cos(c.yaw)));
      else if (d > 6 && d < 13 && c.hasKnife && chance(0.004 * t.aggression)) { _a.set(c.pos.x, c.pos.y + 1.4, c.pos.z); _b.set(tgt.pos.x - _a.x, tgt.pos.y + 1.2 - _a.y, tgt.pos.z - _a.z).normalize(); throwKnife(c, _a, _b); }
      speed = t.run * 0.9;
    }
    // ----- apply aim smoothing (finite turn rate)
    const maxTurn = t.turn * dt * (c.stumble > 0 ? 0.5 : 1);
    this.aimYaw += clamp(angDiff(this.aimYaw, desYaw), -maxTurn, maxTurn); this.aimPitch += clamp(desPitch - this.aimPitch, -maxTurn, maxTurn);
    c.yaw = this.aimYaw; c.aimPitch = this.aimPitch; c.aimBlend = damp(c.aimBlend, aimBlendT, 6, dt);
    const sp = (wishX || wishZ) ? speed * stumble : 0; const l = Math.hypot(wishX, wishZ) || 1;
    c.wish.x = wishX / l; c.wish.z = wishZ / l; c.wish.speed = sp;
    // ----- shooting
    if (tgt && this.reactT <= 0 && w && c.throwT <= 0 && c.cur !== 'knife') this.shoot(dt, tgt, w);
    // ----- stuck detection
    if (sp > 0.5) { if (c.pos.distanceTo(this.lastPos) < 0.04) this.stuckT += dt; else { this.stuckT = 0; this.lastPos.copy(c.pos); } if (this.stuckT > 1.4) { this.stuckT = 0; this.path = null; this.goalT = 0; this.repathT = 0; if (!tgt) this.holdT = 0; c.wish.x += rand(-1, 1); } }
    this.lastPos.copy(c.pos); this.pendingThrow(dt);
  }

  startThrow(tgt) { const c = this.c; c.throwT = 1.0; c.aimBlend = 0.9; this.throwQ = { t: 0.55, tgt: tgt.pos.clone().add(new THREE.Vector3(tgt.vel.x * 0.6, 0, tgt.vel.z * 0.6)) }; ctx.audio.mech('pin', c.pos, 1); }
  pendingThrow(dt) {
    const q = this.throwQ; if (!q) return; q.t -= dt; const c = this.c; this.c.wish.speed *= 0.2;
    if (q.t <= 0) { const from = _a.set(c.pos.x - Math.sin(c.yaw) * 0.4, c.pos.y + 1.6 * c.s, c.pos.z - Math.cos(c.yaw) * 0.4).clone(); const v = grenadeVelocity(from, q.tgt, 0.07); throwGrenade(c, from, v); this.throwQ = null; }
  }

  shoot(dt, tgt, w) {
    const c = this.c, t = this.t;
    if (c.reload || c.overheat || c.swapT > 0 || w.heatLock > 0) return;
    const dx = tgt.pos.x - c.pos.x, dz = tgt.pos.z - c.pos.z, dist = Math.hypot(dx, dz);
    // is the aim pointing close enough to the target?
    const ey = Math.abs(angDiff(this.aimYaw, Math.atan2(-dx, -dz)));
    if (ey > 0.025 + 0.45 / (dist + 8)) return;
    if (dist > w.def.range * 0.9) return;
    this.burstCd -= dt;
    if (this.burst <= 0) { if (this.burstCd > 0) return; this.burst = w.type === 'pistol' ? randi(1, 2) : w.type === 'shotgun' ? 1 : randi(t.burstMin, t.burstMax); }
    if (c.fireCd > 0) return;
    const eye = _a.set(c.pos.x, c.pos.y + 1.45 * c.s * (1 - 0.25 * c.crouch), c.pos.z);
    const dir = _b.set(-Math.sin(this.aimYaw) * Math.cos(this.aimPitch), Math.sin(this.aimPitch), -Math.cos(this.aimYaw) * Math.cos(this.aimPitch));
    const spread = t.acc * (1 + dist / 55) * (c.moveSpeed > 1.2 ? 1.5 : 1) * (c.stumble > 0 ? 2.2 : 1) * (c.crouch > 0.5 ? 0.8 : 1) * (this.supportBonus ? 0.9 : 1) * (ctx.sky.dark > 0.5 ? 1.15 : 1);
    if (fireWeapon(c, eye, dir, { spread })) { this.burst--; if (this.burst <= 0) this.burstCd = t.pause * rand(0.6, 1.4) * (w.type === 'shotgun' ? 1.2 : 1); }
  }

  followPath(dt) {
    const c = this.c; c.wish.x = 0; c.wish.z = 0; this.repathT -= dt;
    if (!this.path || this.pi >= this.path.length) return;
    // skip ahead if we can see further waypoints
    let wp = this.path[this.pi];
    while (this.pi < this.path.length - 1 && Math.hypot(wp.x - c.pos.x, wp.z - c.pos.z) < 0.9) { this.pi++; wp = this.path[this.pi]; }
    if (this.pi >= this.path.length - 1 && Math.hypot(wp.x - c.pos.x, wp.z - c.pos.z) < 0.9) { this.pi = this.path.length; return; }
    const look = this.path[Math.min(this.path.length - 1, this.pi + 1)];
    const dx = (wp.x + look.x) / 2 - c.pos.x, dz = (wp.z + look.z) / 2 - c.pos.z, d = Math.hypot(dx, dz) || 1;
    c.wish.x = dx / d; c.wish.z = dz / d;
    // keep a little personal space from squad mates
    for (const a of ctx.chars) { if (a === c || !a.alive) continue; const ax = c.pos.x - a.pos.x, az = c.pos.z - a.pos.z, ad = Math.hypot(ax, az); if (ad < 1.2 && ad > 0.01) { c.wish.x += ax / ad * 0.6; c.wish.z += az / ad * 0.6; } }
  }
}
