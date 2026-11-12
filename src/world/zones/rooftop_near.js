import { xf, box, cyl, cylBetween } from '../../gfx/geo.js';
import { mulberry32 } from '../labels.js';

// 近景：图外 50~110 m 的邻居——北边的冷库、粮仓筒仓、油罐区，西边的物流大棚，东边的仓库和箱区，
// 再加几条路的高杆路灯。b 是远景专用的 Batch（不投影、不进碰撞），r 是远景自己的随机数。
const G = { tile: 1.2 }, P = { tile: 5.2 }, C = { tile: 3 };

// 一栋平顶大棚：墙、檐口、屋面、屋面上的几台机组和采光罩；doors 是 [面, 个数]，面 'n' 's' 'e' 'w'
function shed(b, M, mats, r, o) {
  const { x0, x1, z0, z1, h, wall = M.grey, doors = null } = o;
  const w = x1 - x0, d = z1 - z0, cx = (x0 + x1) / 2, cz = (z0 + z1) / 2;
  b.add(wall, box(w, h, d), xf(cx, h / 2, cz), P);
  b.add(M.dark, box(w + 0.4, 0.8, d + 0.4), xf(cx, h + 0.2, cz), P);
  if (o.band) b.add(o.band, box(w + 0.06, 1.2, d + 0.06), xf(cx, h - 1.4, cz), P);
  // 墙面的钢柱和勒脚，把大面墙切成一跨一跨
  for (const [len, fixed, alongX] of [[w, z0, true], [w, z1, true], [d, x0, false], [d, x1, false]]) {
    const n = Math.max(2, Math.round(len / 7.5));
    for (let i = 0; i <= n; i++) {
      const u = (alongX ? x0 : z0) + (len * i) / n;
      b.add(M.dark, box(alongX ? 0.45 : 0.5, h, alongX ? 0.5 : 0.45), xf(alongX ? u : fixed, h / 2, alongX ? fixed : u), P);
    }
  }
  b.add(mats.concrete, box(w + 0.3, 1.0, d + 0.3), xf(cx, 0.5, cz), C);
  for (let i = 0; i < Math.floor((w * d) / 260); i++) {
    const ux = x0 + 4 + r() * (w - 8), uz = z0 + 4 + r() * (d - 8);
    if (r() < 0.55) b.add(M.unit, box(2.6, 1.5, 1.6), xf(ux, h + 0.6 + 0.75, uz, 0, r() < 0.5 ? 0 : Math.PI / 2, 0), P);
    else b.add(M.skylight, box(2.4, 0.4, 1.4), xf(ux, h + 0.8, uz));
  }
  if (!doors) return;
  const [face, n] = doors;
  const along = face === 'n' || face === 's' ? w : d;
  for (let i = 0; i < n; i++) {
    const u = -along / 2 + (along * (i + 0.5)) / n;
    const out = face === 's' || face === 'e' ? 1 : -1;
    const px = face === 'e' || face === 'w' ? (out > 0 ? x1 : x0) : cx + u, pz = face === 'n' || face === 's' ? (out > 0 ? z1 : z0) : cz + u;
    const ns = face === 'n' || face === 's';
    // 装卸口：卷帘门缩在门封里，门封是两侧和顶上的黑色软垫，下沿两块防撞胶块；du 沿墙，dn 朝外
    const put = (mat, du, y, dn, wAlong, hh, dep, opt) => b.add(mat, box(ns ? wAlong : dep, hh, ns ? dep : wAlong), xf(px + (ns ? du : out * dn), y, pz + (ns ? out * dn : du)), opt);
    put(M.dark, 0, 2.75, 0.05, 3.0, 3.1, 0.1, P);
    for (let k = 1; k < 7; k++) put(mats.black, 0, 1.2 + k * 0.44, 0.105, 3.0, 0.03, 0.01);
    for (const s of [-1, 1]) {
      put(mats.black, s * 1.7, 3.0, 0.25, 0.4, 3.6, 0.5);
      put(mats.black, s * 1.15, 1.0, 0.09, 0.3, 0.35, 0.18);
    }
    put(mats.black, 0, 4.55, 0.25, 3.8, 0.5, 0.5);
    if (r() < 0.8) b.add(M.sodium, box(ns ? 0.4 : 0.08, 0.1, ns ? 0.08 : 0.4), xf(px + (ns ? 0 : out * 0.2), 5.6, pz + (ns ? out * 0.2 : 0)));
  }
}

// 半挂车：车厢 + 牵引车头（有的没挂车头）。局部坐标车头朝 +z。
// 屋面北望只有二十几米，底下要看得出轮子、支腿，车尾要有门缝、锁杆和尾灯；轮子是 10 边的筒，不用街上那种细车轮
function trailer(b, M, mats, r, x, z, yaw) {
  const m = xf(x, 0, z, 0, yaw, 0), mat = [M.grey, M.blue, M.red, M.unit][Math.floor(r() * 4)];
  const at = (mt, g, lx, ly, lz, opt) => b.add(mt, g, m.clone().multiply(xf(lx, ly, lz)), opt);
  const tyre = (lx, lz) => {
    b.add(mats.black, cyl(0.5, 0.5, 0.24, 10), m.clone().multiply(xf(lx, 0.5, lz, 0, 0, Math.PI / 2)));
    if (Math.abs(lx) > 0.9) b.add(mats.galv, cyl(0.24, 0.24, 0.03, 8), m.clone().multiply(xf(lx + Math.sign(lx) * 0.12, 0.5, lz, 0, 0, Math.PI / 2)), G);
  };
  at(mat, box(2.5, 2.9, 13.4), 0, 1.25 + 1.45, 0, P);
  // 车厢四条长边的包边和车头两根角柱，屋面上看过去的是车头这一端
  for (const s of [-1, 1]) {
    for (const y of [1.32, 4.1]) at(M.dark, box(0.06, 0.12, 13.4), s * 1.26, y, 0, P);
    at(M.dark, box(0.1, 2.9, 0.1), s * 1.22, 2.7, 6.67, P);
  }
  // 底盘：两根纵梁、后横梁和防钻撞梁，双轴双胎，前部两条支腿
  for (const s of [-1, 1]) at(mats.black, box(0.22, 0.3, 12.6), s * 0.5, 1.1, 0.2);
  at(mats.black, box(2.5, 0.22, 0.14), 0, 1.14, -6.62);
  at(mats.black, box(2.3, 0.14, 0.12), 0, 0.6, -6.5);
  for (const s of [-1, 1]) {
    at(mats.black, box(0.1, 0.5, 0.1), s * 0.8, 0.85, -6.5);
    for (const wz of [-4.2, -5.5]) for (const dx of [0.76, 1.0]) tyre(s * dx, wz);
    at(M.dark, box(0.12, 1.13, 0.12), s * 0.9, 0.685, 4.6, P);
    at(M.dark, box(0.3, 0.05, 0.3), s * 0.9, 0.1, 4.6, P);
    // 尾灯
    at(M.red, box(0.32, 0.1, 0.04), s * 0.95, 1.14, -6.7, P);
  }
  at(M.dark, box(1.9, 0.1, 0.1), 0, 0.85, 4.6, P);
  // 车尾：对开门的中缝、门框、四根锁杆
  at(mats.black, box(0.03, 2.75, 0.02), 0, 2.7, -6.71);
  at(M.dark, box(2.5, 0.1, 0.05), 0, 4.1, -6.72, P);
  for (const lx of [-1.0, -0.35, 0.35, 1.0]) at(mats.galv, cyl(0.025, 0.025, 2.7, 4, true), lx, 2.7, -6.74, G);
  if (r() < 0.5) {
    at(M.dark, box(2.5, 2.4, 2.4), 0, 2.4, 8.3, P);
    at(mats.black, box(2.2, 0.85, 0.04), 0, 2.9, 9.51);
    at(mats.black, box(2.5, 0.4, 0.3), 0, 0.75, 9.45);
    for (const s of [-1, 1]) {
      at(mats.black, box(0.22, 0.3, 4.2), s * 0.5, 0.95, 7.6);
      tyre(s * 1.0, 8.6);
      for (const dx of [0.76, 1.0]) tyre(s * dx, 6.3);
    }
  }
}

// 轮胎吊在已有门框外加的东西：每侧两条腿之间的 X 撑和腿脚的轮组，大梁上的小车，
// 小车底下钢丝绳吊着的吊具（长边顺着箱子沿 z）。x、z 是中心，hx、hz 是腿的半间距，top 是大梁底，cx 是小车位置
function rtgDress(b, M, mats, { x, z, hx, hz, top, cx }) {
  for (const sx of [-1, 1]) {
    const lx = x + sx * hx;
    b.add(M.yellow, cylBetween(lx, 1.6, z - hz, lx, top - 1.5, z + hz, 0.16, 4), null, P);
    b.add(M.yellow, cylBetween(lx, 1.6, z + hz, lx, top - 1.5, z - hz, 0.16, 4), null, P);
    for (const sz of [-1, 1]) {
      for (const dz of [-0.45, 0.45]) b.add(mats.black, cyl(0.45, 0.45, 0.5, 10), xf(lx, 0.45, z + sz * hz + dz, 0, 0, Math.PI / 2));
    }
  }
  b.add(M.dark, box(4.2, 1.3, hz * 2 + 1.4), xf(cx, top + 2.4, z), P);
  for (const dx of [-0.8, 0.8]) for (const dz of [-1.3, 1.3]) b.add(mats.galv, cylBetween(cx + dx, top + 1.7, z + dz * 2, cx + dx, top - 6.8, z + dz, 0.04, 3), null, G);
  b.add(M.dark, box(2.3, 0.8, 2.4), xf(cx, top - 7.0, z), P);
  for (const dx of [-1.0, 1.0]) b.add(M.yellow, box(0.3, 0.5, 12.0), xf(cx + dx, top - 7.4, z), P);
}

// 高杆路灯：一排，dir 是灯头朝向（只做发光体，不是真灯）
function lampRow(b, M, mats, ax, az, bx, bz, step, dir, h = 10) {
  const len = Math.hypot(bx - ax, bz - az), n = Math.max(1, Math.round(len / step));
  for (let i = 0; i <= n; i++) {
    const x = ax + ((bx - ax) * i) / n, z = az + ((bz - az) * i) / n;
    b.add(mats.galv, cyl(0.09, 0.14, h, 6), xf(x, h / 2, z), G);
    b.add(mats.galv, cylBetween(x, h - 0.2, z, x + dir[0] * 1.6, h + 0.1, z + dir[1] * 1.6, 0.05, 4), null, G);
    b.add(M.sodium, box(0.6, 0.12, 0.3), xf(x + dir[0] * 1.7, h, z + dir[1] * 1.7, 0, Math.atan2(dir[0], dir[1]), 0));
  }
}

// 粮仓工作塔：混凝土塔身分层压线，顶上一层带窗的机房，东面贴一根楼梯井（每层平台一盏灯），
// 一条斜皮带廊从塔腰落到地面。从屋顶看是西北方向最高的剪影，光秃秃一块方柱会很假
function workTower(b, M, mats) {
  const x = -51, z = -96, body = 30, top = 37;
  b.add(mats.concrete, box(10, body, 10), xf(x, body / 2, z), { tile: 6 });
  for (let y = 5; y < body; y += 5) b.add(mats.concrete, box(10.4, 0.3, 10.4), xf(x, y, z), C);
  // 机房：窗户贴图（两层窗），压顶和四角航标灯
  b.add(M.cityNear, box(12, top - body, 11), xf(x, (body + top) / 2, z), { tile: 51.2, ou: 0.25, ov: 0.5 });
  b.add(M.dark, box(12.4, 0.6, 11.4), xf(x, top + 0.3, z), P);
  b.add(M.dark, box(12.2, 0.4, 11.2), xf(x, body + 0.2, z), P);
  for (const [dx, dz] of [[-5.8, -5.3], [5.8, -5.3], [-5.8, 5.3], [5.8, 5.3]]) b.add(M.redLight, box(0.6, 0.6, 0.6), xf(x + dx, top + 0.9, z + dz));
  // 东面的楼梯井：深色钢板外皮，平台高度上一盏壁灯
  b.add(M.dark, box(3.2, top - 1, 3.4), xf(x + 6.6, (top - 1) / 2, z + 2.2), P);
  for (let y = 3.3; y < top - 2; y += 3.3) b.add(M.lampWarm, box(0.1, 0.4, 0.5), xf(x + 8.25, y, z + 2.2));
  // 西面接筒仓顶的皮带廊
  b.add(M.dark, box(46, 3, 3.2), xf(-79, 27.5, -96.3), P);
  b.add(M.beacon, box(0.7, 0.7, 0.7), xf(-79, 29.4, -96.3));
  // 斜皮带廊：塔腰往东落到地面的受料坑，两根钢支腿
  const ax = x + 5, ay = 24, bx = -33, by = 2.5, gz = z - 3, len = Math.hypot(bx - ax, by - ay), ang = Math.atan2(by - ay, bx - ax);
  b.add(M.dark, box(len, 2.4, 2.4), xf((ax + bx) / 2, (ay + by) / 2, gz, 0, 0, ang), P);
  for (const t of [0.35, 0.7]) {
    const lx = ax + (bx - ax) * t, ly = ay + (by - ay) * t - 1.3;
    b.add(mats.galv, box(0.5, ly, 0.5), xf(lx, ly / 2, gz - 0.9), G);
    b.add(mats.galv, box(0.5, ly, 0.5), xf(lx, ly / 2, gz + 0.9), G);
  }
  b.add(mats.concrete, box(5, 2.5, 5), xf(bx + 1.5, 1.25, gz), C);
}

export function buildNear(b, M, mats, r) {
  // 北边：冷库（南面一排装卸口，门前停着半挂车）
  shed(b, M, mats, r, { x0: -28, x1: 34, z0: -112, z1: -78, h: 12, band: M.blue, doors: ['s', 7] });
  for (let i = 0; i < 7; i++) if (r() < 0.65) trailer(b, M, mats, r, 3 - 31 + (62 * (i + 0.5)) / 7, -71.3, 0);
  // 冷库围墙和大门柱
  b.add(mats.concrete, box(70, 2.4, 0.25), xf(3, 1.2, -61), C);
  // 西北：粮食筒仓两排 + 工作塔 + 顶上的皮带廊
  for (let row = 0; row < 2; row++) {
    for (let i = 0; i < 5; i++) b.add(mats.concrete, cyl(4.2, 4.2, 26, 24), xf(-100 + i * 8.6, 13, -92 - row * 8.6), { tile: 6 });
  }
  workTower(b, M, mats);
  // 东北：油罐区，围堰里两排罐，顶上有检修灯
  for (let row = 0; row < 2; row++) {
    for (let i = 0; i < 3; i++) {
      const x = 62 + i * 20, z = -74 - row * 20, h = 11 + r() * 4;
      b.add(M.unit, cyl(8, 8, h, 28), xf(x, h / 2, z), P);
      b.add(M.unit, cyl(8.1, 8.1, 0.5, 28), xf(x, h + 0.2, z), P);
      b.add(mats.galv, cylBetween(x + 7.9, 0, z, x + 3, h, z - 6, 0.5, 4), null, G);
      b.add(M.lampCool, box(0.3, 0.2, 0.3), xf(x + 2, h + 0.7, z - 5.5));
    }
  }
  b.add(mats.concrete, box(66, 1.4, 0.4), xf(82, 0.7, -62), C);
  b.add(mats.concrete, box(0.4, 1.4, 44), xf(49, 0.7, -84), C);
  b.add(M.dark, box(70, 1.2, 2.4), xf(82, 6, -64.5), P);
  for (let x = 50; x <= 114; x += 8) b.add(M.dark, box(0.4, 6, 0.4), xf(x, 3, -64.5), P);

  // 西边：物流大棚，东面的装卸口对着我们，门前一排挂车
  shed(b, M, mats, r, { x0: -104, x1: -52, z0: -58, z1: -14, h: 13, band: M.blue, doors: ['e', 6] });
  for (let i = 0; i < 4; i++) if (r() < 0.85) trailer(b, M, mats, r, -45, -36 - 22 + (44 * (i + 0.5)) / 6, Math.PI / 2);
  // 西南：门式起重机跨着一排箱子
  const rtg = [-66, 22];
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) b.add(M.yellow, box(1.2, 19, 1.2), xf(rtg[0] + sx * 12, 9.5, rtg[1] + sz * 4), P);
    b.add(M.yellow, box(1.6, 2.2, 10), xf(rtg[0] + sx * 12, 19.5, rtg[1]), P);
    b.add(M.yellow, box(25.6, 1.8, 1.4), xf(rtg[0], 20.4, rtg[1] + sx * 4.5), P);
  }
  b.add(M.dark, box(4, 2.4, 4), xf(rtg[0] + 3, 18.4, rtg[1]), P);
  b.add(M.lampCool, box(1.2, 0.2, 0.4), xf(rtg[0] - 6, 18.9, rtg[1]));
  rtgDress(b, M, mats, { x: rtg[0], z: rtg[1], hx: 12, hz: 4, top: 18.4, cx: rtg[0] + 3 });
  for (let i = 0; i < 6; i++) {
    for (let k = 0; k < 1 + Math.floor(r() * 4); k++) {
      b.add([M.red, M.blue, M.grey, M.dark][Math.floor(r() * 4)], box(2.44, 2.59, 12.2), xf(rtg[0] - 9 + i * 3.2, 1.3 + k * 2.59, rtg[1]), P);
    }
  }

  // 东边：街对面门面后面的仓库和箱区（街道那排门面到 x 52 左右，从 58 往外起）
  shed(b, M, mats, r, { x0: 60, x1: 104, z0: -46, z1: -8, h: 11, doors: ['s', 5] });
  for (let i = 0; i < 3; i++) trailer(b, M, mats, r, 60 + (44 * (i + 0.5)) / 5, -1.3, 0);
  for (let row = 0; row < 3; row++) {
    for (let i = 0; i < 6; i++) {
      for (let k = 0; k < 1 + Math.floor(r() * 4); k++) {
        b.add([M.red, M.blue, M.grey, M.dark][Math.floor(r() * 4)], box(12.2, 2.59, 2.44), xf(70 + row * 14, 1.3 + k * 2.59, 22 + i * 3.0), P);
      }
    }
  }

  // 路灯：北边东西向的路、东边南北向的路、西边的巷子
  lampRow(b, M, mats, -100, -57.5, 110, -57.5, 26, [0, 1]);
  lampRow(b, M, mats, 56, -50, 56, 70, 24, [-1, 0]);
  lampRow(b, M, mats, -35.5, -60, -35.5, -30, 15, [1, 0], 6.5);
  portYard(b, M, mats);
}

// 西南的集装箱堆场：从屋顶往西南看原来是一大片空地。几个箱区（箱子长边沿 z，横着排六列）、
// 一台跨在箱区上的轮胎吊、三根高杆灯。用自己的随机数，不打乱前面已经摆好的远景
function portYard(b, M, mats) {
  const r = mulberry32(0x5eed), paint = [M.red, M.blue, M.grey, M.dark, M.red, M.blue];
  const block = (cx, cz, bays) => {
    for (let row = 0; row < 6; row++) {
      for (let bay = 0; bay < bays; bay++) {
        const x = cx + (row - 2.5) * 2.54, z = cz + (bay - (bays - 1) / 2) * 12.7, tiers = Math.floor(r() * 4.6);
        for (let k = 0; k < tiers; k++) b.add(paint[Math.floor(r() * paint.length)], box(2.44, 2.59, 12.2), xf(x, 1.3 + k * 2.59, z, 0, (r() - 0.5) * 0.01, 0), { tile: 5.2, ou: r(), ov: r() });
      }
    }
  };
  block(-92, 40, 3);
  block(-72, 48, 2);
  block(-52, 50, 3);
  block(-92, -2, 1);
  // 轮胎吊跨在最西那个箱区上
  const gx = -92, gz = 30;
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) b.add(M.yellow, box(1.1, 20, 1.1), xf(gx + sx * 10, 10, gz + sz * 3.5), P);
    b.add(M.yellow, box(1.4, 1.2, 8.6), xf(gx + sx * 10, 0.6, gz), P);
    b.add(M.yellow, box(21.6, 1.6, 1.2), xf(gx, 20.6, gz + sx * 3.8), P);
  }
  b.add(M.dark, box(3.4, 2.2, 3.6), xf(gx - 4, 18.6, gz), P);
  b.add(M.lampCool, box(1.0, 0.2, 0.4), xf(gx + 5, 19.4, gz));
  rtgDress(b, M, mats, { x: gx, z: gz, hx: 10, hz: 3.5, top: 19.6, cx: gx - 4 });
  // 高杆灯：灯盘上四个钠灯头
  for (const [x, z] of [[-82, 46], [-62, 34], [-46, 12]]) {
    b.add(mats.galv, cyl(0.22, 0.45, 28, 8), xf(x, 14, z), G);
    b.add(M.dark, cyl(1.3, 1.3, 0.3, 10), xf(x, 28, z), P);
    for (let i = 0; i < 4; i++) {
      const a = (i * Math.PI) / 2 + 0.4;
      b.add(M.sodium, box(0.7, 0.18, 0.45), xf(x + Math.cos(a) * 1.0, 27.75, z + Math.sin(a) * 1.0, 0, -a, 0));
    }
  }
}
