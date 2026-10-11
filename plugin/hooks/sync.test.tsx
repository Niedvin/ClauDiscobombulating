import { expect, mock, test } from 'claude-code/testing'


test('terminal pane: cards draw with saved effort', { timeoutMs: 20000 }, async ($, on) => {
  const clock = mock.clock(on)
  const ran: string[] = []
  on('session.model', () => ({ value: 'claude-opus-5-5' }))
  on('settings.read', (_$, e) => ({ value: e.source === 'flag' ? {} : { effortLevel: 'low' } }))
  on('session.usage', () => ({ value: { startedAt: 0, context: { window: 1 }, rateLimits: [{ kind: 'five_hour', percentUsed: 91 }] } }))
  on('env.get', (_$: any, e: any) => ({ value: e.name === 'CLAUDISCOBOMBULATING_LANG' ? 'uk' : undefined }))
  on('tool.register', (_$, e) => ({ value: { tool: e.name } }))
  on('command.register', (_$, e) => ({ value: { command: e.name } }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('session.start', (_$, e) => ({ cwd: e.cwd }))
  on('command.run', (_$, e) => {
    ran.push(`${e.command} ${e.args}`.trim())
    return {}
  })
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  const band = await $.ui.mount({
    plugin: 'ClauDiscobombulating',
    surface: 'terminal',
    component: 'Pane',
    requestId: 'ClauDiscobombulating',
    props: { title: 't', isFocused: false, bodyColumns: 24, placement: 'dock', scroll: { offset: 0, bodyRows: 40 }, view: {} },
  })
  const s = JSON.stringify(await band.drawn())
  expect(s).toContain('Opus 5.5')
  expect(s).toContain('"low"')
  const mode = await $.ui.mount({ plugin: 'ClauDiscobombulating', surface: 'terminal', component: 'SessionMode', props: { modes: [] } })
  expect(JSON.stringify(await mode.drawn())).toContain('━━━━━━━━━')
})

for (const surface of ['terminal', 'desktop'] as const) {
test(`cache timer on ${surface}: 55 down to 0, terminal hides first 5 min`, { timeoutMs: 20000 }, async ($, on) => {
  const clock = mock.clock(on, { now: 1_000_000 })
  on('session.model', () => ({ value: 'claude-opus-5-5' }))
  on('settings.read', () => ({ value: {} }))
  on('session.usage', () => ({ value: { startedAt: 0, context: { window: 1 }, rateLimits: [{ kind: 'five_hour', percentUsed: 10 }] } }))
  on('env.get', (_$: any, e: any) => ({ value: e.name === 'CLAUDISCOBOMBULATING_LANG' ? 'uk' : undefined }))
  on('tool.register', (_$, e) => ({ value: { tool: e.name } }))
  on('command.register', (_$, e) => ({ value: { command: e.name } }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('ui.panes', () => ({ value: [] }))
  on('session.start', (_$, e) => ({ cwd: e.cwd }))
  on('turn.start', (_$, e) => ({ turnId: e.turnId }))
  on('turn.complete', () => ({ text: '' }))
  await $.session.start({ cwd: '/', surface, isInteractive: true })
  const mode = await $.ui.mount(
    surface === 'desktop'
      ? { plugin: 'ClauDiscobombulating', surface, component: 'AbovePrompt', props: { hasSurvey: false, isWorking: false, maxRows: 20, bodyColumns: 100, scroll: { offset: 0, bodyRows: 20 }, view: {} } }
      : { plugin: 'ClauDiscobombulating', surface, component: 'SessionMode', props: { modes: [] } },
  )
  const text = async () => JSON.stringify(await mode.drawn())
  expect(await text()).not.toContain('кеш')

  await $.turn.start({ text: 'hi', turnId: 't1' })
  await $.turn.complete({ answer: 'ok', durationMs: 1, isAborted: false, turnId: 't1', reason: 'answer' })
  await clock.advance(4 * 60000)
  if (surface === 'desktop') expect(await text()).toContain('кеш 56хв')
  else expect(await text()).not.toContain('кеш')

  await clock.advance(2 * 60000)
  expect(await text()).toContain('кеш 54хв')

  await clock.advance(53 * 60000)
  expect(await text()).toContain('кеш 1хв')

  await clock.advance(10 * 60000)
  expect(await text()).toContain('⚠ Cache Miss')

  await $.turn.start({ text: 'hi', turnId: 't2' })
  await clock.advance(2000)
  expect(await text()).not.toContain('кеш')
})
}

test('cache timer restarts at a compact', { timeoutMs: 20000 }, async ($, on) => {
  const clock = mock.clock(on, { now: 1_000_000 })
  on('session.model', () => ({ value: 'claude-opus-5-5' }))
  on('settings.read', () => ({ value: {} }))
  on('session.usage', () => ({ value: { startedAt: 0, context: { window: 1 }, rateLimits: [{ kind: 'five_hour', percentUsed: 10 }] } }))
  on('env.get', (_$: any, e: any) => ({ value: e.name === 'CLAUDISCOBOMBULATING_LANG' ? 'uk' : undefined }))
  on('tool.register', (_$, e) => ({ value: { tool: e.name } }))
  on('command.register', (_$, e) => ({ value: { command: e.name } }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('ui.panes', () => ({ value: [] }))
  on('session.start', (_$, e) => ({ cwd: e.cwd }))
  on('turn.start', (_$, e) => ({ turnId: e.turnId }))
  on('turn.complete', () => ({ text: '' }))
  on('session.compact', () => ({ messages: [{ role: 'assistant', text: 'summary', toolUses: [] }] }))
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  const mode = await $.ui.mount({ plugin: 'ClauDiscobombulating', surface: 'terminal', component: 'SessionMode', props: { modes: [] } })
  const text = async () => JSON.stringify(await mode.drawn())
  await $.turn.start({ text: 'hi', turnId: 't1' })
  await $.turn.complete({ answer: 'ok', durationMs: 1, isAborted: false, turnId: 't1', reason: 'answer' })
  await clock.advance(61 * 60000)
  expect(await text()).toContain('⚠ Cache Miss')

  await $.session.compact({ trigger: 'manual', messages: [{ role: 'user', text: 'hi', toolUses: [] }] })
  await clock.advance(60000)
  expect(await text()).not.toContain('Cache Miss')
  await clock.advance(9 * 60000)
  expect(await text()).toContain('кеш 50хв')
})

