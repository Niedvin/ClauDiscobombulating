import { expect, mock, test } from 'claude-code/testing'

const BAND = { hasSurvey: false, isWorking: false, maxRows: 20, bodyColumns: 100, scroll: { offset: 0, bodyRows: 20 }, view: {} }
const PANE = { title: 't', isFocused: false, bodyColumns: 38, placement: 'dock' as const, scroll: { offset: 0, bodyRows: 40 }, view: {} }

function setup(on: any, usage: { tokens: number; window: number }) {
  on('session.model', () => ({ value: 'claude-opus-5-5' }))
  on('settings.read', () => ({ value: {} }))
  on('session.usage', () => ({ value: { startedAt: 0, context: { ...usage }, rateLimits: [] } }))
  on('env.get', (_$: any, e: any) => ({ value: e.name === 'CLAUDISCOBOMBULATING_LANG' ? 'uk' : undefined }))
  on('tool.register', (_$: any, e: any) => ({ value: { tool: e.name } }))
  on('command.register', (_$: any, e: any) => ({ value: { command: e.name } }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('ui.panes', () => ({ value: [] }))
  on('session.start', (_$: any, e: any) => ({ cwd: e.cwd }))
  on('turn.start', (_$: any, e: any) => ({ turnId: e.turnId }))
  on('turn.complete', () => ({ text: '' }))
  on('command.run', () => ({}))
}

const drawn = async (ui: { drawn: () => Promise<unknown> }) => JSON.stringify(await ui.drawn())

test('terminal: a click on the context counter counts tokens in full, colored by size, and back', { timeoutMs: 30000 }, async ($, on) => {
  const clock = mock.clock(on, { now: 1_000_000 })
  const usage = { tokens: 46200, window: 1000000 }
  setup(on, usage)
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await clock.advance(1100)
  const band = await $.ui.mount({ plugin: 'ClauDiscobombulating', surface: 'terminal', component: 'AbovePrompt', props: BAND })
  expect(await drawn(band)).toContain('46k/1M')
  await band.press({ key: 'ctx' })
  await clock.advance(5000)
  let s = await drawn(band)
  expect(s).toContain('46 200')
  expect(s).toContain('#14ff00')
  usage.tokens = 600000
  await clock.advance(6000)
  s = await drawn(band)
  expect(s).toContain('600 000')
  expect(s).toContain('#ffff00')
  usage.tokens = 900000
  await clock.advance(6000)
  s = await drawn(band)
  expect(s).toContain('900 000')
  expect(s).toContain('#ff0000')
  await band.press({ key: 'ctx' })
  expect(await drawn(band)).toContain('900k/1M')
})

test('terminal: the full count grows while the reply streams, then takes the step usage', { timeoutMs: 30000 }, async ($, on) => {
  const clock = mock.clock(on, { now: 1_000_000 })
  setup(on, { tokens: 46200, window: 1000000 })
  let release = () => {}
  const gate = new Promise<void>(r => (release = r))
  const usage = { input_tokens: 200, cache_read_input_tokens: 46000, cache_creation_input_tokens: 0, output_tokens: 150, model: 'claude-opus-5-5' }
  on('turn.step', async function* (_$: any, e: any) {
    yield { kind: 'text', index: 0, text: 'a'.repeat(400) }
    await gate
    yield { kind: 'stop', stopReason: 'end_turn', usage }
    return { turnId: e.turnId, index: e.index, answer: 'a', toolUses: [], stopReason: 'end_turn', usage }
  })
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await clock.advance(1100)
  const band = await $.ui.mount({ plugin: 'ClauDiscobombulating', surface: 'terminal', component: 'AbovePrompt', props: BAND })
  await band.press({ key: 'ctx' })
  await clock.advance(5000)
  const stream = $.turn.step({ turnId: 't1', index: 0, model: 'claude-opus-5-5', messageCount: 1 })
  await stream.next()
  await clock.advance(3000)
  expect(await drawn(band)).toContain('46 300')
  release()
  while (!(await stream.next()).done) {}
  await clock.advance(3000)
  expect(await drawn(band)).toContain('46 350')
})

test('terminal: a row appended to the context counts at once, the next step usage takes it over', { timeoutMs: 30000 }, async ($, on) => {
  const clock = mock.clock(on, { now: 1_000_000 })
  setup(on, { tokens: 46200, window: 1000000 })
  const usage = { input_tokens: 200, cache_read_input_tokens: 47000, cache_creation_input_tokens: 0, output_tokens: 50, model: 'claude-opus-5-5' }
  on('turn.step', async function* (_$: any, e: any) {
    yield { kind: 'stop', stopReason: 'end_turn', usage }
    return { turnId: e.turnId, index: e.index, answer: '', toolUses: [], stopReason: 'end_turn', usage }
  })
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await clock.advance(1100)
  const band = await $.ui.mount({ plugin: 'ClauDiscobombulating', surface: 'terminal', component: 'AbovePrompt', props: BAND })
  await band.press({ key: 'ctx' })
  await clock.advance(5000)
  await $.session.append({ message: { type: 'user', role: 'user', content: [{ type: 'tool_result', tool_use_id: 'r1', content: 'a'.repeat(4000) }] }, door: 'tool-result', origin: { kind: 'tool', tool: 'Read' }, uuid: 'u1' })
  await clock.advance(3000)
  expect(await drawn(band)).toContain('47 200')
  const stream = $.turn.step({ turnId: 't1', index: 0, model: 'claude-opus-5-5', messageCount: 2 })
  while (!(await stream.next()).done) {}
  await clock.advance(3000)
  expect(await drawn(band)).toContain('47 250')
})

test('terminal: a smaller step usage never drops the count mid-turn, only after it', { timeoutMs: 30000 }, async ($, on) => {
  const clock = mock.clock(on, { now: 1_000_000 })
  setup(on, { tokens: 46200, window: 1000000 })
  let release = () => {}
  const gate = new Promise<void>(r => (release = r))
  const usage = { input_tokens: 200, cache_read_input_tokens: 46000, cache_creation_input_tokens: 0, output_tokens: 100, model: 'claude-opus-5-5' }
  on('turn.step', async function* (_$: any, e: any) {
    yield { kind: 'text', index: 0, text: 'a'.repeat(4000) }
    await gate
    yield { kind: 'stop', stopReason: 'end_turn', usage }
    return { turnId: e.turnId, index: e.index, answer: 'a', toolUses: [], stopReason: 'end_turn', usage }
  })
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await clock.advance(1100)
  const band = await $.ui.mount({ plugin: 'ClauDiscobombulating', surface: 'terminal', component: 'AbovePrompt', props: BAND })
  await band.press({ key: 'ctx' })
  await clock.advance(5000)
  await $.turn.start({ text: 'hi', turnId: 't1' })
  const stream = $.turn.step({ turnId: 't1', index: 0, model: 'claude-opus-5-5', messageCount: 1 })
  await stream.next()
  await clock.advance(3000)
  expect(await drawn(band)).toContain('47 200')
  release()
  while (!(await stream.next()).done) {}
  await clock.advance(3000)
  let s = await drawn(band)
  expect(s).toContain('47 200')
  expect(s).not.toContain('46 300')
  await $.turn.complete({ answer: 'ok', durationMs: 1, isAborted: false, turnId: 't1', reason: 'answer' })
  await clock.advance(3000)
  s = await drawn(band)
  expect(s).toContain('46 300')
  expect(s).not.toContain('47 200')
})

test('terminal: a click on the name dances 15 s on a Raster, then the pane fades back in', { timeoutMs: 30000 }, async ($, on) => {
  const clock = mock.clock(on, { now: 1_000_000 })
  setup(on, { tokens: 46200, window: 1000000 })
  const blits: { key: string; cells: string }[] = []
  on('ui.blit', (_$: any, e: any) => {
    blits.push(e)
    return { value: {} }
  })
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await clock.advance(1100)
  const pane = await $.ui.mount({ plugin: 'ClauDiscobombulating', surface: 'terminal', component: 'Pane', requestId: 'ClauDiscobombulating', props: PANE })
  expect(await drawn(pane)).toContain('Таймер')
  await pane.press({ key: 'name' })
  let s = await drawn(pane)
  expect(s).toContain('"dance"')
  expect(s).not.toContain('Таймер')
  await clock.advance(11000)
  expect(blits.length).toBeGreaterThan(100)
  const rows = 39
  expect(blits.every(b => b.key === 'dance' && b.cells.length === Math.ceil((38 * rows * 12) / 3) * 4)).toBe(true)
  await pane.unmount()
  const late = await $.ui.mount({ plugin: 'ClauDiscobombulating', surface: 'terminal', component: 'Pane', requestId: 'ClauDiscobombulating', props: PANE })
  expect(await drawn(late)).toContain('"dance"')
  await clock.advance(2800)
  await late.unmount()
  const boom = await $.ui.mount({ plugin: 'ClauDiscobombulating', surface: 'terminal', component: 'Pane', requestId: 'ClauDiscobombulating', props: PANE })
  expect(await drawn(boom)).toContain('"dance"')
  await clock.advance(1700)
  s = await drawn(boom)
  expect(s).not.toContain('"dance"')
  expect(s).toContain('Таймер')
  expect(s).not.toContain('#3fbf8f')
  await clock.advance(600)
  expect(await drawn(boom)).toContain('#3fbf8f')
  const done = blits.length
  await clock.advance(2000)
  expect(blits.length).toBe(done)
})
