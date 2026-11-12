// 步枪检视（~ 键）：先把枪口摆向右上、亮出右侧的瞄具和激光模块，再摆到左边看机匣左侧的刻字，最后放回腰射。
// 开火、开镜、换弹、扔烟雾弹、切枪都会打断，残留的姿态由 rig 的 Carry 淡掉
import { spline } from './rifle_reload.js';

// 姿态 = [x, y, z, 俯仰, 偏航, 滚转]（YXZ），叠在腰射姿态上：+偏航 枪口左摆，+滚转 从枪后看逆时针（右侧朝上）。
// 枪口往哪边摆，镜头看到的就是枪的另一侧
const P0 = [0, 0, 0, 0, 0, 0];
// 右侧：枪口往右上摆、右侧再往上翻一点，瞄具、增高座和激光模块的侧面、抛壳口朝着镜头
const RIGHT = [-0.06, -0.01, 0.03, 0.2, -0.6, 0.6];
// 左侧：枪口往左摆，机匣左侧的刻字正对镜头，左手还托着护木、前臂从左下出画面
const LEFT = [0.02, 0.04, 0.03, 0.15, 0.72, -0.2];
const nudge = (p, dx, dy, dz, rx, ry, rz) => [p[0] + dx, p[1] + dy, p[2] + dz, p[3] + rx, p[4] + ry, p[5] + rz];

export const INSPECT_T = 2.5;
// 检视的拟音：[秒, 音名, 音量]。起手和每次换边是衣料和手套的摩擦，摆到位停住（0.95、1.95 那两帧）时指节敲一下机匣
export const INSPECT_CUES = [[0.05, 'inspectCloth', 0.7], [0.95, 'inspectTap', 0.6], [1.02, 'inspectCloth', 0.6], [1.95, 'inspectTap', 0.5], [2.04, 'inspectCloth', 0.5]];
export const INSPECT_KEYS = [
  [0, P0],
  [0.42, RIGHT, 0.6],
  [0.95, nudge(RIGHT, 0.002, 0.004, 0, 0.02, 0.04, 0.05), 0.4],
  [1.38, LEFT, 0.6],
  [1.95, nudge(LEFT, 0.003, 0.005, 0, 0.03, -0.04, -0.05), 0.4],
  [INSPECT_T, P0],
];

export function inspectPose(t, out) {
  return spline(INSPECT_KEYS, t, out);
}
