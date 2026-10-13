/**
 * proofgate-notice — жёлтое сообщение о противоречиях, которые нашла фоновая проверка ответа (пруфгейт).
 *
 *   - `$.clock.every(4000)` читает почтовый ящик текущей сессии (OUTBOX/<id сессии>.jsonl)
 *   - новое противоречие: строка в ленте (`$.ui.log`), всплывающая подсказка и строка состояния под вводом
 *   - полоса над строкой ввода жёлтым, пока пользователь не нажмёт «Понятно»; отметка о прочтении — файл <id>.ack
 *
 * Проверка ответ не задерживает: сообщение появляется следом, обычно через минуту.
 */
import type { EngineInterface, Register } from 'claude-code'
import { count, itemLines, logText, OUTBOX, pending, safe } from './outbox.ts'
import type { Notice } from './outbox.ts'

let timer: { cancel?: () => void } | (() => void) | undefined
let notices: Notice[] = []
let logged = new Set<string>()
let shownKey = ''
let session = ''

const stop = () => {
  if (typeof timer === 'function') timer()
  else timer?.cancel?.()
  timer = undefined
}

const read = ($: EngineInterface, path: string): Promise<string> => $.fs.read(path).catch(() => '')

async function tick($: EngineInterface): Promise<void> {
  const id = safe(await $.session.id())
  if (id !== session) {
    // после /clear сессия другая: чужие сообщения не показываем
    session = id
    notices = []
    shownKey = ''
  }
  const ack = (await read($, `${OUTBOX}/${id}.ack`)).trim()
  const next = pending(await read($, `${OUTBOX}/${id}.jsonl`), ack)
  const key = next.map(n => n.ts).join('|')
  if (key === shownKey) return
  for (const n of next) {
    if (logged.has(`${id}|${n.ts}`)) continue
    logged.add(`${id}|${n.ts}`)
    $.ui.log(logText(n))
    $.ui.toast('Пруфгейт: ответ расходится с данными сессии', { timeoutMs: 8000 })
  }
  notices = next
  shownKey = key
  $.ui.status(next.length ? `пруфгейт: расхождений с данными — ${count(next)}, подробности над строкой ввода и в ленте` : undefined)
  $.ui.invalidate('ui.render')
}

async function acknowledge($: EngineInterface): Promise<void> {
  const last = notices[notices.length - 1]
  if (!last) return
  await $.fs.write(`${OUTBOX}/${session}.ack`, last.ts).catch(err => $.ui.log(`proofgate-notice: отметка о прочтении не записана: ${err}`, { to: 'debug' }))
  notices = []
  shownKey = ''
  $.ui.status(undefined)
  $.ui.invalidate('ui.render')
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    const r = await next(e)
    stop()
    logged = new Set()
    if (e.isInteractive) {
      timer = $.clock.every(4000, () => {
        void tick($).catch(err => $.ui.log(`proofgate-notice: ${err}`, { to: 'debug' }))
      })
    }
    return r
  })

  on('session.end', async ($, e, next) => {
    if (e.reason !== 'clear') stop()
    return next(e)
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    if (!notices.length || e.props.hasSurvey) return next(e)
    const { Box, Text, Button } = $.ui.resolve(e)
    const below = await next(e)
    return (
      <Box flexDirection="column">
        <Box flexDirection="column">
          <Text bold color="yellow">⚠ Пруфгейт: в ответе есть расхождение с данными сессии</Text>
          {notices.flatMap(n =>
            n.items.map((item, i) => {
              const [claim, evidence] = itemLines(item)
              return (
                <Box key={`${n.ts}:${i}`} flexDirection="column">
                  <Text color="yellow">{` • ${claim}`}</Text>
                  <Text color="yellow">{`   ${evidence}`}</Text>
                </Box>
              )
            }),
          )}
          <Button key="ack" label="Понятно" onPress={() => acknowledge($)} />
        </Box>
        {below}
      </Box>
    )
  })
}
