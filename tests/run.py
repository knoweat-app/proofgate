#!/usr/bin/env python3
"""Тестовый набор пруфгейта: каждый случай собирается в транскрипт обоих форматов и проверяется
в обе стороны — ответ «Claude» проверяет Codex, ответ «Codex» проверяет Opus.

  run.py                 все случаи, обе стороны
  run.py --only ID,ID    выбранные случаи
  run.py --side claude   только одна сторона (чей ответ)
  run.py --offline       без моделей: разбор, вырезание секретов, предфильтр, полный протокол

Ожидание случая (expect): pass — замечаний нет; return — есть любое замечание; weak — только «опоры недостаточно»,
без противоречий; contradict — найдено «противоречит источнику». flag — слова, одно из которых должно быть в замечании.
Вывод шага может быть словарём {"filler": "…{i}…", "n": 300, "at": 150, "needle": "…"} — длинный вывод с нужной
строкой в середине (случаи из журнала первой недели, где опору срезало при сокращении).
"""
import argparse, json, os, sys, tempfile
os.environ.setdefault("PROOFGATE_STARTUP", "0")     # тесты герметичны: память и скиллы хоста в запрос не идут
os.environ.setdefault("PROOFGATE_HIDE_PATHS", "/srv/app-data/")
from concurrent.futures import ThreadPoolExecutor

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, ".."))
import proofgate as g  # noqa: E402


def expand(out):
    if isinstance(out, str): return out
    rows = [out["filler"].format(i=i) for i in range(out["n"])]
    rows.insert(out["at"], out["needle"])
    return "\n".join(rows)


def claude_jsonl(turns):
    rows, n = [], 0
    for t in turns:
        rows.append({"type": "user", "message": {"role": "user", "content": t["user"]}})
        for cmd, out in t["steps"]:
            n += 1
            rows.append({"type": "assistant", "message": {"role": "assistant", "content": [
                {"type": "tool_use", "id": f"t{n}", "name": "Bash", "input": {"command": cmd}}]}})
            rows.append({"type": "user", "message": {"role": "user", "content": [
                {"type": "tool_result", "tool_use_id": f"t{n}", "content": expand(out)}]}})
        rows.append({"type": "assistant", "message": {"role": "assistant", "content": [{"type": "text", "text": t["answer"]}]}})
    return rows


def codex_jsonl(turns):
    rows, n = [], 0
    item = lambda p: {"type": "response_item", "payload": p}
    for t in turns:
        rows.append(item({"type": "message", "role": "user", "content": [{"type": "input_text", "text": t["user"]}]}))
        for cmd, out in t["steps"]:
            n += 1
            rows.append(item({"type": "function_call", "name": "exec_command", "call_id": f"c{n}",
                              "arguments": json.dumps({"cmd": cmd}, ensure_ascii=False)}))
            rows.append(item({"type": "function_call_output", "call_id": f"c{n}", "output": expand(out)}))
        rows.append(item({"type": "message", "role": "assistant", "content": [{"type": "output_text", "text": t["answer"]}]}))
    return rows


def write(rows, td, name):
    p = os.path.join(td, name)
    with open(p, "w") as f:
        for r in rows: f.write(json.dumps(r, ensure_ascii=False) + "\n")
    return p


def offline(cases, td):
    ok = True
    for c in cases:
        for side, build in (("claude", claude_jsonl), ("codex", codex_jsonl)):
            p = write(build(c["turns"]), td, f"{c['id']}-{side}.jsonl")
            ev = g.parse(side, p)
            ans = g.final_answer(ev)
            short, full = g.build_protocol(g.redact_events(ev))
            prompt = g.build_prompt(short, g.redact(ans), [], "/tmp/protocol-full.md")
            errs = []
            errs += [f"утечка в полном протоколе: {x}" for x in c.get("no_leak", []) if x in full]
            for x in c.get("full_has", []):      # строка из середины длинного вывода: в запросе срезана, в файле есть
                if x not in full: errs.append(f"нет в полном протоколе: {x}")
                if x in short: errs.append(f"не срезано в запросе (случай не проверяет дочитывание): {x}")
            if c.get("full_has") and "в файле полного протокола" not in short: errs.append("нет ссылки на блок полного протокола")
            if ans != c["turns"][-1]["answer"]: errs.append(f"ответ разобран неверно: {ans[:60]!r}")
            if ev[-1]["turn"] != len(c["turns"]): errs.append(f"ходов {ev[-1]['turn']} вместо {len(c['turns'])}")
            errs += [f"утечка: {s}" for s in c.get("no_leak", []) if s in prompt]
            print(f"{'OK ' if not errs else 'ERR'} {c['id']:24} {side:6} {'; '.join(errs)}")
            ok &= not errs
    ok &= inbox_test(td)
    for s, want in (("да", False), ("Готово.", False), ("Коммит 5d1e1dc", True), ("x" * 70, True)):
        got = g.worth_checking(s)
        print(f"{'OK ' if got == want else 'ERR'} предфильтр {s[:20]!r} → {got}")
        ok &= got == want
    return ok


def inbox_test(td):
    """inbox: новые находки — агенту один раз; повтор молчит; PROOFGATE_INBOX_ONLY отсекает чужие сессии."""
    import contextlib, io
    g.OUTBOX = os.path.join(td, "outbox"); os.makedirs(g.OUTBOX, exist_ok=True)
    g.deliver("claude", "s1", [{"claim": "X проверено", "type": "отчёт о действии", "evidence": "B1: не проверено"}], "2026-01-01T00:00:00")
    tp = write([{"type": "user", "message": {"role": "user", "content": "/deploy"}}], td, "inbox.jsonl")
    def call(only=""):
        g.INBOX_ONLY = only
        buf, sys.stdin = io.StringIO(), io.StringIO(json.dumps({"session_id": "s1", "transcript_path": tp}))
        with contextlib.redirect_stdout(buf): g.inbox("claude")
        sys.stdin = sys.__stdin__
        return buf.getvalue()
    first = call("/release"); second = call(); third = call()
    errs = []
    if first: errs.append("доставлено в сессию, не подходящую под PROOFGATE_INBOX_ONLY")
    if "X проверено" not in second: errs.append("находка не доставлена")
    if third: errs.append("повторная доставка")
    print(f"{'OK ' if not errs else 'ERR'} inbox                    {'; '.join(errs)}")
    g.INBOX_ONLY = ""
    return not errs


def online(cases, sides, td):
    jobs = [(c, s) for c in cases for s in sides]

    def run(job):
        c, side = job
        p = write((claude_jsonl if side == "claude" else codex_jsonl)(c["turns"]), td, f"{c['id']}-{side}.jsonl")
        try: r = g.review(side, p)
        except Exception as e: return c, side, None, str(e)
        return c, side, r, None

    res = []
    with ThreadPoolExecutor(4) as ex:
        for c, side, r, err in ex.map(run, jobs):
            reviewer = g.REVIEWERS[side]["model"]
            if err:
                print(f"ERR  {c['id']:24} {side:6}→{reviewer:9} ошибка: {err[:150]}"); res.append(False); continue
            bad = r["unsupported"]; got = "contradict" if r["contradicted"] else "weak" if r["weak"] else "pass"
            pool = r["contradicted"] if c["expect"] == "contradict" else bad
            hit = not c.get("flag") or any(f.lower() in json.dumps(pool, ensure_ascii=False).lower() for f in c["flag"])
            ok = (got == "pass") if c["expect"] == "pass" else (got != "pass" and hit) if c["expect"] == "return" else (got == c["expect"] and hit)
            cost = f"${r['cost_usd']:.3f}" if r["cost_usd"] else "     "
            print(f"{'OK ' if ok else 'BAD'}  {c['id']:24} {side:6}→{reviewer:11} {got:10} (ждали {c['expect']:10}) "
                  f"{r['duration_s']:5.1f} с {cost} утв. {len(r['verdict']['claims'])}")
            for b in bad + r["lost"]: print(f"       · [{b['verdict']}] «{b['claim'][:90]}» {b['evidence'][:140]}")
            res.append(ok)
    print(f"\nИтого: {sum(res)} из {len(res)} совпали с ожиданием")
    return all(res)


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--only"); ap.add_argument("--side", choices=["claude", "codex"]); ap.add_argument("--offline", action="store_true")
    a = ap.parse_args()
    cases = json.load(open(os.path.join(HERE, "cases.json")))
    if a.only: cases = [c for c in cases if c["id"] in a.only.split(",")]
    with tempfile.TemporaryDirectory() as td:
        ok = offline(cases, td) if a.offline else online(cases, [a.side] if a.side else ["claude", "codex"], td)
    sys.exit(0 if ok else 1)


if __name__ == "__main__":
    main()
