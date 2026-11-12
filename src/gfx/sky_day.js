import * as THREE from 'three';

// 白天和下午的天空：大气渐变、太阳和它周围的光晕、被太阳照亮的碎云。
// 颜色全由时段预设给（线性亮度，可以大于 1）；夜空是另一套，在 sky.js 里。
// 拼在 sky.js 的片元着色器里用，依赖那边的 uSunDir、uTime 和 fbm。
export const daySkyGLSL = /* glsl */ `
uniform vec3 uZenith;     // 天顶
uniform vec3 uHorizon;    // 地平线（背着太阳的一侧）
uniform vec3 uGlow;       // 朝太阳一侧的天色，也是太阳光晕的颜色
uniform vec3 uDisc;       // 日面亮度。烤环境贴图时清零：阳光已经由平行光给了，不能再算一遍
uniform vec3 uCloudLit;   // 云的受光面
uniform vec3 uCloudDark;  // 云底
uniform vec4 uCloud;      // 覆盖阈值（越小云越多）、边缘宽度、不透明度、厚云压暗的程度
uniform vec3 uBelow;      // 地平线以下：环境贴图的下半球，低画质不画海面时也看得到

float cloudField(vec2 p) { return fbm(p * 1.3) * 0.65 + fbm(p * 3.7 + 9.0) * 0.35; }

vec3 daySky(vec3 d) {
  float y = d.y;
  float t = clamp(y, 0.0, 1.0);
  vec3 sd = normalize(uSunDir);
  float mu = dot(d, sd);
  float m01 = clamp(mu * 0.5 + 0.5, 0.0, 1.0);
  float away = 1.0 - mu;
  float az = dot(normalize(d.xz + 1e-5), normalize(sd.xz + 1e-5)) * 0.5 + 0.5;

  // 大气：越靠近地平线越亮越白。朝太阳的一侧是换成暖色而不是往上叠：蓝加橙会发粉
  vec3 col = mix(uHorizon, uZenith, pow(t, 0.5));
  col = mix(col, uGlow, clamp(pow(az, 3.0) * exp(-t * 4.0) * 0.55 + pow(m01, 8.0) * 0.5, 0.0, 0.85));
  vec3 air = col;
  // 太阳周围的光晕：一圈窄的、一圈宽的。泛光的第一级会压掉小而亮的点，日面的晕只能在这里画
  vec3 glare = uGlow * (exp(-away * 700.0) * 2.4 + exp(-away * 60.0) * 0.7);

  vec3 cloud = vec3(0.0);
  float cov = 0.0;
  if (y > 0.0) {
    vec2 c0 = d.xz / (y + 0.14) * 0.9;
    vec2 cp = c0 + vec2(uTime * 0.004, uTime * 0.0015);
    float n = cloudField(cp);
    cov = smoothstep(uCloud.x, uCloud.x + uCloud.y, n) * smoothstep(0.0, 0.1, y) * uCloud.z;
    // 朝太阳挪一小步再取一次密度：往太阳那边变薄的是受光面，变厚的在背阴里
    vec2 toSun = sd.xz / (max(sd.y, 0.0) + 0.14) * 0.9 - c0;
    float n2 = cloudField(cp + normalize(toSun + 1e-4) * 0.22);
    float lit = mix(0.6, clamp(0.5 + (n - n2) * 3.0, 0.0, 1.0), clamp(length(toSun) * 1.2, 0.0, 1.0));
    float thick = smoothstep(uCloud.x, uCloud.x + 0.4, n);
    cloud = mix(uCloudDark, uCloudLit, lit * (1.0 - uCloud.w * thick));
    // 逆光的云：薄的地方透亮，厚的地方反而压暗
    float back = pow(m01, 12.0);
    cloud = mix(cloud, uCloudDark * 0.75, back * thick * 0.6);
    cloud += uGlow * (back * 0.9 + exp(-away * 60.0) * 1.2) * (1.0 - thick);
    // 远处的云融进地平线的雾气里
    cloud = mix(cloud, air, exp(-y * 7.0) * 0.8);
  } else {
    col = mix(col, uBelow, smoothstep(0.0, -0.12, y));
  }
  // 日面被云遮住时不能还是个硬边的白点：按透过率的平方再压一次
  float clear = 1.0 - cov;
  col += glare + uDisc * smoothstep(0.99982, 0.9999, mu) * clear * clear;
  return mix(col, cloud, cov);
}`;

export function dayUniforms() {
  const v = () => ({ value: new THREE.Vector3() });
  return {
    uZenith: v(), uHorizon: v(), uGlow: v(), uDisc: v(), uCloudLit: v(), uCloudDark: v(), uBelow: v(),
    uCloud: { value: new THREE.Vector4(0.5, 0.3, 0.9, 0.5) },
  };
}
