# Ticket-System

Support-Anfragen als eigener Discord-Kanal je Anliegen, vollständig bearbeitbar
im Dashboard.

Es gibt **ein** Ticketsystem. Der Knopf im Discord-Panel und das Formular im
Dashboard rufen dieselben Funktionen auf – dieselbe Nummernvergabe, dieselbe
Zugriffsprüfung, derselbe Verlauf, dasselbe Audit.

```
Panel-Knopf (Discord) ─┐
Formular (Web)        ─┼─► TicketService ─► Discord-Kanal
                       │                  └─► Datensatz + Verlauf + Audit
Nachricht im Kanal    ─┘
```

Ein Ticket lebt an zwei Orten gleichzeitig: als Discord-Kanal und als
Datensatz. Der Kanal ist verletzlich – jemand löscht ihn, Discord ist kurz
weg, die Aufbewahrungsfrist läuft ab. Deshalb ist der Datensatz die Wahrheit
und der Kanal die Darstellung.

---

## 1. Einrichtung

Reihenfolge, weil jeder Schritt den vorherigen braucht:

1. **Moduleinstellungen** (`/modules/tickets`)
   - _Discord-Kategorie_: hier entstehen die Ticket-Kanäle. Ohne sie kann kein
     Ticket eröffnet werden.
   - _Ausweich-Kategorie_: Discord erlaubt 50 Kanäle je Kategorie. Ist die
     erste voll, entstehen die Kanäle hier.
   - _Standard-Support-Rollen_: greifen für Kategorien ohne eigene Rollen.
2. **Kategorien** (`/tickets/kategorien`)
   - Name, Emoji, zuständige Rollen, Fragen beim Eröffnen.
   - Ohne aktive Kategorie lässt sich kein Ticket eröffnen.
3. **Panel** (`/tickets/panels`)
   - Kanal, Titel, Text, Kategorien wählen → **Speichern** → **Veröffentlichen**.
   - Speichern und Veröffentlichen sind bewusst getrennt: an einem Panel lässt
     sich arbeiten, ohne dass jede Zwischenfassung im Kanal steht.
4. **Berechtigungen** (`/settings/permissions`)
   - Support-Rollen bekommen die Vorlage **Support-Team**.
   - Damit gewöhnliche Mitglieder den Bereich überhaupt sehen, braucht ihre
     Rolle `tickets.viewOwn` und `tickets.create`. Ohne diese beiden ist der
     Ticket-Bereich für sie unsichtbar – das ist kein Fehler, sondern die
     Voreinstellung dieses Rechtesystems.
5. **Modul einschalten** (`/modules`)
   - Das Modul ist standardmässig **aus**: es legt Discord-Kanäle an, und das
     soll erst geschehen, wenn Kategorie und Rollen stehen.

Die Gesundheitsprüfung auf `/modules/tickets` meldet jeden dieser Schritte,
der noch fehlt.

### Message-Content-Intent

Damit Antworten aus dem Ticket-Kanal im Dashboard und im Transcript erscheinen,
braucht der Bot das privilegierte Intent **Message Content**:

> Discord Developer Portal → Applications → SwissHub Bot → Bot →
> Privileged Gateway Intents → **Message Content Intent** einschalten →
> Bot neu starten.

Der Bot fragt vor dem Verbinden über die Anwendungs-Flags nach und fordert das
Intent nur an, wenn es freigeschaltet ist – sonst verweigerte discord.js den
Login und der ganze Bot bliebe unten wegen einer Funktion, die ein Modul
braucht. Fehlt das Intent, läuft alles Übrige weiter; die Gesundheitsprüfung
sagt, was dadurch fehlt.

---

## 2. Zugriff: zwei Ebenen

Das zentrale Rechtesystem allein genügt hier nicht. Es wirken **zwei** Ebenen,
und beide müssen zutreffen:

| Ebene                        | Frage                                                            |
| ---------------------------- | ---------------------------------------------------------------- |
| Zentrale Berechtigung        | Darf diese Person überhaupt Support machen (`tickets.support.*`)? |
| Kategorie-Zuständigkeit      | Trägt sie eine der Support-Rollen **dieser** Kategorie?          |

Ohne die zweite Ebene wäre jede Support-Rolle faktisch eine Vollberechtigung:
wer `tickets.support.view` hat, sähe auch Moderationsmeldungen.

Entschieden wird das an genau einer Stelle:
`packages/modules/src/tickets/access.ts` → `getTicketAccess()`.

```ts
const zugriff = await getTicketAccess(viewer, ticket);
// { view, reply, manage, notes, close, asStaff }
```

Jede Seite und jede Server Action geht über `ladeTicketMitZugriff()`. Eine
Ticket-ID aus dem Browser ist keine Berechtigung. Ein Waechtertest
(`tests/integration/ticket-routes.test.ts`) lehnt eine Ticket-Aktion ab, die
diesen Weg nicht nimmt.

### Wer sieht was

| Rolle                         | Sieht                                     | Interne Notizen |
| ----------------------------- | ----------------------------------------- | --------------- |
| Ersteller                     | sein eigenes Ticket                       | **nie**         |
| Hinzugefügter Teilnehmer      | dieses eine Ticket                        | **nie**         |
| Supporter (zuständig)         | Tickets seiner Kategorien                 | mit `notes.view` |
| Supporter (nicht zuständig)   | nichts von dieser Kategorie               | –               |
| `tickets.admin`               | alles                                     | mit `notes.view` |

Ein Ticket, das jemand nicht sehen darf, antwortet mit **derselben Meldung wie
ein nicht vorhandenes** – sonst liesse sich an der Antwort ablesen, welche
Ticketnummern existieren.

Interne Notizen werden nicht ausgeblendet, sondern **gar nicht geladen**:
`listMessages(ticketId, interneSichtbar)` entscheidet an der Abfrage. Was nicht
geladen wird, kann auch nicht im Seitenquelltext auftauchen.

---

## 3. Lebenszyklus

```
PENDING ──► OPEN ──► IN_PROGRESS ──► RESOLVED ──► CLOSED ──► ARCHIVED
   │          ▲            │
   │          └── WAITING_FOR_USER / WAITING_FOR_STAFF
   └──► CREATION_FAILED
```

**Eröffnen** geschieht in zwei Schritten: zuerst Datensatz und Nummer in einer
Transaktion, dann der Kanal. Scheitert der Kanal, bleibt das Ticket als
`CREATION_FAILED` sichtbar, statt halb angelegt zu verschwinden. Der umgekehrte
Weg hinterliesse bei einem Fehler einen herrenlosen Kanal.

**Nummern** kommen aus einer Zählerzeile, nicht aus `MAX+1`:

```sql
INSERT INTO "TicketCounter" ("guildId", "lastNumber", "updatedAt")
VALUES ($1, 1, now())
ON CONFLICT ("guildId") DO UPDATE
  SET "lastNumber" = "TicketCounter"."lastNumber" + 1
RETURNING "lastNumber"
```

Zwei gleichzeitige Erstellungen können sich dadurch nicht dieselbe Nummer
teilen. Zusätzlich sichert `@@unique([guildId, ticketNumber])` das Ergebnis ab.

**Übernehmen** ist ein bedingtes `updateMany`: es trifft nur zu, solange
niemand zugewiesen ist. Der zweite Klick ändert null Zeilen und weiss damit,
dass er zu spät war.

**Schliessen** löscht den Kanal nicht sofort, sondern schaltet ihn stumm.
Wann gelöscht wird, entscheidet `closeBehaviour`:

| Wert                  | Kanal wird gelöscht     |
| --------------------- | ----------------------- |
| `DELETE_IMMEDIATELY`  | beim nächsten Durchgang |
| `KEEP_24H`            | nach 24 Stunden         |
| `KEEP_7D`             | nach 7 Tagen            |
| `KEEP_FOREVER`        | nie                     |

Der Verlauf bleibt in jedem Fall vollständig erhalten – gelöscht wird nur der
Discord-Kanal.

---

## 4. Support-Alltag

| Bereich                    | Adresse                    | Berechtigung                 |
| -------------------------- | -------------------------- | ---------------------------- |
| Schlagwörter               | `/tickets/schlagwoerter`   | `tickets.support.manageTags` |
| Antwortvorlagen            | `/tickets/vorlagen`        | `tickets.templates.manage`   |
| Sperren                    | `/tickets/sperren`         | `tickets.block.manage`       |

**Zuweisen** übergibt ein Ticket an eine bestimmte Person
(`tickets.support.assign`); **Übernehmen** ist der Sonderfall davon, in dem
man sich selbst einträgt. Die Übergabe steht als Systemmeldung im Kanal.

**Schlagwörter** ordnen ein, sie entscheiden nichts über Sichtbarkeit. Jede
Änderung steht im Verlauf des Tickets.

**Antwortvorlagen** werden beim Antworten ins Feld gesetzt, nicht abgeschickt.
Eine Vorlage ist ein Anfang, kein fertiger Text – wer sie unverändert sendet,
hat das entschieden. Vorlagen ohne Kategorie erscheinen überall, sonst nur bei
der passenden.

**Sperren** verhindern das Eröffnen neuer Tickets. Bestehende bleiben
bearbeitbar: eine Sperre schneidet niemanden mitten im Gespräch ab. Sie sind
befristet oder unbefristet und lassen sich jederzeit aufheben; beides wird im
Audit festgehalten.

**Rückmeldung**: ist `feedbackEnabled` gesetzt, fragt der Bot nach dem
Schliessen im Ticket-Kanal nach 1 bis 5 Sternen. Bewerten darf nur, wer das
Ticket eröffnet hat, nur nach dem Abschluss und nur einmal – eine Statistik
aus Bewertungen, die jeder abgeben könnte, wäre keine. Dieselbe Bewertung
lässt sich auch im Dashboard abgeben.

**Für andere eröffnen**: mit `tickets.admin.createForUser` lässt sich unter
`/tickets/neu` ein Ticket im Namen eines Mitglieds anlegen. Es trägt die
Quelle `ADMIN` – im Archiv soll nicht aussehen, als hätte das Mitglied es
selbst eröffnet.

---

## 5. Transcripts

Zwei Fassungen, weil es zwei Publika gibt:

| Fassung | Adresse                                          | Enthält          |
| ------- | ------------------------------------------------ | ---------------- |
| `USER`  | `/api/tickets/<id>/transcript`                   | ohne Notizen     |
| `STAFF` | `/api/tickets/<id>/transcript?fassung=intern`    | vollständig      |

Die Trennung geschieht **beim Erzeugen**, nicht beim Anzeigen: eine Notiz, die
in der Datei steht und nur ausgeblendet wird, ist zwei Tastendrücke von der
Veröffentlichung entfernt.

Ausgeliefert wird über eine autorisierte Route, nie über eine offene Adresse.
Die interne Fassung verlangt zusätzlich `tickets.notes.view`.

Die abgelegte Datei ist ein **Zwischenspeicher**, nicht die Wahrheit: fehlt
sie, wird der Verlauf aus der Datenbank neu erzeugt. Deshalb darf
`transcriptRetentionDays` Dateien löschen, ohne den Verlauf zu vernichten.
Ohne ausdrücklichen Wert (`0`) wird nichts gelöscht.

---

## 6. Zeitsteuerung

Ein Job im bestehenden Runner des Bots, alle fünf Minuten
(`tickets-tick` → `runTicketTick()`). Er prüft selbst, ob das Modul
eingeschaltet ist – ein ausgeschaltetes Modul soll im Hintergrund nichts
löschen.

| Durchgang                | Wirkung                                                        |
| ------------------------ | -------------------------------------------------------------- |
| `runTicketReminders`     | erinnert bei `WAITING_FOR_USER` nach `reminderAfterDays`        |
| `runTicketAutoClose`     | schliesst bei `WAITING_FOR_USER` nach `autoCloseAfterDays`      |
| `runTicketMaintenance`   | fällige Kanäle entfernen, fehlende Kanäle und Panels erkennen, abgelaufene Transcripts löschen |

Erinnert und geschlossen wird **nur**, was auf das Mitglied wartet. Ein Ticket,
das auf den Support wartet, selbsttätig zu schliessen wäre kein Aufräumen,
sondern Wegsehen. Beide Fristen sind je Kategorie einstellbar; `0` schaltet sie
ab.

---

## 7. Discord-Seite

| Kennung                     | Wirkung                                        |
| --------------------------- | ---------------------------------------------- |
| `tickets:open:<categoryId>` | Knopf im Panel → Formular dieser Kategorie     |
| `tickets:claim`             | Knopf im Ticket-Kanal → übernehmen             |
| `tickets:close`             | Knopf im Ticket-Kanal → schliessen             |
| `tickets:feedback:<1-5>`    | Sternknopf nach dem Schliessen → Bewertung     |

Ein Panel trägt **einen Knopf je Kategorie**: das Mitglied wählt in einem
Schritt statt in zweien, und der Bot weiss beim Klick bereits, worum es geht.
Discord erlaubt fünf Knöpfe je Reihe und höchstens 20 in einer Nachricht.

Das Formular fasst fünf Felder. Eines davon ist immer der Betreff – eine
Kategorie darf deshalb höchstens **vier** eigene Fragen stellen. Die Grenze
steht im Service, nicht nur im Formular: ein fünftes Feld liesse das Modal erst
dann scheitern, wenn ein Mitglied ein Ticket eröffnen will.

Die Knöpfe im Ticket-Kanal gehen durch dieselbe Zugriffsprüfung wie das
Dashboard. Ein Knopf im Kanal ist keine Berechtigung.

**Erwähnungen** sind grundsätzlich unterbunden (`allowedMentions: { parse: [] }`).
Der Ersteller wird namentlich freigegeben, die Support-Rollen nur, wenn die
Kategorie `pingSupport` gesetzt hat. Ein `@everyone` im Betreff bleibt
wirkungslos.

---

## 8. Berechtigungen

| Schlüssel                        | Bedeutung                                     |
| -------------------------------- | --------------------------------------------- |
| `tickets.viewOwn`                | eigene Tickets sehen                          |
| `tickets.create`                 | Ticket eröffnen                                |
| `tickets.support.view`           | Tickets der zuständigen Kategorien sehen      |
| `tickets.support.reply`          | antworten                                     |
| `tickets.support.claim`          | übernehmen                                    |
| `tickets.support.assign`         | zuweisen                                      |
| `tickets.support.changeStatus`   | Status setzen                                 |
| `tickets.support.changePriority` | Priorität setzen                              |
| `tickets.support.addUser`        | Teilnehmer hinzufügen                         |
| `tickets.support.removeUser`     | Teilnehmer entfernen                          |
| `tickets.support.close`          | schliessen                                    |
| `tickets.support.reopen`         | wieder öffnen                                 |
| `tickets.support.manageTags`     | Schlagwörter anlegen und setzen               |
| `tickets.templates.manage` ⚠     | Antwortvorlagen pflegen                       |
| `tickets.admin.createForUser` ⚠  | Ticket im Namen eines Mitglieds eröffnen      |
| `tickets.notes.view` ⚠           | interne Notizen lesen                         |
| `tickets.notes.create`           | interne Notizen schreiben                     |
| `tickets.archive.view`           | Archiv durchsuchen                            |
| `tickets.transcript.view` ⚠      | fremde Verläufe herunterladen                 |
| `tickets.categories.manage` ⚠    | Kategorien pflegen                            |
| `tickets.panels.manage` ⚠        | Panels erstellen und veröffentlichen          |
| `tickets.settings` ⚠            | Moduleinstellungen ändern                     |
| `tickets.block.manage` ⚠         | Mitglieder vom Ticketsystem ausschliessen     |
| `tickets.stats.view`             | Kennzahlen ansehen                            |
| `tickets.admin` ⚠                | alle Tickets, unabhängig von der Kategorie    |

⚠ = als kritisch markiert; beim Zuteilen ausdrücklich hervorgehoben.

Die Vorlage **Support-Team** deckt den Alltag ab: bearbeiten und Notizen,
aber keine Kategorien, Panels oder Einstellungen.

---

## 9. Produktion

Die Migration ist **additiv**: neue Tabellen und eine neue nullbare Spalte
(`Ticket.reminderSentAt`). Bestehende Daten werden nicht angefasst.

```bash
cd /opt/swisshub
git pull
docker compose -f docker-compose.prod.yml build
docker compose -f docker-compose.prod.yml run --rm web \
  npx prisma migrate deploy --schema packages/database/prisma/schema.prisma
docker compose -f docker-compose.prod.yml up -d
```

> **Niemals `prisma migrate reset` auf Production verwenden.** Der Befehl
> leert die Datenbank.

Nach dem Start:

1. `/modules/tickets` öffnen und die Gesundheitsprüfung durchgehen.
2. Kategorie anlegen, Panel veröffentlichen, Modul einschalten.
3. Prüfen, dass das Message-Content-Intent freigeschaltet ist (Abschnitt 1).

---

## 10. Wo was liegt

| Ort                                            | Inhalt                                       |
| ---------------------------------------------- | -------------------------------------------- |
| `packages/modules/src/tickets/access.ts`       | Zugriffsentscheidung – die einzige Stelle    |
| `packages/modules/src/tickets/numbering.ts`    | rennsichere Nummernvergabe                   |
| `packages/modules/src/tickets/service.ts`      | Eröffnen, übernehmen, zuweisen, Teilnehmer   |
| `packages/modules/src/tickets/lifecycle.ts`    | Schliessen, wieder öffnen, aufräumen         |
| `packages/modules/src/tickets/messages.ts`     | Antworten, Notizen, Spiegelung aus Discord   |
| `packages/modules/src/tickets/transcript.ts`   | Verlauf als Datei, zwei Fassungen            |
| `packages/modules/src/tickets/scheduler.ts`    | Erinnern, selbsttätig schliessen, abgleichen |
| `packages/modules/src/tickets/panels.ts`       | Panel-Nachricht und Veröffentlichung         |
| `packages/modules/src/tickets/support.ts`      | Schlagwörter, Vorlagen, Sperren, Bewertung   |
| `apps/bot/src/ticket-interactions.ts`          | Panel-Knopf, Formular, Kanal-Knöpfe          |
| `apps/bot/src/ticket-messages.ts`              | Nachrichten aus Ticket-Kanälen übernehmen    |
| `apps/web/src/app/(app)/tickets/`              | Seiten                                       |
| `apps/web/src/modules/tickets/`                | Server Actions und Komponenten               |
