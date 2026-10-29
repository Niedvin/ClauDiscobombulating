#!/usr/bin/env bash
# macOS/Linux installer, usage in README — 2026-10-06
set -euo pipefail

REPO="${CLAUDISCOBOMBULATING_REPO:-Niedvin/ClauDiscobombulating}"
MARKET="ClauDiscobombulating"
PLUGIN="ClauDiscobombulating@$MARKET"
CONFIG="${CLAUDE_CONFIG_DIR:-$HOME/.claude}"
SETTINGS="$CONFIG/settings.json"
OC_BASE="${XDG_CONFIG_HOME:-$HOME/.config}"
OC_DIR="$OC_BASE/opencode/plugins/claudiscobombulating"
PI_BASE="${PI_CODING_AGENT_DIR:-$HOME/.pi/agent}"
PI_EXT_DIR="$PI_BASE/extensions/claudiscobombulating"

command -v claude >/dev/null 2>&1 || { echo "claude CLI not found in PATH" >&2; exit 1; }

install_opencode() {
  # raw.githubusercontent.com serves a 5 min old copy after a push; the marketplace clone is fresh — 2026-10-11
  local clone="$CONFIG/plugins/marketplaces/$MARKET"
  mkdir -p "$OC_DIR"
  for pair in tui.tsx:opencode/tui.tsx plugin.json:plugin/.claude-plugin/plugin.json; do
    local name="${pair%%:*}" src="${pair#*:}"
    if [ -s "$clone/$src" ]; then
      cp "$clone/$src" "$OC_DIR/$name.tmp"
    else
      curl -fsSL -H "Accept: application/vnd.github.raw" "https://api.github.com/repos/$REPO/contents/$src?ref=main" -o "$OC_DIR/$name.tmp"
    fi
    [ -s "$OC_DIR/$name.tmp" ] || { echo "$name is empty" >&2; exit 1; }
    mv -f "$OC_DIR/$name.tmp" "$OC_DIR/$name"
  done
}

install_pi() {
  local clone="$CONFIG/plugins/marketplaces/$MARKET"
  mkdir -p "$PI_EXT_DIR"
  if [ -s "$clone/pi/index.ts" ]; then
    cp "$clone/pi/index.ts" "$PI_EXT_DIR/index.ts.tmp"
  else
    curl -fsSL -H "Accept: application/vnd.github.raw" "https://api.github.com/repos/$REPO/contents/pi/index.ts?ref=main" -o "$PI_EXT_DIR/index.ts.tmp"
  fi
  [ -s "$PI_EXT_DIR/index.ts.tmp" ] || { echo "pi index.ts is empty" >&2; exit 1; }
  mv -f "$PI_EXT_DIR/index.ts.tmp" "$PI_EXT_DIR/index.ts"
}

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
  rm -rf "$OC_DIR"
  rm -rf "$PI_EXT_DIR"
  echo "ClauDiscobombulating removed."
  exit 0
fi

with_opencode=0
if command -v opencode >/dev/null 2>&1 || [ -d "$OC_BASE/opencode" ]; then
  printf 'opencode found. Install the opencode plugin too? [Y/n] '
  # piped through curl stdin is the script itself, so ask the terminal — 2026-10-11
  { read -r answer </dev/tty; } 2>/dev/null || answer=""
  case "$answer" in [nN]*) ;; *) with_opencode=1 ;; esac
fi
with_pi=0
if command -v pi >/dev/null 2>&1 || [ -d "$PI_BASE" ]; then
  printf 'pi found. Install the pi extension too? [Y/n] '
  { read -r answer </dev/tty; } 2>/dev/null || answer=""
  case "$answer" in [nN]*) ;; *) with_pi=1 ;; esac
fi

claude plugin marketplace add "$REPO"
claude plugin install "$PLUGIN" --scope user
set_autoupdate 1
[ "$with_opencode" = 1 ] && install_opencode
[ "$with_pi" = 1 ] && install_pi
echo "ClauDiscobombulating installed. Restart Claude Code and the desktop app."
[ "$with_opencode" = 1 ] && echo "opencode plugin in $OC_DIR. Restart opencode."
[ "$with_pi" = 1 ] && echo "pi extension in $PI_EXT_DIR. Restart pi."
exit 0

