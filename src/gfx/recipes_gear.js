// 武器、手套、粒子和弹痕的贴图配方（GLSL）

// 平纹织物，幅面 0.2 m；颜色偏白，由材质 color 染色
export const fabric = /* glsl */ `
Surf surface(vec2 uv) {
  Surf s = newSurf();
  vec2 p = uv * 64.0;
  vec2 f = fract(p), i = floor(p);
  float over = mod(i.x + i.y, 2.0);
  float wx = sin(f.x * 3.14159), wy = sin(f.y * 3.14159);
  float h = mix(wx * (0.6 + 0.4 * wy), wy * (0.6 + 0.4 * wx), over);
  gSalt = 1.0; float fuzz = fbm(uv, 180.0, 2);
  gSalt = 2.0; float macro = fbm(uv, 4.0, 4);
  s.albedo = vec3(0.78) * (0.7 + 0.3 * h) * (0.85 + 0.3 * macro);
  s.height = h * 0.8 + fuzz * 0.2;
  s.rough = 0.88 + 0.1 * fuzz;
  return s;
}`;

// 原创迷彩布（袖子），幅面 0.6 m：迷彩色块 + 平纹织物起伏
export const camo = /* glsl */ `
Surf surface(vec2 uv) {
  Surf s = newSurf();
  gSalt = 1.0; float a = fbm(uv, 5.0, 4);
  gSalt = 2.0; float b = fbm(uv, 7.0, 4);
  gSalt = 3.0; float c = fbm(uv, 11.0, 3);
  gSalt = 4.0; float w = fbm(uv, 90.0, 2);
  vec3 col = vec3(0.2, 0.21, 0.15);
  col = mix(col, vec3(0.31, 0.28, 0.2), smoothstep(0.5, 0.52, a));
  col = mix(col, vec3(0.09, 0.1, 0.08), smoothstep(0.56, 0.58, b));
  col = mix(col, vec3(0.17, 0.125, 0.09), smoothstep(0.6, 0.62, c));
  vec2 p = uv * 192.0;
  vec2 f = fract(p), i = floor(p);
  float wx = sin(f.x * 3.14159), wy = sin(f.y * 3.14159);
  float h = mix(wx * (0.6 + 0.4 * wy), wy * (0.6 + 0.4 * wx), mod(i.x + i.y, 2.0));
  s.albedo = col * (0.75 + 0.25 * h) * (0.85 + 0.3 * w);
  s.height = h * 0.8 + w * 0.2;
  s.rough = 0.9;
  return s;
}`;

// 聚合物（握把、枪托、弹匣）点状防滑纹，幅面 0.06 m
export const polymer = /* glsl */ `
Surf surface(vec2 uv) {
  Surf s = newSurf();
  gSalt = 1.0; vec3 v = voronoi(uv, 28.0);
  gSalt = 2.0; float n = fbm(uv, 64.0, 3);
  float bump = smoothstep(0.5, 0.1, v.x);
  s.albedo = vec3(0.03, 0.03, 0.032) * (0.8 + 0.4 * n);
  s.height = bump * 0.7 + n * 0.3;
  s.rough = 0.56 + 0.16 * n;
  return s;
}`;

// 枪身金属：深色阳极层 + 拉丝 + 划痕露白 + 指纹油渍，幅面 0.25 m
export const gunmetal = /* glsl */ `
Surf surface(vec2 uv) {
  Surf s = newSurf();
  gSalt = 1.0; float micro = fbm(uv, 256.0, 3);
  gSalt = 2.0; float smudge = fbm(uv, 6.0, 4);
  gSalt = 3.0; float lines = fbm2(uv, vec2(4.0, 320.0), 2);
  gSalt = 4.0;
  float sc = 0.0;
  for (int i = 0; i < 3; i++) {
    vec2 q = rot(float(i) * 1.1 + 0.4) * (uv + float(i) * 0.31);
    sc = max(sc, smoothstep(0.955, 0.98, fbm2(q, vec2(9.0, 620.0), 1)));
  }
  gSalt = 5.0; float wear = smoothstep(0.62, 0.8, fbm(uv, 10.0, 4)) * 0.6;
  float bare = sat(sc * 0.8 + wear * micro);
  s.albedo = mix(vec3(0.05, 0.052, 0.055), vec3(0.42, 0.41, 0.4), bare * 0.7);
  s.height = micro * 0.6 + lines * 0.25 - sc * 0.4;
  s.rough = sat(0.46 + 0.12 * (micro - 0.5) + 0.1 * (lines - 0.5) - 0.14 * smoothstep(0.55, 0.75, smudge) - 0.12 * bare);
  s.metal = 0.82 + 0.18 * bare;
  return s;
}`;

// 刀身：缎面研磨纹（沿 u 方向）+ 石洗细痕，幅面 0.12 m
export const bladeSteel = /* glsl */ `
Surf surface(vec2 uv) {
  Surf s = newSurf();
  gSalt = 1.0; float grind = fbm2(uv, vec2(420.0, 3.0), 3);
  gSalt = 2.0; float wash = fbm(uv, 90.0, 3);
  gSalt = 3.0; float smudge = fbm(uv, 5.0, 4);
  float sc = 0.0;
  for (int i = 0; i < 3; i++) {
    vec2 q = rot(float(i) * 1.3 + 0.2) * (uv + float(i) * 0.23);
    sc = max(sc, smoothstep(0.95, 0.975, fbm2(q, vec2(11.0, 500.0), 1)));
  }
  s.albedo = vec3(0.56, 0.57, 0.58) * (0.86 + 0.2 * grind) * (1.0 - 0.25 * sc);
  s.height = grind * 0.5 + wash * 0.3 - sc * 0.3;
  s.rough = sat(0.2 + 0.16 * grind + 0.1 * wash + 0.12 * smoothstep(0.5, 0.8, smudge) + 0.15 * sc);
  s.metal = 1.0;
  return s;
}`;

// G10 柄片：层压等高线纹 + 斜向防滑槽，幅面 0.08 m
export const g10 = /* glsl */ `
Surf surface(vec2 uv) {
  Surf s = newSurf();
  gSalt = 1.0; float lay = fbm(uv, 3.0, 4);
  float bands = abs(fract(lay * 11.0) - 0.5) * 2.0;
  float groove = 0.5 + 0.5 * sin((uv.x + uv.y) * 6.2831 * 26.0);
  gSalt = 2.0; float n = fbm(uv, 128.0, 2);
  s.albedo = mix(vec3(0.018, 0.019, 0.02), vec3(0.085, 0.088, 0.09), smoothstep(0.35, 0.65, bands)) * (0.85 + 0.3 * n);
  s.height = groove * 0.7 + bands * 0.15 + n * 0.15;
  s.rough = 0.5 + 0.2 * n + 0.1 * bands;
  return s;
}`;

// 弹孔图集 2x2：金属 / 混凝土 / 木头 / 焦痕
export const bulletAtlas = /* glsl */ `
vec4 pixel(vec2 uv) {
  vec2 cell = floor(uv * 2.0);
  vec2 p = fract(uv * 2.0) * 2.0 - 1.0;
  float id = cell.x + cell.y * 2.0;
  float r = length(p), ang = atan(p.y, p.x);
  gSalt = id + 1.0;
  float n = fbm(vec2(ang / 6.2831 + 0.5, 0.3), 12.0, 3);
  float n2 = fbm(p * 0.5 + 0.5, 14.0, 3);
  vec3 col = vec3(0.0);
  float a = 0.0;
  if (id < 0.5) {
    float hole = smoothstep(0.2, 0.13, r + (n - 0.5) * 0.06);
    float ring = smoothstep(0.44 + (n - 0.5) * 0.3, 0.2, r);
    float soot = smoothstep(0.95, 0.3, r) * 0.5 * n2;
    col = mix(vec3(0.02), vec3(0.78, 0.77, 0.74), ring);
    col = mix(col, vec3(0.004), hole);
    a = max(max(hole, ring), soot);
  } else if (id < 1.5) {
    float crater = smoothstep(0.66 + (n - 0.5) * 0.5, 0.3, r);
    float hole = smoothstep(0.24, 0.08, r);
    col = mix(vec3(0.6, 0.58, 0.54) * (0.65 + 0.6 * n2), vec3(0.05), hole);
    a = crater;
  } else if (id < 2.5) {
    float e = length(p * vec2(1.0, 0.4)) + (n - 0.5) * 0.25;
    float splinter = smoothstep(0.6, 0.25, e);
    float hole = smoothstep(0.2, 0.1, r);
    col = mix(vec3(0.62, 0.5, 0.33) * (0.7 + 0.5 * n2), vec3(0.03, 0.02, 0.01), hole);
    a = max(splinter, hole);
  } else {
    a = smoothstep(0.9, 0.1, r + (n - 0.5) * 0.3) * (0.5 + 0.5 * n2);
    col = vec3(0.01);
  }
  return vec4(col, sat(a));
}`;

export const softBlob = /* glsl */ `
vec4 pixel(vec2 uv) {
  float r = length(uv * 2.0 - 1.0);
  float a = pow(sat(1.0 - r), 2.2);
  return vec4(1.0, 1.0, 1.0, a);
}`;

// 烟团 2x2 图集
export const smoke = /* glsl */ `
vec4 pixel(vec2 uv) {
  vec2 cell = floor(uv * 2.0);
  vec2 q = fract(uv * 2.0);
  vec2 p = q * 2.0 - 1.0;
  gSalt = cell.x + cell.y * 2.0 + 1.0;
  float r = length(p);
  float n = fbm(q, 4.0, 5), n2 = fbm(q + 0.31, 9.0, 4);
  float a = smoothstep(1.0, 0.25, r + (n - 0.5) * 0.7) * smoothstep(0.25, 0.75, n * 0.6 + n2 * 0.5);
  return vec4(vec3(0.55 + 0.45 * n2), a * smoothstep(1.0, 0.8, r));
}`;

// 枪口焰 2x2 图集：中心白热、外沿橙色的不规则火舌
export const flash = /* glsl */ `
vec4 pixel(vec2 uv) {
  vec2 cell = floor(uv * 2.0);
  vec2 q = fract(uv * 2.0);
  vec2 p = q * 2.0 - 1.0;
  gSalt = cell.x + cell.y * 2.0 + 1.0;
  float r = length(p), ang = atan(p.y, p.x);
  float lobes = fbm(vec2(ang / 6.2831 + 0.5, 0.2), 6.0, 3);
  float spikes = pow(abs(sin(ang * 2.5 + h21(cell) * 6.0)), 6.0);
  float reach = 0.28 + 0.5 * lobes + 0.3 * spikes * lobes;
  float body = smoothstep(reach, reach * 0.25, r);
  float core = smoothstep(0.3, 0.0, r);
  float tex = 0.6 + 0.4 * fbm(q, 12.0, 3);
  vec3 col = mix(vec3(1.0, 0.42, 0.1), vec3(1.0, 0.92, 0.7), sat(body * body + core));
  float a = sat(body * tex + core) * smoothstep(1.0, 0.85, r);
  return vec4(col * a, a);
}`;

// 镜头污渍：泛光会把它点亮
export const lensDirt = /* glsl */ `
vec4 pixel(vec2 uv) {
  float acc = 0.0;
  for (int k = 0; k < 3; k++) {
    gSalt = float(k) + 1.0;
    float f = 6.0 + float(k) * 7.0;
    vec3 v = voronoi(uv, f);
    float rad = 0.12 + 0.4 * v.z;
    acc += smoothstep(rad, rad * 0.55, v.x) * step(0.55, fract(v.z * 7.13)) * (0.25 + 0.5 * fract(v.z * 3.7));
  }
  gSalt = 9.0; float smear = fbm2(uv, vec2(3.0, 40.0), 4);
  float d = sat(acc * 0.6 + smoothstep(0.55, 0.9, smear) * 0.35);
  return vec4(vec3(d), 1.0);
}`;
