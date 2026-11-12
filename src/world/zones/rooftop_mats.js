import * as THREE from 'three';
import { MEMBRANE, GRAVEL, CITY_WINDOWS } from './rooftop_tex.js';

// 楼顶分区自己的材质，整组按 key 缓存，全场只建一次。
// 新建的实例：卷材、卵石、天花、设备漆、招牌字面两种、航标闪灯、采光罩、积水、远景楼两种（共 11 个，另有车流点一个）；
// 其余直接用共享材质和别处已有的 paint / emissive key，不额外占份额。灯串的小灯泡借招牌字面（同一种暖白）。
export function roofMats(mats) {
  return mats.one('rooftop|mats', () => {
    const mem = mats.set('roofMembrane', MEMBRANE, { size: 1024, normal: 0.006, seed: 31 });
    const grv = mats.set('roofGravel', GRAVEL, { size: 1024, normal: 0.014, seed: 33 });
    const win = mats.set('roofCityWindows', CITY_WINDOWS, { size: 1024, normal: 0.004, seed: 35 });
    const glow = (color, intensity) => new THREE.MeshStandardMaterial({ color: 0x050505, emissive: color, emissiveIntensity: intensity, roughness: 0.4 });
    // 远景楼：贴图的 albedo 当自发光（亮着的窗），orm 给玻璃和墙不同的粗糙度、压暗玻璃
    const city = (color, intensity) => {
      const m = new THREE.MeshStandardMaterial({
        color, roughness: 1, roughnessMap: win.ormMap, aoMap: win.ormMap, normalMap: win.normalMap,
        emissive: 0xffffff, emissiveMap: win.map, emissiveIntensity: intensity,
      });
      m.userData.noShadow = true;
      return m;
    };
    return {
      membrane: mats.pbr(mem, { rough: 1 }),
      // 卵石不走统一的湿表面：碎石缝里存不住水膜，按湿地面压粗糙度会整片反天光、发白
      gravel: mats.pbr(grv, { rough: 1, wet: false }),
      ceiling: mats.paint(0xb6b7b0, { wear: 0.05, dirt: 0.3, rough: 0.85, wet: false, indoor: 0.3 }),
      // 设备漆偏冷的浅灰：原来的暖灰叠上照片细节，夜里暖光一照像胶合板
      unit: mats.paint(0x939b9f, { wear: 0.25, dirt: 0.75, rough: 0.45 }),
      signFace: glow(0xffe4bc, 22),
      signFlicker: glow(0xffe4bc, 22),
      beacon: glow(0xff2a12, 20),
      skylight: new THREE.MeshStandardMaterial({ color: 0x55616a, roughness: 0.2, emissive: 0xb8ccf0, emissiveIntensity: 0.32 }),
      // 屋面积水：同一张卷材贴图压暗、几乎镜面，按世界坐标贴（tile 4）和底下的卷材对缝，
      // 看上去是一层薄水膜，不会像纯黑的洞
      water: mats.pbr(mem, { rough: 0.06, color: 0x8a8c90, normal: 0.15, wet: false }),
      cityNear: city(0x30343a, 1.6),
      cityFar: city(0x262a31, 2.0),
      // 共享的
      clad: mats.paint(0x46525c, { wear: 0.3, dirt: 0.75 }),
      trim: mats.paint(0x2b3238, { wear: 0.35, dirt: 0.6 }),
      yellow: mats.paint(0xc79a12, { wear: 0.6, dirt: 0.6 }),
      box: mats.paint(0x6f746f, { wear: 0.4, dirt: 0.5 }),
      dark: mats.paint(0x3a4046, { wear: 0.4, dirt: 0.8 }),
      // 下面三个和仓库门、街区的蓝红漆同 key，不另占份额
      grey: mats.paint(0xa3a398, { wear: 0.4, dirt: 0.8 }),
      blue: mats.paint(0x1c4470, { wear: 0.45, dirt: 0.6 }),
      red: mats.paint(0x7d2a1e, { wear: 0.45, dirt: 0.6 }),
      lampCool: mats.emissive(0xdfeaff, 30),
      lampWarm: mats.emissive(0xffe2b8, 30),
      sodium: mats.emissive(0xffb45e, 70),
      redLight: mats.emissive(0xff2a12, 24),
    };
  });
}
