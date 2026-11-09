import * as THREE from 'three';
import { makeNoise, fbm, smooth, clamp, lerp, mulberry32 } from './util.js';
import { groundTex } from './textures.js';

export const HALF = 180;      // grid half extent
export const PLAY = 150;      // playable half extent (mine zone starts beyond)
export const RES = 0.5;       // grid resolution
export const S = Math.round((HALF * 2) / RES) + 1;
const MESH_HALF = 176, MESH_STEP = 0.7;

const H = new Float32Array(S * S);
const TD = new Float32Array(S * S).fill(99);
const GR = new Float32Array(S * S);
const CR = new Float32Array(S * S); // crater factor

export const trenches = [];
export const craters = [];
export const pads = [];
export const TRENCH_HW = 1.25;

const nz = makeNoise(1337), nz2 = makeNoise(77), nz3 = makeNoise(5);
function baseH(x, z) {
  const noMan = 1 - smooth(40, 70, Math.abs(z));
  const v = 1.4 * fbm(nz, x * 0.007, z * 0.007, 3) + 0.35 * fbm(nz2, x * 0.035, z * 0.035, 3) * (0.6 + 0.6 * noMan) + 0.5;
  return lerp(v, 0.5, smooth(PLAY + 4, MESH_HALF - 2, Math.max(Math.abs(x), Math.abs(z))));
}

function addTrench(pts, depth, rampStart, rampEnd, ramp = 7) {
  const cum = [0];
  for (let i = 1; i < pts.length; i++) cum.push(cum[i - 1] + Math.hypot(pts[i].x - pts[i - 1].x, pts[i].z - pts[i - 1].z));
  const tr = { pts, depth, rampStart, rampEnd, ramp, cum, total: cum[cum.length - 1] };
  trenches.push(tr);
  return tr;
}

function zigzag(x0, z0, x1, z1, step, amp, phase = 0) {
  const len = Math.hypot(x1 - x0, z1 - z0), n = Math.max(2, Math.round(len / step));
  const dx = (x1 - x0) / len, dz = (z1 - z0) / len, px = -dz, pz = dx;
  const pts = [];
  for (let i = 0; i <= n; i++) {
    const t = i / n, off = (i === 0 || i === n) ? 0 : ((i + phase) % 2 ? amp : -amp);
    pts.push({ x: x0 + (x1 - x0) * t + px * off, z: z0 + (z1 - z0) * t + pz * off });
  }
  return pts;
}

function layoutTrenches() {
  const r = mulberry32(42);
  for (const s of [1, -1]) {
    const front = addTrench(zigzag(-132, s * 50, 132, s * 50, 13, 3.2, 0), 1.55, true, true);
    const supp = addTrench(zigzag(-126, s * 90, 126, s * 90, 14, 3.5, 1), 1.5, true, true);
    const rear = addTrench(zigzag(-95, s * 122, 95, s * 122, 15, 2.8, 0), 1.45, true, true);
    // communication trenches
    const xs = [-105, -48, 8, 62, 108];
    for (let k = 0; k < xs.length; k++) {
      const x = xs[k], jig = (r() - 0.5) * 14;
      const a = front.pts.reduce((b, p) => (Math.abs(p.x - x) < Math.abs(b.x - x) ? p : b));
      const b = supp.pts.reduce((bb, p) => (Math.abs(p.x - (x + jig)) < Math.abs(bb.x - (x + jig)) ? p : bb));
      addTrench(zigzag(a.x, a.z, b.x, b.z, 9, 2.4, k), 1.45, false, false);
      if (k % 2 === 0 && Math.abs(x) < 95) {
        const c = rear.pts.reduce((bb, p) => (Math.abs(p.x - b.x) < Math.abs(bb.x - b.x) ? p : bb));
        addTrench(zigzag(b.x, b.z, c.x, c.z, 9, 2.2, k + 1), 1.4, false, false);
      }
    }
    // forward saps (listening posts) with ramp up into no-man's-land
    for (const x of [-72, 28, 92]) {
      const a = front.pts.reduce((b, p) => (Math.abs(p.x - x) < Math.abs(b.x - x) ? p : b));
      addTrench([{ x: a.x, z: a.z }, { x: a.x + 5, z: a.z - s * 8 }, { x: a.x + 3, z: a.z - s * 19 }], 1.5, false, true, 10);
    }
    // exits at the back
    for (const x of [-60, 20, 75]) {
      const a = rear.pts.reduce((b, p) => (Math.abs(p.x - x) < Math.abs(b.x - x) ? p : b));
      addTrench([{ x: a.x, z: a.z }, { x: a.x - 4, z: a.z + s * 14 }], 1.4, false, true, 11);
    }
    // inter-line ramps (side exits) from support line
    for (const x of [-30, 40]) {
      const a = supp.pts.reduce((b, p) => (Math.abs(p.x - x) < Math.abs(b.x - x) ? p : b));
      addTrench([{ x: a.x, z: a.z }, { x: a.x + 3, z: a.z - s * 13 }], 1.5, false, true, 11);
    }
  }
}

let built = false;
export function buildTerrainData() {
  if (built) return;
  built = true;
  pads.push({ cx: -95, cz: 8, hx: 9, hz: 7, h: 0 }, { cx: 80, cz: -12, hx: 8, hz: 8, h: 0 });
  const r = mulberry32(2024);
  for (let i = 0; i < 44; i++) {
    const x = (r() - 0.5) * 280, z = (r() - 0.5) * 290;
    craters.push({ x, z, r: 1.8 + r() * 3.6, d: 0.35 + r() * 0.8 });
  }
  layoutTrenches();
  // filter craters touching trenches or pads later by td; first base
  for (let j = 0; j < S; j++) for (let i = 0; i < S; i++) {
    const x = -HALF + i * RES, z = -HALF + j * RES;
    H[j * S + i] = baseH(x, z);
  }
  for (const p of pads) {
    p.h = baseH(p.cx, p.cz);
    const m = 5;
    for (let j = 0; j < S; j++) {
      const z = -HALF + j * RES; if (Math.abs(z - p.cz) > p.hz + m) continue;
      for (let i = 0; i < S; i++) {
        const x = -HALF + i * RES; if (Math.abs(x - p.cx) > p.hx + m) continue;
        const dx = Math.max(Math.abs(x - p.cx) - p.hx, 0), dz = Math.max(Math.abs(z - p.cz) - p.hz, 0);
        const w = 1 - smooth(0, m, Math.hypot(dx, dz));
        H[j * S + i] = lerp(H[j * S + i], p.h, w);
      }
    }
  }
  // craters (skip near pads)
  for (const c of craters) {
    if (pads.some((p) => Math.abs(c.x - p.cx) < p.hx + c.r + 6 && Math.abs(c.z - p.cz) < p.hz + c.r + 6)) { c.skip = true; continue; }
    const R = c.r * 1.6, i0 = Math.max(0, Math.floor((c.x - R + HALF) / RES)), i1 = Math.min(S - 1, Math.ceil((c.x + R + HALF) / RES));
    const j0 = Math.max(0, Math.floor((c.z - R + HALF) / RES)), j1 = Math.min(S - 1, Math.ceil((c.z + R + HALF) / RES));
    for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
      const x = -HALF + i * RES, z = -HALF + j * RES, q = Math.hypot(x - c.x, z - c.z) / c.r;
      if (q > 1.6) continue;
      const bowl = q < 1 ? c.d * (1 - q * q) : 0;
      const rim = 0.22 * c.d * Math.exp(-Math.pow((q - 1.12) / 0.22, 2));
      H[j * S + i] += rim - bowl;
      CR[j * S + i] = Math.max(CR[j * S + i], q < 1.05 ? 1 - q * 0.6 : 0);
    }
  }
  // trenches
  const carve = new Float32Array(S * S), berm = new Float32Array(S * S);
  for (const tr of trenches) {
    for (let k = 0; k < tr.pts.length - 1; k++) {
      const a = tr.pts[k], b = tr.pts[k + 1], dx = b.x - a.x, dz = b.z - a.z, len2 = dx * dx + dz * dz, len = Math.sqrt(len2);
      const R = TRENCH_HW + 3.2;
      const i0 = Math.max(0, Math.floor((Math.min(a.x, b.x) - R + HALF) / RES)), i1 = Math.min(S - 1, Math.ceil((Math.max(a.x, b.x) + R + HALF) / RES));
      const j0 = Math.max(0, Math.floor((Math.min(a.z, b.z) - R + HALF) / RES)), j1 = Math.min(S - 1, Math.ceil((Math.max(a.z, b.z) + R + HALF) / RES));
      for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
        const x = -HALF + i * RES, z = -HALF + j * RES;
        const t = clamp(((x - a.x) * dx + (z - a.z) * dz) / len2, 0, 1);
        const d = Math.hypot(x - (a.x + dx * t), z - (a.z + dz * t));
        if (d > R) continue;
        const s = tr.cum[k] + t * len;
        const ramp = (tr.rampStart ? smooth(0, tr.ramp, s) : 1) * (tr.rampEnd ? smooth(0, tr.ramp, tr.total - s) : 1);
        const f = 1 - smooth(TRENCH_HW, TRENCH_HW + 0.95, d);
        const idx = j * S + i;
        carve[idx] = Math.max(carve[idx], tr.depth * f * ramp);
        const bm = 0.32 * Math.exp(-Math.pow((d - (TRENCH_HW + 1.5)) / 0.7, 2)) * smooth(0, 3, s) * smooth(0, 3, tr.total - s);
        berm[idx] = Math.max(berm[idx], bm);
        if (ramp > 0.5 || f < 1) TD[idx] = Math.min(TD[idx], d); else TD[idx] = Math.min(TD[idx], d + 1.2);
      }
    }
  }
  for (let n = 0; n < S * S; n++) H[n] += berm[n] - carve[n];
  // grass mask
  for (let j = 0; j < S; j++) for (let i = 0; i < S; i++) {
    const x = -HALF + i * RES, z = -HALF + j * RES, idx = j * S + i;
    let g = smooth(-0.18, 0.22, fbm(nz3, x * 0.018 + 10, z * 0.018, 3));
    g *= smooth(2.6, 4.2, TD[idx]) * (1 - CR[idx]);
    g *= 1 - 0.6 * (1 - smooth(10, 45, Math.abs(z))) * 0.5;
    GR[idx] = g;
  }
}

function samp(A, x, z) {
  let fx = (x + HALF) / RES, fz = (z + HALF) / RES;
  fx = clamp(fx, 0, S - 1.001); fz = clamp(fz, 0, S - 1.001);
  const i = Math.floor(fx), j = Math.floor(fz), tx = fx - i, tz = fz - j, o = j * S + i;
  return (A[o] * (1 - tx) + A[o + 1] * tx) * (1 - tz) + (A[o + S] * (1 - tx) + A[o + S + 1] * tx) * tz;
}
export const h = (x, z) => samp(H, x, z);
export const trenchDist = (x, z) => samp(TD, x, z);
export const grassAt = (x, z) => samp(GR, x, z);
export const craterAt = (x, z) => samp(CR, x, z);

export function normalAt(x, z, out = new THREE.Vector3()) {
  const e = 0.35;
  out.set(h(x - e, z) - h(x + e, z), 2 * e, h(x, z - e) - h(x, z + e));
  return out.normalize();
}

export function surfaceAt(x, z) {
  const td = trenchDist(x, z);
  if (td < TRENCH_HW + 0.3 || craterAt(x, z) > 0.35) return 'mud';
  if (grassAt(x, z) > 0.45) return 'grass';
  return 'dirt';
}

export function buildTerrainMesh() {
  const n = Math.round((MESH_HALF * 2) / MESH_STEP), vs = n + 1;
  const pos = new Float32Array(vs * vs * 3), nor = new Float32Array(vs * vs * 3), col = new Float32Array(vs * vs * 3), uv = new Float32Array(vs * vs * 2);
  const idx = new Uint32Array(n * n * 6);
  const v = new THREE.Vector3();
  const cDirt = new THREE.Color(0x5e4a33), cMud = new THREE.Color(0x2a2118), cGrass = new THREE.Color(0x4a5c26), cDry = new THREE.Color(0x6e6638), cDead = new THREE.Color(0x3a3328), cGrass2 = new THREE.Color(0x2f3d1c);
  const tmp = new THREE.Color();
  for (let j = 0; j < vs; j++) for (let i = 0; i < vs; i++) {
    const x = -MESH_HALF + i * MESH_STEP, z = -MESH_HALF + j * MESH_STEP, o = j * vs + i;
    pos[o * 3] = x; pos[o * 3 + 1] = h(x, z); pos[o * 3 + 2] = z;
    normalAt(x, z, v); nor[o * 3] = v.x; nor[o * 3 + 1] = v.y; nor[o * 3 + 2] = v.z;
    uv[o * 2] = x * 0.22; uv[o * 2 + 1] = z * 0.22;
    const g = grassAt(x, z), td = trenchDist(x, z), cr = craterAt(x, z);
    const n1 = fbm(nz2, x * 0.09, z * 0.09, 3) * 0.5 + 0.5;
    tmp.copy(cDirt).lerp(cDead, n1 * 0.7);
    tmp.lerp(cGrass, g * (0.6 + 0.5 * n1)); tmp.lerp(cDry, g * 0.35 * (1 - n1)); tmp.lerp(cGrass2, g * 0.3 * n1);
    const mud = Math.max(cr, 1 - smooth(TRENCH_HW, TRENCH_HW + 1.2, td));
    tmp.lerp(cMud, mud * 0.9);
    const slope = 1 - v.y; tmp.lerp(cDirt, smooth(0.08, 0.3, slope) * 0.8);
    const dead = smooth(PLAY - 4, PLAY + 10, Math.max(Math.abs(x), Math.abs(z)));
    tmp.lerp(cMud, dead * 0.5);
    tmp.multiplyScalar(2.1); col[o * 3] = tmp.r; col[o * 3 + 1] = tmp.g; col[o * 3 + 2] = tmp.b;
  }
  let k = 0;
  for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
    const a = j * vs + i, b = a + 1, c = a + vs, d = c + 1;
    idx[k++] = a; idx[k++] = c; idx[k++] = b; idx[k++] = b; idx[k++] = c; idx[k++] = d;
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
  geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  geo.setIndex(new THREE.BufferAttribute(idx, 1));
  geo.computeBoundingSphere();
  const t = groundTex();
  const mat = new THREE.MeshStandardMaterial({ vertexColors: true, map: t, bumpMap: t, bumpScale: 2.2, roughness: 0.96, metalness: 0 });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.receiveShadow = true;
  // far wasteland: four strips around the mesh so they never cover the terrain
  const fm = new THREE.MeshStandardMaterial({ color: 0x3a3228, roughness: 1 }), far = new THREE.Group(), L = 4000, E = MESH_HALF - 0.3;
  for (const [w, d, x, z] of [[L, L / 2, 0, E + L / 4], [L, L / 2, 0, -E - L / 4], [L / 2, 2 * E, E + L / 4, 0], [L / 2, 2 * E, -E - L / 4, 0]]) { const p = new THREE.Mesh(new THREE.PlaneGeometry(w, d), fm); p.rotation.x = -Math.PI / 2; p.position.set(x, 0.5, z); p.receiveShadow = true; far.add(p); }
  mesh.userData.far = far;
  return mesh;
}
