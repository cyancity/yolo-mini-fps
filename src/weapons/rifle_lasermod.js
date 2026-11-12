// 镭射指示器：夹在下层增高架前伸段上的小盒子。前脸一个出光口和一个小辅助窗，后脸一个橡胶开关，
// 左侧一小段线缆顺着护木左上斜面走到压力开关。盒顶比瞄具的视线低得多，开镜时只从上层增高架的镂空里露出来
import * as THREE from 'three';
import { rbox, cyl, lathe, cylBetween, xf } from '../gfx/geo.js';
import { crisp, screw, railClamp } from './rifle_kit.js';
import { markTop } from './rifle_marks.js';
import { OPTIC } from './rifle_optics.js';

const Y = OPTIC.ext, ZC = OPTIC.z - 0.0285, LEN = 0.0375;
const TOP = Y + 0.0165, FRONT = ZC - LEN / 2, BACK = ZC + LEN / 2;
// 出光口中心（整枪坐标）：光束从这里沿 -Z 射出，和枪管平行
export const LASER = [0.0062, Y + 0.0098, FRONT - 0.0032];

export function buildLaser(k) {
  railClamp(k, ZC, 0.03, [ZC], Y);
  k.metal(rbox(0.026, 0.0034, 0.034, 0.0008, 1), xf(0, Y + 0.0017, ZC));
  k.metal(rbox(0.029, TOP - Y - 0.003, LEN, 0.0022, 2), xf(0, (TOP + Y + 0.003) / 2, ZC));
  // 前脸的筒：车出来的一圈，里面是黑底
  const tube = (x, r, len) => {
    k.metal(crisp(lathe([[r * 0.76, 0], [r, 0], [r, len - 0.0008], [r * 0.92, len], [r * 0.76, len], [r * 0.76, 0.0004]], 20)),
      xf(x, LASER[1], FRONT + 0.001, -Math.PI / 2, 0, 0));
    k.black(cylBetween(x, LASER[1], FRONT + 0.001, x, LASER[1], FRONT - 0.0006, r * 0.78, 16));
  };
  // 出光口：筒里一片镜片，镜片后面是发射管的小孔
  tube(LASER[0], 0.0046, 0.0042);
  k.steel(cylBetween(LASER[0], LASER[1], FRONT - 0.0006, LASER[0], LASER[1], FRONT - 0.001, 0.0013, 10));
  k.lens(cyl(0.0035, 0.0035, 0.0005, 20), xf(LASER[0], LASER[1], FRONT - 0.0022, Math.PI / 2, 0, 0));
  tube(-0.0068, 0.003, 0.003);
  // 后脸的橡胶开关，开镜时从上层增高架的镂空里看得见
  k.rubber(rbox(0.0125, 0.0052, 0.0018, 0.0008, 1), xf(0.0015, TOP - 0.0048, BACK + 0.0006));
  // 顶上高低、左侧风偏两颗调节螺丝
  screw(k, 0.008, TOP - 0.0004, ZC + 0.009, 0.008, TOP + 0.0011, ZC + 0.009, 0.0028);
  screw(k, -0.0143, LASER[1], ZC + 0.004, -0.0156, LASER[1], ZC + 0.004, 0.0028);
  markTop(k, 'laser', 0.0058, -0.0032, TOP, ZC - 0.005);

  // 线缆从盒子左侧出来，绕过夹具落到护木左上斜面，压在一个线卡底下，接到压力开关的后端
  k.rubber(cylBetween(-0.0142, Y + 0.0055, ZC - 0.006, -0.0163, Y + 0.0046, ZC - 0.0078, 0.0021, 10));
  const wire = [[-0.0146, Y + 0.0055, ZC - 0.006], [-0.0178, Y + 0.0035, ZC - 0.0095], [-0.0186, 0.034, ZC - 0.0175], [-0.0165, 0.0255, ZC - 0.0255],
    [-0.012, 0.021, ZC - 0.0335], [-0.012, 0.021, ZC - 0.0475], [-0.0158, 0.0173, ZC - 0.0575]];
  for (let i = 0; i < wire.length - 1; i++) {
    k.rubber(cylBetween(...wire[i], ...wire[i + 1], 0.0013, 8));
    k.rubber(new THREE.SphereGeometry(0.0013, 8, 6), xf(...wire[i + 1]));
  }
  k.metal(rbox(0.0056, 0.0042, 0.005, 0.0008, 1), xf(-0.0122, 0.0212, ZC - 0.0405, 0, 0, Math.PI / 4));
  k.rubber(rbox(0.011, 0.0035, 0.03, 0.0012, 1), xf(-0.016, 0.0175, ZC - 0.0735, 0, 0, Math.PI / 4));
  k.rubber(rbox(0.007, 0.0014, 0.02, 0.0006, 1), xf(-0.0174, 0.0189, ZC - 0.0735, 0, 0, Math.PI / 4));
}
