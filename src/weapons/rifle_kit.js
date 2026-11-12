// 步枪建模用的小工具：轮廓处理、蒙皮、导轨、夹具、螺丝、刻字贴花
import * as THREE from 'three';
import { toCreasedNormals } from 'three/addons/utils/BufferGeometryUtils.js';
import { Batch, extrude, xf, cylBetween } from '../gfx/geo.js';

export const RAIL_Y = 0.0305; // 导轨顶面到枪管轴线的高度
export const DECK_Y = 0.0225; // 机匣顶面、护木顶面（导轨座落在这里）

// boxUV 的贴图幅面。比材质表里的默认值小：枪离镜头只有二三十厘米，按默认幅面颗粒有一毫米多，
// 金属像铸铁、塑料像砂石；缩小以后是细喷砂和细麻面
const TILE = { metal: 0.1, steel: 0.12, poly: 0.03, rubber: 0.03 };

// 轮廓坐标 → 整枪坐标的三种摆法
export const SIDE = (x = 0) => xf(x, 0, 0, 0, -Math.PI / 2, 0); // 侧视轮廓 [z, y]，沿 X 拉伸
export const PLAN = (y = 0) => xf(0, y, 0, -Math.PI / 2, 0, 0); // 俯视轮廓 [x, -z]，沿 Y 拉伸
export const FWD = xf(0, 0, 0, -Math.PI / 2, 0, 0); // lathe 的轴 → 枪口方向（-Z），轮廓写 [半径, 向前的距离]

// 一个部件一套批处理。建模一律用整枪坐标，origin 是部件自己的原点，这里统一减掉
export function makeKit(gear, origin = [0, 0, 0], extra = {}) {
  const b = new Batch();
  const off = new THREE.Matrix4().makeTranslation(-origin[0], -origin[1], -origin[2]);
  const put = (mat, tile) => (geo, m) => { b.add(mat, geo, m ? off.clone().multiply(m) : off, tile ? { tile } : {}); };
  const k = {
    metal: put(gear.metal, TILE.metal), steel: put(gear.steel, TILE.steel), poly: put(gear.polymer, TILE.poly), rubber: put(gear.rubber, TILE.rubber),
    black: put(gear.black), brass: put(gear.brass), lens: put(gear.lens),
    group: new THREE.Group(),
  };
  for (const [name, mat] of Object.entries(extra)) k[name] = put(mat);
  k.group.position.set(origin[0], origin[1], origin[2]);
  k.finish = (name) => {
    b.build(k.group, { cast: false });
    k.group.name = name;
    return k.group;
  };
  return k;
}

// toCreasedNormals 按 0.01 的格子合并顶点，米制的小零件会被揉成一团，先放大到毫米再算。
// 默认 20°：圆弧分段被抹平，倒角（最小 22.5°）和直角保持硬边
export function crisp(g, angle = 0.35) {
  g.scale(1000, 1000, 1000);
  const out = toCreasedNormals(g, angle);
  if (out !== g) g.dispose();
  return out.scale(0.001, 0.001, 0.001);
}

export function arc(cx, cy, r, d0, d1, n) {
  const out = [];
  for (let i = 0; i <= n; i++) {
    const a = ((d0 + ((d1 - d0) * i) / n) * Math.PI) / 180;
    out.push([cx + Math.cos(a) * r, cy + Math.sin(a) * r]);
  }
  return out;
}

export function rect(cx, cy, hw, hh, c = 0) {
  if (!c) return [[cx - hw, cy - hh], [cx + hw, cy - hh], [cx + hw, cy + hh], [cx - hw, cy + hh]];
  return [
    [cx - hw + c, cy - hh], [cx + hw - c, cy - hh], [cx + hw, cy - hh + c], [cx + hw, cy + hh - c],
    [cx + hw - c, cy + hh], [cx - hw + c, cy + hh], [cx - hw, cy + hh - c], [cx - hw, cy - hh + c],
  ];
}

// 圆角矩形：r 是圆角半径，每个角分 n 段
export function rrect(cx, cy, hw, hh, r, n = 6) {
  return [
    ...arc(cx + hw - r, cy - hh + r, r, -90, 0, n), ...arc(cx + hw - r, cy + hh - r, r, 0, 90, n),
    ...arc(cx - hw + r, cy + hh - r, r, 90, 180, n), ...arc(cx - hw + r, cy - hh + r, r, 180, 270, n),
  ];
}

// 把闭合轮廓的每个拐角切掉 c，拉伸后就是一条吃高光的小倒角；太短的边和近乎直线的拐角不动
export function chamfer(pts, c) {
  const n = pts.length, out = [];
  for (let i = 0; i < n; i++) {
    const a = pts[(i + n - 1) % n], p = pts[i], b = pts[(i + 1) % n];
    const la = Math.hypot(p[0] - a[0], p[1] - a[1]), lb = Math.hypot(b[0] - p[0], b[1] - p[1]);
    const turn = ((p[0] - a[0]) * (b[1] - p[1]) - (p[1] - a[1]) * (b[0] - p[0])) / (la * lb);
    if (la < c * 2.5 || lb < c * 2.5 || Math.abs(turn) < 0.3) {
      out.push(p);
      continue;
    }
    out.push([p[0] + ((a[0] - p[0]) * c) / la, p[1] + ((a[1] - p[1]) * c) / la], [p[0] + ((b[0] - p[0]) * c) / lb, p[1] + ((b[1] - p[1]) * c) / lb]);
  }
  return out;
}

// 把闭合轮廓的拐角换成圆角（半径 r，每个角分 n 段）；边太短放不下时半径自动收小
export function fillet(pts, r, n = 4) {
  const m = pts.length, out = [];
  for (let i = 0; i < m; i++) {
    const a = pts[(i + m - 1) % m], p = pts[i], b = pts[(i + 1) % m];
    const ux = a[0] - p[0], uy = a[1] - p[1], vx = b[0] - p[0], vy = b[1] - p[1];
    const la = Math.hypot(ux, uy), lb = Math.hypot(vx, vy);
    const half = Math.acos(Math.max(-1, Math.min(1, (ux * vx + uy * vy) / (la * lb)))) / 2;
    // 切点到拐角的距离
    const t = Math.min(r / Math.tan(half), la * 0.45, lb * 0.45);
    if (!(t > 1e-6) || half > 1.5) {
      out.push(p);
      continue;
    }
    const p0 = [p[0] + (ux / la) * t, p[1] + (uy / la) * t], p1 = [p[0] + (vx / lb) * t, p[1] + (vy / lb) * t];
    for (let j = 0; j <= n; j++) {
      const s = j / n, k0 = (1 - s) * (1 - s), k1 = 2 * s * (1 - s), k2 = s * s;
      out.push([p0[0] * k0 + p[0] * k1 + p1[0] * k2, p0[1] * k0 + p[1] * k1 + p1[1] * k2]);
    }
  }
  return out;
}

// 两头半圆的长孔，长轴沿第一个坐标
export const slot = (cx, cy, hl, hw, n = 5) => [...arc(cx + hl - hw, cy, hw, -90, 90, n), ...arc(cx - hl + hw, cy, hw, 90, 270, n)];

// 斜着的长孔：长轴从第一个坐标轴转过 deg 度
export function slant(cx, cy, hl, hw, deg, n = 5) {
  const c = Math.cos((deg * Math.PI) / 180), s = Math.sin((deg * Math.PI) / 180);
  return slot(0, 0, hl, hw, n).map(([x, y]) => [cx + x * c - y * s, cy + x * s + y * c]);
}

// 过控制点的平滑折线（Catmull-Rom），每段分 n 份
export function curve(pts, n = 4) {
  const out = [], last = pts.length - 1;
  for (let i = 0; i < last; i++) {
    const p0 = pts[Math.max(i - 1, 0)], p1 = pts[i], p2 = pts[i + 1], p3 = pts[Math.min(i + 2, last)];
    for (let j = 0; j < n; j++) {
      const t = j / n, t2 = t * t, t3 = t2 * t;
      out.push([0, 1].map((a) => 0.5 * (2 * p1[a] + (p2[a] - p0[a]) * t + (2 * p0[a] - 5 * p1[a] + 4 * p2[a] - p3[a]) * t2 + (3 * p1[a] - p0[a] - 3 * p2[a] + p3[a]) * t3)));
    }
  }
  out.push(pts[last]);
  return out;
}

// 开口折线加厚成带状轮廓（护圈、扳机、弹匣筋条这类弯条）
export function strip(pts, t) {
  const left = [], right = [], n = pts.length;
  for (let i = 0; i < n; i++) {
    const a = pts[Math.max(i - 1, 0)], b = pts[Math.min(i + 1, n - 1)];
    const dx = b[0] - a[0], dy = b[1] - a[1], l = Math.hypot(dx, dy) || 1;
    const nx = (-dy / l) * t * 0.5, ny = (dx / l) * t * 0.5;
    left.push([pts[i][0] + nx, pts[i][1] + ny]);
    right.push([pts[i][0] - nx, pts[i][1] - ny]);
  }
  return left.concat(right.reverse());
}

// extrude 的倒角会把轮廓向外撑大一圈，这里先内缩同样的量，成品外形就等于图纸
function inset(src, d) {
  const pts = src.filter((p, i) => {
    const q = src[(i + 1) % src.length];
    return Math.hypot(p[0] - q[0], p[1] - q[1]) > 1e-6;
  });
  const n = pts.length;
  let area = 0;
  for (let i = 0; i < n; i++) area += pts[i][0] * pts[(i + 1) % n][1] - pts[(i + 1) % n][0] * pts[i][1];
  const s = area > 0 ? 1 : -1;
  return pts.map((p, i) => {
    const a = pts[(i + n - 1) % n], c = pts[(i + 1) % n];
    const ul = Math.hypot(p[0] - a[0], p[1] - a[1]), vl = Math.hypot(c[0] - p[0], c[1] - p[1]);
    const n1x = (-(p[1] - a[1]) / ul) * s, n1y = ((p[0] - a[0]) / ul) * s;
    const n2x = (-(c[1] - p[1]) / vl) * s, n2y = ((c[0] - p[0]) / vl) * s;
    const k = d / Math.max(0.2, 1 + n1x * n2x + n1y * n2y);
    return [p[0] + (n1x + n2x) * k, p[1] + (n1y + n2y) * k];
  });
}

// 轮廓拉伸成体：外形尺寸按图纸，圆弧段平滑着色
export function ex(pts, depth, bevel = 0.001, holes = []) {
  const g = bevel > 0
    ? extrude(inset(pts, bevel), depth, bevel, holes.map((h) => inset(h, -bevel)))
    : extrude(pts, depth, 0, holes);
  return crisp(g);
}

// 超椭圆截面环：中心 c，沿 u、v 两个单位轴展开（e = 2 是椭圆，越大越方）
export function ring(c, u, v, hu, hv, e = 2.6, n = 24) {
  const out = [];
  for (let i = 0; i < n; i++) {
    const t = (i / n) * Math.PI * 2, cs = Math.cos(t), sn = Math.sin(t);
    const a = Math.sign(cs) * Math.abs(cs) ** (2 / e) * hu, b = Math.sign(sn) * Math.abs(sn) ** (2 / e) * hv;
    out.push([c[0] + u[0] * a + v[0] * b, c[1] + u[1] * a + v[1] * b, c[2] + u[2] * a + v[2] * b]);
  }
  return out;
}

// 一串点数相同的截面环蒙皮成体，侧面平滑、两端硬封口（握把、枪托这类有机形状）
export function loft(rings) {
  const n = rings[0].length, m = rings.length, pos = [], idx = [];
  for (const r of rings) for (const p of r) pos.push(p[0], p[1], p[2]);
  for (let i = 0; i < m - 1; i++) {
    for (let j = 0; j < n; j++) {
      const a = i * n + j, b = i * n + ((j + 1) % n);
      idx.push(a, b, a + n, b, b + n, a + n);
    }
  }
  for (const [r, last] of [[rings[0], false], [rings[m - 1], true]]) {
    const base = pos.length / 3;
    let cx = 0, cy = 0, cz = 0;
    for (const p of r) { pos.push(p[0], p[1], p[2]); cx += p[0]; cy += p[1]; cz += p[2]; }
    pos.push(cx / n, cy / n, cz / n);
    for (let j = 0; j < n; j++) {
      const a = base + j, b = base + ((j + 1) % n);
      if (last) idx.push(a, b, base + n); else idx.push(b, a, base + n);
    }
  }
  // 环的绕向由调用方的 u、v 决定：用有符号体积判断朝向，朝里就整体翻面
  let vol = 0;
  for (let i = 0; i < idx.length; i += 3) {
    const a = idx[i] * 3, b = idx[i + 1] * 3, c = idx[i + 2] * 3;
    vol += pos[a] * (pos[b + 1] * pos[c + 2] - pos[b + 2] * pos[c + 1])
      + pos[a + 1] * (pos[b + 2] * pos[c] - pos[b] * pos[c + 2])
      + pos[a + 2] * (pos[b] * pos[c + 1] - pos[b + 1] * pos[c]);
  }
  if (vol < 0) for (let i = 0; i < idx.length; i += 3) { const t = idx[i + 1]; idx[i + 1] = idx[i + 2]; idx[i + 2] = t; }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

// 螺丝或销头：a → b 的短圆柱，b 端压一个黑色内六角
export function screw(k, ax, ay, az, bx, by, bz, r, hex = true) {
  k.steel(cylBetween(ax, ay, az, bx, by, bz, r, 12));
  if (!hex) return;
  const dx = bx - ax, dy = by - ay, dz = bz - az, e = 0.0003 / Math.hypot(dx, dy, dz);
  k.black(cylBetween(ax, ay, az, bx + dx * e, by + dy * e, bz + dz * e, r * 0.52, 6));
}

const TOOTH = [[-0.0078, 0], [0.0078, 0], [0.0106, -0.003], [-0.0106, -0.003]];
const BASE = [[-0.0106, -0.003], [0.0106, -0.003], [0.0078, -0.0058], [0.0078, -0.0082], [-0.0078, -0.0082], [-0.0078, -0.0058]];
// 悬空的导轨段用的薄底座：燕尾以下只留 0.6 mm
export const RAIL_SLIM = [[-0.0106, -0.003], [0.0106, -0.003], [0.0078, -0.0058], [0.0078, -0.0064], [-0.0078, -0.0064], [-0.0078, -0.0058]];

// 皮卡汀尼导轨：z0 是后端，朝枪口铺 n 个齿（齿距 10 mm，槽宽 5.2 mm）；y 是齿顶高度；base 是齿下面那段的截面
export function rail(k, z0, n, y = RAIL_Y, base = BASE) {
  const len = n * 0.01 - 0.0052;
  k.metal(ex(base, len, 0.0004), xf(0, y, z0 - len / 2));
  for (let i = 0; i < n; i++) k.metal(ex(TOOTH, 0.0048, 0.0004), xf(0, y, z0 - 0.0024 - i * 0.01));
}

const JAW = [[-0.0152, 0.003], [-0.0152, -0.0064], [-0.0088, -0.0064], [-0.0088, -0.005], [-0.011, -0.0028], [-0.011, 0.003]];

// 导轨附件的夹具：左右夹爪扣住燕尾，左侧露出横栓螺帽；y 是被夹导轨的齿顶高度
export function railClamp(k, zc, len, bolts = [zc], y = RAIL_Y) {
  k.metal(ex(JAW, len, 0.0006), xf(0, y, zc));
  k.metal(ex(JAW.map(([x, v]) => [-x, v]), len, 0.0006), xf(0, y, zc));
  const by = y - 0.0018;
  for (const z of bolts) {
    k.steel(cylBetween(-0.015, by, z, -0.0182, by, z, 0.0038, 6));
    k.steel(cylBetween(0.015, by, z, 0.0166, by, z, 0.003, 12));
    k.black(cylBetween(-0.0182, by, z, -0.0185, by, z, 0.0016, 12));
  }
}

// 贴花四边形，UV 取图集里的像素矩形 [x, y, w, h]
export function decalQuad(w, h, [px, py, pw, ph], texW, texH) {
  const g = new THREE.PlaneGeometry(w, h), uv = g.attributes.uv;
  for (let i = 0; i < uv.count; i++) uv.setXY(i, (px + uv.getX(i) * pw) / texW, 1 - (py + (1 - uv.getY(i)) * ph) / texH);
  return g;
}
