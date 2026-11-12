import * as THREE from 'three';

// 街道分区自己的贴图配方和材质。幅面（boxUV 的 tile）：人行道砖 2.4，外墙条砖 1.2，抹灰 3。
export const TILE = { paver: 2.4, tile: 1.2, render: 3, conc: 3, paint: 5.2, galv: 1.2, wood: 0.9, plastic: 0.06 };

// 人行道：0.4 m 方砖错缝铺，砖缝积灰，个别砖色深、缺角
const PAVER = /* glsl */ `
Surf surface(vec2 uv) {
  Surf s = newSurf();
  vec2 g = uv * 6.0;
  g.x += step(1.0, mod(floor(g.y), 2.0)) * 0.5;
  vec2 id = mod(floor(g), 6.0), f = fract(g);
  float e = min(min(f.x, 1.0 - f.x), min(f.y, 1.0 - f.y));
  float joint = smoothstep(0.03, 0.01, e);
  float bevel = smoothstep(0.0, 0.07, e);
  float r = h21(id + 3.0);
  gSalt = 1.0; float n = fbm(uv, 24.0, 4);
  gSalt = 2.0; float fine = fbm(uv, 160.0, 3);
  gSalt = 3.0; float stain = smoothstep(0.52, 0.82, fbm(uv, 5.0, 4));
  gSalt = 4.0; vec3 pits = voronoi(uv, 90.0);
  float pit = smoothstep(0.12, 0.03, pits.x) * step(0.78, pits.z);
  vec3 base = mix(vec3(0.3, 0.295, 0.285), vec3(0.46, 0.45, 0.43), r) * (0.85 + 0.3 * n);
  base *= 1.0 - 0.35 * stain;
  vec3 grout = vec3(0.09, 0.088, 0.085);
  s.albedo = mix(base * (0.92 + 0.16 * fine) * (1.0 - 0.45 * pit), grout, joint);
  s.height = 0.5 + 0.25 * bevel * (0.7 + 0.3 * r) + 0.05 * fine - 0.3 * joint - 0.2 * pit;
  s.rough = sat(0.74 + 0.12 * n - 0.12 * stain + 0.15 * joint);
  s.ao = 1.0 - 0.5 * joint;
  return s;
}`;

// 外墙条砖（0.24 × 0.06 釉面砖错缝贴），带从上往下的雨水污痕和零星掉砖。底色近白，颜色由材质 color 染
const FACADE_TILE = /* glsl */ `
Surf surface(vec2 uv) {
  Surf s = newSurf();
  vec2 g = uv * vec2(5.0, 20.0);
  g.x += step(1.0, mod(floor(g.y), 2.0)) * 0.5;
  vec2 id = mod(floor(g), vec2(5.0, 20.0)), f = fract(g);
  vec2 fe = min(f, 1.0 - f) * vec2(0.24, 0.06);
  float e = min(fe.x, fe.y);
  float joint = smoothstep(0.0045, 0.0015, e);
  float bulge = smoothstep(0.0, 0.006, e);
  float r = h21(id + 7.0);
  float missing = step(0.988, h21(id + 19.0));
  gSalt = 1.0; float streak = fbm2(uv, vec2(36.0, 2.0), 4);
  gSalt = 2.0; float lo = fbm(uv, 3.0, 4);
  gSalt = 3.0; float fine = fbm(uv, 220.0, 2);
  float grime = smoothstep(0.42, 0.85, streak * 0.75 + lo * 0.35);
  vec3 col = vec3(0.8, 0.79, 0.76) * (0.88 + 0.2 * r);
  col = mix(col, vec3(0.3, 0.29, 0.27), joint);
  col *= 1.0 - 0.5 * grime;
  col = mix(col, vec3(0.32, 0.31, 0.29) * (0.8 + 0.4 * fine), missing);
  s.albedo = col;
  s.height = 0.5 + 0.18 * bulge - 0.25 * missing + 0.04 * fine;
  s.rough = mix(mix(0.22 + 0.12 * r, 0.92, joint), 0.75, sat(grime * 0.6 + missing));
  s.ao = 1.0 - 0.4 * joint;
  return s;
}`;

// 抹灰墙面：流挂水渍、补过的灰块、细裂缝。底色浅灰，颜色由材质 color 染
const RENDER = /* glsl */ `
Surf surface(vec2 uv) {
  Surf s = newSurf();
  gSalt = 1.0; float lo = fbm(uv, 4.0, 5);
  gSalt = 2.0; float mid = fbm(uv, 30.0, 4);
  gSalt = 3.0; float fine = fbm(uv, 200.0, 2);
  gSalt = 4.0; float streak = fbm2(uv, vec2(48.0, 1.0), 4);
  gSalt = 5.0; vec3 pv = voronoi(uv, 5.0);
  float patchM = step(0.8, pv.z) * smoothstep(0.45, 0.35, pv.x);
  gSalt = 6.0; vec2 warp = 0.015 * vec2(fbm(uv, 10.0, 3), fbm(uv + 0.3, 10.0, 3));
  vec3 cr = voronoi(uv + warp, 6.0);
  float crack = smoothstep(0.01, 0.0, cr.y - cr.x) * smoothstep(0.5, 0.7, lo);
  float stain = smoothstep(0.5, 0.9, streak * 0.8 + lo * 0.3);
  vec3 col = vec3(0.72, 0.71, 0.68) * (0.85 + 0.25 * mid);
  col = mix(col, vec3(0.55, 0.55, 0.53), patchM * 0.6);
  col *= 1.0 - 0.45 * stain;
  col *= 1.0 - 0.6 * crack;
  s.albedo = col * (0.94 + 0.12 * fine);
  s.height = 0.5 + 0.12 * mid + 0.15 * fine + 0.1 * patchM - 0.5 * crack;
  s.rough = sat(0.82 + 0.08 * mid - 0.15 * stain);
  return s;
}`;

// 分区里所有材质都从这里取，同一个 key 全场共用一个实例
export function streetMats(mats) {
  const paver = mats.set('streetPaver', PAVER, { size: 1024, normal: 0.006, seed: 31 });
  const tile = mats.set('streetTile', FACADE_TILE, { size: 1024, normal: 0.004, seed: 33 });
  const render = mats.set('streetRender', RENDER, { size: 1024, normal: 0.005, seed: 35 });
  const one = (k, make) => mats.one(`street|${k}`, make);
  // 发光片和小灯罩不投影：它们很薄，投影看不出来，却要在每个阴影通道里多画一次
  const flat = (m) => { m.userData.noShadow = true; return m; };
  const glow = (k) => one(k, () => flat(new THREE.MeshStandardMaterial({ color: 0x040404, emissive: 0xffffff, emissiveIntensity: 4, roughness: 0.32 })));
  return {
    paver: one('paver', () => mats.pbr(paver, { rough: 1 })),
    tileBeige: one('tileBeige', () => mats.pbr(tile, { color: 0xd9ccb0 })),
    tileGrey: one('tileGrey', () => mats.pbr(tile, { color: 0xb4bab9 })),
    renderOchre: one('renderOchre', () => mats.pbr(render, { color: 0xb89c7c })),
    renderGrey: one('renderGrey', () => mats.pbr(render, { color: 0x949b9c })),
    // 霓虹、灯箱、亮着的窗：同一张画布贴图的自发光；flicker 那份做坏灯管闪烁，blink 是路障上的黄闪灯
    neon: glow('neon'),
    flicker: glow('neonFlicker'),
    blink: glow('neonBlink'),
    // 车漆：新一点、亮一点
    carWhite: mats.paint(0xc9c9c2, { wear: 0.12, dirt: 0.55, rough: 0.3 }),
    carBlue: mats.paint(0x3b5566, { wear: 0.15, dirt: 0.55, rough: 0.3 }),
    lensRed: one('lensRed', () => flat(new THREE.MeshStandardMaterial({ color: 0x5c0805, roughness: 0.18, metalness: 0.1 }))),
    // 垃圾桶的绿塑料
    plasticGreen: one('plasticGreen', () => mats.pbr({ map: null, normalMap: mats.tex.polymer.normalMap }, { color: 0x1f4a2c, rough: 0.55 })),
    // 已有的共用涂装（堆场的箱子、围栏已经建过同样参数的实例，不另增材质）
    frame: mats.paint(0x2b3238, { wear: 0.55, dirt: 0.6 }),
    box: mats.paint(0x6f746f, { wear: 0.4, dirt: 0.5 }),
    grey: mats.paint(0xa8a89f, { wear: 0.45, dirt: 0.6 }),
    blue: mats.paint(0x1c4470, { wear: 0.45, dirt: 0.6 }),
    green: mats.paint(0x2c4a2e, { wear: 0.45, dirt: 0.6 }),
    teal: mats.paint(0x1f5e56, { wear: 0.45, dirt: 0.6 }),
    red: mats.paint(0x7d2a1e, { wear: 0.45, dirt: 0.6 }),
    yellow: mats.paint(0xb8901f, { wear: 0.55, dirt: 0.8 }),
    bollard: mats.paint(0xc79a12, { wear: 0.7, dirt: 0.5 }),
  };
}
