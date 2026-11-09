# ADR-0002: DDD and Hexagonal Architecture for Core Contexts Only

## Status
Accepted

## Context
Full Domain-Driven Design (DDD) with pure Hexagonal/Clean Architecture across all modules introduces high boilerplate (repositories, interfaces, mappers, DTOs). However, money transactions and physical water dispensing have strict safety invariants and high financial risk requiring complete isolation from framework details.

## Decision
We apply strict DDD and 4-layer Hexagonal architecture **only to core contexts**:
1. **Core Contexts (`payments`, `dispensing`):**
   * **Domain layer:** Pure business logic, aggregates, value objects, domain errors, domain events, and port interfaces. Strictly zero dependencies on NestJS, Prisma, BullMQ, or MQTT.
   * **Application layer:** Use-case command/query handlers, process managers, sweeps orchestrators.
   * **Infrastructure layer:** Prisma repositories, ABA PayWay gateway adapters, event publishers.
   * **Interface layer:** REST controllers, MQTT topic subscribers, BullMQ job processors.
2. **Supporting & Generic Contexts (`fleet`, `monitoring`, `identity`, `reporting`):**
   * 2-layer architecture (`application` and `interface`). Pragmatic NestJS services using Prisma directly with pure unit-testable rules.
   * Cross-context interaction occurs solely through public ports (`<context>/application/public/*.port.ts`) or outbox events.

## Consequences
* **Positive:** Critical financial and physical dispensing invariants are protected and 100% unit testable without mocks or databases. Supporting domains remain fast and lean to build.
* **Negative:** Developers must observe the distinction between core and supporting contexts.
