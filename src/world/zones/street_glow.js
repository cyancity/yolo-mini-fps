import * as THREE from 'three';
import { LabelAtlas, STENCIL_FONT } from '../labels.js';

// 自发光画布（1024²）：霓虹字、灯箱、窗里的屋子、广告灯箱、监控屏。
// 画进去的亮度就是发光亮度（材质 emissiveIntensity 统一放大），所以屋里画得暗，霓虹灯芯画成白。
// 店名全是编的。
const CN = '"Microsoft YaHei UI", "Microsoft YaHei", "PingFang SC", sans-serif';

// 固定排版：[x, y, w, h]
const LAYOUT = {
  bladeInn: [0, 0, 112, 480], bladeSpa: [116, 0, 112, 480], ad: [232, 0, 240, 480],
  door: [476, 0, 120, 240], frosted: [600, 0, 424, 240],
  room0: [476, 244, 128, 128], room1: [608, 244, 128, 128], room2: [740, 244, 128, 128], room3: [872, 244, 128, 128],
  room4: [476, 376, 128, 128], room5: [608, 376, 128, 128],
  screen: [740, 376, 128, 80], panel: [872, 376, 128, 40], amber: [872, 420, 48, 48],
  cross: [0, 484, 112, 112], noodle: [116, 484, 512, 128], mart: [632, 484, 392, 128],
  innEn: [0, 616, 512, 96], pharm: [516, 616, 400, 96], open: [920, 616, 104, 96],
  dim0: [0, 716, 128, 128], dim1: [128, 716, 128, 128], dim2: [256, 716, 128, 128], dim3: [384, 716, 128, 128], backWin: [516, 716, 256, 256], backWin2: [776, 716, 248, 256],
  garage: [0, 848, 320, 128], garageFloor: [324, 848, 128, 128],
};

// 汽修铺里面：亮着灯管的后墙、工具板、轮胎，从半开的卷帘门底下看进去
function garage(c, w, h, rand) {
  const g = c.createLinearGradient(0, 0, 0, h);
  g.addColorStop(0, '#8e9088'); g.addColorStop(1, '#4a4740');
  c.fillStyle = g; c.fillRect(0, 0, w, h);
  c.fillStyle = '#3a3e3a'; c.fillRect(20, 14, 120, 60);
  for (let i = 0; i < 26; i++) { c.fillStyle = rand() < 0.3 ? '#a8241a' : '#1c1e1e'; c.fillRect(26 + (i % 9) * 13, 18 + Math.floor(i / 9) * 18, 4, 10 + rand() * 6); }
  c.fillStyle = '#9c2418'; c.fillRect(160, 56, 70, h - 56);
  c.fillStyle = '#5a140e'; for (let y = 64; y < h - 8; y += 14) c.fillRect(164, y, 62, 3);
  c.fillStyle = '#111';
  for (let i = 0; i < 3; i++) { c.beginPath(); c.ellipse(268, h - 14 - i * 22, 30, 12, 0, 0, 6.28); c.fill(); }
  c.fillStyle = 'rgba(20,20,18,0.35)'; c.fillRect(0, h - 10, w, 10);
}

function garageFloor(c, w, h, rand) {
  const g = c.createLinearGradient(0, 0, w, 0);
  g.addColorStop(0, '#1e1c19'); g.addColorStop(1, '#4e4a42');
  c.fillStyle = g; c.fillRect(0, 0, w, h);
  for (let i = 0; i < 9; i++) {
    c.fillStyle = 'rgba(10,8,6,0.45)';
    c.beginPath(); c.ellipse(rand() * w, rand() * h, 6 + rand() * 18, 4 + rand() * 10, rand() * 3, 0, 6.28); c.fill();
  }
}

function neon(c, text, x, y, size, color, font = CN, weight = 700) {
  c.save();
  c.font = `${weight} ${size}px ${font}`;
  c.textAlign = 'center';
  c.textBaseline = 'middle';
  c.lineJoin = 'round';
  c.shadowColor = color;
  c.shadowBlur = size * 0.45;
  c.strokeStyle = color;
  c.lineWidth = size * 0.09;
  c.strokeText(text, x, y);
  c.shadowBlur = size * 0.1;
  c.lineWidth = size * 0.03;
  c.strokeStyle = '#ffe8e0';
  c.strokeText(text, x, y);
  c.restore();
}

// 霓虹边框
function tubeRect(c, x, y, w, h, color, r = 10) {
  c.save();
  c.shadowColor = color; c.shadowBlur = 12; c.strokeStyle = color; c.lineWidth = 5;
  c.beginPath(); c.roundRect(x, y, w, h, r); c.stroke();
  c.shadowBlur = 3; c.lineWidth = 2; c.strokeStyle = '#fff'; c.stroke();
  c.restore();
}

// 窗里的屋子：墙面渐变 + 顶灯光斑 + 家具剪影 + 窗帘或百叶
function room(c, w, h, rand, i) {
  const tones = [['#6b4a2c', '#24170c'], ['#3d5160', '#101820'], ['#70583a', '#2a1d10'], ['#5d5a45', '#1c1b12'], ['#6a3f2a', '#20120b'], ['#4c5866', '#141a20']];
  const [a, b] = tones[i % tones.length];
  const g = c.createLinearGradient(0, 0, 0, h);
  g.addColorStop(0, a); g.addColorStop(1, b);
  c.fillStyle = g; c.fillRect(0, 0, w, h);
  const lx = w * (0.3 + rand() * 0.4);
  const rg = c.createRadialGradient(lx, h * 0.1, 2, lx, h * 0.1, w * 0.7);
  rg.addColorStop(0, i % 3 === 1 ? 'rgba(200,225,255,0.55)' : 'rgba(255,214,150,0.6)');
  rg.addColorStop(1, 'rgba(0,0,0,0)');
  c.fillStyle = rg; c.fillRect(0, 0, w, h);
  c.fillStyle = 'rgba(8,6,4,0.85)';
  // 柜子、沙发靠背、一个人影
  c.fillRect(rand() * w * 0.3, h * 0.62, w * (0.3 + rand() * 0.2), h * 0.38);
  if (rand() < 0.6) c.fillRect(w * 0.55, h * 0.75, w * 0.45, h * 0.25);
  if (i === 2 || i === 4) {
    const px = w * (0.45 + rand() * 0.2);
    c.beginPath(); c.arc(px, h * 0.48, w * 0.06, 0, 6.28); c.fill();
    c.beginPath(); c.roundRect(px - w * 0.09, h * 0.54, w * 0.18, h * 0.5, 8); c.fill();
  }
  if (i % 2 === 0) {
    // 窗帘：两边垂下的褶子
    for (const side of [0, 1]) {
      const cw = w * (0.18 + rand() * 0.22);
      for (let k = 0; k < 6; k++) {
        const x = side ? w - cw + (k * cw) / 6 : (k * cw) / 6;
        c.fillStyle = k % 2 ? 'rgba(120,60,40,0.75)' : 'rgba(70,32,22,0.8)';
        c.fillRect(x, 0, cw / 6 + 1, h);
      }
    }
  } else {
    // 百叶
    const open = 0.3 + rand() * 0.5;
    for (let y = 0; y < h * open; y += 7) { c.fillStyle = 'rgba(190,190,180,0.32)'; c.fillRect(0, y, w, 4); }
  }
}

// 没开灯的窗：画得很暗，只留一点窗帘褶子、百叶缝里的电视蓝光、天花板上的街灯反光，
// 看上去是黑着的屋子而不是一块和墙一个颜色的反光板
function dimRoom(c, w, h, i) {
  c.fillStyle = '#060504'; c.fillRect(0, 0, w, h);
  if (i === 0) {
    // 拉严的厚窗帘，中缝漏一线暖光
    for (let k = 0; k < 16; k++) { c.fillStyle = k % 2 ? '#1c140d' : '#0d0906'; c.fillRect((k * w) / 16, 0, w / 16 + 1, h); }
    const g = c.createLinearGradient(w * 0.44, 0, w * 0.56, 0);
    g.addColorStop(0, 'rgba(0,0,0,0)'); g.addColorStop(0.5, 'rgba(150,100,50,0.85)'); g.addColorStop(1, 'rgba(0,0,0,0)');
    c.fillStyle = g; c.fillRect(w * 0.44, h * 0.05, w * 0.12, h * 0.9);
  } else if (i === 1) {
    // 百叶放下，屋里开着电视
    const rg = c.createRadialGradient(w * 0.35, h * 0.72, 2, w * 0.35, h * 0.72, w * 0.6);
    rg.addColorStop(0, 'rgba(46,70,110,0.95)'); rg.addColorStop(1, 'rgba(0,0,0,0)');
    c.fillStyle = rg; c.fillRect(0, 0, w, h);
    for (let y = 0; y < h; y += 6) { c.fillStyle = 'rgba(22,22,22,0.92)'; c.fillRect(0, y, w, 3); }
  } else if (i === 2) {
    // 黑着的屋子：天花板上一片街灯的反光，柜子和椅背的剪影
    const g = c.createLinearGradient(0, 0, 0, h);
    g.addColorStop(0, '#241a10'); g.addColorStop(0.45, '#0b0806'); g.addColorStop(1, '#050403');
    c.fillStyle = g; c.fillRect(0, 0, w, h);
    c.fillStyle = '#020202'; c.fillRect(w * 0.08, h * 0.42, w * 0.34, h * 0.58); c.fillRect(w * 0.6, h * 0.68, w * 0.4, h * 0.32);
  } else {
    // 报纸糊住的空屋窗（摆法写死，不动分区随机数的序列，别处的摆放才不会跟着变）
    c.fillStyle = '#17140f'; c.fillRect(0, 0, w, h);
    for (let k = 0; k < 6; k++) {
      c.fillStyle = `rgba(${44 + k * 5},${40 + k * 4},${30 + k * 3},0.75)`;
      c.fillRect(((k * 37) % 60) / 100 * w, ((k * 53) % 60) / 100 * h, w * (0.3 + (k % 3) * 0.08), h * (0.32 + (k % 2) * 0.12));
    }
    c.fillStyle = 'rgba(0,0,0,0.55)'; c.fillRect(0, 0, w, h * 0.1);
  }
}

function frosted(c, w, h) {
  c.fillStyle = '#7a6244'; c.fillRect(0, 0, w, h);
  c.save();
  c.filter = 'blur(9px)';
  c.fillStyle = '#b89a6a'; c.fillRect(0, 0, w, h * 0.35);
  c.fillStyle = '#7a5a36';
  for (let i = 0; i < 4; i++) c.fillRect(30 + i * 100, 40, 70, 60);
  c.fillStyle = '#4a3420'; c.fillRect(0, h * 0.68, w, h * 0.32);
  c.fillStyle = '#3a2818';
  c.beginPath(); c.arc(w * 0.62, h * 0.42, 22, 0, 6.28); c.fill();
  c.fillRect(w * 0.62 - 30, h * 0.47, 60, h * 0.3);
  c.beginPath(); c.arc(w * 0.3, h * 0.5, 18, 0, 6.28); c.fill();
  c.fillRect(w * 0.3 - 24, h * 0.55, 48, h * 0.3);
  c.restore();
  // 磨砂贴膜上的透明字带
  c.fillStyle = 'rgba(40,28,16,0.35)'; c.fillRect(0, h * 0.4, w, 46);
  c.fillStyle = 'rgba(200,170,120,0.6)';
  c.font = `700 34px ${CN}`; c.textAlign = 'center'; c.textBaseline = 'middle';
  c.fillText('手 工 拉 面 · 牛 骨 汤 · 夜 宵', w / 2, h * 0.4 + 23);
}

function door(c, w, h) {
  const g = c.createLinearGradient(0, 0, 0, h);
  g.addColorStop(0, '#e8cfa0'); g.addColorStop(0.6, '#8a6a44'); g.addColorStop(1, '#3a2a18');
  c.fillStyle = g; c.fillRect(0, 0, w, h);
  c.fillStyle = 'rgba(30,20,12,0.9)'; c.fillRect(w * 0.15, h * 0.62, w * 0.7, h * 0.2);
  c.fillStyle = 'rgba(255,230,180,0.9)'; c.fillRect(w * 0.2, h * 0.04, w * 0.6, 6);
  c.fillStyle = '#1a1410'; c.fillRect(w / 2 - 2, 0, 4, h);
  c.fillRect(0, 0, 6, h); c.fillRect(w - 6, 0, 6, h);
  c.fillStyle = 'rgba(200,40,30,0.8)'; c.font = `700 14px ${CN}`; c.textAlign = 'center';
  c.fillText('推 PUSH', w * 0.28, h * 0.5); c.fillText('拉 PULL', w * 0.72, h * 0.5);
}

function ad(c, w, h) {
  const g = c.createLinearGradient(0, 0, 0, h);
  g.addColorStop(0, '#0d6f8a'); g.addColorStop(1, '#0a2a46');
  c.fillStyle = g; c.fillRect(0, 0, w, h);
  c.fillStyle = 'rgba(255,255,255,0.12)';
  for (let i = 0; i < 18; i++) { c.beginPath(); c.arc((i * 53) % w, 60 + ((i * 97) % 300), 4 + (i % 5) * 3, 0, 6.28); c.fill(); }
  // 瓶子
  c.fillStyle = '#d8f3f0';
  c.beginPath(); c.roundRect(w / 2 - 34, 150, 68, 190, 22); c.fill();
  c.fillRect(w / 2 - 14, 112, 28, 50);
  c.fillStyle = '#e04a2a'; c.fillRect(w / 2 - 34, 220, 68, 54);
  c.fillStyle = '#fff'; c.textAlign = 'center';
  c.font = `800 44px ${CN}`; c.fillText('海盐苏打', w / 2, 400);
  c.font = `700 22px ${STENCIL_FONT}`; c.fillText('SEA SALT SODA', w / 2, 432);
  c.font = `500 18px ${CN}`; c.fillText('冰 爽 上 市', w / 2, 462);
  c.font = `700 18px ${STENCIL_FONT}`; c.fillStyle = '#ffe9c0'; c.fillText('NEW', w / 2, 247);
}

function windowGrid(c, w, h, rand, cols, rows) {
  c.fillStyle = '#050608'; c.fillRect(0, 0, w, h);
  const cw = w / cols, rh = h / rows;
  for (let j = 0; j < rows; j++) for (let i = 0; i < cols; i++) {
    const lit = rand() < 0.3, x = i * cw + cw * 0.18, y = j * rh + rh * 0.22;
    c.fillStyle = lit ? (rand() < 0.7 ? '#7a5a34' : '#3e5466') : '#0d1014';
    c.fillRect(x, y, cw * 0.64, rh * 0.56);
    if (lit && rand() < 0.5) { c.fillStyle = 'rgba(20,12,6,0.7)'; c.fillRect(x, y, cw * 0.25, rh * 0.56); }
  }
}

function paintAll(atlas, rand) {
  const c = atlas.ctx;
  const put = (key, draw) => {
    const [x, y, w, h] = LAYOUT[key];
    c.save(); c.translate(x, y); c.beginPath(); c.rect(0, 0, w, h); c.clip();
    c.fillStyle = '#000'; c.fillRect(0, 0, w, h);
    draw(c, w, h);
    c.restore();
  };
  put('bladeInn', (c, w, h) => {
    tubeRect(c, 8, 8, w - 16, h - 16, '#ff2d6a', 14);
    ['海', '雾', '旅', '社'].forEach((ch, i) => neon(c, ch, w / 2, 70 + i * 108, 78, '#ff3a78'));
  });
  put('bladeSpa', (c, w, h) => {
    tubeRect(c, 8, 8, w - 16, h - 16, '#9a4dff', 14);
    ['足', '疗', '养', '生'].forEach((ch, i) => neon(c, ch, w / 2, 70 + i * 108, 74, '#b06bff'));
  });
  put('ad', ad);
  put('door', door);
  put('frosted', frosted);
  for (let i = 0; i < 6; i++) put(`room${i}`, (c, w, h) => room(c, w, h, rand, i));
  put('screen', (c, w, h) => {
    for (let k = 0; k < 4; k++) {
      const x = (k % 2) * (w / 2), y = Math.floor(k / 2) * (h / 2);
      c.fillStyle = k === 2 ? '#1c2a22' : '#2c3a36'; c.fillRect(x + 1, y + 1, w / 2 - 2, h / 2 - 2);
      c.fillStyle = 'rgba(160,200,180,0.35)'; c.fillRect(x + 6, y + h / 4, w / 2 - 12, 6);
    }
    c.fillStyle = '#cfe'; c.font = '9px monospace'; c.fillText('CAM 03  02:47', 4, h - 4);
  });
  put('panel', (c, w, h) => { c.fillStyle = '#e8eef2'; c.fillRect(4, 4, w - 8, h - 8); });
  put('amber', (c, w, h) => {
    const g = c.createRadialGradient(w / 2, h / 2, 2, w / 2, h / 2, w / 2);
    g.addColorStop(0, '#fff2c0'); g.addColorStop(0.5, '#ffa020'); g.addColorStop(1, '#5a2a00');
    c.fillStyle = g; c.fillRect(0, 0, w, h);
  });
  put('cross', (c, w, h) => {
    c.save(); c.shadowColor = '#22ff66'; c.shadowBlur = 16; c.fillStyle = '#3bff7a';
    c.fillRect(w * 0.36, 10, w * 0.28, h - 20); c.fillRect(10, h * 0.36, w - 20, h * 0.28);
    c.shadowBlur = 0; c.fillStyle = '#c8ffd8';
    c.fillRect(w * 0.44, 18, w * 0.12, h - 36); c.fillRect(18, h * 0.44, w - 36, h * 0.12);
    c.restore();
  });
  put('noodle', (c, w, h) => {
    neon(c, '夜面馆', 150, h / 2, 74, '#ff8a2a');
    neon(c, 'LATE NOODLES', 380, h / 2 - 16, 30, '#ffd36a', STENCIL_FONT);
    neon(c, '营业至 03:00', 380, h / 2 + 26, 26, '#ff5a3a');
  });
  put('mart', (c, w, h) => {
    c.fillStyle = '#1d6fb8'; c.fillRect(0, 0, w, h);
    c.fillStyle = '#f4f8ff'; c.font = `800 62px ${CN}`; c.textBaseline = 'middle'; c.textAlign = 'left';
    c.fillText('24h', 16, h / 2 + 2);
    c.font = `800 50px ${CN}`; c.fillText('便利店', 140, h / 2 - 16);
    c.font = `700 24px ${STENCIL_FONT}`; c.fillText('MINI MART · 鲜食 烟酒 日杂', 142, h / 2 + 32, w - 150);
  });
  put('innEn', (c, w, h) => neon(c, 'SEA MIST INN', w / 2, h / 2, 60, '#38e8ff', STENCIL_FONT));
  put('pharm', (c, w, h) => {
    c.fillStyle = '#0f7a3c'; c.fillRect(0, 0, w, h);
    c.fillStyle = '#f2fff6'; c.font = `800 52px ${CN}`; c.textAlign = 'center'; c.textBaseline = 'middle';
    c.fillText('康民大药房', w / 2, h / 2 - 8);
    c.font = `600 18px ${STENCIL_FONT}`; c.fillText('KANGMIN PHARMACY · 夜间售药窗口', w / 2, h - 14);
  });
  put('open', (c, w, h) => { neon(c, 'OPEN', w / 2, h * 0.3, 30, '#ff3020', STENCIL_FONT); neon(c, '营业中', w / 2, h * 0.75, 26, '#ff3020'); });
  for (let i = 0; i < 4; i++) put(`dim${i}`, (c, w, h) => dimRoom(c, w, h, i));
  put('garage', (c, w, h) => garage(c, w, h, rand));
  put('garageFloor', (c, w, h) => garageFloor(c, w, h, rand));
  put('backWin', (c, w, h) => windowGrid(c, w, h, rand, 4, 5));
  put('backWin2', (c, w, h) => windowGrid(c, w, h, rand, 3, 4));
}

export class Glow {
  constructor(rand) {
    this.atlas = new LabelAtlas(1024, 1024);
    this.rects = {};
    for (const [k, [x, y, w, h]] of Object.entries(LAYOUT)) this.rects[k] = [x / 1024, 1 - (y + h) / 1024, (x + w) / 1024, 1 - y / 1024];
    paintAll(this.atlas, rand);
  }

  // 居中的平面（朝 +Z），UV 落在画布的某一块上
  quad(key, w, h) {
    const r = this.rects[key], g = new THREE.PlaneGeometry(w, h), uv = g.attributes.uv;
    for (let i = 0; i < uv.count; i++) uv.setXY(i, r[0] + uv.getX(i) * (r[2] - r[0]), r[1] + uv.getY(i) * (r[3] - r[1]));
    return g;
  }

  // 建完调用：画布转成贴图挂到发光材质上
  finish(materials) {
    this.atlas.finish();
    for (const m of materials) {
      m.emissiveMap = this.atlas.material.map;
      m.needsUpdate = true;
    }
  }
}
