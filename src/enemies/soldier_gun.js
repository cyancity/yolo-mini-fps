import * as THREE from 'three';
import { xf, rbox, box, cyl, extrude } from '../gfx/geo.js';
import { B, WEAPON_BIND } from './soldier_skeleton.js';

// 小圆角盒只用一段圆角：三角形省到三分之一
const rb = (w, h, d, r) => rbox(w, h, d, r, 1);

// 敌人用的短突击步枪（原创外形，不对应任何真实型号）。
// 枪的本地坐标：枪管沿 -Z，+Y 向上，+X 是枪的右侧，原点在枪管轴线上、机匣后端。
export const GUN = {
  muzzle: [0, 0, -0.627],
  butt: [0, -0.028, 0.278],      // 托底板中心：抵在肩窝
  sight: 0.07,                   // 瞄准线比枪管轴线高多少
  gripR: [0, -0.085, -0.015],    // 握把上右手虎口内的握持中心
  gripRAxis: [0, -0.963, 0.268], // 握把轴线（向下）
  gripL: [0, -0.07, -0.332],     // 前握把：靠后一点，左手不用把胳膊伸直
  gripLAxis: [0, -0.985, -0.17],
  frontMount: [-0.026, -0.004, -0.43],
  rearMount: [-0.021, 0.002, 0.2],
  halfWidth: 0.026,              // 侧躺在地上时枪管轴线离地的高度（左侧朝下）
  halfWidthR: 0.046,             // 右侧朝下时（垫在战术灯上）
};

const zCyl = (r0, r1, len, seg = 12) => cyl(r0, r1, len, seg).rotateX(Math.PI / 2);
// 侧视轮廓 [前移, 高] 拉成宽 w 的板（轮廓在 YZ 平面，前移为 -Z）
const side = (pts, w, bevel = 0.003) => extrude(pts, w, bevel).rotateY(Math.PI / 2);

const COL = {
  receiver: [0x2b2d2f, 0.42, 0.65, 0.35],
  polymer: [0x141516, 0.62, 0, 1],
  guard: [0x3b3e35, 0.5, 0.3, 0.45],
  steel: [0x18191a, 0.38, 0.85, 0.2],
  lens: [0x0a1014, 0.06, 0.2, 0],
  light: [0x8c949c, 0.15, 0.9, 0],
};

// 枪身全部挂在枪骨上（硬表面材质）
export function buildGun(sb) {
  const at = new THREE.Matrix4().makeTranslation(...WEAPON_BIND);
  const put = (col, geo, m, tile = 0.08) => {
    const c = COL[col];
    sb.paint(c[0], c[1], c[2], 0, c[3]);
    sb.rigid('hard', geo, at.clone().multiply(m), B.weapon, tile);
  };
  // 上下机匣、导轨、拉机柄、抛壳窗
  put('receiver', rb(0.036, 0.05, 0.2, 0.005), xf(0, 0.004, -0.1));
  put('receiver', box(0.022, 0.009, 0.2), xf(0, 0.0335, -0.1));
  for (let i = 0; i < 9; i++) put('steel', box(0.024, 0.003, 0.004), xf(0, 0.0395, -0.012 - i * 0.022));
  put('receiver', box(0.03, 0.008, 0.02), xf(0, 0.026, 0.009));
  put('steel', box(0.003, 0.017, 0.056), xf(0.0185, 0.002, -0.085));
  put('steel', cyl(0.006, 0.006, 0.014, 8), xf(0.02, 0.012, -0.02, 0, 0, Math.PI / 2));
  put('receiver', rb(0.034, 0.04, 0.16, 0.004), xf(0, -0.04, -0.085));
  put('receiver', rb(0.037, 0.05, 0.076, 0.004), xf(0, -0.07, -0.135));
  // 弹匣：弧形，底板略宽
  put('polymer', side([[0.165, -0.05], [0.105, -0.05], [0.11, -0.14], [0.128, -0.215], [0.148, -0.258],
    [0.214, -0.248], [0.19, -0.17], [0.176, -0.1]], 0.025, 0.004), xf());
  put('polymer', rb(0.031, 0.012, 0.072, 0.004), xf(0, -0.258, -0.182, -0.15, 0, 0));
  // 握把、扳机护圈、扳机
  put('polymer', side([[0.046, -0.038], [0.012, -0.038], [-0.012, -0.1], [-0.022, -0.152], [0.012, -0.158],
    [0.032, -0.1], [0.042, -0.06]], 0.03, 0.006), xf());
  put('receiver', box(0.007, 0.005, 0.056), xf(0, -0.088, -0.072));
  put('steel', box(0.004, 0.022, 0.006), xf(0, -0.07, -0.062, 0.25, 0, 0));
  // 缓冲管、伸缩枪托、托底板
  put('receiver', zCyl(0.0155, 0.0155, 0.21, 12), xf(0, 0, 0.105));
  put('polymer', side([[-0.075, 0.026], [-0.25, 0.032], [-0.27, 0.03], [-0.27, -0.09], [-0.245, -0.094],
    [-0.15, -0.032], [-0.075, -0.02]], 0.042, 0.006), xf());
  put('polymer', rb(0.045, 0.128, 0.014, 0.005), xf(0, -0.03, 0.272));
  // 护木：八角管 + 顶部导轨 + 两侧的长孔（深色块）
  put('guard', zCyl(0.025, 0.025, 0.26, 8), xf(0, -0.002, -0.33, 0, 0, Math.PI / 8));
  put('guard', box(0.022, 0.009, 0.26), xf(0, 0.0315, -0.33));
  for (let i = 0; i < 9; i++) put('steel', box(0.024, 0.003, 0.004), xf(0, 0.0375, -0.215 - i * 0.028));
  for (const s of [-1, 1]) for (let i = 0; i < 3; i++) put('steel', box(0.002, 0.008, 0.032), xf(s * 0.0232, -0.01, -0.25 - i * 0.065));
  put('steel', zCyl(0.021, 0.021, 0.014, 14), xf(0, -0.002, -0.198));
  // 枪管、制退器
  put('steel', zCyl(0.0095, 0.0095, 0.12, 10), xf(0, 0, -0.515));
  put('steel', zCyl(0.0128, 0.0128, 0.056, 12), xf(0, 0, -0.599));
  for (let i = 0; i < 3; i++) {
    const a = (i / 3) * Math.PI * 2;
    put('lens', box(0.003, 0.0036, 0.03), xf(Math.cos(a) * 0.0122, Math.sin(a) * 0.0122, -0.61, 0, 0, a));
  }
  // 封闭式红点镜和折叠的机械瞄具
  put('receiver', rb(0.03, 0.012, 0.052, 0.003), xf(0, 0.043, -0.11));
  put('receiver', rb(0.038, 0.042, 0.064, 0.009), xf(0, GUN.sight, -0.11));
  put('lens', zCyl(0.014, 0.014, 0.066, 14), xf(0, GUN.sight + 0.002, -0.11));
  put('receiver', box(0.02, 0.01, 0.024), xf(0, 0.043, -0.02));
  put('receiver', box(0.016, 0.01, 0.02), xf(0, 0.041, -0.44));
  // 前握把、战术灯、背带扣
  const g = new THREE.Vector3(...GUN.gripLAxis);
  const fq = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, -1, 0), g);
  const fm = new THREE.Matrix4().compose(new THREE.Vector3(0, -0.062, GUN.gripL[2] + 0.004), fq, new THREE.Vector3(1, 1, 1));
  put('polymer', cyl(0.0145, 0.0155, 0.085, 12), fm);
  put('polymer', cyl(0.017, 0.017, 0.008, 12), fm.clone().multiply(xf(0, -0.044, 0)));
  put('polymer', rb(0.014, 0.018, 0.03, 0.003), xf(0.024, -0.004, -0.4));
  put('receiver', zCyl(0.0135, 0.0135, 0.085, 12), xf(0.034, -0.004, -0.41));
  put('light', zCyl(0.0118, 0.0118, 0.004, 12), xf(0.034, -0.004, -0.454));
  for (const p of [GUN.frontMount, GUN.rearMount]) put('steel', rb(0.008, 0.016, 0.016, 0.003), xf(...p));
}
