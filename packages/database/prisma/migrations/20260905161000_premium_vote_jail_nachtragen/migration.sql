-- Premium kann keinen Vote Jail starten - die eigentliche Ursache.
--
-- Die Vorlage «Premium» in der Anwendung hat die beiden nötigen Rechte
-- bekommen. Das ändert für einen laufenden Server aber nichts: eine Vorlage
-- wird genau einmal angewendet, nämlich wenn jemand im Dashboard darauf
-- klickt. Danach stehen die Rechte als Zeilen in `RolePermission`, und die
-- sind ab dann die Wahrheit. Eine spätere Änderung an der Vorlage erreicht
-- sie nie.
--
-- Der frühere Fix war deshalb wirkungslos: er hat den Bauplan geändert, nicht
-- das Gebaute.
--
-- Nachgetragen wird hier - eng umgrenzt und ausschliesslich additiv:
--
--   * Nur Rollen ohne Moderationsstufe. Damit ist ausgeschlossen, dass eine
--     Team-Rolle etwas bekommt, und die beiden Rechte selbst sind
--     ausdrücklich keine Moderationsbefugnis: eine Abstimmung führt nur dann
--     zu einem Jail, wenn genug Stimmen zusammenkommen, und die Schutzregeln
--     für das Ziel gelten unverändert.
--   * Nur Rollen, die erkennbar aus der Premium-Vorlage stammen: sie tragen
--     deren beide Erkennungsmerkmale, eine eigene Musik-Session und die
--     eigene Levelkarte. Beides gibt es in keiner anderen Vorlage.
--   * `ON CONFLICT DO NOTHING` - ein zweiter Lauf schreibt nichts.
--
-- Kein DELETE, kein UPDATE: was eine Rolle sonst hat, bleibt unangetastet.
INSERT INTO "RolePermission" ("id", "discordRoleId", "permission", "createdAt", "createdBy")
SELECT
  gen_random_uuid()::text,
  r."discordRoleId",
  benoetigt.permission,
  now(),
  'migration:premium-vote-jail'
FROM "ManagedRole" r
CROSS JOIN (VALUES ('jail.module.view'), ('jail.vote.start')) AS benoetigt(permission)
WHERE r."moderationLevel" = 0
  AND EXISTS (
    SELECT 1 FROM "RolePermission" p
     WHERE p."discordRoleId" = r."discordRoleId" AND p.permission = 'music.session.start'
  )
  AND EXISTS (
    SELECT 1 FROM "RolePermission" p
     WHERE p."discordRoleId" = r."discordRoleId" AND p.permission = 'level.card.custom'
  )
ON CONFLICT ("discordRoleId", "permission") DO NOTHING;
