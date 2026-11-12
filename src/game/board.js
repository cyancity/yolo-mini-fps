// 排行榜的客户端：开局领一个凭据，每打完一轮把成绩报上去，菜单里拉榜单。服务端在仓库的 server/。
// 成绩先进 pending（存在 localStorage），有名字才报；没填名字的可以阵亡后再填，填了就补报。
// 本机开发（localhost）报给本机起的服务，正式站点报给正式地址，互不串。别的域名（别人 fork 后自己部署的）默认不连，
// 打包时用 VITE_BOARD_URL 指到自己的服务
const LOCAL = /^(localhost|127\.0\.0\.1|\[::1\])$/.test(location.hostname);
const HOSTED = { 'cyancity.github.io': 'https://arm.yolooo.cloud/dockzero' };
const API = (import.meta.env.VITE_BOARD_URL || (LOCAL ? 'http://localhost:8823' : HOSTED[location.hostname] || '')).replace(/\/+$/, '');
const KEY = 'dockzero.board.pending.v1';
const TIMEOUT_MS = 6000;
const CACHE_MS = 20000;
const KEEP = 20; // 最多留这么多轮没报上去的成绩
const TOKEN_TRIES = 3; // 开局领凭据最多试几次
const round2 = (x) => Math.round(x * 100) / 100;

async function call(path, body) {
  if (!API) throw new Error('no board');
  const res = await fetch(API + path, {
    method: body ? 'POST' : 'GET',
    headers: body ? { 'content-type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  let data = null;
  try { data = await res.json(); } catch { /* 不是 JSON：按失败处理 */ }
  return { ok: res.ok, status: res.status, data };
}

export class Board {
  constructor() {
    this.local = LOCAL;
    this.name = '';
    this.run = null; // 这一局的凭据（Promise），没领到是 null
    this.pending = [];
    try { this.pending = JSON.parse(localStorage.getItem(KEY)) || []; } catch { /* 存坏了：当没有 */ }
    // 上次留下的只认带名字的（当时连不上没报成）：没名字的是在等别人填名字，这次填名字的不一定是同一个人
    this.pending = Array.isArray(this.pending) ? this.pending.filter((p) => p && p.name) : [];
    this.last = null; // 最近报上去的一轮：{ round, time, rank }
    this.state = 'idle'; // 'idle' | 'sending' | 'offline'（连不上，成绩还留着）| 'rejected'（服务端不收）
    this.busy = false;
    this.cache = new Map();
    this.listeners = [];
  }

  onChange(cb) { this.listeners.push(cb); }
  emit() { for (const cb of this.listeners) cb(); }

  save() {
    try { localStorage.setItem(KEY, JSON.stringify(this.pending)); } catch { /* 存不了就只留在内存里 */ }
  }

  // 开一局：领凭据。服务端拿它核对「报上来的用时不比真实经过的时间长」
  // 一时连不上就隔一秒再试：凭据来得太晚的话，服务端会认为第一轮的用时对不上
  begin() {
    this.run = (async () => {
      for (let i = 0; i < TOKEN_TRIES; i++) {
        if (i) await new Promise((r) => setTimeout(r, 1000));
        try {
          const r = await call('/v1/runs', {});
          if (r.ok && r.data?.run) return r.data.run;
        } catch { /* 再试 */ }
      }
      return null;
    })();
    this.last = null; // 上一局报上去的那句「第 N 轮 · 第几名」不带进新的一局
    this.emit();
  }

  setName(name) {
    this.name = name;
    this.flush();
  }

  // 打完一轮（rounds.js 的 close 的结果）。tod 是时段
  async report(r, tod) {
    const run = await this.run;
    if (!run) {
      this.state = 'offline';
      this.emit();
      return;
    }
    this.pending.push({
      run, tod, name: this.name || null, round: r.round, time: round2(r.time), penalty: round2(r.penalty),
      shots: r.shots, hits: r.hits, headshots: r.headshots, kills: r.kills, damage: round2(r.damage),
    });
    // 超了就整局整局地丢最早的：服务端要求同一局的上一轮在库里，只丢半局的话剩下的也报不上
    while (this.pending.length > KEEP) {
      const old = this.pending[0].run;
      this.pending = this.pending.filter((p) => p.run !== old);
    }
    this.save();
    this.flush();
  }

  // 按先后把 pending 报上去。连不上、被限流就停下留着；服务端明确不收的（校验不过、凭据过期）丢掉
  async flush() {
    if (!this.name || this.busy || !this.pending.length) {
      this.emit();
      return;
    }
    this.busy = true;
    this.state = 'sending';
    this.emit();
    try {
      while (this.pending.length) {
        const p = this.pending[0];
        let res = null;
        // 打完时就有名字的按当时的名字报，当时没填的用现在的
        try { res = await call('/v1/rounds', { ...p, name: p.name || this.name }); } catch { /* 网络不通或超时 */ }
        if (!res || res.status === 429 || res.status >= 500) {
          this.state = 'offline';
          break;
        }
        if (res.ok) {
          this.last = { round: p.round, time: p.time, rank: res.data?.rank ?? null };
          this.cache.clear();
          this.state = 'idle';
        } else this.state = 'rejected';
        this.pending.shift();
        this.save();
      }
    } finally {
      this.busy = false;
      this.emit();
    }
  }

  // 榜单：{ round, sort, total, rounds, rows }。sort 是 'time'、'acc'、'damage'。短时间内重复看不重复拉
  async top(round, sort) {
    const key = `${round}:${sort}`, hit = this.cache.get(key);
    if (hit && performance.now() - hit.at < CACHE_MS) return hit.data;
    const res = await call(`/v1/board?round=${round}&sort=${sort}&limit=100`);
    if (!res.ok || !res.data) throw new Error('board');
    this.cache.set(key, { at: performance.now(), data: res.data });
    return res.data;
  }
}
