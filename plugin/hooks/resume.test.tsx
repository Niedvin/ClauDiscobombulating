import { expect, mock, test } from 'claude-code/testing'

const PANE = { title: 't', isFocused: false, bodyColumns: 24, placement: 'dock', scroll: { offset: 0, bodyRows: 40 }, view: {} } as const

async function boot($: any, on: any, answer: string, limits: any[] = [], tokens = 300000) {
  const sent: string[] = []
  const asked: string[] = []
  const ran: string[] = []
  on('session.model', () => ({ value: 'claude-opus-5-5' }))
  on('settings.read', () => ({ value: {} }))
  on('session.usage', () => ({ value: { startedAt: 0, context: { tokens, window: 1000000 }, rateLimits: limits } }))
  on('env.get', (_$: any, e: any) => ({ value: e.name === 'CLAUDISCOBOMBULATING_LANG' ? 'uk' : undefined }))
  on('tool.register', (_$: any, e: any) => ({ value: { tool: e.name } }))
  on('command.register', (_$: any, e: any) => ({ value: { command: e.name } }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('ui.panes', () => ({ value: [] }))
  on('session.start', (_$: any, e: any) => ({ cwd: e.cwd }))
  on('turn.start', (_$: any, e: any) => ({ turnId: e.turnId }))
  on('turn.complete', () => ({ text: '' }))
  on('command.run', (_$: any, e: any) => {
    ran.push(e.command)
    return {}
  })
  on('prompt.submit', (_$: any, e: any) => {
    sent.push(e.text)
    return { text: e.text }
  })
  on('tool.call', { tool: 'AskUserQuestion' }, (_$: any, e: any) => {
    const q = e.questions[0].question as string
    asked.push(q)
    return { result: { questions: e.questions, answers: { [q]: answer } } }
  })
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  const pane = await $.ui.mount({ plugin: 'ClauDiscobombulating', surface: 'terminal', component: 'Pane', requestId: 'ClauDiscobombulating', props: PANE })
  return { sent, asked, ran, pane }
}

async function finishTurn($: any) {
  await $.turn.start({ text: 'hi', turnId: 't1' })
  await $.turn.complete({ answer: 'ok', durationMs: 1, isAborted: false, turnId: 't1', reason: 'answer' })
}

test('resume: cache hit sends "--resume" without asking', { timeoutMs: 20000 }, async ($, on) => {
  const clock = mock.clock(on, { now: 1_000_000 })
  const { sent, asked, pane } = await boot($, on, 'Продовжити')
  await finishTurn($)
  await clock.advance(10 * 60000)
  await pane.press({ key: 'resume' })
  expect(asked).toEqual([])
  expect(sent).toEqual(['--resume'])
})

test('resume: cache miss asks, continues on yes, stops on no', { timeoutMs: 20000 }, async ($, on) => {
  const clock = mock.clock(on, { now: 1_000_000 })
  const yes = await boot($, on, 'Продовжити')
  await finishTurn($)
  await clock.advance(61 * 60000)
  await yes.pane.press({ key: 'resume' })
  expect(yes.asked.length).toBe(1)
  expect(yes.asked[0]).toContain('Cache miss')
  expect(yes.sent).toEqual(['--resume'])
})

test('resume: cache miss declined sends nothing', { timeoutMs: 20000 }, async ($, on) => {
  const clock = mock.clock(on, { now: 1_000_000 })
  const no = await boot($, on, 'Скасувати')
  await finishTurn($)
  await clock.advance(61 * 60000)
  await no.pane.press({ key: 'resume' })
  expect(no.asked.length).toBe(1)
  expect(no.sent).toEqual([])
})

test('resume: cache miss right after a compact sends without asking', { timeoutMs: 20000 }, async ($, on) => {
  const clock = mock.clock(on, { now: 1_000_000 })
  on('session.compact', () => ({ messages: [{ role: 'assistant', text: 'summary', toolUses: [] }] }))
  const { sent, asked, pane } = await boot($, on, 'Продовжити')
  await finishTurn($)
  await $.session.compact({ trigger: 'manual', messages: [{ role: 'user', text: 'hi', toolUses: [] }] })
  await clock.advance(61 * 60000)
  await pane.press({ key: 'resume' })
  expect(asked).toEqual([])
  expect(sent).toEqual(['--resume'])
})

test('resume: cache miss at a 99% limit sends without asking', { timeoutMs: 20000 }, async ($, on) => {
  const clock = mock.clock(on, { now: 1_000_000 })
  const { sent, asked, pane } = await boot($, on, 'Продовжити', [{ kind: 'five_hour', percentUsed: 99 }])
  await finishTurn($)
  await clock.advance(61 * 60000)
  await pane.press({ key: 'resume' })
  expect(asked).toEqual([])
  expect(sent).toEqual(['--resume'])
})

test('resume: cache miss under 200k tokens sends without asking', { timeoutMs: 20000 }, async ($, on) => {
  const clock = mock.clock(on, { now: 1_000_000 })
  const { sent, asked, pane } = await boot($, on, 'Продовжити', [], 150000)
  await finishTurn($)
  await clock.advance(61 * 60000)
  await pane.press({ key: 'resume' })
  expect(asked).toEqual([])
  expect(sent).toEqual(['--resume'])
})

test('sessions button opens /resume picker', { timeoutMs: 20000 }, async ($, on) => {
  const { ran, sent, pane } = await boot($, on, 'Продовжити')
  await pane.press({ key: 'sessions' })
  expect(ran).toEqual(['resume'])
  expect(sent).toEqual([])
})

test('pane order: timer on top, then Sessions, Compact, Resume', { timeoutMs: 20000 }, async ($, on) => {
  mock.clock(on)
  const { pane } = await boot($, on, 'Продовжити')
  const s = JSON.stringify(await pane.drawn())
  const at = (w: string) => s.indexOf(w)
  expect(at('⏰')).toBeGreaterThan(-1)
  expect(at('⏰')).toBeLessThan(at('Sessions'))
  expect(at('Sessions')).toBeLessThan(at('Compact'))
  expect(at('Compact')).toBeLessThan(at('Resume'))
  expect(at('Resume')).toBeLessThan(at('Opus'))
})

