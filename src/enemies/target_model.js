import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { xf, box, cyl, extrude, boxUV } from '../gfx/geo.js';

// 练习场钢靶的尺寸和命中形状。局部坐标：原点是底座落地点，+y 向上，靶面朝 +z（朝射手），铰链轴沿 x。
// 整高 1.75 m，和武装人员一样高：在这里练出来的手感要能直接用到真人身上
export const HINGE_Y = 0.17, HINGE_Z = -0.036;
export const PLATE_T = 0.012;
// 躯干板：凸多边形（逆时针），肩宽 0.5，腰宽 0.4
export const TORSO = [[-0.2, 0.86], [0.2, 0.86], [0.25, 1.33], [0.205, 1.44], [0.09, 1.49], [-0.09, 1.49], [-0.205, 1.44], [-0.25, 1.33]];
// 头板：椭圆，顶到 1.75
export const HEAD = { y: 1.632, rx: 0.1, ry: 0.118 };
// 倒下后的后仰角：靶杆顶头刚好着地，整块靶面朝天躺平
export const TILT_DOWN = 1.645;
// 靶面中心离铰链的高度（粗筛用）和包住两块靶板的半径
export const PLATE_CY = 1.3, PLATE_R = 0.52;

const TAU = Math.PI * 2;

// 靶面平面上的一点落在哪块板上：'head'、'torso' 或 null。按真实板形算，不是包围盒
export function plateHit(x, y) {
  const hx = x / HEAD.rx, hy = (y - HEAD.y) / HEAD.ry;
  if (hx * hx + hy * hy <= 1) return 'head';
  if (y < 0.86 || y > 1.49 || x < -0.25 || x > 0.25) return null;
  for (let i = 0, n = TORSO.length; i < n; i++) {
    const a = TORSO[i], b = TORSO[(i + 1) % n];
    if ((b[0] - a[0]) * (y - a[1]) - (b[1] - a[1]) * (x - a[0]) < 0) return null;
  }
  return 'torso';
}

// 拼几何体：统一成 position/normal/uv/aPaint 四个属性（aPaint 1 = 荧光漆，0 = 裸钢），最后合成一个
class Parts {
  constructor() { this.list = []; }

  add(geo, matrix, paint, tile = 0.6) {
    const g = geo.index ? geo.toNonIndexed() : geo;
    if (matrix) g.applyMatrix4(matrix);
    boxUV(g, tile);
    for (const k of Object.keys(g.attributes)) {
      if (k !== 'position' && k !== 'normal' && k !== 'uv') g.deleteAttribute(k);
    }
    g.clearGroups();
    g.setAttribute('aPaint', new THREE.BufferAttribute(new Float32Array(g.attributes.position.count).fill(paint), 1));
    this.list.push(g);
    if (g !== geo) geo.dispose();
    return this;
  }

  merge() {
    const out = mergeGeometries(this.list, false);
    for (const g of this.list) g.dispose();
    out.computeBoundingSphere();
    return out;
  }
}

function headOutline(n = 28) {
  const pts = [];
  for (let i = 0; i < n; i++) {
    const a = (i / n) * TAU;
    pts.push([Math.cos(a) * HEAD.rx, HEAD.y + Math.sin(a) * HEAD.ry]);
  }
  return pts;
}

// 绕铰链转的那一整块：两块靶板、背后的立杆和夹板、铰链套筒
export function buildPlateGeometry() {
  const p = new Parts(), z = HINGE_Z, bz = -PLATE_T / 2 - 0.0025;
  p.add(extrude(TORSO, PLATE_T, 0.002), null, 1);
  p.add(extrude(headOutline(), PLATE_T, 0.002), null, 1);
  // 躯干板正面的三颗马车螺栓，跟板一起刷了漆
  for (const [x, y] of [[-0.13, 1.4], [0.13, 1.4], [0, 0.915]]) p.add(cyl(0.014, 0.014, 0.008, 8), xf(x, y, PLATE_T / 2 + 0.003, Math.PI / 2, 0, 0), 1);
  // 立杆（方管）和背后的夹板
  p.add(box(0.05, 1.6 - HINGE_Y, 0.05), xf(0, (1.6 + HINGE_Y) / 2, z), 0);
  p.add(box(0.36, 0.06, 0.005), xf(0, 1.22, bz), 0);
  p.add(box(0.3, 0.05, 0.005), xf(0, 0.95, bz), 0);
  p.add(box(0.05, 0.2, 0.005), xf(0, 1.63, bz), 0);
  // 立杆根部的加强筋和铰链套筒
  for (const s of [-1, 1]) p.add(box(0.008, 0.16, 0.06), xf(s * 0.029, HINGE_Y + 0.1, z), 0);
  p.add(cyl(0.03, 0.03, 0.16, 12), xf(0, HINGE_Y, z, 0, 0, Math.PI / 2), 0);
  return p.merge();
}

// 底座：脚板、两片耳板夹着销轴、前面一块斜挡板护住铰链，后面一根横向支脚防倾
export function buildBaseGeometry() {
  const p = new Parts(), z = HINGE_Z;
  p.add(box(0.6, 0.03, 0.72), xf(0, 0.015, -0.12), 0);
  p.add(box(0.95, 0.04, 0.07), xf(0, 0.02, -0.4), 0);
  for (const s of [-1, 1]) {
    p.add(box(0.012, 0.17, 0.13), xf(s * 0.095, 0.03 + 0.085, z), 0);
    p.add(box(0.012, 0.12, 0.012), xf(s * 0.2, 0.09, 0.12, -0.55, 0, 0), 0);
  }
  p.add(cyl(0.012, 0.012, 0.25, 8), xf(0, HINGE_Y, z, 0, 0, Math.PI / 2), 0);
  p.add(box(0.46, 0.19, 0.01), xf(0, 0.11, 0.16, -0.7, 0, 0), 0);
  return p.merge();
}
