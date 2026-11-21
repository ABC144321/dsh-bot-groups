# dsh-bot-groups · Bot Groups

> A group-chat layer for DSH Bots, plus a new **Bot mode** in the mode picker — Grok-Bot style: bots pull each other into groups, hand off with @mentions, run round-tables, and share a group goal.

MIT License · no runtime dependencies beyond `@zifeng1023/dsh-bot` · 63 offline checks

## What you get

**1. Bot mode** — a new card in the new-session mode picker: a resident-Bot persona with the full file / search / web / subagent toolset plus `bot_group_*` group tools. It delegates through groups instead of doing everything alone.

**2. Bot Groups panel** (sidebar)

- Create a group from existing bots; pick a lead and a per-round hand-off cap.
- Routing modes: smart @ routing / round-robin / panel / moderated.
- @ hand-off: a bot reply containing `@memberName` queues that member next (bounded).
- Shared group goal, injected into every group turn; active / paused / done.
- Per-message cost plus group totals.

**3. Composer quick bar** — a slim Bot Groups strip under the input box showing unread and running groups.

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

After install: a **Bot Groups** icon in the sidebar, a **Bot mode** card in the new-session mode picker, a quick bar above the composer, and a **Bot Groups** section in Settings.

Host-side edits (`lib/index.js`, `lib/store.js`, `lib/tools.js`) do not hot-reload; restart the row:

```
plugin_manager action=set_plugin target="include:dsh-bot-groups" enabled=false
plugin_manager action=set_plugin target="include:dsh-bot-groups" enabled=true
```

Client-only edits (`lib/client.js`) pick up through client HMR without a host restart.

## Data

```
~/.dsh/bot/groups/<groupId>.json   # members, messages, rounds, goal
~/.dsh/bot/bots/<botId>/...        # bot identities (owned by dsh-bot)
~/.dsh/bot/runs/YYYY/MM/*.json     # bot run records (owned by dsh-bot)
```

## Tools

`bot_group_list`, `bot_group_create`, `bot_group_show`, `bot_group_chat`, `bot_group_round`, `bot_group_speak`, `bot_group_invite`, `bot_group_remove_members`, `bot_group_goal`, `bot_group_mode`, `bot_group_delete`.

## API

Same-origin, localhost only (`/_dsh-bot-groups/...`), mirrored by the panel.

## Configuration (`dsh-bot-groups` row)

| Key | Default | Meaning |
| --- | --- | --- |
| `homeDir` | `~/.dsh/bot` | root for bots and groups |
| `replyDryRun` | `false` | dry-run replies by default |
| `handoffEnabled` | `true` | allow @ hand-off between bots |
| `maxBotsPerRound` | `6` | hard cap of model runs per round |
| `runTimeoutMs` | `240000` | per-reply timeout |
| `snapshotEnabled` | `false` | snapshot bot workspace before a reply |

## Known limits

- Mentions match a member's exact name or bot id.
- Each round is hard-capped (`maxRounds` × `maxBotsPerRound`) to stop bot-to-bot loops from burning budget. One human message can therefore trigger up to `maxBotsPerRound` real model runs — lower it if you care about cost.
- The panel polls (2s while running, 9s idle); there is no host push channel for plugins yet.
- The plugin builds its own `BotService` + `RoutineRunner` over the same `~/.dsh/bot` data and model; group turns are serialized per group.

## Tests

No DSH install needed (run by CI on every push):

```powershell
npm run check     # syntax
npm test          # data layer 23 + service & routes 22 + client bundle 18
```

Needs a real DSH install (validates the 26 plugin packages Bot mode pulls in, plus each one's config):

```powershell
$env:DSH_INSTALL_DIR='<...>/resources/app.asar/dsh/node_modules/@deepseek-ai/dsh'
npm run test:preset
```

Verified live after install: `/overview` 200, `/diag` with `degraded: false`, all 11 `bot_group_*` tools in the session tool list, client slots `conversation.input.dock` and `sidebar.panellist` active for `dsh-bot-groups-client`, `include:preset-bot` active, and a real two-bot group round completing create → mention → hand-off → reply with records and cost.

## License

[MIT](LICENSE). Issues and PRs welcome.