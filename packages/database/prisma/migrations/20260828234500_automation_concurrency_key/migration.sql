-- Der aufgeloeste Gleichzeitigkeitsschluessel eines Laufs (§18).
--
-- Additiv: eine neue, nullbare Spalte und ein Index. Bestehende Laeufe
-- behalten `NULL` und zaehlen damit gegen die ganze Automation - genau das
-- Verhalten, das vor dieser Migration galt.
ALTER TABLE "AutomationRun" ADD COLUMN "concurrencyKey" TEXT;

CREATE INDEX "AutomationRun_automationId_status_concurrencyKey_idx"
  ON "AutomationRun"("automationId", "status", "concurrencyKey");

-- Kurze Notiz je Fassung, damit die Fassungsliste lesbar ist.
ALTER TABLE "AutomationVersion" ADD COLUMN "note" TEXT;
