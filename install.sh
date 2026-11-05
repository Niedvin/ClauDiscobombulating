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
# Command Code support was dropped in 3.0.2; its files go on every run — 2026-11-04
CC_DIR="$HOME/.commandcode/mods"

command -v claude >/dev/null 2>&1 || { echo "claude CLI not found in PATH" >&2; exit 1; }

# raw.githubusercontent.com serves a 5 min old copy after a push; the marketplace clone is fresh — 2026-10-11
copy_part() {
  local from="$1" to="$2" clone="$CONFIG/plugins/marketplaces/$MARKET"
  if [ -s "$clone/$from" ]; then
    cp "$clone/$from" "$to.tmp"
  else
    curl -fsSL -H "Accept: application/vnd.github.raw" "https://api.github.com/repos/$REPO/contents/$from?ref=main" -o "$to.tmp"
  fi
  [ -s "$to.tmp" ] || { rm -f "$to.tmp"; echo "$from is empty" >&2; exit 1; }
  mv -f "$to.tmp" "$to"
}
trap 'rm -f "$OC_DIR"/*.tmp "$PI_EXT_DIR"/*.tmp "$SETTINGS.tmp" 2>/dev/null || true' EXIT

# where the installed marketplace points: "github:owner/repo", "directory:/path", or empty — 2026-11-05
market_source() {
  local js
  js="$(claude plugin marketplace list --json 2>/dev/null || true)"
  if command -v python3 >/dev/null 2>&1; then
    printf '%s' "$js" | python3 -c 'import json,sys
try: ms=json.load(sys.stdin)
except Exception: ms=[]
m=[x for x in ms if x.get("name")==sys.argv[1]]
print("" if not m else m[0].get("source","")+":"+(m[0].get("repo") or m[0].get("path") or ""))' "$MARKET"
  elif command -v node >/dev/null 2>&1; then
    printf '%s' "$js" | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{let ms=[];try{ms=JSON.parse(s)}catch{};const m=ms.find(x=>x.name===process.argv[1]);console.log(m?`${m.source}:${m.repo||m.path||""}`:"")})' "$MARKET"
  fi
}

install_opencode() {
  mkdir -p "$OC_DIR"
  copy_part plugin/hooks/dance.ts "$OC_DIR/dance.ts"
  copy_part opencode/tui.tsx "$OC_DIR/tui.tsx"
  copy_part plugin/.claude-plugin/plugin.json "$OC_DIR/plugin.json"
}

install_pi() {
  mkdir -p "$PI_EXT_DIR"
  copy_part pi/index.ts "$PI_EXT_DIR/index.ts"
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
if on != "1" and not cfg.get("extraKnownMarketplaces"):
    sys.exit(0)
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
for old in ClauDiscombobulating@ClauDiscombobulating prompt-bar@prompt-bar prompt-bar@prompt-bar-local; do
  claude plugin uninstall "$old" --scope user >/dev/null 2>&1 || true
done
for old in ClauDiscombobulating prompt-bar prompt-bar-local; do
  claude plugin marketplace remove "$old" >/dev/null 2>&1 || true
done

if [ "${1:-}" = "--uninstall" ]; then
  claude plugin uninstall "$PLUGIN" --scope user >/dev/null 2>&1 || true
  claude plugin marketplace remove "$MARKET" >/dev/null 2>&1 || true
  set_autoupdate 0
  rm -rf "$OC_DIR"
  rm -rf "$PI_EXT_DIR"
  rm -f "$CC_DIR/claudiscobombulating.ts" "$CC_DIR/claudiscobombulating.plugin.json" "$CC_DIR/claudiscobombulating.package.json"
  echo "ClauDiscobombulating removed."
  exit 0
fi

with_opencode=0
{ command -v opencode >/dev/null 2>&1 || [ -d "$OC_BASE/opencode" ]; } && with_opencode=1
with_pi=0
{ command -v pi >/dev/null 2>&1 || [ -d "$PI_BASE" ]; } && with_pi=1

# the installed copy goes only after the new source is fetched: no network must not leave you with no mod — 2026-11-05
had="$(market_source)"
if [ "$had" = "github:$REPO" ]; then
  claude plugin marketplace update "$MARKET" || { echo "Could not update the marketplace; the installed copy is kept." >&2; exit 1; }
else
  # removing the marketplace uninstalls the plugin too: reach GitHub first — 2026-11-05
  if [ -n "$had" ] && ! git ls-remote --heads "https://github.com/$REPO" >/dev/null 2>&1 && ! curl -fsS "https://api.github.com/repos/$REPO" >/dev/null 2>&1; then
    echo "GitHub ($REPO) is out of reach; the installed copy is kept." >&2
    exit 1
  fi
  [ -n "$had" ] && claude plugin marketplace remove "$MARKET" >/dev/null 2>&1
  if ! claude plugin marketplace add "$REPO"; then
    case "$had" in
      github:* | directory:*) claude plugin marketplace add "${had#*:}" >/dev/null 2>&1 && claude plugin install "$PLUGIN" --scope user >/dev/null 2>&1 || true ;;
    esac
    echo "Could not add $REPO; the previous install was put back where possible." >&2
    exit 1
  fi
fi
claude plugin uninstall "$PLUGIN" --scope user >/dev/null 2>&1 || true
claude plugin install "$PLUGIN" --scope user
set_autoupdate 1
[ "$with_opencode" = 1 ] && install_opencode
[ "$with_pi" = 1 ] && install_pi
rm -f "$CC_DIR/claudiscobombulating.ts" "$CC_DIR/claudiscobombulating.plugin.json" "$CC_DIR/claudiscobombulating.package.json"
echo "ClauDiscobombulating installed. Restart Claude Code and the desktop app."
[ "$with_opencode" = 1 ] && echo "opencode plugin in $OC_DIR (reloads by itself)."
[ "$with_pi" = 1 ] && echo "pi extension in $PI_EXT_DIR. Restart pi."
exit 0

