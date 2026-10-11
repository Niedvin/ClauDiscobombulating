import { expect, mock, test } from 'claude-code/testing'

const BAND = { hasSurvey: false, isWorking: false, maxRows: 20, bodyColumns: 100, scroll: { offset: 0, bodyRows: 20 }, view: {} }

async function band($: any, on: any, env: Record<string, string>, stdout = '') {
  const clock = mock.clock(on, { now: 1_000_000 })
  const spawned: string[] = []
  const toasts: string[] = []
  on('session.usage', () => ({ value: { startedAt: 0, context: { window: 1 }, rateLimits: [{ kind: 'five_hour', percentUsed: 8 }, { kind: 'seven_day', percentUsed: 74 }] } }))
  on('env.get', (_$: any, e: any) => ({ value: env[e.name] }))
  on('process.run', (_$: any, e: any) => {
    spawned.push(e.argv[0])
    return { value: { exitCode: 0, stdout, stderr: '' } }
  })
  on('ui.toast', (_$: any, e: any) => {
    toasts.push(e.text)
    return { value: undefined }
  })
  on('session.start', (_$: any, e: any) => ({ cwd: e.cwd }))
  on('session.attach', (_$: any, e: any) => ({ clientId: e.clientId }))
  on('turn.start', (_$: any, e: any) => ({ turnId: e.turnId }))
  on('turn.complete', () => ({ text: '' }))
  await $.session.start({ cwd: '/', surface: null, isInteractive: false })
  await $.session.attach({ surface: 'desktop', clientId: 'desktop:default' })
  await $.turn.start({ text: 'hi', turnId: 't1' })
  await $.turn.complete({ answer: 'ok', durationMs: 1, isAborted: false, turnId: 't1', reason: 'answer' })
  await clock.advance(6 * 60000)
  const mounted = await $.ui.mount({ plugin: 'ClauDiscobombulating', surface: 'desktop', component: 'AbovePrompt', props: BAND })
  return { text: JSON.stringify(await mounted.drawn()), spawned, toasts }
}

test('english system: units and words in English', { timeoutMs: 20000 }, async ($, on) => {
  const { text } = await band($, on, { LANG: 'en_US.UTF-8' })
  expect(text).toContain('cache 54m')
  expect(text).toContain('5h')
  expect(text).toContain('7d')
  expect(text).not.toContain('кеш')
})

test('ukrainian LANG keeps the ukrainian text', { timeoutMs: 20000 }, async ($, on) => {
  const { text } = await band($, on, { LANG: 'uk_UA.UTF-8' })
  expect(text).toContain('кеш 54хв')
  expect(text).toContain('5г')
})

test('windows reads the display language from powershell, ignoring LANG', { timeoutMs: 20000 }, async ($, on) => {
  const uk = await band($, on, { OS: 'Windows_NT', LANG: 'en_US.UTF-8' }, 'uk-UA\r\n')
  expect(uk.spawned).toContain('powershell.exe')
  expect(uk.text).toContain('кеш 54хв')
})

test('windows with an english display language', { timeoutMs: 20000 }, async ($, on) => {
  const en = await band($, on, { OS: 'Windows_NT' }, 'en-US\r\n')
  expect(en.text).toContain('cache 54m')
})

test('CLAUDISCOBOMBULATING_LANG overrides detection', { timeoutMs: 20000 }, async ($, on) => {
  const { text, spawned } = await band($, on, { CLAUDISCOBOMBULATING_LANG: 'uk', LANG: 'en_US.UTF-8' })
  expect(spawned).toEqual([])
  expect(text).toContain('кеш 54хв')
})

test('nothing detectable falls back to english', { timeoutMs: 20000 }, async ($, on) => {
  const { text } = await band($, on, {})
  expect(text).toContain('cache 54m')
})

