-- Phase 7 reporting views (Plan Phase 7 task 1).
--
-- Revenue = money ABA actually received:
--   * payments the machine was told were paid (paid_at set), dated by paid_at
--   * late payments (approved after EXPIRED/CANCELLED/FAILED: paid_at stays NULL,
--     a LATE_PAYMENT refund case is opened), dated by the refund case creation
-- refunded_amount_minor is subtracted for net revenue.

-- CreateMaterializedView: sales_daily
CREATE MATERIALIZED VIEW IF NOT EXISTS sales_daily AS
SELECT
    DATE(COALESCE(p.paid_at, lp.created_at)) AS date,
    p.currency,
    COUNT(*)::INTEGER AS total_payments,
    COUNT(*) FILTER (WHERE p.status = 'DISPENSED')::INTEGER AS dispensed_count,
    COUNT(*) FILTER (WHERE p.status = 'REFUNDED')::INTEGER AS refunded_count,
    SUM(p.amount_minor)::BIGINT AS gross_amount_minor,
    SUM(COALESCE(p.refunded_amount_minor, 0))::BIGINT AS refunded_amount_minor,
    (SUM(p.amount_minor) - SUM(COALESCE(p.refunded_amount_minor, 0)))::BIGINT AS net_amount_minor,
    SUM(p.volume_ml)::BIGINT AS total_volume_ml
FROM payments p
LEFT JOIN refund_cases lp ON lp.tran_id = p.tran_id AND lp.reason = 'LATE_PAYMENT'
WHERE p.paid_at IS NOT NULL OR lp.tran_id IS NOT NULL
GROUP BY DATE(COALESCE(p.paid_at, lp.created_at)), p.currency;

CREATE UNIQUE INDEX IF NOT EXISTS sales_daily_date_currency_idx ON sales_daily (date, currency);

-- CreateMaterializedView: sales_by_machine
CREATE MATERIALIZED VIEW IF NOT EXISTS sales_by_machine AS
SELECT
    p.machine_id,
    DATE(COALESCE(p.paid_at, lp.created_at)) AS date,
    p.currency,
    COUNT(*)::INTEGER AS total_payments,
    COUNT(*) FILTER (WHERE p.status = 'DISPENSED')::INTEGER AS dispensed_count,
    COUNT(*) FILTER (WHERE p.status = 'REFUNDED')::INTEGER AS refunded_count,
    SUM(p.amount_minor)::BIGINT AS gross_amount_minor,
    SUM(COALESCE(p.refunded_amount_minor, 0))::BIGINT AS refunded_amount_minor,
    (SUM(p.amount_minor) - SUM(COALESCE(p.refunded_amount_minor, 0)))::BIGINT AS net_amount_minor,
    SUM(p.volume_ml)::BIGINT AS total_volume_ml
FROM payments p
LEFT JOIN refund_cases lp ON lp.tran_id = p.tran_id AND lp.reason = 'LATE_PAYMENT'
WHERE p.paid_at IS NOT NULL OR lp.tran_id IS NOT NULL
GROUP BY p.machine_id, DATE(COALESCE(p.paid_at, lp.created_at)), p.currency;

CREATE UNIQUE INDEX IF NOT EXISTS sales_by_machine_machine_date_currency_idx ON sales_by_machine (machine_id, date, currency);

-- CreateView: machine_status_view
CREATE OR REPLACE VIEW machine_status_view AS
SELECT
    m.id,
    m.name,
    m.location,
    m.enabled,
    m.currency,
    m.online,
    m.last_seen_at,
    m.pending_outcomes,
    m.pending_outcomes_since,
    m.last_stm32_state,
    m.decommissioned_at,
    COUNT(a.id) FILTER (WHERE a.status = 'active')::INTEGER AS active_alerts_count
FROM machines m
LEFT JOIN alerts a ON a.machine_id = m.id
GROUP BY m.id;

-- CreateView: refund_queue_view
-- refund_cases has claimed_by / claimed_until (there is no claimed_at column).
CREATE OR REPLACE VIEW refund_queue_view AS
SELECT
    rc.tran_id,
    p.machine_id,
    p.amount_minor,
    p.currency,
    rc.status AS refund_status,
    rc.reason AS refund_reason,
    rc.suggested_amount_minor,
    rc.refunded_amount_minor,
    rc.claimed_by AS claimant_id,
    rc.claimed_until AS expires_at,
    rc.decision_reason,
    m.online AS machine_online,
    m.pending_outcomes AS machine_pending_outcomes,
    m.last_stm32_state,
    rc.created_at,
    rc.updated_at
FROM refund_cases rc
JOIN payments p ON p.tran_id = rc.tran_id
JOIN machines m ON m.id = p.machine_id;
