import { Plugin } from "@opencode/plugin/tui"
import { createMemo, createSignal, For, Show } from "solid-js"
import { spawn } from "node:child_process"
import { readFileSync, renameSync, statSync, writeFileSync } from "node:fs"
import { homedir } from "node:os"
import path from "node:path"
import { fileURLToPath } from "node:url"

type Ctx = Plugin.Context
type Limit = { kind: string; percentUsed: number; resetsAt?: string }
type Shared = { at: number; limits: Limit[] }
type Activity = { at: number; cached: boolean }

const ID = "claudiscobombulating"
const NAME = "ClauDiscobombulating"
const RESUME_TEXT = "continue"
const AUTO_COMPACT_AT = 99
const COMPACT_GRACE_MS = 600000
// a window this close to its reset frees itself; a compact would only cost — 2026-10-11
const NO_COMPACT_BEFORE_RESET_MS = 59 * 60000
const SHARED_EVERY_MS = 5000
// opencode sends Anthropic cache marks without a ttl, so the provider's 5 min default holds — 2026-10-11
const DEFAULT_CACHE_MIN = 5
const EFFORT_BARS = "▁▂▃▄▅▆▇█"
const RED = "#ef5b5b"
const YELLOW = "#f0b429"
const GREEN = "#3fbf8f"

const UK = {
  defaultText: "продовжуй",
  hour: "г",
  min: "хв",
  day: "д",
  cache: "кеш",
  via: "через",
  ago: (m: number) => `${m}${UK.min} тому`,
  yes: "Продовжити",
  no: "Скасувати",
  alertBody: (m: number) => `Кеш: лишилось ${m} хв`,
  armed: (t: string) => `Повідомлення піде о ${t}`,
  compactFailed: "Compact не вдався",
  autoCompact: (p: number) => `Ліміт 5г ${p}%: стоп і compact`,
  resumeAsk: "Cache miss: контекст кешується заново і це коштує. Все одно продовжити?",
  updateAvail: "нова",
  updateDone: (v: string) => `Оновлено до v${v}`,
  updateFailed: "Оновлення не вдалося",
  textTitle: "Текст повідомлення",
  sendBtn: "✓ відправити",
  cancelBtn: "✕ скасувати",
  sendFailed: "Не вдалося відправити",
}
const EN: typeof UK = {
  defaultText: "continue",
  hour: "h",
  min: "m",
  day: "d",
  cache: "cache",
  via: "in",
  ago: m => `${m}m ago`,
  yes: "Continue",
  no: "Cancel",
  alertBody: m => `Cache: ${m} min left`,
  armed: t => `Message will be sent at ${t}`,
  compactFailed: "Compact failed",
  autoCompact: p => `5h limit ${p}%: stopping to compact`,
  resumeAsk: "Cache miss: the context is cached again, which costs tokens. Continue anyway?",
  updateAvail: "new",
  updateDone: v => `Updated to v${v}`,
  updateFailed: "Update failed",
  textTitle: "Message text",
  sendBtn: "✓ send",
  cancelBtn: "✕ cancel",
  sendFailed: "Could not send",
}

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

function setup(context: Ctx) {
  const { theme, ui, data, client, keymap } = context
  const here = path.dirname(fileURLToPath(import.meta.url))
  const sharedPath = path.join(homedir(), ".claude", "mods", `${NAME}-limits.json`)
  const ttlMin = Number(context.options.cacheMinutes) || DEFAULT_CACHE_MIN
  // a 5 min cache gives no time to act on an alert: only long ttls get one, at 1/6 left — 2026-10-11
  const alertMin = Number(context.options.alertMinutes) || (ttlMin >= 20 ? Math.round(ttlMin / 6) : 0)

  const [tr, setTr] = createSignal(EN)
  const [now, setNow] = createSignal(Date.now())
  const [shared, setShared] = createSignal<Shared>()
  const [mem, setMem] = context.storage.memory("state", {
    initial: { timer: { at: 0, text: "", sessionID: "" }, draft: { h: 0, m: 0, isSet: false }, alerted: 0, compactedFor: "", compactedAt: 0, latest: "" },
  })

  let version = "?"
  let repo = "Niedvin/ClauDiscobombulating"
  try {
    const m = JSON.parse(readFileSync(path.join(here, "plugin.json"), "utf8")) as { version?: unknown; repository?: unknown }
    if (typeof m.version === "string") version = m.version
    if (typeof m.repository === "string") repo = m.repository.replace(/^https?:\/\/github\.com\//, "").replace(/\.git$/, "")
  } catch {}
  const raw = (file: string) => `https://raw.githubusercontent.com/${repo}/main/${file}`

  void detectUk().then(isUk => setTr(isUk ? UK : EN))

  let sharedMtime = 0
  let sharedRead = 0
  function readShared() {
    try {
      const st = statSync(sharedPath)
      if (st.mtimeMs === sharedMtime) return
      sharedMtime = st.mtimeMs
      const v = JSON.parse(readFileSync(sharedPath, "utf8")) as Shared
      if (v && Array.isArray(v.limits)) setShared({ at: Number(v.at) || st.mtimeMs, limits: v.limits })
    } catch {}
  }

  // the API reports a new window only with the next response, so a passed reset reads 0 — 2026-10-11
  const limits = createMemo(() => {
    const t = now()
    return (shared()?.limits ?? []).map(l => (l.resetsAt && Date.parse(l.resetsAt) <= t ? { kind: l.kind, percentUsed: 0 } : l))
  })
  const five = () => limits().find(l => l.kind === "five_hour")

  function currentSession() {
    const r = ui.router.current()
    return r.type === "session" ? r.sessionID : undefined
  }

  function activity(sessionID: string): Activity | undefined {
    const msgs = data.session.message.list(sessionID)
    for (let i = msgs.length - 1; i >= 0; i--) {
      const m = msgs[i]
      if (m.type === "assistant") {
        const c = m.tokens?.cache
        return { at: m.time.completed ?? m.time.created, cached: !!c && c.read + c.write > 0 }
      }
      if (m.type === "compaction" && m.status === "completed") return { at: m.time.created, cached: true }
    }
    return undefined
  }

  // ms until the prompt cache lapses; undefined while a turn runs or the provider caches nothing — 2026-10-11
  function cacheLeft(sessionID: string, t: number) {
    if (data.session.status(sessionID) === "running") return undefined
    const a = activity(sessionID)
    if (!a?.cached) return undefined
    return Math.max(0, ttlMin * 60000 - (t - a.at))
  }

  function cacheText(ms: number) {
    if (ms <= 0) return "⚠ Cache Miss"
    if (ttlMin <= 10) {
      const s = Math.ceil(ms / 1000)
      return `${tr().cache} ${Math.floor(s / 60)}:${two(s % 60)}`
    }
    return `${tr().cache} ${Math.ceil(ms / 60000)}${tr().min}`
  }
  const cacheColor = (ms: number) => (ms <= (ttlMin * 60000) / 12 ? RED : ms <= (ttlMin * 60000) / 4 ? YELLOW : GREEN)

  function resetIn(iso: string | undefined, t: number) {
    if (!iso) return ""
    const at = Date.parse(iso)
    if (Number.isNaN(at)) return ""
    const m = Math.max(0, Math.round((at - t) / 60000))
    const s = tr()
    if (m >= 1440) return `${Math.floor(m / 1440)}${s.day} ${Math.floor((m % 1440) / 60)}${s.hour}`
    return m >= 60 ? `${Math.floor(m / 60)}${s.hour} ${m % 60}${s.min}` : `${m}${s.min}`
  }
  const shortName = (kind: string) => ({ five_hour: `5${tr().hour}`, seven_day: `7${tr().day}`, spend_limit: "$" })[kind as "five_hour"] ?? kind

  function shownDraft() {
    const d = mem.draft
    if (d.isSet) return d
    const reset = five()?.resetsAt
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
      await client.session.prompt({ sessionID, text })
    } catch {
      ui.toast.show({ message: tr().sendFailed, variant: "error" })
    }
  }

  async function compact(sessionID: string) {
    try {
      await client.session.compact({ sessionID })
      setMem(s => {
        s.compactedAt = Date.now()
      })
      return true
    } catch {
      ui.toast.show({ message: tr().compactFailed, variant: "error" })
      // hold the grace so a failed attempt is retried after it, not every tick — 2026-10-11
      setMem(s => {
        s.compactedAt = Date.now()
      })
      return false
    }
  }

  async function resume(sessionID: string) {
    if (cacheLeft(sessionID, Date.now()) === 0) {
      const ok = await ui.dialog.confirm({ title: NAME, message: tr().resumeAsk, label: { confirm: tr().yes, cancel: tr().no } })
      if (!ok) return
    }
    await send(sessionID, RESUME_TEXT)
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
      const [code, manifest] = await Promise.all([fetch(raw("opencode/tui.tsx")), fetch(raw("plugin/.claude-plugin/plugin.json"))])
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

  void fetch(raw("plugin/.claude-plugin/plugin.json"))
    .then(r => (r.ok ? (r.json() as Promise<{ version?: unknown }>) : undefined))
    .then(m => {
      const v = m?.version
      if (typeof v === "string" && newerThan(v, version)) setMem(s => void (s.latest = v))
    })
    .catch(() => undefined)

  let busy = false
  async function autoCompact(sessionID: string) {
    const f = five()
    if (busy || !f || f.percentUsed < AUTO_COMPACT_AT) return
    // Claude limits only bind Claude models — 2026-10-11
    if (ui.model.current()?.providerID !== "anthropic") return
    const t = Date.now()
    if (f.resetsAt && Date.parse(f.resetsAt) - t < NO_COMPACT_BEFORE_RESET_MS) return
    if (t - mem.compactedAt < COMPACT_GRACE_MS) return
    const key = f.resetsAt ?? `t${Math.floor(t / 18000000)}`
    if (mem.compactedFor === key) return
    busy = true
    try {
      ui.toast.show({ message: tr().autoCompact(Math.floor(f.percentUsed)), variant: "warning" })
      if (data.session.status(sessionID) === "running") await client.session.interrupt({ sessionID }).catch(() => undefined)
      if (await compact(sessionID)) setMem(s => void (s.compactedFor = key))
    } finally {
      busy = false
    }
  }

  function tick() {
    const t = Date.now()
    setNow(t)
    if (t - sharedRead >= SHARED_EVERY_MS) {
      sharedRead = t
      readShared()
    }
    const timer = mem.timer
    if (timer.at && t >= timer.at) {
      setMem(s => {
        s.timer = { ...s.timer, at: 0 }
        s.draft = { ...s.draft, isSet: false }
      })
      if (timer.sessionID) void send(timer.sessionID, timer.text || tr().defaultText)
    }
    const sid = currentSession()
    if (!sid) return
    const left = cacheLeft(sid, t)
    const a = activity(sid)
    if (alertMin > 0 && a && left !== undefined && left > 0 && left <= alertMin * 60000 && mem.alerted !== a.at) {
      setMem(s => void (s.alerted = a.at))
      ui.toast.show({ title: NAME, message: tr().alertBody(alertMin), variant: "warning" })
      void context.attention.notify({ title: NAME, message: tr().alertBody(alertMin), notification: true, sound: true }).catch(() => undefined)
    }
    void autoCompact(sid)
  }
  readShared()
  const every = setInterval(tick, 1000)

  const Click = (p: { label: string; fg?: unknown; onClick: () => void; onScroll?: (dir: number) => void }) => (
    <text
      fg={(p.fg ?? theme.text.base) as never}
      onMouseUp={() => p.onClick()}
      onMouseScroll={e => {
        if (!p.onScroll || !e.scroll) return
        e.stopPropagation()
        p.onScroll(e.scroll.direction === "up" ? 1 : -1)
      }}
    >
      {p.label}
    </text>
  )

  function Section(p: { sessionID: string }) {
    const sid = () => p.sessionID
    const left = createMemo(() => cacheLeft(sid(), now()))
    const age = createMemo(() => {
      const s = shared()
      return s ? Math.floor((now() - s.at) / 60000) : 0
    })
    const variants = createMemo(() => ui.model.variant.list())
    const variant = createMemo(() => ui.model.current()?.variant)
    const draft = createMemo(() => shownDraft())
    return (
      <box gap={1}>
        <box flexDirection="row" gap={1}>
          <text fg={theme.text.base}>
            <b>{NAME}</b>
          </text>
          <text fg={theme.text.muted}>{`v${version}`}</text>
          <Show when={mem.latest && newerThan(mem.latest, version)}>
            <Click label={`${tr().updateAvail} v${mem.latest}`} fg={YELLOW} onClick={() => void selfUpdate()} />
          </Show>
        </box>
        <Show when={limits().length > 0}>
          <box>
            <text fg={theme.text.base}>
              <b>Claude</b>
              <Show when={age() >= 5}>
                <span style={{ fg: theme.text.muted }}>{` · ${tr().ago(age())}`}</span>
              </Show>
            </text>
            <For each={limits().slice(0, 3)}>
              {l => {
                const n = () => Math.round(Math.min(l.percentUsed, 100) / 10)
                return (
                  <text>
                    <span style={{ fg: theme.text.muted }}>{`${shortName(l.kind)} `}</span>
                    <span style={{ fg: tone(l.percentUsed) }}>{"━".repeat(n())}</span>
                    <span style={{ fg: theme.text.muted }}>{"─".repeat(10 - n())}</span>
                    <span style={{ fg: tone(l.percentUsed) }}>{` ${Math.round(l.percentUsed)}%`}</span>
                    <Show when={l.resetsAt}>
                      <span style={{ fg: theme.text.muted }}>{` ↻ ${resetIn(l.resetsAt, now())}`}</span>
                    </Show>
                  </text>
                )
              }}
            </For>
          </box>
        </Show>
        <Show when={left() !== undefined}>
          <text fg={cacheColor(left() ?? 0)}>{cacheText(left() ?? 0)}</text>
        </Show>
        <box>
          <Show
            when={mem.timer.at > 0}
            fallback={
              <>
                <box flexDirection="row">
                  <text fg={theme.text.base}>{"⏰ "}</text>
                  <Click label={two(draft().h)} onClick={() => nudge("h", 1)} onScroll={d => nudge("h", d)} />
                  <text fg={theme.text.muted}>{" : "}</text>
                  <Click label={two(draft().m)} onClick={() => nudge("m", 1)} onScroll={d => nudge("m", d)} />
                  <text>{"  "}</text>
                  <Click label={tr().sendBtn} fg={GREEN} onClick={() => arm(sid())} />
                </box>
                <Click label={`«${mem.timer.text || tr().defaultText}»`} fg={theme.text.muted} onClick={() => void editText()} />
              </>
            }
          >
            <box flexDirection="row">
              <text fg={YELLOW}>{`⏰ ${two(new Date(mem.timer.at).getHours())} : ${two(new Date(mem.timer.at).getMinutes())}  `}</text>
              <Click label={tr().cancelBtn} fg={theme.text.muted} onClick={() => setMem(s => void (s.timer = { ...s.timer, at: 0 }))} />
            </box>
            <text fg={theme.text.muted}>{`«${mem.timer.text || tr().defaultText}» · ${tr().via} ${resetIn(new Date(mem.timer.at).toISOString(), now())}`}</text>
          </Show>
        </box>
        <box flexDirection="row" gap={2}>
          <Click label="☰ Sessions" fg="#b678e0" onClick={() => keymap.dispatch("session.list")} />
          <Click label="⟲ Resume" fg={GREEN} onClick={() => void resume(sid())} />
          <Click label="⇊ Compact" fg="#4f9cf0" onClick={() => void compact(sid())} />
        </box>
        <box>
          <Click label={`${modelName()} ▾`} onClick={() => keymap.dispatch("model.list")} />
          <Show when={variants().length > 0}>
            <box flexDirection="row" gap={1}>
              <Click label="◀" fg={theme.text.muted} onClick={() => cycleVariant(-1)} onScroll={d => cycleVariant(-d)} />
              <text fg={theme.text.base}>{variant() ?? "default"}</text>
              <Click label="▶" fg={theme.text.muted} onClick={() => cycleVariant(1)} onScroll={d => cycleVariant(-d)} />
              <text>
                <For each={variants()}>
                  {(v, k) => {
                    const at = () => variants().indexOf(variant() ?? "")
                    const bar = EFFORT_BARS[Math.min(EFFORT_BARS.length - 1, Math.round((k() * (EFFORT_BARS.length - 1)) / Math.max(1, variants().length - 1)))]
                    return <span style={{ fg: k() <= at() ? GREEN : theme.text.muted }}>{bar}</span>
                  }}
                </For>
              </text>
            </box>
          </Show>
        </box>
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
