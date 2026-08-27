# Community-Kalender

Zentraler Terminkalender der SwissHub-Community: Community-Abende, Turniere,
Streams, Watchpartys und Treffen. Mit Anmeldung, Warteliste,
Discord-Ankündigung und Erinnerungen.

---

## 1. Wozu

Ein Ort für alle Termine. Mitglieder sehen, was ansteht, melden sich an und
werden erinnert; die Organisation legt Events an, kündigt sie auf Discord an
und verwaltet die Teilnehmer.

Das Modul ist standardmässig **aus**. Einschalten unter **Module →
Community-Kalender**.

---

## 2. Berechtigungen

| Berechtigung                   | Wofür                                             |
| ------------------------------ | ------------------------------------------------- |
| `calendar.view`                | Kalender und Detailseiten sehen                   |
| `calendar.participate`         | Sich selbst an- und abmelden                      |
| `calendar.create`              | Events anlegen (als Entwurf) und duplizieren      |
| `calendar.manageOwn`           | **Eigene** Events bearbeiten - nicht fremde       |
| `calendar.edit`                | Jedes Event bearbeiten                            |
| `calendar.publish`             | Veröffentlichen und auf Discord ankündigen        |
| `calendar.cancel`              | Absagen (kritisch)                                |
| `calendar.delete`              | Endgültig entfernen (kritisch)                    |
| `calendar.registrations.view`  | Teilnehmerliste auch bei nicht-öffentlicher Liste |
| `calendar.manageRegistrations` | Teilnehmer entfernen, Antworten einsehen          |
| `calendar.manageReminders`     | Erinnerungen einstellen                           |
| `calendar.categories.manage`   | Kategorien pflegen                                |
| `calendar.stats.view`          | Kennzahlen in der Verwaltung                      |

`manageOwn` ist der Grund für den feinen Zuschnitt: wer einen Community-Abend
ausrichtet, soll seinen Termin pflegen können, ohne Zugriff auf jeden fremden
zu bekommen. Wer beides braucht, bekommt `calendar.edit`.

Es gibt keine Prüfung auf Rollennamen. Was jemand darf, steht unter **Server →
Berechtigungen**. Jede Seite und jede Aktion prüft serverseitig - dass ein
Knopf im Browser fehlt, ist Bequemlichkeit und keine Absicherung.

---

## 3. Ablauf

1. **Kalender → Event erstellen** - das Event entsteht als **Entwurf** und ist
   nur für Berechtigte sichtbar.
2. **Veröffentlichen** - der Status wird `SCHEDULED` (oder `ONGOING`, wenn der
   Termin bereits läuft), und die Discord-Ankündigung geht raus.
3. Mitglieder melden sich an; ist das Event voll, greift die Warteliste.
4. Die Zeitsteuerung setzt den Status auf `ONGOING` und später `COMPLETED`.
5. Fällt der Abend aus: **Absagen** mit Pflichtgrund. Das Event bleibt
   erhalten und wird als abgesagt gekennzeichnet - auf der Webseite und in der
   Discord-Ankündigung.

### Status

`DRAFT` → `SCHEDULED` → `ONGOING` → `COMPLETED`, aus jedem laufenden Zustand
zusätzlich → `CANCELLED`. Ein beendetes Event bleibt beendet; wer es
wiederholen will, dupliziert es.

Die Zeitsteuerung setzt `startedAt` und `completedAt` nur, wenn sie leer sind -
historische Daten werden nicht überschrieben.

---

## 4. Anmeldung und Warteliste

Je Event einstellbar: maximale Teilnehmerzahl (0 = unbegrenzt), Anmeldeschluss,
Warteliste, Abmeldung erlaubt, Abmeldeschluss, Teilnehmerliste öffentlich.

Dazu beliebige **Zusatzfragen** (Freitext oder Auswahl, pflichtig oder nicht) -
etwa Ingame-Name oder Wunschrolle. Die Antworten sehen nur Organisation und
Verwaltung, nie die öffentliche Liste.

**Der letzte Platz wird genau einmal vergeben.** Vor dem Zählen wird die
Terminzeile gesperrt (`SELECT … FOR UPDATE`); ab da entscheidet nur dieser
Vorgang. Die Eindeutigkeit `(eventId, discordId)` in der Datenbank ist die
zweite Sicherung gegen den Doppelklick.

Wird ein bestätigter Platz frei, rückt **in derselben Transaktion** die erste
wartende Person nach. Getrennt zu tun hiesse, dass dazwischen jemand anders den
Platz nehmen könnte - und die Warteliste wäre eine Empfehlung statt einer
Reihenfolge.

---

## 5. Discord

### Ankündigung

Beim Veröffentlichen geht ein Embed in den gewählten Channel; seine Kennung
wird am Event gemerkt. Jede spätere Änderung **schreibt dieselbe Nachricht
fort**, statt eine neue zu posten - wer den Kanal liest, soll nicht fünf
Fassungen desselben Abends sehen. Eine Absage kennzeichnet das bestehende Embed
als `ABGESAGT`.

Wurde die Nachricht von Hand gelöscht, wird das am Event vermerkt; die
Verwaltung kann sie erneut senden. Von selbst passiert das nicht - eine
gelöschte Nachricht wurde vielleicht mit Absicht gelöscht.

### Erwähnungen

Gepingt wird nur, was unter **Module → Community-Kalender → Erwähnbare Rollen**
freigegeben ist. Ein freies Feld am Event wäre ein Ping-Knopf für den ganzen
Server. Dieselbe Regel wie im Turniermodul.

### Erinnerungen

Vorlaufzeiten je Event (1 Woche / 24 h / 3 h / 1 h / 15 min), Zielkanal,
Rollen-Erwähnung, wahlweise nur die Angemeldeten.

Erinnerungen stehen als **Zeile in der Datenbank**, nicht als `setTimeout`: ein
Neustart würde jeden so gemerkten Termin verlieren. Ein Lauf im Bot
(`calendar-reminders`, alle 30 Sekunden) holt nach, was fällig geworden ist.

Gegen doppelte Nachrichten wirken zwei Dinge:

- `sentAt` wird gesetzt, **bevor** gesendet wird, unter einer Bedingung, die
  nur einmal zutrifft. Wer den Zuschlag nicht bekommt, sendet nicht - auch bei
  mehreren Bot-Instanzen.
- Schlägt der Versand danach fehl, wird die Zeile wieder freigegeben und ein
  Fehlversuch gezählt. Nach fünf Versuchen bleibt sie liegen, statt Discord
  endlos zu bedrängen.

Die Reihenfolge ist Absicht: lieber eine Erinnerung verlieren, wenn der Prozess
mitten im Senden stirbt, als denselben Ping fünfmal schicken.

Eine Erinnerung, deren Termin bereits begonnen hat, wird **nicht** nachgereicht -
sie käme zu spät und stiftete nur Verwirrung.

---

## 6. Zeitzonen

Zeiten stehen als UTC in der Datenbank. Die **Anzeigezone hängt am Termin**
(Vorgabe `Europe/Zurich`), damit eine Sommerzeitumstellung zwischen Anlage und
Durchführung die Ortszeit nicht verschiebt.

Das Formularfeld `datetime-local` trägt keine Zone - es zeigt nur, was
drinsteht. Diese Ortszeit wird ausdrücklich in der Zone des Events gerechnet
(`packages/shared/src/zeitzone.ts`). Sie mit `new Date()` zu lesen hiesse, sie
in der Zone des **Servers** zu deuten; die richtige Antwort hinge dann daran,
wie der Container gestartet wurde.

Die Umstellungstage sind geprüft: der 23-Stunden-Tag im März und der
25-Stunden-Tag im Oktober.

---

## 7. Kalenderexport

Jedes Event lässt sich als `.ics` herunterladen
(`/api/kalender/<slug>/ics`) - für Apple Kalender, Outlook und Google.

Zeiten gehen als UTC hinaus. Das ist die eine Schreibweise, die ohne
mitgelieferte Zonendefinition überall dasselbe bedeutet. Die `UID` bleibt über
Änderungen hinweg gleich, `SEQUENCE` steigt - ein erneuter Import ersetzt den
Termin, statt einen zweiten anzulegen. Ein abgesagtes Event wird als
`STATUS:CANCELLED` geführt, verschwindet also nicht still.

Der Endpunkt ist serverseitig abgesichert wie jede Seite: ohne Anmeldung und
ohne Kalenderberechtigung gibt es nichts, und ein Entwurf ist nur für die
Verwaltung vorhanden.

---

## 8. Ansichten

- **Monat** - Gitter über sechs Wochen, damit die Höhe beim Blättern nicht
  springt.
- **Woche** - sieben Spalten mit Uhrzeiten.
- **Liste/Agenda** - nach Tagen gruppiert.

Auf dem Telefon wird **immer** die Agenda gezeigt: ein zusammengequetschtes
Monatsgitter lässt sich weder lesen noch treffen.

Ansicht, Zeitraum und Filter stehen in der Adresse - damit lässt sich ein
bestimmter Monat verlinken, der Zurück-Knopf funktioniert, und ein Neuladen
zeigt dasselbe.

Filter: Kategorie, Textsuche, «Meine Events», «Mit Anmeldung», «Plätze frei».

---

## 9. Datenschutz

Gespeichert werden nur Discord-Kennung, der Namensstand zum Zeitpunkt der
Anmeldung (für die Nachvollziehbarkeit, wenn jemand den Server verlässt) und
die Antworten auf die gestellten Fragen.

Teilnehmerlisten folgen der Event-Einstellung: entweder für alle Mitglieder
sichtbar oder nur für Organisation und Verwaltung. Die Antworten auf
Zusatzfragen stehen nie in der öffentlichen Liste.

---

## 10. Was im Audit Log steht

`CALENDAR_EVENT_CREATED`, `_UPDATED`, `_PUBLISHED`, `_CANCELLED`, `_DELETED`,
`CALENDAR_ANNOUNCED`, `CALENDAR_REMINDER_SENT`,
`CALENDAR_PARTICIPANTS_NOTIFIED`, `CALENDAR_REGISTRATION_REMOVED`,
`CALENDAR_CATEGORY_SAVED`.

Beim Löschen trägt der Eintrag Titel, Status, Teilnehmerzahl und die
Discord-Kennungen - nach dem Löschen ist er die einzige verbliebene Auskunft.

---

## 11. Kennzahlen

In der Verwaltung: Anzahl Events, kommende, Entwürfe, abgesagte, Anmeldungen
insgesamt, häufigste Kategorien, bestbesuchte Events und die durchschnittliche
Teilnehmerzahl.

Der Durchschnitt zählt **nur beendete Events mit Anmeldung** und nennt seine
Grundgesamtheit. Events ohne Anmeldung mitzurechnen ergäbe eine Zahl, die
nichts bedeutet - sie hatten nie eine Teilnehmerliste.

Eine No-Show-Quote gibt es bewusst nicht: das System erfasst keine Anwesenheit,
und eine geschätzte Zahl wäre schlimmer als keine.

---

## 12. Grenzen

- **Serientermine** sind nicht umgesetzt. Für wiederkehrende Abende gibt es
  **Duplizieren**: Beschreibung, Ort, Kategorie, Anmeldeeinstellungen,
  Zusatzfragen, Erinnerungen und die Discord-Konfiguration werden übernommen,
  Teilnehmer nicht, und die Kopie startet als Entwurf. Eine echte Serie mit
  einzeln änderbaren Terminen wäre ein eigenes Datenmodell - lieber sauber
  vorbereitet als halb gebaut.
- Der Anmeldeknopf auf Discord fehlt: angemeldet wird über die WebApp. Der
  Link im Embed führt direkt dorthin.
- Banner und Symbolbilder werden als `https`-Adresse hinterlegt, nicht
  hochgeladen.
