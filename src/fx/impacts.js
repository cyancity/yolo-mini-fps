import { R, rr, TAU, D, spray, sparkBurst, splash, shards, puff, chips, detail } from './emit.js';
import { CRACK } from './decals.js';

const num = (a, b, k) => Math.max(1, Math.round(rr(a, b) * k));

// 几团朝外喷的尘
function dust(fx, x, y, z, nx, ny, nz, count, size, alpha, r, g, b) {
  for (let k = 0; k < count; k++) {
    spray(nx, ny, nz, 0.5);
    const v = rr(0.5, 1.6);
    puff(fx, x, y, z, D.x * v, D.y * v + 0.15, D.z * v, rr(0.7, 1.2), 0.04, size * rr(0.75, 1.2), alpha, r, g, b, 3.5);
  }
}

// 子弹命中：按材质出火花、尘土、碎屑、水花，并贴弹孔。
// scale 管大小，粒子数量另外按距离和池子余量打折；low：弹孔记进敌人流弹那个环
export function emitImpact(fx, point, normal, surface, decal, scale, low) {
  const x = point.x, y = point.y, z = point.z, nx = normal.x, ny = normal.y, nz = normal.z;
  // 粒子从表面外一点出发，免得一出生就被软粒子淡掉
  const ox = x + nx * 0.02, oy = y + ny * 0.02, oz = z + nz * 0.02;
  const floorY = fx.floorAt(ox + nx * 0.3, oy, oz + nz * 0.3);
  const roll = R() * TAU, dc = fx.decals, k = scale * detail(fx, x, y, z);
  switch (surface) {
    case 'metal': {
      sparkBurst(fx, ox, oy, oz, nx, ny, nz, num(8, 14, k), 7, 0.85, 1, 0.6, 0.24, 7, floorY);
      const g = fx.glow.emit(ox, oy, oz, 0, 0, 0, 0.06, 0.05 * scale, 0.11 * scale, 1, 4);
      fx.glow.tint(g, 9, 6.2, 3.2, 9, 3, 0.8);
      puff(fx, ox, oy, oz, nx * 0.5, ny * 0.5 + 0.2, nz * 0.5, rr(0.4, 0.7), 0.03, 0.2 * scale, 0.22, 0.5, 0.5, 0.52);
      if (decal) {
        const s = rr(0.075, 0.1) * scale;
        dc.add(x, y, z, nx, ny, nz, 0, s, s, roll, 1, 1, 1, 0.45, 1, 1.1, low);
      }
      break;
    }
    case 'asphalt': {
      if (fx.wetAt(x, y, z)) {
        // 雨后的露天地面：深色尘土里夹着溅起的水
        dust(fx, ox, oy, oz, nx, ny, nz, 2, 0.34 * scale, 0.36, 0.4, 0.4, 0.42);
        chips(fx, ox, oy, oz, nx, ny, nz, num(2, 4, k), 3, 0.009, 0.16, 0.16, 0.17);
        splash(fx, ox, oy, oz, nx, ny, nz, num(8, 12, k), 3.6, floorY);
        puff(fx, ox, oy, oz, nx * 1.6, ny * 1.6, nz * 1.6, rr(0.4, 0.6), 0.06, 0.5 * scale, 0.3, 0.8, 0.86, 0.95, 4);
      } else {
        // 屋檐下、屋里的地面是干的：只有尘和碎渣
        dust(fx, ox, oy, oz, nx, ny, nz, 2 + (R() < 0.5), 0.38 * scale, 0.34, 0.36, 0.36, 0.37);
        chips(fx, ox, oy, oz, nx, ny, nz, num(4, 6, k), 3.2, 0.01, 0.2, 0.2, 0.21);
      }
      if (decal) {
        const s = rr(0.085, 0.115) * scale;
        dc.add(x, y, z, nx, ny, nz, 1, s, s, roll, 0.3, 0.3, 0.32, 0, 0.95, 0.8, low);
      }
      break;
    }
    case 'wood': {
      chips(fx, ox, oy, oz, nx, ny, nz, num(5, 8, k), 3, 0.016, 0.55, 0.42, 0.26, 0.22);
      dust(fx, ox, oy, oz, nx, ny, nz, 1 + (R() < 0.5), 0.25 * scale, 0.22, 0.5, 0.42, 0.32);
      if (decal) {
        const s = rr(0.075, 0.1) * scale;
        dc.add(x, y, z, nx, ny, nz, 2, s, s * 1.5, roll, 1, 1, 1, 0, 1, 0.6, low);
      }
      break;
    }
    case 'fabric': {
      dust(fx, ox, oy, oz, nx, ny, nz, 1 + (R() < 0.5), 0.22 * scale, 0.2, 0.45, 0.43, 0.4);
      chips(fx, ox, oy, oz, nx, ny, nz, num(2, 4, k), 1.5, 0.008, 0.5, 0.46, 0.38, 0.3);
      if (decal) {
        const s = rr(0.045, 0.06) * scale;
        dc.add(x, y, z, nx, ny, nz, 3, s, s, roll, 1, 1, 1, 0, 0.9, 0.5, low);
      }
      break;
    }
    case 'rubber': {
      dust(fx, ox, oy, oz, nx, ny, nz, 1, 0.2 * scale, 0.25, 0.08, 0.08, 0.08);
      chips(fx, ox, oy, oz, nx, ny, nz, num(2, 4, k), 2.2, 0.009, 0.03, 0.03, 0.03);
      if (decal) {
        const s = rr(0.04, 0.055) * scale;
        dc.add(x, y, z, nx, ny, nz, 3, s, s, roll, 1, 1, 1, 0, 1, 0.6, low);
      }
      break;
    }
    case 'flesh': {
      // 打在士兵身上：衣料的尘、几根纤维、一小团很快散掉的暗雾。克制，不见血；人会动，所以不贴花
      // 衣料的灰喷得快、散得也快，二三十米外也看得出打中了
      for (let n = 1 + (R() < 0.5); n >= 0; n--) {
        spray(nx, ny, nz, 0.45);
        const v = rr(1.2, 2.6);
        puff(fx, ox, oy, oz, D.x * v, D.y * v + 0.1, D.z * v, rr(0.35, 0.6), 0.04, 0.24 * scale * rr(0.8, 1.2), 0.36, 0.52, 0.5, 0.44, 5, 0.03);
      }
      chips(fx, ox, oy, oz, nx, ny, nz, num(4, 7, k), 2, 0.008, 0.42, 0.42, 0.34, 0.25);
      spray(nx, ny, nz, 0.25);
      const v = rr(1.6, 2.6);
      puff(fx, ox, oy, oz, D.x * v, D.y * v, D.z * v, rr(0.25, 0.38), 0.05, 0.26 * scale, 0.5, 0.11, 0.065, 0.06, 6, 0.04);
      break;
    }
    case 'glass': {
      // 亮碎碴往两面溅（背面是子弹带出去的）、一团白粉、一下冷白的闪光；玻璃上留放射状裂纹
      shards(fx, ox, oy, oz, nx, ny, nz, num(6, 9, k), 4.2, floorY);
      shards(fx, x - nx * 0.06, y - ny * 0.06, z - nz * 0.06, -nx, -ny, -nz, num(4, 7, k), 3.4, floorY);
      chips(fx, ox, oy, oz, nx, ny, nz, num(4, 7, k), 2.6, 0.008, 0.82, 0.9, 0.94);
      dust(fx, ox, oy, oz, nx, ny, nz, 1 + (R() < 0.5), 0.26 * scale, 0.2, 0.85, 0.88, 0.9);
      const g = fx.glow.emit(ox, oy, oz, 0, 0, 0, 0.05, 0.03 * scale, 0.08 * scale, 1, 4);
      fx.glow.tint(g, 3.2, 3.6, 4, 1.2, 1.5, 1.8);
      if (decal) {
        const s = rr(0.2, 0.3) * scale;
        dc.add(x, y, z, nx, ny, nz, CRACK, s, s, roll, 1, 1, 1, 0, 1, R(), low);
      }
      break;
    }
    case 'carpet': {
      // 地毯：一团软尘、几根绒，留个小黑洞
      dust(fx, ox, oy, oz, nx, ny, nz, 2, 0.3 * scale, 0.2, 0.5, 0.47, 0.44);
      chips(fx, ox, oy, oz, nx, ny, nz, num(2, 4, k), 1.3, 0.007, 0.42, 0.4, 0.38, 0.3);
      if (decal) {
        const s = rr(0.05, 0.065) * scale;
        dc.add(x, y, z, nx, ny, nz, 3, s, s, roll, 1, 1, 1, 0, 1.3, 0.7, low);
      }
      break;
    }
    case 'gravel': {
      // 碎石地：石子崩起来，尘比混凝土大，留一个浅坑
      chips(fx, ox, oy, oz, nx, ny, nz, num(6, 10, k), 4.4, 0.013, 0.46, 0.45, 0.43);
      dust(fx, ox, oy, oz, nx, ny, nz, 2 + (R() < 0.5), 0.44 * scale, 0.32, 0.55, 0.52, 0.48);
      if (R() < 0.15) sparkBurst(fx, ox, oy, oz, nx, ny, nz, num(2, 3, k), 5, 0.8, 1, 0.6, 0.24, 6, floorY);
      if (decal) {
        const s = rr(0.08, 0.11) * scale;
        dc.add(x, y, z, nx, ny, nz, 1, s, s, roll, 0.5, 0.48, 0.45, 0, 0.75, 0.9, low);
      }
      break;
    }
    default: {
      // 混凝土，以及没登记的材质
      dust(fx, ox, oy, oz, nx, ny, nz, 2 + (R() < 0.5), 0.42 * scale, 0.34, 0.6, 0.58, 0.54);
      chips(fx, ox, oy, oz, nx, ny, nz, num(4, 7, k), 3.5, 0.011, 0.5, 0.48, 0.44);
      if (R() < 0.3) sparkBurst(fx, ox, oy, oz, nx, ny, nz, num(2, 4, k), 5, 0.8, 1, 0.6, 0.24, 6, floorY);
      if (decal) {
        const s = rr(0.1, 0.14) * scale;
        dc.add(x, y, z, nx, ny, nz, 1, s, s, roll, 1, 1, 1, 0, 1, 0.9, low);
      }
    }
  }
}

// 刀划过表面：一道细长的痕 + 少量火花或碎屑
export function emitSlash(fx, point, normal, surface) {
  const x = point.x, y = point.y, z = point.z, nx = normal.x, ny = normal.y, nz = normal.z;
  const ox = x + nx * 0.02, oy = y + ny * 0.02, oz = z + nz * 0.02;
  const floorY = fx.floorAt(ox + nx * 0.3, oy, oz + nz * 0.3);
  // 墙面上从右上划到左下；地面上方向随意
  const roll = Math.abs(ny) < 0.9 ? rr(0.45, 0.85) : R() * TAU;
  const len = rr(0.28, 0.4), dc = fx.decals;
  switch (surface) {
    case 'metal': {
      dc.add(x, y, z, nx, ny, nz, 0, len, 0.028, roll, 1, 1, 1, 0.45, 1, 0.5);
      // 火花顺着刀走的方向甩出去
      const t = dc.dir;
      let sx = nx * 0.6 - t.x * 0.8, sy = ny * 0.6 - t.y * 0.8, sz = nz * 0.6 - t.z * 0.8;
      const sl = 1 / Math.hypot(sx, sy, sz);
      sx *= sl; sy *= sl; sz *= sl;
      sparkBurst(fx, ox, oy, oz, sx, sy, sz, 5 + ((R() * 4) | 0), 4.5, 0.5, 1, 0.6, 0.24, 7, floorY);
      break;
    }
    case 'wood':
      // 木头那格的木刺沿本地 Y 伸展，所以转 90° 再拉长
      dc.add(x, y, z, nx, ny, nz, 2, 0.035, len, roll + Math.PI / 2, 1, 1, 1, 0, 1, 0.4);
      chips(fx, ox, oy, oz, nx, ny, nz, 3, 1.8, 0.012, 0.55, 0.42, 0.26, 0.22);
      break;
    case 'fabric':
    case 'rubber':
    case 'carpet': {
      const tone = surface === 'rubber' ? 0.07 : 1;
      dc.add(x, y, z, nx, ny, nz, 3, len, 0.014, roll, 1, 1, 1, 0, 0.9, 0.3);
      chips(fx, ox, oy, oz, nx, ny, nz, 2, 1.2, 0.007, 0.5 * tone, 0.46 * tone, 0.38 * tone, 0.3);
      break;
    }
    case 'flesh':
      // 划在衣料上：几根纤维和一点尘，不贴花
      chips(fx, ox, oy, oz, nx, ny, nz, 3, 1.3, 0.007, 0.34, 0.35, 0.27, 0.28);
      puff(fx, ox, oy, oz, nx * 0.4, ny * 0.4 + 0.1, nz * 0.4, rr(0.3, 0.45), 0.03, 0.14, 0.2, 0.4, 0.4, 0.34);
      break;
    case 'glass':
      // 刀尖磕在玻璃上：一小片星状裂纹和几粒碎碴
      dc.add(x, y, z, nx, ny, nz, CRACK, 0.09, 0.09, roll, 1, 1, 1, 0, 1, R());
      shards(fx, ox, oy, oz, nx, ny, nz, 3, 2, floorY);
      break;
    case 'gravel':
      // 松散的石子留不住刀痕
      chips(fx, ox, oy, oz, nx, ny, nz, 4, 2.2, 0.011, 0.46, 0.45, 0.43);
      puff(fx, ox, oy, oz, nx * 0.4, ny * 0.4 + 0.1, nz * 0.4, rr(0.4, 0.6), 0.03, 0.18, 0.2, 0.55, 0.52, 0.48);
      break;
    default: {
      const dark = surface === 'asphalt' ? 0.4 : 1;
      dc.add(x, y, z, nx, ny, nz, 1, len, 0.03, roll, dark, dark, dark, 0, 1, 0.5);
      chips(fx, ox, oy, oz, nx, ny, nz, 3, 2, 0.008, 0.5 * dark, 0.48 * dark, 0.44 * dark);
      puff(fx, ox, oy, oz, nx * 0.4, ny * 0.4 + 0.1, nz * 0.4, rr(0.4, 0.6), 0.03, 0.16, 0.2, 0.55 * dark, 0.53 * dark, 0.5 * dark);
      if (R() < 0.35) sparkBurst(fx, ox, oy, oz, nx, ny, nz, 2, 3.5, 0.7, 1, 0.6, 0.24, 6, floorY);
    }
  }
}
