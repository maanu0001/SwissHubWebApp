-- Persönliche Levelkarte.
--
-- Eine nullbare Spalte am bestehenden Profil - kein eigenes Modell: es gibt
-- höchstens eine Karte je Person, und eine eigene Tabelle dafür wäre eine
-- Zeile mit einem Fremdschlüssel und sonst nichts.
--
-- Gespeichert wird nur der Dateiname. Die Datei liegt im Upload-Verzeichnis
-- ausserhalb des statisch bedienten Bereichs; ein Pfad in der Datenbank wäre
-- eine Einladung, ihn zu manipulieren.

-- AlterTable
ALTER TABLE "LevelProfile" ADD COLUMN     "customCardPath" TEXT;

