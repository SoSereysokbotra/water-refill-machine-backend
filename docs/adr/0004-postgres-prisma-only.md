# ADR-0004: PostgreSQL and Prisma as Single Data Layer

## Status
Accepted

## Context
We need a dependable, type-safe data access solution supporting ACID transactions, partial unique indexes (e.g. at most one open payment per machine), and safe schema migrations.

## Decision
We select **PostgreSQL 16** with **Prisma ORM**:
* Prisma is used for all entity writes, typical reads, and declarative migrations.
* Complex read aggregations and reporting views use Prisma TypedSQL or raw SQL queries (`$queryRaw`).
* Migrations follow the expand-migrate-contract pattern and run via `DIRECT_DATABASE_URL`.
* Partial unique indexes and domain check constraints (e.g. volume tiers 500, 750, 1000) are added through reviewed SQL migration scripts.

## Consequences
* **Positive:** Complete compile-time type safety across database operations, robust migration management, and native PostgreSQL features for concurrency and data integrity.
* **Negative:** Complex multi-table aggregations occasionally require raw SQL instead of the standard Prisma client API.
