# Changelog

## 0.2.1 — Grok Bot 界面整合

界面：

- **Bot 模式一键进群聊**：会话标题栏新增「群聊」入口，输入框上方新增高亮「群聊」按钮，两者都直接切到群聊主视图；入口只在 Bot 模式的会话里出现。
- **隐藏官方模型下拉**：Bot 模式下自动隐藏 `conversation.input.model` 这个插槽（通过 `body.dbg-bot-mode` 标记 + CSS），模型改由群聊面板按群 / 按 Bot 决定；其它模式不受影响。
- **Grok Bot 风格视觉**：群聊面板改为固定深色主题（近黑底、18–20px 圆角、无边框气泡、白色主按钮），不复制任何品牌素材、图标或文案。

缺陷修复：

- **DELETE 请求被 403**：客户端 `api()` 只在有 body 时带 `x-dsh-grok-bot` 头，导致删除群等无 body 的写请求被 CSRF 校验拒绝；现在所有非 GET 请求都会带上。
- **轮次卡在 running**：执行中群被删除时，轮次会永远停在 `running`；现在会落为 `failed` 并记录原因。
- **预算熔断状态**：因预算中断的轮次现在标记为 `blocked` 并记录超限原因，不再误报 `done`。
- **预算写入校验**：`dailyCny/monthlyCny` 只接受有限非负数，非法输入返回 `INVALID_ARGS`，不再写入 `NaN`。
- 导出 Markdown 时累计花费做数值兜底。

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
