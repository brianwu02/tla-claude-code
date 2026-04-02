# general-tla

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
git clone https://github.com/YOUR_USERNAME/general-tla.git /tmp/general-tla
cd /path/to/your-project
bash /tmp/general-tla/setup.sh
```

Requires Java 11+.

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

## Learn more

- [Learn TLA+](https://learntla.com/) by Hillel Wayne
- [Leslie Lamport's TLA+ Home Page](https://lamport.azurewebsites.net/tla/tla.html)
- [TLA+ Examples](https://github.com/tlaplus/Examples)

## License

MIT
