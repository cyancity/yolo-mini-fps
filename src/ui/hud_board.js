// 菜单里的排行榜，和对局中右上角的轮次计时。榜单数据走 game/board.js；名字就是设置里的 name，这里的输入框和设置区那个是同一个值。
// 阵亡页直接带着榜单；开始和暂停页点「排行榜」按钮把操作说明、战绩、设置换成榜单，再点一次换回来
import { Segmented } from './hud_settings.js';
import { pct } from './hud_status.js';

const SORTS = [['time', '用时'], ['acc', '命中率'], ['damage', '掉血']];
const TOP = 10; // 榜单显示前几名；自己不在里面时在最后补一行
const MAX_TABS = 5; // 轮次页签最多几个
const HEAD = ['名次', '名字', '用时', '命中率', '掉血'];

// 一轮的用时：分:秒.十分之一秒
export const lap = (sec) => {
  if (!Number.isFinite(sec)) return '—';
  const t = Math.max(0, Math.floor(sec * 10));
  return `${Math.floor(t / 600)}:${String(Math.floor(t / 10) % 60).padStart(2, '0')}.${t % 10}`;
};

export class BoardView {
  constructor(hud) {
    const el = hud.el, id = `${hud.id}-board`;
    this.hud = hud;
    this.root = el.board;
    this.button = el.rank;
    this.board = null;
    this.settings = null;
    this.round = 1;
    this.sort = 'time';
    this.rounds = '';
    this.seq = 0;
    this.fixed = false; // 当前菜单是不是本来就带榜单（阵亡页）
    this.open = false; // 开始、暂停页里有没有切到榜单
    this.sent = null;
    this.root.innerHTML = `
      <div class="hud-board-me">
        <label class="hud-field-name" for="${id}-name">名字</label>
        <input class="hud-input" id="${id}-name" type="text" maxlength="24" placeholder="留名上榜" autocomplete="off" spellcheck="false">
        <span class="hud-board-status" role="status"></span>
      </div>
      <div class="hud-board-tabs">
        <div class="hud-seg" role="radiogroup" aria-label="轮次"></div>
        <div class="hud-seg" role="radiogroup" aria-label="排序"></div>
      </div>
      <table>
        <thead><tr>${HEAD.map((h) => `<th scope="col">${h}</th>`).join('')}</tr></thead>
        <tbody></tbody>
      </table>
      <p class="hud-board-note" role="status"></p>`;
    this.input = this.root.querySelector('input');
    this.statusEl = this.root.querySelector('.hud-board-status');
    [this.roundEl, this.sortEl] = this.root.querySelectorAll('.hud-seg');
    this.body = this.root.querySelector('tbody');
    this.noteEl = this.root.querySelector('.hud-board-note');
    this.sortSeg = new Segmented(this.sortEl, SORTS, (v) => { this.sort = v; this.load(); });
    this.sortSeg.pick('time', false);
    this.setRounds([1]);
    this.input.addEventListener('change', () => {
      if (!this.settings) return;
      this.settings.set('name', this.input.value);
      this.input.value = this.settings.get('name');
    });
    this.input.addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.isComposing) this.input.blur(); });
    this.button.addEventListener('click', () => this.toggle(!this.open));
  }

  bind(board, settings) {
    this.board = board;
    this.settings = settings;
    this.input.value = settings.get('name');
    board.onChange(() => this.status());
    settings.onChange((key, value) => {
      if (key !== 'name') return;
      this.input.value = value;
      this.mark();
    });
    this.status();
  }

  // hud.showMenu 换菜单时调。menu 是 MENUS 里的一项，收起菜单时是 null
  menu(menu) {
    this.fixed = !!menu?.parts.includes('board');
    this.toggle(false);
  }

  toggle(on) {
    this.open = on;
    this.hud.layer.toggleAttribute('data-board', on);
    this.root.hidden = !(on || this.fixed);
    this.button.textContent = on ? '返回' : '排行榜';
    if (!this.root.hidden) this.load();
  }

  // 轮次页签：有成绩的轮次（最多 MAX_TABS 个）加上正在看的那一轮。列表没变就不重建
  setRounds(list) {
    this.list = list;
    const set = new Set([1, ...list.slice(0, MAX_TABS), this.round]);
    const rounds = [...set].sort((a, b) => a - b), key = rounds.join(',');
    if (key === this.rounds) return;
    this.rounds = key;
    // Segmented 在构造时往容器上挂监听：换一个新容器，旧的监听跟着旧节点走
    const fresh = this.roundEl.cloneNode(false);
    this.roundEl.replaceWith(fresh);
    this.roundEl = fresh;
    this.roundSeg = new Segmented(fresh, rounds.map((n) => [String(n), `第 ${n} 轮`]), (v) => { this.round = Number(v); this.load(); });
    this.roundSeg.pick(String(this.round), false);
  }

  async load() {
    if (!this.board) return;
    const seq = ++this.seq;
    if (!this.body.children.length) this.note('加载中');
    try {
      const data = await this.board.top(this.round, this.sort);
      if (seq === this.seq) this.fill(data);
    } catch {
      if (seq !== this.seq) return;
      this.body.replaceChildren();
      this.note('排行榜连不上');
    }
  }

  fill(data) {
    this.setRounds(data.rounds || []);
    const rows = data.rows || [], me = this.settings?.get('name');
    const mine = me ? rows.findIndex((r) => r.name === me) : -1;
    const show = rows.slice(0, TOP).map((r, i) => [r, i]);
    if (mine >= TOP) show.push([rows[mine], mine]);
    this.body.replaceChildren(...show.map(([r, i]) => {
      const tr = document.createElement('tr');
      tr.toggleAttribute('data-me', i === mine);
      tr.toggleAttribute('data-gap', i >= TOP);
      const cells = [i + 1, r.name, lap(r.time), pct(r.hits, r.shots), r.flawless ? '无伤' : Math.max(1, Math.round(r.damage))];
      cells.forEach((text, c) => {
        const td = document.createElement('td');
        td.textContent = text;
        if (c === 4 && r.flawless) td.dataset.flawless = '';
        tr.append(td);
      });
      return tr;
    }));
    this.note(rows.length ? '' : '还没有人上榜');
  }

  // 名字改了：重新标出自己那一行
  mark() {
    if (!this.root.hidden) this.load();
  }

  note(text) {
    this.noteEl.textContent = text;
    this.noteEl.hidden = !text;
  }

  // 名字右边的一句话：有成绩没名字、正在报、连不上（成绩还留着）、服务端不收、最近报上去的一轮和名次
  status() {
    const b = this.board, n = b.pending.length, name = this.settings.get('name');
    let text = '';
    if (n && !name) text = `填名字，${n} 轮成绩上榜`;
    else if (b.state === 'sending') text = '正在上报';
    else if (b.state === 'offline' && n) text = '连不上，成绩先留在本机';
    else if (b.state === 'rejected') text = '这一轮的成绩没被收下';
    else if (b.last) text = `第 ${b.last.round} 轮 ${lap(b.last.time)}${b.last.rank ? ` · 第 ${b.last.rank} 名` : ''}`;
    this.statusEl.textContent = text;
    // 刚报上去一轮：榜单切到那一轮，开着的话跟着刷新
    if (b.last !== this.sent) {
      this.sent = b.last;
      if (b.last) {
        this.round = b.last.round;
        this.setRounds(this.list);
        this.roundSeg.pick(String(this.round), false);
      }
      if (!this.root.hidden) this.load();
    }
  }
}

// 对局中右上角：第几轮、这一轮的用时（含罚时），有罚时的话后面跟着罚了多少秒。每帧调，显示的字没变就不碰 DOM
export class RoundClock {
  constructor(el) {
    this.n = el.roundN;
    this.t = el.roundT;
    this.p = el.roundP;
    this.v = { n: 0, t: -1, p: '' };
  }

  // r 是 rounds.js 的 live() 的结果
  set(r) {
    const v = this.v, t = Math.floor(r.time), p = r.penalty > 0 ? `+${r.penalty.toFixed(1)}` : '';
    if (r.round !== v.n) { v.n = r.round; this.n.textContent = `第 ${r.round} 轮`; }
    if (t !== v.t) { v.t = t; this.t.textContent = `${Math.floor(t / 60)}:${String(t % 60).padStart(2, '0')}`; }
    if (p !== v.p) { v.p = p; this.p.textContent = p; }
  }
}
