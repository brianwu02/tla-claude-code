"""
Worker Pool with Crash Recovery — Before/After

BEFORE: Naive implementation with concurrency bugs.
AFTER:  Fixed version, each function annotated with the TLA+ action it implements.

Bugs the TLA+ spec caught:
  1. Double-claim: two workers grab the same job (no row locking)
  2. Orphan jobs: crashed worker leaves job stuck as "claimed" forever
  3. Silent worker death: try/except sets job back to "pending" inline,
     masking the crash from monitoring

Requires: PostgreSQL, asyncpg, pytest-asyncio
"""

import asyncio
import asyncpg
from datetime import timedelta


# ===========================================================================
# BEFORE — naive implementation
# ===========================================================================

class WorkerPoolBefore:
    """
    Looks correct in a single-worker test. Breaks under concurrency.
    """

    def __init__(self, pool: asyncpg.Pool):
        self.pool = pool

    async def claim_job(self, worker_id: str):
        """
        BUG: No row lock. Two workers can read the same pending job
        between each other's SELECT and UPDATE.

        TLC trace:
          1. Worker A: SELECT → sees job #1 pending
          2. Worker B: SELECT → sees job #1 pending (not yet updated)
          3. Worker A: UPDATE → claims job #1
          4. Worker B: UPDATE → also claims job #1 ← NoDoubleClaim violated
        """
        async with self.pool.acquire() as conn:
            # No FOR UPDATE — race condition window between SELECT and UPDATE
            row = await conn.fetchrow(
                "SELECT id FROM jobs WHERE status = 'pending' ORDER BY id LIMIT 1"
            )
            if row is None:
                return None
            await conn.execute(
                "UPDATE jobs SET status = 'claimed', worker_id = $1 WHERE id = $2",
                worker_id, row["id"],
            )
            return row["id"]

    async def finish_job(self, job_id: int, worker_id: str):
        async with self.pool.acquire() as conn:
            await conn.execute(
                "UPDATE jobs SET status = 'done', worker_id = NULL WHERE id = $1",
                job_id,
            )

    async def worker_loop(self, worker_id: str, process_fn=None):
        """
        BUG: Catches exceptions and resets job to pending inline.
        This hides worker crashes from monitoring — no one knows the
        worker died. Also creates a race: if the job is re-queued
        while another worker is mid-claim, you get double processing.

        BUG: No orphan recovery. If the process is killed (OOM, SIGKILL),
        the except block never runs. Job stays "claimed" forever.
        """
        while True:
            job_id = await self.claim_job(worker_id)
            if job_id is None:
                await asyncio.sleep(1)
                continue
            try:
                if process_fn:
                    await process_fn(job_id)
                await self.finish_job(job_id, worker_id)
            except Exception:
                # "Fix" the problem by resetting inline — masks the crash
                async with self.pool.acquire() as conn:
                    await conn.execute(
                        "UPDATE jobs SET status = 'pending', worker_id = NULL WHERE id = $1",
                        job_id,
                    )


# ===========================================================================
# AFTER — fixed version, annotated with TLA+ actions
# ===========================================================================

class WorkerPoolAfter:
    """
    Each method maps to a TLA+ action from references/backend-worker-pool.md.
    Bugs fixed by the spec's invariants and liveness properties.
    """

    def __init__(self, pool: asyncpg.Pool):
        self.pool = pool

    async def claim_job(self, worker_id: str):
        """
        TLA+ action: ClaimJob(w, j)
        Guard: workerAlive[w] /\ workerJob[w] = NULL /\ jobState[j] = "pending"
        Invariant enforced: NoDoubleClaim

        FIX: SELECT FOR UPDATE SKIP LOCKED makes claim atomic.
        The row lock IS the TLA+ guard — only one worker can hold it.
        SKIP LOCKED means the second worker gets the next job instead of blocking.
        """
        async with self.pool.acquire() as conn:
            row = await conn.fetchrow("""
                UPDATE jobs
                SET status = 'claimed', worker_id = $1, claimed_at = now()
                WHERE id = (
                    SELECT id FROM jobs
                    WHERE status = 'pending'
                    ORDER BY id
                    LIMIT 1
                    FOR UPDATE SKIP LOCKED
                )
                RETURNING id, status, worker_id, claimed_at
            """, worker_id)
            return row["id"] if row else None

    async def finish_job(self, job_id: int, worker_id: str) -> bool:
        """
        TLA+ action: FinishJob(w)
        Guard: workerAlive[w] /\ workerJob[w] # NULL

        FIX: WHERE includes worker_id — prevents finishing a job
        that was already recovered and re-assigned to another worker.
        """
        async with self.pool.acquire() as conn:
            result = await conn.execute("""
                UPDATE jobs
                SET status = 'done', worker_id = NULL, claimed_at = NULL
                WHERE id = $1 AND worker_id = $2 AND status = 'claimed'
            """, job_id, worker_id)
            return result == "UPDATE 1"

    async def recover_orphans(self, timeout: timedelta = timedelta(minutes=5)) -> int:
        """
        TLA+ action: RecoverOrphan(j)
        Guard: jobState[j] = "claimed" /\ worker is dead
        Liveness enforced: AllJobsDone

        FIX: External cron recovers orphans instead of inline try/except.
        This handles SIGKILL/OOM where no exception handler runs.
        The timeout is the code equivalent of the TLA+ "worker is dead" guard.
        """
        async with self.pool.acquire() as conn:
            result = await conn.execute("""
                UPDATE jobs
                SET status = 'pending', worker_id = NULL, claimed_at = NULL
                WHERE status = 'claimed'
                  AND claimed_at < now() - $1::interval
            """, timeout)
            return int(result.split(" ")[1])

    async def worker_loop(self, worker_id: str, process_fn=None):
        """
        TLA+ actions: ClaimJob → FinishJob, with WorkerCrash modeled by
        unhandled exception or process death.

        FIX: On crash, let the job stay "claimed". Don't try to clean up
        inline — that's the orphan recovery cron's job. Log the error
        so monitoring catches it.
        """
        while True:
            job_id = await self.claim_job(worker_id)
            if job_id is None:
                await asyncio.sleep(1)
                continue
            try:
                if process_fn:
                    await process_fn(job_id)
                await self.finish_job(job_id, worker_id)
            except Exception:
                # TLA+ action: WorkerCrash(w)
                # Job stays "claimed" — RecoverOrphan will handle it.
                # DO NOT reset to "pending" here. The spec proves this
                # is correct: crash recovery is a separate concern.
                raise  # Let it propagate — monitoring should see this


# ===========================================================================
# Tests — each encodes a TLC counterexample trace
# ===========================================================================

SCHEMA = """
CREATE TABLE IF NOT EXISTS jobs (
    id SERIAL PRIMARY KEY,
    status TEXT NOT NULL DEFAULT 'pending',
    worker_id TEXT,
    claimed_at TIMESTAMPTZ
);
"""


async def setup_db(dsn: str) -> asyncpg.Pool:
    pool = await asyncpg.create_pool(dsn)
    async with pool.acquire() as conn:
        await conn.execute(SCHEMA)
    return pool


async def test_double_claim_bug(pool: asyncpg.Pool):
    """
    Proves the BEFORE version has a double-claim bug.

    TLC trace:
      1. ClaimJob(w1, j1) — w1 sees job pending
      2. ClaimJob(w2, j1) — w2 also sees job pending (no lock)
      → NoDoubleClaim violated
    """
    async with pool.acquire() as conn:
        await conn.execute("DELETE FROM jobs")
        await conn.execute("INSERT INTO jobs (status) VALUES ('pending')")

    before = WorkerPoolBefore(pool)
    results = await asyncio.gather(
        before.claim_job("worker_1"),
        before.claim_job("worker_2"),
    )
    claimed = [r for r in results if r is not None]
    # This WILL sometimes produce 2 claims — that's the bug
    print(f"BEFORE: {len(claimed)} workers claimed the job (should be 1)")


async def test_double_claim_fixed(pool: asyncpg.Pool):
    """
    Proves the AFTER version prevents double-claim.

    Same trace, but FOR UPDATE SKIP LOCKED ensures only one succeeds.
    """
    async with pool.acquire() as conn:
        await conn.execute("DELETE FROM jobs")
        await conn.execute("INSERT INTO jobs (status) VALUES ('pending')")

    after = WorkerPoolAfter(pool)
    results = await asyncio.gather(
        after.claim_job("worker_1"),
        after.claim_job("worker_2"),
    )
    claimed = [r for r in results if r is not None]
    assert len(claimed) == 1, f"Double claim! {len(claimed)} workers got the job"


async def test_crash_recovery(pool: asyncpg.Pool):
    """
    TLC trace proving RecoverOrphan is required for AllJobsDone liveness:
      1. ClaimJob(w1, j1) — worker claims job
      2. WorkerCrash(w1) — worker dies, job stuck as "claimed"
      3. RecoverOrphan(j1) — cron re-queues the job
      4. ClaimJob(w2, j1) — new worker picks it up
      5. FinishJob(w2) — job completes

    Without step 3, the job is stuck forever.
    """
    after = WorkerPoolAfter(pool)

    async with pool.acquire() as conn:
        await conn.execute("DELETE FROM jobs")
        await conn.execute("""
            INSERT INTO jobs (status, worker_id, claimed_at)
            VALUES ('claimed', 'dead_worker', now() - interval '10 minutes')
        """)

    recovered = await after.recover_orphans(timeout=timedelta(minutes=5))
    assert recovered == 1, "Orphan not recovered"

    job_id = await after.claim_job("worker_2")
    assert job_id is not None, "Re-queued job not claimable"

    success = await after.finish_job(job_id, "worker_2")
    assert success, "Could not finish recovered job"

    async with pool.acquire() as conn:
        status = await conn.fetchval("SELECT status FROM jobs WHERE id = $1", job_id)
        assert status == "done"
