import { spawn } from "node:child_process";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import type { ModApi } from "@commandcode/harness";

const PANE_ID = "pane";
const CONTINUE = "continue";
const MAX_SESSIONS = 15;
const HEAD_BYTES = 64 * 1024;

const EN = {
	timer: "Timer",
	context: "Context",
	sessions: "Sessions",
	compact: "Compact",
	resume: "Resume",
	hours: "+1h",
	minutes: "+5m",
	armed: (t: string) => `Timer set for ${t}`,
	sent: "Sent “continue”",
	queued: "“continue” queued for after this turn",
	compactDone: "Compaction finished",
	compactFailed: (m: string) => `Compaction failed: ${m}`,
	pick: "Resume a session",
	noSessions: "No saved sessions for this folder",
	resumeCmd: "Resume with",
	copied: "Command copied to the clipboard",
	copyFailed: "Copy the command by hand",
	notMeasured: "not measured yet",
	unavailable: (m: string) => `Unavailable: ${m}`,
};
const UK: typeof EN = {
	timer: "Таймер",
	context: "Контекст",
	sessions: "Sessions",
	compact: "Compact",
	resume: "Resume",
	hours: "+1 год",
	minutes: "+5 хв",
	armed: (t: string) => `Таймер на ${t}`,
	sent: "Надіслано «continue»",
	queued: "«continue» піде після поточної відповіді",
	compactDone: "Стиснення завершено",
	compactFailed: (m: string) => `Стиснення не вдалося: ${m}`,
	pick: "Продовжити сесію",
	noSessions: "Немає збережених сесій для цієї папки",
	resumeCmd: "Продовжити командою",
	copied: "Команду скопійовано",
	copyFailed: "Скопіюйте команду вручну",
	notMeasured: "ще не виміряно",
	unavailable: (m: string) => `Недоступно: ${m}`,
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

function clock(sec: number): string {
	const total = Math.max(0, Math.round(sec));
	const h = Math.floor(total / 3600);
	const m = Math.floor((total % 3600) / 60);
	const s = total % 60;
	const pad = (n: number) => String(n).padStart(2, "0");
	return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${m}:${pad(s)}`;
}

function kTok(n: number | null | undefined): string {
	if (typeof n !== "number" || !Number.isFinite(n)) return "?";
	return n >= 1000 ? `${Math.round(n / 100) / 10}k` : String(n);
}

function readVersion(dir: string | undefined): string {
	if (!dir) return "";
	try {
		const pkg = JSON.parse(readFileSync(join(dir, "package.json"), "utf8"));
		return typeof pkg.version === "string" ? pkg.version : "";
	} catch {
		return "";
	}
}

function readHead(file: string, bytes = HEAD_BYTES): string {
	try {
		return readFileSync(file, "utf8").slice(0, bytes);
	} catch {
		return "";
	}
}

// Command Code's project folder: camelCase split, lowercase, every other run of junk to "-" — 2026-11-03
function slug(cwd: string): string {
	return cwd
		.replace(/([a-z0-9])([A-Z])/g, "$1-$2")
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, "-")
		.replace(/^-+|-+$/g, "");
}

const samePath = (a: string, b: string) =>
	a.replace(/[\\/]+$/, "").toLowerCase() === b.replace(/[\\/]+$/, "").toLowerCase();

function stamp(ms: number): string {
	const d = new Date(ms);
	const pad = (n: number) => String(n).padStart(2, "0");
	return `${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function clip(text: string, max: number): string {
	const clean = text.replace(/\s+/g, " ").trim();
	return clean.length > max ? `${clean.slice(0, max - 1)}…` : clean;
}

function textOf(content: unknown): string {
	if (typeof content === "string") return content;
	if (!Array.isArray(content)) return "";
	return content
		.filter((p: any) => p && p.type === "text" && typeof p.text === "string")
		.map((p: any) => p.text as string)
		.join(" ");
}

function titleOf(dir: string, id: string): string {
	try {
		const meta = JSON.parse(readFileSync(join(dir, `${id}.meta.json`), "utf8"));
		if (typeof meta.title === "string" && meta.title.trim()) return meta.title.trim();
	} catch {}
	for (const line of readHead(join(dir, `${id}.jsonl`)).split("\n")) {
		if (!line.trim()) continue;
		try {
			const row = JSON.parse(line);
			if (row?.type !== "message" || row?.message?.role !== "user") continue;
			const text = textOf(row.message.content);
			if (text.trim()) return text;
		} catch {}
	}
	return "";
}

function projectDir(root: string, cwd: string): string | undefined {
	const direct = join(root, slug(cwd));
	if (existsSync(direct)) return direct;
	try {
		for (const name of readdirSync(root)) {
			const dir = join(root, name);
			const file = readdirSync(dir).find(f => f.endsWith(".jsonl") && !f.endsWith(".checkpoints.jsonl"));
			if (!file) continue;
			const first = readHead(join(dir, file), 4096).split("\n")[0] ?? "";
			try {
				if (samePath(String(JSON.parse(first).cwd ?? ""), cwd)) return dir;
			} catch {}
		}
	} catch {}
	return undefined;
}

export default function (cmd: ModApi): void {
	let tr = EN;
	const version = readVersion(typeof __dirname === "string" ? __dirname : join(cmd.cwd ?? "", "commandcode"));
	const timer = () => ({
		h: cmd.state.get<number>("tH") ?? 0,
		m: cmd.state.get<number>("tM") ?? 0,
		deadline: cmd.state.get<number>("tDeadline") ?? 0,
	});

	const toast = (text: string, level: "info" | "success" | "warning" | "error" = "info") =>
		cmd.ui.toast(text, { level });

	const btn = (key: string, label: string, hotkey: string, onPress: () => void) => ({ type: "button", key, label, hotkey, onPress });

	const fail = (e: unknown) => (e instanceof Error ? e.message : String(e));

	function sendContinue(): void {
		try {
			if (cmd.isIdle()) cmd.sendUserMessage(CONTINUE);
			else {
				cmd.queueMessage({ content: CONTINUE, deliverAs: "follow-up" });
				toast(tr.queued);
				return;
			}
			toast(tr.sent, "success");
		} catch (e) {
			toast(tr.unavailable(fail(e)), "error");
		}
	}

	function nudge(seconds: number, hours: boolean): void {
		const t = timer();
		if (t.deadline > Date.now()) {
			cmd.state.set("tDeadline", t.deadline + seconds * 1000);
			return;
		}
		if (hours) cmd.state.set("tH", (t.h + 1) % 10);
		else cmd.state.set("tM", (t.m + 5) % 60);
	}

	function armOrSend(): void {
		const t = timer();
		const now = Date.now();
		if (t.deadline > now) {
			cmd.state.set("tDeadline", 0);
			sendContinue();
			return;
		}
		const total = t.h * 3600 + t.m * 60;
		if (total <= 0) {
			sendContinue();
			return;
		}
		cmd.state.set("tDeadline", now + total * 1000);
		toast(tr.armed(clock(total)));
	}

	function tick(): void {
		const now = Date.now();
		cmd.state.set("now", now);
		const t = timer();
		if (t.deadline && t.deadline <= now) {
			cmd.state.set("tDeadline", 0);
			sendContinue();
		}
	}

	function compact(): void {
		try {
			cmd.sessions.compact().then(
				() => toast(tr.compactDone, "success"),
				e => toast(tr.compactFailed(fail(e)), "error"),
			);
		} catch (e) {
			toast(tr.compactFailed(fail(e)), "error");
		}
	}

	function sessions(cwd: string): { id: string; label: string }[] {
		const dir = projectDir(join(homedir(), ".commandcode", "projects"), cwd);
		if (!dir) return [];
		try {
			return readdirSync(dir)
				.filter(f => f.endsWith(".jsonl") && !f.endsWith(".checkpoints.jsonl"))
				.map(f => ({ id: f.slice(0, -".jsonl".length), mtime: statSync(join(dir, f)).mtimeMs }))
				.sort((a, b) => b.mtime - a.mtime)
				.slice(0, MAX_SESSIONS)
				.map(s => ({ id: s.id, label: `${stamp(s.mtime)}  ${clip(titleOf(dir, s.id) || s.id, 48)}` }));
		} catch {
			return [];
		}
	}

	async function openSessions(): Promise<void> {
		const list = sessions(cmd.cwd);
		if (!list.length) {
			toast(tr.noSessions, "warning");
			return;
		}
		const picked = await cmd.ui.select({ title: tr.pick, options: list.map(s => ({ label: s.label, value: s.id })) });
		if (!picked) return;
		// No ModApi call switches sessions; hand over the one command that does — 2026-11-03
		const line = `cmdc --resume ${picked}`;
		cmd.ui.notify(`${tr.resumeCmd}: ${line}`, "info");
		const copied = await cmd.ui.copy(line);
		toast(copied.isCopied ? tr.copied : `${tr.copyFailed}: ${line}`, copied.isCopied ? "success" : "info");
	}

	function usageNode(): any {
		const none = { type: "text", text: `${tr.context} · ${tr.notMeasured}`, dim: true };
		try {
			const usage = cmd.getContextUsage();
			if (!usage || usage.percent === null || usage.percent === undefined) return none;
			const pct = Math.max(0, Math.min(100, Math.round(usage.percent)));
			return { type: "progress", label: `${tr.context} ${kTok(usage.tokens)}/${kTok(usage.contextWindow)}`, value: pct / 100, width: 10 };
		} catch {
			return none;
		}
	}

	function build(): any[] {
		const t = timer();
		const armed = t.deadline > Date.now();
		const left = armed ? Math.ceil((t.deadline - Date.now()) / 1000) : t.h * 3600 + t.m * 60;
		const pill = `${armed ? "■" : "▶"} ${left > 0 ? clock(left) : CONTINUE}  alt+t`;
		return [
			{ type: "text", text: `✳ ClauDiscobombulating ${version}`.trim(), bold: true, color: "magenta" },
			{
				type: "box",
				title: tr.timer,
				children: [
					{ type: "row", children: [btn("t-h", tr.hours, "1", () => nudge(3600, true)), btn("t-m", tr.minutes, "5", () => nudge(300, false))] },
					btn("t-go", pill, "t", armOrSend),
				],
			},
			btn("sessions", `☰ ${tr.sessions}  alt+s`, "s", () => { void openSessions().catch(e => toast(fail(e), "error")); }),
			btn("compact", `⇊ ${tr.compact}  alt+c`, "c", compact),
			btn("resume", `⟲ ${tr.resume}  alt+r`, "r", sendContinue),
			usageNode(),
		];
	}

	cmd.ui.pane({ id: PANE_ID, title: "ClauDiscobombulating", render: () => build() });
	cmd.clock.every(1000, tick);
	cmd.hooks({ onSessionStart: () => { cmd.ui.openPane(PANE_ID); } });

	void detectUk().then(isUk => {
		if (!isUk) return;
		tr = UK;
		cmd.state.set("lang", "uk");
	});
}
