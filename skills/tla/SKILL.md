---
name: general-tla
description: TLA+ formal verification — verify concurrency, race conditions, crash recovery, optimistic UI, and UX flows. Works from design docs or existing code.
disable-model-invocation: true
user-invokable: true
argument-hint: "<design-doc|concern|spec-name|code-path>"
---

# TLA+ Verification

Formalize concurrency guarantees into a TLA+ spec, verify with the TLC model checker, then either implement new code or validate existing code.

## Two Paths, One Destination

**Path A (design-first)**: Design doc → Extract → Spec → Align → Model-Check → Implement. A counterexample means the **design** has a flaw.

**Path B (code-first)**: Existing code → Reverse-Extract → Spec → Align → Model-Check → Validate/Fix. A counterexample means the **code** has a bug.

Both paths converge at the Modeling Brief and share Phases 2–4. One upfront prompt, then no interruptions until after verification. See README.md for the full workflow diagram.

## Getting Started

On invocation, use a **single `AskUserQuestion`** with two questions. This is the only prompt before work begins.

Auto-detect hardware (never prompt — detect via `sysctl` or `/proc/cpuinfo` and save to memory on first run):

```bash
# macOS
cores=$(sysctl -n hw.ncpu); ram_bytes=$(sysctl -n hw.memsize); cpu=$(sysctl -n machdep.cpu.brand_string)
# Linux
cores=$(nproc); ram_bytes=$(grep MemTotal /proc/meminfo | awk '{print $2 * 1024}'); cpu=$(grep "model name" /proc/cpuinfo | head -1 | cut -d: -f2)
```

**Question 1**: "What are we working with?"

| Option | Description |
|--------|-------------|
| **I have a design doc** | Path A — provide the path or paste the relevant section |
| **I have existing code** | Path B — provide the file path(s) with the concurrency logic |
| **I have a UX flow to analyze** | Path A variant — describe the screens/steps in the flow |
| **I have a concern but no doc or code yet** | Path A — describe what you're building and what could go wrong |

If the user selects "UX flow" and the description is ambiguous (could be screen flow OR component state), ask one clarifying question: **"Is this about the order of screens in a flow, or about how components react to each other's state?"** This determines which sub-pattern applies (see UX sub-patterns below).

**Question 2**: "How thorough should the analysis be?"

| Preset | What happens | Prompts remaining |
|--------|-------------|-------------------|
| **Quick** | 1 refinement cycle. Safety check only. No adversarial review. Results delivered as a report — no implementation. | 0 (report delivered, done) |
| **Standard** (Recommended) | Up to 3 cycles. Safety first, then asks whether to run liveness. No adversarial review. Asks docs-or-implement at the end. | 1–2 (liveness decision + docs/implement) |
| **Thorough** | Up to 5 cycles. Safety + liveness (no Stage 2 prompt — runs automatically). Adversarial review. Asks docs-or-implement at the end. | 1 (docs/implement only) |

After the user answers, proceed directly to Phase 1. No more prompts until after Phase 4.

**Behavior by preset:**
- **Quick**: skip refinement loop budget prompt, skip verification profile prompt (use Fast), skip check selection (safety only), skip Stage 2, skip adversarial review, skip Phase 5 transition (deliver report and stop).
- **Standard**: use Optimal hardware profile, run safety, prompt for liveness (Stage 2) only if the spec has liveness properties, skip adversarial review, prompt for docs-or-implement at end.
- **Thorough**: use Max hardware profile, run safety then liveness automatically, run adversarial review, prompt for docs-or-implement at end.

### UX sub-patterns

UX work splits into two sub-patterns with very different workflows:

| Sub-pattern | Trigger phrases | Has concurrency? | Workflow |
|-------------|----------------|-------------------|----------|
| **Screen Flow** | "simplify checkout", "too many steps", "reduce screens", "onboarding funnel" | No — deterministic navigation | Fast-path (see below) |
| **Component State** | "button updates after X", "form validates when Y", "modal blocks until Z", "enable after async" | Yes — async callbacks, render timing, interleaving | Normal concurrency workflow |

**Screen Flow fast-path:**
- Default to **Quick** preset (override even if user picked Standard/Thorough — screen flows don't benefit from multiple cycles or liveness)
- Add `CHECK_DEADLOCK FALSE` to the MC config automatically — terminal states (done, abandoned) have no enabled actions, which TLC reports as deadlock by default
- Skip check selection — run safety + `NotDone` invariant trick directly
- Skip liveness — screen flows have no fairness, no temporal properties
- Skip adversarial review — no failure modes, no crash recovery, no network partitions to look for
- Deliver report and stop — screen flow analysis is always "just the report"

**Component State** routes to the normal workflow. These have real concurrency: async callbacks interleaving with user actions, React render batching, state dependencies between components. They need safety invariants at minimum, possibly liveness ("button eventually enables after calendar select").

## When to Use

**Path A (design-first):**
- Planning a feature with concurrency concerns (worker pools, queues, caches, optimistic UI)
- Design doc mentions race conditions, ordering dependencies, or "only one X can Y"
- UX flow optimization — model a multi-step funnel before building it

**Path B (code-first):**
- Existing feature has intermittent bugs that smell like race conditions
- Refactoring concurrent code and want confidence you're not breaking invariants
- Code review raised "is this safe?" questions nobody can answer definitively
- Post-incident: production bug was a concurrency issue, need to verify the fix covers all cases
- Reviewing whether existing specs still match refactored code

**Argument** `$ARGUMENTS` can be:
- A design doc path: `path/to/DESIGN.md` (Path A)
- A code path: `src/workers/pool.py` (Path B)
- A concern: `worker-pool`, `cache-invalidation`, `optimistic-updates`
- A spec name to review: `WorkerPool`, `OptimisticUI`
- A question: `"can two users overwrite each other's edits?"`

---

## Setup

### Installing TLA+ Tools

```bash
# Option 1: TLA+ tools JAR (minimal)
# Download tla2tools.jar from https://github.com/tlaplus/tlaplus/releases
mkdir -p ~/tla && curl -L -o ~/tla/tla2tools.jar \
  https://github.com/tlaplus/tlaplus/releases/latest/download/tla2tools.jar

# Option 2: VS Code extension (recommended for editing)
# Install "TLA+" extension by Jack Vanlightly — syntax highlighting + TLC integration

# Option 3: TLA+ Toolbox (full IDE)
# Download from https://github.com/tlaplus/tlaplus/releases
```

### Running TLC

```bash
# Basic invocation
java -XX:+UseParallelGC -jar ~/tla/tla2tools.jar \
    -config MC_YourSpec.cfg -workers auto -nowarning MC_YourSpec.tla

# With a verify.sh wrapper (recommended per project)
#!/bin/bash
SPEC=${1:-"all"}
TLA_JAR="path/to/tla2tools.jar"
JAVA_OPTS="-XX:+UseParallelGC"
java $JAVA_OPTS -jar "$TLA_JAR" -config "MC_${SPEC}.cfg" -workers auto -nowarning "MC_${SPEC}.tla"
```

### System Requirements

TLC is CPU- and memory-intensive. Any modern laptop handles small models (2 actors, 3 resources) in seconds — this catches most design flaws. For hardware profiles, scaling guidelines, JVM tuning, and CI pipeline advice, see `${CLAUDE_SKILL_DIR}/references/system-requirements.md`.

---

## Phase 1A: Extract from Design Doc

*Use this when you have a design doc or feature spec but no code yet.*

Parse the design doc and identify concurrency-relevant content.

### 1A.1 Identify concurrency boundaries

| Question | Look for in design docs |
|----------|------------------------|
| Mutable state | DB rows, cache keys, in-memory variables, queues, UI state, localStorage |
| Concurrent actors | Worker threads, server processes, browser tabs, websocket connections, cron jobs, user sessions |
| Synchronization | DB locks, atomic operations, optimistic locking, version vectors, mutexes, channels |
| Failure modes | Crash recovery, network partition, rejected writes, stale reads, timeout, tab close |

### 1A.2 Match against pattern catalog

Scan the pattern catalog (below) and identify which patterns apply. Most real systems combine 1-3 patterns.

### 1A.3 Inventory existing specs

Search your project for existing TLA+ specs:

```bash
find . -name "*.tla" -not -path "*/node_modules/*" | head -20
```

Build an inventory table:

| Spec | Location | Vars | Actions | Models |
|------|----------|------|---------|--------|
| _SpecName_ | `path/to/Spec.tla` | _N_ | _N_ | _What it models_ |

If an existing spec covers the concern, extend it rather than creating a new one.

### 1A.4 Produce a modeling brief

Write 2-3 paragraphs naming:
- **State variables** — map real state to abstract state
- **Actions** — map real operations to atomic TLA+ actions
- **Safety invariants** — what bad thing must never happen
- **Liveness properties** — what good thing must eventually happen
- **Abstraction choices** — what's omitted and why

*→ Proceed to Phase 2: Spec*

---

## Phase 1B: Reverse-Extract from Existing Code

*Use this when you have a working implementation and want to formally verify it.*

The goal is the same as 1A — produce a modeling brief — but the source material is code instead of a design doc. This is harder because code conflates **what** it does with **how** it does it. Your job is to extract the **what** and ignore the **how**.

### Parallel code scanning (subagents)

For non-trivial codebases, spawn three agents in parallel to scan different aspects of the code simultaneously. Each agent returns structured findings that merge into the modeling brief.

**All agents — detect language first**: Before grepping, detect the project's languages from file extensions. Only grep for patterns matching detected languages. SQL patterns always apply.

```bash
find . -type f \( -name "*.py" -o -name "*.ts" -o -name "*.tsx" -o -name "*.go" -o -name "*.rs" -o -name "*.java" -o -name "*.cs" -o -name "*.rb" \) -not -path "*/node_modules/*" | sed 's/.*\.//' | sort -u
```

**Grep patterns by language:**

| Language | Agent 1: Shared state | Agent 2: Concurrency primitives | Agent 3: Error/crash paths |
|----------|----------------------|-------------------------------|---------------------------|
| Python | `global`, `threading.Lock`, `asyncio.Lock` | `asyncio.gather`, `queue`, `Pool` | `try/except`, `atexit`, `finally` |
| TS/JS | `useState`, `useRef`, `SharedWorker` | `Promise.all`, `BroadcastChannel` | `try/catch`, `finally` |
| Go | `sync.Map`, `chan` | `sync.Mutex`, `sync.WaitGroup`, `go func` | `recover()`, `defer` |
| Java | `ConcurrentHashMap`, `AtomicReference` | `synchronized`, `ReentrantLock`, `ExecutorService` | `try/catch`, `finally`, `@PreDestroy` |
| Rust | `Arc<Mutex>`, `static mut` | `tokio::join`, `mpsc::channel`, `RwLock` | `Result<`, `Drop`, `?` near mutations |
| C# | `ConcurrentDictionary`, `Interlocked` | `Task.WhenAll`, `lock`, `SemaphoreSlim` | `try/catch`, `finally`, `Dispose` |
| SQL (always) | `UPDATE`, `INSERT`, `SELECT FOR UPDATE` | `BEGIN`, `COMMIT`, `ROLLBACK` | `SAVEPOINT` |

Each agent returns a list of: `{file, line, pattern_type, description}`. Merge the results and use them as input to 1B.1–1B.4 below.

For small codebases (< 10 files involved), skip the agents and scan inline.

### 1B.1 Read the code and identify state

Catalog every piece of mutable state involved in the concurrent behavior (DB rows, cache keys, in-memory variables, queues, React state/refs). For each, note **who writes it** and **who reads it**.

### 1B.2 Identify actions from code paths

Each code path that atomically modifies state becomes a TLA+ action: functions with DB writes, transaction boundaries, event handlers (`onMessage`, `onSuccess`, `useEffect`), cron ticks, error/crash paths. **Watch for hidden non-atomicity**: two DB writes without a transaction are two separate actions, even if they look like one function.

### 1B.3 Infer invariants from the code's assumptions

Look for implicit assumptions: `if status == "claimed": process(job)` implies jobs are only processed in claimed state. `unique_together` implies at most one holder. `if (version !== expected) throw` implies conditional writes. Also look for invariants the code **should** enforce but doesn't.

### 1B.4 Check for known bug patterns

Scan for: check-then-act without lock, shared state without synchronization, `try/catch` that swallows errors and leaves state dirty, optimistic updates without rollback, fire-and-forget async. Each maps to a spec property to verify.

### 1B.5 Produce a modeling brief

Same output as 1A.4 — the brief should be indistinguishable regardless of whether it came from a design doc or from code:

- **State variables** — map real state to abstract state
- **Actions** — map real operations to atomic TLA+ actions
- **Safety invariants** — what bad thing must never happen (derived from 1B.3)
- **Liveness properties** — what good thing must eventually happen
- **Abstraction choices** — what's omitted and why
- **Suspected bugs** — from 1B.4, list anything that looks fragile (the spec will confirm or deny)

*→ Proceed to Phase 2: Spec*

---

## Phase 2: Spec

### Load references via subagent

Before writing the spec, spawn a background agent to read the relevant reference material and return a summary. This keeps the reference content out of the main context window.

**Agent prompt**: "Read `${CLAUDE_SKILL_DIR}/references/pattern-catalog.md` and `${CLAUDE_SKILL_DIR}/references/<matched-example>.md`. Also read `${CLAUDE_SKILL_DIR}/references/community-specs/<MatchedSpec>/<MatchedSpec>.tla` if a community spec matches. Return: (1) the translation table entries that apply, (2) the abstraction guide entries that apply, (3) the key structural patterns from the worked example or community spec (Init, actions, invariants, fairness choices)."

Pick the worked example based on the matched pattern:
- Worker pool / job queue / crash recovery → `backend-worker-pool.md`
- Optimistic UI / websocket / version conflicts → `frontend-optimistic-ui.md`
- Checkout / onboarding / multi-step flow → `ux-state-reduction.md`

Use the agent's summary as a template while writing the spec. The main context never loads the full reference files.

### Writing the spec

Translate the modeling brief into TLA+. Properties first (TDD for specs).

### Action template

```tla
ActionName(param) ==
    /\ guard_predicate                    \* source state
    /\ stateVar' = new_value              \* target state
    /\ UNCHANGED <<all, other, vars>>     \* everything else
```

### UNCHANGED discipline

After writing any action, count: `primed_count + unchanged_count = total_variable_count`. This is the #1 source of TLC errors — a missing variable in UNCHANGED silently allows arbitrary state changes. Use tuple aliases (e.g., `uiVars`, `serverVars`) for brevity.

### Property-before-action (TDD for specs)

This is the most important technique in the workflow. Write the property that should hold *before* writing the action that makes it hold:

1. Write the temporal formula (Safety or Liveness section)
2. Add to MC cfg under INVARIANT or PROPERTY
3. Run TLC — should **FAIL** (property not yet satisfied by existing actions)
4. Add the action that makes it true
5. Re-verify — should **PASS**

If a new property passes immediately, it's either too weak or already implied. Investigate before moving on.

### MC module + cfg

The MC (model-checking) module is a thin wrapper that `EXTENDS` the main spec, declares small constants, and defines state constraints to keep the state space manageable.

| Component | Small model | Medium model |
|-----------|------------|--------------|
| Workers/Actors/Users | 1-2 | 3 |
| Resources/Items | 2-3 | 4-5 |
| Time bound | 10-15 ticks | 20-25 ticks |
| Target runtime | <60s | <5min |

Start with the smallest model. Only increase if you suspect the small model hides bugs. TLA+ is about finding design flaws, not proving correctness at production scale — 2 users finding a bug means 200 users will too.

**Screen Flow specs**: Always add `CHECK_DEADLOCK FALSE` to the MC config. Terminal states (done, abandoned) have no enabled actions — TLC reports these as deadlock by default, which is a false positive. The deadlock is intentional: the user finished.

### File placement

Write all spec files (`.tla`, `.cfg`) to a temp directory during the workflow:

```bash
mkdir -p /tmp/tla-$(date +%s)
```

At the end (Phase 5 transition), ask the user where to save them permanently. Suggest options based on what exists in their project:

- **Colocated**: `feature/specs/` — next to the code they verify
- **Centralized**: `specs/` or `tla/` at project root
- **Keep in temp** — user will move them manually

Do not write to the project directory until the user confirms a location.

### What NOT to model

- HTTP timeouts, retry counts, JSON parsing — implementation details
- Real-time durations — use discrete ticks instead
- External systems as stateful entities — DB writes and API calls are atomic side-effects
- Concurrency within one action — each action is atomic by definition
- UI rendering, CSS, layout — only model the state transitions

### Common TLC errors and fixes

| Error | Cause | Fix |
|-------|-------|-----|
| `TLC threw an unexpected exception` | Syntax error in TLA+ | Check operator precedence; `/\` binds tighter than you think |
| `Attempted to enumerate SUBSET` | Unbounded set in `\E x \in SUBSET S` | Constrain the set or use a different formulation |
| `Variable X has no value in state` | Missing from Init | Add initialization for every declared variable |
| `Deadlock reached` | No action enabled in some state | Either add a `Stutter` action or verify the deadlock is expected |
| `State space too large` | Too many actors or resources | Reduce MC constants; add a `StateConstraint` |
| Runs forever | State explosion from counters or sequences | Bound all numeric values and sequence lengths in MC |

---

## The Refinement Loop (Phases 2 → 3 → 4)

Phases 2, 3, and 4 form a bounded feedback loop. The iteration budget was set by the thoroughness preset chosen in Getting Started:

| Preset | Cycles | Behavior |
|--------|--------|----------|
| **Quick** | 1 pass | Spec → Align → Model-Check → done. No going back. Report all findings as a single deliverable. |
| **Standard** | Up to 3 cycles | Back-to-Spec allowed twice. After cycle 3, remaining issues reported as known limitations. |
| **Thorough** | Up to 5 cycles | After cycle 5, hard stop. If spec is still unstable, recommend splitting into smaller specs. |

### Phase gates

Each phase has an exit checklist. The spec cannot advance until the gate passes. This prevents sloppy loops.

**Phase 2 (Spec) exit gate:**
- [ ] Every declared variable has an `Init` assignment
- [ ] Every action accounts for all variables (`primed + UNCHANGED = total`)
- [ ] At least one safety invariant defined
- [ ] At least one liveness property defined (if applicable)
- [ ] MC module has bounded constants and a `StateConstraint`

**Phase 3 (Align) exit gate:**
- [ ] Alignment table complete — every source claim/code path has a row
- [ ] Zero GAP entries (or GAPs explicitly marked "out of scope" with reason)
- [ ] No unresolved FLAG entries

**Phase 4 (Model-Check) exit gate:**
- [ ] TLC completes without error (not "state space too large")
- [ ] Every counterexample triaged: **spec bug** (back to Phase 2) or **real finding** (report it)
- [ ] Sanity check performed: removed one guard, confirmed TLC catches the violation

### Loop behavior

Each cycle: Spec → Align → Model-Check. If Align finds GAPs or Model-Check finds a spec bug, go back to Spec (costs 1 cycle). Real findings are reported and the loop continues. When the budget is exhausted, deliver a report with: verified properties, known findings, known limitations, and recommendation to split spec or increase budget if issues remain.

**Key rule**: Going back to Phase 2 costs one cycle from the budget. This prevents infinite refinement — each spec revision must be deliberate, not a "let me just tweak this."

### Triage checklist (Phase 4 counterexamples)

Before spending a cycle to go back to Phase 2, verify the counterexample is actually a spec bug:

1. **Is the spec faithful?** Does the failing action accurately model the real system? A missing guard creates a false counterexample.
2. **Are the invariants correct?** An overly strict invariant flags acceptable behavior as a violation.
3. **Are the abstractions sound?** A spec that omits retry logic can't verify retry guarantees.

If all three are "yes," the counterexample is a real finding — report it, don't spend a cycle revising.

---

## Phase 3: Align

Verify the spec faithfully captures the source material. This phase typically takes 2-3 iterations.

The alignment process is the same for both paths — the only difference is what you're aligning against.

| | Path A (design-first) | Path B (code-first) |
|---|---|---|
| Align against | Design doc claims | Code behavior + implicit assumptions |
| "Gap" means | Spec is missing a design guarantee | Spec doesn't cover a code path |
| "Over-model" means | Design is under-specified | Spec models behavior the code doesn't have (flag as potential missing feature or dead code) |

### 3.1 Traceability check

**Path A**: For each design guarantee/claim, identify the corresponding TLA+ property. If a claim has no spec counterpart, the spec is incomplete.

**Path B**: For each code function that modifies shared state, identify the corresponding TLA+ action. For each assertion/constraint in the code, identify the corresponding invariant. If a code path has no spec counterpart, the spec is incomplete.

### 3.2 Scope check

**Path A**: For each TLA+ action, identify the design doc section it models. Extra actions mean the spec is over-modeling.

**Path B**: For each TLA+ action, identify the code function it models. Extra actions might reveal defensive behavior the code is missing (good — the spec found a gap) or over-modeling (trim it).

### 3.3 Abstraction check

Are the abstraction choices compatible with the failure modes?

**Path A**: If the design says "retry with backoff" but the spec omits retry counting, the spec may miss a starvation bug the design intended to prevent.

**Path B**: If the code has error handling for a failure mode but the spec doesn't model that failure, the spec can't verify the error handling is correct. Add the failure mode to the spec.

### 3.4 Output: alignment table

Build a table mapping each source claim (design doc) or code behavior (code path) to a spec property/action. Mark each as **OK**, **GAP** (missing from spec), **SUSPECT** (possible bug), or **FLAG** (needs human decision). Iterate until no GAPs remain.

---

## Phase 4: Model-Check

The verification profile and check type are determined by the thoroughness preset from Getting Started:

| Preset | Hardware profile | Model size | Checks |
|--------|-----------------|-----------|--------|
| **Quick** | Fast (4 workers, 4GB) | 2 actors, 2-3 resources | Safety only |
| **Standard** | Optimal (auto workers, 16GB) | 3 actors, 4-5 resources | Safety, then decide on liveness |
| **Thorough** | Max (auto workers, 50%+ RAM) | 4+ actors, 6+ resources | Safety + liveness (automatic) |

### What TLC checks: safety vs liveness

TLC runs two fundamentally different kinds of checks. They have different costs, different configs, and should be run separately.

**Safety** — "bad things never happen." Checked at every reachable state. If any state violates an invariant, TLC stops with the trace that got there. Fast — TLC evaluates invariants as it explores each state.

**Liveness** — "good things eventually happen." Checked over infinite behaviors (paths through the full state graph). TLC must build the complete state graph, then find strongly connected components (cycles) and verify no cycle violates the property. Expensive — same state space takes much longer.

| | Safety | Liveness |
|---|---|---|
| Properties | Invariants (`INVARIANT`) | Temporal (`PROPERTY`: `<>`, `~>`, `[]<>`) |
| How checked | Per-state | Over full state graph (SCC analysis) |
| Speed | Fast (evaluates inline) | Slow (needs complete graph + cycle detection) |
| Fairness needed? | No | Yes — without `WF`/`SF`, liveness is trivially violated (system can stutter forever) |
| Spec to use | `Spec` (no fairness) | `FairSpec` (with fairness assumptions) |
| Constraint type | `CONSTRAINT` (prunes states — fast, safe for invariants) | `ACTION_CONSTRAINT` (disables actions at bound — slower, safe for temporal properties) |

**Why split configs**: `CONSTRAINT` truncates traces, which can hide liveness counterexamples. `ACTION_CONSTRAINT` lets the system quiesce naturally at the bound without truncation. Always use separate MC configs for safety and liveness runs.

**In plain language**: Safety run answers "can anything go wrong?" Liveness run answers "does the system eventually make progress?" Run safety first (seconds to minutes). Only run liveness after safety passes (minutes to hours).

### Check execution by preset

**Quick**: Run safety only. Display the pre-flight estimate, run TLC, report results. No prompts.

**Standard**: Run safety first. After it passes, compute the liveness estimate from the exact state count (see pre-flight estimate below). Then use `AskUserQuestion` — this is the **only mid-workflow prompt**:

**Question**: "Safety passed: {S:,} distinct states in {safety_time}. Liveness estimate: ~{liveness_estimate} on your {cores}-core {arch} ({B} branches). Proceed?"

| Option | What happens |
|--------|-------------|
| **Run liveness** (~{liveness_estimate}) | Proceed with liveness config. |
| **Reduce model first** | Lower MaxTick, fewer actors, or split the spec. Re-estimate after. |
| **Skip liveness** | Safety is enough. Proceed to Phase 5. |

If liveness estimate > 20 min: suggest reducing. If > 60 min: strongly recommend reducing before running.

**Thorough**: Run safety, then run liveness automatically — no prompt. Both use separate configs (CONSTRAINT for safety, ACTION_CONSTRAINT for liveness).

### Parallel verification (subagents)

When the user selects **Optimal** or **Max**, use a two-stage approach:

1. **Run Fast immediately** in the main context. Report results to the user within seconds.
2. **Spawn a background agent** running the selected higher profile. The agent:
   - Adjusts MC module constants to the larger model size
   - Runs TLC with the appropriate JVM flags
   - Returns: pass/fail, state count, time, any new counterexamples not found by Fast

This way the user gets instant feedback from Fast while deeper verification runs in the background. If Fast already finds counterexamples, the user can start fixing without waiting for Optimal/Max to finish.

**Background agent prompt**: "Run TLC on `<spec>.tla` with MC constants: `<larger model>`. JVM flags: `<profile flags>`. Report: (1) pass or fail with counterexample traces, (2) distinct states explored, (3) wall-clock time, (4) any violations not present in the Fast run."

If Fast and Optimal/Max disagree (Fast passes, larger model fails), the larger model found a bug that only manifests with more actors — flag this to the user as a significant finding.

### Running TLC

Apply the selected profile by adjusting the MC module constants and JVM flags:

```bash
# Fast — small model, quick iteration
java -Xmx4g -XX:+UseParallelGC -jar ~/tla/tla2tools.jar \
    -config MC.cfg -workers 4 -nowarning MC.tla

# Optimal — medium model, full cores
java -Xmx16g -XX:+UseParallelGC -jar ~/tla/tla2tools.jar \
    -config MC.cfg -workers auto -nowarning MC.tla

# Max — large model, maximum resources
java -Xmx<50% of RAM>g -XX:+UseG1GC -jar ~/tla/tla2tools.jar \
    -config MC.cfg -workers auto -nowarning MC.tla
```

Adjust the MC module's constants to match the profile (e.g., `MC_Workers == {w1, w2}` for Fast, `{w1, w2, w3}` for Optimal). Report results with the profile used so the user can decide whether to step up.

### Pre-flight runtime estimate

**Always estimate runtime before running TLC.** Read `${CLAUDE_SKILL_DIR}/references/runtime-estimate.md` for the full estimation procedure (hardware detection, safety estimate from MC constants, liveness estimate from state count, calibration after run).

Always display the estimate before running:

```
Safety estimate: ~15s on your 10-core Apple M1 Pro (16GB)
  Model: 2 workers, 3 jobs, 7 state variables
  Running...
```

### On counterexample

Read the state trace bottom-up:
1. **Last state**: violates the property
2. **Preceding states**: action sequence that led there
3. **Triage** — before declaring a bug, ask: **is the spec correct?**
   - Does the failing action accurately model the real system? If a guard is missing from the spec that exists in the code/design, it's a **spec bug** → go back to Phase 2.
   - Is the violated invariant actually what you want to guarantee? If it's too strict, relax it → go back to Phase 2.
   - If the spec is faithful and the invariant is correct, then this is a real finding.
4. **Diagnosis** (once you've confirmed the spec is faithful):
   - **Path A**: This is a **design bug**. Trace back to the design doc claim that's violated. Fix the design (add a guard, change the protocol), update the spec, and re-verify.
   - **Path B**: This is a **code bug**. The trace is a reproduction recipe — it tells you the exact sequence of operations that triggers the issue. Map each TLA+ action in the trace back to the code function it represents to find the fix.

### On pass

Sanity-check: temporarily remove a guard from an action. TLC should now find a violation. If it still passes, the property may be trivially true — the model is too constrained or the invariant too weak.

### Incremental verification

One action or property per change. Verify. Proceed. With small models TLC runs in <60s. If it fails, the bug is in the last change.

---

## Phase 4.5: Adversarial Review (subagent)

When Phase 4 passes, spawn a background adversarial review agent. Skip for Quick preset and Screen Flow specs. Read `${CLAUDE_SKILL_DIR}/references/adversarial-review.md` for the full agent prompt and result handling.

---

## Transition to Phase 5

After Phase 4 passes (and adversarial review completes, if run), use `AskUserQuestion` before proceeding.

**Question**: "The spec is verified. What next?"

| Option | What happens |
|--------|-------------|
| **Update docs, stop for review** | Write or update the design doc (DESIGN.md) to reflect verified findings. Save the `.tla` spec alongside it. Stop here so the user can review before any code is written. |
| **Implement from the spec** | Proceed to Phase 5 — write new code (Path A) or fix existing code (Path B) based on the verified spec. |

Default to **Update docs, stop for review** if unsure. Writing code from an unreviewed spec is risky — the user may disagree with modeling choices that affect implementation.

### If "Update docs, stop for review"

1. Write or update the design doc with:
   - Verified properties (what the spec proved)
   - Findings and counterexamples (what the spec caught), using the communication style (impact-first)
   - Modeling decisions and known limitations
   - The action-to-code mapping table (what each TLA+ action would become in code)
2. Save the `.tla` and MC files alongside the design doc
3. Stop. The user reviews and comes back with `/tla` when ready to implement.

### If "Implement from the spec"

Proceed to Phase 5A (new code) or 5B (fix existing code) below.

---

## Phase 5A: Implement (Design-First)

*The spec passed. Now write code from it.*

- Each TLA+ **action** maps to a code function/method
- Each **invariant** maps to a test assertion
- **Counterexample traces** from Phase 4 become edge-case test scenarios — the TLC trace is literally a test script showing the exact sequence of operations that triggers the bug
- Post-implementation: validate code matches spec using your system's observability (logs, metrics, trace events)

---

## Phase 5B: Validate and Fix (Code-First)

*The spec either passed or found bugs. Now act on the results.*

### If TLC passed

Deliver a confidence report (scope, state count, invariants verified). Generate test cases from the spec's actions — especially failure/recovery paths. Keep the `.tla` file alongside the code as living documentation.

### If TLC found counterexamples

For each counterexample: (1) map the TLC trace to code functions, (2) write a failing test that reproduces it, (3) fix the code (the spec's guard tells you what the fix is), (4) re-verify. See `${CLAUDE_SKILL_DIR}/references/examples/` for before/after code showing this process.

---

## Pattern Catalog, Translation Guide & Abstraction Reference

Full reference with all 15 patterns, design-to-spec translation table, and abstraction guide: **`${CLAUDE_SKILL_DIR}/references/pattern-catalog.md`**

Community TLA+ specs mapped to each pattern (with links to source): **`${CLAUDE_SKILL_DIR}/references/community-specs.md`**

### Quick reference — pattern matching

During Phase 1 (Extract), scan the design doc or code for these phrases to identify which patterns apply:

| Domain | Patterns | Trigger Phrases |
|--------|----------|-----------------|
| Backend | Transaction Commit, Resource Allocator, Failure Detector, Blocking Queue, Termination Detection, Checkpoint Coordination | "lock row", "pool dispatch", "heartbeat", "bounded queue", "all done", "crash recovery" |
| Both | Readers-Writers, Mutual Exclusion, Lifecycle State Machine, Cache Invalidation | "concurrent read/write", "only one X can", "must X before Y", "stale read" |
| Frontend | Optimistic Update, Multi-Tab Sync, Offline-First Sync, Real-Time Collaboration | "apply locally", "consistent across tabs", "sync on reconnect", "concurrent edits" |
| UX | Screen Flow | "checkout flow", "too many screens", "simplify the funnel" (deterministic — fast-path) |
| UX | Component State | "button updates after X", "enable when Y changes" (has concurrency — normal workflow) |

### Quick reference — translation

| Design/Code Pattern | TLA+ Construct |
|---------------------|----------------|
| "Only one X can..." | Safety: `Cardinality({x \in S : state[x] = "active"}) <= 1` |
| "Eventually every X gets Y" | Liveness: `\A x \in X : <>(state[x] = "Y")` |
| "If X crashes, Y recovers" | Crash action + recovery action, `WF_vars(Recover)` |
| "Apply locally, confirm later" | Separate `localState` / `serverState`; rollback on reject |

See `${CLAUDE_SKILL_DIR}/references/pattern-catalog.md` for the complete translation table (14 entries) and abstraction guide.

---

## When NOT to Use TLA+

Not every concurrency concern needs formal verification. Skip TLA+ when:

- **Single-threaded CRUD** — no concurrent actors, nothing to verify
- **Pure UI/styling** — layout, CSS, animations have no state machine
- **Simple request/response** — one client, one server, no interleaving
- **The design is already a known solved pattern** — e.g., standard mutex, well-tested library handles it
- **Prototyping** — the design will change too fast for specs to keep up

Use TLA+ when the cost of a concurrency bug is high (data corruption, lost writes, security holes) or when the team can't agree on whether the design is correct.

---

## References

Reference files are loaded on demand — read the relevant file when the context calls for it, not all at once.

### When to read each reference

**Read during Phase 1 (Extract) — pattern matching:**
- `${CLAUDE_SKILL_DIR}/references/pattern-catalog.md` — Read when matching the user's concern against patterns. Contains the full 15-pattern catalog, design-to-spec translation table, abstraction guide, and production lessons.
- `${CLAUDE_SKILL_DIR}/references/community-specs.md` — Read when the user's pattern has a community spec. Contains descriptions and real-world mappings. The actual `.tla` files are in `${CLAUDE_SKILL_DIR}/references/community-specs/<SpecName>/`.

**Read during Phase 2 (Spec) — writing TLA+:**
Pick the worked example that matches the user's domain. Each has a full spec, MC module, and TLC walkthrough to use as a template:
- `${CLAUDE_SKILL_DIR}/references/backend-worker-pool.md` — Read when the spec involves job queues, worker pools, crash recovery, DB locks, or bounded concurrency.
- `${CLAUDE_SKILL_DIR}/references/frontend-optimistic-ui.md` — Read when the spec involves optimistic updates, websocket sync, version conflicts, or client-server state divergence.
- `${CLAUDE_SKILL_DIR}/references/ux-state-reduction.md` — Read when the spec involves multi-step UX flows, checkout funnels, onboarding, or "how many screens does the user need?"

**Read during Phase 2 (Spec) — referencing community specs:**
When the matched pattern has a community spec, read the `.tla` file from `${CLAUDE_SKILL_DIR}/references/community-specs/<SpecName>/`. See `${CLAUDE_SKILL_DIR}/references/community-specs.md` for the full index mapping patterns to specs. Source: [tlaplus/examples](https://github.com/tlaplus/examples) (MIT License).

**Read during Phase 5 (Implement/Fix) — companion code:**
Each worked example has a before/after code file showing the buggy version and the TLA+-informed fix. Use as a template when writing implementation code:
- `${CLAUDE_SKILL_DIR}/references/examples/backend_worker_pool.py` — Python (asyncpg). Before: no row lock, no orphan recovery. After: SELECT FOR UPDATE, recovery cron. Includes test cases from TLC traces.
- `${CLAUDE_SKILL_DIR}/references/examples/frontend_optimistic_ui.tsx` — TypeScript (React). Before: no version check, ws clobbers optimistic state. After: useRef guard, baseVersion, deferred ws. Includes test scenarios.
- `${CLAUDE_SKILL_DIR}/references/examples/ux_checkout_flow.tsx` — TypeScript (React). Before: 11-screen flow. After: 7-screen flow with analytics validation against spec predictions.

**Read during Phase 4 (Model-Check):**
- `${CLAUDE_SKILL_DIR}/references/system-requirements.md` — Hardware tables, state space estimates, JVM tuning.
- `${CLAUDE_SKILL_DIR}/references/runtime-estimate.md` — Pre-flight estimation procedure, per-architecture throughput rates, calibration.
- `${CLAUDE_SKILL_DIR}/references/adversarial-review.md` — Agent prompt and result handling for Phase 4.5.

**Read when presenting results:**
- `${CLAUDE_SKILL_DIR}/references/communication-style.md` — Impact-first template, severity labels, examples.

---

## Communication Style

Present all findings impact-first, TLA+ detail second. Read `${CLAUDE_SKILL_DIR}/references/communication-style.md` for the full template, severity labels, and examples. Key rule: "Liveness violation" means nothing to users. "Users get stuck in a loading state that never resolves" does.

---

## Output Format

After each phase, report: path (A/B), target, phase, matched patterns, spec name, state vars, actions, safety/liveness properties, alignment status, verification result (states explored, time, pass/fail with counterexample traces if any), and files changed.
