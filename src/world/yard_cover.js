import { addContainer } from './containers.js';
import { mulberry32 } from './labels.js';
import * as P from './props.js';

// 堆场里补的掩体：卸在地上等提走的箱子、靠围栏码着的货、堆位里卸到一半的货、行车道两边临时堆的托盘。
// 让开练习场从出生点 (-9, 16) 到各个靶子的视线（target_layout.js 的 auditLayout 核对）、敌人出生点、
// 月台前的禁停斜纹带（z -17..-14.4）和地面喷字（「零号泊位」「5」「慢」）。
// 矮的 1.08 米左右（比蹲姿眼高 1.02 高，蹲下连头都能藏住，原地跳得上去），高的 1.8 米以上，不做中间那一档。
// 高件顶上都罩了 noPerch：矮件紧挨着高件，从矮件上跳得上 1.8 米的顶，不罩的话就成了蹲点和翻围栏的台阶。
// 自己的随机数：加减这里的东西不会让堆场其余摆件和远景跟着变。都用省三角形的简版（props.js 的 lean）。

// 两层木箱（1.83 米）
function crateStack(ctx, x, z, yaw) {
  P.crate(ctx, { x, z, yaw, w: 1.2, h: 1.0, d: 0.9, lean: true });
  P.crate(ctx, { x: x + 0.03, y: 1.02, z: z - 0.02, yaw: yaw - 0.08, w: 1.0, h: 0.8, d: 0.8, lean: true });
  P.noPerch(ctx, { x: x + 0.03, z: z - 0.02, yaw: yaw - 0.08, hw: 0.522, hd: 0.422, top: 1.831 });
}
// 齐腰高的单只木箱（碰撞顶 1.081 米）
const lowCrate = (ctx, x, z, yaw) => P.crate(ctx, { x, z, yaw, w: 1.0, h: 1.07, d: 0.9, lean: true });
// 托盘垛：5 层托盘上压一托盖布的薄货（1.084 米）
const lowPallets = (ctx, x, z, yaw) => P.palletStack(ctx, { x, z, yaw, n: 5, load: 0.22, lean: true });
// 盖布货（1.84 米）
function tallTarp(ctx, x, z, yaw, w = 1.8, d = 1.2) {
  P.tarpCargo(ctx, { x, z, yaw, w, h: 1.7, d, lean: true });
  P.noPerch(ctx, { x, z, yaw, hw: w / 2, hd: d / 2, top: 1.844 });
}

export function buildYardCover(ctx0) {
  const ctx = { ...ctx0, rand: mulberry32(4471) };
  // 出生点西边：一个 20 尺箱卸在地上等拖车，离出生点 4 米多，开局就有能整个躲进去的地方
  addContainer(ctx, { x: -16.4, z: 15.6, yaw: 0.06, color: 0x1f5e56, seed: 41, line: 3, lean: true });
  // 出生点身后靠围栏：一垛盖布货（高）和一垛托盘（矮）
  tallTarp(ctx, -8.0, 19.55, 0.05);
  lowPallets(ctx, -9.6, 19.75, -0.08);
  // 出生点东北 5 米：两层木箱加一只单箱，摆在练习场两束靶子视线之间的空当里
  crateStack(ctx, -6.8, 11.5, -0.46);
  lowCrate(ctx, -5.55, 10.7, -0.3);
  // 大门东边、滑轨尽头外，和靠里一点的一组：两层木箱和单箱
  crateStack(ctx, 9.7, 19.7, 0.04);
  lowCrate(ctx, 10.95, 19.75, 0.12);
  // 这一组让开南边 z 17.6 的黄色边线
  crateStack(ctx, 6.5, 16.8, 0.1);
  lowCrate(ctx, 7.68, 16.92, -0.05);
  // 西侧中段：散货（高）加一垛托盘（矮）；再往北一点又一垛散货
  tallTarp(ctx, -19.8, 5.2, 0.3);
  lowPallets(ctx, -18.3, 4.4, 0.2);
  tallTarp(ctx, -17.8, 11.1, 0.25);
  // 行车道东段：北半边两层木箱加单箱，南半边贴着水泥墩一垛盖布货，两处错开，车道中线和「慢」字都不压
  crateStack(ctx, 17.0, -1.0, 0.1);
  lowCrate(ctx, 18.28, -1.25, 0.3);
  tallTarp(ctx, 20.9, 1.8, 0.04);
  // A3 堆位里卸到一半的货：靠东一垛盖布货，西边一垛托盘（西边那半不能高，练习场看月台的视线从这里过）
  tallTarp(ctx, 0.2, -6.2, -0.04, 1.9, 1.3);
  lowPallets(ctx, -1.6, -5.6, 0.15);
  // 东门内侧：一垛盖布货加托盘
  tallTarp(ctx, 16.0, 4.5, 0.2);
  lowPallets(ctx, 17.65, 5.05, -0.1);
  // 桶堆北边：两层木箱加托盘
  crateStack(ctx, 17.75, -10.25, -0.3);
  lowPallets(ctx, 19.3, -10.6, 0.1);
  // 北边那条东西向的长条空地：「零号泊位」东边贴着木箱码一垛盖布货
  tallTarp(ctx, 3.0, -13.5, 0.06);
}
