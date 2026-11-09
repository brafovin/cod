import * as THREE from 'three';
import { clamp, rand, lerp, windU, pick } from './util.js';
import * as T from './terrain.js';
import { holeTex, craterDecalTex, groundLeafTex, rockTex } from './textures.js';
import { bulletGeo9 } from './weapons.js';

const _v = new THREE.Vector3(), _q = new THREE.Quaternion(), _q2 = new THREE.Quaternion(), _m = new THREE.Matrix4(), _s = new THREE.Vector3(), _e = new THREE.Euler();
const Z = new THREE.Vector3(0, 0, 1), UPV = new THREE.Vector3(0, 1, 0);

// ---------------------------------------------------------------- generic small rigid bodies (casings, loose rounds, pebbles)
class SmallBodies {
  constructor(scene, geo, mat, cap, { radius = 0.01, bounce = 0.35, fric = 0.55, sound = null, shadow = false } = {}) {
    this.cap = cap; this.r = radius; this.bounce = bounce; this.fric = fric; this.sound = sound; this.n = 0; this.head = 0;
    this.mesh = new THREE.InstancedMesh(geo, mat, cap); this.mesh.frustumCulled = false; this.mesh.count = 0; this.mesh.castShadow = shadow;
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    scene.add(this.mesh);
    this.p = new Float32Array(cap * 3); this.v = new Float32Array(cap * 3); this.rot = new Float32Array(cap * 3); this.w = new Float32Array(cap * 3);
    this.sleep = new Uint8Array(cap); this.scale = new Float32Array(cap).fill(1); this.live = new Uint8Array(cap); this.snd = new Float32Array(cap);
    this.dirty = true;
  }
  add(x, y, z, vx, vy, vz, sc = 1, asleep = false) {
    const i = this.head; this.head = (this.head + 1) % this.cap; this.n = Math.min(this.cap, this.n + 1); this.mesh.count = this.n;
    this.p.set([x, y, z], i * 3); this.v.set([vx, vy, vz], i * 3); this.rot.set([rand(0, 6.28), rand(0, 6.28), rand(0, 6.28)], i * 3);
    this.w.set([rand(-20, 20), rand(-20, 20), rand(-20, 20)], i * 3); this.sleep[i] = asleep ? 1 : 0; this.scale[i] = sc; this.live[i] = 1; this.dirty = true;
    if (asleep) { this.v.fill(0, i * 3, i * 3 + 3); this.w.fill(0, i * 3, i * 3 + 3); }
    this._set(i); return i;
  }
  _set(i) {
    _e.set(this.rot[i * 3], this.rot[i * 3 + 1], this.rot[i * 3 + 2]); _q.setFromEuler(_e); const s = this.scale[i];
    _m.compose(_v.set(this.p[i * 3], this.p[i * 3 + 1], this.p[i * 3 + 2]), _q, _s.set(s, s, s)); this.mesh.setMatrixAt(i, _m);
  }
  update(dt, chars, audio) {
    let ch = false;
    for (let i = 0; i < this.n; i++) {
      const i3 = i * 3;
      if (this.sleep[i]) {
        // woken by passing characters
        for (const c of chars) {
          if (!c.alive || c.moveSpeed < 0.4) continue;
          const dx = this.p[i3] - c.pos.x, dz = this.p[i3 + 2] - c.pos.z, d2 = dx * dx + dz * dz;
          if (d2 < 0.3 && Math.abs(this.p[i3 + 1] - c.pos.y) < 0.4) {
            const d = Math.sqrt(d2) || 0.01, sp = c.moveSpeed;
            this.v[i3] = dx / d * sp * 0.9 + rand(-0.3, 0.3); this.v[i3 + 1] = rand(0.6, 1.8) * Math.min(1, sp / 2); this.v[i3 + 2] = dz / d * sp * 0.9 + rand(-0.3, 0.3);
            this.w[i3] = rand(-25, 25); this.w[i3 + 1] = rand(-25, 25); this.w[i3 + 2] = rand(-25, 25); this.sleep[i] = 0; break;
          }
        }
        continue;
      }
      this.v[i3 + 1] -= 9.8 * dt;
      this.p[i3] += this.v[i3] * dt; this.p[i3 + 1] += this.v[i3 + 1] * dt; this.p[i3 + 2] += this.v[i3 + 2] * dt;
      this.rot[i3] += this.w[i3] * dt; this.rot[i3 + 1] += this.w[i3 + 1] * dt; this.rot[i3 + 2] += this.w[i3 + 2] * dt;
      const gy = T.h(this.p[i3], this.p[i3 + 2]) + this.r * this.scale[i];
      if (this.p[i3 + 1] < gy) {
        this.p[i3 + 1] = gy;
        if (this.v[i3 + 1] < -0.6) {
          if (this.sound && audio && this.snd[i] < performance.now() - 80) { this.snd[i] = performance.now(); if (Math.random() < 0.5) audio.mech('clink', _v.set(this.p[i3], this.p[i3 + 1], this.p[i3 + 2]), 0.5, rand(0.8, 1.3)); }
          this.v[i3 + 1] *= -this.bounce; this.v[i3] *= this.fric; this.v[i3 + 2] *= this.fric; this.w[i3] *= 0.6; this.w[i3 + 1] *= 0.6; this.w[i3 + 2] *= 0.6;
        } else {
          this.v[i3 + 1] = 0; this.v[i3] *= 1 - dt * 9; this.v[i3 + 2] *= 1 - dt * 9; this.w[i3] *= 1 - dt * 12; this.w[i3 + 1] *= 1 - dt * 12; this.w[i3 + 2] *= 1 - dt * 12;
          if (Math.abs(this.v[i3]) + Math.abs(this.v[i3 + 2]) < 0.06) { this.sleep[i] = 1; this.v.fill(0, i3, i3 + 3); this.w.fill(0, i3, i3 + 3); }
        }
      }
      this._set(i); ch = true;
    }
    if (ch || this.dirty) { this.mesh.instanceMatrix.needsUpdate = true; this.dirty = false; }
  }
}

// ---------------------------------------------------------------- particles
const PART_VERT = `attribute vec4 aColor; attribute float aSize; attribute float aAdd; uniform float uScale; varying vec4 vC; varying float vAdd;
void main(){ vC = aColor; vAdd = aAdd; vec4 mv = modelViewMatrix * vec4(position,1.0); gl_Position = projectionMatrix * mv; gl_PointSize = clamp(aSize * uScale / max(0.1,-mv.z), 0.0, 220.0); }`;
const PART_FRAG = `varying vec4 vC; varying float vAdd; uniform vec3 uLight;
void main(){ float d = length(gl_PointCoord - 0.5) * 2.0; float a = smoothstep(1.0, 0.15, d); if(a<0.01) discard;
  vec3 rgb = vC.rgb * mix(uLight, vec3(1.0), vAdd); gl_FragColor = vec4(rgb * a * vC.a, a * vC.a * (1.0 - vAdd)); }`;

export class FX {
  constructor(scene, audio) {
    this.scene = scene; this.audio = audio; this.time = 0;
    // particles
    const N = this.N = 3500;
    const geo = new THREE.BufferGeometry();
    this.pp = new Float32Array(N * 3); this.pc = new Float32Array(N * 4); this.ps = new Float32Array(N); this.pa = new Float32Array(N);
    geo.setAttribute('position', new THREE.BufferAttribute(this.pp, 3).setUsage(THREE.DynamicDrawUsage));
    geo.setAttribute('aColor', new THREE.BufferAttribute(this.pc, 4).setUsage(THREE.DynamicDrawUsage));
    geo.setAttribute('aSize', new THREE.BufferAttribute(this.ps, 1).setUsage(THREE.DynamicDrawUsage));
    geo.setAttribute('aAdd', new THREE.BufferAttribute(this.pa, 1).setUsage(THREE.DynamicDrawUsage));
    this.pU = { uScale: { value: 600 }, uLight: { value: new THREE.Color(1, 1, 1) } };
    this.points = new THREE.Points(geo, new THREE.ShaderMaterial({ uniforms: this.pU, vertexShader: PART_VERT, fragmentShader: PART_FRAG, transparent: true, depthWrite: false, blending: THREE.CustomBlending, blendEquation: THREE.AddEquation, blendSrc: THREE.OneFactor, blendDst: THREE.OneMinusSrcAlphaFactor }));
    this.points.frustumCulled = false; scene.add(this.points);
    this.pv = new Float32Array(N * 3); this.pl = new Float32Array(N); this.pml = new Float32Array(N); this.pg = new Float32Array(N); this.pd = new Float32Array(N); this.pgrow = new Float32Array(N); this.ps0 = new Float32Array(N); this.pa0 = new Float32Array(N);
    this.ph = 0; this.ps.fill(0); this.pl.fill(0);
    // decals
    const dm = (tex, cap) => { const m = new THREE.InstancedMesh(new THREE.PlaneGeometry(1, 1), new THREE.MeshStandardMaterial({ map: tex, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4, roughness: 1, metalness: 0 }), cap); m.count = 0; m.frustumCulled = false; m.instanceMatrix.setUsage(THREE.DynamicDrawUsage); scene.add(m); return m; };
    this.holes = dm(holeTex(), 900); this.craters = dm(craterDecalTex(), 80); this.dh = 0; this.dc = 0;
    // tracers
    this.tracers = [];
    const tg = new THREE.BoxGeometry(0.016, 0.016, 1), tm = new THREE.MeshBasicMaterial({ color: 0xffe0a0, transparent: true, opacity: 0.9, blending: THREE.AdditiveBlending, depthWrite: false, fog: false });
    for (let i = 0; i < 30; i++) { const m = new THREE.Mesh(tg, tm); m.visible = false; m.frustumCulled = false; scene.add(m); this.tracers.push({ m, life: 0, a: new THREE.Vector3(), b: new THREE.Vector3(), len: 1 }); }
    // casings etc.
    const cg = new THREE.CylinderGeometry(0.0046, 0.005, 0.034, 6); cg.rotateX(Math.PI / 2);
    const brass = new THREE.MeshStandardMaterial({ color: 0xb08a3a, roughness: 0.35, metalness: 0.9 }), red = new THREE.MeshStandardMaterial({ color: 0xa02018, roughness: 0.6, metalness: 0.1 });
    this.casings = new SmallBodies(scene, cg, brass, 600, { radius: 0.005, bounce: 0.4, fric: 0.5, sound: true });
    const sg = new THREE.CylinderGeometry(0.0095, 0.0095, 0.06, 8); sg.rotateX(Math.PI / 2);
    this.shells = new SmallBodies(scene, sg, red, 120, { radius: 0.01, bounce: 0.3, fric: 0.5, sound: true });
    this.loose = new SmallBodies(scene, bulletGeo9(), new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.35, metalness: 0.9 }), 500, { radius: 0.006, bounce: 0.3, fric: 0.5 });
    const rt = rockTex(); const pg = new THREE.IcosahedronGeometry(1, 1); const pos = pg.attributes.position; for (let i = 0; i < pos.count; i++) { const k = 0.7 + Math.abs(Math.sin(i * 12.9898) * 43758.5453 % 1) * 0.5; pos.setXYZ(i, pos.getX(i) * k, pos.getY(i) * k * 0.7, pos.getZ(i) * k); } pg.computeVertexNormals();
    this.pebbles = new SmallBodies(scene, pg, new THREE.MeshStandardMaterial({ map: rt, roughness: 0.95 }), 500, { radius: 0.03, bounce: 0.25, fric: 0.4, shadow: false });
    // leaves
    this.initLeaves(scene);
    this.props = [];
  }

  // ---------- particles
  emit(x, y, z, vx, vy, vz, o) {
    const i = this.ph; this.ph = (this.ph + 1) % this.N;
    this.pp[i * 3] = x; this.pp[i * 3 + 1] = y; this.pp[i * 3 + 2] = z; this.pv[i * 3] = vx; this.pv[i * 3 + 1] = vy; this.pv[i * 3 + 2] = vz;
    const c = o.c || [0.5, 0.5, 0.5];
    this.pc[i * 4] = c[0]; this.pc[i * 4 + 1] = c[1]; this.pc[i * 4 + 2] = c[2]; this.pc[i * 4 + 3] = o.a ?? 0.6; this.pa0[i] = o.a ?? 0.6;
    this.pml[i] = this.pl[i] = o.life ?? 1; this.ps0[i] = o.size ?? 0.2; this.ps[i] = this.ps0[i]; this.pgrow[i] = o.grow ?? 1; this.pg[i] = o.grav ?? 0; this.pd[i] = o.drag ?? 1; this.pa[i] = o.add ?? 0;
  }
  dust(p, n = 6, col = [0.38, 0.32, 0.25], up = 1, spread = 1) {
    for (let i = 0; i < n; i++) this.emit(p.x, p.y, p.z, rand(-1, 1) * spread, rand(0.2, 1.2) * up, rand(-1, 1) * spread, { c: col, a: 0.5, life: rand(0.5, 1.2), size: rand(0.15, 0.3), grow: 2.5, grav: -0.1, drag: 2.5 });
  }
  smoke(p, n = 3, size = 0.4, life = 2.5, col = [0.5, 0.5, 0.5]) {
    for (let i = 0; i < n; i++) this.emit(p.x + rand(-0.1, 0.1), p.y, p.z + rand(-0.1, 0.1), rand(-0.2, 0.2) + windU.uWindDir.value.x * 0.5, rand(0.3, 0.9), rand(-0.2, 0.2) + windU.uWindDir.value.y * 0.5, { c: col, a: 0.35, life, size, grow: 3, grav: -0.15, drag: 0.8 });
  }
  sparks(p, n, nrm) { for (let i = 0; i < n; i++) this.emit(p.x, p.y, p.z, (nrm ? nrm.x : 0) * 3 + rand(-2, 2), (nrm ? nrm.y : 1) * 3 + rand(0, 2), (nrm ? nrm.z : 0) * 3 + rand(-2, 2), { c: [1, 0.7, 0.3], a: 1, life: rand(0.15, 0.4), size: 0.035, grow: 0.3, grav: 9, drag: 0.5, add: 1 }); }
  blood(p, dir, n = 6) { for (let i = 0; i < n; i++) this.emit(p.x, p.y, p.z, dir.x * rand(1, 3) + rand(-1, 1), dir.y * 2 + rand(0, 1.5), dir.z * rand(1, 3) + rand(-1, 1), { c: [0.35, 0.02, 0.02], a: 0.9, life: rand(0.3, 0.7), size: rand(0.04, 0.09), grow: 0.8, grav: 8, drag: 1 }); }
  splinters(p, nrm, n = 6, col = [0.6, 0.45, 0.3]) { for (let i = 0; i < n; i++) this.emit(p.x, p.y, p.z, nrm.x * 3 + rand(-2, 2), nrm.y * 2 + rand(0, 3), nrm.z * 3 + rand(-2, 2), { c: col, a: 1, life: rand(0.3, 0.8), size: 0.04, grow: 0.5, grav: 9, drag: 0.6 }); }
  muzzle(p, dir, sup, big = 1) {
    if (!sup) for (let i = 0; i < 4; i++) this.emit(p.x, p.y, p.z, dir.x * rand(2, 6), dir.y * rand(2, 6), dir.z * rand(2, 6), { c: [1, 0.75, 0.35], a: 1, life: 0.07, size: 0.22 * big, grow: 0.5, add: 1, drag: 3 });
    this.emit(p.x + dir.x * 0.2, p.y + dir.y * 0.2, p.z + dir.z * 0.2, dir.x * 1.5, dir.y * 1.5 + 0.2, dir.z * 1.5, { c: [0.6, 0.6, 0.6], a: sup ? 0.12 : 0.28, life: 1.1 * big, size: 0.15, grow: 5, grav: -0.2, drag: 1.5 });
  }
  explosion(p, r = 4) {
    for (let i = 0; i < 40; i++) { const a = rand(0, 6.28), e = rand(-0.2, 1), sp = rand(2, 9); this.emit(p.x, p.y + 0.3, p.z, Math.cos(a) * sp * (1 - e * 0.4), e * sp * 0.9 + 2, Math.sin(a) * sp * (1 - e * 0.4), { c: [1, rand(0.4, 0.8), 0.15], a: 1, life: rand(0.15, 0.45), size: rand(0.9, 1.8), grow: 1.4, grav: 0, drag: 3, add: 1 }); }
    for (let i = 0; i < 36; i++) { const a = rand(0, 6.28), sp = rand(1, 6); this.emit(p.x, p.y + 0.5, p.z, Math.cos(a) * sp, rand(1, 6), Math.sin(a) * sp, { c: [0.28, 0.25, 0.22], a: 0.75, life: rand(1.5, 3.2), size: rand(0.8, 1.6), grow: 3.2, grav: -0.2, drag: 1.4 }); }
    for (let i = 0; i < 50; i++) { const a = rand(0, 6.28), sp = rand(5, 18); this.emit(p.x, p.y + 0.2, p.z, Math.cos(a) * sp, rand(3, 14), Math.sin(a) * sp, { c: [0.25, 0.2, 0.14], a: 1, life: rand(0.6, 1.6), size: 0.1, grow: 0.8, grav: 12, drag: 0.3 }); }
    this.sparks(p, 30, UPV);
  }
  leafBurst(p, n = 20) { for (let i = 0; i < n; i++) this.spawnLeaf(p.x + rand(-1, 1), p.y + rand(-0.5, 0.5), p.z + rand(-1, 1), rand(-2, 2), rand(0, 3), rand(-2, 2)); }

  // ---------- decals
  decal(pos, nrm, size = 0.07, kind = 'hole', tint = [1, 1, 1]) {
    const mesh = kind === 'crater' ? this.craters : this.holes;
    const i = kind === 'crater' ? (this.dc = (this.dc + 1) % 80) : (this.dh = (this.dh + 1) % 900);
    _q.setFromUnitVectors(Z, nrm); _q2.setFromAxisAngle(Z, rand(0, 6.28)); _q.multiply(_q2);
    _v.copy(pos).addScaledVector(nrm, 0.01);
    _m.compose(_v, _q, _s.set(size, size, size)); mesh.setMatrixAt(i, _m); mesh.setColorAt(i, new THREE.Color(tint[0], tint[1], tint[2]));
    mesh.count = Math.max(mesh.count, i + 1); mesh.instanceMatrix.needsUpdate = true; if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  }

  // ---------- tracers
  tracer(a, b) {
    const t = this.tracers.find((t) => t.life <= 0) || this.tracers[0];
    t.a.copy(a); t.b.copy(b); t.life = 0.09; t.max = 0.09; t.m.visible = true;
  }

  // ---------- casings
  casing(pos, vel, kind = 'rifle') {
    if (kind === 'shell') this.shells.add(pos.x, pos.y, pos.z, vel.x, vel.y, vel.z);
    else this.casings.add(pos.x, pos.y, pos.z, vel.x, vel.y, vel.z, kind === 'pistol' ? 0.8 : 1);
  }

  // ---------- leaves
  initLeaves(scene) {
    const C = this.LC = 1700;
    const g = new THREE.PlaneGeometry(0.12, 0.085); g.rotateX(-Math.PI / 2);
    const m = new THREE.MeshStandardMaterial({ map: groundLeafTex(), alphaTest: 0.5, side: THREE.DoubleSide, roughness: 0.9 });
    this.leafMesh = new THREE.InstancedMesh(g, m, C); this.leafMesh.frustumCulled = false; this.leafMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage); scene.add(this.leafMesh);
    this.lp = new Float32Array(C * 3); this.lv = new Float32Array(C * 3); this.lr = new Float32Array(C * 3); this.lw = new Float32Array(C * 3); this.ls = new Uint8Array(C); this.lh = 0; this.leafCount = 0;
    this.leafMesh.count = 0; this.leafTimer = 0;
    const col = new THREE.Color();
    for (let i = 0; i < C; i++) { col.setHSL(rand(0.06, 0.2), rand(0.35, 0.6), rand(0.25, 0.5)); this.leafMesh.setColorAt(i, col); }
  }
  spawnLeaf(x, y, z, vx = 0, vy = 0, vz = 0, state = 1) {
    const i = this.lh; this.lh = (this.lh + 1) % this.LC; this.leafCount = Math.min(this.LC, this.leafCount + 1); this.leafMesh.count = this.leafCount;
    this.lp.set([x, y, z], i * 3); this.lv.set([vx, vy, vz], i * 3); this.lr.set([rand(0, 6.28), rand(0, 6.28), rand(0, 6.28)], i * 3); this.lw.set([rand(-4, 4), rand(-3, 3), rand(-4, 4)], i * 3); this.ls[i] = state;
    return i;
  }
  scatterLeaf(x, z) { const y = T.h(x, z) + 0.012; const i = this.spawnLeaf(x, y, z, 0, 0, 0, 0); this.lr[i * 3] = 0; this.lr[i * 3 + 2] = 0; }
  updateLeaves(dt, chars, trees, camPos) {
    const wind = windU.uWind.value, wd = windU.uWindDir.value, t = this.time;
    // trees shed leaves
    this.leafTimer -= dt;
    if (this.leafTimer <= 0 && trees.length) {
      this.leafTimer = 0.18 / (0.5 + wind);
      const tr = trees[Math.floor(Math.random() * trees.length)];
      if (tr.alive && tr.leafy && Math.hypot(tr.x - camPos.x, tr.z - camPos.z) < 70) this.spawnLeaf(tr.x + rand(-2.5, 2.5), T.h(tr.x, tr.z) + tr.h * rand(0.6, 0.95), tr.z + rand(-2.5, 2.5), wd.x * wind, 0, wd.y * wind);
    }
    const n = this.leafCount; let ch = false; const mesh = this.leafMesh;
    for (let i = 0; i < n; i++) {
      const i3 = i * 3, st = this.ls[i];
      if (st === 0) {
        const px = this.lp[i3], pz = this.lp[i3 + 2];
        let kicked = false;
        for (const c of chars) {
          if (!c.alive || c.moveSpeed < 0.5) continue; const dx = px - c.pos.x, dz = pz - c.pos.z, d2 = dx * dx + dz * dz;
          if (d2 < 0.55 && Math.abs(this.lp[i3 + 1] - c.pos.y) < 0.5) { const d = Math.sqrt(d2) || 0.01; this.lv[i3] = dx / d * c.moveSpeed * 0.7 + rand(-0.4, 0.4); this.lv[i3 + 1] = rand(0.8, 2.0); this.lv[i3 + 2] = dz / d * c.moveSpeed * 0.7 + rand(-0.4, 0.4); this.ls[i] = 2; this.lw[i3] = rand(-8, 8); this.lw[i3 + 1] = rand(-8, 8); this.lw[i3 + 2] = rand(-8, 8); kicked = true; break; }
        }
        if (!kicked && wind > 0.55 && Math.random() < 0.0009 * (wind - 0.4) * 60 * dt * 60 / 60 && Math.hypot(px - camPos.x, pz - camPos.z) < 45) { this.lv[i3] = wd.x * wind * 2.2; this.lv[i3 + 1] = rand(0.6, 1.6); this.lv[i3 + 2] = wd.y * wind * 2.2; this.ls[i] = 2; }
        continue;
      }
      // airborne
      const fl = st === 1 ? 0.9 : 0.5;
      this.lv[i3] += ((wd.x * wind * 3.2) - this.lv[i3]) * dt * 1.2 + Math.sin(t * 5 + i) * 0.6 * dt * fl;
      this.lv[i3 + 2] += ((wd.y * wind * 3.2) - this.lv[i3 + 2]) * dt * 1.2 + Math.cos(t * 4.3 + i * 1.7) * 0.6 * dt * fl;
      this.lv[i3 + 1] += (st === 1 ? (-0.9 + Math.sin(t * 4 + i * 2) * 0.5 - this.lv[i3 + 1]) * dt * 2.5 : -6 * dt);
      this.lp[i3] += this.lv[i3] * dt; this.lp[i3 + 1] += this.lv[i3 + 1] * dt; this.lp[i3 + 2] += this.lv[i3 + 2] * dt;
      this.lr[i3] += this.lw[i3] * dt; this.lr[i3 + 1] += this.lw[i3 + 1] * dt; this.lr[i3 + 2] += this.lw[i3 + 2] * dt;
      const gy = T.h(this.lp[i3], this.lp[i3 + 2]) + 0.012;
      if (this.lp[i3 + 1] <= gy) {
        this.lp[i3 + 1] = gy;
        if (wind > 0.7 && Math.random() < 0.5 * wind) { this.lv[i3 + 1] = rand(0.5, 1.5); this.lv[i3] = wd.x * wind * 2.4; this.lv[i3 + 2] = wd.y * wind * 2.4; this.ls[i] = 2; }
        else { this.ls[i] = 0; this.lr[i3] = 0; this.lr[i3 + 2] = 0; }
      }
      _e.set(this.lr[i3], this.lr[i3 + 1], this.lr[i3 + 2]); _q.setFromEuler(_e);
      mesh.setMatrixAt(i, _m.compose(_v.set(this.lp[i3], this.lp[i3 + 1], this.lp[i3 + 2]), _q, _s.set(1, 1, 1))); ch = true;
    }
    if (this._leafInit !== this.leafCount) { // matrices for freshly placed resting leaves
      for (let i = this._leafInit || 0; i < this.leafCount; i++) { const i3 = i * 3; _e.set(this.lr[i3], this.lr[i3 + 1], this.lr[i3 + 2]); _q.setFromEuler(_e); mesh.setMatrixAt(i, _m.compose(_v.set(this.lp[i3], this.lp[i3 + 1], this.lp[i3 + 2]), _q, _s.set(1, 1, 1))); }
      this._leafInit = this.leafCount; ch = true;
    }
    if (ch) { mesh.instanceMatrix.needsUpdate = true; }
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = false;
  }

  // ---------- physical props (pick-ups, dropped mags, grenades, knives, rockets)
  addProp(p) {
    p.vel = p.vel || new THREE.Vector3(); p.tx = 0; p.tz = 0; p.tvx = 0; p.tvz = 0; p.sleep = false; p.still = 0; p.yaw = p.yaw ?? rand(0, 6.28);
    p.rest = p.rest ?? 0.04; p.bounce = p.bounce ?? 0.3; p.fric = p.fric ?? 0.5; p.lying = p.lying || new THREE.Quaternion(); p.spin = p.spin ?? rand(-6, 6);
    this.scene.add(p.mesh); this.props.push(p); this._orient(p); return p;
  }
  removeProp(p) { this.scene.remove(p.mesh); const i = this.props.indexOf(p); if (i >= 0) this.props.splice(i, 1); }
  _orient(p) {
    _e.set(p.tx, p.yaw, p.tz, 'YXZ'); p.mesh.quaternion.setFromEuler(_e).multiply(p.lying); p.mesh.position.copy(p.pos);
  }
  updateProps(dt, chars, hooks) {
    for (let k = this.props.length - 1; k >= 0; k--) {
      const p = this.props[k];
      if (p.kind === 'rocket' || p.kind === 'knife_fly') { hooks.flight(p, dt, k); continue; }
      if (p.fuse !== undefined) { p.fuse -= dt; if (p.fuse <= 0) { hooks.explode(p); this.removeProp(p); continue; } }
      // characters walking over objects make them react
      for (const c of chars) {
        if (!c.alive) continue; const dx = p.pos.x - c.pos.x, dz = p.pos.z - c.pos.z, d2 = dx * dx + dz * dz, rr = 0.5 + (p.size || 0.2) * 0.5;
        if (d2 < rr * rr && Math.abs(p.pos.y - c.pos.y) < 0.45 && c.moveSpeed > 0.5) {
          const d = Math.sqrt(d2) || 0.01, sp = c.moveSpeed * (p.kind === 'grenade' ? 0.6 : 0.5);
          p.vel.x += dx / d * sp * dt * 14; p.vel.z += dz / d * sp * dt * 14; p.vel.y = Math.max(p.vel.y, 0.5 * Math.min(1, c.moveSpeed / 3));
          p.tvx += (dz / d) * sp * 4 * dt * 10 * (Math.random() - 0.2); p.tvz += (-dx / d) * sp * 4 * dt * 10 * (Math.random() - 0.2); p.sleep = false; p.still = 0;
        }
      }
      if (p.sleep) { p.pos.y = T.h(p.pos.x, p.pos.z) + p.rest; this._tilt(p, dt); this._orient(p); continue; }
      p.vel.y -= 9.8 * dt;
      p.pos.addScaledVector(p.vel, dt);
      const gy = T.h(p.pos.x, p.pos.z) + p.rest; let grounded = false;
      if (p.pos.y < gy) {
        p.pos.y = gy; grounded = true;
        const n = T.normalAt(p.pos.x, p.pos.z, _v);
        if (p.vel.y < -1.0) { if (this.audio && p.kind !== 'mag_empty') this.audio.mech('clink', p.pos, p.kind === 'grenade' ? 1.1 : 0.7, p.kind === 'grenade' ? 0.7 : 1); p.vel.y *= -p.bounce; p.vel.x *= p.fric + 0.2; p.vel.z *= p.fric + 0.2; p.tvx += rand(-3, 3); p.tvz += rand(-3, 3); p.yaw += rand(-1, 1); if (this.audio === undefined) 0; }
        else {
          p.vel.y = 0;
          // rolling friction + downhill slope; grenades roll noticeably, others slide to a stop
          const roll = p.kind === 'grenade' ? 0.6 : 5.5;
          p.vel.x *= Math.max(0, 1 - dt * roll); p.vel.z *= Math.max(0, 1 - dt * roll);
          const slope = p.kind === 'grenade' ? 6 : 2.5; p.vel.x += n.x * slope * dt; p.vel.z += n.z * slope * dt;
        }
        p.yaw += p.vel.length() * dt * (p.kind === 'grenade' ? 0 : 0.6) * Math.sign(p.spin);
      }
      if (p.kind === 'grenade') { p.mesh.rotation.x += (p.vel.z * 3) * dt; p.mesh.rotation.z -= (p.vel.x * 3) * dt; p.mesh.position.copy(p.pos); }
      else { this._tilt(p, dt); this._orient(p); }
      const sp2 = p.vel.x * p.vel.x + p.vel.z * p.vel.z;
      if (grounded && sp2 < 0.01 && Math.abs(p.vel.y) < 0.2) { p.still += dt; if (p.still > 0.4 && p.kind !== 'grenade') p.sleep = true; } else p.still = 0;
    }
  }
  _tilt(p, dt) { // springy wobble back to flat
    p.tvx += (-p.tx * 90 - p.tvx * 7) * dt; p.tvz += (-p.tz * 90 - p.tvz * 7) * dt; p.tx += p.tvx * dt; p.tz += p.tvz * dt;
    p.tx = clamp(p.tx, -0.9, 0.9); p.tz = clamp(p.tz, -0.9, 0.9);
  }

  update(dt, chars, cam, trees, renderH) {
    this.time += dt;
    // particle update
    const N = this.N;
    for (let i = 0; i < N; i++) {
      if (this.pl[i] <= 0) { if (this.ps[i] !== 0) { this.ps[i] = 0; } continue; }
      this.pl[i] -= dt; const f = this.pl[i] / this.pml[i];
      const i3 = i * 3, dr = Math.max(0, 1 - this.pd[i] * dt);
      this.pv[i3] *= dr; this.pv[i3 + 1] = this.pv[i3 + 1] * dr - this.pg[i] * dt; this.pv[i3 + 2] *= dr;
      this.pp[i3] += this.pv[i3] * dt; this.pp[i3 + 1] += this.pv[i3 + 1] * dt; this.pp[i3 + 2] += this.pv[i3 + 2] * dt;
      if (this.pg[i] > 4) { const gy = T.h(this.pp[i3], this.pp[i3 + 2]); if (this.pp[i3 + 1] < gy) { this.pp[i3 + 1] = gy; this.pv[i3 + 1] = 0; this.pv[i3] *= 0.5; this.pv[i3 + 2] *= 0.5; } }
      this.ps[i] = this.ps0[i] * (1 + (1 - f) * this.pgrow[i]); this.pc[i * 4 + 3] = this.pa0[i] * Math.min(1, f * 2.2) * (this.pa[i] > 0.5 ? f : 1);
    }
    const g = this.points.geometry; g.attributes.position.needsUpdate = g.attributes.aColor.needsUpdate = g.attributes.aSize.needsUpdate = g.attributes.aAdd.needsUpdate = true;
    this.pU.uScale.value = renderH / (2 * Math.tan(cam.fov * Math.PI / 360));
    // tracers
    for (const t of this.tracers) {
      if (t.life <= 0) continue; t.life -= dt; if (t.life <= 0) { t.m.visible = false; continue; }
      const total = t.a.distanceTo(t.b) || 1, u = 1 - t.life / t.max, head = u * total * 1.0, len = Math.min(10, total * 0.4), tail = Math.max(0, head - len);
      _v.subVectors(t.b, t.a).normalize(); t.m.position.copy(t.a).addScaledVector(_v, (head + tail) / 2); t.m.scale.set(1, 1, Math.max(0.1, head - tail)); t.m.lookAt(_s.copy(t.m.position).add(_v));
    }
    this.casings.update(dt, chars, this.audio); this.shells.update(dt, chars, this.audio); this.loose.update(dt, chars, null); this.pebbles.update(dt, chars, null);
    this.updateLeaves(dt, chars, trees, cam.position);
  }
}
