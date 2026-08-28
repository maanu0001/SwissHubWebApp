-- Wann ueber einen gescheiterten Lauf gemeldet wurde (§26).
--
-- Additiv und nullbar: bestehende Laeufe tragen `NULL` und gelten damit als
-- ungemeldet. Damit die Einfuehrung nicht eine Flut alter Meldungen ausloest,
-- meldet der Job ausschliesslich Laeufe der letzten Stunde.
ALTER TABLE "AutomationRun" ADD COLUMN "notifiedAt" TIMESTAMP(3);

CREATE INDEX "AutomationRun_status_notifiedAt_idx"
  ON "AutomationRun"("status", "notifiedAt");
