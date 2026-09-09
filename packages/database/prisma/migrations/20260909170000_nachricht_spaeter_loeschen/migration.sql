-- Eine Job-Art fuer das spaetere Loeschen einer Nachricht.
--
-- Rein additiv: ein neuer Enum-Wert. Bestehende Jobs behalten ihre Art.
ALTER TYPE "AutomationJobKind" ADD VALUE IF NOT EXISTS 'DELETE_MESSAGE';
