# Changelog

## 0.2.0 — Grok Bot 超级优化版

破坏性变更（有意为之）：

- 包名 / 模块 id 从 `dsh-bot-groups` 改为 `dsh-grok-bot`，`cordis.patch.yml` 的行 id 同步改名。
- 兼容性保留：HTTP 前缀仍是 `/_dsh-bot-groups`，数据目录仍是 `~/.dsh/bot`，上下文服务仍是 `ctx.set('botGroups')`，`buildGroupTaskPrompt(group, trigger, speaker)` 签名不变。

功能缺陷修复：

- **Bot 不可用**：优先复用 `ctx.get('bot')`；模块解析新增 `DSH_BOT_DIR`、`~/.dsh/{plugins,extensions,node_modules}`、全部 profile、`process.resourcesPath`、`process.cwd()` 与 `require.resolve`。
- **Bot 写不了文件**：发言 prompt 注入 Bot workspace 绝对路径并确保目录存在。
- **月预算无效**：新增 `spentMonth/monthKey`，日/月任一超限在轮次开始前熔断（`BUDGET_EXCEEDED` 语义在群内以系统消息体现）。
- **停止不彻底**：`stop()` 现在会让整轮在下一个检查点结束，轮次状态保持 `stopped`。
- **dryRun 无效**：`bot_group_chat` / `POST /messages` / `POST /rounds` 的 `dryRun` 会传给 `RoutineRunner.runTask`。
- **@ 解析不一致**：统一使用带词边界的 `parseMentions`，`@Bot2` 不再误命中 `Bot`。
- `normalizeBudget` 不再把 `null`（不限）折算成 `0` 元额度。

性能：

- `GroupStore` 增加内存缓存；`list()` 并发读取；`appendMessage/patchMessage` 不再重复计算 stats；群 JSON 不再持久化 `homeDir`。
- 客户端：后台标签页暂停轮询，空闲轮询 9s → 15s。

安全：

- 写操作要求 `x-dsh-grok-bot: 1` 请求头（跨站表单无法伪造），客户端已自动携带。
- `providers.json` 的写入串行化，避免并发保存互相覆盖。
- 本机同源校验保留：无 Origin 的原生请求仍可用，但写操作必须带自定义头。

结构：

- `lib/index.js` 拆分：`config.js` / `errors.js` / `http.js` / `runtime.js` / `service.js` / `routes.js`，入口只做装配。

测试：

- 新增 CSRF 头校验、月预算累计、客户端写请求头三组断言；原有 117 项测试全部通过。
