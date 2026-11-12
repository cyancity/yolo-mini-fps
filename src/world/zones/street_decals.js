import { distress, STENCIL_FONT } from '../labels.js';

// 街道分区画进标签图集的东西：不发光的招牌、涂鸦、小广告、横幅、路牌、车牌。名字、电话都是编的。
const CN = '"Microsoft YaHei UI", "Microsoft YaHei", "PingFang SC", sans-serif';

// 招牌：底色 + 中文大字 + 英文小字
export function signBoard(ctx, key, cn, en, { bg = '#e9e4d6', fg = '#9c1b14', sub = '#1c1c1c', w = 512, h = 128 } = {}) {
  return ctx.atlas.cached(`street|sign|${key}`, w, h, (c) => {
    c.fillStyle = bg; c.fillRect(0, 0, w, h);
    c.strokeStyle = 'rgba(0,0,0,0.25)'; c.lineWidth = 4; c.strokeRect(5, 5, w - 10, h - 10);
    c.fillStyle = fg; c.textAlign = 'center'; c.textBaseline = 'middle';
    c.font = `800 ${Math.round(h * 0.5)}px ${CN}`; c.fillText(cn, w / 2, h * 0.4, w - 30);
    c.fillStyle = sub; c.font = `700 ${Math.round(h * 0.17)}px ${STENCIL_FONT}`; c.fillText(en, w / 2, h * 0.82, w - 30);
    // 雨水从上沿往下流的脏印
    for (let i = 0; i < 26; i++) {
      const x = ctx.rand() * w, len = h * (0.2 + ctx.rand() * 0.7);
      const g = c.createLinearGradient(0, 0, 0, len);
      g.addColorStop(0, 'rgba(40,32,24,0.35)'); g.addColorStop(1, 'rgba(40,32,24,0)');
      c.fillStyle = g; c.fillRect(x, 0, 2 + ctx.rand() * 5, len);
    }
    distress(c, w, h, ctx.rand, 0.45);
  });
}

// 涂鸦：粗描边的字加滴流
export function graffiti(ctx, key, text, colors) {
  return ctx.atlas.cached(`street|graf|${key}`, 512, 224, (c, w, h) => {
    c.save();
    c.translate(w / 2, h / 2); c.rotate(-0.08); c.transform(1, 0, -0.25, 1, 0, 0);
    c.font = `900 118px ${STENCIL_FONT}`; c.textAlign = 'center'; c.textBaseline = 'middle';
    c.lineJoin = 'round';
    c.lineWidth = 22; c.strokeStyle = '#111'; c.strokeText(text, 0, 0);
    c.lineWidth = 9; c.strokeStyle = colors[1]; c.strokeText(text, 0, 0);
    const g = c.createLinearGradient(0, -50, 0, 50);
    g.addColorStop(0, colors[0]); g.addColorStop(1, colors[2] || colors[0]);
    c.fillStyle = g; c.fillText(text, 0, 0);
    c.restore();
    c.fillStyle = colors[0];
    for (let i = 0; i < 14; i++) {
      const x = 60 + ctx.rand() * (w - 120), y = h / 2 + 20 + ctx.rand() * 30;
      c.fillRect(x, y, 3, 20 + ctx.rand() * 50);
    }
    distress(c, w, h, ctx.rand, 0.6);
  });
}

// 小广告：白纸黑字，电话号码打码
export function poster(ctx, i) {
  const items = [['招工', '日结 · 包吃住', '#c4221a'], ['开锁', '修锁 · 换锁芯', '#1a1a1a'], ['旺铺转让', '临街 · 可餐饮', '#c4221a'], ['搬家', '空调移机', '#1a3fa0']];
  const [a, b, col] = items[i % items.length];
  return ctx.atlas.cached(`street|poster|${i}`, 128, 176, (c, w, h) => {
    c.fillStyle = i % 2 ? '#ece7d6' : '#f2e9a8'; c.fillRect(0, 0, w, h);
    c.fillStyle = col; c.textAlign = 'center';
    c.font = `800 34px ${CN}`; c.fillText(a, w / 2, 46, w - 10);
    c.fillStyle = '#222'; c.font = `600 17px ${CN}`; c.fillText(b, w / 2, 82, w - 10);
    c.fillStyle = '#333'; c.fillRect(14, 104, w - 28, 16);
    c.font = `600 14px ${STENCIL_FONT}`; c.fillText('电话 · TEL', w / 2, 142);
    distress(c, w, h, ctx.rand, 1.2);
  });
}

// 红底白字横幅
export function banner(ctx, key, text) {
  return ctx.atlas.cached(`street|banner|${key}`, 512, 80, (c, w, h) => {
    c.fillStyle = '#b8231a'; c.fillRect(0, 0, w, h);
    c.fillStyle = '#fff3e0'; c.font = `800 46px ${CN}`; c.textAlign = 'center'; c.textBaseline = 'middle';
    c.fillText(text, w / 2, h / 2 + 2, w - 20);
    distress(c, w, h, ctx.rand, 0.4);
  });
}

// 圆形交通标志（四角透明）：kind 'noPark' 禁停，'noEntry' 禁行，'limit' 限速
export function roundSign(ctx, kind) {
  return ctx.atlas.cached(`street|round|${kind}`, 128, 128, (c, w, h) => {
    c.beginPath(); c.arc(w / 2, h / 2, 60, 0, 6.283);
    c.fillStyle = kind === 'noPark' ? '#1b4f9c' : '#f2f2ee'; c.fill();
    c.lineWidth = 12; c.strokeStyle = '#c4221a'; c.stroke();
    c.fillStyle = '#c4221a';
    if (kind === 'noPark') {
      c.save(); c.translate(w / 2, h / 2); c.rotate(-Math.PI / 4); c.fillRect(-56, -6, 112, 12); c.restore();
    } else if (kind === 'noEntry') {
      c.fillRect(30, 56, 68, 16);
    } else {
      c.fillStyle = '#111'; c.font = `800 54px ${STENCIL_FONT}`; c.textAlign = 'center'; c.textBaseline = 'middle'; c.fillText('20', w / 2, h / 2 + 3);
    }
    distress(c, w, h, ctx.rand, 0.2);
  });
}

// 长方形警示牌：黄底黑字
export function warnSign(ctx, key, cn, en, { w = 384, h = 192, bg = '#e8b520' } = {}) {
  return ctx.atlas.cached(`street|warn|${key}`, w, h, (c) => {
    c.fillStyle = bg; c.fillRect(0, 0, w, h);
    c.strokeStyle = '#111'; c.lineWidth = 8; c.strokeRect(8, 8, w - 16, h - 16);
    c.fillStyle = '#111'; c.textAlign = 'center'; c.textBaseline = 'middle';
    c.font = `800 ${Math.round(h * 0.34)}px ${CN}`; c.fillText(cn, w / 2, h * 0.42, w - 30);
    c.font = `700 ${Math.round(h * 0.15)}px ${STENCIL_FONT}`; c.fillText(en, w / 2, h * 0.76, w - 30);
    distress(c, w, h, ctx.rand, 0.35);
  });
}

// 空白车牌：只有边框和铆钉
export function plate(ctx, color = '#d9b21c') {
  return ctx.atlas.cached(`street|plate|${color}`, 128, 40, (c, w, h) => {
    c.fillStyle = color; c.fillRect(0, 0, w, h);
    c.strokeStyle = '#222'; c.lineWidth = 3; c.strokeRect(3, 3, w - 6, h - 6);
    c.fillStyle = '#555'; for (const x of [16, w - 16]) { c.beginPath(); c.arc(x, h / 2, 3, 0, 6.3); c.fill(); }
    distress(c, w, h, ctx.rand, 0.5);
  });
}

// 门牌号
export function houseNo(ctx, n) {
  return ctx.atlas.cached(`street|no|${n}`, 96, 64, (c, w, h) => {
    c.fillStyle = '#1b4f9c'; c.fillRect(0, 0, w, h);
    c.fillStyle = '#f2f6ff'; c.textAlign = 'center';
    c.font = `600 13px ${CN}`; c.fillText('港前路', w / 2, 18);
    c.font = `800 34px ${STENCIL_FONT}`; c.fillText(String(n), w / 2, 54);
  });
}

// 车身侧面的公司名
export function fleetMark(ctx) {
  return ctx.atlas.cached('street|fleet', 768, 192, (c, w, h) => {
    c.fillStyle = '#1d5f8a';
    c.beginPath(); c.moveTo(0, h * 0.75); c.bezierCurveTo(w * 0.3, h * 0.55, w * 0.6, h * 0.95, w, h * 0.7); c.lineTo(w, h); c.lineTo(0, h); c.fill();
    c.fillStyle = '#163c5a'; c.textBaseline = 'middle';
    c.font = `800 86px ${CN}`; c.fillText('北堤冷运', 20, 64);
    c.font = `700 40px ${STENCIL_FONT}`; c.fillText('NORTHMOLE FREIGHT · 港区专线', 24, 128, w - 40);
    distress(c, w, h, ctx.rand, 0.25);
  });
}
