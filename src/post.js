import * as THREE from 'three';
import { clamp } from './util.js';

// Render pipeline: scene -> HDR MSAA target at dynamic resolution -> upscale + CAS sharpen + tonemap + grade.
// (A browser-side stand-in for DLSS/FSR: adaptive render scale with edge-aware sharpening.)
export class Post {
  constructor(renderer) {
    this.r = renderer;
    this.scale = 1; this.mode = 'auto'; this.minScale = 0.55; this.maxScale = 1;
    this.ema = 16; this.adapt = 0;
    this.u = {
      tDiffuse: { value: null }, uRes: { value: new THREE.Vector2(1, 1) }, uSharp: { value: 0.4 }, uTime: { value: 0 }, uExposure: { value: 1 },
      uDamage: { value: 0 }, uFlash: { value: 0 }, uDark: { value: 0 }, uRain: { value: 0 }, uLow: { value: 0 }, uAspect: { value: 1 },
    };
    this.mat = new THREE.ShaderMaterial({
      uniforms: this.u, depthTest: false, depthWrite: false, toneMapped: false,
      vertexShader: `varying vec2 vUv; void main(){ vUv = position.xy*0.5+0.5; gl_Position = vec4(position.xy, 0.0, 1.0); }`,
      fragmentShader: /* glsl */`
      varying vec2 vUv; uniform sampler2D tDiffuse; uniform vec2 uRes; uniform float uSharp, uTime, uExposure, uDamage, uFlash, uDark, uRain, uLow, uAspect;
      vec3 aces(vec3 x){ x *= 0.8; return clamp((x*(2.51*x+0.03))/(x*(2.43*x+0.59)+0.14), 0.0, 1.0); }
      vec3 tap(vec2 uv){ return aces(texture2D(tDiffuse, uv).rgb * uExposure); }
      float hash(vec2 p){ return fract(sin(dot(p, vec2(12.9898,78.233))) * 43758.5453); }
      void main(){
        vec2 px = 1.0 / uRes;
        vec3 e = tap(vUv);
        vec3 b = tap(vUv + vec2(0.0,-px.y)), d = tap(vUv + vec2(-px.x,0.0)), f = tap(vUv + vec2(px.x,0.0)), h = tap(vUv + vec2(0.0,px.y));
        vec3 mn = min(min(min(d,e),min(f,b)),h), mx = max(max(max(d,e),max(f,b)),h);
        vec3 amp = sqrt(clamp(min(mn, 1.0-mx) / max(mx, vec3(1e-3)), 0.0, 1.0));
        vec3 w = -amp * mix(0.125, 0.2, uSharp);
        vec3 col = clamp((e + (b+d+f+h)*w) / (1.0 + 4.0*w), 0.0, 1.0);
        // grade: slightly desaturated, cool shadows, warm highlights (grim war look)
        float l = dot(col, vec3(0.299,0.587,0.114));
        col = mix(vec3(l), col, 0.86 - uDamage*0.4 - uRain*0.08);
        col = mix(col * vec3(0.94,1.0,1.06), col * vec3(1.06,1.0,0.92), smoothstep(0.2,0.9,l));
        col = mix(col, col*col*(3.0-2.0*col), 0.25);
        col = mix(col, vec3(0.55,0.65,1.0) * l * 1.1, uDark * 0.12);
        vec2 q = vUv - 0.5; q.x *= uAspect;
        float vig = smoothstep(0.95, 0.25, length(q));
        col *= mix(0.62, 1.0, vig);
        col += vec3(0.55,0.0,0.0) * uDamage * smoothstep(0.15, 0.7, length(q)) ;
        col = mix(col, vec3(1.0), uFlash);
        col += (hash(vUv*uRes + uTime) - 0.5) * 0.012;
        col = pow(col, vec3(1.0/2.2));
        gl_FragColor = vec4(col, 1.0);
      }`,
    });
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array([-1, -1, 0, 3, -1, 0, -1, 3, 0]), 3));
    this.quad = new THREE.Mesh(g, this.mat); this.quad.frustumCulled = false;
    this.qs = new THREE.Scene(); this.qs.add(this.quad);
    this.qc = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    this.rt = null; this.w = 1; this.h = 1;
  }

  resize(w, h) { this.w = w; this.h = h; this._alloc(); }
  _alloc() {
    const rw = Math.max(64, Math.floor(this.w * this.scale)), rh = Math.max(64, Math.floor(this.h * this.scale));
    if (this.rt) this.rt.dispose();
    this.rt = new THREE.WebGLRenderTarget(rw, rh, { type: THREE.HalfFloatType, samples: 4, depthBuffer: true, minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter });
    this.u.uRes.value.set(rw, rh); this.u.uAspect.value = this.w / this.h;
    this.u.uSharp.value = clamp((1 - this.scale) * 2.2 + 0.25, 0.25, 1);
  }
  setMode(m) {
    this.mode = m;
    if (m === 'high') { this.scale = 1; this.minScale = this.maxScale = 1; }
    else if (m === 'medium') { this.scale = 0.8; this.minScale = this.maxScale = 0.8; }
    else if (m === 'low') { this.scale = 0.62; this.minScale = this.maxScale = 0.62; }
    else { this.minScale = 0.55; this.maxScale = 1; }
    this._alloc();
  }

  adaptScale(dtMs) {
    this.ema += (dtMs - this.ema) * 0.05;
    if (this.mode !== 'auto') return;
    this.adapt += dtMs;
    if (this.adapt < 700) return; this.adapt = 0;
    let s = this.scale;
    if (this.ema > 21) s -= 0.07; else if (this.ema < 13.5) s += 0.03;
    s = clamp(s, this.minScale, this.maxScale);
    if (Math.abs(s - this.scale) > 0.01) { this.scale = s; this._alloc(); }
  }

  render(scene, cam, vmScene, vmCam, time) {
    const r = this.r;
    this.u.uTime.value = time % 100;
    r.setRenderTarget(this.rt);
    r.autoClear = true; r.clear();
    r.render(scene, cam);
    if (vmScene) { r.autoClear = false; r.clearDepth(); r.render(vmScene, vmCam); r.autoClear = true; }
    r.setRenderTarget(null);
    this.u.tDiffuse.value = this.rt.texture;
    r.render(this.qs, this.qc);
  }
}
