import { expect, mock, test } from 'claude-code/testing'

const PANE = { title: 't', isFocused: false, bodyColumns: 24, placement: 'dock', scroll: { offset: 0, bodyRows: 40 }, view: {} } as const

async function run($: any, on: any, clock: any, idleMin: number, model: string, effort: string, tokens = 300000, confirmation?: { override?: string; failCompact?: boolean }) {
  const ran: string[] = []
  let current = model
  let override = confirmation?.override
  on('env.get', (_$: any, e: any, next: any) => e.name === 'CLAUDE_CODE_EFFORT_LEVEL' ? { value: override } : next(e))
  on('env.set', (_$: any, e: any, next: any) => {
    if (e.name !== 'CLAUDE_CODE_EFFORT_LEVEL') return next(e)
    override = e.value
    return { value: undefined }
  })
  on('session.model', () => ({ value: current }))
  on('settings.read', () => ({ value: { effortLevel: effort } }))
  on('session.usage', () => ({ value: { startedAt: 0, context: { tokens, window: 1000000 }, rateLimits: [] } }))
  on('tool.register', (_$: any, e: any) => ({ value: { tool: e.name } }))
  on('command.register', (_$: any, e: any) => ({ value: { command: e.name } }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('ui.panes', () => ({ value: [] }))
  on('session.start', (_$: any, e: any) => ({ cwd: e.cwd }))
  on('turn.start', (_$: any, e: any) => ({ turnId: e.turnId }))
  on('turn.complete', () => ({ text: '' }))
  on('command.run', (_$: any, e: any) => {
    if (confirmation && e.command === 'effort' && override !== e.args) {
      ran.push(`confirmation ${e.args}`)
      throw new Error('Cached effort needs confirmation')
    }
    if (confirmation && e.command === 'compact') {
      expect(override).toBe(confirmation.override)
      if (confirmation.failCompact) throw new Error('Compaction failed')
    }
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
  if (confirmation) expect(override).toBe(confirmation.override)
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

test('compact on a cache miss under 200k tokens is a plain cheap compact', { timeoutMs: 20000 }, async ($, on) => {
  const clock = mock.clock(on, { now: 1_000_000 })
  expect(await run($, on, clock, 61, 'claude-opus-5-5', 'xhigh', 150000)).toEqual(['effort low', 'compact', 'effort xhigh'])
})

test('compact confirms cached effort changes and restores the original effort', { timeoutMs: 20000 }, async ($, on) => {
  const clock = mock.clock(on, { now: 1_000_000 })
  expect(await run($, on, clock, 10, 'claude-opus-5-5', 'xhigh', 300000, {})).toEqual(['effort low', 'compact', 'effort xhigh'])
})

test('compact preserves an existing effort override across both effort changes', { timeoutMs: 20000 }, async ($, on) => {
  const clock = mock.clock(on, { now: 1_000_000 })
  expect(await run($, on, clock, 61, 'claude-opus-5-5', 'xhigh', 300000, { override: 'xhigh' })).toEqual(['model haiku', 'effort medium', 'compact', 'model opus', 'effort xhigh'])
})

test('failed compact still confirms effort restoration and removes its override', { timeoutMs: 20000 }, async ($, on) => {
  const clock = mock.clock(on, { now: 1_000_000 })
  expect(await run($, on, clock, 10, 'claude-opus-5-5', 'xhigh', 300000, { failCompact: true })).toEqual(['effort low', 'effort xhigh'])
})
