import * as THREE from 'three';
import { xf, extrude, cylBetween, cyl, lathe, scaleUV } from '../../gfx/geo.js';
import { wallX, wallZ, slab, stairs, railing } from '../build.js';
import { WALLS } from '../plan.js';
import { STENCIL_FONT } from '../labels.js';
import { L0, L1, L2, L3, L4, TOP, SW, ST, STAIR_DOOR_S, STAIR_DOOR_E, DOOR_H, UI_FONT, FACE, skirting } from './office_layout.js';

// 楼梯间（西北角）：双跑楼梯从一层 1.1 经二层 4.6 上到屋面 8.1。
// 西道和中道是梯段，北头是休息平台；东侧一条过道串起各层的两扇门，屋面那层的过道通到出屋面小屋的门。
// 一层的两跑是实心的；上面两跑是带斜底板的薄梯段，下面的人才不会碰头。
const RISE_MAX = 0.19;
const WALL_TOP = L4 + 1.0; // 中隔墙和过道隔墙高出屋面平台一米，当栏板

// 薄梯段：锯齿形踏步 + 斜底板，一个拉伸体；碰撞是每级一块薄板
function thinFlight(ctx, mat, { x, z, dir, w, y0, y1, run }) {
  const n = Math.max(1, Math.ceil((y1 - y0) / RISE_MAX)), rise = (y1 - y0) / n, tread = run / n, waist = 0.22;
  const m = xf(x, 0, z, 0, Math.atan2(dir[0], dir[1]), 0);
  const prof = [[0, -waist]];
  for (let i = 0; i < n; i++) prof.push([i * tread, (i + 1) * rise], [(i + 1) * tread, (i + 1) * rise]);
  prof.push([run, y1 - y0 - waist]);
  ctx.batch.add(mat, extrude(prof, w, 0), m.clone().multiply(xf(0, y0, 0, 0, -Math.PI / 2, 0)), { tile: 3 });
  for (let i = 0; i < n; i++) ctx.phys.solid(m, 0, y0 + (i + 1) * rise - 0.12, (i + 0.5) * tread, w / 2, 0.12, tread / 2, 'concrete');
}

// 每级踏步前沿的铝防滑条
function nosings(kit, mat, { x, z, dir, w, y0, y1, run }) {
  const n = Math.max(1, Math.ceil((y1 - y0) / RISE_MAX)), rise = (y1 - y0) / n, tread = run / n;
  for (let i = 0; i < n - 1; i++) {
    const d = i * tread + 0.03, y = y0 + (i + 1) * rise + 0.005;
    kit.box(mat, w - 0.1, 0.012, 0.05, x + dir[0] * d, y, z + dir[1] * d, { ry: Math.atan2(dir[0], dir[1]), tile: 1.2 });
  }
}

// 贴墙扶手：一根圆管加几只托架；a、b 是两端 [x, y, z]，wx 是墙面所在一侧的偏移方向
function wallRail(ctx, mat, a, b, off) {
  const [ox, oz] = off;
  ctx.batch.add(mat, cylBetween(a[0], a[1], a[2], b[0], b[1], b[2], 0.022, 8), null, { tile: 1.2 });
  for (const t of [0.12, 0.5, 0.88]) {
    const px = a[0] + (b[0] - a[0]) * t, py = a[1] + (b[1] - a[1]) * t, pz = a[2] + (b[2] - a[2]) * t;
    ctx.batch.add(mat, cylBetween(px, py - 0.03, pz, px + ox * 0.07, py - 0.06, pz + oz * 0.07, 0.008, 6), null, { tile: 1.2 });
  }
}

export function buildStairs(ctx, M, kit) {
  const { mats } = ctx;
  const frame = mats.steelIn;
  // 楼梯间两道隔墙（0.4 厚，砌到屋面板底）。一次调用里同一段只能挖一个洞，所以按层分两段砌
  for (const [y0, y1] of [[L0, L2], [L2, TOP]]) {
    const hole = (d) => [{ a: d.a, b: d.b, y0, y1: y0 + DOOR_H, frame }];
    const e = { x: WALLS.stairEast.x, z0: SW.z0, z1: SW.z1 + 0.4, y0, y1, holes: hole(STAIR_DOOR_E) };
    const s = { z: WALLS.stairSouth.z, x0: SW.x0, x1: SW.x1, y0, y1, holes: hole(STAIR_DOOR_S) };
    wallZ(ctx, M.wall, e);
    wallX(ctx, M.wall, s);
    skirting(kit, M.accent, 'z', e);
    skirting(kit, M.accent, 'x', s);
  }
  // 中道和东过道之间的隔墙、两道梯段之间的中隔墙，都高出屋面平台一米
  const mid = { x: (ST.mx1 + ST.ex0) / 2, z0: SW.z0, z1: ST.zs, y0: L0, y1: WALL_TOP, t: ST.ex0 - ST.mx1 };
  wallZ(ctx, M.wall, mid);
  for (const y of [L0, L2, L4]) skirting(kit, M.accent, 'z', mid, { sides: [1], y });
  wallZ(ctx, M.wall, { x: (ST.wx1 + ST.mx0) / 2, z0: ST.zn, z1: ST.zs, y0: L0, y1: WALL_TOP, t: ST.mx0 - ST.wx1 });
  // 两道矮墙顶上的钢压顶
  for (const [x, t, z0] of [[(ST.mx1 + ST.ex0) / 2, ST.ex0 - ST.mx1, SW.z0], [(ST.wx1 + ST.mx0) / 2, ST.mx0 - ST.wx1, ST.zn]]) {
    kit.box(mats.steelIn, t + 0.05, 0.04, ST.zs - z0, x, WALL_TOP + 0.02, (z0 + ST.zs) / 2, { tile: 1.2 });
  }

  const wc = (ST.wx0 + ST.wx1) / 2, mc = (ST.mx0 + ST.mx1) / 2, w = ST.wx1 - ST.wx0, run = ST.zs - ST.zn;
  const f1 = { x: mc, z: ST.zs, dir: [0, -1], w, y0: L0, y1: L1, run };
  const f2 = { x: wc, z: ST.zn, dir: [0, 1], w, y0: L1, y1: L2, run };
  const f3 = { x: mc, z: ST.zs, dir: [0, -1], w, y0: L2, y1: L3, run };
  const f4 = { x: wc, z: ST.zn, dir: [0, 1], w, y0: L3, y1: L4, run };
  // 一层：第一跑实心；第一个休息平台和第二跑底下用混凝土填实
  stairs(ctx, mats.concreteIn, { ...f1, surface: 'concrete', tile: 3 });
  kit.solid(M.vinyl, ST.wx0, ST.mx1, L0, L1, SW.z0, ST.zn, 'concrete', 2.4);
  kit.solid(mats.concreteIn, ST.wx0, ST.wx1, L0, L1, ST.zn, ST.zs, 'concrete', 3);
  stairs(ctx, mats.concreteIn, { ...f2, surface: 'concrete', tile: 3 });
  // 二层以上：薄梯段 + 薄平台
  thinFlight(ctx, mats.concreteIn, f3);
  slab(ctx, M.vinyl, { x0: ST.wx0, x1: ST.mx1, z0: SW.z0, z1: ST.zn, y: L3, t: 0.2, matBottom: mats.concreteIn, tile: 2.4 });
  thinFlight(ctx, mats.concreteIn, f4);
  // 屋面那层的平台：梯段南头一条 + 东过道，过道一直铺到出屋面小屋的门 (-25, -44.5)
  const roof = { y: L4, t: 0.25, matBottom: mats.concreteIn, tile: 2.4 };
  slab(ctx, M.vinyl, { ...roof, x0: SW.x0, x1: SW.x1, z0: ST.zs, z1: SW.z1 });
  slab(ctx, M.vinyl, { ...roof, x0: ST.ex0, x1: SW.x1, z0: SW.z0, z1: ST.zs });
  railing(ctx, mats.steelIn, { a: [ST.mx0, ST.zs + 0.04], b: [ST.mx1, ST.zs + 0.04], y: L4, posts: 0.8 });
  for (const f of [f1, f2, f3, f4]) nosings(kit, mats.galvIn, f);

  // 扶手：外墙一侧、中隔墙两侧、过道隔墙一侧
  const H = 0.92;
  for (const f of [f2, f4]) {
    const zA = f.z, zB = f.z + run;
    wallRail(ctx, mats.steelIn, [ST.wx0 + 0.07, f.y0 + H, zA], [ST.wx0 + 0.07, f.y1 + H, zB], [-1, 0]);
    wallRail(ctx, mats.steelIn, [ST.wx1 - 0.07, f.y0 + H, zA], [ST.wx1 - 0.07, f.y1 + H, zB], [1, 0]);
  }
  for (const f of [f1, f3]) {
    const zA = f.z, zB = f.z - run;
    wallRail(ctx, mats.steelIn, [ST.mx1 - 0.07, f.y0 + H, zA], [ST.mx1 - 0.07, f.y1 + H, zB], [1, 0]);
    wallRail(ctx, mats.steelIn, [ST.mx0 + 0.07, f.y0 + H, zA], [ST.mx0 + 0.07, f.y1 + H, zB], [-1, 0]);
  }
  for (const y of [L1, L3]) wallRail(ctx, mats.steelIn, [ST.wx0 + 0.3, y + H, SW.z0 + 0.07], [ST.mx1 - 0.3, y + H, SW.z0 + 0.07], [0, -1]);

  stairSigns(ctx, M, kit);
  standpipe(ctx, M, kit);
  underStairCage(ctx, M, kit);
  // 每层平台的壁灯（发光面），屋面平台那盏投光灯装在过道隔墙顶上
  // 各层平台在过道的东墙上，休息平台在北墙上（避开楼梯窗）
  for (const [y, dy, mid] of [[L0, 2.25, false], [L1, 2.0, true], [L2, 2.25, false], [L3, 1.15, true]]) {
    const x = mid ? -26.8 : ST.ex1 - 0.045, z = mid ? SW.z0 + 0.045 : ST.zs - 0.6, ry = mid ? FACE.pz : FACE.nx;
    kit.box(M.plastic, 0.36, 0.14, 0.09, x, y + dy, z, { ry, r: 0.02 });
    kit.box(M.warm, 0.3, 0.08, 0.02, x + Math.sin(ry) * 0.04, y + dy, z + Math.cos(ry) * 0.04, { ry });
  }
  // 屋面平台的投光灯：架在过道隔墙顶上，斜着朝下照梯井
  kit.box(M.plastic, 0.24, 0.2, 0.3, -26.33, WALL_TOP + 0.17, -44.9, { rz: 0.5, r: 0.02 });
  kit.box(M.panel, 0.01, 0.16, 0.24, -26.44, WALL_TOP + 0.11, -44.9, { rz: 0.5 });
  return { light: { pos: [-26.5, WALL_TOP + 0.08, -44.9], aim: [(ST.wx0 + ST.mx1) / 2, L0, -44.6] } };
}

// 一层西道南头（第二跑梯段底下那块 1.6 × 1.9 的空当）围成杂物笼：钢丝网挡人不挡子弹。
// 敞着的话敌人会缩进去，人在楼上时它就一直蹲在那儿不上楼
function underStairCage(ctx, M, kit) {
  const { mats, batch, phys } = ctx;
  const x = ST.wx1 - 0.03, z0 = ST.zs, z1 = SW.z1, len = z1 - z0, zc = (z0 + z1) / 2, h = 2.3, y = L0, G = { tile: 1.2 };
  for (const z of [z0 + 0.03, zc, z1 - 0.03]) kit.box(mats.steelIn, 0.04, h, 0.04, x, y + h / 2, z, G);
  for (const yy of [0.06, h - 0.02]) kit.box(mats.steelIn, 0.04, 0.04, len, x, y + yy, zc, G);
  const mesh = scaleUV(new THREE.PlaneGeometry(len - 0.06, h - 0.12), (len - 0.06) / 0.48, (h - 0.12) / 0.48);
  batch.add(mats.chainlink, mesh, xf(x, y + h / 2, zc, 0, Math.PI / 2, 0));
  phys.addBox(x, y + h / 2, zc, 0.03, h / 2, len / 2, 0, 'metal').playerOnly = true;
  // 笼门上的挂锁
  kit.box(mats.galvIn, 0.03, 0.06, 0.05, x + 0.04, y + 1.05, zc + 0.1, G);
  // 里面：两摞纸箱、拖把桶、靠墙一架人字梯
  for (const [bx, bz, n] of [[-29.2, -42.9, 3], [-28.6, -42.95, 2]]) {
    for (let i = 0; i < n; i++) kit.box(M.cardboard, 0.5, 0.36, 0.4, bx, y + 0.18 + i * 0.37, bz, { ry: (ctx.rand() - 0.5) * 0.2, tile: 0.9, r: 0.006 });
  }
  batch.add(M.yellow, cyl(0.17, 0.14, 0.32, 14), xf(-28.6, y + 0.16, -41.85), { tile: 5.2 });
  batch.add(mats.woodIn, cylBetween(-28.6, y + 0.3, -41.85, -28.85, y + 1.45, -41.7, 0.014, 6), null, { tile: 0.9 });
  for (const s of [-1, 1]) kit.box(mats.galvIn, 0.04, 1.8, 0.04, -29.5, y + 0.9, -42.1 + s * 0.2, { rz: 0.12, tile: 1.2 });
}

// 消防立管：过道东北角一根红管贯通三层，每层一只阀门；旁边一根灰色电线管和接线盒
function standpipe(ctx, M, kit) {
  const { mats, batch, phys } = ctx;
  const red = M.red;
  const x = ST.ex1 - 0.13, z = SW.z0 + 0.13, r = 0.055;
  batch.add(red, cyl(r, r, L4 + 0.9 - L0, 14), xf(x, (L0 + L4 + 0.9) / 2, z), { tile: 5.2 });
  phys.addCyl(x, z, r, L0, L4 + 0.9, 'metal');
  const ring = lathe([[0.075, -0.012], [0.095, -0.012], [0.095, 0.012], [0.075, 0.012], [0.075, -0.012]], 16);
  for (const y of [L0 + 1.1, L2 + 1.1, L4 + 0.7]) {
    // 管箍、朝西伸出的阀体、朝上的阀杆和手轮
    batch.add(red, cyl(r + 0.015, r + 0.015, 0.06, 14), xf(x, y + 0.25, z), { tile: 5.2 });
    batch.add(red, cylBetween(x, y, z, x - 0.2, y, z, 0.04, 12), null, { tile: 5.2 });
    batch.add(mats.steelIn, cyl(0.05, 0.05, 0.03, 12), xf(x - 0.2, y, z, 0, 0, Math.PI / 2), { tile: 1.2 });
    batch.add(red, ring, xf(x - 0.12, y + 0.13, z), { tile: 5.2 });
    batch.add(red, cylBetween(x - 0.12, y, z, x - 0.12, y + 0.13, z, 0.012, 6), null, { tile: 5.2 });
  }
  // 电线管：沿北墙爬上去，每层一只接线盒
  const cx = ST.ex0 + 0.35, cz = SW.z0 + 0.03;
  batch.add(mats.galvIn, cyl(0.016, 0.016, L4 + 0.9 - L0, 8), xf(cx, (L0 + L4 + 0.9) / 2, cz), { tile: 1.2 });
  for (const y of [L0 + 1.35, L2 + 1.35, L4 + 0.5]) {
    kit.box(mats.galvIn, 0.12, 0.12, 0.06, cx, y, cz + 0.01, { tile: 1.2, r: 0.006 });
    for (const dy of [-1.2, -0.6, 0.6, 1.2]) kit.box(mats.galvIn, 0.05, 0.02, 0.04, cx, y + dy, cz, { tile: 1.2 });
  }
}

// 楼层号、安全出口灯、门牌
function stairSigns(ctx, M, kit) {
  const { mats } = ctx;
  const floorNo = (txt) => kit.label(`floor${txt}`, 256, 256, (c, w, h) => {
    c.fillStyle = '#2b5c8a'; c.fillRect(0, 0, w, h);
    c.fillStyle = '#f2f1ec'; c.textAlign = 'center'; c.textBaseline = 'middle';
    c.font = `700 150px ${STENCIL_FONT}`; c.fillText(txt, w / 2, h / 2 - 14);
    c.font = `600 34px ${UI_FONT}`; c.fillText(txt === 'RF' ? '屋面' : `${txt[0]} 层`, w / 2, h - 34);
  });
  kit.decal(floorNo('1F'), 0.6, 0.6, (ST.ex0 + ST.ex1) / 2, L0 + 1.7, SW.z0 + 0.002, FACE.pz);
  kit.decal(floorNo('2F'), 0.6, 0.6, (ST.ex0 + ST.ex1) / 2, L2 + 1.7, SW.z0 + 0.002, FACE.pz);
  kit.decal(floorNo('RF'), 0.5, 0.5, ST.ex0 + 0.002, L4 + 0.6, -46.6, FACE.px);
  // 梯段南头那面墙上刷一个大号的楼层号，走到这一层的人正对着它：
  // 二层刷在西道（从一层上来），一层刷在中道（从二层下来，西道那头是杂物笼）
  for (const [txt, y, x] of [['1F', L0, (ST.mx0 + ST.mx1) / 2], ['2F', L2, (ST.wx0 + ST.wx1) / 2]]) {
    kit.decal(floorNo(txt), 0.9, 0.9, x, y + 1.6, WALLS.stairSouth.z - 0.2 - 0.003, FACE.nz);
  }
  // 安全出口：楼梯间门外上方（朝办公区）
  const exit = kit.label('exit', 256, 96, (c, w, h) => {
    c.fillStyle = '#f4fff6';
    c.font = `700 46px ${UI_FONT}`; c.textBaseline = 'middle'; c.fillText('安全出口', 92, h / 2 + 2);
    // 奔跑小人（通用标志的简化画法）
    c.beginPath(); c.arc(46, 22, 9, 0, 6.3); c.fill();
    c.lineWidth = 9; c.strokeStyle = '#f4fff6'; c.lineCap = 'round';
    c.beginPath(); c.moveTo(42, 36); c.lineTo(36, 58); c.lineTo(22, 74); c.moveTo(36, 58); c.lineTo(54, 66); c.lineTo(56, 84);
    c.moveTo(40, 40); c.lineTo(58, 50); c.moveTo(40, 40); c.lineTo(24, 46); c.stroke();
  });
  const exitBox = (x, y, z, ry) => {
    kit.box(M.plastic, 0.4, 0.17, 0.05, x, y, z, { ry, r: 0.01 });
    const nx = Math.sin(ry) * 0.027, nz = Math.cos(ry) * 0.027;
    kit.box(M.exit, 0.36, 0.13, 0.004, x + nx, y, z + nz, { ry });
    kit.decal(exit, 0.34, 0.127, x + nx * 1.15, y, z + nz * 1.15, ry);
  };
  const sx = (STAIR_DOOR_S.a + STAIR_DOOR_S.b) / 2, ez = (STAIR_DOOR_E.a + STAIR_DOOR_E.b) / 2;
  for (const y of [L0, L2]) {
    exitBox(sx, y + DOOR_H + 0.3, WALLS.stairSouth.z + 0.23, FACE.pz);
    exitBox(WALLS.stairEast.x + 0.23, y + DOOR_H + 0.3, ez, FACE.px);
  }
}
