import * as THREE from 'three';
import { MAX_CLOUDS } from './common.js';
import { R, rr, TAU } from './emit.js';

const PUFFS = 40;        // 每团的烟团数
const G = 12;            // 和 Billboards 的 GPU 实例格式一致：位置+半边长、颜色+不透明度、转角/图集格/宽高比/热度
const P = 14;            // 每个烟团的静态参数
const OX = 0, OY = 1, OZ = 2, SIZE = 3, ROT = 4, ROTV = 5, FRAME = 6, SHADE = 7, PHASE = 8, WOB = 9,
  FADE = 10, ALPHA = 11, BURST = 12, ASPECT = 13;
const SKIRT = 6;         // 其中几团压扁贴地：大烟团的下半截被软粒子在地面上淡掉，靠它们把烟脚补实
const THIN = 1.2;        // 最后这么多秒变稀
const PEAK = 6;          // 给加色特效算透射：正穿烟芯一整条视线的光学厚度。穿过烟芯 4 米透过来约 1.4%，离中心 2.5 米约 8%
const SIGMA = 0.45;      // 高斯团的标准差（× radius），和看得见的烟芯差不多大
const TRIES = 5;         // 烟团被墙挡住时换几次方向
const ALBEDO = [0.78, 0.79, 0.8];
const NIGHT_BOOST = 2;   // 夜里环境光的补光倍数（白天着色器自己收掉），写成负的热度

const _o = new THREE.Vector3();
const _d = new THREE.Vector3();

// 烟雾弹的烟。每团 40 个大烟团，位置、大小、浓淡都由寿命算出来，不进通用烟池（不会被弹着点的尘顶掉，
// 也不挤占它们），但和通用烟一起排序、一个 draw call。另外把每团当成一个高斯团交给 LightRig，
// 加色的特效（曳光、火花、枪口焰、雨）穿过它时按厚度压暗。
export class SmokeClouds {
  constructor(fx) {
    this.fx = fx;
    this.cap = MAX_CLOUDS * PUFFS;
    this.clouds = Array.from({ length: MAX_CLOUDS }, () => ({
      alive: false, x: 0, y: 0, z: 0, base: 0, r: 1, age: 0, life: 1,
    }));
    this.puff = new Float32Array(this.cap * P);
    this.ext = { count: 0, gpu: new Float32Array(this.cap * G) };
  }

  get active() {
    let n = 0;
    for (const c of this.clouds) if (c.alive) n++;
    return n;
  }

  // 在 (x, y, z) 炸开（一般是落地的罐子）。返回占用的槽位
  spawn(x, y, z, radius, life) {
    let k = 0, best = Infinity;
    for (let i = 0; i < MAX_CLOUDS; i++) {
      const c = this.clouds[i];
      if (!c.alive) { k = i; break; }
      // 都占着：顶掉剩余寿命最短的那团
      const left = c.life - c.age;
      if (left < best) { best = left; k = i; }
    }
    const fx = this.fx, c = this.clouds[k];
    const floor = fx.floorAt(x, y + 0.3, z);
    // 空中炸开的（扔上屋檐卡住之类）就地铺开，不往下找地面
    const base = y - floor < 2.5 ? floor : y - 0.5;
    c.alive = true;
    c.x = x; c.z = z; c.base = base; c.y = Math.max(y, base + 0.12);
    c.r = radius; c.age = 0; c.life = Math.max(life, THIN + 0.4);

    // 烟团的落点：地面上一个扁穹顶，越往中心越密；被墙和顶棚挡住的换个方向，实在不行就收在墙前，
    // 门口炸开的烟顺着门洞两边铺，不会穿墙漏到隔壁
    const phys = fx.phys, H = Math.min(1, radius * 0.3);
    _o.set(x, base + H, z);
    for (let i = 0; i < PUFFS; i++) {
      const q = (k * PUFFS + i) * P, skirt = i < SKIRT;
      const rf = skirt ? rr(0.15, 0.85) : Math.pow(R(), 0.75);
      const hs = skirt ? radius * rr(0.2, 0.26) : radius * rr(0.36, 0.5) * (1 - 0.25 * rf);
      let tx = 0, ty = 0, tz = 0, bestFree = -1;
      for (let t = 0; t < TRIES; t++) {
        const a = R() * TAU, hr = rf * radius * 0.78;
        const dome = radius * 0.72 * Math.sqrt(Math.max(0, 1 - (hr / radius) ** 2));
        const py = skirt ? base + hs * rr(0.6, 0.8) : base + 0.35 * hs + R() * dome * 0.85;
        const px = x + Math.cos(a) * hr, pz = z + Math.sin(a) * hr;
        _d.set(px - _o.x, py - _o.y, pz - _o.z);
        const dist = _d.length();
        let free = dist;
        if (phys && dist > 0.05) {
          _d.multiplyScalar(1 / dist);
          const hit = phys.raycast(_o, _d, dist + hs * 0.35);
          if (hit) free = Math.max(0.15, hit.dist - Math.min(0.6, hs * 0.35));
        }
        const f = Math.min(1, free / Math.max(dist, 1e-3));
        if (f > bestFree) {
          bestFree = f;
          tx = _o.x + (px - _o.x) * f; ty = _o.y + (py - _o.y) * f; tz = _o.z + (pz - _o.z) * f;
        }
        if (f > 0.7) break;
      }
      const p = this.puff;
      p[q + OX] = tx - x; p[q + OY] = ty - c.y; p[q + OZ] = tz - z;
      p[q + SIZE] = hs;
      // 贴地的那几团横着摆，只微微转
      p[q + ROT] = skirt ? rr(-0.12, 0.12) : R() * TAU; p[q + ROTV] = skirt ? rr(-0.02, 0.02) : rr(-0.12, 0.12);
      p[q + ASPECT] = skirt ? rr(1.8, 2.3) : 1;
      p[q + FRAME] = (R() * 4) | 0;
      // 假的自阴影：贴地、靠里的暗，顶上的亮
      const up = Math.min(1, (ty - base) / Math.max(radius * 0.7, 0.5));
      p[q + SHADE] = (0.55 + 0.55 * up + 0.1 * rf) * rr(0.92, 1.06);
      p[q + PHASE] = R() * TAU; p[q + WOB] = rr(0.12, 0.32) * radius / 4.2;
      p[q + FADE] = rr(0.55, 1);
      p[q + ALPHA] = 1 - 0.3 * rf;
      p[q + BURST] = rr(0.1, 0.16);
    }
    return k;
  }

  update(dt) {
    for (const c of this.clouds) {
      if (!c.alive) continue;
      c.age += dt;
      if (c.age >= c.life) c.alive = false;
    }
  }

  // 绘制前：按寿命算出每个烟团写进 ext，并把烟团的球（视空间）和浓度交给加色特效
  flush(camera, uniforms) {
    const g = this.ext.gpu, p = this.puff;
    const spheres = uniforms.uClouds.value, dens = uniforms.uCloudK.value;
    const e = camera ? camera.matrixWorldInverse.elements : null;
    let n = 0;
    for (let k = 0; k < MAX_CLOUDS; k++) {
      const c = this.clouds[k];
      if (!c.alive) { dens[k] = 0; continue; }
      const age = c.age, life = c.life, r = c.r;
      const fin = Math.min(1, age / 0.06);
      const outC = Math.min(1, Math.max(0, (life - age) / THIN));
      const grow = 1 + 0.035 * age;
      for (let i = 0; i < PUFFS; i++) {
        const q = (k * PUFFS + i) * P;
        const out = Math.min(1, Math.max(0, (life - age) / (THIN * p[q + FADE])));
        const a = p[q + ALPHA] * fin * Math.pow(out, 1.5);
        if (a <= 0.004) continue;
        const b = p[q + BURST], ex = 1 - Math.exp(-age / b), es = 1 - Math.exp(-age / (b * 1.4));
        // 慢慢翻滚：每个烟团绕着落点小幅晃，整团微微往外胀、往上飘，散的时候飘得更快
        const ph = p[q + PHASE], w = p[q + WOB] * ex, thin = 1 - out;
        const wx = Math.sin(age * 0.7 + ph) * w, wy = Math.sin(age * 0.53 + ph * 1.3) * w * 0.5, wz = Math.cos(age * 0.61 + ph * 0.7) * w;
        const o = n * G;
        g[o] = c.x + p[q + OX] * ex * grow + wx;
        g[o + 1] = c.y + p[q + OY] * ex + wy + 0.035 * age + 0.5 * thin;
        g[o + 2] = c.z + p[q + OZ] * ex * grow + wz;
        g[o + 3] = p[q + SIZE] * (0.22 + 0.78 * es) * grow * (1 + 0.3 * thin);
        const s = p[q + SHADE];
        g[o + 4] = ALBEDO[0] * s; g[o + 5] = ALBEDO[1] * s; g[o + 6] = ALBEDO[2] * s;
        g[o + 7] = a;
        g[o + 8] = p[q + ROT] + p[q + ROTV] * age; g[o + 9] = p[q + FRAME]; g[o + 10] = p[q + ASPECT]; g[o + 11] = -NIGHT_BOOST;
        n++;
      }
      // 透射用的高斯团：中心在穹顶的重心附近，跟着炸开一起长大
      const sr = r * SIGMA * (0.2 + 0.8 * (1 - Math.exp(-age / 0.15))), cy = c.base + r * 0.3;
      dens[k] = PEAK * fin * Math.pow(outC, 1.5);
      if (e) {
        spheres[k].set(
          e[0] * c.x + e[4] * cy + e[8] * c.z + e[12],
          e[1] * c.x + e[5] * cy + e[9] * c.z + e[13],
          e[2] * c.x + e[6] * cy + e[10] * c.z + e[14], sr);
      } else dens[k] = 0;
    }
    this.ext.count = n;
  }

  clear() {
    for (const c of this.clouds) c.alive = false;
    this.ext.count = 0;
  }
}
