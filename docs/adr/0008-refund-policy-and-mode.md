# ADR-0008: Refund Policy and Claim Modes

## Status
Accepted

## Context
When dispensing fails, dispenses partially, encounters a sensor fault, or receives a late payment after QR expiration, the customer must be reimbursed fairly while preventing operator abuse or premature refunds before machine outcome delivery.

## Decision
We define a multi-tiered refund calculation and a dual-mode refund workflow:
1. **Calculation Rules:**
   * **Late payment:** 100% refund.
   * **Fault/Error/Bottle timeout with < 10% target delivered:** 100% refund.
   * **Partial dispense:** Pro-rata refund `(1 - flow_ml / volume) * amount`, rounded to currency minor unit.
   * **Outcome unknown:** Escalated for operator review after 24h of confirmed machine online connectivity with `pending_outcomes = 0`.
2. **Refund Modes (`REFUND_MODE`):**
   * **Manual mode (default):** Refund cases are opened in status `open`. An operator **claims** the case (atomic reservation for `REFUND_CLAIM_MINUTES`). The operator performs the refund via ABA merchant portal or cash, then enters method, unique reference, and amount.
   * **Auto mode (future):** 100% refund cases executed programmatically via ABA refund API once ABA confirms API availability for KHQR.
3. **Safety Gate:**
   * Refunds cannot be executed while the target machine reports `pending_outcomes > 0` (unless overridden by an admin with a documented reason).

## Consequences
* **Positive:** Prevents refunds while an offline machine might still be dispensing or preparing to report a successful dispense.
* **Negative:** Manual mode requires operator attention through the admin dashboard.
