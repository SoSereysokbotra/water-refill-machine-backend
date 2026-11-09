# ADR-0001: Modular Monolith Architecture

## Status
Accepted

## Context
The Water Refill Machine system requires coordination between IoT machines, cloud backend, payment gateway (ABA PayWay), and operations dashboards. We need a maintainable architecture that avoids the operational overhead, network latency, distributed transaction complexity, and deployment friction of microservices for a single-developer or small-team project.

## Decision
We adopt a **Modular Monolith** structure in a single repository:
* Codebase is organized into bounded contexts (`payments`, `dispensing`, `fleet`, `monitoring`, `identity`, `reporting`).
* Contexts communicate through in-process domain events, transactional outbox, or strictly defined public ports.
* Single container image deployed in production with runtime process roles controlled by `RUN_MODE` (`api`, `worker`, or `all`).
* Strict architectural boundaries enforced automatically in CI using `dependency-cruiser`.

## Consequences
* **Positive:** Simplified deployments, single database transaction capability where appropriate, straightforward refactoring, fast local development, zero microservice network overhead.
* **Negative:** Requires rigorous discipline and CI linting to prevent tight coupling across modules.
