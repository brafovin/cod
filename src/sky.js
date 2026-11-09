import * as THREE from 'three';
import { clamp, lerp, smooth, windU, rand } from './util.js';

const SKY_VERT = /* glsl */`
varying vec3 vDir;
void main(){ vDir = position; vec4 p = modelViewMatrix * vec4(position,1.0); gl_Position = projectionMatrix * p; gl_Position.z = gl_Position.w; }`;
const SKY_FRAG = /* glsl */`
varying vec3 vDir;
uniform vec3 uZenith, uHorizon, uGround, uSunDir, uMoonDir, uSunCol, uCloudLit, uCloudDark;
uniform float uCover, uNight, uTwilight, uRain, uTime;
uniform vec2 uWindOff;
float hash(vec2 p){ p = fract(p*vec2(123.34, 456.21)); p += dot(p, p+45.32); return fract(p.x*p.y); }
float vnoise(vec2 p){ vec2 i=floor(p), f=fract(p); f=f*f*(3.0-2.0*f);
  return mix(mix(hash(i),hash(i+vec2(1,0)),f.x), mix(hash(i+vec2(0,1)),hash(i+vec2(1,1)),f.x), f.y); }
float fbm(vec2 p){ float a=0.5, s=0.0; for(int i=0;i<5;i++){ s+=a*vnoise(p); p=p*2.03+vec2(17.3,9.1); a*=0.5; } return s; }
void main(){
  vec3 dir = normalize(vDir);
  float up = dir.y;
  vec3 col = mix(uHorizon, uZenith, pow(clamp(up,0.0,1.0), 0.42));
  float sd = max(dot(dir, uSunDir), 0.0);
  col += uSunCol * (pow(sd, 6.0) * 0.18 + pow(sd, 48.0) * 0.5) * (0.35 + uTwilight) * (1.0-uNight);
  col += vec3(1.0,0.45,0.2) * uTwilight * pow(sd, 3.0) * 0.35;
  if (up < 0.0) { col = mix(uHorizon, uGround, smoothstep(0.0, -0.25, up)); }
  // stars
  if (up > 0.0 && uNight > 0.01) {
    vec2 sp = vec2(atan(dir.x, dir.z), asin(clamp(dir.y,-1.0,1.0))) * vec2(220.0, 220.0);
    vec2 cell = floor(sp); float r = hash(cell);
    float star = step(0.9965, r) * smoothstep(0.35, 0.0, length(fract(sp) - 0.5)) * (0.6 + 0.4*sin(uTime*2.0 + r*60.0));
    col += vec3(0.8,0.85,1.0) * star * uNight * 1.3 * smoothstep(0.0,0.2,up);
  }
  // sun & moon discs
  float sdisk = smoothstep(0.99955, 0.99975, dot(dir, uSunDir));
  col = mix(col, uSunCol * 30.0, sdisk * (1.0 - uNight));
  float md = dot(dir, uMoonDir);
  float mdisk = smoothstep(0.9993, 0.9996, md);
  vec2 mp = (dir.xz - uMoonDir.xz) * 90.0;
  float mt = 0.75 + 0.25*fbm(mp*3.0);
  col += vec3(0.75,0.8,0.95) * pow(max(md,0.0), 90.0) * 0.35 * uNight;
  col = mix(col, vec3(0.9,0.93,1.0) * 2.4 * mt, mdisk * uNight);
  // clouds
  if (up > 0.015) {
    vec2 uv = dir.xz / (up + 0.14) * 1.15 + uWindOff;
    float n = fbm(uv * 0.9) * 0.78 + fbm(uv * 3.2 + 3.7) * 0.22;
    float th = mix(0.78, 0.36, uCover);
    float c = smoothstep(th, th + 0.14, n) * smoothstep(0.015, 0.16, up);
    float lit = fbm(uv * 0.9 + uSunDir.xz * 0.35);
    float shade = clamp((n - lit) * 3.0 + 0.5, 0.0, 1.0);
    vec3 cc = mix(uCloudDark, uCloudLit, shade);
    cc = mix(cc, uCloudDark * 0.8, uRain * 0.6);
    col = mix(col, cc, c * (0.92 - 0.1 * uNight));
  }
  gl_FragColor = vec4(col, 1.0);
}`;

const C = (r, g, b) => new THREE.Color(r, g, b);

export class Sky {
  constructor(renderer, scene) {
    this.renderer = renderer; this.scene = scene;
    this.tod = 7.4;            // time of day (hours)
    this.hourSeconds = 48;     // 1 game hour in real seconds
    this.rain = 0; this.rainTarget = 0; this.rainTimer = rand(50, 100);
    this.wind = 0.4; this.windT = 0; this.gust = 0;
    this.cover = 0.4; this.windOff = new THREE.Vector2();
    this.sunDir = new THREE.Vector3(); this.moonDir = new THREE.Vector3();
    this.dark = 0; this.sunElev = 0.2; this.exposure = 1;

    this.uniforms = {
      uZenith: { value: C(0.3, 0.4, 0.6) }, uHorizon: { value: C(0.6, 0.65, 0.7) }, uGround: { value: C(0.05, 0.05, 0.05) },
      uSunDir: { value: this.sunDir }, uMoonDir: { value: this.moonDir }, uSunCol: { value: C(1, 0.9, 0.7) },
      uCloudLit: { value: C(1, 1, 1) }, uCloudDark: { value: C(0.4, 0.45, 0.5) },
      uCover: { value: 0.4 }, uNight: { value: 0 }, uTwilight: { value: 0 }, uRain: { value: 0 }, uTime: { value: 0 }, uWindOff: { value: this.windOff },
    };
    const mat = new THREE.ShaderMaterial({ uniforms: this.uniforms, vertexShader: SKY_VERT, fragmentShader: SKY_FRAG, side: THREE.BackSide, depthWrite: false, depthTest: false, fog: false });
    this.dome = new THREE.Mesh(new THREE.SphereGeometry(500, 48, 24), mat);
    this.dome.renderOrder = -10; this.dome.frustumCulled = false;
    scene.add(this.dome);
    this.envScene = new THREE.Scene(); this.envDome = new THREE.Mesh(this.dome.geometry, mat); this.envDome.frustumCulled = false; this.envScene.add(this.envDome);
    this.pmrem = new THREE.PMREMGenerator(renderer);
    this.envRT = null; this.envTimer = 0; this.envTod = -99;

    // lights
    this.hemi = new THREE.HemisphereLight(0xaabbd0, 0x4a3d2c, 0.6); scene.add(this.hemi);
    this.sun = new THREE.DirectionalLight(0xfff0d8, 3); this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(2048, 2048);
    const sc = this.sun.shadow.camera; sc.left = -52; sc.right = 52; sc.top = 52; sc.bottom = -52; sc.near = 1; sc.far = 260;
    this.sun.shadow.bias = -0.0005; this.sun.shadow.normalBias = 0.05; this.sun.shadow.radius = 2;
    scene.add(this.sun, this.sun.target);
    this.moon = new THREE.DirectionalLight(0x8fa6e0, 0); scene.add(this.moon);
    scene.fog = new THREE.FogExp2(0x8a9096, 0.004);

    // rain
    const N = 3200, pos = new Float32Array(N * 2 * 3), end = new Float32Array(N * 2), rnd = new Float32Array(N * 2);
    for (let i = 0; i < N; i++) {
      const x = Math.random() * 40 - 20, y = Math.random() * 26, z = Math.random() * 40 - 20, r = Math.random();
      for (let k = 0; k < 2; k++) { pos.set([x, y, z], (i * 2 + k) * 3); end[i * 2 + k] = k; rnd[i * 2 + k] = r; }
    }
    const rg = new THREE.BufferGeometry();
    rg.setAttribute('position', new THREE.BufferAttribute(pos, 3)); rg.setAttribute('aEnd', new THREE.BufferAttribute(end, 1)); rg.setAttribute('aRnd', new THREE.BufferAttribute(rnd, 1));
    this.rainU = { uCenter: { value: new THREE.Vector3() }, uTime: { value: 0 }, uAmt: { value: 0 }, uWindX: { value: 0 } };
    this.rainMesh = new THREE.LineSegments(rg, new THREE.ShaderMaterial({
      uniforms: this.rainU, transparent: true, depthWrite: false, fog: false,
      vertexShader: `uniform vec3 uCenter; uniform float uTime, uAmt, uWindX; attribute float aEnd, aRnd; varying float vA;
        void main(){ vec3 p = position; p.y = mod(p.y - uTime*(14.0 + aRnd*5.0) + aRnd*30.0, 26.0); p.x = mod(p.x + uWindX*p.y*0.08 + 20.0, 40.0) - 20.0; p.z = mod(p.z + 20.0, 40.0) - 20.0;
          vec3 w = uCenter + p - vec3(0.0, 8.0, 0.0); w += aEnd * vec3(uWindX*0.05, 0.55, 0.0);
          vA = step(aRnd, uAmt) * (0.18 + 0.2*aRnd);
          gl_Position = projectionMatrix * viewMatrix * vec4(w, 1.0); }`,
      fragmentShader: `varying float vA; void main(){ gl_FragColor = vec4(0.75,0.8,0.9, vA); }`,
    }));
    this.rainMesh.frustumCulled = false; this.rainMesh.renderOrder = 5;
    scene.add(this.rainMesh);
    this.update(0, new THREE.Vector3());
    this.refreshEnv(true);
  }

  baseCover(t) { return 0.52 * smooth(4.5, 8, t) * (1 - smooth(16.0, 19.5, t)) + 0.04; }

  update(dt, playerPos) {
    this.tod = (this.tod + dt / this.hourSeconds) % 24;
    const t = this.tod, a = (t - 6) / 12 * Math.PI;
    this.sunDir.set(Math.cos(a) * 0.88, Math.sin(a), 0.38).normalize();
    this.moonDir.copy(this.sunDir).negate();
    const e = this.sunElev = this.sunDir.y;
    const day = smooth(-0.04, 0.32, e), tw = Math.exp(-Math.pow(e / 0.2, 2));
    this.dark = 1 - smooth(-0.04, 0.2, e);
    const night = 1 - smooth(-0.22, 0.05, e);
    // weather
    this.rainTimer -= dt;
    if (this.rainTimer <= 0) {
      if (this.rainTarget > 0) { this.rainTarget = 0; this.rainTimer = rand(80, 170); } else { this.rainTarget = rand(0.55, 1); this.rainTimer = rand(40, 85); }
    }
    this.rain += clamp(this.rainTarget - this.rain, -dt * 0.07, dt * 0.07);
    this.windT += dt;
    const tt = this.windT;
    this.wind = clamp(0.32 + 0.22 * Math.sin(tt * 0.11) + 0.14 * Math.sin(tt * 0.37 + 1) + 0.1 * Math.sin(tt * 1.3) + this.rain * 0.35, 0.05, 1.3);
    windU.uTime.value = tt; windU.uWind.value = this.wind;
    const wa = 0.4 + Math.sin(tt * 0.03) * 0.6; windU.uWindDir.value.set(Math.cos(wa), Math.sin(wa));
    const cover = clamp(this.baseCover(t) + this.rain * 0.55, 0, 1);
    this.cover += (cover - this.cover) * Math.min(1, dt * 0.5);
    this.windOff.x += windU.uWindDir.value.x * dt * 0.006 * (0.6 + this.wind); this.windOff.y += windU.uWindDir.value.y * dt * 0.006 * (0.6 + this.wind);

    const U = this.uniforms, over = clamp(this.rain * 0.8 + this.cover * 0.15, 0, 1);
    // sky colors blended by sun height
    const zen = C(0.015, 0.022, 0.05).lerp(C(0.16, 0.24, 0.38), day).lerp(C(0.1, 0.1, 0.2), tw * 0.5 * (1 - night));
    const hor = C(0.03, 0.04, 0.07).lerp(C(0.52, 0.58, 0.6), day).lerp(C(0.85, 0.42, 0.22), tw * 0.75 * (1 - night * 0.3));
    const grey = C(0.35, 0.37, 0.4).multiplyScalar(0.3 + day * 0.7);
    U.uZenith.value.copy(zen).lerp(grey.clone().multiplyScalar(0.8), over * 0.8);
    U.uHorizon.value.copy(hor).lerp(grey, over * 0.8);
    U.uGround.value.copy(hor).multiplyScalar(0.35);
    U.uSunCol.value.copy(C(1, 0.5, 0.25).lerp(C(1, 0.95, 0.82), smooth(0, 0.5, e)));
    U.uCloudLit.value.copy(C(0.07, 0.08, 0.12)).lerp(C(1.05, 1.03, 1.0), day).lerp(C(1.2, 0.6, 0.35), tw * 0.8 * (1 - night));
    U.uCloudDark.value.copy(C(0.02, 0.025, 0.04)).lerp(C(0.42, 0.45, 0.52), day).lerp(C(0.35, 0.22, 0.25), tw * 0.6 * (1 - night));
    U.uCover.value = this.cover; U.uNight.value = night; U.uTwilight.value = tw; U.uRain.value = this.rain; U.uTime.value = tt;

    // lights
    const sunI = 3.4 * smooth(-0.02, 0.28, e) * (1 - 0.55 * this.cover * 0.8) * (1 - 0.8 * this.rain);
    this.sun.color.copy(C(1, 0.5, 0.25).lerp(C(1, 0.94, 0.82), smooth(0, 0.55, e)));
    this.sun.intensity = sunI;
    this.moon.intensity = 0.55 * night * (1 - 0.6 * this.rain) * (1 - 0.4 * this.cover);
    this.moon.position.copy(playerPos).addScaledVector(this.moonDir, 100);
    this.hemi.color.copy(U.uZenith.value).lerp(C(0.7, 0.75, 0.85), day * 0.5);
    this.hemi.groundColor.copy(C(0.12, 0.1, 0.08)).lerp(C(0.3, 0.25, 0.18), day);
    this.hemi.intensity = lerp(0.14, 0.9, day) * (1 - 0.25 * this.rain) + 0.05 * tw;
    this.scene.environmentIntensity = lerp(0.1, 0.55, day) * (1 - 0.3 * this.rain);
    // shadow-casting sun follows the player with texel snapping
    const texel = 104 / 2048, dir = this.sunDir;
    const right = new THREE.Vector3().crossVectors(new THREE.Vector3(0, 1, 0), dir).normalize(), upv = new THREE.Vector3().crossVectors(dir, right).normalize();
    const p = playerPos.clone(), A = p.dot(right), B = p.dot(upv);
    p.addScaledVector(right, Math.round(A / texel) * texel - A).addScaledVector(upv, Math.round(B / texel) * texel - B);
    this.sun.target.position.copy(p);
    this.sun.position.copy(p).addScaledVector(dir.y > 0.02 ? dir : new THREE.Vector3(0, 1, 0).multiplyScalar(0.02).add(dir), 110);
    this.sun.target.updateMatrixWorld();
    this.sun.castShadow = sunI > 0.05;
    // fog
    const fogCol = hor.clone().lerp(grey, over * 0.7).multiplyScalar(0.55 + 0.4 * day);
    this.scene.fog.color.copy(fogCol);
    this.scene.fog.density = 0.0036 + 0.0045 * this.rain + 0.0035 * night + 0.0012 * tw;
    this.fogColor = fogCol;
    this.exposure = lerp(4.2, 2.4, day) * (1 + 0.2 * this.rain);
    // rain mesh
    this.rainU.uTime.value = tt; this.rainU.uAmt.value = this.rain; this.rainU.uCenter.value.copy(playerPos); this.rainU.uWindX.value = windU.uWindDir.value.x * this.wind * 8;
    this.rainMesh.visible = this.rain > 0.02;
    this.dome.position.copy(playerPos);
    // env map refresh
    this.envTimer -= dt;
    if (this.envTimer <= 0) { this.refreshEnv(); }
  }

  refreshEnv(force) {
    this.envTimer = 6;
    if (!force && Math.abs(this.tod - this.envTod) < 0.05) return;
    this.envTod = this.tod;
    const rt = this.pmrem.fromScene(this.envScene, 0, 1, 1000);
    if (this.envRT) this.envRT.dispose();
    this.envRT = rt; this.scene.environment = rt.texture;
    if (this.onEnv) this.onEnv(rt.texture);
  }

  clock() { const h = Math.floor(this.tod), m = Math.floor((this.tod - h) * 60); return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`; }
}
