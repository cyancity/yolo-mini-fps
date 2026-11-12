import * as THREE from 'three';
import { boxUV } from '../gfx/geo.js';

export const lerp = (a, b, t) => a + (b - a) * t;
export const clamp01 = (t) => Math.min(1, Math.max(0, t));
export const smooth = (t) => { t = clamp01(t); return t * t * (3 - 2 * t); };
export const rad = (deg) => (deg * Math.PI) / 180;
// 鼓包的边缘轮廓：中间平，到 ±1 处收到 0
export const pill = (a, n = 6) => Math.sqrt(Math.max(0, 1 - Math.abs(a) ** n));

const _c = new THREE.Color();
const _v = new THREE.Vector3();

// 带骨权重、顶点色和表面参数的几何构建器。整个士兵只有两种材质（soft 布料、hard 硬表面），
// 颜色靠顶点色，粗糙度、金属度、自发光、迷彩斑块强度靠 aSurf，所以一个士兵只要两次 draw call。
// 格网的法线由面累加再按位置焊接，接缝两侧光照连续；现成几何体保留自带法线。
export class SkinBuilder {
  constructor() {
    this.pos = []; this.nor = []; this.uv = []; this.col = []; this.surf = []; this.bi = []; this.bw = [];
    this.soft = [];
    this.tris = { soft: [], hard: [] };
    this.tint = [1, 1, 1];
    this.sf = [0.9, 0, 0, 0];
  }

  // 之后加的顶点都用这套颜色和表面：rough 粗糙度基准，metal 金属度，glow 自发光（HDR 倍数），pattern 迷彩斑块强度
  paint(color, rough = 0.9, metal = 0, glow = 0, pattern = 0) {
    _c.set(color);
    this.tint = [_c.r, _c.g, _c.b];
    this.sf = [rough, metal, glow, pattern];
    return this;
  }

  // skin：骨索引，或 [骨, 权重, 骨, 权重, …]（最多取四根，自动归一化）
  vert(p, uv, skin, n = null) {
    this.pos.push(p[0], p[1], p[2]);
    this.nor.push(n ? n[0] : 0, n ? n[1] : 0, n ? n[2] : 0);
    this.uv.push(uv[0], uv[1]);
    this.col.push(this.tint[0], this.tint[1], this.tint[2]);
    this.surf.push(this.sf[0], this.sf[1], this.sf[2], this.sf[3]);
    const base = this.bi.length;
    let k = 0, sum = 0;
    if (typeof skin === 'number') { this.bi.push(skin); this.bw.push(1); k = 1; sum = 1; } else {
      for (let i = 0; i + 1 < skin.length && k < 4; i += 2) {
        if (skin[i + 1] <= 1e-4) continue;
        this.bi.push(skin[i]); this.bw.push(skin[i + 1]);
        sum += skin[i + 1];
        k++;
      }
    }
    for (; k < 4; k++) { this.bi.push(0); this.bw.push(0); }
    for (let i = 0; i < 4; i++) this.bw[base + i] /= sum;
    this.soft.push(n ? 0 : 1);
    return this.soft.length - 1;
  }

  tri(mat, a, b, c) { this.tris[mat].push(a, b, c); }

  // (nu+1)×(nv+1) 格网，fn(i, j) → { p, skin }。外法线 = j 切向 × i 切向，flip 时反过来。
  // UV 用格网上的实际弧长，贴图密度处处是 1/tile。
  grid(mat, nu, nv, fn, tile = 0.4, flip = false) {
    const pts = [];
    for (let j = 0; j <= nv; j++) for (let i = 0; i <= nu; i++) pts.push(fn(i, j));
    const at = (i, j) => pts[j * (nu + 1) + i].p;
    const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
    const mid = nu >> 1, base = this.soft.length;
    let v = 0;
    for (let j = 0; j <= nv; j++) {
      if (j > 0) v += dist(at(mid, j), at(mid, j - 1));
      const u = [0];
      for (let i = 1; i <= nu; i++) u.push(u[i - 1] + dist(at(i, j), at(i - 1, j)));
      for (let i = 0; i <= nu; i++) {
        const q = pts[j * (nu + 1) + i];
        this.vert(q.p, [(u[i] - u[mid]) / tile, v / tile], q.skin);
      }
    }
    for (let j = 0; j < nv; j++) for (let i = 0; i < nu; i++) {
      const a = base + j * (nu + 1) + i, b = a + 1, d = a + nu + 1, c = d + 1;
      if (flip) { this.tri(mat, a, c, d); this.tri(mat, a, b, c); } else { this.tri(mat, a, d, c); this.tri(mat, a, c, b); }
    }
  }

  // 现成几何体。skin：骨索引（整块跟一根骨走），或 (p) => 权重数组（跨骨的软连接）
  rigid(mat, geo, matrix, skin, tile = 0.25) {
    const g = geo.index ? geo.toNonIndexed() : geo;
    const flipped = matrix && matrix.determinant() < 0;
    if (matrix) g.applyMatrix4(matrix);
    boxUV(g, tile);
    const P = g.attributes.position, N = g.attributes.normal, U = g.attributes.uv, base = this.soft.length;
    for (let i = 0; i < P.count; i++) {
      const p = [P.getX(i), P.getY(i), P.getZ(i)];
      this.vert(p, [U.getX(i), U.getY(i)], typeof skin === 'function' ? skin(p) : skin, [N.getX(i), N.getY(i), N.getZ(i)]);
    }
    for (let i = 0; i < P.count; i += 3) {
      if (flipped) this.tri(mat, base + i, base + i + 2, base + i + 1); else this.tri(mat, base + i, base + i + 1, base + i + 2);
    }
    if (g !== geo) geo.dispose();
    g.dispose();
  }

  #normals() {
    const P = this.pos, N = this.nor, n = this.soft.length;
    for (const idx of Object.values(this.tris)) {
      for (let t = 0; t < idx.length; t += 3) {
        const a = idx[t] * 3, b = idx[t + 1] * 3, c = idx[t + 2] * 3;
        if (!this.soft[idx[t]]) continue;
        const ux = P[b] - P[a], uy = P[b + 1] - P[a + 1], uz = P[b + 2] - P[a + 2];
        const vx = P[c] - P[a], vy = P[c + 1] - P[a + 1], vz = P[c + 2] - P[a + 2];
        const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
        for (const k of [a, b, c]) { N[k] += nx; N[k + 1] += ny; N[k + 2] += nz; }
      }
    }
    const weld = new Map();
    const key = (i) => `${Math.round(P[i * 3] * 2e4)},${Math.round(P[i * 3 + 1] * 2e4)},${Math.round(P[i * 3 + 2] * 2e4)}`;
    for (let i = 0; i < n; i++) {
      if (!this.soft[i]) continue;
      const k = key(i), s = weld.get(k);
      if (s) { s[0] += N[i * 3]; s[1] += N[i * 3 + 1]; s[2] += N[i * 3 + 2]; } else weld.set(k, [N[i * 3], N[i * 3 + 1], N[i * 3 + 2]]);
    }
    for (let i = 0; i < n; i++) {
      if (!this.soft[i]) continue;
      const s = weld.get(key(i)), l = Math.hypot(s[0], s[1], s[2]) || 1;
      N[i * 3] = s[0] / l; N[i * 3 + 1] = s[1] / l; N[i * 3 + 2] = s[2] / l;
    }
  }

  // 返回 { soft, hard } 两个几何体（共用一套顶点缓冲）和三角形总数
  build() {
    this.#normals();
    const attrs = {
      position: new THREE.Float32BufferAttribute(this.pos, 3),
      normal: new THREE.Float32BufferAttribute(this.nor, 3),
      uv: new THREE.Float32BufferAttribute(this.uv, 2),
      color: new THREE.Float32BufferAttribute(this.col, 3),
      aSurf: new THREE.Float32BufferAttribute(this.surf, 4),
      skinIndex: new THREE.Uint16BufferAttribute(this.bi, 4),
      skinWeight: new THREE.Float32BufferAttribute(this.bw, 4),
    };
    const out = { tris: 0 };
    for (const [mat, idx] of Object.entries(this.tris)) {
      const g = new THREE.BufferGeometry();
      for (const k in attrs) g.setAttribute(k, attrs[k]);
      g.setIndex(idx);
      out[mat] = g;
      out.tris += idx.length / 3;
    }
    return out;
  }
}

// 轮廓表 [y, a(半宽), bf(前半深), bb(后半深), cz, cx?]（y 升序）→ f(y)。第六列可选，是截面中心的 x 偏移。
// spline = false 时线性插值（靴子这类有硬折的）
export function profile(table, spline = true) {
  const n = table.length;
  return (y) => {
    let i = 0;
    while (i < n - 2 && y > table[i + 1][0]) i++;
    const r0 = table[i], r1 = table[i + 1], h = r1[0] - r0[0];
    const t = clamp01((y - r0[0]) / h), t2 = t * t, t3 = t2 * t;
    const p0 = table[Math.max(0, i - 1)], p3 = table[Math.min(n - 1, i + 2)];
    const out = [];
    for (let k = 1; k < r0.length; k++) {
      if (!spline) { out.push(lerp(r0[k], r1[k], t)); continue; }
      const m0 = ((r1[k] - p0[k]) / (r1[0] - p0[0])) * h, m1 = ((p3[k] - r0[k]) / (p3[0] - r0[0])) * h;
      out.push((2 * t3 - 3 * t2 + 1) * r0[k] + (t3 - 2 * t2 + t) * m0 + (-2 * t3 + 3 * t2) * r1[k] + (t3 - t2) * m1);
    }
    return out;
  };
}

// 截面 q 上方位角 th 处的点：th = 0 正前方（-Z），+90° 是角色右侧（+X）。off 沿水平外法线偏出，e < 1 截面更方
export function ringPoint(q, cx, y, th, off = 0, e = 1) {
  const s = Math.sin(th), c = Math.cos(th), b = c >= 0 ? q[1] : q[2];
  cx += q[4] || 0;
  const nx = b * s, nz = -q[0] * c, l = Math.hypot(nx, nz) || 1;
  return [
    cx + q[0] * Math.sign(s) * Math.abs(s) ** e + (nx / l) * off, y,
    q[3] - b * Math.sign(c) * Math.abs(c) ** e + (nz / l) * off,
  ];
}

// 沿 Y 一圈圈叠起来的管子。ys 升序；skin(p) 给权重；off(y, th) 是额外的径向起伏
export function loftY(sb, mat, P, cx, ys, nu, skin, { tile = 0.4, e = 1, off = null, capTop = false, capBot = false } = {}) {
  const n = ys.length;
  sb.grid(mat, nu, n - 1 + (capTop ? 1 : 0) + (capBot ? 1 : 0), (i, j) => {
    let jj = j - (capBot ? 1 : 0), open = true;
    if (jj < 0) { jj = 0; open = false; } else if (jj >= n) { jj = n - 1; open = false; }
    const y = ys[jj], q = P(y), th = (i / nu) * Math.PI * 2;
    const p = open ? ringPoint(q, cx, y, th, off ? off(y, th) : 0, e) : [cx + (q[4] || 0), y, q[3] + (q[2] - q[1]) * 0.5];
    return { p, skin: skin(p) };
  }, tile);
}

// 贴在管壁上的一块鼓包（口袋、护板、魔术贴）：h(a, b) 是鼓出高度，a 横向、b 竖向，都在 [-1, 1]。
// ths、ys 是 [起, 止]（都要升序，法线才朝外）；base 取负值把边缘埋进底面
export function patch(sb, mat, P, cx, ths, ys, nu, nv, h, skin, { tile = 0.4, e = 1, base = -0.003 } = {}) {
  sb.grid(mat, nu, nv, (i, j) => {
    const y = lerp(ys[0], ys[1], j / nv), th = lerp(ths[0], ths[1], i / nu);
    const p = ringPoint(P(y), cx, y, th, base + h((i / nu) * 2 - 1, (j / nv) * 2 - 1, y, th), e);
    return { p, skin: skin(p) };
  }, tile);
}

const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const norm = (a) => { const l = Math.hypot(a[0], a[1], a[2]) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };
const tangent = (pts, j) => norm(sub(pts[Math.min(pts.length - 1, j + 1)], pts[Math.max(0, j - 1)]));

// 沿折线的圆管（手指、线缆、天线）；rad 是常数或每个点一个半径，两端收成圆头
export function tubePath(sb, mat, pts, rad, nu, skin, { tile = 0.25, cap = true } = {}) {
  const n = pts.length, r = (j) => (typeof rad === 'number' ? rad : rad[j]);
  // 平行移动法线，管子不拧
  const frames = [];
  let N = null;
  for (let j = 0; j < n; j++) {
    const T = tangent(pts, j);
    N ??= norm(cross(T, Math.abs(T[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0]));
    const d = N[0] * T[0] + N[1] * T[1] + N[2] * T[2];
    N = norm([N[0] - T[0] * d, N[1] - T[1] * d, N[2] - T[2] * d]);
    frames.push({ T, N, S: cross(N, T) });
  }
  const rows = [];
  if (cap) rows.push([0, 0, -0.9], [0, 0.72, -0.62]);
  for (let j = 0; j < n; j++) rows.push([j, 1, 0]);
  if (cap) rows.push([n - 1, 0.72, 0.62], [n - 1, 0, 0.9]);
  sb.grid(mat, nu, rows.length - 1, (i, k) => {
    const [j, kr, along] = rows[k], f = frames[j], ph = (i / nu) * Math.PI * 2;
    const c = Math.cos(ph) * r(j) * kr, s = Math.sin(ph) * r(j) * kr, a = along * r(j);
    const p = [0, 1, 2].map((m) => pts[j][m] + f.N[m] * c + f.S[m] * s + f.T[m] * a);
    return { p, skin: skin(p) };
  }, tile);
}

// 带子：pts 是带子贴着的表面点，nrm 是各点朝外的法线；w 宽、t 厚。首尾点相同就是闭合的一圈
export function strap(sb, mat, pts, nrm, w, t, skin, { tile = 0.4 } = {}) {
  const corners = [[-0.5, 0], [-0.5, 1], [0.5, 1], [0.5, 0], [-0.5, 0]];
  const closed = Math.hypot(...sub(pts[0], pts[pts.length - 1])) < 1e-6, n = pts.length;
  const tan = (j) => (closed && (j === 0 || j === n - 1) ? norm(sub(pts[1], pts[n - 2])) : tangent(pts, j));
  sb.grid(mat, 4, n - 1, (i, j) => {
    const N = norm(nrm[j]), S = norm(cross(tan(j), N));
    const [a, b] = corners[i];
    const p = [0, 1, 2].map((m) => pts[j][m] + S[m] * a * w + N[m] * b * t);
    return { p, skin: skin(p) };
  }, tile, true);
}

// 原点落在表面点上、+Z 朝外、+Y 朝上的摆放矩阵：把盒子类的零件贴到身体表面用
export function onSurface(P, cx, y, th, off = 0, e = 1) {
  const p = ringPoint(P(y), cx, y, th, off, e), q = ringPoint(P(y), cx, y, th, off + 1, e);
  const z = _v.set(q[0] - p[0], 0, q[2] - p[2]).normalize().clone();
  const x = new THREE.Vector3(0, 1, 0).cross(z);
  return new THREE.Matrix4().makeBasis(x, new THREE.Vector3(0, 1, 0), z).setPosition(p[0], p[1], p[2]);
}

// 骨权重：[骨, 权重, …] 去掉近零项、按权重从大到小取前四个（SkinBuilder.vert 会归一化）
export function W(...pairs) {
  const list = [];
  for (let i = 0; i + 1 < pairs.length; i += 2) if (pairs[i + 1] > 1e-3) list.push([pairs[i], pairs[i + 1]]);
  list.sort((a, b) => b[1] - a[1]);
  return list.slice(0, 4).flat();
}
