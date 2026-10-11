# ClauDiscobombulating

Claude Code mod. One plugin, mode by surface:

- **Console (terminal)**: full. Limits + cache timer in footer, model/effort pickers above prompt, side pane (timer, Sessions, Resume, Compact, model, effort).
- **Claude desktop**: lean. Limits + cache timer only, in a band above the prompt (`AbovePrompt`). No pickers, no pane, no commands, no timer. Footer (`SessionMode`) passes through: its slot is ≈220 px and clips.

Switch: `isFull` (set by `enableFull`). Desktop app runs the CLI headless: `session.start` surface is `null`, app arrives later as `session.attach` `desktop`. So: start with terminal/other surface → full; attach `desktop` → lean. Never branch on `e.surface === 'desktop'` at start. Render hooks gate on their own `e.surface`.

## Layout

- `install.sh` — macOS/Linux installer, GitHub copy only (`curl … | bash`, `--uninstall`). Same auto-update write as `install.ps1`.
- `install.ps1` — installer. `.\install.ps1` / `-Uninstall` / `-WhatIf`. User scope, covers console + desktop.
- `.claude-plugin/marketplace.json` — marketplace `ClauDiscobombulating`, plugin at `./plugin`. Repo: github.com/Niedvin/ClauDiscobombulating (public).
- `plugin/.claude-plugin/plugin.json` — manifest. Bump version on every release (auto-update keys on it).
- `plugin/assets/cache-alert.mp3` — alert sound. Original `cache alert.mp3` in root is git-ignored.
- `plugin/hooks/register.tsx` — whole mod. `hooks.json` points to it.
- `plugin/types/index.d.ts` — `$.state` contract. New state key → declare here.
- `plugin/hooks/*.test.tsx` — tests. `claude plugin test plugin`, `claude plugin validate plugin`.
- `plugin/.claude-plugin/types/` — engine-generated, git-ignored. Never edit.

## Dev loop

- Edit here (not under `~/.claude`: protected path, bypass mode does not cover it).
- Hot reload: copy `plugin/hooks`, `plugin.json` to `~/.claude/dev-mods/<session-id>/ClauDiscobombulating/`.
- Ship: `.\install.ps1` (reinstalls), restart apps.
- Test installer without touching real config: set `CLAUDE_CONFIG_DIR` to a temp dir first.

## Pane (terminal, 24 cols)

Name + version header pinned top (rows 0..3), timer below (rows 5..11). Version comes from `plugin.json`, read at the first `enableFull`. Bottom stack anchored down, order: Sessions, Resume, Compact, model, effort: bordered round cards, 1 row gap between each.

- Change a block → update `STACK_ROWS`/`CARDS_ROWS` + `paneRows` offsets in `ui.render` Pane. Wheel hit-test uses them.
- Cells only: no half-row gap. Tried 0 gap (merged) and flat 1-row filled buttons (too small); user wants bordered buttons, 1 row gap.
- **Sessions** = `/resume` slash command (session picker).
- **Resume** = submit prompt as user. Terminal: `--resume`. Other surfaces: `continue`. Before send: `cacheMinutes() === 0` (idle ≥ 1h, `CACHE_TTL_MS`) → `$.ui.ask` "Cache miss… continue?"; no → nothing sent.
- **Compact**: cache hit → effort low, `/compact`, effort back. Cache miss → model haiku at medium (the summary decides what the context keeps), `/compact`, model + effort back. Haiku takes effort like every model now: no `noEffort` gate.
- Cache hint: console hides it first 5 min idle (`CACHE_SHOW_BELOW`) in the `SessionMode` footer; desktop shows it always in the `AbovePrompt` band (flat dark pills, Box + Text, Compact button, cache pill on the right; `Svg` drew nothing in the footer slot). Then minutes left, then `⚠ Cache Miss`.
- Cache alert: `left <= ALERT_MIN` (10), once per idle period (`alerted` state). In-app toast + Windows toast + `cache-alert.mp3` via `powershell.exe` (`ALERT_PS`, env-passed text, no double quotes in it). `lastActive` persists in `activeAt` state (survives reload), is restored on resume from `classic.SessionStart` `seconds_since_last_response`, and restarts at every real compaction.

- Auto compact: `five_hour` ≥ 99% (`AUTO_COMPACT_AT`) → abort running turn (`$.turn.abort`), run `compact()`. Once per 5h window (`compactedFor` state = `resetsAt`). Check cadence by last seen %: <75 → 5 min, <90 → 1 min, <95 → 30 s, else 1 s. Checked in `poll`, both surfaces. No auto-resume after.

## Runtime files

- `~/.claude/mods/ClauDiscobombulating-limits.json` — limits shared between sessions.
- `~/.claude/mods/ClauDiscobombulating-debug.log` — event log (console only).

## Gotchas

- Same-version update rewrites the plugin dir in place → a running session logs `plugin.json changed — names no hooks module now; register.tsx unloaded` and loses the mod until restart. Always bump `version` for a release.
- Plugin/marketplace rename strands existing installs: the old `enabledPlugins` key survives and `claude plugin list` shows "Plugin <old> not found in marketplace <old>" — console runs with no mod at all. Reinstall under the new name: `claude plugin uninstall <old>@<old>` → `claude plugin marketplace remove <old>` → `claude plugin marketplace add Niedvin/<new>` → `claude plugin install <new>@<new>`; re-check `autoUpdate: true` in `extraKnownMarketplaces` (CLI add does not write it).
- Python reading test output on Windows: decode stdin as UTF-8, or Cyrillic turns to mojibake.

- Console test without a human: pywinpty + pyte in a temp venv, `claude` (no skip-permissions flag: the auto-mode classifier denies it) from a trusted cwd such as the home dir.

## Rules

- Back up before overwriting user-authored files (`~/.claude/.backups/`).
- Comments: one line, dated ` — YYYY-MM-DD`, only non-obvious why.
- UI text: `UK` and `EN` dictionaries in `register.tsx`, picked once at `session.start` (`detectUk`). Ukrainian only if the system language is Ukrainian, else English. New UI string → add to both.

## Auto-update from GitHub

Published as marketplace `ClauDiscobombulating` (repo root has `.claude-plugin/marketplace.json`). Users: `.\install.ps1 -Repo Niedvin/ClauDiscobombulating` — also writes `extraKnownMarketplaces.ClauDiscobombulating` (github source, `autoUpdate: true`) into `settings.json` (backup in `.backups/`); `-Uninstall` removes it. Local install leaves settings alone.

Release: bump `version` in `plugin.json`, commit, push. Installed copies pull it.

