-- Springen innerhalb eines Titels.
--
-- Die Fortschrittsanzeige war eine Anzeige und sonst nichts: sie sah aus wie
-- eine Leiste, auf die man klicken kann, und tat es nicht. Wer ein Intro
-- überspringen wollte, musste den Titel überspringen.
--
-- Rein additiv: ein neuer Wert im Befehlstyp. Alte Befehle bleiben, was sie
-- sind. Eine Laufzeit, die den Wert noch nicht kennt, meldet den Befehl als
-- fehlgeschlagen zurück - sie fällt nicht aus.
ALTER TYPE "MusicCommandKind" ADD VALUE IF NOT EXISTS 'SEEK';
