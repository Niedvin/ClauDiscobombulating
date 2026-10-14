import { expect, mock, test } from 'claude-code/testing'

const BAND = { hasSurvey: false, isWorking: false, maxRows: 20, bodyColumns: 100, scroll: { offset: 0, bodyRows: 20 }, view: {} }

test('desktop app (start surface null, then attach): only limits and cache', { timeoutMs: 20000 }, async ($, on) => {
  const clock = mock.clock(on, { now: 1_000_000 })
  const calls: string[] = []
  on('session.usage', () => ({ value: {
    startedAt: 0,
    context: { window: 200000 },
    rateLimits: [
      { kind: 'five_hour', percentUsed: 8, resetsAt: new Date(Date.now() + 3 * 3600000).toISOString() },
      { kind: 'seven_day', percentUsed: 74 },
    ],
  } }))
  on('env.get', (_$: any, e: any) => ({ value: e.name === 'CLAUDISCOBOMBULATING_LANG' ? 'uk' : undefined }))
  on('session.start', (_$, e) => ({ cwd: e.cwd }))
  on('session.attach', (_$, e) => ({ clientId: e.clientId }))
  on('turn.start', (_$, e) => ({ turnId: e.turnId }))
  on('turn.complete', () => ({ text: '' }))
  on('command.run', (_$, e) => {
    calls.push(`command ${e.command}`)
    return {}
  })
  on('command.register', (_$, e) => {
    calls.push(`register ${e.name}`)
    return { value: { command: e.name } }
  })
  on('tool.register', (_$, e) => {
    calls.push(`tool ${e.name}`)
    return { value: { tool: e.name } }
  })
  on('ui.open', () => {
    calls.push('open')
    return { value: { isPlaced: true } }
  })
  on('ui.render', { component: 'SessionMode' }, ($, e) => {
    const { Text } = $.ui.resolve(e)
    return <Text>FOOTER</Text>
  })
  await $.session.start({ cwd: '/', surface: null, isInteractive: false })
  await $.session.attach({ surface: 'desktop', clientId: 'desktop:default' })
  await $.turn.start({ text: 'hi', turnId: 't1' })
  await $.turn.complete({ answer: 'ok', durationMs: 1, isAborted: false, turnId: 't1', reason: 'answer' })
  await clock.advance(6 * 60000)

  const band = await $.ui.mount({ plugin: 'ClauDiscobombulating', surface: 'desktop', component: 'AbovePrompt', props: BAND })
  const s = JSON.stringify(await band.drawn())
  expect(s).toContain('кеш 54хв')
  expect(s).toContain('5г')
  expect(s).toContain('7д')
  expect(s).toContain('"74"')
  expect(s).toContain('↻')
  expect(s).not.toContain('Opus')

  const mode = await $.ui.mount({ plugin: 'ClauDiscobombulating', surface: 'desktop', component: 'SessionMode', props: { modes: [] } })
  expect(JSON.stringify(await mode.drawn())).toContain('FOOTER')
  expect(calls).toEqual([])
})

test('desktop compact button: effort low, compact, effort back', { timeoutMs: 20000 }, async ($, on) => {
  const clock = mock.clock(on, { now: 1_000_000 })
  const ran: string[] = []
  on('session.usage', () => ({ value: { startedAt: 0, context: { window: 1 }, rateLimits: [{ kind: 'five_hour', percentUsed: 8 }] } }))
  on('env.get', (_$: any, e: any) => ({ value: e.name === 'CLAUDISCOBOMBULATING_LANG' ? 'uk' : undefined }))
  on('session.start', (_$, e) => ({ cwd: e.cwd }))
  on('session.model', () => ({ value: 'claude-opus-5-5' }))
  on('settings.read', () => ({ value: { effortLevel: 'xhigh' } }))
  on('command.run', (_$, e) => {
    ran.push(`${e.command} ${e.args}`.trim())
    return { text: e.command === 'effort' ? `Set effort level to ${e.args} (this session only): x` : '' }
  })
  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  await clock.advance(1100)
  const band = await $.ui.mount({ plugin: 'ClauDiscobombulating', surface: 'desktop', component: 'AbovePrompt', props: BAND })
  await band.press({ key: 'compact' })
  expect(ran).toEqual(['effort low', 'compact', 'effort xhigh'])
})

test('resumed session before a response: context from the local estimate', { timeoutMs: 20000 }, async ($, on) => {
  mock.clock(on, { now: 1_000_000 })
  on('session.usage', (_$: any, e: any) => ({ value: {
    startedAt: 0,
    context: { window: 200000, ...(e?.breakdown ? { breakdown: { totalTokens: 84000 } } : {}) },
    rateLimits: [],
  } }))
  on('env.get', (_$: any, e: any) => ({ value: e.name === 'CLAUDISCOBOMBULATING_LANG' ? 'uk' : undefined }))
  on('session.start', (_$, e) => ({ cwd: e.cwd }))
  on('ui.render', { component: 'PromptHint' }, ($, e) => {
    const { Text } = $.ui.resolve(e)
    return <Text>HINT</Text>
  })
  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  const hint = await $.ui.mount({ plugin: 'ClauDiscobombulating', surface: 'desktop', component: 'PromptHint', props: { hint: '' } })
  expect(JSON.stringify(await hint.drawn())).toContain('≈84k/200k')
})

test('fresh session: shared limits stay through an empty measure', { timeoutMs: 20000 }, async ($, on) => {
  const clock = mock.clock(on, { now: 1_000_000 })
  on('session.usage', () => ({ value: { startedAt: 0, context: { window: 1 }, rateLimits: [] } }))
  on('env.get', (_$: any, e: any) => ({ value: e.name === 'CLAUDISCOBOMBULATING_LANG' ? 'uk' : e.name === 'USERPROFILE' || e.name === 'HOME' ? '/home' : undefined }))
  on('session.start', (_$, e) => ({ cwd: e.cwd }))
  on('fs.read', (_$: any, e: any, next: any) =>
    e.path.endsWith('ClauDiscobombulating-limits.json') ? { value: JSON.stringify({ at: 5, limits: [{ kind: 'seven_day', percentUsed: 63 }] }) } : next(e),
  )
  on('session.measure', (_$, e) => ({ changed: e.changed }))
  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  await clock.advance(1100)
  await $.session.measure({ context: { window: 1 }, rateLimits: [], changed: ['context'] })
  await clock.advance(1100)
  const band = await $.ui.mount({ plugin: 'ClauDiscobombulating', surface: 'desktop', component: 'AbovePrompt', props: BAND })
  expect(JSON.stringify(await band.drawn())).toContain('"63"')
})
