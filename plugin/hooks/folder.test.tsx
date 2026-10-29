import { expect, mock, test } from 'claude-code/testing'

const PANE = { title: 't', isFocused: false, bodyColumns: 38, placement: 'dock', scroll: { offset: 0, bodyRows: 40 }, view: {} } as const
const dir = (name: string) => ({ name, kind: 'dir' as const, size: 0, mtimeMs: 0, isLink: false })
const slashed = (p: string) => p.replace(/\\/g, '/')

test('pane: the folder card unfolds the tree and a row selects its directory', { timeoutMs: 20000 }, async ($, on) => {
  const clock = mock.clock(on, { now: 1_000_000 })
  const ran: string[] = []
  const paths: string[] = []
  on('session.model', () => ({ value: 'claude-opus-5-5' }))
  on('settings.read', () => ({ value: {} }))
  on('session.usage', () => ({ value: { startedAt: 0, context: { window: 1 }, rateLimits: [] } }))
  on('env.get', (_$: any, e: any) => ({ value: e.name === 'CLAUDISCOBOMBULATING_LANG' ? 'uk' : undefined }))
  on('tool.register', (_$: any, e: any) => ({ value: { tool: e.name } }))
  on('command.register', (_$: any, e: any) => ({ value: { command: e.name } }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('ui.panes', () => ({ value: [] }))
  on('session.start', (_$: any, e: any) => ({ cwd: e.cwd }))
  on('session.cwd', () => ({ value: 'C:/work/thing' }))
  on('fs.list', (_$: any, e: any) => {
    paths.push(slashed(e.path))
    return { value: slashed(e.path) === 'C:/work/thing' ? [dir('src'), dir('docs'), dir('.git'), { name: 'README.md', kind: 'file', size: 1, mtimeMs: 0, isLink: false }] : [dir('inner')] }
  })
  on('fs.exists', () => ({ value: false }))
  on('command.run', (_$: any, e: any) => {
    ran.push(`${e.command} ${e.args ?? ''}`.trim())
    return {}
  })
  await $.session.start({ cwd: 'C:/work/thing', surface: 'terminal', isInteractive: true })
  await clock.advance(1100)
  const pane = await $.ui.mount({ plugin: 'ClauDiscobombulating', surface: 'terminal', component: 'Pane', requestId: 'ClauDiscobombulating', props: PANE })
  const text = async () => JSON.stringify(await pane.drawn())
  expect(await text()).toContain('📁 Папка  thing')
  expect(await text()).not.toContain('сюди')

  await pane.press({ key: 'folder-btn' })
  await clock.advance(300)
  let s = await text()
  expect(paths).toEqual(['C:/work/thing'])
  expect(s).toContain('‹ ..')
  expect(s).toContain('сюди')
  expect(s).toContain('docs')
  expect(s).toContain('src')
  expect(s).not.toContain('.git')
  expect(s).not.toContain('README.md')

  await pane.press({ key: 'pick-1' })
  await clock.advance(300)
  expect(ran.map(slashed)).toEqual(['cd C:/work/thing/docs'])
  s = await text()
  expect(s).not.toContain('сюди')
})
