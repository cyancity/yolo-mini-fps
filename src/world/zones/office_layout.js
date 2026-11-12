import { xf, box, rbox } from '../../gfx/geo.js';
import { decalQuad } from '../labels.js';
import { Y, ZONE, RESERVED } from '../plan.js';

// 办公楼各模块共用的尺寸和小工具。坐标、门洞、窗位都只在这里定一次，墙、家具、灯才对得上。
export const IN = ZONE.office; // 室内净范围 x -29.6..8，z -47.6..-32.9
export const L0 = Y.dock, L2 = Y.office2, L4 = Y.officeRoof; // 一层 1.1，二层 4.6，屋面 8.1
export const L1 = (L0 + L2) / 2, L3 = (L2 + L4) / 2; // 两个休息平台
export const TOP = 7.85; // 墙顶 = 屋面板底
export const SLAB_T = 0.25, G_SOFFIT = L2 - SLAB_T; // 二层楼板底 4.35
export const CEIL = [3.75, 7.25]; // 吊顶底面
export const PT = 0.15; // 隔墙厚
export const SW = RESERVED.stairwell;
// 楼梯间：西道（贴外墙）、中道、东侧过道（通各层门和屋面那扇门）
export const ST = {
  wx0: SW.x0, wx1: -28.0, mx0: -27.9, mx1: -26.3, ex0: -26.15, ex1: SW.x1,
  zs: -43.3, zn: -46.1, // 梯段南端、北端；北端到外墙是休息平台
};
// 楼梯间门洞（每层一样）：南墙上的门对着过道，东墙上的门在过道北头
export const STAIR_DOOR_S = { a: -26.0, b: -24.6 };
export const STAIR_DOOR_E = { a: -46.7, b: -45.3 };
export const DOOR_H = 2.1;

// 外墙窗洞：[a, b, 开着]（开着 = 不装玻璃，子弹能过）
export const WIN_Y = [[2.0, 3.4], [5.5, 6.9]];
export const WIN_N = [
  [[-11.8, -10.0], [-9.4, -7.6, true], [-7.0, -5.2], [-4.6, -2.8], [-2.2, -0.4], [2.6, 4.4], [5.4, 7.2]],
  [[-23.2, -21.4], [-20.8, -19.0], [-18.4, -16.6], [-16.0, -14.2, true], [-13.6, -11.8], [-11.2, -9.4], [-8.8, -7.0],
    [-6.4, -4.6, true], [-4.0, -2.2], [-1.6, 0.2], [1.5, 3.1], [6.5, 7.7]],
];
export const WIN_E = [
  [[-46.9, -45.1], [-44.5, -42.3], [-37.7, -35.5], [-34.9, -33.4]],
  [[-47.3, -45.6], [-45.3, -43.6], [-43.3, -41.75], [-41.3, -39.6], [-39.3, -37.6, true], [-37.3, -35.6], [-35.3, -33.4, true]],
];
export const WIN_W = [[[-39.6, -37.8], [-36.0, -34.2]], [[-39.6, -37.8], [-36.0, -34.2]]];
// 楼梯间北墙上的两扇窗（各对着一个休息平台）
export const WIN_STAIR = [[-28.9, -27.0, 3.55, 5.0], [-28.9, -27.0, 7.0, 7.65]];
// 室内聚光灯的平面位置：灯装在吊顶灯板 / 筒灯的位置上，两边用同一份坐标
export const SPOTS = { lobby: [4.8, -40.2], gWork: [-6.4, -42.6], uOpen: [-14.0, -41.6], uSup: [-3.4, -35.2] };
// 两根通高的结构柱（两层同位）
export const COLUMNS = [[-18.3, -40.2], [-6.4, -40.2]];
// 正门雨棚：只挑出 1.8 m 盖住平台，院子里离门十几米就能看全上面的招牌；lampX 是筒灯和聚光灯的 x
export const CANOPY = { x1: 10.2, y: 3.62, lampX: 9.45 };

export const UI_FONT = '"Microsoft YaHei UI", "Microsoft YaHei", "PingFang SC", sans-serif';

// 往 batch 里放一个盒子；r > 0 用倒角盒（seg 1 就够吃高光）
export function makeKit(ctx) {
  const { batch, decals, atlas, phys } = ctx;
  const kit = {
    rb: (w, h, d, r = 0.01) => rbox(w, h, d, r, 1),
    box(mat, w, h, d, x, y, z, { ry = 0, rx = 0, rz = 0, tile, r = 0, seg = 1 } = {}) {
      const g = r > 0 ? rbox(w, h, d, r, seg) : box(w, h, d);
      batch.add(mat, g, xf(x, y, z, rx, ry, rz), tile ? { tile } : {});
    },
    // 轴对齐实心块：几何体加碰撞体
    solid(mat, x0, x1, y0, y1, z0, z1, surface = 'concrete', tile = 3, r = 0) {
      kit.box(mat, x1 - x0, y1 - y0, z1 - z0, (x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2, { tile, r });
      return phys.addBox((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2, (x1 - x0) / 2, (y1 - y0) / 2, (z1 - z0) / 2, 0, surface);
    },
    col(x, y, z, hx, hy, hz, surface = 'concrete', yaw = 0) { return phys.addBox(x, y, z, hx, hy, hz, yaw, surface); },
    // 贴花：中心在 (x, y, z)，朝向由 ry 定（0 朝 +Z，π/2 朝 +X，-π/2 朝 -X，π 朝 -Z）
    decal(rect, w, h, x, y, z, ry = 0) {
      decals.add(atlas.material, decalQuad(w, h, rect), xf(x, y, z, 0, ry, 0).multiply(xf(-w / 2, -h / 2, 0)));
    },
    label(key, w, h, draw) { return atlas.cached(`office|${key}`, w, h, draw); },
  };
  return kit;
}

// 朝向：贴在墙面上、面朝某个方向时的 ry
export const FACE = { px: Math.PI / 2, nx: -Math.PI / 2, pz: 0, nz: Math.PI };

// 踢脚线：墙根 9 cm 高的深色塑胶条，通到地面的门洞处连门框一起让开。
// o 就是传给 wallX / wallZ 的参数；sides 里 -1 贴坐标小的一面，1 贴坐标大的一面；y 是楼面
export function skirting(kit, mat, along, o, { sides = [-1, 1], y = o.y0 } = {}) {
  const H = 0.09, D = 0.014, t = o.t ?? 0.4;
  const at = along === 'x' ? o.z : o.x, u0 = along === 'x' ? o.x0 : o.z0, u1 = along === 'x' ? o.x1 : o.z1;
  const cuts = (o.holes || []).filter((h) => (h.y0 ?? y) <= y + 0.01).map((h) => [h.a - 0.07, h.b + 0.07]).sort((p, q) => p[0] - q[0]);
  let c = u0;
  const run = (a, b) => {
    if (b - a < 0.05) return;
    for (const s of sides) {
      const off = at + s * (t / 2 + D / 2);
      if (along === 'x') kit.box(mat, b - a, H, D, (a + b) / 2, y + H / 2, off, { tile: 3 });
      else kit.box(mat, D, H, b - a, off, y + H / 2, (a + b) / 2, { tile: 3 });
    }
  };
  for (const [a, b] of cuts) { if (a > c) run(c, a); c = Math.max(c, b); }
  if (c < u1) run(c, u1);
}
