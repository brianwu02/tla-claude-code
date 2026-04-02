# Adversarial Review — Agent Prompt & Handling

## When to run

Spawn as a background agent immediately after Phase 4 passes. The user reads the pass report while the review runs.

Skip for: Quick preset, Screen Flow UX specs. Only run for Standard/Thorough budgets on specs that guard critical paths.

## Background agent prompt

```
You are an adversarial reviewer for a TLA+ specification. Your job is to
find what the spec DOESN'T cover — missing failure modes, weak invariants,
absent actors, and boundary gaps. You are not trying to break TLC; you are
trying to break the modeler's assumptions.

Spec file: <path to .tla>
Modeling brief: <paste the modeling brief from Phase 1>
Source material: <design doc path or code path>

Perform these four checks and return structured findings:

1. INVARIANT STRENGTH
   For each safety invariant, propose a stricter version.
   Example: if the spec checks `NoDoubleClaim`, propose
   `NoDoubleClaim /\ NoOrphanedClaims`. If the stricter version
   would also pass, the original may be under-specifying.
   Return: [{invariant, stricter_version, rationale}]

2. MISSING FAILURE MODES
   List failure scenarios not modeled as actions. Consider:
   - Network partition between actors
   - Partial writes (DB write succeeds, cache write fails)
   - Token/session expiry mid-operation
   - Actor disappears without crash signal (silent failure)
   - External dependency returns stale data
   - User closes browser/tab during async operation
   - Clock skew between distributed actors
   Return: [{failure_mode, which_actors_affected, suggested_action_name}]

3. MISSING ACTORS
   Is there a concurrent participant the spec ignores?
   - Background cron/scheduler
   - Admin user with elevated access
   - Migration script running alongside normal operations
   - CDN/cache layer between client and server
   - Monitoring/health-check system that modifies state
   Return: [{actor, how_it_interacts, why_it_matters}]

4. SCOPE BOUNDARY RISKS
   What's just outside the spec that could break assumptions?
   - Upstream systems the spec treats as reliable
   - Downstream consumers of the spec's output state
   - Cross-spec interactions (if other specs exist)
   Return: [{boundary, assumption_at_risk, worst_case}]

For each finding, rate severity: LOW (interesting but unlikely),
MEDIUM (plausible, worth modeling), HIGH (likely to cause a real bug).

Return only MEDIUM and HIGH findings.
```

## Handling the results

Present findings grouped by severity. For each HIGH finding, recommend whether to:
- Add it to the spec and re-run Phase 4 (costs 1 refinement cycle)
- Document it as a known limitation (if out of scope)
- Defer to a separate spec (if it's a distinct concern)

MEDIUM findings are informational — present them but don't pressure the user to act on all of them. The goal is awareness, not exhaustive coverage.
