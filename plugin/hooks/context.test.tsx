import { expect, mock, test } from 'claude-code/testing'

const BAND = { hasSurvey: false, isWorking: false, maxRows: 20, bodyColumns: 100, scroll: { offset: 0, bodyRows: 20 }, view: {} }
const USAGE = { startedAt: 0, context: { tokens: 46200, window: 200000, percent: 23 }, rateLimits: [] }

function setup(on: any, panes: unknown[] = []) {
  on('session.model', () => ({ value: 'claude-opus-5-5' }))
  on('settings.read', () => ({ value: {} }))
  on('session.usage', () => ({ value: USAGE }))
  on('env.get', (_$: any, e: any) => ({ value: e.name === 'CLAUDISCOBOMBULATING_LANG' ? 'uk' : undefined }))
  on('tool.register', (_$, e: any) => ({ value: { tool: e.name } }))
  on('command.register', (_$, e: any) => ({ value: { command: e.name } }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('ui.panes', () => ({ value: panes }))
  on('session.start', (_$, e: any) => ({ cwd: e.cwd }))
  on('session.attach', (_$, e: any) => ({ clientId: e.clientId }))
  on('turn.start', (_$, e: any) => ({ turnId: e.turnId }))
  on('turn.complete', () => ({ text: '' }))
  on('command.run', () => ({}))
}

test('terminal: the context counter draws above the prompt, beside the pickers', { timeoutMs: 20000 }, async ($, on) => {
  const clock = mock.clock(on, { now: 1_000_000 })
  setup(on)
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await clock.advance(1100)
  const band = await $.ui.mount({ plugin: 'ClauDiscobombulating', surface: 'terminal', component: 'AbovePrompt', props: BAND })
  const s = JSON.stringify(await band.drawn())
  expect(s).toContain('46k/200k')
  expect(s).toContain('Opus 5.5')
})

test('terminal with the pane up: the counter stays, the pickers hide', { timeoutMs: 20000 }, async ($, on) => {
  const clock = mock.clock(on, { now: 1_000_000 })
  setup(on, [{ id: 'ClauDiscobombulating', isPlaced: true, isShown: true }])
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await clock.advance(1100)
  const band = await $.ui.mount({ plugin: 'ClauDiscobombulating', surface: 'terminal', component: 'AbovePrompt', props: BAND })
  const s = JSON.stringify(await band.drawn())
  expect(s).toContain('46k/200k')
  expect(s).not.toContain('Opus 5.5')
})

test('desktop: the context counter draws on the line under the prompt', { timeoutMs: 20000 }, async ($, on) => {
  const clock = mock.clock(on, { now: 1_000_000 })
  setup(on)
  await $.session.start({ cwd: '/', surface: null, isInteractive: false })
  await $.session.attach({ surface: 'desktop', clientId: 'desktop:default' })
  await clock.advance(1100)
  const hint = await $.ui.mount({ plugin: 'ClauDiscobombulating', surface: 'desktop', component: 'PromptHint', props: { isDraft: false, isWorking: false, hint: '? for shortcuts' } })
  const s = JSON.stringify(await hint.drawn())
  expect(s).toContain('? for shortcuts')
  expect(s).toContain('46k/200k')
})

