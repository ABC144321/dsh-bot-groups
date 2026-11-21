# dsh-bot-groups · Bot 群

> 给 DSH Bot 加一个群聊层，并在「模式」里加入 **Bot 模式** —— 像 Grok Bot 一样，Bot 之间可以互相拉群、@ 交接、圆桌讨论、共享群目标。

MIT License · 无运行时依赖（除了 `@zifeng1023/dsh-bot`）· 离线自测 63 项

## 它做了什么

**1. Bot 模式（模式选择器里的新卡片）**

新建会话时，模式里会多一项「Bot 模式」：一位常驻 Bot 助手的人设 + 完整的文件 / 搜索 / 网页 / 子代理能力 + `bot_group_*` 群聊工具。它不把活全揽在自己身上，而是会按需要拉群、@ 成员、把球传出去。

**2. Bot 群（侧边栏「Bot 群」面板）**

- 拉群：把多位已有 Bot 拉进一个群，可选主持人、每轮接力人数。
- 路由模式：智能 @ 路由 / 依次发言 / 全员圆桌 / 主持人主导。
- @ 交接：Bot 回复里 `@成员名` 会自动触发下一位发言（有轮次上限，避免无限接力）。
- 群目标：一句话目标会注入每次群发言的上下文，可标记进行中 / 暂停 / 已完成。
- 花费可见：每条 Bot 发言带本次花费，群头部统计累计花费与消息数。
- 私聊：`kind: dm` 就是和单个 Bot 的 1 对 1 会话。

**3. 输入框快捷条**

输入框下方常驻一条 `Bot 群` 快捷条：一眼看到未读与「进行中」，点一下就切到对应的群。

## 依赖

- `@zifeng1023/dsh-bot`（Bot 体系、Bot 身份、运行记录、预算与快照）。没有它时插件以只读降级模式运行，群消息可记录但 Bot 不会自动发言。
- DSH `>= 0.2.1-rc.5 < 0.3.0-0`。

## 安装

```powershell
# 方式一：从本仓库克隆后安装（安装会执行代码，需要完整权限）
git clone https://github.com/ABC144321/dsh-bot-groups.git
plugin_manager action=install_bundle target="<克隆下来的目录绝对路径>"

# 方式二：已下载到本地某个目录，直接指向它
plugin_manager action=install_bundle target="<本目录绝对路径>"
```

装好后：侧边栏出现「Bot 群」图标，新建会话的模式里出现「Bot 模式」，输入框上方出现快捷条，设置里出现「Bot 群」分区。

改了宿主代码（`lib/index.js`、`lib/store.js`、`lib/tools.js`）后不会热更新，需要在插件管理器里重启这一行：

```
plugin_manager action=set_plugin target="include:dsh-bot-groups" enabled=false
plugin_manager action=set_plugin target="include:dsh-bot-groups" enabled=true
```

只改 `lib/client.js` 时不用重启宿主，客户端 HMR 会重新发布 bundle 并重挂插槽（侧边栏图标就是这么生效的）。

## 数据在哪

```
~/.dsh/bot/groups/<groupId>.json   # 每个群一个文件：成员、消息、轮次、目标
~/.dsh/bot/bots/<botId>/...        # Bot 身份（由 dsh-bot 管理，本插件只读）
~/.dsh/bot/runs/YYYY/MM/*.json     # Bot 运行记录（由 dsh-bot 写入）
```

## 工具

`bot_group_list`、`bot_group_create`、`bot_group_show`、`bot_group_chat`、`bot_group_round`、`bot_group_speak`、`bot_group_invite`、`bot_group_remove_members`、`bot_group_goal`、`bot_group_mode`、`bot_group_delete`。

## HTTP API

同源、仅本机（Host/Origin 校验）：

```
GET    /_dsh-bot-groups/overview
GET    /_dsh-bot-groups/diag
GET    /_dsh-bot-groups/bots
POST   /_dsh-bot-groups/groups
GET    /_dsh-bot-groups/groups/:id
DELETE /_dsh-bot-groups/groups/:id
POST   /_dsh-bot-groups/groups/:id/messages
POST   /_dsh-bot-groups/groups/:id/rounds
POST   /_dsh-bot-groups/groups/:id/speak
POST   /_dsh-bot-groups/groups/:id/invite
POST   /_dsh-bot-groups/groups/:id/remove-members
POST   /_dsh-bot-groups/groups/:id/update
```

## 配置（cordis.patch.yml 的 `dsh-bot-groups` 行）

| 键 | 默认 | 说明 |
| --- | --- | --- |
| `homeDir` | `~/.dsh/bot` | Bot 与群数据根目录 |
| `replyDryRun` | `false` | 群内自动回复默认是否演练 |
| `handoffEnabled` | `true` | 是否允许回复里的 @ 触发下一位 |
| `maxBotsPerRound` | `6` | 一轮最多几位成员真的跑模型 |
| `runTimeoutMs` | `240000` | 单次发言超时 |
| `snapshotEnabled` | `false` | 群发言前是否给 Bot workspace 打快照 |

## 已知边界

- 群消息里的 @ 按「名字或 bot_xxx ID」精确匹配，不支持模糊匹配。
- 一轮接力有硬上限（`maxRounds` 与 `maxBotsPerRound` 取小），防止 Bot 之间无限对聊烧预算。一条人类消息最多触发 `maxBotsPerRound` 次真实模型运行，按需调小。
- 当前不监听 Host 推送，面板用轮询（运行中 2s，空闲 9s）。
- 本插件会自己构造一份 `BotService` + `RoutineRunner`（复用 dsh-bot 的 `~/.dsh/bot` 数据与模型），与 dsh-bot 自带的实例各自持锁；群内发言按群串行，不会和别群并发。

## 自测

不依赖 DSH 也能跑的三组（CI 每次提交都跑）：

```powershell
npm run check     # 语法检查
npm test          # 数据层 23 项 + 服务与路由 22 项 + 客户端 bundle 18 项
```

需要真实 DSH 安装目录的两组（校验 Bot 模式引用的 26 个插件包与它们各自的 config）：

```powershell
$env:DSH_INSTALL_DIR='<...>/resources/app.asar/dsh/node_modules/@deepseek-ai/dsh'
npm run test:preset
```

线上（安装后）已验证：`GET /_dsh-bot-groups/overview` 返回 200、`/diag` 显示 `degraded: false`、11 个 `bot_group_*` 工具出现在会话工具表、客户端插槽 `conversation.input.dock` / `sidebar.panellist` 中 `dsh-bot-groups-client` 均为 active、`include:preset-bot` 为 active、两个 Bot 的群聊实测完成「建群 → 点名 → 接力 → 回传」并落档计费。

## 许可证

[MIT](LICENSE)。欢迎 issue / PR。