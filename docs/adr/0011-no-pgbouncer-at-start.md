# ADR-0011: Connection Budgeting Without PgBouncer at Launch

## Status
Accepted

## Context
Deploying connection poolers like PgBouncer introduces extra deployment infrastructure, session state limitations (e.g. prepared statement compatibility), and operational complexity. We need to evaluate whether PgBouncer is necessary for initial deployment phases.

## Decision
We do **not** use PgBouncer at the start of the project:
* The connection budget is strictly managed through Prisma connection pool limits:
  * 2 API instances × 5 connections = 10 connections.
  * 1 Worker instance × 5 connections = 5 connections.
  * Direct migration runner = 1–2 connections.
  * **Total client connections:** ~17 connections.
* This budget comfortably fits within standard managed PostgreSQL tiers (which typically support ≥ 25–50 concurrent connections).
* No session-scoped PostgreSQL features (e.g. `LISTEN`, advisory session locks) are used, ensuring a pooler can be introduced in Phase 10 or later without application code rewrites if machine fleet scaling demands it.

## Consequences
* **Positive:** Simpler infrastructure stack, fewer failure modes, zero prepared statement issues.
* **Negative:** Connection pool size per process must remain bounded via `DATABASE_URL` query parameters.
