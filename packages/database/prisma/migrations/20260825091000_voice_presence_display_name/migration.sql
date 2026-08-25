-- Anzeigename in der Anwesenheitstabelle.
--
-- Die WebApp ist ein eigener Prozess und sieht die Voice-Zustaende nicht. Ohne
-- den Namen muesste sie fuer jede Mitgliederliste Discord fragen - einen
-- Aufruf je Person je Seitenaufbau. Genau dafuer fuehrt diese Tabelle schon
-- `channelName` mit; der Anzeigename ist derselbe Gedanke.
--
-- Rein additiv und nullable: bestehende Zeilen bleiben, der Bot fuellt sie
-- beim naechsten Voice-Ereignis.
ALTER TABLE "VoicePresence" ADD COLUMN "displayName" TEXT;
