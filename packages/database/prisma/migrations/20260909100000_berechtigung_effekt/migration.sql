-- Ausdrueckliche Ausnahmen zu einer Erlaubnis.
--
-- Rein additiv: der neue Typ und die neue Spalte kommen dazu, bestehende
-- Zeilen bekommen den Vorgabewert ALLOW und behalten damit genau die
-- Bedeutung, die sie bisher hatten.
CREATE TYPE "PermissionEffect" AS ENUM ('ALLOW', 'DENY');

ALTER TABLE "RolePermission"
  ADD COLUMN "effect" "PermissionEffect" NOT NULL DEFAULT 'ALLOW';

CREATE INDEX "RolePermission_discordRoleId_effect_idx"
  ON "RolePermission" ("discordRoleId", "effect");
