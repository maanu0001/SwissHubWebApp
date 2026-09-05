-- Ticket-Kanaele verschwinden nach dem Schliessen.
--
-- Die Einstellung `closeBehaviour` entscheidet, wie lange der Kanal nach dem
-- Abschluss stehen bleibt. Ihre Vorgabe im Code ist `DELETE_IMMEDIATELY` -
-- fuenf Sekunden. Sobald aber irgendwann einmal die Moduleinstellungen
-- gespeichert wurden, steht dort der damals gewaehlte Wert, und der bleibt,
-- bis ihn jemand aendert.
--
-- Steht dort `KEEP_24H`, `KEEP_7D` oder `KEEP_FOREVER`, dann wird beim
-- Schliessen gar keine Loeschung eingeplant. Der Kanal bleibt - nicht als
-- Fehler, sondern als Folge der Einstellung. Von aussen sieht beides gleich
-- aus: der Kanal ist noch da.
--
-- Diese Migration setzt die Einstellung auf das, was sie sein soll. Sie
-- aendert nur diesen einen Schluessel und laesst alles andere unberuehrt;
-- wer den Kanal laenger behalten will, stellt es unter Module -> Tickets
-- jederzeit wieder um.
UPDATE "ModuleState"
SET settings = jsonb_set(settings::jsonb, '{closeBehaviour}', '"DELETE_IMMEDIATELY"'),
    "updatedAt" = now()
WHERE "moduleId" = 'tickets'
  AND coalesce(settings->>'closeBehaviour', 'DELETE_IMMEDIATELY') <> 'DELETE_IMMEDIATELY';
