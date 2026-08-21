# Kommunikation

Neuigkeiten, Events und Umfragen als Discord-Embed im Namen des SwissHub Bots.

Es gibt **eine** Kommunikations-Engine. Das Dashboard und der Slash Command
`/post` rufen dieselben Funktionen auf – dieselbe Validierung, derselbe
Embed-Bauplan, derselbe Verlauf, dasselbe Audit.

```
Neuigkeiten (Web) ─┐
Event (Web)       ─┤
Umfrage (Web)     ─┼─► CommunicationService ─► Discord
/post             ─┘                        └─► Verlauf + Audit
```

---

## 1. Die drei Nachrichtenarten

| Art             | Felder                                                                      | Berechtigung          |
| --------------- | --------------------------------------------------------------------------- | --------------------- |
| **Neuigkeiten** | Titel, Text, Banner, Erwähnung, Channel                                     | `communication.news`  |
| **Event**       | zusätzlich Treffpunkt, Datum/Uhrzeit, verantwortliche Person, Anmeldung via | `communication.event` |
| **Umfrage**     | wie Neuigkeiten, danach automatisch 👍 / 👎                                 | `communication.poll`  |

Die Vorschau im Formular ist reine Darstellung. Was tatsächlich gesendet wird,
entsteht ausschliesslich serverseitig aus den geprüften Eingaben.

---

## 2. Events

Das Event-Embed übernimmt das Layout des früheren Bots: zwei Felder je Zeile.

```
[Titel]
[Beschreibung]

Treffpunkt              Datum/Uhrziit
Discord Lounge          <Discord-Zeitstempel>

Verantwortlichi Person  Ahmäldig via
@Manuel                 #ticket-erstellen

[Banner]
```

**Datum und Uhrzeit.** Die WebApp verwendet einen Datums- und Zeitauswähler;
gespeichert wird UTC, eingegeben wird Europe/Zurich. Im Embed steht ein
Discord-Zeitstempel – dadurch sieht jedes Mitglied seine eigene lokale Zeit.

`/post` kennt im Discord-Modal keinen Auswähler. Was sich als Datum lesen
lässt (`TT.MM.JJJJ HH:MM`), wird zum Zeitstempel; alles andere bleibt Text.
Ein unmögliches Datum wie der 32. Januar bleibt ebenfalls Text – lieber die
Angabe der Person als eine stillschweigend verschobene Zeit.

**Verantwortliche Person.** Ohne Auswahl gilt, wer die Nachricht sendet –
genau wie beim Vorgänger.

**Anmeldung via.** Fünf Möglichkeiten: keine Angabe, Freitext, Ticket-System,
ein Discord-Channel oder eine Adresse. Beim Ticket-System wird der in den
Einstellungen hinterlegte Channel verwendet; ist keiner konfiguriert, wird die
Angabe weggelassen und das gemeldet.

---

## 3. Erwähnungen

Der alte Bot nahm hier freien Text entgegen und schrieb ihn unverändert in die
Nachricht. Damit liess sich jede Rolle anpingen, unabhängig von jeder
Berechtigung.

Jetzt gibt es eine feste Auswahl: keine, `@everyone`, `@here`, eine Rolle oder
eine Person. Jede Nachricht wird mit einer ausdrücklichen
`allowedMentions`-Liste gesendet – was im Text zufällig wie eine Erwähnung
aussieht, benachrichtigt niemanden.

| Erwähnung           | Voraussetzung                                                      |
| ------------------- | ------------------------------------------------------------------ |
| Rolle oder Person   | `communication.mention`                                            |
| `@everyone`/`@here` | zusätzlich `communication.mentionEveryone` **und** die Einstellung |

Fehlt die Berechtigung, geht die Nachricht trotzdem raus – sie pingt nur
niemanden, und die Oberfläche sagt das.

---

## 4. Einstellungen

Alles im Dashboard unter **Kommunikation → Einstellungen**. Es gibt dafür
bewusst keine Werte in der `.env`.

| Einstellung                             | Wofür                                                  |
| --------------------------------------- | ------------------------------------------------------ |
| Standard-Channel                        | Vorauswahl im Formular                                 |
| Channel für Neuigkeiten/Events/Umfragen | Vorauswahl je Nachrichtenart                           |
| **Ticket-Channel**                      | ersetzt die früher fest im Bot eingetragene Channel-ID |
| **Standard-Banner** je Art              | ersetzt den früher fest eingetragenen Imgur-Link       |
| Fusszeile                               | erscheint unten in jedem Embed                         |
| Umfragen mit 👍/👎                      | Reaktionen automatisch setzen                          |
| @everyone zulassen                      | zusätzlich zur Berechtigung                            |

Änderungen wirken sofort – auch für `/post`, ohne Neustart des Bots.

---

## 5. `/post`

Der Ablauf bleibt wie gewohnt:

```
/post kanal:#events mention:@everyone person:@Manuel img_url:…
        ↓
   Discord-Modal: Titel, Nachricht, Treffpunkt, Datum/Uhrziit, Ahmäldig via
        ↓
   CommunicationService  ← dieselbe Stelle wie das Dashboard
```

Geändert hat sich, was darunter liegt:

- Die Berechtigung kommt aus der zentralen Engine (`communication.event`)
  statt aus einer fest eingetragenen Rollen-ID.
- Der Ticket-Channel und das Standardbanner stammen aus den Einstellungen.
- Der Versand landet im Verlauf, gekennzeichnet als „via /post".
- Antworten bleiben ephemeral – nur die ausführende Person sieht sie.

Das Sonderwort `ticket` im Feld „Ahmäldig via" funktioniert weiterhin; es
wählt jetzt die Anmeldungsart „Ticket", und welcher Channel gemeint ist, steht
in den Einstellungen.

---

## 6. Verlauf

Jeder Versand wird festgehalten – auch ein gescheiterter.

| Status    | Bedeutung                                              |
| --------- | ------------------------------------------------------ |
| `SENT`    | auf Discord veröffentlicht                             |
| `FAILED`  | Discord hat abgelehnt oder nicht geantwortet           |
| `DELETED` | nachträglich auf Discord gelöscht – der Eintrag bleibt |

Filtern nach Art, Status, Channel, Zeitraum und Freitext; die Auswahl steht in
der Adresse und lässt sich verlinken. Zu jedem Eintrag: auf Discord öffnen,
als Vorlage verwenden, löschen (mit `communication.manage`).

Ein Eintrag wird nie physisch entfernt. Löschen bedeutet: auf Discord
gelöscht, im Verlauf als solches gekennzeichnet.

---

## 7. Fehlerbehandlung

**Zeitlimit.** Ein Versand bricht nach 15 Sekunden ab. Die Discord-Anbindung
wiederholt bei Fehlern und wartet bei Ratenbegrenzung – ohne Frist könnte ein
Versand über eine Minute blockieren.

**Nach einem Zeitlimit wird nicht erneut gesendet.** Es ist dann unklar, ob
Discord die Nachricht doch bekommen hat. Der Idempotenz-Schlüssel bleibt
belegt: ein zweiter Versuch mit demselben Schlüssel postet nicht noch einmal.
Die Meldung bittet darum, zuerst im Channel nachzusehen.

**Doppelklick.** Ein Schlüssel je Versuch, serverseitig geprüft. Zwei
gleichzeitige Anfragen ergeben höchstens eine Discord-Nachricht.

**Die Oberfläche bleibt bedienbar.** Der Ladezustand wird in jedem Fall
zurückgesetzt – auch wenn die Anfrage gar nicht durchkommt. Bei einem Fehler
bleibt der Formularinhalt stehen, damit sich der Fehler beheben lässt.

**Ein Fehler reisst die Navigation nicht mit.** Fehlergrenzen innerhalb des
Layouts sorgen dafür, dass die Seitenleiste bedienbar bleibt.

**Discord nicht erreichbar.** Der Bereich öffnet sich trotzdem. Der Verlauf
und alle gespeicherten Daten sind da, nur das Senden ist vorübergehend nicht
möglich – und das steht auch so auf der Seite.

---

## 8. Berechtigungen

| Berechtigung                    | Bedeutung                                    |
| ------------------------------- | -------------------------------------------- |
| `communication.view`            | Bereich öffnen                               |
| `communication.send`            | Grundberechtigung zum Senden                 |
| `communication.news`            | Neuigkeiten senden                           |
| `communication.event`           | Events senden – auch `/post`                 |
| `communication.poll`            | Umfragen senden                              |
| `communication.mention`         | Rollen und Personen anpingen                 |
| `communication.mentionEveryone` | zusätzlich `@everyone` und `@here`           |
| `communication.history`         | Verlauf ansehen                              |
| `communication.draft`           | Entwürfe bearbeiten                          |
| `communication.manage`          | Nachrichten löschen, Ankündigungen verwalten |
| `communication.settings.manage` | Einstellungen ändern                         |

Jede Prüfung erfolgt serverseitig. Dass ein Knopf im Browser fehlt, ist
Bequemlichkeit und keine Absicherung.

---

## 9. Hinweis zur Ablösung des alten Bots

Der bereitgestellte Quelltext des alten Kommunikationsbots enthielt einen
**Bot-Token im Klartext**. Er wurde nicht übernommen, nirgends gespeichert und
nirgends protokolliert. Er gilt trotzdem als kompromittiert und **muss im
Discord Developer Portal rotiert werden**.

Der alte Bot sollte abgeschaltet werden, sobald `/post` über den zentralen Bot
läuft – sonst antworten zwei Bots auf denselben Befehl, und welcher gewinnt,
ist nicht vorhersehbar.
