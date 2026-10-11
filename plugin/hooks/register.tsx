import { atom, read, update } from 'claude-code'
import type { EngineInterface, Hook, Register, Timer } from 'claude-code'

import type { Context, Draft, Limit, Live, Pending, Timer as Alarm } from '../types'

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
const PANE_COLS = 24
const STACK_ROWS = 21
// the 4+1 before the timer is the name header (4 rows) plus its gap — 2026-10-11
const CARDS_ROWS = 4 + 1 + 7 + 1 + STACK_ROWS
const RESUME_TERMINAL = '--resume'
const RESUME_OTHER = 'continue'
const WHEEL_GAP_MS = 150
const CACHE_TTL_MS = 3600000
const CACHE_SHOW_BELOW = 55
const ALERT_MIN = 10
const AUTO_COMPACT_AT = 99
// a release check redraws the header at most every 6h — 2026-10-11
const VERSION_CHECK_MS = 6 * 3600000
const COMPACT_GRACE_MS = 600000
const COMPACT_QUIET_MSGS = 5
const ALERT_TITLE = 'ClauDiscobombulating'
// no double quotes: argv reaches powershell.exe as one command line — 2026-10-06
const ALERT_PS = `$ErrorActionPreference='Stop';Add-Type -AssemblyName PresentationCore;$p=New-Object System.Windows.Media.MediaPlayer;$p.Open([uri]$env:PB_SOUND);$p.Play();[void][Windows.UI.Notifications.ToastNotificationManager,Windows.UI.Notifications,ContentType=WindowsRuntime];[void][Windows.Data.Xml.Dom.XmlDocument,Windows.Data.Xml.Dom.XmlDocument,ContentType=WindowsRuntime];$x=New-Object Windows.Data.Xml.Dom.XmlDocument;$x.LoadXml('<toast><visual><binding template=''ToastGeneric''><text>'+$env:PB_TITLE+'</text><text>'+$env:PB_BODY+'</text></binding></visual><audio silent=''true''/></toast>');[Windows.UI.Notifications.ToastNotificationManager]::CreateToastNotifier('{1AC14E77-02E7-4E5D-B744-2EB1AE5198B7}\\WindowsPowerShell\\v1.0\\powershell.exe').Show([Windows.UI.Notifications.ToastNotification]::new($x));Start-Sleep -Seconds 5`

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
}
let tr = EN

const limits = atom({ plugin: 'ClauDiscobombulating', key: 'limits' } as const, [] as Limit[])
const live = atom({ plugin: 'ClauDiscobombulating', key: 'live' } as const, { model: '', effort: '' } as Live)
const pending = atom({ plugin: 'ClauDiscobombulating', key: 'pending' } as const, { model: '', effort: '' } as Pending)
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

// USERPROFILE is Windows-only, HOME covers macOS/Linux — 2026-10-06
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

type SavedSettings = { effortLevel?: unknown; modelSettings?: Record<string, { effortLevel?: unknown }> }

async function openPane($: EngineInterface, why: string) {
  const r = await $.ui.open({ id: PANE, title: 'ClauDiscobombulating', columns: PANE_COLS })
  await note($, `open pane (${why}) → ${JSON.stringify(r)}`)
}

async function savedEffort($: EngineInterface, model: string) {
  const st = (await $.settings.read()) as SavedSettings
  const own = st.modelSettings?.[model]?.effortLevel
  if (isLevel(own)) return own
  return isLevel(st.effortLevel) ? st.effortLevel : ''
}


const two = (n: number) => String(n).padStart(2, '0')

const cacheText = (min: number) => (min <= 0 ? '⚠ Cache Miss' : `${tr.cache} ${min}${tr.min}`)
const cacheColor = (min: number) => (min <= 5 ? '#ef5b5b' : min <= 15 ? '#f0b429' : '#3fbf8f')
const kTok = (n: number) => (n >= 1000000 ? `${Math.round(n / 100000) / 10}M` : n >= 1000 ? `${Math.round(n / 1000)}k` : `${n}`)
const ctxLabel = (c: Context) => (c.window > 0 ? `${kTok(c.tokens)}/${kTok(c.window)}` : '')

// minutes until the 1h prompt cache lapses; -1 while a turn runs or before any turn — 2026-10-06
function cacheMinutes(now: number) {
  if (!lastActive || isBusy) return -1
  return Math.max(0, Math.ceil((CACHE_TTL_MS - (now - lastActive)) / 60000))
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

// the terminal footer hides the timer for the first 5 min idle, the desktop footer shows it always — 2026-10-06
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

// quiet at 99%+ limits and until 5 messages pass after a compact — 2026-10-06
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

async function compact($: EngineInterface): Promise<boolean> {
  const model = await $.session.model()
  // live is only polled in full mode, so desktop reads the effort from the app flag or saved settings — 2026-10-06
  const flagged = ((await $.settings.read({ source: 'flag' })) as SavedSettings).effortLevel
  const effort = (await read($, live)).effort || (isLevel(flagged) ? flagged : await savedEffort($, model))
  const fam = MODELS[modelIndex(model)]
  const isMiss = cacheMinutes(await $.clock.now()) === 0
  // haiku takes the whole 1M window now and is the cheap one to re-read the context on — 2026-10-10
  const isSwitch = isMiss && fam?.family !== 'haiku'
  // medium on a miss: the summary decides what the context keeps, so it is worth the thinking — 2026-10-10
  const target = isMiss ? 'medium' : 'low'
  // an unknown effort is left alone: nothing to set, nothing to restore — 2026-10-11
  const changed = isLevel(effort) && effort !== target
  try {
    if (isSwitch) {
      $.ui.toast(tr.compactOnHaiku)
      await runInjected($, 'model', 'haiku')
    }
    // effort goes after a model switch: the app re-sends its own at every switch — 2026-10-10
    if (changed) await runInjected($, 'effort', target)
    await runInjected($, 'compact')
    const doneAt = await $.clock.now()
    await update($, compactedAt, () => doneAt)
    await update($, sinceCompact, () => 0)
    return true
  } catch (err) {
    $.ui.toast(tr.compactFailed)
    await note($, `compact failed ${String(err)}`)
    // hold the grace so a failed attempt is retried after it, not every tick — 2026-10-06
    const failAt = await $.clock.now()
    await update($, compactedAt, () => failAt)
    return false
  } finally {
    if (isSwitch) {
      await runInjected($, 'model', fam?.id ?? model).catch(() => undefined)
      await update($, live, l => ({ ...l, model }))
    }
    if (isLevel(effort) && (isSwitch || changed)) {
      await runInjected($, 'effort', effort).catch(() => undefined)
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
  isCompacting = true
  try {
    if (now - (await read($, compactedAt)) < COMPACT_GRACE_MS) return
    // no resetsAt: a 5h wall bucket still allows one compact per window — 2026-10-11
    const key = five.resetsAt ?? `t${Math.floor(now / 18000000)}`
    if ((await read($, compactedFor)) === key) return
    $.ui.toast(tr.autoCompact(Math.floor(five.percentUsed)))
    if (isBusy && turnId) {
      await $.turn.abort({ turnId }).catch(err => note($, `auto abort failed ${String(err)}`))
      isBusy = false
    }
    await note($, `auto compact at ${five.percentUsed}%`)
    // the window is marked only once a compact stood, so a failed one can retry — 2026-10-06
    if (await compact($)) await update($, compactedFor, () => key)
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
  if (cacheMinutes(await $.clock.now()) === 0 && !(await alertQuiet($))) {
    const answer = await $.ui
      .ask(tr.resumeAsk, [tr.yes, tr.no])
      .catch(() => '')
    if (answer !== tr.yes) return
  }
  await note($, `resume → ${text}`)
  await $.prompt.submit({ text, asUser: true })
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
    if (!lastVersionCheck || tick - lastVersionCheck > VERSION_CHECK_MS) void checkVersion($).catch(() => undefined)
    await adoptShared($).catch(() => undefined)
    const u = await $.session.usage().catch(() => undefined)
    const c = u?.context
    if (c) {
      const fresh: Context = { tokens: c.tokens ?? 0, window: c.window ?? 0, percent: typeof c.percent === 'number' ? Math.round(c.percent) : c.tokens && c.window ? Math.round((c.tokens / c.window) * 100) : -1 }
      const seen = await read($, context)
      if (seen.tokens !== fresh.tokens || seen.window !== fresh.window || seen.percent !== fresh.percent) await update($, context, () => fresh)
    }
    const now = Date.now()
    const ls = await read($, limits)
    if (ls.some(l => l.resetsAt && Date.parse(l.resetsAt) <= now)) {
      // the API reports a new window only with the next response, so zero it locally — 2026-10-02
      await update($, limits, xs => xs.map(l => (l.resetsAt && Date.parse(l.resetsAt) <= now ? { kind: l.kind, percentUsed: 0 } : l)))
    }
    void autoCompact($).catch(err => note($, `auto compact failed ${String(err)}`))
    if (!isFull) return
    const up = (await $.ui.panes().catch(() => [])).some(x => x.id === PANE && x.isPlaced && x.isShown)
    if (up !== (await read($, paneUp))) await update($, paneUp, () => up)
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
  if (!v || !Array.isArray(v.limits) || v.at <= sharedAt) return
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

// runs a /model or /effort the mod itself chose; onCommand leaves those unnoted — 2026-10-11
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
let lastVersionCheck = 0
// manifest, so a version bump never drifts from the header — 2026-10-11
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
  lastVersionCheck = Date.now()
  const repo = pluginRepo.replace(/^https?:\/\/github\.com\//, '').replace(/\.git$/, '')
  if (!repo.includes('/')) return
  const r = await $.http.fetch(`https://raw.githubusercontent.com/${repo}/main/plugin/.claude-plugin/plugin.json`)
  if (!r.ok) return
  const m = JSON.parse(r.text) as { version?: unknown }
  if (typeof m.version === 'string' && newerThan(m.version, pluginVersion)) await update($, latest, () => m.version)
}

// the click on the header's new-version line: pull the release in, restart applies — 2026-10-11
async function doUpdate($: EngineInterface) {
  try {
    const v = await read($, latest)
    const args = ['plugin', 'update', `${PANE}@${PANE}`, '--scope', 'user']
    const os = await $.env.get('OS').catch(() => undefined)
    const argv = os === 'Windows_NT' ? ['cmd.exe', '/c', `claude ${args.join(' ')}`] : ['claude', ...args]
    await $.process.run(argv, { timeoutMs: 180000 })
    await update($, latest, () => '')
    $.ui.toast(tr.updateDone(v))
  } catch (err) {
    $.ui.toast(tr.updateFailed)
    await note($, `update failed ${String(err)}`)
  }
}

async function enableFull($: EngineInterface, why: string) {
  if (isFull) return
  isFull = true
  await loadVersion($).catch(() => undefined)
  void checkVersion($).catch(() => undefined)
  await $.command.register({ name: 'ClauDiscobombulating', description: 'Open the model and effort pane' })
  await openPane($, why)
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
  let paneWidth = 24
  let lastWheel = 0

  on('session.start', async ($, e, next) => {
    const r = await next(e)
    await applyLang($).catch(err => note($, `lang failed ${String(err)}`))
    pollEvery?.cancel()
    pollEvery = $.clock.every(1000, () => void poll($))
    try {
      const u = await $.session.usage()
      await update($, limits, () => u.rateLimits.map(l => ({ ...l })))
      await poll($)
      const p = await read($, pending)
      // a reload inside the pick debounce leaves pending set: re-arm the apply — 2026-10-06
      if (p.model) modelTimer = $.clock.after(APPLY_MS, () => void applyModel($))
      if (p.effort) effortTimer = $.clock.after(APPLY_MS, () => void applyEffort($))
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
    if (e.surface === 'desktop') isFull = false
    else await enableFull($, `attach surface=${e.surface}`).catch(err => note($, `attach failed ${String(err)}`))
    return r
  })

  on('classic.SessionStart', async ($, e, next) => {
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
    await update($, limits, () => ls)
    if (ls.length > 0) await shareLimits($, ls).catch(() => undefined)
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
        // compaction is its own API request, so the 1h cache timer restarts here — 2026-10-10
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

  on('turn.complete', async ($, e, next) => {
    if (e.agentId) return next(e)
    isBusy = false
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
    return yield* next(e)
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
        log: await read($, log),
      }
      return { result: JSON.stringify(data, null, 1) }
    } catch (err) {
      return { result: `probe failed: ${String(err)}` }
    }
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    if (e.props.hasSurvey || e.props.view.agentId) return next(e)
    if (e.surface === 'desktop') {
      const ls = await read($, limits)
      const cache = await read($, cacheLeft)
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
                  {cacheText(cache)}
                </Text>,
              ])
            : null}
        </Box>
      )
    }
    if (!isFull) return next(e)
    metrics = { surface: e.surface, bodyColumns: e.props.bodyColumns, maxRows: e.props.maxRows, viewport: e.viewport ?? null }
    const cur = await read($, live)
    const p = await read($, pending)
    const model = p.model || cur.model
    const effort = p.effort || cur.effort
    const label = ctxLabel(await read($, context))
    const up = await read($, paneUp)
    if (up && !label) return next(e)
    const { Box, Button, Text } = $.ui.resolve(e)
    const i = modelIndex(model)
    const hue = MODELS[i]?.hue ?? 'gray'
    const f = EFFORTS.indexOf(effort)
    const effortColor = f >= 0 ? EFFORT_COLORS[f] : 'gray'
    return (
      <Box flexDirection="row" justifyContent="flex-end" alignItems="center" gap={1} width={e.props.bodyColumns}>
        {label ? <Text dimColor>{label}</Text> : null}
        {up ? null : (
          <Box key="pick" flexDirection="row" alignItems="center" gap={1}>
            <Button key="to-pane" plain dimColor label={tr.toPane} onPress={() => openPane($, 'button')} />
            <Box flexDirection="row" alignItems="center" gap={1} borderStyle="round" borderColor={hue} paddingX={1}>
              <Button key="m-prev" plain dimColor label="◀" onPress={() => pick($, 'model', -1)} />
              <Text bold color={hue}>
                {modelLabel(model)}
                {p.model ? ' •' : ''}
              </Text>
              <Button key="m-next" plain dimColor label="▶" onPress={() => pick($, 'model', 1)} />
            </Box>
            <Box flexDirection="row" alignItems="center" gap={1} borderStyle="round" borderColor={effortColor} paddingX={1}>
              <Button key="e-prev" plain dimColor label="◀" action="pane:previous" onPress={() => pick($, 'effort', -1)} />
              <Text bold color={effortColor}>
                {effort || 'auto'}
                {p.effort ? ' •' : ''}
              </Text>
              <Text>
                {EFFORTS.map((lv, k) => (
                  <Text key={lv} color={f >= 0 && k <= f ? EFFORT_COLORS[k] : 'gray'}>{'▁▃▄▆█'[k]}</Text>
                ))}
              </Text>
              <Button key="e-next" plain dimColor label="▶" action="pane:next" onPress={() => pick($, 'effort', 1)} />
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
    else if (!(await read($, timer).catch(() => ({ at: 0 }))).at) await nudgeDraft($, (e.pointer?.column ?? 0) < paneWidth / 2 ? 'h' : 'm', dir).catch(() => undefined)
    else return next(e)
    return {}
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const { Box, Button, Input, Text } = $.ui.resolve(e)
    const cur = await read($, live)
    const p = await read($, pending)
    const model = p.model || cur.model
    const effort = p.effort || cur.effort
    const i = modelIndex(model)
    const hue = MODELS[i]?.hue ?? 'gray'
    const f = EFFORTS.indexOf(effort)
    const effortColor = f >= 0 ? EFFORT_COLORS[f] : 'gray'
    const width = Math.max(18, e.props.bodyColumns)
    const rows = e.props.scroll.bodyRows
    const height = Math.max(rows, CARDS_ROWS)
    const stack = height - STACK_ROWS
    // the timer follows the 4-row header and its 1-row gap — 2026-10-11
    paneRows = { timer: [5, 11], model: [stack + 12, stack + 15], effort: [stack + 17, stack + 20] }
    paneWidth = width
    const latestV = await read($, latest)
    const alarm = await read($, timer)
    const d = await shownDraft($)
    const isArmed = alarm.at > 0
    const at = isArmed ? new Date(alarm.at) : undefined
    const hh = at ? at.getHours() : d.h
    const mm = at ? at.getMinutes() : d.m
    return (
      <Box flexDirection="column" width={width} height={height} backgroundColor="black" justifyContent="space-between">
        <Box flexDirection="column" width={width}>
          <Box flexDirection="column" alignItems="center" borderStyle="round" borderColor="#6c6c7c" backgroundColor="black" width={width}>
            <Text bold color="#ececf1">
              {$.plugin.name}
            </Text>
            {latestV && newerThan(latestV, pluginVersion) ? (
              <Box flexDirection="row" justifyContent="center">
                <Text dimColor>{`v${pluginVersion}`}</Text>
                <Button key="update" plain label={` ${tr.updateAvail} v${latestV}`} onPress={() => doUpdate($)} />
              </Box>
            ) : (
              <Text dimColor>{`v${pluginVersion}`}</Text>
            )}
          </Box>
          <Box height={1} />
          <Box flexDirection="column" alignItems="center" borderStyle="round" borderColor={isArmed ? '#f0b429' : '#6c6c7c'} backgroundColor="black" width={width}>
            <Text bold color={isArmed ? '#f0b429' : '#ececf1'}>
              ⏰ {two(hh)} : {two(mm)}
            </Text>
            <Text color="#3a3a48">{'─'.repeat(Math.max(4, width - 4))}</Text>
            {isArmed ? (
              <Text color="#9a9aab" wrap="truncate-end">
                «{alarm.text}» · {tr.via} {inFor(alarm.at - Date.now())}
              </Text>
            ) : (
              <Input key="timer-text" placeholder={tr.placeholder} submitLabel="" value={alarm.text} onInput={v => update($, timer, t => ({ ...t, text: v }))} onSubmit={async v => { await update($, timer, t => ({ ...t, text: v || t.text })); await armTimer($) }} />
            )}
            <Text color="#3a3a48">{'─'.repeat(Math.max(4, width - 4))}</Text>
            <Box flexDirection="row" justifyContent="center">
              {isArmed ? (
                <Button key="timer-cancel" plain label={tr.cancelBtn} onPress={() => update($, timer, t => ({ ...t, at: 0 }))} />
              ) : (
                <Button key="timer-arm" plain label={tr.sendBtn} onPress={() => armTimer($)} />
              )}
            </Box>
          </Box>
        </Box>
        <Box flexDirection="column" width={width}>
        <Box flexDirection="row" justifyContent="center" borderStyle="round" borderColor="#b678e0" backgroundColor="black" width={width}>
          <Button key="sessions" plain label="☰  Sessions" onPress={() => sessions($)} />
        </Box>
        <Box height={1} />
        <Box flexDirection="row" justifyContent="center" borderStyle="round" borderColor="#3fbf8f" backgroundColor="black" width={width}>
          <Button key="resume" plain label="⟲  Resume" onPress={() => resume($, e.surface)} />
        </Box>
        <Box height={1} />
        <Box flexDirection="row" justifyContent="center" borderStyle="round" borderColor="#4f9cf0" backgroundColor="black" width={width}>
          <Button key="compact" plain label="⇊  Compact" onPress={() => compact($)} />
        </Box>
        <Box height={1} />
        <Box flexDirection="column" alignItems="center" justifyContent="center" borderStyle="round" borderColor={hue} backgroundColor="black" width={width}>
          <Text bold color={hue}>
            {modelLabel(model)}
            {p.model ? ' •' : ''}
          </Text>
          <Text>
            {MODELS.map((m, k) => (
              <Text key={m.family} color={k === i ? hue : 'gray'}>{k === i ? ' ● ' : ' · '}</Text>
            ))}
          </Text>
        </Box>
        <Box height={1} />
        <Box flexDirection="column" alignItems="center" justifyContent="center" borderStyle="round" borderColor={effortColor} backgroundColor="black" width={width}>
          <Text bold color={effortColor}>
            {effort || 'auto'}
            {p.effort ? ' •' : ''}
          </Text>
          <Text>
            {EFFORTS.map((lv, k) => (
              <Text key={lv} color={f >= 0 && k <= f ? EFFORT_COLORS[k] : 'gray'}>{'▁▃▄▆█'[k].repeat(2)} </Text>
            ))}
          </Text>
        </Box>
        </Box>
      </Box>
    )
  })

  on('ui.render', { component: 'SessionMode' }, async ($, e, next) => {
    if (e.surface === 'desktop') return next(e)
    const ls = await read($, limits)
    const cache = await read($, cacheLeft)
    if (ls.length === 0 && cache < 0) return next(e)
    const { Box, Button, Text } = $.ui.resolve(e)
    const now = Date.now()
    const isAt = await read($, showResetAt)
    const five = ls.find(l => l.kind === 'five_hour')?.resetsAt
    const fiveLabel = five ? (isAt ? `${tr.at} ${two(new Date(five).getHours())}:${two(new Date(five).getMinutes())}` : resetIn(five, now)) : ''
    return (
      <Box flexDirection="row" gap={2}>
        {e.props.modes.length > 0 ? <Text dimColor>{e.props.modes.join(' & ')}</Text> : null}
        {showsCache(cache, e.surface) ? <Text bold={cache <= 0} color={cacheColor(cache)}>{cacheText(cache)}</Text> : null}
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

