# Moderation Center und Analytics

Zwei Bereiche, die zusammengehören und trotzdem getrennt bleiben müssen.

Das **Moderation Center** ist der Ort, an dem gehandelt wird: bannen, kicken,
Timeout setzen, eine Notiz hinterlegen. Jede Massnahme braucht einen Grund und
landet in der Akte des Mitglieds.

**Analytics** ist der Ort, an dem nachgesehen wird: was ist auf dem Server
geschehen, wer hat eine Nachricht gelöscht, wer hat eine Rolle vergeben. Es
handelt nicht, es zeichnet auf.

```
             ┌──────────────────────┐        ┌───────────────────────┐
Dashboard ──►│  Moderation Center   │──────► │  Discord              │
             │  Grund + Rangfolge   │        │  Bann, Kick, Timeout  │
             └──────────┬───────────┘        └───────────┬───────────┘
                        │                                │ Gateway-Ereignis
                        ▼                                ▼
                 ModerationAction ◄───verknüpft───  DiscordEvent
                 «warum es geschah»                 «dass es geschah»
```

---

## 1. Moderation Center

### Was es kann

| Massnahme        | Berechtigung                | Wirkt auf Nichtmitglieder |
| ---------------- | --------------------------- | ------------------------- |
| Bann             | `moderation.ban`            | ja                        |
| Bann aufheben    | `moderation.unban`          | ja                        |
| Kick             | `moderation.kick`           | nein                      |
| Timeout          | `moderation.timeout`        | nein                      |
| Timeout aufheben | `moderation.timeout.remove` | nein                      |
| Notiz            | `moderation.notes.create`   | ja                        |

Jail bleibt beim Jail-Modul mit seinen eigenen Berechtigungen. Das Moderation
Center ist der gemeinsame Eingang und die gemeinsame Akte, **kein zweiter
Motor**: ein zweiter Schlüssel für dieselbe Handlung wäre eine zweite Wahrheit.

### Reihenfolge: erst Discord, dann die Akte

Der Eintrag entsteht erst, wenn Discord die Massnahme bestätigt hat.
Andersherum stünde in der Akte ein Bann, den es auf dem Server nie gab – und
niemand könnte ihn aufheben, weil es nichts aufzuheben gibt.

Ein gescheiterter Versuch verschwindet trotzdem nicht, sondern wird als
`FAILED` vermerkt. Wer es versucht hat, gehört zur Geschichte des Mitglieds.

### Rangfolge

Wen jemand moderieren darf, entscheidet `evaluateModerationPolicy` aus
`@swisshub/permissions` – **dieselbe** Policy, die Jail und Vote Jail
verwenden. Geschützte Rollen und Moderationsstufen sind dort konfigurierbar,
und ein Bann darf sie nicht anders auslegen als ein Jail.

`packages/modules/src/moderation/policy.ts` ist nur ein Adapter. Er trägt
zusammen, was die Policy braucht, und beantwortet die eine Frage, die das Jail
nicht kennt: **Bann und Entbannung wirken auch auf jemanden, der gar nicht
mehr auf dem Server ist.** Die Schutzregeln ohne Rollenbezug – Serverinhaber,
der Bot selbst, man selbst – gelten dabei weiterhin.

Die Moderationsstufe des Ausführenden wird aus seinen Rollen abgeleitet, nicht
entgegengenommen: wer sie behaupten dürfte, könnte sich selbst hochstufen.

### Laufende Timeouts

`expiresAt` ist eine eigene Spalte, kein Wert im Metadaten-JSON – danach wird
gefiltert, und «welche Timeouts laufen gerade» ist eine Abfrage.

**Die Liste kennt nur, was über dieses System gesetzt wurde.** Was jemand
direkt im Discord-Client getan hat, steht nicht in der Datenbank. Die
Oberfläche sagt das dazu; sie behauptet keine Vollständigkeit, die sie nicht
hat.

---

## 2. Analytics

### Berechtigungen: drei Stufen, absichtlich getrennt

| Schlüssel                  | Erlaubt                                          |
| -------------------------- | ------------------------------------------------ |
| `analytics.view`           | dass etwas geschehen ist – ohne Texte            |
| `analytics.content.view`   | den Text gelöschter und bearbeiteter Nachrichten |
| `analytics.media.download` | archivierte Dateien öffnen                       |
| `analytics.export`         | den gefilterten Verlauf als CSV                  |
| `analytics.settings`       | Fristen, Grenzen, Auswahl der Ereignisse         |

Ein Moderator, der wissen muss, wer wann was gelöscht hat, muss nicht den
Inhalt lesen. Die Trennung ist nicht kosmetisch: ohne
`analytics.content.view` werden `contentBefore`/`contentAfter` **gar nicht erst
aus der Datenbank geladen**, und die Volltextsuche geht nicht über sie – sonst
liesse sich über Treffer/kein-Treffer erschliessen, was in einer Nachricht
stand.

### Der Verursacher: im Zweifel unbekannt

Discord nennt bei einer gelöschten Nachricht nicht, wer sie gelöscht hat. Die
einzige weitere Quelle ist Discords Audit Log, und die ist unscharf:

1. **Selbstlöschungen erzeugen gar keinen Eintrag.**
2. **Discord verdichtet.** Löscht dieselbe Person mehrere Nachrichten
   desselben Verfassers im selben Kanal, wird ein bestehender Eintrag
   hochgezählt – mit dem alten Zeitstempel.
3. **Der Zeitstempel steckt nur in der Snowflake.**

`correlateActor` ordnet deshalb nur zu, wenn **alle** Bedingungen erfüllt sind:
gleicher Ereignistyp, gleiches Ziel, gleicher Kanal (wo bekannt), und ein
Eintrag aus den letzten **fünf Sekunden**. Sonst steht in der Zeitleiste
«Nicht zuzuordnen».

Ein Protokoll, das rät, ist schlimmer als eines, das schweigt: es sieht aus wie
ein Beweis.

`actorSource` sagt immer, woher die Aussage stammt:

| Wert        | Bedeutung                                 |
| ----------- | ----------------------------------------- |
| `GATEWAY`   | Das Ereignis nennt den Verursacher selbst |
| `AUDIT_LOG` | Aus Discords Audit Log korreliert         |
| `WEBAPP`    | Eine Massnahme aus diesem Dashboard       |
| `UNKNOWN`   | Nicht zuzuordnen. Keine Vermutung.        |

### Nachrichtentexte

Discord liefert beim Löschen nur die Kennung. `DiscordMessageSnapshot` hält
deshalb den letzten bekannten Stand jeder Nachricht – ohne ihn stünde im
Verlauf «eine Nachricht wurde gelöscht», eine Zeile, die nichts beantwortet.

Ohne das **Message-Content-Intent** kommen Nachrichten leer an. Das Modul
zeichnet dann weiterhin auf, behauptet aber nicht, der Text sei leer gewesen,
und der Gesundheitscheck des Moduls sagt es ausdrücklich. Freigeschaltet wird
das Intent im Discord Developer Portal unter _Bot → Privileged Gateway
Intents_.

### Doppelte Sicht auf dasselbe Geschehen

Bannt jemand über das Dashboard, entstehen zwei Aufzeichnungen: der
Moderationsvorgang und, Sekundenbruchteile später, das Discord-Ereignis.

`verknuepfeMitMassnahme` verbindet die beiden – **es unterdrückt keine.** Sie
beantworten verschiedene Fragen: der Vorgang sagt, _warum_ es geschah, das
Ereignis sagt, dass Discord es _tatsächlich vollzogen_ hat. Bliebe das Ereignis
aus, wäre gerade das interessant: eine Massnahme ohne Discord-Ereignis ist
eine, die nicht angekommen ist.

### Medienarchiv

Vier Zusagen:

1. **Nichts liegt öffentlich.** Das Verzeichnis liegt ausserhalb von `public`
   und wird nie statisch bedient. Der einzige Weg führt über
   `/api/analytics/media/[id]`, das vorher die Berechtigung prüft und jeden
   Abruf im Audit Log vermerkt.
2. **Kein erratbarer Pfad.** Der Speichername entsteht aus 24 Zufallsbytes,
   nicht aus dem Namen bei Discord. Der ursprüngliche Name bleibt als reine
   Anzeige erhalten – bereinigt, weil er in einem `Content-Disposition`-Header
   landet.
3. **Gelöscht ist gelöscht.** Läuft die Frist ab, verschwinden die Bytes vom
   Datenträger. Der Eintrag bleibt mit `deletedAt` stehen – «hier gab es eine
   Datei» ist eine Auskunft, die erhalten bleiben soll. Eine abgelaufene Datei
   wird auch dann nicht mehr herausgegeben, wenn die Bytes noch dort liegen.
4. **Es gibt eine Obergrenze.** Ist sie erreicht, wird nichts Neues
   archiviert. Alte Dateien werden dafür **nicht** gelöscht: die
   Aufbewahrungsfrist ist eine Zusage, und sie still zu unterlaufen wäre ihr
   Gegenteil.

Ausgeliefert wird immer als `attachment`, nie zur Anzeige im Browser – der
Inhalt stammt von Fremden und liefe sonst im Ursprung dieser Anwendung.

### Aufbewahrung

| Einstellung          | Standard | Obergrenze im Code |
| -------------------- | -------- | ------------------ |
| `retentionDays`      | 90       | 365                |
| `mediaRetentionDays` | 30       | 90                 |
| `mediaQuotaMb`       | 2048     | 20480              |
| `maxMediaFileMb`     | 8        | 25                 |

Der Job `analytics-retention` im Bot läuft alle sechs Stunden – auch dann,
wenn das Modul inzwischen ausgeschaltet wurde. Sonst bliebe liegen, was bei
eingeschaltetem Modul entstanden ist.

Erst die Dateien, dann die Ereignisse: umgekehrt nähme ein gelöschtes Ereignis
seine Dateien per Kaskade mit, und die Bytes blieben verwaist liegen.

### Export

Der CSV-Export ist keine Hintertür um die Berechtigungen herum. Wer die
Inhalte nicht sehen darf, bekommt eine Datei **ohne diese Spalten** – nicht
eine mit leeren Feldern, aus denen jemand schlösse, es habe nichts darin
gestanden.

Felder, die mit `=`, `+`, `-` oder `@` beginnen, bekommen ein vorangestelltes
Apostroph: ein Discord-Nutzername darf so anfangen, und Excel führte ihn sonst
als Formel aus.

Jeder Export wird im Audit Log vermerkt, mit dem verwendeten Filter und der
Angabe, ob die Obergrenze von 5000 Zeilen erreicht wurde.

---

## 2b. Statistik

Die Zeitleiste beantwortet «was ist geschehen». Die Statistik beantwortet «wie
entwickelt sich der Server» – dieselben Daten, eine andere Frage.

### Der Befund, der alles bestimmt

Das Ereignisprotokoll konnte diese Frage nicht beantworten. Es zeichnet auf,
wenn eine Nachricht **bearbeitet oder gelöscht** wird – eine *geschriebene*
Nachricht war nie ein Ereignis. Sprachzeit gab es als Betreten, Verlassen und
Verschieben, aber nirgends als Dauer.

Beides lässt sich nicht nachträglich errechnen. Die Ingestion zählt deshalb
selbst, und zwar **ohne den Text zu lesen**: für eine Nachrichtenzahl braucht
es ihn nicht, und das Zählen hängt dadurch auch nicht am
Message-Content-Intent.

### Sprachzeit als Abschnitte

| Ereignis     | Abschnitt      | Sitzung        |
| ------------ | -------------- | -------------- |
| Betreten     | beginnt        | beginnt        |
| Verschieben  | endet, beginnt | **läuft weiter** |
| Verlassen    | endet          | endet          |

Wer den Kanal wechselt, bleibt im Gespräch. `sessionId` klammert die
Abschnitte einer durchgehenden Anwesenheit: die Kanalstatistik summiert
Abschnitte, die Sitzungszahl gruppiert nach Sitzung. Ein Wechsel ergibt
dadurch zwei Kanäle mit je der Hälfte der Zeit – und trotzdem *eine* Sitzung.

Zeit im AFK-Kanal ist Anwesenheit, keine Aktivität: der Abschnitt bleibt als
Beleg stehen, seine Sekunden fliessen nicht in die Zahlen.

Nach einem Absturz stehen Abschnitte offen, und wir wissen nicht, wann die
Leute gegangen sind. Was wir wissen, ist der **letzte Herzschlag des Bots** –
bis dorthin wird geschlossen. Bis *jetzt* zu zählen machte aus drei Tagen
Ausfall drei Tage Sprachzeit.

### Aggregate

| Tabelle                 | Körnung            | Wofür                                  |
| ----------------------- | ------------------ | -------------------------------------- |
| `AnalyticsHourly`        | Server × Stunde    | Tagesverlauf, Heatmap                  |
| `AnalyticsDaily`         | Server × Tag       | Kennzahlen, Mitgliederverlauf          |
| `AnalyticsUserDaily`     | Person × Tag       | Ranglisten, **eindeutige** Aktive      |
| `AnalyticsChannelDaily`  | Kanal × Tag        | Top-Kanäle, Wachstum je Kanal          |
| `AnalyticsVoiceSegment`  | Abschnitt          | Sitzungen, laufende Anwesenheit        |
| `AnalyticsMemberProfile` | Person             | Aktivierung, Bindung, erste Äusserung  |
| `AnalyticsTracking`      | Server             | seit wann gezählt wird                 |

Die Zeile je Person und Tag ist die wichtigste: eindeutige aktive Mitglieder
über einen Monat sind **nicht** die Summe der Tageswerte. Wer an zwanzig Tagen
schreibt, ist eine Person und nicht zwanzig. Überall steht deshalb `distinct`
statt `sum` – auch beim Zusammenfassen zu Wochen.

### Europe/Zurich

Stunden decken sich mit UTC (Zürich liegt auf vollen Stunden). Tage nicht: ein
Zürcher Tag beginnt um 22:00 oder 23:00 UTC, und am Umstellungstag ist er 23
oder 25 Stunden lang. Kalendertage werden deshalb als reines Datum geführt und
die Verschiebung wird *berechnet* statt angenommen.

Eine Sitzung von 23:30 bis 01:30 landet zu 30 Minuten im einen und zu 90
Minuten im nächsten Tag.

### Keine Zahl, die mehr verspricht, als sie weiss

- Von 0 auf 5 ist kein Wachstum von unendlich Prozent, sondern «vorher gab es
  nichts».
- 1 auf 3 ist kein «+200 %» – unter fünf als Grundlage erscheint die Richtung,
  aber keine Prozentzahl.
- Unter zehn Austritten sagt ein Beitrittsverhältnis mehr über den Zufall aus.
- Unter zwanzig Personen gilt dasselbe für eine Bindungsquote.

### Bindung als echte Kohorte

Die Frage lautet: «Von denen, die vor N Tagen beigetreten sind – wie viele
waren N Tage später noch da?» Entscheidend ist die **jeweils eigene**
N-Tage-Marke jedes Mitglieds, nicht der heutige Stichtag. Wer nur zählt, wer
heute noch da ist, misst für die 7- und die 90-Tage-Marke fast dieselbe Gruppe
und bekommt drei Zahlen, die alle dasselbe sagen.

### Diagramme

Ohne Chart-Bibliothek. Das Projekt hat keine, und eine einzuführen wäre für
diese Seite der falsche Handel: Recharts und Verwandte bringen 100–200 kB in
jedes Bundle, das sie anfasst. Was die Seite braucht – Linie, Balken, Raster –
ist SVG, und SVG rendert der Server mit.

Der Mitgliederverlauf bekommt eine Achse **um die Werte** statt ab null: eine
Mitgliederzahl zwischen 5'800 und 6'000 ergäbe auf einer Achse ab null eine
schnurgerade Linie am oberen Rand, aus der niemand ablesen kann, ob die
Gemeinschaft wächst.

### Backfill

Aus dem vorhandenen Ereignisprotokoll lassen sich Beitritte, Austritte und
Sprachzeit nachziehen. **Nachrichten nicht** – sie waren nie ein Ereignis. Der
Lauf ist wiederholbar (er räumt seinen Bereich vorher aus), fortsetzbar
(`backfilledUntil`) und läuft als gewöhnlicher Job in Stapeln, nicht beim
Start: bei vielen Ereignissen reagierte der Bot sonst minutenlang nicht auf
Discord.

Ein Abschnitt ohne Ende im Protokoll wird **verworfen**, nicht geschätzt.

---

## 3. Was das Modul absichtlich nicht tut

- **Es rät keinen Verursacher.** Siehe oben.
- **Es zeichnet nicht ohne Einschalten auf.** `defaultEnabled: false` – ein
  Protokoll über alles, was Menschen schreiben, entsteht erst, wenn jemand es
  ausdrücklich will.
- **Es zeichnet keine Zustandsänderungen im Voice auf** (stumm, taub, Stream).
  Sie ändern denselben Zustand, ohne dass jemand den Kanal wechselt.
- **Es protokolliert nicht, wer die Zeitleiste liest.** Ein Protokoll jeder
  geöffneten Seite wäre eine Bewegungsakte über die Mitarbeiter. Protokolliert
  wird, was Daten aus dem System heraus trägt: Download und Export.
- **Es speichert keine Bot-Nachrichten**, solange `logBots` aus ist.

---

## 4. Dateien

```
packages/modules/src/moderation/
  permissions.ts   Berechtigungen der Massnahmen
  policy.ts        Adapter auf die gemeinsame Moderation Policy
  service.ts       Ban, Unban, Kick, Timeout, Notiz
  queries.ts       Verlauf, laufende Timeouts, Kennzahlen

packages/modules/src/analytics/
  config.ts        Modul, Einstellungen, Gesundheitsprüfungen
  permissions.ts   die drei Sichtbarkeitsstufen
  events.ts        Aufnahme; Nachrichtenstand merken
  actor.ts         Zuordnung des Verursachers - im Zweifel unbekannt
  dedup.ts         Verknüpfung mit einer Massnahme des Dashboards
  queries.ts       Zeitleiste (Cursor), Kennzahlen
  media.ts         Archiv, geschützter Zugriff, Aufbewahrung
  export.ts        CSV der Zeitleiste
  zeit.ts          Europe/Zurich, Tages- und Stundenverteilung
  zeitraum.ts      Zeitraumauflösung und Vergleich
  zaehler.ts       Fortschreiben der Aggregate
  statistik.ts     Kennzahlen, Verläufe, Ranglisten, Heatmap
  backfill.ts      Nachziehen aus vorhandenen Ereignissen

apps/bot/src/analytics-events.ts   die Aufzeichnung selbst
apps/web/src/app/(app)/moderation/ Übersicht, Verlauf, Banns
apps/web/src/app/(app)/analytics/  Zeitleiste und Statistik
apps/web/src/app/api/analytics/    Export und Medienausgabe
```
