// 成绩库：一张 rounds 表，一行是某一局（run）里打完的一轮。不存 IP。
import * as sqlite from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

// Node 26.11 起类名改成 Database，DatabaseSync 留作文档层面弃用的别名；26.10 只有后者
const Database = sqlite.Database ?? sqlite.DatabaseSync;

// 默认放在 server/data，不跟着启动时的当前目录走
export function dataDir() {
  return process.env.DATA_DIR ? resolve(process.env.DATA_DIR) : fileURLToPath(new URL('./data/', import.meta.url));
}

const SCHEMA = `
CREATE TABLE IF NOT EXISTS rounds (
  id        INTEGER PRIMARY KEY AUTOINCREMENT,
  run       TEXT    NOT NULL,
  round     INTEGER NOT NULL,
  name      TEXT    NOT NULL,
  time      REAL    NOT NULL,
  penalty   REAL    NOT NULL,
  shots     INTEGER NOT NULL,
  hits      INTEGER NOT NULL,
  headshots INTEGER NOT NULL,
  kills     INTEGER NOT NULL,
  damage    REAL    NOT NULL,
  tod       TEXT    NOT NULL,
  at        INTEGER NOT NULL,
  UNIQUE (run, round)
);
CREATE INDEX IF NOT EXISTS rounds_round_time ON rounds (round, time);
CREATE INDEX IF NOT EXISTS rounds_name ON rounds (name);
`;

// ORDER BY 不能参数绑定，只从这张固定表里取；id 兜底让同分同时刻的顺序也稳定
const ORDER = {
  time: 'time ASC, at ASC, id ASC',
  acc: 'CAST(hits AS REAL) / shots DESC, time ASC, at ASC, id ASC',
  damage: 'damage ASC, time ASC, at ASC, id ASC',
};
const FILTER = { time: '', acc: 'AND shots >= 30', damage: '' };

const COLUMNS = 'run, round, name, time, penalty, shots, hits, headshots, kills, damage, tod, at';

// busyMs：别的连接（比如 admin.js）正在写时同步等待的上限，期间整个进程是卡住的
export function openStore(dir, { busyMs = 1000 } = {}) {
  mkdirSync(dir, { recursive: true });
  const db = new Database(join(dir, 'board.db'), { timeout: busyMs });
  db.exec('PRAGMA journal_mode = WAL; PRAGMA synchronous = NORMAL;');
  db.exec(SCHEMA);

  const q = {
    find: db.prepare('SELECT id, time, name FROM rounds WHERE run = ? AND round = ?'),
    used: db.prepare('SELECT COALESCE(SUM(time - penalty), 0) AS used FROM rounds WHERE run = ? AND round < ?'),
    insert: db.prepare(`INSERT INTO rounds (${COLUMNS}) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT (run, round) DO NOTHING`),
    // 只数这条记录之前就在库里的，重复提交时算出来的就是第一次的名次。自己以前更快的成绩不算别人
    rank: db.prepare(`SELECT COUNT(DISTINCT name) + 1 AS rank FROM rounds
      WHERE round = ? AND time < ? AND id < ? AND name <> ?`),
    rounds: db.prepare('SELECT DISTINCT round FROM rounds ORDER BY round'),
    recent: db.prepare(`SELECT id, round, name, time, at FROM rounds
      WHERE ? IS NULL OR round = ? ORDER BY id DESC LIMIT ?`),
    byId: db.prepare('SELECT id, round, name, time, at FROM rounds WHERE id = ?'),
    deleteId: db.prepare('DELETE FROM rounds WHERE id = ?'),
    deleteName: db.prepare('DELETE FROM rounds WHERE name = ?'),
  };
  const board = {};
  const total = {};
  for (const sort of Object.keys(ORDER)) {
    board[sort] = db.prepare(`SELECT name, time, penalty, shots, hits, damage, tod, at FROM (
        SELECT *, ROW_NUMBER() OVER (PARTITION BY name ORDER BY ${ORDER[sort]}) AS rn
        FROM rounds WHERE round = ? ${FILTER[sort]}
      ) WHERE rn = 1 ORDER BY ${ORDER[sort]} LIMIT ?`);
    total[sort] = db.prepare(`SELECT COUNT(DISTINCT name) AS n FROM rounds WHERE round = ? ${FILTER[sort]}`);
  }

  const rankOf = (round, time, id, name) => q.rank.get(round, time, id, name).rank;

  return {
    find(run, round) {
      const row = q.find.get(run, round);
      return row ? { id: row.id, rank: rankOf(round, row.time, row.id, row.name) } : null;
    },
    // 这一局在 round 之前各轮的有效用时（time - penalty）之和
    used(run, round) {
      return q.used.get(run, round).used;
    },
    // 返回 { id, rank }；(run, round) 已存在时返回已有那条
    insert(run, r, at) {
      const res = q.insert.run(run, r.round, r.name, r.time, r.penalty, r.shots, r.hits, r.headshots, r.kills, r.damage, r.tod, at);
      if (res.changes === 0) return this.find(run, r.round);
      const id = Number(res.lastInsertRowid);
      return { id, rank: rankOf(r.round, r.time, id, r.name) };
    },
    board(round, sort, limit) {
      return { total: total[sort].get(round).n, rows: board[sort].all(round, limit) };
    },
    rounds() {
      return q.rounds.all().map((r) => r.round);
    },
    recent(round, limit = 50) {
      return q.recent.all(round, round, limit);
    },
    byId(id) {
      return q.byId.get(id);
    },
    deleteId(id) {
      return q.deleteId.run(id).changes;
    },
    deleteName(name) {
      return q.deleteName.run(name).changes;
    },
    close() {
      if (db.isOpen) db.close();
    },
  };
}
