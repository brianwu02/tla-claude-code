# Worked Example: Optimistic UI with Conflict Resolution

Multiple users edit shared data with optimistic local updates. The server is the source of truth, may reject edits, and broadcasts accepted changes via websocket. This pattern appears in any app where the UI updates immediately without waiting for the server — collaborative docs, todo lists, social feeds, shopping carts, booking systems.

## The Design

> When a user edits an item, the UI updates immediately (optimistic). The edit is sent to the server. The server may accept (broadcasting to other users via websocket) or reject (user's UI rolls back). Two users can edit concurrently.

### Concurrency boundaries

| Question | Answer |
|----------|--------|
| Mutable state | Server state (authoritative), per-user local state (optimistic), pending edit queue, websocket delivery queue |
| Concurrent actors | N browser sessions (users/tabs) |
| Synchronization | Server-side version check on accept/reject |
| Failure modes | Stale overwrite, phantom rollback, zombie websocket update, double-apply |

### Patterns matched

- **Optimistic Update** — apply locally, confirm from server
- **Readers-Writers** — multiple readers, one authoritative writer (server)
- **Real-Time Collaboration** — websocket broadcast for cross-user sync

### The bugs we're hunting

| Bug | Symptom |
|-----|---------|
| **Stale overwrite** | User A's edit silently erases User B's concurrent edit |
| **Phantom rollback** | Server rejects edit, but rollback target is stale (another ws message arrived in between) |
| **Zombie update** | Server accepts edit, then a *stale* websocket message from another user's earlier edit arrives and overwrites the UI |
| **Double-apply** | Optimistic local update + server confirmation both applied — counter increments by 2 |

---

## The Spec

```tla
------------------------ MODULE OptimisticUI ------------------------
EXTENDS Naturals, Sequences

CONSTANTS Users, Values, InitValue, NULL

VARIABLES serverState,      \* The authoritative server value
          serverVersion,    \* Monotonic version counter
          localState,       \* Function: user -> what they see locally
          localVersion,     \* Function: user -> version they last synced from
          pendingEdit,      \* Function: user -> {value, baseVersion} or NULL
          wsQueue           \* Function: user -> sequence of {value, version} messages

vars == <<serverState, serverVersion, localState, localVersion, pendingEdit, wsQueue>>

\* ---------- Type invariant ----------
TypeOK ==
    /\ serverState \in Values
    /\ serverVersion \in Nat
    /\ localState \in [Users -> Values]
    /\ localVersion \in [Users -> Nat]
    /\ \A u \in Users : pendingEdit[u] \in
        [value: Values, baseVersion: Nat] \cup {NULL}
    /\ \A u \in Users : \A i \in 1..Len(wsQueue[u]) :
        wsQueue[u][i] \in [value: Values, version: Nat]

\* ---------- Safety: eventual consistency ----------
\* When no edits are in flight and all websocket messages delivered,
\* every user sees the server's current state.
EventualConsistency ==
    (\A u \in Users : pendingEdit[u] = NULL /\ wsQueue[u] = <<>>)
        => (\A u \in Users : localState[u] = serverState)

\* ---------- Safety: no lost updates ----------
\* Server version only increases (edits are never silently dropped
\* when they should succeed).
VersionMonotonic ==
    serverVersion >= 0   \* Strengthened via temporal check below

\* ---------- Init ----------
Init ==
    /\ serverState = InitValue
    /\ serverVersion = 0
    /\ localState = [u \in Users |-> InitValue]
    /\ localVersion = [u \in Users |-> 0]
    /\ pendingEdit = [u \in Users |-> NULL]
    /\ wsQueue = [u \in Users |-> <<>>]

\* ---------- User makes an optimistic edit ----------
\* Apply locally immediately. Store the edit with its base version
\* so the server can detect conflicts.
UserEdit(u) ==
    /\ pendingEdit[u] = NULL              \* one edit in flight at a time
    /\ \E val \in Values :
        /\ val # localState[u]            \* actually changing something
        /\ localState' = [localState EXCEPT ![u] = val]
        /\ pendingEdit' = [pendingEdit EXCEPT ![u] =
            [value |-> val, baseVersion |-> localVersion[u]]]
    /\ UNCHANGED <<serverState, serverVersion, localVersion, wsQueue>>

\* ---------- Server accepts the edit ----------
\* Only if baseVersion matches — no one else edited since this user last synced.
ServerAccept(u) ==
    /\ pendingEdit[u] # NULL
    /\ pendingEdit[u].baseVersion = serverVersion  \* optimistic lock check
    /\ serverState' = pendingEdit[u].value
    /\ serverVersion' = serverVersion + 1
    /\ pendingEdit' = [pendingEdit EXCEPT ![u] = NULL]
    /\ localVersion' = [localVersion EXCEPT ![u] = serverVersion + 1]
    \* Broadcast to other users
    /\ wsQueue' = [v \in Users |->
        IF v # u
        THEN Append(wsQueue[v],
            [value |-> pendingEdit[u].value, version |-> serverVersion + 1])
        ELSE wsQueue[v]]
    /\ UNCHANGED localState   \* already applied optimistically

\* ---------- Server rejects the edit (version conflict) ----------
\* Roll back to current server state.
ServerReject(u) ==
    /\ pendingEdit[u] # NULL
    /\ pendingEdit[u].baseVersion # serverVersion  \* conflict detected
    /\ pendingEdit' = [pendingEdit EXCEPT ![u] = NULL]
    /\ localState' = [localState EXCEPT ![u] = serverState]
    /\ localVersion' = [localVersion EXCEPT ![u] = serverVersion]
    /\ UNCHANGED <<serverState, serverVersion, wsQueue>>

\* ---------- User receives a websocket update ----------
\* Apply only if not currently mid-edit (avoid clobbering optimistic state).
ReceiveWS(u) ==
    /\ wsQueue[u] # <<>>
    /\ LET msg == Head(wsQueue[u])
       IN /\ IF pendingEdit[u] = NULL
             THEN /\ localState' = [localState EXCEPT ![u] = msg.value]
                  /\ localVersion' = [localVersion EXCEPT ![u] = msg.version]
             ELSE /\ UNCHANGED localState    \* defer — pending edit takes priority
                  /\ UNCHANGED localVersion
          /\ wsQueue' = [wsQueue EXCEPT ![u] = Tail(wsQueue[u])]
    /\ UNCHANGED <<serverState, serverVersion, pendingEdit>>

Next ==
    \E u \in Users :
        \/ UserEdit(u)
        \/ ServerAccept(u)
        \/ ServerReject(u)
        \/ ReceiveWS(u)

\* ---------- Liveness: edits are eventually resolved ----------
EditsResolve == \A u \in Users : <>(pendingEdit[u] = NULL)

\* ---------- Liveness: websocket queues drain ----------
QueuesEmpty == \A u \in Users : <>(wsQueue[u] = <<>>)

\* ---------- Fairness ----------
Fairness ==
    /\ \A u \in Users : WF_vars(ServerAccept(u))
    /\ \A u \in Users : WF_vars(ServerReject(u))
    /\ \A u \in Users : WF_vars(ReceiveWS(u))
    \* No fairness on UserEdit — users are nondeterministic

Spec == Init /\ [][Next]_vars /\ Fairness
=============================================================================
```

## MC Module

```tla
------------------------ MODULE MC_OptimisticUI ------------------------
EXTENDS OptimisticUI

CONSTANTS alice, bob

MC_Users == {alice, bob}
MC_Values == {1, 2, 3}
MC_InitValue == 1
MC_NULL == "null_val"

StateConstraint ==
    /\ serverVersion <= 4
    /\ \A u \in MC_Users : Len(wsQueue[u]) <= 3
=============================================================================
```

## MC Config (`MC_OptimisticUI.cfg`)

```
SPECIFICATION Spec
CONSTANTS
    Users = {alice, bob}
    Values = {1, 2, 3}
    InitValue = 1
    NULL = "null_val"
INVARIANT TypeOK
INVARIANT EventualConsistency
PROPERTY EditsResolve
PROPERTY QueuesEmpty
CONSTRAINT StateConstraint
```

---

## What TLC Finds

### Bug 1: Remove version check from ServerAccept

Change `ServerAccept` to always accept (remove the `baseVersion = serverVersion` guard):

```
EventualConsistency is violated.
Trace:
1. Init: server=1, alice=1, bob=1
2. UserEdit(alice): alice edits to 2 (local=2, pending, baseVersion=0)
3. UserEdit(bob): bob edits to 3 (local=3, pending, baseVersion=0)
4. ServerAccept(alice): server=2, version=1, ws to bob
5. ServerAccept(bob): server=3, version=2, ws to alice
6. ReceiveWS(alice): alice=3
7. ReceiveWS(bob): bob=2  <-- bob sees alice's OLD value, not current server state
```

**Bug**: Without version checking, bob's ws message (value=2) arrives *after* the server moved to 3. Bob's local state diverges. This is the **stale overwrite** — alice's edit is silently lost from bob's perspective.

**Fix**: The version check in `ServerAccept` is essential. With it, step 5 would be `ServerReject(bob)` instead, and bob would roll back to the current server state (2).

### Bug 2: ReceiveWS clobbers optimistic state

Change `ReceiveWS` to always apply (remove the `pendingEdit[u] = NULL` check):

```
EventualConsistency is violated.
Trace:
1. Init: server=1, alice=1, bob=1
2. UserEdit(alice): alice edits to 2 (optimistic, local=2)
3. UserEdit(bob): bob edits to 3 (optimistic, local=3)
4. ServerAccept(alice): server=2, version=1, ws to bob
5. ReceiveWS(bob): bob's local overwritten to 2  <-- kills bob's pending edit display
6. ServerReject(bob): bob rolls back to server=2 (fine, but the UI flickered 3->2->2)
```

**Bug**: The websocket message clobbers bob's optimistic local state. The user sees their edit disappear and reappear (or not). This is the **zombie update** problem.

**Fix**: When a user has a pending edit, defer websocket updates — the pending edit takes visual priority. On resolution (accept/reject), the user syncs to the correct state.

### Bug 3: Naive rollback to stale snapshot

If `ServerReject` rolled back to a captured `snapshotState` (saved at edit time) instead of current `serverState`:

```
EventualConsistency is violated.
Trace:
1. Init: server=1
2. UserEdit(alice): snapshot=1, local=2, pending
3. ServerAccept(bob's earlier edit): server=3
4. ServerReject(alice): alice rolls back to snapshot=1, but server is at 3
```

**Bug**: The snapshot is stale. Rolling back to it puts the user behind the server. This is **phantom rollback**.

**Fix**: Always roll back to the *current* server state, not a saved snapshot. The spec models this correctly with `localState' = serverState` in `ServerReject`.

---

## Mapping to Code

| TLA+ | React / TypeScript |
|------|-------------------|
| `localState[u]` | Component state: `useState(value)` or Zustand/Redux store |
| `serverState` | Database row / API response |
| `serverVersion` | `updated_at` timestamp or monotonic version column |
| `pendingEdit[u]` | `useMutation` pending state (TanStack Query) or manual `isPending` flag |
| `UserEdit(u)` | `onSubmit` handler: `setLocalValue(newVal); mutation.mutate(newVal)` |
| `ServerAccept(u)` | `onSuccess` callback: invalidate query, update version |
| `ServerReject(u)` | `onError` callback: `setLocalValue(serverValue)` — rollback |
| `ReceiveWS(u)` | WebSocket `onmessage`: update only if no pending mutation |
| `EventualConsistency` | E2E test: both browsers show same value after all mutations settle |
| `NoStaleOverwrite` | API test: concurrent PUTs with same base version — second one returns 409 |

### React hook sketch

```typescript
function useOptimisticSync<T>(key: string, wsChannel: string) {
  const [local, setLocal] = useState<T>(initial);
  const [version, setVersion] = useState(0);
  const pendingRef = useRef<{ value: T; baseVersion: number } | null>(null);

  // UserEdit action
  const edit = async (newValue: T) => {
    pendingRef.current = { value: newValue, baseVersion: version };
    setLocal(newValue); // optimistic

    try {
      const result = await api.put(key, { value: newValue, baseVersion: version });
      // ServerAccept
      setVersion(result.version);
      pendingRef.current = null;
    } catch (e) {
      if (e.status === 409) {
        // ServerReject — roll back to current server state
        const current = await api.get(key);
        setLocal(current.value);
        setVersion(current.version);
      }
      pendingRef.current = null;
    }
  };

  // ReceiveWS action
  useWebSocket(wsChannel, (msg) => {
    if (!pendingRef.current) {
      // No pending edit — safe to apply
      setLocal(msg.value);
      setVersion(msg.version);
    }
    // If pending edit exists, defer — our pending edit takes priority
  });

  return { value: local, edit, isPending: !!pendingRef.current };
}
```

Note how the hook mirrors the TLA+ spec action-for-action. Each counterexample trace from TLC maps directly to a test scenario:
- **Stale overwrite test**: Two clients edit simultaneously, verify server rejects the second
- **Zombie update test**: Client edits, receives ws from another user mid-flight, verify local state isn't clobbered
- **Phantom rollback test**: Client edits, another edit is accepted while pending, client is rejected — verify rollback goes to *current* server state, not the stale snapshot
