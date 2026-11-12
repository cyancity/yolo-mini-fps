// 瞄具组的总布局，外加前后两个放倒的折叠机瞄。自下而上：机匣导轨 → 多用途下层增高架、镂空上层增高架
// （rifle_risers.js）→ 开放式红点（rifle_sight.js）；镭射在下层的前伸段上（rifle_lasermod.js）
import { box, rbox, cyl, cylBetween, xf } from '../gfx/geo.js';
import { screw, railClamp, RAIL_Y } from './rifle_kit.js';

// 开镜时眼睛到镜片的距离。按画面定的：镜片在这个距离上占画面高度的一成半，镜框以下是镜座和增高架的背面
export const EYE_RELIEF = 0.135;
// 布局（米）。z 是镜片朝射手的那一面：眼睛在它后面 EYE_RELIEF，落在机匣后端上方，
// 拉机柄、缓冲管、枪托不是在眼睛后面就是在正下方，开镜时进不了画面。各层高度是齿顶或顶面相对枪管轴线的高度
export const OPTIC = {
  z: -0.15,
  lo: RAIL_Y + 0.016, // 下层后平台的齿顶
  ext: RAIL_Y + 0.0085, // 下层前伸段的齿顶
  deck: RAIL_Y + 0.036, // 上层的顶面，镜座坐在这里
  base: 0.009, // 镜座前段的高度，它的顶面就是镜框的下槛
  glass: 0.021, // 镜片露在下槛以上的高度
  post: 0.0155, // 立柱高出下槛多少
  hw: 0.0144, // 镜片半宽：两边插在立柱里，磨边藏在立柱后面
  postX: 0.0132, // 立柱内侧到中线的距离。立柱只有 1.8 mm 厚，是一圈薄边
  edge: 0.0006, // 红点的活动范围比镜片轮廓往里收这么多（镜片顶上没有框，也没有磨边）
  axis: 0.0092, // 光轴高出下槛多少
};
// 红点的窗口。pos 是光轴穿过镜片后表面的那一点，其余都相对光轴：通光口的半宽、到上沿、到下槛、上角的圆角；
// 立柱内侧的距离和柱顶的高度（立柱之间和柱顶以上才透光）
export const SIGHT = {
  pos: [0, OPTIC.deck + OPTIC.base + OPTIC.axis, OPTIC.z],
  w: OPTIC.hw - OPTIC.edge, up: OPTIC.glass - OPTIC.axis - OPTIC.edge, down: OPTIC.axis, r: 0.004 - OPTIC.edge,
  postX: OPTIC.postX, postY: OPTIC.post - OPTIC.axis,
};

// 折叠机瞄：铰链在外端（dir = +1 朝后），瞄准臂向内放倒贴在座上
function buis(k, zc, dir, front) {
  const ya = RAIL_Y + 0.0092, zh = zc + dir * 0.0135, ze = zh - dir * 0.0295;
  railClamp(k, zc, 0.03, [zc]);
  k.metal(rbox(0.0235, 0.0065, 0.036, 0.0012, 1), xf(0, RAIL_Y + 0.00325, zc));
  k.metal(cylBetween(-0.012, ya, zh, 0.012, ya, zh, 0.0034, 12));
  k.steel(cylBetween(-0.0127, ya, zh, 0.0127, ya, zh, 0.0013, 8));
  k.metal(rbox(0.0165, 0.0052, 0.029, 0.0012, 1), xf(0, ya, zh - dir * 0.0155));
  screw(k, 0, ya + 0.0015, zh - dir * 0.011, 0, ya + 0.003, zh - dir * 0.011, 0.0017);
  if (front) {
    // 准星：两片护耳夹着一根准星柱
    for (const s of [-1, 1]) k.metal(rbox(0.003, 0.0058, 0.011, 0.0008, 1), xf(s * 0.0062, ya + 0.0003, ze + dir * 0.004));
    k.steel(cylBetween(0, ya + 0.0008, ze + dir * 0.008, 0, ya + 0.0008, ze - dir * 0.0015, 0.001, 8));
  } else {
    // 照门：觇孔环放倒后孔朝上；右侧风偏旋钮
    k.metal(cyl(0.0058, 0.0058, 0.0056, 16), xf(0, ya, ze));
    k.black(cyl(0.0023, 0.0023, 0.0062, 12), xf(0, ya, ze));
    k.metal(cylBetween(0.012, ya, zh, 0.0172, ya, zh, 0.0048, 14));
    k.black(box(0.0005, 0.0085, 0.0008), xf(0.01735, ya, zh));
  }
}

export function buildIrons(k) {
  buis(k, -0.024, 1, false);
  buis(k, -0.478, -1, true);
}
