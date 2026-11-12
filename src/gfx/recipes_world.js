// 场景表面的贴图配方（GLSL）。uv 在 [0,1) 内可平铺，注释里的“幅面”是这张贴图铺到世界里的边长。

// 沥青，幅面 3 m。alpha 存骨料高度，地面着色器据此决定积水先淹哪里。
export const asphalt = /* glsl */ `
Surf surface(vec2 uv) {
  Surf s = newSurf();
  gSalt = 1.0; vec3 v1 = voronoi(uv, 300.0);
  gSalt = 2.0; vec3 v2 = voronoi(uv, 110.0);
  gSalt = 3.0; float macro = fbm(uv, 5.0, 5);
  gSalt = 4.0; float fine = fbm(uv, 256.0, 3);
  float st1 = smoothstep(0.62, 0.18, v1.x);
  float st2 = smoothstep(0.55, 0.2, v2.x) * step(0.45, v2.z);
  float h = sat(st1 * 0.55 + st2 * 0.3 + fine * 0.25);
  vec3 binder = vec3(0.03, 0.03, 0.032);
  vec3 stone = mix(vec3(0.05, 0.05, 0.052), vec3(0.125, 0.12, 0.112), v1.z * v1.z);
  vec3 stoneB = mix(vec3(0.07), vec3(0.15, 0.145, 0.135), v2.z);
  vec3 col = mix(binder, stone, st1 * 0.9);
  col = mix(col, stoneB, st2 * 0.8);
  s.albedo = col * (0.7 + 0.6 * macro);
  s.height = h;
  s.alpha = h;
  s.rough = mix(0.95, 0.7, st1);
  return s;
}`;

// 混凝土，幅面 3 m
export const concrete = /* glsl */ `
Surf surface(vec2 uv) {
  Surf s = newSurf();
  gSalt = 1.0; float macro = fbm(uv, 4.0, 6);
  gSalt = 2.0; float mid = fbm(uv, 24.0, 4);
  gSalt = 3.0; float fine = fbm(uv, 300.0, 2);
  gSalt = 4.0; vec3 pores = voronoi(uv, 140.0);
  gSalt = 5.0; vec2 warp = 0.02 * vec2(fbm(uv, 12.0, 3), fbm(uv + 0.37, 12.0, 3));
  vec3 cr = voronoi(uv + warp, 4.0);
  float pit = smoothstep(0.16, 0.05, pores.x) * step(0.72, pores.z);
  float crack = smoothstep(0.012, 0.0, cr.y - cr.x) * smoothstep(0.35, 0.6, macro);
  gSalt = 6.0; float stain = smoothstep(0.45, 0.75, fbm2(uv, vec2(10.0, 3.0), 4));
  vec3 col = mix(vec3(0.2, 0.196, 0.188), vec3(0.4, 0.39, 0.37), macro * 0.6 + mid * 0.4);
  col *= 1.0 - 0.35 * stain;
  col *= 1.0 - 0.6 * pit - 0.7 * crack;
  s.albedo = col * (0.92 + 0.16 * fine);
  s.height = 0.5 + 0.15 * mid + 0.1 * fine - 0.5 * pit - 0.6 * crack;
  s.rough = sat(0.78 + 0.15 * (mid - 0.5) + 0.1 * stain - 0.15 * (1.0 - macro));
  return s;
}`;

// 涂装金属的磨损遮罩：r = 锈潜势，g = 污垢，b = 漆面明度变化，a = 露底划痕。
// 颜色在材质里按遮罩合成，一套遮罩供所有颜色的集装箱、油桶、设备共用。
const wearCore = /* glsl */ `
vec4 wear(vec2 uv) {
  gSalt = 1.0; float lo = fbm(uv, 3.0, 5);
  gSalt = 2.0; float hi = fbm(uv, 48.0, 4);
  gSalt = 3.0; float streak = fbm2(uv, vec2(64.0, 2.0), 4);
  gSalt = 4.0; vec3 chips = voronoi(uv, 64.0);
  // 锈是连续的“潜势”，材质里按磨损程度取阈值
  float rust = sat(max(lo * 0.55 + hi * 0.45, streak * 0.7 + lo * 0.3));
  gSalt = 5.0; float grime = sat(fbm(uv, 6.0, 5) * 0.7 + fbm2(uv, vec2(90.0, 3.0), 3) * 0.5 - 0.25);
  gSalt = 6.0; float vary = fbm(uv, 2.0, 4);
  gSalt = 7.0;
  float sc = 0.0;
  for (int i = 0; i < 4; i++) {
    // 刮痕大多是水平方向的（吊装、并排堆放时蹭出来的）
    vec2 q = rot((float(i) - 1.5) * 0.11) * (uv + float(i) * 0.37);
    sc = max(sc, smoothstep(0.966, 0.988, fbm2(q, vec2(9.0, 620.0), 1)));
  }
  float chip = smoothstep(0.2, 0.08, chips.x) * step(0.972, chips.z);
  return vec4(rust, grime, vary, sat(sc + chip));
}`;
export const wearMask = `${wearCore}\nvec4 pixel(vec2 uv) { return wear(uv); }`;
export const wearNormal = /* glsl */ `${wearCore}
Surf surface(vec2 uv) {
  Surf s = newSurf();
  vec4 w = wear(uv);
  gSalt = 11.0; float peel = fbm(uv, 220.0, 2);
  gSalt = 12.0; float dent = fbm(uv, 5.0, 3);
  gSalt = 13.0; float pitting = fbm(uv, 120.0, 3);
  float rust = smoothstep(0.62, 0.72, w.r);
  s.height = 0.5 + 0.03 * peel + 0.35 * dent + rust * (0.1 + 0.3 * pitting) - 0.12 * w.a;
  return s;
}`;

// 木板，幅面 0.9 m，6 块板沿 v 方向
export const wood = /* glsl */ `
Surf surface(vec2 uv) {
  Surf s = newSurf();
  float planks = 6.0;
  float pi = floor(uv.x * planks), pf = fract(uv.x * planks);
  vec2 q = vec2(uv.x, uv.y + h21(vec2(pi, 3.0)));
  gSalt = 1.0; float warp = fbm(q, 6.0, 3);
  gSalt = 2.0; float grain = fbm2(vec2(q.x + warp * 0.05, q.y), vec2(96.0, 4.0), 4);
  float rings = 0.5 + 0.5 * sin((grain * 9.0 + q.x * planks * 2.0) * 6.2831);
  gSalt = 3.0; vec3 kn = voronoi(uv, 5.0);
  float knot = smoothstep(0.1, 0.02, kn.x) * step(0.7, kn.z);
  vec3 col = mix(vec3(0.2, 0.13, 0.07), vec3(0.46, 0.34, 0.2), sat(0.25 + 0.75 * grain));
  col = mix(col, col * 0.7, rings * 0.35);
  col *= 0.72 + 0.5 * h21(vec2(pi, 9.0));
  col = mix(col, vec3(0.08, 0.05, 0.03), knot * 0.8);
  gSalt = 4.0; float weather = fbm(uv, 5.0, 4);
  col = mix(col, vec3(dot(col, vec3(0.333))) * vec3(0.9, 0.93, 0.95), 0.5 * weather);
  float gap = smoothstep(0.04, 0.0, min(pf, 1.0 - pf));
  s.albedo = col * (1.0 - 0.85 * gap);
  s.height = 0.5 + 0.1 * (rings - 0.5) + 0.2 * (grain - 0.5) - 0.6 * gap;
  s.rough = 0.72 + 0.2 * weather;
  s.ao = 1.0 - 0.6 * gap;
  return s;
}`;

// 镀锌钢，幅面 1.2 m
export const galv = /* glsl */ `
Surf surface(vec2 uv) {
  Surf s = newSurf();
  gSalt = 1.0; vec3 v = voronoi(uv, 36.0);
  gSalt = 2.0; float n = fbm(uv, 8.0, 5);
  gSalt = 3.0; float streak = fbm2(uv, vec2(60.0, 2.0), 3);
  vec3 col = mix(vec3(0.34, 0.35, 0.36), vec3(0.6, 0.61, 0.62), v.z * 0.6 + n * 0.4);
  float dirt = smoothstep(0.7, 0.92, streak * 0.6 + n * 0.5);
  s.albedo = mix(col, vec3(0.12, 0.1, 0.08), dirt * 0.6);
  s.height = 0.5 + 0.05 * v.z + 0.1 * n;
  s.rough = sat(0.38 + 0.1 * v.z + 0.35 * dirt);
  s.metal = 1.0 - 0.7 * dirt;
  return s;
}`;

// 菱形铁丝网，幅面 0.48 m，alpha 是丝
export const chainlink = /* glsl */ `
Surf surface(vec2 uv) {
  Surf s = newSurf();
  float n = 8.0, w = 0.085;
  float da = abs(fract((uv.x + uv.y) * n) - 0.5), db = abs(fract((uv.x - uv.y) * n) - 0.5);
  float wa = smoothstep(w, w * 0.5, da), wb = smoothstep(w, w * 0.5, db);
  float body = max(wa * (1.0 - da / w), wb * (1.0 - db / w));
  s.alpha = max(wa, wb);
  s.albedo = vec3(0.34, 0.35, 0.36) * (0.6 + 0.4 * body);
  s.height = body;
  s.rough = 0.45;
  s.metal = 1.0;
  return s;
}`;

// 地面宏观遮罩（不平铺，覆盖整张地面）：r = 积水，g = 裂缝，b = 油污，a = 明度变化（0.5 为中性）
export const groundMacro = /* glsl */ `
vec4 pixel(vec2 uv) {
  gSalt = 1.0; float lo = fbm(uv, 9.0, 5);
  gSalt = 2.0; float mid = fbm(uv, 40.0, 3);
  float puddle = smoothstep(0.5, 0.66, lo * 0.8 + mid * 0.2);
  gSalt = 3.0; float stain = smoothstep(0.56, 0.8, fbm(uv, 22.0, 5));
  gSalt = 4.0; float tracks = fbm2(uv, vec2(4.0, 150.0), 3);
  gSalt = 5.0; vec2 cell = floor(uv * vec2(11.0, 15.0));
  vec2 cf = fract(uv * vec2(11.0, 15.0));
  float edge = smoothstep(0.0, 0.02, min(min(cf.x, 1.0 - cf.x), min(cf.y, 1.0 - cf.y)));
  float repair = step(0.82, h21(cell)) * edge;
  gSalt = 6.0; vec2 warp = 0.006 * vec2(fbm(uv, 30.0, 3), fbm(uv + 0.41, 30.0, 3));
  vec3 cr = voronoi(uv + warp, 16.0);
  float crack = smoothstep(0.006, 0.0, cr.y - cr.x) * smoothstep(0.42, 0.62, fbm(uv, 5.0, 3));
  gSalt = 7.0; float vary = fbm(uv, 14.0, 4);
  float tone = 0.5 + 0.3 * (vary - 0.5) - 0.22 * repair + 0.12 * (tracks - 0.5);
  return vec4(puddle, crack, stain, sat(tone));
}`;
