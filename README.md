# dsh-bot-groups · Bot Groups

> A group-chat layer for DSH Bots, plus a new **Bot mode** in the mode picker — Grok-Bot style: bots pull each other into groups, hand off with @mentions, run round-tables, share a group goal and a task board. Also ships **third-party model APIs** (mainstream providers / ModelScope / any OpenAI-compatible endpoint).

MIT License · no runtime dependencies beyond `@zifeng1023/dsh-bot` · 90 offline checks

## What you get

**1. Bot mode** — a new card in the new-session mode picker: a resident-Bot persona with the full file / search / web / subagent toolset plus `bot_group_*` group tools. It delegates through groups instead of doing everything alone.

**2. Bot Groups + DMs** (sidebar)

- Create a group from existing bots; pick a lead and a per-round hand-off cap. One-click templates (release review / feature work / research / writing) prefill members and goal.
- DMs are first-class: **+ 私聊** opens a 1:1 chat with any bot. One DM per bot — starting it again reuses the existing thread (`POST /dm` is idempotent). The sidebar splits **DMs** and **groups**.
- Routing modes: smart @ routing / round-robin / panel / moderated.
- @ hand-off: a bot reply containing `@memberName` queues that member next (bounded).
- Shared group goal, injected into every group turn; active / paused / done.
- Group memo: long-lived human instructions ("keep answers under 200 chars", "run the tests before touching code") injected into every turn with high priority.
- Task board: todo / doing / done items are shown to bots on every turn.
- Quotes and attachments: reply to a specific message, attach local files for the bot to read.
- Stop and retry: abort a running round, or retry a failed / stopped turn.
- Per-message cost, a per-bot usage breakdown in the side panel, group totals and a daily budget meter.
- In-group message search and one-click Markdown export (goal, memo, task board, transcript, costs).

**3. Composer quick bar** — a slim Bot Groups strip under the input box showing unread and running groups.

**4. Third-party model APIs** (Settings → *Model providers*)

Give any bot — or a whole group — a different brain. Twelve presets ship with the plugin:

| Preset | Protocol | Base URL | Notes |
| --- | --- | --- | --- |
| DeepSeek | openai | `https://api.deepseek.com/v1` | official |
| **ModelScope (魔搭社区)** | openai | `https://api-inference.modelscope.cn/v1` | model ids carry an org prefix, e.g. `Qwen/Qwen3-235B-A22B-Instruct-2507`, `deepseek-ai/DeepSeek-V3.2` |
| OpenAI | openai | `https://api.openai.com/v1` | |
| Anthropic | anthropic | `https://api.anthropic.com/v1` | native protocol |
| Gemini | gemini | `https://generativelanguage.googleapis.com/v1beta` | native protocol |
| DashScope (Qwen) | openai | `https://dashscope.aliyuncs.com/compatible-mode/v1` | |
| Moonshot (Kimi) | openai | `https://api.moonshot.cn/v1` | |
| Zhipu GLM | openai | `https://open.bigmodel.cn/api/paas/v4` | |
| Volcengine Ark (Doubao) | openai | `https://ark.cn-beijing.volces.com/api/v3` | model = endpoint id |
| SiliconFlow | openai | `https://api.siliconflow.cn/v1` | |
| OpenRouter | openai | `https://openrouter.ai/api/v1` | |
| Ollama (local) | openai | `http://127.0.0.1:11434/v1` | no key needed |

Or add **any OpenAI-compatible endpoint** with *+ Custom provider* (self-hosted gateways, one-api / new-api, vLLM, LM Studio, …).

- Keys live only in `~/.dsh/bot/providers.json`; the API returns `hasKey / keySource`, never the secret. `env:NAME` and `file:/abs/path` references are supported.
- *Test* hits `GET /models` first to validate the key and connectivity, then reports models and latency.
- Scope: switch a single bot from the Bot panel, or switch a whole group from its *Model & budget* card (`Follow bot` keeps each bot's own model).
- Third-party usage costs cannot be derived from the response and are reported as `costKind: unknown` (¥0 in the UI); the host DeepSeek channel keeps its normal billing.

## Requirements

- `@zifeng1023/dsh-bot` (bots, identities, run records, budgets, snapshots). Without it the plugin runs in a read-only degraded mode: groups still store messages, but bots do not reply.
- DSH `>= 0.2.1-rc.5 < 0.3.0-0`.

## Install

```powershell
# from this repo (installing a bundle executes code, so it needs full access)
git clone https://github.com/ABC144321/dsh-bot-groups.git
plugin_manager action=install_bundle target="<absolute path to the clone>"

# or point at an existing checkout
plugin_manager action=install_bundle target="<absolute path to this folder>"
```

After install: a **Bot Groups** icon in the sidebar, a **Bot mode** card in the new-session mode picker, a quick bar above the composer, and **Bot Groups** + **Model providers** sections in Settings.

Host-side edits (`lib/index.js`, `lib/store.js`, `lib/tools.js`, `lib/providers.js`) do not hot-reload; restart the row:

```
plugin_manager action=set_plugin target="include:dsh-bot-groups" enabled=false
plugin_manager action=set_plugin target="include:dsh-bot-groups" enabled=true
```

`lib/client.js` alone reloads through client HMR (the sidebar icon is proof).

## Where the data lives

```
~/.dsh/bot/groups/<groupId>.json   # one file per group: members, messages, rounds, goal, tasks, budget
~/.dsh/bot/providers.json          # third-party provider config (keys included, local only)
~/.dsh/bot/bots/<botId>/...        # bot identities (owned by dsh-bot, read-only here)
~/.dsh/bot/runs/YYYY/MM/*.json     # run records (written by dsh-bot)
```

## Tools

`bot_group_list`, `bot_group_create`, `bot_group_show`, `bot_group_chat`, `bot_group_round`, `bot_group_speak`, `bot_group_invite`, `bot_group_remove_members`, `bot_group_goal`, `bot_group_mode`, `bot_group_delete`, `bot_group_stop`, `bot_group_retry`, `bot_group_task`, `bot_group_budget`, `bot_group_model`, `bot_group_dm`, `bot_group_note`, `bot_providers`.

## HTTP API

Same-origin, local-only (Host/Origin checked):

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

## Config (the `dsh-bot-groups` row in `cordis.patch.yml`)

| Key | Default | Meaning |
| --- | --- | --- |
| `homeDir` | `~/.dsh/bot` | root of bots, groups and `providers.json` |
| `replyDryRun` | `false` | dry-run group replies by default |
| `handoffEnabled` | `true` | allow @ mentions to queue the next bot |
| `maxBotsPerRound` | `6` | max bots that really run the model per round |
| `runTimeoutMs` | `240000` | per-turn timeout |
| `snapshotEnabled` | `false` | snapshot bot workspaces before group turns |
| `defaultProvider` | `deepseek` | fallback provider |
| `defaultModel` | `deepseek-flash` | fallback model |
| `defaultReasoningEffort` | `high` | fallback reasoning effort |
| `defaultDailyCny` | `5` | default daily budget for new groups (0 = unlimited) |
| `defaultMonthlyCny` | `100` | default monthly budget for new groups |

## Known limits

- @ mentions match a member's name or `bot_xxx` id exactly; no fuzzy matching.
- One human message can trigger at most `maxBotsPerRound` real model runs; hand-offs stay inside one round.
- No host push channel yet: the panel polls (2 s while running, 9 s idle).
- The plugin builds its own `BotService` + `RoutineRunner` over the same `~/.dsh/bot` data as dsh-bot, so the two instances hold separate locks; group turns are serialized per group.
- Token usage is normalized from each provider's `usage` shape; a few providers omit fields, in which case counts fall back to 0.

## Tests

Four suites that need no DSH install (CI runs them on every push):

```powershell
npm run check     # syntax
npm test          # store 23 + service/routes 22 + client bundle 19 + providers 26
```

Two more that need a real DSH install (they validate the 26 packages referenced by Bot mode and their configs):

```powershell
$env:DSH_INSTALL_DIR='<...>/resources/app.asar/dsh/node_modules/@deepseek-ai/dsh'
npm run test:preset
```

Live-verified after install: `/overview` → 200, `/diag` → `degraded: false`, 19 group/provider tools in the session tool table, `dsh-bot-groups-client` active in `conversation.input.dock`, `sidebar.panellist` and both `settings.section` slots, `include:preset-bot` active, and a real two-bot group run (create → mention → hand-off → reply) persisted with cost.

## Changelog

- **0.1.2** — DMs as a first-class feature (`POST /dm` idempotent, DM/group split in the sidebar, DM header and composer, quick-bar DM button); one-click group templates; group memo injected into every turn; in-group message search; Markdown export (goal, memo, tasks, transcript, costs); per-bot usage breakdown; 2 new tools (`bot_group_dm`, `bot_group_note`) and 2 new endpoints (`POST /dm`, `GET /groups/:id/export`).
- **0.1.1** — third-party model APIs (12 presets incl. ModelScope, custom OpenAI-compatible endpoints, `env:`/`file:` keys, connectivity tests, per-bot and per-group switching); stop/retry; group task board; daily/monthly budgets; quotes and attachments; 6 new tools and 13 new endpoints.
- **0.1.0** — Bot mode, Bot Groups (create / routing / @ hand-off / goal / DM), composer quick bar, sidebar and settings sections.

## License

[MIT](LICENSE). Issues and PRs welcome.
