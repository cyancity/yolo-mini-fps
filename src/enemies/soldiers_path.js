import { CELL, NAV } from './soldier_nav.js';

// 网格上的搜索：A*（带二叉堆）、限距 Dijkstra（找掩体用）、路径抽稀。
// 所有缓冲按节点容量预先分配，搜索时不分配；用“代数”标记代替每次清零。
const SQ2 = Math.SQRT2 * CELL;
export const MAX_WP = 48;
const H_WEIGHT = 1.4;

export class PathFinder {
  constructor(nav) {
    this.nav = nav;
    this.cap = 0;
    this.gen = 0;
    this.expanded = 0;
    // 玩家视线锥：走进去的每一步加价，绕路包抄就从这里来
    this.watch = { on: false, x: 0, z: 0, fx: 0, fz: -1, cos: 0.9, r2: 900, k: 2 };
    this.nodes = new Int32Array(1024);
    this.ensure();
  }

  ensure() {
    const cap = this.nav.cap;
    if (this.cap >= cap) return;
    this.cap = cap;
    this.g = new Float32Array(cap);
    this.f = new Float32Array(cap);
    this.came = new Int32Array(cap);
    this.mark = new Uint32Array(cap);
    this.shut = new Uint32Array(cap);
    this.hpos = new Int32Array(cap);
    this.heap = new Int32Array(cap);
    this.gen = 0;
  }

  // ---- 带位置索引的二叉最小堆（支持降键）
  push(n) {
    const h = this.heap, f = this.f, p = this.hpos;
    let i = this.size++;
    while (i > 0) {
      const up = (i - 1) >> 1, m = h[up];
      if (f[m] <= f[n]) break;
      h[i] = m; p[m] = i; i = up;
    }
    h[i] = n; p[n] = i;
  }

  raise(n) {
    const h = this.heap, f = this.f, p = this.hpos;
    let i = p[n];
    while (i > 0) {
      const up = (i - 1) >> 1, m = h[up];
      if (f[m] <= f[n]) break;
      h[i] = m; p[m] = i; i = up;
    }
    h[i] = n; p[n] = i;
  }

  pop() {
    const h = this.heap, f = this.f, p = this.hpos, top = h[0], last = h[--this.size];
    let i = 0;
    const size = this.size;
    if (size > 0) {
      for (;;) {
        let c = 2 * i + 1;
        if (c >= size) break;
        if (c + 1 < size && f[h[c + 1]] < f[h[c]]) c++;
        if (f[h[c]] >= f[last]) break;
        h[i] = h[c]; p[h[c]] = i; i = c;
      }
      h[i] = last; p[last] = i;
    }
    return top;
  }

  begin(start) {
    this.ensure();
    if (++this.gen >= 0xfffffff0) { this.gen = 1; this.mark.fill(0); this.shut.fill(0); }
    this.size = 0;
    this.expanded = 0;
    this.g[start] = 0;
    this.came[start] = -1;
    this.mark[start] = this.gen;
  }

  stepCost(n, m, d) {
    const nav = this.nav, dy = nav.nY[m] - nav.nY[n];
    // 下落边（落差超过 DROP）多算一米：差不多远时还是走台阶
    let c = (d < 4 ? CELL : SQ2) + (dy > 0 ? dy * 1.5 : dy < -NAV.DROP ? 1 - dy * 0.5 : -dy * 0.5);
    const w = this.watch;
    if (w.on) {
      const x = nav.cx(m) - w.x, z = nav.cz(m) - w.z, d2 = x * x + z * z;
      if (d2 < w.r2 && d2 > 1 && (x * w.fx + z * w.fz) > w.cos * Math.sqrt(d2)) c *= w.k;
    }
    return c;
  }

  // 八方向距离加高差，乘个大于 1 的系数（加权 A*）：路径最多长一点点，搜索的节点少得多
  h(n) {
    const nav = this.nav, dx = Math.abs(nav.cx(n) - this.gx), dz = Math.abs(nav.cz(n) - this.gz);
    return (Math.max(dx, dz) + (SQ2 / CELL - 1) * Math.min(dx, dz) + Math.abs(nav.nY[n] - this.gy)) * H_WEIGHT;
  }

  // 分帧 A*：open 开一次搜索，之后每帧 step(预算) 推进，返回真表示结束，结果在 this.result
  // （终点；走不到时 partial 为真就给离目标最近的已探索节点，否则 -1）
  open(start, goal, maxExpand = 12000, partial = true) {
    const nav = this.nav;
    this.gx = nav.cx(goal); this.gz = nav.cz(goal); this.gy = nav.nY[goal];
    this.begin(start);
    this.f[start] = this.h(start);
    this.push(start);
    this.from = start;
    this.goal = goal;
    this.best = start;
    this.bestH = this.f[start];
    this.maxExpand = maxExpand;
    this.partial = partial;
    this.result = -1;
    this.done = false;
  }

  step(budget) {
    if (this.done) return true;
    const links = this.nav.links, gen = this.gen, goal = this.goal;
    for (let k = 0; k < budget; k++) {
      if (this.size === 0 || this.expanded >= this.maxExpand) {
        this.result = this.partial && this.best !== this.from ? this.best : -1;
        this.done = true;
        return true;
      }
      const n = this.pop();
      if (n === goal) { this.result = goal; this.done = true; return true; }
      this.shut[n] = gen;
      const hn = this.f[n] - this.g[n];
      if (hn < this.bestH) { this.bestH = hn; this.best = n; }
      this.expanded++;
      for (let d = 0; d < 8; d++) {
        const m = links[n * 8 + d];
        if (m < 0 || this.shut[m] === gen) continue;
        const c = this.g[n] + this.stepCost(n, m, d);
        if (this.mark[m] !== gen) {
          this.mark[m] = gen; this.g[m] = c; this.came[m] = n; this.f[m] = c + this.h(m); this.push(m);
        } else if (c < this.g[m]) {
          this.f[m] += c - this.g[m]; this.g[m] = c; this.came[m] = n; this.raise(m);
        }
      }
    }
    return false;
  }

  // 一口气搜完（调试页和测试用）
  search(start, goal, maxExpand = 12000, partial = true) {
    this.open(start, goal, maxExpand, partial);
    this.step(Infinity);
    return this.result;
  }

  // 限距 Dijkstra：每个出堆的节点回调 visit(n, cost)，visit 返回 true 就提前收工。
  // 之后可以用 extract 取到任一已访问节点的路径，cost(n) 取到步行代价（没访问到是 Infinity）
  flood(start, maxCost, visit, maxExpand = 9000) {
    const links = this.nav.links;
    this.begin(start);
    this.f[start] = 0;
    this.push(start);
    const gen = this.gen;
    while (this.size > 0) {
      const n = this.pop();
      this.shut[n] = gen;
      if (visit(n, this.g[n]) === true) break;
      if (++this.expanded > maxExpand) break;
      for (let d = 0; d < 8; d++) {
        const m = links[n * 8 + d];
        if (m < 0 || this.shut[m] === gen) continue;
        const c = this.g[n] + this.stepCost(n, m, d);
        if (c > maxCost) continue;
        if (this.mark[m] !== gen) {
          this.mark[m] = gen; this.g[m] = c; this.came[m] = n; this.f[m] = c; this.push(m);
        } else if (c < this.g[m]) {
          this.g[m] = c; this.came[m] = n; this.f[m] = c; this.raise(m);
        }
      }
    }
  }

  cost(n) { return n >= 0 && this.shut[n] === this.gen ? this.g[n] : Infinity; }

  // 最近一次搜索里到 end 的节点序列（从起点到终点）写进 this.nodes，返回长度
  extract(end) {
    let len = 0;
    for (let n = end; n >= 0; n = this.came[n]) len++;
    if (this.nodes.length < len) this.nodes = new Int32Array(len * 2);
    let i = len;
    for (let n = end; n >= 0; n = this.came[n]) this.nodes[--i] = n;
    return len;
  }

  // 抽稀：能直着走到的中间点都去掉。out 是 Float32Array(MAX_WP * 3)，返回路点数（不含起点）
  smooth(len, out) {
    const nav = this.nav, p = this.nodes;
    let count = 0, anchor = 0;
    const put = (n) => {
      if (count >= MAX_WP) return;
      out[count * 3] = nav.cx(n); out[count * 3 + 1] = nav.nY[n]; out[count * 3 + 2] = nav.cz(n);
      count++;
    };
    for (let i = 1; i < len; i++) {
      if (i === len - 1) { put(p[i]); break; }
      if (i - anchor > 36 || !nav.lineWalk(p[anchor], p[i + 1])) { put(p[i]); anchor = i; }
    }
    return count;
  }
}
