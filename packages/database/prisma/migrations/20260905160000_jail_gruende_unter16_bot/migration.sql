-- Zwei Gründe nachtragen: «Unter 16» und «Bot».
--
-- Die Vorgabeliste in der Anwendung greift nur, solange niemand die
-- Einstellungen gespeichert hat. Sobald das einmal geschehen ist, steht die
-- damalige Liste in der Datenbank und ändert sich nie wieder von selbst -
-- eine neue Vorgabe erreicht diesen Server also nicht.
--
-- Deshalb hier, und nur für den Fall, dass der Grund wirklich fehlt:
-- `POSITION(...) = 0` prüft es je Grund einzeln, also fügt ein zweiter Lauf
-- nichts ein. Die Reihenfolge und alles bereits Eingetragene bleiben, wie sie
-- sind; angehängt wird am Ende.
--
-- Ausschliesslich additiv: kein Grund wird entfernt, keine Einstellung
-- überschrieben, und wer die Liste bewusst geleert hat, bekommt genau diese
-- zwei Zeilen und nicht die ganze Vorgabe zurück.
UPDATE "ModuleState"
   SET settings = jsonb_set(
         settings::jsonb,
         '{reasonPresets}',
         to_jsonb(
           CASE WHEN length(trim(settings->>'reasonPresets')) = 0
                THEN 'Unter 16'
                ELSE (settings->>'reasonPresets') || E'\nUnter 16'
           END
         )
       )
 WHERE "moduleId" = 'jail'
   AND settings ? 'reasonPresets'
   AND POSITION('Unter 16' IN (settings->>'reasonPresets')) = 0;

UPDATE "ModuleState"
   SET settings = jsonb_set(
         settings::jsonb,
         '{reasonPresets}',
         to_jsonb(
           CASE WHEN length(trim(settings->>'reasonPresets')) = 0
                THEN 'Bot'
                ELSE (settings->>'reasonPresets') || E'\nBot'
           END
         )
       )
 WHERE "moduleId" = 'jail'
   AND settings ? 'reasonPresets'
   -- Auf eine ganze Zeile geprüft, nicht auf das Wort: «Bot-Werbung» oder
   -- «Botting» enthalten «Bot», sind aber ein anderer Grund.
   AND (settings->>'reasonPresets') !~ '(^|\n)[[:space:]]*Bot[[:space:]]*($|\n)';
