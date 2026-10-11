import { expect, mock, test } from 'claude-code/testing'

const PANE = { title: 't', isFocused: false, bodyColumns: 24, placement: 'dock', scroll: { offset: 0, bodyRows: 40 }, view: {} } as const

async function run($: any, on: any, clock: any, idleMin: number, model: string, effort: string) {
  const ran: string[] = []
  let current = model
  on('session.model', () => ({ value: current }))
  on('settings.read', () => ({ value: { effortLevel: effort } }))
  on('session.usage', () => ({ value: { startedAt: 0, context: { window: 1 }, rateLimits: [] } }))
  on('tool.register', (_$: any, e: any) => ({ value: { tool: e.name } }))
  on('command.register', (_$: any, e: any) => ({ value: { command: e.name } }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('ui.panes', () => ({ value: [] }))
  on('session.start', (_$: any, e: any) => ({ cwd: e.cwd }))
  on('turn.start', (_$: any, e: any) => ({ turnId: e.turnId }))
  on('turn.complete', () => ({ text: '' }))
  on('command.run', (_$: any, e: any) => {
    ran.push(`${e.command} ${e.args}`.trim())
    if (e.command === 'model') current = e.args === 'haiku' ? 'claude-haiku-5-5' : e.args === 'opus' ? 'claude-opus-5-5' : e.args
    return { text: e.command === 'effort' ? `Set effort level to ${e.args} (this session only): x` : `Set model to ${e.args}` }
  })
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  const pane = await $.ui.mount({ plugin: 'ClauDiscobombulating', surface: 'terminal', component: 'Pane', requestId: 'ClauDiscobombulating', props: PANE })
  await $.turn.start({ text: 'hi', turnId: 't1' })
  await $.turn.complete({ answer: 'ok', durationMs: 1, isAborted: false, turnId: 't1', reason: 'answer' })
  await clock.advance(idleMin * 60000)
  ran.length = 0
  await pane.press({ key: 'compact' })
  return ran
}

test('compact on cache hit: effort low, compact, effort back', { timeoutMs: 20000 }, async ($, on) => {
  const clock = mock.clock(on, { now: 1_000_000 })
  expect(await run($, on, clock, 10, 'claude-opus-5-5', 'xhigh')).toEqual(['effort low', 'compact', 'effort xhigh'])
})

test('compact on cache miss: haiku medium, compact, model and effort back', { timeoutMs: 20000 }, async ($, on) => {
  const clock = mock.clock(on, { now: 1_000_000 })
  expect(await run($, on, clock, 61, 'claude-opus-5-5', 'xhigh')).toEqual(['model haiku', 'effort medium', 'compact', 'model opus', 'effort xhigh'])
})

test('compact on cache miss while already on haiku raises effort to medium and restores it', { timeoutMs: 20000 }, async ($, on) => {
  const clock = mock.clock(on, { now: 1_000_000 })
  expect(await run($, on, clock, 61, 'claude-haiku-5-5', 'low')).toEqual(['effort medium', 'compact', 'effort low'])
})

test('compact on cache hit while on haiku: effort low, effort back', { timeoutMs: 20000 }, async ($, on) => {
  const clock = mock.clock(on, { now: 1_000_000 })
  expect(await run($, on, clock, 10, 'claude-haiku-5-5', 'high')).toEqual(['effort low', 'compact', 'effort high'])
})

