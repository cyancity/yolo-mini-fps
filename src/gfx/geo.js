import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';

const _q = new THREE.Quaternion();
const _e = new THREE.Euler();
const _p = new THREE.Vector3();
const _s = new THREE.Vector3();
const _a = new THREE.Vector3();
const _b = new THREE.Vector3();
const UP = new THREE.Vector3(0, 1, 0);

export function xf(x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0, sx = 1, sy = sx, sz = sx) {
  _q.setFromEuler(_e.set(rx, ry, rz, 'YXZ'));
  return new THREE.Matrix4().compose(_p.set(x, y, z), _q, _s.set(sx, sy, sz));
}

export const box = (w, h, d) => new THREE.BoxGeometry(w, h, d);
export const rbox = (w, h, d, r = 0.012, seg = 2) => new RoundedBoxGeometry(w, h, d, seg, Math.min(r, w / 2, h / 2, d / 2));
export const cyl = (rt, rb, h, seg = 16, open = false) => new THREE.CylinderGeometry(rt, rb, h, seg, 1, open);

export const lathe = (pts, seg = 24) => new THREE.LatheGeometry(pts.map(([r, y]) => new THREE.Vector2(r, y)), seg);

export function scaleUV(geo, su, sv, ou = 0, ov = 0) {
  const uv = geo.attributes.uv;
  for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * su + ou, uv.getY(i) * sv + ov);
  return geo;
}

// 两点之间的圆柱（管线、栏杆）
export function cylBetween(ax, ay, az, bx, by, bz, r, seg = 10) {
  _a.set(ax, ay, az);
  _b.set(bx, by, bz);
  const len = _a.distanceTo(_b);
  const g = new THREE.CylinderGeometry(r, r, len, seg, 1);
  _q.setFromUnitVectors(UP, _b.clone().sub(_a).normalize());
  g.applyMatrix4(new THREE.Matrix4().compose(_a.clone().add(_b).multiplyScalar(0.5), _q, _s.set(1, 1, 1)));
  return g;
}

// 2D 轮廓（[x,y] 数组）拉伸成体，沿 Z 居中；bevel 给边缘倒角好吃高光。
// 默认倒角把侧壁往外推 bevel；opts.inset 时侧壁正好落在给定轮廓上（端盖往里收 bevel），
// 按轮廓尺寸贴附件的调用方（面包车、叉车）要用它，否则附件会埋进外扩的壳里
export function extrude(pts, depth, bevel = 0.004, holes = [], { inset = false } = {}) {
  const shape = new THREE.Shape(pts.map(([x, y]) => new THREE.Vector2(x, y)));
  for (const h of holes) shape.holes.push(new THREE.Path(h.map(([x, y]) => new THREE.Vector2(x, y))));
  const g = new THREE.ExtrudeGeometry(shape, {
    depth: depth - bevel * 2, bevelEnabled: bevel > 0, bevelThickness: bevel, bevelSize: bevel,
    bevelOffset: inset ? -bevel : 0, bevelSegments: 2, curveSegments: 10, steps: 1,
  });
  g.translate(0, 0, -(depth - bevel * 2) / 2);
  return g;
}

// 按法线主轴投影 UV，纹理密度与世界尺寸一致（tile = 一张贴图覆盖的米数）
export function boxUV(geo, tile = 1, ou = 0, ov = 0) {
  const pos = geo.attributes.position, nor = geo.attributes.normal;
  const uv = new Float32Array(pos.count * 2);
  for (let i = 0; i < pos.count; i++) {
    const ax = Math.abs(nor.getX(i)), ay = Math.abs(nor.getY(i)), az = Math.abs(nor.getZ(i));
    let u, v;
    if (ay >= ax && ay >= az) { u = pos.getX(i); v = pos.getZ(i); }
    else if (ax >= az) { u = pos.getZ(i); v = pos.getY(i); }
    else { u = pos.getX(i); v = pos.getY(i); }
    uv[i * 2] = u / tile + ou;
    uv[i * 2 + 1] = v / tile + ov;
  }
  geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  return geo;
}

// 梯形波纹板：位于 XY 平面，凸向 +Z。默认竖纹；horizontal 时纹路沿 X 走。
export function corrugated(w, h, { pitch = 0.276, depth = 0.036, horizontal = false, tile = 2.6, ou = 0, ov = 0 } = {}) {
  const span = horizontal ? h : w, len = horizontal ? w : h;
  const n = Math.max(1, Math.round(span / pitch));
  const p = span / n;
  const prof = [];
  for (let i = 0; i < n; i++) {
    const o = i * p;
    prof.push([o, 0], [o + p * 0.28, 0], [o + p * 0.5, depth], [o + p * 0.78, depth]);
  }
  prof.push([span, 0]);
  const pos = [], nor = [], uv = [];
  const put = (a, b, z, na, nz) => {
    if (horizontal) { pos.push(b, a, z); nor.push(0, na, nz); uv.push(b / tile + ou, a / tile + ov); }
    else { pos.push(a, b, z); nor.push(na, 0, nz); uv.push(a / tile + ou, b / tile + ov); }
  };
  for (let i = 0; i < prof.length - 1; i++) {
    const [a0, z0] = prof[i], [a1, z1] = prof[i + 1];
    const da = a1 - a0, dz = z1 - z0, l = Math.hypot(da, dz);
    const na = -dz / l, nz = da / l;
    if (horizontal) {
      put(a0, 0, z0, na, nz); put(a0, len, z0, na, nz); put(a1, len, z1, na, nz);
      put(a0, 0, z0, na, nz); put(a1, len, z1, na, nz); put(a1, 0, z1, na, nz);
    } else {
      put(a0, 0, z0, na, nz); put(a1, 0, z1, na, nz); put(a1, len, z1, na, nz);
      put(a0, 0, z0, na, nz); put(a1, len, z1, na, nz); put(a0, len, z0, na, nz);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  return g;
}

// 把大量小几何体按材质合并成少数几个网格，降低 draw call
export class Batch {
  constructor() {
    this.groups = new Map();
  }

  // opts.tile：按世界尺寸重算 UV；opts.keepUV：保留几何体自带 UV
  add(mat, geo, matrix = null, opts = {}) {
    const g = geo.index ? geo.toNonIndexed() : geo.clone();
    if (matrix) {
      g.applyMatrix4(matrix);
      if (matrix.determinant() < 0) flipWinding(g);
    }
    if (opts.tile) boxUV(g, opts.tile, opts.ou || 0, opts.ov || 0);
    for (const k of Object.keys(g.attributes)) {
      if (k !== 'position' && k !== 'normal' && k !== 'uv') g.deleteAttribute(k);
    }
    if (!g.attributes.uv) g.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(g.attributes.position.count * 2), 2));
    g.morphAttributes = {};
    if (!this.groups.has(mat)) this.groups.set(mat, []);
    this.groups.get(mat).push(g);
    if (geo !== g && opts.dispose !== false) geo.dispose();
    return this;
  }

  build(parent, { cast = true, receive = true, layer = 0 } = {}) {
    const out = [];
    for (const [mat, list] of this.groups) {
      const merged = mergeGeometries(list, false);
      for (const g of list) g.dispose();
      merged.computeBoundingSphere();
      const mesh = new THREE.Mesh(merged, mat);
      mesh.castShadow = cast && !mat.userData.noShadow;
      mesh.receiveShadow = receive;
      mesh.layers.set(layer);
      parent.add(mesh);
      out.push(mesh);
    }
    this.groups.clear();
    return out;
  }
}

function flipWinding(g) {
  for (const name of Object.keys(g.attributes)) {
    const a = g.attributes[name], n = a.itemSize, arr = a.array;
    for (let i = 0; i < a.count; i += 3) {
      for (let k = 0; k < n; k++) {
        const t = arr[(i + 1) * n + k];
        arr[(i + 1) * n + k] = arr[(i + 2) * n + k];
        arr[(i + 2) * n + k] = t;
      }
    }
  }
}

// canvas 文字/标识贴图（集装箱编号、警示牌、地面喷字）
export function canvasTexture(w, h, draw, { srgb = true, aniso = 8 } = {}) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  draw(c.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  t.anisotropy = aniso;
  return t;
}
