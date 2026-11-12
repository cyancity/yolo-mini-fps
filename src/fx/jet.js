import { R, rr, TAU, D, spray, puff, chips } from './emit.js';
import { DUST, SPLASHY } from './slide.js';

const HIP = 0.95;        // 喷口离脚底的高度
const SIDE = 0.2;        // 两个喷口离行进轴线多远
const SUSTAIN = 0.15;    // 起步后跟着人继续喷多久
const STEP = 1 / 60;     // 持续段的发射间隔
const TELEPORT2 = 2.5 * 2.5; // 一步挪得比这远就是传送或重生，停喷
const RING_REACH = 1.5;  // 离地多高以内还会在地上吹出尘环
const LIGHT = 0x9cc8ff;
const EDGE_TIME = 0.12;  // 第一人称画面下角的汽和光条只在这段时间里出
const KEEP = 0.7;        // 它们带走人的速度的比例：先跟着镜头走，相对镜头慢慢往喷气那一侧漂出画面
const SPLAY = 0.45;      // 两个喷口往外撇：后撤时两股汽从准心两边过去，不糊在正中
const V = { cx: 0, cy: 0, cz: 0, fx: 0, fz: -1 }; // view() 的输出：镜头位置和水平朝向

// 玩家的喷气冲刺：开头一下蓝白的爆燃（光晕、火舌、几道快速的光条、一团汽），
// 接着跟着人再喷一小段，在身后拖出一条尾迹；贴地时喷口冲着地面吹出一圈尘，湿地上甩水。
// 第一人称里人横着、往前冲时喷口始终在镜头正下方或身后，看不见，
// 所以镜头就是这个人时，另在喷气那一侧的画面下角补跟着镜头走的汽和光条，只往外、往后漂，不进画面中间。
export class DashJet {
  constructor(fx) {
    this.fx = fx;
    this.ref = null;  // 调用方给的脚底位置；是玩家的 position 时持续段会跟着人走
    this.t = SUSTAIN;
    this.next = 0;
    this.dx = 0; this.dz = -1; this.by = 0;
    this.lx = 0; this.ly = 0; this.lz = 0;
  }

  start(pos, dirX, dirZ, grounded) {
    const fx = this.fx;
    let l = Math.hypot(dirX, dirZ);
    if (l < 1e-4) {
      // 没给方向：按镜头朝前
      const e = fx.camera?.matrixWorld.elements;
      dirX = e ? -e[8] : 0; dirZ = e ? -e[10] : -1;
      l = Math.hypot(dirX, dirZ) || 1;
    }
    this.dx = dirX / l; this.dz = dirZ / l;
    // 推力朝行进的反方向，略往下压；空中压得更多，像是在托住身体
    this.by = grounded ? -0.12 : -0.35;
    this.ref = pos;
    this.t = 0;
    this.next = STEP;
    this.lx = pos.x; this.ly = pos.y; this.lz = pos.z;

    this.emit(pos.x, pos.y, pos.z, 1, true);
    this.ring(pos, grounded);
    const bx = -this.dx, bz = -this.dz;
    fx.kickMuzzle(pos.x + bx * 0.5, pos.y + HIP - 0.1, pos.z + bz * 0.5, 45, true, LIGHT);
  }

  update(dt) {
    if (this.t >= SUSTAIN) return;
    this.t += dt;
    const p = this.ref;
    const mx = p.x - this.lx, my = p.y - this.ly, mz = p.z - this.lz;
    if (mx * mx + my * my + mz * mz > TELEPORT2) { this.t = SUSTAIN; return; }
    this.lx = p.x; this.ly = p.y; this.lz = p.z;
    const inv = dt > 0 ? 1 / dt : 0;
    while (this.next <= this.t && this.next < SUSTAIN) {
      const k = 1 - this.next / SUSTAIN;
      this.emit(p.x, p.y, p.z, k, false);
      if (this.next < EDGE_TIME) this.edge(p, mx * inv, my * inv, mz * inv, k);
      this.next += STEP;
    }
  }

  // 镜头是不是这个人的眼睛（预览页的侧面机位、死亡后的镜头都不是）。是的话把镜头的水平朝向写进 V
  view(x, y, z) {
    const cam = this.fx.camera;
    if (!cam) return false;
    const e = cam.matrixWorld.elements, hx = e[12] - x, hy = e[13] - y, hz = e[14] - z;
    if (hx * hx + hz * hz > 1 || hy < 0.8 || hy > 2.2) return false;
    const fx0 = -e[8], fz0 = -e[10], fl = Math.hypot(fx0, fz0);
    if (fl < 1e-3) return false;
    V.cx = e[12]; V.cy = e[13]; V.cz = e[14]; V.fx = fx0 / fl; V.fz = fz0 / fl;
    return true;
  }

  // 第一人称画面下角的汽和光条。v：人这一帧的速度（量出来的）
  edge(p, vx, vy, vz, k) {
    const fx = this.fx;
    if (!this.view(p.x, p.y, p.z)) return;
    const cx = V.cx, cy = V.cy, cz = V.cz, fx0 = V.fx, fz0 = V.fz, rx = -fz0, rz = fx0;
    // 喷气方向在镜头里的前后（bf > 0 是朝前喷，即后撤）、左右分量
    const bx = -this.dx, bz = -this.dz, bf = bx * fx0 + bz * fz0, br = bx * rx + bz * rz;
    const st = fx.streaks;
    for (let s = -1; s <= 1; s += 2) {
      // 喷气偏向一侧时只出那一侧；朝正前、正后喷时两侧都出
      if (Math.abs(br) > 0.35 ? Math.sign(br) !== s : R() > 0.7) continue;
      // 右下角是第一人称武器，右边的抬高到武器上方的画面右缘
      const f = rr(0.9, 1.15), l = s > 0 ? rr(0.75, 0.95) : rr(0.55, 0.8), down = s > 0 ? rr(0.2, 0.38) : rr(0.45, 0.65);
      const px = cx + fx0 * f + rx * s * l, py = cy - down, pz = cz + fz0 * f + rz * s * l;
      // 往前喷时多往外甩，免得往画面中间飘
      const out = rr(1.5, 3) + Math.max(0, bf) * 3, rel = rr(2, 4) * (1 - Math.max(0, bf) * 0.6);
      const ux = vx * KEEP + bx * rel + rx * s * out, uz = vz * KEEP + bz * rel + rz * s * out, uy = vy * KEEP + rr(-0.3, 0.2);
      const j = puff(fx, px, py, pz, ux, uy, uz, rr(0.14, 0.22), 0.08, rr(0.25, 0.4), 0.28 * (0.4 + 0.6 * k), 0.74, 0.78, 0.84, 0.5, 0.15);
      // 负热度：夜里多吃环境光（见 billboards.js），暗处也看得见这团汽
      fx.puffs.heat(j, -2, 1);
      for (let n = 0; n < 2; n++) {
        const i = st.spark(px, py + rr(-0.08, 0.1), pz, ux * rr(1, 1.2), uy, uz * rr(1, 1.2), rr(0.1, 0.16), 0.0016, 0.025, -1e9, 0, 0.5, 0);
        st.color(i, 0.8, 0.9, 1, rr(5, 9) * (0.4 + 0.6 * k), 0.3, 0.5, 1);
      }
      const g = fx.glow.emit(px, py, pz, ux, uy, uz, 0.08, 0.12, 0.3, 1, 4);
      fx.glow.tint(g, 0.25 * k, 0.45 * k, 1 * k, 0.05, 0.1, 0.3);
    }
  }

  clear() {
    this.t = SUSTAIN;
    this.ref = null;
  }

  // 两个喷口各喷一次。k：强度（持续段逐渐减弱）；burst：起步那一下
  emit(x, y, z, k, burst) {
    const fx = this.fx, g = fx.glow, st = fx.streaks;
    const dx = this.dx, dz = this.dz, sx = -dz, sz = dx;
    const floorY = fx.floorAt(x, y + 0.3, z);
    // 第一人称：火舌就在镜头正下方，看过去是两根贴脸的白刺，不画；朝视线方向喷的汽淡一些
    const own = this.view(x, y, z), toView = own ? Math.max(0, -dx * V.fx - dz * V.fz) : 0;
    for (let side = -1; side <= 1; side += 2) {
      const nx = x + sx * SIDE * side - dx * 0.15, ny = y + HIP, nz = z + sz * SIDE * side - dz * 0.15;
      // 推力方向：行进的反方向，每个喷口往自己那一侧撇一点
      let bx = -dx + sx * side * SPLAY, by = this.by, bz = -dz + sz * side * SPLAY;
      const bl = 1 / Math.hypot(bx, by, bz);
      bx *= bl; by *= bl; bz *= bl;
      let i;
      if (burst) {
        // 喷口上一团白热的核和一圈淡蓝的光晕
        i = g.emit(nx, ny, nz, bx * 1.5, by * 1.5, bz * 1.5, 0.1, 0.07, 0.3, 1, 4);
        g.tint(i, 6, 9, 14, 1.2, 2.2, 5);
        i = g.emit(nx + bx * 0.3, ny + by * 0.3, nz + bz * 0.3, bx * 3, by * 3, bz * 3, 0.2, 0.35, 0.9, 1, 4);
        g.tint(i, 0.9, 1.4, 2.6, 0.1, 0.22, 0.6);
      }
      // 火舌：一条主的，起步时再加两条散开的
      const tongues = own ? 0 : burst ? 3 : 1;
      for (let t = 0; t < tongues; t++) {
        spray(bx, by, bz, t === 0 ? 0.05 : 0.22);
        const len = (t === 0 ? rr(0.6, 0.9) : rr(0.3, 0.5)) * (0.6 + 0.4 * k);
        i = st.dash(nx, ny, nz, D.x * len, D.y * len, D.z * len, burst ? 0.09 : 0.055, (t === 0 ? 0.05 : 0.03) * (0.6 + 0.4 * k));
        st.color(i, 0.72, 0.86, 1, (burst ? 16 : 12) * (0.3 + 0.7 * k));
        st.jet(i);
      }
      // 快速的光条：贴着推力方向窜出去，很快冷成暗蓝
      const n = burst ? 5 : 1 + (R() < k ? 1 : 0);
      for (let s = 0; s < n; s++) {
        spray(bx, by, bz, 0.18);
        const v = rr(14, 26);
        i = st.spark(nx, ny, nz, D.x * v, D.y * v, D.z * v, rr(0.1, 0.2), rr(0.0022, 0.0034), rr(0.02, 0.03), floorY, 1.5, 2.5, 0);
        st.color(i, 0.8, 0.9, 1, rr(8, 14) * (0.4 + 0.6 * k), 0.25, 0.45, 1);
      }
      // 汽：从喷口吐出来马上被拖住，慢慢摊开散掉
      const m = burst ? 4 : 1;
      for (let s = 0; s < m; s++) {
        spray(bx, by, bz, 0.35);
        const v = rr(3, 6);
        puff(fx, nx + bx * 0.15, ny + by * 0.15, nz + bz * 0.15, D.x * v, D.y * v + 0.25, D.z * v,
          rr(0.6, 1), 0.08, rr(0.45, 0.7), (burst ? 0.32 : 0.2) * (1 - 0.6 * toView), 0.74, 0.78, 0.84, 5, 0.04);
      }
    }
  }

  // 喷口冲着身后的地面：贴地吹出一圈尘，湿地上甩出水和水雾。离地 RING_REACH 以内都有，越高越弱
  ring(pos, grounded) {
    const fx = this.fx, st = fx.streaks;
    const bx = -this.dx, bz = -this.dz;
    const x = pos.x + bx * 0.55, z = pos.z + bz * 0.55;
    const floor = fx.floorAt(x, pos.y + 0.1, z);
    const h = pos.y - floor;
    const k = grounded ? 1 : Math.max(0, 1 - h / RING_REACH);
    if (k <= 0.05) return;
    const surface = fx.phys?.groundSurface || 'asphalt';
    const y = floor + 0.03;
    if (SPLASHY[surface] === 1 && fx.wetAt(x, floor, z)) {
      const n = Math.round(rr(10, 14) * k);
      for (let i = 0; i < n; i++) {
        const a = R() * TAU, cx = Math.cos(a), cz = Math.sin(a);
        // 顺着推力那一侧甩得远
        const along = Math.max(0, cx * bx + cz * bz), v = rr(2.5, 5.5) * (0.5 + 0.7 * along) * (0.6 + 0.4 * k);
        const j = st.spark(x + cx * 0.15, y, z + cz * 0.15, cx * v, rr(1, 2.6) * (0.6 + 0.4 * k), cz * v,
          rr(0.3, 0.5), rr(0.0035, 0.006), rr(0.02, 0.032), floor, 9.8, 0.6, 0);
        st.color(j, 0.75, 0.85, 1, rr(2.4, 4.2));
        st.lit(j);
      }
      for (let i = 0; i < 7; i++) {
        const a = (i / 7) * TAU + rr(-0.4, 0.4), cx = Math.cos(a), cz = Math.sin(a);
        const along = Math.max(0, cx * bx + cz * bz), v = rr(2.2, 3.8) * (0.6 + 0.6 * along) * k;
        puff(fx, x + cx * 0.2, y + 0.06, z + cz * 0.2, cx * v, rr(0.15, 0.4), cz * v,
          rr(0.7, 1.1), 0.12, rr(0.55, 0.85), 0.3 * k, 0.8, 0.86, 0.94, 4, 0.06);
      }
      return;
    }
    const c = DUST[surface in DUST ? surface : 'concrete'];
    if (!c) return;
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * TAU + rr(-0.35, 0.35), cx = Math.cos(a), cz = Math.sin(a);
      const along = Math.max(0, cx * bx + cz * bz), v = rr(2.6, 4.2) * (0.6 + 0.6 * along) * k;
      const p = puff(fx, x + cx * 0.2, y + 0.05, z + cz * 0.2, cx * v, rr(0.1, 0.35), cz * v,
        rr(0.7, 1.1), 0.1, c[3] * rr(0.9, 1.3) + 0.25, Math.min(0.5, c[4] * 1.3) * k, c[0], c[1], c[2], 3.5, 0.08);
      fx.puffs.motion(p, -0.05, 3.5, R() * TAU, rr(-0.5, 0.5), 1, 0.08);
    }
    if (surface === 'gravel' || surface === 'concrete') {
      chips(fx, x, y, z, bx * 0.7, 0.71, bz * 0.7, 2 + ((R() * 3) | 0), 2.4, 0.01, c[0] * 0.8, c[1] * 0.8, c[2] * 0.8);
    }
  }
}
