-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "PaymentStatus" AS ENUM ('PENDING', 'PAID', 'DISPENSED', 'DISPENSE_UNKNOWN', 'EXPIRED', 'CANCELLED', 'FAILED', 'REFUND_REVIEW', 'REFUNDED', 'REFUND_REJECTED');

-- CreateEnum
CREATE TYPE "Currency" AS ENUM ('KHR', 'USD');

-- CreateEnum
CREATE TYPE "DispenseResult" AS ENUM ('ok', 'partial', 'error');

-- CreateEnum
CREATE TYPE "RefundReason" AS ENUM ('LATE_PAYMENT', 'DISPENSE_FAILED', 'DISPENSE_PARTIAL', 'DISPENSE_UNKNOWN');

-- CreateEnum
CREATE TYPE "RefundStatus" AS ENUM ('open', 'claimed', 'refunded', 'rejected', 'auto_failed');

-- CreateEnum
CREATE TYPE "AlertSeverity" AS ENUM ('info', 'warning', 'critical');

-- CreateEnum
CREATE TYPE "AlertStatus" AS ENUM ('active', 'acknowledged', 'resolved');

-- CreateTable
CREATE TABLE "machines" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "location" TEXT,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "currency" "Currency" NOT NULL DEFAULT 'USD',
    "firmware" TEXT,
    "mqtt_username" TEXT NOT NULL,
    "last_seen_at" TIMESTAMP(3),
    "online" BOOLEAN NOT NULL DEFAULT false,
    "last_stm32_state" TEXT,
    "pending_outcomes" INTEGER NOT NULL DEFAULT 0,
    "version" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "machines_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "machine_prices" (
    "machine_id" TEXT NOT NULL,
    "volume_ml" INTEGER NOT NULL,
    "amount_minor" INTEGER NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "machine_prices_pkey" PRIMARY KEY ("machine_id","volume_ml")
);

-- CreateTable
CREATE TABLE "payments" (
    "tran_id" TEXT NOT NULL,
    "machine_id" TEXT NOT NULL,
    "request_id" TEXT NOT NULL,
    "volume_ml" INTEGER NOT NULL,
    "amount_minor" INTEGER NOT NULL,
    "currency" "Currency" NOT NULL,
    "status" "PaymentStatus" NOT NULL,
    "qr_string" TEXT NOT NULL,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "paid_at" TIMESTAMP(3),
    "aba_apv" TEXT,
    "next_aba_check_at" TIMESTAMP(3),
    "aba_check_count" INTEGER NOT NULL DEFAULT 0,
    "last_aba_check_at" TIMESTAMP(3),
    "closed_at" TIMESTAMP(3),
    "refunded_amount_minor" INTEGER,
    "refunded_at" TIMESTAMP(3),
    "version" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "payments_pkey" PRIMARY KEY ("tran_id")
);

-- CreateTable
CREATE TABLE "payment_events" (
    "id" TEXT NOT NULL,
    "tran_id" TEXT NOT NULL,
    "from_status" "PaymentStatus",
    "to_status" "PaymentStatus" NOT NULL,
    "reason" TEXT,
    "actor_id" TEXT,
    "at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "payment_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "dispenses" (
    "tran_id" TEXT NOT NULL,
    "machine_id" TEXT NOT NULL,
    "result" "DispenseResult" NOT NULL,
    "flow_ml" INTEGER NOT NULL,
    "weight_g" INTEGER NOT NULL,
    "diff_percent" DECIMAL(5,2) NOT NULL,
    "fault" TEXT,
    "occurred_at" TIMESTAMP(3) NOT NULL,
    "received_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "clock_skew" BOOLEAN NOT NULL DEFAULT false,
    "late" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "dispenses_pkey" PRIMARY KEY ("tran_id")
);

-- CreateTable
CREATE TABLE "dispense_rejections" (
    "id" TEXT NOT NULL,
    "machine_id" TEXT NOT NULL,
    "tran_id" TEXT,
    "code" TEXT NOT NULL,
    "raw" JSONB NOT NULL,
    "received_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "dispense_rejections_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "refund_cases" (
    "tran_id" TEXT NOT NULL,
    "reason" "RefundReason" NOT NULL,
    "suggested_amount_minor" INTEGER NOT NULL,
    "refunded_amount_minor" INTEGER,
    "status" "RefundStatus" NOT NULL DEFAULT 'open',
    "claimed_by" TEXT,
    "claimed_until" TIMESTAMP(3),
    "method" TEXT,
    "reference" TEXT,
    "decided_by" TEXT,
    "decided_at" TIMESTAMP(3),
    "decision_reason" TEXT,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "last_error" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "refund_cases_pkey" PRIMARY KEY ("tran_id")
);

-- CreateTable
CREATE TABLE "outbox" (
    "id" TEXT NOT NULL,
    "aggregate_type" TEXT NOT NULL,
    "aggregate_id" TEXT NOT NULL,
    "event_type" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "occurred_at" TIMESTAMP(3) NOT NULL,
    "dispatched_at" TIMESTAMP(3),
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "last_error" TEXT,
    "dead_at" TIMESTAMP(3),

    CONSTRAINT "outbox_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "inbox" (
    "message_id" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "received_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "inbox_pkey" PRIMARY KEY ("message_id")
);

-- CreateTable
CREATE TABLE "heartbeats" (
    "id" BIGSERIAL NOT NULL,
    "machine_id" TEXT NOT NULL,
    "data" JSONB NOT NULL,
    "at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "heartbeats_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "machines_mqtt_username_key" ON "machines"("mqtt_username");

-- CreateIndex
CREATE INDEX "payments_status_next_aba_check_at_idx" ON "payments"("status", "next_aba_check_at");

-- CreateIndex
CREATE INDEX "payments_status_paid_at_idx" ON "payments"("status", "paid_at");

-- CreateIndex
CREATE INDEX "payments_machine_id_created_at_idx" ON "payments"("machine_id", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "payments_machine_id_request_id_key" ON "payments"("machine_id", "request_id");

-- CreateIndex
CREATE INDEX "payment_events_tran_id_idx" ON "payment_events"("tran_id");

-- CreateIndex
CREATE INDEX "dispenses_machine_id_occurred_at_idx" ON "dispenses"("machine_id", "occurred_at");

-- CreateIndex
CREATE INDEX "dispense_rejections_machine_id_received_at_idx" ON "dispense_rejections"("machine_id", "received_at");

-- CreateIndex
CREATE UNIQUE INDEX "refund_cases_reference_key" ON "refund_cases"("reference");

-- CreateIndex
CREATE INDEX "refund_cases_status_created_at_idx" ON "refund_cases"("status", "created_at");

-- CreateIndex
CREATE INDEX "outbox_occurred_at_idx" ON "outbox"("occurred_at");

-- CreateIndex
CREATE INDEX "inbox_received_at_idx" ON "inbox"("received_at");

-- CreateIndex
CREATE INDEX "heartbeats_machine_id_at_idx" ON "heartbeats"("machine_id", "at");

-- CreateIndex
CREATE INDEX "heartbeats_at_idx" ON "heartbeats"("at");

-- AddForeignKey
ALTER TABLE "machine_prices" ADD CONSTRAINT "machine_prices_machine_id_fkey" FOREIGN KEY ("machine_id") REFERENCES "machines"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payments" ADD CONSTRAINT "payments_machine_id_fkey" FOREIGN KEY ("machine_id") REFERENCES "machines"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payment_events" ADD CONSTRAINT "payment_events_tran_id_fkey" FOREIGN KEY ("tran_id") REFERENCES "payments"("tran_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "dispenses" ADD CONSTRAINT "dispenses_tran_id_fkey" FOREIGN KEY ("tran_id") REFERENCES "payments"("tran_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "refund_cases" ADD CONSTRAINT "refund_cases_tran_id_fkey" FOREIGN KEY ("tran_id") REFERENCES "payments"("tran_id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- ---------------------------------------------------------------------------
-- Business rules Prisma cannot express in schema.prisma (Plan §C6).
-- These used to be created by seed.ts; they belong in the migration so every
-- environment (CI, staging, production) gets them with `prisma migrate deploy`.
-- ---------------------------------------------------------------------------

-- Invariant: a machine has at most one open payment (PENDING or PAID).
CREATE UNIQUE INDEX "one_open_payment_per_machine" ON "payments"("machine_id") WHERE "status" IN ('PENDING', 'PAID');

-- Only the fixed volume tiers exist (500 / 750 / 1000 mL).
ALTER TABLE "machine_prices" ADD CONSTRAINT "tier_check" CHECK ("volume_ml" IN (500, 750, 1000));
