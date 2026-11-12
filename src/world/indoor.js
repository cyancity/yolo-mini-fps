import { ROOMS, SKY_DOORS, ROOM_DOORS, WALLS, ZONE, Y, RESERVED } from './plan.js';
import { WIN_N, WIN_E, WIN_W, WIN_Y, WIN_STAIR, STAIR_DOOR_S, STAIR_DOOR_E, DOOR_H, L0, L2 } from './zones/office_layout.js';
import { PANELS } from './zones/office_ceiling.js';
import { indoorUniforms as U, MAX_ROOMS, MAX_PORTALS, MAX_LINKS, PANEL } from '../gfx/indoor_light.js';

// 室内补光的数据：把 plan.js 的房间盒、门洞和办公楼的窗填进 indoor_light.js 的 uniform，
// 每帧按各房间里灯的亮度更新房间照度（灯全关了，房间照度也跟着没了）。由 Lighting 建、每帧调 update
const WALL_HALF = 0.2;
const SW = RESERVED.stairwell;

// 同一面墙上挨得近的窗合成一条：洞口少，着色器里的循环就短。窗间墙那 0.6 米本来也照得到
function strips(list, gap = 1.35) {
  const out = [];
  for (const [a, b] of [...list].sort((p, q) => p[0] - q[0])) {
    const last = out[out.length - 1];
    if (last && a - last[1] <= gap) last[1] = Math.max(last[1], b);
    else out.push([a, b]);
  }
  return out;
}

// 通向室外的洞口（外门和窗）：{ c: 中心, h: 半尺寸, reach }。倒影的可见性判断（ground.js）也用它
export function skyOpenings() {
  const out = [...SKY_DOORS];
  WIN_Y.forEach(([y0, y1], f) => {
    for (const [a, b] of strips(WIN_N[f])) out.push({ axis: 'x', at: WALLS.officeNorth.z, a, b, y0, y1 });
    for (const [a, b] of strips(WIN_E[f])) out.push({ axis: 'z', at: WALLS.officeEast.x, a, b, y0, y1 });
    for (const [a, b] of strips(WIN_W[f])) out.push({ axis: 'z', at: WALLS.officeWest.x, a, b, y0, y1 });
  });
  for (const [a, b, y0, y1] of WIN_STAIR) out.push({ axis: 'x', at: WALLS.officeNorth.z, a, b, y0, y1 });
  // 洞口越大，天光照进来越远：2 到 4 米
  return out.map((o) => ({ ...hole(o), reach: Math.min(4, Math.max(2, 0.8 * Math.sqrt((o.b - o.a) * (o.y1 - o.y0)))) }));
}

// 墙上的洞口 → 盒子（中心、半尺寸），盒子厚度是整个墙厚
function hole(o) {
  const u = (o.a + o.b) / 2, w = o.b - o.a, h = o.y1 - o.y0;
  return {
    c: o.axis === 'x' ? [u, (o.y0 + o.y1) / 2, o.at] : [o.at, (o.y0 + o.y1) / 2, u],
    h: o.axis === 'x' ? [w / 2, h / 2, WALL_HALF] : [WALL_HALF, h / 2, w / 2],
  };
}

// 房间之间的门：plan.js 的 ROOM_DOORS，加上楼梯间每层朝办公楼的两道门
function roomLinks() {
  const list = [...ROOM_DOORS];
  for (const [y0, room] of [[L0, 'office1'], [L2, 'office2']]) {
    list.push({ axis: 'x', at: WALLS.stairSouth.z, ...STAIR_DOOR_S, y0, y1: y0 + DOOR_H, rooms: ['stair', room] });
    list.push({ axis: 'z', at: WALLS.stairEast.x, ...STAIR_DOOR_E, y0, y1: y0 + DOOR_H, rooms: ['stair', room] });
  }
  const idx = (name) => ROOMS.findIndex((r) => r.name === name);
  return list.map((o) => ({ ...hole(o), rooms: o.rooms.map(idx) })).filter((o) => o.rooms.every((i) => i >= 0 && i < MAX_ROOMS));
}

export const inBox = (r, [x, y, z], m = 0) => x >= r.x0 - m && x <= r.x1 + m && y >= r.y0 - m && y <= r.y1 + m && z >= r.z0 - m && z <= r.z1 + m;
const roomOf = (p, m) => ROOMS.findIndex((r) => inBox(r, p, m));

// 灯板密度表：每块亮着的灯板在附近撒一团高斯（σ 0.85 米：格宽 1.2，再窄的话 2 米多宽的走廊贴墙那一格就照不到），按格心取值，再归一到全楼层平均为 1。
// 灯板正下方到 2 上下，灯板之间和没灯的房间往 0.45 落
function panelTables() {
  const { nx, nz, cell } = PANEL, out = new Float32Array(PANEL.tables * nx * nz).fill(1);
  const s2 = 2 * 0.85 * 0.85;
  for (let t = 0; t < PANEL.tables; t++) {
    const list = PANELS.filter((p) => (t === 0 ? p.y < Y.office2 : p.y >= Y.office2));
    if (!list.length) continue;
    const raw = new Float32Array(nx * nz);
    let sum = 0, n = 0;
    for (let j = 0; j < nz; j++) for (let i = 0; i < nx; i++) {
      const x = ZONE.office.x0 + (i + 0.5) * cell, z = ZONE.office.z0 + (j + 0.5) * cell;
      let v = 0;
      for (const p of list) {
        const d2 = (p.x - x) ** 2 + (p.z - z) ** 2;
        if (d2 < 12) v += p.w * Math.exp(-d2 / s2);
      }
      raw[j * nx + i] = v;
      const stair = x < SW.x1 && z < SW.z1;
      if (x <= ZONE.office.x1 && z <= ZONE.office.z1 && !stair) { sum += v; n++; }
    }
    const mean = sum / Math.max(1, n) || 1;
    for (let k = 0; k < nx * nz; k++) out[t * nx * nz + k] = Math.min(2.2, 0.45 + 0.55 * (raw[k] / mean));
  }
  return out;
}

export class IndoorLight {
  // lamps：Lighting.lamps（{ light, ... }），按灯的位置分到房间
  constructor(lamps) {
    this.scale = 1; // 时段的 lamps.indoor
    const lo = U.uRoomLo.value, hi = U.uRoomHi.value, sky = U.uRoomSky.value, amb = U.uRoomAmb.value;
    const holes = skyOpenings().map((p) => ({ ...p, room: roomOf(p.c, WALL_HALF + 0.15) })).filter((p) => p.room >= 0);
    holes.sort((a, b) => a.room - b.room);
    if (ROOMS.length > MAX_ROOMS || holes.length > MAX_PORTALS) console.warn('[indoor] 房间或洞口超过着色器上限', ROOMS.length, holes.length);
    const pc = U.uPortalC.value, ph = U.uPortalH.value;
    holes.slice(0, MAX_PORTALS).forEach((p, j) => {
      pc.set([...p.c, p.reach], j * 4);
      ph.set([...p.h, 1], j * 4);
    });
    const links = roomLinks(), lc = U.uLinkC.value, lh = U.uLinkH.value;
    if (links.length > MAX_LINKS) console.warn('[indoor] 房间之间的门超过着色器上限', links.length);
    lh.fill(-1);
    // 混合距离 1 米：门口一小片，不至于把隔壁的冷暖拖进整个房间
    links.slice(0, MAX_LINKS).forEach((p, j) => {
      lc.set([...p.c, 1.0], j * 4);
      lh.set([...p.h, p.rooms[0] * 16 + p.rooms[1]], j * 4);
    });
    const all = U.uIndoorAll.value.set(1e5, 1e5, -1e5, -1e5);
    this.rooms = ROOMS.slice(0, MAX_ROOMS).map((r, i) => {
      lo.set([r.x0, r.y0, r.z0, 0], i * 4);
      hi.set([r.x1, r.y1, r.z1, 0], i * 4);
      const first = holes.findIndex((p) => p.room === i), count = holes.filter((p) => p.room === i).length;
      sky.set([first < 0 ? 0 : first, first < 0 ? 0 : Math.min(MAX_PORTALS, first + count), r.sky, 0], i * 4);
      amb[i * 4 + 3] = r.panels;
      all.set(Math.min(all.x, r.x0), Math.min(all.y, r.z0), Math.max(all.z, r.x1), Math.max(all.w, r.z1));
      const own = lamps.filter((e) => roomOf(e.light.position.toArray(), 0.3) === i).map((e) => ({ light: e.light, i0: e.light.intensity || 1 }));
      return { amb: r.amb, own, level: 1 };
    });
    U.uPanelGrid.value.set(ZONE.office.x0, ZONE.office.z0, 1 / PANEL.cell, 0);
    U.uPanel.value.set(panelTables());
    this.update();
  }

  // 房间照度跟着房里最亮的那盏灯走：一盏在闪不影响，全关了才暗；房里没登记灯的按常亮算
  update() {
    const amb = U.uRoomAmb.value;
    for (let i = 0; i < this.rooms.length; i++) {
      const r = this.rooms[i];
      let k = r.own.length ? 0 : 1;
      for (const o of r.own) k = Math.max(k, o.light.intensity / o.i0);
      r.level = k;
      const s = k * this.scale;
      amb[i * 4] = r.amb[0] * s;
      amb[i * 4 + 1] = r.amb[1] * s;
      amb[i * 4 + 2] = r.amb[2] * s;
    }
  }
}
