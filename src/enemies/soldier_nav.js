import { MAP } from '../world/plan.js';

// 人形敌人的寻路网格：只读 level.phys 的盒子和圆柱，不需要手工标注。
// 每个格子（CELL 米见方）可以有多层“落脚点”（地面、月台、二层、楼顶……），一个落脚点就是一个节点。
// 规则照抄 PhysicsWorld 的 groundHeight / resolve：从高度 y 走进相邻格，新的落脚高度是该格里不高于 y + STEP 的最高顶面；
// 往下掉超过 DROP 就不是“走”了：落差不超过 FALL 的连一条单向的下落边（月台边、陡梯段），只能从高往低；
// 落脚点上身体（半径 R、身高 HEIGHT）不许碰到任何高出台阶的碰撞体。
export const CELL = 0.5;
export const NAV = { R: 0.3, RG: 0.24, STEP: 0.42, DROP: 0.5, FALL: 1.2, HEIGHT: 1.82 };
const { R, RG, STEP, DROP, FALL, HEIGHT } = NAV;
// 八个方向：0 +x，1 +z，2 -x，3 -z，4 (+x,+z)，5 (-x,+z)，6 (-x,-z)，7 (+x,-z)
export const DX = [1, 0, -1, 0, 1, -1, -1, 1];
export const DZ = [0, 1, 0, -1, 1, 1, -1, -1];
const DIAG_A = [0, 2, 2, 0], DIAG_B = [1, 1, 3, 3];
// 挡在旁边的东西顶面离脚底不超过这个高度就算矮掩体（蹲下藏、站起来就能打）
export const LOW_COVER = 1.35;
const CLEAR = -1e9;

export class SoldierNav {
  constructor(phys) {
    this.phys = phys;
    this.count = -1;
    this.ms = 0;
    this.builds = 0;
    this.walkable = 0;
    this.x0 = MAP.x0;
    this.z0 = MAP.z0;
    this.nx = Math.ceil((MAP.x1 - MAP.x0) / CELL);
    this.nz = Math.ceil((MAP.z1 - MAP.z0) / CELL);
    const nc = this.nx * this.nz;
    this.colHead = new Int32Array(nc).fill(-1);
    this.eHead = new Int32Array(nc).fill(-1);
    this.eCap = 0;
    this.eN = 0;
    this.growEntries(1 << 16);
    this.cap = 0;
    this.nodes = 0;
    this.growNodes(1 << 15);
  }

  // 碰撞体数量变了（分区模块后加的）就要重建
  get stale() { return this.phys.boxes.length + this.phys.cyls.length !== this.count; }
  get ready() { return this.builds > 0; }

  growEntries(cap) {
    const old = this;
    const next = new Int32Array(cap), bot = new Float32Array(cap), top = new Float32Array(cap), flag = new Uint8Array(cap);
    if (this.eCap) { next.set(old.eNext); bot.set(old.eBot); top.set(old.eTop); flag.set(old.eFlag); }
    this.eNext = next; this.eBot = bot; this.eTop = top; this.eFlag = flag;
    this.eCap = cap;
  }

  growNodes(cap) {
    const copy = (T, src, n) => { const a = new T(n); if (src) a.set(src); return a; };
    this.nCol = copy(Int32Array, this.nCol, cap);
    this.nY = copy(Float32Array, this.nY, cap);
    this.nNext = copy(Int32Array, this.nNext, cap);
    this.nBlock = copy(Float32Array, this.nBlock, cap);
    this.cover = copy(Uint8Array, this.cover, cap); // 八个方向上紧贴着障碍物
    this.low = copy(Uint8Array, this.low, cap); // 其中是矮障碍的方向
    this.links = copy(Int32Array, this.links, cap * 8);
    this.queue = copy(Int32Array, this.queue, cap);
    this.cap = cap;
  }

  // 把每个碰撞体按“落脚面”和“挡身体”两种用途登记到它覆盖的格子上
  raster() {
    const { phys, x0, z0, nx, nz } = this;
    this.eHead.fill(-1);
    this.eN = 0;
    const R2 = R * R, RG2 = RG * RG;
    for (const b of phys.boxes) {
      if (b.top < -0.2) continue;
      const ex = Math.abs(b.c) * b.hx + Math.abs(b.s) * b.hz + R, ez = Math.abs(b.s) * b.hx + Math.abs(b.c) * b.hz + R;
      const i0 = Math.max(0, Math.ceil((b.cx - ex - x0) / CELL - 0.5)), i1 = Math.min(nx - 1, Math.floor((b.cx + ex - x0) / CELL - 0.5));
      const k0 = Math.max(0, Math.ceil((b.cz - ez - z0) / CELL - 0.5)), k1 = Math.min(nz - 1, Math.floor((b.cz + ez - z0) / CELL - 0.5));
      for (let k = k0; k <= k1; k++) {
        const dz = z0 + (k + 0.5) * CELL - b.cz;
        for (let i = i0; i <= i1; i++) {
          const dx = x0 + (i + 0.5) * CELL - b.cx;
          const lx = dx * b.c - dz * b.s, lz = dx * b.s + dz * b.c;
          const px = Math.max(Math.abs(lx) - b.hx, 0), pz = Math.max(Math.abs(lz) - b.hz, 0), d2 = px * px + pz * pz;
          // groundHeight 不把 playerOnly 当地面，resolve 却照样挡人
          const f = (!b.playerOnly && d2 < RG2 ? 1 : 0) | (d2 < R2 ? 2 : 0);
          if (f) this.entry(k * nx + i, b.bottom, b.top, f);
        }
      }
    }
    for (const c of phys.cyls) {
      if (c.y1 < -0.2) continue;
      const e = c.r + R, rg2 = (c.r + RG) ** 2, r2 = e * e;
      const i0 = Math.max(0, Math.ceil((c.x - e - x0) / CELL - 0.5)), i1 = Math.min(nx - 1, Math.floor((c.x + e - x0) / CELL - 0.5));
      const k0 = Math.max(0, Math.ceil((c.z - e - z0) / CELL - 0.5)), k1 = Math.min(nz - 1, Math.floor((c.z + e - z0) / CELL - 0.5));
      for (let k = k0; k <= k1; k++) {
        const dz = z0 + (k + 0.5) * CELL - c.z;
        for (let i = i0; i <= i1; i++) {
          const dx = x0 + (i + 0.5) * CELL - c.x, d2 = dx * dx + dz * dz;
          const f = (d2 < rg2 ? 1 : 0) | (d2 < r2 ? 2 : 0);
          if (f) this.entry(k * nx + i, c.y0, c.y1, f);
        }
      }
    }
  }

  entry(col, bot, top, flag) {
    if (this.eN >= this.eCap) this.growEntries(this.eCap * 2);
    const e = this.eN++;
    this.eBot[e] = bot;
    this.eTop[e] = top;
    this.eFlag[e] = flag;
    this.eNext[e] = this.eHead[col];
    this.eHead[col] = e;
  }

  // 从脚底高度 lim - STEP 走进这一格时踩到的高度（同 groundHeight）
  floorAt(col, lim) {
    let g = 0;
    for (let e = this.eHead[col]; e >= 0; e = this.eNext[e]) {
      if (!(this.eFlag[e] & 1)) continue;
      const t = this.eTop[e];
      if (t > lim || t <= g) continue;
      g = t;
    }
    return g;
  }

  // 站在 y 上会被挡住吗：返回挡路物里最高的顶面，不挡返回 CLEAR（同 resolve 的判定）
  blockAt(col, y) {
    let top = CLEAR;
    const head = y + HEIGHT, foot = y + STEP;
    for (let e = this.eHead[col]; e >= 0; e = this.eNext[e]) {
      if (!(this.eFlag[e] & 2) || this.eBot[e] >= head || this.eTop[e] <= foot) continue;
      if (this.eTop[e] > top) top = this.eTop[e];
    }
    return top;
  }

  find(col, y) {
    for (let n = this.colHead[col]; n >= 0; n = this.nNext[n]) if (Math.abs(this.nY[n] - y) < 0.01) return n;
    return -1;
  }

  make(col, y) {
    if (this.nodes >= this.cap) this.growNodes(this.cap * 2);
    const n = this.nodes++;
    this.nCol[n] = col;
    this.nY[n] = y;
    this.nNext[n] = this.colHead[col];
    this.colHead[col] = n;
    this.nBlock[n] = this.blockAt(col, y);
    this.cover[n] = 0;
    this.low[n] = 0;
    this.links.fill(-1, n * 8, n * 8 + 8);
    return n;
  }

  walk(n) { return this.nBlock[n] === CLEAR; }
  cx(n) { return this.x0 + ((this.nCol[n] % this.nx) + 0.5) * CELL; }
  cz(n) { return this.z0 + (((this.nCol[n] / this.nx) | 0) + 0.5) * CELL; }

  colAt(x, z) {
    const i = Math.floor((x - this.x0) / CELL), k = Math.floor((z - this.z0) / CELL);
    return i < 0 || k < 0 || i >= this.nx || k >= this.nz ? -1 : k * this.nx + i;
  }

  // 从出生点等种子出发洪水填充：只有走得到的地方才进网格（箱顶、够不着的屋面不算）
  build(seeds) {
    const t0 = performance.now(), nx = this.nx, nz = this.nz;
    this.count = this.phys.boxes.length + this.phys.cyls.length;
    this.raster();
    this.colHead.fill(-1);
    this.nodes = 0;
    let qh = 0, qt = 0;
    for (const s of seeds) {
      const col = this.colAt(s.x, s.z);
      if (col < 0) continue;
      const y = this.floorAt(col, (s.y || 0) + STEP);
      if (this.find(col, y) >= 0) continue;
      const n = this.make(col, y);
      if (this.walk(n)) this.queue[qt++] = n;
    }
    while (qh < qt) {
      const n = this.queue[qh++], col = this.nCol[n], y = this.nY[n], i = col % nx, k = (col / nx) | 0;
      for (let d = 0; d < 4; d++) {
        const i2 = i + DX[d], k2 = k + DZ[d];
        if (i2 < 0 || k2 < 0 || i2 >= nx || k2 >= nz) continue;
        const col2 = k2 * nx + i2, y2 = this.floorAt(col2, y + STEP);
        const fall = y2 < y - DROP;
        if (fall && (y2 < y - FALL || !this.fallClear(col2, y2, y))) continue;
        let n2 = this.find(col2, y2);
        if (n2 < 0) {
          n2 = this.make(col2, y2);
          if (this.walk(n2)) this.queue[qt++] = n2;
        }
        if (this.walk(n2)) this.links[n * 8 + d] = n2;
        else if (!fall) this.markCover(n, d, this.nBlock[n2] - y);
      }
    }
    // 斜向：两条直角边都通才连，免得贴着墙角穿过去
    for (let n = 0; n < this.nodes; n++) {
      if (!this.walk(n)) continue;
      const col = this.nCol[n], y = this.nY[n], i = col % nx, k = (col / nx) | 0;
      for (let d = 4; d < 8; d++) {
        const i2 = i + DX[d], k2 = k + DZ[d];
        if (i2 < 0 || k2 < 0 || i2 >= nx || k2 >= nz) continue;
        const col2 = k2 * nx + i2, y2 = this.floorAt(col2, y + STEP);
        if (y2 < y - DROP) continue;
        const n2 = this.find(col2, y2);
        if (n2 < 0) continue;
        if (!this.walk(n2)) { this.markCover(n, d, this.nBlock[n2] - y); continue; }
        // 斜着走时两条直角边都得是平路：一边是下落边说明正擦着台沿，斜切过去会半路掉下去
        const a = this.links[n * 8 + DIAG_A[d - 4]], b = this.links[n * 8 + DIAG_B[d - 4]];
        if (a < 0 || b < 0 || this.nY[a] < y - DROP || this.nY[b] < y - DROP) continue;
        this.links[n * 8 + d] = n2;
      }
    }
    this.walkable = qt;
    this.builds++;
    this.ms = performance.now() - t0;
    return this.ms;
  }

  // 从 from 高度跳进这一格、落到 y：下落过程里身体扫过的高度不许有挡人的东西。
  // 头顶按落差的一半算：陡梯段（消防梯）按半米一格量出来的“落差”其实是连续的踏步，人跨进这一格时脚已经在半路上，
  // 按起点高度算会被上一跑梯段的底板挡掉，整部梯子只能上不能下
  fallClear(col, y, from) {
    const head = (from + y) / 2 + HEIGHT, foot = y + STEP;
    for (let e = this.eHead[col]; e >= 0; e = this.eNext[e]) {
      if ((this.eFlag[e] & 2) && this.eBot[e] < head && this.eTop[e] > foot) return false;
    }
    return true;
  }

  markCover(n, d, h) {
    if (h < 0.5) return; // 只比脚下高一点的东西（路沿、托盘）挡不住子弹
    this.cover[n] |= 1 << d;
    if (h <= LOW_COVER) this.low[n] |= 1 << d;
  }

  // 离某个位置最近的可走节点（先看同一格，再一圈圈往外找）。dy 的容差照顾跳在半空和站在箱顶的人
  nearest(x, y, z, maxR = 3) {
    const nx = this.nx, nz = this.nz;
    const i0 = Math.floor((x - this.x0) / CELL), k0 = Math.floor((z - this.z0) / CELL);
    const rr = Math.ceil(maxR / CELL);
    let best = -1, bd = Infinity;
    for (let r = 0; r <= rr; r++) {
      if (best >= 0 && (r - 1) * CELL > Math.sqrt(bd)) break;
      for (let k = k0 - r; k <= k0 + r; k++) {
        if (k < 0 || k >= nz) continue;
        const edge = k === k0 - r || k === k0 + r;
        for (let i = i0 - r; i <= i0 + r; i += edge ? 1 : 2 * r || 1) {
          if (i < 0 || i >= nx) continue;
          for (let n = this.colHead[k * nx + i]; n >= 0; n = this.nNext[n]) {
            if (!this.walk(n)) continue;
            const dy = this.nY[n] - y;
            if (dy > 1 || dy < -2.6) continue;
            const hx = this.x0 + (i + 0.5) * CELL - x, hz = this.z0 + (k + 0.5) * CELL - z;
            const d = hx * hx + hz * hz + dy * dy * 4;
            if (d < bd) { bd = d; best = n; }
          }
        }
      }
    }
    return best;
  }

  // 半径 r 内随便挑一个可走节点（巡逻、搜索用）
  randomNear(x, y, z, r, tries = 6) {
    for (let t = 0; t < tries; t++) {
      const a = Math.random() * Math.PI * 2, d = r * Math.sqrt(Math.random());
      const n = this.nearest(x + Math.cos(a) * d, y, z + Math.sin(a) * d, 1.5);
      if (n >= 0) return n;
    }
    return this.nearest(x, y, z, 2);
  }

  // 两个节点之间能不能直着走过去：沿直线逐格（只走直角边）顺着连接走，高度变化也就跟着楼梯走了
  lineWalk(a, b, maxSteps = 160) {
    if (a === b) return true;
    const nx = this.nx;
    let n = a, i = this.nCol[a] % nx, k = (this.nCol[a] / nx) | 0;
    const ib = this.nCol[b] % nx, kb = (this.nCol[b] / nx) | 0;
    const dx = ib - i, dz = kb - k, sx = Math.sign(dx), sz = Math.sign(dz);
    const tdx = dx ? 1 / Math.abs(dx) : Infinity, tdz = dz ? 1 / Math.abs(dz) : Infinity;
    let tx = tdx * 0.5, tz = tdz * 0.5;
    for (let s = 0; s < maxSteps && (i !== ib || k !== kb); s++) {
      let d;
      if (Math.abs(tx - tz) < 1e-9) {
        d = sx > 0 ? (sz > 0 ? 4 : 7) : (sz > 0 ? 5 : 6);
        tx += tdx; tz += tdz; i += sx; k += sz;
      } else if (tx < tz) {
        d = sx > 0 ? 0 : 2; tx += tdx; i += sx;
      } else {
        d = sz > 0 ? 1 : 3; tz += tdz; k += sz;
      }
      n = this.links[n * 8 + d];
      if (n < 0) return false;
    }
    return n === b || (i === ib && k === kb && Math.abs(this.nY[n] - this.nY[b]) < 0.3);
  }
}
