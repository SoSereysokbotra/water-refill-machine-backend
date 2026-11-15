# ADR-0010: Identity, Authentication & Role-Based Access Control (RBAC)

## Status
Accepted

## Context
In Phases 1 through 5, administrative and operator REST endpoints were protected during development by `AdminKeyGuard` (open in `APP_ENV=local`, or requiring header `X-Admin-Key` matching `ADMIN_API_KEY` outside local). 
For production deployment, multi-operator support, and the upcoming web dashboard (Phase 7), the platform requires secure session-based authentication, role-based access control (Admin, Operator, Viewer), brute-force protection, and an immutable security audit trail.

Per Plan E Phase 6, we evaluated Better Auth in NestJS + Fastify versus the native modular architecture fallback.

## Spike Evaluation & Decision
1. **Spike Findings (Better Auth vs NestJS Fastify):**
   * Better Auth is optimized for web standards (Fetch Request/Response) or Express middleware.
   * Integrating Better Auth into NestJS Fastify requires mounting raw routing handlers outside NestJS's dependency injection container, which bypasses NestJS execution context, metadata reflection (`@Roles()`), exception filters (`GlobalExceptionFilter`), and structured Pino logging context.
2. **Decision (Architectural Fallback):**
   * We adopt the designated fallback architecture: **NestJS Guards (`AuthGuard`, `RolesGuard`) + Argon2id password hashing (`@node-rs/argon2`) + HTTP-only cookies / Bearer auth + PostgreSQL `sessions` and `users` tables**.
   * **Password Hashing:** Argon2id via `@node-rs/argon2` (prebuilt, high-performance, resistant to GPU/ASIC cracking).
   * **Sessions & Tokens:** High-entropy random tokens (`session_<64hex>`) transmitted via HTTP-only cookie `wrm_session` (for browser/dashboard) or `Authorization: Bearer <token>` (for API/CLI/tests). In the database, only the cryptographic SHA-256 hash (`token_hash`) of the token is stored.
   * **Roles Hierarchy:**
     * `admin`: Full administrative control (user management, machine provisioning, decommissioning, price modifications, credential rotation, refund overrides, audit viewing).
     * `operator`: Day-to-day operations (alert acknowledgment/resolution, viewing machines and payments, handling refund claims).
     * `viewer`: Read-only access (viewing machines, dashboards, sales reports).
   * **Two-Factor Authentication (TOTP):** Admin users can optionally enable RFC 6238 TOTP (Time-based One-Time Password) for login verification.
   * **Immutable Audit Trail:** Sensitive state changes (price modifications, machine status updates, credential rotation, refund claim/mark/reject/reopen decisions, user updates) are immutably recorded in `audit_logs`.
   * **Rate Limiting:** Login attempts are rate-limited per IP and per identifier via Redis `RateLimiterService` to mitigate brute-force credential attacks.

## Consequences
* **Positive:** Complete type safety, native integration with NestJS Dependency Injection, zero fragile middleware shims, and strict architectural boundary compliance.
* **Security:** Database leaks do not expose plaintext passwords (Argon2id) or active session tokens (SHA-256 hashed).
