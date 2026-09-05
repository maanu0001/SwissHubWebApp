# Übernahme des alten Jail-Bots

Dieses Dokument beschreibt die einmalige Ablösung des früheren SwissHub
Jail-Bots (`bot.py` mit `jail_data.db`) durch das Jail-Modul dieser
Anwendung.

Nach der Übernahme gibt es **ein** Jail-System. Dashboard und Slash Commands
rufen dieselben Funktionen auf, schreiben in dieselbe PostgreSQL-Datenbank und
verwenden dieselbe Konfiguration. Es läuft kein zweiter Bot mehr mit.

---

## 1. Vor dem Start

### Den alten Bot stoppen

**Der alte Bot muss gestoppt sein, bevor der Import bestätigt wird.** Laufen
beide Bots gleichzeitig, überschreiben sie sich gegenseitig die Rollen: der
alte Bot lässt jemanden nach Ablauf frei, der neue setzt die Jail-Rolle beim
nächsten Abgleich wieder - oder umgekehrt.

Der Assistent verlangt deshalb eine ausdrückliche Bestätigung. Ohne sie wird
nichts übernommen.

### Den alten Bot-Token rotieren

`bot.py` enthält den Bot-Token **im Klartext** in einer Konstanten. Jede Kopie
dieser Datei ist damit ein Zugang zum Bot.

> **Bitte den Token im [Discord Developer Portal](https://discord.com/developers/applications)
> unter „Bot“ → „Reset Token“ neu erzeugen.**

Der Token wird beim Import weder gelesen noch gespeichert noch angezeigt: Die
Datei `bot.py` wird gar nicht hochgeladen - nur `jail_data.db`. Diese
Anwendung verwendet ihre eigene, über `DISCORD_BOT_TOKEN` konfigurierte
Zugangsdatei (siehe [CONFIGURATION.md](./CONFIGURATION.md)).

### Konfiguration im Dashboard hinterlegen

Der alte Bot hatte alle IDs fest im Code. Diese Werte gehören jetzt in die
Moduleinstellungen unter **Module → Jail**:

| Alte Konstante in `bot.py`         | Neue Einstellung                                       |
| ---------------------------------- | ------------------------------------------------------ |
| `JAIL_ROLE_ID`                     | Jail-Rolle                                             |
| `BOOSTER_ROLE_ID`                  | Booster-Rolle (+ „Booster-Rolle behalten“)             |
| `ANNOUNCE_CHANNEL_ID`              | Ankündigungs-Channel                                   |
| `MOD_LOG_CHANNEL_ID`               | Moderations-Log                                        |
| `JAIL_PING_CHANNEL_ID`             | Jail-Ping-Channel                                      |
| `ROLE_MAENNLICH_ID`                | Rolle „männlich“ (optional, nur für die Anrede)        |
| `ROLE_WEIBLICH_ID`                 | Rolle „weiblich“ (optional, nur für die Anrede)        |
| `VOTE_REQUIRED = 5`                | Benötigte Stimmen                                      |
| `VOTE_DURATION_MINUTES = 5`        | Voting-Dauer                                           |
| `VOTE_JAIL_MINUTES = 30`           | Jail-Dauer bei Erfolg                                  |
| `VOTE_COOLDOWN_HOURS = 12`         | Sperrfrist nach erfolgreicher Abstimmung               |
| `MAX_JAIL_DAYS = 365`              | Maximale Jail-Dauer                                    |
| `ADMIN_ROLE_ID`                    | _entfällt_ - ersetzt durch die Berechtigungen `jail.*` |
| `VOTING_ROLE_ID`                   | _entfällt_ - ersetzt durch `jail.vote.start`           |
| `FEMALE_/MALE_/NEUTRAL_TEMPLATE_*` | Textvorlagen (siehe unten)                             |

Die beiden festen Rollen `ADMIN_ROLE_ID` und `VOTING_ROLE_ID` haben bewusst
keine Entsprechung mehr. Wer was darf, wird unter **Server → Berechtigungen**
pro Rolle vergeben - dieselbe Zuordnung gilt für Dashboard und Slash Commands.

---

## 2. Der Import-Assistent

**Modul Jail → Jail-Import** (Berechtigung `jail.import`).

```
Hochladen  →  Analysieren  →  Vorschau prüfen  →  Bestätigen  →  Übernehmen  →  Abgleichen
                                                  ↑
                                        bis hierher wird nichts verändert
```

1. **Hochladen** – `jail_data.db` auswählen. Die Datei wird gelesen, geprüft
   und danach gelöscht. Sie wird **nie verändert**.
2. **Analysieren** – Jede Zeile wird bewertet. Es entsteht noch kein Jail.
3. **Vorschau** – Für jede Zeile ist sichtbar, was mit ihr geschieht und
   warum.
4. **Bestätigen** – Erst mit der Bestätigung „Der alte Jail-Bot ist gestoppt“
   werden die Einträge angelegt, und zwar in einer Transaktion: entweder alle
   oder keiner.
5. **Abgleichen** – Anschliessend läuft die Reconciliation: fehlt jemandem die
   Jail-Rolle auf Discord, wird sie gesetzt; ist ein Mitglied nicht mehr auf
   dem Server, wird der Eintrag entsprechend markiert.

### Entscheidungen der Analyse

| Ergebnis              | Bedeutung                                                                                    |
| --------------------- | -------------------------------------------------------------------------------------------- |
| **Wird übernommen**   | Wird als offener Jail angelegt.                                                              |
| **Bereits vorhanden** | Wurde in einem früheren Durchgang schon übernommen.                                          |
| **Konflikt**          | Für dieses Mitglied läuft hier bereits ein Jail. Der bestehende Eintrag bleibt unangetastet. |
| **Unlesbar**          | Pflichtangaben fehlen oder sind beschädigt (z.B. keine gültige Discord-ID).                  |

### Wiederholbarkeit

Jede Legacy-Zeile erhält den Schlüssel `userId:jail_start`. Ein zweiter
Durchgang mit derselben Datei erkennt alle Zeilen wieder und legt nichts
doppelt an. Der Import lässt sich dadurch gefahrlos wiederholen - etwa, wenn
er beim ersten Mal abgebrochen wurde.

---

## 3. Abbildung der Daten

Die alte Datenbank kannte nur **laufende** Jails: beim Freilassen wurde die
Zeile gelöscht. Es gibt deshalb keine übernehmbare Historie - die Historie der
neuen Anwendung beginnt mit dem Import.

### Tabelle `jail_data` → `JailEntry`

| Legacy                             | Neu                                             | Anmerkung                                                                  |
| ---------------------------------- | ----------------------------------------------- | -------------------------------------------------------------------------- |
| `user_id`                          | `targetDiscordId`                               | Muss eine gültige Discord-ID sein, sonst „unlesbar“.                       |
| `roles` (CSV)                      | `roleSnapshot` + `JailRoleSnapshot`             | Der Text wird in einzelne Zeilen zerlegt; unbrauchbare Einträge entfallen. |
| `jailed_by`                        | `moderatorDiscordId`                            | Fehlt der Wert, steht „Unbekannt (Altbestand)“.                            |
| `jail_start`                       | `startedAt`                                     | ISO-Zeitstempel aus Python, inkl. Mikrosekunden und Offset.                |
| `jail_end = NULL`                  | `type = PERMANENT`, `endsAt = NULL`             | Kein erfundenes Ersatzdatum.                                               |
| `jail_end` gesetzt                 | `type = TEMPORARY`, `endsAt`, `durationSeconds` | Dauer = Ende − Start.                                                      |
| `reason`                           | `reason`                                        | Leer → „Kein Grund angegeben (Übernahme aus dem alten Bot)“.               |
| `guild_id`                         | _entfällt_                                      | Die Anwendung ist auf genau einen Server konfiguriert.                     |
| `gender`                           | _nur zur Information_                           | Die Anrede wird zur Laufzeit aus den konfigurierten Rollen bestimmt.       |
| `status = active` / `pending`      | `lifecycle = ACTIVE`                            |                                                                            |
| `status = expired_pending_restore` | `lifecycle = PENDING_REJOIN`                    | Zeit abgelaufen, Mitglied nicht erreichbar - die Rollen fehlen noch.       |
| `status = restore_failed`          | `lifecycle = RESTORE_FAILED`                    | Rollen liessen sich nicht zurückgeben.                                     |
| –                                  | `source = IMPORT`                               | Herkunft bleibt in der Historie sichtbar.                                  |

Der Rollen-Snapshot wird als eigene Relation `JailRoleSnapshot` gespeichert
(`roleId`, `roleNameAtTime`, `rolePositionAtTime`). Für übernommene Altdaten
ist der damalige Name unbekannt; er wird aus dem heutigen Guild-Zustand
ergänzt, soweit es die Rolle noch gibt, und bleibt sonst leer. Das ist
ehrlicher als ein erfundener Name.

**Rollen werden beim Import nicht auf Discord verändert.** Der alte Bot hat
die Jail-Rolle bereits gesetzt; der Import bildet diesen Zustand ab. Was davon
tatsächlich stimmt, prüft der anschliessende Abgleich.

### Tabelle `vote_cooldowns` → `VoteJailCooldown`

Noch laufende Sperrfristen werden übernommen, abgelaufene weggelassen.

### Tabelle `active_votes`

Wird **nicht** übernommen. Eine laufende Abstimmung hängt an einer
Discord-Nachricht mit Button, die dem alten Bot gehört; nach dessen Stopp
wäre sie wirkungslos. Laufende Abstimmungen sollten vor der Umstellung
auslaufen.

---

## 4. Was sich im Betrieb ändert

### Slash Commands

Die Befehle heissen unverändert `/jail`, `/silent_jail`, `/jail_free`,
`/jail_list` und `/vote_jail`, und `/jail` versteht weiterhin `10m`, `2h`,
`3d` - zusätzlich `permanent`. Ohne Dauerangabe entsteht wie bisher ein
unbefristeter Jail.

Neu ist, was **hinter** den Befehlen passiert: Sie sind reine Adapter auf
dieselben Funktionen, die auch das Dashboard aufruft. Damit gelten überall

- dieselbe Berechtigungsprüfung (`jail.create`, `jail.release`, …),
- dieselbe Moderation Policy (geschützte Rollen, Rollenhierarchie, Owner),
- derselbe Rollen-Snapshot,
- dasselbe Audit Log,
- dieselbe Konfiguration aus dem Dashboard - ohne Neustart.

### Textvorlagen

Die drei fest im Code stehenden Textvarianten (weiblich/männlich/neutral) sind
durch konfigurierbare Vorlagen mit Platzhaltern ersetzt:

```
{gendered:De |D |}{mention} macht e Usziit im Jail (Bis: {end_time})
```

Verfügbare Platzhalter: `{mention}`, `{user}`, `{moderator}`, `{reason}`,
`{duration}`, `{end_time}`, `{end_relative}`, `{pronoun}` und
`{gendered:männlich|weiblich|neutral}`.

Ein server-eigenes Emoji lässt sich direkt in die Vorlage schreiben, zum
Beispiel `<:angrypolice:989101111552118824>`. In den Standardvorlagen steht
bewusst keines, weil eine Emoji-ID nur auf einem bestimmten Server gültig ist.

`{end_time}` und `{end_relative}` erzeugen Discord-Zeitstempel: Discord
rechnet sie im Client jeder Leserin in deren Zeitzone um, statt eine feste
Uhrzeit hinzuschreiben.

### Verhalten bei Austritt und Wiedereintritt

Ein Jail endet nicht dadurch, dass jemand den Server verlässt. Der Eintrag
bleibt offen (`PENDING_REJOIN`) und wird beim erneuten Beitritt automatisch
wieder angewendet - oder korrekt beendet, falls die Zeit inzwischen abgelaufen
ist. Steuerbar über die Einstellung „Jail beim Wiedereintritt erneut
anwenden“.

### Automatische Freilassung

Der alte Bot prüfte im Minutentakt im Arbeitsspeicher. Hier ist die Datenbank
massgeblich: ein wiederkehrender Job sucht fällige Einträge. Ein Neustart,
ein Deployment oder ein Absturz verliert dadurch keine Freilassung.

---

## 5. Nach dem Import

1. **Jail-Übersicht prüfen** – Die übernommenen Einträge sind mit
   „Übernommen“ gekennzeichnet.
2. **Systemzustand prüfen** – Unter **System** zeigt der Abgleich, ob
   Datenbank und Discord übereinstimmen.
3. **Alten Bot endgültig abschalten** – Dienst deaktivieren, damit er nicht
   bei einem Neustart wieder hochkommt.
4. **Alten Token rotieren**, falls noch nicht geschehen (siehe oben).
5. **`jail_data.db` sicher aufbewahren** – als Sicherungskopie, bis die
   Umstellung im Alltag bestätigt ist.
6. **`bot.py` bereinigen** – Solange der Token im Klartext darin steht, gehört
   die Datei nicht in ein Repository und nicht in eine Ablage mit breitem
   Zugriff.

---

## 6. Fehlerbilder

| Meldung                                                         | Ursache und Abhilfe                                                                                        |
| --------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| „Das ist keine SQLite-Datenbank.“                               | Es wurde eine andere Datei gewählt - erwartet wird `jail_data.db`.                                         |
| „In der Datei fehlt die Tabelle `jail_data`.“                   | Die Datei stammt nicht vom SwissHub Jail-Bot.                                                              |
| „Bitte zuerst bestätigen, dass der alte Jail-Bot gestoppt ist.“ | Der Schalter im letzten Schritt fehlt.                                                                     |
| „Dieser Import wurde bereits durchgeführt.“                     | Für einen erneuten Durchgang die Datei neu hochladen; bereits übernommene Zeilen werden erkannt.           |
| Viele Zeilen als „Konflikt“                                     | Es laufen bereits Jails im Dashboard. Bestehende Einträge werden nie überschrieben.                        |
| Zeilen als „unlesbar“                                           | Meist eine beschädigte `user_id` oder ein unlesbarer `jail_start`. Die Vorschau nennt den Grund pro Zeile. |

---

## Vote Jail: wie das Ziel gewählt wird

Wer eine Abstimmung starten darf, bekommt dadurch **keine Mitgliedersuche**.
Eine Namenssuche beantwortet die Frage «wer ist alles da?», und die Antwort
ist eine Mitgliederliste — die Befugnis, eine Abstimmung zu starten, ist keine
Befugnis, den Server zu durchsuchen.

Drei Wege zum Ziel, je nachdem, was jemand ohnehin darf:

| Weg                               | Voraussetzung                                                                   |
| --------------------------------- | ------------------------------------------------------------------------------- |
| `/vote_jail` auf Discord          | `jail.vote.start` — das Ziel kommt aus Discords eigenem Auswahldialog           |
| Discord-ID im Dashboard eintragen | `jail.vote.start` — genau eine Kennung wird nachgeschlagen, nichts aufgezählt   |
| Namenssuche im Dashboard          | zusätzlich `members.view` — dieselbe Liste, die das Member Center ohnehin zeigt |

Alle drei enden bei derselben Prüfung: `evaluateModerationPolicy` mit
`kind: 'COMMUNITY_VOTE'`. Zurück kommt ausschliesslich, gegen wen dieser
Handelnde tatsächlich eine Abstimmung starten könnte.

Beim Nachschlagen einer Kennung ist die Antwort dieselbe für «gibt es nicht»
und «gegen den darfst du nicht» — sonst liesse sich an ihr ablesen, wer
geschützt ist.

## Jail-Gründe

Sie stehen seit der Zusammenführung bei der Moderation — siehe
[MODERATION_GRUENDE.md](MODERATION_GRUENDE.md). Der Schlüssel `reasonPresets`
im Jail-Schema bleibt als Altbestand erhalten, wird aber nicht mehr gelesen.
