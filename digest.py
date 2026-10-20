#!/usr/bin/env python3
"""digest — сводка журнала пруфгейта для регулярного разбора: какие ошибки повторяются и просятся в правило.

  digest.py                     находки «противоречит источнику» с прошлого разбора (по умолчанию — за 7 дней), по типам
  digest.py --since YYYY-MM-DD  то же с указанной даты
  digest.py --done              отметить разбор сделанным; следующая сводка начнётся с этого момента

Зачем. Находки по одной разбираются в той же сессии, но повторы видны только в сумме. Порядок разбора:
тип ошибки, повторившийся 2+ раз, — черновик правила для инструкций агента; правило вносит человек.
Сам скрипт ничего не правит. Журнал — тот же, что пишет proofgate.py (PROOFGATE_JOURNAL).
"""
import collections
import json
import os
import sys
import time
from datetime import datetime, timedelta, timezone

HOME = os.path.expanduser("~")
STATE_DIR = os.environ.get("PROOFGATE_STATE", os.path.join(HOME, ".local/state/proofgate"))
JOURNAL = os.environ.get("PROOFGATE_JOURNAL", os.path.join(STATE_DIR, "journal.jsonl"))
STAMP = os.path.join(STATE_DIR, "digest-last")


def parse_ts(s):
    try:
        dt = datetime.fromisoformat(s.replace("Z", "+00:00"))
    except (AttributeError, ValueError):
        return None
    return dt if dt.tzinfo else dt.replace(tzinfo=timezone.utc)


def main():
    if "--done" in sys.argv:
        os.makedirs(STATE_DIR, exist_ok=True)
        with open(STAMP, "w") as f: f.write(time.strftime("%Y-%m-%dT%H:%M:%S%z\n"))
        print(f"разбор отмечен: {STAMP}"); return
    if "--since" in sys.argv:
        since = datetime.fromisoformat(sys.argv[sys.argv.index("--since") + 1]).replace(tzinfo=timezone.utc)
    elif os.path.exists(STAMP):
        since = datetime.fromtimestamp(os.path.getmtime(STAMP), timezone.utc)
    else:
        since = datetime.now(timezone.utc) - timedelta(days=7)

    found, checks = [], 0
    try:
        with open(JOURNAL, encoding="utf-8") as f:
            for line in f:
                try: e = json.loads(line)
                except ValueError: continue
                ts = parse_ts(e.get("ts"))
                if not ts or ts <= since or e.get("result") == "skip": continue
                checks += 1
                for c in e.get("contradicted") or []:
                    found.append((e["ts"][:16], e.get("agent"), c))
    except FileNotFoundError:
        print(f"журнала нет: {JOURNAL}"); return

    print(f"С {since:%Y-%m-%d %H:%M} UTC: проверок {checks}, находок «противоречит источнику» {len(found)}\n")
    by_type = collections.defaultdict(list)
    for item in found: by_type[item[2].get("type") or "без типа"].append(item)
    for t, items in sorted(by_type.items(), key=lambda kv: -len(kv[1])):
        print(f"## {t}: {len(items)}")
        for ts, agent, c in items:
            print(f"- [{ts} {agent}] {c.get('claim', '')[:200]}\n    → {c.get('evidence', '')[:200]}")
        print()


if __name__ == "__main__":
    main()
