# ADR-0003: Transactional Outbox Pattern for Reliable Event Dispatch

## Status
Accepted

## Context
When domain state changes (e.g. payment marked `PAID`), the system must publish messages to MQTT (telling the machine to dispense) and notify other contexts. Publishing to a message broker directly within a database transaction risks two-phase commit failures, lost messages, or dual writes.

## Decision
We implement the **Transactional Outbox Pattern**:
* Every domain event is persisted into an `outbox` table within the same PostgreSQL ACID transaction as the aggregate state change.
* A background relay process polls pending outbox entries (batch size 20, 250 ms poll) using `SELECT ... FOR UPDATE SKIP LOCKED`.
* Events are dispatched to BullMQ queues where individual handlers retry independently with exponential backoff.
* Rows past max retry attempts (10 attempts) are marked `dead_at` and raise an alert without blocking the relay pipeline.

## Consequences
* **Positive:** Guaranteed at-least-once message publishing. Eliminates lost messages due to transient broker or network downtime.
* **Negative:** Consumers must be idempotent to handle occasional duplicate deliveries.
