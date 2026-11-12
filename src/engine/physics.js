import * as THREE from 'three';

const _v = new THREE.Vector3();
// 空间索引的格子边长（米）。碰撞体上千个以后，逐个遍历会拖慢玩家、敌人和子弹的每次查询
const CELL = 4, GRID_LIMIT = 90;
// 射线检测的中间结果（避免每次分配）
const H = { best: 0, nx: 0, ny: 1, nz: 0, surface: null };

// 关卡碰撞：绕 Y 轴旋转的盒子 + 竖直圆柱。玩家是竖直圆柱体，子弹是射线。
const SMOKE_SEE = 1.2;

export class PhysicsWorld {
  constructor() {
    // 烟雾弹的烟团 { x, y, z, r }：只挡 blocked() 的视线判定，不挡子弹和人；r 为 0 表示还没炸开或已散尽
    this.smokes = [];
    this.boxes = [];
    this.cyls = [];
    this.groundSurface = 'asphalt';
    this.grid = null;
    this.stamp = 0;
    this.qb = [];
    this.qc = [];
  }

  addBox(cx, cy, cz, hx, hy, hz, yaw = 0, surface = 'concrete') {
    const b = { cx, cy, cz, hx, hy, hz, c: Math.cos(yaw), s: Math.sin(yaw), surface, top: cy + hy, bottom: cy - hy, q: 0 };
    this.boxes.push(b);
    this.grid = null;
    return b;
  }

  addCyl(x, z, r, y0, y1, surface = 'metal') {
    const c = { x, z, r, y0, y1, surface, q: 0 };
    this.cyls.push(c);
    this.grid = null;
    return c;
  }

  // 由局部矩阵（只含平移和绕 Y 旋转）登记盒子
  solid(matrix, lx, ly, lz, hx, hy, hz, surface) {
    _v.set(lx, ly, lz).applyMatrix4(matrix);
    const e = matrix.elements;
    return this.addBox(_v.x, _v.y, _v.z, hx, hy, hz, Math.atan2(-e[2], e[0]), surface);
  }

  // 均匀网格：每格记下与它相交的碰撞体。加了新碰撞体后下次查询时重建
  buildGrid() {
    let x0 = Infinity, z0 = Infinity, x1 = -Infinity, z1 = -Infinity;
    const items = [];
    const put = (o, ax0, az0, ax1, az1) => {
      items.push([o, ax0, az0, ax1, az1]);
      x0 = Math.min(x0, ax0); z0 = Math.min(z0, az0); x1 = Math.max(x1, ax1); z1 = Math.max(z1, az1);
    };
    for (const b of this.boxes) {
      const ex = Math.abs(b.c) * b.hx + Math.abs(b.s) * b.hz, ez = Math.abs(b.s) * b.hx + Math.abs(b.c) * b.hz;
      put(b, b.cx - ex, b.cz - ez, b.cx + ex, b.cz + ez);
    }
    for (const c of this.cyls) put(c, c.x - c.r, c.z - c.r, c.x + c.r, c.z + c.r);
    x0 = Math.max(x0, -GRID_LIMIT); z0 = Math.max(z0, -GRID_LIMIT); x1 = Math.min(x1, GRID_LIMIT); z1 = Math.min(z1, GRID_LIMIT);
    if (!(x1 > x0)) { x0 = z0 = 0; x1 = z1 = CELL; }
    const nx = Math.max(1, Math.ceil((x1 - x0) / CELL)), nz = Math.max(1, Math.ceil((z1 - z0) / CELL));
    const cells = Array.from({ length: nx * nz }, () => []);
    const far = [];
    for (const [o, ax0, az0, ax1, az1] of items) {
      // 伸到网格外面的大块头单独放，每次都测
      if (ax0 < x0 - 1e-6 || az0 < z0 - 1e-6 || ax1 > x0 + nx * CELL + 1e-6 || az1 > z0 + nz * CELL + 1e-6) { far.push(o); continue; }
      const i0 = Math.min(nx - 1, Math.floor((ax0 - x0) / CELL)), i1 = Math.min(nx - 1, Math.floor((ax1 - x0) / CELL));
      const k0 = Math.min(nz - 1, Math.floor((az0 - z0) / CELL)), k1 = Math.min(nz - 1, Math.floor((az1 - z0) / CELL));
      for (let k = k0; k <= k1; k++) for (let i = i0; i <= i1; i++) cells[k * nx + i].push(o);
    }
    this.grid = { x0, z0, nx, nz, cells, far };
    return this.grid;
  }

  // 取出矩形范围内可能相交的碰撞体（去重），盒子进 this.qb，圆柱进 this.qc
  gather(x0, z0, x1, z1) {
    const g = this.grid || this.buildGrid(), qb = this.qb, qc = this.qc, s = ++this.stamp;
    qb.length = 0;
    qc.length = 0;
    for (const o of g.far) (o.hx !== undefined ? qb : qc).push(o);
    const i0 = Math.max(0, Math.floor((x0 - g.x0) / CELL)), i1 = Math.min(g.nx - 1, Math.floor((x1 - g.x0) / CELL));
    const k0 = Math.max(0, Math.floor((z0 - g.z0) / CELL)), k1 = Math.min(g.nz - 1, Math.floor((z1 - g.z0) / CELL));
    for (let k = k0; k <= k1; k++) {
      for (let i = i0; i <= i1; i++) {
        const cell = g.cells[k * g.nx + i];
        for (let n = 0; n < cell.length; n++) {
          const o = cell[n];
          if (o.q === s) continue;
          o.q = s;
          (o.hx !== undefined ? qb : qc).push(o);
        }
      }
    }
  }

  // 把圆（玩家）推出所有挡路的碰撞体；返回是否发生了碰撞
  resolve(pos, radius, feetY, headY, stepH) {
    let hit = false;
    for (let iter = 0; iter < 3; iter++) {
      let moved = false;
      this.gather(pos.x - radius, pos.z - radius, pos.x + radius, pos.z + radius);
      for (const b of this.qb) {
        if (b.bottom >= headY || b.top <= feetY + stepH) continue;
        const dx = pos.x - b.cx, dz = pos.z - b.cz;
        const lx = dx * b.c - dz * b.s, lz = dx * b.s + dz * b.c;
        const qx = Math.max(-b.hx, Math.min(b.hx, lx)), qz = Math.max(-b.hz, Math.min(b.hz, lz));
        let px = lx - qx, pz = lz - qz;
        const d2 = px * px + pz * pz;
        if (d2 >= radius * radius) continue;
        if (d2 > 1e-10) {
          const d = Math.sqrt(d2), k = (radius - d) / d;
          px *= k; pz *= k;
        } else {
          // 圆心已在盒内：沿穿透最浅的轴推出
          const ex = b.hx - Math.abs(lx), ez = b.hz - Math.abs(lz);
          if (ex < ez) { px = (ex + radius) * Math.sign(lx || 1); pz = 0; }
          else { px = 0; pz = (ez + radius) * Math.sign(lz || 1); }
        }
        pos.x += px * b.c + pz * b.s;
        pos.z += -px * b.s + pz * b.c;
        moved = hit = true;
      }
      for (const c of this.qc) {
        if (c.y0 >= headY || c.y1 <= feetY + stepH) continue;
        const dx = pos.x - c.x, dz = pos.z - c.z;
        const rr = radius + c.r, d2 = dx * dx + dz * dz;
        if (d2 >= rr * rr) continue;
        const d = Math.sqrt(d2) || 1e-4;
        pos.x += (dx / d) * (rr - d);
        pos.z += (dz / d) * (rr - d);
        moved = hit = true;
      }
      if (!moved) break;
    }
    return hit;
  }

  // 脚下能站的最高表面（不超过 feetY + stepH）
  groundHeight(x, z, radius, feetY, stepH) {
    let g = 0;
    this.groundSurface = 'asphalt';
    const lim = feetY + stepH;
    this.gather(x - radius, z - radius, x + radius, z + radius);
    for (const b of this.qb) {
      if (b.playerOnly || b.top > lim || b.top <= g) continue;
      const dx = x - b.cx, dz = z - b.cz;
      const lx = dx * b.c - dz * b.s, lz = dx * b.s + dz * b.c;
      const px = Math.max(Math.abs(lx) - b.hx, 0), pz = Math.max(Math.abs(lz) - b.hz, 0);
      if (px * px + pz * pz < radius * radius) { g = b.top; this.groundSurface = b.surface; }
    }
    for (const c of this.qc) {
      if (c.y1 > lim || c.y1 <= g) continue;
      const dx = x - c.x, dz = z - c.z, rr = c.r + radius;
      if (dx * dx + dz * dz < rr * rr) { g = c.y1; this.groundSurface = c.surface; }
    }
    return g;
  }

  // 头顶上方最近的遮挡底面（跳起时用）
  ceilingHeight(x, z, radius, headY) {
    let c = Infinity;
    this.gather(x - radius, z - radius, x + radius, z + radius);
    for (const b of this.qb) {
      if (b.bottom < headY - 0.05 || b.bottom >= c) continue;
      const dx = x - b.cx, dz = z - b.cz;
      const lx = dx * b.c - dz * b.s, lz = dx * b.s + dz * b.c;
      const px = Math.max(Math.abs(lx) - b.hx, 0), pz = Math.max(Math.abs(lz) - b.hz, 0);
      if (px * px + pz * pz < radius * radius) c = b.bottom;
    }
    return c;
  }

  rayBox(b, o, d) {
    const dx = o.x - b.cx, dz = o.z - b.cz;
    const ox = dx * b.c - dz * b.s, oz = dx * b.s + dz * b.c, oy = o.y - b.cy;
    const rx = d.x * b.c - d.z * b.s, rz = d.x * b.s + d.z * b.c, ry = d.y;
    let tmin = -Infinity, tmax = Infinity, axis = 0, sign = 1;
    // 三个轴的 slab 测试
    for (let ax = 0; ax < 3; ax++) {
      const oo = ax === 0 ? ox : ax === 1 ? oy : oz, rr = ax === 0 ? rx : ax === 1 ? ry : rz, h = ax === 0 ? b.hx : ax === 1 ? b.hy : b.hz;
      if (Math.abs(rr) < 1e-9) {
        if (Math.abs(oo) > h) return;
        continue;
      }
      let t1 = (-h - oo) / rr, t2 = (h - oo) / rr, s = -1;
      if (t1 > t2) { const tt = t1; t1 = t2; t2 = tt; s = 1; }
      if (t1 > tmin) { tmin = t1; axis = ax; sign = s; }
      if (t2 < tmax) tmax = t2;
      if (tmin > tmax) return;
    }
    if (tmin < 1e-4 || tmin >= H.best) return;
    H.best = tmin;
    H.surface = b.surface;
    if (axis === 1) { H.nx = 0; H.ny = sign; H.nz = 0; }
    else if (axis === 0) { H.nx = sign * b.c; H.ny = 0; H.nz = -sign * b.s; }
    else { H.nx = sign * b.s; H.ny = 0; H.nz = sign * b.c; }
  }

  rayCyl(c, o, d) {
    const ox = o.x - c.x, oz = o.z - c.z;
    const a = d.x * d.x + d.z * d.z;
    if (a > 1e-9) {
      const bq = ox * d.x + oz * d.z, cq = ox * ox + oz * oz - c.r * c.r;
      const disc = bq * bq - a * cq;
      if (disc > 0) {
        const t = (-bq - Math.sqrt(disc)) / a;
        const y = o.y + d.y * t;
        if (t > 1e-4 && t < H.best && y >= c.y0 && y <= c.y1) {
          H.best = t;
          H.surface = c.surface;
          H.nx = (ox + d.x * t) / c.r; H.ny = 0; H.nz = (oz + d.z * t) / c.r;
        }
      }
    }
    if (d.y < -1e-6) {
      const t = (c.y1 - o.y) / d.y;
      const hx = ox + d.x * t, hz = oz + d.z * t;
      if (t > 1e-4 && t < H.best && hx * hx + hz * hz <= c.r * c.r) {
        H.best = t;
        H.surface = c.surface;
        H.nx = 0; H.ny = 1; H.nz = 0;
      }
    }
  }

  rayItem(o2, o, d) {
    if (o2.hx !== undefined) { if (!o2.playerOnly) this.rayBox(o2, o, d); }
    else this.rayCyl(o2, o, d);
  }

  // 射线检测。返回 { dist, point, normal, surface } 或 null
  raycast(o, d, maxDist = 500) {
    if (!this.cast(o, d, maxDist)) return null;
    return {
      dist: H.best,
      point: new THREE.Vector3(o.x + d.x * H.best, o.y + d.y * H.best, o.z + d.z * H.best),
      normal: new THREE.Vector3(H.nx, H.ny, H.nz),
      surface: H.surface,
    };
  }

  // 只要距离的射线检测：不产生任何对象，命中返回距离，没命中返回 -1。敌人每帧打很多条视线，走这条
  rayDist(o, d, maxDist = 500) {
    return this.cast(o, d, maxDist) ? H.best : -1;
  }

  // 射线检测的本体：结果留在 H 里，返回有没有命中
  cast(o, d, maxDist) {
    H.best = maxDist; H.nx = 0; H.ny = 1; H.nz = 0; H.surface = null;
    if (d.y < -1e-6) {
      const t = -o.y / d.y;
      if (t > 0 && t < H.best) { H.best = t; H.surface = 'asphalt'; }
    }
    const g = this.grid || this.buildGrid(), s = ++this.stamp;
    for (const it of g.far) this.rayItem(it, o, d);

    // 沿射线逐格走（2D DDA），每格只测登记在这格里的碰撞体；命中点落在已走过的范围内就可以停
    const gx1 = g.x0 + g.nx * CELL, gz1 = g.z0 + g.nz * CELL;
    let t0 = 0, t1 = H.best;
    for (let ax = 0; ax < 2; ax++) {
      const oo = ax ? o.z : o.x, dd = ax ? d.z : d.x, lo = ax ? g.z0 : g.x0, hi = ax ? gz1 : gx1;
      if (Math.abs(dd) < 1e-9) {
        if (oo < lo || oo > hi) t1 = -1;
      } else {
        let a = (lo - oo) / dd, b = (hi - oo) / dd;
        if (a > b) { const tt = a; a = b; b = tt; }
        t0 = Math.max(t0, a);
        t1 = Math.min(t1, b);
      }
    }
    if (t1 >= t0) {
      const px = o.x + d.x * t0, pz = o.z + d.z * t0;
      let ix = Math.min(g.nx - 1, Math.max(0, Math.floor((px - g.x0) / CELL)));
      let iz = Math.min(g.nz - 1, Math.max(0, Math.floor((pz - g.z0) / CELL)));
      const sx = d.x > 0 ? 1 : -1, sz = d.z > 0 ? 1 : -1;
      const dtx = Math.abs(d.x) > 1e-9 ? CELL / Math.abs(d.x) : Infinity, dtz = Math.abs(d.z) > 1e-9 ? CELL / Math.abs(d.z) : Infinity;
      let tx = Math.abs(d.x) > 1e-9 ? (g.x0 + (ix + (sx > 0 ? 1 : 0)) * CELL - o.x) / d.x : Infinity;
      let tz = Math.abs(d.z) > 1e-9 ? (g.z0 + (iz + (sz > 0 ? 1 : 0)) * CELL - o.z) / d.z : Infinity;
      for (;;) {
        const cell = g.cells[iz * g.nx + ix];
        for (let n = 0; n < cell.length; n++) {
          const it = cell[n];
          if (it.q === s) continue;
          it.q = s;
          this.rayItem(it, o, d);
        }
        const exit = Math.min(tx, tz);
        if (H.best <= exit || exit > t1) break;
        if (tx < tz) { ix += sx; tx += dtx; } else { iz += sz; tz += dtz; }
        if (ix < 0 || iz < 0 || ix >= g.nx || iz >= g.nz) break;
      }
    }
    return !!H.surface;
  }

  // 两点之间有没有遮挡（敌人的视线判定）。不分配内存
  blocked(a, b) {
    _v.subVectors(b, a);
    const len = _v.length();
    if (len < 1e-4) return false;
    _v.multiplyScalar(1 / len);
    // 烟团：视线在烟里穿过的总长度超过 SMOKE_SEE 米就算看不见
    let inSmoke = 0;
    for (const s of this.smokes) {
      if (!(s.r > 0)) continue;
      const ox = a.x - s.x, oy = a.y - s.y, oz = a.z - s.z;
      const b = ox * _v.x + oy * _v.y + oz * _v.z, disc = b * b - (ox * ox + oy * oy + oz * oz - s.r * s.r);
      if (disc <= 0) continue;
      const q = Math.sqrt(disc);
      inSmoke += Math.max(0, Math.min(len, -b + q) - Math.max(0, -b - q));
      if (inSmoke > SMOKE_SEE) return true;
    }
    return this.cast(a, _v, len) && H.best < len - 0.05;
  }
}
