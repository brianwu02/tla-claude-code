# tla-claude-code

A [Claude Code](https://docs.anthropic.com/en/docs/claude-code) skill that leverages [TLA+](https://lamport.azurewebsites.net/tla/tla.html), Leslie Lamport's formal verification framework, to find concurrency bugs by checking every possible ordering of events. Works from design docs or existing code.

```
/tla "user clicks Pay twice fast, what if both requests go through?"
```

```
FAIL: NoDuplicateCharge
  1. UserClick        → request #1 in flight, setState(disabled) queued
  2. UserClick        → request #2 (button still enabled, setState hasn't flushed)
  3. ServerAccept(#1) → charged
  4. ServerAccept(#2) → DOUBLE CHARGE

Fix: guard on useRef, not useState. Refs update synchronously.
```

## Install

```bash
git clone https://github.com/brianwu02/tla-claude-code.git /tmp/tla-claude-code
cd /path/to/your-project
bash /tmp/tla-claude-code/setup.sh
```

Requires Java 11+. The setup script copies skill files into your project and downloads TLA+ tools if missing.

## More examples

### Frontend — race condition

```
/tla "can two users book the same slot?"
```

```
PASS: NoDoubleBook         — at most one user holds a given slot
FAIL: StaleAvailabilityUI  — user 2 still sees "available" after user 1 books
```

### UX — flow simplification

```
/tla "my checkout has 11 screens, can we simplify it?"
```

```
Shortest path (returning user, saved payment):  7 steps
Longest path (guest, first time):              11 steps

Merge candidates:
  - search_results + site_detail  → always adjacent
  - guest_info + shipping         → both collect contact info
  - review + confirm              → review is read-only
```

### Backend — crash recovery

```
/tla "two workers grab the same job from the queue — is our locking safe?"
```

```
PASS: NoDoubleClaim           — no two workers process the same job
PASS: AllJobsDone (liveness)  — every job eventually completes
FAIL: NoOrphanedClaims        — window between crash and recovery
                                 where a job is claimed but worker is dead
```

## How it works

One prompt asks what you're working with and how thorough to be. Then:

1. **Extract** — reads your design doc or code, identifies concurrency boundaries
2. **Spec** — writes a TLA+ spec with safety and liveness properties
3. **Align** — verifies spec matches your source material
4. **Model-Check** — TLC explores every reachable state, reports violations with exact traces
5. **Implement or fix** — maps findings to code changes and test cases

Full details in [SKILL.md](SKILL.md).

## What's included

- **Before/after code examples** — see the buggy version and the fix side-by-side (Python, TypeScript, React)
- **Works on frontend and backend** — double-clicks, stale caches, crashed workers, booking conflicts, multi-tab bugs
- **UX flow analysis** — finds unnecessary screens in your checkout/onboarding and tells you which ones to cut
- **Explains findings in plain English** — "users could be charged twice" not "liveness violation on temporal property"
- **Estimates runtime before checking** — tells you "~15 seconds on your machine" before it starts, not after
- **One prompt to configure** — pick Quick (seconds), Standard (minutes), or Thorough (deep analysis) and it handles the rest

## Learn more

- [Learn TLA+](https://learntla.com/) by Hillel Wayne
- [Leslie Lamport's TLA+ Home Page](https://lamport.azurewebsites.net/tla/tla.html)
- [TLA+ Examples](https://github.com/tlaplus/Examples)

## License

MIT
