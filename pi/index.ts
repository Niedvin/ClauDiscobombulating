import { spawn } from "node:child_process";
import { SessionManager, SessionSelectorComponent } from "@earendil-works/pi-coding-agent";
import type { ExtensionAPI, ExtensionCommandContext, Theme } from "@earendil-works/pi-coding-agent";
import { parseColor, truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";
import type { Color, Component, TuiMouseEvent, TuiMouseEventResult } from "@earendil-works/pi-tui";

const CARDS = [
  { kind: "sessions", label: "☰ Sessions", color: parseColor("#b678e0") },
  { kind: "compact", label: "⇊ Compact", color: parseColor("#4f9cf0") },
  { kind: "resume", label: "⟲ Resume", color: parseColor("#3fbf8f") },
] as const;
type CardKind = (typeof CARDS)[number]["kind"];
// 3 cards × 12 cols is the width where a single row no longer fits — 2026-10-29
const ROW_MIN = 36;

const EN = {
  compactDone: "Compaction completed",
  compactFailed: (m: string) => `Compaction failed: ${m}`,
  resumeQueued: "Continue queued for after the current turn",
  pickerNoTui: "The session picker needs interactive mode",
  resumeFailed: (m: string) => `Failed to resume session: ${m}`,
};
const UK: typeof EN = {
  compactDone: "Стиснення завершено",
  compactFailed: (m: string) => `Стиснення не вдалося: ${m}`,
  resumeQueued: "«Продовжити» піде після поточної відповіді",
  pickerNoTui: "Вибір сесії доступний лише в інтерактивному режимі",
  resumeFailed: (m: string) => `Не вдалося відновити сесію: ${m}`,
};

const UK_TAG = /^uk(?![a-z])/i;
const firstTag = (out: string) => /[A-Za-z]{2,3}(?:[-_][A-Za-z0-9]+)?/.exec(out)?.[0] ?? "";

function run(argv: string[]): Promise<string> {
  return new Promise(resolve => {
    try {
      const p = spawn(argv[0], argv.slice(1), { windowsHide: true });
      let out = "";
      const timer = setTimeout(() => p.kill(), 5000);
      p.stdout.on("data", d => (out += String(d)));
      p.on("error", () => { clearTimeout(timer); resolve(""); });
      p.on("close", () => { clearTimeout(timer); resolve(out); });
    } catch {
      resolve("");
    }
  });
}

async function detectUk(): Promise<boolean> {
  const forced = process.env.CLAUDISCOBOMBULATING_LANG;
  if (forced) return UK_TAG.test(forced);
  if (process.platform !== "win32") {
    const e = process.env;
    const set = [e.LC_ALL, e.LC_MESSAGES, e.LANGUAGE, e.LANG].find(v => v && v !== "C" && v !== "POSIX");
    if (set) return UK_TAG.test(set);
  }
  const argv = process.platform === "win32"
    ? ["powershell.exe", "-NoProfile", "-NonInteractive", "-Command", "(Get-UICulture).Name"]
    : ["defaults", "read", "-g", "AppleLanguages"];
  return UK_TAG.test(firstTag(await run(argv)));
}

function center(label: string, inner: number): string {
  const vis = visibleWidth(label);
  if (vis >= inner) return truncateToWidth(label, inner);
  const left = Math.floor((inner - vis) / 2);
  return " ".repeat(left) + label + " ".repeat(inner - vis - left);
}

class ButtonsWidget implements Component {
  private theme: Theme;
  private onPick: (kind: CardKind) => void;
  private cachedWidth: number | undefined;
  private cachedLines: string[] | undefined;
  private layout: { row: boolean; cardW: number } = { row: true, cardW: 0 };

  constructor(theme: Theme, onPick: (kind: CardKind) => void) {
    this.theme = theme;
    this.onPick = onPick;
  }

  private card(color: Color, label: string, w: number): string[] {
    const inner = Math.max(1, w - 2);
    const style = (s: string) => this.theme.style(s, { fg: color });
    return [
      style("╭" + "─".repeat(inner) + "╮"),
      style("│" + center(label, inner) + "│"),
      style("╰" + "─".repeat(inner) + "╯"),
    ];
  }

  render(width: number): string[] {
    if (this.cachedLines && this.cachedWidth === width) return this.cachedLines;
    const w = Math.max(1, width);
    const row = w >= ROW_MIN;
    const cardW = Math.max(1, row ? Math.min(18, Math.floor((w - 2) / 3)) : w);
    this.layout = { row, cardW };
    const cards = CARDS.map(c => this.card(c.color, c.label, cardW));
    const lines = row ? [0, 1, 2].map(i => cards.map(c => c[i]).join(" ")) : cards.flat();
    this.cachedWidth = width;
    this.cachedLines = lines.map(l => truncateToWidth(l, w));
    return this.cachedLines;
  }

  handleMouse(event: TuiMouseEvent): TuiMouseEventResult | undefined {
    if (event.type !== "click" || event.button !== "left") return;
    const { row, cardW } = this.layout;
    let index: number | undefined;
    if (row) {
      if (event.y < 0 || event.y >= 3) return;
      const slot = Math.floor(event.x / (cardW + 1));
      if (slot >= 0 && slot < CARDS.length && event.x < slot * (cardW + 1) + cardW) index = slot;
    } else {
      if (event.y < 0 || event.y >= CARDS.length * 3) return;
      index = Math.floor(event.y / 3);
    }
    if (index === undefined) return;
    this.onPick(CARDS[index].kind);
    return { handled: true };
  }

  invalidate(): void {
    this.cachedWidth = undefined;
    this.cachedLines = undefined;
  }
}

export default function (pi: ExtensionAPI) {
  let tr: typeof EN = EN;
  let langAsked = false;

  async function openPicker(ctx: ExtensionCommandContext) {
    // the TUI's manager is the full class; ReadonlySessionManager omits usesDefaultSessionDir — 2026-10-29
    const sm = ctx.sessionManager as unknown as SessionManager;
    const cwd = sm.getCwd();
    const sessionDir = sm.getSessionDir();
    const usesDefault = sm.usesDefaultSessionDir();
    await ctx.ui.custom<void>((tui, _theme, keybindings, done) => {
      const selector = new SessionSelectorComponent(
        (onProgress, signal) => SessionManager.list(cwd, sessionDir, onProgress, signal),
        (onProgress, signal) => (usesDefault ? SessionManager.listAll(onProgress, signal) : SessionManager.listAll(sessionDir, onProgress, signal)),
        sessionPath => {
          done();
          void ctx.switchSession(sessionPath).catch(e => ctx.ui.notify(tr.resumeFailed(e instanceof Error ? e.message : String(e)), "error"));
        },
        () => { done(); tui.requestRender(); },
        () => { void ctx.shutdown(); },
        () => tui.requestRender(),
        { keybindings },
        sm.getSessionFile(),
      );
      return selector;
    });
  }

  pi.registerCommand("sessions", {
    description: "Pick a session to resume",
    handler: async (_args, ctx) => {
      if (ctx.mode !== "tui") {
        ctx.ui.notify(tr.pickerNoTui, "error");
        return;
      }
      await openPicker(ctx);
    },
  });

  pi.on("session_start", (_event, ctx) => {
    if (ctx.mode !== "tui") return;
    if (!langAsked) {
      langAsked = true;
      void detectUk().then(isUk => { tr = isUk ? UK : EN; });
    }
    ctx.ui.setWidget("claudiscobombulating-buttons", (_tui, theme) => new ButtonsWidget(theme, kind => {
      if (kind === "sessions") {
        // expandPromptTemplates routes a /command through registerCommand handlers — 2026-10-29
        pi.sendUserMessage("/sessions", { expandPromptTemplates: true });
      } else if (kind === "compact") {
        ctx.compact({
          onComplete: () => ctx.ui.notify(tr.compactDone, "info"),
          onError: e => ctx.ui.notify(tr.compactFailed(e.message), "error"),
        });
      } else if (ctx.isIdle()) {
        pi.sendUserMessage("continue");
      } else {
        pi.sendUserMessage("continue", { deliverAs: "followUp" });
        ctx.ui.notify(tr.resumeQueued, "info");
      }
    }), { placement: "belowEditor" });
  });
}
