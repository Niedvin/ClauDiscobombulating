#!/usr/bin/env bash
# macOS/Linux installer, usage in README — 2026-10-06
set -euo pipefail

REPO="${CLAUDISCOBOMBULATING_REPO:-Niedvin/ClauDiscobombulating}"
MARKET="ClauDiscobombulating"
PLUGIN="ClauDiscobombulating@$MARKET"
CONFIG="${CLAUDE_CONFIG_DIR:-$HOME/.claude}"
SETTINGS="$CONFIG/settings.json"

command -v claude >/dev/null 2>&1 || { echo "claude CLI not found in PATH" >&2; exit 1; }

set_autoupdate() {
  local on="$1"
  if command -v python3 >/dev/null 2>&1 || command -v python >/dev/null 2>&1; then
    "$(command -v python3 || command -v python)" - "$SETTINGS" "$on" "$REPO" "$MARKET" <<'PY'
import json, os, shutil, sys, time
path, on, repo, market = sys.argv[1:5]
exists = os.path.exists(path)
if not exists and on != "1":
    sys.exit(0)
cfg = json.load(open(path, encoding="utf-8")) if exists else {}
known = cfg.setdefault("extraKnownMarketplaces", {})
if on == "1":
    known[market] = {"source": {"source": "github", "repo": repo}, "autoUpdate": True}
    known.pop("ClauDiscombobulating", None)
else:
    known.pop(market, None)
    known.pop("ClauDiscombobulating", None)
if exists:
    bak = os.path.join(os.path.dirname(path), ".backups")
    os.makedirs(bak, exist_ok=True)
    copy = os.path.join(bak, "settings.json." + time.strftime("%Y%m%d-%H%M%S"))
    shutil.copy2(path, copy)
    if os.path.getsize(copy) == 0:
        sys.exit("backup of " + path + " is empty")
os.makedirs(os.path.dirname(path), exist_ok=True)
tmp = path + ".tmp"
with open(tmp, "w", encoding="utf-8") as f:
    json.dump(cfg, f, indent=2, ensure_ascii=False)
    f.write("\n")
os.replace(tmp, path)
PY
  elif command -v node >/dev/null 2>&1; then
    node - "$SETTINGS" "$on" "$REPO" "$MARKET" <<'JS'
const fs = require('fs'), path = require('path')
const [file, on, repo, market] = process.argv.slice(2)
const exists = fs.existsSync(file)
if (!exists && on !== '1') process.exit(0)
const cfg = exists ? JSON.parse(fs.readFileSync(file, 'utf8')) : {}
cfg.extraKnownMarketplaces = cfg.extraKnownMarketplaces || {}
if (on === '1') { cfg.extraKnownMarketplaces[market] = { source: { source: 'github', repo }, autoUpdate: true }; delete cfg.extraKnownMarketplaces['ClauDiscombobulating'] }
else { delete cfg.extraKnownMarketplaces[market]; delete cfg.extraKnownMarketplaces['ClauDiscombobulating'] }
if (exists) {
  const bak = path.join(path.dirname(file), '.backups')
  fs.mkdirSync(bak, { recursive: true })
  const copy = path.join(bak, 'settings.json.' + new Date().toISOString().replace(/\D/g, '').slice(0, 14))
  fs.copyFileSync(file, copy)
  if (fs.statSync(copy).size === 0) throw new Error('backup of ' + file + ' is empty')
}
fs.mkdirSync(path.dirname(file), { recursive: true })
fs.writeFileSync(file + '.tmp', JSON.stringify(cfg, null, 2) + '\n')
fs.renameSync(file + '.tmp', file)
JS
  else
    echo "python3 or node not found: add to $SETTINGS by hand for auto-update:" >&2
    echo "  \"extraKnownMarketplaces\": { \"$MARKET\": { \"source\": { \"source\": \"github\", \"repo\": \"$REPO\" }, \"autoUpdate\": true } }" >&2
  fi
}

# the mod was called prompt-bar before the rename, ClauDiscombobulating until 1.1.7 — 2026-10-11
for old in "$PLUGIN" ClauDiscombobulating@ClauDiscombobulating prompt-bar@prompt-bar prompt-bar@prompt-bar-local; do
  claude plugin uninstall "$old" --scope user >/dev/null 2>&1 || true
done
for old in "$MARKET" ClauDiscombobulating prompt-bar prompt-bar-local; do
  claude plugin marketplace remove "$old" >/dev/null 2>&1 || true
done

if [ "${1:-}" = "--uninstall" ]; then
  set_autoupdate 0
  echo "ClauDiscobombulating removed."
  exit 0
fi

claude plugin marketplace add "$REPO"
claude plugin install "$PLUGIN" --scope user
set_autoupdate 1
echo "ClauDiscobombulating installed. Restart Claude Code and the desktop app."

