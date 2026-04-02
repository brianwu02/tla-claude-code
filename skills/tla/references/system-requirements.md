# System Requirements

TLC is CPU- and memory-intensive. The state space grows exponentially with the number of variables, actors, and possible values. Here's what to expect at different scales.

## Hardware Profiles

| Machine | Cores | RAM | Sweet spot |
|---------|-------|-----|------------|
| MacBook Air (M1/M2/M3) | 8 | 8-24 GB | Small models (2 actors, 3 resources). Development and iteration. Most design-phase specs fit here comfortably. |
| MacBook Pro (M1-M4 Pro/Max) | 10-16 | 16-96 GB | Medium models (3-4 actors, 5 resources). Covers 90% of real-world specs. `-workers auto` uses all P-cores. |
| Mac Pro / Mac Studio (Ultra) | 24 | 64-192 GB | Large models and exhaustive checks. Overkill for most specs — useful for final verification of complex protocols. |
| Linux workstation (Ryzen/Xeon) | 16-64 | 32-256 GB | Production-grade model checking. Headless, can run overnight. Best throughput per dollar. |
| Linux server / cloud VM | 32-128 | 64-512 GB | Massive state spaces (10+ variables, 5+ actors). CI/CD verification pipelines. Spot instances keep costs low. |

## Scaling Guidelines

TLC's performance depends on two things: **state space size** (how many distinct states exist) and **worker threads** (how many cores explore states in parallel).

### State space estimation

| Spec complexity | Distinct states | Time (8-core) | Time (32-core) | RAM |
|----------------|-----------------|---------------|-----------------|-----|
| Small (2 actors, 3 resources, ≤7 vars) | 10K-500K | <10s | <5s | <1 GB |
| Medium (3 actors, 5 resources, ≤12 vars) | 500K-50M | 30s-5min | 10s-90s | 2-8 GB |
| Large (4+ actors, 8+ resources, ≤20 vars) | 50M-5B | 10min-hours | 2min-30min | 8-64 GB |
| Exhaustive (5+ actors, complex guards) | 5B+ | Hours-days | 30min-hours | 64-256 GB |

### Rules of thumb

- Each additional actor roughly **squares** the state space (2 workers = N states, 3 workers = N² states)
- Each additional boolean variable **doubles** the state space
- Each additional enum variable **multiplies** by the number of values
- `-workers auto` uses all available cores — TLC scales nearly linearly up to ~32 cores
- TLC stores states in memory by default. If RAM is tight, use `-dump` to disk (10-50x slower)

## JVM Tuning

```bash
# Small spec (laptop)
java -Xmx4g -XX:+UseParallelGC -jar tla2tools.jar ...

# Medium spec (workstation)
java -Xmx16g -XX:+UseParallelGC -jar tla2tools.jar -workers auto ...

# Large spec (server) — use G1GC for heaps > 32 GB
java -Xmx128g -XX:+UseG1GC -jar tla2tools.jar -workers auto ...
```

## Practical Advice

- Start with the **smallest model** that captures the concurrency bug (2 actors, 2-3 resources). This runs in seconds on any machine and catches most design flaws.
- Only scale up model constants when the small model passes and you suspect it's hiding bugs due to symmetry reduction.
- For CI pipelines, small models are fast enough to run on every commit (<30s). Reserve medium/large models for pre-merge gates or nightly runs.
- On Apple Silicon, TLC runs well under Rosetta but native ARM JDKs (Azul Zulu, Eclipse Temurin) are 20-30% faster.
