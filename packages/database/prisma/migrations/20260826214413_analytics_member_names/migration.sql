-- Name und Avatar in der Mitgliederakte der Statistik.
--
-- Rein additiv: drei nullbare Spalten. Bestehende Zeilen bekommen NULL und
-- füllen sich bei der nächsten Äusserung der jeweiligen Person - rückwirkend
-- einen Namen zu erfinden ginge nicht, denn wir haben ihn damals nicht
-- gesehen.

-- AlterTable
ALTER TABLE "AnalyticsMemberProfile" ADD COLUMN     "avatarHash" TEXT,
ADD COLUMN     "displayName" TEXT,
ADD COLUMN     "username" TEXT;
