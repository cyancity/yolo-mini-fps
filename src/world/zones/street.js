import { mulberry32 } from '../labels.js';
import { streetMats } from './street_mats.js';
import { Glow } from './street_glow.js';
import { buildWalls } from './street_walls.js';
import { buildStreetBase } from './street_furniture.js';
import { buildFacades } from './street_facades.js';
import { buildStreetLayout, STREET_SPAWNS } from './street_layout.js';
import { buildCourt, COURT_SPAWNS } from './street_court.js';
import { paintStreet } from './street_paint.js';
import { dressWalls } from './street_dress.js';

// 分区：街道（场地东侧，南北向）和仓库背后的卸货场。接口见 dev/README.md 的「分区模块」。
// street_mats 材质，street_glow 自发光画布，street_walls 围墙和大门，street_furniture 人行道、电杆和架空线，
// street_facades / street_shops 对面一排门面，street_layout 街上的车和掩体，street_court 卸货场，street_dress 墙面细节，street_paint 地面标线。

const SODIUM = 0xffa04a, LED = 0xd2e2ff;
const SODIUM_I = 650, LED_I = 600;

// 合批前先挡一道：材质缺了就跳过那块几何体并报警，免得整个分区的合批在 level.js 里炸掉
function guarded(batch) {
  return {
    add(mat, geo, m, o) {
      if (!mat) { console.warn('[street] 缺材质，跳过一块几何体'); return this; }
      batch.add(mat, geo, m, o);
      return this;
    },
  };
}

export function build(ctx0) {
  // 自己的随机数：别的分区改动不会让这里的摆放跟着变
  const ctx = { ...ctx0, batch: guarded(ctx0.batch), decals: guarded(ctx0.decals), rand: mulberry32(7301) };
  const S = streetMats(ctx.mats);
  const glow = new Glow(ctx.rand);
  buildWalls(ctx, S, glow);
  dressWalls(ctx, S);
  const lamps = buildStreetBase(ctx, S);
  buildFacades(ctx, S, glow);
  buildStreetLayout(ctx, S, glow);
  buildCourt(ctx, S);
  glow.finish([S.neon, S.flicker, S.blink]);

  // 三盏钠灯挂在电杆挑臂上，一盏冷白投光灯在卸货场北墙正中
  const lights = lamps.map((p) => ({
    pos: [p.x, p.y, p.z], aim: [p.x - 0.6, 0, p.z], color: SODIUM, intensity: SODIUM_I, distance: 11, angle: 0.95, penumbra: 0.7, fog: 0.5,
  }));
  lights.push({ pos: [19.3, 4.05, -47.25], aim: [19.3, 0, -39.0], color: LED, intensity: LED_I, distance: 14, angle: 1.0, penumbra: 0.6, fog: 0.5 });

  // 闪烁：足疗竖招牌的灯管接触不良，路障黄闪灯一秒一闪，中间那盏钠灯偶尔跳一下
  const glowBase = S.neon.emissiveIntensity;
  const update = (dt, t, ls) => {
    const buzz = Math.sin(t * 31) * Math.sin(t * 4.7) > 0.7 || Math.sin(t * 0.43) > 0.97;
    S.flicker.emissiveIntensity = buzz ? glowBase * 0.15 : glowBase;
    S.blink.emissiveIntensity = (t * 1.1) % 1 < 0.45 ? glowBase * 1.4 : glowBase * 0.04;
    if (ls[1]) ls[1].intensity = Math.sin(t * 23) * Math.sin(t * 0.9) > 0.93 ? SODIUM_I * 0.55 : SODIUM_I;
  };
  return { lights, spawns: [...STREET_SPAWNS, ...COURT_SPAWNS], paint: paintStreet, update };
}
