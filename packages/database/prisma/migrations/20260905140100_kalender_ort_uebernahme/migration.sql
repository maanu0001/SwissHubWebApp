-- Bestehende Termine auf die zwei verbliebenen Arten übertragen.
--
-- «Vor Ort» und «Hybrid» haben beide eine Adresse - das ist echtes Leben.
-- «Online» hiess bisher: irgendwo im Netz, in aller Regel auf unserem eigenen
-- Discord. Die hinterlegte Adresse (`locationUrl`) bleibt dabei stehen; sie
-- wird weiterhin angezeigt, es geht hier nur um die Einordnung.
--
-- Kein DROP, kein Umbenennen, kein Datenverlust: geändert wird eine
-- Einordnung, und nur dort, wo sie eine der abgelösten war.
UPDATE "CalendarEvent" SET "locationKind" = 'REAL_LIFE'
WHERE "locationKind" IN ('OFFLINE', 'HYBRID');

UPDATE "CalendarEvent" SET "locationKind" = 'DISCORD'
WHERE "locationKind" = 'ONLINE';
