-- Temporäre Sprachkanäle heissen neu «[Name] Stübli».
--
-- Die Vorgabe steht in der Preset-Vorlage, nicht im Code - deshalb genügt es
-- nicht, den Standard für neue Server zu ändern: auf einem laufenden Server
-- stehen die Presets längst in der Datenbank, und `seedPresets` fasst
-- bestehende Zeilen bewusst nicht an.
--
-- Geändert wird ausschliesslich, was noch exakt der alten Vorgabe entspricht.
-- Wer seine Vorlage angepasst hat, behält sie: eine Migration, die eine
-- bewusst gesetzte Einstellung überschreibt, ist ein Datenverlust, auch wenn
-- sie nur einen Namen betrifft.
ALTER TABLE "VoicePreset" ALTER COLUMN "nameTemplate" SET DEFAULT '🔊 {username} Stübli';

UPDATE "VoicePreset" SET "nameTemplate" = '🔊 {username} Stübli'
 WHERE "nameTemplate" = '🔊 {username}''s Talk';

UPDATE "VoicePreset" SET "nameTemplate" = '👥 {username} Duo-Stübli'
 WHERE "nameTemplate" = '👥 {username}''s Duo';

UPDATE "VoicePreset" SET "nameTemplate" = '🔒 {username} Stübli'
 WHERE "nameTemplate" = '🔒 {username}''s Talk';

-- Die persönlichen Voreinstellungen der Mitglieder (`VoiceUserPreference`)
-- bleiben unberührt. Wer seinem Talk einen eigenen Namen gegeben hat, behält
-- ihn - die neue Vorgabe gilt nur, wo keiner gesetzt ist.
