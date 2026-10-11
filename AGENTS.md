# ClauDiscobombulating

Claude Code mod. One plugin, mode by surface:

- **Console (terminal)**: full. Limits + cache timer in footer, model/effort pickers above prompt, side pane (timer, Sessions, Resume, Compact, model, effort).
- **Claude desktop**: lean. Limits + cache timer only, in a band above the prompt (`AbovePrompt`). No pickers, no pane, no commands, no timer. Footer (`SessionMode`) passes through: its slot is ≈220 px and clips.

Switch: `isFull` (set by `enableFull`) and its atom `full` — draws read the atom, so a band mounted before `enableFull` redraws. Desktop app runs the CLI headless: `session.start` surface is `null`, app arrives later as `session.attach` `desktop`. So: start with terminal/other surface → full; attach `desktop` → lean. Never branch on `e.surface === 'desktop'` at start. Render hooks gate on their own `e.surface`.

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
- `opencode/tui.tsx` — opencode TUI plugin, one file. Installed with `plugin.json` next to it (version source).

## Dev loop

- Edit here (not under `~/.claude`: protected path, bypass mode does not cover it).
- Hot reload: copy `plugin/hooks`, `plugin.json` to `~/.claude/dev-mods/<session-id>/ClauDiscobombulating/`.
- Ship: `.\install.ps1` (reinstalls), restart apps.
- Test installer without touching real config: set `CLAUDE_CONFIG_DIR` to a temp dir first.

## Pane (terminal, asks 38 cols)

Same look as the opencode sidebar, packed from the top: name banner (bordered, name in a purple → orange gradient, `glow`; version from `plugin.json`, read at the first `enableFull`), Timer box (`TIMER_ROWS` 12: time centered, countdown, outlined text field, bordered send button), Sessions/Compact/Resume cards in one row (stacked below 38 cols), Model box + Effort box joined. 1 row gap between groups, dropped when `bodyRows` is short. The dock may give more than 38 (a kept width wins); boxes stretch. The `minute` atom ticks so the countdown redraws.

- Border titles (`Таймер`, `Модель`, `Effort`, the chord) are `position="absolute"` later siblings in a wrapper: a child is clipped to its parent's inside and never paints on that border.
- Change a block → keep `paneRows` in `ui.render` Pane in step; the wheel hit-test uses it (timer: hours/minutes by column, `HOURS_END`/`MINUTES_END`).
- **Sessions** = `/resume` slash command (session picker).
- **Resume** = submit prompt as user. Terminal: `--resume`. Other surfaces: `continue`. Before send: `cacheMinutes() === 0` (idle ≥ 1h, `CACHE_TTL_MS`) → `$.ui.ask` "Cache miss… continue?"; no → nothing sent.
- **Compact**: cache hit → effort low, `/compact`, effort back. Cache miss → model haiku at medium (the summary decides what the context keeps), `/compact`, model + effort back. Haiku takes effort like every model now: no `noEffort` gate.
- Cache hint: console hides it first 5 min idle (`CACHE_SHOW_BELOW`) in the `SessionMode` footer; desktop shows it always in the `AbovePrompt` band (flat dark pills, Box + Text, Compact button, cache pill on the right; `Svg` drew nothing in the footer slot). Then minutes left, then `⚠ Cache Miss`.
- Cache alert: `left <= ALERT_MIN` (10), once per idle period (`alerted` state). In-app toast + Windows toast + `cache-alert.mp3` via `powershell.exe` (`ALERT_PS`, env-passed text, no double quotes in it). `lastActive` persists in `activeAt` state (survives reload), is restored on resume from `classic.SessionStart` `seconds_since_last_response`, and restarts at every real compaction.

- Auto compact: `five_hour` ≥ 99% (`AUTO_COMPACT_AT`) → abort running turn (`$.turn.abort`), run `compact()`. Once per 5h window (`compactedFor` state = `resetsAt`, else a 5h wall bucket). Check cadence by last seen %: <75 → 5 min, <90 → 1 min, <95 → 30 s, else 1 s. Checked in `poll`, both surfaces. No auto-resume after. Skipped when `five_hour` resets in < 59 min (`NO_COMPACT_BEFORE_RESET_MS`).
- ctrl+t cycles effort: band ◀/▶ and the pane's effort card ◀/▶ (keys `e-prev`/`e-next`) carry engine actions `pane:previous`/`pane:next`; the band hides its picker while the pane is open, so the pane must carry them too. The engine's own handler for those actions runs only with 2+ panes open. The chord lives in the person's `~/.claude/keybindings.json`; `loadChord` reads the one bound to `pane:next` and both effort blocks show it as a hint (band: chord after ▶; pane: on the Effort box's bottom border, `ctrl+t змінити`).
- New version: header compares `pluginVersion` with `latest` (GitHub raw, checked at session start); the click runs `claude plugin update`, restart applies — 2026-10-11.

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

Version: never bump per fix. Batch fixes and features; bump once, only when the user asks to push/release, to the version they name (else the next minor). A string of 0.0.1 bumps spams every install with updates.

Release: bump `version` in `plugin.json`, commit (`release: X.Y.Z`), push, then `gh release create vX.Y.Z --title "ClauDiscobombulating X.Y.Z" --generate-notes` — one GitHub release per shipped version. Installed copies pull it.

## opencode plugin

- Loads from `<XDG_CONFIG_HOME or ~/.config>/opencode/plugins/claudiscobombulating/tui.tsx` (auto-discovered, no package.json) or a project's `.opencode/plugins/<name>/`. `opencode plugin list` shows it. Local sources hot-reload.
- API: `Plugin.define({ id, setup })` from `@opencode/plugin/tui`; blocks go in `ui.slot({ append: "sidebar.content" })`. Runtime gives solid-js, `@opentui/solid`, `@opentui/core`, node builtins.
- Limits: `GET https://opencode.ai/zen/go/v1/usage` (undocumented), `Authorization: Bearer <opencode-go key>` from `<XDG_DATA_HOME or ~/.local/share>/opencode/auth.json`, needs a `User-Agent` (Cloudflare 1010 otherwise). Returns `usage.{rolling,weekly,monthly}.{percent,resetsAt}`. Polled every 60 s.
- Cut on purpose (user: commands first, anything shaky goes): Claude limits, cache timer/alert, auto compact.
- Sending: `client.session.prompt` uses the session's stored model, so `send` calls `client.session.switchModel` to `ui.model.current()` first. Compact = `keymap.dispatch("session.compact")`.
- Effort = model variant (`ui.model.variant`); `ctrl+t` is opencode's own `variant.cycle`, its chord shown via `keymap.shortcuts("variant.cycle")` in the Effort box's bottom title. Wheel anywhere on the Effort box cycles it (up = higher; `WHEEL_GAP_MS` drops bursts).
- Layout, top → bottom: name banner, Timer box, Sessions/Compact/Resume cards in one row, Model box + Effort box (joined). Same banner and Timer box as the Claude pane. OpenCode Go limits sit at the sidebar's bottom (`prepend: "sidebar.footer"`, 1 col padded: the footer has no scrollbar gutter); the home panel pushes them down with a grow spacer.
- Home (before the first message) has no sidebar slot. `append: "app"` draws a 42-col panel and flips its parent (the app column) to `row` while the route is home and the terminal > 120 cols, back to `column` on cleanup. No session there: Timer, Resume, Compact hidden. Rounded borders with `title`; sidebar content ≈ 37 cols, so the three cards fill it exactly — no padding inside them.
- Self-update: `✦ new vX` → `opencode/tui.tsx` + `plugin/.claude-plugin/plugin.json` from `main` via the GitHub contents API (raw.githubusercontent.com lags ≈5 min after a push), temp write, rename; opencode hot-reloads it. Both files on `main` must stay in step with the release. Installers copy from the marketplace clone (`installLocation`) for the same reason.
- UI strings: `UK`/`EN` in `tui.tsx`, same rule as the Claude side.
- Type-check: copy to `src/tui.tsx` of a scratch npm project (`@opencode/plugin`, `@opencode/theme`, `@opentui/core`, `@opentui/solid`, `solid-js`, `@types/bun`, `@types/node`, `typescript`; tsconfig `jsx: preserve`, `jsxImportSource: @opentui/solid`), `npx tsc -p .`. Live test: never against the real dirs (a variant change persists to `~/.local/state/opencode/model.json`). Temp `XDG_CONFIG_HOME` (plugin in `opencode/plugins/claudiscobombulating/`), `XDG_DATA_HOME` (copy of `opencode/auth.json`), `XDG_STATE_HOME` (`opencode/model.json` picking a free model), then `opencode api session.create --standalone -d '{"location":{"directory":…}}'` and `opencode --standalone --session <id> <dir>` in a PTY (SGR mouse clicks work). `--standalone` avoids the managed service port. Delete the temp dirs after (auth copy).
