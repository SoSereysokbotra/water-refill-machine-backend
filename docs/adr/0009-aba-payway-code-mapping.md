# ADR-0009: ABA PayWay Per-Operation Code Mapping & Lifetime Rules

## Status
Accepted

## Context
ABA PayWay is the primary payment gateway for generating dynamic KHQR payment codes and verifying transactions. The API returns status codes that have distinct semantics depending on which operation was invoked:
1. In `generate-qr`, code `403` indicates a duplicate `tran_id` which can be safely recovered by regenerating the `tran_id`.
2. In `check-transaction-2`, code `6` does **not** mean a failure or rejection; it means "transaction not found yet" (i.e. the customer has not completed payment in their banking app), and the transaction must remain `PENDING` until `expires_at + grace`.
3. PayWay lifetimes must be specified in **minutes** (minimum 3 minutes), while local machine timers operate in seconds.
4. Programmatic `close-transaction` and KHQR refund APIs are documented as best-effort until final merchant account terms are confirmed by ABA support.

## Decision
1. **Per-Operation Status Code Mapping (Plan §D7 & §C10):**
   * **`generate-qr`**:
     * Code `0`: Success -> return `qrString`, `qrMd5`, `qrImage`, `deeplink`.
     * Code `403`: `DuplicateTranIdError` -> regenerate `tran_id` and retry up to 3 times.
     * Code `8`, `429`: `GatewayUnavailableError` -> transient failure, client may retry.
     * Other non-zero codes: `GatewayRejectedError` -> terminal configuration/merchant error.
   * **`check-transaction-2`**:
     * Code `00` or `0`:
       * `payment_status_code` `0` -> `approved`
       * `payment_status_code` `2` -> `pending`
       * `payment_status_code` `3` or `7` -> `declined`
       * `payment_status_code` `4` -> `refunded`
     * **Code `6`**: Mapped to `not_found` (= `pending` until `expires_at + grace`). Never treated as an error.
     * Code `11`, `429`: `GatewayUnavailableError`.
     * Code `5` (invalid hash), `8` (invalid merchant): `GatewayRejectedError`.
2. **Lifetime Specification:**
   * Sent to ABA as integer minutes (`PAYMENT_TTL_MINUTES`, default 3).
   * Exact expiration timestamp `expires_at` is tracked in UTC by the backend and broadcast to the ESP32 in `pay/qr`, which converts it into remaining seconds for the STM32 display.
3. **Closing & Probing:**
   * Expired and cancelled transactions trigger best-effort `close-transaction`.
   * Probing schedule for terminal unpaid payments: +5 min, +1 hour, +1 day, +3 days, +6 days (5 probes within ABA's 7-day query window). If any probe discovers payment approval, the transaction transitions to `REFUND_REVIEW`.

## Consequences
* **Positive:** Resilient handling of pending payments without false failures; automatic recovery from rare `tran_id` collisions; compliance with ABA's 7-day query window.
* **Negative:** Probes must run periodically against ABA API for 6 days for each expired transaction, requiring database-driven reconciliation sweeps.
