import { mulberry32, STENCIL_FONT } from '../labels.js';
import { UI_FONT } from './office_layout.js';

// 会议室大屏的六路监控：原创的港区俯视示意画面，带时间戳、录制红点、扫描线和噪点。
// 大屏是发光材质，贴花是压在上面的半透明层，画面越亮的地方贴花越透、透出屏幕的光。
// 所以每路先在离屏画布上画一张普通的彩色画面，再逐像素按亮度反推不透明度；字和边框用 destination-out 抠透
const TW = 160, TH = 132;

const fill = (g, col, x, y, w, h) => { g.fillStyle = col; g.fillRect(x, y, w, h); };
const pick = (r, list) => list[Math.floor(r() * list.length)];
const BOX = ['#8a3b26', '#2d5d8a', '#3f6b45', '#9a9a92', '#b06a2a', '#6d2f2f', '#c9c3b2'];

// 一只集装箱的顶面：底色、横向波纹、两端门框，右下压一道影子
function container(g, r, x, y, w, h) {
  fill(g, 'rgba(0,0,0,0.45)', x + 2, y + 2, w, h);
  fill(g, pick(r, BOX), x, y, w, h);
  g.fillStyle = 'rgba(0,0,0,0.22)';
  if (h > w) for (let k = y + 2; k < y + h - 1; k += 2) g.fillRect(x, k, w, 1);
  else for (let k = x + 2; k < x + w - 1; k += 2) g.fillRect(k, y, 1, h);
  g.strokeStyle = 'rgba(255,255,255,0.18)'; g.lineWidth = 1; g.strokeRect(x + 0.5, y + 0.5, w - 1, h - 1);
}

function asphalt(g, r, col = '#34383a') {
  fill(g, col, 0, 0, TW, TH);
  for (let i = 0; i < 260; i++) fill(g, `rgba(${r() < 0.5 ? '0,0,0' : '255,255,255'},${0.05 + r() * 0.08})`, r() * TW, r() * TH, 1 + r() * 3, 1 + r() * 3);
}

function dashes(g, x0, y0, x1, y1, col, on = 6, off = 5, w = 1.5) {
  g.strokeStyle = col; g.lineWidth = w; g.setLineDash([on, off]);
  g.beginPath(); g.moveTo(x0, y0); g.lineTo(x1, y1); g.stroke(); g.setLineDash([]);
}

// 堆场：三排竖着摆的箱子，中间两条通道，一台跨运车
function yard(g, r) {
  asphalt(g, r);
  for (const x of [52, 108]) { dashes(g, x, 0, x, TH, 'rgba(225,190,60,0.85)'); fill(g, 'rgba(230,230,220,0.6)', x - 14, 0, 1, TH); fill(g, 'rgba(230,230,220,0.6)', x + 13, 0, 1, TH); }
  for (const [x0, cols] of [[4, 3], [70, 3], [124, 3]]) {
    for (let c = 0; c < cols; c++) for (let row = 0; row < 3; row++) {
      if (r() < 0.15) continue;
      container(g, r, x0 + c * 11, 4 + row * 44, 10, 40);
    }
  }
  fill(g, 'rgba(0,0,0,0.5)', 99, 61, 22, 30); fill(g, '#c7a12a', 96, 58, 22, 30); fill(g, '#2c2c2c', 100, 64, 14, 18);
}

// 码头前沿：左边是水和靠泊的船，中间是带黄色边线的岸线，岸桥的两条轨道
function quay(g, r) {
  fill(g, '#1b262e', 0, 0, 62, TH);
  for (let i = 0; i < 70; i++) fill(g, `rgba(170,200,220,${0.05 + r() * 0.12})`, r() * 60, r() * TH, 3 + r() * 8, 1);
  g.fillStyle = 'rgba(0,0,0,0.5)'; g.fillRect(8, -4, 40, TH + 8);
  g.fillStyle = '#4b4f52'; g.beginPath(); g.moveTo(6, -6); g.lineTo(44, -6); g.lineTo(44, 120); g.quadraticCurveTo(25, 140, 6, 120); g.closePath(); g.fill();
  for (let row = 0; row < 5; row++) for (let c = 0; c < 3; c++) container(g, r, 10 + c * 11, 2 + row * 23, 10, 21);
  fill(g, '#7f817c', 62, 0, TW - 62, TH);
  for (let i = 0; i < 200; i++) fill(g, `rgba(0,0,0,${r() * 0.12})`, 62 + r() * 98, r() * TH, 2, 2);
  fill(g, '#d8b43a', 63, 0, 3, TH);
  for (let y = 10; y < TH; y += 30) { g.fillStyle = '#222'; g.beginPath(); g.arc(70, y, 2.5, 0, 7); g.fill(); }
  for (const x of [84, 132]) fill(g, 'rgba(40,40,40,0.9)', x, 0, 2, TH);
  fill(g, 'rgba(0,0,0,0.45)', 80, 44, 62, 14); fill(g, '#a8402a', 78, 40, 62, 12); fill(g, '#5a2016', 80, 36, 8, 20); fill(g, '#5a2016', 128, 36, 8, 20);
}

// 闸口：两条车道、岗亭、栏杆，一辆进场的集卡
function gate(g, r) {
  asphalt(g, r, '#3a3c3d');
  fill(g, '#5e605c', 0, 0, 30, TH); fill(g, '#5e605c', 130, 0, 30, TH);
  dashes(g, 80, 0, 80, TH, 'rgba(235,235,230,0.85)', 8, 6);
  fill(g, 'rgba(235,235,230,0.8)', 30, 74, 100, 3);
  fill(g, 'rgba(0,0,0,0.5)', 76, 62, 12, 20); fill(g, '#b8b6ae', 74, 60, 12, 20); fill(g, '#2a3a48', 76, 63, 8, 6);
  for (let x = 34; x < 74; x += 8) fill(g, x % 16 ? '#d23a2a' : '#e8e8e2', x, 66, 8, 2);
  fill(g, 'rgba(0,0,0,0.5)', 100, 22, 18, 74); fill(g, '#2d5d8a', 98, 86, 16, 14); fill(g, '#151a1e', 100, 94, 12, 4);
  container(g, r, 98, 20, 16, 62);
}

// 卸货场：上方是仓库的卸货门，几辆倒进车位的货车，地上散着托盘和一台叉车
function apron(g, r) {
  asphalt(g, r, '#6a6a65');
  fill(g, '#4c4f52', 0, 0, TW, 26); fill(g, 'rgba(0,0,0,0.35)', 0, 26, TW, 4);
  for (let x = 6; x < TW; x += 30) { fill(g, '#2a2c2e', x, 18, 20, 8); fill(g, '#d8b43a', x - 2, 26, 1.5, 14); }
  for (const x of [8, 38, 98]) { fill(g, 'rgba(0,0,0,0.45)', x + 3, 34, 16, 66); fill(g, '#c6c8c2', x, 30, 16, 52); fill(g, pick(r, ['#1d4a80', '#a3170f', '#d0d0c8']), x, 84, 16, 14); }
  for (let i = 0; i < 7; i++) { const x = 64 + r() * 26, y = 40 + r() * 70; fill(g, '#7a5a35', x, y, 7, 7); fill(g, 'rgba(0,0,0,0.25)', x, y + 3, 7, 1); }
  fill(g, '#d0a215', 124, 92, 9, 13); fill(g, '#222', 125, 86, 7, 5);
  dashes(g, 0, 118, TW, 118, 'rgba(225,190,60,0.8)', 10, 6);
}

// 停车场：斜线车位、一排小车、斑马线
function parking(g, r) {
  asphalt(g, r);
  for (let x = 4; x < TW; x += 22) fill(g, 'rgba(235,235,230,0.75)', x, 6, 1.5, 40);
  for (let x = 4; x < TW; x += 22) fill(g, 'rgba(235,235,230,0.75)', x, 86, 1.5, 40);
  for (let x = 8; x < TW - 18; x += 22) {
    for (const y of [10, 90]) {
      if (r() < 0.3) continue;
      const col = pick(r, ['#c9c9c4', '#2a2d30', '#7d1d1d', '#30455c', '#9c9c96', '#e2e2dc']);
      fill(g, 'rgba(0,0,0,0.45)', x + 2, y + 2, 14, 30); fill(g, col, x, y, 14, 30);
      fill(g, 'rgba(20,30,40,0.85)', x + 2, y + (y < 50 ? 20 : 4), 10, 6);
    }
  }
  for (let x = 20; x < 140; x += 8) fill(g, 'rgba(235,235,230,0.8)', x, 56, 4, 18);
  g.fillStyle = '#ddd'; g.beginPath(); g.arc(112, 66, 2.2, 0, 7); g.fill();
}

// 仓库屋面：压型钢板的肋、两条采光带、几台空调外机、女儿墙
function roof(g, r) {
  fill(g, '#8b8f8e', 0, 0, TW, TH);
  for (let x = 0; x < TW; x += 4) fill(g, 'rgba(0,0,0,0.18)', x, 0, 1, TH);
  for (const x of [40, 104]) fill(g, 'rgba(225,235,240,0.75)', x, 10, 12, TH - 20);
  for (let i = 0; i < 5; i++) {
    const x = 60 + (i % 2) * 22 + r() * 4, y = 14 + i * 22;
    fill(g, 'rgba(0,0,0,0.45)', x + 3, y + 3, 16, 14); fill(g, '#b8bab6', x, y, 16, 14);
    g.strokeStyle = '#3a3c3e'; g.lineWidth = 1.5; g.beginPath(); g.arc(x + 8, y + 7, 5, 0, 7); g.stroke();
  }
  fill(g, '#55595a', 0, 0, TW, 4); fill(g, '#55595a', 0, TH - 4, TW, 4); fill(g, '#55595a', 0, 0, 4, TH);
  fill(g, 'rgba(0,0,0,0.3)', 4, 4, TW, 3);
}

const FEEDS = [['堆场 A', yard], ['码头前沿', quay], ['闸口', gate], ['卸货场', apron], ['停车场', parking], ['仓库屋面', roof]];

function feed(i, rnd) {
  const cv = document.createElement('canvas');
  cv.width = TW; cv.height = TH;
  const g = cv.getContext('2d');
  FEEDS[i][1](g, rnd);
  // 彩色画面 → 半透明层：亮处透出屏幕的光；扫描线隔行压暗，四角暗角，加一点噪点
  const img = g.getImageData(0, 0, TW, TH), d = img.data;
  for (let y = 0; y < TH; y++) {
    for (let x = 0; x < TW; x++) {
      const p = (y * TW + x) * 4, dx = x / TW - 0.5, dy = y / TH - 0.5;
      let L = (0.3 * d[p] + 0.59 * d[p + 1] + 0.11 * d[p + 2]) / 255;
      L *= (1 - 1.1 * (dx * dx + dy * dy)) * (y % 2 ? 0.78 : 1) * (0.88 + 0.24 * rnd());
      // 屏幕的光很亮（2.6），漏一成就是中灰：中等亮度以下（路面、屋面、水面）完全不透、颜色压暗近黑，
      // 只有亮的标线、箱顶和字透出来，黑位才起得来
      const t = Math.pow(Math.max(0, Math.min(1, (L - 0.3) / 0.7)), 1.8);
      d[p + 3] = Math.round(255 * (1 - 0.85 * t));
      const dim = 0.3 + 0.7 * t;
      d[p] *= dim; d[p + 1] *= dim; d[p + 2] *= dim;
    }
  }
  g.putImageData(img, 0, 0);
  // 字幕：抠透成亮字；录制红点是实色
  const sec = String(Math.floor(rnd() * 60)).padStart(2, '0');
  g.globalCompositeOperation = 'destination-out';
  g.fillStyle = 'rgba(0,0,0,0.92)';
  g.font = `600 10px ${STENCIL_FONT}`;
  g.fillText(`CAM 0${i + 1}`, 5, 12);
  g.font = `600 9px ${UI_FONT}`;
  g.fillText(FEEDS[i][0], 46, 12);
  g.font = `600 9px ${STENCIL_FONT}`;
  g.fillText(`2026-11-12  14:3${i}:${sec}`, 5, TH - 5);
  g.fillText('REC', TW - 24, 12);
  g.fillStyle = 'rgba(0,0,0,0.6)';
  g.fillRect(0, 0, TW, 1); g.fillRect(0, TH - 1, TW, 1); g.fillRect(0, 0, 1, TH); g.fillRect(TW - 1, 0, 1, TH);
  g.globalCompositeOperation = 'source-over';
  g.fillStyle = '#ff2a1c'; g.beginPath(); g.arc(TW - 31, 8.5, 3, 0, 7); g.fill();
  return cv;
}

// 返回贴图集里的 UV 矩形（512 × 288，和原来的占位图一样大，不多占图集）
export function wallCams(kit) {
  return kit.label('wallcams', 512, 288, (c, w, h) => {
    const rnd = mulberry32(907);
    c.fillStyle = 'rgba(4,8,12,0.94)'; c.fillRect(0, 0, w, h);
    for (let i = 0; i < 6; i++) {
      const x = 8 + (i % 3) * 168, y = 8 + Math.floor(i / 3) * 140;
      c.clearRect(x, y, TW, TH);
      c.drawImage(feed(i, rnd), x, y);
    }
  });
}
