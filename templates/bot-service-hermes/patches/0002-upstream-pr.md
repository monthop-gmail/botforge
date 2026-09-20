# Upstream PR package — generic `pre_verify` seam

Prepared against **NousResearch/hermes-agent** `eeb85107f9e6` (upstream `main`, 2026-09-20).
Local branch: `feat/pre-verify-non-editing-turns` · commit `ac57959`.
Patch: `0002-upstream-pr-pre-verify-always.patch` (`git am`-ready).

**Not pushed. No fork created. No PR opened.** See "What remains" below.

---

## PR title

    feat(agent): opt-in pre_verify for turns that edited no files

## PR body

`pre_verify` is the only turn-end seam a plugin can use to keep an agent going,
but the gate is reachable only after the agent edited code
(`agent/turn_stop_gates.py`):

```python
if _edited and has_hook("pre_verify") and attempt < max_verify_nudges():
```

A hook whose policy is not about files can never run. Programmatic callers are
the obvious case: a job runner launches an agent to complete a unit of work, the
model narrates that it finished and stops, and nothing in Hermes can notice that
the work was left undone. The mechanism to fix that already exists one line away
— only its precondition excludes the caller.

### What this changes

1. **`agent.pre_verify_always`** (default `false`) — the hook, not the edit list,
   decides whether the turn may end. Hooks keep receiving `changed_paths` and can
   `return None` immediately, so nothing changes for existing hooks whether or not
   the option is on. `max_verify_nudges` still bounds the loop.

2. **Preflush before the hook runs.** The option alone is not enough. A hook that
   decides on what the turn has already done can only read that back through the
   session store, and the current turn's tool results are not flushed when the gate
   runs. Measured on a real turn: the store held **2 rows at hook time and 4 once
   the turn ended**, so the hook saw a turn that had apparently called nothing.
   The patch flushes first, reusing the same persistence call the interim-answer
   path already makes, wrapped so a failed flush cannot end the turn.

### Compatibility

* Default `false` — no behaviour change for anyone who does not opt in.
* `changed_paths` contract unchanged; edit-only hooks need no edit.
* The preflush runs only inside the gate, and only once the gate has already
  decided to consult a hook.
* `max_verify_nudges` still caps continuations.

### Tests

`tests/agent/test_pre_verify_always.py` (12 cases): gate off/on with and without
edits, existing edit path unchanged, hook returning `None`, no registered hook,
attempt budget, flush ordering, flush failure, no-messages path, and the config
reader.

Related suites re-run green: `tests/agent/test_verify_hooks.py`,
`tests/agent/test_verification_continuation_budget.py`,
`tests/hermes_cli/test_plugins.py` — **107 passed**.

### One open question for maintainers

`pre_verify_always` is not quite accurate: the gate still requires a registered
hook and still respects `max_verify_nudges`, so it is not "always". A name that
says what it does — for example `pre_verify_all_turns` — would read better in
config. The patch is otherwise identical under either name; happy to rename
before merge.

---

## What remains (not done, and why)

Opening the PR touches a third-party repository under another organisation. That
needs a fork under an account we control and a push, which is an outward-facing
action on someone else's project. No standing authorisation covers it, so the
branch and patch are prepared and stopped here.

To finish, someone with that authorisation runs:

```bash
gh repo fork NousResearch/hermes-agent --clone=false
git remote add fork git@github.com:<account>/hermes-agent.git
git push fork feat/pre-verify-non-editing-turns
gh pr create --repo NousResearch/hermes-agent \
  --head <account>:feat/pre-verify-non-editing-turns \
  --title "feat(agent): opt-in pre_verify for turns that edited no files" \
  --body-file <this file's PR body section>
```

## Upstream drift since our deployed version

Our canary runs `v2026.8.3` (`3c27eb62`, 2026-08-03). Upstream `main` is seven
weeks ahead and **the gate moved**: it was extracted from `agent/conversation_loop.py`
into `agent/turn_stop_gates.py`, and `conversation_loop.py` shrank from ~7,250 to
~1,745 lines. The v2026.8.3-shaped patch (`0001-…`) does **not** apply to `main`.

That is why there are two patches:

| file | target | used for |
| --- | --- | --- |
| `0001-pre-verify-always.patch` | `v2026.8.3` | our canary runtime |
| `0002-upstream-pr-pre-verify-always.patch` | `main` @ `eeb85107` | the PR |

They implement the same two changes. The `main` version is smaller and cleaner
because the extracted module gave the preflush an obvious place to live.

## Recommended rollout after merge (not performed)

1. PR merged upstream and released.
2. Bump the canary image to the release that contains it; drop `0001-…` and the
   ephemeral patch step from the runner.
3. Re-run the botforge full-loop harness on the new image — it must stay green
   without the local patch.
4. Only then consider enabling the option on a production instance, as its own
   decision with its own evidence.
