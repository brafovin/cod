import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { ctx } from './ctx.js';
import * as T from './terrain.js';
import { clamp, rand, randi, pick, chance, smooth, lerp, windU, mulberry32 } from './util.js';
import * as TX from './textures.js';

const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _s = new THREE.Vector3(), _p = new THREE.Vector3(), _e = new THREE.Euler();

export const BUILD_SPOTS = [{ x: -95, z: 8 }, { x: 80, z: -12 }];

function windPatch(mat, amount = 1, trunk = false) {
  mat.onBeforeCompile = (sh) => {
    sh.uniforms.uTime = windU.uTime; sh.uniforms.uWind = windU.uWind; sh.uniforms.uWindDir = windU.uWindDir;
    sh.vertexShader = 'uniform float uTime; uniform float uWind; uniform vec2 uWindDir;\n' + sh.vertexShader.replace('#include <begin_vertex>', `#include <begin_vertex>
      float hh = clamp(position.y * 0.1, 0.0, 1.0); hh *= hh;
      float sw = sin(uTime*1.6 + position.x*0.7 + position.z*0.9) * 0.55 + sin(uTime*3.3 + position.y*1.9 + position.x) * ${trunk ? '0.0' : '0.35'};
      float amt = (0.03 + 0.13 * uWind) * hh * ${amount.toFixed(2)};
      transformed.x += uWindDir.x * sw * amt * 2.0; transformed.z += uWindDir.y * sw * amt * 2.0; transformed.y += sw * 0.01 * uWind * ${trunk ? '0.0' : '1.0'};`);
  };
  mat.customProgramCacheKey = () => 'wind' + amount + trunk;
}

function texBox(w, h, d, uvs = 0.5) {
  const g = new THREE.BoxGeometry(w, h, d), uv = g.attributes.uv, dims = [[d, h], [d, h], [w, d], [w, d], [w, h], [w, h]];
  for (let f = 0; f < 6; f++) for (let i = 0; i < 4; i++) { const k = f * 4 + i; uv.setXY(k, uv.getX(k) * dims[f][0] * uvs, uv.getY(k) * dims[f][1] * uvs); }
  return g;
}

// ------------------------------------------------------------------ tree variants
function makeTreeVariant(seed, kind) {
  const r = mulberry32(seed), R = (a, b) => a + r() * (b - a);
  const H = kind === 'broken' ? R(5, 7) : R(7.5, 11.5), r0 = R(0.26, 0.38);
  const pts = []; const bend = R(0.3, 1.1), ang = r() * 6.28;
  for (let i = 0; i <= 6; i++) { const t = i / 6; pts.push(new THREE.Vector3(Math.cos(ang) * bend * t * t * 0.6 + (r() - 0.5) * 0.15, t * H, Math.sin(ang) * bend * t * t * 0.6 + (r() - 0.5) * 0.15)); }
  const curve = new THREE.CatmullRomCurve3(pts);
  const SEG = 18, RAD = 9;
  const tube = (c, rad, seg, rs, taper) => {
    const g = new THREE.TubeGeometry(c, seg, rad, rs, false), p = g.attributes.position, uv = g.attributes.uv;
    for (let i = 0; i < p.count; i++) {
      const ring = Math.floor(i / (rs + 1)), j = i % (rs + 1), t = ring / seg, cp = c.getPointAt(t);
      const k = taper(t) * (0.92 + 0.16 * Math.sin(ring * 2.3 + j * 1.7 + seed));
      p.setXYZ(i, cp.x + (p.getX(i) - cp.x) * k, cp.y + (p.getY(i) - cp.y) * k, cp.z + (p.getZ(i) - cp.z) * k);
      uv.setXY(i, j / rs * 2, t * c.getLength() / 1.4);
    }
    g.computeVertexNormals(); return g;
  };
  const parts = [tube(curve, r0, SEG, RAD, (t) => (1 - 0.82 * t) * (1 + 0.7 * Math.exp(-t * 16)))];
  const leafCenters = [];
  const nBr = kind === 'dead' ? 8 : 6;
  for (let b = 0; b < nBr; b++) {
    const t = R(0.38, 0.92), base = curve.getPointAt(t), a = r() * 6.28, len = R(1.2, 2.6) * (1.1 - t * 0.5), up = R(0.2, 0.9);
    const end = new THREE.Vector3(base.x + Math.cos(a) * len, base.y + len * up + R(0, 0.5), base.z + Math.sin(a) * len);
    const mid = base.clone().lerp(end, 0.5); mid.y += R(0, 0.3);
    const c = new THREE.CatmullRomCurve3([base, mid, end]);
    parts.push(tube(c, r0 * (0.32 - t * 0.2), 6, 5, (u) => 1 - 0.75 * u));
    if (r() < 0.8) { const a2 = a + R(0.6, 1.2), e2 = end.clone().add(new THREE.Vector3(Math.cos(a2) * 0.9, R(0.2, 0.7), Math.sin(a2) * 0.9)); parts.push(tube(new THREE.CatmullRomCurve3([end.clone().lerp(base, 0.2), e2]), 0.035, 3, 4, (u) => 1 - 0.8 * u)); leafCenters.push(e2); }
    leafCenters.push(end);
  }
  const top = curve.getPointAt(1);
  if (kind === 'broken') { const cone = new THREE.ConeGeometry(r0 * 0.2, 0.9, 5); const p = cone.attributes.position; for (let i = 0; i < p.count; i++) p.setXYZ(i, p.getX(i) * (0.7 + r() * 0.6), p.getY(i), p.getZ(i) * (0.7 + r() * 0.6)); cone.translate(top.x, top.y + 0.3, top.z); parts.push(cone); }
  else leafCenters.push(top.clone().add(new THREE.Vector3(0, 0.8, 0)));
  const trunk = mergeGeometries(parts.map((g) => { g.deleteAttribute('uv1'); return g; }));
  // leaf cards
  let leaf = null;
  if (kind === 'leafy' || kind === 'sparse') {
    const cards = [], per = kind === 'leafy' ? 20 : 8, keep = kind === 'leafy' ? 1 : 0.55;
    for (const c of leafCenters) {
      if (r() > keep) continue;
      for (let i = 0; i < per; i++) {
        const g = new THREE.PlaneGeometry(R(0.7, 1.15), R(0.7, 1.15));
        _e.set(R(-1.4, 1.4), r() * 6.28, R(-0.8, 0.8)); _q.setFromEuler(_e);
        _p.set(R(-1, 1), R(-0.7, 0.7), R(-1, 1)).multiplyScalar(R(0.5, 1.3)).add(c);
        g.applyMatrix4(_m.compose(_p, _q, _s.set(1, 1, 1)));
        const n = g.attributes.position.count, col = new Float32Array(n * 3), tint = R(0.65, 1.15), warm = r() < 0.25 ? 0.8 : 1;
        for (let k = 0; k < n; k++) { col[k * 3] = tint * (r() < 0.3 ? 1.1 : 1); col[k * 3 + 1] = tint * warm; col[k * 3 + 2] = tint * 0.85; }
        g.setAttribute('color', new THREE.BufferAttribute(col, 3)); g.deleteAttribute('uv1'); cards.push(g);
      }
    }
    leaf = cards.length ? mergeGeometries(cards) : null;
  }
  return { trunk, leaf, H, r0, kind };
}

// ------------------------------------------------------------------ world builder
export function buildWorld(scene, fx, quality = 'high') {
  const W = { colliders: [], glass: [], trees: [], standingBoxes: [], emitters: [], statics: [], falling: [], quality };
  ctx.world = W;
  const rng = mulberry32(777), R = (a, b) => a + rng() * (b - a);
  const barkT = TX.barkTex(), woodT = TX.woodTex(), concT = TX.concreteTex(), brickT = TX.brickTex(), sandT = TX.sandbagTex(), crateT = TX.crateTex();

  // ---------- terrain
  T.buildTerrainData();
  const terrain = T.buildTerrainMesh(); scene.add(terrain); scene.add(terrain.userData.far);
  W.terrain = terrain;

  const addBox = (minx, miny, minz, maxx, maxy, maxz, mat) => { const b = { minx, miny, minz, maxx, maxy, maxz, mat }; W.colliders.push(b); return b; };
  const randSpot = (opts = {}) => {
    for (let i = 0; i < 300; i++) {
      const x = R(-T.PLAY + 8, T.PLAY - 8), z = R(-T.PLAY + 8, T.PLAY - 8);
      if (opts.minTd !== undefined && T.trenchDist(x, z) < opts.minTd) continue;
      if (opts.maxTd !== undefined && T.trenchDist(x, z) > opts.maxTd) continue;
      if (opts.zAbs && (Math.abs(z) < opts.zAbs[0] || Math.abs(z) > opts.zAbs[1])) continue;
      if (BUILD_SPOTS.some((b) => Math.hypot(x - b.x, z - b.z) < 16)) continue;
      if (Math.abs(z) > 122 && !opts.spawnOk) continue;
      return { x, z };
    }
    return { x: 0, z: 0 };
  };
  W.randSpot = randSpot;

  // ---------- trees
  const variants = [makeTreeVariant(11, 'leafy'), makeTreeVariant(23, 'leafy'), makeTreeVariant(37, 'sparse'), makeTreeVariant(41, 'dead'), makeTreeVariant(53, 'broken'), makeTreeVariant(67, 'leafy')];
  const trunkMat = new THREE.MeshStandardMaterial({ map: barkT, roughness: 0.96, color: 0xcfc2b0 }); windPatch(trunkMat, 0.6, true);
  const leafMat = new THREE.MeshStandardMaterial({ map: TX.leafTex(), vertexColors: true, alphaTest: 0.45, side: THREE.DoubleSide, roughness: 0.85 }); windPatch(leafMat, 1.0, false);
  const nTrees = quality === 'low' ? 90 : 150;
  const treeSpots = [];
  for (let i = 0; i < nTrees * 4 && W.trees.length < nTrees; i++) {
    // prefer groves along the trench lines and field edges
    let x, z;
    if (chance(0.6)) { const tr = pick(T.trenches), k = Math.floor(rng() * (tr.pts.length - 1)), a = tr.pts[k], b = tr.pts[k + 1], u = rng(); const dx = b.x - a.x, dz = b.z - a.z, l = Math.hypot(dx, dz); const off = (rng() < 0.5 ? -1 : 1) * R(4.5, 11); x = a.x + dx * u - dz / l * off; z = a.z + dz * u + dx / l * off; }
    else { x = R(-T.PLAY + 6, T.PLAY - 6); z = R(-T.PLAY + 6, T.PLAY - 6); }
    if (Math.abs(x) > T.PLAY - 5 || Math.abs(z) > T.PLAY - 5) continue;
    if (T.trenchDist(x, z) < 4.2 || T.craterAt(x, z) > 0.2) continue;
    if (Math.abs(z) > 126) continue;
    if (BUILD_SPOTS.some((b) => Math.hypot(x - b.x, z - b.z) < 17)) continue;
    if (treeSpots.some((p) => Math.hypot(p.x - x, p.z - z) < 4.5)) continue;
    treeSpots.push({ x, z });
    const kinds = [0, 0, 1, 1, 5, 5, 2, 2, 3, 4], vi = pick(kinds), v = variants[vi], sc = R(0.85, 1.3);
    const grp = new THREE.Group(); grp.position.set(x, T.h(x, z) - 0.1, z); grp.rotation.y = rng() * 6.28; grp.scale.setScalar(sc);
    const tm = new THREE.Mesh(v.trunk, trunkMat); tm.castShadow = true; tm.receiveShadow = true; grp.add(tm);
    let lm = null; if (v.leaf) { lm = new THREE.Mesh(v.leaf, leafMat); lm.castShadow = true; grp.add(lm); }
    scene.add(grp);
    const tree = { x, z, r: v.r0 * sc * 1.05, h: v.H * sc, alive: true, falling: false, group: grp, leafy: !!v.leaf && v.kind === 'leafy', fallT: 0, kind: v.kind };
    W.trees.push(tree);
    // pre-existing bullet damage on the trunks
    const nh = 2 + Math.floor(rng() * 6);
    for (let k = 0; k < nh; k++) { const a = rng() * 6.28, y = R(0.4, 2.6); const nx = Math.cos(a), nz = Math.sin(a); fx.decal(new THREE.Vector3(x + nx * tree.r * 0.97, T.h(x, z) + y, z + nz * tree.r * 0.97), new THREE.Vector3(nx, 0, nz), R(0.05, 0.1), 'hole', [0.55, 0.5, 0.45]); }
    for (let k = 0; k < 7; k++) fx.scatterLeaf(x + R(-5, 5), z + R(-5, 5));
  }
  W.fellTree = (t, dir) => { if (t.falling || !t.alive) return; t.falling = true; t.fallT = 0; t.dir = dir.clone(); t.crashed = false; W.falling.push(t); ctx.audio.treeCrash(new THREE.Vector3(t.x, T.h(t.x, t.z), t.z)); fx.leafBurst(new THREE.Vector3(t.x, T.h(t.x, t.z) + t.h * 0.7, t.z), 30); };
  const stumpMat = trunkMat;

  // ---------- grass (chunked, distance culled, wind + body reactive)
  {
    const bg = new THREE.BufferGeometry(); const w = 0.045;
    bg.setAttribute('position', new THREE.BufferAttribute(new Float32Array([-w, 0, 0, w, 0, 0, -w * 0.7, 0.5, 0, w * 0.7, 0.5, 0, 0.004, 1, 0]), 3));
    bg.setIndex([0, 1, 2, 1, 3, 2, 2, 3, 4]); bg.computeVertexNormals();
    const gm = new THREE.MeshStandardMaterial({ side: THREE.DoubleSide, roughness: 0.9, color: 0xffffff });
    gm.onBeforeCompile = (sh) => {
      sh.uniforms.uTime = windU.uTime; sh.uniforms.uWind = windU.uWind; sh.uniforms.uWindDir = windU.uWindDir; sh.uniforms.uChars = windU.uChars;
      sh.vertexShader = 'uniform float uTime; uniform float uWind; uniform vec2 uWindDir; uniform vec3 uChars[10];\n' + sh.vertexShader
        .replace('#include <begin_vertex>', `#include <begin_vertex>
          float gh = position.y; vec4 wp = instanceMatrix * vec4(position, 1.0);
          float sw = sin(uTime*2.1 + wp.x*0.55 + wp.z*0.4) + 0.5*sin(uTime*4.7 + wp.x*1.3 + wp.z*0.9);
          float bend = (0.05 + 0.2*uWind) * gh * gh * sw;
          transformed.x += uWindDir.x * bend; transformed.z += uWindDir.y * bend;
          for (int i = 0; i < 10; i++) { vec2 d = wp.xz - uChars[i].xz; float dist = length(d); float push = smoothstep(1.2, 0.1, dist) * step(abs(wp.y - uChars[i].y), 1.5); transformed.xz += normalize(d + 1e-4) * push * gh * 0.8; transformed.y -= push * gh * 0.5; }`)
        .replace('#include <color_vertex>', `#include <color_vertex>\n vColor.rgb *= mix(0.4, 1.0, position.y);`);
    };
    const CH = 25, perChunk = quality === 'low' ? 500 : quality === 'medium' ? 900 : 1500;
    W.grassChunks = [];
    const col = new THREE.Color();
    for (let cx = -T.PLAY; cx < T.PLAY; cx += CH) for (let cz = -T.PLAY; cz < T.PLAY; cz += CH) {
      const mats = [];
      for (let i = 0; i < perChunk; i++) {
        const x = cx + rng() * CH, z = cz + rng() * CH, g = T.grassAt(x, z);
        if (g < 0.2 || rng() > g) continue; if (BUILD_SPOTS.some((b) => Math.abs(x - b.x) < 9 && Math.abs(z - b.z) < 7)) continue;
        const sc = R(0.35, 0.95) * (0.7 + g * 0.6) * (chance(0.06) ? 1.7 : 1);
        _m.compose(_p.set(x, T.h(x, z) - 0.02, z), _q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), rng() * 6.28), _s.set(1.3, sc, 1)); mats.push(_m.clone());
      }
      if (!mats.length) continue;
      const im = new THREE.InstancedMesh(bg, gm, mats.length);
      mats.forEach((m, i) => { im.setMatrixAt(i, m); col.setHSL(R(0.15, 0.26), R(0.3, 0.55), R(0.17, 0.36)); if (chance(0.25)) col.setHSL(R(0.1, 0.14), 0.4, R(0.28, 0.4)); im.setColorAt(i, col); });
      im.castShadow = false; im.receiveShadow = false; im.computeBoundingSphere(); im.frustumCulled = true; im.userData.c = new THREE.Vector3(cx + CH / 2, 0, cz + CH / 2);
      scene.add(im); W.grassChunks.push(im);
    }
  }

  // ---------- rocks / stones (static, cracked)
  {
    const rt = TX.rockTex(), rm = new THREE.MeshStandardMaterial({ map: rt, roughness: 0.93 });
    const geos = [0, 1, 2].map((k) => { const g = new THREE.IcosahedronGeometry(1, 2), p = g.attributes.position; const r = mulberry32(k * 31 + 5); for (let i = 0; i < p.count; i++) { const v = new THREE.Vector3().fromBufferAttribute(p, i); const n = 0.78 + 0.35 * Math.abs(Math.sin(v.x * 3.1 + k) * Math.cos(v.y * 2.7 + v.z * 2.3)) + r() * 0.04; v.multiplyScalar(n); v.y *= 0.65; p.setXYZ(i, v.x, v.y, v.z); } g.computeVertexNormals(); const uv = g.attributes.uv; for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * 2, uv.getY(i) * 2); return g; });
    const lists = [[], [], []];
    const nBig = 70, nSmall = quality === 'low' ? 120 : 260;
    for (let i = 0; i < nBig + nSmall; i++) {
      const big = i < nBig, sp = randSpot({ minTd: 3.0 }), s = big ? R(0.35, 0.95) : R(0.07, 0.2), k = Math.floor(rng() * 3);
      _m.compose(_p.set(sp.x, T.h(sp.x, sp.z) + s * 0.25, sp.z), _q.setFromEuler(_e.set(R(-0.3, 0.3), R(0, 6.28), R(-0.3, 0.3))), _s.set(s * R(0.9, 1.4), s, s * R(0.9, 1.4))); lists[k].push(_m.clone());
      if (big && s > 0.55) addBox(sp.x - s * 0.8, T.h(sp.x, sp.z) - 0.3, sp.z - s * 0.8, sp.x + s * 0.8, T.h(sp.x, sp.z) + s * 0.85, sp.z + s * 0.8, 'concrete');
    }
    lists.forEach((l, k) => { const im = new THREE.InstancedMesh(geos[k], rm, l.length); l.forEach((m, i) => im.setMatrixAt(i, m)); im.castShadow = true; im.receiveShadow = true; scene.add(im); });
    // dynamic loose pebbles that react to feet
    for (let i = 0; i < 380; i++) { const sp = randSpot({ minTd: 0.5 }); const s = R(0.03, 0.07); fx.pebbles.add(sp.x, T.h(sp.x, sp.z) + s * 0.4, sp.z, 0, 0, 0, s / 0.03 * 0.6, true); }
  }

  // ---------- trench furnishing
  {
    const panelG = texBox(1.15, 1.1, 0.07, 0.8), postG = new THREE.BoxGeometry(0.1, 1.5, 0.1);
    const wmat = new THREE.MeshStandardMaterial({ map: woodT, roughness: 0.9 });
    const panels = [], posts = [], bags = [], boards = [];
    const bagG = new THREE.BoxGeometry(0.5, 0.19, 0.3, 3, 2, 3); { const p = bagG.attributes.position; for (let i = 0; i < p.count; i++) { const x = p.getX(i), y = p.getY(i), z = p.getZ(i); const k = 1 - 0.18 * (Math.abs(x) / 0.25) * (Math.abs(z) / 0.15); p.setXYZ(i, x, y * (0.8 + 0.4 * (1 - Math.abs(x) / 0.28) * (1 - Math.abs(z) / 0.17)), z * k); } bagG.computeVertexNormals(); }
    const bagM = new THREE.MeshStandardMaterial({ map: sandT, roughness: 1 });
    const boardG = new THREE.BoxGeometry(1.7, 0.05, 1.5);
    for (const tr of T.trenches) {
      for (let k = 0; k < tr.pts.length - 1; k++) {
        const a = tr.pts[k], b = tr.pts[k + 1], dx = b.x - a.x, dz = b.z - a.z, L = Math.hypot(dx, dz), tx = dx / L, tz = dz / L, nx = -tz, nz = tx, yaw = Math.atan2(-tz, tx) * 1 + 0;
        for (let u = 0.6; u < L - 0.4; u += 1.2) {
          const s = tr.cum[k] + u, ramp = (tr.rampStart ? smooth(0, tr.ramp, s) : 1) * (tr.rampEnd ? smooth(0, tr.ramp, tr.total - s) : 1);
          const cx = a.x + tx * u, cz = a.z + tz * u, floor = T.h(cx, cz);
          if (ramp > 0.85) {
            for (const side of [-1, 1]) {
              if (Math.floor(s / 7 + (side > 0 ? 3.3 : 0) + tr.total) % 3 === 0) continue;
              const px = cx + nx * side * (T.TRENCH_HW + 0.08), pz = cz + nz * side * (T.TRENCH_HW + 0.08);
              _m.compose(_p.set(px, floor + 0.55, pz), _q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), yaw), _s.set(1, 1, 1)); panels.push(_m.clone());
              if (Math.floor(u / 1.2) % 2 === 0) { _m.compose(_p.set(px - nx * side * 0.06, floor + 0.65, pz - nz * side * 0.06), _q, _s.set(1, 1, 1)); posts.push(_m.clone()); }
            }
            if (rng() < 0.12) { _m.compose(_p.set(cx, floor + 0.03, cz), _q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), yaw), _s.set(1, 1, 1)); boards.push(_m.clone()); }
            // sandbag parapet clusters at the top edge (front side)
            if (rng() < 0.11) {
              const side = rng() < 0.5 ? -1 : 1, d = T.TRENCH_HW + 1.55 + R(0, 0.5), bx = cx + nx * side * d, bz = cz + nz * side * d, base = T.h(bx, bz);
              let minx = 1e9, maxx = -1e9, minz = 1e9, maxz = -1e9;
              const rows = [[-0.52, 0], [0, 0], [0.52, 0], [-0.26, 1], [0.26, 1], [0, 2]];
              for (const [ox, row] of rows) {
                const wx = bx + tx * ox, wz = bz + tz * ox, wy = base + 0.09 + row * 0.18;
                _m.compose(_p.set(wx, wy, wz), _q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), yaw + R(-0.08, 0.08)), _s.set(1, 1, 1)); bags.push(_m.clone());
                minx = Math.min(minx, wx - 0.3); maxx = Math.max(maxx, wx + 0.3); minz = Math.min(minz, wz - 0.3); maxz = Math.max(maxz, wz + 0.3);
              }
              addBox(minx, base - 0.1, minz, maxx, base + 0.55, maxz, 'sand');
            }
            // loose rounds & casings along the ledge
            if (rng() < 0.3) { const o = (rng() < 0.5 ? -1 : 1) * R(1.7, 2.6), lx = cx + nx * o, lz = cz + nz * o; for (let q = 0; q < randi(2, 5); q++) fx.loose.add(lx + R(-0.3, 0.3), T.h(lx, lz) + 0.01, lz + R(-0.3, 0.3), 0, 0, 0, 1, true); }
          }
        }
      }
    }
    const mk = (geo, mat, list, shadow = true) => { if (!list.length) return; const im = new THREE.InstancedMesh(geo, mat, list.length); list.forEach((m, i) => im.setMatrixAt(i, m)); im.castShadow = shadow; im.receiveShadow = true; scene.add(im); };
    mk(panelG, wmat, panels); mk(postG, wmat, posts); mk(bagG, bagM, bags); mk(boardG, wmat, boards, false);
  }

  // ---------- props: crates, barrels, hedgehogs, barbed wire, wrecks
  {
    const crateG = texBox(0.9, 0.9, 0.9, 0.8), cm = new THREE.MeshStandardMaterial({ map: woodT, roughness: 0.9 });
    const ammoG = texBox(0.8, 0.5, 0.5, 1), am = new THREE.MeshStandardMaterial({ map: crateT, roughness: 0.7 });
    const barrelG = new THREE.CylinderGeometry(0.3, 0.3, 0.9, 14), bm = new THREE.MeshStandardMaterial({ map: TX.metalTex('#4a4a3c'), roughness: 0.55, metalness: 0.6 });
    const hedgeG = (() => { const parts = []; for (let i = 0; i < 3; i++) { const g = new THREE.BoxGeometry(0.1, 0.1, 1.9); g.rotateY(0); const m = new THREE.Matrix4().makeRotationFromEuler(new THREE.Euler(i === 0 ? 0.8 : i === 1 ? -0.8 : 0, i === 2 ? 0 : 0, i === 2 ? 0.8 : 0)); if (i === 2) m.makeRotationFromEuler(new THREE.Euler(0, Math.PI / 2, 0.8)); g.applyMatrix4(m); parts.push(g); } return mergeGeometries(parts.map((g) => { g.deleteAttribute('uv'); return g; })); })();
    const hm = new THREE.MeshStandardMaterial({ color: 0x4a443a, roughness: 0.6, metalness: 0.7 });
    const L = { crate: [], ammo: [], barrel: [], hedge: [] };
    const place = (list, key, sx, sy, sz, mat, hx, hy, hz) => { const sp = randSpot({ minTd: 3.5 }); const y = T.h(sp.x, sp.z), yaw = rng() * 6.28; _m.compose(_p.set(sp.x, y + hy / 2 - 0.03, sp.z), _q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), yaw), _s.set(1, 1, 1)); list[key].push(_m.clone()); const r = Math.max(hx, hz) * 0.75; addBox(sp.x - r, y - 0.1, sp.z - r, sp.x + r, y + hy, sp.z + r, mat); return sp; };
    for (let i = 0; i < 26; i++) place(L, 'crate', 0, 0, 0, 'wood', 0.9, 0.9, 0.9);
    for (let i = 0; i < 12; i++) place(L, 'ammo', 0, 0, 0, 'wood', 0.8, 0.5, 0.5);
    for (let i = 0; i < 22; i++) place(L, 'barrel', 0, 0, 0, 'metal', 0.6, 0.9, 0.6);
    for (let i = 0; i < 20; i++) { const sp = randSpot({ minTd: 3, zAbs: [8, 60] }), y = T.h(sp.x, sp.z); _m.compose(_p.set(sp.x, y + 0.5, sp.z), _q.setFromEuler(_e.set(0, rng() * 6.28, 0)), _s.set(1, 1, 1)); L.hedge.push(_m.clone()); addBox(sp.x - 0.6, y, sp.z - 0.6, sp.x + 0.6, y + 1.0, sp.z + 0.6, 'metal'); }
    const mk = (geo, mat, list) => { const im = new THREE.InstancedMesh(geo, mat, Math.max(1, list.length)); list.forEach((m, i) => im.setMatrixAt(i, m)); im.count = list.length; im.castShadow = true; im.receiveShadow = true; scene.add(im); };
    mk(crateG, cm, L.crate); mk(ammoG, am, L.ammo); mk(barrelG, bm, L.barrel); mk(hedgeG, hm, L.hedge);
    // barbed wire belts in no man's land
    const wireTex = (() => { const c = document.createElement('canvas'); c.width = 256; c.height = 64; const g = c.getContext('2d'); g.strokeStyle = '#2a2a2a'; g.lineWidth = 1.6; for (let i = 0; i < 4; i++) { g.beginPath(); for (let x = 0; x <= 256; x += 4) { const y = 8 + i * 15 + Math.sin(x * 0.2 + i * 2) * 3; x ? g.lineTo(x, y) : g.moveTo(x, y); } g.stroke(); } g.lineWidth = 1.2; for (let i = 0; i < 70; i++) { const x = Math.random() * 256, y = 6 + Math.random() * 52, a = Math.random() * 6.28; g.beginPath(); g.moveTo(x - Math.cos(a) * 3, y - Math.sin(a) * 3); g.lineTo(x + Math.cos(a) * 3, y + Math.sin(a) * 3); g.stroke(); } const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.wrapS = THREE.RepeatWrapping; return t; })();
    const wireG = new THREE.PlaneGeometry(3, 0.9), wireM = new THREE.MeshStandardMaterial({ map: wireTex, alphaTest: 0.4, side: THREE.DoubleSide, roughness: 0.5, metalness: 0.8, transparent: false });
    const postG2 = new THREE.CylinderGeometry(0.03, 0.04, 1.3, 6), wires = [], wposts = [];
    for (const zLine of [-37, -33, 33, 37]) for (let x = -128; x < 128; x += 3) { if (rng() < 0.25) continue; const z = zLine + Math.sin(x * 0.2) * 1.5, y = T.h(x + 1.5, z); if (T.trenchDist(x + 1.5, z) < 3) continue; _m.compose(_p.set(x + 1.5, y + 0.5, z), _q.setFromEuler(_e.set(0, R(-0.15, 0.15), 0)), _s.set(1, 1, 1)); wires.push(_m.clone()); _m.compose(_p.set(x, y + 0.6, z), _q.identity(), _s.set(1, 1, 1)); wposts.push(_m.clone()); }
    mk(wireG, wireM, wires); mk(postG2, hm, wposts);
    // wrecked vehicles
    const rust = new THREE.MeshStandardMaterial({ map: TX.metalTex('#3b3a33'), roughness: 0.7, metalness: 0.5 }), tire = new THREE.MeshStandardMaterial({ color: 0x0b0b0b, roughness: 0.9 });
    for (const [wx, wz, wy] of [[10, -22, 0.4], [-48, 26, 2.2], [52, 38, 4.4]]) {
      const g = new THREE.Group(); const y = T.h(wx, wz);
      const body = new THREE.Mesh(new THREE.BoxGeometry(2.3, 1.0, 4.6), rust); body.position.y = 0.95; g.add(body);
      const cab = new THREE.Mesh(new THREE.BoxGeometry(2.1, 1.1, 1.7), rust); cab.position.set(0, 1.9, -1.4); g.add(cab);
      const bed = new THREE.Mesh(new THREE.BoxGeometry(2.2, 0.8, 2.4), rust); bed.position.set(0, 1.5, 1.0); bed.rotation.z = 0.1; g.add(bed);
      for (const [x, z] of [[-1.1, -1.5], [1.1, -1.5], [-1.1, 1.5], [1.1, 1.5]]) { if (chance(0.2)) continue; const w = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.5, 0.4, 12), tire); w.rotation.z = Math.PI / 2; w.position.set(x, 0.5, z); g.add(w); }
      g.position.set(wx, y - 0.1, wz); g.rotation.set(R(-0.06, 0.06), wy, R(-0.12, 0.12)); g.traverse((c) => { if (c.isMesh) { c.castShadow = true; c.receiveShadow = true; } }); scene.add(g);
      addBox(wx - 1.7, y - 0.2, wz - 1.7, wx + 1.7, y + 2.0, wz + 1.7, 'metal');
      W.emitters.push({ x: wx, y: y + 2.0, z: wz, t: 0 });
    }
  }

  // ---------- lost-place buildings
  const buildings = [];
  {
    const concM = new THREE.MeshStandardMaterial({ map: concT, roughness: 0.95 }), brickM = new THREE.MeshStandardMaterial({ map: brickT, roughness: 0.95 });
    const woodM = new THREE.MeshStandardMaterial({ map: woodT, roughness: 0.9 }), darkM = new THREE.MeshStandardMaterial({ color: 0x1b1a18, roughness: 1 });
    const glassBroken = new THREE.MeshStandardMaterial({ map: TX.glassTex(true), transparent: true, roughness: 0.05, metalness: 0.2, side: THREE.DoubleSide, depthWrite: false });
    const glassIntact = new THREE.MeshStandardMaterial({ map: TX.glassTex(false), transparent: true, roughness: 0.05, metalness: 0.2, side: THREE.DoubleSide, depthWrite: false, color: 0xcfe0e5 });
    const add = (mesh) => { mesh.castShadow = true; mesh.receiveShadow = true; scene.add(mesh); return mesh; };
    const piece = (mat, x0, y0, z0, x1, y1, z1, kind = 'concrete') => {
      const w = x1 - x0, h = y1 - y0, d = z1 - z0; if (w < 0.01 || h < 0.01 || d < 0.01) return;
      const m = add(new THREE.Mesh(texBox(w, h, d, 0.45), mat)); m.position.set((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2); addBox(x0, y0, z0, x1, y1, z1, kind);
    };
    // axis-aligned wall with damage ranges and openings. axis 'x': runs along x at fixed z.
    const wall = (axis, fixed, a0, a1, y0, h, th, mat, openings = [], damage = [], kind = 'concrete') => {
      const bps = new Set([a0, a1]); for (const o of openings) { bps.add(o.a); bps.add(o.a + o.w); } for (const d of damage) { bps.add(clamp(d.a, a0, a1)); bps.add(clamp(d.b, a0, a1)); }
      const xs = [...bps].sort((p, q) => p - q);
      for (let i = 0; i < xs.length - 1; i++) {
        const s = xs[i], e = xs[i + 1]; if (e - s < 0.01) continue; const mid = (s + e) / 2;
        let top = h; for (const d of damage) if (mid >= d.a && mid <= d.b) top = Math.min(top, d.h);
        const op = openings.find((o) => mid >= o.a && mid <= o.a + o.w);
        const P = (ya, yb) => { if (yb - ya < 0.02) return; if (axis === 'x') piece(mat, s, y0 + ya, fixed - th / 2, e, y0 + yb, fixed + th / 2, kind); else piece(mat, fixed - th / 2, y0 + ya, s, fixed + th / 2, y0 + yb, e, kind); };
        if (op) { P(0, op.sill); if (top > op.top) P(op.top, top); } else P(0, top);
      }
      for (const o of openings) if (o.glass) {
        const broken = chance(o.brokenChance ?? 0.35), cx = o.a + o.w / 2, cy = y0 + (o.sill + o.top) / 2, gh = o.top - o.sill;
        const gm = new THREE.Mesh(new THREE.PlaneGeometry(o.w - 0.1, gh - 0.1), chance(0.6) ? glassBroken : glassIntact);
        const b = axis === 'x' ? { minx: o.a, maxx: o.a + o.w, miny: cy - gh / 2, maxy: cy + gh / 2, minz: fixed - 0.04, maxz: fixed + 0.04 } : { minx: fixed - 0.04, maxx: fixed + 0.04, miny: cy - gh / 2, maxy: cy + gh / 2, minz: o.a, maxz: o.a + o.w };
        if (axis === 'x') gm.position.set(cx, cy, fixed); else { gm.position.set(fixed, cy, cx); gm.rotation.y = Math.PI / 2; }
        b.mesh = gm; b.broken = false; scene.add(gm); W.glass.push(b);
        if (broken) { b.broken = true; gm.visible = false; } // already smashed — only the frame remains
        // frame
        const fw = 0.07, f = (x0_, y0_, z0_, x1_, y1_, z1_) => { const m = add(new THREE.Mesh(new THREE.BoxGeometry(Math.max(0.02, x1_ - x0_), Math.max(0.02, y1_ - y0_), Math.max(0.02, z1_ - z0_)), woodM)); m.position.set((x0_ + x1_) / 2, (y0_ + y1_) / 2, (z0_ + z1_) / 2); };
        if (axis === 'x') { f(o.a, cy - gh / 2, fixed - 0.06, o.a + o.w, cy - gh / 2 + fw, fixed + 0.06); f(o.a, cy + gh / 2 - fw, fixed - 0.06, o.a + o.w, cy + gh / 2, fixed + 0.06); f(o.a, cy - gh / 2, fixed - 0.06, o.a + fw, cy + gh / 2, fixed + 0.06); f(o.a + o.w - fw, cy - gh / 2, fixed - 0.06, o.a + o.w, cy + gh / 2, fixed + 0.06); }
        else { f(fixed - 0.06, cy - gh / 2, o.a, fixed + 0.06, cy - gh / 2 + fw, o.a + o.w); f(fixed - 0.06, cy + gh / 2 - fw, o.a, fixed + 0.06, cy + gh / 2, o.a + o.w); f(fixed - 0.06, cy - gh / 2, o.a, fixed + 0.06, cy + gh / 2, o.a + fw); f(fixed - 0.06, cy - gh / 2, o.a + o.w - fw, fixed + 0.06, cy + gh / 2, o.a + o.w); }
      }
    };
    const graffiti = (x, y, z, ry, w, h, seed) => { const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshStandardMaterial({ map: TX.graffitiTex(seed), transparent: true, roughness: 0.9, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 })); m.position.set(x, y, z); m.rotation.y = ry; scene.add(m); };
    const slab = (mat, x0, z0, x1, z1, y, th = 0.3, tilt = null, kind = 'concrete') => { const m = add(new THREE.Mesh(texBox(x1 - x0, th, z1 - z0, 0.4), mat)); m.position.set((x0 + x1) / 2, y, (z0 + z1) / 2); if (tilt) { m.rotation.set(tilt[0], 0, tilt[1]); } else addBox(x0, y - th / 2, z0, x1, y + th / 2, z1, kind); return m; };
    const rubble = (cx, cz, n, spread, y) => { for (let i = 0; i < n; i++) { const s = R(0.2, 0.7), m = add(new THREE.Mesh(new THREE.BoxGeometry(s, s * R(0.4, 0.8), s * R(0.6, 1.2)), pick([concM, brickM]))); const x = cx + R(-spread, spread), z = cz + R(-spread, spread); m.position.set(x, y + s * 0.25, z); m.rotation.set(R(-0.5, 0.5), R(0, 3), R(-0.5, 0.5)); } };
    const crate = (x, z, y, s = 0.9) => { const m = add(new THREE.Mesh(texBox(s, s, s, 0.8), new THREE.MeshStandardMaterial({ map: woodT, roughness: 0.9 }))); m.position.set(x, y + s / 2, z); m.rotation.y = R(0, 1); addBox(x - s * 0.6, y, z - s * 0.6, x + s * 0.6, y + s, z + s * 0.6, 'wood'); };

    // ===== Building A: factory hall, concrete, long, half collapsed west wall
    {
      const b = BUILD_SPOTS[0], x0 = b.x - 7, x1 = b.x + 7, z0 = b.z - 5, z1 = b.z + 5, gy = T.h(b.x, b.z), H = 4.2, th = 0.35;
      const win = (a, w = 1.4) => ({ a, w, sill: 1.05, top: 2.5, glass: true });
      wall('x', z0, x0, x1, gy, H, th, concM, [win(x0 + 2), win(x0 + 5), win(x0 + 8), win(x0 + 11)], [{ a: x0 + 4, b: x0 + 6.3, h: 3.0 }, { a: x0 + 10, b: x1, h: 3.4 }]);
      wall('x', z1, x0, x1, gy, H, th, concM, [{ a: b.x - 1.2, w: 2.4, sill: 0, top: 2.7 }, win(x0 + 1.5), win(x0 + 9), win(x0 + 11.5, 1.2)], [{ a: x0 + 3, b: x0 + 5, h: 2.6 }]);
      wall('z', x1, z0, z1, gy, H, th, concM, [win(z0 + 1.5), win(z0 + 6.5)], [{ a: z0, b: z0 + 1, h: 1.6 }]);
      wall('z', x0, z0, z1, gy, H, th, concM, [win(z0 + 1.2)], [{ a: z0 + 2.5, b: z1 - 0.8, h: 1.15 }, { a: z0, b: z0 + 2.5, h: 3.8 }]);
      for (const px of [b.x - 2.5, b.x + 2.5]) piece(concM, px - 0.25, gy, b.z - 0.25, px + 0.25, gy + H - 0.2, b.z + 0.25);
      slab(concM, x0, z0, x1, z1, gy + 0.03, 0.12, null, 'concrete'); W.colliders.pop();
      // partial roof
      for (let i = 0; i < 4; i++) { if (i === 1 || i === 2) { if (i === 1) slab(concM, x0 + 3.5 + i * 3.5 - 3.4, z0, x0 + 3.5 + i * 3.5, z0 + 3, gy + H - 0.1, 0.25, [0.45, 0.0]); continue; } slab(concM, x0 + i * 3.5, z0, x0 + i * 3.5 + 3.5, z1, gy + H + 0.1, 0.25); }
      rubble(x0 + 1.5, b.z + 3, 14, 3, gy); rubble(b.x + 3, b.z - 2, 10, 2.5, gy);
      crate(b.x - 4, b.z - 3, gy); crate(b.x - 3.1, b.z - 3.2, gy, 0.7); crate(b.x + 4.5, b.z + 3, gy);
      graffiti(b.x + 3.0, gy + 1.7, z1 - th / 2 - 0.01, Math.PI, 3.6, 1.8, 101); graffiti(b.x - 6.8, gy + 1.8, b.z + 0.5, Math.PI / 2, 3.2, 1.6, 102); graffiti(x1 + th / 2 + 0.01, gy + 1.5, b.z - 1, -Math.PI / 2, 3.0, 1.5, 103);
      buildings.push({ cx: b.x, cz: b.z, gy, name: 'A', hx: 7, hz: 5 });
    }
    // ===== Building B: L-shaped brick house, tower stub, flat roof with big hole
    {
      const b = BUILD_SPOTS[1], gy = T.h(b.x, b.z), H = 3.6, th = 0.4;
      const ax0 = b.x - 6, ax1 = b.x + 5, az0 = b.z - 4, az1 = b.z + 2; // main block
      const wx0 = b.x + 1, wx1 = b.x + 5, wz0 = b.z + 2, wz1 = b.z + 8; // wing
      const w = (a, ww = 1.0) => ({ a, w: ww, sill: 1.2, top: 2.4, glass: true, brokenChance: 0.5 });
      wall('x', az0, ax0, ax1, gy, H, th, brickM, [w(ax0 + 1.4), w(ax0 + 4.2), w(ax0 + 7.8)], [{ a: ax0 + 5.5, b: ax0 + 7, h: 2.2 }]);
      wall('x', az1, ax0, wx0, gy, H, th, brickM, [{ a: ax0 + 2, w: 1.1, sill: 0, top: 2.2 }, w(ax0 + 4.5)], [{ a: ax0 + 3.2, b: ax0 + 4, h: 1.4 }]);
      wall('z', ax0, az0, az1, gy, H, th, brickM, [w(az0 + 2.5)], [{ a: az0, b: az0 + 1.8, h: 2.1 }]);
      wall('z', ax1, az0, wz0, gy, H, th, brickM, [w(az0 + 1.5), w(az0 + 4.2)], []);
      wall('z', wx0, wz0, wz1, gy, H, th, brickM, [w(wz0 + 1.5), w(wz0 + 4)], [{ a: wz0 + 4.5, b: wz1, h: 1.4 }]);
      wall('z', wx1, wz0, wz1, gy, H, th, brickM, [w(wz0 + 2)], [{ a: wz0, b: wz0 + 1, h: 3.0 }]);
      wall('x', wz1, wx0, wx1, gy, H, th, brickM, [{ a: wx0 + 1.2, w: 1.6, sill: 0, top: 2.3 }], [{ a: wx0, b: wx0 + 1.2, h: 0.9 }]);
      // tower stub in the corner
      piece(brickM, ax0 - 1.2, gy, az0 - 1.2, ax0 + 1.5, gy + 6.2, az0 + 1.5); // solid chimney-like stub
      slab(concM, ax0 + 0.5, az0, ax1 - 3, az1, gy + H + 0.1, 0.25); slab(concM, ax1 - 1.3, az0, ax1, az1, gy + H + 0.1, 0.25); slab(concM, ax0 + 1, az0 + 0.5, ax0 + 4.5, az1, gy + H - 0.5, 0.2, [0.0, -0.5]);
      rubble(b.x - 2, b.z - 1, 18, 3, gy); rubble(wx0 + 2, wz0 + 4, 8, 2, gy);
      crate(b.x + 1, b.z - 2.5, gy); crate(b.x - 4, b.z - 2.8, gy, 0.8);
      const tbl = add(new THREE.Mesh(texBox(1.6, 0.8, 0.8, 0.7), woodM)); tbl.position.set(b.x + 2.5, gy + 0.4, b.z + 0.3); tbl.rotation.z = 0.02; addBox(b.x + 1.7, gy, b.z - 0.1, b.x + 3.3, gy + 0.8, b.z + 0.7, 'wood');
      graffiti(b.x - 0.5, gy + 1.7, az0 + th / 2 + 0.01, 0, 3.4, 1.7, 201); graffiti(ax1 + th / 2 + 0.01 - 0.4, gy + 1.8, b.z - 1.5, -Math.PI / 2, 2.6, 1.3, 202); graffiti(b.x - 4, gy + 1.5, az1 - th / 2 - 0.02, Math.PI, 2.4, 1.2, 203);
      buildings.push({ cx: b.x, cz: b.z, gy, name: 'B', hx: 8, hz: 8 });
    }
  }
  W.buildings = buildings;

  // ---------- warning signs + mine field border
  {
    const signM = new THREE.MeshStandardMaterial({ map: TX.signTex(), roughness: 0.6, metalness: 0.2, side: THREE.DoubleSide });
    const boardG = new THREE.PlaneGeometry(1.0, 0.625), postG = new THREE.CylinderGeometry(0.035, 0.045, 2.1, 6), postM = new THREE.MeshStandardMaterial({ color: 0x3a3a38, roughness: 0.7, metalness: 0.6 });
    const boards = [], posts = [], fenceP = [], fence = [];
    const P = T.PLAY;
    const ring = (fn) => { for (let t = -P; t <= P; t += 15) { fn(t, P, Math.PI); fn(t, -P, 0); fn(P, t, -Math.PI / 2); fn(-P, t, Math.PI / 2); } };
    ring((a, b, ry) => {
      let x = a, z = b; if (ry === -Math.PI / 2 || ry === Math.PI / 2) { x = b; z = a; }
      const y = T.h(x, z);
      _m.compose(_p.set(x, y + 1.55, z), _q.setFromEuler(_e.set(0, ry, 0)), _s.set(1, 1, 1)); boards.push(_m.clone());
      _m.compose(_p.set(x, y + 1.0, z - 0.0), _q.identity(), _s.set(1, 1, 1)); posts.push(_m.clone());
    });
    // wire fence between signs
    const wmat = new THREE.MeshStandardMaterial({ color: 0x2b2b2b, roughness: 0.6, metalness: 0.8 });
    const mk = (geo, mat, list) => { const im = new THREE.InstancedMesh(geo, mat, list.length); list.forEach((m, i) => im.setMatrixAt(i, m)); im.castShadow = true; scene.add(im); return im; };
    mk(boardG, signM, boards); mk(postG, postM, posts);
    // rails of the border fence
    const rg = new THREE.BoxGeometry(15, 0.025, 0.025), rails = [];
    ring((a, b, ry) => { let x = a, z = b, rot = 0; if (ry === -Math.PI / 2 || ry === Math.PI / 2) { x = b; z = a; rot = Math.PI / 2; } for (const hy of [0.5, 1.0, 1.5]) { _m.compose(_p.set(x + (rot ? 0 : 7.5), T.h(x, z) + hy, z + (rot ? 7.5 : 0)), _q.setFromEuler(_e.set(0, rot, 0)), _s.set(1, 1, 1)); rails.push(_m.clone()); } });
    mk(rg, wmat, rails);
    // buried mines beyond the border
    const mineG = new THREE.CylinderGeometry(0.16, 0.18, 0.07, 12), mineM = new THREE.MeshStandardMaterial({ color: 0x2f3328, roughness: 0.6, metalness: 0.6 }), mines = [];
    for (let i = 0; i < 130; i++) { const side = Math.floor(rng() * 4), t = R(-P - 20, P + 20), d = R(P + 3, P + 24); let x, z; if (side === 0) { x = t; z = d; } else if (side === 1) { x = t; z = -d; } else if (side === 2) { x = d; z = t; } else { x = -d; z = t; } if (Math.abs(x) > T.HALF - 3 || Math.abs(z) > T.HALF - 3) continue; _m.compose(_p.set(x, T.h(x, z) - 0.01, z), _q.setFromEuler(_e.set(R(-0.1, 0.1), 0, R(-0.1, 0.1))), _s.set(1, 1, 1)); mines.push(_m.clone()); }
    mk(mineG, mineM, mines);
  }

  // ---------- smoke columns from wrecks + bookkeeping
  W.update = (dt, camPos) => {
    // falling trees
    for (let i = W.falling.length - 1; i >= 0; i--) {
      const t = W.falling[i]; t.fallT += dt; const dur = 1.7, u = clamp(t.fallT / dur, 0, 1), a = (Math.PI / 2 - 0.05) * (u * u * (1.2 - 0.2 * u));
      const axis = new THREE.Vector3(t.dir.z, 0, -t.dir.x).normalize(); t.group.quaternion.setFromAxisAngle(axis, a).multiply(_q.setFromEuler(_e.set(0, 0, 0)));
      if (!t.crashed && u >= 0.97) { t.crashed = true; const p = new THREE.Vector3(t.x + t.dir.x * t.h * 0.7, T.h(t.x, t.z) + 0.4, t.z + t.dir.z * t.h * 0.7); fx.dust(p, 14, [0.4, 0.34, 0.26], 1, 3); fx.leafBurst(p, 25); ctx.game?.shake(clamp(1 - p.distanceTo(camPos) / 30, 0, 1) * 0.6); }
      if (u >= 1) { t.alive = false; W.falling.splice(i, 1); }
    }
    for (const e of W.emitters) { e.t -= dt; if (e.t <= 0) { e.t = 0.35; fx.smoke(new THREE.Vector3(e.x, e.y, e.z), 1, 0.7, 5, [0.2, 0.2, 0.2]); } }
    // grass distance culling
    W._gt = (W._gt || 0) - dt; if (W._gt <= 0) { W._gt = 0.4; const lim = quality === 'low' ? 55 : 85; for (const g of W.grassChunks) { g.visible = Math.hypot(g.userData.c.x - camPos.x, g.userData.c.z - camPos.z) < lim + 20; } }
    for (let i = 0; i < 10; i++) { const c = ctx.chars[i]; if (c) windU.uChars.value[i].set(c.pos.x, c.pos.y, c.pos.z); else windU.uChars.value[i].set(9999, 0, 9999); }
  };
  return W;
}

// ------------------------------------------------------------------ character physics / collision
export function groundHeight(x, z, feetY) {
  let g = T.h(x, z); const W = ctx.world;
  if (W) for (const b of W.colliders) { if (b.broken) continue; if (x > b.minx && x < b.maxx && z > b.minz && z < b.maxz && b.maxy <= feetY + 0.58 && b.maxy > g && b.miny < feetY + 0.4) g = b.maxy; }
  return g;
}

export function collideXZ(c, x, z) {
  const W = ctx.world, r = c.radius * (c.crouch > 0.5 ? 0.9 : 1); let px = x, pz = z;
  const y0 = c.pos.y, y1 = c.pos.y + 1.6 * c.s * (1 - 0.25 * c.crouch);
  for (const b of W.colliders) {
    if (b.broken) continue; if (b.maxy <= y0 + 0.58 || b.miny >= y1) continue;
    if (px < b.minx - r || px > b.maxx + r || pz < b.minz - r || pz > b.maxz + r) continue;
    const cx = clamp(px, b.minx, b.maxx), cz = clamp(pz, b.minz, b.maxz); let dx = px - cx, dz = pz - cz, d2 = dx * dx + dz * dz;
    if (d2 < r * r) {
      if (d2 < 1e-8) { // center inside: push out through nearest face
        const l = px - b.minx, rr = b.maxx - px, f = pz - b.minz, bk = b.maxz - pz, m = Math.min(l, rr, f, bk);
        if (m === l) px = b.minx - r; else if (m === rr) px = b.maxx + r; else if (m === f) pz = b.minz - r; else pz = b.maxz + r;
      } else { const d = Math.sqrt(d2), k = (r - d) / d; px += dx * k; pz += dz * k; }
    }
  }
  for (const t of W.trees) { if (!t.alive || t.falling) continue; const dx = px - t.x, dz = pz - t.z, rr = r + t.r, d2 = dx * dx + dz * dz; if (d2 < rr * rr) { const d = Math.sqrt(d2) || 0.01, k = (rr - d) / d; px += dx * k; pz += dz * k; } }
  return [px, pz];
}

export function physStep(c, dt, gravity = 14) {
  const lim = T.HALF - 2;
  c.vel.y -= gravity * dt;
  let nx = c.pos.x + c.vel.x * dt, nz = c.pos.z + c.vel.z * dt;
  [nx, nz] = collideXZ(c, nx, nz);
  nx = clamp(nx, -lim, lim); nz = clamp(nz, -lim, lim);
  const feet = c.pos.y, move = Math.hypot(nx - c.pos.x, nz - c.pos.z);
  const gNew = groundHeight(nx, nz, feet);
  const ok = c.onGround ? (gNew - feet) <= Math.max(0.03, 1.05 * move) + 0.02 : gNew <= feet + 0.1;
  if (ok) { c.pos.x = nx; c.pos.z = nz; }
  else {
    // try sliding along each axis separately
    const gx = groundHeight(nx, c.pos.z, feet), gz = groundHeight(c.pos.x, nz, feet);
    const mx = Math.abs(nx - c.pos.x), mz = Math.abs(nz - c.pos.z);
    const okx = c.onGround ? (gx - feet) <= Math.max(0.03, 1.05 * mx) + 0.02 : gx <= feet + 0.1, okz = c.onGround ? (gz - feet) <= Math.max(0.03, 1.05 * mz) + 0.02 : gz <= feet + 0.1;
    if (okx) c.pos.x = nx; else c.vel.x *= 0.2; if (okz) c.pos.z = nz; else c.vel.z *= 0.2;
  }
  c.pos.y += c.vel.y * dt;
  const g = groundHeight(c.pos.x, c.pos.z, c.pos.y), was = c.onGround; let landed = 0;
  if (c.pos.y <= g + (c.onGround && c.vel.y <= 0 ? 0.32 : 0)) { if (!was && c.vel.y < -3) landed = -c.vel.y; c.pos.y = g; c.vel.y = 0; c.onGround = true; } else c.onGround = false;
  return landed;
}
