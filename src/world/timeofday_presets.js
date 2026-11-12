import * as THREE from 'three';

// 各时段的参数表。字段和 timeofday.js 的 capture() 记下来的启动状态同形，apply() 照着写进场景。
// 亮度都是线性值：太阳的强度和场上的人造灯在一个量级（高杆灯正下方大约 20），一档曝光室内外都能看清。
const v3 = (x, y, z) => new THREE.Vector3(x, y, z);
const lin = (r, g, b) => new THREE.Color().setRGB(r, g, b);
const hex = (h) => new THREE.Color(h);
// 太阳方向。高度角；方位角从正南起算、往西为正（+z 是南，-x 是西）
const sunDir = (elevDeg, azDeg) => {
  const e = THREE.MathUtils.degToRad(elevDeg), a = THREE.MathUtils.degToRad(azDeg);
  return v3(-Math.sin(a) * Math.cos(e), Math.sin(e), Math.cos(a) * Math.cos(e));
};

// 夜里唯一加的东西：一点从头顶下来的冷色天光，把最暗的角落（街上、集装箱背后）抬起来一点，
// 站在暗处的敌人不至于和背景糊成一片。灯照得到的地方它可以忽略，夜景的气氛不动。
// 室内材质和第一人称武器（withIndoor）在房间盒里只吃到一成上下的半球光；敌人和室外材质摆进屋里时照样全吃，所以只给这么多
export const NIGHT_FILL = { sky: hex(0x8fb2ff), ground: hex(0x05070c), intensity: 0.2 };
// 夜里的地面：湿透，下着雨时积水再涨一截，路边和车辙都汪着水（画质关了雨就不涨，见 ground.js 的 rainPuddle）
export const NIGHT_GROUND = { wetness: 1, puddle: 0, rainPuddle: 0.15 };

export const PRESETS = {
  // 夜晚：全部取启动时记下的值，这里什么都不覆盖
  night: {},

  // 下午：雨刚停，太阳在西南方 18 度，金色主光、长影子，天光偏冷，碎云，薄雾，地面还湿着
  afternoon: {
    sun: { dir: sunDir(18, 50), color: hex(0xffc489), intensity: 11, soft: 0.05, bias: -0.0005, normalBias: 0.07, shadow: 1, weight: 3 },
    sky: {
      night: false,
      zenith: v3(0.075, 0.18, 0.47), horizon: v3(0.46, 0.54, 0.68), glow: v3(1.4, 1.0, 0.48), disc: v3(120, 85, 45),
      cloudLit: v3(1.5, 1.12, 0.74), cloudDark: v3(0.33, 0.36, 0.48), cloud: new THREE.Vector4(0.53, 0.16, 0.95, 0.55),
      below: v3(0.1, 0.12, 0.15),
    },
    // 补光给得足：背阴处的敌人是深色的，周围的地面和墙得比他亮一截才认得出来
    fill: { sky: hex(0xa9c6ff), ground: hex(0x4a3a2c), intensity: 0.75 },
    env: 1.2,
    fog: { color: lin(0.42, 0.48, 0.58), density: 0.0048 },
    vol: { density: 0.008, maxDist: 80, sun: 0.075, cutoff: 40 },
    exposure: 1, bloom: 0.06, dirt: 0.02,
    rain: 0,
    ambient: lin(1.25, 0.98, 0.72),
    sea: hex(0x0c2a3a),
    ground: { wetness: 0.9, puddle: 0 },
    wet: 0.8,
    // 室外的灯刚亮起来，还压不过太阳；屋里的灯调亮一些，从太阳地里走进去不至于一片黑
    lamps: { outdoor: 0.16, indoor: 1.4 },
    glow: { outdoor: 0.55, indoor: 1 },
    city: false,
    // 敌人的轮廓光（夜里的值在 soldier_mat.js）：太阳地里补光够了，只留一丝
    rim: 0.05,
  },

  // 白天：上午晚些时候，阴转晴。太阳高、颜色中性，云多、影子软，到处都看得清；灯基本是关着的样子
  day: {
    sun: { dir: sunDir(52, -40), color: hex(0xfff1e0), intensity: 9, soft: 0.12, bias: -0.0004, normalBias: 0.07, shadow: 0.88, weight: 3 },
    sky: {
      night: false,
      zenith: v3(0.16, 0.3, 0.62), horizon: v3(0.78, 0.84, 0.9), glow: v3(1.3, 1.25, 1.15), disc: v3(40, 38, 34),
      cloudLit: v3(1.6, 1.6, 1.58), cloudDark: v3(0.62, 0.65, 0.7), cloud: new THREE.Vector4(0.44, 0.24, 0.96, 0.55),
      below: v3(0.16, 0.17, 0.19),
    },
    fill: { sky: hex(0xd6e4ff), ground: hex(0x5a5448), intensity: 1 },
    env: 1,
    fog: { color: lin(0.7, 0.75, 0.8), density: 0.0036 },
    vol: { density: 0.006, maxDist: 80, sun: 0.1, cutoff: 60 },
    exposure: 1.25, bloom: 0.06, dirt: 0.012,
    rain: 0,
    ambient: lin(1.3, 1.3, 1.28),
    sea: hex(0x1b3a48),
    // 地面大半干了，只剩最深的几处积水
    ground: { wetness: 0.3, puddle: -0.4 },
    wet: 0.35,
    lamps: { outdoor: 0.05, indoor: 1 },
    glow: { outdoor: 0.12, indoor: 1 },
    city: false,
    rim: 0,
  },
};
