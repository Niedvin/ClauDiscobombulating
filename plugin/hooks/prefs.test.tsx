import { expect, mock, test } from 'claude-code/testing'

const PANE = { title: 't', isFocused: false, bodyColumns: 38, placement: 'dock', scroll: { offset: 0, bodyRows: 40 }, view: {} } as const

const mark = (drawn: string, label: string) => new RegExp(`${label}[^"]*(○ вимк|● увімк)`).exec(drawn)?.[1]

test('a new session reads the prefs the last one stored, and writes every change back', { timeoutMs: 20000 }, async ($, on) => {
  const clock = mock.clock(on, { now: 1_000_000 })
  const store: Record<string, unknown> = { autoCompact: false, updateNotify: false, silentUpdate: true }
  on('store.get', (_$: any, e: any) => ({ value: store[e.key] }))
  on('store.set', (_$: any, e: any) => {
    store[e.key] = e.value
    return { value: undefined }
  })
  on('session.model', () => ({ value: 'claude-opus-5-5' }))
  on('settings.read', () => ({ value: {} }))
  on('session.usage', () => ({ value: { startedAt: 0, context: { window: 1 }, rateLimits: [] } }))
  on('env.get', (_$: any, e: any) => ({ value: e.name === 'CLAUDISCOBOMBULATING_LANG' ? 'uk' : undefined }))
  on('tool.register', (_$: any, e: any) => ({ value: { tool: e.name } }))
  on('command.register', (_$: any, e: any) => ({ value: { command: e.name } }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('ui.panes', () => ({ value: [] }))
  on('session.start', (_$: any, e: any) => ({ cwd: e.cwd }))
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await clock.advance(1100)

  const pane = await $.ui.mount({ plugin: 'ClauDiscobombulating', surface: 'terminal', component: 'Pane', requestId: 'ClauDiscobombulating', props: PANE })
  await pane.press({ key: 'gear' })
  const rows = async () => JSON.stringify(await pane.drawn())
  let s = await rows()
  expect(mark(s, 'Авто compact 99%')).toBe('○ вимк')
  expect(mark(s, 'Сповіщення про версії')).toBe('○ вимк')
  expect(mark(s, 'Тихе оновлення')).toBe('● увімк')

  await pane.press({ key: 'set-autoCompact' })
  await pane.press({ key: 'set-updateNotify' })
  await pane.press({ key: 'set-silentUpdate' })
  expect(store.autoCompact).toBe(true)
  expect(store.updateNotify).toBe(true)
  expect(store.silentUpdate).toBe(false)
  s = await rows()
  expect(mark(s, 'Авто compact 99%')).toBe('● увімк')
  expect(mark(s, 'Сповіщення про версії')).toBe('● увімк')
  expect(mark(s, 'Тихе оновлення')).toBe('○ вимк')
})
