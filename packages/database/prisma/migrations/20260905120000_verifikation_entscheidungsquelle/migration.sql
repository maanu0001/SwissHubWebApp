-- Wo die Entscheidung eines Verifikationsvorgangs gefallen ist.
--
-- Additiv und nullbar: bestehende Vorgänge wissen es nicht, und sie sollen
-- deswegen nicht angefasst werden. Für die Entscheidung selbst ist die Spalte
-- ohne Belang - beide Wege laufen durch denselben Dienst.
ALTER TABLE "VerificationRequest" ADD COLUMN IF NOT EXISTS "decidedSource" TEXT;
