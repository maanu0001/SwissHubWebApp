# XP-Verlosungen (XP-Glücksrad)

Mitglieder setzen einen Teil ihrer XP ein, um an einer Verlosung teilzunehmen.
Die Auslosung wird auf `/xp-gluecksrad` als Glücksrad dargestellt.

Die Verlosungen gehören zum **Level-System**. Es gibt keine zweite Währung und
keine getrennte Brieftasche: eingesetzt werden dieselben XP, gebucht wird über
dieselbe Engine, und jede Buchung steht im selben Journal (`XpTransaction`).

---

## 1. Eine Stelle, drei Zugänge

```
Dashboard ─┐
           ├─► XpRaffleService / enterRaffle ─► PostgreSQL
Webseite  ─┤
           │
Discord   ─┘
```

Dashboard, die Mitgliederseite und der Knopf auf Discord rufen dieselben
Funktionen auf. Der Einsatz, das Gewicht und die Gewinnchance entstehen an
einer einzigen Stelle – es gibt keinen zweiten Preis je nach Weg.

---

## 2. Die beiden Einsatzmodelle

Eine Verlosung verwendet genau eines der beiden Modelle. Nach der ersten
bezahlten Teilnahme lässt es sich nicht mehr ändern (siehe Abschnitt 6).

### Festbetrag (`FIXED`)

Alle zahlen denselben Betrag, jede Teilnahme wiegt `1`.

| Teilnehmende | Einsatz je Person | Gewinnchance je Person |
| ------------ | ----------------- | ---------------------- |
| 100          | 500 XP            | 1,00 %                 |

### Anteil (`PERCENTAGE`)

Der Einsatz ist ein Anteil der eigenen XP, das Gewicht entspricht dem Einsatz.

| Person | XP-Stand  | Einsatz (5 %) | Gewicht | Gewinnchance |
| ------ | --------- | ------------- | ------- | ------------ |
| A      | 20'000 XP | 1'000 XP      | 1'000   | 66,67 %      |
| B      | 10'000 XP | 500 XP        | 500     | 33,33 %      |

Die Chance entspricht damit dem Anteil am gesamten Einsatz. Die Oberfläche
weist das ausdrücklich aus – sie stellt es nie so dar, als hätten alle
dieselbe Chance.

---

## 3. Rundung

Der Anteil wird **immer aufgerundet**, danach greift der Mindesteinsatz und
zuletzt der Höchsteinsatz.

```
roh      = aufrunden(XP × Anteil)
danach   = max(roh, 1)                  ← eine Teilnahme ohne Einsatz hätte
                                          im gewichteten Modell keine Chance
danach   = max(danach, Mindesteinsatz)
Einsatz  = min(danach, Höchsteinsatz)
```

Aufgerundet wird, damit ein kleiner Anteil bei niedrigem Punktestand nicht auf
0 XP fällt. Der Höchsteinsatz steht zuletzt, damit er auch einen durch den
Mindesteinsatz angehobenen Betrag noch deckelt.

| XP-Stand   | Anteil | Mindest. | Höchst. | Einsatz  |
| ---------- | ------ | -------- | ------- | -------- |
| 1'001 XP   | 5 %    | –        | –       | 51 XP    |
| 1'000 XP   | 5 %    | 100 XP   | –       | 100 XP   |
| 160'000 XP | 5 %    | –        | 5'000   | 5'000 XP |
| 10 XP      | 1 %    | –        | –       | 1 XP     |

**Der Prozentwert wird beim Beitritt berechnet und dann festgeschrieben.**
Verdient jemand später XP dazu oder verliert welche, bleibt der bereits
bezahlte Einsatz unverändert (`XpRaffleEntry.entryXp` ist unveränderlich).

---

## 4. Eine Teilnahme pro Person

Auf Datenbankebene über `@@unique([raffleId, discordId])`. Dazu kommt eine
Prüfung vor und eine hinter der Zeilensperre auf dem Profil. Ein Doppelklick
kann dadurch nicht zweimal abbuchen – die zweite Anfrage sieht die Teilnahme
der ersten und meldet „nimmt bereits teil“, statt einen Fehler zu erzeugen.

Abbuchung, Teilnahme und Journalzeile entstehen in **einer** Transaktion. Es
gibt keinen Zustand, in dem XP fehlen, ohne dass eine Teilnahme existiert –
oder umgekehrt.

---

## 5. Die Ziehung

**Das Rad im Browser bestimmt nichts.** Der Gewinner steht zum Zeitpunkt der
Animation längst in der Datenbank.

```
Verwaltung startet die Ziehung
        ↓
Status wechselt auf DRAWING – ab hier kommt niemand mehr dazu
        ↓
unveränderlicher Auszug der gültigen Teilnahmen (XpRaffleDraw.snapshot)
        ↓
Gewinner aus crypto.randomInt(0, Summe der Gewichte)
        ↓
Ergebnis gespeichert  →  Rad dreht sich dorthin  →  Bestätigung
```

`crypto.randomInt` verwirft Werte ausserhalb des grössten passenden
Vielfachen, statt mit Modulo zu rechnen – jede Zahl ist damit gleich
wahrscheinlich. Eine Modulo-Rechnung würde die kleinsten Zahlen bevorzugen.

Zu jeder Ziehung wird festgehalten: Teilnehmerzahl, Summe der Gewichte, der
gezogene Punkt auf der Gewichtsachse, ein Zufallswert, die Fassung des
Verfahrens und der vollständige Auszug. Damit lässt sich eine Ziehung
nachrechnen.

Die Verwaltung kann die Ziehung **auslösen**, aber keinen Gewinner
**auswählen**. Einen solchen Weg gibt es nicht.

---

## 6. Was nach der ersten Teilnahme feststeht

Sobald jemand bezahlt hat, sind gesperrt:

- Einsatzmodell
- Festbetrag
- Anteil
- Mindest- und Höchsteinsatz

Wer bereits bezahlt hat, hat zu den damals geltenden Bedingungen bezahlt.
Liesse sich das nachträglich ändern, stünden Teilnahmen nebeneinander, die
nach verschiedenen Regeln zustande kamen – die ausgewiesene Gewinnchance wäre
dann schlicht falsch.

Titel, Beschreibung, Banner und die Discord-Angaben bleiben änderbar. Jede
Änderung wird auditiert.

---

## 7. Neuziehung

Nur mit Pflichtgrund und mit einer **eigenen Berechtigung**
(`level.raffle.redraw`), die nicht automatisch zur Verwaltung gehört. Möglich
ist sie nur, solange der Gewinner noch nicht bestätigt ist.

- Die frühere Ziehung bleibt erhalten – sie wird nicht überschrieben, sondern
  durch eine neue Fassung ergänzt.
- Der bisherige Gewinner wird standardmässig ausgeschlossen. Sein Einsatz wird
  dabei **nicht** zurückgezahlt: die Teilnahme gilt als ausgeschlossen, nicht
  als storniert.
- Gezogen wird aus demselben Auszug wie beim ersten Mal, abzüglich der
  ausgeschlossenen Teilnahmen.
- Grund, Zeitpunkt und ausführende Person stehen im Audit Log.

---

## 8. Rückzahlungen

Beim Abbruch einer Verlosung wird **jeder Einsatz vollständig zurückgezahlt**,
über dieselbe Engine (`XpSource.RAFFLE_REFUND`).

Jede Rückzahlung hängt an einer eigenen Zeile mit eindeutigem Schlüssel auf der
Teilnahme (`XpRaffleRefund.entryId` ist `@unique`). Ein zweiter Anlauf – etwa
nach einem Neustart mitten im Abbruch – findet diese Zeile vor und zahlt kein
zweites Mal.

Teilnahmen werden nie gelöscht. Sie wechseln ihren Zustand:

| Zustand        | Bedeutung                       |
| -------------- | ------------------------------- |
| `ACTIVE`       | nimmt an der Ziehung teil       |
| `REFUNDED`     | Einsatz zurückgezahlt (Abbruch) |
| `DISQUALIFIED` | von der Ziehung ausgeschlossen  |
| `WINNER`       | gezogen und bestätigt           |

Nur `ACTIVE` zählt zur Ziehung.

---

## 9. Berechtigungen

| Berechtigung               | Für wen                                                    |
| -------------------------- | ---------------------------------------------------------- |
| `level.raffle.view`        | alle Mitglieder                                            |
| `level.raffle.participate` | alle Mitglieder                                            |
| `level.raffle.create`      | Verwaltung                                                 |
| `level.raffle.edit`        | Verwaltung                                                 |
| `level.raffle.open`        | Verwaltung                                                 |
| `level.raffle.close`       | Verwaltung                                                 |
| `level.raffle.manage`      | Verwaltung (Teilnehmer, Ankündigung)                       |
| `level.raffle.draw`        | Verwaltung                                                 |
| `level.raffle.redraw`      | **getrennt vergeben** – greift in ein Ergebnis ein         |
| `level.raffle.cancel`      | **getrennt vergeben** – zahlt alle Einsätze zurück         |
| `level.raffle.delete`      | **getrennt vergeben** – entfernt eine vergangene Verlosung |
| `level.raffle.history`     | Einsicht in Ziehungen und Rückzahlungen                    |

Es gibt keine Vorgabe-Berechtigung für Mitglieder: `level.raffle.view` und
`level.raffle.participate` müssen der Mitglieder-Rolle unter
**Server → Berechtigungen** ausdrücklich zugewiesen werden. Ohne Zuweisung
sieht niemand die Seite – die Engine verweigert im Zweifel.

Jede Prüfung erfolgt serverseitig. Dass ein Knopf im Browser fehlt, ist
Bequemlichkeit und keine Absicherung.

---

## 10. Ablauf für die Verwaltung

1. **Level-System → XP-Glücksrad → Neue Verlosung**
2. Titel, Gewinn, Einsatzmodell, Zeitraum und Discord-Channel angeben.
   Die Vorschau rechts zeigt die Mitgliederseite und das Discord-Embed.
3. **Entwurf anlegen** – noch für niemanden sichtbar, kostet niemanden XP.
4. **Veröffentlichen** – die Teilnahme startet sofort oder zum hinterlegten
   Zeitpunkt; die Ankündigung geht in den gewählten Channel.
5. **Teilnahme schliessen** (von Hand oder durch die Zeitsteuerung).
6. **Auslosung starten** – mit Bestätigung, die Teilnehmerzahl und Topf nennt.
7. **Gewinner bestätigen** – erst danach ist die Verlosung abgeschlossen und
   der Gewinner wird auf Discord verkündet.

Die Zeitsteuerung läuft als Hintergrundlauf gegen die Datenbank, nicht über
Zeitgeber im Arbeitsspeicher. Ein Neustart verliert deshalb keine Frist, und
nach einem Ausfall über Nacht wird nachgeholt, was fällig geworden ist.

### Vergangene Verlosungen löschen

Abgeschlossene und abgebrochene Verlosungen sammeln sich mit der Zeit in der
Übersicht an. Wer `level.raffle.delete` hat, findet auf der Detailseite einer
solchen Verlosung den Knopf **Löschen**. Ein Grund ist Pflicht.

Was dabei geschieht – und was ausdrücklich nicht:

- **XP bleiben unberührt.** Einsätze, Rückzahlungen und Gewinne stehen als
  eigene Buchungen im XP-Journal und hängen nicht an der Verlosung. Niemand
  bekommt XP zurück, niemand verliert welche. Eine Löschung im Nachhinein darf
  keinen Punktestand verändern.
- **Löschen ersetzt keinen Abbruch.** Eine laufende Verlosung lässt sich nicht
  löschen; die Oberfläche bietet den Knopf erst gar nicht an, und der Server
  weist es ab. Wer eine laufende Verlosung beenden will, bricht sie ab – dabei
  werden die Einsätze zurückgezahlt.
- **Offene Rückzahlungen blockieren.** Ist ein Abbruch auf halbem Weg
  steckengeblieben und wartet noch eine Teilnahme auf ihre Rückzahlung, wird
  das Löschen verweigert. Diese Zeile ist der einzige Beleg dafür, dass jemandem
  noch XP zustehen.
- **Discord wird nicht aufgeräumt.** Eine bereits verschickte Ankündigung
  bleibt stehen. Ihre Kennungen landen im Audit Log, damit sie sich
  nachträglich finden lässt.

Der Eintrag im Audit Log ist nach dem Löschen die einzige verbliebene Auskunft
über die Verlosung. Er trägt deshalb Titel, Zustand, Teilnehmerzahl, Topf,
Gewinner und den angegebenen Grund – nicht nur die Kennung, die sich hinterher
nicht mehr auflösen liesse.

---

## 11. Der XP-Topf

Die Summe aller Einsätze wird angezeigt, aber **nicht automatisch an die
gewinnende Person ausgezahlt**. Die XP sind Teilnahmegebühr; der Gewinn wird je
Verlosung eigens festgelegt:

| Gewinnart        | Bedeutung                                         |
| ---------------- | ------------------------------------------------- |
| `EXTERNAL_PRIZE` | Sachpreis ausserhalb des Systems – nur Verwaltung |
| `XP_PRIZE`       | XP-Gutschrift, gebucht über dieselbe Engine       |
| `ROLE_PRIZE`     | Discord-Rolle, vergeben nach der Bestätigung      |
| `TEXT_ONLY`      | reine Ankündigung                                 |

Bei `ROLE_PRIZE` vergibt der Bot die Rolle erst **nach** der Bestätigung durch
die Verwaltung – vorher liesse sich noch neu ziehen, und die Rolle wäre bei der
falschen Person. Vor der Vergabe wird die Rangfolge geprüft: Discord lässt
einen Bot nur Rollen vergeben, die unter seiner höchsten eigenen Rolle stehen.
Scheitert es daran, bleibt die Verlosung gültig und das Dashboard nennt den
Grund.

Externe Gutscheine oder Zahlungen werden nicht versendet – das System verwaltet
und zeigt sie nur an. Es gibt ausschliesslich interne XP, keine Echtgeld-Käufe
und keine Möglichkeit, Teilnahmen zu kaufen.

---

## 12. Sprache

Nach der Vorgabe des Projekts: die WebApp spricht Deutsch, die Ankündigungen
auf Discord Schweizerdeutsch. Die Vorschau beim Anlegen zeigt beide Fassungen
nebeneinander.

Meldungen aus der gemeinsamen Engine (etwa „Du hesch nid gnueg XP“) sind
Schweizerdeutsch – so wie im übrigen Level-System auch, und sie erscheinen
überwiegend auf Discord.
