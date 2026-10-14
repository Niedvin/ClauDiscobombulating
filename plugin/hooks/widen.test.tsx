import { expect, mock, test } from 'claude-code/testing'

const USAGE = { startedAt: 0, context: { tokens: 46200, window: 200000, percent: 23 }, rateLimits: [] }

function setup(on: any, panes: { id: string; isPlaced: boolean; isShown: boolean }[], runs: { env?: Record<string, string> }[]) {
  on('session.model', () => ({ value: 'claude-opus-5-5' }))
  on('settings.read', () => ({ value: {} }))
  on('session.usage', () => ({ value: USAGE }))
  on('env.get', (_$: any, e: any) => ({ value: e.name === 'CLAUDISCOBOMBULATING_LANG' ? 'uk' : e.name === 'OS' ? 'Windows_NT' : undefined }))
  on('tool.register', (_$, e: any) => ({ value: { tool: e.name } }))
  on('command.register', (_$, e: any) => ({ value: { command: e.name } }))
  on('ui.open', () => ({ value: { isPlaced: panes[0]?.isPlaced === true } }))
  on('ui.panes', () => ({ value: panes }))
  on('process.run', (_$, e: any) => {
    runs.push({ env: e.init?.env })
    return { value: { exitCode: 0, stdout: '', stderr: '' } }
  })
  on('session.start', (_$, e: any) => ({ cwd: e.cwd }))
  on('session.attach', (_$, e: any) => ({ clientId: e.clientId }))
  on('turn.start', (_$, e: any) => ({ turnId: e.turnId }))
  on('turn.complete', () => ({ text: '' }))
  on('command.run', () => ({}))
}

test('terminal: the pane waits unplaced, so the mod grows the console to the dock width', { timeoutMs: 30000 }, async ($, on) => {
  const clock = mock.clock(on, { now: 1_000_000 })
  const runs: { env?: Record<string, string> }[] = []
  const panes = [{ id: 'ClauDiscobombulating', isPlaced: false, isShown: false }]
  setup(on, panes, runs)
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await clock.advance(200)
  expect(runs.length).toBe(1)
  expect(runs[0]?.env?.CDB_WIDEN).toBe('144')
  expect(runs[0]?.env?.CDB_ROWS).toBe('40')
  expect(String(runs[0]?.env?.CDB_CS)).toContain('SetConsoleWindowInfo')
  expect(String(runs[0]?.env?.CDB_CS)).toContain('WriteConsoleW')
  panes[0]!.isPlaced = true
  panes[0]!.isShown = true
  await clock.advance(2000)
  expect(runs.length).toBe(1)
})

test('terminal: a placed pane grows nothing', { timeoutMs: 30000 }, async ($, on) => {
  const clock = mock.clock(on, { now: 1_000_000 })
  const runs: { env?: Record<string, string> }[] = []
  const panes = [{ id: 'ClauDiscobombulating', isPlaced: true, isShown: true }]
  setup(on, panes, runs)
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await clock.advance(2000)
  expect(runs.length).toBe(0)
})

test('terminal: a refused widen is tried a capped number of times', { timeoutMs: 60000 }, async ($, on) => {
  const clock = mock.clock(on, { now: 1_000_000 })
  const runs: { env?: Record<string, string> }[] = []
  const panes = [{ id: 'ClauDiscobombulating', isPlaced: false, isShown: false }]
  setup(on, panes, runs)
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await clock.advance(2000)
  expect(runs.map(r => r.env?.CDB_WIDEN)).toEqual(['144'])
  await clock.advance(12 * 60000)
  const seen = runs.map(r => r.env?.CDB_WIDEN)
  expect(seen).toEqual(['144', '144', '144'])
})
