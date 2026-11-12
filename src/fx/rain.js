import * as THREE from 'three';
import { depthGLSL, lightGLSL, cloudGLSL, ribbonGLSL, ribbonGeometry } from './common.js';
import { RoofMap } from './roofmap.js';
import { RainSplash } from './rain_splash.js';

const CAP = 9000;
const BASE_COUNT = 6500;    // intensity = 1 时的雨丝数
const PERIOD = 64;          // 秒。下落和风的位移在一个周期里都是盒子尺寸的整数倍，时间回卷不跳变
const BOX_BELOW = 10;       // 盒子往镜头下方罩多深：站在 9 米的屋顶往下看，地面上也有雨
const CLOSE_SHARE = 0.04;   // 贴着镜头那一小盒占的雨丝比例（总数不变，开销不变）
const CLOSE_BOX = [7, 6, 7];

const vert = /* glsl */ `
attribute vec4 aSeed;
uniform vec2 uResolution;
uniform float uPhase;
uniform float uPeriod;
uniform vec3 uCenter;
uniform vec3 uBox;
uniform vec3 uCloseCenter;
uniform vec3 uCloseBox;
uniform vec2 uWindN;     // 一个周期里风吹过的盒子数（整数）
uniform vec2 uWindClose; // 同样的风折成近处小盒的盒子数
uniform vec2 uClose;     // 近处那层占的比例、亮度（镜头在屋檐下时为 0）
uniform float uExposure; // 雨丝长度 = 速度 × 曝光时间
uniform float uHalfW;
uniform vec3 uGain;      // 环境底亮度、灯光散射系数、前向散射强度
uniform sampler2D tRoof;
uniform vec4 uRoofRect;  // minX, minZ, 1/sizeX, 1/sizeZ
varying vec2 vUv;
varying vec3 vColor;
varying float vViewZ;
varying float vClose;
${lightGLSL}
${ribbonGLSL}
${cloudGLSL}
void main() {
  // 一小部分雨丝挤在镜头跟前的小盒里，擦着镜头落下；镜头进了屋檐下就整层熄掉
  float isClose = step(1.0 - uClose.x, fract(aSeed.w * 37.17));
  vClose = isClose;
  if (isClose > 0.5 && uClose.y <= 0.0) { gl_Position = vec4(2.0, 2.0, 2.0, 1.0); return; }
  vec3 box = mix(uBox, uCloseBox, isClose);
  vec3 center = mix(uCenter, uCloseCenter, isClose);
  vec2 wind = mix(uWindN, uWindClose, isClose);
  // 速度量化成每周期落 n 个盒高，位置只用 fract 算，跑多久都不丢精度
  float n = floor((32.0 + aSeed.w * 15.0) * uBox.y / box.y);
  float speed = n * box.y / uPeriod;
  vec3 f = fract(vec3(aSeed.x + wind.x * uPhase, aSeed.y - n * uPhase, aSeed.z + wind.y * uPhase));
  // 雨滴钉在世界里，只在跟随镜头的盒子边界回卷
  vec3 local = mod(f * box - center + box * 0.5, box) - box * 0.5;
  vec3 head = center + local;
  vec3 vel = vec3(wind.x * box.x / uPeriod, -speed, wind.y * box.z / uPeriod);
  vec3 tail = head - vel * uExposure;

  vec3 e = 1.0 - abs(local) / (box * 0.5);
  float fade = smoothstep(0.0, 0.14, e.x) * smoothstep(0.0, 0.14, e.z) * smoothstep(0.0, 0.08, e.y);
  // 遮雨高度图：每一根都单独比，屋里、棚下、集装箱里不下雨，隔着门窗照样看得见外面的雨
  float roof = texture2D(tRoof, (head.xz - uRoofRect.xy) * uRoofRect.zw).r;
  fade *= step(roof, head.y);
  // 罩住的、出了盒子的直接丢掉，不白占填充率（在大仓库里，盒子里大半的雨丝都在屋顶下）
  if (fade <= 0.0) { gl_Position = vec4(2.0, 2.0, 2.0, 1.0); return; }

  float k, cap;
  vec3 p = ribbon((viewMatrix * vec4(tail, 1.0)).xyz, (viewMatrix * vec4(head, 1.0)).xyz, position.xy, uHalfW, 1.0, k, cap);
  vViewZ = -p.z;
  gl_Position = projectionMatrix * vec4(p, 1.0);
  vec3 mid = (head + tail) * 0.5;
  // 加色的雨丝白天按环境光算会一片发白（真实的雨丝在亮背景前反差很低），环境光亮起来后这一项压下去
  float day = smoothstep(0.08, 0.4, dot(uAmbient, vec3(0.2126, 0.7152, 0.0722)));
  vec3 light = uAmbient * (uGain.x * mix(1.0, 0.4, day)) + fxLight(mid, normalize(cameraPosition - mid), uGain.z) * uGain.y;
  // 烟团后面的雨丝被烟挡住（雨是加色的，不和烟一起排序）
  vColor = light * (k * fade * mix(1.0, uClose.y, isClose) * (0.55 + 0.9 * fract(aSeed.w * 7.31)) * cloudT(p));
  vUv = position.xy;
}`;

const frag = /* glsl */ `
varying vec2 vUv;
varying vec3 vColor;
varying float vViewZ;
varying float vClose;
${depthGLSL}
void main() {
  // 近处淡掉：雨丝不会糊在武器和镜头上；贴脸那层离得更近才淡
  float soft = clamp((sceneViewZ() - vViewZ) / 0.25, 0.0, 1.0) * smoothstep(mix(0.9, 0.3, vClose), mix(2.2, 0.8, vClose), vViewZ);
  float across = 1.0 - abs(vUv.y);
  float along = smoothstep(0.0, 0.3, vUv.x) * smoothstep(1.0, 0.8, vUv.x);
  gl_FragColor = vec4(vColor * (across * along * soft), 0.0);
}`;

// 跟随镜头的一盒雨丝，加上落在各层顶面上的水花。全部在顶点着色器里算，CPU 每帧只更新几个 uniform。
export class Rain {
  constructor({ rig, phys, renderOrder = 0 }) {
    this.phys = phys;
    this.time = 0;
    this.cover = 0;       // 镜头头顶有遮挡的程度，0 露天 … 1 在屋里（平滑过）
    this.covered = false;
    const seeds = new Float32Array(CAP * 4);
    for (let i = 0; i < seeds.length; i++) seeds[i] = Math.random();
    const geo = ribbonGeometry();
    geo.setAttribute('aSeed', new THREE.InstancedBufferAttribute(seeds, 4));
    this.geo = geo;
    this.roof = new RoofMap();

    this.uniforms = {
      ...rig.uniforms,
      uPhase: { value: 0 },
      uPeriod: { value: PERIOD },
      uCenter: { value: new THREE.Vector3() },
      uBox: { value: new THREE.Vector3(36, 16, 36) },
      uCloseCenter: { value: new THREE.Vector3() },
      uCloseBox: { value: new THREE.Vector3(...CLOSE_BOX) },
      uWindN: { value: new THREE.Vector2(3, 1) },
      uWindClose: { value: new THREE.Vector2(15, 5) },
      uClose: { value: new THREE.Vector2(CLOSE_SHARE, 1) },
      uExposure: { value: 0.03 },
      uHalfW: { value: 0.0035 },
      uGain: { value: new THREE.Vector3(0.7, 0.012, 14) },
      tRoof: { value: this.roof.texture },
      uRoofRect: { value: this.roof.rect },
    };
    const mat = new THREE.ShaderMaterial({
      vertexShader: vert,
      fragmentShader: frag,
      uniforms: this.uniforms,
      transparent: true,
      depthTest: false,
      depthWrite: false,
      blending: THREE.CustomBlending,
      blendSrc: THREE.OneFactor,
      blendDst: THREE.OneFactor,
    });
    this.mesh = new THREE.Mesh(geo, mat);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = renderOrder;
    this.splash = new RainSplash({ rig, roof: this.roof, renderOrder });
  }

  update(dt, camera, state) {
    const phys = this.phys;
    // 高度图不只给雨用（弹着点、滑铲查地面干湿），关了雨也要跟着碰撞体更新
    if (phys) this.roof.sync(phys);
    if (camera) {
      const e = camera.matrixWorld.elements;
      this.covered = this.roof.coverAt(e[12], e[14]) > e[13] + 0.05;
      this.cover += ((this.covered ? 1 : 0) - this.cover) * Math.min(1, dt * 8);
    }
    const on = state.enabled && state.intensity > 0;
    this.geo.instanceCount = on ? Math.min(CAP, Math.floor(BASE_COUNT * state.intensity)) : 0;
    this.splash.update(this.time / PERIOD, PERIOD, camera, on ? state.intensity : 0);
    if (!on) return;
    this.time = (this.time + dt) % PERIOD;
    const u = this.uniforms;
    u.uPhase.value = this.time / PERIOD;
    u.uClose.value.y = this.cover > 0.98 ? 0 : 1 - this.cover;
    // 近处小盒的风换算成整数个盒子，和远处那层吹得一样快
    const w = u.uWindN.value, box = u.uBox.value, nb = u.uCloseBox.value;
    u.uWindClose.value.set(Math.round((w.x * box.x) / nb.x), Math.round((w.y * box.z) / nb.z));
    if (camera) {
      // 盒子中心往前推一段，把雨丝花在看得见的方向；竖直方向不往地底下浪费
      const e = camera.matrixWorld.elements;
      const fx = -e[8], fz = -e[10], fl = Math.hypot(fx, fz) || 1;
      const reach = box.x * 0.28;
      u.uCenter.value.set(e[12] + (fx / fl) * reach, Math.max(-1, e[13] - BOX_BELOW) + box.y * 0.5, e[14] + (fz / fl) * reach);
      u.uCloseCenter.value.set(e[12] + (fx / fl) * nb.x * 0.3, e[13] + nb.y * 0.15, e[14] + (fz / fl) * nb.z * 0.3);
    }
  }

  // 挪动或改了已有碰撞体之后手动重烤（增减碰撞体会自动重烤）
  bakeRoof() {
    if (this.phys) this.roof.bake(this.phys);
  }
}
