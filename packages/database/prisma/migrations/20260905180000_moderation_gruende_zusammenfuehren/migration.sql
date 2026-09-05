-- Die Gründe stehen ab jetzt bei der Moderation, nicht mehr beim Jail.
--
-- Jail ist eine Moderationsmassnahme geworden, und zwei Listen für dieselbe
-- Frage waren eine zu viel: die eine gab es beim Jailen, die andere nirgends -
-- Bann, Kick und Timeout verlangten, den Grund jedes Mal neu zu tippen.
--
-- Was die Serverleitung im Jail-Modul selbst eingetragen hat, wandert hierher.
-- Übernommen wird nur, was nicht ohnehin Vorgabe ist: die neun
-- Standardgründe stehen im Code und brauchen keinen Eintrag. Alles, was
-- darüber hinausgeht, ist eine bewusste Ergänzung dieses Servers und darf
-- nicht verlorengehen.
--
-- Rein additiv und wiederholbar: `jsonb_set` schreibt nur, wenn nach dem
-- Aussortieren etwas übrig bleibt, und der zweite Lauf findet dieselben Zeilen
-- bereits vor - `NOT LIKE` je Zeile verhindert Duplikate. Die Jail-Einstellung
-- selbst bleibt unangetastet; sie wird nur nicht mehr gelesen.
WITH eigene AS (
  SELECT
    string_agg(zeile, E'\n' ORDER BY nr) AS text
  FROM (
    SELECT
      trim(zeile) AS zeile,
      nr
    FROM "ModuleState",
         unnest(string_to_array(settings->>'reasonPresets', E'\n')) WITH ORDINALITY AS z(zeile, nr)
    WHERE "moduleId" = 'jail'
      AND settings ? 'reasonPresets'
      AND length(trim(zeile)) >= 3
      AND lower(trim(zeile)) NOT IN (
        'spam', 'beleidigung', 'provokation', 'regelverstoss',
        'unangemessenes verhalten', 'voice-verhalten', 'werbung',
        'unter 16', 'bot'
      )
  ) gefiltert
)
INSERT INTO "ModuleState" ("moduleId", enabled, settings, "updatedAt")
SELECT 'moderation', true, jsonb_build_object('reasonTemplates', eigene.text), now()
FROM eigene
WHERE eigene.text IS NOT NULL AND length(eigene.text) > 0
ON CONFLICT ("moduleId") DO UPDATE
  SET settings = jsonb_set(
        "ModuleState".settings::jsonb,
        '{reasonTemplates}',
        to_jsonb(
          CASE
            WHEN coalesce(length(trim("ModuleState".settings->>'reasonTemplates')), 0) = 0
              THEN excluded.settings->>'reasonTemplates'
            ELSE ("ModuleState".settings->>'reasonTemplates') || E'\n' || (excluded.settings->>'reasonTemplates')
          END
        )
      ),
      "updatedAt" = now()
  WHERE coalesce("ModuleState".settings->>'reasonTemplates', '') NOT LIKE
        '%' || (excluded.settings->>'reasonTemplates') || '%';
