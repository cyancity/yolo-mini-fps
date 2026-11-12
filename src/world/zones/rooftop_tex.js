// 楼顶分区的三套贴图配方（GLSL，写法同 src/gfx/recipes_world.js）。

// 仓库屋面的改性沥青卷材，幅面 4 m：卷材 1 m 宽沿 x 铺，搭接缝略鼓；
// 表面撒砂、小补丁、积水干后留下的浅色水渍圈
export const MEMBRANE = /* glsl */ `
Surf surface(vec2 uv) {
  Surf s = newSurf();
  gSalt = 1.0; float macro = fbm(uv, 3.0, 5);
  gSalt = 2.0; float fine = fbm(uv, 200.0, 3);
  gSalt = 3.0; vec3 gran = voronoi(uv, 300.0);
  float rolls = 4.0;
  float rf = fract(uv.y * rolls), ri = floor(uv.y * rolls);
  float lap = smoothstep(0.0, 0.01, rf) * smoothstep(0.075, 0.06, rf);
  float seam = smoothstep(0.012, 0.0, abs(rf - 0.075));
  // 卷材端头的横向搭接，每卷错开
  float ef = fract(uv.x * 0.5 + h21(vec2(ri, 3.0)));
  float endSeam = smoothstep(0.004, 0.0, abs(ef - 0.5)) * step(0.075, rf);
  gSalt = 4.0; float pond = fbm(uv, 4.0, 4);
  float ring = smoothstep(0.03, 0.0, abs(pond - 0.62)) + smoothstep(0.05, 0.0, abs(pond - 0.58)) * 0.5;
  float stain = smoothstep(0.6, 0.72, pond);
  gSalt = 5.0; vec3 pv = voronoi(uv, 3.0);
  float patchA = step(0.86, pv.z) * step(abs(fract(uv.x * 3.0 + pv.z) - 0.5), 0.12) * step(abs(fract(uv.y * 3.0 + pv.z * 3.1) - 0.5), 0.09);
  vec3 col = vec3(0.07, 0.072, 0.076) * (0.75 + 0.5 * macro);
  col *= 0.85 + 0.3 * gran.z * smoothstep(0.5, 0.2, gran.x);
  col = mix(col, vec3(0.13, 0.125, 0.118), stain * 0.45 + ring * 0.25);
  col = mix(col, col * 0.55, max(seam, endSeam));
  col = mix(col, vec3(0.045, 0.046, 0.05), patchA * 0.8);
  // 积水暗斑：屋面微凹处常年潮着，颜色深、略亮。贴图每 4 m 重复一次，压得很淡才看不出周期；
  // 补丁不写在这里，按世界坐标另铺（rooftop_shell.js 的 roofPatches）
  gSalt = 6.0; float damp = smoothstep(0.5, 0.7, fbm(uv, 2.0, 4));
  col *= 1.0 - 0.15 * damp;
  s.albedo = col * (0.92 + 0.16 * fine);
  s.height = 0.5 + 0.22 * lap + 0.06 * fine + 0.05 * gran.z * smoothstep(0.45, 0.1, gran.x) + 0.12 * patchA - 0.1 * seam;
  s.rough = sat(0.82 + 0.1 * (fine - 0.5) - 0.25 * stain - 0.15 * patchA - 0.1 * damp);
  return s;
}`;

// 办公楼屋面的压顶卵石，幅面 1.5 m：两层不同大小的石子叠着，缝隙很暗
export const GRAVEL = /* glsl */ `
Surf surface(vec2 uv) {
  Surf s = newSurf();
  gSalt = 1.0; vec3 a = voronoi(uv, 40.0);
  gSalt = 2.0; vec3 b = voronoi(uv + vec2(0.37, 0.11), 66.0);
  gSalt = 3.0; float macro = fbm(uv, 3.0, 4);
  gSalt = 4.0; float fine = fbm(uv, 240.0, 2);
  float ha = sqrt(smoothstep(0.56, 0.06, a.x)) * (0.75 + 0.25 * a.z);
  float hb = sqrt(smoothstep(0.5, 0.06, b.x)) * (0.55 + 0.25 * b.z);
  float h = max(ha, hb);
  float id = hb > ha ? b.z : a.z;
  // 湿卵石偏暗：太亮了月光下整片屋面会发白，像积雪
  vec3 grey = mix(vec3(0.11, 0.11, 0.105), vec3(0.3, 0.295, 0.28), fract(id * 7.31));
  vec3 brown = mix(vec3(0.15, 0.125, 0.09), vec3(0.28, 0.235, 0.18), fract(id * 3.7));
  vec3 col = mix(grey, brown, step(0.7, fract(id * 13.1)));
  col *= 0.65 + 0.45 * macro;
  col *= mix(0.22, 1.0, smoothstep(0.02, 0.3, h));
  s.albedo = col * (0.9 + 0.2 * fine);
  s.height = h * 0.9 + fine * 0.05;
  s.rough = mix(0.95, 0.55, smoothstep(0.2, 0.7, h));
  s.ao = mix(0.35, 1.0, smoothstep(0.0, 0.3, h));
  return s;
}`;

// 远景楼的窗：一张图 32 开间 × 16 层（开间 1.6 m、层高 3.2 m，铺满 51.2 m 见方）。
// albedo 当自发光贴图用（只有亮着的窗有颜色），orm 的 r 压暗玻璃上的环境光，g 是粗糙度
export const CITY_WINDOWS = /* glsl */ `
Surf surface(vec2 uv) {
  Surf s = newSurf();
  vec2 g = uv * vec2(32.0, 16.0);
  vec2 c = floor(g), f = fract(g);
  float glass = step(0.1, f.x) * step(f.x, 0.9) * step(0.3, f.y) * step(f.y, 0.92);
  float pane = glass * step(0.03, abs(f.x - 0.5));
  float unit = floor(c.x / 4.0);
  float rFloor = h21(vec2(7.0, c.y));
  float rUnit = h21(vec2(unit, c.y + 40.0));
  float rCell = h21(c + vec2(0.0, 80.0));
  float lit = step(0.64, rUnit * 0.6 + rCell * 0.4 + (rFloor - 0.5) * 0.35);
  // 整层亮着的写字楼层：冷白
  float office = step(0.93, rFloor) * step(0.2, rCell);
  float hue = h21(vec2(unit + 13.0, c.y));
  vec3 col = hue < 0.45 ? vec3(1.0, 0.66, 0.34) : hue < 0.8 ? vec3(1.0, 0.85, 0.64) : vec3(0.72, 0.84, 1.0);
  col = mix(col, vec3(0.8, 0.9, 1.0), office);
  lit = max(lit, office);
  // 拉着窗帘的只亮下半截，亮度也各不相同
  float curtain = mix(1.0, 0.25 + 0.6 * smoothstep(0.85, 0.45, f.y), step(0.62, h21(c + vec2(9.0, 0.0))));
  float k = (0.3 + 0.7 * h21(c + vec2(3.0, 0.0))) * curtain;
  s.albedo = col * lit * k * pane;
  s.height = 0.5 - 0.35 * glass + 0.1 * step(abs(f.y - 0.2), 0.04);
  s.rough = mix(0.85, 0.1, glass);
  s.ao = mix(1.0, 0.3, glass);
  return s;
}`;
