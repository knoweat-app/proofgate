// Почтовый ящик пруфгейта: по строке JSON на проверку, в которой нашлись противоречия (пишет proofgate.py, deliver).
export type Item = { claim: string; type: string; evidence: string }
export type Notice = { ts: string; agent: string; items: Item[] }

// та же папка состояния, что у proofgate.py: PROOFGATE_STATE или ~/.local/state/proofgate
const env: Record<string, string | undefined> = (globalThis as any).process?.env ?? {}
export const OUTBOX = `${env.PROOFGATE_STATE ?? `${env.HOME ?? '/root'}/.local/state/proofgate`}/outbox`

// то же правило имени файла, что в proofgate.py: всё, кроме букв, цифр, точки, дефиса и подчёркивания, — в «_»
export const safe = (session: string): string => (session || 'nosession').replace(/[^\w.-]/g, '_')

export function parse(raw: string): Notice[] {
  const out: Notice[] = []
  for (const line of raw.split('\n')) {
    if (!line.trim()) continue
    try {
      const d = JSON.parse(line)
      if (typeof d.ts === 'string' && Array.isArray(d.items) && d.items.length) out.push(d)
    } catch {
      // недописанная строка: прочитаем на следующем тике
    }
  }
  return out
}

// метки времени — ISO без пояса, сравниваются как строки
export const pending = (raw: string, ackTs: string): Notice[] => parse(raw).filter(n => n.ts > ackTs)

export const cut = (text: string, max: number): string => {
  const t = text.replace(/\s+/g, ' ').trim()
  return t.length <= max ? t : `${t.slice(0, max - 1)}…`
}

export const itemLines = (item: Item): [string, string] => [`«${cut(item.claim, 220)}»`, `по данным сессии: ${cut(item.evidence, 320)}`]

export function logText(n: Notice): string {
  const head = `⚠ Пруфгейт: в ответе от ${n.ts.slice(11, 16)} ${n.items.length === 1 ? 'утверждение расходится' : 'утверждения расходятся'} с данными сессии`
  return [head, ...n.items.flatMap(i => itemLines(i).map((l, k) => (k ? `   ${l}` : ` • ${l}`)))].join('\n')
}

export const count = (notices: Notice[]): number => notices.reduce((s, n) => s + n.items.length, 0)

// Кнопка «Консенсус»: находки уходят в текущую сессию, модель разбирает каждую —
// исправляет, если пруфгейт прав, или договаривается о согласованном варианте с одобрения пользователя.
export function consensusPrompt(notices: Notice[]): string {
  const items = notices.flatMap(n => n.items.map(item => ({ ts: n.ts, item })))
  return [
    'Пользователь нажал «Консенсус» на сообщении пруфгейта. Фоновая проверка нашла в твоих ответах этой сессии расхождения с данными сессии. Разбери каждое: перепроверь по данным сессии или живым запросом.',
    '— Пруфгейт прав полностью — исправь без обсуждения: утверждение, а если ошибка дошла до кода, конфига, памяти или документов — и их.',
    '— Прав частично или вопрос спорный — скажи, что верно, а что нет, с доказательством (вывод команды, строка файла), предложи согласованную формулировку или правку и спроси одобрения пользователя; до его «да» спорную часть не меняй.',
    '— Неправ — объясни почему, со ссылкой на данные.',
    'Ответ начни коротким разделом «Пруфгейт» с итогом по каждому пункту.',
    '',
    ...items.map(({ ts, item }, i) => `${i + 1}. [${ts}] «${item.claim}» (${item.type}): ${item.evidence}`),
  ].join('\n')
}
