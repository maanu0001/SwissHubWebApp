-- Ein Beitritt, ein Talk - diesmal so, dass Prisma es sieht.
--
-- Bisher stand die Regel als Teilindex nur in der Migration. Prisma kennt
-- keine Teilindizes in der Schemasprache, und damit war sie fuer
-- `prisma db push` unsichtbar: die Tests liefen ohne sie, und `migrate dev`
-- haette sie als Abweichung wieder entfernt. Eine Sicherung, die nur in
-- Production existiert, ist genau dort keine.
--
-- Stattdessen eine gewoehnliche Eindeutigkeit ueber eine Spalte, die nur
-- gefuellt ist, solange der Talk offen ist - dieselbe Bauart wie
-- `SpielersucheMatch.activeCreatorKey`. Mehrere NULL verletzen eine
-- Eindeutigkeit nicht, geschlossene Talks stehen sich also nicht im Weg.
DROP INDEX IF EXISTS "TemporaryVoiceChannel_offen_je_hub";

ALTER TABLE "TemporaryVoiceChannel" ADD COLUMN "activeOwnerKey" TEXT;

-- Bestehende offene Talks bekommen ihren Schluessel nachtraeglich.
--
-- Nur die aus einem Hub: der alte Teilindex galt ausdruecklich nur fuer
-- `hubId IS NOT NULL`, und daran aendert sich nichts. Ein Kanal der
-- Spielersuche hat keinen Hub - dort begrenzt die Spielersuche selbst, wie
-- viele Suchen jemand gleichzeitig laufen lassen darf.
UPDATE "TemporaryVoiceChannel"
   SET "activeOwnerKey" = "ownerDiscordId"
 WHERE "closedAt" IS NULL
   AND "hubId" IS NOT NULL;

CREATE UNIQUE INDEX "TemporaryVoiceChannel_guildId_hubId_activeOwnerKey_key"
  ON "TemporaryVoiceChannel" ("guildId", "hubId", "activeOwnerKey");
