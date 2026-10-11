import { Plugin } from "@opencode/plugin/tui"
import { createMemo, createSignal, For, Show } from "solid-js"
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

  const Card = (p: { label: string; fg: string; onClick: () => void }) => (
    <box border borderStyle="rounded" borderColor={p.fg} flexGrow={1} alignItems="center" onMouseUp={() => p.onClick()}>
      <text fg={p.fg}>{p.label}</text>
    </box>
  )

  function Section(p: { sessionID: string }) {
    const sid = () => p.sessionID
    const variants = createMemo(() => ui.model.variant.list())
    const variant = createMemo(() => ui.model.current()?.variant)
    const hue = createMemo(() => effortHue(variant()) ?? theme.border.base)
    const chord = createMemo(() => keymap.shortcuts("variant.cycle")[0])
    const draft = createMemo(() => shownDraft())
    const armed = () => mem.timer.at > 0
    const text = () => `«${mem.timer.text || tr().defaultText}»`
    return (
      <box gap={1}>
        <box>
          <box flexDirection="row" gap={1}>
            <text fg={theme.text.base}>
              <b>{NAME}</b>
            </text>
            <text fg={theme.text.muted}>{`v${version}`}</text>
          </box>
          <Show when={mem.latest && newerThan(mem.latest, version)}>
            <Click label={`✦ ${tr().updateAvail} v${mem.latest}`} fg={YELLOW} onClick={() => void selfUpdate()} />
          </Show>
        </box>

        <box border borderStyle="rounded" borderColor={armed() ? YELLOW : theme.border.base} title={` ${tr().timer} `} titleColor={theme.text.muted} paddingX={1}>
          <Show
            when={armed()}
            fallback={
              <>
                <box flexDirection="row" justifyContent="space-between">
                  <box flexDirection="row">
                    <text fg={theme.text.base}>{"⏰ "}</text>
                    <Click label={two(draft().h)} bold onClick={() => nudge("h", 1)} onScroll={d => nudge("h", d)} />
                    <text fg={theme.text.muted}>{" : "}</text>
                    <Click label={two(draft().m)} bold onClick={() => nudge("m", 1)} onScroll={d => nudge("m", d)} />
                  </box>
                  <Click label={tr().sendBtn} fg={GREEN} onClick={() => arm(sid())} />
                </box>
                <Click label={text()} fg={theme.text.muted} onClick={() => void editText()} />
              </>
            }
          >
            <box flexDirection="row" justifyContent="space-between">
              <text fg={YELLOW}>
                <b>{`⏰ ${two(new Date(mem.timer.at).getHours())} : ${two(new Date(mem.timer.at).getMinutes())}`}</b>
              </text>
              <Click label={tr().cancelBtn} fg={theme.text.muted} onClick={() => setMem(s => void (s.timer = { ...s.timer, at: 0 }))} />
            </box>
            <text fg={theme.text.muted}>{`${text()} · ${tr().via} ${resetIn(new Date(mem.timer.at).toISOString(), now())}`}</text>
          </Show>
        </box>

        <box flexDirection="row" gap={1}>
          <Card label="☰ Sessions" fg={PURPLE} onClick={() => keymap.dispatch("session.list")} />
          <Card label="⟲ Resume" fg={GREEN} onClick={() => void send(sid(), RESUME_TEXT)} />
          <Card label="⇊ Compact" fg={BLUE} onClick={() => keymap.dispatch("session.compact")} />
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
      </box>
    )
  }

  const release = ui.slot({ append: "sidebar.content", render: input => <Section sessionID={input.sessionID} /> })
  return () => {
    clearInterval(every)
    release()
  }
}

export default Plugin.define({ id: ID, setup })
