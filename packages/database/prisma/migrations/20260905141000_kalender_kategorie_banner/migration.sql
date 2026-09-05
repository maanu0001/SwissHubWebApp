-- Ein Vorgabe-Banner je Kategorie.
--
-- Wiederkehrende Reihen - GameNight, Watchparty, Turnierabend - haben ihr
-- eigenes Bild, und es war jedes Mal von Hand einzutragen. Wer es vergass,
-- bekam eine nackte Ankündigung; wer es eintrug, tat es zum zwanzigsten Mal.
--
-- Additiv und nullbar: ohne Eintrag ändert sich nichts, und das Banner am
-- Termin selbst hat weiterhin Vorrang.
ALTER TABLE "CalendarCategory" ADD COLUMN IF NOT EXISTS "defaultBannerUrl" TEXT;
