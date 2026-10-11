import { expect, mock, test } from 'claude-code/testing'

for (const surface of ['terminal', 'desktop'] as const) {
  test(`cache timer survives a resume on ${surface}`, { timeoutMs: 20000 }, async ($, on) => {
    const clock = mock.clock(on, { now: 1_000_000 })
    on('session.model', () => ({ value: 'claude-opus-5-5' }))
    on('settings.read', () => ({ value: {} }))
    on('session.usage', () => ({ value: { startedAt: 0, context: { window: 1 }, rateLimits: [{ kind: 'five_hour', percentUsed: 10 }] } }))
    on('tool.register', (_$, e) => ({ value: { tool: e.name } }))
    on('command.register', (_$, e) => ({ value: { command: e.name } }))
    on('ui.open', () => ({ value: { isPlaced: true } }))
    on('ui.panes', () => ({ value: [] }))
    on('ui.toast', () => ({ value: undefined }))
    on('env.get', (_$: any, e: any) => ({ value: e.name === 'CLAUDISCOBOMBULATING_LANG' ? 'uk' : undefined }))
    on('session.start', (_$, e) => ({ cwd: e.cwd }))
    on('classic.SessionStart', () => ({}))
    await $.session.start({ cwd: '/', surface, isInteractive: true })
    await $.classic.SessionStart({ source: 'resume', seconds_since_last_response: 40 * 60 })
    await clock.advance(1500)
    const mode = await $.ui.mount(
      surface === 'desktop'
        ? { plugin: 'ClauDiscobombulating', surface, component: 'AbovePrompt', props: { hasSurvey: false, isWorking: false, maxRows: 20, bodyColumns: 100, scroll: { offset: 0, bodyRows: 20 }, view: {} } }
        : { plugin: 'ClauDiscobombulating', surface, component: 'SessionMode', props: { modes: [] } },
    )
    expect(JSON.stringify(await mode.drawn())).toContain('кеш 20хв')
  })
}

