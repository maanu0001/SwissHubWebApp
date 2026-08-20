# Übernahme des alten Spielersuche-Bots

Dieses Dokument beschreibt die einmalige Ablösung des früheren SwissHub
Spielersuche-Bots (`main.py` mit `data/matchmaking.db`) durch das
Spielersuche-Modul dieser Anwendung.

Nach der Übernahme gibt es **eine** Spielersuche. Dashboard, `/spielersuche`
und die Knöpfe unter jeder Suche rufen dieselben Funktionen auf, schreiben in
dieselbe PostgreSQL-Datenbank und verwenden dieselbe Konfiguration. Es läuft
kein zweiter Bot mehr mit.

---

## 1. Vor dem Start

### Den alten Bot stoppen

**Der alte Bot muss gestoppt sein, bevor der Import bestätigt wird.** Laufen
beide gleichzeitig, entstehen doppelte Suchen, doppelte Rollen-Pings, doppelte
Sprachkanäle und widersprüchliche Teilnehmerlisten. Beide registrieren
ausserdem einen Slash Command `/spielersuche` - welcher gewinnt, ist nicht
vorhersehbar.

Der Assistent verlangt deshalb eine ausdrückliche Bestätigung. Ohne sie wird
nichts übernommen.

### Konfiguration im Dashboard hinterlegen

Der alte Bot hatte seine Einstellungen teils in `.env`, teils in der SQLite-
Datenbank. Diese Werte gehören jetzt unter **Spielersuche → Einstellungen**:

| Alter Wert                             | Neue Einstellung                                                  |
| -------------------------------------- | ----------------------------------------------------------------- |
| `guild_settings.search_channel_id`     | Spielersuche-Channel                                              |
| `guild_settings.voice_category_id`     | Voice-Kategorie                                                   |
| `guild_settings.expiry_hours`          | Automatisch schliessen nach                                       |
| `guild_settings.accent_color`          | Embed-Farbe                                                       |
| `ROLE_PING_COOLDOWN_MINUTES = 5`       | Ping-Sperrfrist je Spiel                                          |
| `games.*` (Name, Rolle, Banner, Limit) | Spielersuche → Spiele                                             |
| `ALLOWED_ROLE_ID_1` / `_2`             | _entfällt_ - ersetzt durch die Berechtigungen `spielersuche.*`    |
| `TEST_GUILD_ID`                        | _entfällt_ - der Server wird im Einrichtungsassistenten verbunden |
| Hart codierte Onboarding-Nachricht     | Spielersuche → Onboarding (Titel, Text, Banner, Uhrzeit)          |

Die beiden festen Rollen `ALLOWED_ROLE_ID_1` und `ALLOWED_ROLE_ID_2` haben
bewusst keine Entsprechung. Wer was darf, wird unter **Server →
Berechtigungen** pro Rolle vergeben - dieselbe Zuordnung gilt für Dashboard,
Slash Command und Knöpfe.

### Berechtigungen vergeben

| Berechtigung                         | Bedeutung                                               |
| ------------------------------------ | ------------------------------------------------------- |
| `spielersuche.view`                  | Suchen ansehen                                          |
| `spielersuche.create`                | Suche starten (`/spielersuche` und Dashboard)           |
| `spielersuche.join`                  | Über **Mitmache** beitreten                             |
| `spielersuche.closeOwn`              | Eigene Suche beenden                                    |
| `spielersuche.closeAny`              | Fremde Suche beenden (ersetzt die Administratorprüfung) |
| `spielersuche.games.view/manage`     | Spiele ansehen / verwalten                              |
| `spielersuche.settings.view/manage`  | Einstellungen ansehen / ändern                          |
| `spielersuche.stats.viewOwn/viewAll` | Eigene / fremde Statistik, Rangliste                    |
| `spielersuche.onboarding.manage`     | Hinweisnachricht verwalten und testen                   |
| `spielersuche.import`                | Alte Datenbank übernehmen                               |

Ohne `spielersuche.join` kann niemand einer Suche beitreten - diese
Berechtigung gehört also an eine breite Rolle (z.B. `@Member`).

---

## 2. Der Import-Assistent

**Spielersuche → Import** (Berechtigung `spielersuche.import`).

```
Hochladen  →  Analysieren  →  Vorschau prüfen  →  Bestätigen  →  Übernehmen
                                                  ↑
                                        bis hierher wird nichts verändert
```

1. **Hochladen** – `matchmaking.db` auswählen. Die Datei wird gelesen, geprüft
   und danach gelöscht. Sie wird **nie verändert**.
2. **Analysieren** – Jede Zeile wird bewertet. Es entsteht kein Spiel und keine
   Suche.
3. **Vorschau** – Für jede Zeile ist sichtbar, was mit ihr geschieht und warum.
4. **Bestätigen** – Erst mit der Bestätigung „Der alte Spielersuche-Bot ist
   gestoppt" werden die Daten übernommen, und zwar in einer Transaktion:
   entweder alle oder keine.

### Mehrere Server in einer Datei

Der alte Bot verwaltete mehrere Discord-Server in derselben Datei (typisch:
Testserver und Produktivserver). Diese Anwendung ist auf genau **einen** Server
konfiguriert.

Der Assistent zeigt deshalb alle gefundenen Server mit ihrer Datenmenge an und
übernimmt genau einen - vorgeschlagen wird der mit den meisten Daten. Alles
andere erscheint in der Vorschau als „Anderer Server" und wird sichtbar
übersprungen, statt stillschweigend vermischt zu werden.

Das ist wichtig, weil Spielnamen pro Server eindeutig sind: ohne diese Trennung
würden zwei Einträge namens „CS2" mit unterschiedlichen Rollen kollidieren.

### Entscheidungen der Analyse

| Ergebnis              | Bedeutung                                                              |
| --------------------- | ---------------------------------------------------------------------- |
| **Wird übernommen**   | Wird angelegt.                                                         |
| **Bereits vorhanden** | Wurde in einem früheren Durchgang schon übernommen.                    |
| **Anderer Server**    | Gehört zu einem Server, der nicht übernommen wird.                     |
| **Konflikt**          | Es gibt bereits einen gleichnamigen Eintrag. Der bestehende bleibt.    |
| **Unlesbar**          | Pflichtangaben fehlen, oder der Eintrag ist zu alt, um noch zu wirken. |

### Wiederholbarkeit

Spiele, Suchen, Nutzungen und Voice-Sessions behalten ihre alte Zeilen-ID als
`legacyId`. Ein zweiter Durchgang mit derselben Datei erkennt alles wieder und
legt nichts doppelt an - der Import lässt sich also gefahrlos wiederholen.

---

## 3. Abbildung der Daten

| Legacy-Tabelle   | Neues Modell               | Anmerkung                                                         |
| ---------------- | -------------------------- | ----------------------------------------------------------------- |
| `guild_settings` | Moduleinstellungen         | Nur auf Wunsch und nur für Channels, die es auf Discord noch gibt |
| `games`          | `SpielersucheGame`         | Name, Rolle, Banner, `user_limit` → Squad-Grösse                  |
| `matches`        | `SpielersucheMatch`        | Vollständig als Historie, `source = LEGACY_IMPORT`                |
| `participants`   | `SpielersucheParticipant`  | Mit Kennzeichnung des Erstellers                                  |
| `command_usage`  | `SpielersucheUsage`        | Beide Schreibweisen vereinheitlicht (siehe unten)                 |
| `voice_sessions` | `SpielersucheVoiceSession` | Abgeschlossene Sessions; offene bekommen die gespeicherte Dauer   |
| `role_ping_log`  | `SpielersucheRolePing`     | Nur Einträge der letzten Stunde                                   |

### Laufende Suchen

Suchen mit Status `open` oder `complete` werden **als beendete Historie**
übernommen, nicht wieder geöffnet. Der Grund ist praktisch: ihre
Discord-Nachricht mit den Knöpfen gehört dem alten Bot. Nach dessen Stopp
bedient sie niemand mehr, und die Buttons wären wirkungslos.

Wer eine solche Suche fortsetzen möchte, startet sie neu - das dauert
zehn Sekunden und erzeugt einen sauberen Zustand.

### Der Zählfehler im alten Bot

Der alte Bot schrieb die Nutzung je nach Version unter zwei verschiedenen
Namen in die Datenbank: `spielersuche` und `spielersuechi`. Seine
Statistikabfrage suchte aber nur nach `spielersuche` - ein grosser Teil der
Nutzung tauchte in `/stats` und in der Top-5-Liste deshalb nie auf.

Beim Import werden beide Schreibweisen vereinheitlicht. Die Zahlen nach der
Übernahme sind daher **höher** als das, was der alte Bot angezeigt hat. Das ist
kein Fehler, sondern die Korrektur eines alten.

### Banner

Banner-Adressen werden geprüft: erlaubt ist ausschliesslich `https`.
Discord-Anhangslinks (`media.discordapp.net/attachments/...`) tragen
Ablaufzeitpunkt und Signatur im Query-Teil und wären nach wenigen Stunden tot -
sie werden deshalb auf die dauerhafte Form `cdn.discordapp.com/attachments/...`
gekürzt. Adressen, die kein gültiges `https` sind, werden weggelassen und in
der Vorschau gemeldet.

### Discord-IDs

Die alte Datenbank speicherte Discord-IDs als `INTEGER`. Solche Werte
überschreiten den sicheren Zahlenbereich von JavaScript - als Zahl gelesen
käme eine falsche ID heraus. Der Importer liest sie deshalb durchgehend als
BigInt und wandelt sie sofort in Text.

---

## 4. Was sich im Betrieb ändert

### Slash Commands

| Befehl                                        | Bemerkung                                                  |
| --------------------------------------------- | ---------------------------------------------------------- |
| `/spielersuche`                               | Unverändert, inklusive Autocomplete und `gsuechti-spieler` |
| `/spielersuche-hilf`                          | Früher `/help` - umbenannt, um keine Kollision zu erzeugen |
| `/spielersuche-stats [user]`                  | Früher `/stats`; ohne Angabe die eigene Statistik          |
| `/spielersucheadmin top`                      | Früher der Knopf „Top 5" unter `/stats`                    |
| `/spielersucheadmin games`                    | Wie bisher                                                 |
| `/spielersucheadmin testmessage`              | Wie bisher                                                 |
| `/spielersucheadmin close`                    | Wie bisher, jetzt mit `closeOwn` / `closeAny`              |
| `/spielersucheadmin settings`                 | Wie bisher, zeigt jetzt auch aktuelle Kennzahlen           |
| `/spielersucheadmin setup`                    | _entfällt_ - Einrichtung im Dashboard                      |
| `/spielersucheadmin game-add` / `game-remove` | _entfällt_ - Spiele im Dashboard verwalten                 |
| `/spielersucheadmin dashboard`                | _entfällt_ - dafür gibt es das Dashboard                   |

Die Befehle sind reine Adapter auf dieselben Funktionen, die auch das
Dashboard aufruft.

### Knöpfe

Die vier Knöpfe heissen unverändert **Mitmache**, **Verlah**,
**Suechi beende** und **Hilf**. Sie verwenden neue Custom IDs
(`swisshub:spielersuche:*`), erkennen aber weiterhin die alten
(`swisshub_spielersuche:*`) - Nachrichten des alten Bots bleiben damit
bedienbar, sofern die zugehörige Suche importiert wurde.

### Sprachkanäle

Der Ersteller bekommt seinen Kanal wie bisher mit erweiterten Rechten, aber
**ohne** „Kanäle verwalten". Damit liesse sich der Kanal umbenennen,
verschieben oder dauerhaft umkonfigurieren - mehr, als eine Spielsession
braucht. Sprechen, streamen, stummschalten und verschieben bleiben; steuerbar
über die Einstellung „Ersteller darf im eigenen Kanal moderieren".

Leere Spielersuche-Kanäle werden weiterhin automatisch gelöscht - erkennbar
daran, dass eine Suche in der Datenbank auf sie zeigt. Fremde Sprachkanäle
bleiben unberührt.

Das Teilnehmerlimit des Kanals folgt dem alten Verhalten: hat das Spiel eine
Squad-Grösse, gilt diese; sonst fasst der Kanal genau die gesuchte Gruppe
(gesuchte Spieler + Ersteller, höchstens 99).

Ist die Gruppe vollständig, wird der Kanal für alle übrigen geschlossen und im
Embed als `🔒 Gschlosse` ausgewiesen. Wird wieder ein Platz frei, öffnet er
sich und zeigt `🟢 Offe für alli`. Die Teilnehmer selbst behalten ihren Zugang
in beiden Zuständen.

### Ablauf und Onboarding

Der alte Bot prüfte im Zwei-Minuten-Takt im Arbeitsspeicher und schickte die
Onboarding-Nachricht über einen Timer um 16:00 Uhr. Hier ist die Datenbank
massgeblich: ein Job sucht regelmässig fällige Suchen, und die Hinweisnachricht
merkt sich den zuletzt gesendeten Tag. Ein Neustart verliert dadurch weder eine
Ablaufzeit noch schickt er die Nachricht ein zweites Mal.

---

## 5. Nach dem Import

1. **Spiele prüfen** – Unter _Spielersuche → Spiele_ stehen die übernommenen
   Einträge. Fehlt eine Rolle auf Discord, wird das dort angezeigt.
2. **Einstellungen prüfen** – Channel und Voice-Kategorie müssen gesetzt sein;
   der Systemzustand meldet Fehlendes.
3. **`/spielersuche` testen** – Eine Suche starten, beitreten, beenden.
4. **Alten Bot endgültig abschalten** – Dienst deaktivieren, damit er nicht bei
   einem Neustart wieder hochkommt.
5. **Alte Slash Commands aufräumen** – Solange die Anwendung des alten Bots im
   Discord Developer Portal existiert, können seine Befehle weiterhin
   erscheinen. Entweder die alte Anwendung löschen oder ihre Befehle
   deregistrieren.
6. **`matchmaking.db` sichern** – als Sicherungskopie, bis die Umstellung im
   Alltag bestätigt ist.

---

## 6. Fehlerbilder

| Meldung                                                    | Ursache und Abhilfe                                                                           |
| ---------------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| „Das ist keine SQLite-Datenbank."                          | Es wurde eine andere Datei gewählt - erwartet wird `matchmaking.db`.                          |
| „In der Datei fehlt die Tabelle `games`."                  | Die Datei stammt nicht vom SwissHub Spielersuche-Bot.                                         |
| „Bitte zuerst bestätigen, dass der alte Bot gestoppt ist." | Der Schalter im letzten Schritt fehlt.                                                        |
| Viele Zeilen als „Anderer Server"                          | Erwartet, wenn die Datei mehrere Server enthält. Die Serverliste zeigt die Auswahl.           |
| Alles als „Bereits vorhanden"                              | Der Import lief schon einmal durch - es gibt nichts mehr zu tun.                              |
| `/spielersuche` erscheint nicht auf Discord                | Der Bot braucht den Scope `applications.commands`; die Befehle werden beim Start registriert. |
| „Es isch kei Spiel konfiguriert"                           | Unter _Spielersuche → Spiele_ ein Spiel anlegen oder aktivieren.                              |
| Sprachkanal wird nicht erstellt                            | Voice-Kategorie prüfen; der Bot braucht dort „Kanäle verwalten".                              |
