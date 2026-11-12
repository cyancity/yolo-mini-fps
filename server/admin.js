// 命令行管理，直接读写 DATA_DIR 下的 board.db。服务开着也能用（WAL）。
//   node admin.js list [round]        最近 50 条
//   node admin.js delete <id>         删一条
//   node admin.js delete-name <名字>  列出这个名字的记录数；末尾加 --yes 才真删
import { dataDir, openStore } from './store.js';
import { normalizeName } from './validate.js';

const USAGE = `用法：
  node admin.js list [round]
  node admin.js delete <id>
  node admin.js delete-name <名字> [--yes]`;

const [cmd, ...args] = process.argv.slice(2);

function fmt(r) {
  return [String(r.id).padStart(6), `r${r.round}`.padEnd(4), r.time.toFixed(2).padStart(8), new Date(r.at).toISOString(), r.name].join('  ');
}

function run(store) {
  if (cmd === 'list') {
    if (args[0] !== undefined && !/^\d+$/.test(args[0])) return USAGE;
    const rows = store.recent(args[0] === undefined ? null : Number(args[0]));
    if (rows.length === 0) return '没有记录';
    return ['    id  轮次      用时  时间（UTC）               名字', ...rows.map(fmt)].join('\n');
  }
  if (cmd === 'delete') {
    if (!/^\d+$/.test(args[0] ?? '')) return USAGE;
    const row = store.byId(Number(args[0]));
    if (!row) return `没有 id ${args[0]}`;
    store.deleteId(row.id);
    return `已删除：\n${fmt(row)}`;
  }
  if (cmd === 'delete-name') {
    // 库里存的是归一化后的名字，输入也按同样规则处理再比
    const yes = args.at(-1) === '--yes';
    const name = normalizeName((yes ? args.slice(0, -1) : args).join(' '));
    if (name === null) return USAGE;
    // 名字归一化以后才比（全角、多余空格都会命中同一个名字）：先看清会删多少条
    const n = store.countName(name);
    if (!yes) return `名字 ${JSON.stringify(name)} 有 ${n} 条记录。确认删除在命令末尾加 --yes`;
    return `已删除 ${store.deleteName(name)} 条，名字 ${JSON.stringify(name)}`;
  }
}

if (!['list', 'delete', 'delete-name'].includes(cmd)) {
  // 命令都不对时不去打开库，免得在错误的目录里凭空建一个空库
  console.log(USAGE);
  process.exitCode = 1;
} else {
  const store = openStore(dataDir(), { busyMs: 5000 });
  try {
    const out = run(store);
    console.log(out);
    if (out === USAGE) process.exitCode = 1;
  } finally {
    store.close();
  }
}
