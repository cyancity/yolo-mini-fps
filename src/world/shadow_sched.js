// 阴影图的刷新调度：按时间，不按帧。
// 原来每帧固定重画 perFrame 张，帧率越高画得越多（144 帧时下午的太阳每秒重画 144 次整张图）。
// 这里每盏灯有自己的刷新间隔，60 帧时和原来一样；只有投影范围里有东西在动的灯才排进来，静止的灯不重画。
const BASE_HZ = 10;  // perFrame 每一档 = 权重为 1 的灯每秒刷新 10 次（6 盏灯、60 帧、每帧 perFrame 张，正好是这个数）
const MAX_HZ = 60;   // 单盏灯的上限：下午的太阳权重是 3，高画质算出来正好 60
const HOLD = 0.3;    // 范围里最后一次有东西动过之后，这盏灯还要接着刷新这么久（停下来的那个姿势得画进去）
const IDLE = 1.5;    // 没有东西在动的灯每隔这么久轮到一盏兜底重画，防着有没认出来的变化
const RESCAN = 1;    // 多久重新找一遍场景里会投影的网格（池子里的敌人、后加载的靶场）
const REACH = 2;     // 物体按这个半径算进灯的照射范围（米）

const shown = (o) => {
  for (; o; o = o.parent) if (!o.visible) return false;
  return true;
};

export class ShadowSchedule {
  constructor(scene) {
    this.scene = scene;
    this.items = [];
    this.time = 0;
    this.rescanT = 0;
    this.idleT = 0;
    this.idleAt = 0;
    this.next = new Float64Array(0); // 每盏灯下一次该刷新的时刻
    this.hot = new Float64Array(0);  // 每盏灯「范围里有东西在动」的状态保持到什么时刻
    this.drawn = 0;                  // 累计排了多少张，量刷新率用
  }

  // 场景里所有会投影的网格。静态的合批网格也在里面，它们的位姿不变，每帧只多比较一个数
  collect() {
    const old = new Map(this.items.map((m) => [m.o, m]));
    const items = [];
    this.scene.traverse((o) => {
      if (!o.isMesh || !o.castShadow) return;
      const had = old.get(o);
      if (had) { items.push(had); return; }
      // 带骨骼的看骨头（人站着不走，手脚也在动）；每三根取一根，够认出动没动
      const bones = o.isSkinnedMesh && o.skeleton ? o.skeleton.bones.filter((_, i) => i % 3 === 0) : null;
      items.push({ o, bones, sig: NaN, on: false, x: 0, y: 0, z: 0 });
    });
    this.items = items;
  }

  // 位姿的指纹：变了就是动了。顺手记下它在哪
  sign(m) {
    const o = m.o;
    let e = o.matrixWorld.elements, s = 0;
    if (m.bones) {
      for (const b of m.bones) { const k = b.matrixWorld.elements; s += k[12] + 1.37 * k[13] + 1.91 * k[14] + 0.61 * k[0] + 0.43 * k[5]; }
      e = m.bones[0].matrixWorld.elements;
    } else {
      s = e[12] + 1.37 * e[13] + 1.91 * e[14] + 0.71 * e[0] + 0.53 * e[5] + 0.31 * e[10] + 0.17 * e[1] + 0.13 * e[6];
      // 实例化网格（靶子）动的是实例矩阵
      if (o.isInstancedMesh) s += o.instanceMatrix.version * 7.3 + o.count;
    }
    m.x = e[12]; m.y = e[13]; m.z = e[14];
    return s;
  }

  // 这一点在不在这盏灯照得到的范围里。平行光罩着全图；实例化网格不知道哪个实例动了，按全图算
  reaches(light, m) {
    if (!light.isSpotLight || m.o.isInstancedMesh) return true;
    const p = light.position, q = light.target.position;
    const vx = m.x - p.x, vy = m.y - p.y, vz = m.z - p.z, d = Math.hypot(vx, vy, vz);
    if (d > (light.distance || 1e9) + REACH) return false;
    if (d < REACH * 1.5) return true;
    const ax = q.x - p.x, ay = q.y - p.y, az = q.z - p.z, al = Math.hypot(ax, ay, az) || 1;
    const cos = (vx * ax + vy * ay + vz * az) / (d * al);
    return cos > Math.cos(Math.min(Math.PI, light.angle + Math.asin(REACH / d)));
  }

  watch(dt, lights) {
    if ((this.rescanT -= dt) <= 0) { this.collect(); this.rescanT = RESCAN; }
    const until = this.time + HOLD, hot = this.hot, n = lights.length;
    for (const m of this.items) {
      const on = shown(m.o);
      // 藏着的不用看；刚藏起来的那一下（尸体收走、敌人回池）影子要跟着消失，按原来的位置算一次
      if (!on && !m.on) continue;
      const s = on ? this.sign(m) : NaN;
      if (on === m.on && s === m.sig) continue;
      m.on = on;
      m.sig = s;
      for (let i = 0; i < n; i++) if (this.reaches(lights[i], m)) hot[i] = until;
    }
  }

  // 每帧调用。weight：各灯的刷新权重；perFrame：画质档（一帧最多排几张）；busy：这一帧已经有别的重活（地面倒影），
  // 只放行拖得久的那一张。返回这一帧排了几张
  update(dt, lights, weight, perFrame, busy = false) {
    const n = lights.length;
    if (this.next.length !== n) {
      this.next = new Float64Array(n);
      this.hot = new Float64Array(n);
      // 错开相位：同一档刷新率的灯不挤在同一帧
      for (let i = 0; i < n; i++) this.next[i] = this.time + (i / n) / (BASE_HZ * Math.max(1, perFrame));
    }
    if (dt <= 0) return 0;
    this.time += dt;
    this.watch(dt, lights);
    const t = this.time, next = this.next, hot = this.hot;
    let done = 0;
    for (let k = 0, cap = busy ? 1 : perFrame; k < cap; k++) {
      let best = -1, most = busy ? 0.5 : 0, gap = 0;
      for (let i = 0; i < n; i++) {
        if (t >= hot[i]) continue;
        const iv = 1 / Math.min(MAX_HZ, BASE_HZ * perFrame * Math.min(3, Math.max(0.02, weight[i])));
        const late = (t - next[i]) / iv;
        if (late >= most) { most = late; best = i; gap = iv; }
      }
      if (best < 0) break;
      lights[best].shadow.needsUpdate = true;
      // 平时按自己的节拍走（保住相位）；隔了很久才又动起来的，从现在重新起拍
      next[best] = Math.max(next[best] + gap, t + gap * 0.5);
      done++;
    }
    this.idleT += dt;
    if (!done && !busy && this.idleT >= IDLE) {
      this.idleT = 0;
      for (let k = 0; k < n; k++) {
        const i = (this.idleAt + k) % n;
        if (t < hot[i]) continue;
        lights[i].shadow.needsUpdate = true;
        this.idleAt = i + 1;
        done++;
        break;
      }
    }
    this.drawn += done;
    return done;
  }
}
