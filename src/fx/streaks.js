import * as THREE from 'three';
import { depthGLSL, lightGLSL, cloudGLSL, ribbonGLSL, ribbonGeometry, uploadRange } from './common.js';

const S = 24;
// 火花/余烬：位置、速度；曳光：起点、单位方向；火舌：根部、根到尖的向量
const PX = 0, PY = 1, PZ = 2, VX = 3, VY = 4, VZ = 5,
  LIFE = 6,      // 曳光：已飞距离
  MAXLIFE = 7,   // 曳光：全程长度
  KIND = 8, WIDTH = 9,
  TRAIL = 10,    // 火花：拖尾时长（秒）；曳光：光条长度（米）
  GRAV = 11,
  DRAG = 12,     // 曳光：飞行速度
  FLOOR = 13,    // 曳光：光条从离起点多远处开始显示
  BOUNCE = 14, R0 = 15, G0 = 16, B0 = 17, R1 = 18, G1 = 19, B1 = 20,
  TIMER = 21, POWER = 22,
  FLAGS = 23;    // 直接按 GPU 的编码存：2 受光，8 加粗，16 冷色火舌（尖端不变红）
const SPARK = 0, TRACER = 1, EMBER = 2, DASH = 3;
const G = 12;
const EMBER_STEP = 0.045;
const EVICT_SCAN = 8;
// 条带半宽最多占的张角（弧度）。玩家的曳光从两米外才开始画，碰不到这个上限
const NEAR_SPREAD = (0.012).toFixed(4);

const vert = /* glsl */ `
attribute vec4 aHead;   // 头部位置 + 半宽
attribute vec4 aTail;   // 尾部位置 + 标志（2：受场景灯光照亮；4：火舌外形；8：加粗，远处和迎面也看得清；16：冷色火舌）
attribute vec4 aColor;  // 颜色 + 强度
uniform vec2 uResolution;
varying vec2 vUv;
varying vec3 vColor;
varying float vViewZ;
varying vec3 vView;
varying vec3 vShape; // 端头圆角占比、是否火舌、尖端变红的程度
${lightGLSL}
${ribbonGLSL}
void main() {
  vec3 h = (viewMatrix * vec4(aHead.xyz, 1.0)).xyz;
  vec3 t = (viewMatrix * vec4(aTail.xyz, 1.0)).xyz;
  float fl = aTail.w;
  float jet = step(15.5, fl);
  fl -= 16.0 * jet;
  float bold = step(7.5, fl);
  fl -= 8.0 * bold;
  float flame = step(3.5, fl);
  float lit = step(1.5, fl - 4.0 * flame);
  // 半宽按张角封顶：擦着镜头飞过的曳光贴脸那一段不会撑成半屏宽的光楔（火舌本来就贴着枪口，不封）
  float zv = max(-mix(t.z, h.z, position.x), 0.05);
  float halfW = mix(min(aHead.w, ${NEAR_SPREAD} * zv), aHead.w, flame);
  float k, cap;
  vec3 p = ribbon(t, h, position.xy, halfW, 1.0 + 0.5 * bold, k, cap);
  // 敌人的曳光：撑到最小线宽时亮度不跟着一路压下去，朝镜头飞来缩成一个点也认得出
  k = mix(k, max(k, 0.65), bold);
  vViewZ = -p.z;
  vView = p;
  gl_Position = projectionMatrix * vec4(p, 1.0);
  vec3 c = aColor.rgb * (aColor.a * k);
  // 水花这类不发光的条带：亮度来自周围的灯。强度里有一大块是夜里的闪点，
  // 环境光亮起来（白天）以后环境光那一项的倍数封顶，碎玻璃和水花不会比周围的地面还亮
  float amb = dot(uAmbient, vec3(0.2126, 0.7152, 0.0722));
  float glint = mix(1.0, min(aColor.a, 2.0) / max(aColor.a, 1e-3), smoothstep(0.08, 0.4, amb));
  vec3 env = uAmbient * (1.5 * glint) + fxLight(aHead.xyz, normalize(cameraPosition - aHead.xyz), 5.0) * 0.06;
  vColor = c * mix(vec3(1.0), env, lit);
  vUv = position.xy;
  vShape = vec3(cap, flame, flame * (1.0 - jet));
}`;

const frag = /* glsl */ `
varying vec2 vUv;
varying vec3 vColor;
varying float vViewZ;
varying vec3 vView;
varying vec3 vShape;
${depthGLSL}
${cloudGLSL}
void main() {
  float soft = clamp((sceneViewZ() - vViewZ) / 0.04, 0.0, 1.0) * smoothstep(0.15, 0.5, vViewZ);
  float u = vUv.x;
  // 火舌：根部略收、中段最宽、尖端收成一点，越往外越暗越红；其余条带等宽
  float env = mix(1.0, mix(0.5, 1.0, smoothstep(0.0, 0.25, u)) * (1.0 - smoothstep(0.3, 1.0, u)), vShape.y);
  float across = clamp(1.0 - abs(vUv.y) / max(env, 1e-3), 0.0, 1.0);
  float caps = smoothstep(0.0, vShape.x, u) * smoothstep(0.0, vShape.x, 1.0 - u);
  // 火花和曳光：头亮尾暗
  float along = mix(u * sqrt(u), mix(1.0, 0.25, u), vShape.y);
  vec3 col = vColor * mix(vec3(1.0), mix(vec3(1.0), vec3(1.0, 0.38, 0.1), u), vShape.z);
  gl_FragColor = vec4(col * (across * caps * along * soft * cloudT(vView)), 0.0);
}`;

// 细长发光条带池：火花、余烬、曳光弹、枪口火舌共用一个 draw call
export class Streaks {
  constructor({ cap, rig, renderOrder = 0 }) {
    this.cap = cap;
    this.count = 0;
    this.cursor = 0;
    this.data = new Float32Array(cap * S);
    this.gpu = new Float32Array(cap * G);
    this.range = { start: 0, count: 0 };
    this.evicted = 0; // 池满被顶掉的条数，调池子大小时看
    this.onTrail = null; // (x, y, z, heat) => void，余烬沿途冒烟

    const buf = new THREE.InstancedInterleavedBuffer(this.gpu, G, 1);
    buf.setUsage(THREE.DynamicDrawUsage);
    this.buf = buf;
    const geo = ribbonGeometry();
    geo.setAttribute('aHead', new THREE.InterleavedBufferAttribute(buf, 4, 0));
    geo.setAttribute('aTail', new THREE.InterleavedBufferAttribute(buf, 4, 4));
    geo.setAttribute('aColor', new THREE.InterleavedBufferAttribute(buf, 4, 8));
    this.geo = geo;
    const mat = new THREE.ShaderMaterial({
      vertexShader: vert,
      fragmentShader: frag,
      uniforms: rig.uniforms,
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
  }

  alloc(kind, x, y, z, vx, vy, vz) {
    const d = this.data;
    let i;
    if (this.count < this.cap) i = this.count++;
    else {
      // 池满：在游标后面几个里挑最接近寿终的顶掉；还在飞的曳光算法里进度是负的，轮不到它
      i = this.cursor;
      let best = -Infinity;
      for (let k = 0; k < EVICT_SCAN; k++) {
        const j = (this.cursor + k) % this.cap, q = j * S;
        const t = d[q + KIND] === TRACER ? (d[q + LIFE] - d[q + TRAIL]) / d[q + MAXLIFE] : d[q + LIFE] / d[q + MAXLIFE];
        if (t > best) { best = t; i = j; }
      }
      this.cursor = (this.cursor + EVICT_SCAN) % this.cap;
      this.evicted++;
    }
    const o = i * S;
    d[o + PX] = x; d[o + PY] = y; d[o + PZ] = z;
    d[o + VX] = vx; d[o + VY] = vy; d[o + VZ] = vz;
    d[o + LIFE] = 0; d[o + KIND] = kind;
    d[o + R0] = 1; d[o + G0] = 1; d[o + B0] = 1;
    d[o + R1] = 1; d[o + G1] = 1; d[o + B1] = 1;
    d[o + TIMER] = 0; d[o + POWER] = 1; d[o + FLAGS] = 0;
    return i;
  }

  // 带重力和拖尾的火花；floorY 是它会落到的地面高度，反弹 bounces 次后熄灭
  spark(x, y, z, vx, vy, vz, life, halfW, trail, floorY = -1e9, gravity = 9.8, drag = 1, bounces = 1) {
    const i = this.alloc(SPARK, x, y, z, vx, vy, vz);
    const d = this.data, o = i * S;
    d[o + MAXLIFE] = life; d[o + WIDTH] = halfW; d[o + TRAIL] = trail;
    d[o + FLOOR] = floorY; d[o + GRAV] = gravity; d[o + DRAG] = drag; d[o + BOUNCE] = bounces;
    return i;
  }

  // 余烬：比火花粗、慢，沿途通过 onTrail 冒烟
  ember(x, y, z, vx, vy, vz, life, halfW, trail, floorY = -1e9) {
    const i = this.spark(x, y, z, vx, vy, vz, life, halfW, trail, floorY, 9.8, 0.6, 2);
    this.data[i * S + KIND] = EMBER;
    return i;
  }

  // 从 (x,y,z) 飞向 (tx,ty,tz) 的光条；startAt 之前的一段不显示
  tracer(x, y, z, tx, ty, tz, speed, halfW, length, startAt) {
    let dx = tx - x, dy = ty - y, dz = tz - z;
    const len = Math.hypot(dx, dy, dz);
    if (len < 1e-3) return -1;
    dx /= len; dy /= len; dz /= len;
    const i = this.alloc(TRACER, x, y, z, dx, dy, dz);
    const d = this.data, o = i * S;
    d[o + MAXLIFE] = len; d[o + WIDTH] = halfW; d[o + TRAIL] = length;
    d[o + DRAG] = speed; d[o + FLOOR] = Math.min(startAt, len * 0.5);
    d[o + LIFE] = d[o + FLOOR];
    return i;
  }

  // 原地的火舌：从 (x,y,z) 伸出 (dx,dy,dz)，只淡出不移动
  dash(x, y, z, dx, dy, dz, life, halfW) {
    const i = this.alloc(DASH, x, y, z, dx, dy, dz);
    const d = this.data, o = i * S;
    d[o + MAXLIFE] = life; d[o + WIDTH] = halfW;
    return i;
  }

  // 颜色从 (r,g,b) 冷却到 (r1,g1,b1)，power 是 HDR 强度
  color(i, r, g, b, power, r1 = r, g1 = g, b1 = b) {
    if (i < 0) return;
    const d = this.data, o = i * S;
    d[o + R0] = r; d[o + G0] = g; d[o + B0] = b;
    d[o + R1] = r1; d[o + G1] = g1; d[o + B1] = b1;
    d[o + POWER] = power;
  }

  // 不发光，亮度取自周围灯光（水花、碎玻璃）
  lit(i) {
    if (i >= 0) this.data[i * S + FLAGS] = 2;
  }

  // 加粗：最小线宽放大，亮度不随距离一路压低（敌人的曳光）
  bold(i) {
    if (i >= 0) this.data[i * S + FLAGS] = 8;
  }

  // 冷色火舌：火舌外形，但尖端不往橙红过渡（喷气的蓝白焰）
  jet(i) {
    if (i >= 0) this.data[i * S + FLAGS] = 16;
  }

  update(dt) {
    const d = this.data;
    let n = this.count;
    for (let i = 0; i < n;) {
      const o = i * S, kind = d[o + KIND];
      let dead = false;
      if (kind === TRACER) {
        d[o + LIFE] += d[o + DRAG] * dt;
        dead = d[o + LIFE] - d[o + TRAIL] >= d[o + MAXLIFE];
      } else {
        const life = d[o + LIFE] + dt;
        d[o + LIFE] = life;
        dead = life >= d[o + MAXLIFE];
        if (!dead && kind !== DASH) {
          const f = 1 / (1 + d[o + DRAG] * dt);
          d[o + VX] *= f;
          d[o + VY] = d[o + VY] * f - d[o + GRAV] * dt;
          d[o + VZ] *= f;
          d[o + PX] += d[o + VX] * dt;
          d[o + PY] += d[o + VY] * dt;
          d[o + PZ] += d[o + VZ] * dt;
          const floor = d[o + FLOOR];
          if (d[o + PY] < floor && d[o + VY] < 0) {
            if (d[o + BOUNCE] > 0) {
              d[o + BOUNCE]--;
              d[o + PY] = floor;
              d[o + VY] *= -0.35;
              d[o + VX] *= 0.6;
              d[o + VZ] *= 0.6;
            } else dead = true;
          }
          if (kind === EMBER && this.onTrail) {
            d[o + TIMER] -= dt;
            if (d[o + TIMER] <= 0) {
              d[o + TIMER] = EMBER_STEP;
              this.onTrail(d[o + PX], d[o + PY], d[o + PZ], 1 - life / d[o + MAXLIFE]);
            }
          }
        }
      }
      if (dead) {
        n--;
        if (i !== n) d.copyWithin(o, n * S, n * S + S);
        continue;
      }
      i++;
    }
    this.count = n;
    if (this.cursor >= n) this.cursor = 0;
  }

  flush() {
    const n = this.count, d = this.data, g = this.gpu;
    this.geo.instanceCount = n;
    if (n === 0) return;
    for (let k = 0; k < n; k++) {
      const o = k * S, p = k * G, kind = d[o + KIND];
      let hx, hy, hz, tx, ty, tz, t = 0, power = d[o + POWER];
      if (kind === TRACER) {
        const len = d[o + MAXLIFE], head = Math.min(d[o + LIFE], len);
        const tail = Math.min(Math.max(d[o + LIFE] - d[o + TRAIL], d[o + FLOOR]), head);
        hx = d[o + PX] + d[o + VX] * head; hy = d[o + PY] + d[o + VY] * head; hz = d[o + PZ] + d[o + VZ] * head;
        tx = d[o + PX] + d[o + VX] * tail; ty = d[o + PY] + d[o + VY] * tail; tz = d[o + PZ] + d[o + VZ] * tail;
        if (head - tail < 1e-3) power = 0;
      } else if (kind === DASH) {
        t = d[o + LIFE] / d[o + MAXLIFE];
        tx = d[o + PX]; ty = d[o + PY]; tz = d[o + PZ];
        hx = tx + d[o + VX]; hy = ty + d[o + VY]; hz = tz + d[o + VZ];
        power *= 1 - t;
      } else {
        t = d[o + LIFE] / d[o + MAXLIFE];
        const tr = d[o + TRAIL];
        hx = d[o + PX]; hy = d[o + PY]; hz = d[o + PZ];
        tx = hx - d[o + VX] * tr; ty = Math.max(hy - d[o + VY] * tr, d[o + FLOOR]); tz = hz - d[o + VZ] * tr;
        const u = 1 - t;
        power *= kind === EMBER ? u : u * Math.sqrt(u);
      }
      g[p] = hx; g[p + 1] = hy; g[p + 2] = hz; g[p + 3] = d[o + WIDTH];
      g[p + 4] = tx; g[p + 5] = ty; g[p + 6] = tz; g[p + 7] = d[o + FLAGS] + (kind === DASH ? 4 : 0);
      g[p + 8] = d[o + R0] + (d[o + R1] - d[o + R0]) * t;
      g[p + 9] = d[o + G0] + (d[o + G1] - d[o + G0]) * t;
      g[p + 10] = d[o + B0] + (d[o + B1] - d[o + B0]) * t;
      g[p + 11] = power;
    }
    uploadRange(this.buf, this.range, n * G);
  }

  clear() {
    this.count = 0;
    this.cursor = 0;
    this.geo.instanceCount = 0;
  }
}
