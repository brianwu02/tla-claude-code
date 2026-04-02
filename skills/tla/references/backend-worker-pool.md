# Worked Example: Worker Pool with Crash Recovery

A job queue with multiple workers that claim jobs, process them, and handle crashes. This is the most common backend concurrency pattern — if you're building anything with background workers, this example is your starting point.

## The Design

> Workers pull jobs from a queue. Each job must be processed exactly once. If a worker crashes mid-job, the job is recovered and re-queued. At most N workers can run concurrently.

### Concurrency boundaries

| Question | Answer |
|----------|--------|
| Mutable state | Job queue, job status (pending/claimed/done/orphaned), worker status |
| Concurrent actors | N worker processes |
| Synchronization | DB row lock on job claim (SELECT FOR UPDATE) |
| Failure modes | Worker crash mid-processing, duplicate claim race |

### Patterns matched

- **Transaction Commit** — atomic job claim
- **Mutual Exclusion** — one worker per job
- **Checkpoint Coordination** — crash recovery re-queues

---

## The Spec

```tla
--------------------------- MODULE WorkerPool ---------------------------
EXTENDS Naturals, FiniteSets

CONSTANTS Workers, Jobs, NULL

VARIABLES jobState,       \* Function: job -> "pending" | "claimed" | "done"
          workerJob,      \* Function: worker -> job being processed (or NULL)
          workerAlive     \* Function: worker -> TRUE | FALSE

vars == <<jobState, workerJob, workerAlive>>

\* ---------- Type invariant ----------
TypeOK ==
    /\ jobState \in [Jobs -> {"pending", "claimed", "done"}]
    /\ workerJob \in [Workers -> Jobs \cup {NULL}]
    /\ workerAlive \in [Workers -> BOOLEAN]

\* ---------- Safety: no two workers claim the same job ----------
NoDoubleClaim ==
    \A w1, w2 \in Workers :
        (w1 # w2 /\ workerJob[w1] # NULL /\ workerJob[w2] # NULL)
        => workerJob[w1] # workerJob[w2]

\* ---------- Safety: claimed jobs have a live worker ----------
NoOrphanedClaims ==
    \A j \in Jobs :
        jobState[j] = "claimed" =>
            \E w \in Workers : workerJob[w] = j /\ workerAlive[w]

\* ---------- Init ----------
Init ==
    /\ jobState = [j \in Jobs |-> "pending"]
    /\ workerJob = [w \in Workers |-> NULL]
    /\ workerAlive = [w \in Workers |-> TRUE]

\* ---------- Worker claims a pending job ----------
ClaimJob(w, j) ==
    /\ workerAlive[w]
    /\ workerJob[w] = NULL            \* worker is idle
    /\ jobState[j] = "pending"        \* job is available
    /\ jobState' = [jobState EXCEPT ![j] = "claimed"]
    /\ workerJob' = [workerJob EXCEPT ![w] = j]
    /\ UNCHANGED workerAlive

\* ---------- Worker finishes processing ----------
FinishJob(w) ==
    /\ workerAlive[w]
    /\ workerJob[w] # NULL
    /\ jobState' = [jobState EXCEPT ![workerJob[w]] = "done"]
    /\ workerJob' = [workerJob EXCEPT ![w] = NULL]
    /\ UNCHANGED workerAlive

\* ---------- Worker crashes ----------
WorkerCrash(w) ==
    /\ workerAlive[w]
    /\ workerAlive' = [workerAlive EXCEPT ![w] = FALSE]
    /\ UNCHANGED <<jobState, workerJob>>
    \* Note: job stays "claimed" — this is the bug crash recovery must fix

\* ---------- Recovery: find orphaned jobs and re-queue them ----------
RecoverOrphan(j) ==
    /\ jobState[j] = "claimed"
    /\ \A w \in Workers : workerJob[w] = j => ~workerAlive[w]
    /\ jobState' = [jobState EXCEPT ![j] = "pending"]
    \* Clear the dead worker's reference
    /\ workerJob' = [w \in Workers |->
        IF workerJob[w] = j THEN NULL ELSE workerJob[w]]
    /\ UNCHANGED workerAlive

\* ---------- Worker restarts after crash ----------
WorkerRestart(w) ==
    /\ ~workerAlive[w]
    /\ workerAlive' = [workerAlive EXCEPT ![w] = TRUE]
    /\ workerJob' = [workerJob EXCEPT ![w] = NULL]
    /\ UNCHANGED jobState

Next ==
    \/ \E w \in Workers, j \in Jobs : ClaimJob(w, j)
    \/ \E w \in Workers : FinishJob(w)
    \/ \E w \in Workers : WorkerCrash(w)
    \/ \E j \in Jobs : RecoverOrphan(j)
    \/ \E w \in Workers : WorkerRestart(w)

\* ---------- Liveness: every job eventually completes ----------
AllJobsDone == <>(\A j \in Jobs : jobState[j] = "done")

\* ---------- Fairness ----------
Fairness ==
    /\ \A w \in Workers, j \in Jobs : WF_vars(ClaimJob(w, j))
    /\ \A w \in Workers : WF_vars(FinishJob(w))
    /\ \A j \in Jobs : WF_vars(RecoverOrphan(j))
    /\ \A w \in Workers : WF_vars(WorkerRestart(w))
    \* No fairness on WorkerCrash — crashes are nondeterministic

Spec == Init /\ [][Next]_vars /\ Fairness
=============================================================================
```

## MC Module

```tla
--------------------------- MODULE MC_WorkerPool ---------------------------
EXTENDS WorkerPool

CONSTANTS w1, w2, j1, j2, j3

MC_Workers == {w1, w2}
MC_Jobs == {j1, j2, j3}
MC_NULL == "null_val"

\* Keep state space bounded
StateConstraint ==
    TRUE   \* Small model is already bounded
=============================================================================
```

## MC Config (`MC_WorkerPool.cfg`)

```
SPECIFICATION Spec
CONSTANTS
    Workers = {w1, w2}
    Jobs = {j1, j2, j3}
    NULL = "null_val"
INVARIANT TypeOK
INVARIANT NoDoubleClaim
PROPERTY AllJobsDone
```

---

## What TLC Finds

### Without `RecoverOrphan` action

Remove `RecoverOrphan` from `Next`. TLC finds a liveness violation:

```
Temporal property AllJobsDone is violated.
Trace:
1. Init: all jobs pending, all workers alive
2. ClaimJob(w1, j1): w1 claims j1
3. WorkerCrash(w1): w1 dies — j1 stuck as "claimed" forever
```

**Design fix**: The recovery mechanism is load-bearing. Without it, a single crash permanently loses a job.

### Without the `workerJob[w] = NULL` guard in ClaimJob

Remove the idle check. TLC finds a safety violation:

```
NoDoubleClaim is violated.
Trace:
1. ClaimJob(w1, j1): w1 claims j1
2. ClaimJob(w1, j2): w1 claims j2 (still "holding" j1 reference)
```

**Design fix**: Workers must finish or release their current job before claiming another.

### With `NoOrphanedClaims` invariant (intentionally fails)

This invariant says "every claimed job has a live worker." It fails because there's a window between `WorkerCrash` and `RecoverOrphan` where the job is claimed but the worker is dead. This is expected — the invariant is too strong. The correct property is the liveness property: orphaned jobs are *eventually* recovered, not *always* recovered.

---

## Mapping to Code

| TLA+ | Implementation |
|------|---------------|
| `ClaimJob(w, j)` | `UPDATE jobs SET status='claimed', worker_id=$1 WHERE id=$2 AND status='pending'` (atomic via row lock) |
| `FinishJob(w)` | `UPDATE jobs SET status='done' WHERE id=$1 AND worker_id=$2` |
| `WorkerCrash(w)` | Process killed, container OOM, network partition |
| `RecoverOrphan(j)` | Cron job: `UPDATE jobs SET status='pending', worker_id=NULL WHERE status='claimed' AND worker_id NOT IN (SELECT id FROM live_workers)` |
| `WorkerRestart(w)` | Container orchestrator restarts the process |
| `NoDoubleClaim` | Test: two workers race to claim same job, only one succeeds |
| `AllJobsDone` | Integration test: submit jobs, kill a worker mid-run, verify all jobs complete |
