import { atom, read, update } from 'claude-code'
import type { EngineInterface, Hook, Register, RenderElement, Timer, TurnStepChunk } from 'claude-code'

import type { AgentLive, Context, Counted, Draft, Limit, Live, Pending, Timer as Alarm } from '../types'
import { DANCE_MS, REVEAL_MS, danceCells } from './dance'
import type { Head } from './dance'

// aliases: the engine resolves each to the newest model of the family — 2026-10-02
const MODELS = [
  { family: 'haiku', id: 'haiku', hue: '#3fbf8f' },
  { family: 'sonnet', id: 'sonnet', hue: '#4f9cf0' },
  { family: 'opus', id: 'opus', hue: '#d97757' },
]
const EFFORTS = ['low', 'medium', 'high', 'xhigh', 'max']
const EFFORT_COLORS = ['#4f9cf0', '#3fbf8f', '#3fbf8f', '#3fbf8f', '#ef5b5b']
const APPLY_MS = 700
const UNREAD = '?'
const PANE = 'ClauDiscobombulating'
const PANE_COLS = 38
const TIMER_ROWS = 12
const RESUME_TERMINAL = '--resume'
const RESUME_OTHER = 'continue'
const WHEEL_GAP_MS = 150
const CACHE_TTL_MS = 3600000
// User chose 200k tokens as cheap re-cache threshold — 2026-10-16
const CHEAP_MISS_TOKENS = 200000
const CACHE_SHOW_BELOW = 55
const ALERT_MIN = 10
const AUTO_COMPACT_AT = 99
// a window this close to its reset frees itself; a compact would only cost — 2026-10-11
const NO_COMPACT_BEFORE_RESET_MS = 59 * 60000
const COMPACT_GRACE_MS = 600000
const COMPACT_QUIET_MSGS = 5
const COUNT_FRAME_MS = 50
const GUESS_EVERY_MS = 30000
const DANCE_FRAME_MS = 40
const STAGE_MIN_ROWS = 12
const ALERT_TITLE = 'ClauDiscobombulating'
// no double quotes: argv reaches powershell.exe as one command line — 2026-10-06
const ALERT_PS = `$ErrorActionPreference='Stop';Add-Type -AssemblyName PresentationCore;$p=New-Object System.Windows.Media.MediaPlayer;$p.Open([uri]$env:PB_SOUND);$p.Play();[void][Windows.UI.Notifications.ToastNotificationManager,Windows.UI.Notifications,ContentType=WindowsRuntime];[void][Windows.Data.Xml.Dom.XmlDocument,Windows.Data.Xml.Dom.XmlDocument,ContentType=WindowsRuntime];$x=New-Object Windows.Data.Xml.Dom.XmlDocument;$x.LoadXml('<toast><visual><binding template=''ToastGeneric''><text>'+$env:PB_TITLE+'</text><text>'+$env:PB_BODY+'</text></binding></visual><audio silent=''true''/></toast>');[Windows.UI.Notifications.ToastNotificationManager]::CreateToastNotifier('{1AC14E77-02E7-4E5D-B744-2EB1AE5198B7}\\WindowsPowerShell\\v1.0\\powershell.exe').Show([Windows.UI.Notifications.ToastNotification]::new($x));Start-Sleep -Seconds 5`

// WT takes CSI 8 t written to the console, but not after SetConsoleWindowInfo already resized its buffer; classic consoles take the latter — 2026-10-14
const WIDEN_CS = `using System;
using System.Runtime.InteropServices;
public class W {
  [DllImport("kernel32.dll", SetLastError=true)] public static extern bool AttachConsole(uint pid);
  [DllImport("kernel32.dll", SetLastError=true)] public static extern bool FreeConsole();
  [DllImport("kernel32.dll", SetLastError=true)] public static extern bool GetConsoleMode(IntPtr h, out uint mode);
  [DllImport("kernel32.dll", SetLastError=true)] public static extern bool SetConsoleMode(IntPtr h, uint mode);
  [DllImport("kernel32.dll", SetLastError=true, CharSet=CharSet.Unicode)] public static extern IntPtr CreateFileW(string name, uint access, uint share, IntPtr sa, uint disp, uint flags, IntPtr templ);
  [DllImport("kernel32.dll", SetLastError=true)] public static extern bool GetConsoleScreenBufferInfo(IntPtr h, out CSI info);
  [DllImport("kernel32.dll", SetLastError=true)] public static extern bool SetConsoleScreenBufferSize(IntPtr h, COORD size);
  [DllImport("kernel32.dll", SetLastError=true)] public static extern bool SetConsoleWindowInfo(IntPtr h, bool absolute, ref RECT rect);
  [DllImport("kernel32.dll", SetLastError=true, CharSet=CharSet.Unicode)] public static extern bool WriteConsoleW(IntPtr h, string text, uint n, out uint written, IntPtr reserved);
  [DllImport("kernel32.dll", SetLastError=true)] public static extern bool CloseHandle(IntPtr h);
  [StructLayout(LayoutKind.Sequential)] public struct COORD { public short X; public short Y; }
  [StructLayout(LayoutKind.Sequential)] public struct RECT { public short Left; public short Top; public short Right; public short Bottom; }
  [StructLayout(LayoutKind.Sequential)] public struct CSI { public COORD Size; public COORD Cursor; public ushort Attrs; public RECT Window; public COORD Max; }
}`

// hex literals parse as negative ints in PowerShell and the uint parameters refuse them; single quotes only, the argv keeps them — 2026-10-12
const WIDEN_PS =
  `$ErrorActionPreference='SilentlyContinue';Add-Type -TypeDefinition $env:CDB_CS;` +
  `[W]::FreeConsole()|Out-Null;[W]::AttachConsole([uint32]::MaxValue)|Out-Null;` +
  `$h=[W]::CreateFileW('CONOUT$',[uint32]3221225472,[uint32]3,[IntPtr]::Zero,[uint32]3,[uint32]0,[IntPtr]::Zero);` +
  `$hv=0;try{$hv=$h.ToInt64()}catch{};` +
  `if($hv -gt 0){$i=New-Object 'W+CSI';` +
  `if([W]::GetConsoleScreenBufferInfo($h,[ref]$i)){` +
  `$rows=$i.Window.Bottom-$i.Window.Top+1;$cols=$i.Window.Right-$i.Window.Left+1;$t=[int]$env:CDB_WIDEN;$u=[int]$env:CDB_ROWS;` +
  `if($t -lt $cols){$t=$cols};if($u -lt $rows){$u=$rows};Write-Output ([string]$cols+'x'+$rows);` +
  `if($t -gt $cols -or $u -gt $rows){` +
  `$m=[uint32]0;[W]::GetConsoleMode($h,[ref]$m)|Out-Null;[W]::SetConsoleMode($h,[uint32]($m -bor 5))|Out-Null;` +
  `$s=[string][char]27+'[8;'+$u+';'+$t+'t';$n=[uint32]0;[W]::WriteConsoleW($h,$s,[uint32]$s.Length,[ref]$n,[IntPtr]::Zero)|Out-Null;[W]::SetConsoleMode($h,$m)|Out-Null;` +
  `Start-Sleep -Milliseconds 400;[W]::GetConsoleScreenBufferInfo($h,[ref]$i)|Out-Null;` +
  `if($i.Window.Right-$i.Window.Left+1 -lt $t -or $i.Window.Bottom-$i.Window.Top+1 -lt $u){` +
  `$b=New-Object 'W+COORD';$b.X=[int16]$t;$b.Y=[int16][Math]::Max([int]$i.Size.Y,$u);` +
  `[W]::SetConsoleScreenBufferSize($h,$b)|Out-Null;` +
  `$r=New-Object 'W+RECT';$r.Left=0;$r.Top=0;$r.Right=[int16]($t-1);$r.Bottom=[int16]($u-1);` +
  `[W]::SetConsoleWindowInfo($h,$true,[ref]$r)|Out-Null}}}};` +
  `[W]::CloseHandle($h)|Out-Null`

// the dock places a pane the mod opens on its own from 144 cols; 40 rows show the whole pane unscrolled — 2026-10-14
const FIT_COLS = 144
const FIT_ROWS = 40
const WIDEN_WAIT_MS = 1200
const GROW_GAP_MS = 10000
const GROW_MAX = 3

const UK = {
  defaultText: 'продовжуй',
  yes: 'Продовжити',
  no: 'Скасувати',
  hour: 'г',
  min: 'хв',
  day: 'д',
  cache: 'кеш',
  at: 'о',
  via: 'через',
  alertBody: 'Кеш: лишилось 10 хв',
  armed: (t: string) => `Повідомлення піде о ${t}`,
  compactOnHaiku: 'Cache miss: compact на Haiku',
  compactFailed: 'Compact не вдався',
  autoCompact: (p: number) => `Ліміт 5г ${p}%: стоп і compact`,
  resumeFailed: 'Не вдалося відкрити /resume',
  resumeAsk: 'Cache miss: контекст кешується заново і це коштує. Все одно продовжити?',
  toPane: 'колесо ⇥',
  paneOpen: 'Панель відкрита.',
  paneWaits: 'Панель чекає на ширший термінал.',
  updateAvail: 'нова',
  updateDone: (v: string) => `Оновлено до v${v}. Перезапусти сесію.`,
  updateFailed: 'Оновлення не вдалося',
  placeholder: 'текст повідомлення',
  cancelBtn: '✕  скасувати',
  sendBtn: '✓  відправити',
  chordHint: 'змінити',
  timer: 'Таймер',
  model: 'Модель',
  subagents: 'Субагенти',
  subStart: 'стартує…',
  subThink: 'думає…',
  subWrite: 'пише…',
  sep: ' ',
  boom: 'БАХ!',
}
const EN: typeof UK = {
  defaultText: 'continue',
  yes: 'Continue',
  no: 'Cancel',
  hour: 'h',
  min: 'm',
  day: 'd',
  cache: 'cache',
  at: 'at',
  via: 'in',
  alertBody: 'Cache: 10 min left',
  armed: t => `Message will be sent at ${t}`,
  compactOnHaiku: 'Cache miss: compacting on Haiku',
  compactFailed: 'Compact failed',
  autoCompact: p => `5h limit ${p}%: stopping to compact`,
  resumeFailed: 'Could not open /resume',
  resumeAsk: 'Cache miss: the context is cached again, which costs tokens. Continue anyway?',
  toPane: 'wheel ⇥',
  paneOpen: 'Pane opened.',
  paneWaits: 'Pane waits for a wider terminal.',
  updateAvail: 'new',
  updateDone: (v: string) => `Updated to v${v}. Restart the session.`,
  updateFailed: 'Update failed',
  placeholder: 'message text',
  cancelBtn: '✕  cancel',
  sendBtn: '✓  send',
  chordHint: 'to change',
  timer: 'Timer',
  model: 'Model',
  subagents: 'Subagents',
  subStart: 'starting…',
  subThink: 'thinking…',
  subWrite: 'writing…',
  sep: ',',
  boom: 'BOOM!',
}
let tr = EN

const limits = atom({ plugin: 'ClauDiscobombulating', key: 'limits' } as const, [] as Limit[])
const live = atom({ plugin: 'ClauDiscobombulating', key: 'live' } as const, { model: '', effort: '' } as Live)
const pending = atom({ plugin: 'ClauDiscobombulating', key: 'pending' } as const, { model: '', effort: '' } as Pending)
const agents = atom({ plugin: 'ClauDiscobombulating', key: 'agents' } as const, {} as Record<string, AgentLive>)
const flag = atom({ plugin: 'ClauDiscobombulating', key: 'flag' } as const, UNREAD)
const paneUp = atom({ plugin: 'ClauDiscobombulating', key: 'paneUp' } as const, false)
const timer = atom({ plugin: 'ClauDiscobombulating', key: 'timer' } as const, { at: 0, text: UK.defaultText } as Alarm)
const draft = atom({ plugin: 'ClauDiscobombulating', key: 'draft' } as const, { h: 0, m: 0, isSet: false } as Draft)
const showResetAt = atom({ plugin: 'ClauDiscobombulating', key: 'showResetAt' } as const, false)
const cacheLeft = atom({ plugin: 'ClauDiscobombulating', key: 'cacheLeft' } as const, -1)
const activeAt = atom({ plugin: 'ClauDiscobombulating', key: 'activeAt' } as const, 0)
const alerted = atom({ plugin: 'ClauDiscobombulating', key: 'alerted' } as const, 0)
// persisted per 5h window so a reload at 99% does not compact twice — 2026-10-06
const compactedFor = atom({ plugin: 'ClauDiscobombulating', key: 'compactedFor' } as const, '')
const compactedAt = atom({ plugin: 'ClauDiscobombulating', key: 'compactedAt' } as const, 0)
const sinceCompact = atom({ plugin: 'ClauDiscobombulating', key: 'sinceCompact' } as const, COMPACT_QUIET_MSGS)
const context = atom({ plugin: 'ClauDiscobombulating', key: 'context' } as const, { tokens: 0, window: 0, percent: -1 } as Context)
const log = atom({ plugin: 'ClauDiscobombulating', key: 'log' } as const, [] as string[])
const latest = atom({ plugin: 'ClauDiscobombulating', key: 'latest' } as const, '')
// the band reads this, not isFull: a draw that read no atom is never redrawn — 2026-10-11
const full = atom({ plugin: 'ClauDiscobombulating', key: 'full' } as const, false)
const minute = atom({ plugin: 'ClauDiscobombulating', key: 'minute' } as const, 0)
const countMode = atom({ plugin: 'ClauDiscobombulating', key: 'countMode' } as const, false)
const counted = atom({ plugin: 'ClauDiscobombulating', key: 'counted' } as const, { n: 0, prev: 0 } as Counted)
const dance = atom({ plugin: 'ClauDiscobombulating', key: 'dance' } as const, 0)
const reveal = atom({ plugin: 'ClauDiscobombulating', key: 'reveal' } as const, 1)

const modelIndex = (id: string) => MODELS.findIndex(m => id.toLowerCase().includes(m.family))
const labels: Record<string, string> = {}
const cap = (w: string) => w.charAt(0).toUpperCase() + w.slice(1)
function versionLabel(id: string) {
  const m = /claude-([a-z]+)-(\d+)-(\d+)(?:-\d{8})?/.exec(id.toLowerCase())
  return m ? `${cap(m[1])} ${m[2]}.${m[3]}` : undefined
}
function modelLabel(id: string) {
  const fam = MODELS[modelIndex(id)]?.family
  return versionLabel(id) ?? (fam ? labels[fam] ?? cap(fam) : id || '…')
}
const isLevel = (v: unknown): v is string => typeof v === 'string' && EFFORTS.includes(v)
const effortTone = (l: string) => EFFORT_COLORS[EFFORTS.indexOf(l)] ?? 'gray'
const HINT_KEYS = ['file_path', 'notebook_path', 'path', 'command', 'pattern', 'query', 'url', 'skill', 'description', 'prompt']
const HINT_FILE = new Set(['file_path', 'notebook_path', 'path'])
const HINT_MAX = 26
function toolHint(e: Record<string, unknown>) {
  for (const k of HINT_KEYS) {
    const v = e[k]
    if (typeof v !== 'string' || !v.trim()) continue
    const first = v.trim().split('\n')[0] ?? v.trim()
    const s = HINT_FILE.has(k) ? first.replace(/[\\/]+$/, '').split(/[\\/]/).pop() ?? first : first
    return s.length > HINT_MAX ? `${s.slice(0, HINT_MAX - 1)}…` : s
  }
  return ''
}
const REFUSED = /Not applied|Failed|Unknown|Usage:/
const within = (row: number, [a, b]: number[]) => row >= a && row <= b
const wrap = (i: number, n: number) => ((i % n) + n) % n
const tone = (p: number) => (p >= 90 ? '#ef5b5b' : p >= 70 ? '#f0b429' : '#3fbf8f')
const shortName = (kind: string) => ({ five_hour: `5${tr.hour}`, seven_day: `7${tr.day}`, spend_limit: '$' })[kind as 'five_hour'] ?? kind

function resetIn(iso?: string, now = Date.now()) {
  if (!iso) return ''
  const t = Date.parse(iso)
  if (Number.isNaN(t)) return ''
  const m = Math.max(0, Math.round((t - now) / 60000))
  if (m >= 1440) return `${Math.floor(m / 1440)}${tr.day} ${Math.floor((m % 1440) / 60)}${tr.hour}`
  return m >= 60 ? `${Math.floor(m / 60)}${tr.hour} ${m % 60}${tr.min}` : `${m}${tr.min}`
}

const homeDir = async ($: EngineInterface) => (await $.env.get('USERPROFILE')) || (await $.env.get('HOME'))

async function note($: EngineInterface, line: string) {
  const t = new Date().toISOString().slice(11, 19)
  await update($, log, l => [...l.slice(-29), `${t} ${line}`])
  try {
    const home = await homeDir($)
    if (home) await $.fs.write(`${home}/.claude/mods/ClauDiscobombulating-debug.log`, (await read($, log)).join(String.fromCharCode(10)))
  } catch {}
}

async function countSinceCompact($: EngineInterface) {
  const seen = await read($, sinceCompact)
  if (seen < COMPACT_QUIET_MSGS) await update($, sinceCompact, () => seen + 1)
}

// a loop id the list does not name is an engine fork (compaction, memory), not a subagent — 2026-10-15
async function adoptAgent($: EngineInterface, id: string) {
  if ((await read($, agents))[id]) return true
  const known = await $.agent.list().then(list => list.some(a => a.id === id)).catch(() => false)
  if (known) await update($, agents, a => ({ ...a, [id]: { model: '', effort: '', line: `✧ ${tr.subThink}` } }))
  return known
}

async function patchAgent($: EngineInterface, id: string, patch: Partial<AgentLive>) {
  await update($, agents, a => (a[id] ? { ...a, [id]: { ...a[id], ...patch } } : a))
}

async function dropAgent($: EngineInterface, id: string) {
  await update($, agents, a => {
    if (!a[id]) return a
    const left = { ...a }
    delete left[id]
    return left
  })
}

type SavedSettings = { effortLevel?: unknown; modelSettings?: Record<string, { effortLevel?: unknown }> }

async function openPane($: EngineInterface, why: string) {
  const r = await $.ui.open({ id: PANE, title: 'ClauDiscobombulating', columns: PANE_COLS })
  await note($, `open pane (${why}) → ${JSON.stringify(r)}`)
  return r
}

let growTries = 0
let growAt = 0
let growFor = ''
let view = { columns: 0, rows: 0 }

async function widenConsole($: EngineInterface) {
  const rows = Math.max(view.rows, FIT_ROWS)
  if ((await $.env.get('OS').catch(() => undefined)) === 'Windows_NT') {
    const argv = ['powershell.exe', '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', WIDEN_PS]
    const r = await $.process.run(argv, { env: { CDB_CS: WIDEN_CS, CDB_WIDEN: String(FIT_COLS), CDB_ROWS: String(rows) }, timeoutMs: 10000 }).catch(err => note($, `widen failed ${String(err)}`))
    if (r) await note($, `widen: console ${r.stdout.trim() || 'unseen'}`)
    return
  }
  const grow = 's=$(stty size </dev/tty) || exit 0; r=${s% *}; c=${s#* }; [ "$r" -lt "$CDB_ROWS" ] && r=$CDB_ROWS; [ "$c" -lt "$CDB_WIDEN" ] && c=$CDB_WIDEN; printf "\\033[8;%s;%st" "$r" "$c" > /dev/tty'
  const argv = ['sh', '-c', grow]
  await $.process.run(argv, { env: { CDB_WIDEN: String(FIT_COLS), CDB_ROWS: String(rows) }, timeoutMs: 5000 }).catch(err => note($, `widen failed ${String(err)}`))
}

// the viewport leaves out a docked pane, so only its rows tell the window is short; width is the unplaced pane's trigger — 2026-10-14
const isShort = () => view.rows > 0 && view.rows < FIT_ROWS

async function fitPane($: EngineInterface): Promise<boolean> {
  if (!isFull) return false
  const size = `${view.columns}x${view.rows}`
  if (size !== growFor) {
    growFor = size
    growTries = 0
  }
  if (growTries >= GROW_MAX) return false
  const now = await $.clock.now()
  if (now - growAt < GROW_GAP_MS) return false
  growAt = now
  growTries++
  await widenConsole($)
  await new Promise<void>(r => $.clock.after(WIDEN_WAIT_MS, () => r()))
  const placed = (await $.ui.panes().catch(() => [])).some(x => x.id === PANE && x.isPlaced)
  await note($, placed ? `pane placed after widening from ${size}` : `widen from ${size}: pane waits`)
  return placed
}

async function savedEffort($: EngineInterface, model: string) {
  const st = (await $.settings.read()) as SavedSettings
  const own = st.modelSettings?.[model]?.effortLevel
  if (isLevel(own)) return own
  return isLevel(st.effortLevel) ? st.effortLevel : ''
}


const two = (n: number) => String(n).padStart(2, '0')
function hsl(h: number, s: number, l: number) {
  const a = s * Math.min(l, 1 - l)
  const f = (n: number) => {
    const k = (n + h / 30) % 12
    return Math.round(255 * (l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1)))).toString(16).padStart(2, '0')
  }
  return `#${f(0)}${f(8)}${f(4)}`
}
const glow = (n: number) => Array.from({ length: n }, (_, k) => hsl((280 + (k * 120) / Math.max(1, n - 1)) % 360, 0.75, 0.65))

const cacheText = (min: number, tokens = 0) => (min <= 0 ? `⚠ Cache Miss${tokens > 0 ? ` ${kTok(tokens)}` : ''}` : `${tr.cache} ${min}${tr.min}`)
const cacheColor = (min: number) => (min <= 5 ? '#ef5b5b' : min <= 15 ? '#f0b429' : '#3fbf8f')
const kTok = (n: number) => (n >= 1000000 ? `${Math.round(n / 100000) / 10}M` : n >= 1000 ? `${Math.round(n / 1000)}k` : `${n}`)
const ctxLabel = (c: Context) => (c.window > 0 ? `${c.isGuess ? '≈' : ''}${kTok(c.tokens)}/${kTok(c.window)}` : '')
const grouped = (n: number) => String(Math.max(0, Math.round(n))).replace(/\B(?=(\d{3})+(?!\d))/g, tr.sep)

// pure yellow at 600k, pure red from 900k: the user's pick — 2026-10-11
function ctxColor(n: number, white = 0) {
  const ch = (v: number) => Math.round(v + (255 - v) * white).toString(16).padStart(2, '0')
  return `#${ch(255 * Math.min(1, n / 600000))}${ch(255 * (1 - Math.min(1, Math.max(0, n - 600000) / 300000)))}${ch(0)}`
}

function cacheMinutes(now: number) {
  if (!lastActive || isBusy) return -1
  return Math.max(0, Math.ceil((CACHE_TTL_MS - (now - lastActive)) / 60000))
}

async function isCostlyMiss($: EngineInterface) {
  return cacheMinutes(await $.clock.now()) === 0 && (await read($, context)).tokens >= CHEAP_MISS_TOKENS
}

const UK_TAG = /^uk(?![a-z])/i
const firstTag = (out: string) => /[A-Za-z]{2,3}(?:[-_][A-Za-z0-9]+)?/.exec(out)?.[0] ?? ''

// LANG is set by Git Bash on Windows, so there the display language wins; unknown → English — 2026-10-06
async function detectUk($: EngineInterface) {
  const none = () => undefined
  const forced = await $.env.get('CLAUDISCOBOMBULATING_LANG').catch(none)
  if (forced) return UK_TAG.test(forced)
  const isWin = (await $.env.get('OS').catch(none)) === 'Windows_NT'
  if (!isWin) {
    const vars = [await $.env.get('LC_ALL').catch(none), await $.env.get('LC_MESSAGES').catch(none), await $.env.get('LANGUAGE').catch(none), await $.env.get('LANG').catch(none)]
    const set = vars.find(v => v && v !== 'C' && v !== 'POSIX')
    if (set) return UK_TAG.test(set)
  }
  const argv = isWin ? ['powershell.exe', '-NoProfile', '-NonInteractive', '-Command', '(Get-UICulture).Name'] : ['defaults', 'read', '-g', 'AppleLanguages']
  const r = await $.process.run(argv, { timeoutMs: 5000 }).catch(() => undefined)
  return UK_TAG.test(firstTag(r?.stdout ?? ''))
}

async function applyLang($: EngineInterface) {
  tr = (await detectUk($)) ? UK : EN
  const isDefault = (x: string) => x === UK.defaultText || x === EN.defaultText
  await update($, timer, t => (isDefault(t.text) && t.text !== tr.defaultText ? { ...t, text: tr.defaultText } : t))
}

const showsCache = (min: number, surface: string) => min >= 0 && (surface === 'desktop' || min <= CACHE_SHOW_BELOW)

async function alertCache($: EngineInterface) {
  $.ui.toast(tr.alertBody)
  if ((await $.env.get('OS').catch(() => undefined)) === 'Windows_NT') {
    const sound = encodeURI(`file:///${$.plugin.root.replace(/\\/g, '/')}/assets/cache-alert.mp3`)
    // the PS script single-quotes these: an apostrophe doubles — 2026-10-11
    const ps = (s: string) => s.replace(/'/g, "''")
    const env = { PB_SOUND: sound, PB_TITLE: ps(ALERT_TITLE), PB_BODY: ps(tr.alertBody) }
    const argv = ['powershell.exe', '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', ALERT_PS]
    await $.process.run(argv, { env, timeoutMs: 20000 }).catch(err => note($, `alert failed ${String(err)}`))
    return
  }
  // the engine plays the clip with afplay on macOS and skips it where there is no player — 2026-10-06
  await $.audio.play({ asset: 'assets/cache-alert.mp3' }).catch(err => note($, `alert failed ${String(err)}`))
}

async function alertQuiet($: EngineInterface) {
  const five = (await read($, limits)).find(l => l.kind === 'five_hour')
  return (five?.percentUsed ?? 0) >= AUTO_COMPACT_AT || (await read($, sinceCompact)) < COMPACT_QUIET_MSGS
}

function nextAt(h: number, m: number, now: number) {
  const d = new Date(now)
  d.setHours(h, m, 0, 0)
  if (d.getTime() <= now) d.setDate(d.getDate() + 1)
  return d.getTime()
}

function inFor(ms: number) {
  const m = Math.max(0, Math.round(ms / 60000))
  return m >= 60 ? `${Math.floor(m / 60)}${tr.hour} ${m % 60}${tr.min}` : `${m}${tr.min}`
}

async function shownDraft($: EngineInterface): Promise<Draft> {
  const d = await read($, draft)
  if (d.isSet) return d
  const reset = (await read($, limits)).find(l => l.kind === 'five_hour')?.resetsAt
  const base = reset ? Date.parse(reset) + 60000 : Date.now() + 3600000
  const t = new Date(Math.ceil(base / 300000) * 300000)
  return { h: t.getHours(), m: t.getMinutes(), isSet: false }
}

async function nudgeDraft($: EngineInterface, part: 'h' | 'm', dir: number) {
  const d = await shownDraft($)
  const next = part === 'h' ? { ...d, h: wrap(d.h + dir, 24) } : { ...d, m: wrap(d.m + dir * 5, 60) }
  await update($, draft, () => ({ ...next, isSet: true }))
}

async function armTimer($: EngineInterface) {
  const d = await shownDraft($)
  const at = nextAt(d.h, d.m, Date.now())
  await update($, timer, t => ({ ...t, at }))
  await note($, `timer armed for ${new Date(at).toString()}`)
  $.ui.toast(tr.armed(`${two(d.h)}:${two(d.m)}`))
}

async function fireTimer($: EngineInterface) {
  const t = await read($, timer)
  if (!t.at || Date.now() < t.at) return
  await update($, timer, x => ({ ...x, at: 0 }))
  await update($, draft, x => ({ ...x, isSet: false }))
  await note($, `timer fired: ${t.text}`)
  await $.prompt.submit({ text: t.text || tr.defaultText, asUser: true })
}

async function compactEffort($: EngineInterface, effort: string) {
  const previous = await $.env.get('CLAUDE_CODE_EFFORT_LEVEL')
  // Claude Code compares env-resolved effort before its cache confirmation — 2026-10-16
  await $.env.set('CLAUDE_CODE_EFFORT_LEVEL', effort)
  try {
    return await runInjected($, 'effort', effort)
  } finally {
    await $.env.set('CLAUDE_CODE_EFFORT_LEVEL', previous)
  }
}

async function compact($: EngineInterface): Promise<boolean> {
  const model = await $.session.model()
  // live is only polled in full mode, so desktop reads the effort from the app flag or saved settings — 2026-10-06
  const flagged = ((await $.settings.read({ source: 'flag' })) as SavedSettings).effortLevel
  const effort = (await read($, live)).effort || (isLevel(flagged) ? flagged : await savedEffort($, model))
  const fam = MODELS[modelIndex(model)]
  const isMiss = (await isCostlyMiss($))
  const isSwitch = isMiss && fam?.family !== 'haiku'
  // medium on a miss: the summary decides what the context keeps, so it is worth the thinking — 2026-10-10
  const target = isMiss ? 'medium' : 'low'
  const changed = isLevel(effort) && effort !== target
  try {
    if (isSwitch) {
      $.ui.toast(tr.compactOnHaiku)
      await runInjected($, 'model', 'haiku')
    }
    // effort goes after a model switch: the app re-sends its own at every switch — 2026-10-10
    if (changed) await compactEffort($, target)
    await runInjected($, 'compact')
    const doneAt = await $.clock.now()
    await update($, compactedAt, () => doneAt)
    await update($, sinceCompact, () => 0)
    return true
  } catch (err) {
    $.ui.toast(tr.compactFailed)
    await note($, `compact failed ${String(err)}`)
    const failAt = await $.clock.now()
    await update($, compactedAt, () => failAt)
    return false
  } finally {
    if (isSwitch) {
      await runInjected($, 'model', fam?.id ?? model).catch(() => undefined)
      await update($, live, l => ({ ...l, model }))
    }
    if (isLevel(effort) && (isSwitch || changed)) {
      await compactEffort($, effort).catch(() => undefined)
      await update($, live, l => ({ ...l, effort }))
    }
  }
}

const checkEveryMs = (p: number) => (p >= 95 ? 1000 : p >= 90 ? 30000 : p >= 75 ? 60000 : 300000)

async function autoCompact($: EngineInterface) {
  const five = (await read($, limits)).find(l => l.kind === 'five_hour')
  const now = await $.clock.now()
  if (five && now - lastCheck < checkEveryMs(lastPercent)) return
  lastCheck = now
  lastPercent = five?.percentUsed ?? 0
  if (!five || five.percentUsed < AUTO_COMPACT_AT || isCompacting) return
  if (five.resetsAt && Date.parse(five.resetsAt) - now < NO_COMPACT_BEFORE_RESET_MS) return
  isCompacting = true
  try {
    if (now - (await read($, compactedAt)) < COMPACT_GRACE_MS) return
    const key = five.resetsAt ?? `t${Math.floor(now / 18000000)}`
    if ((await read($, compactedFor)) === key) return
    $.ui.toast(tr.autoCompact(Math.floor(five.percentUsed)))
    if (isBusy && turnId) {
      await $.turn.abort({ turnId }).catch(err => note($, `auto abort failed ${String(err)}`))
      isBusy = false
    }
    await note($, `auto compact at ${five.percentUsed}%`)
    if (await compact($)) {
      compactedKey = key
      await update($, compactedFor, () => key)
    }
  } finally {
    isCompacting = false
  }
}

async function sessions($: EngineInterface) {
  try {
    await $.command.run({ command: 'resume' })
  } catch (err) {
    $.ui.toast(tr.resumeFailed)
    await note($, `sessions failed ${String(err)}`)
  }
}

async function resume($: EngineInterface, surface: string) {
  const text = surface === 'terminal' ? RESUME_TERMINAL : RESUME_OTHER
  if ((await isCostlyMiss($)) && !(await alertQuiet($))) {
    const answer = await $.ui
      .ask(tr.resumeAsk, [tr.yes, tr.no])
      .catch(() => '')
    if (answer !== tr.yes) return
  }
  await note($, `resume → ${text}`)
  await $.prompt.submit({ text, asUser: true })
}

let guessedAt = 0
let isCompacted = false
let compactedKey = ''
let latestSeen = ''
let guessed = 0
// no response yet after a compaction → usage() has no tokens; /context's local estimate fills in — 2026-10-14
async function guessTokens($: EngineInterface) {
  const now = Date.now()
  if (now - guessedAt < GUESS_EVERY_MS) return guessed
  guessedAt = now
  const b = (await $.session.usage({ breakdown: 'summary' }).catch(() => undefined))?.context.breakdown
  if (b) guessed = b.totalTokens
  return guessed
}

let polling = false
async function poll($: EngineInterface) {
  // a tick is skipped rather than overlapped: the reads below are not atomic together — 2026-10-11
  if (polling) return
  polling = true
  try {
    if (isFull) await fireTimer($)
    const tick = await $.clock.now()
    if (!lastActive) lastActive = await read($, activeAt)
    if (isBusy) lastActive = tick
    const left = cacheMinutes(tick)
    if (left !== (await read($, cacheLeft))) await update($, cacheLeft, () => left)
    const quiet = await alertQuiet($)
    if (!quiet && left > 0 && left <= ALERT_MIN && (await read($, alerted)) !== lastActive) {
      await update($, alerted, () => lastActive)
      void alertCache($)
    }
    await adoptShared($).catch(() => undefined)
    await resync($).catch(() => undefined)
    const u = await $.session.usage().catch(() => undefined)
    const c = u?.context
    if (c) {
      const has = typeof c.tokens === 'number'
      if (has) isCompacted = false
      const isGuess = !has && isCompacted && c.window > 0
      const tokens = isGuess ? await guessTokens($) : (c.tokens ?? 0)
      if (!isGuess) guessedAt = 0
      const fresh: Context = { tokens, window: has || isGuess ? c.window : 0, percent: typeof c.percent === 'number' ? Math.round(c.percent) : tokens && c.window ? Math.round((tokens / c.window) * 100) : -1, isGuess }
      const seen = await read($, context)
      if (seen.tokens !== fresh.tokens || seen.window !== fresh.window || seen.percent !== fresh.percent || !seen.isGuess !== !fresh.isGuess) await update($, context, () => fresh)
      measured(fresh.tokens)
      kickCount($)
    }
    const now = Date.now()
    const ls = await read($, limits)
    if (ls.some(l => l.resetsAt && Date.parse(l.resetsAt) <= now)) {
      // the API reports a new window only with the next response, so zero it locally — 2026-10-02
      await update($, limits, xs => xs.map(l => (l.resetsAt && Date.parse(l.resetsAt) <= now ? { kind: l.kind, percentUsed: 0 } : l)))
    }
    void autoCompact($).catch(err => note($, `auto compact failed ${String(err)}`))
    if (!isFull) return
    const m = Math.floor(tick / 60000)
    if (m !== (await read($, minute))) await update($, minute, () => m)
    const panes = await $.ui.panes().catch(() => [])
    const up = panes.some(x => x.id === PANE && x.isPlaced && x.isShown)
    if (up !== (await read($, paneUp))) await update($, paneUp, () => up)
    if ((!up && panes.some(x => x.id === PANE)) || isShort()) void fitPane($).catch(err => note($, `fit failed ${String(err)}`))
    const model = await $.session.model()
    const raw = ((await $.settings.read({ source: 'flag' })) as { effortLevel?: unknown }).effortLevel
    const flagEffort = typeof raw === 'string' ? raw : ''
    const seen = await read($, flag)
    const p = await read($, pending)
    const cur = await read($, live)
    let nextLive = cur
    const known = versionLabel(model)
    const fam = MODELS[modelIndex(model)]?.family
    if (known && fam && labels[fam] !== known) {
      labels[fam] = known
      await $.store.set(`label:${fam}`, known).catch(() => undefined)
    }
    if (!p.model && model && model !== cur.model) {
      nextLive = { ...nextLive, model }
      // app re-sends its own effort on every model switch — 2026-10-02
      if (cur.model) nextLive = { ...nextLive, effort: flagEffort || (await savedEffort($, model)) || cur.effort }
    }
    if (flagEffort !== seen) {
      await update($, flag, () => flagEffort)
      if (seen !== UNREAD || !cur.effort) {
        nextLive = { ...nextLive, effort: flagEffort }
        if (p.effort) await update($, pending, q => ({ ...q, effort: '' }))
        await note($, `app effort → ${flagEffort || 'unset'}`)
      }
    }
    if (!nextLive.effort) {
      const saved = await savedEffort($, model)
      if (saved) nextLive = { ...nextLive, effort: saved }
    }
    if (nextLive !== cur) await update($, live, () => nextLive)
  } catch (err) {
    await note($, `poll failed ${String(err)}`)
  } finally {
    polling = false
  }
}

let isFull = false
let sharedAt = 0
let lastActive = 0
let isBusy = false
let isCompacting = false
let lastCheck = 0
let lastPercent = 0
let turnId = ''

type Shared = { at: number; limits: Limit[] }

// each session hears only its own API replies; the store carries the freshest to the rest — 2026-10-02
async function sharedPath($: EngineInterface) {
  const home = await homeDir($)
  return home ? `${home}/.claude/mods/ClauDiscobombulating-limits.json` : undefined
}

async function shareLimits($: EngineInterface, ls: Limit[]) {
  sharedAt = Date.now()
  const path = await sharedPath($)
  if (path) await $.fs.write(path, JSON.stringify({ at: sharedAt, limits: ls })).catch(() => undefined)
}

async function adoptShared($: EngineInterface) {
  const path = await sharedPath($)
  if (!path) return
  let v: Shared | undefined
  try {
    v = JSON.parse(await $.fs.read(path)) as Shared
  } catch {
    return
  }
  if (!v || !Array.isArray(v.limits) || (v.at <= sharedAt && (await read($, limits)).length > 0)) return
  sharedAt = v.at
  await update($, limits, () => v.limits)
}
let effortTimer: Timer | undefined
let modelTimer: Timer | undefined
let pollEvery: Timer | undefined
let injected = 0

async function applyModel($: EngineInterface) {
  const p = await read($, pending)
  if (!p.model) return
  const cur = await read($, live)
  if (p.model !== cur.model) {
    try {
      const r = await runInjected($, 'model', p.model)
      const text = r.text ?? ''
      if (!/Set model to|Kept model as/.test(text)) $.ui.toast(text.slice(0, 160) || `ClauDiscobombulating: /model ${p.model} failed`)
      await note($, `/model ${p.model} → ${text.slice(0, 90)}`)
    } catch (err) {
      $.ui.toast(`ClauDiscobombulating: /model ${p.model} failed`)
      await note($, `/model failed ${String(err)}`)
    }
    const model = await $.session.model()
    const flagged = ((await $.settings.read({ source: 'flag' })) as SavedSettings).effortLevel
    const effort = isLevel(flagged) ? flagged : await savedEffort($, model)
    await update($, live, l => ({ ...l, model, effort: effort || l.effort }))
  }
  await update($, pending, q => (q.model === p.model ? { ...q, model: '' } : q))
}

async function applyEffort($: EngineInterface) {
  const p = await read($, pending)
  if (!p.effort) return
  const cur = await read($, live)
  if (p.effort !== cur.effort) {
    try {
      const r = await runInjected($, 'effort', p.effort)
      const text = r.text ?? ''
      const isRefused = REFUSED.test(text)
      const level = parseEffort(text) ?? (isRefused ? undefined : p.effort)
      if (level) await update($, live, l => ({ ...l, effort: level }))
      else $.ui.toast(text.slice(0, 160))
      await note($, `/effort ${p.effort} → ${text.slice(0, 90)}`)
    } catch (err) {
      $.ui.toast(`ClauDiscobombulating: /effort ${p.effort} failed`)
      await note($, `/effort failed ${String(err)}`)
    }
  }
  await update($, pending, q => (q.effort === p.effort ? { ...q, effort: '' } : q))
}

async function pick($: EngineInterface, zone: 'model' | 'effort', dir: number) {
  const cur = await read($, live)
  const p = await read($, pending)
  const model = p.model || cur.model
  if (zone === 'model') {
    const i = modelIndex(model)
    const target = MODELS[wrap(i < 0 ? (dir > 0 ? 0 : -1) : i + dir, MODELS.length)].id
    await update($, pending, q => ({ ...q, model: target }))
    modelTimer?.cancel()
    modelTimer = $.clock.after(APPLY_MS, () => void applyModel($))
    return
  }
  const i = EFFORTS.indexOf(p.effort || cur.effort)
  const target = EFFORTS[wrap(i < 0 ? 2 : i + dir, EFFORTS.length)]
  await update($, pending, q => ({ ...q, effort: target }))
  effortTimer?.cancel()
  effortTimer = $.clock.after(APPLY_MS, () => void applyEffort($))
}

function parseEffort(text: string) {
  const m = /set to '(\w+)' instead/.exec(text) ?? /(?:Set effort level to|Current effort level:|currently) (\w+)/.exec(text)
  const level = m?.[1]
  return isLevel(level) ? level : undefined
}

async function runInjected($: EngineInterface, command: string, args?: string) {
  injected += 1
  try {
    return await $.command.run({ command, args })
  } finally {
    injected -= 1
  }
}

const onCommand: Hook<'command.run'> = async ($, e, next) => {
  if (!isFull) return next(e)
  const r = await next(e)
  if (injected > 0) return r
  const text = r.text ?? ''
  if (e.command === 'effort') {
    const level = parseEffort(text) ?? (isLevel(e.args) && !REFUSED.test(text) ? e.args : undefined)
    if (level) await update($, live, l => ({ ...l, effort: level }))
  } else {
    const model = await $.session.model()
    await update($, live, l => ({ ...l, model }))
  }
  await note($, `typed /${e.command} ${e.args} → ${text.slice(0, 90)}`)
  return r
}

// the desktop app drives the CLI headless: session.start says surface null, the app shows up later as an attach — 2026-10-06
let pluginVersion = '?'
let pluginRepo = 'Niedvin/ClauDiscobombulating'
async function loadVersion($: EngineInterface) {
  for (const p of [`${$.plugin.root}/.claude-plugin/plugin.json`, `${$.plugin.root}/plugin.json`]) {
    try {
      const m = JSON.parse(await $.fs.read(p)) as { version?: unknown; repository?: unknown }
      if (typeof m.repository === 'string') pluginRepo = m.repository
      if (typeof m.version === 'string') {
        pluginVersion = m.version
        return
      }
    } catch {}
  }
}

function newerThan(a: string, b: string) {
  const x = a.split('.').map(Number)
  const y = b.split('.').map(Number)
  for (let i = 0; i < Math.max(x.length, y.length); i++) {
    if ((x[i] ?? 0) !== (y[i] ?? 0)) return (x[i] ?? 0) > (y[i] ?? 0)
  }
  return false
}

async function checkVersion($: EngineInterface) {
  const repo = pluginRepo.replace(/^https?:\/\/github\.com\//, '').replace(/\.git$/, '')
  if (!repo.includes('/')) return
  const r = await $.http.fetch(`https://raw.githubusercontent.com/${repo}/main/plugin/.claude-plugin/plugin.json`)
  if (!r.ok) return
  const m = JSON.parse(r.text) as { version?: unknown }
  if (typeof m.version === 'string' && newerThan(m.version, pluginVersion)) {
    latestSeen = m.version
    await update($, latest, () => m.version)
  }
}

async function doUpdate($: EngineInterface) {
  try {
    const v = await read($, latest)
    const args = ['plugin', 'update', `${PANE}@${PANE}`, '--scope', 'user']
    const os = await $.env.get('OS').catch(() => undefined)
    const argv = os === 'Windows_NT' ? ['cmd.exe', '/c', `claude ${args.join(' ')}`] : ['claude', ...args]
    await $.process.run(argv, { timeoutMs: 180000 })
    latestSeen = ''
    await update($, latest, () => '')
    $.ui.toast(tr.updateDone(v))
  } catch (err) {
    $.ui.toast(tr.updateFailed)
    await note($, `update failed ${String(err)}`)
  }
}

let countOn = false
let ctxKnown = 0
let ctxStepIn = -1
let ctxPolled = -1
let ctxStreamed = 0
let ctxPending = 0
let shownN = 0
let shownPrev = 0
let isFraming = false
let countTimer: Timer | undefined

const ctxTarget = () => ctxKnown + Math.round(ctxStreamed + ctxPending)

const countGoal = () => (isBusy ? Math.max(ctxTarget(), shownN) : ctxTarget())

function estTokens(s: string) {
  let n = 0
  for (let i = 0; i < s.length; i++) n += s.charCodeAt(i) < 128 ? 0.25 : 0.5
  return n
}

// `sent` = the pending rows this request carried: its usage counts them, later rows stay pending — 2026-10-11
function countChunk(c: TurnStepChunk, sent: number) {
  if (c.kind === 'text' || c.kind === 'thinking') ctxStreamed += estTokens(c.text)
  else if (c.kind === 'input') ctxStreamed += estTokens(c.json)
  else if (c.kind === 'stop' && c.usage) {
    ctxStepIn = c.usage.input_tokens + c.usage.cache_read_input_tokens + c.usage.cache_creation_input_tokens
    ctxKnown = ctxStepIn + c.usage.output_tokens
    ctxStreamed = 0
    ctxPending = Math.max(0, ctxPending - sent)
  }
}

// an image costs ≈1600 tokens at the API's usual downscale — 2026-10-11
function blockTokens(b: unknown): number {
  const x = (b ?? {}) as { type?: unknown; text?: unknown; content?: unknown }
  if (x.type === 'text' && typeof x.text === 'string') return estTokens(x.text)
  if (x.type === 'image') return 1600
  if (x.type !== 'tool_result') return 0
  if (typeof x.content === 'string') return estTokens(x.content)
  return Array.isArray(x.content) ? x.content.reduce((n: number, y) => n + blockTokens(y), 0) : 0
}

function measured(tokens: number) {
  if (tokens === ctxPolled) return
  ctxPolled = tokens
  // usage() counts input only: the stop chunk already gave this request with its output — 2026-10-11
  if (tokens === ctxStepIn) return
  ctxKnown = tokens
  ctxStreamed = 0
  ctxPending = 0
}

function kickCount($: EngineInterface) {
  if (countOn && !countTimer && (shownN !== countGoal() || shownPrev !== shownN)) countTimer = $.clock.every(COUNT_FRAME_MS, () => void countFrame($))
}

async function countFrame($: EngineInterface) {
  if (isFraming) return
  const to = countGoal()
  if (!countOn || (shownN === to && shownPrev === to)) {
    countTimer?.cancel()
    countTimer = undefined
    return
  }
  isFraming = true
  try {
    shownPrev = shownN
    // a sixth of the gap a frame: a 20k jump rolls ≈2.5 s instead of snapping — 2026-10-11
    if (shownN !== to) shownN += Math.sign(to - shownN) * Math.max(1, Math.ceil(Math.abs(to - shownN) / 6))
    const next = { n: shownN, prev: shownPrev }
    await update($, counted, () => next)
  } finally {
    isFraming = false
  }
}

async function toggleCount($: EngineInterface) {
  countOn = !(await read($, countMode))
  await update($, countMode, () => countOn)
  await $.store.set('countMode', countOn).catch(() => undefined)
  shownN = shownPrev = 0
  if (countOn) await update($, counted, () => ({ n: 0, prev: 0 }))
  kickCount($)
}

let danceTimer: Timer | undefined
let isBlitting = false
let stage: { columns: number; rows: number; head?: Head } = { columns: 0, rows: 0 }

async function startDance($: EngineInterface) {
  if ((await read($, dance)) > 0) return
  const at = await $.clock.now()
  await update($, reveal, () => 0)
  await update($, dance, () => at)
  runDance($, at)
}

function runDance($: EngineInterface, at: number) {
  danceTimer?.cancel()
  danceTimer = $.clock.every(DANCE_FRAME_MS, () => void danceFrame($, at))
}

async function danceFrame($: EngineInterface, at: number) {
  const t = (await $.clock.now()) - at
  if (t >= DANCE_MS + REVEAL_MS) {
    danceTimer?.cancel()
    danceTimer = undefined
    await update($, reveal, () => 1)
    await update($, dance, d => (d === at ? 0 : d))
    return
  }
  if (t >= DANCE_MS) {
    const k = Math.max(0.02, Math.round(((t - DANCE_MS) / REVEAL_MS) * 50) / 50)
    await update($, reveal, () => k)
    return
  }
  if (isBlitting || !stage.rows) return
  isBlitting = true
  try {
    await $.ui.blit({ requestId: PANE, key: 'dance', cells: danceCells(stage.columns, stage.rows, t / 1000, tr.boom, stage.head) })
  } catch {
  } finally {
    isBlitting = false
  }
}

const FG_RGB = 0xcccccc
const DIM_RGB = 0x767676
const NAMED_RGB: Record<string, number> = { black: 0x000000, gray: 0x808080, grey: 0x808080, white: 0xffffff }
const rgbOf = (c: unknown, fallback: number) => (typeof c === 'string' ? (/^#[0-9a-f]{6}$/i.test(c) ? parseInt(c.slice(1), 16) : NAMED_RGB[c] ?? fallback) : fallback)
const scaled = (c: number, k: number) => `#${[16, 8, 0].map(s => Math.round(((c >> s) & 255) * k).toString(16).padStart(2, '0')).join('')}`

// fade-in after the dance: every colour scaled by k; Input takes no colour, so a Text stands in — 2026-10-11
function fadeTree(node: unknown, k: number, inherit: number, text: (s: string, color: string) => unknown): unknown {
  if (Array.isArray(node)) return node.map(n => fadeTree(n, k, inherit, text))
  if (!node || typeof node !== 'object') return node
  const el = node as { type: string; props?: Record<string, unknown>; children?: unknown }
  const props = { ...(el.props ?? {}) }
  let own = inherit
  if (el.type === 'Input') return text(String(props.value || props.placeholder || ''), scaled(FG_RGB, k))
  if (el.type === 'Box') {
    if (props.borderStyle) props.borderColor = scaled(rgbOf(props.borderColor, FG_RGB), k)
    if (props.backgroundColor) props.backgroundColor = scaled(rgbOf(props.backgroundColor, 0), k)
  } else if (el.type === 'Text') {
    own = rgbOf(props.color, inherit)
    if (props.dimColor) own = parseInt(scaled(own, 0.6).slice(1), 16)
    props.color = scaled(own, k)
    delete props.dimColor
  } else if (el.type === 'Button') {
    own = props.dimColor ? DIM_RGB : FG_RGB
    delete props.dimColor
    const isBare = el.children === undefined || (Array.isArray(el.children) && el.children.length === 0)
    if (isBare && typeof props.label === 'string') return { ...el, props, children: [text(props.label, scaled(own, k))] }
  }
  const out: Record<string, unknown> = { ...el, props }
  if (el.children !== undefined) out.children = fadeTree(el.children, k, own, text)
  return out
}

// pane:* runs in the engine only with 2+ panes; chat:*Effort is listed but has no engine handler — 2026-10-14
const MODEL_NEXT = 'pane:next'
const MODEL_PREV = 'pane:previous'
const EFFORT_UP = 'chat:increaseEffort'
const EFFORT_DOWN = 'chat:decreaseEffort'

// ctrl+letter reaches the engine as a control code on any layout; alt+letter matches only under a Latin one — 2026-10-14
const DEFAULT_BINDS: Record<string, string> = {
  'ctrl+q': MODEL_NEXT,
  'ctrl+e': EFFORT_UP,
  'alt+m': MODEL_NEXT,
  'alt+shift+m': MODEL_PREV,
  'alt+e': EFFORT_UP,
  'alt+shift+e': EFFORT_DOWN,
}

const configDir = async ($: EngineInterface) => (await $.env.get('CLAUDE_CONFIG_DIR').catch(() => undefined)) || `${await homeDir($)}/.claude`

type Keybindings = { bindings?: { context?: string; bindings?: Record<string, unknown> }[] }

// once per install: a person who later removes or rebinds these keeps their choice — 2026-10-14
async function seedBindings($: EngineInterface) {
  if ((await $.store.get('bindsSeeded').catch(() => undefined)) === true) return
  const dir = await configDir($)
  const path = `${dir}/keybindings.json`
  const had = await $.fs.exists(path)
  const old = had ? await $.fs.read(path) : ''
  const kb = (had ? JSON.parse(old) : { $schema: 'https://www.schemastore.org/claude-code-keybindings.json', bindings: [] }) as Keybindings
  if (!Array.isArray(kb.bindings)) return
  const all = kb.bindings.flatMap(b => Object.entries(b.bindings ?? {}))
  const actions = new Set(all.map(([, a]) => a))
  const keys = new Set(all.map(([k]) => k.toLowerCase()))
  const add = Object.entries(DEFAULT_BINDS).filter(([k]) => !keys.has(k))
  if (add.length > 0 && !actions.has(MODEL_NEXT) && !actions.has(EFFORT_UP)) {
    if (had) {
      const backup = `${dir}/.backups/keybindings.json.${Date.now()}`
      await $.fs.write(backup, old)
      if ((await $.fs.read(backup)) !== old) return
    }
    let global = kb.bindings.find(b => b.context === 'Global')
    if (!global) {
      global = { context: 'Global', bindings: {} }
      kb.bindings.push(global)
    }
    global.bindings = { ...(global.bindings ?? {}), ...Object.fromEntries(add) }
    await $.fs.write(path, `${JSON.stringify(kb, null, 2)}
`)
    await note($, `keybindings: added ${add.map(([k]) => k).join(', ')}`)
  }
  await $.store.set('bindsSeeded', true)
}

let modelChord = ''
let effortChord = ''
async function loadChord($: EngineInterface) {
  const dir = await configDir($)
  const kb = JSON.parse(await $.fs.read(`${dir}/keybindings.json`)) as { bindings?: { bindings?: Record<string, unknown> }[] }
  const chordOf = (action: string) => {
    for (const block of kb.bindings ?? []) {
      const hit = Object.entries(block.bindings ?? {}).find(([, a]) => a === action)
      if (hit) return hit[0]
    }
    return ''
  }
  modelChord = chordOf(MODEL_NEXT)
  effortChord = chordOf(EFFORT_UP)
}

// /resume and /clear go on under a new session id with fresh atoms: the mod's own truth is written back each tick — 2026-10-14
async function resync($: EngineInterface) {
  if (isFull && !(await read($, full))) await update($, full, () => true)
  if (countOn !== (await read($, countMode))) await update($, countMode, () => countOn)
  if (latestSeen !== (await read($, latest))) await update($, latest, () => latestSeen)
  if (compactedKey && compactedKey !== (await read($, compactedFor))) await update($, compactedFor, () => compactedKey)
}

async function enableFull($: EngineInterface, why: string) {
  if (isFull) return
  isFull = true
  await seedBindings($).catch(err => note($, `keybindings seed failed ${String(err)}`))
  await loadChord($).catch(() => undefined)
  await update($, full, () => true)
  await loadVersion($).catch(() => undefined)
  void checkVersion($).catch(() => undefined)
  await $.command.register({ name: 'ClauDiscobombulating', description: 'Open the model and effort pane' })
  const opened = await openPane($, why)
  growTries = 0
  if (!opened.isPlaced) void fitPane($)
  for (const m of MODELS) {
    const v = await $.store.get(`label:${m.family}`).catch(() => undefined)
    if (typeof v === 'string') labels[m.family] = v
  }
  await poll($)
  await $.tool.register({
    name: 'probe',
    description: 'ClauDiscobombulating diagnostics: model and effort as the engine and the app hold them, render metrics, recent events.',
    inputSchema: { type: 'object', properties: {} },
  })
}

export const register: Register = on => {
  let metrics: Record<string, unknown> = {}
  let paneRows = { timer: [-1, -1], model: [-1, -1], effort: [-1, -1] }
  let paneWidth = PANE_COLS
  let lastWheel = 0

  on('session.start', async ($, e, next) => {
    const r = await next(e)
    await applyLang($).catch(err => note($, `lang failed ${String(err)}`))
    // subagents die with the process: anything the store kept is a ghost — 2026-10-15
    await update($, agents, () => ({})).catch(() => undefined)
    pollEvery?.cancel()
    pollEvery = $.clock.every(1000, () => void poll($))
    try {
      const u = await $.session.usage()
      if (u.rateLimits.length > 0) await update($, limits, () => u.rateLimits.map(l => ({ ...l })))
      await poll($)
      const p = await read($, pending)
      // a reload inside the pick debounce leaves pending set: re-arm the apply — 2026-10-06
      if (p.model) modelTimer = $.clock.after(APPLY_MS, () => void applyModel($))
      if (p.effort) effortTimer = $.clock.after(APPLY_MS, () => void applyEffort($))
      countOn = (await $.store.get('countMode').catch(() => undefined)) === true
      await update($, countMode, () => countOn)
      const dancing = await read($, dance)
      if (dancing > 0) {
        if ((await $.clock.now()) - dancing < DANCE_MS + REVEAL_MS) runDance($, dancing)
        else {
          await update($, reveal, () => 1)
          await update($, dance, () => 0)
        }
      }
      const seen = e.surface ? [e.surface] : await $.session.surfaces().catch(() => [])
      const other = seen.find(x => x !== 'desktop')
      if (other) await enableFull($, `start surface=${other}`)
    } catch (err) {
      await note($, `start failed ${String(err)}`)
    }
    return r
  })

  on('session.attach', async ($, e, next) => {
    const r = await next(e)
    if (e.surface === 'desktop') {
      isFull = false
      await update($, full, () => false)
    } else await enableFull($, `attach surface=${e.surface}`).catch(err => note($, `attach failed ${String(err)}`))
    return r
  })

  on('classic.SessionStart', async ($, e, next) => {
    if (e.source !== 'compact') isCompacted = false
    const secs = e.seconds_since_last_response
    if (typeof secs === 'number') {
      try {
        lastActive = (await $.clock.now()) - secs * 1000
        await update($, activeAt, () => lastActive)
      } catch {}
    }
    return next(e)
  })

  on('session.measure', async ($, e, next) => {
    const ls = e.rateLimits.map(l => ({ ...l }))
    if (ls.length > 0) {
      await update($, limits, () => ls)
      await shareLimits($, ls).catch(() => undefined)
    }
    return next(e)
  })

  on('session.compact', async ($, e, next) => {
    const r = await next(e)
    // only a real main-transcript compaction counts: not precompute, not a subagent, not a skip — 2026-10-06
    if (e.trigger !== 'precompute' && !e.agentId && !r?.skip) {
      try {
        const doneAt = await $.clock.now()
        await update($, compactedAt, () => doneAt)
        await update($, sinceCompact, () => 0)
        isCompacted = true
        lastActive = doneAt
        await update($, activeAt, () => doneAt)
      } catch {}
    }
    return r
  })

  on('turn.start', async ($, e, next) => {
    // a subagent raises turn.complete (no turn.start): guard main-loop state — 2026-10-06
    if (e.agentId) return next(e)
    isBusy = true
    turnId = e.turnId
    lastActive = await $.clock.now()
    await update($, activeAt, () => lastActive)
    return next(e)
  })

  on('agent.spawn', async ($, e, next) => {
    const r = await next(e)
    if (r?.agentId) {
      try {
        await update($, agents, a => ({ ...a, [r.agentId!]: { model: r.model, effort: '', line: `✧ ${tr.subStart}` } }))
      } catch {}
    }
    return r
  })

  on('turn.complete', async ($, e, next) => {
    if (e.agentId) {
      await dropAgent($, e.agentId)
      return next(e)
    }
    isBusy = false
    kickCount($)
    lastActive = await $.clock.now()
    await update($, activeAt, () => lastActive)
    await countSinceCompact($)
    return next(e)
  })

  on('turn.step', async function* ($, e, next) {
    if (isFull && !e.agentId && isLevel(e.effort)) {
      const p = await read($, pending)
      const cur = await read($, live)
      const effort = e.effort
      if (!p.effort && cur.effort !== effort) await update($, live, l => ({ ...l, effort }))
    }
    if (e.agentId) {
      const id = e.agentId
      if (!(await adoptAgent($, id))) return yield* next(e)
      const effort = isLevel(e.effort) ? e.effort : typeof e.effort === 'number' ? String(e.effort) : ''
      await patchAgent($, id, { model: e.model, effort, line: `✧ ${tr.subThink}` })
      const stream = next(e)
      let shown = ''
      for await (const c of stream) {
        try {
          const want = c.kind === 'text' ? `✎ ${tr.subWrite}` : c.kind === 'tool' ? `⚙ ${c.name} …` : ''
          if (want && want !== shown) {
            shown = want
            await patchAgent($, id, { line: want })
          }
        } catch {}
        yield c
      }
      return await stream.result
    }
    if (!isFull || !countOn) return yield* next(e)
    const stream = next(e)
    const sent = ctxPending
    for await (const c of stream) {
      // a hook that throws mid-stream is left where it stood, and the turn with it — 2026-10-11
      try {
        countChunk(c, sent)
        kickCount($)
      } catch {}
      yield c
    }
    return await stream.result
  })

  // rows enter the context the moment they are appended; the reply's own rows are counted from its stream — 2026-10-11
  on('session.append', async ($, e, next) => {
    const r = await next(e)
    if (isFull && countOn && !e.agentId && (e.message.role ?? e.message.type) === 'user' && e.door !== 'compaction') {
      try {
        ctxPending += e.message.content.reduce((n: number, b) => n + blockTokens(b), 0)
        kickCount($)
      } catch {}
    }
    return r
  })

  on('command.run', { command: 'effort' }, onCommand)
  on('command.run', { command: 'model' }, onCommand)

  on('tool.call', { tool: 'mcp__ClauDiscobombulating__probe' }, async $ => {
    try {
      const merged = (await $.settings.read()) as { effortLevel?: unknown; model?: unknown }
      const fromApp = (await $.settings.read({ source: 'flag' })) as { effortLevel?: unknown; model?: unknown }
      const commands = (await $.command.list()).map(c => c.name).filter(n => /^(model|effort)$/.test(n))
      const data = {
        version: 3,
        model: await $.session.model(),
        settings: { merged: { effortLevel: merged.effortLevel, model: merged.model }, flag: { effortLevel: fromApp.effortLevel } },
        live: await read($, live),
        pending: await read($, pending),
        flag: await read($, flag),
        surfaces: await $.session.surfaces(),
        commands,
        metrics,
        paneRows,
        agents: await read($, agents),
        log: await read($, log),
        limits: await read($, limits),
        context: await read($, context),
        cacheLeft: await read($, cacheLeft),
        usage: await $.session.usage().catch(err => String(err)),
        full: isFull,
      }
      return { result: JSON.stringify(data, null, 1) }
    } catch (err) {
      return { result: `probe failed: ${String(err)}` }
    }
  })

  on('tool.call', async ($, e, next) => {
    const id = e.agentId
    if (!id || !(await read($, agents))[id]) return next(e)
    const hint = toolHint(e as unknown as Record<string, unknown>)
    const line = `⚙ ${e.tool}${hint ? ` ${hint}` : ''}`
    await patchAgent($, id, { line }).catch(() => undefined)
    const r = await next(e)
    try {
      if ((await read($, agents))[id]?.line === line) await patchAgent($, id, { line: `✧ ${tr.subThink}` })
    } catch {}
    return r
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    if (e.props.hasSurvey || e.props.view.agentId) return next(e)
    if (e.surface === 'desktop') {
      const ls = await read($, limits)
      const cache = await read($, cacheLeft)
      const ctxTokens = (await read($, context)).tokens
      if (ls.length === 0 && cache < 0) return next(e)
      // desktop footer slot is ≈220 px and clips, so everything sits in this band; Svg drew nothing in the footer — 2026-10-06
      const { Box, Button, Text } = $.ui.resolve(e)
      const now = Date.now()
      const fill = '#262626'
      const pill = (key: string, kids: unknown[]) => (
        <Box key={key} flexDirection="row" alignItems="center" gap={1} paddingX={1} backgroundColor={fill}>
          {kids}
        </Box>
      )
      return (
        <Box flexDirection="row" alignItems="center" justifyContent="space-between" width={e.props.bodyColumns}>
          <Box flexDirection="row" alignItems="center" gap={2}>
            {ls.slice(0, 2).map(l => {
              const c = tone(l.percentUsed)
              const n = Math.round(Math.min(l.percentUsed, 100) / 10)
              return pill(l.kind, [
                <Text key="n" dimColor>{shortName(l.kind)}</Text>,
                <Text key="b">
                  <Text color={c}>{'━'.repeat(n)}</Text>
                  <Text color="gray">{'─'.repeat(10 - n)}</Text>
                </Text>,
                <Text key="p" bold color={c}>{Math.round(l.percentUsed)}%</Text>,
                l.resetsAt ? <Text key="r" dimColor>↻ {resetIn(l.resetsAt, now)}</Text> : null,
              ])
            })}
            <Button key="compact" label="⇊ Compact" onPress={() => compact($)} />
          </Box>
          {showsCache(cache, e.surface)
            ? pill('cache', [
                <Text key="t" bold={cache <= 0} color={cacheColor(cache)}>
                  {cacheText(cache, ctxTokens)}
                </Text>,
              ])
            : null}
        </Box>
      )
    }
    if (!(await read($, full))) return next(e)
    metrics = { surface: e.surface, bodyColumns: e.props.bodyColumns, maxRows: e.props.maxRows, viewport: e.viewport ?? null }
    if (e.viewport) view = { columns: e.viewport.columns, rows: e.viewport.rows }
    const cur = await read($, live)
    const p = await read($, pending)
    const model = p.model || cur.model
    const effort = p.effort || cur.effort
    const ctx = await read($, context)
    const label = ctxLabel(ctx)
    const up = await read($, paneUp)
    if (up && !label) return next(e)
    const { Box, Button, Text } = $.ui.resolve(e)
    const i = modelIndex(model)
    const hue = MODELS[i]?.hue ?? 'gray'
    const f = EFFORTS.indexOf(effort)
    const effortColor = f >= 0 ? EFFORT_COLORS[f] : 'gray'
    let counter: RenderElement | null = null
    if (label && (await read($, countMode))) {
      const { n, prev } = await read($, counted)
      const now = grouped(n)
      const was = grouped(prev).padStart(now.length).slice(-now.length)
      const runs: { text: string; isHot: boolean }[] = []
      for (let k = 0; k < now.length; k++) {
        const ch = now.charAt(k)
        const isHot = ch !== was.charAt(k)
        const last = runs[runs.length - 1]
        if (last && last.isHot === isHot) last.text += ch
        else runs.push({ text: ch, isHot })
      }
      counter = (
        <Button key="ctx" plain onPress={() => toggleCount($)}>
          {runs.map((r, k) => (
            <Text key={`d${k}`} bold={r.isHot} color={ctxColor(n, r.isHot ? 0.6 : 0)}>
              {r.text}
            </Text>
          ))}
          <Text dimColor>{` / ${kTok(ctx.window)}`}</Text>
        </Button>
      )
    } else if (label) counter = <Button key="ctx" plain dimColor label={label} onPress={() => toggleCount($)} />
    return (
      <Box flexDirection="row" justifyContent="flex-end" alignItems="center" gap={1} width={e.props.bodyColumns}>
        {counter}
        {up ? null : (
          <Box key="pick" flexDirection="row" alignItems="center" gap={1}>
            <Button key="to-pane" plain dimColor label={tr.toPane} onPress={() => openPane($, 'button')} />
            <Box flexDirection="row" alignItems="center" gap={1} borderStyle="round" borderColor={hue} paddingX={1}>
              <Button key="m-prev" plain dimColor label="◀" action={MODEL_PREV} onPress={() => pick($, 'model', -1)} />
              <Text bold color={hue}>
                {modelLabel(model)}
                {p.model ? ' •' : ''}
              </Text>
              <Button key="m-next" plain dimColor label="▶" action={MODEL_NEXT} onPress={() => pick($, 'model', 1)} />
              {modelChord ? <Text key="chord" dimColor>{modelChord}</Text> : null}
            </Box>
            <Box flexDirection="row" alignItems="center" gap={1} borderStyle="round" borderColor={effortColor} paddingX={1}>
              <Button key="e-prev" plain dimColor label="◀" action={EFFORT_DOWN} onPress={() => pick($, 'effort', -1)} />
              <Text bold color={effortColor}>
                {effort || 'auto'}
                {p.effort ? ' •' : ''}
              </Text>
              <Text>
                {EFFORTS.map((lv, k) => (
                  <Text key={lv} color={f >= 0 && k <= f ? EFFORT_COLORS[k] : 'gray'}>{'▁▃▄▆█'[k]}</Text>
                ))}
              </Text>
              <Button key="e-next" plain dimColor label="▶" action={EFFORT_UP} onPress={() => pick($, 'effort', 1)} />
              {effortChord ? <Text key="chord" dimColor>{effortChord}</Text> : null}
            </Box>
          </Box>
        )}
      </Box>
    )
  })

  on('ui.render', { component: 'PromptHint' }, async ($, e, next) => {
    if (e.surface !== 'desktop') return next(e)
    const label = ctxLabel(await read($, context))
    if (!label) return next(e)
    const { Text } = $.ui.resolve(e)
    return <Text dimColor>{`${e.props.hint}${e.props.hint ? '  ·  ' : ''}${label}`}</Text>
  })

  on('command.run', { command: 'ClauDiscobombulating' }, async $ => {
    const opened = await $.ui.open({ id: PANE, title: 'ClauDiscobombulating', columns: PANE_COLS })
    return { text: opened.isPlaced ? tr.paneOpen : tr.paneWaits }
  })

  on('ui.scroll', { component: 'Pane', requestId: PANE }, async ($, e, next) => {
    // pointer rows count from the window's first row, the zones from the tree's — 2026-10-11
    const row = e.pointer?.row === undefined ? undefined : e.pointer.row + e.offset
    if (row === undefined || e.origin.kind !== 'person') return next(e)
    const zone = within(row, paneRows.model) ? 'model' : within(row, paneRows.effort) ? 'effort' : within(row, paneRows.timer) ? 'timer' : ''
    if (!zone) return next(e)
    const dir = e.by < 0 ? 1 : -1
    // one wheel notch arrives as several events on Windows (3 lines per notch) — 2026-10-02
    const now = Date.now()
    if (now - lastWheel < WHEEL_GAP_MS) return next(e)
    lastWheel = now
    if (zone === 'model') await pick($, 'model', dir).catch(() => undefined)
    else if (zone === 'effort') await pick($, 'effort', dir).catch(() => undefined)
    else {
      const col = e.pointer?.column ?? 0
      if ((await read($, timer).catch(() => ({ at: 0 }))).at) return next(e)
      await nudgeDraft($, col < paneWidth / 2 ? 'h' : 'm', dir).catch(() => undefined)
    }
    return {}
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const { Box, Button, Input, Text } = $.ui.resolve(e)
    const width = Math.max(18, e.props.bodyColumns)
    const latestV = await read($, latest)
    const hasUpdate = !!latestV && newerThan(latestV, pluginVersion)
    const headRows = hasUpdate ? 4 : 3
    const name = [...$.plugin.name]
    const hues = glow(name.length)
    const banner = (
      <Box flexDirection="column" alignItems="center" borderStyle="round" borderColor={hues[0]} width={width}>
        <Button key="name" plain onPress={() => startDance($)}>
          {name.map((ch, k) => (
            <Text key={`n${k}`} bold color={hues[k]}>
              {ch}
            </Text>
          ))}
          <Text dimColor>{`  v${pluginVersion}`}</Text>
        </Button>
        {hasUpdate ? (
          <Button key="update" plain onPress={() => doUpdate($)}>
            <Text color="#f0b429">{`✦ ${tr.updateAvail} v${latestV}`}</Text>
          </Button>
        ) : null}
      </Box>
    )
    const danceAt = await read($, dance)
    const fadeK = await read($, reveal)
    const danceMs = danceAt > 0 ? (await $.clock.now()) - danceAt : DANCE_MS
    if (danceMs < DANCE_MS && e.surface === 'terminal') {
      const { Raster } = $.ui.resolve(e)
      // no taller than the visible body: a taller tree scrolls a row mid-dance and strands a blitted row — 2026-10-11
      const rows = headRows + Math.max(STAGE_MIN_ROWS, Math.min(e.props.scroll.bodyRows - headRows - 1, e.props.placement === 'dock' ? 60 : 20))
      const toRgb = (h: string | undefined) => parseInt((h ?? '#cccccc').slice(1), 16)
      const head: Head = { name: name.join(''), colors: hues.map(toRgb), tail: `  v${pluginVersion}`, update: hasUpdate ? `✦ ${tr.updateAvail} v${latestV}` : '', border: toRgb(hues[0]) }
      stage = { columns: width, rows, head }
      paneRows = { timer: [-1, -1], model: [-1, -1], effort: [-1, -1] }
      const cells = danceCells(width, rows, Math.max(0, danceMs) / 1000, tr.boom, head)
      return (
        <Box flexDirection="column" width={width} height={rows} backgroundColor="black">
          <Raster key="dance" columns={width} rows={rows} cells={cells} />
        </Box>
      )
    }
    const cur = await read($, live)
    const p = await read($, pending)
    const agentV = await read($, agents)
    const agentList = Object.entries(agentV)
    const model = p.model || cur.model
    const effort = p.effort || cur.effort
    const i = modelIndex(model)
    const hue = MODELS[i]?.hue ?? 'gray'
    const f = EFFORTS.indexOf(effort)
    const effortColor = f >= 0 ? EFFORT_COLORS[f] : 'gray'
    const alarm = await read($, timer)
    const d = await shownDraft($)
    const isArmed = alarm.at > 0
    const at = isArmed ? new Date(alarm.at) : undefined
    const hh = at ? at.getHours() : d.h
    const mm = at ? at.getMinutes() : d.m
    const isWide = width >= PANE_COLS
    const cardW = isWide ? Math.floor((width - 2) / 3) : width
    const fireAt = isArmed ? alarm.at : nextAt(d.h, d.m, Date.now())
    // read only so the countdown redraws each minute — 2026-10-11
    await read($, minute)
    const cardRows = isWide ? 3 : 9
    const gap = e.props.scroll.bodyRows >= headRows + TIMER_ROWS + cardRows + 6 + 3 ? 1 : 0
    const timerAt = headRows + gap
    const modelAt = timerAt + TIMER_ROWS + gap + cardRows + gap
    paneRows = { timer: [timerAt + 1, timerAt + 3], model: [modelAt, modelAt + 2], effort: [modelAt + 3, modelAt + 5] }
    paneWidth = width
    // a child cannot paint on its own border (clipped to the inside), so titles are later siblings — 2026-10-11
    const framed = (key: string, text: string, box: unknown, foot?: unknown) => (
      <Box key={key} flexDirection="column" width={width}>
        {box}
        <Box position="absolute" top={0} left={2}>
          <Text color="#9a9aab">{` ${text} `}</Text>
        </Box>
        {foot ? (
          <Box position="absolute" bottom={0} right={2}>
            {foot}
          </Box>
        ) : null}
      </Box>
    )
    const card = (key: string, label: string, color: string, onPress: () => unknown) => (
      <Box key={`card-${key}`} width={cardW} justifyContent="center" borderStyle="round" borderColor={color}>
        <Button key={key} plain onPress={onPress}>
          <Text color={color}>{label}</Text>
        </Button>
      </Box>
    )
    const subRows = agentList.length ? agentList.length * 3 + 1 : 0
    const tree = (
      <Box flexDirection="column" width={width} height={Math.max(e.props.scroll.bodyRows, modelAt + 6 + (agentList.length ? gap + subRows : 0))} backgroundColor="black">
        {banner}
        {gap ? <Box height={1} /> : null}
        {framed(
          'timer',
          tr.timer,
          <Box flexDirection="column" borderStyle="round" borderColor={isArmed ? '#f0b429' : '#6c6c7c'} paddingX={1} width={width}>
            <Box height={1} />
            <Box flexDirection="row" justifyContent="center">
              {isArmed ? (
                <Text bold color="#f0b429">{`⏰ ${two(hh)} : ${two(mm)}`}</Text>
              ) : (
                <Box flexDirection="row">
                  <Text>{'⏰ '}</Text>
                  <Button key="t-h" plain onPress={() => nudgeDraft($, 'h', 1)}>
                    <Text bold color="#ececf1">{two(hh)}</Text>
                  </Button>
                  <Text dimColor>{' : '}</Text>
                  <Button key="t-m" plain onPress={() => nudgeDraft($, 'm', 1)}>
                    <Text bold color="#ececf1">{two(mm)}</Text>
                  </Button>
                </Box>
              )}
            </Box>
            <Box flexDirection="row" justifyContent="center">
              <Text dimColor>{`${tr.via} ${inFor(fireAt - Date.now())}`}</Text>
            </Box>
            <Box height={1} />
            <Box flexDirection="row" borderStyle="round" borderColor={isArmed ? '#3a3a48' : '#9a9aab'} backgroundColor="#1c1c24" paddingX={1}>
              <Text color="#9a9aab">{'✎ '}</Text>
              {isArmed ? (
                <Text color="#9a9aab" wrap="truncate-end">{alarm.text}</Text>
              ) : (
                <Input key="timer-text" placeholder={tr.placeholder} submitLabel="" value={alarm.text} onInput={v => update($, timer, t => ({ ...t, text: v }))} onSubmit={async v => { await update($, timer, t => ({ ...t, text: v || t.text })); await armTimer($) }} />
              )}
            </Box>
            <Box justifyContent="center" borderStyle="round" borderColor={isArmed ? '#6c6c7c' : '#3fbf8f'}>
              {isArmed ? (
                <Button key="timer-cancel" plain onPress={() => update($, timer, t => ({ ...t, at: 0 }))}>
                  <Text color="#9a9aab">{tr.cancelBtn}</Text>
                </Button>
              ) : (
                <Button key="timer-arm" plain onPress={() => armTimer($)}>
                  <Text bold color="#3fbf8f">{tr.sendBtn}</Text>
                </Button>
              )}
            </Box>
          </Box>,
        )}
        {gap ? <Box height={1} /> : null}
        <Box flexDirection={isWide ? 'row' : 'column'} gap={isWide ? 1 : 0} width={width}>
          {card('sessions', '☰ Sessions', '#b678e0', () => sessions($))}
          {card('compact', '⇊ Compact', '#4f9cf0', () => compact($))}
          {card('resume', '⟲ Resume', '#3fbf8f', () => resume($, e.surface))}
        </Box>
        {gap ? <Box height={1} /> : null}
        {framed(
          'model',
          tr.model,
          <Box flexDirection="row" justifyContent="space-between" borderStyle="round" borderColor={hue} paddingX={1} width={width}>
            <Box flexDirection="row" gap={2}>
              <Button key="m-prev" plain dimColor label="◀" action={MODEL_PREV} onPress={() => pick($, 'model', -1)} />
              <Text bold color={hue}>
                {modelLabel(model)}
                {p.model ? ' •' : ''}
              </Text>
              <Button key="m-next" plain dimColor label="▶" action={MODEL_NEXT} onPress={() => pick($, 'model', 1)} />
            </Box>
            <Text>
              {MODELS.map((m, k) => (
                <Text key={m.family} color={k === i ? hue : 'gray'}>{`${k ? ' ' : ''}${k === i ? '●' : '·'}`}</Text>
              ))}
            </Text>
          </Box>,
          modelChord ? (
            <Text>
              <Text>{' '}</Text>
              <Text bold color="#9a9aab">{modelChord}</Text>
              <Text dimColor>{` ${tr.chordHint} `}</Text>
            </Text>
          ) : null,
        )}
        {framed(
          'effort',
          'Effort',
          <Box flexDirection="row" justifyContent="space-between" borderStyle="round" borderColor={effortColor} paddingX={1} width={width}>
            <Box flexDirection="row" gap={2}>
              <Button key="e-prev" plain dimColor label="◀" action={EFFORT_DOWN} onPress={() => pick($, 'effort', -1)} />
              <Text bold color={effortColor}>
                {effort || 'auto'}
                {p.effort ? ' •' : ''}
              </Text>
              <Button key="e-next" plain dimColor label="▶" action={EFFORT_UP} onPress={() => pick($, 'effort', 1)} />
            </Box>
            <Text>
              {EFFORTS.map((lv, k) => (
                <Text key={lv} color={f >= 0 && k <= f ? EFFORT_COLORS[k] : 'gray'}>{'▁▃▄▆█'[k]}</Text>
              ))}
            </Text>
          </Box>,
          effortChord ? (
            <Text>
              <Text>{' '}</Text>
              <Text bold color="#9a9aab">{effortChord}</Text>
              <Text dimColor>{` ${tr.chordHint} `}</Text>
            </Text>
          ) : null,
        )}
        {agentList.length && gap ? <Box height={1} /> : null}
        {agentList.length
          ? framed(
              'subagents',
              tr.subagents,
              <Box flexDirection="column" borderStyle="round" borderColor="#b678e0" paddingX={1} width={width}>
                {agentList.map(([id, a], k) => (
                  <Box key={id} flexDirection="column">
                    {k > 0 ? <Box height={1} /> : null}
                    <Box flexDirection="row" justifyContent="space-between">
                      <Text bold color={MODELS[modelIndex(a.model)]?.hue ?? 'gray'}>
                        {modelLabel(a.model)}
                      </Text>
                      <Text color={effortTone(a.effort)}>{a.effort || 'auto'}</Text>
                    </Box>
                    <Text color="#9a9aab" wrap="truncate-end">{a.line}</Text>
                  </Box>
                ))}
              </Box>,
            )
          : null}
      </Box>
    )
    if (danceAt <= 0 || fadeK >= 1) return tree
    return fadeTree(tree, fadeK, FG_RGB, (text, color) => <Text color={color}>{text}</Text>) as RenderElement
  })

  on('ui.render', { component: 'SessionMode' }, async ($, e, next) => {
    if (e.surface === 'desktop') return next(e)
    const ls = await read($, limits)
    const cache = await read($, cacheLeft)
    const ctxTokens = (await read($, context)).tokens
    if (ls.length === 0 && cache < 0) return next(e)
    const { Box, Button, Text } = $.ui.resolve(e)
    const now = Date.now()
    const isAt = await read($, showResetAt)
    const five = ls.find(l => l.kind === 'five_hour')?.resetsAt
    const fiveLabel = five ? (isAt ? `${tr.at} ${two(new Date(five).getHours())}:${two(new Date(five).getMinutes())}` : resetIn(five, now)) : ''
    return (
      <Box flexDirection="row" gap={2}>
        {e.props.modes.length > 0 ? <Text dimColor>{e.props.modes.join(' & ')}</Text> : null}
        {showsCache(cache, e.surface) ? <Text bold={cache <= 0} color={cacheColor(cache)}>{cacheText(cache, ctxTokens)}</Text> : null}
        {ls.slice(0, 3).map(l => {
          const n = Math.round(Math.min(l.percentUsed, 100) / 10)
          return (
            <Box key={l.kind} flexDirection="row">
            <Text>
              <Text dimColor>{shortName(l.kind)} </Text>
              <Text color={tone(l.percentUsed)}>{'━'.repeat(n)}</Text>
              <Text color="gray">{'─'.repeat(10 - n)}</Text>
              <Text bold color={tone(l.percentUsed)}> {Math.round(l.percentUsed)}%</Text>
              {l.resetsAt && l.kind !== 'five_hour' ? <Text dimColor> ({resetIn(l.resetsAt, now)})</Text> : null}
            </Text>
            {l.kind === 'five_hour' && fiveLabel ? <Button key="reset-toggle" plain dimColor label={` (${fiveLabel})`} onPress={() => update($, showResetAt, v => !v)} /> : null}
            </Box>
          )
        })}
      </Box>
    )
  })
}

