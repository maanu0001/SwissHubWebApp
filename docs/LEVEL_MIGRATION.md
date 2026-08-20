# Übernahme des alten Level-/XP-Bots

Dieses Dokument beschreibt die einmalige Ablösung des früheren SwissHub
Level-Bots (`bot.py` mit `levels.db`) durch das Level-Modul dieser Anwendung.

Nach der Übernahme gibt es **eine** XP-Engine. Nachrichten, Zeit im Voice, die
XP-Spiele, die Slash Commands und das Dashboard buchen alle über dieselben
Funktionen in dieselbe PostgreSQL-Datenbank. Es läuft kein zweiter Bot mehr mit.

---

## 1. Vor dem Start

### Den alten Bot stoppen

**Der alte Bot muss gestoppt sein, bevor der Import bestätigt wird.** Laufen
beide gleichzeitig, vergeben zwei Bots XP für dieselbe Nachricht, ziehen zweimal
Inaktivitäts-Abzug ab und registrieren dieselben Slash Commands - welcher davon
gewinnt, ist nicht vorhersehbar. Die übernommenen Stände wären sofort wieder
falsch.

Der Assistent verlangt deshalb eine ausdrückliche Bestätigung. Ohne sie wird
nichts übernommen.

### Was aus der `.env` wird

Der alte Bot las seine gesamte Konfiguration aus Umgebungsvariablen; eine
Änderung brauchte eine neue `.env` und einen Neustart. Diese Werte liegen jetzt
in der Laufzeitkonfiguration und wirken sofort:

| Alter Wert                                  | Neue Einstellung                                                  |
| ------------------------------------------- | ----------------------------------------------------------------- |
| `MAIN_CHAT_ID`                              | Level-System → XP-Regeln → Level-Up-Channel                       |
| `LEVEL_LOG_CHANNEL_ID`                      | XP-Protokoll                                                      |
| `DECAY_LOG_CHANNEL_ID`                      | Inaktivitäts-Protokoll                                            |
| `NO_XP_ROLE_ID`                             | Rolle ohne XP                                                     |
| `PREMIUM_ROLE_ID`                           | Premium-Rolle                                                     |
| `XP_PER_MESSAGE`                            | XP pro Nachricht                                                  |
| `MESSAGE_XP_COOLDOWN_SECONDS`               | Cooldown                                                          |
| `PREMIUM_MESSAGE_XP_COOLDOWN_SECONDS`       | Cooldown mit Premium-Rolle                                        |
| `PREMIUM_XP_MULTIPLIER`                     | Premium-Multiplikator                                             |
| `XP_PER_VOICE_MINUTE`                       | Level-System → Voice XP → XP pro Minute                           |
| `VOICE_ACTIVITY_TOUCH_INTERVAL_SECONDS`     | Aktivität auffrischen alle                                        |
| `SPECIAL_VOICE_CHANNEL_IDS` / `_MULTIPLIER` | Kanäle mit Sonder-Multiplikator                                   |
| `STAGE_VOICE_CHANNEL_IDS` / `_MULTIPLIER`   | Bühnen-Kanäle                                                     |
| `DOT_GRACE_DAYS`                            | Level-System → Inaktivität → Schonfrist                           |
| `DOT_DECAY_DAY1_4` / `DOT_DECAY_DAY5_24`    | Abzug Tag 1 bis 4 / ab Tag 5                                      |
| `DOT_SWEEP_INTERVAL_SECONDS`                | Prüfintervall                                                     |
| `MAX_LEVEL_TOTAL_XP`                        | XP für das Höchstlevel                                            |
| `MILESTONE_ROLES="5:ID,10:ID"`              | Level-System → Level & Rollen                                     |
| `BANNER_URL` / `BANNER_PATH`                | Hintergrund der Levelkarte                                        |
| `config.xp_boost` (SQLite)                  | Globaler XP-Boost                                                 |
| `config.announce_levels` (SQLite)           | Nur diese Level ankündigen                                        |
| `no_xp_channels` (SQLite)                   | Channels ohne XP                                                  |
| `guild_config.*` (SQLite)                   | Voice XP → Stummschaltung und Alleinsein                          |
| `LEVEL_MANAGER_ROLE_ID`                     | _entfällt_ - ersetzt durch `level.*`-Berechtigungen               |
| `LEVEL5_ROLE_ID`                            | _entfällt_ - ersetzt durch `level.games.play.basic`               |
| `LEVEL10_ROLE_ID`                           | _entfällt_ - ersetzt durch `level.games.play.advanced`            |
| `ALLOWED_ROLES` / `ALLOWED_ROLES2`          | _entfällt_ - ersetzt durch `level.*`-Berechtigungen               |
| `BOT_TOKEN`                                 | _entfällt_ - der Bot nutzt die zentrale Konfiguration             |
| `GUILD_ID`                                  | _entfällt_ - der Server wird im Einrichtungsassistenten verbunden |

Die vier festen Rollen-IDs haben bewusst keine Entsprechung. Wer was darf, wird
unter **Server → Berechtigungen** pro Rolle vergeben - dieselbe Zuordnung gilt
für Dashboard und Slash Commands.

### Berechtigungen vergeben

| Berechtigung                 | Bedeutung                                            |
| ---------------------------- | ---------------------------------------------------- |
| `level.view`                 | Übersicht des Level-Systems                          |
| `level.members.view`         | XP-Stände einzelner Mitglieder, `/check_user`        |
| `level.members.manage`       | XP vergeben und entziehen (`/give_xp`, `/rem_xp`)    |
| `level.leaderboard.view`     | Rangliste im Dashboard                               |
| `level.games.view`           | Laufende und beendete Partien ansehen                |
| `level.games.play.basic`     | `/xp_battle`, `/xp_ssp` - früher `LEVEL5_ROLE_ID`    |
| `level.games.play.advanced`  | `/xp_ttt`, `/xp_4gewinnt` - früher `LEVEL10_ROLE_ID` |
| `level.games.manage`         | Partien abbrechen und Einsätze zurückgeben           |
| `level.roles.view/manage`    | Level-Rollen ansehen / verwalten                     |
| `level.rules.manage`         | XP-Regeln, Boost und Channels ohne XP ändern         |
| `level.decay.manage`         | Inaktivitäts-Abzug ändern und von Hand ausführen     |
| `level.stats.view`           | Auswertungen                                         |
| `level.settings.view/manage` | Einstellungen ansehen / ändern                       |
| `level.import`               | Altdaten übernehmen                                  |

`/level`, `/leaderboard`, `/level_stats`, `/global_stats` und
`/game_leaderboard` bleiben wie beim Vorgänger für alle Mitglieder offen und
verlangen keine Berechtigung.

---

## 2. Die Übernahme

1. **Level-System → Import** öffnen.
2. `levels.db` hochladen. Die Datei wird nur gelesen und danach wieder gelöscht;
   dieser Schritt ändert noch keinen einzigen XP-Stand.
3. Die Vorschau prüfen: Sie zeigt je Zeile, ob sie übernommen, als Duplikat
   erkannt, als leer übersprungen oder als unbrauchbar abgewiesen wird.
4. Bestätigen, dass der alte Bot abgeschaltet ist, und übernehmen.

Optional lässt sich anschliessend die alte `.env` hochladen, um die
Einstellungen zu übernehmen (siehe unten).

### Was übernommen wird

| Legacy-Tabelle   | Ziel                                                         |
| ---------------- | ------------------------------------------------------------ |
| `levels`         | `LevelProfile` - XP, Nachrichten, Voice-Minuten, Zeitstempel |
| `game_wins`      | `LevelGameStats` - Siege je Spielart                         |
| `no_xp_channels` | Einstellung "Channels ohne XP"                               |
| `config`         | XP-Boost und "Nur diese Level ankündigen"                    |
| `guild_config`   | Voice-Regeln für Stummschaltung und Alleinsein               |

### XP werden gesetzt, nicht ausgerechnet

Der Stand aus der Altdatenbank gilt. Er wird **nicht** aus Nachrichten und
Voice-Minuten neu berechnet - das ergäbe andere Zahlen, weil Boost, Cooldowns
und der Inaktivitäts-Abzug über die Jahre unterschiedlich gewirkt haben.

### Dieselbe Datei zählt nur einmal

Jedes übernommene Profil merkt sich die SHA-256-Prüfsumme der Datei, aus der
sein Stand stammt. Wird dieselbe `levels.db` erneut hochgeladen, erscheint jede
Zeile als Duplikat und es wird nichts gebucht. Zusätzlich trägt jede Buchung
einen Schlüssel aus Lauf-ID und Legacy-Zeile - eine wiederholte Ausführung
desselben Laufs bucht deshalb ebenfalls nicht doppelt.

Eine **andere** Datei (etwa ein neuerer Stand des alten Bots) wird dagegen
übernommen und setzt die Stände neu. Das ist gewollt: so lässt sich eine
Übernahme mit einem frischeren Auszug wiederholen.

### Leere Zeilen werden übersprungen

Wer 0 XP, keine Nachrichten und keine Voice-Zeit hat, bekommt kein Profil. Der
alte Bot legte für jede gesehene Person eine Zeile an; diese Karteileichen
würden die Mitgliederliste ohne Nutzen füllen.

---

## 3. Einstellungen aus der alten `.env`

Der Import liest die Datei über eine **Positivliste**: ausgewertet wird
ausschliesslich, was in der Tabelle oben steht.

`BOT_TOKEN`, `AUTH_SECRET`, `DATABASE_URL` und `REDIS_URL` stehen nicht auf
dieser Liste. Sie werden nicht gelesen, nicht angezeigt, nicht protokolliert und
nicht gespeichert. Die Vorschau zeigt nur, **wie viele** weitere Einträge
übersprungen wurden - nicht deren Namen.

Eine Sperrliste wäre hier der falsche Ansatz: sie müsste jeden künftigen Namen
kennen, und ein vergessener Eintrag würde ein Geheimnis durchlassen.

Aus `MILESTONE_ROLES="5:ROLEID,10:ROLEID"` entstehen echte Level-Rollen unter
**Level-System → Level & Rollen**.

---

## 4. Nach der Übernahme

### Level-Rollen abgleichen

Der Bot zieht Meilenstein-Rollen bei jeder XP-Änderung nach. Wer seit der
Einrichtung keine XP mehr gesammelt hat, bekäme eine neu eingerichtete Rolle
deshalb nie. Einmalig **Level & Rollen → Alle abgleichen** ausführen.

Der Bot muss in der Rollenhierarchie **über** allen Level-Rollen stehen. Rollen,
die er nicht vergeben kann, sind in der Liste markiert.

### Discord-Rechte prüfen

Der Bot braucht die Gateway Intents `GuildMessages` (XP für Nachrichten) und
`GuildVoiceStates` (XP für Voice). Beide sind nicht privilegiert. Der Inhalt von
Nachrichten wird **nicht** gelesen - `MessageContent` ist nicht nötig.

### Den alten Bot entfernen

Erst wenn die Stände im Dashboard stimmen: alten Prozess deaktivieren,
Autostart entfernen, `levels.db` sichern. Der alte Bot darf nicht versehentlich
wieder starten.

---

## 5. Was sich gegenüber dem alten Bot ändert

Die Zahlen bleiben gleich - XP-Kurve, Auszahlungen und Abzugssätze wurden
unverändert übernommen und sind in `tests/unit/level-semantics.test.ts` mit
Werten festgehalten, die im alten Bot ausgerechnet wurden.

Drei Dinge verhalten sich bewusst anders, weil sie beim Vorgänger XP kosten
konnten:

**Jede Änderung steht im Journal.** Der alte Bot speicherte nur den aktuellen
Stand; woher eine Zahl kam, liess sich höchstens aus Discord-Logs erraten. Jede
Buchung ist jetzt eine Zeile in `XpTransaction` mit Quelle, Betrag, Stand davor
und danach. `LevelProfile.xp` ist die Summe daraus.

**Einsätze werden beim Annehmen abgebucht.** Vorher prüfte der Bot nur den
Punktestand und buchte erst beim Abrechnen ab. Wer zwei Spiele gleichzeitig
startete, konnte deshalb mehr setzen, als er besass. Das Nettoergebnis bleibt
identisch: Der Verlierer verliert den Einsatz, der Gewinner erhält
`Einsatz × 2 × 0.95` abzüglich des eigenen Einsatzes.

**Wer gerade spielt, steht in der Datenbank.** Der alte Bot merkte sich das in
einer Menge im Arbeitsspeicher; ein Neustart gab jede Sperre frei und damit die
Möglichkeit, dieselben XP mehrfach zu setzen. Jetzt hält ein Unique-Index die
Sperre, und hängengebliebene Partien werden nach Ablauf automatisch freigegeben.

---

## 6. Wenn etwas schiefgeht

**Die Datei wird abgewiesen.** Geprüft werden SQLite-Header, Dateigrösse und die
erwarteten Tabellen. Fehlt `levels`, ist es nicht die Datenbank des Level-Bots.

**Einzelne Zeilen scheitern.** Der Lauf bricht nicht ab; die Zusammenfassung
nennt die Zahl der Fehler, und die betroffenen Zeilen tragen den Grund.

**Die Einstellungen wurden nicht gespeichert.** Meist zeigt ein übernommener
Channel auf etwas, das es auf Discord nicht mehr gibt. Channels ohne XP werden
vorab aussortiert und in der Vorschau benannt; bei den übrigen Werten meldet die
Übernahme den Grund, statt ihn zu verschlucken.

**Zu viel oder zu wenig XP nach der Übernahme.** Der Lauf lässt sich mit einer
frischeren `levels.db` wiederholen - die Stände werden dann neu gesetzt, nicht
addiert.
