// 击倒反馈：准星下方的加分条（准星上只有命中标记的 X，击倒时变黄，见 hud.js 的 hitmarker）。
// 3 秒内连续击倒合成一串：顶上一行是累计分和连杀数，下面每次击倒一行（爆头写在同一行），各自滑入、停留、淡出。

const CHAIN_MS = 3000;
const LINES_MAX = 3;
const VERB = { soldier: '击倒', drone: '击毁', target: '击倒' };

const swap = (el) => { el.dataset.anim = el.dataset.anim === 'a' ? 'b' : 'a'; };

export class KillFeedback {
  constructor(el, number) {
    this.ticker = el.ticker;
    this.head = el.tickHead;
    this.total = el.tickTotal;
    this.count = el.tickCount;
    this.lines = el.tickLines;
    this.number = number;
    this.reset();
    // 停留时长由 CSS 动画决定，播完就移除
    this.lines.addEventListener('animationend', (e) => {
      if (e.target.parentNode === this.lines) e.target.remove();
    });
  }

  // 新开一局：连杀清零，残留的行和累计分立刻收掉
  reset() {
    this.sum = 0;
    this.chain = 0;
    this.lastAt = -Infinity;
    this.lines.replaceChildren();
    delete this.head.dataset.anim;
  }

  // time 是游戏时间（秒，暂停时不走），连杀窗口按它算；不传就用页面时间（预览页）
  kill({ kind = 'soldier', headshot = false, points = 0, time } = {}) {
    const now = Number.isFinite(time) ? time * 1000 : performance.now();
    const pts = Math.max(0, Math.round(Number(points) || 0));
    if (now - this.lastAt > CHAIN_MS) { this.sum = 0; this.chain = 0; }
    this.lastAt = now;
    this.sum += pts;
    this.chain++;

    // 累计分和连杀数
    this.total.textContent = `+${this.number.format(this.sum)}`;
    this.count.textContent = this.chain > 1 ? `×${this.chain}` : '';
    swap(this.head);

    // 明细：最新的一次排在最上面，一杀一行
    this.lines.prepend(this.line(VERB[kind] || VERB.soldier, headshot, pts));
    while (this.lines.children.length > LINES_MAX) this.lines.lastElementChild.remove();
  }

  line(verb, headshot, pts) {
    const li = document.createElement('li');
    const name = document.createElement('span');
    name.textContent = verb;
    if (headshot) {
      const head = document.createElement('em');
      head.textContent = '爆头';
      name.append(' · ', head);
    }
    const value = document.createElement('b');
    value.textContent = `+${this.number.format(pts)}`;
    li.append(name, value);
    return li;
  }
}
