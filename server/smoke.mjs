// 端到端冒烟：临时数据目录、随机端口起服务子进程，把接口规则逐条打一遍。
// 运行：node server/smoke.mjs（失败时退出码非零）
import { execFileSync, spawn } from 'node:child_process';
import { createHmac, randomBytes } from 'node:crypto';
import { existsSync, mkdtempSync, readFileSync, rmSync, statSync } from 'node:fs';
import net from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import * as sqlite from 'node:sqlite';
import { fileURLToPath } from 'node:url';

const Database = sqlite.Database ?? sqlite.DatabaseSync;
const BOARD = fileURLToPath(new URL('./board.js', import.meta.url));
const ADMIN = fileURLToPath(new URL('./admin.js', import.meta.url));
const SECRET = randomBytes(24).toString('base64url');
const HOUR = 3600_000;
const temp = mkdtempSync(join(tmpdir(), 'dockzero-board-'));
const servers = [];
let pass = 0;
let failCount = 0;

function check(label, ok, detail) {
  if (ok) return void pass++;
  failCount++;
  const extra = detail === undefined ? '' : `：${typeof detail === 'string' ? detail : JSON.stringify(detail)}`;
  console.log(`FAIL ${label}${extra}`);
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function freePort() {
  return new Promise((resolve, reject) => {
    const s = net.createServer();
    s.once('error', reject);
    s.listen(0, '127.0.0.1', () => {
      const { port } = s.address();
      s.close(() => resolve(port));
    });
  });
}

async function start(label, extraEnv) {
  const port = await freePort();
  const env = { ...process.env };
  for (const k of ['BOARD_SECRET', 'TRUST_PROXY', 'ALLOW_ORIGINS', 'RATE_ROUNDS', 'RATE_RUNS', 'RATE_GET', 'DATA_DIR']) delete env[k];
  Object.assign(env, { PORT: String(port), HOST: '127.0.0.1' }, extraEnv);
  const child = spawn(process.execPath, [BOARD], { env, stdio: ['ignore', 'pipe', 'pipe'] });
  const srv = { base: `http://127.0.0.1:${port}`, port, child, out: '', err: '' };
  srv.exited = new Promise((r) => child.once('exit', r));
  child.stdout.on('data', (d) => (srv.out += d));
  child.stderr.on('data', (d) => (srv.err += d));
  servers.push(srv);
  for (let i = 0; i < 100 && child.exitCode === null; i++) {
    try {
      if ((await fetch(`${srv.base}/health`)).ok) return srv;
    } catch {}
    await sleep(50);
  }
  throw new Error(`服务 ${label} 没起来：${srv.err}`);
}

async function stop(srv) {
  if (srv.child.exitCode === null) srv.child.kill();
  await srv.exited;
}

// 默认每个请求换一个 X-Forwarded-For，免得主流程撞上限流；测限流时显式给 ip
let seq = 0;
const nextIp = () => {
  seq++;
  return `10.${(seq >> 16) & 255}.${(seq >> 8) & 255}.${seq & 255}`;
};

async function call(srv, method, path, { body, raw, headers = {}, ip } = {}) {
  const h = { 'x-forwarded-for': ip ?? nextIp(), ...headers };
  const payload = body !== undefined ? JSON.stringify(body) : raw;
  if (payload !== undefined) h['content-type'] = 'application/json';
  const init = { method, headers: h, body: payload };
  if (payload instanceof ReadableStream) init.duplex = 'half';
  const res = await fetch(srv.base + path, init);
  const text = await res.text();
  let json = null;
  try {
    json = JSON.parse(text);
  } catch {}
  return { status: res.status, json, h: res.headers };
}

function sign(startMs, secret = SECRET, id = randomBytes(12).toString('base64url')) {
  const body = `${id}.${startMs}`;
  return `${body}.${createHmac('sha256', secret).update(body).digest('base64url')}`;
}
const oldRun = (agoMs = 2 * HOUR) => sign(Date.now() - agoMs);
const runId = (token) => token.split('.')[0];

const good = (run, over = {}) => ({
  run, name: 'YOLO', round: 1, time: 254.3, penalty: 0, shots: 210, hits: 131,
  headshots: 9, kills: 21, damage: 85, tod: 'afternoon', ...over,
});
const submit = (srv, body, opt = {}) => call(srv, 'POST', '/v1/rounds', { body, ...opt });
const getBoard = (srv, query = '', opt) => call(srv, 'GET', `/v1/board${query}`, opt);

function expectError(label, r, status, code) {
  check(label, r.status === status && r.json?.error === code, { status: r.status, body: r.json });
}

// 发完请求头和半截请求体就停住，看服务多久掐断
function slowRequest(srv) {
  return new Promise((resolve) => {
    const t0 = Date.now();
    let data = '';
    const sock = net.connect(srv.port, '127.0.0.1', () => {
      sock.write('POST /v1/runs HTTP/1.1\r\nHost: x\r\nContent-Type: application/json\r\nContent-Length: 10\r\n\r\n{');
    });
    const guard = setTimeout(() => sock.destroy(), 20_000);
    sock.on('data', (d) => (data += d));
    sock.on('error', () => {});
    sock.on('close', () => {
      clearTimeout(guard);
      resolve({ ms: Date.now() - t0, head: data.slice(0, 40) });
    });
  });
}

async function basics(A) {
  let r = await call(A, 'GET', '/health');
  check('health 200', r.status === 200 && r.json?.ok === true, r);
  check('Cache-Control: no-store', r.h.get('cache-control') === 'no-store');
  check('X-Content-Type-Options: nosniff', r.h.get('x-content-type-options') === 'nosniff');
  check('Content-Type 是 JSON', /^application\/json/.test(r.h.get('content-type') ?? ''));

  r = await call(A, 'POST', '/v1/runs', { body: {} });
  const fresh = r.json?.run;
  const [id, start] = String(fresh).split('.');
  check('开局 200 返回三段 token', r.status === 200 && String(fresh).split('.').length === 3, r.json);
  check('token 的 id 是 12 字节 base64url', /^[A-Za-z0-9_-]{16}$/.test(id) && Buffer.from(id, 'base64url').length === 12);
  check('token 的 startMs 是现在', Math.abs(Number(start) - Date.now()) < 5000);
  check('token 签名按约定算法', sign(Number(start), SECRET, id) === fresh);
  r = await call(A, 'POST', '/v1/runs', { raw: '' });
  check('开局的空请求体按 {} 处理', r.status === 200 && typeof r.json?.run === 'string', r);

  expectError('刚开局就报 200 秒被拒', await submit(A, good(fresh, { time: 200 })), 400, 'time_mismatch');
  expectError('刚开局就报 30 秒也被拒', await submit(A, good(fresh, { time: 30 })), 400, 'time_mismatch');
  return fresh;
}

async function tokenRules(A) {
  const t = oldRun();
  const tampered = t.slice(0, 30) + (t[30] === 'A' ? 'B' : 'A') + t.slice(31);
  expectError('缺 run', await submit(A, good(undefined)), 400, 'run');
  expectError('run 格式不对', await submit(A, good('abc.123.def')), 400, 'run');
  expectError('签名被改过', await submit(A, good(tampered)), 400, 'run');
  expectError('别的密钥签的', await submit(A, good(sign(Date.now() - HOUR, 'x'.repeat(40)))), 400, 'run');
  expectError('startMs 在未来', await submit(A, good(sign(Date.now() + 60_000))), 400, 'run_expired');
  expectError('startMs 早于 24 小时前', await submit(A, good(sign(Date.now() - 25 * HOUR))), 400, 'run_expired');
}

async function fieldRules(A) {
  const tk = oldRun();
  const bad = [
    ['round 0', { round: 0 }, 'round'], ['round 51', { round: 51 }, 'round'],
    ['round 小数', { round: 1.5 }, 'round'], ['round 是字符串', { round: '1' }, 'round'],
    ['time 29.9', { time: 29.9 }, 'time'], ['time 7200.1', { time: 7200.1 }, 'time'],
    ['time null', { time: null }, 'time'], ['time 是字符串', { time: '254.3' }, 'time'],
    ['penalty 负数', { penalty: -1 }, 'penalty'], ['penalty 大于 time', { penalty: 254.31 }, 'penalty'],
    ['shots 负数', { shots: -1 }, 'shots'], ['shots 超上限', { shots: 100001 }, 'shots'],
    ['shots 小数', { shots: 210.5 }, 'shots'],
    ['hits 大于 shots', { hits: 211 }, 'hits'], ['hits 负数', { hits: -1 }, 'hits'],
    ['kills 少于 10', { kills: 9, headshots: 0 }, 'kills'], ['kills 超过 500', { kills: 501 }, 'kills'],
    ['headshots 大于 kills', { headshots: 22 }, 'headshots'], ['headshots 负数', { headshots: -1 }, 'headshots'],
    ['damage 负数', { damage: -0.5 }, 'damage'], ['damage 超上限', { damage: 100000.5 }, 'damage'],
    ['tod 不在名单里', { tod: 'dawn' }, 'tod'], ['tod 缺', { tod: undefined }, 'tod'],
    ['name 空串', { name: '' }, 'name'], ['name 全是空白', { name: ' \t ' }, 'name'],
    ['name 全是零宽字符', { name: '\u200b\u200d\ufeff' }, 'name'],
    ['name 13 个字符', { name: 'abcdefghijklm' }, 'name'], ['name 13 个 emoji', { name: '😀'.repeat(13) }, 'name'],
    ['name 是数字', { name: 123 }, 'name'], ['name 缺', { name: undefined }, 'name'],
  ];
  for (const [label, over, code] of bad) expectError(label, await submit(A, good(tk, over)), 400, code);
  const inf = JSON.stringify(good(tk)).replace('"time":254.3', '"time":1e400');
  expectError('time 是 1e400（解析成 Infinity）', await call(A, 'POST', '/v1/rounds', { raw: inf }), 400, 'time');
}

async function flow(A) {
  const runA = oldRun(HOUR);
  let r = await submit(A, good(runA));
  const idA1 = r.json?.id;
  check('提交第 1 轮 200', r.status === 200 && r.json?.ok === true && Number.isInteger(idA1), r.json);
  check('第一个上榜的名次是 1', r.json?.rank === 1, r.json);
  r = await submit(A, good(runA));
  check('重复提交 200 且是同一条', r.status === 200 && r.json?.ok && r.json.id === idA1 && r.json.rank === 1, r.json);
  r = await submit(A, good(runA, { name: 'Other', time: 100 }));
  check('改了内容的重复提交仍返回第一次的结果', r.status === 200 && r.json?.id === idA1 && r.json?.rank === 1, r.json);

  expectError('跳到第 3 轮', await submit(A, good(runA, { round: 3 })), 400, 'round_gap');
  expectError('新的一局直接报第 2 轮', await submit(A, good(oldRun(), { round: 2 })), 400, 'round_gap');
  expectError('两轮用时之和超过开局至今', await submit(A, good(runA, { round: 2, time: 3400 })), 400, 'time_mismatch');
  r = await submit(A, good(runA, { round: 2, time: 3400, penalty: 100 }));
  check('罚时不计入时间核对', r.status === 200 && r.json?.rank === 1, r.json);

  // 第 1 轮的榜：插入顺序决定 rank 的期望值
  const entries = [
    ['YOLO 第二局', { time: 240.5, shots: 100, hits: 40, damage: 0, tod: 'night' }, 1],
    ['名字归一化', { name: '  Ｄｏｃｋ\u200b  \t Zero\u0007 ', time: 260, shots: 200, hits: 100, damage: 0, tod: 'day' }, 2],
    ['Ace 300', { name: 'Ace', time: 300, shots: 50, hits: 45, damage: 20, tod: 'day' }, 3],
    ['Ace 280', { name: 'Ace', time: 280.004, shots: 20, hits: 20, damage: 50 }, 3],
    ['Tie', { name: 'Tie', time: 250.456, shots: 100, hits: 50, damage: 30 }, 2],
    ['12 个汉字', { name: '一二三四五六七八九十十一', time: 500, shots: 10, hits: 5, kills: 10, headshots: 0, damage: 900 }, 5],
    ['12 个 emoji', { name: '😀'.repeat(12), time: 501, shots: 10, hits: 5, kills: 10, headshots: 0, damage: 900 }, 6],
  ];
  for (const [label, over, rank] of entries) {
    r = await submit(A, good(oldRun(), over));
    check(`上榜：${label}，名次 ${rank}`, r.status === 200 && r.json?.rank === rank, r.json);
  }
  return runA;
}

async function boardRules(A) {
  const names = (r) => (r.json?.rows ?? []).map((x) => x.name);
  const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
  const emo = '😀'.repeat(12);
  const cjk = '一二三四五六七八九十十一';

  let r = await getBoard(A);
  check('默认参数 round 1 按用时', r.status === 200 && r.json?.round === 1 && r.json?.sort === 'time', r.json);
  check('按用时：每名一行、升序', same(names(r), ['YOLO', 'Tie', 'Dock Zero', 'Ace', cjk, emo]), names(r));
  check('按用时：total 是名字数', r.json?.total === 6, r.json?.total);
  check('rounds 是有记录的轮次', same(r.json?.rounds, [1, 2]), r.json?.rounds);
  const yolo = r.json?.rows?.[0] ?? {};
  check('行字段齐全且只有约定字段', same(Object.keys(yolo), ['name', 'time', 'penalty', 'shots', 'hits', 'damage', 'flawless', 'tod', 'at']), Object.keys(yolo));
  check('名字的最好成绩那条', yolo.time === 240.5 && yolo.shots === 100 && yolo.tod === 'night' && Number.isInteger(yolo.at), yolo);
  check('damage 0 是 flawless', yolo.flawless === true && r.json?.rows?.[3]?.flawless === false, r.json?.rows);
  check('用时存两位小数', r.json?.rows?.[1]?.time === 250.46 && r.json?.rows?.[3]?.time === 280, r.json?.rows);

  r = await getBoard(A, '?round=1&sort=acc');
  check('按命中率：只算 shots ≥ 30、平手按用时', same(names(r), ['Ace', 'YOLO', 'Tie', 'Dock Zero']), names(r));
  check('按命中率：每名取命中率最高那条', r.json?.rows?.[0]?.time === 300 && r.json?.rows?.[1]?.time === 254.3, r.json?.rows);
  check('按命中率：total 只数够 30 发的名字', r.json?.total === 4, r.json?.total);

  r = await getBoard(A, '?sort=damage');
  check('按掉血：升序、平手按用时', same(names(r), ['YOLO', 'Dock Zero', 'Ace', 'Tie', cjk, emo]), names(r));
  check('按掉血：每名取掉血最少那条', r.json?.rows?.[0]?.time === 240.5 && r.json?.rows?.[2]?.damage === 20, r.json?.rows);

  r = await getBoard(A, '?limit=2');
  check('limit 截断 rows，total 不变', r.json?.rows?.length === 2 && r.json?.total === 6, r.json);
  r = await getBoard(A, '?round=2');
  check('第 2 轮的榜', r.json?.total === 1 && r.json?.rows?.[0]?.time === 3400 && r.json?.rows?.[0]?.penalty === 100, r.json);
  r = await getBoard(A, '?round=7');
  check('没人打过的轮次', r.status === 200 && r.json?.total === 0 && same(r.json?.rows, []) && same(r.json?.rounds, [1, 2]), r.json);

  for (const [q, code] of [['?sort=foo', 'sort'], ['?round=0', 'round'], ['?round=51', 'round'], ['?round=abc', 'round'],
    ['?limit=0', 'limit'], ['?limit=101', 'limit'], ['?limit=-1', 'limit']]) {
    expectError(`查询参数 ${q}`, await getBoard(A, q), 400, code);
  }
}

async function httpRules(A) {
  const allowed = 'https://cyancity.github.io';
  let r = await getBoard(A, '', { headers: { origin: allowed } });
  check('允许的 origin 回 ACAO 和 Vary', r.h.get('access-control-allow-origin') === allowed && /\bOrigin\b/.test(r.h.get('vary') ?? ''));
  r = await call(A, 'POST', '/v1/runs', { body: {}, headers: { origin: 'http://localhost:5188' } });
  check('本地开发端口的 origin 也允许', r.status === 200 && r.h.get('access-control-allow-origin') === 'http://localhost:5188');
  r = await getBoard(A, '', { headers: { origin: 'https://evil.example' } });
  check('不在名单的 origin 照常 200 但不带 CORS 头', r.status === 200 && !r.h.has('access-control-allow-origin') && !r.h.has('vary'));
  r = await submit(A, {}, { headers: { origin: allowed } });
  check('错误响应也带 CORS 头', r.status === 400 && r.h.get('access-control-allow-origin') === allowed);

  const pre = { 'access-control-request-method': 'POST', 'access-control-request-headers': 'content-type' };
  r = await call(A, 'OPTIONS', '/v1/rounds', { headers: { origin: allowed, ...pre } });
  check('预检 204', r.status === 204, r.status);
  check('预检带 ACAO', r.h.get('access-control-allow-origin') === allowed);
  check('预检允许 GET, POST, OPTIONS', r.h.get('access-control-allow-methods') === 'GET, POST, OPTIONS');
  check('预检允许 content-type 头', r.h.get('access-control-allow-headers') === 'content-type');
  check('预检 Max-Age 86400', r.h.get('access-control-max-age') === '86400');
  r = await call(A, 'OPTIONS', '/v1/rounds', { headers: { origin: 'https://evil.example', ...pre } });
  check('不在名单的预检不带 ACAO', r.status === 204 && !r.h.has('access-control-allow-origin'));
  expectError('未知路径的预检 404', await call(A, 'OPTIONS', '/nope', { headers: { origin: allowed } }), 404, 'not_found');

  expectError('请求体超过 2KB', await call(A, 'POST', '/v1/rounds', { raw: JSON.stringify({ pad: 'x'.repeat(3000) }) }), 413, 'too_large');
  const enc = new TextEncoder();
  const stream = new ReadableStream({
    start(c) {
      c.enqueue(enc.encode(`{"pad":"${'x'.repeat(1500)}`));
      c.enqueue(enc.encode(`${'x'.repeat(1500)}"}`));
      c.close();
    },
  });
  expectError('分块发送、没有 Content-Length 的超长请求体', await call(A, 'POST', '/v1/runs', { raw: stream }), 413, 'too_large');
  r = await call(A, 'POST', '/v1/runs', { raw: `{"pad":"${'x'.repeat(2038)}"}` });
  check('正好 2048 字节不算超', r.status === 200, r.status);

  expectError('JSON 解析失败', await call(A, 'POST', '/v1/rounds', { raw: '{bad' }), 400, 'bad_json');
  expectError('JSON 是数组', await call(A, 'POST', '/v1/rounds', { raw: '[1,2]' }), 400, 'bad_json');
  expectError('JSON 是 null', await call(A, 'POST', '/v1/runs', { raw: 'null' }), 400, 'bad_json');

  for (const p of ['/nope', '/v1/board/', '/v1', '/__proto__', '/constructor']) {
    expectError(`404 ${p}`, await call(A, 'GET', p), 404, 'not_found');
  }
  r = await call(A, 'GET', '/v1/runs');
  expectError('GET /v1/runs 405', r, 405, 'method');
  check('405 带 Allow 头', r.h.get('allow') === 'POST, OPTIONS', r.h.get('allow'));
  expectError('PUT /v1/rounds 405', await call(A, 'PUT', '/v1/rounds', { body: {} }), 405, 'method');
  expectError('DELETE /v1/board 405', await call(A, 'DELETE', '/v1/board'), 405, 'method');
  expectError('POST /health 405', await call(A, 'POST', '/health', { body: {} }), 405, 'method');
}

async function rateRules(A) {
  const ip = '10.250.0.1';
  let last;
  for (let i = 0; i < 30; i++) last = await call(A, 'POST', '/v1/rounds', { raw: '{}', ip });
  check('提交前 30 次不限流', last.status === 400, last.status);
  expectError('提交第 31 次 429', await call(A, 'POST', '/v1/rounds', { raw: '{}', ip }), 429, 'rate_limited');
  expectError('只认 X-Forwarded-For 最后一段', await call(A, 'POST', '/v1/rounds', { raw: '{}', ip: `1.2.3.4, ${ip}` }), 429, 'rate_limited');
  last = await call(A, 'POST', '/v1/rounds', { raw: '{}', ip: `${ip}, 10.250.0.2` });
  check('别的 IP 不受影响', last.status === 400, last.status);
  last = await call(A, 'POST', '/v1/runs', { body: {}, ip });
  check('开局和提交分开计数', last.status === 200, last.status);

  const ip2 = '10.250.1.1';
  for (let i = 0; i < 59; i++) last = await call(A, 'POST', '/v1/runs', { body: {}, ip: ip2 });
  last = await call(A, 'POST', '/v1/runs', { body: {}, ip: ip2 });
  check('开局前 60 次不限流', last.status === 200, last.status);
  expectError('开局第 61 次 429', await call(A, 'POST', '/v1/runs', { body: {}, ip: ip2 }), 429, 'rate_limited');

  const ip3 = '10.250.2.1';
  for (let i = 0; i < 240; i++) last = await getBoard(A, '?limit=1', { ip: ip3 });
  check('GET 前 240 次不限流', last.status === 200, last.status);
  expectError('GET 第 241 次 429', await getBoard(A, '', { ip: ip3 }), 429, 'rate_limited');
  expectError('/health 和榜单共用 GET 额度', await call(A, 'GET', '/health', { ip: ip3 }), 429, 'rate_limited');
}

async function storageRules(A, dirA, runA) {
  const db = new Database(join(dirA, 'board.db'), { timeout: 0 });
  try {
    // 占住写锁，服务写库时等满 busy timeout 后报错，应得 500 且进程不退出
    db.exec('BEGIN IMMEDIATE');
    let r;
    try {
      r = await submit(A, good(oldRun(), { name: 'Locked' }));
    } finally {
      db.exec('ROLLBACK');
    }
    expectError('写库失败返回 500', r, 500, 'server');
    r = await call(A, 'GET', '/health');
    check('500 之后进程还在', r.status === 200 && A.child.exitCode === null);

    const cols = db.prepare('PRAGMA table_info(rounds)').all().map((c) => c.name);
    check('库里没有 IP 列', !cols.some((c) => /ip|addr|host/i.test(c)), cols);
    const row = db.prepare('SELECT time, penalty, damage, at FROM rounds WHERE name = ?').get('Tie');
    check('存库的用时取两位小数', row?.time === 250.46 && row?.penalty === 0, row);
    check('at 是服务器毫秒时间', Math.abs((row?.at ?? 0) - Date.now()) < 60_000, row);
    const n = db.prepare('SELECT COUNT(*) AS n FROM rounds WHERE run = ?').get(runId(runA)).n;
    check('重复提交没新增记录，库里存的是 run 的 id', n === 2, n);
    check('名字存的是归一化后的', db.prepare('SELECT COUNT(*) AS n FROM rounds WHERE name = ?').get('Dock Zero').n === 1);
  } finally {
    db.close();
  }
}

function adminRules(A, dirA) {
  const admin = (...args) => execFileSync(process.execPath, [ADMIN, ...args], { env: { ...process.env, DATA_DIR: dirA }, encoding: 'utf8' });
  check('admin list 列出记录', /YOLO/.test(admin('list')) && /Tie/.test(admin('list', '1')) && !/Tie/.test(admin('list', '2')));
  check('admin delete-name 按归一化后的名字删', /已删除 1 条/.test(admin('delete-name', ' Ｄｏｃｋ', ' Zero')));
  const id = /^\s*(\d+)\s+r1\s+250\.46/m.exec(admin('list', '1'))?.[1];
  check('admin delete <id>', id !== undefined && /已删除/.test(admin('delete', id)) && /没有 id/.test(admin('delete', id)));
}

async function secretRules() {
  const dirB = join(temp, 'b');
  const B = await start('B', { DATA_DIR: dirB, RATE_RUNS: '2', ALLOW_ORIGINS: 'https://a.example, https://b.example' });
  const file = join(dirB, 'secret');
  check('没给 BOARD_SECRET 时生成 secret 文件', existsSync(file));
  const fileSecret = readFileSync(file, 'utf8').trim();
  check('secret 至少 32 字符', fileSecret.length >= 32);
  if (process.platform !== 'win32') check('secret 文件权限 600', (statSync(file).mode & 0o777) === 0o600);

  let r = await call(B, 'POST', '/v1/runs', { body: {}, headers: { origin: 'https://b.example' } });
  const [id, start0] = String(r.json?.run).split('.');
  check('用 secret 文件里的密钥签名', sign(Number(start0), fileSecret, id) === r.json?.run);
  check('ALLOW_ORIGINS 可配置', r.h.get('access-control-allow-origin') === 'https://b.example');
  r = await call(B, 'GET', '/health', { headers: { origin: 'https://cyancity.github.io' } });
  check('自定义名单后默认 origin 不再放行', r.status === 200 && !r.h.has('access-control-allow-origin'));
  await call(B, 'POST', '/v1/runs', { body: {} });
  expectError('TRUST_PROXY 关闭时不看 X-Forwarded-For，RATE_RUNS 生效', await call(B, 'POST', '/v1/runs', { body: {} }), 429, 'rate_limited');
  check('日志里看得到 trust proxy 关闭', /trust proxy off/.test(B.out));
  await stop(B);

  const B2 = await start('B2', { DATA_DIR: dirB });
  check('重启后 secret 文件不变', readFileSync(file, 'utf8').trim() === fileSecret);
  r = await submit(B2, good(sign(Date.now() - HOUR, fileSecret)));
  check('重启后沿用同一个密钥', r.status === 200 && r.json?.ok === true, r.json);
  await stop(B2);
}

function logRules(A, tokens) {
  const lines = A.out.trim().split(/\r?\n/);
  const bad = lines.slice(1).find((l) => !/^\S+Z [A-Z]+ \S+ \d{3} \d+ms( error=\w+)?( name=".*")?( aborted)?$/.test(l));
  check('日志一行一条请求', bad === undefined, bad);
  check('日志里有名字', A.out.includes('name="YOLO"'));
  const leaked = tokens.find((t) => A.out.includes(runId(t)) || A.out.includes(t.split('.')[2]) || A.err.includes(runId(t)));
  check('日志不含 token', leaked === undefined, leaked);
  check('日志不含名字以外的请求内容', !/afternoon|254\.3|"shots"/.test(A.out + A.err));
}

async function main() {
  const dirA = join(temp, 'a');
  const A = await start('A', { BOARD_SECRET: SECRET, TRUST_PROXY: '1', DATA_DIR: dirA });
  const slow = slowRequest(A);

  const fresh = await basics(A);
  await tokenRules(A);
  await fieldRules(A);
  const runA = await flow(A);
  await boardRules(A);
  await httpRules(A);
  await rateRules(A);
  await storageRules(A, dirA, runA);
  adminRules(A, dirA);
  await secretRules();

  const s = await slow;
  check('请求 10 秒超时', s.ms >= 9000 && s.ms <= 13_000, s);
  check('超时回 408', s.head.startsWith('HTTP/1.1 408'), s);
  logRules(A, [fresh, runA]);
  await stop(A);
}

try {
  await main();
} catch (err) {
  failCount++;
  console.log(`FAIL 冒烟中途出错：${err?.stack ?? err}`);
} finally {
  for (const s of servers) await stop(s);
  rmSync(temp, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
}
console.log(`通过 ${pass}/${pass + failCount}`);
process.exitCode = failCount === 0 ? 0 : 1;
