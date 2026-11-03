import { expect, mock, test } from 'claude-code/testing'
import { keptFlags, newWindow, relaunchArgv, splitWin } from './restart'

const PANE = { title: 't', isFocused: false, bodyColumns: 38, placement: 'dock', scroll: { offset: 0, bodyRows: 60 }, view: {} } as const

test('relaunch argv keeps flags, drops pickers and prompts, names the session', async () => {
  expect(keptFlags(['--dangerously-skip-permissions', '-c', '--model', 'opus', '-r', 'old', 'fix it'])).toEqual(['--dangerously-skip-permissions', '--model', 'opus'])
  expect(keptFlags(['--add-dir', 'a', 'b', '--verbose', '-p', '--debug=api'])).toEqual(['--add-dir', 'a', 'b', '--verbose', '--debug=api'])
  expect(relaunchArgv(['claude', '--dangerously-skip-permissions'], 'S1', 'bypassPermissions')).toEqual(['claude', '--dangerously-skip-permissions', '--resume', 'S1'])
  expect(relaunchArgv(['claude'], '', 'acceptEdits')).toEqual(['claude', '--permission-mode', 'acceptEdits'])
  expect(relaunchArgv(['claude', '--permission-mode', 'plan'], '', 'default')).toEqual(['claude', '--permission-mode', 'plan'])
  expect(splitWin('"C:\\Program Files\\claude.exe" --model opus "a b"')).toEqual(['C:\\Program Files\\claude.exe', '--model', 'opus', 'a b'])
  expect(newWindow('/usr/bin/xfce4-terminal', '/w', ['claude'], false)?.slice(0, 3)).toEqual(['xfce4-terminal', '--hold', '--working-directory=/w'])
  expect(newWindow('tmux: server', '/w', ['claude'], false)).toBe(undefined)
})

async function setup($: any, on: any) {
  const ran: string[] = []
  const runs: string[][] = []
  on('session.model', () => ({ value: 'claude-opus-5-5' }))
  on('settings.read', () => ({ value: {} }))
  on('session.usage', () => ({ value: { startedAt: 0, context: { window: 1 }, rateLimits: [] } }))
  on('session.turns', () => ({ value: 3 }))
  on('session.id', () => ({ value: 'S1' }))
  on('session.root', () => ({ value: '/work dir' }))
  on('env.get', (_$: any, e: any) => ({ value: ({ CLAUDISCOBOMBULATING_LANG: 'uk', WINDOWID: '777', HOME: '/h' } as Record<string, string>)[e.name] }))
  on('fs.read', (_$: any, e: any, next: any) => (String(e.path).endsWith('plugin.json') ? { value: JSON.stringify({ version: '2.9.8', repository: 'https://github.com/Niedvin/ClauDiscobombulating' }) } : next(e)))
  on('http.fetch', () => ({ value: { status: 200, ok: true, headers: {}, text: JSON.stringify({ version: '99.0.0' }) } }))
  on('ui.toast', () => ({ value: undefined }))
  on('tool.register', (_$: any, e: any) => ({ value: { tool: e.name } }))
  on('command.register', (_$: any, e: any) => ({ value: { command: e.name } }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('session.start', (_$: any, e: any) => ({ cwd: e.cwd }))
  on('command.run', (_$: any, e: any) => {
    ran.push(e.command)
    return {}
  })
  on('process.run', (_$: any, e: any) => {
    runs.push([...e.argv])
    const script = e.argv[2] ?? ''
    const out =
      script === 'echo $PPID' ? '4242\n'
      : script.startsWith('[ -r /proc/') ? 'y\n'
      : script.startsWith('tr ') ? '/usr/bin/claude\u0000--dangerously-skip-permissions\n'.replace('\u0000', '\n')
      : script.startsWith('ps -o ppid=') ? '100\n'
      : script.startsWith('ps -o args= -p 100') ? 'xfce4-terminal\n'
      : ''
    return { value: { exitCode: 0, stdout: out, stderr: '' } }
  })
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  return { ran, runs }
}

test('update row says click to update; a press updates, relaunches with the same flags and session, TERMs claude', { timeoutMs: 20000 }, async ($, on) => {
  const clock = mock.clock(on, { now: 1_000_000 })
  const { ran, runs } = await setup($, on)
  await clock.advance(1000)
  const pane = await $.ui.mount({ plugin: 'ClauDiscobombulating', surface: 'terminal', component: 'Pane', requestId: 'ClauDiscobombulating', props: PANE })
  expect(JSON.stringify(await pane.drawn())).toContain('✦ v99.0.0 — натисніть, щоб оновити')
  await pane.press({ key: 'update' })
  await clock.advance(1000)
  expect(runs.some(a => a.join(' ').includes('plugin update ClauDiscobombulating@ClauDiscobombulating'))).toBe(true)
  const helper = runs.find(a => a[0] === 'setsid')
  expect(helper).toBeDefined()
  const script = helper![4]!
  for (const part of ['xfce4-terminal', '--hold', '--working-directory=/work dir']) expect(script).toContain(part)
  expect(script).toContain('--dangerously-skip-permissions')
  expect(script).toContain('--resume')
  expect(script).toContain('S1')
  expect(script).toContain('wmctrl -i -c 777')
  expect(script).toContain('kill -TERM 4242')
  expect(ran).not.toContain('exit')
})
