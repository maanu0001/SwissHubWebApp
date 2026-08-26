-- Geplantes Ende einer befristeten Moderationsmassnahme.
--
-- Rein additiv: eine nullbare Spalte und ein Index. Bestehende Zeilen
-- bekommen NULL - das ist richtig so, denn für sie gab es nie ein geplantes
-- Ende. Rückwirkend ein Datum zu erfinden wäre eine Behauptung über die
-- Vergangenheit, die niemand belegen kann.

-- AlterTable
ALTER TABLE "ModerationAction" ADD COLUMN "expiresAt" TIMESTAMP(3);

-- CreateIndex
CREATE INDEX "ModerationAction_type_expiresAt_idx" ON "ModerationAction"("type", "expiresAt");
