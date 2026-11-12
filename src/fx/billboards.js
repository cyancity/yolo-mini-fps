import * as THREE from 'three';
import { depthGLSL, lightGLSL, cloudGLSL, uploadRange } from './common.js';

// CPU 侧每粒子字段
const S = 26;
const PX = 0, PY = 1, PZ = 2, VX = 3, VY = 4, VZ = 5, LIFE = 6, MAXLIFE = 7, SIZE0 = 8, SIZE1 = 9,
  ROT = 10, ROTV = 11, ALPHA = 12, FADEIN = 13, GRAV = 14, DRAG = 15, R0 = 16, G0 = 17, B0 = 18,
  R1 = 19, G1 = 20, B1 = 21, FRAME = 22, ASPECT = 23, HEAT = 24, COOL = 25;
// GPU 侧每实例：位置+半边长、颜色+不透明度、旋转/图集格/宽高比/热度
const G = 12;
const BINS = 64;
const EVICT_SCAN = 8;

const vert = /* glsl */ `
attribute vec4 aPosSize;
attribute vec4 aColor;
attribute vec4 aMisc;
varying vec2 vUv;
varying vec4 vColor;
varying float vViewZ;
varying float vSoft;
#ifdef SMOKE
varying float vHeat;
${lightGLSL}
#else
varying vec2 vUvBlob;
varying float vBlob;
varying vec3 vView;
#endif
void main() {
  vec4 mv = viewMatrix * vec4(aPosSize.xyz, 1.0);
  float c = cos(aMisc.x), s = sin(aMisc.x);
  vec2 q = position.xy * vec2(aMisc.z, 1.0);
  vec2 off = vec2(q.x * c - q.y * s, q.x * s + q.y * c) * aPosSize.w;
  mv.xy += off;
  vViewZ = -mv.z;
  gl_Position = projectionMatrix * mv;
  float f = aMisc.y;
  vec2 cell = vec2(mod(f, 2.0), floor(f * 0.5));
  vColor = aColor;
  #ifdef SMOKE
    vUv = (uv + cell) * 0.5;
    vSoft = aPosSize.w * 0.5 + 0.03;
    vHeat = aMisc.w;
    // 按四个角各自的位置取光，大烟团穿过光锥边缘时有明暗过渡
    vec3 right = vec3(viewMatrix[0][0], viewMatrix[1][0], viewMatrix[2][0]);
    vec3 up = vec3(viewMatrix[0][1], viewMatrix[1][1], viewMatrix[2][1]);
    vec3 wo = right * off.x + up * off.y;
    vec3 wp = aPosSize.xyz + wo * 0.6;
    // 天光从上面来：朝上的一侧亮一点，白天环境光大了也不是一片平的灰
    float sky = 0.85 + 0.3 * clamp(wo.y / max(aPosSize.w, 1e-3), -1.0, 1.0);
    // 热度为负：大团的烟（烟雾弹）在夜里多吃几倍环境光（按亮度补成中性灰，不把烟染蓝），补上没算进来的月光和多次散射，
    // 暗处也看得出一团灰；环境光亮起来（白天）以后补光收掉，不会发白发亮
    float amb = dot(uAmbient, vec3(0.2126, 0.7152, 0.0722));
    float boost = max(-aMisc.w, 0.0) * (1.0 - smoothstep(0.08, 0.4, amb));
    vColor.rgb *= (uAmbient + amb * boost) * sky + fxLight(wp, normalize(cameraPosition - wp), 1.5) * 0.1;
  #else
    vBlob = step(3.5, f);
    vUv = (uv + cell * (1.0 - vBlob)) * 0.5;
    vUvBlob = uv;
    vSoft = aPosSize.w * 0.25 + 0.02;
    vView = mv.xyz;
  #endif
}`;

const frag = /* glsl */ `
uniform sampler2D tAtlas;
varying vec2 vUv;
varying vec4 vColor;
varying float vViewZ;
varying float vSoft;
#ifdef SMOKE
varying float vHeat;
#else
uniform sampler2D tBlob;
varying vec2 vUvBlob;
varying float vBlob;
varying vec3 vView;
${cloudGLSL}
#endif
${depthGLSL}
void main() {
  float soft = clamp((sceneViewZ() - vViewZ) / vSoft, 0.0, 1.0);
  #ifdef SMOKE
    // 贴脸的烟团淡掉，免得走进烟里整屏糊住；大烟团从更远处开始淡，穿过它时不会一下跳没
    soft *= smoothstep(0.1, max(0.55, vSoft), vViewZ);
    vec4 t = texture2D(tAtlas, vUv);
    float a = t.a * vColor.a * soft;
    float h = clamp(vHeat, 0.0, 1.0);
    vec3 fire = mix(vec3(1.0, 0.16, 0.02), vec3(1.0, 0.5, 0.14), h) * (h * 9.0) * t.rgb * t.rgb * 1.3;
    // 预乘 alpha：热的时候接近加色（火），冷下来变成遮挡的烟
    gl_FragColor = vec4((vColor.rgb * t.rgb + fire) * a, a * (1.0 - 0.75 * h));
  #else
    soft *= smoothstep(0.04, 0.16, vViewZ);
    vec3 e = mix(texture2D(tAtlas, vUv).rgb, vec3(texture2D(tBlob, vUvBlob).a), vBlob);
    gl_FragColor = vec4(e * vColor.rgb * (vColor.a * soft * cloudT(vView)), 0.0);
  #endif
}`;

// 面向镜头的实例化四边形粒子池。smoke: 受光、预乘 alpha、每帧按深度排序；否则是加色发光体。
// extra：给外部来源（烟雾弹的烟团）留的实例数。它们由 ext = { count, gpu } 按 GPU 格式写好，
// 不占池子、不会被顶掉，但和池里的烟一起排序，同一个 draw call
export class Billboards {
  constructor({ cap, extra = 0, smoke = false, atlas, blob = null, rig, renderOrder = 0 }) {
    this.cap = cap;
    this.extra = extra;
    this.ext = null;
    this.count = 0;
    this.cursor = 0;
    this.smoke = smoke;
    this.fadePow = smoke ? 1.4 : 1;
    this.wind = new THREE.Vector3();
    this.data = new Float32Array(cap * S);
    const total = cap + extra;
    this.gpu = new Float32Array(total * G);
    this.range = { start: 0, count: 0 };
    if (smoke) {
      this.order = new Uint16Array(total);
      this.depth = new Float32Array(total);
      this.slot = new Uint8Array(total);
      this.bins = new Uint16Array(BINS + 1);
    }

    const buf = new THREE.InstancedInterleavedBuffer(this.gpu, G, 1);
    buf.setUsage(THREE.DynamicDrawUsage);
    this.buf = buf;
    const geo = new THREE.InstancedBufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute([-1, -1, 0, 1, -1, 0, 1, 1, 0, -1, 1, 0], 3));
    geo.setAttribute('uv', new THREE.Float32BufferAttribute([0, 0, 1, 0, 1, 1, 0, 1], 2));
    geo.setIndex([0, 1, 2, 0, 2, 3]);
    geo.setAttribute('aPosSize', new THREE.InterleavedBufferAttribute(buf, 4, 0));
    geo.setAttribute('aColor', new THREE.InterleavedBufferAttribute(buf, 4, 4));
    geo.setAttribute('aMisc', new THREE.InterleavedBufferAttribute(buf, 4, 8));
    geo.instanceCount = 0;
    this.geo = geo;

    const uniforms = { ...rig.uniforms, tAtlas: { value: atlas } };
    if (!smoke) uniforms.tBlob = { value: blob };
    const mat = new THREE.ShaderMaterial({
      vertexShader: vert,
      fragmentShader: frag,
      uniforms,
      defines: smoke ? { SMOKE: 1 } : {},
      transparent: true,
      depthTest: false,
      depthWrite: false,
      blending: THREE.CustomBlending,
      blendSrc: THREE.OneFactor,
      blendDst: smoke ? THREE.OneMinusSrcAlphaFactor : THREE.OneFactor,
    });
    this.mesh = new THREE.Mesh(geo, mat);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = renderOrder;
  }

  // 返回粒子下标，紧接着用 tint / motion / heat 补参数（下标到下一次 update 前有效）
  emit(x, y, z, vx, vy, vz, life, size0, size1, alpha, frame = 0) {
    const d = this.data;
    let i;
    if (this.count < this.cap) i = this.count++;
    else {
      // 池满：在游标后面几个里挑最接近寿终的顶掉，正浓的烟不会突然消失
      i = this.cursor;
      let oldest = -1;
      for (let k = 0; k < EVICT_SCAN; k++) {
        const j = (this.cursor + k) % this.cap, t = d[j * S + LIFE] / d[j * S + MAXLIFE];
        if (t > oldest) { oldest = t; i = j; }
      }
      this.cursor = (this.cursor + EVICT_SCAN) % this.cap;
    }
    const o = i * S;
    d[o + PX] = x; d[o + PY] = y; d[o + PZ] = z;
    d[o + VX] = vx; d[o + VY] = vy; d[o + VZ] = vz;
    d[o + LIFE] = 0; d[o + MAXLIFE] = life;
    d[o + SIZE0] = size0; d[o + SIZE1] = size1;
    d[o + ROT] = 0; d[o + ROTV] = 0;
    d[o + ALPHA] = alpha; d[o + FADEIN] = 0;
    d[o + GRAV] = 0; d[o + DRAG] = 0;
    d[o + R0] = 1; d[o + G0] = 1; d[o + B0] = 1;
    d[o + R1] = 1; d[o + G1] = 1; d[o + B1] = 1;
    d[o + FRAME] = frame; d[o + ASPECT] = 1;
    d[o + HEAT] = 0; d[o + COOL] = 1;
    return i;
  }

  tint(i, r, g, b, r1 = r, g1 = g, b1 = b) {
    const d = this.data, o = i * S;
    d[o + R0] = r; d[o + G0] = g; d[o + B0] = b;
    d[o + R1] = r1; d[o + G1] = g1; d[o + B1] = b1;
  }

  // gravity 为正向下；drag 把速度拉向风速；fadeIn 是淡入占寿命的比例
  motion(i, gravity, drag, rot = 0, rotSpeed = 0, aspect = 1, fadeIn = 0) {
    const d = this.data, o = i * S;
    d[o + GRAV] = gravity; d[o + DRAG] = drag;
    d[o + ROT] = rot; d[o + ROTV] = rotSpeed;
    d[o + ASPECT] = aspect; d[o + FADEIN] = fadeIn;
  }

  // 烟团的初始热度（发光的火），在寿命的前 cool 比例内冷却成烟
  heat(i, heat, cool) {
    const d = this.data, o = i * S;
    d[o + HEAT] = heat; d[o + COOL] = cool;
  }

  update(dt) {
    const d = this.data, w = this.wind;
    let n = this.count;
    for (let i = 0; i < n;) {
      const o = i * S;
      const life = d[o + LIFE] + dt;
      if (life >= d[o + MAXLIFE]) {
        n--;
        if (i !== n) d.copyWithin(o, n * S, n * S + S);
        continue;
      }
      d[o + LIFE] = life;
      const k = d[o + DRAG] * dt, f = 1 / (1 + k);
      d[o + VX] = (d[o + VX] + k * w.x) * f;
      d[o + VY] = (d[o + VY] + k * w.y) * f - d[o + GRAV] * dt;
      d[o + VZ] = (d[o + VZ] + k * w.z) * f;
      d[o + PX] += d[o + VX] * dt;
      d[o + PY] += d[o + VY] * dt;
      d[o + PZ] += d[o + VZ] * dt;
      d[o + ROT] += d[o + ROTV] * dt;
      i++;
    }
    this.count = n;
    if (this.cursor >= n) this.cursor = 0;
  }

  // 绘制前打包：烟按从远到近排好再写入实例缓冲
  flush(camera) {
    const n = this.count, d = this.data, g = this.gpu, ext = this.ext;
    const m = ext ? Math.min(ext.count, this.extra) : 0, total = n + m, eg = ext ? ext.gpu : null;
    this.geo.instanceCount = total;
    if (total === 0) return;
    let order = null;
    if (this.smoke && camera) {
      const e = camera.matrixWorldInverse.elements, dep = this.depth;
      order = this.order;
      let lo = Infinity, hi = -Infinity;
      for (let i = 0; i < total; i++) {
        let z;
        if (i < n) {
          const o = i * S;
          z = e[2] * d[o + PX] + e[6] * d[o + PY] + e[10] * d[o + PZ];
        } else {
          const q = (i - n) * G;
          z = e[2] * eg[q] + e[6] * eg[q + 1] + e[10] * eg[q + 2];
        }
        dep[i] = z;
        if (z < lo) lo = z;
        if (z > hi) hi = z;
      }
      // 视空间 z 越小越远。先按深度分桶排出大致顺序，再用插入排序收尾：
      // 直接插入排序是平方级的，池子扩到七八百个以后满载时每帧要多花零点几毫秒
      const bins = this.bins, slot = this.slot, scale = (BINS - 1) / Math.max(hi - lo, 1e-6);
      bins.fill(0);
      for (let i = 0; i < total; i++) {
        const b = ((dep[i] - lo) * scale) | 0;
        slot[i] = b;
        bins[b + 1]++;
      }
      for (let b = 1; b <= BINS; b++) bins[b] += bins[b - 1];
      for (let i = 0; i < total; i++) order[bins[slot[i]]++] = i;
      for (let i = 1; i < total; i++) {
        const idx = order[i], key = dep[idx];
        let j = i - 1;
        while (j >= 0 && dep[order[j]] > key) { order[j + 1] = order[j]; j--; }
        order[j + 1] = idx;
      }
    }
    const fp = this.fadePow;
    for (let k = 0; k < total; k++) {
      const idx = order ? order[k] : k, p = k * G;
      if (idx >= n) {
        // 外部实例已经是 GPU 格式，原样拷过来
        const q = (idx - n) * G;
        for (let j = 0; j < G; j++) g[p + j] = eg[q + j];
        continue;
      }
      const o = idx * S;
      const t = d[o + LIFE] / d[o + MAXLIFE];
      const u = 1 - t;
      let a = d[o + ALPHA] * (fp === 1 ? u : Math.pow(u, fp));
      const fi = d[o + FADEIN];
      if (t < fi) a *= t / fi;
      g[p] = d[o + PX]; g[p + 1] = d[o + PY]; g[p + 2] = d[o + PZ];
      g[p + 3] = d[o + SIZE0] + (d[o + SIZE1] - d[o + SIZE0]) * (1 - u * u);
      g[p + 4] = d[o + R0] + (d[o + R1] - d[o + R0]) * t;
      g[p + 5] = d[o + G0] + (d[o + G1] - d[o + G0]) * t;
      g[p + 6] = d[o + B0] + (d[o + B1] - d[o + B0]) * t;
      g[p + 7] = a;
      g[p + 8] = d[o + ROT]; g[p + 9] = d[o + FRAME]; g[p + 10] = d[o + ASPECT];
      const cool = d[o + COOL], c = t < cool ? 1 - t / cool : 0;
      g[p + 11] = d[o + HEAT] * c * c;
    }
    uploadRange(this.buf, this.range, total * G);
  }

  clear() {
    this.count = 0;
    this.cursor = 0;
    this.geo.instanceCount = 0;
  }
}
