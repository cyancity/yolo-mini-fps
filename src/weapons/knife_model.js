// 爪刀（Karambit）程序化模型：整块钢板（刀身 + 钢衬 + 指环）两侧夹 G10 柄片。
// 设计坐标用毫米：u 朝前（世界 -Z）、v 朝上（世界 +Y）、x 是厚度方向；出网格时换算成米。
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { Batch, canvasTexture } from '../gfx/geo.js';
import { makeEmerald } from './knife_gem.js';

const MM = 0.001;
const H = 1.9;                    // 钢板半厚（板厚 3.8）
const CH = 0.4;                   // 钢板棱边倒角
const RING_V = 52.5, RO = 18.5, RI = 12.5;
const RING = [RING_V * RING_V / 600, RING_V];
const VJ = -36;                   // 握柄与刀身的分界（沿中线的 v）
const SCREWS = [-26, -1, 24];
const GRIP = [-1.7, 0];           // 握柄截面中心（root 原点），比中线略靠后缘
const GRIND = 16, EDGE_W = 1.1, EDGE_H = 0.35;      // 研磨线到刃的距离、刃口斜面宽、刃肩半厚
const SLOPE = (H - EDGE_H) / (GRIND - EDGE_W);      // 主研磨面斜率

const lerp = (a, b, t) => a + (b - a) * t;
const smooth = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
const bump = (x, w) => (Math.abs(x) < w ? Math.cos(Math.PI / 2 * x / w) ** 2 : 0);
const circle = (c, r, n) => Array.from({ length: n }, (_, i) => [c[0] + r * Math.cos(i / n * Math.PI * 2), c[1] + r * Math.sin(i / n * Math.PI * 2)]);
const area = (p) => p.reduce((s, a, i) => { const b = p[(i + 1) % p.length]; return s + a[0] * b[1] - b[0] * a[1]; }, 0);

// 握柄中线是一段很缓的抛物线（整刀呈月牙形）；side 返回中线旁偏移 w 的点，w > 0 朝前
function side(v, w) {
  const l = Math.hypot(1, v / 300);
  return [v * v / 600 + w / l, v - w * v / 300 / l];
}
// 前缘半宽：三道指槽，靠刀身一端外扩成护指
const wFront = (v) => 14 - (Math.abs(v) < 30 ? 1.2 * (1 - Math.cos(Math.PI * (v + 30) / 10)) : 0) + 4.5 * smooth(-24, -34, v);
// 后缘半宽：中段略鼓，贴掌心
const wBack = (v) => 15 + 1.2 * Math.cos(Math.min(1, Math.abs(v - 4) / 40) * Math.PI / 2) ** 2;
// 拇指防滑齿，横跨握柄与刀身的分界（s 是沿中线离分界的距离，握柄一侧为负）。
// 分界正好落在一道齿槽的槽底，钢衬和刀身两种材质的色差就藏在槽里。
const jimp = (s) => (s > -6.9 && s < 20.9 ? 0.45 * bump(((s + 1) % 2 + 2) % 2 - 1, 0.65) : 0);

// 刀身中线：切线角从握柄中线的方向连续转到刀尖略微上挑，越靠刀尖弯得越急
const TH0 = Math.atan2(-1, -VJ / 300), TH1 = 0.09;
const theta = (t) => TH0 + (TH1 - TH0) * t ** 1.25;
const LEN = (() => { // 中线弧长：按弦长 85 反推
  let x = 0, y = 0;
  for (let i = 0; i < 400; i++) { x += Math.cos(theta((i + 0.5) / 400)); y += Math.sin(theta((i + 0.5) / 400)); }
  return 85 * 400 / Math.hypot(x, y);
})();

function geo(pos, uv, nor, idx) {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  if (idx) g.setIndex(idx);
  if (nor) g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  else g.computeVertexNormals();
  return g;
}

// rows[j][i] = [x, y, z, u, v]。cuts 把每行切成若干条带：带内共用顶点（平滑），带间各有一套顶点（硬棱）。
// 条带末尾的列号可以等于行长，表示绕回第 0 列；closed 表示最后一行接回第一行。
function strips(rows, cuts, closed = false) {
  const pos = [], uv = [], idx = [], n = rows.length;
  const same = (a, b) => pos[a * 3] === pos[b * 3] && pos[a * 3 + 1] === pos[b * 3 + 1] && pos[a * 3 + 2] === pos[b * 3 + 2];
  const tri = (a, b, c) => { if (!same(a, b) && !same(b, c) && !same(a, c)) idx.push(a, b, c); }; // 塌缩的条带不出三角形
  for (let c = 0; c + 1 < cuts.length; c++) {
    const i0 = cuts[c], w = cuts[c + 1] - i0 + 1, base = pos.length / 3;
    for (const r of rows) for (let i = i0; i < i0 + w; i++) { const p = r[i % r.length]; pos.push(p[0], p[1], p[2]); uv.push(p[3], p[4]); }
    for (let j = 0; j < (closed ? n : n - 1); j++) for (let i = 0; i < w - 1; i++) {
      const a = base + j * w + i, b = base + ((j + 1) % n) * w + i;
      tri(a, b, b + 1);
      tri(a, b + 1, a + 1);
    }
  }
  return geo(pos, uv, null, idx);
}

// 把折线上第 i 个顶点处的折角换成二次贝塞尔过渡（前后各退 d）
function fillet(pts, i, d, n = 14) {
  const cut = (dir) => {
    for (let k = i, left = d; ; k += dir) {
      const p = pts[k], q = pts[k + dir], l = Math.hypot(q[0] - p[0], q[1] - p[1]);
      if (l >= left) return [k + dir, [lerp(p[0], q[0], left / l), lerp(p[1], q[1], left / l)]];
      left -= l;
    }
  };
  const [ia, a] = cut(-1), [ib, b] = cut(1), c = pts[i], arc = [];
  for (let j = 0; j <= n; j++) {
    const t = j / n, w0 = (1 - t) ** 2, w1 = 2 * t * (1 - t), w2 = t * t;
    arc.push([a[0] * w0 + c[0] * w1 + b[0] * w2, a[1] * w0 + c[1] * w1 + b[1] * w2]);
  }
  pts.splice(ia + 1, ib - ia - 1, ...arc);
}

const QUAD = [[0, 0], [1, 0], [1, 1], [0, 0], [1, 1], [0, 1]];

// 把二维轮廓沿厚度方向放样成板。contours[0] 是外轮廓，其余是孔。
// prof 是若干段 [内缩量, x] 折线（x 递增）：段内平滑，段与段之间是硬棱；lo / hi 表示在最低 / 最高剖面点封平面。
// open 表示轮廓的收尾边不出侧壁也不内缩（钢衬和刀身在那里对接）。
function plate(contours, lo, hi, tile) {
  const pos = [], nor = [], uv = [];
  const put = (p, x, nu, nv, nx, tu, tv) => { pos.push(x * MM, p[1] * MM, -p[0] * MM); nor.push(nx, nv, -nu); uv.push(tu / tile, tv / tile); };
  const loops = contours.map(({ pts, prof, open }, ci) => {
    if ((area(pts) > 0) !== (ci === 0)) pts.reverse(); // 外轮廓逆时针、孔顺时针：实体总在行进方向左侧
    const n = pts.length, en = [], vn = [], len = [0];
    for (let k = 0; k < n; k++) {
      const a = pts[k], b = pts[(k + 1) % n], l = Math.hypot(b[0] - a[0], b[1] - a[1]);
      en.push([(a[1] - b[1]) / l, (b[0] - a[0]) / l]);
      len.push(len[k] + l);
    }
    for (let k = 0; k < n; k++) {
      const q = open && k === n - 1 ? en[k - 1] : en[k], p = open && k === 0 ? q : en[(k + n - 1) % n];
      const mx = p[0] + q[0], my = p[1] + q[1], l = Math.hypot(mx, my), miter = l * Math.max(0.5, (mx * q[0] + my * q[1]) / l);
      vn.push([mx / miter, my / miter, p[0] * q[0] + p[1] * q[1] < 0.5]); // 朝实体内的偏移方向（含斜接）、是否硬角
    }
    const at = (k, d) => [pts[k % n][0] + vn[k % n][0] * d, pts[k % n][1] + vn[k % n][1] * d];
    for (const seg of prof) {
      const sn = [];
      for (let r = 0; r + 1 < seg.length; r++) {
        const di = seg[r + 1][0] - seg[r][0], dx = seg[r + 1][1] - seg[r][1], l = Math.hypot(di, dx);
        sn.push([dx / l, di / l]);
      }
      for (let k = 0; k < (open ? n - 1 : n); k++) for (let r = 0; r + 1 < seg.length; r++) for (const [dk, dr] of QUAD) {
        const kk = k + dk, rr = r + dr, v = vn[kk % n], o = v[2] ? en[k] : v;
        const a = sn[Math.max(0, rr - 1)], b = sn[Math.min(sn.length - 1, rr)], l = Math.hypot(a[0] + b[0], a[1] + b[1]), c = (a[0] + b[0]) / l;
        put(at(kk, seg[rr][0]), seg[rr][1], -o[0] * c, -o[1] * c, (a[1] + b[1]) / l, len[kk], seg[rr][1]);
      }
    }
    return { at, n };
  });
  for (const sg of [-1, 1]) {
    if (!(sg < 0 ? lo : hi)) continue;
    const pick = (prof) => (sg < 0 ? prof[0][0] : prof.at(-1).at(-1));
    const rings = loops.map((r, ci) => Array.from({ length: r.n }, (_, k) => new THREE.Vector2(...r.at(k, pick(contours[ci].prof)[0]))));
    const all = rings.flat(), x = pick(contours[0].prof)[1];
    for (const f of THREE.ShapeUtils.triangulateShape(rings[0], rings.slice(1))) {
      const [a, b, c] = f.map((i) => all[i]);
      const ccw = (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x) > 0;
      for (const p of ccw === sg > 0 ? [a, b, c] : [a, c, b]) put([p.x, p.y], x, 0, 0, sg, -p.x, p.y);
    }
  }
  return geo(pos, uv, nor);
}

// 刀身横截面（s 是沿中线离握柄的距离）。返回刀背一侧的半宽 ws，以及半边剖面点 [离刀背的距离, 半厚]：
// 刀背棱 → 刀背斜面终点 → 血槽 ×5 → 研磨线 → 凹磨中间点 ×3 → 刃肩 → 刃尖
function section(s) {
  const half = 15 * (1 - (s / LEN) ** 1.8);
  const ws = half - jimp(s);
  const we = half + 3.5 * (1 - smooth(2, 11, s)) - 2.2 * bump(s - 12, 2.6);  // 护指凸起、刃根的磨刀缺口
  const W = ws + we;
  const g = smooth(13.2, 15.2, s);                  // 0 = 未开刃的刀根，1 = 完整研磨；过渡段就是研磨起始线
  const m = smooth(0.4 * LEN, 0.54 * LEN, s);       // 假刃（刀背斜面）从中段渐入
  const hs0 = lerp(H - CH, 0.3, m), ts = lerp(1, 0.36, m);
  const bsh = lerp(CH, EDGE_W, g), hsh = lerp(H, EDGE_H, g), ash = Math.max(0, W - bsh);
  let a2 = W - CH - (GRIND - CH) * g ** 0.6, a1 = (H - hs0) / ts, h1 = H;
  if (a2 < a1) { // 靠近刀尖平面消失：假刃斜面和主研磨面直接交成一条脊
    a1 = a2 = Math.min(ash, Math.max(0, (hsh + ash * SLOPE - hs0) / (ts + SLOPE)));
    h1 = Math.min(hs0 + a1 * ts, hsh + (ash - a1) * SLOPE);
  }
  const pts = [[0, Math.min(hs0, h1)], [a1, h1]];
  const fd = 0.45 * smooth(23, 25.5, s) * (1 - smooth(42.5, 45, s)); // 血槽：贴着刀背走，两端渐浅
  for (let q = -1; q <= 1; q += 0.5) pts.push([Math.min(a2, Math.max(a1, 4 + 1.2 * q)), h1 - fd * Math.cos(Math.PI / 2 * q) ** 2]);
  pts.push([a2, h1]);
  const sag = g * (ash - a2) ** 2 / 880;            // 凹磨：砂轮半径约 110
  for (let q = 0.25; q < 1; q += 0.25) pts.push([lerp(a2, ash, q), lerp(h1, hsh, q) - sag * 4 * q * (1 - q)]);
  pts.push([ash, hsh], [W, lerp(H - CH, 0, g)]);
  const k = Math.min(1, W / 2.5);                   // 最后几毫米整体收薄成尖
  for (const p of pts) p[1] *= k;
  return { ws, pts };
}

function bladeGeometry() {
  const rows = [], P = side(VJ, 0), glints = [];
  let done = 0, mark = null, next = 16;
  for (let s = 0; ; s = Math.min(LEN, s + (s < 21 ? 0.15 : s < 26 || s > LEN - 6 ? 0.3 : 0.6))) {
    while (done < s - 1e-9) { // 中点法积分中线
      const h = Math.min(0.05, s - done), th = theta((done + h / 2) / LEN);
      P[0] += Math.cos(th) * h; P[1] += Math.sin(th) * h; done += h;
    }
    const th = theta(s / LEN), n = [-Math.sin(th), Math.cos(th)], { ws, pts } = section(s), row = [];
    // 一圈 26 个点：+x 面从刀背到刃，再沿 -x 面回到刀背。贴图 u 沿刀身、v 横跨刀身，研磨纹因此垂直于刃线。
    for (let i = 0; i < 26; i++) {
      const [a, h] = pts[i < 13 ? i : 25 - i], sg = i < 13 ? 1 : -1, w = a - ws;
      row.push([sg * h * MM, (P[1] + n[1] * w) * MM, -(P[0] + n[0] * w) * MM, s / 120, (w + (i < 13 ? 0 : 47)) / 120]);
    }
    rows.push(row);
    if (!mark && s >= 14.5) mark = { p: [...P], n };
    // 粒子的出生点：沿刃口每 11 毫米一个，隔一个再在刀背上补一个，最后是刀尖
    if (s >= next || s >= LEN) {
      glints.push([0, row[12][1], row[12][2]]);
      if (glints.length % 3 === 2) glints.push([0, row[0][1], row[0][2]]);
      next += 11;
    }
    if (s >= LEN) break;
  }
  return { geo: strips(rows, [0, 1, 2, 6, 7, 11, 12, 13, 14, 18, 19, 23, 24, 25, 26]), tip: [...P], mark, glints };
}

// 钢衬外轮廓：前缘向上 → 指环外圆 → 后缘向下，收尾边是与刀身对接的那条线
function tangOutline() {
  const front = (v) => side(v, wFront(v)), back = (v) => side(v, jimp(VJ - v) - wBack(v));
  const hit = (f) => { // 握柄边线进入指环外圆的位置
    let a = 30, b = RING_V;
    for (let i = 0; i < 40; i++) { const v = (a + b) / 2, p = f(v); if (Math.hypot(p[0] - RING[0], p[1] - RING[1]) > RO) a = v; else b = v; }
    return a;
  };
  const vf = hit(front), vb = hit(back), pf = front(vf), pb = back(vb), pts = [];
  for (let v = VJ; v < vf; v += 0.5) pts.push(front(v));
  const iF = pts.push(pf) - 1, a0 = Math.atan2(pf[1] - RING[1], pf[0] - RING[0]);
  const a1 = Math.atan2(pb[1] - RING[1], pb[0] - RING[0]) + Math.PI * 2, na = Math.ceil((a1 - a0) / 0.026);
  for (let i = 1; i < na; i++) { const a = lerp(a0, a1, i / na); pts.push([RING[0] + RO * Math.cos(a), RING[1] + RO * Math.sin(a)]); }
  const iB = pts.push(pb) - 1;
  for (let v = vb - 0.5; v > VJ + 0.05; v -= v > -29 ? 0.5 : 0.15) pts.push(back(v));
  pts.push(back(VJ));
  fillet(pts, iB, 6);
  fillet(pts, iF, 6);
  return pts;
}

// 柄片轮廓：比钢衬内缩 0.5（侧面看得到一圈钢边），两端收成圆角
function scaleOutline() {
  const V0 = -38.5, V1 = 35.5, R0 = 4, R1 = 4.5;
  const half = (wf, sg) => {
    const out = [], add = (v, cut) => out.push(side(v, sg * (wf(v) - 0.5 - cut)));
    for (let i = 0; i <= 12; i++) { const a = Math.PI / 2 * (1 - i / 12); add(V0 + R0 * (1 - Math.sin(a)), R0 * (1 - Math.cos(a))); }
    for (let v = V0 + R0 + 0.5; v < V1 - R1; v += 0.5) add(v, 0);
    for (let i = 0; i <= 12; i++) { const a = Math.PI / 2 * i / 12; add(V1 - R1 * (1 - Math.sin(a)), R1 * (1 - Math.cos(a))); }
    return out;
  };
  return [...half(wFront, 1), ...half(wBack, -1).reverse()];
}

const chamfer = (c) => [[[c, -H], [0, c - H]], [[0, c - H], [0, H - c]], [[0, H - c], [c, H]]];
const SCALE_RIM = [[[0, 0], [0, 3.6], [0.1, 4.4], [0.4, 5.1], [0.9, 5.6], [1.5, 5.9], [2.2, 6]].map(([d, x]) => [d, H + x])];
const SCALE_HOLE = [[[0, H], [0, H + 5.7]], [[0, H + 5.7], [0.3, H + 6]]];
const mirror = (prof) => prof.map((seg) => seg.map(([d, x]) => [d, -x]).reverse()).reverse();

// 梅花槽螺丝头，轴线沿 x，沉在柄片的沉孔里
function screw(c, sg) {
  const rows = [], top = sg * (H + 5.5);
  for (let j = 0; j < 48; j++) {
    const a = -sg * j / 48 * Math.PI * 2, star = 1.5 + 0.36 * Math.cos(6 * a);
    rows.push([[0, 1.3], [star, 1.3], [star, 0], [2.7, 0], [3.1, 0.4], [3.1, 5]].map(([r, d]) => {
      const u = c[0] + r * Math.cos(a), v = c[1] + r * Math.sin(a);
      return [(top - sg * d) * MM, v * MM, -u * MM, u / 250, v / 250];
    }));
  }
  return strips(rows, [0, 1, 2, 3, 4, 5], true);
}

// 刀根的激光蚀刻标记，两面各一块；贴图左半给 +x 面，右半给 -x 面
const markTexture = () => canvasTexture(1024, 288, (c) => {
  const text = (str, px, weight, gap, x, y) => {
    c.font = `${weight} ${px}px Bahnschrift, "DIN Alternate", "Arial Narrow", Arial, sans-serif`;
    c.letterSpacing = `${gap}px`;
    c.fillText(str, x + gap / 2, y);
  };
  c.fillStyle = 'rgba(14,15,17,0.88)';
  c.textAlign = 'center';
  text('DZ', 176, 700, 6, 256, 168);
  c.fillRect(150, 190, 212, 6);
  text('0481', 50, 600, 16, 256, 252);
  text('DOCK ZERO', 62, 700, 10, 768, 138);
  c.fillRect(600, 164, 336, 5);
  text('KRB-01', 40, 600, 12, 768, 222);
});

function markGeometry({ p, n }) {
  const pos = [], nor = [], uv = [], c = [p[0] - n[0] * 7.8, p[1] - n[1] * 7.8];
  // 字的上方朝刀背；阅读方向在两面相反，这样从哪一面看都是正的
  for (const sg of [1, -1]) for (const [i, j] of QUAD) {
    const x = (i * 2 - 1) * 6.75 * -sg, y = (j * 2 - 1) * 3.8;
    const u = c[0] + n[1] * x - n[0] * y, v = c[1] - n[0] * x - n[1] * y;
    pos.push(sg * (H + 0.02) * MM, v * MM, -u * MM);
    nor.push(sg, 0, 0);
    uv.push((sg > 0 ? 0 : 0.5) + i * 0.5, j);
  }
  return geo(pos, uv, nor);
}

// 单位米。刀身平面是 YZ 平面，握柄大致沿 Y：指环在 +Y 端，刀身从 -Y 端伸出并向 -Z 弯成钩，内弧是主刃。
// root 原点在握柄中心；spin 原点在指环中心，所有网格都挂在它下面，绕它的 X 轴转就是绕食指转刀。
// 两套涂装共用一条顶点缓冲：钢色（steel）按材质分四段画，绿宝石（emerald）一种材质一次画完；
// 刀根的蚀刻标记两套都有。两套网格开局都建好，setSkin 只切显隐。
export function buildKarambit(gear) {
  const root = new THREE.Group(), spin = new THREE.Group();
  spin.position.set(0, (RING[1] - GRIP[1]) * MM, (GRIP[0] - RING[0]) * MM);
  root.add(spin);
  const m = new THREE.Matrix4().makeTranslation(0, -RING[1] * MM, RING[0] * MM);
  const b = new Batch(), blade = bladeGeometry();
  b.add(gear.blade, blade.geo, m);
  b.add(gear.steel, plate([
    { pts: tangOutline(), prof: chamfer(CH), open: true },
    { pts: circle(RING, RI, 144), prof: chamfer(0.8) },
  ], true, true, 120), m);
  const outline = scaleOutline(), holes = SCREWS.map((v) => circle(side(v, -1), 3.3, 40));
  for (const sg of [1, -1]) {
    const fit = (prof) => (sg > 0 ? prof : mirror(prof));
    b.add(gear.g10, plate([
      { pts: outline, prof: fit(SCALE_RIM) },
      ...holes.map((pts) => ({ pts, prof: fit(SCALE_HOLE) })),
    ], sg < 0, sg > 0, 80), m);
    for (const v of SCREWS) b.add(gear.metal, screw(side(v, -1), sg), m);
  }
  b.add(gear.decal(markTexture()), markGeometry(blade.mark), m);
  // Batch 按材质各并出一块（顺序：刀身、钢衬、柄片、螺丝、标记），再接成一条缓冲，每个网格只画其中一段
  const parts = b.build(new THREE.Group()), all = mergeGeometries(parts.map((p) => p.geometry), false);
  all.computeBoundingSphere();
  for (const p of parts) p.geometry.dispose();
  const range = (start, count) => {
    const g = new THREE.BufferGeometry();
    for (const name of ['position', 'normal', 'uv']) g.setAttribute(name, all.attributes[name]);
    g.setDrawRange(start, count);
    g.boundingSphere = all.boundingSphere;
    return g;
  };
  const gem = makeEmerald(gear), skins = { steel: [], emerald: [] };
  let start = 0;
  parts.forEach((p, i) => {
    const count = p.geometry.attributes.position.count, mesh = new THREE.Mesh(range(start, count), p.material);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    spin.add(mesh);
    if (i < parts.length - 1) skins.steel.push(mesh);
    else {
      const body = new THREE.Mesh(range(0, start), gem.material);
      body.castShadow = body.receiveShadow = true;
      spin.add(body);
      skins.emerald.push(body);
    }
    start += count;
  });
  let skin = 'steel';
  const setSkin = (name) => {
    skin = skins[name] ? name : 'steel';
    for (const key in skins) for (const mesh of skins[key]) mesh.visible = key === skin;
  };
  setSkin(skin);
  const shift = (p) => [p[0], p[1] - RING[1] * MM, p[2] + RING[0] * MM];
  const anchor = (p) => {
    const o = new THREE.Object3D();
    o.position.set(0, (p[1] - RING[1]) * MM, (RING[0] - p[0]) * MM);
    spin.add(o);
    return o;
  };
  return {
    root, spin,
    anchors: { ring: anchor(RING), grip: anchor(GRIP), tip: anchor(blade.tip) },
    ringRadius: RI * MM,
    // 涂装：'steel' 或 'emerald'。gem = { material, uniforms }；emitters = 刀身上的粒子出生点（spin 坐标）；
    // materials = 两套涂装用到的全部材质（开局预热用）
    setSkin, get skin() { return skin; }, gem, emitters: blade.glints.map(shift),
    materials: [gem.material, ...parts.map((p) => p.material)],
  };
}
