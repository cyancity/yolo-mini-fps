import { MAP } from '../world/plan.js';

// 无人机的导航数据和难度参数。

const CELL = 0.5;
// 无人机的活动范围：整张图的露天部分（堆场、街道、卸货场）和各处屋面上空，只比地图边界收一点。
// 室内进不去靠的是高度场：屋面板、门楣都登记成那几格的障碍顶面，无人机只能从屋面上方加净空飞过去
export const DRONE_BOUNDS = { x0: MAP.x0 + 1.5, x1: MAP.x1 - 1.5, z0: MAP.z0 + 1.5, z1: MAP.z1 - 1.5 };
const OPEN = 2.2; // 障碍顶面不高于这个的格子算露天（地面、月台、路沿、矮车）
const TALL = 4; // 顶面高于这个的算楼、雨棚、高箱堆：贴着它们的露天格就是“门口”候选

export function clampBounds(v) {
  v.x = Math.min(DRONE_BOUNDS.x1, Math.max(DRONE_BOUNDS.x0, v.x));
  v.z = Math.min(DRONE_BOUNDS.z1, Math.max(DRONE_BOUNDS.z0, v.z));
  return v;
}

// 把碰撞体光栅化成高度场：每格存“这里最高的障碍顶面”，无人机只在它上方飞，于是不会穿箱子。
// 细高的杆子不进高度场（否则每次路过都得翻过十米灯杆），单独记下来做水平绕行。
export class NavGrid {
  constructor(phys, { x0 = MAP.x0, x1 = MAP.x1, z0 = MAP.z0, z1 = MAP.z1, margin = 0.75, outside = 11 } = {}) {
    this.x0 = x0;
    this.z0 = z0;
    this.nx = Math.ceil((x1 - x0) / CELL);
    this.nz = Math.ceil((z1 - z0) / CELL);
    this.h = new Float32Array(this.nx * this.nz);
    this.outside = outside; // 网格之外是远景楼群，按这个高度当障碍
    this.poles = [];
    const m2 = margin * margin;
    for (const b of phys?.boxes || []) {
      if (b.playerOnly) continue;
      if (b.hx < 0.35 && b.hz < 0.35 && b.top > 4) {
        this.poles.push({ x: b.cx, z: b.cz, r: Math.max(b.hx, b.hz), top: b.top });
        continue;
      }
      const ex = Math.abs(b.c) * b.hx + Math.abs(b.s) * b.hz + margin;
      const ez = Math.abs(b.s) * b.hx + Math.abs(b.c) * b.hz + margin;
      this.raster(b.cx - ex, b.cx + ex, b.cz - ez, b.cz + ez, b.top, (x, z) => {
        const dx = x - b.cx, dz = z - b.cz;
        const px = Math.max(Math.abs(dx * b.c - dz * b.s) - b.hx, 0), pz = Math.max(Math.abs(dx * b.s + dz * b.c) - b.hz, 0);
        return px * px + pz * pz < m2;
      });
    }
    for (const c of phys?.cyls || []) {
      if (c.r < 0.5 && c.y1 > 4) {
        this.poles.push({ x: c.x, z: c.z, r: c.r, top: c.y1 });
        continue;
      }
      const rr = c.r + margin;
      this.raster(c.x - rr, c.x + rr, c.z - rr, c.z + rr, c.y1, (x, z) => (x - c.x) ** 2 + (z - c.z) ** 2 < rr * rr);
    }
    this.findDoors();
  }

  raster(xa, xb, za, zb, top, inside) {
    const i0 = Math.max(0, Math.floor((xa - this.x0) / CELL)), i1 = Math.min(this.nx - 1, Math.floor((xb - this.x0) / CELL));
    const j0 = Math.max(0, Math.floor((za - this.z0) / CELL)), j1 = Math.min(this.nz - 1, Math.floor((zb - this.z0) / CELL));
    for (let j = j0; j <= j1; j++) {
      for (let i = i0; i <= i1; i++) {
        const k = j * this.nx + i;
        if (this.h[k] < top && inside(this.x0 + (i + 0.5) * CELL, this.z0 + (j + 0.5) * CELL)) this.h[k] = top;
      }
    }
  }

  // 楼外贴墙的露天格（每米取一个）：玩家躲进室内时，无人机在这些点里找一个能隔着门洞、窗洞看见他的位置悬停
  findDoors() {
    const { nx, nz, h } = this, pts = [], R = 4; // 离高处 R 格（2 米）以内
    for (let j = 1; j < nz - 1; j += 2) {
      for (let i = 1; i < nx - 1; i += 2) {
        if (h[j * nx + i] > OPEN) continue;
        let near = false;
        for (let dj = -R; dj <= R && !near; dj++) {
          const jj = j + dj;
          if (jj < 0 || jj >= nz) continue;
          for (let di = -R; di <= R; di++) {
            const ii = i + di;
            if (ii >= 0 && ii < nx && h[jj * nx + ii] > TALL) { near = true; break; }
          }
        }
        if (near) pts.push(this.x0 + (i + 0.5) * CELL, this.z0 + (j + 0.5) * CELL);
      }
    }
    this.doors = new Float32Array(pts);
    this.doorN = pts.length / 2;
  }

  // 这一点下方的障碍顶面高度（空地为 0）
  floor(x, z) {
    const i = Math.floor((x - this.x0) / CELL), j = Math.floor((z - this.z0) / CELL);
    if (i < 0 || j < 0 || i >= this.nx || j >= this.nz) return this.outside;
    return this.h[j * this.nx + i];
  }

  // 头顶有屋面、雨棚或者四周全是高墙：无人机从正上方看不见、也下不去
  covered(p) { return this.floor(p.x, p.z) > p.y + 2.2; }
}

// level 从 1 起。数值都在这里调。
export function levelParams(level = 1) {
  const l = Math.max(0, level - 1);
  const c = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
  return {
    level,
    hp: c(60 + 10 * l, 60, 100),
    speed: c(6.5 + 0.6 * l, 6.5, 9.5), // 机动速度 m/s
    accel: c(9 + 1.2 * l, 9, 15), // 水平加速度 m/s²
    burst: c(4 + Math.floor(l / 2), 4, 6), // 每次点射发数
    reaction: c(0.95 - 0.11 * l, 0.4, 0.95), // 连续看见玩家多久后开始预警
    cooldown: c(2.3 - 0.22 * l, 1.1, 2.3), // 同一架两次点射的间隔
    spread: c(0.032 - 0.001 * l, 0.025, 0.032), // 弹道散布（弧度）
    lead: c(0.5 + 0.06 * l, 0.5, 0.85), // 提前量给到几成
    lag: c(0.14 - 0.01 * l, 0.08, 0.14), // 瞄准点跟随的时间常数：越大越容易被横向跑动甩开
    interval: c(2.2 - 0.13 * l, 1.3, 2.2), // 全队相邻两次点射的最小间隔：总火力由它封顶，架数多只是角度多
    dive: c(0.22 + 0.03 * l, 0.22, 0.4), // 点射后俯冲掠过的概率
  };
}
