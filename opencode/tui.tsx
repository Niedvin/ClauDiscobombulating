import { Plugin } from "@opencode/plugin/tui"
import type { Renderable } from "@opentui/core"
import { useTerminalDimensions } from "@opentui/solid"
import { createMemo, createSignal, For, onCleanup, onMount, Show } from "solid-js"
import { spawn } from "node:child_process"
import { readFileSync, renameSync, writeFileSync } from "node:fs"
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
const EFFORT_BARS = "▁▂▃▄▅▆▇█"
const RED = "#ef5b5b"
const YELLOW = "#f0b429"
const GREEN = "#3fbf8f"
const BLUE = "#4f9cf0"
const PURPLE = "#b678e0"
const CYAN = "#56b6c2"
const WHEEL_GAP_MS = 80
// opencode's own session sidebar: 42 wide, shown above 120 columns — 2026-10-11
const SIDEBAR_W = 42
const SIDEBAR_FROM = 120

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
}

const effortHue = (v: string | undefined) => (!v ? undefined : /^(none|minimal|low)$/.test(v) ? BLUE : /^(xhigh|max)$/.test(v) ? RED : GREEN)
const two = (n: number) => String(n).padStart(2, "0")
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
    initial: { timer: { at: 0, text: "", sessionID: "" }, draft: { h: 0, m: 0, isSet: false }, latest: "" },
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

  function cycleVariant(dir: number) {
    const options: (string | undefined)[] = [undefined, ...ui.model.variant.list()]
    const i = options.indexOf(ui.model.current()?.variant)
    ui.model.variant.set(options[wrap(i + dir, options.length)])
  }

  function modelName() {
    const cur = ui.model.current()
    if (!cur) return "…"
    const m = data.location.model.list()?.find(x => x.providerID === cur.providerID && (x.id === cur.modelID || x.modelID === cur.modelID))
    return m?.name ?? cur.modelID
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
      if (timer.sessionID) void send(timer.sessionID, timer.text || tr().defaultText)
    }
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
    const variants = createMemo(() => ui.model.variant.list())
    const variant = createMemo(() => ui.model.current()?.variant)
    const hue = createMemo(() => effortHue(variant()) ?? theme.border.base)
    const chord = createMemo(() => keymap.shortcuts("variant.cycle")[0])
    const draft = createMemo(() => shownDraft())
    const armed = () => mem.timer.at > 0
    const text = () => `«${mem.timer.text || tr().defaultText}»`
    const fireAt = () => (armed() ? mem.timer.at : nextAt(draft().h, draft().m, now()))
    return (
      <box gap={1}>
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

        <Show when={p.sessionID}>
          <box border borderStyle="rounded" borderColor={armed() ? YELLOW : theme.border.base} title={` ${tr().timer} `} titleColor={theme.text.muted} paddingX={1} paddingTop={1}>
            <box flexDirection="row" justifyContent="center">
              <Show
                when={armed()}
                fallback={
                  <>
                    <text fg={theme.text.base}>{"⏰ "}</text>
                    <Click label={two(draft().h)} bold onClick={() => nudge("h", 1)} onScroll={d => nudge("h", d)} />
                    <text fg={theme.text.muted}>{" : "}</text>
                    <Click label={two(draft().m)} bold onClick={() => nudge("m", 1)} onScroll={d => nudge("m", d)} />
                  </>
                }
              >
                <text fg={YELLOW}>
                  <b>{`⏰ ${two(new Date(mem.timer.at).getHours())} : ${two(new Date(mem.timer.at).getMinutes())}`}</b>
                </text>
              </Show>
            </box>
            <box flexDirection="row" justifyContent="center">
              <text fg={theme.text.muted}>{`${tr().via} ${resetIn(new Date(fireAt()).toISOString(), now())}`}</text>
            </box>
            <box height={1} />
            <Click label={`✎ ${text()}`} fg={armed() ? theme.text.muted : theme.text.base} onClick={() => !armed() && void editText()} />
            <box
              border
              borderStyle="rounded"
              borderColor={armed() ? theme.border.base : GREEN}
              alignItems="center"
              onMouseUp={() => (armed() ? setMem(s => void (s.timer = { ...s.timer, at: 0 })) : arm(sid()))}
            >
              <text fg={armed() ? theme.text.muted : GREEN}>
                <b>{armed() ? tr().cancelBtn : tr().sendBtn}</b>
              </text>
            </box>
          </box>
        </Show>

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
              paddingX={1}
              flexDirection="row"
              justifyContent="space-between"
              onMouseScroll={e => wheel(e, cycleVariant)}
            >
              <box flexDirection="row" gap={2}>
                <Click label="◀" fg={theme.text.muted} onClick={() => cycleVariant(-1)} />
                <text fg={hue()}>
                  <b>{variant() ?? "default"}</b>
                </text>
                <Click label="▶" fg={theme.text.muted} onClick={() => cycleVariant(1)} />
              </box>
              <text>
                <For each={variants()}>
                  {(v, k) => {
                    const at = () => variants().indexOf(variant() ?? "")
                    const bar = EFFORT_BARS[Math.min(EFFORT_BARS.length - 1, Math.round((k() * (EFFORT_BARS.length - 1)) / Math.max(1, variants().length - 1)))]
                    return <span style={{ fg: k() <= at() ? (effortHue(v) ?? GREEN) : theme.border.base }}>{bar}</span>
                  }}
                </For>
              </text>
            </box>
          </Show>
        </box>
      </box>
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
