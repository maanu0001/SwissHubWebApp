-- Der Musik-Controller ist ab jetzt der Systembot.
--
-- Bisher konnte ein Controller als eigene Discord-Anwendung angelegt werden.
-- Diese Rolle uebernimmt der Systembot: er benutzt dasselbe Token wie die
-- SwissHub-Anwendung, und niemand muss dafuer eine zweite Anwendung anlegen.
--
-- Bereits angelegte Controller werden zu Workern. Sie behalten ihr Token,
-- ihren Namen und ihren Zustand und spielen weiterhin Musik - sie sind nur
-- nicht mehr der Controller. Sie stattdessen stehenzulassen hiesse, dass sie
-- von der Laufzeit nicht mehr gelesen werden und stumm im Dashboard stuenden.
--
-- Ausdruecklich additiv: kein DROP, kein TRUNCATE, keine geloeschte Zeile.
-- Der Enum-Wert MUSIC_CONTROLLER bleibt bestehen, damit diese Migration auch
-- auf einer Datenbank laeuft, die ihn noch in einer Zeile traegt.
UPDATE "IntegrationBot"
   SET "kind" = 'MUSIC_WORKER',
       "updatedAt" = now()
 WHERE "kind" = 'MUSIC_CONTROLLER';
