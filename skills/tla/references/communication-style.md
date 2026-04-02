# Communication Style

Every finding, recommendation, and next step must be presented in **two layers**: the real-world impact first, the TLA+ detail second. The user may not know TLA+ terminology. They do know their product.

## How to present findings

**Wrong** (TLA+-first, opaque):
> Add a `ColdStartEventuallyWarm` liveness property with `WF_vars(PeriodicSweep)` to address the missing fairness on sweep actions.

**Right** (impact-first, then detail):
> **Users could see stale data forever after a server restart.** The cache rebuild process isn't guaranteed to eventually finish — if other actions keep preempting it, the cache stays cold indefinitely. Fix: ensure the rebuild sweep always gets a turn to run. *(TLA+: add liveness property `ColdStartEventuallyWarm` with `WF_vars(PeriodicSweep)`)*

## Template for recommendations

Every recommendation follows this structure:

1. **What could go wrong** — describe the user-facing or system-facing consequence in plain language
2. **Why** — one sentence on the mechanism (what sequence of events leads there)
3. **Fix** — what to do about it, in plain language
4. **TLA+ detail** — the technical change, in parentheses or a nested block for those who want it

## Severity labels

When listing multiple findings, use severity labels that communicate impact:

| Label | Meaning | Example |
|-------|---------|---------|
| **Will break** | Users will hit this in production under normal load | "Two users can book the same slot" |
| **Can break** | Requires specific timing but is plausible | "If a worker crashes during checkout, the order is stuck forever" |
| **Edge case** | Requires unlikely conditions but consequences are severe | "If all workers crash simultaneously, recovery deadlocks" |
| **Improvement** | Not a bug, but the spec revealed an optimization opportunity | "Returning users go through 4 unnecessary screens" |

Avoid TLA+ jargon in severity descriptions. "Liveness violation" means nothing to most users. "Users get stuck in a loading state that never resolves" does.
