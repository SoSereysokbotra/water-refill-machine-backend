-- A decommissioned (retired) machine is disabled permanently and cannot be re-enabled (Phase 4).
ALTER TABLE "machines" ADD COLUMN "decommissioned_at" TIMESTAMP(3);
