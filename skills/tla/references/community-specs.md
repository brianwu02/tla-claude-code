# Community TLA+ Specifications

Curated specifications from the [tlaplus/examples](https://github.com/tlaplus/examples) repository, organized by the patterns in this skill's catalog. Each entry describes what the spec models, why it's useful to study, and how it maps to real-world code.

Source: https://github.com/tlaplus/examples (MIT License)

---

## Starting Point

### DiningPhilosophers

**Path**: `specifications/DiningPhilosophers/`
**Pattern**: Mutual Exclusion, Deadlock
**Source**: [tlaplus/examples](https://github.com/tlaplus/examples/tree/master/specifications/DiningPhilosophers)

Five philosophers share forks. Each needs two forks to eat. Classic deadlock scenario — if every philosopher picks up their left fork simultaneously, nobody can eat.

**Why read this**: If you've never read a TLA+ spec before, start here. The problem is simple enough to understand in 30 seconds, and the spec is short enough to read in 5 minutes. It demonstrates deadlock detection, resource contention, and fairness — concepts that apply to every other spec in this list.

**Maps to**: Any system where multiple actors compete for shared resources — database connections, file locks, API rate limits.

---

## Backend Patterns

### transaction_commit

**Path**: `specifications/transaction_commit/`
**Pattern**: Transaction Commit
**Source**: [tlaplus/examples](https://github.com/tlaplus/examples/tree/master/specifications/transaction_commit)

Two-phase commit protocol. A coordinator asks participants to prepare, then commit or abort. Models the case where participants can fail between prepare and commit.

**Why read this**: This is the spec behind every database transaction, every distributed write, every "atomic operation" you've ever relied on. The spec shows exactly why partial failures make distributed transactions hard — and how the two-phase protocol handles them.

**Maps to**: `BEGIN/COMMIT` in SQL, Stripe payment capture (authorize then capture), any multi-step operation that must be all-or-nothing. If your code does two writes that "must both succeed," you're implementing a variant of this.

---

### ReadersWriters

**Path**: `specifications/ReadersWriters/`
**Pattern**: Readers-Writers
**Source**: [tlaplus/examples](https://github.com/tlaplus/examples/tree/master/specifications/ReadersWriters)

Multiple readers can access a resource concurrently, but writers need exclusive access. Models reader/writer priorities and starvation.

**Why read this**: The readers-writers pattern appears in caches (many reads, occasional write-through), databases (read replicas vs write primary), and frontend state (multiple components reading while one mutation is in-flight).

**Maps to**: Redis read-through caches, React state with concurrent readers and async mutations, database connection pools with read/write splitting, `SharedArrayBuffer` in web workers.

---

### allocator

**Path**: `specifications/allocator/`
**Pattern**: Resource Allocator
**Source**: [tlaplus/examples](https://github.com/tlaplus/examples/tree/master/specifications/allocator)

A generic resource allocation system. Clients request sets of resources, the allocator grants them when available, clients release when done.

**Why read this**: Any system with a pool of limited resources uses this pattern — worker pools, connection pools, thread pools, rate limiters, IP address assignment.

**Maps to**: Database connection pools, worker thread dispatch, Kubernetes pod scheduling, API rate limit token buckets, VPN exit node assignment.

---

### SingleLaneBridge

**Path**: `specifications/SingleLaneBridge/`
**Pattern**: Bounded Concurrency
**Source**: [tlaplus/examples](https://github.com/tlaplus/examples/tree/master/specifications/SingleLaneBridge)

Cars cross a single-lane bridge from both directions. At most N cars on the bridge, all going the same direction. Models bounded concurrency with directionality.

**Why read this**: Intuitive mental model for "at most N concurrent operations." The directionality adds a dimension most simple semaphore examples miss — in real systems, read operations and write operations often can't be concurrent.

**Maps to**: API endpoints with `max_concurrent` limits, build pipelines (N parallel jobs, one deploy at a time), database migration locks (reads OK, writes blocked during migration).

---

### lamport_mutex

**Path**: `specifications/lamport_mutex/`
**Pattern**: Mutual Exclusion (distributed)
**Source**: [tlaplus/examples](https://github.com/tlaplus/examples/tree/master/specifications/lamport_mutex)

Lamport's distributed mutual exclusion algorithm. Processes coordinate via message passing (no shared memory) to ensure only one enters the critical section at a time.

**Why read this**: This is Lamport's original algorithm from the paper that introduced logical clocks. The spec shows how to achieve mutual exclusion without a central lock server — relevant to any system where a single coordinator is a bottleneck or single point of failure.

**Maps to**: Distributed cron (only one instance runs the job), leader election, exclusive write access across multiple app servers.

---

### Bakery-Boulangerie

**Path**: `specifications/Bakery-Boulangerie/`
**Pattern**: Mutual Exclusion (without hardware support)
**Source**: [tlaplus/examples](https://github.com/tlaplus/examples/tree/master/specifications/Bakery-Boulangerie)

Lamport's bakery algorithm. Processes take a "ticket number" and enter the critical section in ticket order. No atomic hardware instructions required.

**Why read this**: Shows that mutual exclusion is possible with just reads and writes — no locks, no CAS, no `SELECT FOR UPDATE`. The ticket-based approach maps to real-world queuing systems.

**Maps to**: Job queues with priority ordering, customer service ticket systems, any "take a number" pattern in distributed systems.

---

## Coordination Patterns

### CheckpointCoordination

**Path**: `specifications/CheckpointCoordination/`
**Pattern**: Checkpoint Coordination
**Source**: [tlaplus/examples](https://github.com/tlaplus/examples/tree/master/specifications/CheckpointCoordination)

Coordinating checkpoints across distributed processes so that recovery after a crash restores a consistent global state.

**Why read this**: If your system has crash recovery — re-queuing orphaned jobs, rebuilding in-memory state from a WAL, restoring a user's session — this spec formalizes what "consistent recovery" means.

**Maps to**: Database WAL replay, Redis AOF recovery, application-level crash recovery (re-queuing stuck jobs), browser session restoration after tab crash.

---

### ewd840

**Path**: `specifications/ewd840/`
**Pattern**: Termination Detection
**Source**: [tlaplus/examples](https://github.com/tlaplus/examples/tree/master/specifications/ewd840)

Dijkstra's algorithm for detecting termination in a ring of processes. A token circulates — when it returns to the initiator unchanged, all processes have terminated.

**Why read this**: This fills the "gap" in our pattern catalog. Any time you need to know "are all workers done?" — batch job completion, migration sweep finished, all websocket clients disconnected — this is the formal version.

**Maps to**: `Promise.all()` semantics (but for distributed systems), MapReduce job completion, "all shards migrated" detection, waiting for all background tasks to drain before shutdown.

---

### KeyValueStore

**Path**: `specifications/KeyValueStore/`
**Pattern**: Cache Invalidation, Snapshot Isolation
**Source**: [tlaplus/examples](https://github.com/tlaplus/examples/tree/master/specifications/KeyValueStore)

A snapshot-isolated key-value store. Readers see a consistent point-in-time snapshot while writers update concurrently.

**Why read this**: Snapshot isolation is what makes "read your own writes" work in databases, and what makes optimistic UI possible in frontends. This spec formalizes the boundary between "stale but consistent" and "fresh but potentially torn."

**Maps to**: React Query stale-while-revalidate, Redis snapshot reads during write-behind, database MVCC (PostgreSQL's default isolation), localStorage reads while IndexedDB syncs.

---

## How to Use These

These specs are meant to be read, not copied. Use them as:

1. **Learning material** — Read a spec that maps to a pattern you're working with. The tlaplus/examples repo includes comments explaining each action and invariant.

2. **Reference implementations** — When writing your own spec, check if a community spec models the same pattern. Compare your actions and invariants against the reference to catch gaps.

3. **Starting points** — Fork a community spec and adapt it to your domain. `ReadersWriters` with your specific cache semantics, `allocator` with your specific pool constraints.

4. **Validation** — If your spec models the same pattern as a community spec but has different invariants, investigate. Either your system has additional requirements (good — document them) or you're missing something the community spec catches.
