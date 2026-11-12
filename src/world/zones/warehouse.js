import { buildWarehouse } from '../warehouse.js';
import { whMats, swatches, rng } from './warehouse_kit.js';
import { buildShell } from './warehouse_shell.js';
import { buildFloor } from './warehouse_floor.js';
import { buildRacks } from './warehouse_racks.js';
import { buildServices, lampLights } from './warehouse_services.js';
import { buildLayout, SPAWNS } from './warehouse_layout.js';

// 分区：仓库。外立面（../warehouse.js）、壳（墙、柱、屋架）、地面（月台、车辆区、楼梯、坡道）、货架、机电、库内摆放。
// 接口见 dev/README.md 的「分区模块」。
const FLICKER = 3; // lights 里会闪的那盏：月台雨棚 3 盏之后的第一盏高天棚灯（货架区）

export function build(ctx) {
  const { lamps } = buildWarehouse(ctx);
  const k = whMats(ctx.mats), sw = swatches(ctx, rng(907));
  const c = { ...ctx, sw };
  buildShell(c, k);
  buildFloor(c, k, sw);
  buildRacks(c, k);
  buildServices(c, k);
  buildLayout(c, k, sw);
  // 月台雨棚下的三盏灯 + 库内四盏高天棚灯。雨棚灯离墙 1.9 米、不投影：光锥朝外倾约 34°、半角 0.85，
  // 后沿接近竖直，照不进关着的卷帘门里面
  const lights = lamps.map((p) => ({
    pos: [p.x, p.y, p.z], aim: [p.x, 0, p.z + 4], color: 0xffe0b0, intensity: 520, distance: 15, angle: 0.85, penumbra: 0.85, fog: 0.7,
  }));
  lights.push(...lampLights());
  const base = lights[FLICKER].intensity, glow = k.lampFlicker.emissiveIntensity;
  // 镇流器快坏了的那盏：大部分时间正常，隔一阵抖几下、偶尔整段暗掉
  const update = (dt, t, L) => {
    const l = L[FLICKER];
    if (!l) return;
    const burst = Math.sin(t * 0.73) * Math.sin(t * 0.31 + 1.7) > 0.55;
    const f = burst ? (Math.sin(t * 41) * Math.sin(t * 17.3) > 0.1 ? 0.12 : 0.85) : 1;
    l.intensity = base * f;
    k.lampFlicker.emissiveIntensity = glow * f;
  };
  return { lights, spawns: SPAWNS.map((p) => ({ ...p })), paint: null, update };
}
