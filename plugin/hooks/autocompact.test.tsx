import { expect, mock, test } from 'claude-code/testing'

async function setup($: any, on: any, busy: boolean, startPct = 96) {
  const ran: string[] = []
  on('session.model', () => ({ value: 'claude-opus-5-5' }))
  on('settings.read', () => ({ value: { effortLevel: 'high' } }))
  on('session.usage', () => ({ value: { startedAt: 0, context: { window: 1 }, rateLimits: [{ kind: 'five_hour', percentUsed: startPct }] } }))
  on('session.start', (_$: any, e: any) => ({ cwd: e.cwd }))
  on('session.attach', (_$: any, e: any) => ({ clientId: e.clientId }))
  on('session.measure', (_$: any, e: any) => ({ changed: e.changed }))
  on('turn.start', (_$: any, e: any) => ({ turnId: e.turnId }))
  on('turn.complete', () => ({ text: '' }))
  on('turn.abort', (_$: any, e: any) => {
    ran.push(`abort ${e.turnId}`)
    // engine skips a hook that returns neither { value } nor { deny } — 2026-10-10
    return { value: undefined }
  })
  on('ui.toast', () => ({ value: undefined }))
  on('env.get', () => ({ value: undefined }))
  on('command.run', (_$: any, e: any) => {
    ran.push(`${e.command} ${e.args}`.trim())
    return { text: e.command === 'effort' ? `Set effort level to ${e.args} (this session only): x` : 'ok' }
  })
  await $.session.start({ cwd: '/', surface: null, isInteractive: false })
  await $.session.attach({ surface: 'desktop', clientId: 'desktop:default' })
  if (busy) await $.turn.start({ text: 'work', turnId: 't1' })
  return ran
}

const measure = (pct: number, resetsAt = '2030-01-01T00:00:00Z') => ({
  context: { window: 1 },
  rateLimits: [{ kind: 'five_hour', percentUsed: pct, resetsAt }],
  changed: ['rateLimits' as const],
})

test('99% mid-turn: abort the turn, then compact once per window', { timeoutMs: 20000 }, async ($, on) => {
  const clock = mock.clock(on, { now: 1_000_000 })
  const ran = await setup($, on, true)
  await $.session.measure(measure(98))
  await clock.advance(3000)
  expect(ran).toEqual([])

  await $.session.measure(measure(99))
  await clock.advance(3000)
  expect(ran).toEqual(['abort t1', 'effort low', 'compact', 'effort high'])

  await $.session.measure(measure(100))
  await clock.advance(3000)
  expect(ran.length).toBe(4)
})

test('check cadence follows the last seen percent: below 75% waits 5 min', { timeoutMs: 20000 }, async ($, on) => {
  const clock = mock.clock(on, { now: 1_000_000 })
  const ran = await setup($, on, false, 50)
  await $.session.measure(measure(99))
  await clock.advance(120000)
  expect(ran).toEqual([])
  await clock.advance(200000)
  expect(ran).toEqual(['effort low', 'compact', 'effort high'])
})

test('99% while idle: compact without abort', { timeoutMs: 20000 }, async ($, on) => {
  const clock = mock.clock(on, { now: 1_000_000 })
  const ran = await setup($, on, false)
  await $.session.measure(measure(99))
  await clock.advance(3000)
  expect(ran).toEqual(['effort low', 'compact', 'effort high'])
})

test('99% with the 5h reset under 59 min away: no compact', { timeoutMs: 20000 }, async ($, on) => {
  const start = Date.now()
  const clock = mock.clock(on, { now: start })
  const ran = await setup($, on, true)
  await $.session.measure(measure(99, new Date(start + 58 * 60000).toISOString()))
  await clock.advance(3000)
  expect(ran).toEqual([])
})

test('99% with the 5h reset 60 min away: compact', { timeoutMs: 20000 }, async ($, on) => {
  const start = Date.now()
  const clock = mock.clock(on, { now: start })
  const ran = await setup($, on, false)
  await $.session.measure(measure(99, new Date(start + 60 * 60000).toISOString()))
  await clock.advance(3000)
  expect(ran).toEqual(['effort low', 'compact', 'effort high'])
})

const summary = [{ role: 'assistant', text: 'summary', toolUses: [] }] as const
const prompt = [{ role: 'user', text: 'hi', toolUses: [] }] as const

test('a manual compact within the grace holds the auto compact, after it fires', { timeoutMs: 20000 }, async ($, on) => {
  const clock = mock.clock(on, { now: 1_000_000 })
  on('session.compact', () => ({ messages: summary }))
  const ran = await setup($, on, false)
  await $.session.compact({ trigger: 'manual', messages: prompt })
  await $.session.measure(measure(99))
  await clock.advance(3000)
  expect(ran).toEqual([])

  await clock.advance(600001)
  expect(ran).toEqual(['effort low', 'compact', 'effort high'])
})

test('a skipped compact does not hold the auto compact', { timeoutMs: 20000 }, async ($, on) => {
  const clock = mock.clock(on, { now: 1_000_000 })
  on('session.compact', () => ({ skip: 'nope' }))
  const ran = await setup($, on, false)
  await $.session.compact({ trigger: 'manual', messages: prompt })
  await $.session.measure(measure(99))
  await clock.advance(3000)
  expect(ran).toEqual(['effort low', 'compact', 'effort high'])
})

test('a precompute compact does not hold the auto compact', { timeoutMs: 20000 }, async ($, on) => {
  const clock = mock.clock(on, { now: 1_000_000 })
  on('session.compact', () => ({ messages: summary }))
  const ran = await setup($, on, false)
  await $.session.compact({ trigger: 'precompute', messages: prompt })
  await $.session.measure(measure(99))
  await clock.advance(3000)
  expect(ran).toEqual(['effort low', 'compact', 'effort high'])
})

test('a subagent turn does not clear isBusy: 99% still aborts the main turn', { timeoutMs: 20000 }, async ($, on) => {
  const clock = mock.clock(on, { now: 1_000_000 })
  const ran = await setup($, on, true)
  await $.turn.complete({ answer: '', durationMs: 1, isAborted: false, turnId: 's1', reason: 'answer', agentId: 'a1' })
  await $.session.measure(measure(99))
  await clock.advance(3000)
  expect(ran).toEqual(['abort t1', 'effort low', 'compact', 'effort high'])
})

