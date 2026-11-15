# Phase 6: Identity & Access Control Guide

> **Quick status:** Code and automated test suites for Phase 6 are complete (16 test suites passing, 133/133 unit & integration tests, 0 boundary violations).
> **Architecture Decision:** [ADR-0010: Identity, Authentication & Role-Based Access Control](docs/adr/0010-identity-and-auth.md).

---

## 1. Overview

Phase 6 introduces authentication, role-based authorization (RBAC), multi-factor authentication (TOTP), and an immutable security audit trail to the Water Refill Machine backend.

### Key Capabilities
- **Session-Based Authentication:** Tokens stored as cryptographic SHA-256 hashes (`token_hash`) in the PostgreSQL `sessions` table. Transmitted via secure HTTP-only cookie (`wrm_session`) for browsers/dashboard or `Authorization: Bearer <token>` for API/CLI/tests.
- **Argon2id Hashing:** Password hashing powered by `@node-rs/argon2` (resistant to GPU and ASIC brute-forcing).
- **Three-Tier Role Hierarchy (RBAC):**
  - **`admin`**: Full system control (user management, machine provisioning, price updates, credential rotation, decommissioning, refund overrides, audit inspection).
  - **`operator`**: Daily operational tasks (alert acknowledgment and resolution, machine/payment monitoring, claiming refund cases).
  - **`viewer`**: Read-only access (viewing fleet machines, dashboards, sales reports).
- **Two-Factor Authentication (TOTP):** Optional RFC 6238 time-based one-time password 2FA for admin and operator accounts.
- **Immutable Security Audit Trail:** Every sensitive operational modification (price changes, machine state changes, credential rotation, refund decisions, unknown dispense resolutions, user account changes) is immutably logged into `audit_logs`.
- **Brute-Force & Rate Limiting:** Login attempts are rate-limited per IP and per account via Redis `RateLimiterService`.

---

## 2. API Endpoints

All endpoints are prefixed with `/v1`.

### Authentication (`/v1/auth`)

| Method & Route | Access | Description |
|---|---|---|
| `POST /v1/auth/login` | Public | Authenticates email & password (+ optional `totpCode`). Returns session token and sets `wrm_session` HTTP-only cookie. Rate limited. |
| `POST /v1/auth/logout` | Authenticated | Clears `wrm_session` cookie and invalidates session token. |
| `GET /v1/auth/me` | Authenticated | Returns current authenticated user profile and assigned role. |
| `POST /v1/auth/totp/setup` | Authenticated | Initiates 2FA setup; returns base32 secret and `otpauth://` URI. |
| `POST /v1/auth/totp/verify` | Authenticated | Verifies 6-digit TOTP code and activates 2FA on the user account. |

### Users Management (`/v1/users`)

| Method & Route | Required Role | Description |
|---|---|---|
| `POST /v1/users` | `admin` | Creates a new user account with hashed password and role. Audit-logged. |
| `GET /v1/users` | `admin` | Lists all user accounts (paginated, max 100). |
| `GET /v1/users/:id` | `admin` | Retrieves user account details. |
| `PATCH /v1/users/:id` | `admin` | Updates user name, role, or enables/disables the account. Audit-logged. |

### Audit Logs (`/v1/audit-logs`)

| Method & Route | Required Role | Description |
|---|---|---|
| `GET /v1/audit-logs` | `admin` | Queries immutable security audit records. Filters by `entityType`, `entityId`, `actorId`, and `limit`. |

---

## 3. Role Hierarchy & Endpoint Protection Matrix

Endpoints are protected by `@UseGuards(SessionAuthGuard, RolesGuard)` and decorated with `@Roles(...)`:

```
admin (rank 3) ──▶ operator (rank 2) ──▶ viewer (rank 1)
```

| Route | Minimum Role Required | Permitted Roles |
|---|---|---|
| `/health/live`, `/health/ready` | *None* | Public |
| `POST /v1/payway/callback` | *None* (Rate limited) | Public (Webhook) |
| `POST /v1/auth/login` | *None* (Rate limited) | Public |
| `GET /v1/machines`, `GET /v1/machines/:id` | `viewer` | Viewer, Operator, Admin |
| `GET /v1/payments/:tranId` | `operator` | Operator, Admin |
| `GET /v1/refund-cases`, `GET /v1/refund-cases/:tranId` | `operator` | Operator, Admin |
| `POST /v1/refund-cases/:tranId/claim` | `operator` | Operator, Admin |
| `GET /v1/alerts`, `POST /v1/alerts/:id/ack`, `/resolve` | `operator` | Operator, Admin |
| `POST /v1/machines`, `PATCH /v1/machines/:id` | `admin` | Admin only |
| `PUT /v1/machines/:id/prices` | `admin` | Admin only |
| `POST /v1/machines/:id/rotate-credentials`, `/decommission` | `admin` | Admin only |
| `POST /v1/refund-cases/:tranId/mark-refunded`, `/reject`, `/reopen`| `admin` | Admin only |
| `POST /v1/payments/:tranId/resolve-unknown` | `admin` | Admin only |
| `GET /v1/users`, `POST /v1/users`, `PATCH /v1/users/:id` | `admin` | Admin only |
| `GET /v1/audit-logs` | `admin` | Admin only |

---

## 4. Default Seed Accounts (Local / Staging)

Running `pnpm --filter @wrm/api db:seed` provisions default development accounts:

| Role | Email | Password |
|---|---|---|
| **Admin** | `admin@wrm.kh` | `AdminPassword123!` |
| **Operator** | `operator@wrm.kh` | `OperatorPassword123!` |
| **Viewer** | `viewer@wrm.kh` | `ViewerPassword123!` |

---

## 5. Testing & Verification

Run the test suites:

```bash
# 1. Run all Identity unit tests (TOTP, Services, Guards, Controllers)
pnpm --filter @wrm/api exec vitest run test/totp.spec.ts test/identity-services.spec.ts test/roles-guard.spec.ts test/identity-api.spec.ts

# 2. Run all project unit tests
pnpm --filter @wrm/api test:unit

# 3. Check architectural boundary compliance (0 violations)
pnpm --filter @wrm/api depcruise

# 4. Verify TypeScript compilation
pnpm typecheck
```
