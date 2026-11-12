import * as THREE from 'three';
import { MAP } from '../world/plan.js';

const N = 512;
const MARGIN = 3;      // 包围框外留一圈空白，边缘采到的是露天
const REACH = 16;      // 地图边界外这么远以外的碰撞体不进图，分辨率留给地图本身
const LAND_MIN = 0.3;  // 顶面半宽不到这个数的盒子上不落水花（栏杆、矮墙、台阶踏板）
export const NO_LANDING = -1000;

// 把一个盒子的俯视投影（四周放大 grow，可为负）按顶面高度取最大值写进通道 ch
function stampBox(d, ch, b, grow, x0, z0, tx, tz) {
  const hx = b.hx + grow, hz = b.hz + grow;
  if (hx <= 0 || hz <= 0) return;
  const ac = Math.abs(b.c), as = Math.abs(b.s);
  const ex = hx * ac + hz * as, ez = hx * as + hz * ac;
  const i0 = Math.max(1, Math.floor((b.cx - ex - x0) / tx)), i1 = Math.min(N - 2, Math.ceil((b.cx + ex - x0) / tx));
  const j0 = Math.max(1, Math.floor((b.cz - ez - z0) / tz)), j1 = Math.min(N - 2, Math.ceil((b.cz + ez - z0) / tz));
  const top = b.top;
  for (let j = j0; j <= j1; j++) {
    const dz = z0 + (j + 0.5) * tz - b.cz;
    for (let i = i0; i <= i1; i++) {
      const dx = x0 + (i + 0.5) * tx - b.cx;
      const o = (j * N + i) * 2 + ch;
      if (top > d[o] && Math.abs(dx * b.c - dz * b.s) <= hx && Math.abs(dx * b.s + dz * b.c) <= hz) d[o] = top;
    }
  }
}

// 俯视的遮雨高度图，由碰撞体烤出来，雨丝、水花、弹着点和滑铲的干湿、“镜头在不在屋檐下”都查它。
// R：这一格上方最高的顶面（多罩半格，宁可墙外少几滴也不让雨落进屋里）。雨从上往下落，
//    最先碰到的就是最高的那个面，所以多层楼、雨棚、屋顶上的小屋都只需要这一个高度。
// G：水花落在哪个高度。露天地面是 0；只有整格都落在一块够大的顶面里才算数，否则是 NO_LANDING。
// 范围是总平面的地图范围并上碰撞体的包围框（地图外只多罩 REACH 米），新分区加进来不用改这里。
export class RoofMap {
  constructor(bounds = MAP) {
    this.bounds = bounds;
    this.data = new Float32Array(N * N * 2);
    this.texture = new THREE.DataTexture(this.data, N, N, THREE.RGFormat, THREE.FloatType);
    this.texture.minFilter = this.texture.magFilter = THREE.NearestFilter;
    this.texture.needsUpdate = true;
    this.rect = new THREE.Vector4(0, 0, 1, 1); // minX, minZ, 1/sizeX, 1/sizeZ
    this.x0 = 0;
    this.z0 = 0;
    this.tx = 1;
    this.tz = 1;
    this.nb = -1;
    this.nc = -1;
    this.lastB = null;
    this.lastC = null;
    this.bakes = 0;
    this.bakeMs = 0;
  }

  // 碰撞体有增减就重烤；返回这次有没有重烤。挪动已有碰撞体不会被发现，要手动调 bake
  sync(phys) {
    const nb = phys.boxes.length, nc = phys.cyls.length;
    if (nb === this.nb && nc === this.nc && (nb === 0 || phys.boxes[nb - 1] === this.lastB) && (nc === 0 || phys.cyls[nc - 1] === this.lastC)) return false;
    this.bake(phys);
    return true;
  }

  bake(phys) {
    const t0 = performance.now();
    const d = this.data, boxes = phys.boxes, cyls = phys.cyls, m = this.bounds;
    this.nb = boxes.length;
    this.nc = cyls.length;
    this.lastB = boxes[this.nb - 1] || null;
    this.lastC = cyls[this.nc - 1] || null;
    this.bakes++;
    d.fill(0);
    let x0 = m.x0, x1 = m.x1, z0 = m.z0, z1 = m.z1;
    for (const b of boxes) {
      if (b.playerOnly || b.top <= 0.05) continue;
      const ex = Math.abs(b.hx * b.c) + Math.abs(b.hz * b.s), ez = Math.abs(b.hx * b.s) + Math.abs(b.hz * b.c);
      x0 = Math.min(x0, b.cx - ex); x1 = Math.max(x1, b.cx + ex);
      z0 = Math.min(z0, b.cz - ez); z1 = Math.max(z1, b.cz + ez);
    }
    for (const c of cyls) {
      x0 = Math.min(x0, c.x - c.r); x1 = Math.max(x1, c.x + c.r);
      z0 = Math.min(z0, c.z - c.r); z1 = Math.max(z1, c.z + c.r);
    }
    x0 = Math.max(x0, m.x0 - REACH) - MARGIN; x1 = Math.min(x1, m.x1 + REACH) + MARGIN;
    z0 = Math.max(z0, m.z0 - REACH) - MARGIN; z1 = Math.min(z1, m.z1 + REACH) + MARGIN;
    const tx = (x1 - x0) / N, tz = (z1 - z0) / N, pad = Math.max(tx, tz) * 0.5;
    this.x0 = x0; this.z0 = z0; this.tx = tx; this.tz = tz;

    for (const b of boxes) {
      if (b.playerOnly || b.top <= 0.05) continue;
      stampBox(d, 0, b, pad, x0, z0, tx, tz);
      if (Math.min(b.hx, b.hz) >= LAND_MIN) stampBox(d, 1, b, -pad * 1.5, x0, z0, tx, tz);
    }
    // 圆柱（油桶、轮胎、灯杆）只挡雨，顶上不落水花
    for (const c of cyls) {
      const r = c.r + pad;
      const i0 = Math.max(1, Math.floor((c.x - r - x0) / tx)), i1 = Math.min(N - 2, Math.ceil((c.x + r - x0) / tx));
      const j0 = Math.max(1, Math.floor((c.z - r - z0) / tz)), j1 = Math.min(N - 2, Math.ceil((c.z + r - z0) / tz));
      for (let j = j0; j <= j1; j++) {
        const dz = z0 + (j + 0.5) * tz - c.z;
        for (let i = i0; i <= i1; i++) {
          const dx = x0 + (i + 0.5) * tx - c.x, o = (j * N + i) * 2;
          if (c.y1 > d[o] && dx * dx + dz * dz <= r * r) d[o] = c.y1;
        }
      }
    }
    // 落点只认最上面那一层：被别的东西罩住、或者落在边沿那半格里的都不算
    for (let o = 0; o < d.length; o += 2) {
      const roof = d[o];
      d[o + 1] = roof <= 0 ? 0 : d[o + 1] >= roof - 1e-3 ? roof : NO_LANDING;
    }
    this.texture.needsUpdate = true;
    this.rect.set(x0, z0, 1 / (x1 - x0), 1 / (z1 - z0));
    this.bakeMs = performance.now() - t0;
  }

  cell(x, z) {
    const i = Math.floor((x - this.x0) / this.tx), j = Math.floor((z - this.z0) / this.tz);
    return i < 0 || j < 0 || i >= N || j >= N ? -1 : (j * N + i) * 2;
  }

  // (x, z) 上方最高的顶面高度；图外和露天是 0
  coverAt(x, z) {
    const o = this.cell(x, z);
    return o < 0 ? 0 : this.data[o];
  }

  // 雨水落在 (x, z) 的哪个高度；落不到（被罩住、栏杆这类细东西）是 NO_LANDING
  landAt(x, z) {
    const o = this.cell(x, z);
    return o < 0 ? 0 : this.data[o + 1];
  }
}
