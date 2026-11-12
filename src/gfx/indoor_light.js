import * as THREE from 'three';

// 室内补光：withIndoor（materials.js）共用的 uniform 和着色器片段。
// 房间盒里天光（半球补光、环境贴图）只剩 uRoomSky.z 那么多，离门窗洞近了再升回 1；
// 另加一层各房间自己的暖白环境照度（灯打到地面、墙面再反出来的那部分），办公楼按灯板密度表调制。
// 全是 uniform，不占纹理单元；数量上限写死在着色器里，数据由 world/indoor.js 填，没填时什么都不改变。
export const MAX_ROOMS = 8;
export const MAX_PORTALS = 24;
// 两个房间之间的门洞（门口混两边的房间照度）
export const MAX_LINKS = 8;
// 灯板密度表：每张 nx × nz 格（格宽 cell 米），按行存，一个 vec4 装 4 格
export const PANEL = { nx: 32, nz: 13, tables: 2, cell: 1.2 };
const PANEL_VEC = (PANEL.tables * PANEL.nz * PANEL.nx) / 4;

const far = (n, v) => new Float32Array(n * 4).fill(v);
// 数组 uniform 都用 Float32Array：three 上传时不再逐元素拷贝
export const indoorUniforms = {
  uRoomLo: { value: far(MAX_ROOMS, 1e5) },
  uRoomHi: { value: far(MAX_ROOMS, -1e5) },
  uRoomAmb: { value: new Float32Array(MAX_ROOMS * 4) },
  uRoomSky: { value: new Float32Array(MAX_ROOMS * 4) },
  uPortalC: { value: new Float32Array(MAX_PORTALS * 4) },
  uPortalH: { value: new Float32Array(MAX_PORTALS * 4) },
  // 房间之间的门：C 是中心和混合距离，H 是半尺寸和两边的房间号（a * 16 + b；-1 表示没填，循环到这里就停）
  uLinkC: { value: new Float32Array(MAX_LINKS * 4) },
  uLinkH: { value: far(MAX_LINKS, -1) },
  uPanel: { value: new Float32Array(PANEL_VEC * 4).fill(1) },
  uPanelGrid: { value: new THREE.Vector4(0, 0, 1 / PANEL.cell, 0) },
  uIndoorAll: { value: new THREE.Vector4(1e5, 1e5, -1e5, -1e5) },
  uIndoorOn: { value: 1 },
  // 房间照度按法线分配：朝上、侧面、朝下（地面反上去的）各乘多少；w 是当作周围表面反过来的辐亮度给镜面的比例
  // （平均反照率 0.35 / π，金属件只吃这一项）
  uIndoorK: { value: new THREE.Vector4(1, 0.6, 0.45, 0.35 / Math.PI) },
};

export const indoorPars = /* glsl */ `
#define IN_ROOMS ${MAX_ROOMS}
#define IN_PORTALS ${MAX_PORTALS}
#define IN_LINKS ${MAX_LINKS}
#define IN_NX ${PANEL.nx}.0
#define IN_NZ ${PANEL.nz}.0
uniform vec4 uRoomLo[IN_ROOMS];
uniform vec4 uRoomHi[IN_ROOMS];
uniform vec4 uRoomAmb[IN_ROOMS];
uniform vec4 uRoomSky[IN_ROOMS];
uniform vec4 uPortalC[IN_PORTALS];
uniform vec4 uPortalH[IN_PORTALS];
uniform vec4 uLinkC[IN_LINKS];
uniform vec4 uLinkH[IN_LINKS];
uniform vec4 uPanel[${PANEL_VEC}];
uniform vec4 uPanelGrid;
uniform vec4 uIndoorAll;
uniform float uIndoorOn;
uniform vec4 uIndoorK;
float gSkyVis = 1.0;
vec3 gRoomIrr = vec3(0.0);
float inPanelAt(float t, vec2 c) {
  float i = (t * IN_NZ + c.y) * IN_NX + c.x;
  float q = floor(i * 0.25);
  return dot(uPanel[int(q)], vec4(equal(vec4(i - q * 4.0), vec4(0.0, 1.0, 2.0, 3.0))));
}
float inPanel(float t, vec2 xz) {
  vec2 g = clamp((xz - uPanelGrid.xy) * uPanelGrid.z - 0.5, vec2(0.0), vec2(IN_NX, IN_NZ) - 1.001);
  vec2 c = floor(g), f = g - c;
  return mix(mix(inPanelAt(t, c), inPanelAt(t, c + vec2(1.0, 0.0)), f.x),
             mix(inPanelAt(t, c + vec2(0.0, 1.0)), inPanelAt(t, c + vec2(1.0, 1.0)), f.x), f.y);
}
// 某个房间在这一点、这个朝向上的房间照度
vec3 inRoomIrr(int room, vec3 p, vec3 n) {
  vec4 a = uRoomAmb[room];
  float k = mix(uIndoorK.y, n.y > 0.0 ? uIndoorK.x : uIndoorK.z, abs(n.y));
  // 墙面按它前面 0.6 米处取密度：照到墙上的是屋里的灯，密度表的格子又粗，贴墙那格常常落在墙外
  if (a.w >= 0.0) k *= inPanel(a.w, p.xz + n.xz * 0.6);
  return a.rgb * k;
}
// p 世界坐标，n 世界法线。房间按顺序找第一个装得下的；只算这个房间自己的洞口
void indoorShade(vec3 p, vec3 n) {
  if (uIndoorOn < 0.5 || any(lessThan(p.xz, uIndoorAll.xy)) || any(greaterThan(p.xz, uIndoorAll.zw))) return;
  int room = -1;
  for (int i = 0; i < IN_ROOMS; i++) {
    if (all(greaterThanEqual(p, uRoomLo[i].xyz)) && all(lessThanEqual(p, uRoomHi[i].xyz))) { room = i; break; }
  }
  if (room < 0) return;
  vec4 s = uRoomSky[room];
  float open = 0.0;
  for (int j = 0; j < IN_PORTALS; j++) {
    if (float(j) < s.x) continue;
    if (float(j) >= s.y) break;
    vec4 c = uPortalC[j];
    float d = length(max(abs(p - c.xyz) - uPortalH[j].xyz, 0.0));
    open = max(open, uPortalH[j].w * (1.0 - smoothstep(0.15 * c.w, c.w, d)));
  }
  float sky = s.z;
  vec3 irr = inRoomIrr(room, p, n);
  // 房间之间的门：门洞里两边各取一半，离门越远越回到自己房间的值，所以跨过墙中线是连续的
  for (int j = 0; j < IN_LINKS; j++) {
    vec4 h = uLinkH[j];
    if (h.w < 0.0) break;
    float ra = floor(h.w / 16.0 + 0.01), rb = h.w - ra * 16.0;
    int other = room == int(ra) ? int(rb + 0.01) : room == int(rb + 0.01) ? int(ra) : -1;
    if (other < 0) continue;
    vec4 c = uLinkC[j];
    float w = 0.5 * (1.0 - smoothstep(0.0, c.w, length(max(abs(p - c.xyz) - h.xyz, 0.0))));
    if (w <= 0.0) continue;
    irr = mix(irr, inRoomIrr(other, p, n), w);
    sky = mix(sky, uRoomSky[other].z, w);
  }
  gSkyVis = mix(sky, 1.0, open);
  gRoomIrr = irr;
}
`;

// 加在 lights_fragment_end 前面：房间照度进 IBL 那一路（漫反射和多次散射都吃它），镜面再给一点
export const indoorApply = /* glsl */ `
#if defined( RE_IndirectDiffuse ) && defined( RE_IndirectSpecular )
  iblIrradiance += gRoomIrr;
  radiance += gRoomIrr * uIndoorK.w;
#endif
`;
