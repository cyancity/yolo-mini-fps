import { roofMats } from './rooftop_mats.js';
import { buildShell } from './rooftop_shell.js';
import { buildFireEscape } from './rooftop_escape.js';
import { buildSign } from './rooftop_sign.js';
import { dressWarehouseRoof, dressOfficeRoof } from './rooftop_dress.js';
import { buildCity } from './rooftop_city.js';

// 分区：楼顶与远景。接口见 dev/README.md 的「分区模块」。
// 屋面板和女儿墙、出屋面楼梯间、两屋面之间的台阶、消防梯、屋面设备、招牌、图外的城市远景。
// 各块单独兜错：哪一块抛错只少那一块，灯的数量不变

function part(name, fn) {
  try {
    return fn();
  } catch (e) {
    console.error(`[rooftop] ${name} 没建起来`, e);
    return null;
  }
}

// 敌人出生点：都躲在设备后面，周围 1 m 没东西；用碰撞体射线逐点查过，
// 从消防梯各层平台、台阶上下口、楼梯间门内外站着看都看不见
const SPAWNS = [
  { x: -28.7, y: 9.0, z: -27.2 },
  { x: -14.0, y: 9.0, z: -26.0 },
  { x: 3.0, y: 9.0, z: -23.5 },
  { x: 23.25, y: 9.0, z: -22.25 },
  { x: 0.4, y: 8.1, z: -38.0 },
];

export function build(ctx) {
  const M = roofMats(ctx.mats);
  part('屋面', () => buildShell(ctx, M));
  part('消防梯', () => buildFireEscape(ctx, M));
  const sign = part('招牌', () => buildSign(ctx, M));
  part('仓库屋面设备', () => dressWarehouseRoof(ctx, M));
  part('办公楼屋面设备', () => dressOfficeRoof(ctx, M));
  const city = part('远景', () => buildCity(ctx, M));

  const lights = [
    // 招牌底下的投光灯往上打；建失败了也占着位置，亮度给 0
    sign?.light ?? { pos: [-4, 9.95, -19.5], aim: [-4, 12, -20.4], intensity: 0 },
    // 楼梯间门头灯：往外斜着打，正下方不在灯锥里（屋面板底下就是办公楼二层）
    { pos: [-23.8, 10.32, -44.5], aim: [-20.9, 8.1, -44.5], color: 0xdde8ff, intensity: 70, distance: 4.4, angle: 0.62, penumbra: 0.75, fog: 0.25 },
  ];

  const flick = M.signFlicker, beacon = M.beacon, base = flick.emissiveIntensity;
  const update = (dt, time) => {
    // K 的下撇接触不良：大部分时间亮着，偶尔连闪几下
    const off = Math.sin(time * 23.0) * Math.sin(time * 3.1) > 0.6 || Math.sin(time * 0.41) > 0.94;
    flick.emissiveIntensity = off ? base * 0.05 : base;
    // 航标灯：1.25 秒闪一下
    beacon.emissiveIntensity = (time * 0.8) % 1 < 0.16 ? 40 : 0.8;
    if (city) city.time.value = time;
  };
  return { lights, spawns: SPAWNS, paint: null, update };
}
