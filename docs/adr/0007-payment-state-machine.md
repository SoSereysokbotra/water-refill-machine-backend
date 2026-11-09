# ADR-0007: Payment State Machine & System Invariants

## Status
Accepted

## Context
Handling physical water dispensing backed by external QR payments requires strict state rules to protect against fraud, equipment damage, and lost revenue.

## Decision
We enforce the final payment state machine (Section C1) and 5 non-negotiable system invariants:
1. **System Invariants:**
   * **Invariant 1:** No water without a confirmed payment for that specific machine and `tran_id`.
   * **Invariant 2:** A payment dispenses at most once.
   * **Invariant 3:** No automatic refund while the dispense outcome is unknown.
   * **Invariant 4:** No financial decision depends solely on a message that can be lost (derivable from PostgreSQL + ABA).
   * **Invariant 5:** No payment that ABA may still accept is left unobserved (proactive reconciliation).
2. **One Open Payment Rule:**
   * A machine may have at most **one open payment** (`PENDING` or `PAID`) enforced via PostgreSQL partial unique index `CREATE UNIQUE INDEX one_open_payment_per_machine ON payments(machine_id) WHERE status IN ('PENDING','PAID')`.
   * A new customer request supersedes any existing `PENDING` request (marking it `CANCELLED`). An active `PAID` payment rejects new requests with `PAY_MACHINE_BUSY`.
3. **Late Payments:**
   * If a customer pays after the QR has expired or cancelled, the payment transitions to `REFUND_REVIEW`. The machine is **never** told to dispense water for a late payment.

## Consequences
* **Positive:** Complete elimination of double dispensing, ghost dispenses, and unmonitored late customer payments.
* **Negative:** Customers cannot queue up payments while another customer is actively filling water.
