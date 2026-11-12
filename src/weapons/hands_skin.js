import * as THREE from 'three';
import { boxUV } from '../gfx/geo.js';

export const lerp = (a, b, t) => a + (b - a) * t;
export const clamp01 = (t) => Math.min(1, Math.max(0, t));
export const smooth = (t) => { t = clamp01(t); return t * t * (3 - 2 * t); };
export const bump = (d, w) => Math.exp(-(d * d) / (w * w));

// 带骨权重的几何构建器。格网顶点的法线由面累加得到，再把位置重合的顶点焊到一起：
// 背侧/掌侧两块材质各有自己连续的 UV，接缝处的光照仍然连续。
export class SkinGeo {
  constructor() {
    this.pos = []; this.nor = []; this.uv = []; this.bi = []; this.bw = [];
    this.soft = [];
    this.tris = new Map();
  }

  vert(p, uv, skin, n = null) {
    this.pos.push(p[0], p[1], p[2]);
    this.nor.push(n ? n[0] : 0, n ? n[1] : 0, n ? n[2] : 0);
    this.uv.push(uv[0], uv[1]);
    for (let k = 0; k < 4; k++) { this.bi.push(skin[k * 2] || 0); this.bw.push(skin[k * 2 + 1] || 0); }
    this.soft.push(n ? 0 : 1);
    return this.soft.length - 1;
  }

  tri(mat, a, b, c) {
    let list = this.tris.get(mat);
    if (!list) this.tris.set(mat, (list = []));
    list.push(a, b, c);
  }

  // (nu+1)×(nv+1) 格网，fn(i, j) → { p, skin }。外法线 = j 切向 × i 切向，flip 时反过来。
  // UV 用格网上的实际弧长（i 向以中间那列为零点），贴图密度处处是 1/tile。
  grid(mat, nu, nv, fn, tile, flip = false) {
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

  // 现成几何体整块跟一根骨头走，保留它自带的法线
  rigid(mat, geo, matrix, bone, tile) {
    const g = geo.index ? geo.toNonIndexed() : geo;
    g.applyMatrix4(matrix);
    boxUV(g, tile);
    const P = g.attributes.position, N = g.attributes.normal, U = g.attributes.uv, base = this.soft.length;
    for (let i = 0; i < P.count; i++) {
      this.vert([P.getX(i), P.getY(i), P.getZ(i)], [U.getX(i), U.getY(i)], [bone, 1], [N.getX(i), N.getY(i), N.getZ(i)]);
    }
    for (let i = 0; i < P.count; i += 3) this.tri(mat, base + i, base + i + 1, base + i + 2);
    g.dispose();
  }

  #normals() {
    const P = this.pos, N = this.nor, n = this.soft.length;
    for (const idx of this.tris.values()) {
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
    const key = (i) => `${Math.round(P[i * 3] * 2e5)},${Math.round(P[i * 3 + 1] * 2e5)},${Math.round(P[i * 3 + 2] * 2e5)}`;
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

  // 返回 Map<材质键, BufferGeometry>，各几何体共用同一套顶点缓冲。mirror：沿 X 镜像成左手
  build(mirror = false) {
    this.#normals();
    if (mirror) {
      for (let i = 0; i < this.pos.length; i += 3) { this.pos[i] = -this.pos[i]; this.nor[i] = -this.nor[i]; }
      for (const idx of this.tris.values()) {
        for (let t = 0; t < idx.length; t += 3) { const b = idx[t + 1]; idx[t + 1] = idx[t + 2]; idx[t + 2] = b; }
      }
    }
    const attrs = {
      position: new THREE.Float32BufferAttribute(this.pos, 3),
      normal: new THREE.Float32BufferAttribute(this.nor, 3),
      uv: new THREE.Float32BufferAttribute(this.uv, 2),
      skinIndex: new THREE.Uint16BufferAttribute(this.bi, 4),
      skinWeight: new THREE.Float32BufferAttribute(this.bw, 4),
    };
    const out = new Map();
    for (const [mat, idx] of this.tris) {
      const g = new THREE.BufferGeometry();
      for (const k in attrs) g.setAttribute(k, attrs[k]);
      g.setIndex(idx);
      out.set(mat, g);
    }
    return out;
  }
}
