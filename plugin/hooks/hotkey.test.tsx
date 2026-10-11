import { expect, mock, test } from 'claude-code/testing'

const BAND = { hasSurvey: false, isWorking: false, maxRows: 20, bodyColumns: 120, scroll: { offset: 0, bodyRows: 20 }, view: {} }
const PANE = { title: 't', isFocused: false, bodyColumns: 24, placement: 'dock', scroll: { offset: 0, bodyRows: 40 }, view: {} } as const

function stub(on: any, placed: boolean) {
  const ran: string[] = []
  on('session.model', () => ({ value: 'claude-opus-5-5' }))
  on('settings.read', () => ({ value: { effortLevel: 'high' } }))
  on('session.usage', () => ({ value: { startedAt: 0, context: { window: 1 }, rateLimits: [] } }))
  on('env.get', (_$: any, e: any) => ({ value: e.name === 'CLAUDISCOBOMBULATING_LANG' ? 'en' : undefined }))
  on('tool.register', (_$: any, e: any) => ({ value: { tool: e.name } }))
  on('command.register', (_$: any, e: any) => ({ value: { command: e.name } }))
  on('ui.open', () => ({ value: { isPlaced: placed } }))
  on('ui.panes', () => ({ value: placed ? [{ id: 'ClauDiscobombulating', isPlaced: true, isShown: true }] : [] }))
  on('session.start', (_$: any, e: any) => ({ cwd: e.cwd }))
  on('command.run', (_$: any, e: any) => {
    ran.push(`${e.command} ${e.args ?? ''}`.trim())
    return { text: e.command === 'effort' ? `Set effort level to ${e.args}` : '' }
  })
  return ran
}

test('band drawn before full mode redraws with the ctrl+t effort buttons', { timeoutMs: 20000 }, async ($, on) => {
  const clock = mock.clock(on, { now: 1_000_000 })
  stub(on, false)
  on('ui.render', { component: 'AbovePrompt' }, ($: any, e: any) => {
    const { Text } = $.ui.resolve(e)
    return <Text>ENGINE</Text>
  })
  const band = await $.ui.mount({ plugin: 'ClauDiscobombulating', surface: 'terminal', component: 'AbovePrompt', props: BAND })
  expect(await band.find({ key: 'e-next' })).toBeUndefined()
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await clock.advance(1100)
  expect(JSON.stringify(await band.find({ key: 'e-next' }))).toContain('pane:next')
  expect(JSON.stringify(await band.find({ key: 'e-prev' }))).toContain('pane:previous')
})

test('open pane carries the ctrl+t effort buttons', { timeoutMs: 20000 }, async ($, on) => {
  const clock = mock.clock(on, { now: 1_000_000 })
  const ran = stub(on, true)
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await clock.advance(1100)
  const pane = await $.ui.mount({ plugin: 'ClauDiscobombulating', surface: 'terminal', component: 'Pane', requestId: 'ClauDiscobombulating', props: PANE })
  expect(JSON.stringify(await pane.find({ key: 'e-next' }))).toContain('pane:next')
  expect(JSON.stringify(await pane.find({ key: 'e-prev' }))).toContain('pane:previous')
  await pane.press({ key: 'e-next' })
  await clock.advance(800)
  expect(ran).toContain('effort xhigh')
})
