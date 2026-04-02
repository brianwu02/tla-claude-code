# Pattern Catalog & Translation Guide

Three reference tables for mapping real-world systems to TLA+ specifications.

**Sources and attribution:**
- Pattern names and classifications draw from the concurrency patterns literature, particularly Leslie Lamport's [Specifying Systems](https://lamport.azurewebsites.net/tla/book.html) and Hillel Wayne's [Learn TLA+](https://learntla.com/).
- Community specifications referenced below are from [tlaplus/examples](https://github.com/tlaplus/examples) (MIT License).
- Frontend patterns (Optimistic Update, Multi-Tab Sync, Offline-First, UX Flow Reduction) are original to this skill.

---

## 1. Pattern Catalog

Maps common design-doc and codebase language to known concurrency patterns. When your design doc or code uses phrases from the "Trigger Phrases" column, the corresponding pattern applies. Most real systems combine 1-3 patterns.

### Backend Patterns

| Pattern | Trigger Phrases | What It Models | Community Spec |
|---------|----------------|----------------|----------------|
| Transaction Commit | "atomic claim/release", "lock row", "SELECT FOR UPDATE", "all-or-nothing" | Multiple participants agree to commit or abort. Partial failure between prepare and commit. | [`transaction_commit`](https://github.com/tlaplus/examples/tree/master/specifications/transaction_commit) |
| Resource Allocator | "round-robin", "pool dispatch", "assign X to worker", "connection pool" | Clients request resources from a finite pool. Allocator grants when available, clients release when done. | [`allocator`](https://github.com/tlaplus/examples/tree/master/specifications/allocator) |
| Failure Detector | "heartbeat", "healthcheck", "detect dead node", "timeout" | Processes monitor each other's liveness. Unreliable detection can cause false positives (premature failover) or false negatives (undetected crash). | [`detector_chan96`](https://github.com/tlaplus/examples/tree/master/specifications/detector_chan96) |
| Blocking Queue | "bounded queue", "producer/consumer", "workers consume from queue", "backpressure" | Producers add to a bounded buffer. Consumers remove. Queue full blocks producers; queue empty blocks consumers. | [`Disruptor`](https://github.com/tlaplus/examples/tree/master/specifications/Disruptor) |
| Termination Detection | "all workers done", "sweep complete", "cycle finished", "drain queue" | Detecting global quiescence — all processes idle, no messages in flight. | [`ewd840`](https://github.com/tlaplus/examples/tree/master/specifications/ewd840) |
| Checkpoint Coordination | "crash recovery", "re-queue orphans", "rebuild on restart", "WAL replay" | Coordinating consistent snapshots across processes so recovery after a crash restores a valid global state. | [`CheckpointCoordination`](https://github.com/tlaplus/examples/tree/master/specifications/CheckpointCoordination) |

### Backend / Frontend Patterns

| Pattern | Trigger Phrases | What It Models | Community Spec |
|---------|----------------|----------------|----------------|
| Readers-Writers | "concurrent read/write", "writers update while readers serve", "read replica" | Multiple concurrent readers, exclusive writers. Variants differ on priority (reader-priority, writer-priority, fair). | [`ReadersWriters`](https://github.com/tlaplus/examples/tree/master/specifications/ReadersWriters) |
| Mutual Exclusion | "only one X can", "exclusive access", "single writer", "distributed lock" | At most one actor in the critical section at a time. Many algorithms exist — with locks, without locks, distributed, local. | [`lamport_mutex`](https://github.com/tlaplus/examples/tree/master/specifications/lamport_mutex), [`Bakery-Boulangerie`](https://github.com/tlaplus/examples/tree/master/specifications/Bakery-Boulangerie) |
| Lifecycle State Machine | "progresses through phases", "must X before Y", "status transitions" | Entity moves through ordered states with guards. Invalid transitions are safety violations. | — |
| Cache Invalidation | "stale read", "TTL expiry", "write-through/write-behind", "stale-while-revalidate" | Maintaining consistency between a cache and a source of truth under concurrent reads and writes. | [`KeyValueStore`](https://github.com/tlaplus/examples/tree/master/specifications/KeyValueStore) |

### Frontend Patterns

| Pattern | Trigger Phrases | What It Models | Community Spec |
|---------|----------------|----------------|----------------|
| Optimistic Update | "apply locally, confirm from server", "rollback on reject", "pending mutation" | UI updates immediately, server confirms or rejects asynchronously. Concurrent updates from other users via websocket. | — (see `references/frontend-optimistic-ui.md`) |
| Multi-Tab Sync | "consistent across tabs", "BroadcastChannel", "SharedWorker", "tab coordination" | Multiple browser tabs sharing state. Writes in one tab must be visible in others. Auth state, cart contents, preferences. | — |
| Offline-First Sync | "queue while offline", "sync on reconnect", "conflict resolution", "local-first" | Operations queued locally during network loss. On reconnect, sync with server. Conflicts between local and remote state. | — |
| Real-Time Collaboration | "concurrent edits", "operational transform", "CRDT", "multiplayer" | Multiple users editing the same document/resource simultaneously. Operation ordering, conflict resolution, convergence. | — |

### UX / Flow Patterns

| Pattern | Trigger Phrases | What It Models | Community Spec |
|---------|----------------|----------------|----------------|
| Screen Flow | "checkout flow", "too many steps", "reduce screens", "simplify the funnel" | Deterministic screen-to-screen navigation. No concurrency. Analysis identifies merge candidates, routing-only nodes, shortest paths. **Fast-path: safety only, CHECK_DEADLOCK FALSE, skip adversarial.** | — (see `references/ux-state-reduction.md`) |
| Component State | "button updates after X", "enable when Y changes", "form validates when Z", "modal blocks until" | Component state dependencies with async callbacks and render timing. Has real concurrency — interleaving between user actions and async results. Normal workflow. | — |

---

## 2. Design-to-Spec Translation Guide

Direct mapping from natural-language design patterns to TLA+ constructs. Use this when translating a modeling brief into a spec.

### Ordering & Guards

| Design Doc Pattern | TLA+ Construct | Example |
|-------------------|----------------|---------|
| "X must happen before Y" | Guard: `stateVar = "X_done"` in Y's action | `PrepareComplete(node)` must precede `Commit(node)` |
| "Bounded queue of size N" | `StateConstraint: Len(queue) <= N` + invariant | Queue never exceeds capacity |
| "TTL-based expiry" | Tick action + guard: `expiresAt[x] <= clock` | Cache entries expire after N ticks |
| "Idempotent retry" | Action guard allows re-entry: `state[x] \in {"pending", "failed"}` | Retrying a failed payment |

### Safety (bad things that must never happen)

| Design Doc Pattern | TLA+ Construct | Example |
|-------------------|----------------|---------|
| "Only one X can..." | `Cardinality({x \in S : state[x] = "active"}) <= 1` | Only one worker processes a given job |
| "At most N concurrent" | `Cardinality({w : state[w] = "busy"}) <= N` | Max 8 concurrent scraper connections |
| "Last-writer-wins" | Version counter on server; reject if `clientVersion < serverVersion` | Optimistic locking on database rows |

### Liveness (good things that must eventually happen)

| Design Doc Pattern | TLA+ Construct | Example |
|-------------------|----------------|---------|
| "Eventually every X gets Y" | `\A x \in X : <>(state[x] = "Y")` | Every job eventually completes |
| "If X crashes, Y recovers" | Crash action + recovery action, `WF_vars(Recover)` | Orphaned jobs are re-queued |

### Frontend-Specific

| Design Doc Pattern | TLA+ Construct | Example |
|-------------------|----------------|---------|
| "Apply locally, confirm later" | Separate `localState` and `serverState` variables; rollback action on reject | Optimistic UI mutation |
| "Sync across tabs/sessions" | Broadcast queue per actor; `EventualConsistency` invariant when quiescent | Cart state across browser tabs |

### UX — Screen Flow (deterministic, fast-path)

| Design Doc Pattern | TLA+ Construct | Example |
|-------------------|----------------|---------|
| "User must go through N screens" | Model each screen as a state; `NotDone` invariant trick finds shortest path. `CHECK_DEADLOCK FALSE` required. | Checkout flow analysis |
| "Simplify the checkout/onboarding" | State machine with step counter; compare path lengths across user segments | Reducing 11 screens to 7 |

Screen Flow specs are deterministic — no concurrency, no fairness, no liveness. Use safety-only with `CHECK_DEADLOCK FALSE` (terminal states have no outgoing actions). Skip adversarial review.

### UX — Component State (has concurrency, normal workflow)

| Design Doc Pattern | TLA+ Construct | Example |
|-------------------|----------------|---------|
| "Button enables after async completes" | Guard: `asyncResult # NULL` in `EnableButton` action; safety invariant: button enabled ↔ data loaded | Calendar select → Book button |
| "Form validates when field changes" | Async validation action + render action; invariant: submitted ↔ all fields valid | Email validation on blur |
| "Modal blocks until confirmed" | Modal state variable; guard on all other actions: `modalOpen = FALSE` | Delete confirmation dialog |

Component State specs have real concurrency: async callbacks interleave with user actions and render cycles. Needs safety invariants at minimum, possibly liveness.

---

## 3. Abstraction Guide

The art of TLA+ is choosing the right abstraction level. Model too much and TLC can't explore the state space. Model too little and you miss real bugs.

### System-to-Model Mapping

| Real system | TLA+ model | Rationale |
|-------------|------------|-----------|
| 100 server instances | 2-3 nodes | Symmetry reduction — if it breaks with 2, it breaks with 100 |
| Millions of users | 2 users | Enough to find all race conditions between concurrent actors |
| 5-minute cron interval | `CronInterval = 5` ticks | Discrete time, not wall-clock time |
| HTTP request/response | Atomic action | Send and receive in one step — network latency is modeled by interleaving |
| Database write | Side-effect — not modeled | Unless read-back matters for the invariant |
| Retry with backoff | Counter variable + guard | No real time — just "retryCount < maxRetries" |
| localStorage / IndexedDB | Function variable `store[key]` | Persistent across actions but local to one actor |
| WebSocket message | Append to per-actor queue | Ordered, reliable delivery within one connection |
| Tab close / browser crash | Nondeterministic `Crash(actor)` action | Can happen at any point — TLC explores all timings |

### Fairness

Fairness assumptions determine what TLC assumes about scheduling. Getting these wrong produces false liveness violations or hides real ones.

| Type | Notation | Meaning | Use for |
|------|----------|---------|---------|
| Weak fairness | `WF_vars(Action)` | If continuously enabled, eventually taken | Worker pickup, clock tick, message delivery |
| Strong fairness | `SF_vars(Action)` | If repeatedly enabled (even intermittently), eventually taken | Recovery that needs all workers idle, GC |
| No fairness | (omit) | May never happen | Environment faults — crashes, network partitions, user actions |

**Common mistake**: Giving fairness to crash/failure actions. Crashes are nondeterministic — the whole point is that TLC tries every possible timing. Adding fairness to crashes forces them to happen, which is wrong (the system should work even if nothing crashes).

### Lessons from Production Specs

These lessons come from applying TLA+ to real production systems — a scraper fleet with 65 VPN containers, a multi-layer cache serving 7,000+ parks, and a distributed job queue. Each lesson was learned the hard way (false violations, state explosions, or missed bugs).

#### Cap accumulators

Unbounded counters (scrape count, retry count, version number) multiply the state space exponentially. A counter going 0→1→2→...→N creates N states per actor per tick.

**Fix**: Cap at the minimum value needed to prove the property. "Every job gets scraped at least once" only needs `scraped ≤ 2` (0 = not scraped, 1 = scraped, 2 = scraped again — proves re-scraping works). One production spec went from 16M+ states (intractable after 4 hours) to under 4M states after capping counters.

#### Use CONSTRAINT, not guarded Tick

For time-based specs, bound time with a `StateConstraint` in the MC module, **not** by guarding the `Tick` action with `clock < MaxTime`.

**Why**: A guarded Tick prevents timers from firing at the time boundary. If a cooldown expires at tick 10 and MaxTime is 10, the expiry action is never enabled — causing a false liveness violation. `StateConstraint` stops state exploration beyond the bound without preventing the final tick's actions from firing.

```tla
\* WRONG — causes false liveness violations at time boundary
Tick == /\ clock < MaxTime
        /\ clock' = clock + 1

\* RIGHT — constraint stops exploration, doesn't block actions
StateConstraint == clock <= MaxTime
```

#### Model explicit crash recovery

If workers can crash mid-operation, add a `processing` set (or equivalent) to track in-flight work. Without it, a crashed worker leaves a job permanently stuck in "claimed" state with no path to recovery.

The pattern:
- `ClaimJob`: move job from `pending` to `processing`, assign to worker
- `FinishJob`: move job from `processing` to `done`
- `WorkerCrash`: worker dies — job stays in `processing`
- `RecoverOrphan`: detect job in `processing` with dead worker → move back to `pending`

Liveness property: every job eventually leaves `processing`. This caught a real bug where a cache rebuild worker could crash mid-recompute, stranding parks in the processing set permanently.

#### Snapshot variables for consistency

When clients read from a mutable store (cache, database, shared state), model the read as a **snapshot variable** — a separate copy captured at read time, not a reference to the live state.

```tla
\* Client reads a snapshot, not the live cache
ClientRead(c) ==
    /\ snapshot' = [snapshot EXCEPT ![c] = cacheContent]
    /\ UNCHANGED cacheContent  \* cache may change after snapshot
```

This catches race conditions where the cache updates between a client's read and its use of the data. A production spec for a two-layer cache revealed that clients could serve stale data if the cache was updated between compute and delivery — the snapshot variable made this visible.

#### Fairness stratification

Use **weak fairness** (`WF`) for actions that stay enabled once their guard is true (worker pickup, clock tick, message delivery). Use **strong fairness** (`SF`) for actions that are only transiently enabled — they flicker on and off because their guard depends on other actors' state.

Example: orphan recovery needs all workers to be idle. Workers are constantly picking up and finishing jobs, so "all workers idle" is only intermittently true. `WF` on recovery would be wrong — it requires the action to be *continuously* enabled. `SF` is correct — it fires if the action is *repeatedly* enabled, even if only briefly.

Missing fairness on a single action, or the wrong type (WF vs SF), causes false liveness violations that are hard to diagnose. Check fairness assignments whenever you see unexpected liveness failures.

#### Symmetry reduction

Start with the smallest model that can have a conflict: 2 actors, 3 items, queues capped at 6. Scale up only if TLC passes and you suspect the small model is hiding bugs.

#### Three-valued logic

If your system has NULL/unknown states — not just true/false — model them explicitly. A boolean that's actually a three-valued enum (`TRUE`, `FALSE`, `NULL`) behaves differently under negation.

Example: SQL `WHERE scrape_enabled IS NOT FALSE` matches both `TRUE` and `NULL` rows. A two-valued boolean model would miss the `NULL` case entirely, hiding bugs where newly-inserted rows (with `NULL` default) are unexpectedly included in queries.

Model: `scrapeEnabled[s] \in {"TRUE", "FALSE", "NULL"}` with guard `scrapeEnabled[s] # "FALSE"` — matches the real SQL semantics.

#### Nondeterminism for environment

External events (network failures, health check results, user actions, crash timing) should be **nondeterministic actions**, not deterministic sequences. Don't model "health check returns healthy" — model "health check returns `\E result \in {Healthy, Unhealthy, Timeout}`" and let TLC explore all outcomes.

```tla
\* WRONG — deterministic, only tests one outcome
HealthCheck(node) ==
    /\ nodeState' = [nodeState EXCEPT ![node] = "healthy"]

\* RIGHT — nondeterministic, TLC tests all outcomes
HealthCheck(node) ==
    /\ \E result \in {"healthy", "unhealthy", "timeout"} :
        nodeState' = [nodeState EXCEPT ![node] = result]
```

This is one of TLA+'s core strengths — you describe what *can* happen, and TLC systematically tries every possibility. Deterministic environment modeling defeats the purpose.
