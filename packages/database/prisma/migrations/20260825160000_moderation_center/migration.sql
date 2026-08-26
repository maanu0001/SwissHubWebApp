-- Moderation Center: die Massnahmen, die Discord selbst kennt.
--
-- Rein additiv - nur neue Werte im bestehenden Enum. Bestehende Zeilen und
-- die drei Jail-Werte bleiben unberührt; die Jail-Historie liegt weiterhin in
-- derselben Tabelle und erscheint künftig zusammen mit Bann, Kick und Timeout
-- in einer Akte.
--
-- `ALTER TYPE ... ADD VALUE` darf ab PostgreSQL 12 in einer Transaktion
-- laufen, solange der neue Wert darin nicht auch verwendet wird. Genau das ist
-- hier der Fall: es wird nur hinzugefügt.

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "ModerationActionType" ADD VALUE 'BAN';
ALTER TYPE "ModerationActionType" ADD VALUE 'UNBAN';
ALTER TYPE "ModerationActionType" ADD VALUE 'KICK';
ALTER TYPE "ModerationActionType" ADD VALUE 'TIMEOUT';
ALTER TYPE "ModerationActionType" ADD VALUE 'TIMEOUT_REMOVE';
ALTER TYPE "ModerationActionType" ADD VALUE 'NOTE';

