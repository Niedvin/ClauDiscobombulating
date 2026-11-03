import { expect, mock, test } from 'claude-code/testing'

const PANE = { title: 't', isFocused: false, bodyColumns: 38, placement: 'dock', scroll: { offset: 0, bodyRows: 40 }, view: {} } as const
const file = (name: string, mtimeMs: number, size = 5000) => ({ name, kind: 'file' as const, size, mtimeMs, isLink: false })

async function boot($: any, on: any, entries: any[], toasts: string[]) {
  const ran: string[] = []
  const dirs: string[] = []
  on('session.model', () => ({ value: 'claude-opus-5-5' }))
  on('settings.read', () => ({ value: {} }))
  on('session.usage', () => ({ value: { startedAt: 0, context: { window: 1 }, rateLimits: [] } }))
  on('env.get', (_$: any, e: any) => ({
    value: e.name === 'CLAUDISCOBOMBULATING_LANG' ? 'uk' : e.name === 'CLAUDE_CONFIG_DIR' ? '/cfg' : undefined,
  }))
  on('tool.register', (_$: any, e: any) => ({ value: { tool: e.name } }))
  on('command.register', (_$: any, e: any) => ({ value: { command: e.name } }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('ui.panes', () => ({ value: [] }))
  on('ui.toast', (_$: any, e: any) => {
    toasts.push(e.text)
    return { value: undefined }
  })
  on('session.start', (_$: any, e: any) => ({ cwd: e.cwd }))
  on('session.cwd', () => ({ value: '/work/thing' }))
  on('session.id', () => ({ value: 'cur-0000' }))
  on('fs.list', (_$: any, e: any) => {
    dirs.push(e.path)
    return { value: entries }
  })
  on('command.run', (_$: any, e: any) => {
    ran.push(`${e.command} ${e.args ?? ''}`.trim())
    return {}
  })
  await $.session.start({ cwd: '/work/thing', surface: 'terminal', isInteractive: true })
  const pane = await $.ui.mount({ plugin: 'ClauDiscobombulating', surface: 'terminal', component: 'Pane', requestId: 'ClauDiscobombulating', props: PANE })
  return { ran, dirs, pane }
}

test('pane: the last-session half resumes the newest transcript that is not the current one', { timeoutMs: 20000 }, async ($, on) => {
  mock.clock(on, { now: 1_000_000 })
  const toasts: string[] = []
  const { ran, dirs, pane } = await boot($, on, [
    file('cur-0000.jsonl', 9000),
    file('old-aaaa.jsonl', 1000),
    file('new-bbbb.jsonl', 8000),
    file('tiny-cccc.jsonl', 9500, 100),
    { name: 'notes.txt', kind: 'file', size: 9000, mtimeMs: 9999, isLink: false },
  ], toasts)
  const s = JSON.stringify(await pane.drawn())
  expect(s).toContain('≡ Sessions')
  expect(s).toContain('↶')
  expect(s).not.toContain('☰')
  expect(s).toContain('┬')
  expect(s).toContain('┴')
  expect(s).not.toContain('├')

  await pane.press({ key: 'last' })
  expect(dirs).toEqual(['/cfg/projects/-work-thing'])
  expect(ran).toEqual(['resume new-bbbb'])
  expect(toasts).toEqual([])
})

test('pane: no previous transcript toasts and runs nothing', { timeoutMs: 20000 }, async ($, on) => {
  mock.clock(on, { now: 1_000_000 })
  const toasts: string[] = []
  const { ran, pane } = await boot($, on, [file('cur-0000.jsonl', 9000), file('tiny-cccc.jsonl', 9000, 10)], toasts)
  await pane.press({ key: 'last' })
  expect(ran).toEqual([])
  expect(toasts).toEqual(['Немає попередньої сесії'])
})
