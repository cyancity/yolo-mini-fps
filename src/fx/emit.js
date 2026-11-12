import * as THREE from 'three';

// 各配方共用的发射小工具。全部只写预分配的池，不产生临时对象。
export const R = Math.random;
export const rr = (a, b) => a + Math.random() * (b - a);
export const TAU = Math.PI * 2;
export const D = new THREE.Vector3(); // spray 的输出

// 以 (nx,ny,nz) 为轴的随机方向，写进 D。spread 0 贴着轴，1 铺满半球，再大就压回表面以上。
export function spray(nx, ny, nz, spread) {
  const z = R() * 2 - 1, a = R() * TAU, r = Math.sqrt(1 - z * z);
  D.set(nx + Math.cos(a) * r * spread, ny + z * spread, nz + Math.sin(a) * r * spread);
  if (D.lengthSq() < 1e-6) D.set(nx, ny, nz);
  D.normalize();
  const d = D.x * nx + D.y * ny + D.z * nz;
  if (d < 0.08) {
    D.x += nx * (0.08 - d); D.y += ny * (0.08 - d); D.z += nz * (0.08 - d);
    D.normalize();
  }
  return D;
}

// 粒子数量的折扣：离镜头远的、烟池快满时的都少发。
// 一群敌人同时扫射时，近处的弹着点照常，远处的缩水，池子留出余量，爆炸的烟不会被顶掉。
export function detail(fx, x, y, z) {
  let k = 1;
  const d2 = fx.dist2(x, y, z);
  if (d2 > 625) k = Math.max(0.3, 1 - (Math.sqrt(d2) - 25) / 50);
  const load = Math.max(fx.puffs.count / fx.puffs.cap, fx.streaks.count / fx.streaks.cap);
  if (load > 0.6) k *= Math.max(0.3, 1 - (load - 0.6) * 2);
  return k;
}

// 一把火花：从亮黄冷却到暗红
export function sparkBurst(fx, x, y, z, nx, ny, nz, count, speed, spread, r, g, b, power, floorY) {
  const st = fx.streaks;
  for (let k = 0; k < count; k++) {
    spray(nx, ny, nz, spread);
    const v = speed * (0.3 + 0.9 * R() * R() + 0.25 * R());
    const i = st.spark(x, y, z, D.x * v, D.y * v, D.z * v, rr(0.18, 0.55), rr(0.0025, 0.0045), rr(0.016, 0.03), floorY);
    st.color(i, r, g, b, power * rr(0.6, 1.3), r, g * 0.45, b * 0.12);
  }
}

// 溅起的水：不发光，亮度取自周围灯光
export function splash(fx, x, y, z, nx, ny, nz, count, speed, floorY) {
  const st = fx.streaks;
  for (let k = 0; k < count; k++) {
    spray(nx, ny, nz, 0.6);
    const v = speed * rr(0.4, 1);
    const i = st.spark(x, y, z, D.x * v, D.y * v, D.z * v, rr(0.22, 0.42), rr(0.003, 0.005), rr(0.014, 0.024), floorY, 9.8, 0.5, 0);
    st.color(i, 0.75, 0.85, 1, rr(1.2, 2.2));
    st.lit(i);
  }
}

// 碎玻璃：比水花亮、飞得久，靠周围的灯一闪一闪，落地弹一下
export function shards(fx, x, y, z, nx, ny, nz, count, speed, floorY) {
  const st = fx.streaks;
  for (let k = 0; k < count; k++) {
    spray(nx, ny, nz, 0.8);
    const v = speed * rr(0.3, 1);
    const i = st.spark(x, y, z, D.x * v, D.y * v + 0.5, D.z * v, rr(0.35, 0.7), rr(0.003, 0.0055), rr(0.012, 0.02), floorY, 9.8, 0.6, 1);
    st.color(i, 0.8, 0.92, 1, rr(4, 9));
    st.lit(i);
  }
}

// 一团受光的烟或尘
export function puff(fx, x, y, z, vx, vy, vz, life, size0, size1, alpha, r, g, b, drag = 2.5, fadeIn = 0.08) {
  const p = fx.puffs;
  const i = p.emit(x, y, z, vx, vy, vz, life, size0, size1, alpha, (R() * 4) | 0);
  p.tint(i, r, g, b);
  p.motion(i, 0, drag, R() * TAU, rr(-0.8, 0.8), 1, fadeIn);
  return i;
}

// 碎屑：小而实的受光颗粒，带重力和翻滚。aspect < 1 是细长的木刺、纤维。
export function chips(fx, x, y, z, nx, ny, nz, count, speed, size, r, g, b, aspect = 1) {
  const p = fx.puffs;
  for (let k = 0; k < count; k++) {
    spray(nx, ny, nz, 0.75);
    const v = speed * rr(0.35, 1), s = size * rr(0.6, 1.5), tone = rr(0.7, 1.15);
    const i = p.emit(x, y, z, D.x * v, D.y * v + 0.6, D.z * v, rr(0.45, 0.9), s, s, 1, (R() * 4) | 0);
    p.tint(i, r * tone, g * tone, b * tone);
    p.motion(i, 9.8, 0.4, R() * TAU, rr(-25, 25), aspect, 0);
  }
}
