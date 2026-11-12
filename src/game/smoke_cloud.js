import * as THREE from 'three';

// 烟团的时间表：0.4 秒长到 4.2 米，维持，最后 1.2 秒变稀，6 秒整散尽
export const CLOUD = { radius: 4.2, grow: 0.4, life: 6, fade: 1.2 };
// 视线球心离烟团落脚地面的高度。烟是扣在地上的扁穹顶（顶高约 0.8 × 半径），
// 球心放低一点，球露出地面的部分和穹顶差不多大，站着、蹲着的视线都从厚的地方穿过
export const CLOUD_LIFT = 0.5;

const PUFF = { size: 1.6, life: 2.4, rise: 0.18, count: 1, color: 0xc2c6ca };
const POP = { size: 0.9, life: 1.2, rise: 2.2, count: 6, color: 0xc6cacd };
const MAX_PER_FRAME = 12;
const _p = new THREE.Vector3();

// 长到多大（0..1）：先快后慢
export function growth(t) {
  if (t >= CLOUD.grow) return 1;
  const u = 1 - Math.max(0, t) / CLOUD.grow;
  return 1 - u * u;
}

// 挡视线用的半径：跟着烟团长大，变稀时缩回 0
export function visionRadius(t) {
  const { radius, life, fade } = CLOUD;
  if (!(t >= 0) || t >= life) return 0;
  const f = (t - (life - fade)) / fade;
  if (f <= 0) return radius * growth(t);
  return radius * (1 - f * f * (3 - 2 * f));
}

// 每秒补几团：起烟时最密，维持期补烟，变稀阶段前半段减到 0，剩下的自己淡掉
// fx.smoke 的单团从出生就开始变淡，要叠到三四层才挡得住，所以补得很勤（同时在场约一百团）
function rate(t) {
  if (t < CLOUD.grow) return 110;
  const fadeAt = CLOUD.life - CLOUD.fade;
  if (t < fadeAt) return 38;
  const f = (t - fadeAt) / (CLOUD.fade * 0.5);
  return f < 1 ? 38 * (1 - f) : 0;
}

// 没有 fx.smokeCloud 时的退路：按时间表往 fx.smoke 里喂烟团。
// c = { x, y, z, t, acc }：x、z 是烟团中心，y 是落脚的地面，t 是炸开后过了多久
export function feedCloud(fx, c, dt) {
  if (c.t === 0) {
    // 炸开那一下：一股往上冲的浓烟
    _p.set(c.x, c.y + 0.3, c.z);
    fx.smoke(_p, POP);
  }
  c.t += dt;
  c.acc = Math.min(c.acc + rate(c.t) * dt, MAX_PER_FRAME);
  while (c.acc >= 1) {
    c.acc -= 1;
    emitOne(fx, c);
  }
}

// 在一个扣在地上的穹顶里随机放一团：越靠边越矮；还在长的时候整体缩小
function emitOne(fx, c) {
  const R = CLOUD.radius, g = growth(c.t);
  const left = CLOUD.life - c.t;
  // fx.smoke 会把寿命随机放大到 1.2 倍，这里先除掉，保证 6 秒时一团不剩
  const life = Math.min(2.3 + Math.random() * 0.8, left / 1.2);
  if (life < 0.35) return;
  const a = Math.random() * Math.PI * 2, k = Math.sqrt(Math.random());
  const hr = R * 0.8 * k * (0.35 + 0.65 * g);
  const h = (0.2 + Math.random() * 2.8 * (1 - 0.55 * k * k)) * (0.45 + 0.55 * g);
  _p.set(c.x + Math.cos(a) * hr, c.y + h, c.z + Math.sin(a) * hr);
  PUFF.life = life;
  PUFF.size = (1.5 + Math.random() * 0.7) * (0.6 + 0.4 * g);
  fx.smoke(_p, PUFF);
}
