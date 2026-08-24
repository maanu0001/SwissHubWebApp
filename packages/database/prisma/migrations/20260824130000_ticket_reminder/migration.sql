-- Wann zuletzt an eine Antwort erinnert wurde.
--
-- Rein additiv und nullbar: bestehende Tickets tragen NULL und werden beim
-- ersten faelligen Durchgang genau einmal erinnert. Ohne diese Spalte
-- erinnerte jeder Durchgang erneut, solange ein Ticket wartet - aus einer
-- Erinnerung wuerde eine stuendliche Mahnung.
ALTER TABLE "Ticket" ADD COLUMN "reminderSentAt" TIMESTAMP(3);
