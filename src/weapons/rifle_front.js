// 前半截：枪管、导气装置、浮置护木、消焰器、垂直握把、前背带环
import * as THREE from 'three';
import { box, rbox, cyl, lathe, cylBetween, xf } from '../gfx/geo.js';
import { ex, crisp, FWD, arc, rect, slot, loft, ring, screw, rail, DECK_Y } from './rifle_kit.js';

export const MUZZLE_Z = -0.5755;
export const FOREGRIP = [0, -0.062, -0.36];

function barrel(k) {
  // 枪口端把膛口也车出来，里面塞一段黑柱当膛线深处
  k.steel(crisp(lathe([[0, 0.17], [0.0122, 0.17], [0.0122, 0.232], [0.0095, 0.246], [0.0095, 0.398], [0.0092, 0.43],
    [0.0092, 0.5335], [0.005, 0.5335], [0.003, 0.5318], [0.003, 0.522]], 24)), FWD);
  k.black(cylBetween(0, 0, -0.5, 0, 0, -0.5312, 0.00295, 12));
  k.metal(cylBetween(0, 0, -0.19, 0, 0, -0.214, 0.0168, 20)); // 枪管螺母
  // 导气箍和导气管
  k.metal(cylBetween(0, 0, -0.4, 0, 0, -0.428, 0.0128, 20));
  k.metal(rbox(0.0165, 0.0115, 0.028, 0.002, 1), xf(0, 0.0136, -0.414));
  k.steel(cylBetween(-0.0086, 0.0145, -0.4045, 0.0086, 0.0145, -0.4045, 0.001, 8));
  for (const z of [-0.4075, -0.4205]) screw(k, 0, -0.0124, z, 0, -0.0131, z, 0.0022);
  k.steel(cylBetween(0, 0.0145, -0.19, 0, 0.0145, -0.402, 0.0024, 10));
}

function muzzle(k) {
  k.steel(crisp(lathe([[0.0093, 0.5132], [0.0104, 0.5132], [0.0108, 0.5148], [0.0104, 0.5164], [0.0093, 0.5164]], 20)), FWD);
  k.metal(crisp(lathe([[0.0093, 0.5164], [0.0108, 0.5164], [0.0113, 0.5182], [0.0113, 0.5226], [0.01, 0.524], [0.01, 0.54],
    [0.0044, 0.54], [0.0044, 0.5338]], 24)), FWD);
  // 三叉消焰器：每根叉是一段扇环截面，叉与叉之间是真缝
  const prong = [...arc(0, 0, 0.01, -38, 38, 8), ...arc(0, 0, 0.0046, 38, -38, 6)];
  for (let i = 0; i < 3; i++) k.metal(ex(prong, 0.036, 0.0007), xf(0, 0, -0.5575, 0, 0, Math.PI / 2 + (i * Math.PI * 2) / 3));
}

const HG = { d0: 0.192, d1: 0.502, t: 0.0026, slant: 0.42 };
// 护木截面八边形 [x, y]：从枪后朝枪口看，自右下角起逆时针。下面按边的序号开孔：1、5 两侧，7 底面，3 顶面
const OCT = [[0.0085, -0.0235], [0.021, -0.011], [0.021, 0.01], [0.0085, DECK_Y], [-0.0085, DECK_Y], [-0.021, 0.01], [-0.021, -0.011], [-0.0085, -0.0235]];

function panelHoles(i, dMax) {
  const out = [];
  const fill = (c0, pitch, hl, shape) => { for (let c = c0; c + hl + 0.006 < dMax; c += pitch) out.push(shape(c)); };
  if (i === 1 || i === 5 || i === 7) fill(0.258, 0.04, 0.016, (c) => rect(c, 0, 0.016, 0.0035, 0.0012)); // 两侧和底面：附件槽
  else if (i === 2 || i === 4) fill(0.24, 0.04, 0.0155, (c) => slot(c, 0, 0.0155, 0.0032)); // 斜上：散热长孔
  else if (i !== 3) fill(0.245, 0.026, 0.008, (c) => slot(c, 0, 0.008, 0.0026)); // 斜下：减重孔；顶面压在导轨下不开孔
  return out;
}

// 八块带孔的板围成护木，孔是真的，能看见里面的枪管和导气管。前端斜切，越靠下越短
function handguard(k) {
  for (let i = 0; i < 8; i++) {
    const [ax, ay] = OCT[i], [bx, by] = OCT[(i + 1) % 8];
    const w = Math.hypot(bx - ax, by - ay), tx = (bx - ax) / w, ty = (by - ay) / w, nx = ty, ny = -tx;
    const fa = HG.d1 - HG.slant * (DECK_Y - ay), fb = HG.d1 - HG.slant * (DECK_Y - by);
    const outline = [[HG.d0, -w / 2], [fa, -w / 2], [fb, w / 2], [HG.d0, w / 2]];
    // 板的局部坐标：x 向前，y 沿截面边，z 朝外
    const m = new THREE.Matrix4().makeBasis(new THREE.Vector3(0, 0, -1), new THREE.Vector3(tx, ty, 0), new THREE.Vector3(nx, ny, 0))
      .setPosition((ax + bx) / 2 - (nx * HG.t) / 2, (ay + by) / 2 - (ny * HG.t) / 2, 0);
    k.metal(ex(outline, HG.t, 0.0005, panelHoles(i, Math.min(fa, fb))), m);
  }
  rail(k, -0.1955, 31);
  // 后段夹紧螺丝：两侧各两颗，斜上面各两颗
  for (const s of [-1, 1]) {
    for (const z of [-0.2, -0.212]) screw(k, s * 0.0208, -0.004, z, s * 0.0222, -0.004, z, 0.0026);
    for (const z of [-0.203, -0.219]) screw(k, s * 0.014, 0.0155, z, s * 0.0152, 0.0167, z, 0.0022);
  }
  // 左侧背带环座和挂环
  k.metal(rbox(0.004, 0.0125, 0.03, 0.0015, 1), xf(-0.0228, -0.0005, -0.298));
  for (const z of [-0.2875, -0.3085]) screw(k, -0.0246, -0.0005, z, -0.0252, -0.0005, z, 0.002);
  k.steel(cylBetween(-0.0245, -0.0005, -0.298, -0.0288, -0.0005, -0.298, 0.0036, 12));
  k.steel(new THREE.TorusGeometry(0.0085, 0.0013, 8, 24), xf(-0.0282, -0.0088, -0.298, 0.14, Math.PI / 2, 0));
}

function foregrip(k) {
  const [, , z] = FOREGRIP;
  k.metal(rbox(0.021, 0.0065, 0.052, 0.002, 1), xf(0, -0.0265, z));
  const st = [[-0.0285, 0.0115, 0.0138], [-0.0335, 0.0128, 0.0152]];
  for (let i = 0; i <= 12; i++) st.push([-0.0375 - i * 0.004, 0.0128 + (i % 2) * 0.0007, 0.0152 + (i % 2) * 0.0007]); // 一圈圈防滑棱
  st.push([-0.0895, 0.0128, 0.0152], [-0.0925, 0.0112, 0.0136]);
  k.poly(loft(st.map(([y, hx, hz]) => ring([0, y, z], [1, 0, 0], [0, 0, 1], hx, hz, 2.8))));
  k.metal(cyl(0.0085, 0.0085, 0.0016, 20), xf(0, -0.0931, z));
  k.black(box(0.011, 0.0005, 0.0014), xf(0, -0.094, z));
}

export function buildFront(k) {
  barrel(k);
  muzzle(k);
  handguard(k);
  foregrip(k);
}
