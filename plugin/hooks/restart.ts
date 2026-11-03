const ONE = new Set([
  '--agent', '--agents', '--append-system-prompt', '--append-system-prompt-file', '--autocompact', '--debug-file', '--effort',
  '--environment', '--fallback-model', '--input-format', '--json-schema', '--max-budget-usd', '--model', '-n', '--name',
  '--output-format', '--permission-mode', '--permission-prompts', '--permission-prompt-tool', '--plugin-url',
  '--remote-control-session-name-prefix', '--session-id', '--setting-sources', '--settings', '--system-prompt',
  '--system-prompt-file', '--system-prompt-snapshot', '--max-turns',
])
const MANY = new Set(['--add-dir', '--allowedTools', '--allowed-tools', '--betas', '--disallowedTools', '--disallowed-tools', '--file', '--mcp-config', '--plugin-dir', '--tools'])
const OPTIONAL = new Set(['-d', '--debug', '--cloud', '--from-pr', '--prompt-suggestions', '--remote-control', '-r', '--resume', '--teleport', '-w', '--worktree'])
// one-shot or session-picking flags: the relaunch names its own session — 2026-11-03
const DROP = new Set(['-c', '--continue', '-r', '--resume', '--session-id', '--fork-session', '-p', '--print', '--from-pr', '--teleport', '--cloud', '-w', '--worktree', '--tmux', '--bg', '--background', '--desktop', '--file', '-h', '--help', '-v', '--version'])

const flagName = (t: string) => (t.startsWith('--') ? t.split('=')[0]! : t)

export function keptFlags(args: readonly string[]): string[] {
  const out: string[] = []
  for (let i = 0; i < args.length; i++) {
    const t = args[i]!
    if (t === '--') break
    if (!t.startsWith('-') || t === '-') continue
    const name = flagName(t)
    const take: string[] = [t]
    if (!t.includes('=')) {
      if (ONE.has(name)) {
        if (i + 1 < args.length) take.push(args[++i]!)
      } else if (MANY.has(name)) {
        while (i + 1 < args.length && !args[i + 1]!.startsWith('-')) take.push(args[++i]!)
      } else if (OPTIONAL.has(name) && i + 1 < args.length && !args[i + 1]!.startsWith('-')) take.push(args[++i]!)
    }
    if (!DROP.has(name)) out.push(...take)
  }
  return out
}

export function startMode(args: readonly string[]): string {
  if (args.includes('--dangerously-skip-permissions')) return 'bypassPermissions'
  const i = args.findIndex(a => a === '--permission-mode' || a.startsWith('--permission-mode='))
  if (i < 0) return ''
  return args[i]!.includes('=') ? args[i]!.split('=')[1]! : (args[i + 1] ?? '')
}

export function relaunchArgv(argv: readonly string[], sessionId: string, mode: string): string[] {
  const [bin = 'claude', ...rest] = argv
  const flags = keptFlags(rest)
  if (mode && mode !== 'default' && mode !== startMode(rest)) flags.push('--permission-mode', mode)
  return [bin, ...flags, ...(sessionId ? ['--resume', sessionId] : [])]
}

export const shq = (s: string) => `'${s.replace(/'/g, `'\\''`)}'`

// quote rules of the C runtime, enough for claude's own flags — 2026-11-03
export function splitWin(line: string): string[] {
  const out: string[] = []
  let cur = ''
  let isQuoted = false
  let has = false
  for (let i = 0; i < line.length; i++) {
    const c = line[i]!
    if (c === '"') {
      isQuoted = !isQuoted
      has = true
    } else if (!isQuoted && (c === ' ' || c === '\t')) {
      if (has || cur) out.push(cur)
      cur = ''
      has = false
    } else cur += c
  }
  if (has || cur) out.push(cur)
  return out
}

const SHELLS = new Set(['bash', 'zsh', 'fish', 'sh', 'dash', 'ksh', 'tcsh', 'csh', 'nu', 'elvish', 'xonsh', 'pwsh', 'powershell'])
export const isShell = (comm: string) => SHELLS.has(comm.replace(/^-/, '').replace(/\.exe$/i, '').split('/').pop()!.toLowerCase())

const TERMS: Record<string, (cwd: string, cmd: string) => string[]> = {
  'xfce4-terminal': (cwd, cmd) => ['xfce4-terminal', `--working-directory=${cwd}`, '-x', 'sh', '-c', cmd],
  'gnome-terminal-server': (cwd, cmd) => ['gnome-terminal', `--working-directory=${cwd}`, '--', 'sh', '-c', cmd],
  'gnome-terminal': (cwd, cmd) => ['gnome-terminal', `--working-directory=${cwd}`, '--', 'sh', '-c', cmd],
  'kgx': (cwd, cmd) => ['kgx', `--working-directory=${cwd}`, '-e', 'sh', '-c', cmd],
  'ptyxis-agent': (cwd, cmd) => ['ptyxis', '--new-window', `--working-directory=${cwd}`, '--', 'sh', '-c', cmd],
  'konsole': (cwd, cmd) => ['konsole', '--workdir', cwd, '-e', 'sh', '-c', cmd],
  'kitty': (cwd, cmd) => ['kitty', '--directory', cwd, 'sh', '-c', cmd],
  'alacritty': (cwd, cmd) => ['alacritty', '--working-directory', cwd, '-e', 'sh', '-c', cmd],
  'wezterm-gui': (cwd, cmd) => ['wezterm', 'start', '--cwd', cwd, '--', 'sh', '-c', cmd],
  'foot': (cwd, cmd) => ['foot', '--working-directory', cwd, 'sh', '-c', cmd],
  'tilix': (cwd, cmd) => ['tilix', '--working-directory', cwd, '-e', `sh -c ${shq(cmd)}`],
  'terminator': (cwd, cmd) => ['terminator', `--working-directory=${cwd}`, '-x', 'sh', '-c', cmd],
  'xterm': (cwd, cmd) => ['xterm', '-e', 'sh', '-c', `cd ${shq(cwd)} && ${cmd}`],
}

export function newWindow(term: string, cwd: string, argv: readonly string[], isInShell: boolean): string[] | undefined {
  const name = term.split('/').pop()!
  const make = TERMS[name]
  if (!make) return undefined
  const run = `unset CLAUDECODE CLAUDE_CODE_ENTRYPOINT; ${isInShell ? '' : 'exec '}${argv.map(shq).join(' ')}${isInShell ? '; exec "${SHELL:-sh}"' : ''}`
  const win = make(cwd, run)
  // a claude-only xfce4 window comes from a --hold launcher (its .desktop entry) — 2026-11-03
  return name === 'xfce4-terminal' && !isInShell ? [win[0]!, '--hold', ...win.slice(1)] : win
}

// TERMs claude at once, KILL after 10 s, then opens `open` with the env claude started with, closes the old X11 window — 2026-11-03
export function relaunchScript(pid: number, hasProc: boolean, envFile: string, open: string, windowId: string): string {
  return [
    hasProc ? `cp /proc/${pid}/environ ${shq(envFile)} 2>/dev/null` : ':',
    `sleep 0.5; kill -TERM ${pid} 2>/dev/null`,
    'n=0',
    `while kill -0 ${pid} 2>/dev/null; do sleep 0.2; n=$((n+1)); [ $n = 50 ] && kill -KILL ${pid}; done`,
    `if [ -s ${shq(envFile)} ] && command -v bash >/dev/null; then`,
    `  bash -c 'mapfile -d "" E < "$1"; rm -f "$1"; shift; exec env -i "\${E[@]}" "$@"' _ ${shq(envFile)} sh -c ${shq(open)}`,
    `else env -u CLAUDECODE -u CLAUDE_CODE_ENTRYPOINT sh -c ${shq(open)}; fi`,
    /^\d+$/.test(windowId) ? `sleep 1; command -v wmctrl >/dev/null && wmctrl -i -c ${windowId}` : ':',
  ].join('\n')
}
