-- AlterTable
ALTER TABLE "machines" ADD COLUMN     "pending_outcomes_since" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "alerts" (
    "id" TEXT NOT NULL,
    "machine_id" TEXT,
    "type" TEXT NOT NULL,
    "severity" "AlertSeverity" NOT NULL,
    "message" TEXT NOT NULL,
    "status" "AlertStatus" NOT NULL DEFAULT 'active',
    "resolved_by" TEXT,
    "resolved_at" TIMESTAMP(3),
    "acknowledged_by" TEXT,
    "acknowledged_at" TIMESTAMP(3),
    "dedupe_key" TEXT NOT NULL,
    "count" INTEGER NOT NULL DEFAULT 1,
    "last_seen_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "alerts_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "alerts_status_dedupe_key_idx" ON "alerts"("status", "dedupe_key");

-- CreateIndex
CREATE INDEX "alerts_machine_id_created_at_idx" ON "alerts"("machine_id", "created_at");

-- AddForeignKey
ALTER TABLE "alerts" ADD CONSTRAINT "alerts_machine_id_fkey" FOREIGN KEY ("machine_id") REFERENCES "machines"("id") ON DELETE SET NULL ON UPDATE CASCADE;
