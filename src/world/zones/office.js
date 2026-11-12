// 分区：办公楼（仓库西北，两层，屋面 8.1）。接口见 dev/README.md 的「分区模块」。
// 外壳和楼板在 office_shell，楼梯间在 office_stairs，一层在 office_ground，二层在 office_upper。
import { officeMats, ledTime } from './office_mats.js';
import { makeKit, L0, L2, SPOTS, CANOPY } from './office_layout.js';
import { buildShell } from './office_shell.js';
import { buildStairs } from './office_stairs.js';
import { buildGround } from './office_ground.js';
import { buildUpper } from './office_upper.js';
import { PANELS } from './office_ceiling.js';

export function build(ctx) {
  PANELS.length = 0;
  const M = officeMats(ctx.mats);
  const kit = makeKit(ctx);
  buildShell(ctx, M, kit);
  const stair = buildStairs(ctx, M, kit);
  const ground = buildGround(ctx, M, kit);
  const upper = buildUpper(ctx, M, kit);

  const lights = [
    // 楼梯间：屋面平台上往下打
    { pos: stair.light.pos, aim: stair.light.aim, color: 0xffe6c8, intensity: 160, distance: 10.5, angle: 0.5, penumbra: 0.8 },
    // 正门雨棚下的筒灯：雨里出一道光柱
    { pos: [CANOPY.lampX, CANOPY.y - 0.14, -40], aim: [CANOPY.lampX + 0.4, 0, -40], color: 0xffdcb0, intensity: 120, distance: 6, angle: 0.85, penumbra: 0.7, fog: 0.6 },
    // 室内的灯锥都开得很宽，兼当整片区域的补光；二层的灯 distance 收在 6，照不穿楼板到一层
    // 大堂中间那盏筒灯
    { pos: [SPOTS.lobby[0], 3.7, SPOTS.lobby[1]], aim: [4.8, L0, -40.4], color: 0xffe9cf, intensity: 70, distance: 7, angle: 1.25, penumbra: 0.95 },
    // 一层办公区：会闪的那块灯板下面
    { pos: [SPOTS.gWork[0], 3.72, SPOTS.gWork[1]], aim: [-6.6, L0, -42.0], color: 0xe8eeff, intensity: 70, distance: 7.5, angle: 1.3, penumbra: 0.95 },
    // 二层开放办公区中间；主管办公室（隔墙上有玻璃，光也漫到北边工位和东侧）
    { pos: [SPOTS.uOpen[0], 7.22, SPOTS.uOpen[1]], aim: [-14.0, L2, -41.2], color: 0xeef2ff, intensity: 60, distance: 6, angle: 1.3, penumbra: 0.95 },
    { pos: [SPOTS.uSup[0], 7.22, SPOTS.uSup[1]], aim: [-3.6, L2, -35.4], color: 0xffeedd, intensity: 55, distance: 6, angle: 1.3, penumbra: 0.95 },
  ];
  const spawns = [...ground.spawns, ...upper.spawns];
  const base = lights.map((l) => l.intensity);
  // 一层办公区那盏灯接触不良：大部分时间亮着，偶尔连闪几下
  const update = (dt, time, zl) => {
    ledTime.value = time;
    const flick = Math.sin(time * 31) * Math.sin(time * 4.7) > 0.86 || Math.sin(time * 0.43) > 0.993 ? 0.15 : 1;
    if (zl[3]) zl[3].intensity = base[3] * flick;
    M.panelBad.emissiveIntensity = 4.5 * flick;
  };
  return { lights, spawns, paint: null, update };
}
