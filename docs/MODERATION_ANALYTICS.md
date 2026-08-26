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
  export.ts        CSV

apps/bot/src/analytics-events.ts   die Aufzeichnung selbst
apps/web/src/app/(app)/moderation/ Übersicht, Verlauf, Banns
apps/web/src/app/(app)/analytics/  Zeitleiste
apps/web/src/app/api/analytics/    Export und Medienausgabe
```
