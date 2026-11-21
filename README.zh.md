# dsh-grok-bot · Grok Bot 超级优化版

> 给 DSH Bot 加一个群聊层，并在「模式」里加入 **Bot 模式** —— 像 Grok Bot 一样，Bot 之间可以互相拉群、@ 交接、圆桌讨论、共享群目标与任务看板；同时支持**第三方模型 API**（主流服务商 / 魔搭社区 ModelScope / 任意 OpenAI 兼容端点）。

MIT License · 无运行时依赖（除了 `@zifeng1023/dsh-bot`）· 离线自测 100+ 项

## v0.2.0 更新（重要）

- **修复「实际会话里 Bot 不可用」**：优先复用宿主已注册的 `ctx.get('bot')`；动态加载模块时扩展到 `DSH_BOT_DIR`、`~/.dsh/{plugins,extensions,node_modules}`、所有 profile、`process.resourcesPath` 与 `require.resolve`，不再只认 `~/.dsh/profiles/*`。
- **修复「Bot 写不了文件」**：每次发言的 prompt 里注入该 Bot 的 workspace **绝对路径**，并自动创建目录；模型不会再因为相对路径落到会话 cwd 或被沙箱拒绝。
- **群级月预算真正生效**：同时累计 `spentDay / spentMonth`，日/月任一超限即在本轮开始前熔断（不再只累计日额度）。
- **「停止」真正停住整轮**：停止后不会继续下一位成员，轮次状态保持 `stopped`，不会被结尾的 `done` 覆盖。
- **`bot_group_chat` 的 `dryRun` 真正生效**；`@` 解析统一走带词边界的 `parseMentions`（`@Bot2` 不会再误命中 `Bot`）。
- **性能**：群数据内存缓存、`list()` 并发读取、stats 只算一次、不再把 `homeDir` 写进每个群 JSON；面板后台标签页停止轮询，空闲轮询 9s → 15s。
- **安全**：写操作必须带 `x-dsh-grok-bot: 1` 头（挡 CSRF）；`providers.json` 写入串行化，避免并发覆盖。
- **结构**：`lib/index.js` 拆分为 `config / errors / http / runtime / service / routes`，入口只负责装配。
- 包名与模块 id 改为 `dsh-grok-bot`；API 前缀 `/_dsh-bot-groups` 与数据目录 `~/.dsh/bot` 保持不变，旧数据可直接沿用。

## 它做了什么

**1. Bot 模式（模式选择器里的新卡片）**

新建会话时，模式里会多一项「Bot 模式」：一位常驻 Bot 助手的人设 + 完整的文件 / 搜索 / 网页 / 子代理能力 + `bot_group_*` 群聊工具。它不把活全揽在自己身上，而是会按需要拉群、@ 成员、把球传出去。

**2. Bot 群 + 私聊（侧边栏「Bot 群」面板）**

- 拉群：把多位已有 Bot 拉进一个群，可选主持人、每轮接力人数；也支持一键套用「发布评审 / 功能开发 / 资料调研 / 内容撰写」模板。
- 私聊：点「+ 私聊」选一位 Bot 就直接开聊；同一个 Bot 只会有一个私聊，重复发起会复用（`POST /dm` 幂等）。左栏把「私聊」与「群聊」分区展示。
- 路由模式：智能 @ 路由 / 依次发言 / 全员圆桌 / 主持人主导。
- @ 交接：Bot 回复里 `@成员名` 会自动触发下一位发言（有轮次上限，避免无限接力）。
- 群目标：一句话目标会注入每次群发言的上下文，可标记进行中 / 暂停 / 已完成。
- 群备忘录：人类维护的长期设定（「回答控制在 200 字内」「改代码前先跑测试」），每次发言都会注入，优先级高于普通消息。
- 任务看板：群里可以维护待办 / 进行中 / 已完成的任务，Bot 发言时能看到未完成项。
- 引用与附件：可以引用某条消息回复，也可以把本机文件挂到消息上（Bot 用文件工具读取）。
- 停止与重试：一轮跑到一半可以「停止」，失败或被停下的发言可以「重试」。
- 花费可见：每条 Bot 发言带本次花费；右栏有「本群用量」按 Bot 拆分的消息数与花费，以及累计花费、每日/每月预算用量。
- 搜索与导出：群头部可以搜消息（本地过滤，显示匹配数），也可以一键导出整段对话为 Markdown（含目标、备忘录、任务看板）。

**3. 输入框快捷条**

输入框下方常驻一条 `Bot 群` 快捷条：一眼看到未读与「进行中」，点一下就切到对应的群。

**4. 第三方模型 API（设置 →「模型服务商」）**

Grok Bot 的 Bot 可以换脑子，这里也可以：给任意 Bot、或整个群，换到第三方模型端点。

内置 12 家预置，点「配置」填 Key 即可：

| 预置 | 协议 | Base URL | 备注 |
| --- | --- | --- | --- |
| DeepSeek | openai | `https://api.deepseek.com/v1` | 官方 |
| **魔搭社区 ModelScope** | openai | `https://api-inference.modelscope.cn/v1` | 模型名带组织前缀，如 `Qwen/Qwen3-235B-A22B-Instruct-2507`、`deepseek-ai/DeepSeek-V3.2` |
| OpenAI | openai | `https://api.openai.com/v1` | |
| Anthropic | anthropic | `https://api.anthropic.com/v1` | 原生协议 |
| Gemini | gemini | `https://generativelanguage.googleapis.com/v1beta` | 原生协议 |
| 通义千问（百炼） | openai | `https://dashscope.aliyuncs.com/compatible-mode/v1` | |
| Kimi（月之暗面） | openai | `https://api.moonshot.cn/v1` | |
| 智谱 GLM | openai | `https://open.bigmodel.cn/api/paas/v4` | |
| 火山方舟（豆包） | openai | `https://ark.cn-beijing.volces.com/api/v3` | 模型填 endpoint id |
| SiliconFlow | openai | `https://api.siliconflow.cn/v1` | |
| OpenRouter | openai | `https://openrouter.ai/api/v1` | |
| Ollama（本地） | openai | `http://127.0.0.1:11434/v1` | 无需 Key |

也可以「+ 自定义服务商」：任意 OpenAI 兼容端点（自建网关、one-api / new-api、vLLM、LM Studio…），填 ID、Base URL、模型清单即可。

- Key 只存在本机 `~/.dsh/bot/providers.json`，接口只回 `hasKey / keySource`，不下发明文；支持 `env:变量名` 与 `file:/绝对路径` 引用。
- 「测试」会先打 `GET /models` 验证 Key 与连通性，再报告可用模型与延迟。
- 生效范围：在 Bot 面板把某个 Bot 的模型切到这家服务商；或在群的「模型与预算」里把整个群临时切过去（`跟随 Bot` 则用 Bot 自己的模型）。
- 第三方通道费用无法从响应里推算，会记为 `costKind: unknown`（花费显示 ¥0），宿主自带的 DeepSeek 通道仍按原价计费。

## 依赖

- `@zifeng1023/dsh-bot`（Bot 体系、Bot 身份、运行记录、预算与快照）。没有它时插件以只读降级模式运行，群消息可记录但 Bot 不会自动发言。
- DSH `>= 0.2.1-rc.5 < 0.3.0-0`。

## 安装

```powershell
# 方式一：从本仓库克隆后安装（安装会执行代码，需要完整权限）
git clone https://github.com/ABC144321/dsh-grok-bot.git
plugin_manager action=install_bundle target="<克隆下来的目录绝对路径>"

# 方式二：已下载到本地某个目录，直接指向它
plugin_manager action=install_bundle target="<本目录绝对路径>"
```

装好后：侧边栏出现「Bot 群」图标，新建会话的模式里出现「Bot 模式」，输入框上方出现快捷条，设置里出现「Bot 群」与「模型服务商」两个分区。

改了宿主代码（`lib/index.js`、`lib/service.js`、`lib/runtime.js`、`lib/store.js`、`lib/tools.js`、`lib/providers.js`）后不会热更新，需要在插件管理器里重启这一行：

```
plugin_manager action=set_plugin target="include:dsh-grok-bot" enabled=false
plugin_manager action=set_plugin target="include:dsh-grok-bot" enabled=true
```

只改 `lib/client.js` 时不用重启宿主，客户端 HMR 会重新发布 bundle 并重挂插槽。

## 数据在哪

```
~/.dsh/bot/groups/<groupId>.json   # 每个群一个文件：成员、消息、轮次、目标、任务、预算
~/.dsh/bot/providers.json          # 第三方模型服务商配置（含 Key，仅本机）
~/.dsh/bot/bots/<botId>/...        # Bot 身份（由 dsh-bot 管理，本插件只读）
~/.dsh/bot/runs/YYYY/MM/*.json     # Bot 运行记录（由 dsh-bot 写入）
```

## 工具

`bot_group_list`、`bot_group_create`、`bot_group_show`、`bot_group_chat`、`bot_group_round`、`bot_group_speak`、`bot_group_invite`、`bot_group_remove_members`、`bot_group_goal`、`bot_group_mode`、`bot_group_delete`、`bot_group_stop`、`bot_group_retry`、`bot_group_task`、`bot_group_budget`、`bot_group_model`、`bot_providers`、`bot_group_dm`、`bot_group_note`。

## HTTP API

同源、仅本机（Host/Origin 校验）：

```
GET    /_dsh-bot-groups/overview
GET    /_dsh-bot-groups/diag
GET    /_dsh-bot-groups/bots
POST   /_dsh-bot-groups/bots/:id/model
GET    /_dsh-bot-groups/providers
POST   /_dsh-bot-groups/providers
DELETE /_dsh-bot-groups/providers/:id
GET    /_dsh-bot-groups/providers/:id/models
POST   /_dsh-bot-groups/providers/:id/test
POST   /_dsh-bot-groups/providers/:id/enable
POST   /_dsh-bot-groups/groups
POST   /_dsh-bot-groups/dm
GET    /_dsh-bot-groups/groups/:id
GET    /_dsh-bot-groups/groups/:id/export
DELETE /_dsh-bot-groups/groups/:id
POST   /_dsh-bot-groups/groups/:id/messages
POST   /_dsh-bot-groups/groups/:id/rounds
POST   /_dsh-bot-groups/groups/:id/speak
POST   /_dsh-bot-groups/groups/:id/invite
POST   /_dsh-bot-groups/groups/:id/remove-members
POST   /_dsh-bot-groups/groups/:id/update
POST   /_dsh-bot-groups/groups/:id/stop
POST   /_dsh-bot-groups/groups/:id/retry
POST   /_dsh-bot-groups/groups/:id/tasks
POST   /_dsh-bot-groups/groups/:id/tasks/:taskId
POST   /_dsh-bot-groups/groups/:id/budget
POST   /_dsh-bot-groups/groups/:id/model
```

## 配置（cordis.patch.yml 的 `dsh-grok-bot` 行）

| 键 | 默认 | 说明 |
| --- | --- | --- |
| `homeDir` | `~/.dsh/bot` | Bot 与群数据根目录（`providers.json` 也在这里） |
| `replyDryRun` | `false` | 群内自动回复默认是否演练 |
| `handoffEnabled` | `true` | 是否允许回复里的 @ 触发下一位 |
| `maxBotsPerRound` | `6` | 一轮最多几位成员真的跑模型 |
| `runTimeoutMs` | `240000` | 单次发言超时 |
| `snapshotEnabled` | `false` | 群发言前是否给 Bot workspace 打快照 |
| `defaultProvider` | `deepseek` | 没有显式模型时的兜底服务商 |
| `defaultModel` | `deepseek-flash` | 兜底模型 |
| `defaultReasoningEffort` | `high` | 兜底推理强度 |
| `defaultDailyCny` | `5` | 新群的默认每日预算（0 表示不限） |
| `defaultMonthlyCny` | `100` | 新群的默认每月预算 |

## 已知边界

- 群消息里的 @ 按「名字或 bot_xxx ID」精确匹配，不支持模糊匹配。
- 一轮接力有硬上限（`maxRounds` 与 `maxBotsPerRound` 取小），防止 Bot 之间无限对聊烧预算。一条人类消息最多触发 `maxBotsPerRound` 次真实模型运行，按需调小。
- 当前不监听 Host 推送，面板用轮询（运行中 2s，空闲 15s；后台标签页暂停）。
- 写操作需要 `x-dsh-grok-bot: 1` 头；面板已自动带上，外部脚本调用时记得加。
- 本插件会自己构造一份 `BotService` + `RoutineRunner`（复用 dsh-bot 的 `~/.dsh/bot` 数据与模型），与 dsh-bot 自带的实例各自持锁；群内发言按群串行，不会和别群并发。
- 第三方通道的 token 用量按服务商返回的 usage 归一化；不同服务商字段差异较大，个别情况可能缺省为 0。

## 自测

不依赖 DSH 也能跑的四组（CI 每次提交都跑）：

```powershell
npm run check     # 语法检查
npm test          # 数据层 28 项 + 服务与路由 28 项 + 客户端 bundle 21 项 + 服务商 27 项
```

需要真实 DSH 安装目录的两组（校验 Bot 模式引用的 26 个插件包与它们各自的 config）：

```powershell
$env:DSH_INSTALL_DIR='<...>/resources/app.asar/dsh/node_modules/@deepseek-ai/dsh'
npm run test:preset
```

线上（安装后）已验证：`GET /_dsh-bot-groups/overview` 返回 200、`/diag` 显示 `degraded: false`、19 个 `bot_group_*` / `bot_providers` 工具出现在会话工具表、客户端插槽 `conversation.input.dock` / `sidebar.panellist` / 两个 `settings.section` 中 `dsh-bot-groups-client` 均为 active、`include:preset-bot` 为 active、两个 Bot 的群聊实测完成「建群 → 点名 → 接力 → 回传」并落档计费、`POST /dm` 建私聊后重复调用复用同一会话、第三方路由实测（绑魔搭后缺 Key 的失败分支）落档为 `failed` 且花费 0。

## 更新日志

- **0.1.2**：私聊一等公民（`POST /dm` 幂等、左栏「私聊 / 群聊」分区、私聊头部与占位文案、输入框快捷条「+ 私聊」）；一键建群模板（发布评审 / 功能开发 / 资料调研 / 内容撰写）；群备忘录（注入每次发言）；群内消息搜索；导出 Markdown（含目标、备忘录、任务看板、花费）；右栏按 Bot 拆分的用量统计；2 个新工具 `bot_group_dm` / `bot_group_note` 与 2 个新端点 `POST /dm`、`GET /groups/:id/export`。
- **0.1.1**：第三方模型 API（12 家预置 + 魔搭社区 + 自定义 OpenAI 兼容端点、`env:`/`file:` Key 引用、连通性测试、按 Bot / 按群切换）；停止与重试；群任务看板；每日/每月预算；引用回复与附件；6 个新工具与 13 个新端点。
- **0.1.0**：Bot 模式、Bot 群（拉群 / 路由模式 / @ 交接 / 群目标 / 私聊）、输入框快捷条、侧边栏与设置分区。

## 许可证

[MIT](LICENSE)。欢迎 issue / PR。
