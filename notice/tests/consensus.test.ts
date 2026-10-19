// Кнопка «Консенсус»: полоса рисуется на каждой поверхности, нажатие отправляет находки в сессию и ставит отметки
import { expect, mock, test } from 'claude-code/testing'
import { OUTBOX } from '../hooks/outbox.ts'

const SESSION = 'test-sess'
const box = `${OUTBOX}/${SESSION}`
const notice = (ts: string) =>
  JSON.stringify({ ts, agent: 'claude', items: [{ claim: 'Треть просадки пришлась на сегодня', type: 'факт', evidence: '−332 из −628 — это 53%' }] })

for (const surface of ['terminal', 'desktop'] as const) {
  test(`консенсус на поверхности ${surface}`, async ($, on) => {
    const files: Record<string, string> = { [`${box}.jsonl`]: `${notice('2026-10-19T10:00:00')}\n${notice('2026-10-19T10:01:00')}\n`, [`${box}.seen`]: '2026-10-19T09:00:00' }
    const sent: string[] = []
    const clock = mock.clock(on)
    on('session.start', ($, e) => ({ cwd: e.cwd }))
    on('session.id', () => ({ value: SESSION }))
    on('fs.read', ($, e) => {
      if (!(e.path in files)) return { deny: `нет файла ${e.path}` }
      return { value: files[e.path]! }
    })
    on('fs.write', ($, e) => {
      files[e.path] = e.text
      return { value: undefined }
    })
    on('prompt.submit', ($, e) => {
      sent.push(e.text)
      return { text: e.text }
    })
    on('ui.log', () => ({ value: undefined }))
    on('ui.toast', () => ({ value: undefined }))
    on('ui.status', () => ({ value: undefined }))
    on('ui.render', ($, e) => {
      const { Box } = $.ui.resolve(e)
      return h(Box, {})
    })

    await $.session.start({ cwd: '/tmp', surface, isInteractive: true })
    await clock.advance(4000)
    const ui = await $.ui.mount({ plugin: 'proofgate-notice', surface, component: 'AbovePrompt', props: { hasSurvey: false, isWorking: false } as never })
    expect(await ui.find({ key: 'ack' })).toBeDefined()
    expect((await ui.find({ key: 'consensus' }))?.text).toContain('Консенсус')

    await ui.press({ key: 'consensus' })
    expect(sent.length).toBe(1)
    expect(sent[0]).toContain('1. [2026-10-19T10:00:00]')
    expect(sent[0]).toContain('2. [2026-10-19T10:01:00]')
    expect(files[`${box}.ack`]).toBe('2026-10-19T10:01:00')
    expect(files[`${box}.seen`]).toBe('2026-10-19T10:01:00')
    expect(await ui.find({ key: 'consensus' })).toBeUndefined()
  })
}
