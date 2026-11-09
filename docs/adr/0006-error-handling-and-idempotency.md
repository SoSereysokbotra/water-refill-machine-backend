# ADR-0006: Error Taxonomy and Idempotency Architecture

## Status
Accepted

## Context
IoT edge devices communicate over unreliable wireless and cellular networks, resulting in message retries, reordered deliveries, and transient disconnections. Simultaneously, payment gateways experience transient errors, duplicate webhooks, and rate limits.

## Decision
We enforce a unified error classification and strict idempotency mechanisms:
1. **Error Taxonomy:**
   * `DomainError`: Business invariant violations (never retried).
   * `ValidationError`: Malformed input (never retried).
   * `NotFoundError`: Entity does not exist (never retried).
   * `ConflictError`: Concurrency or state collision (retried boundedly).
   * `AuthError`: Authentication / permission issue (never retried).
   * `RateLimitError`: Throttled calls (caller backs off).
   * `InfrastructureError`: DB, Redis, MQTT, ABA transient failures (retried with backoff).
2. **Idempotency Keys:**
   * Payment requests: Unique `(machine_id, request_id)` key. Duplicate requests trigger **status-aware replay** (re-serving existing active QR without creating duplicate ABA charges).
   * Dispense outcomes: Unique `dispenses.tran_id` primary key. Duplicate outcomes reply with `transaction/ack ok`.
   * ABA callbacks: Enqueue `payments.confirm` with `jobId = tran_id`. Duplicate callbacks are naturally deduplicated by BullMQ and verified via `check-transaction`.

## Consequences
* **Positive:** Total defense against double-charging customers and double-dispensing water across retries and network hiccups.
* **Negative:** Requires storing client-provided `request_id` and tracking state lifecycle transitions.
