// 全图总平面。各分区模块都从这里取坐标，门洞和楼层标高才对得上。
// 坐标：x 向东，z 向南（北 = -z），y 向上，单位米。
//
//   z=-48 ┌──────────────────────────┬────────────────┬────────┐
//         │ 办公楼（两层，屋面 8.1）  │ 卸货场（露天）  │        │
//   -32.9 ├──────────────────────────┴────────────────┤  街道  │
//         │ 仓库库区（月台标高 1.1）  ┆ 车辆区（地面）  │        │
//   z=-20 ├──[门01]──[门02]──[门03]───┴──[逃生门]──────┤        │
//         │        堆场（已有，东西两侧是集装箱墙）  [东门]      │
//   z=+20 └───────────────────────────────────────────┴────────┘
//        x=-30                                      x=30      x=42

// 玩家和敌人能到的最大范围（四周隐形墙的内侧）
export const MAP = { x0: -30.4, x1: 42.4, z0: -48.4, z1: 21.3 };
// 楼面标高（能站人的顶面）
export const Y = { ground: 0, dock: 1.1, office2: 4.6, officeRoof: 8.1, whRoof: 9.0 };
// 外墙和隔墙厚度。所有门洞、走廊、楼梯净宽不小于 1.3（敌人寻路按 0.32 的半径走）
export const WALL = 0.4;

// 各区室内净空或场地范围（墙在范围之外）
export const ZONE = {
  yard: { x0: -24, x1: 24, z0: -17, z1: 18 },
  // 仓库：x < bayX 是月台标高的库区，x > bayX 是地面标高的车辆区；净高到 ceil，屋面板顶 9.0
  warehouse: { x0: -29.6, x1: 29.6, z0: -32.5, z1: -20.4, bayX: 13, ceil: 8.8 },
  // 办公楼：一层楼面 1.1，二层楼面 4.6，屋面 8.1；每层净高约 3.2
  office: { x0: -29.6, x1: 8, z0: -47.6, z1: -32.9 },
  court: { x0: 8.4, x1: 30, z0: -47.6, z1: -32.9 },
  // 街道西边线：z > -20 是堆场东墙外的围墙（内侧 x 29.3），往北依次是仓库东墙（30）和卸货场围墙（30.4）
  street: { x0: 29.3, x1: 42, z0: -47.6, z1: 20.6 },
};

// 各道墙的中心线和归属。墙厚都是 WALL，一道墙只由一个模块建。
// 仓库的墙砌到 8.8，办公楼的墙砌到 7.85，上面压着屋面板（屋面板和屋面以上的东西归楼顶模块）
export const WALLS = {
  whSouth: { z: -20.2, owner: 'warehouse' }, // 仓库正立面，x -30..30
  whNorth: { z: -32.7, owner: 'warehouse' }, // 仓库背墙，同时是办公楼和卸货场的南墙，x -30..30
  whWest: { x: -29.8, owner: 'warehouse' }, // z -32.9..-20
  whEast: { x: 29.8, owner: 'warehouse' },
  officeWest: { x: -29.8, owner: 'office' }, // z -48..-32.9
  officeNorth: { z: -47.8, owner: 'office' }, // x -30..8.4
  officeEast: { x: 8.2, owner: 'office' }, // 办公楼东墙，朝卸货场，z -48..-32.9
  stairEast: { x: -24.2, owner: 'office' }, // 楼梯间的两道隔墙（屋面以上的那一段归楼顶模块）
  stairSouth: { z: -41.2, owner: 'office' },
  courtNorth: { z: -47.8, owner: 'street' }, // x 8.4..42.4，连同街道北端
  courtEast: { x: 30.2, owner: 'street' }, // z -48..-32.9
  yardEast: { x: 29.1, owner: 'street' }, // 堆场东侧箱墙外的围墙，z -20..20.9
  streetEast: { x: 42.2, owner: 'street' }, // 街对面的一排门面
  streetSouth: { z: 20.8, owner: 'street' }, // x 29.3..42.4
};

// 屋面板：顶面标高 y，厚 t，盖住整栋楼的外轮廓。归楼顶模块建；办公楼屋面板在楼梯间的位置留洞
export const ROOF = {
  warehouse: { x0: -30, x1: 30, z0: -32.9, z1: -20, y: 9.0, t: 0.2 },
  office: { x0: -30, x1: 8.4, z0: -48, z1: -32.9, y: 8.1, t: 0.25 },
};

// 门洞。x 或 z 是洞口中心，w 是净宽，y0..y1 是净高范围。
export const PORTAL = {
  // 堆场 ↔ 仓库：都在 whSouth 上
  dockDoor2: { x: -2, w: 4, y0: 1.1, y1: 4.3 },
  dockDoor3: { x: 6, w: 4, y0: 1.1, y1: 3.3 },
  exitDoor: { x: 21, w: 1.3, y0: 0, y1: 2.1 },
  // 仓库 ↔ 办公楼一层：在 whNorth 上
  officeA: { x: -12, w: 1.8, y0: 1.1, y1: 3.3 },
  officeB: { x: 3, w: 1.3, y0: 1.1, y1: 3.2 },
  // 办公楼二层朝库区的观察窗：在 whNorth 上，不装玻璃，子弹能过
  overlook: { x: -4, w: 6, y0: 5.5, y1: 7.0 },
  // 仓库车辆区 ↔ 卸货场：whNorth 上的大门
  bayDoor: { x: 22, w: 5, y0: 0, y1: 4 },
  // 办公楼正门 ↔ 卸货场：在 officeEast 上，门外有台阶下到地面
  officeFront: { z: -40, w: 2, y0: 1.1, y1: 3.3 },
  // 卸货场 ↔ 街道：在 courtEast 上
  courtGate: { z: -40, w: 6, y0: 0, y1: 4.5 },
  // 堆场 ↔ 街道：东侧箱墙抽掉一列（x 26.4..28.8，z 0..6），yardEast 上对应开口
  yardGate: { z: 3, w: 6, y0: 0, y1: 4.5 },
};

// 跨模块占位：别的模块要让开
export const RESERVED = {
  // 办公楼楼梯间：从一层（1.1）经二层（4.6）通到屋面（8.1），楼梯、各层平台和屋面那层的平台都归办公楼模块。
  // 屋面板在这个范围整块留洞；洞上面的出屋面小屋（四面墙砌到 10.6 加顶）归楼顶模块，
  // 门开在东墙上（中心 z -44.5，宽 1.3），所以屋面那层的平台要铺到 (-25, -44.5) 这一带
  stairwell: { x0: -29.6, x1: -24.4, z0: -47.6, z1: -41.4 },
  // 室外消防梯：从卸货场地面沿仓库背墙上到仓库屋面（楼顶模块建）
  fireEscape: { x0: 9, x1: 13.4, z0: -36.6, z1: -32.9 },
  // 办公楼正门外的台阶和雨棚（办公楼模块建）
  frontSteps: { x0: 8.4, x1: 11, z0: -41.6, z1: -38.4 },
  // 办公楼屋面上到仓库屋面的几级台阶（楼顶模块建，落在办公楼屋面一侧）
  roofSteps: { x0: -21, x1: -18, z0: -34.6, z1: -32.9 },
};

// 每个分区最多几盏聚光灯（全部不投影；数量定下后不能增减）。仓库的 7 盏里有 3 盏是月台雨棚灯
export const LIGHT_BUDGET = { warehouse: 7, office: 6, rooftop: 2, street: 4 };

// 室内补光的房间盒（src/world/indoor.js）：净空往外放到墙中线，墙的内表面算屋里、外表面算屋外，
// 共用一道墙的两个房间在中线上接上，不留缝。
// 按顺序取第一个装得下的，所以楼梯间排在办公楼前面。sky：离门窗洞远的地方还剩多少天光；
// amb：房间自己的灯给的环境照度（线性 rgb，跟着屋里的灯开关，再乘时段的 lamps.indoor）；panels：用第几张灯板密度表
const PAD = WALL / 2;
const room = (name, r, y0, y1, o) => ({ name, x0: r.x0 - PAD, x1: r.x1 + PAD, z0: r.z0 - PAD, z1: r.z1 + PAD, y0, y1, panels: -1, ...o });
const SPLIT = (Y.office2 + Y.office2 - 0.25) / 2; // 二层楼板中间
export const ROOMS = [
  room('stair', RESERVED.stairwell, Y.dock - 0.6, 10.7, { sky: 0.12, amb: [0.5, 0.46, 0.4] }),
  room('office1', ZONE.office, Y.dock - 0.6, SPLIT, { sky: 0.15, amb: [0.62, 0.6, 0.56], panels: 0 }),
  room('office2', ZONE.office, SPLIT, Y.officeRoof - 0.12, { sky: 0.15, amb: [0.62, 0.6, 0.56], panels: 1 }),
  room('dock', { ...ZONE.warehouse, x1: ZONE.warehouse.bayX }, -0.5, ROOF.warehouse.y - 0.1, { sky: 0.1, amb: [0.6, 0.52, 0.41] }),
  room('bay', { ...ZONE.warehouse, x0: ZONE.warehouse.bayX }, -0.5, ROOF.warehouse.y - 0.1, { sky: 0.1, amb: [0.6, 0.52, 0.41] }),
];

// 天光照进屋的门洞（室内补光用）：axis 是墙沿哪个方向走，at 是墙中心线，a..b 沿墙，y0..y1 净高。
// 01 号卷帘门关着不算，03 号的 y1 就是帘子下沿；办公楼的窗由 indoor.js 从 office_layout 的窗表合成
const span = (p, axis, at) => ({ axis, at, a: (p.x ?? p.z) - p.w / 2, b: (p.x ?? p.z) + p.w / 2, y0: p.y0, y1: p.y1 });
export const SKY_DOORS = [
  span(PORTAL.dockDoor2, 'x', WALLS.whSouth.z),
  span(PORTAL.dockDoor3, 'x', WALLS.whSouth.z),
  span(PORTAL.exitDoor, 'x', WALLS.whSouth.z),
  span(PORTAL.bayDoor, 'x', WALLS.whNorth.z),
  span(PORTAL.officeFront, 'z', WALLS.officeEast.x),
  // 出屋面楼梯间东墙上的门（见 RESERVED.stairwell）
  span({ z: -44.5, w: 1.3, y0: Y.officeRoof, y1: Y.officeRoof + 2.1 }, 'z', WALLS.stairEast.x),
];

// 两个房间之间的门洞（室内补光用）：门口一米上下把两边的房间照度混一半，跨门槛不出硬边。
// rooms 是 ROOMS 里的名字；楼梯间各层的门由 indoor.js 从 office_layout 合成
export const ROOM_DOORS = [
  { ...span(PORTAL.officeA, 'x', WALLS.whNorth.z), rooms: ['dock', 'office1'] },
  { ...span(PORTAL.officeB, 'x', WALLS.whNorth.z), rooms: ['dock', 'office1'] },
  { ...span(PORTAL.overlook, 'x', WALLS.whNorth.z), rooms: ['dock', 'office2'] },
];

// 这个位置在哪个分区里（只看平面）；给音频的室内混响、调试和敌人出生点用
export function zoneAt(x, z) {
  const inside = (r) => x >= r.x0 && x <= r.x1 && z >= r.z0 && z <= r.z1;
  if (inside(ZONE.warehouse)) return 'warehouse';
  if (inside(ZONE.office)) return 'office';
  if (inside(ZONE.court)) return 'court';
  if (x > ZONE.street.x0) return 'street';
  return 'yard';
}
