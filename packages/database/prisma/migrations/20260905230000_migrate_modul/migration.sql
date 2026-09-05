-- Das Migrate-Modul: Uebertragung der Konfiguration auf eine andere Guild.
--
-- Ein Lauf steht in der Datenbank und nicht im Browser. Eine Uebertragung
-- zieht sich: Rollen zuordnen, Kanaele zuordnen, Probelauf ansehen, jemanden
-- fragen, am naechsten Tag anwenden. Wer das an einen Reiter bindet, verliert
-- beim ersten Neuladen den Ueberblick darueber, was schon geschehen ist -
-- und beim Neustart der Anwendung ohnehin.
--
-- Was hier NICHT steht, ist genauso wichtig: keine Zugangsdaten, keine
-- Tokens, kein Schluesselmaterial. Das Paket traegt Konfiguration und
-- Verweise auf Rollen und Kanaele, die beim Anwenden uebersetzt werden.
--
-- Rein additiv: ein neuer Typ und eine neue Tabelle. Nichts Bestehendes wird
-- angefasst.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'MigrationRunStatus') THEN
    CREATE TYPE "MigrationRunStatus" AS ENUM (
      'DRAFT',
      'VALIDATING',
      'READY',
      'RUNNING',
      'PARTIAL',
      'COMPLETED',
      'FAILED',
      'ROLLED_BACK'
    );
  END IF;
END
$$;

CREATE TABLE IF NOT EXISTS "MigrationRun" (
  "id"                 TEXT NOT NULL,
  "sourceGuildId"      TEXT NOT NULL,
  "targetGuildId"      TEXT NOT NULL,
  "status"             "MigrationRunStatus" NOT NULL DEFAULT 'DRAFT',
  "phase"              TEXT,
  "package"            JSONB NOT NULL,
  "mappings"           JSONB NOT NULL DEFAULT '{}',
  "plan"               JSONB,
  "snapshot"           JSONB,
  "report"             JSONB,
  "error"              TEXT,
  "createdByDiscordId" TEXT NOT NULL,
  "createdByUsername"  TEXT NOT NULL,
  "createdAt"          TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"          TIMESTAMP(3) NOT NULL,
  "startedAt"          TIMESTAMP(3),
  "finishedAt"         TIMESTAMP(3),

  CONSTRAINT "MigrationRun_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "MigrationRun_sourceGuildId_createdAt_idx"
  ON "MigrationRun" ("sourceGuildId", "createdAt");
CREATE INDEX IF NOT EXISTS "MigrationRun_status_createdAt_idx"
  ON "MigrationRun" ("status", "createdAt");
