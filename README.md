# ClauDiscobombulating

Mod for Claude Code (console + Claude desktop), plus a sidebar plugin for opencode. One plugin, mode picks itself by app.

> **On purpose:** *ClauDiscobombulating* — a **disco** + **bomb** mash-up, not a typo of "discombobulating". Renamed from `ClauDiscombobulating` in v1.1.7.

![ClauDiscobombulating in the console: side pane with timer, Sessions, Resume, Compact, model and effort; limits and cache timer in the footer](docs/preview.png)

| | Console | Desktop app |
| --- | --- | --- |
| Usage limits (5h, 7d) | footer | band above prompt |
| Cache timer | footer (after 5 min idle) | band above prompt (always) |
| Cache alert (toast + sound, 10 min before miss; off at 99%+ limits or right after a compact) | yes | yes |
| Auto compact at 99% of the 5h limit | yes | yes |
| Model / effort pickers | above prompt | - |
| Context usage counter | above the prompt (right) | under the prompt |
| Side pane: message timer, Sessions, Resume, Compact, model, effort | yes | - |

- **Auto compact:** when the 5h limit reaches 99%, a running turn is stopped and `/compact` runs, once per 5h window. Not when the 5h limit resets in less than 59 min: waiting is cheaper. Better a controlled compact now than the work dying on its own and re-reading the whole context after the reset. It does not resume the work afterwards. Skipped when a compaction (manual or the engine's own) already ran in the last 10 min. The limit is checked every 5 min below 75%, every minute from 75%, every 30 s from 90%, every second from 95%.
- **Sessions** opens `/resume`. **Resume** sends `--resume` (console) and asks first when cache is already missed — not asked at 99%+ limits or right after a compact.
- **Compact** on cache miss: switches to Haiku at medium effort (1M window now), compacts, restores model + effort.
- **Language:** Ukrainian when the system language is Ukrainian, English otherwise (`d`, `h`, `m`, `send`, `cancel`, …). Force it with env `CLAUDISCOBOMBULATING_LANG=uk` or `en`.
- **Limits shared between sessions:** every session shows the freshest limits, not only after its own first reply. Works on Windows, macOS and Linux.
- Cache alert sound: `plugin/assets/cache-alert.mp3`, installed with the plugin. Windows: system toast + sound. macOS: sound (system player, `afplay`) + in-app toast. Other systems: in-app toast only.
- **ctrl+t cycles effort** (console): the effort ◀/▶ in the band and in the pane carry the engine actions `pane:previous` / `pane:next`, so the chord itself lives in `~/.claude/keybindings.json` — this setup binds `ctrl+t` / `ctrl+shift+t` there. The engine takes those actions over only while 2+ panes are open.
- **Update check**: the pane header reads the released version from GitHub when a session starts. When a newer release exists it draws `v1.1.8 ✦ нова v1.1.9`; a click runs `claude plugin update`. Restart applies.

## opencode

opencode already has a sidebar; the plugin adds its blocks there, under opencode's own context block:

- OpenCode Go limits (5h, 7d, month) with reset times, read every minute from opencode.ai with the Go key opencode already keeps (`auth.json`). No Go subscription → no block.
- Message timer (click or wheel on hours / minutes, click the text to edit it), Sessions, Resume, Compact. Resume and the timer send with the model picked in the prompt.
- Model (click opens the model list) and variant ◀ ▶ (= effort). `ctrl+t` cycles it, opencode's own key.
- Update check: `✦ new vX` under the header; a click downloads the new files, opencode reloads them.

Not in opencode: Claude limits, cache timer, auto compact.

Files: `~/.config/opencode/plugins/claudiscobombulating/` (`tui.tsx`, `plugin.json`). The install script asks for it when opencode is found.

## Install

Needs the `claude` CLI. One line, nothing to clone.

**Windows** (PowerShell):

```powershell
& ([scriptblock]::Create((irm https://raw.githubusercontent.com/Niedvin/ClauDiscobombulating/main/install.ps1)))
```

**macOS / Linux**:

```bash
curl -fsSL https://raw.githubusercontent.com/Niedvin/ClauDiscobombulating/main/install.sh | bash
```

Restart Claude Code and the desktop app. One install serves both the console and the desktop app. When opencode is found, the script asks `[Y/n]` whether to add the opencode plugin too; restart opencode after.

### Why the script and not the two manual commands

- **Auto-update is on from the start.** The script writes the `autoUpdate` entry into `settings.json` for you. With the manual commands the mod never updates, until you edit that file by hand. A new release reaches you when its `version` goes up, nothing to run.
- **Install and update are the same line.** An old copy is removed first, so rerunning it updates right now, repairs a broken install, or moves an old one to the GitHub copy.
- **Moves you off the old names.** An install made under a previous name (`prompt-bar`, `ClauDiscombobulating`) is found and removed, so you do not end up with two copies.
- **Your settings stay.** Only the one `extraKnownMarketplaces` key is touched, and `settings.json` is copied to `.backups/` first (the copy is checked to be non-empty). The file is replaced in one step, never half-written.
- **One line to undo.** The same script with `-Uninstall` (Windows) or `--uninstall` (macOS / Linux) removes the plugin, the marketplace, the auto-update entry and the opencode plugin.
- **Same result on every system.** One source of truth, no copy-pasting JSON, no editing a file by hand on Windows and a different one on Mac.
- **Readable.** Both scripts are short and sit in this repo: [install.ps1](install.ps1), [install.sh](install.sh). Read before you run.
- **Your own fork.** `-Repo owner/name` (Windows) or env `CLAUDISCOBOMBULATING_REPO=owner/name` (macOS / Linux) installs and auto-updates from a fork instead.

By hand (no auto-update):

```
claude plugin marketplace add Niedvin/ClauDiscobombulating
claude plugin install ClauDiscobombulating@ClauDiscobombulating --scope user
```

Coming from the old name by hand: run `claude plugin uninstall ClauDiscombobulating@ClauDiscombobulating --scope user` and `claude plugin marketplace remove ClauDiscombobulating` first.

Updates are pulled only when `version` in `plugin/.claude-plugin/plugin.json` goes up.

## Uninstall

```powershell
& ([scriptblock]::Create((irm https://raw.githubusercontent.com/Niedvin/ClauDiscobombulating/main/install.ps1))) -Uninstall
```

```bash
curl -fsSL https://raw.githubusercontent.com/Niedvin/ClauDiscobombulating/main/install.sh | bash -s -- --uninstall
```

