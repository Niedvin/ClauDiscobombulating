import { expect, mock, test } from 'claude-code/testing'

test('cache alert: one toast + sound script per idle period, 10 min before miss', { timeoutMs: 30000 }, async ($, on) => {
  const clock = mock.clock(on, { now: 1_000_000 })
  const runs: { argv: readonly string[]; env: Record<string, string> | undefined }[] = []
  on('session.usage', () => ({ value: { startedAt: 0, context: { window: 1 }, rateLimits: [] } }))
  on('session.start', (_$, e) => ({ cwd: e.cwd }))
  on('session.attach', (_$, e) => ({ clientId: e.clientId }))
  on('turn.start', (_$, e) => ({ turnId: e.turnId }))
  on('turn.complete', () => ({ text: '' }))
  on('ui.toast', () => ({ value: undefined }))
  on('env.get', (_$, e) => ({ value: e.name === 'OS' ? 'Windows_NT' : e.name === 'CLAUDISCOBOMBULATING_LANG' ? 'uk' : undefined }))
  on('process.run', (_$, e) => {
    runs.push({ argv: e.argv, env: e.init?.env })
    return { value: { exitCode: 0, stdout: '', stderr: '' } }
  })
  await $.session.start({ cwd: '/', surface: null, isInteractive: false })
  await $.session.attach({ surface: 'desktop', clientId: 'desktop:default' })
  const finish = async (id: string) => {
    await $.turn.start({ text: 'hi', turnId: id })
    await $.turn.complete({ answer: 'ok', durationMs: 1, isAborted: false, turnId: id, reason: 'answer' })
  }
  await finish('t1')
  await clock.advance(48 * 60000)
  expect(runs.length).toBe(0)

  await clock.advance(3 * 60000)
  expect(runs.length).toBe(1)
  expect(runs[0]?.argv[0]).toBe('powershell.exe')
  expect(runs[0]?.env?.PB_BODY).toBe('Кеш: лишилось 10 хв')
  expect(runs[0]?.env?.PB_SOUND).toContain('assets/cache-alert.mp3')

  await clock.advance(5 * 60000)
  expect(runs.length).toBe(1)

  await finish('t2')
  await clock.advance(51 * 60000)
  expect(runs.length).toBe(2)
})

test('cache alert on macOS: the engine plays the clip', { timeoutMs: 30000 }, async ($, on) => {
  const clock = mock.clock(on, { now: 1_000_000 })
  const played: unknown[] = []
  on('session.usage', () => ({ value: { startedAt: 0, context: { window: 1 }, rateLimits: [] } }))
  on('session.start', (_$, e) => ({ cwd: e.cwd }))
  on('session.attach', (_$, e) => ({ clientId: e.clientId }))
  on('turn.start', (_$, e) => ({ turnId: e.turnId }))
  on('turn.complete', () => ({ text: '' }))
  on('ui.toast', () => ({ value: undefined }))
  on('env.get', (_$, e) => ({ value: e.name === 'CLAUDISCOBOMBULATING_LANG' ? 'uk' : undefined }))
  on('audio.play', (_$, e) => {
    played.push(e.clip)
    return { value: undefined }
  })
  await $.session.start({ cwd: '/', surface: null, isInteractive: false })
  await $.session.attach({ surface: 'desktop', clientId: 'desktop:default' })
  await $.turn.start({ text: 'hi', turnId: 't1' })
  await $.turn.complete({ answer: 'ok', durationMs: 1, isAborted: false, turnId: 't1', reason: 'answer' })
  await clock.advance(51 * 60000)
  expect(played).toEqual([{ asset: 'assets/cache-alert.mp3' }])
})

test('no cache alert while the 5h limit sits at 99%+', { timeoutMs: 30000 }, async ($, on) => {
  const clock = mock.clock(on, { now: 1_000_000 })
  const runs: { argv: readonly string[]; env: Record<string, string> | undefined }[] = []
  on('session.usage', () => ({ value: { startedAt: 0, context: { window: 1 }, rateLimits: [] } }))
  on('session.measure', (_$, e) => ({ changed: e.changed }))
  on('session.start', (_$, e) => ({ cwd: e.cwd }))
  on('session.attach', (_$, e) => ({ clientId: e.clientId }))
  on('turn.start', (_$, e) => ({ turnId: e.turnId }))
  on('turn.complete', () => ({ text: '' }))
  on('session.model', () => ({ value: 'claude-opus-5-5' }))
  on('settings.read', () => ({ value: { effortLevel: 'high' } }))
  on('command.run', () => ({ text: 'ok' }))
  on('ui.toast', () => ({ value: undefined }))
  on('env.get', (_$, e) => ({ value: e.name === 'OS' ? 'Windows_NT' : e.name === 'CLAUDISCOBOMBULATING_LANG' ? 'uk' : undefined }))
  on('process.run', (_$, e) => {
    runs.push({ argv: e.argv, env: e.init?.env })
    return { value: { exitCode: 0, stdout: '', stderr: '' } }
  })
  await $.session.start({ cwd: '/', surface: null, isInteractive: false })
  await $.session.attach({ surface: 'desktop', clientId: 'desktop:default' })
  await $.turn.start({ text: 'hi', turnId: 't1' })
  await $.turn.complete({ answer: 'ok', durationMs: 1, isAborted: false, turnId: 't1', reason: 'answer' })
  await $.session.measure({ context: { window: 1 }, rateLimits: [{ kind: 'five_hour', percentUsed: 99 }], changed: ['rateLimits'] })

  await clock.advance(51 * 60000)
  expect(runs.length).toBe(0)
})

test('no cache alert while a compact is within the last 5 turns', { timeoutMs: 30000 }, async ($, on) => {
  const clock = mock.clock(on, { now: 1_000_000 })
  const runs: { argv: readonly string[]; env: Record<string, string> | undefined }[] = []
  on('session.usage', () => ({ value: { startedAt: 0, context: { window: 1 }, rateLimits: [] } }))
  on('session.start', (_$, e) => ({ cwd: e.cwd }))
  on('session.attach', (_$, e) => ({ clientId: e.clientId }))
  on('turn.start', (_$, e) => ({ turnId: e.turnId }))
  on('turn.complete', () => ({ text: '' }))
  on('session.compact', () => ({ messages: [{ role: 'assistant', text: 'summary', toolUses: [] }] }))
  on('ui.toast', () => ({ value: undefined }))
  on('env.get', (_$, e) => ({ value: e.name === 'OS' ? 'Windows_NT' : e.name === 'CLAUDISCOBOMBULATING_LANG' ? 'uk' : undefined }))
  on('process.run', (_$, e) => {
    runs.push({ argv: e.argv, env: e.init?.env })
    return { value: { exitCode: 0, stdout: '', stderr: '' } }
  })
  await $.session.start({ cwd: '/', surface: null, isInteractive: false })
  await $.session.attach({ surface: 'desktop', clientId: 'desktop:default' })
  await $.turn.start({ text: 'hi', turnId: 't1' })
  await $.turn.complete({ answer: 'ok', durationMs: 1, isAborted: false, turnId: 't1', reason: 'answer' })
  await $.session.compact({ trigger: 'manual', messages: [{ role: 'user', text: 'hi', toolUses: [] }] })

  await clock.advance(51 * 60000)
  expect(runs.length).toBe(0)

  for (const id of ['t2', 't3']) {
    await $.turn.start({ text: 'hi', turnId: id })
    await $.turn.complete({ answer: 'ok', durationMs: 1, isAborted: false, turnId: id, reason: 'answer' })
  }
  await clock.advance(51 * 60000)
  expect(runs.length).toBe(0)

  await $.turn.start({ text: 'hi', turnId: 't4' })
  await $.turn.complete({ answer: 'ok', durationMs: 1, isAborted: false, turnId: 't4', reason: 'answer' })
  await clock.advance(51 * 60000)
  expect(runs.length).toBe(1)
})

