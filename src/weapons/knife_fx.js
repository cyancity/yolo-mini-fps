// 绿宝石涂装的粒子：刀身上飘出来的绿色微尘，掏刀、出刀、转刀时迸出的一小撮碎光。
// 一个实例化的加色小网格（最多 MAX 个面片，一次 draw call），挂在 holder 下面、矩阵取 holder 的逆，
// 所以粒子其实活在 holder 的父级坐标里（跟着镜头走，不跟着手走）：手挥过去，碎光留在原地慢慢散。
import * as THREE from 'three';
import { likeGear } from './knife_gem.js';

const MAX = 64;
// 每个粒子：位置 3、速度 3、年龄、寿命、半径、亮度、形状（0 圆点 / 1 四芒星）、阻力、随机相位
const S = 13, PX = 0, PY = 1, PZ = 2, VX = 3, VY = 4, VZ = 5, AGE = 6, TTL = 7, SIZE = 8, GAIN = 9, KIND = 10, DRAG = 11, SEED = 12;
const COLOR = [0.2, 1, 0.5];

const vert = /* glsl */ `
attribute vec4 aPos;
attribute vec4 aTint;
varying vec2 vQ;
varying vec4 vTint;
void main() {
  vQ = position.xy;
  vTint = aTint;
  // 面片朝镜头：模型视图矩阵的前两行就是镜头的右和上
  vec3 right = vec3(modelViewMatrix[0][0], modelViewMatrix[1][0], modelViewMatrix[2][0]);
  vec3 up = vec3(modelViewMatrix[0][1], modelViewMatrix[1][1], modelViewMatrix[2][1]);
  vec3 transformed = aPos.xyz + (right * position.x + up * position.y) * aPos.w;
  #include <project_vertex>
}`;

const frag = /* glsl */ `
varying vec2 vQ;
varying vec4 vTint;
void main() {
  vec2 a = abs(vQ);
  float r2 = dot(vQ, vQ);
  float core = exp(-r2 * 70.0);
  float dotv = core * 1.6 + exp(-r2 * 9.0) * 0.4;
  float star = core * 2.0 + exp(-(a.x * 3.2 + a.y * 30.0)) + exp(-(a.y * 3.2 + a.x * 30.0));
  float v = mix(dotv, star, vTint.a) * smoothstep(1.0, 0.6, max(a.x, a.y));
  gl_FragColor = vec4(vTint.rgb * v, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`;

const _m = new THREE.Matrix4(), _v = new THREE.Vector3();
const rnd = (a, b) => a + (b - a) * Math.random();

export class KnifeFx {
  // points：刀身上的出生点（spin 坐标，米），gem：makeEmerald 的返回值
  constructor(gear, model, holder, gem) {
    this.model = model;
    this.holder = holder;
    this.gem = gem;
    this.points = model.emitters;
    const n = this.points.length;
    this.at = new Float32Array(n * 3);   // 出生点在父级坐标里的位置
    this.vel = new Float32Array(n * 3);  // 和速度（上一帧差出来的）
    this.primed = false;
    this.p = new Float32Array(MAX * S);
    this.count = 0;
    this.active = false;
    this.flash = 0;
    this.accRest = this.accDraw = this.accSwing = this.accSpin = 0;
    this.swingT = 0;
    this.swingRate = 0;
    this.pending = 0;

    const geo = new THREE.InstancedBufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute([-1, -1, 0, 1, -1, 0, 1, 1, 0, -1, 1, 0], 3));
    geo.setIndex([0, 1, 2, 0, 2, 3]);
    this.aPos = new THREE.InstancedBufferAttribute(new Float32Array(MAX * 4), 4).setUsage(THREE.DynamicDrawUsage);
    this.aTint = new THREE.InstancedBufferAttribute(new Float32Array(MAX * 4), 4).setUsage(THREE.DynamicDrawUsage);
    geo.setAttribute('aPos', this.aPos);
    geo.setAttribute('aTint', this.aTint);
    geo.instanceCount = 0;
    this.material = likeGear(gear, new THREE.ShaderMaterial({
      vertexShader: vert, fragmentShader: frag, uniforms: {},
      blending: THREE.AdditiveBlending, transparent: true, depthWrite: false,
    }));
    this.mesh = new THREE.Mesh(geo, this.material);
    this.mesh.name = 'knifeMotes';
    this.mesh.frustumCulled = false;
    this.mesh.matrixAutoUpdate = false;
    this.mesh.visible = false;
    this.mesh.renderOrder = 2;
    holder.add(this.mesh);
  }

  setActive(on) {
    this.active = on;
    if (!on) this.clear();
  }

  clear() {
    this.count = 0;
    this.flash = 0;
    this.swingT = 0;
    this.pending = 0;
    this.primed = false;
    this.mesh.visible = false;
    this.mesh.geometry.instanceCount = 0;
    this.gem.uniforms.uGemFlash.value = 0;
  }

  // 一下亮：掏刀、出刀时让宝石自己也闪一下
  pulse(amount) { this.flash = Math.max(this.flash, amount); }

  // 出刀：接下来 seconds 秒里沿刀身撒 n 个碎光
  swing(n, seconds = 0.12) {
    if (!this.active) return;
    this.swingT = seconds;
    this.swingRate = n / seconds;
    this.pulse(0.8);
  }

  // 一次迸出 n 个（喷气切枪时刀是瞬间到手的）；等下一帧姿态摆好了再出
  burst(n) {
    if (!this.active) return;
    this.pending = n;
    this.pulse(0.7);
  }

  // 出生点在父级坐标里的位置和速度
  locate(dt) {
    const { holder, model, points, at, vel } = this;
    if (!holder.parent) return false;
    model.spin.updateWorldMatrix(true, false);
    _m.copy(holder.parent.matrixWorld).invert().multiply(model.spin.matrixWorld);
    const live = this.primed && dt > 1e-5;
    for (let i = 0; i < points.length; i++) {
      _v.fromArray(points[i]).applyMatrix4(_m);
      const j = i * 3;
      vel[j] = live ? (_v.x - at[j]) / dt : 0;
      vel[j + 1] = live ? (_v.y - at[j + 1]) / dt : 0;
      vel[j + 2] = live ? (_v.z - at[j + 2]) / dt : 0;
      at[j] = _v.x; at[j + 1] = _v.y; at[j + 2] = _v.z;
    }
    this.primed = true;
    return true;
  }

  spawn(i, vx, vy, vz, ttl, size, gain, kind, drag) {
    if (this.count >= MAX) return;
    const p = this.p, o = this.count++ * S, j = i * 3, k = 0.0015;
    p[o + PX] = this.at[j] + rnd(-k, k);
    p[o + PY] = this.at[j + 1] + rnd(-k, k);
    p[o + PZ] = this.at[j + 2] + rnd(-k, k);
    p[o + VX] = vx; p[o + VY] = vy; p[o + VZ] = vz;
    p[o + AGE] = 0; p[o + TTL] = ttl; p[o + SIZE] = size; p[o + GAIN] = gain; p[o + KIND] = kind; p[o + DRAG] = drag;
    p[o + SEED] = Math.random() * 6.283;
  }

  // 静置时的微尘：慢慢飘起来，飘一秒多就没了
  mote(i) {
    this.spawn(i, rnd(-0.012, 0.012), rnd(0.008, 0.03), rnd(-0.012, 0.012), rnd(0.9, 1.6), rnd(0.0012, 0.002), rnd(1.2, 2.2), 0, 0.8);
  }

  // 碎光：带着刀的一部分速度飞出去，很快被阻力拖住；star 是落在刀上的一个四芒星闪点
  spark(i, speed, star = false) {
    const j = i * 3, k = 0.16, vel = this.vel;
    if (star) return this.spawn(i, vel[j] * 0.05, vel[j + 1] * 0.05, vel[j + 2] * 0.05, rnd(0.12, 0.22), rnd(0.006, 0.01), rnd(1.6, 2.6), 1, 3);
    const a = Math.random() * 6.283, c = rnd(-1, 1), s = Math.sqrt(1 - c * c), v = speed * rnd(0.3, 1);
    this.spawn(i, vel[j] * k + Math.cos(a) * s * v, vel[j + 1] * k + Math.sin(a) * s * v + 0.02, vel[j + 2] * k + c * v,
      rnd(0.28, 0.6), rnd(0.0011, 0.0022), rnd(2.4, 4.2), 0, 5.5);
  }

  // 每帧：knife 是 Knife 实例，读它当前在做什么来决定撒多少
  update(dt, knife) {
    const u = this.gem.uniforms;
    u.uGemTime.value = (u.uGemTime.value + dt) % 1000;
    this.flash *= Math.exp(-5 * dt);
    u.uGemFlash.value = this.flash;
    if (!this.active) return;
    const mesh = this.mesh, holder = this.holder, n = this.points.length;
    if (this.locate(dt)) {
      const m = knife.move, up = knife.down.x < 0.5;
      for (; this.pending > 0; this.pending--) this.spark((Math.random() * n) | 0, 0.22, this.pending % 4 === 0);
      // 掏刀转那一圈
      if (knife.drawT > 0.1 && knife.drawT < 0.5 && knife.down.target === 0) {
        this.pulse(0.6);
        for (this.accDraw += 38 * dt; this.accDraw >= 1; this.accDraw--) this.spark((Math.random() * n) | 0, 0.16, Math.random() < 0.2);
      }
      if (this.swingT > 0) {
        this.swingT -= dt;
        for (this.accSwing += this.swingRate * dt; this.accSwing >= 1; this.accSwing--) this.spark((Math.random() * n) | 0, 0.2, Math.random() < 0.16);
      }
      // 检视转刀：转得越快撒得越多
      if (m && m.spin && knife.spinRate > 2) {
        this.pulse(0.5);
        for (this.accSpin += Math.min(34, knife.spinRate * 1.6) * dt; this.accSpin >= 1; this.accSpin--) this.spark((Math.random() * n) | 0, 0.12, Math.random() < 0.14);
      }
      // 静置：一秒两三粒；跑起来、收下去时不出
      if (up && knife.sprintT < 0.3) {
        for (this.accRest += 2.4 * dt; this.accRest >= 1; this.accRest--) this.mote((Math.random() * n) | 0);
      }
    }
    // 推进并压实：活着的往前挪
    const p = this.p, pos = this.aPos.array, tint = this.aTint.array;
    let w = 0;
    for (let i = 0; i < this.count; i++) {
      const o = i * S, age = p[o + AGE] + dt, ttl = p[o + TTL];
      if (age >= ttl) continue;
      const d = Math.exp(-p[o + DRAG] * dt), seed = p[o + SEED], q = w * S;
      const vx = p[o + VX] * d, vy = p[o + VY] * d, vz = p[o + VZ] * d;
      // 微尘飘的时候左右轻轻晃
      const sway = p[o + KIND] ? 0 : 0.012 * Math.sin(seed + age * 3.1);
      const x = p[o + PX] + (vx + sway) * dt, y = p[o + PY] + vy * dt, z = p[o + PZ] + (vz + sway * 0.6) * dt;
      p[q + PX] = x; p[q + PY] = y; p[q + PZ] = z; p[q + VX] = vx; p[q + VY] = vy; p[q + VZ] = vz;
      p[q + AGE] = age; p[q + TTL] = ttl; p[q + SIZE] = p[o + SIZE]; p[q + GAIN] = p[o + GAIN];
      p[q + KIND] = p[o + KIND]; p[q + DRAG] = p[o + DRAG]; p[q + SEED] = seed;
      // 亮度：很快亮起来，后半段淡掉，中间带一点闪烁
      const t = age / ttl, env = Math.min(1, t * 8) * (1 - t) * (1 - t) * 1.6;
      const g = p[q + GAIN] * env * (0.7 + 0.3 * Math.sin(seed * 7 + age * (16 + seed * 3)));
      const k = w * 4;
      pos[k] = x; pos[k + 1] = y; pos[k + 2] = z; pos[k + 3] = p[q + SIZE] * (p[q + KIND] ? 0.6 + 0.4 * Math.sin(Math.PI * t) : 1);
      tint[k] = COLOR[0] * g; tint[k + 1] = COLOR[1] * g; tint[k + 2] = COLOR[2] * g; tint[k + 3] = p[q + KIND];
      w++;
    }
    this.count = w;
    mesh.visible = w > 0;
    mesh.geometry.instanceCount = w;
    if (w > 0) {
      this.aPos.needsUpdate = this.aTint.needsUpdate = true;
      holder.updateMatrix();
      mesh.matrix.copy(holder.matrix).invert();
      mesh.matrixWorldNeedsUpdate = true;
    }
  }
}

// 预热：着色器第一次画的那一帧要编译，会卡一下。开局时给每种材质在镜头下面挂一个画不出东西的三角形，
// 画过几帧就藏起来，之后第一次掏刀、换涂装都不用再编译。arm() 让它们再画几帧（每局开头调一次，灯光配置变了也能跟上）
export function warmUp(camera, materials) {
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(new Float32Array(9), 3));
  geo.setAttribute('normal', new THREE.Float32BufferAttribute(new Float32Array(9), 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array(6), 2));
  const group = new THREE.Group();
  group.name = 'knifeWarm';
  let left = 0;
  const meshes = materials.map((mat) => {
    const mesh = new THREE.Mesh(geo, mat);
    mesh.frustumCulled = false;
    mesh.castShadow = false;
    mesh.layers.set(1);
    group.add(mesh);
    return mesh;
  });
  meshes[0].onAfterRender = () => { if (--left <= 0) group.visible = false; };
  group.visible = false;
  camera.add(group);
  return { group, arm(frames = 3) { left = frames; group.visible = true; } };
}
