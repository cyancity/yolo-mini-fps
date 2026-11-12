// 一局的无状态凭证：<id>.<startMs>.<sig>，sig = HMAC-SHA256(secret, id + "." + startMs)
import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const DAY_MS = 24 * 3600 * 1000;
// 12 字节的 base64url 正好 16 个字符，SHA-256 的 base64url 正好 43 个
const TOKEN = /^([A-Za-z0-9_-]{16})\.(\d{1,15})\.([A-Za-z0-9_-]{43})$/;

// 有 BOARD_SECRET 就用它；否则沿用数据目录里的 secret 文件，没有就生成一个
export function loadSecret(dir) {
  const fromEnv = process.env.BOARD_SECRET;
  if (fromEnv) {
    if (fromEnv.length < 32) throw new Error('BOARD_SECRET 不足 32 个字符');
    return Buffer.from(fromEnv, 'utf8');
  }
  mkdirSync(dir, { recursive: true });
  const file = join(dir, 'secret');
  try {
    // wx：两个进程同时首次启动时只有一个能写成，另一个读它写好的
    writeFileSync(file, randomBytes(32).toString('base64url') + '\n', { mode: 0o600, flag: 'wx' });
  } catch (err) {
    if (err.code !== 'EEXIST') throw err;
  }
  const text = readFileSync(file, 'utf8').trim();
  if (text.length < 32) throw new Error('secret 文件内容不足 32 个字符，删掉它重启会重新生成（已发出的凭证随之作废）');
  return Buffer.from(text, 'utf8');
}

export function makeTokens(secret) {
  const sign = (body) => createHmac('sha256', secret).update(body).digest('base64url');
  return {
    issue(now = Date.now()) {
      const body = `${randomBytes(12).toString('base64url')}.${now}`;
      return `${body}.${sign(body)}`;
    },
    // 返回 { id, startMs } 或 { error }
    read(token, now = Date.now()) {
      const m = typeof token === 'string' ? TOKEN.exec(token) : null;
      if (!m) return { error: 'run' };
      const want = Buffer.from(sign(`${m[1]}.${m[2]}`));
      if (!timingSafeEqual(want, Buffer.from(m[3]))) return { error: 'run' };
      const startMs = Number(m[2]);
      if (startMs > now || now - startMs > DAY_MS) return { error: 'run_expired' };
      return { id: m[1], startMs };
    },
  };
}
