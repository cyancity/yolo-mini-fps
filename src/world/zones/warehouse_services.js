import { xf, box, cyl, cylBetween } from '../../gfx/geo.js';
import { distress, STENCIL_FONT } from '../labels.js';
import { HALL, BAY, ZN, ZS, ZC, CEIL, TRUSS_X, TRUSS, G, P, rng, sticker, visual } from './warehouse_kit.js';

// 机电：天车梁下的高天棚灯、沿墙电缆桥架、送风管、喷淋主管、墙上的分区大字和安全标牌。全是够不着的高处，不登记碰撞。
// 灯具：lit 2 = 真灯（分区预算 4 盏），1 = 只亮灯罩（泛光撑气氛），0 = 坏了没亮
// 灯罩半径 0.32，挂在两榀屋架之间，离屋架（TRUSS_X）至少 0.4，免得插进屋架竖杆。
// 车辆区那盏真灯放在车道正中（20.4）：挪到货车正上方旁边时，白色厢板被照得一片死白
export const LAMPS = [
  { x: -26.3, lit: 0 }, { x: -21.5, lit: 2, flicker: true }, { x: -16.1, lit: 1 },
  { x: -10.0, lit: 0 }, { x: -4.5, lit: 2 }, { x: 1.5, lit: 1 },
  { x: 7.5, lit: 2 }, { x: 15.6, lit: 1 }, { x: 20.4, lit: 2 }, { x: 26.2, lit: 0 },
];
export const LAMP_Y = 8.05;

function lamps(ctx, k) {
  const { batch, mats } = visual(ctx);
  for (const l of LAMPS) {
    const x = l.x, z = ZC;
    batch.add(mats.galvIn, box(0.04, 0.04, 1.5), xf(x, CEIL - 0.15, z), G);
    batch.add(mats.galvIn, cylBetween(x, CEIL - 0.17, z, x, 8.43, z, 0.008, 4), null, G);
    batch.add(mats.steelIn, cyl(0.15, 0.17, 0.14, 14), xf(x, 8.36, z), G);
    for (let i = 0; i < 6; i++) batch.add(mats.steelIn, box(0.02, 0.1, 0.36), xf(x, 8.36, z, 0, (i * Math.PI) / 6, 0), G);
    batch.add(k.liner, cyl(0.2, 0.32, 0.18, 18, true), xf(x, 8.2, z), P);
    const lens = l.lit ? (l.flicker ? k.lampFlicker : k.lamp) : mats.glassDark;
    batch.add(lens, cyl(0.3, 0.3, 0.02, 18), xf(x, 8.115, z));
  }
}

// 沿墙梯级式电缆桥架：两根边梁、横档、里面几根电缆，每 3 米一个托臂
function cableTray(ctx, k, z, n, y, x0, x1) {
  const { batch, mats } = visual(ctx);
  const zc = z + n * 0.6, L = x1 - x0, cx = (x0 + x1) / 2;
  for (const s of [-1, 1]) batch.add(mats.galvIn, box(L, 0.08, 0.02), xf(cx, y + 0.04, zc + s * 0.15), G);
  for (let x = x0 + 0.3; x < x1; x += 0.6) batch.add(mats.galvIn, box(0.03, 0.015, 0.3), xf(x, y + 0.008, zc), G);
  for (const [dz, r] of [[-0.08, 0.022], [0, 0.03], [0.07, 0.018]]) batch.add(mats.black, cyl(r, r, L, 6), xf(cx, y + 0.02 + r, zc + dz, 0, 0, Math.PI / 2));
  for (let x = x0 + 1.5; x < x1; x += 3) {
    batch.add(mats.steelIn, box(0.05, 0.05, 0.8), xf(x, y - 0.03, z + n * 0.4), G);
    batch.add(mats.steelIn, cylBetween(x, y - 0.03, z + n * 0.05, x, y + 0.45, z + n * 0.02, 0.012, 4), null, G);
  }
}

// 送风管：沿南侧横向通道上空，一头封堵，一头往上穿屋面；每 6 米一个散流器
function duct(ctx, k) {
  const { batch, mats } = visual(ctx);
  const z = ZS - 1.2, y = 7.25, r = 0.3, x0 = HALL.x0 + 0.6, x1 = 12;
  for (let x = x0; x < x1 - 0.01; x += 3) {
    const e = Math.min(x1, x + 3);
    batch.add(mats.galvIn, cyl(r, r, e - x, 16, true), xf((x + e) / 2, y, z, 0, 0, Math.PI / 2), G);
    batch.add(mats.galvIn, cyl(r + 0.02, r + 0.02, 0.05, 16, true), xf(x, y, z, 0, 0, Math.PI / 2), G);
  }
  batch.add(mats.galvIn, cyl(r + 0.02, r + 0.02, 0.04, 16), xf(x0, y, z, 0, 0, Math.PI / 2), G);
  batch.add(mats.galvIn, cyl(r, r, CEIL - y, 16, true), xf(x1, (y + CEIL) / 2, z), G);
  batch.add(mats.galvIn, cyl(r + 0.03, r + 0.03, 0.06, 16), xf(x1, y, z), G);
  for (const tx of TRUSS_X) {
    if (tx < x0 || tx > x1) continue;
    for (const s of [-1, 1]) batch.add(mats.galvIn, cylBetween(tx + 0.3, y + r * 0.7, z + s * 0.32, tx + 0.3, TRUSS.y0, z + s * 0.32, 0.008, 4), null, G);
    batch.add(mats.steelIn, box(0.05, 0.04, 0.72), xf(tx + 0.3, y - r - 0.02, z), G);
  }
  for (let x = x0 + 3; x < x1 - 1; x += 6) {
    batch.add(mats.galvIn, box(0.36, 0.25, 0.36), xf(x, y - r - 0.06, z), G);
    batch.add(mats.steelIn, box(0.56, 0.05, 0.56), xf(x, y - r - 0.2, z), G);
    for (let i = -2; i <= 2; i++) batch.add(mats.black, box(0.5, 0.012, 0.03), xf(x, y - r - 0.23, z + i * 0.1));
  }
}

function sprinklers(ctx, k) {
  const { batch } = visual(ctx);
  for (const z of [ZN + 3, ZC, ZS - 3]) {
    batch.add(k.red, cyl(0.045, 0.045, BAY.x1 - HALL.x0 - 0.6, 8), xf(0, 8.48, z, 0, 0, Math.PI / 2), P);
    for (let x = HALL.x0 + 1.5; x < BAY.x1 - 1; x += 3) {
      batch.add(k.red, cyl(0.012, 0.012, 0.12, 5), xf(x, 8.38, z), P);
      batch.add(ctx.mats.galvIn, cyl(0.025, 0.012, 0.03, 6), xf(x, 8.31, z), G);
    }
  }
}

// 墙上的分区大字和几块安全标牌
function signage(ctx, rand) {
  const zh = '"Microsoft YaHei UI", "Microsoft YaHei", "PingFang SC", sans-serif';
  const zone = (ch, sub) => ctx.atlas.cached(`wh|zone${ch}`, 512, 256, (c, w, h) => {
    c.fillStyle = '#e4ded0';
    c.font = `700 230px ${STENCIL_FONT}`;
    c.textBaseline = 'alphabetic';
    c.fillText(ch, 6, 218);
    c.font = `700 70px ${zh}`;
    c.fillText(sub, 200, 120);
    c.font = `600 40px ${STENCIL_FONT}`;
    c.fillText(`ZONE ${ch}`, 204, 196);
    distress(c, w, h, rand, 0.6);
  });
  sticker(ctx, zone('A', '高位货架'), -24, 4.35, ZS - 0.02, 3.0, 1.5, Math.PI);
  sticker(ctx, zone('B', '集货理货'), 8, 6.25, ZN + 0.02, 3.0, 1.5);
  sticker(ctx, zone('C', '车辆装卸'), BAY.x1 - 0.02, 4.35, ZC + 2.5, 3.0, 1.5, -Math.PI / 2);
  const plate = (key, draw) => ctx.atlas.cached(`wh|${key}`, 256, 320, (c, w, h) => {
    c.fillStyle = '#ece9e0'; c.fillRect(0, 0, w, h);
    draw(c, w, h);
    distress(c, w, h, rand, 0.25);
  });
  const caption = (c, w, a, b) => {
    c.fillStyle = '#16181a'; c.textAlign = 'center';
    c.font = `700 40px ${zh}`; c.fillText(a, w / 2, 262);
    c.font = `600 26px ${STENCIL_FONT}`; c.fillText(b, w / 2, 300);
  };
  const forklift = plate('forklift', (c, w) => {
    c.fillStyle = '#e0b020';
    c.beginPath(); c.moveTo(w / 2, 14); c.lineTo(w - 16, 214); c.lineTo(16, 214); c.closePath(); c.fill();
    c.fillStyle = '#16181a';
    c.fillRect(82, 120, 70, 50); c.fillRect(140, 92, 14, 78); c.fillRect(154, 150, 34, 8); c.fillRect(96, 100, 30, 22);
    c.beginPath(); c.arc(98, 178, 14, 0, 6.3); c.arc(142, 178, 14, 0, 6.3); c.fill();
    caption(c, w, '叉车作业 注意避让', 'FORKLIFT AREA');
  });
  const noFire = plate('nofire', (c, w) => {
    c.strokeStyle = '#c0261b'; c.lineWidth = 22;
    c.beginPath(); c.arc(w / 2, 112, 84, 0, 6.3); c.stroke();
    c.fillStyle = '#16181a';
    c.beginPath(); c.moveTo(w / 2, 50); c.quadraticCurveTo(w / 2 + 40, 110, w / 2, 160); c.quadraticCurveTo(w / 2 - 40, 110, w / 2, 50); c.fill();
    c.beginPath(); c.moveTo(w / 2 - 60, 52); c.lineTo(w / 2 + 60, 172); c.stroke();
    caption(c, w, '严禁烟火', 'NO OPEN FLAMES');
  });
  const ppe = plate('ppe', (c, w) => {
    c.fillStyle = '#1f5fae'; c.beginPath(); c.arc(w / 2, 112, 94, 0, 6.3); c.fill();
    c.fillStyle = '#f0efe8';
    c.beginPath(); c.ellipse(w / 2, 126, 62, 40, 0, Math.PI, 0); c.fill();
    c.fillRect(w / 2 - 74, 122, 148, 14);
    caption(c, w, '必须戴安全帽', 'HARD HAT AREA');
  });
  const speed = plate('speed', (c, w) => {
    c.strokeStyle = '#c0261b'; c.lineWidth = 20;
    c.beginPath(); c.arc(w / 2, 112, 86, 0, 6.3); c.stroke();
    c.fillStyle = '#16181a'; c.textAlign = 'center';
    c.font = `700 104px ${STENCIL_FONT}`; c.fillText('5', w / 2, 150);
    caption(c, w, '库内限速', 'MAX 5 KM/H');
  });
  const S = (r, x, y, z, yaw = 0) => sticker(ctx, r, x, y, z, 0.48, 0.6, yaw);
  S(forklift, 11.0, 2.9, ZS - 0.03, Math.PI);
  S(noFire, -13.6, 2.9, ZS - 0.03, Math.PI);
  S(ppe, -14.0, 2.6, ZN + 0.03);
  S(speed, 18.4, 2.2, ZN + 0.03);
  S(forklift, -16.1, 2.6, ZN + 0.03);
  S(noFire, 12.0, 2.6, ZN + 0.03);
}

export function buildServices(ctx, k) {
  lamps(ctx, k);
  cableTray(ctx, k, ZS, -1, 6.4, HALL.x0 + 0.2, BAY.x1 - 0.2);
  cableTray(ctx, k, ZN, 1, 7.45, HALL.x0 + 0.2, BAY.x1 - 0.2);
  duct(ctx, k);
  sprinklers(ctx, k);
  signage(ctx, rng(515));
}

// 高天棚灯的聚光灯：不投影，光锥收在库内（距离刚好够到地面，落不到墙外）
export function lampLights() {
  return LAMPS.filter((l) => l.lit === 2).map((l) => {
    const bay = l.x > BAY.x0;
    return {
      pos: [l.x, LAMP_Y, ZC], aim: [l.x, 0, ZC], color: l.flicker ? 0xfff0d8 : 0xe6eeff,
      intensity: 1400, distance: bay ? 10.5 : 9.6, angle: 0.8, penumbra: 0.7, fog: 0.35,
    };
  });
}
