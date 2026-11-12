// 握把和弹匣
import { box, rbox, lathe, xf } from '../gfx/geo.js';
import { ex, crisp, SIDE, loft, ring, screw } from './rifle_kit.js';

export const GRIP_WEB = [0, -0.047, 0.0315]; // 握把后上方，虎口顶住的位置
export const MAG_TOP = [0, -0.014, -0.1];
// 弹匣中心线：上段直 STRAIGHT，往下按半径 BEND 向前弯，全长 LEN
const STRAIGHT = 0.062, BEND = 0.34, LEN = 0.176;
// 左手捏弹匣的点：匣井下面露出那一段的中间，+Y 顺着弹匣朝上、+Z 朝后（弹匣的局部坐标，原点是匣口）
const HOLD_S = 0.105, HOLD_A = (HOLD_S - STRAIGHT) / BEND;
export const MAG_HOLD = {
  pos: [0, -STRAIGHT - BEND * Math.sin(HOLD_A), -BEND * (1 - Math.cos(HOLD_A))],
  rot: [HOLD_A, 0, 0],
};

const X = [1, 0, 0], Y = [0, 1, 0], Z = [0, 0, 1];

function grip(k) {
  // 水平截面逐层后移，中段掌心鼓起：[y, 截面中心 z, 前后半深, 左右半宽]
  const st = [[-0.04, 0.0115, 0.0185, 0.0122], [-0.052, 0.015, 0.0188, 0.013], [-0.075, 0.0217, 0.02, 0.014], [-0.1, 0.029, 0.0205, 0.0142],
    [-0.125, 0.0362, 0.02, 0.0138], [-0.138, 0.04, 0.0196, 0.0134]];
  k.poly(loft(st.map(([y, z, hd, hw]) => ring([0, y, z], X, Z, hw, hd, 3.2))));
  k.poly(rbox(0.029, 0.005, 0.042, 0.002, 1), xf(0, -0.1402, 0.0407));
  screw(k, 0, -0.1415, 0.0407, 0, -0.1431, 0.0407, 0.0035);
  // 虎口护翼：从握把顶往后上方收尖
  const tail = [[0.022, -0.0415, 0.0122, 0.0075], [0.03, -0.04, 0.0118, 0.007], [0.0352, -0.0375, 0.0095, 0.005], [0.0382, -0.0355, 0.006, 0.003]];
  k.poly(loft(tail.map(([z, y, hw, hh]) => ring([0, y, z], X, Y, hw, hh, 2.6))));
}

// 缓冲管和枪托在 rifle_stock.js，单独成组
export function buildFurniture(k) {
  grip(k);
}

// 弹匣：上段直、下段向前弯。侧视轮廓沿中心弧线生成
export function buildMag(k) {
  const [, top, zc] = MAG_TOP, hl = 0.0303, straight = STRAIGHT, R = BEND, len = LEN;
  // 弧线上距顶端 s 处、朝后偏 off 的点 [z, y]
  const at = (s, off) => {
    const a = Math.max(0, s - straight) / R;
    return [zc - R * (1 - Math.cos(a)) + Math.cos(a) * off, top - Math.min(s, straight) - R * Math.sin(a) - Math.sin(a) * off];
  };
  const band = (o0, o1, s0, s1, n = 12) => {
    const f = [], r = [];
    for (let i = 0; i <= n; i++) {
      const s = s0 + ((s1 - s0) * i) / n;
      f.push(at(s, o0));
      r.push(at(s, o1));
    }
    return f.concat(r.reverse());
  };
  k.poly(ex(band(-hl, hl, 0, len), 0.0226, 0.0018), SIDE());
  // 井口以下的三道纵筋，比匣体略宽
  for (const [o0, o1] of [[-0.0265, -0.0195], [-0.0035, 0.0035], [0.0195, 0.0265]]) k.poly(ex(band(o0, o1, 0.057, len - 0.012), 0.0242, 0.0008), SIDE());
  k.poly(ex(band(-hl - 0.0016, hl + 0.0016, len - 0.001, len + 0.0085, 2), 0.0262, 0.0015), SIDE());
  const [bz, by] = at(len + 0.0086, 0);
  k.black(box(0.008, 0.0006, 0.012), xf(0, by, bz, 0.36, 0, 0));
  // 托弹板、抱弹口，最上面一发弹高出匣口，枪机后坐时能从抛壳口看到
  k.black(rbox(0.017, 0.004, 0.052, 0.001, 1), xf(0, top - 0.0025, zc));
  for (const s of [-1, 1]) k.poly(rbox(0.0028, 0.0062, 0.04, 0.001, 1), xf(s * 0.0082, top + 0.0018, zc + 0.006, 0, 0, s * 0.35));
  const round = [[0, 0], [0.0042, 0], [0.0047, 0.0006], [0.0047, 0.0012], [0.0041, 0.0016], [0.0041, 0.0024], [0.0047, 0.003], [0.0047, 0.0365],
    [0.0032, 0.0405], [0.0032, 0.0448], [0.00285, 0.0448], [0.0027, 0.049], [0.0017, 0.0545], [0.0005, 0.0572], [0, 0.0573]];
  k.brass(crisp(lathe(round, 20)), xf(0.0018, top + 0.0045, zc + 0.0287, -Math.PI / 2, 0, 0));
}
