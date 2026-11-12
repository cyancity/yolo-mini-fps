import * as THREE from 'three';
import { Batch, xf, box, cyl } from '../../gfx/geo.js';
import { mulberry32 } from '../labels.js';
import { buildNear } from './rooftop_near.js';

// 远景：近处的邻居厂区（rooftop_near.js）、130~280 m 的多层街区、260~400 m 的商务区高楼、
// 北边一条高架路和上面的车流，外加电视塔。都不进碰撞。
// 自己合一个批次、不投影：几百米宽的东西要是并进分区的批次，整个楼顶分区的视锥剔除就失效了，
// 而且会被画进月光和高杆灯的每一张阴影图
const P = { tile: 5.2 }, C = { tile: 3 };
const EXPRESS_Z = -150, EXPRESS_Y = 12;
// 高楼群：[中心 x, z, 栋数, 半径, 最矮, 最高]。东边两簇近一点，街对面那排门面挡得多
const CLUSTERS = [[200, -350, 12, 80, 60, 165], [-50, -370, 7, 60, 50, 120], [-290, -250, 7, 60, 45, 110], [-360, -40, 5, 45, 40, 90],
  [360, -120, 6, 55, 45, 100], [200, 25, 4, 35, 40, 75], [250, -60, 5, 45, 45, 95]];

// 一栋楼：墙面贴窗户图（tile 是一张图铺多少米），顶上压一圈檐口，再随机加点屋顶设备
function block(b, M, mats, r, o) {
  const { x, z, w, d, h, mat, tile, y0 = 0 } = o;
  const uv = { tile, ou: Math.floor(r() * 32) / 32, ov: Math.floor(r() * 16) / 16 };
  b.add(mat, box(w, h, d), xf(x, y0 + h / 2, z), uv);
  b.add(M.dark, box(w + 0.6, 0.9, d + 0.6), xf(x, y0 + h + 0.25, z), P);
  return y0 + h + 0.7;
}

function midRing(b, M, mats, r) {
  const lamps = [];
  for (let gx = -272; gx <= 272; gx += 34) {
    for (let gz = -282; gz <= 52; gz += 34) {
      if (Math.abs(gx) < 128 && gz > -136) continue; // 近景的地盘
      if (Math.abs(gz - EXPRESS_Z) < 26) continue; // 高架路走廊
      if (Math.hypot(gx, gz) > 300 || r() < 0.18) continue;
      if (CLUSTERS.some(([cx, cz, , rad]) => Math.hypot(gx - cx, gz - cz) < rad + 14)) continue;
      const n = r() < 0.45 ? 2 : 1;
      for (let i = 0; i < n; i++) {
        const w = 12 + r() * 12, d = 12 + r() * 12;
        const x = gx + (n === 2 ? (i ? 7 : -7) : 0) + (r() - 0.5) * (n === 2 ? 2 : 10 - w * 0.2);
        const z = gz + (r() - 0.5) * (26 - d);
        const floors = 4 + Math.floor(r() * r() * 14), h = floors * 3.2;
        const top = block(b, M, mats, r, { x, z, w: n === 2 ? Math.min(w, 12.5) : w, d, h, mat: M.cityNear, tile: 51.2 });
        // 底商的灯箱带
        if (r() < 0.45) b.add([M.lampWarm, M.signFace, M.lampCool][Math.floor(r() * 3)], box((n === 2 ? Math.min(w, 12.5) : w) + 0.1, 0.7, d + 0.1), xf(x, 3.6, z));
        if (r() < 0.55) b.add(M.unit, cyl(1.3, 1.3, 2.2, 10), xf(x + w * 0.2, top + 1.1, z - d * 0.2), P);
        if (r() < 0.5) b.add(M.dark, box(3, 2.6, 4), xf(x - w * 0.2, top + 1.3, z + d * 0.15), P);
        if (h > 34) b.add(M.redLight, box(1.0, 1.0, 1.0), xf(x, top + 0.5, z));
      }
      // 街口的路灯（只做发光点）
      if (r() < 0.7) lamps.push([gx + 17, gz + 17]);
    }
  }
  for (const [x, z] of lamps) {
    b.add(M.sodium, box(0.8, 0.3, 0.8), xf(x, 9, z));
    b.add(M.sodium, box(0.8, 0.3, 0.8), xf(x - 17, 9, z));
  }
}

// 商务区高楼：主体 + 收分 + 冠顶灯带 + 避雷针和航标灯
function tower(b, M, mats, r, x, z, h) {
  const w = 20 + r() * 18, d = 18 + r() * 16;
  const tile = [48, 64, 64, 80][Math.floor(r() * 4)];
  let top = block(b, M, mats, r, { x, z, w, d, h, mat: M.cityFar, tile });
  // 一半的楼外面加竖向遮阳肋，打断窗格子
  if (r() < 0.5) {
    for (const [fw, fd, nx, nz] of [[w, d, 1, 0], [d, w, 0, 1]]) {
      const n = Math.floor(fw / 4.5);
      for (let i = 1; i < n; i++) {
        const u = -fw / 2 + (fw * i) / n;
        for (const s of [-1, 1]) {
          const px = nx ? x + u : x + s * (fd / 2 + 0.3), pz = nx ? z + s * (fd / 2 + 0.3) : z + u;
          b.add(M.dark, box(nx ? 0.35 : 0.6, h, nx ? 0.6 : 0.35), xf(px, h / 2, pz), P);
        }
      }
    }
  }
  if (r() < 0.6) {
    const h2 = h * (0.12 + r() * 0.2), k = 0.55 + r() * 0.2;
    top = block(b, M, mats, r, { x, z, w: w * k, d: d * k, h: h2, y0: top, mat: M.cityFar, tile });
  }
  if (r() < 0.55) {
    const crown = r() < 0.5 ? M.lampCool : M.lampWarm;
    b.add(crown, box(w * 0.5, 1.2, d * 0.5), xf(x, top + 0.6, z));
  }
  if (h > 100) {
    b.add(mats.galv, cyl(0.4, 1.0, 18, 6), xf(x, top + 9, z), { tile: 1.2 });
    b.add(M.beacon, box(1.6, 1.6, 1.6), xf(x, top + 18.5, z));
  }
  for (const [sx, sz] of [[-1, -1], [1, 1]]) b.add(M.redLight, box(1.3, 1.3, 1.3), xf(x + sx * w * 0.35, top + 0.7, z + sz * d * 0.35));
}

function skyline(b, M, mats, r) {
  const cluster = (cx, cz, n, rad, hmin, hmax) => {
    for (let i = 0; i < n; i++) {
      const a = r() * Math.PI * 2, dist = Math.sqrt(r()) * rad;
      tower(b, M, mats, r, cx + Math.cos(a) * dist, cz + Math.sin(a) * dist, hmin + (hmax - hmin) * r() ** 1.4);
    }
  };
  for (const c of CLUSTERS) cluster(...c);
  // 电视塔
  const tx = -140, tz = -250;
  b.add(mats.concrete, cyl(2.6, 6, 150, 16), xf(tx, 75, tz), { tile: 6 });
  b.add(M.dark, cyl(15, 10, 9, 24), xf(tx, 120, tz), P);
  b.add(M.cityFar, cyl(15.2, 15.2, 5, 24), xf(tx, 127, tz), { tile: 64 });
  b.add(M.lampCool, cyl(15.4, 15.4, 0.7, 24), xf(tx, 129.9, tz));
  b.add(M.dark, cyl(9, 15, 4, 24), xf(tx, 132, tz), P);
  b.add(mats.galv, cyl(0.6, 1.6, 48, 6), xf(tx, 158, tz), { tile: 1.2 });
  for (let y = 140; y < 182; y += 14) b.add(M.redLight, box(1.4, 1.4, 1.4), xf(tx, y, tz));
  b.add(M.beacon, box(1.8, 1.8, 1.8), xf(tx, 182.5, tz));
}

// 高架路：桥墩、桥面、防撞墙、两侧路灯
function expressway(b, M, mats) {
  const z = EXPRESS_Z, y = EXPRESS_Y;
  b.add(mats.concrete, box(700, 1.8, 22), xf(0, y - 0.9, z), { tile: 6 });
  for (const s of [-1, 1]) b.add(mats.concrete, box(700, 1.1, 0.5), xf(0, y + 0.55, z + s * 10.8), C);
  for (let x = -340; x <= 340; x += 40) b.add(mats.concrete, box(4, y - 1.8, 7), xf(x, (y - 1.8) / 2, z), { tile: 6 });
  for (let x = -330; x <= 330; x += 30) {
    for (const s of [-1, 1]) {
      b.add(mats.galv, cyl(0.12, 0.16, 9, 5), xf(x + s * 15, y + 4.5, z + s * 10.5), { tile: 1.2 });
      b.add(M.sodium, box(1.0, 0.25, 0.6), xf(x + s * 15, y + 9, z + s * 9.6));
    }
  }
}

// 高架上的车流：每辆车一个点，顶点着色器里按时间沿 x 平移，CPU 每帧只改一个 uniform
function traffic(scene, r) {
  const N = 260, L = 680, pos = new Float32Array(N * 3), col = new Float32Array(N * 3);
  for (let i = 0; i < N; i++) {
    const south = i % 2 === 0, lane = Math.floor(r() * 3);
    pos[i * 3] = r() * L;
    pos[i * 3 + 1] = EXPRESS_Y + 0.8;
    pos[i * 3 + 2] = EXPRESS_Z + (south ? 2.5 + lane * 3 : -2.5 - lane * 3);
    const c = south ? [1, 0.85, 0.7] : [1, 0.12, 0.06], k = south ? 9 + r() * 6 : 6 + r() * 4;
    col.set([c[0] * k, c[1] * k, c[2] * k], i * 3);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  const time = { value: 0 };
  const mat = new THREE.PointsMaterial({ size: 2.2, sizeAttenuation: false, vertexColors: true });
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uTime = time;
    shader.vertexShader = `uniform float uTime;\n${shader.vertexShader}`.replace('#include <begin_vertex>', /* glsl */ `
      #include <begin_vertex>
      float dir = position.z > ${EXPRESS_Z.toFixed(1)} ? -1.0 : 1.0;
      transformed.x = mod(position.x + uTime * dir * (15.0 + fract(position.x * 0.37) * 8.0), ${L.toFixed(1)}) - ${(L / 2).toFixed(1)};`);
  };
  mat.customProgramCacheKey = () => 'roof-traffic';
  const pts = new THREE.Points(g, mat);
  pts.frustumCulled = false;
  scene.add(pts);
  return time;
}

export function buildCity(ctx, M) {
  const { mats, scene } = ctx;
  const b = new Batch(), r = mulberry32(0x0d0c);
  // 地面：220 m 那块湿沥青之外，北、西、东三面铺到 480 m，南边留给海和码头
  const land = (x0, x1, z0, z1) => b.add(mats.concreteDark, box(x1 - x0, 1.2, z1 - z0), xf((x0 + x1) / 2, -0.62, (z0 + z1) / 2), { tile: 8 });
  land(-480, 480, -480, -109.9);
  land(-480, -109.9, -109.9, 86);
  land(109.9, 480, -109.9, 86);
  buildNear(b, M, mats, r);
  midRing(b, M, mats, r);
  skyline(b, M, mats, r);
  expressway(b, M, mats);
  b.build(scene, { cast: false });
  return { time: traffic(scene, r) };
}
