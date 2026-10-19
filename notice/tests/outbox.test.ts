// Запуск: claude plugin test <путь к папке notice>
import { describe, expect, test } from 'claude-code/testing'
import { consensusPrompt, count, cut, itemLines, logText, parse, pending, safe } from '../hooks/outbox.ts'

const line = (ts: string, claim = 'Треть просадки пришлась на сегодня') =>
  JSON.stringify({ ts, agent: 'claude', items: [{ claim, type: 'факт', evidence: '−332 из −628 — это 53%' }] })

describe('почтовый ящик пруфгейта', () => {
  test('разбор пропускает пустые, недописанные и пустые по содержанию строки', () => {
    const raw = [line('2026-10-06T12:00:00'), '', '{"ts":"2026-10-06T12:01', JSON.stringify({ ts: '2026-10-06T12:02:00', items: [] })].join('\n')
    expect(parse(raw).length).toBe(1)
  })

  test('показываются только сообщения новее отметки о прочтении', () => {
    const raw = [line('2026-10-06T12:00:00'), line('2026-10-06T12:05:00')].join('\n')
    expect(pending(raw, '').length).toBe(2)
    expect(pending(raw, '2026-10-06T12:00:00').map(n => n.ts)).toEqual(['2026-10-06T12:05:00'])
    expect(pending(raw, '2026-10-06T12:05:00').length).toBe(0)
  })

  test('имя файла совпадает с правилом proofgate.py', () => {
    expect(safe('34f6ca67-4769-484c')).toBe('34f6ca67-4769-484c')
    expect(safe('a/b c')).toBe('a_b_c')
    expect(safe('')).toBe('nosession')
  })

  test('текст для ленты: заголовок со временем, утверждение и данные', () => {
    const [n] = parse(line('2026-10-06T12:00:00'))
    const text = logText(n!)
    expect(text).toContain('12:00')
    expect(text).toContain('«Треть просадки пришлась на сегодня»')
    expect(text).toContain('по данным сессии: −332 из −628 — это 53%')
    expect(count([n!])).toBe(1)
  })

  test('длинное утверждение обрезается, переносы схлопываются', () => {
    expect(cut('a\n\n b', 10)).toBe('a b')
    expect(cut('x'.repeat(50), 10).length).toBe(10)
    expect(itemLines({ claim: 'y'.repeat(500), type: 'факт', evidence: 'z' })[0].length).toBeLessThanOrEqual(222)
  })

  test('консенсус: правило разбора и все находки по порядку, без обрезки', () => {
    const long = 'y'.repeat(500)
    const text = consensusPrompt(parse([line('2026-10-06T12:00:00'), line('2026-10-06T12:05:00', long)].join('\n')))
    expect(text).toContain('Пользователь нажал «Консенсус»')
    expect(text).toContain('спроси одобрения пользователя')
    expect(text).toContain('1. [2026-10-06T12:00:00] «Треть просадки пришлась на сегодня» (факт): −332 из −628 — это 53%')
    expect(text).toContain(`2. [2026-10-06T12:05:00] «${long}»`)
  })
})
