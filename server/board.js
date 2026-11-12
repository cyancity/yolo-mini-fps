// 零号码头排行榜服务入口：读配置、起 http、分路由。运行：node board.js
import { createServer } from 'node:http';
import { performance } from 'node:perf_hooks';
import { createLimiter } from './limit.js';
import { dataDir, openStore } from './store.js';
import { loadSecret, makeTokens } from './token.js';
import { checkBoardQuery, checkRound } from './validate.js';

const DEFAULT_ORIGINS = 'https://cyancity.github.io,http://localhost:5183,http://localhost:5184,http://localhost:5185,http://localhost:5188';
const MAX_BODY = 2048;
const GRACE_MS = 5000;
const HOUR = 3600 * 1000;

const env = process.env;
const posInt = (raw, fallback) => (/^\d+$/.test(raw ?? '') && Number(raw) > 0 ? Number(raw) : fallback);

const config = {
  port: /^\d+$/.test(env.PORT ?? '') ? Number(env.PORT) : 8823,
  host: env.HOST || '127.0.0.1',
  dataDir: dataDir(),
  // 设成空串也按默认名单，免得 compose 里留个空变量就把前端全挡掉
  origins: new Set((env.ALLOW_ORIGINS || DEFAULT_ORIGINS).split(',').map((s) => s.trim()).filter(Boolean)),
  trustProxy: env.TRUST_PROXY === '1',
};

const store = openStore(config.dataDir);
const tokens = makeTokens(loadSecret(config.dataDir));
// RATE_* 只为测试和临时调整，平时用默认值
const limiter = createLimiter({
  rounds: { limit: posInt(env.RATE_ROUNDS, 30), windowMs: HOUR },
  runs: { limit: posInt(env.RATE_RUNS, 60), windowMs: HOUR },
  get: { limit: posInt(env.RATE_GET, 240), windowMs: 10 * 60 * 1000 },
});

class HttpError extends Error {
  constructor(status, code) {
    super(code);
    this.status = status;
    this.code = code;
  }
}
const fail = (status, code) => { throw new HttpError(status, code); };

// ---- 路由处理，返回响应体，出错抛 HttpError ----

function health() {
  return { ok: true };
}

async function newRun(req) {
  parseJson(await readBody(req));
  return { run: tokens.issue() };
}

async function submitRound(req, ctx) {
  const body = parseJson(await readBody(req));
  const now = Date.now();
  const run = tokens.read(body.run, now);
  if (run.error) fail(400, run.error);
  const checked = checkRound(body);
  if (checked.error) fail(400, checked.error);
  const r = checked.value;
  ctx.name = r.name;

  const existing = store.find(run.id, r.round);
  if (existing) return { ok: true, ...existing };
  if (r.round > 1 && !store.find(run.id, r.round - 1)) fail(400, 'round_gap');
  const used = store.used(run.id, r.round) + (r.time - r.penalty);
  if (used * 1000 > now - run.startMs + GRACE_MS) fail(400, 'time_mismatch');

  return { ok: true, ...store.insert(run.id, r, now) };
}

function board(req, ctx, params) {
  const checked = checkBoardQuery(params);
  if (checked.error) fail(400, checked.error);
  const { round, sort, limit } = checked.value;
  const { total, rows } = store.board(round, sort, limit);
  return {
    round,
    sort,
    total,
    rounds: store.rounds(),
    rows: rows.map((r) => ({
      name: r.name,
      time: r.time,
      penalty: r.penalty,
      shots: r.shots,
      hits: r.hits,
      damage: r.damage,
      flawless: r.damage === 0,
      tod: r.tod,
      at: r.at,
    })),
  };
}

const ROUTES = {
  '/health': { GET: health },
  '/v1/runs': { POST: newRun },
  '/v1/rounds': { POST: submitRound },
  '/v1/board': { GET: board },
};
const BUCKET = { '/v1/runs': 'runs', '/v1/rounds': 'rounds' };

// ---- 请求体 ----

function readBody(req) {
  return new Promise((resolve, reject) => {
    const tooLarge = () => {
      // 不再收集，但把剩下的读掉，客户端才收得到 413；连接随后关闭，慢速灌数据的由请求超时兜底
      req.removeAllListeners('data');
      req.resume();
      reject(new HttpError(413, 'too_large'));
    };
    if (Number(req.headers['content-length']) > MAX_BODY) return tooLarge();
    const chunks = [];
    let size = 0;
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > MAX_BODY) return tooLarge();
      chunks.push(chunk);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    // 客户端断开或请求超时：响应已经送不出去，只为日志里标一下
    const aborted = () => reject(new HttpError(400, 'aborted'));
    req.on('error', aborted);
    req.on('close', () => {
      if (!req.complete) aborted();
    });
  });
}

function parseJson(text) {
  if (text.trim() === '') return {};
  let v;
  try {
    v = JSON.parse(text);
  } catch {
    fail(400, 'bad_json');
  }
  if (v === null || typeof v !== 'object' || Array.isArray(v)) fail(400, 'bad_json');
  return v;
}

// ---- http ----

// 限流用的键。IPv6 只取前 64 位：一个用户通常拿到整个 /64，逐个换地址不该各算一份额度
function limitKey(ip) {
  if (!ip.includes(':') || ip.startsWith('::ffff:')) return ip;
  const [head, tail = ''] = ip.split('::');
  const a = head ? head.split(':') : [], b = tail ? tail.split(':') : [];
  const groups = ip.includes('::') ? [...a, ...Array(Math.max(0, 8 - a.length - b.length)).fill('0'), ...b] : a;
  return groups.slice(0, 4).map((g) => g.toLowerCase().replace(/^0+(?=.)/, '')).join(':') + '::/64';
}

function clientIp(req) {
  if (config.trustProxy) {
    const xff = req.headers['x-forwarded-for'];
    // 只信最后一段：那是反代自己看到的对端，前面几段客户端可以随便写
    const last = typeof xff === 'string' ? xff.split(',').pop().trim() : '';
    if (last) return limitKey(last.slice(0, 64));
  }
  return limitKey(req.socket.remoteAddress ?? 'unknown');
}

function send(res, status, body) {
  if (res.headersSent) return void res.destroy();
  res.statusCode = status;
  if (body === undefined) return void res.end();
  const data = JSON.stringify(body);
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Content-Length', Buffer.byteLength(data));
  res.end(data);
}

const oneLine = (err) => String(err?.stack ?? err).replace(/\s*\n\s*/g, ' | ');

function logLine(req, res, path, ctx, t0) {
  const ms = Math.round(performance.now() - t0);
  let line = `${new Date().toISOString()} ${req.method} ${path.slice(0, 80)} ${res.statusCode} ${ms}ms`;
  if (ctx.error) line += ` error=${ctx.error}`;
  if (ctx.name !== null) line += ` name=${JSON.stringify(ctx.name)}`;
  if (!res.writableFinished) line += ' aborted';
  console.log(line);
}

async function handle(req, res) {
  const t0 = performance.now();
  const ctx = { name: null, error: null };
  const q = req.url.indexOf('?');
  const path = q < 0 ? req.url : req.url.slice(0, q);
  res.on('close', () => logLine(req, res, path, ctx, t0));

  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  const origin = req.headers.origin;
  if (origin && config.origins.has(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Vary', 'Origin');
  }

  try {
    const route = Object.hasOwn(ROUTES, path) ? ROUTES[path] : null;
    if (!route) fail(404, 'not_found');
    if (req.method === 'OPTIONS') {
      res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
      res.setHeader('Access-Control-Allow-Headers', 'content-type');
      res.setHeader('Access-Control-Max-Age', '86400');
      return send(res, 204);
    }
    const fn = Object.hasOwn(route, req.method) ? route[req.method] : null;
    if (!fn) {
      res.setHeader('Allow', [...Object.keys(route), 'OPTIONS'].join(', '));
      fail(405, 'method');
    }
    // POST 只收 JSON：text/plain 这类「简单请求」不触发预检，别的网站能让访客的浏览器替它提交
    if (req.method === 'POST' && !/^application\/json\b/i.test(req.headers['content-type'] ?? '')) fail(415, 'content_type');
    if (!limiter.hit(BUCKET[path] ?? 'get', clientIp(req))) fail(429, 'rate_limited');
    const params = new URLSearchParams(q < 0 ? '' : req.url.slice(q + 1));
    send(res, 200, await fn(req, ctx, params));
  } catch (err) {
    if (err instanceof HttpError) {
      ctx.error = err.code;
      if (err.status === 413) res.setHeader('Connection', 'close');
      return send(res, err.status, { error: err.code });
    }
    ctx.error = 'server';
    console.error(`${new Date().toISOString()} error ${oneLine(err)}`);
    send(res, 500, { error: 'server' });
  }
}

const server = createServer(
  // connectionsCheckingInterval 默认 30 秒，不调小的话 10 秒超时实际可能拖到 40 秒
  { requestTimeout: 10_000, headersTimeout: 10_000, connectionsCheckingInterval: 1000 },
  (req, res) => {
    handle(req, res).catch((err) => {
      console.error(`${new Date().toISOString()} error ${oneLine(err)}`);
      send(res, 500, { error: 'server' });
    });
  },
);

process.on('uncaughtException', (err) => console.error(`${new Date().toISOString()} uncaught ${oneLine(err)}`));
process.on('unhandledRejection', (err) => console.error(`${new Date().toISOString()} unhandled ${oneLine(err)}`));

// 数据库操作都是同步的，收到信号时不会有写到一半的请求
for (const sig of ['SIGTERM', 'SIGINT']) {
  process.on(sig, () => {
    server.close();
    store.close();
    process.exit(0);
  });
}

// 端口被占这类启动失败要让进程退出，否则会被上面的 uncaughtException 吞掉，空跑着不监听
server.on('error', (err) => {
  console.error(`${new Date().toISOString()} server ${oneLine(err)}`);
  if (!server.listening) process.exit(1);
});

server.listen(config.port, config.host, () => {
  const { address, port } = server.address();
  console.log(`${new Date().toISOString()} board listening on ${address}:${port}, trust proxy ${config.trustProxy ? 'on' : 'off'}`);
});
