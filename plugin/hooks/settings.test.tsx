import { expect, mock, test } from 'claude-code/testing'

const PANE = { title: 't', isFocused: false, bodyColumns: 38, placement: 'dock', scroll: { offset: 0, bodyRows: 40 }, view: {} } as const

// find() drops hover, which the drawing keeps beside props — 2026-11-03
const at = (tree: any, key: string): any => {
  if (tree?.type === 'Button' && tree?.props?.key === key) return tree
  for (const child of tree?.children ?? []) {
    const hit = at(child, key)
    if (hit) return hit
  }
  return undefined
}

function stub(on: any) {
  const store: Record<string, unknown> = {}
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
  return store
}

test('pane: the gear opens settings, the auto-compact row stores false, back returns', { timeoutMs: 20000 }, async ($, on) => {
  const clock = mock.clock(on, { now: 1_000_000 })
  const store = stub(on)
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await clock.advance(1100)
  const pane = await $.ui.mount({ plugin: 'ClauDiscobombulating', surface: 'terminal', component: 'Pane', requestId: 'ClauDiscobombulating', props: PANE })
  const text = async () => JSON.stringify(await pane.drawn())
  expect(await text()).toContain('Таймер')
  expect(await text()).not.toContain('Налаштування')

  await pane.press({ key: 'gear' })
  let s = await text()
  expect(s).toContain('Налаштування')
  expect(s).toContain('Авто compact 99%')
  expect(s).toContain('Сповіщення про версії')
  expect(s).toContain('Тихе оновлення')
  expect(s).toContain('○ вимк')
  expect(s).not.toContain('Таймер')
  expect(s).not.toContain('Sessions')

  await pane.press({ key: 'set-autoCompact' })
  s = await text()
  expect(store.autoCompact).toBe(false)
  expect(s).toContain('○ вимк')

  await pane.press({ key: 'settings-back' })
  s = await text()
  expect(s).not.toContain('Налаштування')
  expect(s).toContain('Таймер')

  await pane.press({ key: 'gear' })
  await pane.press({ key: 'gear' })
  expect(await text()).not.toContain('Налаштування')
})

test('settings rows: one hover scope and one inside-width text per row, and the border glyph presses it', { timeoutMs: 20000 }, async ($, on) => {
  const clock = mock.clock(on, { now: 1_000_000 })
  const store = stub(on)
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await clock.advance(1100)
  const pane = await $.ui.mount({ plugin: 'ClauDiscobombulating', surface: 'terminal', component: 'Pane', requestId: 'ClauDiscobombulating', props: PANE })
  await pane.press({ key: 'gear' })

  const inside = 38 - 2
  const drawn = async () => (await pane.drawn()) as any
  for (const key of ['set-autoCompact', 'set-updateNotify', 'set-silentUpdate']) {
    expect(at(await drawn(), key)?.hover).toEqual({ scope: key, inverse: true })
    const row = await pane.find({ type: 'Button', key })
    expect(row?.text.length).toBe(inside)
    for (const side of ['bl', 'br']) {
      expect(at(await drawn(), `${key}-${side}`)?.hover).toEqual({ scope: key, inverse: true })
      expect((await pane.find({ type: 'Button', key: `${key}-${side}` }))?.text).toBe('│')
    }
  }
  const back = await pane.find({ type: 'Button', key: 'settings-back' })
  expect(back?.text.length).toBe(inside)
  expect(at(await drawn(), 'settings-back')?.hover).toEqual({ scope: 'set-back', inverse: true })
  expect(at(await drawn(), 'settings-back-br')?.hover).toEqual({ scope: 'set-back', inverse: true })

  expect(store.autoCompact).toBeUndefined()
  await pane.press({ key: 'set-autoCompact-bl' })
  expect(store.autoCompact).toBe(false)
  expect(JSON.stringify(await pane.drawn())).toContain('○ вимк')
  await pane.press({ key: 'set-autoCompact-br' })
  expect(store.autoCompact).toBe(true)
  expect(JSON.stringify(await pane.drawn())).toContain('● увімк')

  await pane.press({ key: 'settings-back-bl' })
  expect(JSON.stringify(await pane.drawn())).not.toContain('Налаштування')
})
