# 零号码头排行榜服务

游戏是 GitHub Pages 上的纯静态站点，这个服务替它收成绩、出排行榜。玩家每清完一圈五个区域算打完一轮，浏览器把这一轮的成绩报上来，所有玩家共用一张榜。不注册不登录，只填一个名字。

服务只用 Node 26 的内置模块（`node:http`、`node:sqlite`、`node:crypto`），没有 npm 依赖，数据存在一个 SQLite 文件里。成绩是浏览器报的，防不住作弊，服务只做基本校验和按 IP 限流。

## 接口

所有请求和响应都是 UTF-8 的 JSON。线上经 Caddy 反代在 `/dockzero` 下，服务自己看到的路径不带这个前缀。

| 方法和路径 | 用途 | 成功时返回 |
|---|---|---|
| `POST /v1/runs` | 开一局，请求体 `{}` | `{ "run": "<token>" }` |
| `POST /v1/rounds` | 提交打完的一轮 | `{ "ok": true, "id": 12, "rank": 3 }` |
| `GET /v1/board?round=1&sort=time&limit=50` | 某一轮的榜 | 见下文 |
| `GET /health` | 存活检查 | `{ "ok": true }` |

### 开局

token 的格式是 `<id>.<startMs>.<sig>`。id 是 12 字节随机数的 base64url，startMs 是服务器开局时刻（毫秒），sig 是 `HMAC-SHA256(密钥, id + "." + startMs)` 的 base64url。服务不存 token，靠签名认。token 签发后 24 小时内有效。

### 提交一轮

```json
{ "run": "<token>", "name": "YOLO", "round": 1, "time": 254.3, "penalty": 0, "shots": 210, "hits": 131, "headshots": 9, "kills": 21, "damage": 85, "tod": "afternoon" }
```

`time` 是这一轮的用时（秒，已含罚时），`penalty` 是其中的罚时，`damage` 是这一轮掉的血，`tod` 是 `night`、`afternoon`、`day` 之一。数字必须是 JSON 数字，字符串 `"1"` 不算。

名字先做 NFKC 归一化，去掉控制字符、零宽和方向控制这类格式字符，首尾去空白，中间连续空白压成一个，按码点算要有 1 到 12 个字符。榜上和库里存的都是归一化之后的名字。

除了逐个字段的范围，服务还核对时间：这一局之前各轮的 `time - penalty` 加上本轮的，不能超过开局至今的时长再加 5 秒。第 2 轮起，这一局的上一轮必须已经交过。

同一局同一轮只收一次。重复提交返回 200 和第一次那条记录的 `id`、`rank`，不新增记录，也不改名字。

`rank` 是该轮里「最好用时比这次短的名字数」加 1，只数这条记录入库之前就在的记录，所以重复提交拿到的还是第一次的名次。同一个名字以前跑得更快的话，自己那个名字也算一个，这时名次会比榜上这个名字的位置靠后。

### 排行榜

`sort` 取 `time`（用时升序）、`acc`（命中率降序，只算 `shots ≥ 30` 的记录，平手按用时）、`damage`（掉血升序，平手按用时），默认 `time`。`round` 取 1 到 50，默认 1。`limit` 取 1 到 100，默认 50。每个名字只出一行，是这个名字在该轮、该排序下最好的那条。名字区分大小写。

```json
{ "round": 1, "sort": "time", "total": 37, "rounds": [1, 2, 3],
  "rows": [ { "name": "YOLO", "time": 254.3, "penalty": 0, "shots": 210, "hits": 131, "damage": 85, "flawless": false, "tod": "afternoon", "at": 1794500000000 } ] }
```

`total` 是这一轮、这种排序下上榜的名字数（`acc` 只数有过 30 发以上记录的名字），`rounds` 是库里有记录的轮次，`flawless` 是 `damage === 0`，`at` 是服务器收到成绩的时刻（毫秒）。

### 错误

出错时返回 `{ "error": "<代码>" }`。

| 状态码 | 代码 | 含义 |
|---|---|---|
| 400 | `bad_json` | 请求体不是 JSON 对象 |
| 400 | `run` | token 缺失、格式不对或签名不对 |
| 400 | `run_expired` | token 的开局时刻在未来，或早于 24 小时前 |
| 400 | `name`、`round`、`time`、`penalty`、`shots`、`hits`、`kills`、`headshots`、`damage`、`tod` | 对应字段不合法，按这个顺序只报第一个 |
| 400 | `round_gap` | 这一局的上一轮还没交 |
| 400 | `time_mismatch` | 各轮用时之和超过开局至今的时长 |
| 400 | `sort`、`limit`、`round` | 排行榜的查询参数不合法 |
| 404 | `not_found` | 没有这个路径 |
| 405 | `method` | 方法不对，`Allow` 头里写着能用的方法 |
| 413 | `too_large` | 请求体超过 2048 字节 |
| 429 | `rate_limited` | 超过限流 |
| 500 | `server` | 服务内部出错 |

### 其他行为

`Origin` 在允许名单里时回 `Access-Control-Allow-Origin` 和 `Vary: Origin`，不在名单里就不加 CORS 头，请求照常处理。`OPTIONS` 预检回 204，允许 `GET, POST, OPTIONS` 和 `content-type` 头，缓存 86400 秒。

限流按客户端 IP 分开计数：`POST /v1/rounds` 每小时 30 次，`POST /v1/runs` 每小时 60 次，所有 `GET`（含 `/health`）每 10 分钟 240 次。计数在内存里，重启清零。

所有响应带 `Cache-Control: no-store` 和 `X-Content-Type-Options: nosniff`。一个请求 10 秒内收不完就断开。

## 本地运行

```sh
node server/board.js
```

默认监听 `127.0.0.1:8823`，数据放在 `server/data/`（已在 `server/.gitignore` 里忽略）。

| 环境变量 | 默认值 | 说明 |
|---|---|---|
| `PORT` | `8823` | |
| `HOST` | `127.0.0.1` | 容器里是 `0.0.0.0` |
| `DATA_DIR` | `server/data` | 放 `board.db` 和 `secret`；给相对路径时按当前目录解析 |
| `ALLOW_ORIGINS` | `https://cyancity.github.io` 和本地 5183、5184、5185、5188 端口 | 逗号分隔 |
| `TRUST_PROXY` | 不开 | 设成 `1` 时客户端 IP 取 `X-Forwarded-For` 的最后一段 |
| `BOARD_SECRET` | 不设 | 签 token 的密钥；不设时首次启动随机生成，存成数据目录下的 `secret`（权限 600），之后沿用 |
| `RATE_ROUNDS`、`RATE_RUNS`、`RATE_GET` | 30、60、240 | 限流次数，只为测试和临时调整 |

换密钥（改 `BOARD_SECRET` 或删掉 `secret` 文件）会让所有还没打完的局交不了成绩。

## 冒烟

```sh
node server/smoke.mjs
```

脚本在系统临时目录建数据目录，在空闲端口起服务子进程，把上面的规则逐条打一遍，最后打印通过数，有失败时退出码非零，结束后删掉临时目录。整个过程约 11 秒，主要是在等 10 秒的请求超时。

## 部署

服务器是 Oracle ARM（arm64），Caddy 已经在跑。

1. 把仓库拉到服务器上（`git clone https://github.com/cyancity/yolo-mini-fps.git`，已有就 `git pull`），进入 `server/` 目录。
2. 构建并启动：

   ```sh
   docker compose up -d --build
   docker compose ps
   ```

   容器只绑 `127.0.0.1:8823`，数据在命名卷 `dockzero_board-data` 里，密钥首次启动时生成在卷里。

3. 在 Caddy 对应域名的站点块里加：

   ```caddyfile
   handle_path /dockzero/* {
   	reverse_proxy 127.0.0.1:8823
   }
   ```

   `handle_path` 会去掉 `/dockzero` 前缀再转发。站点块里已经有别的 `handle` 时，这几个 `handle` 互斥，按路径匹配各走各的。然后重载 Caddy（`sudo systemctl reload caddy` 或 `caddy reload --config <Caddyfile>`）。

4. 验证：

   ```sh
   curl https://<域名>/dockzero/health
   curl -X POST https://<域名>/dockzero/v1/runs -H 'content-type: application/json' -d '{}'
   curl 'https://<域名>/dockzero/v1/board?round=1'
   ```

   第一条应返回 `{"ok":true}`。看日志用 `docker compose logs -f board`。

前端的服务地址写 `https://<域名>/dockzero`。如果 Caddy 前面还有 Cloudflare 这类 CDN，`X-Forwarded-For` 的最后一段会是 CDN 节点，限流就不再按玩家算，这时要在 Caddy 里配 `trusted_proxies`。

## 回滚

```sh
docker compose down
```

不加 `-v`，数据卷保留。再把 Caddy 里的 `handle_path /dockzero/*` 那段删掉并重载。要恢复时重新 `docker compose up -d`，成绩和密钥都还在。

备份就是拷数据卷：先 `docker compose stop`，再把卷里的 `board.db`（连同 `board.db-wal`，如果有）和 `secret` 拷出来。

## 管理命令

直接读写同一个库，服务开着也能用。

```sh
node admin.js list [round]        # 最近 50 条：id、轮次、用时、时间（UTC）、名字
node admin.js delete <id>         # 删一条
node admin.js delete-name <名字>  # 删这个名字的全部记录，名字按提交时的规则归一化后再比
```

本地在 `server/` 目录下运行。服务器上在容器里运行：

```sh
docker compose exec board node admin.js list
```

删掉某一局的中间一轮后，这一局后面的轮次就交不上了（会报 `round_gap`）。

## 存了什么

库里一张 `rounds` 表，每行一轮成绩：局的 id（token 的第一段，不是整个 token）、轮次、名字、用时、罚时、开枪数、命中数、爆头数、击杀数、掉血、时段，以及服务器收到时的时间。用时、罚时、掉血存两位小数。

不存 IP。IP 只在内存里用来限流，日志也不记 IP。日志一行一个请求：时间、方法、路径、状态码、耗时，提交成绩时带上名字，出错时带上错误代码，不记 token 和其他请求内容。
