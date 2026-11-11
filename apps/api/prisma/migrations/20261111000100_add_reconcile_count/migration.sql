-- Number of reconcile probes done after a payment ended unpaid (Plan B4.8).
-- Kept separate from aba_check_count, which also counts polls while the QR was shown.
ALTER TABLE "payments" ADD COLUMN "reconcile_count" INTEGER NOT NULL DEFAULT 0;
