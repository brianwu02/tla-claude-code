/**
 * Optimistic UI with Conflict Resolution — Before/After
 *
 * BEFORE: Naive optimistic update with concurrency bugs.
 * AFTER:  Fixed version, each function annotated with the TLA+ action it implements.
 *
 * Bugs the TLA+ spec caught:
 *   1. Stale overwrite: concurrent edits silently lost (no version check)
 *   2. Zombie update: websocket clobbers optimistic local state mid-mutation
 *   3. Phantom rollback: rejected edit rolls back to stale snapshot, not current server state
 *
 * Maps to: references/frontend-optimistic-ui.md
 */

import { useState, useRef, useEffect, useCallback } from "react";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface ServerState<T> {
  value: T;
  version: number;
}

interface PendingEdit<T> {
  value: T;
  baseVersion: number;
}

interface OptimisticResult<T> {
  value: T;
  isPending: boolean;
  edit: (newValue: T) => Promise<void>;
  error: string | null;
}

// Mock API — replace with your actual API client
declare function apiPut<T>(
  key: string,
  payload: { value: T; baseVersion: number }
): Promise<ServerState<T>>;

declare function apiGet<T>(key: string): Promise<ServerState<T>>;

// ===========================================================================
// BEFORE — naive implementation
// ===========================================================================

/**
 * Looks correct with one user. Breaks with concurrent users or slow networks.
 */
function useOptimisticBefore<T>(key: string, initialValue: T): OptimisticResult<T> {
  const [local, setLocal] = useState<T>(initialValue);
  const [isPending, setIsPending] = useState(false);

  const edit = async (newValue: T) => {
    /**
     * BUG 1: No version check. If another user edited between our last
     * read and this write, their edit is silently overwritten.
     *
     * TLC trace (stale overwrite):
     *   1. UserEdit(alice): alice edits to 2 (local=2, pending)
     *   2. UserEdit(bob): bob edits to 3 (local=3, pending)
     *   3. ServerAccept(alice): server=2
     *   4. ServerAccept(bob): server=3, alice's edit silently lost
     */
    setLocal(newValue); // optimistic
    setIsPending(true);

    try {
      // No baseVersion — server accepts unconditionally
      await apiPut(key, { value: newValue, baseVersion: 0 });
    } catch {
      /**
       * BUG 3: Rolls back to initialValue, not current server state.
       * If another user's edit was accepted while we were pending,
       * we roll back to a stale snapshot.
       *
       * TLC trace (phantom rollback):
       *   1. UserEdit(alice): snapshot=1, local=2
       *   2. ServerAccept(bob): server=3
       *   3. ServerReject(alice): rolls back to 1, but server is 3
       */
      setLocal(initialValue); // BUG: stale snapshot, not current server state
    } finally {
      setIsPending(false);
    }
  };

  /**
   * BUG 2: Websocket updates always apply, even during pending edits.
   * This clobbers the optimistic local state mid-mutation.
   *
   * TLC trace (zombie update):
   *   1. UserEdit(alice): local=2 (optimistic)
   *   2. ReceiveWS(bob's earlier edit): local overwritten to bob's value
   *   3. User sees their edit disappear
   */
  useEffect(() => {
    const ws = new WebSocket(`/ws/${key}`);
    ws.onmessage = (event) => {
      const msg = JSON.parse(event.data);
      setLocal(msg.value); // BUG: always applies, even during pending edit
    };
    return () => ws.close();
  }, [key]);

  return { value: local, isPending, edit, error: null };
}


// ===========================================================================
// AFTER — fixed version, annotated with TLA+ actions
// ===========================================================================

/**
 * Each operation maps to a TLA+ action from references/frontend-optimistic-ui.md.
 * Bugs fixed by the spec's invariants (EventualConsistency) and liveness (EditsResolve).
 */
function useOptimisticAfter<T>(key: string, initialValue: T): OptimisticResult<T> {
  const [local, setLocal] = useState<T>(initialValue);
  const [version, setVersion] = useState(0);
  const [error, setError] = useState<string | null>(null);

  /**
   * FIX: useRef for pending state, not useState.
   * Refs update synchronously — prevents the double-click race where two
   * clicks both see isPending=false before setState flushes.
   *
   * TLA+ variable: pendingEdit[u]
   */
  const pendingRef = useRef<PendingEdit<T> | null>(null);
  const isPending = pendingRef.current !== null;

  /**
   * TLA+ action: UserEdit(u)
   * Guard: pendingEdit[u] = NULL (one edit in flight at a time)
   *
   * FIX 1: Includes baseVersion for server-side conflict detection.
   * FIX 3: On reject, rolls back to CURRENT server state, not stale snapshot.
   */
  const edit = useCallback(async (newValue: T) => {
    // Guard: only one edit in flight (synchronous check via ref)
    if (pendingRef.current) return;

    pendingRef.current = { value: newValue, baseVersion: version };
    setLocal(newValue); // optimistic update
    setError(null);

    try {
      /**
       * TLA+ action: ServerAccept(u)
       * Guard: pendingEdit[u].baseVersion = serverVersion
       */
      const result = await apiPut(key, {
        value: newValue,
        baseVersion: version,
      });
      setVersion(result.version);
      pendingRef.current = null;
    } catch (e: any) {
      if (e.status === 409) {
        /**
         * TLA+ action: ServerReject(u)
         * Guard: pendingEdit[u].baseVersion # serverVersion
         *
         * FIX: Fetch current server state for rollback, don't use
         * a stale snapshot. The spec proves this is necessary:
         * localState' = serverState (current), not snapshot.
         */
        const current = await apiGet<T>(key);
        setLocal(current.value);
        setVersion(current.version);
        setError("Someone else edited this. Your change was not saved.");
      }
      pendingRef.current = null;
    }
  }, [key, version]);

  /**
   * TLA+ action: ReceiveWS(u)
   * Guard in spec: pendingEdit[u] = NULL (defer if edit in flight)
   *
   * FIX 2: Only apply websocket updates when no edit is pending.
   * If we have a pending edit, our optimistic state takes priority.
   * On resolution (accept/reject above), we sync to the correct state.
   */
  useEffect(() => {
    const ws = new WebSocket(`/ws/${key}`);
    ws.onmessage = (event) => {
      const msg: ServerState<T> = JSON.parse(event.data);
      if (!pendingRef.current) {
        // Safe to apply — no edit in flight
        setLocal(msg.value);
        setVersion(msg.version);
      }
      // If pending: defer. The pending edit's resolution will sync state.
    };
    return () => ws.close();
  }, [key]);

  return { value: local, isPending, edit, error };
}


// ===========================================================================
// Tests — each encodes a TLC counterexample trace
// ===========================================================================

/**
 * Test: Stale overwrite (NoStaleOverwrite invariant)
 *
 * TLC trace:
 *   1. UserEdit(alice): edits to "alice's version" (baseVersion=0)
 *   2. UserEdit(bob): edits to "bob's version" (baseVersion=0)
 *   3. ServerAccept(alice): server="alice's version", version=1
 *   4. ServerAccept(bob): REJECTED (baseVersion=0 ≠ serverVersion=1)
 *
 * BEFORE: Both accepted → alice's edit silently lost.
 * AFTER: Bob gets 409, rolls back, sees alice's version.
 */

/**
 * Test: Zombie websocket update (EventualConsistency invariant)
 *
 * TLC trace:
 *   1. UserEdit(alice): local="new" (optimistic, pending)
 *   2. ReceiveWS(bob's edit): msg={value: "bob", version: 1}
 *   3. BEFORE: local overwritten to "bob" — alice's edit disappears
 *      AFTER: deferred — alice still sees "new" until her edit resolves
 */

/**
 * Test: Phantom rollback
 *
 * TLC trace:
 *   1. UserEdit(alice): snapshot=initialValue, local="new"
 *   2. ServerAccept(bob): server="bob's value", version=2
 *   3. ServerReject(alice): 409 conflict
 *   4. BEFORE: rolls back to initialValue (stale)
 *      AFTER: fetches current server state → shows "bob's value"
 */

export { useOptimisticBefore, useOptimisticAfter };
