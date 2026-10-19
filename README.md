# Proofgate

[Русский](README.ru.md)

Cross-vendor fact checking for AI coding agents. Every final answer from Claude Code is read by Codex after it is sent,
and every answer from Codex is read by Claude. The reviewer extracts each concrete claim from the answer and checks it
against what the tools actually returned in that session. When a claim contradicts the session data, the user gets a
separate yellow notice with the quote it contradicts.

The idea comes from Vlad Arbatov's article "The agent lies: AI checking AI" (pimenov.ai, in Russian, 23 Sep 2026).
The standard and the implementation are our own.

> **Language.** The checking standard, the reviewer prompt and the verdict labels are written in Russian, and the test
> suite was passed on that text. The code is language-neutral otherwise. To run it in another language, translate
> `PROOF-STANDARD.md`, the prompt in `build_prompt` and the verdict and type constants in `proofgate.py`, then re-run
> the tests.

## Why

An agent writes with the same confidence about what it read and what it made up. "Do not invent things" in the
instructions does not help: at answer time the agent cannot tell the two apart. So the check is done from outside,
after the answer, by a model from a different vendor.

## How one check runs

1. The agent finishes its answer and the Stop hook fires. Short answers with no digits or paths are skipped without
   calling a model.
2. The hook records the transcript size (anything written later does not count as evidence), hands the job to a
   background process and exits. The user already has the answer.
3. The transcript becomes a protocol: user messages, tool calls and tool output, numbered B1, B2, … The agent's own
   words are left out.
4. Secrets are redacted.
5. The reviewer receives the standard, a shortened protocol, the answer and the path to the full protocol file.
6. The reviewer returns a type, a verdict and a quote for every claim.
7. Everything goes to the journal; claims with the verdict "contradicts the source" are shown to the user.

There are five verdicts: confirmed, acceptable inference, contradicts the source, insufficient evidence, context lost.
Only the third one counts as an error in the answer. The full rules are in [PROOF-STANDARD.md](PROOF-STANDARD.md).

## What is in the repository

| File | What it is |
|---|---|
| `proofgate.py` | hook, background check, transcript parsers for both platforms, secret redaction, journal |
| `PROOF-STANDARD.md` | the checking standard; inserted into the reviewer prompt in full |
| `notice/` | Claude Code mod: yellow band above the prompt with two buttons — "Понятно" (mark as read) and "Консенсус" (send the findings to the agent in the current session for review) |
| `tests/` | 26 cases, each run in both directions |
| `examples/` | settings fragments for Claude Code and Codex |
| `docs/LESSONS.ru.md` | history, numbers and pitfalls (in Russian) |
| `AGENT-INSTALL.md` | instructions for an agent that will install this |

## Requirements

- Python 3.10+, no third-party packages.
- Claude Code and Codex CLI, both installed, both logged in, both with Stop hooks.
- Linux or macOS. Tested only on Linux as root.

## Install

```bash
git clone https://github.com/knoweat-app/proofgate ~/proofgate
python3 ~/proofgate/tests/run.py --offline          # no models: parsing, redaction, prefilter
```

1. **Claude Code.** Add the Stop hook from `examples/claude-settings.json` to `~/.claude/settings.json`.
2. **Codex.** Add the Stop hook from `examples/codex-hooks.json` to `~/.codex/hooks.json`. Codex runs a new hook only
   after you trust it, and asks again whenever the hook command changes.
3. **Yellow notice (optional).** Copy `notice/` to `~/.claude/skills/proofgate-notice` and start a new session. Without
   the mod, findings still go to the journal and to `~/.local/state/proofgate/outbox/`.
4. **Findings back to the agent (optional).** Add the `UserPromptSubmit` hook from `examples/claude-settings.json`.
   Unread findings then reach Claude Code together with your next message, and the agent is asked to settle each one
   before answering: re-check it, fix what the reviewer got right, and argue with evidence where the reviewer is wrong.
   `PROOFGATE_INBOX_ONLY` (a regular expression) limits this to sessions whose transcript contains it, for example
   sessions where a given skill was invoked.
5. **Check.** `python3 ~/proofgate/tests/run.py --only version-lie` makes two real reviewer calls; both must find the
   contradiction.

The mode is set with `PROOFGATE_MODE` in the hook command: `async` (default), `shadow` (synchronous, journal only),
`block` (synchronous, returns the answer to the agent for up to four rounds), `off`. To pause without touching settings:
`touch ~/.local/state/proofgate/PAUSED`.

Other settings are environment variables listed at the top of `proofgate.py`. The most important one is
`PROOFGATE_HIDE_PATHS`: a regular expression of paths; output of commands that touch them is never shown to the reviewer.

## What we know about accuracy

One week on one server, Claude Code answers reviewed by gpt-6.1-sol: 263 checks, 4,938 claims, 95 of them with the
verdict "contradicts the source". 98 such findings (including the following day) were labelled by hand against the
saved protocols:

| Outcome | Count | Share |
|---|---:|---:|
| Real discrepancy that changes the meaning of the answer | 21 | 21% |
| Real but minor: an inexact number, rounding, an overly broad word | 47 | 48% |
| The reviewer was wrong | 5 | 5% |
| Could not be decided from the protocol | 25 | 26% |

Caveats: a single labeller, and it was the same model whose answers were under review; misses (errors the reviewer did
not notice) were not measured; the "Claude reviews Codex" direction has seen little traffic.

## Limitations

- The notice arrives after the answer, so the user reads the wrong claim first. With the inbox hook the agent sees it
  only with the next user message.
- Only the main agent's final answer is checked, not subagents.
- It catches disagreement with what was shown, not untruth in general: if a tool returned wrong data, an answer based
  on it is "confirmed".
- Images are not available to the reviewer.
- Redaction is pattern-based and does not guarantee that nothing sensitive leaves the machine. The session protocol is
  sent to the other model's provider; make sure you are comfortable with that.

## License

MIT.
