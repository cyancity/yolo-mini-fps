import * as THREE from 'three';
import { xf, box, rbox, cyl, cylBetween, scaleUV, corrugated } from '../gfx/geo.js';
import { decalQuad, distress, STENCIL_FONT } from './labels.js';

const G = { tile: 1.2 };

// 南侧铁丝网围栏和滑动大门
export function buildFence(ctx, { z = 20.5, x0 = -28.8, x1 = 28.8, gate = [-4, 4] } = {}) {
  const { batch, decals, mats, atlas, phys } = ctx;
  const H = 2.5, span = 3.2;
  const n = Math.round((x1 - x0) / span), step = (x1 - x0) / n;
  batch.add(mats.concrete, box(x1 - x0 + 0.4, 0.22, 0.3), xf((x0 + x1) / 2, 0.11, z), { tile: 3 });
  const link = (ax, bx, y0, y1, zz = z) => {
    const g = new THREE.PlaneGeometry(bx - ax, y1 - y0);
    scaleUV(g, (bx - ax) / 0.48, (y1 - y0) / 0.48);
    batch.add(mats.chainlink, g, xf((ax + bx) / 2, (y0 + y1) / 2, zz));
  };
  for (let i = 0; i <= n; i++) {
    const x = x0 + i * step;
    batch.add(mats.galv, cyl(0.038, 0.038, H + 0.25, 10), xf(x, (H + 0.25) / 2, z), G);
    batch.add(mats.galv, cylBetween(x, H + 0.2, z, x, H + 0.62, z + 0.38, 0.02, 8), null, G);
    if (i === n) break;
    const nx = x + step, inGate = x >= gate[0] - 0.01 && nx <= gate[1] + 0.01;
    for (let w = 0; w < 3; w++) {
      const t = 0.3 + w * 0.35;
      batch.add(mats.galv, cylBetween(x, H + 0.2 + 0.42 * t, z + 0.38 * t, nx, H + 0.2 + 0.42 * t, z + 0.38 * t, 0.005, 5), null, G);
    }
    if (inGate) continue;
    link(x, nx, 0.22, H);
    batch.add(mats.galv, cylBetween(x, H, z, nx, H, z, 0.02, 8), null, G);
  }
  // 大门：方管框架 + 铁丝网 + 斜撑，关着
  const gw = gate[1] - gate[0], gz = z - 0.09, gm = (gate[0] + gate[1]) / 2;
  const frame = mats.paint(0x2b3238, { wear: 0.55, dirt: 0.6 });
  for (const y of [0.3, H - 0.03]) batch.add(frame, rbox(gw, 0.06, 0.06, 0.006), xf(gm, y, gz), { tile: 5.2 });
  for (let i = 0; i <= 4; i++) batch.add(frame, rbox(0.06, H - 0.3, 0.06, 0.006), xf(gate[0] + (gw * i) / 4, (H + 0.3) / 2 - 0.02, gz), { tile: 5.2 });
  batch.add(mats.galv, cylBetween(gate[0], 0.35, gz, gate[1], H - 0.1, gz, 0.016, 8), null, G);
  link(gate[0], gate[1], 0.33, H - 0.06, gz - 0.035);
  for (const x of [gate[0] + 0.6, gate[1] - 0.6]) batch.add(mats.rubber, cyl(0.1, 0.1, 0.05, 16), xf(x, 0.16, gz, Math.PI / 2, 0, 0));
  batch.add(mats.galv, box(gw + 6, 0.03, 0.08), xf(gm + 1.5, 0.045, gz), G);
  const sign = atlas.add(384, 256, (c, w, h) => {
    c.fillStyle = '#d9d6cc'; c.fillRect(0, 0, w, h);
    c.fillStyle = '#a01d14'; c.fillRect(0, 0, w, 78);
    c.fillStyle = '#f2efe6'; c.textAlign = 'center';
    c.font = '700 54px "Microsoft YaHei UI", "Microsoft YaHei", sans-serif';
    c.fillText('禁止通行', w / 2, 58);
    c.fillStyle = '#16181a';
    c.font = `700 50px ${STENCIL_FONT}`;
    c.fillText('RESTRICTED', w / 2, 142);
    c.font = '600 34px "Microsoft YaHei UI", "Microsoft YaHei", sans-serif';
    c.fillText('危险品作业区 · 凭证出入', w / 2, 204, w - 20);
    distress(c, w, h, ctx.rand, 0.25);
  });
  for (const x of [gm - 1, x0 + step * 2.5, x1 - step * 3.5]) {
    batch.add(mats.galv, rbox(0.9, 0.6, 0.012, 0.004), xf(x, 1.55, z - 0.16), G);
    decals.add(atlas.material, decalQuad(0.9, 0.6, sign), xf(x + 0.45, 1.25, z - 0.168, 0, Math.PI, 0));
  }
  // 挡人的盒子比网栏高出一截到 4 米：堆场里站上 1.1 米的货再起跳，脚能过 2.5 米，翻出去就卡在空气墙前回不来
  phys.addBox((x0 + x1) / 2, 2, z, (x1 - x0) / 2 + 0.2, 2, 0.08, 0, 'metal').playerOnly = true;
  phys.addBox((x0 + x1) / 2, 0.11, z, (x1 - x0) / 2 + 0.2, 0.11, 0.15, 0, 'concrete');
}

// 高杆灯：返回灯头位置，灯光模块据此放聚光灯
export function lightMast(ctx, o) {
  const { batch, mats, phys } = ctx;
  const h = o.h || 9.5;
  const yaw = Math.atan2(o.aim[0] - o.x, o.aim[1] - o.z);
  const m = xf(o.x, 0, o.z, 0, yaw, 0);
  batch.add(mats.concrete, rbox(0.9, 0.45, 0.9, 0.03), m.clone().multiply(xf(0, 0.225, 0)), { tile: 3 });
  batch.add(mats.galv, rbox(0.42, 0.03, 0.42, 0.008), m.clone().multiply(xf(0, 0.465, 0)), G);
  for (const [bx, bz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) batch.add(mats.steelDark, cyl(0.022, 0.022, 0.05, 6), m.clone().multiply(xf(bx * 0.16, 0.5, bz * 0.16)), G);
  batch.add(mats.galv, scaleUV(cyl(0.065, 0.11, h, 14), 0.5, 7), m.clone().multiply(xf(0, 0.47 + h / 2, 0)));
  batch.add(mats.paint(0x6f746f, { wear: 0.4, dirt: 0.5 }), rbox(0.2, 0.34, 0.14, 0.012), m.clone().multiply(xf(0, 1.5, 0.15)), { tile: 5.2 });
  const top = 0.47 + h;
  batch.add(mats.galv, rbox(1.7, 0.07, 0.07, 0.008), m.clone().multiply(xf(0, top, 0)), G);
  const tilt = 0.9;
  for (const s of [-1, 1]) {
    const hm = m.clone().multiply(xf(s * 0.62, top - 0.12, 0.14, tilt, 0, 0));
    batch.add(mats.plasticBlack, rbox(0.52, 0.4, 0.13, 0.015), hm, { tile: 0.06 });
    for (let i = 0; i < 6; i++) batch.add(mats.plasticBlack, box(0.46, 0.34, 0.008), hm.clone().multiply(xf(0, 0, -0.075 - i * 0.012)), { tile: 0.06 });
    batch.add(mats.emissive(o.cool ? 0xd6e6ff : 0xffb45e, 70), box(0.45, 0.33, 0.006), hm.clone().multiply(xf(0, 0, 0.066)));
    batch.add(mats.galv, cylBetween(0, 0.1, -0.08, 0, 0.12, -0.14, 0.02, 8), hm, G);
  }
  batch.add(mats.emissive(0xff2a12, 12), new THREE.SphereGeometry(0.05, 8, 6), m.clone().multiply(xf(0, top + 0.12, 0)));
  phys.addBox(o.x, 0.225, o.z, 0.45, 0.225, 0.45, yaw, 'concrete');
  phys.addCyl(o.x, o.z, 0.11, 0.45, top, 'metal');
  return { position: new THREE.Vector3(o.x + Math.sin(yaw) * 0.2, top - 0.2, o.z + Math.cos(yaw) * 0.2), target: new THREE.Vector3(o.aim[0], 0, o.aim[1]) };
}

// 远景的简化集装箱（局部坐标：箱底中心在原点，长边沿 x）。只有朝堆场的 -z 面是波纹板，
// 尺寸照 containers.js；doorEnd 为 ±1 时那一端加两扇门和四根锁杆（锁杆用箱体漆，镀锌材质的包围球不往外扩）。约 300 个三角形，细节箱的十分之一
function backdropBox(ctx, paint, m, ou, ov, doorEnd) {
  const { batch } = ctx;
  const L = 6.06, H = 2.59, W = 2.44, T = { tile: 5.2, ou, ov };
  const put = (mat, geo, local, opt = T) => batch.add(mat, geo, m.clone().multiply(local), opt);
  put(paint, box(L - 0.1, H - 0.06, W - 0.14), xf(0, H / 2, 0));
  const wallW = L - 0.3, wallH = H - 0.28;
  put(paint, corrugated(wallW, wallH, { tile: 5.2, ou, ov }), xf(wallW / 2, 0.16, -(W / 2 - 0.05), 0, Math.PI, 0), {});
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) put(paint, box(0.16, H, 0.16), xf(sx * (L / 2 - 0.08), H / 2, sz * (W / 2 - 0.08)));
  for (const sz of [-1, 1]) {
    put(paint, box(L - 0.3, 0.16, 0.09), xf(0, 0.08, sz * (W / 2 - 0.05)));
    put(paint, box(L - 0.3, 0.12, 0.09), xf(0, H - 0.06, sz * (W / 2 - 0.05)));
  }
  if (!doorEnd) return;
  const dx = doorEnd * (L / 2 - 0.02), doorH = H - 0.3;
  for (const sz of [-1, 1]) put(paint, box(0.05, doorH, W / 2 - 0.02), xf(dx, 0.15 + doorH / 2, sz * W / 4));
  for (const z of [-0.85, -0.33, 0.33, 0.85]) put(paint, cyl(0.022, 0.022, doorH + 0.1, 5, true), xf(dx + doorEnd * 0.04, 0.15 + doorH / 2, z));
}

// 远景：围栏外的箱堆、岸桥剪影、水面、港区灯火。只负责轮廓和纵深，不参与碰撞。
export function buildBackdrop(ctx, scene) {
  const { batch, mats, rand } = ctx;
  const colors = [0x7d2a1e, 0x1c4470, 0x1f5e56, 0xb8901f, 0x8a8a82, 0xb24a18, 0x5a1f24];
  // detail：离围栏 13 m 的两排做成简化箱（朝堆场的波纹侧板、角柱、上下梁，排头排尾的箱门和锁杆），
  // 后面几排看不清，仍是一个盒子。随机数的取用顺序和原来一样，后面的远景不跟着变
  const stack = (x, z, yaw, rows, high, detail = false) => {
    for (let r = 0; r < rows; r++) {
      for (let k = 0; k < high - (rand() < 0.35 ? 1 : 0); k++) {
        const c = colors[Math.floor(rand() * colors.length)];
        const paint = mats.paint(c, { wear: 0.5, dirt: 0.7 });
        const m = xf(x, k * 2.59, z, 0, yaw, 0).multiply(xf(r * 6.3, 0, 0)), ou = rand(), ov = rand();
        if (detail) backdropBox(ctx, paint, m, ou, ov, r === 0 ? -1 : r === rows - 1 ? 1 : 0);
        else batch.add(paint, box(6.06, 2.59, 2.44), m.multiply(xf(0, 1.295, 0)), { tile: 5.2, ou, ov });
      }
    }
  };
  stack(-34, 31, 0, 5, 3, true);
  stack(4, 34, 0, 6, 4, true);
  stack(-22, 44, 0, 7, 4);
  stack(-40, -6, Math.PI / 2, 4, 3);

  // 码头前沿和岸桥
  const dark = mats.paint(0x3a4046, { wear: 0.4, dirt: 0.8 });
  const craneMat = mats.paint(0x86301f, { wear: 0.4, dirt: 0.7 });
  batch.add(mats.concreteDark, box(420, 1.2, 46), xf(0, -0.35, 108), { tile: 3 });
  const crane = (x, z, s = 1) => {
    const m = xf(x, 0.25, z, 0, 0, 0, s);
    const P = { tile: 5.2 };
    for (const lx of [-13, 13]) {
      for (const lz of [-9, 9]) batch.add(craneMat, box(1.6, 46, 1.6), m.clone().multiply(xf(lx, 23, lz)), P);
      batch.add(craneMat, box(1.4, 1.8, 18), m.clone().multiply(xf(lx, 16, 0)), P);
      batch.add(craneMat, box(1.4, 1.8, 18), m.clone().multiply(xf(lx, 45, 0)), P);
    }
    for (const lz of [-9, 9]) batch.add(craneMat, box(26, 2, 1.4), m.clone().multiply(xf(0, 45, lz)), P);
    const bar = (mat, ax, ay, az, bx, by, bz, r) => batch.add(mat, cylBetween(ax, ay, az, bx, by, bz, r, 3), m, P);
    // 门腿两侧的 X 撑，门框上角的斜撑
    for (const lx of [-13, 13]) {
      bar(craneMat, lx, 17, -9, lx, 44, 9, 0.3);
      bar(craneMat, lx, 17, 9, lx, 44, -9, 0.3);
      for (const lz of [-9, 9]) bar(craneMat, lx, 38, lz, lx - Math.sign(lx) * 6, 44.5, lz, 0.25);
    }
    // 臂架：两侧上下弦杆加 Z 形腹杆，顶上隔一段一道横联；后端顶上是机房
    const z0 = -32, z1 = 60, nP = 23;
    for (const sx of [-1, 1]) {
      batch.add(craneMat, box(0.9, 1.2, z1 - z0), m.clone().multiply(xf(sx * 1.3, 47, (z0 + z1) / 2)), P);
      batch.add(craneMat, box(0.6, 0.6, z1 - z0), m.clone().multiply(xf(sx * 1.3, 49.7, (z0 + z1) / 2)), P);
      for (let i = 0; i < nP; i++) {
        const a = z0 + ((z1 - z0) * i) / nP, b = z0 + ((z1 - z0) * (i + 1)) / nP;
        bar(craneMat, sx * 1.3, i % 2 ? 49.5 : 47.5, a, sx * 1.3, i % 2 ? 47.5 : 49.5, b, 0.14);
      }
    }
    for (let i = 0; i <= nP; i += 2) batch.add(craneMat, box(2.6, 0.3, 0.3), m.clone().multiply(xf(0, 49.8, z0 + ((z1 - z0) * i) / nP)), P);
    batch.add(craneMat, box(7, 4, 10), m.clone().multiply(xf(0, 52, -25)), P);
    batch.add(craneMat, box(1.2, 16, 1.2), m.clone().multiply(xf(0, 56, -4)), P);
    batch.add(craneMat, cylBetween(0, 64, -4, 0, 49.5, 52, 0.35, 6), m, P);
    batch.add(craneMat, cylBetween(0, 64, -4, 0, 49.5, -28, 0.35, 6), m, P);
    // 司机室（位置照旧）、它前面的小车，小车下面钢丝绳吊着吊具（长边顺着码头，和船上的箱子同向）。
    // 新加的件都用岸桥的红漆：深灰漆原来只有司机室，包围球小，加到它上面会让它进更多视锥和阴影遍，多出 draw call
    batch.add(craneMat, box(3.4, 1.0, 5.5), m.clone().multiply(xf(0, 46.3, 17)), P);
    batch.add(dark, box(4, 3.2, 5), m.clone().multiply(xf(0, 44.5, 22)), P);
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) bar(craneMat, sx * 1.0, 45.8, 17 + sz * 1.4, sx * 0.9, 31.2, 17 + sz * 1.0, 0.05);
    batch.add(craneMat, box(2.6, 0.9, 2.6), m.clone().multiply(xf(0, 31.2, 17)), P);
    for (const sz of [-1, 1]) batch.add(craneMat, box(12.2, 0.5, 0.35), m.clone().multiply(xf(0, 30.6, 17 + sz * 1.05)), P);
    batch.add(mats.emissive(0xff2a12, 24), new THREE.SphereGeometry(0.45, 8, 6), m.clone().multiply(xf(0, 64.6, -4)));
    batch.add(mats.emissive(0xff2a12, 24), new THREE.SphereGeometry(0.4, 8, 6), m.clone().multiply(xf(0, 50, 59)));
    batch.add(mats.emissive(0xffe1b0, 40), box(1.6, 0.5, 0.2), m.clone().multiply(xf(0, 46.2, 30)));
    batch.add(mats.emissive(0xdfeaff, 30), box(1.2, 0.4, 0.2), m.clone().multiply(xf(13, 30, 9.9)));
  };
  crane(-58, 112);
  crane(6, 118, 0.95);
  crane(74, 108, 1.05);

  const water = new THREE.Mesh(new THREE.PlaneGeometry(1400, 1400), new THREE.MeshStandardMaterial({ color: 0x04070b, roughness: 0.16, metalness: 0 }));
  water.rotation.x = -Math.PI / 2;
  water.position.y = -0.6;
  water.name = 'sea'; // 低画质档按名字找到它关掉
  scene.add(water);

  // 远处港区灯火：HDR 小点，泛光会把它们晕开
  const N = 420, pos = new Float32Array(N * 3), col = new Float32Array(N * 3);
  const palette = [[1.0, 0.62, 0.28], [1.0, 0.86, 0.6], [0.75, 0.86, 1.0], [1.0, 0.16, 0.08]];
  for (let i = 0; i < N; i++) {
    const a = rand() * Math.PI * 2, d = 190 + rand() * 260;
    pos[i * 3] = Math.cos(a) * d;
    pos[i * 3 + 1] = 1.5 + rand() * rand() * 42;
    pos[i * 3 + 2] = Math.sin(a) * d;
    const c = palette[rand() < 0.08 ? 3 : Math.floor(rand() * 3)], k = 5 + rand() * 22;
    col[i * 3] = c[0] * k; col[i * 3 + 1] = c[1] * k; col[i * 3 + 2] = c[2] * k;
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  const pts = new THREE.Points(g, new THREE.PointsMaterial({ size: 2.6, sizeAttenuation: false, vertexColors: true, fog: false }));
  pts.frustumCulled = false;
  scene.add(pts);
}
