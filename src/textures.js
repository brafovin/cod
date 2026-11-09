import * as THREE from 'three';
import { mulberry32 } from './util.js';

function cv(w, h) { const c = document.createElement('canvas'); c.width = w; c.height = h; return c; }
function tex(c, { repeat = true, srgb = true, aniso = 8 } = {}) {
  const t = new THREE.CanvasTexture(c);
  if (repeat) { t.wrapS = t.wrapT = THREE.RepeatWrapping; }
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = aniso;
  return t;
}
function speckle(g, w, h, n, r, alpha, light = 255, dark = 0) {
  for (let i = 0; i < n; i++) {
    const v = Math.random() < 0.5 ? dark : light;
    g.fillStyle = `rgba(${v},${v},${v},${Math.random() * alpha})`;
    const s = Math.random() * r + 0.5;
    g.fillRect(Math.random() * w, Math.random() * h, s, s);
  }
}

export function groundTex() {
  const c = cv(512, 512), g = c.getContext('2d');
  g.fillStyle = '#f0ece2'; g.fillRect(0, 0, 512, 512);
  speckle(g, 512, 512, 14000, 3, 0.3);
  for (let i = 0; i < 260; i++) { // pebbles
    const x = Math.random() * 512, y = Math.random() * 512, r = Math.random() * 3 + 1;
    const v = 120 + Math.random() * 100;
    g.fillStyle = `rgba(${v},${v - 6},${v - 14},0.8)`; g.beginPath(); g.ellipse(x, y, r, r * 0.7, Math.random() * 3, 0, 7); g.fill();
    g.fillStyle = 'rgba(0,0,0,0.25)'; g.beginPath(); g.ellipse(x + 1, y + 1, r, r * 0.6, 0, 0, 7); g.fill();
  }
  // blade-like streaks for grass feel
  g.strokeStyle = 'rgba(40,50,20,0.10)';
  for (let i = 0; i < 600; i++) { const x = Math.random() * 512, y = Math.random() * 512; g.beginPath(); g.moveTo(x, y); g.lineTo(x + (Math.random() - 0.5) * 4, y - Math.random() * 7); g.stroke(); }
  return tex(c);
}

export function barkTex() {
  const c = cv(256, 512), g = c.getContext('2d');
  g.fillStyle = '#4b4034'; g.fillRect(0, 0, 256, 512);
  for (let i = 0; i < 260; i++) {
    const x = Math.random() * 256, w = 2 + Math.random() * 6, y = Math.random() * 512, l = 30 + Math.random() * 120;
    const v = 20 + Math.random() * 55;
    g.fillStyle = `rgba(${v},${v * 0.85},${v * 0.7},0.55)`; g.fillRect(x, y, w, l);
    g.fillStyle = 'rgba(0,0,0,0.35)'; g.fillRect(x + w, y, 1.5, l);
  }
  speckle(g, 256, 512, 3000, 3, 0.3);
  return tex(c);
}

export function camoTex(team) {
  const c = cv(512, 512), g = c.getContext('2d');
  const pal = team === 1
    ? ['#3d4b2b', '#27341d', '#5a6842', '#1a2415', '#4c5535', '#2f3b22']
    : ['#561f1c', '#33100f', '#7a2e27', '#1e0a09', '#62241f', '#3e1613'];
  g.fillStyle = pal[0]; g.fillRect(0, 0, 512, 512);
  const r = mulberry32(team * 99);
  for (let layer = 1; layer < pal.length; layer++) {
    g.fillStyle = pal[layer];
    for (let i = 0; i < 38; i++) {
      const x = r() * 512, y = r() * 512, s = 18 + r() * 52;
      g.beginPath();
      for (let k = 0; k < 9; k++) {
        const a = (k / 9) * Math.PI * 2, rr = s * (0.55 + r() * 0.7);
        const px = x + Math.cos(a) * rr * 1.4, py = y + Math.sin(a) * rr * 0.8;
        k ? g.lineTo(px, py) : g.moveTo(px, py);
      }
      g.closePath(); g.fill();
      // wrap
      g.save(); g.translate(512, 0); g.fill(); g.restore();
    }
  }
  // fabric weave
  g.globalAlpha = 0.18;
  for (let i = 0; i < 512; i += 2) { g.fillStyle = i % 4 ? '#000' : '#fff'; g.fillRect(i, 0, 1, 512); }
  g.globalAlpha = 1;
  speckle(g, 512, 512, 4000, 2, 0.25);
  return tex(c);
}

export function leafTex() {
  const c = cv(256, 256), g = c.getContext('2d');
  g.clearRect(0, 0, 256, 256);
  const cols = ['#4e6b2a', '#5d7a30', '#3f5a22', '#6c7f35', '#7a6a2c', '#8a5a25'];
  for (let i = 0; i < 11; i++) {
    const x = 30 + Math.random() * 196, y = 30 + Math.random() * 196, a = Math.random() * 6.28, s = 30 + Math.random() * 22;
    g.save(); g.translate(x, y); g.rotate(a);
    g.fillStyle = cols[Math.floor(Math.random() * cols.length)];
    g.beginPath(); g.moveTo(0, -s); g.quadraticCurveTo(s * 0.8, -s * 0.2, 0, s); g.quadraticCurveTo(-s * 0.8, -s * 0.2, 0, -s); g.fill();
    g.strokeStyle = 'rgba(20,30,10,0.6)'; g.lineWidth = 1; g.beginPath(); g.moveTo(0, -s); g.lineTo(0, s); g.stroke();
    g.restore();
  }
  return tex(c, { repeat: false });
}

export function groundLeafTex() {
  const c = cv(64, 64), g = c.getContext('2d');
  const cols = ['#6b4f22', '#7a5a25', '#5a4a1d', '#8a6a2c', '#4e5a22', '#7c3d1c'];
  g.fillStyle = cols[Math.floor(Math.random() * cols.length)];
  g.beginPath(); g.moveTo(32, 4); g.quadraticCurveTo(58, 28, 32, 60); g.quadraticCurveTo(6, 28, 32, 4); g.fill();
  g.strokeStyle = 'rgba(0,0,0,0.5)'; g.beginPath(); g.moveTo(32, 4); g.lineTo(32, 60); g.stroke();
  return tex(c, { repeat: false });
}

export function concreteTex() {
  const c = cv(512, 512), g = c.getContext('2d');
  g.fillStyle = '#8b8a84'; g.fillRect(0, 0, 512, 512);
  speckle(g, 512, 512, 20000, 3, 0.35);
  for (let i = 0; i < 14; i++) { // stains
    const x = Math.random() * 512, y = Math.random() * 512, r = 30 + Math.random() * 90;
    const gr = g.createRadialGradient(x, y, 0, x, y, r); gr.addColorStop(0, 'rgba(40,40,30,0.25)'); gr.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = gr; g.fillRect(x - r, y - r, r * 2, r * 2);
  }
  g.strokeStyle = 'rgba(30,30,28,0.7)'; g.lineWidth = 1.2; // cracks
  for (let i = 0; i < 9; i++) {
    let x = Math.random() * 512, y = Math.random() * 512; g.beginPath(); g.moveTo(x, y);
    for (let k = 0; k < 14; k++) { x += (Math.random() - 0.5) * 40; y += Math.random() * 28; g.lineTo(x, y); }
    g.stroke();
  }
  return tex(c);
}

export function brickTex() {
  const c = cv(512, 512), g = c.getContext('2d');
  g.fillStyle = '#6a6258'; g.fillRect(0, 0, 512, 512);
  for (let y = 0; y < 512; y += 32) for (let x = -64; x < 512; x += 64) {
    const o = (y / 32) % 2 ? 32 : 0;
    const v = 90 + Math.random() * 50;
    g.fillStyle = `rgb(${v + 30},${v * 0.6},${v * 0.45})`; g.fillRect(x + o + 2, y + 2, 60, 28);
  }
  speckle(g, 512, 512, 12000, 3, 0.4);
  for (let i = 0; i < 160; i++) { g.fillStyle = 'rgba(120,120,110,0.5)'; g.fillRect(Math.random() * 512, Math.random() * 512, 20 + Math.random() * 40, 20 + Math.random() * 20); }
  return tex(c);
}

export function woodTex() {
  const c = cv(256, 256), g = c.getContext('2d');
  g.fillStyle = '#6a5036'; g.fillRect(0, 0, 256, 256);
  for (let y = 0; y < 256; y += 32) {
    g.fillStyle = `rgba(0,0,0,0.5)`; g.fillRect(0, y, 256, 2);
    for (let i = 0; i < 18; i++) { const v = 60 + Math.random() * 50; g.fillStyle = `rgba(${v + 40},${v + 15},${v - 10},0.3)`; g.fillRect(0, y + Math.random() * 30, 256, 1 + Math.random() * 2); }
  }
  speckle(g, 256, 256, 2500, 2, 0.3);
  return tex(c);
}

export function sandbagTex() {
  const c = cv(256, 256), g = c.getContext('2d');
  g.fillStyle = '#8c7d5a'; g.fillRect(0, 0, 256, 256);
  for (let i = 0; i < 800; i++) { g.fillStyle = `rgba(${Math.random() < .5 ? 60 : 200},${Math.random() < .5 ? 50 : 180},${Math.random() < .5 ? 30 : 140},0.18)`; g.fillRect(Math.random() * 256, Math.random() * 256, 2 + Math.random() * 10, 1); }
  for (let i = 0; i < 800; i++) { g.fillStyle = 'rgba(0,0,0,0.15)'; g.fillRect(Math.random() * 256, Math.random() * 256, 1, 2 + Math.random() * 8); }
  return tex(c);
}

export function rockTex() {
  const c = cv(256, 256), g = c.getContext('2d');
  g.fillStyle = '#95948c'; g.fillRect(0, 0, 256, 256);
  speckle(g, 256, 256, 6000, 2, 0.3);
  for (let i = 0; i < 12; i++) { const x = Math.random() * 256, y = Math.random() * 256, r = 20 + Math.random() * 40; const gr = g.createRadialGradient(x, y, 0, x, y, r); gr.addColorStop(0, 'rgba(60,70,40,0.35)'); gr.addColorStop(1, 'rgba(0,0,0,0)'); g.fillStyle = gr; g.fillRect(x - r, y - r, 2 * r, 2 * r); }
  g.strokeStyle = 'rgba(25,25,25,0.6)'; g.lineWidth = 1.2; // cracks
  for (let i = 0; i < 10; i++) {
    let x = Math.random() * 256, y = Math.random() * 256, a = Math.random() * 6.28; g.beginPath(); g.moveTo(x, y);
    for (let k = 0; k < 9; k++) { a += (Math.random() - 0.5) * 1.1; x += Math.cos(a) * 12; y += Math.sin(a) * 12; g.lineTo(x, y); if (Math.random() < 0.2) { g.moveTo(x, y); } }
    g.stroke();
  }
  return tex(c);
}

export function metalTex(base = '#4a4d44') {
  const c = cv(256, 256), g = c.getContext('2d');
  g.fillStyle = base; g.fillRect(0, 0, 256, 256);
  speckle(g, 256, 256, 5000, 3, 0.4);
  for (let i = 0; i < 40; i++) { const x = Math.random() * 256, y = Math.random() * 256, r = 6 + Math.random() * 24; const gr = g.createRadialGradient(x, y, 0, x, y, r); gr.addColorStop(0, 'rgba(120,60,20,0.55)'); gr.addColorStop(1, 'rgba(0,0,0,0)'); g.fillStyle = gr; g.fillRect(x - r, y - r, 2 * r, 2 * r); }
  g.fillStyle = 'rgba(0,0,0,0.5)'; for (let i = 0; i < 6; i++) g.fillRect(0, i * 44 + 6, 256, 3);
  return tex(c);
}

export function holeTex() {
  const c = cv(64, 64), g = c.getContext('2d');
  const gr = g.createRadialGradient(32, 32, 0, 32, 32, 30);
  gr.addColorStop(0, 'rgba(0,0,0,1)'); gr.addColorStop(0.22, 'rgba(5,3,2,1)'); gr.addColorStop(0.3, 'rgba(30,20,12,0.85)'); gr.addColorStop(0.6, 'rgba(60,45,30,0.35)'); gr.addColorStop(1, 'rgba(0,0,0,0)');
  g.fillStyle = gr; g.fillRect(0, 0, 64, 64);
  g.strokeStyle = 'rgba(210,190,150,0.7)'; g.lineWidth = 1; // splinters
  for (let i = 0; i < 9; i++) { const a = Math.random() * 6.28, r1 = 8 + Math.random() * 4, r2 = r1 + 4 + Math.random() * 14; g.beginPath(); g.moveTo(32 + Math.cos(a) * r1, 32 + Math.sin(a) * r1); g.lineTo(32 + Math.cos(a) * r2, 32 + Math.sin(a) * r2); g.stroke(); }
  return tex(c, { repeat: false });
}

export function craterDecalTex() {
  const c = cv(128, 128), g = c.getContext('2d');
  const gr = g.createRadialGradient(64, 64, 0, 64, 64, 62);
  gr.addColorStop(0, 'rgba(10,8,6,0.95)'); gr.addColorStop(0.45, 'rgba(25,20,15,0.8)'); gr.addColorStop(0.8, 'rgba(40,32,24,0.35)'); gr.addColorStop(1, 'rgba(0,0,0,0)');
  g.fillStyle = gr; g.fillRect(0, 0, 128, 128);
  for (let i = 0; i < 40; i++) { const a = Math.random() * 6.28, r = 20 + Math.random() * 40; g.fillStyle = 'rgba(0,0,0,0.5)'; g.fillRect(64 + Math.cos(a) * r, 64 + Math.sin(a) * r, 2, 2 + Math.random() * 10); }
  return tex(c, { repeat: false });
}

export function glassTex(broken = true) {
  const c = cv(256, 256), g = c.getContext('2d');
  g.clearRect(0, 0, 256, 256);
  g.fillStyle = 'rgba(150,185,195,0.22)'; g.fillRect(0, 0, 256, 256);
  if (broken) {
    // erase jagged holes
    g.globalCompositeOperation = 'destination-out';
    const n = 2 + Math.floor(Math.random() * 2);
    for (let k = 0; k < n; k++) {
      const cx = 40 + Math.random() * 176, cy = 40 + Math.random() * 176, R = 50 + Math.random() * 60;
      g.beginPath();
      for (let i = 0; i < 16; i++) { const a = i / 16 * 6.28, r = R * (0.45 + Math.random() * 0.7); const x = cx + Math.cos(a) * r, y = cy + Math.sin(a) * r; i ? g.lineTo(x, y) : g.moveTo(x, y); }
      g.closePath(); g.fill();
    }
    g.globalCompositeOperation = 'source-over';
    g.strokeStyle = 'rgba(230,245,250,0.8)'; g.lineWidth = 1.2;
    for (let i = 0; i < 30; i++) { const cx = 128 + (Math.random() - 0.5) * 120, cy = 128 + (Math.random() - 0.5) * 120; let x = cx, y = cy, a = Math.random() * 6.28; g.beginPath(); g.moveTo(x, y); for (let k = 0; k < 4; k++) { a += (Math.random() - .5) * .6; x += Math.cos(a) * (14 + Math.random() * 30); y += Math.sin(a) * (14 + Math.random() * 30); g.lineTo(x, y); } g.stroke(); }
  }
  return tex(c, { repeat: false });
}

export function graffitiTex(seed) {
  const r = mulberry32(seed);
  const c = cv(512, 256), g = c.getContext('2d');
  g.clearRect(0, 0, 512, 256);
  const words = ['WAR', 'NO MORE', 'RIP', 'FREE', 'ZERO', 'DEAD', 'PEACE', 'X', 'ALONE'];
  const cols = ['#e03030', '#30c0e0', '#e0d030', '#ffffff', '#c040e0', '#40e060', '#ff8020'];
  const word = words[Math.floor(r() * words.length)];
  g.font = `bold ${70 + Math.floor(r() * 50)}px Impact, sans-serif`; g.textAlign = 'center';
  g.save(); g.translate(256, 150); g.rotate((r() - 0.5) * 0.3);
  g.lineWidth = 10; g.strokeStyle = 'rgba(0,0,0,0.85)'; g.strokeText(word, 0, 0);
  g.fillStyle = cols[Math.floor(r() * cols.length)]; g.fillText(word, 0, 0);
  g.restore();
  for (let i = 0; i < 40; i++) { g.fillStyle = cols[Math.floor(r() * cols.length)]; g.globalAlpha = 0.5; g.fillRect(r() * 512, 150 + r() * 100, 2, 10 + r() * 40); } // drips
  g.globalAlpha = 1;
  if (r() < 0.6) { g.strokeStyle = cols[Math.floor(r() * cols.length)]; g.lineWidth = 8; g.beginPath(); g.arc(256, 128, 90 + r() * 30, 0, 6.28); g.stroke(); }
  return tex(c, { repeat: false });
}

export function signTex() {
  const c = cv(512, 320), g = c.getContext('2d');
  g.fillStyle = '#e9e6dc'; g.fillRect(0, 0, 512, 320);
  g.strokeStyle = '#b01010'; g.lineWidth = 18; g.strokeRect(12, 12, 488, 296);
  g.fillStyle = '#b01010';
  g.beginPath(); g.moveTo(256, 24); g.lineTo(330, 120); g.lineTo(182, 120); g.fill(); // warn triangle
  g.fillStyle = '#e9e6dc'; g.fillRect(250, 56, 12, 36); g.fillRect(250, 98, 12, 12);
  g.font = 'bold 92px Impact, Arial Black, sans-serif'; g.textAlign = 'center'; g.fillStyle = '#cc0a0a';
  g.fillText('WARNUNG11', 256, 220);
  g.font = 'bold 34px Arial, sans-serif'; g.fillStyle = '#222'; g.fillText('MINEN – LEBENSGEFAHR', 256, 278);
  speckle(g, 512, 320, 4000, 3, 0.4);
  for (let i = 0; i < 30; i++) { g.fillStyle = 'rgba(80,60,30,0.2)'; g.fillRect(Math.random() * 512, Math.random() * 320, 20 + Math.random() * 40, 2); }
  return tex(c, { aniso: 8 });
}

export function flagTex(kind) {
  const c = cv(128, 80), g = c.getContext('2d');
  if (kind === 'usa') {
    for (let i = 0; i < 13; i++) { g.fillStyle = i % 2 ? '#f2f2f2' : '#b22234'; g.fillRect(0, i * 80 / 13, 128, 80 / 13 + 1); }
    g.fillStyle = '#3c3b6e'; g.fillRect(0, 0, 56, 43);
    g.fillStyle = '#fff'; for (let y = 0; y < 5; y++) for (let x = 0; x < 6; x++) g.fillRect(5 + x * 8.5, 5 + y * 7.5, 2, 2);
  } else {
    g.fillStyle = '#f4f4f4'; g.fillRect(0, 0, 128, 27); g.fillStyle = '#1c3f94'; g.fillRect(0, 27, 128, 27); g.fillStyle = '#d52b1e'; g.fillRect(0, 54, 128, 26);
  }
  return tex(c, { repeat: false });
}

export function crateTex() {
  const c = cv(256, 256), g = c.getContext('2d');
  g.fillStyle = '#4b5133'; g.fillRect(0, 0, 256, 256);
  speckle(g, 256, 256, 4000, 3, 0.35);
  g.strokeStyle = 'rgba(0,0,0,0.5)'; g.lineWidth = 6; g.strokeRect(8, 8, 240, 240);
  g.fillStyle = '#d8c24a'; g.font = 'bold 34px Arial'; g.textAlign = 'center'; g.fillText('AMMO', 128, 120); g.font = 'bold 20px Arial'; g.fillText('7.62 / 12G / 9mm', 128, 150);
  g.fillRect(40, 170, 176, 5);
  return tex(c);
}
