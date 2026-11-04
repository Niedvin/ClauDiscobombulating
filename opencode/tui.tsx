import { Plugin } from "@opencode/plugin/tui"
import type { Renderable } from "@opentui/core"
import { useTerminalDimensions } from "@opentui/solid"
import { createEffect, createMemo, createSignal, For, onCleanup, onMount, Show } from "solid-js"
import { spawn } from "node:child_process"
import { existsSync, readdirSync, readFileSync, renameSync, writeFileSync } from "node:fs"
import { homedir } from "node:os"
import path from "node:path"
import { fileURLToPath } from "node:url"

type Ctx = Plugin.Context
type Window = { percent: number; resetsAt?: string }
type Kind = "rolling" | "weekly" | "monthly"
type Usage = Partial<Record<Kind, Window>>

const ID = "claudiscobombulating"
const NAME = "ClauDiscobombulating"
const RESUME_TEXT = "continue"
// undocumented, found by probing; takes the Go API key as Bearer — 2026-10-11
const USAGE_URL = "https://opencode.ai/zen/go/v1/usage"
const USAGE_EVERY_MS = 60000
const KINDS: Kind[] = ["rolling", "weekly", "monthly"]
// same 5-step meter as the Claude pane, whatever variants the model offers — 2026-11-04
const EFFORT_BARS = "▁▃▄▆█"
const TIMER_ROWS = 7
// big digits: 17 cols of time + ≤16-col pill; 36 not 38 ∵ opencode sidebar content is 37 wide — 2026-11-03
const BIG_TIMER_COLS = 36
const DIGIT_HOVER = "#9ad0f0"
const RED = "#ef5b5b"
const YELLOW = "#f0b429"
const GREEN = "#3fbf8f"
const BLUE = "#4f9cf0"
const PURPLE = "#b678e0"
const CYAN = "#56b6c2"
const WHEEL_GAP_MS = 80
const TREE_ROWS = 12
const FOLDER = "#c9a36b"
const DONE_MS = 2000
const DONE_FRAME_MS = 80
const DONE_TYPE_MS = 480
const DONE_FADE_MS = 700
const DONE_HUE = [0x3f, 0xbf, 0x8f]
const DONE_DIM = [0x4a, 0x4a, 0x55]
// opencode's own session sidebar: 42 wide, shown above 120 columns — 2026-10-11
const SIDEBAR_W = 42
const SIDEBAR_FROM = 120
// a missing panel on a narrow terminal asks the terminal to grow: CSI 8 h;w t — 2026-10-12
const WIDEN_STEP = 20
const WIDEN_MAX = 200
const WIDEN_TRIES = 5
const WIDEN_EVERY_MS = 3000
const SEEN_FRESH_MS = 4000

const UK = {
  defaultText: "продовжуй",
  hour: "г",
  min: "хв",
  day: "д",
  month: "міс",
  via: "через",
  armed: (t: string) => `Повідомлення піде о ${t}`,
  updateAvail: "нова",
  updateDone: (v: string) => `Оновлено до v${v}`,
  updateFailed: "Оновлення не вдалося",
  textTitle: "Текст повідомлення",
  sendBtn: "✓ відправити",
  cancelBtn: "✕ скасувати",
  sendFailed: "Не вдалося відправити",
  timer: "Таймер",
  model: "Модель",
  effortHint: "змінити",
  subagents: "Субагенти",
  folder: "Папка",
  folderHome: "тут стартує сесія таймера",
  here: "сюди",
  subStart: "стартує…",
  subThink: "думає…",
  done: "Готово",
  subWrite: "пише…",
}
const EN: typeof UK = {
  defaultText: "continue",
  hour: "h",
  min: "m",
  day: "d",
  month: "mo",
  via: "in",
  armed: t => `Message will be sent at ${t}`,
  updateAvail: "new",
  updateDone: v => `Updated to v${v}`,
  updateFailed: "Update failed",
  textTitle: "Message text",
  sendBtn: "✓ send",
  cancelBtn: "✕ cancel",
  sendFailed: "Could not send",
  timer: "Timer",
  model: "Model",
  effortHint: "to change",
  subagents: "Subagents",
  folder: "Folder",
  folderHome: "timer session starts here",
  here: "here",
  subStart: "starting…",
  subThink: "thinking…",
  done: "Done",
  subWrite: "writing…",
}

const EFFORT_HUES = [BLUE, GREEN, GREEN, GREEN, RED]
const effortStep = (v: string | undefined) => (!v ? -1 : /^(none|minimal|low)$/.test(v) ? 0 : v === "medium" ? 1 : v === "xhigh" ? 3 : v === "max" ? 4 : 2)
const effortHue = (v: string | undefined) => (!v ? undefined : /^(none|minimal|low)$/.test(v) ? BLUE : /^(xhigh|max)$/.test(v) ? RED : GREEN)
const two = (n: number) => String(n).padStart(2, "0")
const isRootDir = (p: string) => /^[A-Za-z]:[\\/]*$/.test(p) || /^[\\/]+$/.test(p)

// cells as the engine lays them out: ☰ counts 2 — 2026-11-03
function cells(s: string) {
  let n = 0
  for (const ch of s) {
    const c = ch.codePointAt(0) ?? 0
    if (c === 0xfe0f || c === 0x200d) continue
    const isWide =
      (c >= 0x1100 && c <= 0x115f) ||
      (c >= 0x2630 && c <= 0x2637) ||
      (c >= 0x23e9 && c <= 0x23f3) ||
      (c >= 0x2e80 && c <= 0xa4cf) ||
      (c >= 0xac00 && c <= 0xd7a3) ||
      (c >= 0xf900 && c <= 0xfaff) ||
      (c >= 0xfe30 && c <= 0xfe4f) ||
      (c >= 0xff00 && c <= 0xff60) ||
      (c >= 0xffe0 && c <= 0xffe6) ||
      (c >= 0x1f300 && c <= 0x1faff)
    n += isWide ? 2 : 1
  }
  return n
}
const fit = (s: string, w: number) => s + " ".repeat(Math.max(0, w - cells(s)))

// 3×5 pixel digits shifted down half a row: 0.5…3.0, centred on the send pill — 2026-11-03
const DIGIT_PX = ["111101101101111", "010110010010111", "111001111100111", "111001111001111", "101101111001001", "111100111001111", "111100111101111", "111001001001001", "111101111101111", "111101111001111"]
const halfRows = (px: string, c: number) => ["0", ...[0, 1, 2, 3, 4].map(r => px[r * 3 + c] ?? "0")]
const bigDigits = (s: string) =>
  [0, 1, 2].map(r =>
    [...s]
      .map(ch => {
        const px = DIGIT_PX[Number(ch)] ?? DIGIT_PX[0]!
        return [0, 1, 2].map(c => " ▀▄█"[Number(halfRows(px, c)[2 * r]) + 2 * Number(halfRows(px, c)[2 * r + 1])]).join("")
      })
      .join(" "),
  )

// typed in, held, then faded to grey before the row goes — 2026-10-30
function doneLook(t: number, word: string) {
  const n = Math.min(word.length, Math.ceil((t / DONE_TYPE_MS) * word.length))
  const k = Math.min(1, Math.max(0, (t - (DONE_MS - DONE_FADE_MS)) / DONE_FADE_MS))
  const color = `#${DONE_HUE.map((v, i) => Math.round(v + (DONE_DIM[i]! - v) * k).toString(16).padStart(2, "0")).join("")}`
  return { text: `✓ ${word.slice(0, n)}`, color }
}
function hsl(h: number, s: number, l: number) {
  const a = s * Math.min(l, 1 - l)
  const f = (n: number) => {
    const k = (n + h / 30) % 12
    return Math.round(255 * (l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1)))).toString(16).padStart(2, "0")
  }
  return `#${f(0)}${f(8)}${f(4)}`
}
// purple → pink → orange across the name, as on the Claude Code side — 2026-10-11
const hues = Array.from({ length: NAME.length }, (_, k) => hsl((280 + (k * 120) / (NAME.length - 1)) % 360, 0.75, 0.65))
const wrap = (i: number, n: number) => ((i % n) + n) % n
const tone = (p: number) => (p >= 90 ? RED : p >= 70 ? YELLOW : GREEN)
const UK_TAG = /^uk(?![a-z])/i
const firstTag = (out: string) => /[A-Za-z]{2,3}(?:[-_][A-Za-z0-9]+)?/.exec(out)?.[0] ?? ""

// live-step hint for the subagent box: the argument that says most about the call — 2026-10-15
const HINT_KEYS = ["filePath", "path", "command", "pattern", "query", "url", "description", "prompt"]
const HINT_MAX = 26
function toolHint(input: unknown) {
  if (!input || typeof input !== "object") return ""
  const rec = input as Record<string, unknown>
  for (const k of HINT_KEYS) {
    const v = rec[k]
    if (typeof v !== "string" || !v.trim()) continue
    const s = k === "filePath" || k === "path" ? path.basename(v.trim()) : v.trim().split("\n")[0]
    return s.length > HINT_MAX ? `${s.slice(0, HINT_MAX - 1)}…` : s
  }
  return ""
}

function run(argv: string[], timeoutMs: number) {
  return new Promise<string>(resolve => {
    try {
      const p = spawn(argv[0], argv.slice(1), { windowsHide: true })
      let out = ""
      const timer = setTimeout(() => p.kill(), timeoutMs)
      p.stdout.on("data", d => (out += String(d)))
      p.on("error", () => resolve(""))
      p.on("close", () => {
        clearTimeout(timer)
        resolve(out)
      })
    } catch {
      resolve("")
    }
  })
}

// same order as the Claude Code side: forced, POSIX locale, then the OS display language — 2026-10-11
async function detectUk() {
  const forced = process.env.CLAUDISCOBOMBULATING_LANG
  if (forced) return UK_TAG.test(forced)
  const isWin = process.platform === "win32"
  if (!isWin) {
    const e = process.env
    const set = [e.LC_ALL, e.LC_MESSAGES, e.LANGUAGE, e.LANG].find(v => v && v !== "C" && v !== "POSIX")
    if (set) return UK_TAG.test(set)
  }
  const argv = isWin ? ["powershell.exe", "-NoProfile", "-NonInteractive", "-Command", "(Get-UICulture).Name"] : ["defaults", "read", "-g", "AppleLanguages"]
  return UK_TAG.test(firstTag(await run(argv, 5000)))
}

function newerThan(a: string, b: string) {
  const x = a.split(".").map(Number)
  const y = b.split(".").map(Number)
  for (let i = 0; i < Math.max(x.length, y.length); i++) {
    if ((x[i] ?? 0) !== (y[i] ?? 0)) return (x[i] ?? 0) > (y[i] ?? 0)
  }
  return false
}

function nextAt(h: number, m: number, now: number) {
  const d = new Date(now)
  d.setHours(h, m, 0, 0)
  if (d.getTime() <= now) d.setDate(d.getDate() + 1)
  return d.getTime()
}

function goKey() {
  const base = process.env.XDG_DATA_HOME || path.join(homedir(), ".local", "share")
  try {
    const auth = JSON.parse(readFileSync(path.join(base, "opencode", "auth.json"), "utf8")) as Record<string, { key?: unknown }>
    const key = auth["opencode-go"]?.key
    return typeof key === "string" ? key : undefined
  } catch {
    return undefined
  }
}

function setup(context: Ctx) {
  const { theme, ui, data, client, keymap } = context
  const here = path.dirname(fileURLToPath(import.meta.url))

  const [tr, setTr] = createSignal(EN)
  const [now, setNow] = createSignal(Date.now())
  const [usage, setUsage] = createSignal<Usage>()
  const [mem, setMem] = context.storage.memory("state", {
    initial: { timer: { at: 0, text: "", sessionID: "" }, draft: { h: 0, m: 0, isSet: false }, latest: "", dir: "" },
  })

  let version = "?"
  let repo = "Niedvin/ClauDiscobombulating"
  try {
    const m = JSON.parse(readFileSync(path.join(here, "plugin.json"), "utf8")) as { version?: unknown; repository?: unknown }
    if (typeof m.version === "string") version = m.version
    if (typeof m.repository === "string") repo = m.repository.replace(/^https?:\/\/github\.com\//, "").replace(/\.git$/, "")
  } catch {}
  // raw.githubusercontent.com serves a 5 min old copy after a push; the contents API is fresh — 2026-10-11
  const fromMain = (file: string) =>
    fetch(`https://api.github.com/repos/${repo}/contents/${file}?ref=main`, { headers: { Accept: "application/vnd.github.raw", "User-Agent": "opencode" } })

  void detectUk().then(isUk => setTr(isUk ? UK : EN))

  async function pollUsage() {
    const key = goKey()
    if (!key) return setUsage(undefined)
    try {
      // Cloudflare answers 403 to some default agents — 2026-10-11
      const r = await fetch(USAGE_URL, { headers: { Authorization: `Bearer ${key}`, "User-Agent": "opencode" } })
      if (!r.ok) return
      const v = (await r.json()) as { usage?: Usage }
      if (v.usage) setUsage(v.usage)
    } catch {}
  }

  // the server reports a new window only on the next poll, so a passed reset reads 0 — 2026-10-11
  const limits = createMemo(() => {
    const t = now()
    const u = usage()
    if (!u) return []
    return KINDS.flatMap(kind => {
      const w = u[kind]
      if (!w || typeof w.percent !== "number") return []
      return [{ kind, percentUsed: w.resetsAt && Date.parse(w.resetsAt) <= t ? 0 : w.percent, resetsAt: w.resetsAt }]
    })
  })

  function resetIn(iso: string | undefined, t: number) {
    if (!iso) return ""
    const at = Date.parse(iso)
    if (Number.isNaN(at)) return ""
    const m = Math.max(0, Math.round((at - t) / 60000))
    const s = tr()
    if (m >= 1440) return `${Math.floor(m / 1440)}${s.day} ${Math.floor((m % 1440) / 60)}${s.hour}`
    return m >= 60 ? `${Math.floor(m / 60)}${s.hour} ${m % 60}${s.min}` : `${m}${s.min}`
  }
  const shortName = (kind: Kind) => ({ rolling: `5${tr().hour}`, weekly: `7${tr().day}`, monthly: tr().month })[kind]

  function shownDraft() {
    const d = mem.draft
    if (d.isSet) return d
    const reset = usage()?.rolling?.resetsAt
    const base = reset ? Date.parse(reset) + 60000 : now() + 3600000
    const t = new Date(Math.ceil(base / 300000) * 300000)
    return { h: t.getHours(), m: t.getMinutes(), isSet: false }
  }

  function nudge(part: "h" | "m", dir: number) {
    const d = shownDraft()
    const next = part === "h" ? { ...d, h: wrap(d.h + dir, 24) } : { ...d, m: wrap(d.m + dir * 5, 60) }
    setMem(s => {
      s.draft = { ...next, isSet: true }
    })
  }

  function arm(sessionID: string) {
    const d = shownDraft()
    const at = nextAt(d.h, d.m, Date.now())
    setMem(s => {
      s.timer = { ...s.timer, at, sessionID }
    })
    ui.toast.show({ message: tr().armed(`${two(d.h)}:${two(d.m)}`), variant: "info" })
  }

  async function editText() {
    const v = await ui.dialog.prompt({ title: tr().textTitle, value: mem.timer.text || tr().defaultText })
    if (v === undefined) return
    setMem(s => {
      s.timer = { ...s.timer, text: v }
    })
  }

  async function send(sessionID: string, text: string) {
    try {
      // the server prompts with the session's stored model, not the one picked in the TUI — 2026-10-11
      const cur = ui.model.current()
      const had = data.session.get(sessionID)?.model
      if (cur && (had?.id !== cur.modelID || had?.providerID !== cur.providerID || had?.variant !== cur.variant)) {
        await client.session.switchModel({ sessionID, model: { id: cur.modelID, providerID: cur.providerID, variant: cur.variant } })
      }
      await client.session.prompt({ sessionID, text })
    } catch {
      ui.toast.show({ message: tr().sendFailed, variant: "error" })
    }
  }

  // home dir pick is plugin-local: no client call moves the launch directory — 2026-11-03
  function homeDir() {
    try {
      return mem.dir || data.location.default().directory
    } catch {
      return mem.dir || context.location?.directory || process.cwd()
    }
  }

  async function fire(sessionID: string, text: string) {
    if (sessionID) return send(sessionID, text)
    try {
      const cur = ui.model.current()
      const info = await client.session.create({
        location: { directory: homeDir() },
        model: cur && { id: cur.modelID, providerID: cur.providerID, variant: cur.variant },
      })
      await send(info.id, text)
      ui.router.navigate({ type: "session", sessionID: info.id })
    } catch {
      ui.toast.show({ message: tr().sendFailed, variant: "error" })
    }
  }

  function cycleVariant(dir: number) {
    const options: (string | undefined)[] = [undefined, ...ui.model.variant.list()]
    const i = options.indexOf(ui.model.current()?.variant)
    ui.model.variant.set(options[wrap(i + dir, options.length)])
  }

  function modelLabel(id: string, providerID: string) {
    const m = data.location.model.list()?.find(x => x.providerID === providerID && (x.id === id || x.modelID === id))
    return m?.name ?? id
  }

  function modelName() {
    const cur = ui.model.current()
    return cur ? modelLabel(cur.modelID, cur.providerID) : "…"
  }

  async function selfUpdate() {
    const v = mem.latest
    try {
      const [code, manifest] = await Promise.all([fromMain("opencode/tui.tsx"), fromMain("plugin/.claude-plugin/plugin.json")])
      if (!code.ok || !manifest.ok) throw new Error(`HTTP ${code.status}/${manifest.status}`)
      const src = await code.text()
      const json = await manifest.text()
      if (src.length < 1000 || !src.includes("Plugin.define") || JSON.parse(json).version !== v) throw new Error("bad download")
      for (const [name, body] of [["tui.tsx", src], ["plugin.json", json]] as const) {
        const target = path.join(here, name)
        writeFileSync(`${target}.tmp`, body)
        renameSync(`${target}.tmp`, target)
      }
      setMem(s => {
        s.latest = ""
      })
      ui.toast.show({ message: tr().updateDone(v), variant: "success" })
    } catch {
      ui.toast.show({ message: tr().updateFailed, variant: "error" })
    }
  }

  void fromMain("plugin/.claude-plugin/plugin.json")
    .then(r => (r.ok ? (r.json() as Promise<{ version?: unknown }>) : undefined))
    .then(m => {
      const v = m?.version
      if (typeof v === "string" && newerThan(v, version)) setMem(s => void (s.latest = v))
    })
    .catch(() => undefined)

  let polled = 0
  let seenAt = Date.now()
  let triedAt = 0
  let triedCols = -1
  let tries = 0
  // opentui's own view of the terminal beats process.stdout, which bun may leave undefined — 2026-10-12
  let termCols = process.stdout.columns ?? 0
  let termRows = process.stdout.rows ?? 30
  function tick() {
    const t = Date.now()
    setNow(t)
    if (t - polled >= USAGE_EVERY_MS) {
      polled = t
      void pollUsage()
    }
    const timer = mem.timer
    if (timer.at && t >= timer.at) {
      setMem(s => {
        s.timer = { ...s.timer, at: 0 }
        s.draft = { ...s.draft, isSet: false }
      })
      void fire(timer.sessionID, timer.text || tr().defaultText)
    }
    const cols = termCols
    // a terminal takes a resize only from the app's own stdout, and only the panel proves it landed — 2026-10-12
    if (cols !== triedCols) {
      triedCols = cols
      tries = 0
    }
    try {
      const route = ui.router.current()?.type
      const wantsPanel = route === "home" || route === "session"
      if (wantsPanel && cols > 0 && cols < WIDEN_MAX && t - seenAt > SEEN_FRESH_MS && tries < WIDEN_TRIES && t - triedAt >= WIDEN_EVERY_MS) {
        tries++
        triedAt = t
        const target = Math.min(WIDEN_MAX, Math.max(cols + WIDEN_STEP, SIDEBAR_FROM + 2))
        process.stdout.write(`\x1b[8;${termRows};${target}t`)
      }
    } catch {}
  }
  tick()
  const every = setInterval(tick, 1000)

  let lastWheel = 0
  function wheel(e: { scroll?: { direction: string }; stopPropagation(): void }, step: (dir: number) => void) {
    if (!e.scroll) return
    e.stopPropagation()
    const t = Date.now()
    // a notch can arrive as a burst of events — 2026-10-11
    if (t - lastWheel < WHEEL_GAP_MS) return
    lastWheel = t
    step(e.scroll.direction === "up" ? 1 : -1)
  }

  const Click = (p: { label: string; fg?: unknown; bold?: boolean; onClick: () => void; onScroll?: (dir: number) => void }) => (
    <text fg={(p.fg ?? theme.text.base) as never} onMouseUp={() => p.onClick()} onMouseScroll={e => p.onScroll && wheel(e, p.onScroll)}>
      {p.bold ? <b>{p.label}</b> : p.label}
    </text>
  )

  const Card = (p: { label: string; fg: string; width?: number; onClick: () => void }) => (
    <box border borderStyle="rounded" borderColor={p.fg} width={p.width} flexGrow={p.width ? 0 : 1} flexBasis={p.width ?? 0} alignItems="center" onMouseUp={() => p.onClick()}>
      <text fg={p.fg}>{p.label}</text>
    </box>
  )

  function Section(p: { sessionID?: string }) {
    const sid = () => p.sessionID ?? ""
    // the panel is up while this runs: a heartbeat the widen reads as its silence — 2026-10-12
    onMount(() => {
      seenAt = Date.now()
      const beat = setInterval(() => (seenAt = Date.now()), 1000)
      onCleanup(() => clearInterval(beat))
    })
    const variants = createMemo(() => ui.model.variant.list())
    const variant = createMemo(() => ui.model.current()?.variant)
    const hue = createMemo(() => effortHue(variant()) ?? theme.border.base)
    const chord = createMemo(() => keymap.shortcuts("variant.cycle")[0])
    const draft = createMemo(() => shownDraft())
    const armed = () => mem.timer.at > 0
    const fireAt = () => (armed() ? mem.timer.at : nextAt(draft().h, draft().m, now()))
    const [width, setWidth] = createSignal(0)
    const [fill, setFill] = createSignal(0)
    const [agentCount, setAgentCount] = createSignal(0)
    const [hoverH, setHoverH] = createSignal(false)
    const [hoverM, setHoverM] = createSignal(false)
    const [hoverPill, setHoverPill] = createSignal(false)
    const dims = useTerminalDimensions()
    let rootEl: Renderable | undefined
    let spacerEl: Renderable | undefined
    const timerW = () => (width() > 0 ? width() : 37)
    const isBig = () => timerW() >= BIG_TIMER_COLS
    const hh = () => (armed() ? new Date(mem.timer.at).getHours() : draft().h)
    const mm = () => (armed() ? new Date(mem.timer.at).getMinutes() : draft().m)
    const digitColor = () => (armed() ? YELLOW : theme.text.base)
    const pillText = () => (armed() ? tr().cancelBtn : tr().sendBtn)
    const pillColor = () => (armed() ? theme.text.muted : GREEN)
    const pillBg = () => (armed() ? "#2a2a34" : "#173d30")
    const pillHoverBg = () => (armed() ? "#3a3a48" : "#22543f")
    const pillPress = () => (armed() ? setMem(s => void (s.timer = { ...s.timer, at: 0 })) : arm(sid()))
    const countdown = () => `${tr().via} ${resetIn(new Date(fireAt()).toISOString(), now())}`
    const fieldW = () => Math.max(1, timerW() - 4)
    // left leaves room for "✎ " and the field's border+padding, right for "  ⏎" — 2026-11-03
    const text = () => {
      const max = Math.max(4, fieldW() - 10)
      const s = (mem.timer.text || tr().defaultText).split("\n")[0]!
      return cells(s) > max ? `${s.slice(0, max - 1)}…` : s
    }
    // 2 cols each side, less only when the pane is too narrow for them — 2026-11-03
    const pillW = () => Math.max(1, Math.min(Math.max(cells(pillText()), cells(countdown())) + 4, timerW() - 4 - 17 - 2))
    const centre = (s: string, w: number) => fit(" ".repeat(Math.max(0, Math.floor((w - cells(s)) / 2))) + s, w)
    // the sidebar slot is scrollbox content: the root needs a height before a flex spacer can grow — 2026-11-03
    function measure() {
      const el = rootEl
      if (!el) return
      setWidth(el.width)
      if (agentCount() === 0) return setFill(0)
      let parent: Renderable | null = el.parent
      while (parent && !("scrollHeight" in parent)) parent = parent.parent
      if (!parent) return setFill(0)
      const pane = parent as Renderable & { screenY: number; height: number; scrollTop?: number }
      const natural = el.height - (spacerEl?.height ?? 0)
      // scroll offset cancels out: pin to the content bottom, not the visibly scrolled one — 2026-11-03
      const top = el.screenY - pane.screenY + (pane.scrollTop ?? 0)
      setFill(Math.max(0, pane.height - top - natural))
    }
    createEffect(() => {
      agentCount()
      dims().height
      measure()
    })
    return (
      <box ref={r => (rootEl = r)} onSizeChange={measure} minHeight={fill() || undefined} gap={1}>
        <box border borderStyle="rounded" borderColor={hues[0]} alignItems="center">
          <text>
            <b>
              <For each={[...NAME]}>{(ch, k) => <span style={{ fg: hues[k()] }}>{ch}</span>}</For>
            </b>
            <span style={{ fg: theme.text.muted }}>{`  v${version}`}</span>
          </text>
          <Show when={mem.latest && newerThan(mem.latest, version)}>
            <Click label={`✦ ${tr().updateAvail} v${mem.latest}`} fg={YELLOW} onClick={() => void selfUpdate()} />
          </Show>
        </box>

        <box
          border
          borderStyle="rounded"
          borderColor={armed() ? YELLOW : theme.border.base}
          title={` ${tr().timer} `}
          titleColor={theme.text.muted}
          paddingX={1}
          height={isBig() ? TIMER_ROWS + 2 : TIMER_ROWS}
        >
          <box flexDirection="row" justifyContent="space-between">
            <box flexDirection="row">
              <Show when={!isBig()}>
                <text fg={digitColor()}>{"⏰ "}</text>
              </Show>
              <box
                flexDirection="column"
                onMouseUp={() => !armed() && nudge("h", 1)}
                onMouseScroll={e => wheel(e, d => nudge("h", d))}
                onMouseOver={() => setHoverH(true)}
                onMouseOut={() => setHoverH(false)}
              >
                <For each={isBig() ? bigDigits(two(hh())) : [two(hh())]}>
                  {line => (
                    <text fg={!armed() && hoverH() ? DIGIT_HOVER : digitColor()}>
                      <b>{line}</b>
                    </text>
                  )}
                </For>
              </box>
              <Show
                when={isBig()}
                fallback={
                  <text fg="#6c6c7c">{":"}</text>
                }
              >
                <box flexDirection="column">
                  <text fg="#6c6c7c">{"   "}</text>
                  <text fg="#6c6c7c">{" ▀ "}</text>
                  <text fg="#6c6c7c">{" ▀ "}</text>
                </box>
              </Show>
              <box
                flexDirection="column"
                onMouseUp={() => !armed() && nudge("m", 1)}
                onMouseScroll={e => wheel(e, d => nudge("m", d))}
                onMouseOver={() => setHoverM(true)}
                onMouseOut={() => setHoverM(false)}
              >
                <For each={isBig() ? bigDigits(two(mm())) : [two(mm())]}>
                  {line => (
                    <text fg={!armed() && hoverM() ? DIGIT_HOVER : digitColor()}>
                      <b>{line}</b>
                    </text>
                  )}
                </For>
              </box>
            </box>
            <Show
              when={isBig()}
              fallback={
                <box
                  backgroundColor={hoverPill() ? pillHoverBg() : pillBg()}
                  paddingX={1}
                  onMouseUp={pillPress}
                  onMouseOver={() => setHoverPill(true)}
                  onMouseOut={() => setHoverPill(false)}
                >
                  <text fg={pillColor()}>
                    <b>{pillText()}</b>
                  </text>
                </box>
              }
            >
              <box
                flexDirection="column"
                width={pillW()}
                onMouseUp={pillPress}
                onMouseOver={() => setHoverPill(true)}
                onMouseOut={() => setHoverPill(false)}
              >
                <text fg={hoverPill() ? pillColor() : pillBg()}>{"▁".repeat(pillW())}</text>
                <text fg={pillColor()} bg={hoverPill() ? pillHoverBg() : pillBg()}>{centre(pillText(), pillW())}</text>
                <text fg={pillColor()} bg={hoverPill() ? pillHoverBg() : pillBg()}>{centre(countdown(), pillW())}</text>
                <text fg={hoverPill() ? pillColor() : pillBg()}>{"▔".repeat(pillW())}</text>
              </box>
            </Show>
          </box>
          <Show when={!isBig()}>
            {/* 3 cols = "⏰ ": countdown starts under the digits — 2026-10-30 */}
            <box paddingLeft={3}>
              <text fg={theme.text.muted}>{countdown()}</text>
            </box>
          </Show>
          <Show
            when={armed()}
            fallback={
              <box
                border
                borderStyle="rounded"
                borderColor={theme.text.muted}
                backgroundColor="#1c1c24"
                width={fieldW()}
                paddingX={1}
                flexDirection="row"
                justifyContent="space-between"
                onMouseUp={() => void editText()}
              >
                <text fg={theme.text.base}>{`✎ ${text()}`}</text>
                <box paddingLeft={2} onMouseUp={e => (e.stopPropagation(), arm(sid()))}>
                  <text fg={GREEN}>{"⏎"}</text>
                </box>
              </box>
            }
          >
            <box
              border
              borderStyle="rounded"
              borderColor={theme.border.base}
              backgroundColor="#1c1c24"
              width={fieldW()}
              paddingX={1}
            >
              <text fg={theme.text.muted}>{`✎ ${text()}`}</text>
            </box>
          </Show>
        </box>

        <box flexDirection="row" gap={1}>
          {/* opentui counts ☰ as 2 cells: 13 fits the label, the other 2 share the rest of 37 — 2026-10-11 */}
          <Card label="☰ Sessions" fg={PURPLE} width={p.sessionID ? 13 : undefined} onClick={() => keymap.dispatch("session.list")} />
          <Show when={p.sessionID}>
            <Card label="⇊ Compact" fg={BLUE} onClick={() => keymap.dispatch("session.compact")} />
            <Card label="⟲ Resume" fg={GREEN} onClick={() => void send(sid(), RESUME_TEXT)} />
          </Show>
        </box>

        <box>
          <box
            border
            borderStyle="rounded"
            borderColor={CYAN}
            title={` ${tr().model} `}
            titleColor={theme.text.muted}
            paddingX={1}
            flexDirection="row"
            justifyContent="space-between"
            onMouseUp={() => keymap.dispatch("model.list")}
          >
            <text fg={theme.text.base}>
              <b>{modelName()}</b>
            </text>
            <text fg={CYAN}>▾</text>
          </box>
          <Show when={variants().length > 0}>
            <box
              border
              borderStyle="rounded"
              borderColor={hue()}
              title=" Effort "
              titleColor={theme.text.muted}
              bottomTitle={chord() ? ` ${chord()} ${tr().effortHint} ` : undefined}
              bottomTitleAlignment="right"
              paddingRight={1}
              flexDirection="row"
              justifyContent="space-between"
              onMouseScroll={e => wheel(e, cycleVariant)}
            >
              <box flexDirection="row">
                <box paddingX={1} onMouseUp={() => cycleVariant(-1)}>
                  <text fg={theme.text.muted}>◀</text>
                </box>
                <box paddingX={1}>
                  <text fg={hue()}>
                    <b>{variant() ?? "default"}</b>
                  </text>
                </box>
                <box paddingX={1} onMouseUp={() => cycleVariant(1)}>
                  <text fg={theme.text.muted}>▶</text>
                </box>
              </box>
              <text>
                <For each={[...EFFORT_BARS]}>
                  {(bar, k) => <span style={{ fg: k() <= effortStep(variant()) ? EFFORT_HUES[k()] : theme.border.base }}>{bar}</span>}
                </For>
              </text>
            </box>
          </Show>
        </box>

        <Folder sessionID={p.sessionID} />

        <Show when={agentCount() > 0}>
          <box flexGrow={1} ref={r => (spacerEl = r)} />
        </Show>

        <Show when={p.sessionID}>{sid => <Subagents sessionID={sid()} onCount={setAgentCount} />}</Show>
      </box>
    )
  }

  // session.move re-roots the session; the store follows its session.moved event — 2026-10-30
  function Folder(p: { sessionID?: string }) {
    const [open, setOpen] = createSignal(false)
    const [dir, setDir] = createSignal("")
    const [top, setTop] = createSignal(0)
    const where = () => (p.sessionID ? data.session.get(p.sessionID)?.location.directory ?? "" : homeDir())
    const entries = createMemo(() => {
      const d = dir()
      if (!d) return [] as { name: string; path: string }[]
      let dirs: string[] = []
      try {
        dirs = readdirSync(d, { withFileTypes: true })
          .filter(e => e.isDirectory() && !e.name.startsWith("."))
          .map(e => e.name)
          .sort((a, b) => a.toLowerCase().localeCompare(b.toLowerCase()))
      } catch {}
      const drives =
        process.platform === "win32" && isRootDir(d)
          ? [..."CDEFGHIJKLMNOPQRSTUVWXYZ"].filter(l => `${l}:` !== d.slice(0, 2).toUpperCase() && existsSync(`${l}:/`)).map(l => `${l}:`)
          : []
      return [...dirs.map(n => ({ name: n, path: path.join(d, n) })), ...drives.map(v => ({ name: v, path: `${v}/` }))]
    })
    const shown = createMemo(() => entries().slice(top(), top() + TREE_ROWS))
    const enter = (d: string) => (setDir(d), setTop(0))
    const toggle = () => {
      if (!open()) enter(where())
      setOpen(!open())
    }
    const pick = (d: string) => {
      setOpen(false)
      if (!p.sessionID) {
        setMem(s => void (s.dir = d))
        return
      }
      void client.session.move({ sessionID: p.sessionID, directory: d }).catch(err => ui.toast.show({ message: String(err).slice(0, 160), variant: "error" }))
    }
    const name = () => {
      const at = where()
      const b = path.basename(at) || at
      return b.length > 22 ? `${b.slice(0, 21)}…` : b
    }
    return (
      <box>
        <box flexDirection="row" justifyContent="space-between" paddingX={1} onMouseUp={toggle}>
          <text fg={FOLDER}>{`📁 ${tr().folder}  ${name()}`}</text>
          <text fg={theme.text.muted}>{open() ? "▴" : "▾"}</text>
        </box>
        <Show when={open()}>
          <box paddingX={1} onMouseScroll={e => setTop(t => Math.max(0, Math.min(Math.max(0, entries().length - TREE_ROWS), t + (e.scroll?.direction === "up" ? -1 : 1))))}>
            {/* row halves are boxes: a press anywhere on one counts, not on its text only — 2026-10-30 */}
            <box flexDirection="row">
              <box flexGrow={1} onMouseUp={() => !isRootDir(dir()) && enter(path.dirname(dir()))}>
                <text fg={PURPLE}>{isRootDir(dir()) ? " " : "‹ .."}</text>
              </box>
              <box paddingLeft={2} onMouseUp={() => pick(dir())}>
                <text fg={GREEN}>{`✓ ${tr().here}`}</text>
              </box>
            </box>
            <For each={shown()}>
              {en => (
                <box flexDirection="row">
                  <box flexGrow={1} onMouseUp={() => enter(en.path)}>
                    <text fg="#9ad0f0">{`▸ ${en.name.length > 28 ? `${en.name.slice(0, 27)}…` : en.name}`}</text>
                  </box>
                  <box paddingLeft={2} onMouseUp={() => pick(en.path)}>
                    <text fg={GREEN}>{"→"}</text>
                  </box>
                </box>
              )}
            </For>
          </box>
        </Show>
        <Show when={!p.sessionID}>
          <box paddingX={1}>
            <text fg={theme.text.muted}>{`⏱ ${tr().folderHome}`}</text>
          </box>
        </Show>
      </box>
    )
  }

  // box under Effort: live subagents of this session tree — model, effort, current step — 2026-10-15
  function Subagents(p: { sessionID: string; onCount: (n: number) => void }) {
    const tried = new Map<string, number>()
    const running = createMemo(() =>
      data.session
        .list()
        .filter(s => s.parentID && s.id !== p.sessionID && data.session.root(s.id) === data.session.root(p.sessionID) && data.session.status(s.id) === "running")
        .toSorted((a, b) => a.time.created - b.time.created),
    )
    // a reload misses earlier deltas: pull the transcript once per id while it runs — 2026-10-15
    createEffect(() => {
      const t = now()
      const ids = new Set(running().map(s => s.id))
      for (const id of [...tried.keys()]) if (!ids.has(id)) tried.delete(id)
      for (const id of ids) {
        if (data.session.message.list(id).length > 0 || t - (tried.get(id) ?? 0) < 4000) continue
        tried.set(id, t)
        void data.session.message.sync(id).catch(() => undefined)
      }
    })
    type Row = { s: ReturnType<typeof running>[number]; at: number }
    const [finished, setFinished] = createSignal<Row[]>([])
    const [frameAt, setFrameAt] = createSignal(Date.now())
    let seen = new Map<string, Row["s"]>()
    createEffect(() => {
      const list = running()
      const ids = new Set(list.map(s => s.id))
      const gone = [...seen.values()].filter(s => !ids.has(s.id))
      const at = Date.now()
      if (gone.length) setFinished(f => [...f.filter(x => !ids.has(x.s.id)), ...gone.map(s => ({ s, at }))])
      seen = new Map(list.map(s => [s.id, s]))
    })
    const ticker = setInterval(() => {
      if (!finished().length) return
      const t = Date.now()
      setFrameAt(t)
      if (finished().some(x => t - x.at >= DONE_MS)) setFinished(f => f.filter(x => t - x.at < DONE_MS))
    }, DONE_FRAME_MS)
    onCleanup(() => clearInterval(ticker))
    const rows = createMemo(() => [...running().map(s => ({ s, at: 0 })), ...finished()].toSorted((a, b) => a.s.time.created - b.s.time.created))
    createEffect(() => p.onCount(rows().length))
    onCleanup(() => p.onCount(0))
    const modelOf = (id: string) => {
      const last = data.session.message.list(id).findLast(m => m.type === "assistant")
      const ref = (last?.type === "assistant" ? last.model : undefined) ?? data.session.get(id)?.model
      if (!ref) return { name: "…", effort: undefined as string | undefined }
      const name = modelLabel(ref.id, ref.providerID)
      return { name: name.length > 24 ? `${name.slice(0, 23)}…` : name, effort: ref.variant }
    }
    const activityOf = (id: string) => {
      const last = data.session.message.list(id).findLast(m => m.type === "assistant")
      const part = last?.type === "assistant" ? last.content[last.content.length - 1] : undefined
      if (!part) return { glyph: "✧", text: tr().subStart }
      if (part.type === "tool") {
        if (part.state.status === "streaming") return { glyph: "⚙", text: `${part.name} …` }
        if (part.state.status === "running") {
          const hint = toolHint(part.state.input)
          return { glyph: "⚙", text: hint ? `${part.name} ${hint}` : part.name }
        }
        return { glyph: "⚙", text: `${part.name} ${part.state.status === "error" ? "✕" : "✓"}` }
      }
      if (part.type === "text") {
        const line = part.text.split("\n").find(l => l.trim())?.trim()
        return { glyph: "✎", text: !line ? tr().subWrite : line.length > 28 ? `${line.slice(0, 27)}…` : line }
      }
      return { glyph: "✧", text: tr().subThink }
    }
    return (
      <Show when={rows().length > 0}>
        <box border borderStyle="rounded" borderColor={PURPLE} title={` ${tr().subagents} `} titleColor={theme.text.muted} paddingX={1}>
          <For each={rows()}>
            {({ s, at }, i) => {
              const m = createMemo(() => modelOf(s.id))
              const a = createMemo(() => activityOf(s.id))
              const done = createMemo(() => (at ? doneLook(frameAt() - at, tr().done) : undefined))
              return (
                <box>
                  <Show when={i() > 0}>
                    <box height={1} />
                  </Show>
                  <box flexDirection="row" justifyContent="space-between">
                    <text fg={theme.text.base}>
                      <b>{m().name}</b>
                    </text>
                    <text fg={effortHue(m().effort) ?? theme.text.muted}>{m().effort ?? "default"}</text>
                  </box>
                  <Show when={done()} fallback={<text fg={theme.text.muted}>{`${a().glyph} ${a().text}`}</text>}>
                    <text fg={done()?.color}>
                      <b>{done()?.text}</b>
                    </text>
                  </Show>
                </box>
              )
            }}
          </For>
        </box>
      </Show>
    )
  }

  function Limits() {
    return (
      <Show when={limits().length > 0}>
        <box border borderStyle="rounded" borderColor={theme.border.base} title=" OpenCode Go " titleColor={theme.text.muted} paddingX={1}>
          <For each={limits()}>
            {l => {
              const n = () => Math.round(Math.min(l.percentUsed, 100) / 10)
              return (
                <text>
                  <span style={{ fg: theme.text.muted }}>{`${shortName(l.kind).padEnd(3)} `}</span>
                  <span style={{ fg: tone(l.percentUsed) }}>{"━".repeat(n())}</span>
                  <span style={{ fg: theme.border.base }}>{"─".repeat(10 - n())}</span>
                  <span style={{ fg: tone(l.percentUsed) }}>{` ${String(Math.round(l.percentUsed)).padStart(3)}%`}</span>
                  <Show when={l.resetsAt}>
                    <span style={{ fg: theme.text.muted }}>{` ↻ ${resetIn(l.resetsAt, now())}`}</span>
                  </Show>
                </text>
              )
            }}
          </For>
        </box>
      </Show>
    )
  }

  // home has no sidebar slot: draw one beside the routes by turning the app column into a row — 2026-10-11
  function Beside() {
    let el: Renderable | undefined
    let host: Renderable | null = null
    onMount(() => {
      host = el?.parent ?? null
      if (host) host.flexDirection = "row"
    })
    onCleanup(() => {
      if (host) host.flexDirection = "column"
    })
    return (
      <box
        ref={r => (el = r)}
        width={SIDEBAR_W}
        height="100%"
        flexShrink={0}
        backgroundColor={theme.background.raised.base}
        paddingTop={1}
        paddingBottom={1}
        paddingLeft={2}
        paddingRight={3}
      >
        <Section />
        <box flexGrow={1} />
        <Limits />
      </box>
    )
  }

  function Home() {
    const dims = useTerminalDimensions()
    createEffect(() => {
      termCols = dims().width
      termRows = dims().height
    })
    return (
      <Show when={ui.router.current().type === "home" && dims().width > SIDEBAR_FROM}>
        <Beside />
      </Show>
    )
  }

  const releases = [
    ui.slot({ append: "sidebar.content", render: input => <Section sessionID={input.sessionID} /> }),
    // the footer has no scrollbar gutter: 1 col in keeps the right edge in line — 2026-10-11
    ui.slot({ prepend: "sidebar.footer", render: () => <box paddingRight={1}><Limits /></box> }),
    ui.slot({ append: "app", render: () => <Home /> }),
  ]
  return () => {
    clearInterval(every)
    for (const release of releases) release()
  }
}

export default Plugin.define({ id: ID, setup })
