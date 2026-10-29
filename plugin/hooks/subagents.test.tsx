import { expect, mock, test } from 'claude-code/testing'

const PANE_PROPS = { title: 't', isFocused: false, bodyColumns: 38, placement: 'dock', scroll: { offset: 0, bodyRows: 40 }, view: {} } as const
const USAGE = { input_tokens: 10, cache_read_input_tokens: 0, cache_creation_input_tokens: 0, output_tokens: 5, model: 'claude-opus-5-5' }
// the call's types leave agentId out; the engine takes it riding along — 2026-10-15
const toolCall = ($: any, input: Record<string, unknown>) => $.tool.call(input) as Promise<unknown>

test('pane: the subagents box follows spawn, step, tool and completion', { timeoutMs: 20000 }, async ($, on) => {
  const clock = mock.clock(on, { now: 1_000_000 })
  on('session.model', () => ({ value: 'claude-opus-5-5' }))
  on('settings.read', () => ({ value: {} }))
  on('session.usage', () => ({ value: { startedAt: 0, context: { window: 1 }, rateLimits: [] } }))
  on('env.get', (_$: any, e: any) => ({ value: e.name === 'CLAUDISCOBOMBULATING_LANG' ? 'uk' : undefined }))
  on('tool.register', (_$, e) => ({ value: { tool: e.name } }))
  on('command.register', (_$, e) => ({ value: { command: e.name } }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('ui.panes', () => ({ value: [] }))
  on('session.start', (_$, e) => ({ cwd: e.cwd }))
  on('agent.spawn', () => ({ model: 'claude-opus-5-5', agentId: 'a1' }))
  on('agent.list', () => ({ value: [] }))
  on('turn.step', async function* (_$: any, e: any) {
    yield { kind: 'text', index: 0, text: 'hi' }
    yield { kind: 'stop', stopReason: 'end_turn', usage: USAGE }
    return { turnId: e.turnId, index: e.index, answer: 'hi', toolUses: [], stopReason: 'end_turn', usage: USAGE }
  })
  on('turn.complete', () => ({ text: '' }))
  let release = () => {}
  const gate = new Promise<void>(r => (release = r))
  on('tool.call', async () => {
    await gate
    return { result: {} }
  })
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  const pane = await $.ui.mount({ plugin: 'ClauDiscobombulating', surface: 'terminal', component: 'Pane', requestId: 'ClauDiscobombulating', props: PANE_PROPS })
  const text = async () => JSON.stringify(await pane.drawn())
  expect(await text()).not.toContain('Субагенти')

  await $.agent.spawn({
    tool_use_id: 'tu1',
    prompt: 'read the repo',
    description: 'read',
    subagentType: 'Explore',
    provider: { plugin: 'engine', tier: 'core' },
    parentModel: 'claude-opus-5-5',
    background: true,
    fork: false,
  })
  await clock.advance(300)
  expect(await text()).toContain('Субагенти')
  expect(await text()).toContain('Opus 5.5')
  expect(await text()).toContain('стартує')

  const step = $.turn.step({ turnId: 't1', index: 0, model: 'claude-sonnet-4-5', effort: 'high', messageCount: 1, agentId: 'a1' })
  await step.next()
  expect(await text()).toContain('Sonnet 4.5')
  expect(await text()).toContain('"high"')
  expect(await text()).toContain('пише')
  while (!(await step.next()).done) {}
  expect(await text()).toContain('пише')

  const call = toolCall($, { tool: 'Read', file_path: 'C:/work/src/thing.ts', agentId: 'a1' })
  await clock.advance(100)
  expect(await text()).toContain('Read thing.ts')
  release()
  await call
  await clock.advance(100)
  expect(await text()).toContain('думає')
  expect(await text()).not.toContain('thing.ts')

  await $.turn.complete({ answer: 'done', durationMs: 1, isAborted: false, turnId: 't1', reason: 'answer', agentId: 'a1' })
  await clock.advance(600)
  expect(await text()).toContain('Готово')
  expect(await text()).not.toContain('думає')
  await clock.advance(2000)
  expect(await text()).not.toContain('Субагенти')
})

test('pane: a loop id the agent list does not name never draws', { timeoutMs: 20000 }, async ($, on) => {
  mock.clock(on, { now: 1_000_000 })
  on('session.model', () => ({ value: 'claude-opus-5-5' }))
  on('settings.read', () => ({ value: {} }))
  on('session.usage', () => ({ value: { startedAt: 0, context: { window: 1 }, rateLimits: [] } }))
  on('env.get', (_$: any, e: any) => ({ value: e.name === 'CLAUDISCOBOMBULATING_LANG' ? 'uk' : undefined }))
  on('tool.register', (_$, e) => ({ value: { tool: e.name } }))
  on('command.register', (_$, e) => ({ value: { command: e.name } }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('ui.panes', () => ({ value: [] }))
  on('session.start', (_$, e) => ({ cwd: e.cwd }))
  on('agent.list', () => ({ value: [] }))
  on('turn.step', async function* (_$: any, e: any) {
    yield { kind: 'stop', stopReason: 'end_turn', usage: USAGE }
    return { turnId: e.turnId, index: e.index, answer: '', toolUses: [], stopReason: 'end_turn', usage: USAGE }
  })
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  const pane = await $.ui.mount({ plugin: 'ClauDiscobombulating', surface: 'terminal', component: 'Pane', requestId: 'ClauDiscobombulating', props: PANE_PROPS })
  const stream = $.turn.step({ turnId: 't1', index: 0, model: 'claude-opus-5-5', messageCount: 1, agentId: 'engine-fork' })
  while (!(await stream.next()).done) {}
  expect(JSON.stringify(await pane.drawn())).not.toContain('Субагенти')
})
