import * as THREE from 'three';
import { xf, box, rbox, cyl, cylBetween, scaleUV } from '../../gfx/geo.js';
import { distress, STENCIL_FONT } from '../labels.js';
import { G, P, WD, sticker, keepClear } from './warehouse_kit.js';
import { cargo } from './warehouse_cargo.js';

// 库区设备和杂物：危险品笼、缠膜机、消防点、更衣柜、打包台、配电柜、吨桶。
const ZH = '"Microsoft YaHei UI", "Microsoft YaHei", "PingFang SC", sans-serif';
const plate = (ctx, key, w, h, bg, fg, a, b) => ctx.atlas.cached(`wh|${key}`, w, h, (c) => {
  c.fillStyle = bg; c.fillRect(0, 0, w, h);
  c.fillStyle = fg; c.textAlign = 'center';
  c.font = `700 ${Math.round(h * 0.36)}px ${ZH}`; c.fillText(a, w / 2, h * 0.47, w - 16);
  c.font = `600 ${Math.round(h * 0.2)}px ${STENCIL_FONT}`; c.fillText(b, w / 2, h * 0.84, w - 16);
});

// 铁丝网围起来的危险品笼：北边靠墙，南边开门（门扇推开贴在网外）。网挡人不挡子弹
export function cage(ctx, k, o, rand) {
  const { batch, mats, phys } = ctx;
  const { x0, x1, z0, z1, y, gate } = o, h = 2.5;
  const panel = (ax, az, bx, bz, hole = null) => {
    const len = Math.hypot(bx - ax, bz - az), yaw = Math.atan2(-(bz - az), bx - ax);
    const n = Math.max(1, Math.ceil(len / 1.5));
    for (let i = 0; i <= n; i++) {
      const t = i / n, px = ax + (bx - ax) * t, pz = az + (bz - az) * t;
      batch.add(mats.steelIn, box(0.05, h, 0.05), xf(px, y + h / 2, pz), G);
    }
    const piece = (t0, t1) => {
      const l = (t1 - t0) * len, cx = ax + (bx - ax) * (t0 + t1) / 2, cz = az + (bz - az) * (t0 + t1) / 2;
      if (l < 0.05) return;
      const g = scaleUV(new THREE.PlaneGeometry(l, h - 0.15), l / 0.48, (h - 0.15) / 0.48);
      batch.add(mats.chainlink, g, xf(cx, y + h / 2 + 0.02, cz, 0, yaw, 0));
      for (const yy of [0.06, h - 0.02]) batch.add(mats.steelIn, box(l, 0.04, 0.04), xf(cx, y + yy, cz, 0, yaw, 0), G);
      phys.addBox(cx, y + h / 2, cz, l / 2, h / 2, 0.03, yaw, 'metal').playerOnly = true;
    };
    if (!hole) piece(0, 1);
    else { piece(0, (hole[0] - ax) / (bx - ax)); piece((hole[1] - ax) / (bx - ax), 1); }
  };
  panel(x0, z0, x0, z1);
  panel(x0, z1, x1, z1, gate);
  panel(x1, z1, x1, z0);
  // 门扇：推开 180° 贴在网外
  const gw = gate[1] - gate[0], gx = gate[1] + gw / 2 + 0.03, gz = z1 + 0.07;
  const g = scaleUV(new THREE.PlaneGeometry(gw - 0.08, h - 0.25), gw / 0.48, h / 0.48);
  batch.add(mats.chainlink, g, xf(gx, y + h / 2, gz));
  for (const yy of [0.1, h - 0.1]) batch.add(k.yellow, box(gw, 0.04, 0.04), xf(gx, y + yy, gz), P);
  for (const s of [-1, 1]) batch.add(k.yellow, box(0.04, h - 0.2, 0.04), xf(gx + s * (gw / 2 - 0.02), y + h / 2, gz), P);
  sticker(ctx, plate(ctx, 'hazmat', 384, 192, '#e6e2d6', '#a3170f', '危险品存放区', 'HAZMAT · AUTHORISED ONLY'), (gate[1] + gw + x1) / 2, y + 1.7, z1 + 0.04, 0.8, 0.4);

  // 笼内：靠墙一排钢货架（顶到柱子）、柱子另一边气瓶架，东南角一托危险品桶，西边易燃品柜
  shelving(ctx, k, x0 + 1.9, z0 + 0.33, 3.3, 0.6, y, rand);
  const gx0 = x0 + 4.05;
  batch.add(mats.steelIn, box(1.5, 0.05, 0.36), xf(gx0 + 0.75, y + 0.9, z0 + 0.2), G);
  batch.add(mats.steelIn, box(1.5, 0.05, 0.36), xf(gx0 + 0.75, y + 0.06, z0 + 0.2), G);
  for (let i = 0; i < 6; i++) {
    const cx = gx0 + 0.13 + i * 0.25, paint = [k.red, mats.steelIn, k.rackBlue][i % 3];
    batch.add(paint, cyl(0.11, 0.11, 1.25, 12), xf(cx, y + 0.68, z0 + 0.2), P);
    batch.add(paint, cyl(0.04, 0.11, 0.12, 12), xf(cx, y + 1.36, z0 + 0.2), P);
    batch.add(mats.galvIn, cyl(0.035, 0.035, 0.1, 8), xf(cx, y + 1.46, z0 + 0.2), G);
  }
  batch.add(mats.black, box(1.5, 0.015, 0.02), xf(gx0 + 0.75, y + 1.05, z0 + 0.4));
  phys.addBox(gx0 + 0.75, y + 0.75, z0 + 0.2, 0.75, 0.75, 0.2, 0, 'metal');
  cargo(ctx, k, xf(x1 - 0.65, y, z1 - 0.55, 0, 0, 0), rand, { type: 'drums', hmax: 1.2 });
  phys.addBox(x1 - 0.65, y + 0.5, z1 - 0.55, 0.6, 0.5, 0.5, 0, 'metal');
  const cab = xf(x0 + 0.5, y, z0 + 1.1, 0, Math.PI / 2, 0);
  batch.add(k.yellow, rbox(0.9, 1.7, 0.6, 0.02, 1), cab.clone().multiply(xf(0, 0.85, 0)), P);
  batch.add(mats.black, box(0.01, 1.6, 0.012), cab.clone().multiply(xf(0, 0.85, 0.302)));
  for (const s of [-1, 1]) batch.add(mats.steelIn, box(0.03, 0.14, 0.03), cab.clone().multiply(xf(s * 0.06, 0.95, 0.31)), G);
  sticker(ctx, plate(ctx, 'flammable', 256, 128, '#c7261b', '#f4f0e6', '易燃品', 'FLAMMABLE'), x0 + 0.81, y + 1.35, z0 + 1.1, 0.6, 0.3, Math.PI / 2);
  phys.addBox(x0 + 0.5, y + 0.85, z0 + 1.1, 0.3, 0.85, 0.45, 0, 'metal');
}

// 钢制层架：四根角钢立柱、四层板、板上随手放的纸箱
export function shelving(ctx, k, x, z, len, d, y, rand, h = 2.0) {
  const { batch, mats, phys } = ctx;
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) batch.add(mats.galvIn, box(0.04, h, 0.04), xf(x + sx * (len / 2 - 0.02), y + h / 2, z + sz * (d / 2 - 0.02)), G);
  for (let i = 0; i < 4; i++) {
    const yy = y + 0.12 + i * 0.6;
    batch.add(mats.galvIn, box(len, 0.02, d), xf(x, yy, z), G);
    for (let bx = -len / 2 + 0.05; bx < len / 2 - 0.25;) {
      const w = 0.25 + rand() * 0.35, bh = 0.18 + rand() * 0.3;
      if (bx + w > len / 2 - 0.03) break;
      if (rand() < 0.8) batch.add(k.carton, box(w - 0.02, bh, d * (0.6 + rand() * 0.3)), xf(x + bx + w / 2, yy + 0.01 + bh / 2, z, 0, (rand() - 0.5) * 0.1, 0), { tile: 1.2, ou: rand(), ov: rand() });
      bx += w + 0.04;
    }
  }
  phys.addBox(x, y + h / 2, z, len / 2, h / 2, d / 2, 0, 'metal').playerOnly = true;
}

// 立式缠膜机：转盘 + 立柱 + 膜架，转盘上一托缠了一半的货
export function wrapper(ctx, k, o, rand) {
  const { batch, mats, phys } = ctx;
  const { x, y, z, mz } = o; // mz：立柱在转盘北边多远
  batch.add(mats.steelIn, cyl(0.85, 0.85, 0.1, 28), xf(x, y + 0.05, z), G);
  batch.add(mats.galvIn, cyl(0.82, 0.82, 0.02, 28), xf(x, y + 0.11, z), G);
  batch.add(k.yellow, box(0.5, 0.1, Math.abs(mz)), xf(x, y + 0.05, z + mz / 2), P);
  batch.add(k.yellow, rbox(0.3, 2.6, 0.3, 0.02, 1), xf(x, y + 1.3, z + mz), P);
  batch.add(k.yellow, rbox(0.42, 0.28, 0.3, 0.02, 1), xf(x, y + 1.15, z + mz * 0.8), P);
  batch.add(k.film, cyl(0.09, 0.09, 0.5, 14), xf(x + 0.12, y + 1.15, z + mz * 0.68), { tile: 1.2 });
  batch.add(k.white, rbox(0.38, 0.5, 0.22, 0.02, 1), xf(x + 0.3, y + 1.4, z + mz), P);
  batch.add(mats.emissive(0x2bff6a, 6), box(0.04, 0.04, 0.01), xf(x + 0.24, y + 1.52, z + mz + Math.sign(-mz) * 0.115));
  batch.add(mats.emissive(0xff3018, 6), box(0.04, 0.04, 0.01), xf(x + 0.36, y + 1.52, z + mz + Math.sign(-mz) * 0.115));
  const top = 0.12 + cargo(ctx, k, xf(x, y + 0.12, z, 0, 0.4, 0), rand, { type: 'wrapped', hmax: 1.75 });
  phys.addBox(x, y + top / 2, z, 0.62, top / 2, 0.62, 0.4, 'wood');
  phys.addBox(x, y + 1.3, z + mz, 0.2, 1.3, 0.2, 0, 'metal');
  // 转盘和墙之间那条窄缝封掉
  phys.addBox(x, y + 1.0, z + mz / 2, 0.85, 1.0, Math.abs(mz) / 2 + 0.15, 0, 'metal').playerOnly = true;
}

// 消防点：红底板、两只灭火器、上方标牌、地上禁停框。n 是墙面朝向（+1 朝 +z）
export function firePoint(ctx, k, sw, x, y, z, n) {
  const { batch, mats } = ctx;
  batch.add(k.red, rbox(0.72, 1.0, 0.03, 0.01, 1), xf(x, y + 1.35, z + n * 0.02), P);
  for (const s of [-1, 1]) {
    const ex = x + s * 0.17, ez = z + n * 0.13;
    batch.add(k.red, cyl(0.08, 0.08, 0.5, 12), xf(ex, y + 1.1, ez), P);
    batch.add(k.white, cyl(0.081, 0.081, 0.1, 12), xf(ex, y + 1.12, ez), P);
    batch.add(mats.steelIn, cyl(0.025, 0.035, 0.08, 8), xf(ex, y + 1.39, ez), G);
    batch.add(mats.black, cylBetween(ex, y + 1.4, ez, ex + s * 0.05, y + 0.95, ez + n * 0.06, 0.012, 5), null);
  }
  sticker(ctx, plate(ctx, 'fire', 256, 128, '#b81d14', '#f4f0e6', '灭火器', 'FIRE POINT'), x, y + 2.1, z + n * 0.02, 0.6, 0.3, n > 0 ? 0 : Math.PI);
  keepClear(ctx, sw, y, x - 0.6, x + 0.6, n > 0 ? z : z - 0.6, n > 0 ? z + 0.6 : z);
}

// 一排更衣柜，靠墙（墙在 -z 一侧，柜门朝 +z）
export function lockers(ctx, k, x0, n, y, zWall) {
  const { batch, mats, phys } = ctx;
  const w = 0.4, d = 0.5, h = 1.8, z = zWall + d / 2;
  for (let i = 0; i < n; i++) {
    const x = x0 + w / 2 + i * w;
    batch.add(k.liner, box(w - 0.01, h, d), xf(x, y + h / 2, z), P);
    for (let v = 0; v < 4; v++) batch.add(mats.black, box(0.2, 0.012, 0.005), xf(x, y + h - 0.2 - v * 0.04, z + d / 2 + 0.002));
    batch.add(mats.steelIn, box(0.03, 0.12, 0.03), xf(x + w / 2 - 0.08, y + 1.0, z + d / 2 + 0.015), G);
  }
  batch.add(mats.steelIn, box(n * w, 0.08, d), xf(x0 + (n * w) / 2, y + 0.04, z), G);
  phys.addBox(x0 + (n * w) / 2, y + h / 2, z, (n * w) / 2, h / 2, d / 2, 0, 'metal');
}

// 打包台：钢腿木台面，台上打包带盘和收紧器，墙上挂工具板
export function bench(ctx, k, x0, x1, y, zWall, rand) {
  const { batch, mats, phys } = ctx;
  const d = 0.8, z = zWall + d / 2, cx = (x0 + x1) / 2, L = x1 - x0;
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) batch.add(mats.steelIn, box(0.05, 0.88, 0.05), xf(cx + sx * (L / 2 - 0.05), y + 0.44, z + sz * (d / 2 - 0.05)), G);
  batch.add(mats.woodIn, box(L, 0.05, d), xf(cx, y + 0.9, z), WD);
  batch.add(mats.steelIn, box(L - 0.1, 0.03, d - 0.1), xf(cx, y + 0.2, z), G);
  batch.add(mats.black, cyl(0.24, 0.24, 0.11, 18), xf(cx - 0.5, y + 0.98, z + 0.05));
  batch.add(mats.galvIn, cyl(0.06, 0.06, 0.12, 10), xf(cx - 0.5, y + 0.98, z + 0.05), G);
  batch.add(k.red, rbox(0.32, 0.12, 0.14, 0.02, 1), xf(cx + 0.2, y + 0.99, z + 0.1, 0, 0.3, 0), P);
  batch.add(k.carton, box(0.5, 0.3, 0.4), xf(cx + 0.65, y + 1.08, z - 0.1, 0, 0.1, 0), { tile: 1.2 });
  batch.add(k.carton, box(0.4, 0.4, 0.4), xf(cx + 0.8, y + 0.42, z, 0, -0.2, 0), { tile: 1.2 });
  batch.add(mats.woodIn, box(L - 0.2, 0.9, 0.02), xf(cx, y + 1.65, zWall + 0.02), WD);
  for (let i = 0; i < 7; i++) {
    const w = 0.08 + rand() * 0.2, hh = 0.15 + rand() * 0.3;
    batch.add(mats.black, box(w, hh, 0.02), xf(cx - L / 2 + 0.3 + i * (L - 0.5) / 7, y + 1.6 + (rand() - 0.5) * 0.3, zWall + 0.04));
  }
  phys.addBox(cx, y + 0.475, z, L / 2, 0.475, d / 2, 0, 'metal');
}

// 一排配电柜，靠墙（n 是柜门朝向），柜顶有线管上到桥架
export function panels(ctx, k, x0, n, y, zWall, face, trayY) {
  const { batch, mats, phys } = ctx;
  const w = 0.8, d = 0.5, h = 2.0, z = zWall + face * d / 2;
  const volt = ctx.atlas.cached('wh|volt', 128, 128, (c) => {
    c.fillStyle = '#e0b020';
    c.beginPath(); c.moveTo(64, 8); c.lineTo(122, 116); c.lineTo(6, 116); c.closePath(); c.fill();
    c.fillStyle = '#111';
    c.beginPath(); c.moveTo(70, 40); c.lineTo(54, 72); c.lineTo(66, 72); c.lineTo(58, 102); c.lineTo(80, 64); c.lineTo(67, 64); c.closePath(); c.fill();
  });
  for (let i = 0; i < n; i++) {
    const x = x0 + w / 2 + i * w, fz = z + face * (d / 2 + 0.003);
    batch.add(k.white, rbox(w - 0.02, h, d, 0.015, 1), xf(x, y + h / 2, z), P);
    batch.add(mats.black, box(0.012, h - 0.1, 0.004), xf(x, y + h / 2, fz));
    batch.add(mats.glassDark, box(0.3, 0.2, 0.006), xf(x - 0.17, y + 1.5, fz));
    batch.add(mats.emissive(0x2bff6a, 6), box(0.025, 0.025, 0.006), xf(x + 0.12, y + 1.62, fz));
    if (i % 2) batch.add(mats.emissive(0xff3018, 6), box(0.025, 0.025, 0.006), xf(x + 0.2, y + 1.62, fz));
    batch.add(mats.steelIn, box(0.03, 0.14, 0.03), xf(x + 0.3, y + 1.0, fz + face * 0.015), G);
    sticker(ctx, volt, x - 0.17, y + 1.2, fz + face * 0.002, 0.16, 0.16, face > 0 ? 0 : Math.PI);
    batch.add(mats.galvIn, cyl(0.035, 0.035, trayY - y - h, 8), xf(x, (y + h + trayY) / 2, zWall + face * 0.12), G);
  }
  phys.addBox(x0 + (n * w) / 2, y + h / 2, z, (n * w) / 2, h / 2, d / 2, 0, 'metal');
}

// 吨桶：钢托底座 + 白色塑料内胆 + 镀锌框笼，1.2 × 1.0 × 1.16
export function ibc(ctx, k, x, y, z, yaw = 0) {
  const { batch, mats } = ctx;
  const m = xf(x, y, z, 0, yaw, 0), at = (a, b, c, rx = 0) => m.clone().multiply(xf(a, b, c, rx));
  batch.add(mats.steelIn, box(1.2, 0.14, 1.0), at(0, 0.07, 0), G);
  batch.add(k.white, rbox(1.08, 0.92, 0.9, 0.08, 1), at(0, 0.61, 0), P);
  for (let i = 0; i <= 5; i++) for (const s of [-1, 1]) batch.add(mats.galvIn, box(0.025, 1.0, 0.025), at(-0.58 + i * 0.232, 0.64, s * 0.48), G);
  for (let i = 1; i < 4; i++) for (const s of [-1, 1]) batch.add(mats.galvIn, box(0.025, 1.0, 0.025), at(s * 0.58, 0.64, -0.48 + i * 0.24), G);
  for (const yy of [0.5, 0.82, 1.14]) {
    for (const s of [-1, 1]) {
      batch.add(mats.galvIn, box(1.18, 0.025, 0.025), at(0, yy, s * 0.48), G);
      batch.add(mats.galvIn, box(0.025, 0.025, 0.96), at(s * 0.58, yy, 0), G);
    }
  }
  batch.add(mats.black, cyl(0.1, 0.1, 0.05, 12), at(0, 1.1, 0));
  batch.add(mats.black, cyl(0.05, 0.05, 0.16, 8), at(0, 0.24, 0.55, Math.PI / 2, 0, 0));
}
