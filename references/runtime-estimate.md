# Pre-Flight Runtime Estimate

Always estimate runtime before running TLC. The process differs for safety vs liveness.

## Step 1: Get hardware (ask once, save to memory)

Detect automatically, or ask the user if detection fails:

```bash
# macOS
sysctl -n hw.ncpu                       # cores
sysctl -n hw.memsize                     # RAM in bytes
sysctl -n machdep.cpu.brand_string       # CPU name

# Linux
nproc                                    # cores
grep MemTotal /proc/meminfo              # RAM
grep "model name" /proc/cpuinfo | head -1  # CPU name
```

Classify the architecture:

| Architecture | Example |
|-------------|---------|
| Apple Silicon | M1, M2, M3, M4 (any variant) |
| x86 modern (2020+) | Ryzen 5000+, Intel 12th gen+, Xeon Scalable 3rd+ |
| x86 older / budget | Ryzen 3000, Intel 10th gen, older Xeons |
| ARM Linux | Graviton, Raspberry Pi, Ampere |

Save the hardware profile to memory after first detection — don't re-ask every run.

## Step 2: Estimate safety time

Estimate from MC module constants before running:
- Each actor set of size N: roughly ×N² per additional actor
- Each boolean variable: ×2
- Each enum variable (k values): ×k
- Each bounded sequence (length ≤ L, over set S): ×|S|^L
- StateConstraint bounds (e.g., `clock <= MaxTick`): ×MaxTick

Display before running:

```
Safety estimate: ~15s on your 10-core Apple M1 Pro (16GB)
  Model: 2 workers, 3 jobs, 7 state variables
  Profile: Optimal (auto workers, 16GB heap)
  Running...
```

## Step 3: Compute liveness estimate (after safety passes)

Safety gives the **exact distinct state count S** — TLC prints `N distinct states found`.

Count liveness branches B: each `P ~> Q` = 1 branch, each `\A x \in Set : P ~> Q` = |Set| branches. TLC also prints `satisfiability problem has B branches` in the first seconds of any liveness run.

Per-core liveness throughput by architecture:

| Architecture | core_rate (states/s/core) |
|-------------|---------------------------|
| Apple Silicon | 400 |
| x86 modern (2020+) | 300 |
| x86 older / budget | 150 |
| ARM Linux | 100 |

IO factor (does the state graph fit in memory?):

```
heap_gb = min(system_ram_gb × 0.5, 12)
if S < heap_gb × 20_000_000:    # ~50 bytes/state, fits in 50% of heap
    io_factor = 1.0              # in-memory — full speed
else:
    io_factor = 0.3              # disk spill — 3x slower
```

Estimate:

```
R_live = cores × core_rate × io_factor
T_seconds = S × B / R_live
T_minutes = T_seconds / 60
```

## Step 4: Present to user

```
Safety found 52,500,000 distinct states in 2m 03s.
With 4 liveness branches on your 10-core Apple M1 Pro (16GB):
  Estimated liveness time: ~9 min
  Proceed?
```

**If T > 20 min**: suggest reducing MaxTick or splitting the model.
**If T > 60 min**: strongly recommend reducing before running.

## Step 5: Calibrate (after run completes)

Compare estimate vs actual. If off by >2x, compute the actual core rate and save to memory:

```
actual_core_rate = S × B / (T_actual_seconds × cores × io_factor)
```

This improves future estimates for this user's hardware.
