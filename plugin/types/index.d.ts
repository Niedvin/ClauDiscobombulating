export type Limit = { kind: string; percentUsed: number; resetsAt?: string }
export type Live = { model: string; effort: string }
export type Pending = { model: string; effort: string }
export type Timer = { at: number; text: string }
export type Draft = { h: number; m: number; isSet: boolean }
export type Context = { tokens: number; window: number; percent: number }
export type Counted = { n: number; prev: number }

declare module 'claude-code' {
  interface PluginState {
    'ClauDiscobombulating': { limits: Limit[]; live: Live; pending: Pending; flag: string; log: string[]; latest: string; paneUp: boolean; timer: Timer; draft: Draft; showResetAt: boolean; cacheLeft: number; activeAt: number; alerted: number; compactedFor: string; compactedAt: number; sinceCompact: number; context: Context; full: boolean; minute: number; countMode: boolean; counted: Counted; dance: number; reveal: number }
  }
}

