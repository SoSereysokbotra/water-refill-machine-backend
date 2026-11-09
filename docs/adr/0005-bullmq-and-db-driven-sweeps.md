# ADR-0005: BullMQ and Database-Driven Sweeps

## Status
Accepted

## Context
Payment lifecycles involve time-sensitive deadlines: QR expiration (e.g. 3 minutes + grace), periodic ABA status checks (every 3–5 seconds), reconciliation of terminal states, and offline timeouts. Storing timer states solely in in-memory queues (like Redis delayed jobs) creates vulnerability to data loss during Redis restarts or eviction.

## Decision
We decouple state truth from queue scheduling using **Database-Driven Sweeps**:
* All deadlines live in PostgreSQL columns (`expires_at`, `next_aba_check_at`, `paid_at`).
* Repeatable BullMQ jobs (e.g. `sweep.payments` every 3s, `sweep.reconcile` every 5m) act as trigger pulses that query due records in PostgreSQL.
* Job schedulers are upserted dynamically at every worker process boot.
* Redis data loss causes no loss of financial deadlines—the next sweep run immediately finds all due rows in PostgreSQL.

## Consequences
* **Positive:** Complete resilience against Redis crashes. System state is always reconstructible from PostgreSQL alone.
* **Negative:** Frequent sweep queries against PostgreSQL, mitigated by targeted partial indexes (e.g. `INDEX (status, next_aba_check_at)`).
