import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { xf, box, rbox, cyl, cylBetween, extrude, lathe, Batch, canvasTexture } from '../gfx/geo.js';
import { withWet } from '../gfx/materials.js';

// 武装四旋翼「VX-9」。单位米，机头朝 -Z，+Y 向上，原点在机身中心。
// 几何体只建一次（按 Materials 实例缓存），每架无人机只是新建网格引用同一份几何。每架 16 个网格。

const MOTORS = [[-0.275, -0.26], [0.275, -0.26], [0.275, 0.26], [-0.275, 0.26]]; // 左前、右前、右后、左后
const ARM_ROOT = [0.075, 0.105], ARM_Y = 0.012;
const PROP_Y = 0.078, PROP_R = 0.178, SKID_Y = -0.24;
const GIMBAL = [0, -0.074, -0.03], PITCH_Y = -0.078;
const MUZZLE = [0, -0.048, -0.216], LAMP = [0.026, 0.006, -0.08];
export const DRONE_RADIUS = 0.5;
// 敌方的识别色：发光的橙红灯带（值超过 1 交给泛光），白天夜里、亮背景暗背景前都认得出
const HOSTILE = [5.5, 1.25, 0.3];

const HULL = [[0.25, 0], [0.205, 0.038], [0.11, 0.058], [-0.13, 0.058], [-0.185, 0.035], [-0.2, 0],
  [-0.18, -0.032], [-0.12, -0.05], [0.13, -0.05], [0.21, -0.03]];

const zCyl = (r0, r1, len, seg = 16) => cyl(r0, r1, len, seg).rotateX(Math.PI / 2); // 轴线沿 Z，r0 在 +Z 端
const xCyl = (r, len, seg = 12) => cyl(r, r, len, seg).rotateZ(Math.PI / 2);
const ball = (r, w = 10, h = 8) => new THREE.SphereGeometry(r, w, h);

// 桨叶从根到尖放样：弦长先宽后窄，迎角从根部 0.5 rad 扭到尖部 0.12 rad。沿 +X 伸出，前缘在 -Z 一侧。
function bladeGeo() {
  const N = 10, pos = [], idx = [];
  for (let i = 0; i <= N; i++) {
    const u = i / N, x = 0.012 + u * (PROP_R - 0.012);
    const c = u < 0.3 ? 0.014 + 0.017 * Math.sin((u / 0.3) * Math.PI / 2) : 0.031 - 0.021 * ((u - 0.3) / 0.7) ** 1.7;
    const th = Math.max(0.0014, c * 0.13), b = 0.5 - 0.38 * u ** 0.7, cb = Math.cos(b), sb = Math.sin(b);
    for (const [s, n] of [[-0.3 * c, 0], [0, th * 0.6], [0.7 * c, 0], [0, -th * 0.4]]) pos.push(x, -s * sb + n * cb, s * cb + n * sb);
    for (let k = 0; k < 4 && i < N; k++) {
      const a = i * 4 + k, b2 = i * 4 + ((k + 1) % 4);
      idx.push(a, b2, b2 + 4, a, b2 + 4, a + 4);
    }
  }
  idx.push(N * 4, N * 4 + 1, N * 4 + 2, N * 4, N * 4 + 2, N * 4 + 3);
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

// 带顶点色的小灯：红、绿、白几种航行灯合进一个网格，值超过 1 交给泛光
function lightBits(list) {
  return mergeGeometries(list.map(([geo, matrix, rgb]) => {
    const g = geo.toNonIndexed().applyMatrix4(matrix);
    const col = new Float32Array(g.attributes.position.count * 3);
    for (let i = 0; i < col.length; i += 3) col.set(rgb, i);
    return g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  }), false);
}

// 2x2 斜纹碳纤维：每格一束纱，中间亮两边暗
function carbonTexture() {
  const t = canvasTexture(128, 128, (c) => {
    c.fillStyle = '#08090a';
    c.fillRect(0, 0, 128, 128);
    for (let j = 0; j < 4; j++) {
      for (let i = 0; i < 4; i++) {
        const warp = (i + j) % 4 < 2, x = i * 32, y = j * 32;
        const g = warp ? c.createLinearGradient(x, 0, x + 32, 0) : c.createLinearGradient(0, y, 0, y + 32);
        g.addColorStop(0, '#0e0f10');
        g.addColorStop(0.5, warp ? '#3c3f44' : '#232528');
        g.addColorStop(1, '#0e0f10');
        c.fillStyle = g;
        c.fillRect(x + 1, y + 1, 30, 30);
      }
    }
  });
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  return t;
}

const FONT = '"Bahnschrift", "DIN Alternate", "Arial Narrow", sans-serif';
// 标识图集（512x512）里各块的像素矩形
const RECT = {
  mark: [0, 0, 340, 256], battery: [352, 8, 504, 248], danger: [4, 272, 254, 372], plate: [262, 272, 508, 372],
  num: [0, 392, 160, 504], lens: [176, 392, 288, 504],
};
function markingTexture() {
  return canvasTexture(512, 512, (c) => {
    c.clearRect(0, 0, 512, 512);
    const text = (str, x, y, size, color, weight = 700, max = undefined) => {
      c.fillStyle = color;
      c.font = `${weight} ${size}px ${FONT}`;
      c.fillText(str, x, y, max);
    };
    text('VX-9', 8, 112, 120, '#d9d6cc', 700, 330);
    text('UNIT 07 · NO STEP', 10, 156, 34, '#d9d6cc', 600, 330);
    c.fillStyle = '#c8a21c';
    for (let i = 0; i < 9; i++) {
      c.beginPath();
      c.moveTo(10 + i * 36, 236); c.lineTo(28 + i * 36, 236); c.lineTo(46 + i * 36, 190); c.lineTo(28 + i * 36, 190);
      c.fill();
    }
    c.fillRect(352, 8, 152, 240);
    text('6S', 364, 60, 44, '#141414');
    text('22000 mAh', 364, 98, 26, '#141414', 600, 130);
    text('22.2 V', 364, 132, 26, '#141414', 600);
    c.beginPath(); c.moveTo(428, 150); c.lineTo(486, 236); c.lineTo(370, 236); c.fill();
    c.fillStyle = '#c8a21c';
    c.fillRect(423, 178, 10, 34); c.fillRect(423, 218, 10, 9);
    c.fillStyle = '#a01d14';
    c.fillRect(4, 272, 250, 100);
    text('DANGER', 16, 328, 58, '#f2efe6', 700, 226);
    text('ROTOR ARC · KEEP CLEAR', 16, 360, 22, '#f2efe6', 600, 226);
    c.strokeStyle = '#d9d6cc';
    c.lineWidth = 3;
    c.strokeRect(264, 274, 242, 96);
    text('VX-9 UAS   S/N 0731-07', 274, 302, 22, '#d9d6cc', 600, 222);
    text('MTOW 9.6 KG   6S 22.2 V', 274, 332, 22, '#d9d6cc', 600, 222);
    text('ARMED · DO NOT APPROACH', 274, 362, 22, '#c8a21c', 600, 222);
    text('07', 6, 496, 124, '#d9d6cc', 700, 150);
    // 机鼻镜头：深色镀膜加两道反光弧
    const lens = c.createRadialGradient(232, 448, 4, 232, 448, 55);
    [[0, '#05060a'], [0.45, '#0b1230'], [0.7, '#1c1033'], [0.92, '#04050a'], [1, '#000']].forEach(([k, col]) => lens.addColorStop(k, col));
    c.fillStyle = lens;
    c.beginPath(); c.arc(232, 448, 55, 0, 7); c.fill();
    c.lineCap = 'round';
    for (const [r, a0, a1, w, col] of [[38, 3.6, 4.6, 5, 'rgba(150,190,255,0.55)'], [22, 0.5, 1.4, 3, 'rgba(190,150,255,0.4)']]) {
      c.strokeStyle = col;
      c.lineWidth = w;
      c.beginPath(); c.arc(232, 448, r, a0, a1); c.stroke();
    }
  });
}

function decalQuad(w, h, [x0, y0, x1, y1], matrix) {
  const g = new THREE.PlaneGeometry(w, h), uv = g.attributes.uv;
  for (let i = 0; i < uv.count; i++) uv.setXY(i, (x0 + uv.getX(i) * (x1 - x0)) / 512, 1 - (y1 - uv.getY(i) * (y1 - y0)) / 512);
  return g.applyMatrix4(matrix);
}

function discTexture() {
  return canvasTexture(128, 128, (c) => {
    const g = c.createRadialGradient(64, 64, 4, 64, 64, 64);
    g.addColorStop(0, 'rgba(255,255,255,0)');
    g.addColorStop(0.16, 'rgba(255,255,255,0.75)');
    g.addColorStop(0.55, 'rgba(255,255,255,0.42)');
    g.addColorStop(0.9, 'rgba(255,255,255,0.3)');
    g.addColorStop(1, 'rgba(255,255,255,0)');
    c.fillStyle = g;
    c.fillRect(0, 0, 128, 128);
  }, { srgb: false });
}

function buildBody(mats, paint, carbon, accent) {
  const b = new Batch(), lights = [], decals = [];
  const steel = mats.steelDark, black = mats.plasticBlack;
  const P = { tile: 0.8 }, G = { tile: 0.5 }, K = { tile: 0.03 }, C = { tile: 0.014 };
  // 机身：侧面轮廓拉伸成体，再加顶甲、侧甲、机鼻传感器头
  b.add(paint, extrude(HULL, 0.165, 0.012), xf(0, 0, 0, 0, Math.PI / 2, 0), P);
  b.add(accent, rbox(0.125, 0.012, 0.21, 0.004), xf(0, 0.074, -0.01), P);
  b.add(paint, rbox(0.1, 0.048, 0.05, 0.01), xf(0, -0.004, -0.268), P);
  for (const [x, z] of [[-0.052, -0.1], [0.052, -0.1], [-0.052, 0.08], [0.052, 0.08]]) b.add(steel, cyl(0.0035, 0.0035, 0.003, 8), xf(x, 0.081, z), G);
  // 机鼻斜面上的传感器窗
  const win = xf(0, 0.0615, -0.1575, -0.2075, 0, 0);
  b.add(black, box(0.1, 0.003, 0.075), win, K);
  for (const [x, z] of [[-0.044, -0.031], [0.044, -0.031], [-0.044, 0.031], [0.044, 0.031]]) b.add(steel, cyl(0.003, 0.003, 0.003, 8), win.clone().multiply(xf(x, 0.002, z)), G);
  for (const s of [-1, 1]) {
    b.add(accent, rbox(0.008, 0.075, 0.21, 0.003), xf(s * 0.0865, 0.004, -0.01), P);
    // 侧甲上沿和机腹各一条灯带：从侧面和从下往上看都有一道亮线
    lights.push([box(0.004, 0.007, 0.17), xf(s * 0.0915, 0.0455, -0.01), HOSTILE]);
    lights.push([box(0.012, 0.003, 0.15), xf(s * 0.05, -0.0515, 0.005), HOSTILE]);
    for (let i = 0; i < 5; i++) b.add(black, box(0.003, 0.006, 0.055), xf(s * 0.0915, -0.018 + i * 0.011, 0.062), K);
    for (const y of [0.034, -0.026]) for (const z of [-0.105, -0.01, 0.085]) b.add(steel, xCyl(0.0035, 0.003, 8), xf(s * 0.0915, y, z), G);
    b.add(steel, zCyl(0.0135, 0.0135, 0.006, 14), xf(s * 0.027, 0, -0.2945), G);
    b.add(black, zCyl(0.0105, 0.0105, 0.008, 14), xf(s * 0.027, 0, -0.2955), K);
    // 起落橇：碳管 + 橡胶握套，后面一根横撑
    b.add(carbon, cylBetween(s * 0.15, SKID_Y, -0.15, s * 0.15, SKID_Y, 0.15, 0.0075, 10), null, C);
    for (const z of [-0.085, 0.085]) {
      b.add(carbon, cylBetween(s * 0.07, -0.05, z, s * 0.15, SKID_Y, z, 0.0065, 8), null, C);
      b.add(steel, rbox(0.022, 0.016, 0.022, 0.004), xf(s * 0.15, SKID_Y, z), G);
      b.add(steel, rbox(0.022, 0.014, 0.026, 0.004), xf(s * 0.072, -0.056, z), G);
    }
    for (const e of [-1, 1]) {
      b.add(black, cylBetween(s * 0.15, SKID_Y, e * 0.1, s * 0.15, SKID_Y, e * 0.152, 0.0108, 10), null, K);
      b.add(black, ball(0.0108), xf(s * 0.15, SKID_Y, e * 0.152), K);
    }
    // 鞭状天线
    b.add(steel, cyl(0.006, 0.006, 0.012, 8), xf(s * 0.05, 0.066, 0.15), G);
    b.add(black, cylBetween(s * 0.05, 0.066, 0.15, s * 0.072, 0.215, 0.205, 0.0022, 6), null, K);
    lights.push([box(0.006, 0.002, 0.006), xf(s * 0.02, 0.081, -0.1), [0.3, 2.2, 0.6]]);
    decals.push(decalQuad(0.021, 0.021, RECT.lens, xf(s * 0.027, 0, -0.2998, 0, Math.PI, 0)));
    decals.push(decalQuad(0.106, 0.08, RECT.mark, xf(s * 0.0908, 0.006, -0.047, 0, s * Math.PI / 2, 0)));
  }
  b.add(carbon, cylBetween(-0.1184, -0.165, 0.085, 0.1184, -0.165, 0.085, 0.005, 8), null, C);
  // 电池仓、绑带、插头和线
  b.add(black, rbox(0.084, 0.038, 0.155, 0.008), xf(0, 0.099, 0.005), K);
  for (const z of [-0.04, 0.05]) b.add(steel, box(0.09, 0.042, 0.014), xf(0, 0.1, z), G);
  b.add(black, rbox(0.03, 0.02, 0.02, 0.004), xf(0.022, 0.094, 0.09), K);
  for (const dx of [0.016, 0.028]) b.add(black, cylBetween(dx, 0.094, 0.098, 0.074, 0.05, 0.11 + dx, 0.0035, 6), null, K);
  decals.push(decalQuad(0.066, 0.104, RECT.battery, xf(0, 0.1185, 0.005, -Math.PI / 2, 0, 0)));
  decals.push(decalQuad(0.03, 0.021, RECT.num, xf(0, 0.0806, -0.096, -Math.PI / 2, 0, 0)));
  // 散热鳍、GPS 天线、尾部格栅
  b.add(steel, rbox(0.085, 0.006, 0.05, 0.002), xf(-0.004, 0.073, 0.125), G);
  for (let i = 0; i < 9; i++) b.add(steel, box(0.0025, 0.022, 0.046), xf(-0.04 + i * 0.009, 0.085, 0.125), G);
  b.add(black, cyl(0.005, 0.005, 0.09, 8), xf(0, 0.1, 0.172), K);
  b.add(black, cyl(0.026, 0.028, 0.012, 20), xf(0, 0.15, 0.172), K);
  for (let i = 0; i < 4; i++) b.add(black, box(0.09, 0.004, 0.006), xf(0, -0.02 + i * 0.011, 0.213), K);
  lights.push([box(0.03, 0.007, 0.004), xf(0, 0.03, 0.2105, 0.5, 0, 0), [5, 4.2, 2.8]]);
  lights.push([box(0.006, 0.006, 0.003), xf(0, 0.012, -0.2935), [1.2, 0.5, 1.6]]);
  // 机腹：下视测距模块、铭牌
  b.add(black, rbox(0.06, 0.014, 0.05, 0.004), xf(0, -0.069, 0.075), K);
  for (const s of [-1, 1]) {
    b.add(steel, cyl(0.009, 0.009, 0.006, 12), xf(s * 0.015, -0.077, 0.075), G);
    b.add(black, cyl(0.0065, 0.0065, 0.007, 12), xf(s * 0.015, -0.0775, 0.075), K);
  }
  decals.push(decalQuad(0.086, 0.035, RECT.plate, xf(0, -0.0628, -0.104, Math.PI / 2, 0, 0)));
  // 机臂、折叠关节、电机、电调、线束
  for (const [mx, mz] of MOTORS) {
    const ax = Math.sign(mx) * ARM_ROOT[0], az = Math.sign(mz) * ARM_ROOT[1];
    const dx = mx - ax, dz = mz - az, len = Math.hypot(dx, dz), ux = dx / len, uz = dz / len, yaw = Math.atan2(dx, dz);
    const at = (t, y = ARM_Y) => [ax + ux * t, y, az + uz * t];
    b.add(steel, rbox(0.045, 0.034, 0.045, 0.006), xf(ax, ARM_Y, az, 0, yaw, 0), G);
    b.add(steel, rbox(0.03, 0.03, 0.02, 0.004), xf(...at(0.034), 0, yaw, 0), G);
    b.add(steel, cyl(0.005, 0.005, 0.046, 8), xf(...at(0.034)), G);
    const plate = xf(...at(0.012, 0.034), 0.12, yaw, 0);
    b.add(accent, rbox(0.058, 0.006, 0.075, 0.002), plate, P);
    // 机臂下面一条灯带，四条合起来是个 X，远处看是无人机的轮廓
    lights.push([box(0.008, 0.003, len * 0.5), xf(...at(len * 0.52, ARM_Y - 0.0125), 0, yaw, 0), HOSTILE]);
    decals.push(decalQuad(0.04, 0.016, RECT.danger, plate.clone().multiply(xf(0, 0.0035, 0.004, -Math.PI / 2, 0, Math.PI / 2))));
    b.add(carbon, cylBetween(ax, ARM_Y, az, mx, ARM_Y, mz, 0.0115, 14), null, C);
    for (const t of [0.1, 0.19]) b.add(steel, cylBetween(...at(t - 0.004), ...at(t + 0.004), 0.0142, 14), null, G);
    b.add(black, rbox(0.024, 0.009, 0.05, 0.003), xf(...at(len * 0.55, -0.004), 0, yaw, 0), K);
    b.add(black, cylBetween(ax, 0.034, az, ...at(len * 0.5, 0.028), 0.003, 6), null, K);
    b.add(black, cylBetween(...at(len * 0.5, 0.028), ...at(len - 0.028, 0.026), 0.003, 6), null, K);
    b.add(black, cyl(0.031, 0.031, 0.01, 20), xf(mx, 0.02, mz), K);
    b.add(steel, cyl(0.0245, 0.0245, 0.028, 20), xf(mx, 0.039, mz), G);
    for (let i = 0; i < 12; i++) {
      const a = (i / 12) * Math.PI * 2;
      b.add(black, box(0.005, 0.02, 0.0035), xf(mx + Math.cos(a) * 0.0245, 0.039, mz + Math.sin(a) * 0.0245, 0, -a, 0), K);
    }
    b.add(steel, cyl(0.019, 0.027, 0.012, 20), xf(mx, 0.059, mz), G);
    b.add(steel, cyl(0.0045, 0.0045, 0.02, 8), xf(mx, 0.07, mz), G);
    const rgb = mx < 0 ? [9, 0.35, 0.2] : [0.3, 8, 1.2]; // 左红右绿
    lights.push([box(0.022, 0.009, 0.005), xf(mx + ux * 0.033, 0.02, mz + uz * 0.033, 0, yaw, 0), rgb]);
    lights.push([box(0.014, 0.004, 0.014), xf(mx, 0.0135, mz), rgb]);
  }
  // 云台安装座和减震球
  b.add(steel, cyl(0.05, 0.05, 0.012, 24), xf(GIMBAL[0], -0.068, GIMBAL[2]), G);
  for (const [x, z] of [[-0.03, -0.03], [0.03, -0.03], [-0.03, 0.03], [0.03, 0.03]]) b.add(black, ball(0.009, 8, 6), xf(x, -0.063, GIMBAL[2] + z), K);
  return { batch: b, lights: lightBits(lights), decals: mergeGeometries(decals, false) };
}

function buildRotor(carbon, mirror) {
  const b = new Batch(), C = { tile: 0.014 };
  const flip = new THREE.Matrix4().makeScale(mirror ? -1 : 1, 1, 1);
  for (const ry of [0, Math.PI]) b.add(carbon, bladeGeo(), flip.clone().multiply(xf(0, 0.004, 0, 0, ry, 0)), C);
  b.add(carbon, cyl(0.015, 0.017, 0.016, 16), xf(0, 0.002, 0), C);
  b.add(carbon, lathe([[0.011, 0.01], [0.008, 0.02], [0, 0.024]], 12), null, C);
  return b;
}

function buildGimbal(mats) {
  const yaw = new Batch(), pit = new Batch(), glass = new Batch();
  const steel = mats.steelDark, black = mats.plasticBlack, G = { tile: 0.5 }, K = { tile: 0.03 };
  yaw.add(black, cyl(0.03, 0.03, 0.022, 20), xf(0, -0.011, 0), K);
  yaw.add(black, rbox(0.132, 0.014, 0.034, 0.004), xf(0, -0.027, 0), K);
  for (const s of [-1, 1]) yaw.add(black, rbox(0.01, 0.062, 0.034, 0.004), xf(s * 0.061, -0.058, 0), K);
  // 俯仰组件：传感器球、探照灯筒、测距仪、机枪和弹箱
  pit.add(steel, rbox(0.092, 0.062, 0.1, 0.014), xf(0, 0, -0.004), G);
  for (const s of [-1, 1]) pit.add(steel, xCyl(0.018, 0.012, 16), xf(s * 0.05, 0, 0), G);
  for (let i = 0; i < 5; i++) pit.add(steel, box(0.014, 0.005, 0.007), xf(-0.012, 0.0325, -0.034 + i * 0.014), G);
  pit.add(steel, ball(0.034, 20, 14), xf(-0.022, 0.004, -0.05), G);
  pit.add(steel, zCyl(0.021, 0.021, 0.055), xf(LAMP[0], LAMP[1], -0.05), G);
  for (const z of [-0.03, -0.042, -0.054]) pit.add(steel, zCyl(0.0245, 0.0245, 0.003), xf(LAMP[0], LAMP[1], z), G);
  pit.add(steel, zCyl(0.007, 0.007, 0.03, 10), xf(0.026, -0.022, -0.05), G);
  pit.add(steel, rbox(0.03, 0.032, 0.11, 0.005), xf(0, MUZZLE[1], 0), G);
  pit.add(steel, zCyl(0.0065, 0.0065, 0.15, 10), xf(0, MUZZLE[1], -0.125), G);
  pit.add(steel, zCyl(0.0115, 0.0115, 0.05, 12), xf(0, MUZZLE[1], -0.085), G);
  pit.add(steel, zCyl(0.0095, 0.0095, 0.028, 12), xf(0, MUZZLE[1], MUZZLE[2] + 0.014), G);
  pit.add(steel, zCyl(0.004, 0.004, 0.07, 8), xf(0, MUZZLE[1] + 0.013, -0.09), G);
  pit.add(steel, rbox(0.03, 0.05, 0.06, 0.004), xf(-0.034, -0.045, 0.012), G);
  pit.add(steel, rbox(0.012, 0.012, 0.03, 0.003), xf(-0.018, -0.03, -0.01), G);
  glass.add(mats.glassDark, zCyl(0.0225, 0.0225, 0.012, 20), xf(-0.022, 0.004, -0.0785));
  // 眼：镜片外圈的红环、中心红点，外加测距仪的小红点；预警时一起变亮
  const eye = mergeGeometries([
    new THREE.TorusGeometry(0.0165, 0.0038, 8, 28).translate(-0.022, 0.004, -0.0852),
    zCyl(0.0065, 0.0065, 0.003, 12).translate(-0.022, 0.004, -0.0855),
    zCyl(0.0055, 0.0055, 0.003, 10).translate(0.026, -0.022, -0.0655),
  ].map((g) => g.toNonIndexed()), false);
  return { yaw, pit, glass, eye, lamp: zCyl(0.018, 0.018, 0.004, 20).translate(LAMP[0], LAMP[1], -0.078) };
}

const templates = new WeakMap();
function template(mats) {
  if (templates.has(mats)) return templates.get(mats);
  // 机身是中灰，装甲板是警示橙：原来整机近黑，白天贴着仓库和箱子的暗面根本看不见
  const paint = mats.paint(0x5d646c, { wear: 0.28, dirt: 0.4, rough: 0.55 });
  const accent = mats.paint(0xff6a1c, { wear: 0.22, dirt: 0.3, rough: 0.5 });
  const carbon = withWet(new THREE.MeshStandardMaterial({ map: carbonTexture(), roughness: 0.34, metalness: 0.15 }));
  const take = (batch) => batch.build(new THREE.Group()).map((m) => ({ geo: m.geometry, mat: m.material }));
  const body = buildBody(mats, paint, carbon, accent), gim = buildGimbal(mats);
  const disc = new THREE.CircleGeometry(PROP_R, 28).rotateX(-Math.PI / 2);
  const t = {
    body: take(body.batch),
    lights: body.lights,
    lightMat: new THREE.MeshBasicMaterial({ vertexColors: true }),
    decals: body.decals,
    decalMat: new THREE.MeshStandardMaterial({
      map: markingTexture(), transparent: true, depthWrite: false, roughness: 0.6,
      polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2,
    }),
    rotor: [take(buildRotor(carbon, false))[0], take(buildRotor(carbon, true))[0]],
    discs: mergeGeometries(MOTORS.map(([x, z]) => disc.clone().translate(x, PROP_Y + 0.006, z)), false),
    // 桨盘是一片压暗的半透明圆：夜里不发光，只在亮背景和光柱前显出旋转的模糊
    discMat: new THREE.MeshBasicMaterial({
      map: discTexture(), color: 0x10151a, transparent: true, opacity: 0.5, depthWrite: false, side: THREE.DoubleSide,
    }),
    yaw: take(gim.yaw), pit: take(gim.pit), glass: take(gim.glass), eye: gim.eye, lamp: gim.lamp,
  };
  templates.set(mats, t);
  return t;
}

export function buildDrone(mats) {
  const t = template(mats);
  const root = new THREE.Group();
  const mesh = (parent, geo, mat, cast = true) => {
    const m = new THREE.Mesh(geo, mat);
    m.castShadow = cast;
    m.receiveShadow = cast;
    parent.add(m);
    return m;
  };
  for (const p of t.body) mesh(root, p.geo, p.mat);
  mesh(root, t.lights, t.lightMat, false);
  mesh(root, t.decals, t.decalMat, false);
  const discs = mesh(root, t.discs, t.discMat, false);
  const rotors = MOTORS.map(([x, z], i) => {
    const r = new THREE.Group();
    r.position.set(x, PROP_Y, z);
    mesh(r, t.rotor[i % 2].geo, t.rotor[i % 2].mat);
    root.add(r);
    return r;
  });
  const gimbal = new THREE.Group();
  gimbal.position.fromArray(GIMBAL);
  for (const p of t.yaw) mesh(gimbal, p.geo, p.mat);
  const pitch = new THREE.Group();
  pitch.position.set(0, PITCH_Y, 0);
  for (const p of t.pit) mesh(pitch, p.geo, p.mat);
  for (const p of t.glass) mesh(pitch, p.geo, p.mat, false);
  // 眼和灯的亮度每架各自变化，所以材质不共享
  const eye = new THREE.MeshStandardMaterial({ color: 0x050505, emissive: 0xff2a12, emissiveIntensity: 3, roughness: 0.4 });
  const lampMat = new THREE.MeshStandardMaterial({ color: 0x050505, emissive: 0xdbe8ff, emissiveIntensity: 4, roughness: 0.4 });
  mesh(pitch, t.eye, eye, false);
  mesh(pitch, t.lamp, lampMat, false);
  const muzzle = new THREE.Object3D();
  muzzle.position.fromArray(MUZZLE);
  const lamp = new THREE.Object3D();
  lamp.position.fromArray(LAMP);
  pitch.add(muzzle, lamp);
  gimbal.add(pitch);
  root.add(gimbal);
  return { root, rotors, gimbal, pitch, muzzle, lamp, eye, lampMat, discs, radius: DRONE_RADIUS };
}
