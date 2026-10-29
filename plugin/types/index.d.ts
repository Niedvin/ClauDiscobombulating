export type Limit = { kind: string; percentUsed: number; resetsAt?: string }
export type Live = { model: string; effort: string }
export type Pending = { model: string; effort: string }
export type AgentLive = { model: string; effort: string; line: string; cli?: string; log?: string; done?: number; frame?: number; born?: number }
export type Timer = { at: number; text: string }
export type Draft = { h: number; m: number; isSet: boolean }
export type Context = { tokens: number; window: number; percent: number; isGuess?: boolean }
export type Counted = { n: number; prev: number }
export type Tree = { dir: string; dirs: string[]; drives: string[]; step: number; mode: 'closed' | 'open' | 'closing'; top: number }

declare module 'claude-code' {
  interface PluginState {
    'ClauDiscobombulating': { limits: Limit[]; live: Live; pending: Pending; agents: Record<string, AgentLive>; flag: string; log: string[]; latest: string; paneUp: boolean; timer: Timer; draft: Draft; showResetAt: boolean; cacheLeft: number; activeAt: number; alerted: number; compactedFor: string; compactedAt: number; sinceCompact: number; context: Context; full: boolean; minute: number; countMode: boolean; counted: Counted; dance: number; reveal: number; tree: Tree; cwd: string; agentsTop: number; grow: number }
  }
}

