# Entbannungsanträge

Ein Antrag auf erneute Prüfung einer Sanktion. Für den Antragsteller einfach
und durchschaubar, für das Team ein vollständiger Fall — und für die
Entscheidung nachvollziehbar.

---

## 1. Die eine Besonderheit

Jedes andere Modul in SwissHub setzt voraus, dass der Benutzer Mitglied des
Discord-Servers ist. Dieses nicht — es **kann** es nicht.

Wer gebannt ist, steht nicht mehr auf dem Server. Die Mitgliedschaft als
Zugangsvoraussetzung wäre hier genau die Mauer, die den Antrag unmöglich macht.

Das ist der Grund für fast jede Entscheidung in diesem Dokument.

---

## 2. Warum das sicher ist

Die Frage ist berechtigt: das Modul nimmt ein Glied aus einer Sicherheitskette,
die überall sonst gilt. Drei Dinge tragen die Konstruktion.

**Die Identität ist nicht schwächer, sondern dieselbe.** Discord OAuth mit dem
Scope `identify` liefert eine kryptografisch bestätigte Discord-Kennung. Sie ist
exakt dieselbe Kennung, mit der sich auch ein Mitglied anmeldet. Was fehlt, ist
nicht die Identität, sondern die Zugehörigkeit — und die ist hier gerade das
Gegenteil einer Voraussetzung.

**Die Berechtigung wird nicht weggelassen, sondern ersetzt.** An die Stelle
einer Permission tritt eine engere Prüfung:

```ts
appeal.applicantDiscordId === ctx.user.discordId
```

Ein Mitglied mit `appeals.view` sieht viele Fälle. Ein Antragsteller sieht genau
einen — seinen. Das ist die schärfere Bedingung, nicht die schwächere.

**Ein Nicht-Mitglied hat strukturell keine Rechte.** `can(ctx, permission)` gibt
für `isMember: false` immer `false` zurück. Eine Antragsteller-Aktion kann
deshalb nichts erreichen, was einer Berechtigung bedürfte — selbst wenn jemand
es versuchte.

---

## 3. Die beiden Zugänge

```
ANTRAGSTELLER                          TEAM
─────────────                          ────
Discord-Login                          Discord-Login
   │                                      │
   ▼                                      ▼
Session (auch ohne Mitgliedschaft)     Session
   │                                      │
   ▼                                      ▼
requireAuth()                          requireMember()
   │  keine Mitgliedschaft                │
   ▼                                      ▼
/entbannung                            requirePagePermission()
   │                                      │
   ▼                                      ▼
appeal.applicantDiscordId              /appeals
  === ctx.user.discordId                  │
                                          ▼
                                    Entscheidung
                                          │
                                          ▼
                                 moderation.unbanMember()
                                    (prüft moderation.unban,
                                     Rangfolge, geschützte Konten)
```

Die Anmeldung erzeugte schon vorher eine Session für Nicht-Mitglieder — sie
landeten nur auf `/access-denied`. Dort steht jetzt der Einstieg. Am Login
selbst wurde nichts geändert.

### Server Actions

`defineAction` bekam eine additive Kennzeichnung:

```ts
export const antworteAlsAntragstellerAction = defineAction(
  { name: 'appeal.applicant.reply', applicant: true, schema: …, rateLimit: … },
  async ({ ctx, input }) => {
    await appeals.requireEigenerAppeal(guildId, input.appealId, ctx.user.discordId);
    …
  },
);
```

`applicant: true` nimmt **genau ein** Glied aus der Kette: die Mitgliedschaft.
Anmeldung, CSRF, Ratengrenze und Eingabeprüfung bleiben.

Zwei Wächter halten das fest:

- `tests/unit/action-authorization.test.ts` verlangt von jeder so
  gekennzeichneten Aktion den Aufruf von `requireEigenerAppeal`. Ohne ihn fällt
  der Test.
- `defineAction` weist eine Aktion ab, die `applicant` **und** `permission`
  deklariert. Sie wäre in sich widersprüchlich: sie liefe für ein Nicht-Mitglied
  nie und für ein Mitglied ohne den Antragstellerpfad.

---

## 4. Was der Antragsteller sieht

Nicht durch Weglassen in der Anzeige, sondern durch **getrennte Abfragen**:

| | `holeAntragstellerSicht` | `holeStaffSicht` |
| --- | --- | --- |
| Antragstext | ✓ | ✓ |
| Nachrichten | ✓ als «SwissHub Team» | ✓ mit Namen |
| Zeitleiste | nur `PUBLIC`, in der DB gefiltert | vollständig |
| Interne Kommentare | **wird nicht geladen** | ✓ |
| Interne Begründung | ✗ | ✓ |
| Ban-Snapshot | nur Discord-Grund und Datum | vollständig |
| Bearbeiter, Priorität | ✗ | ✓ |

Eine gemeinsame Abfrage mit einem `if` in der Ausgabe wäre eine Zeile davon
entfernt, interne Notizen hinauszusenden — und diese eine Zeile hätte irgendwann
jemand übersehen.

`tests/unit/appeals-security.test.ts` liest den Quelltext und schlägt fehl,
sobald die Antragstellerabfrage `comments` lädt oder die Zeitleiste nicht mehr
in der Datenbank filtert.

### Staff-Identität (§22)

Der Antragsteller liest «SwissHub Team». Der Moderatorname steht in der
Datenbank und im Audit — er geht nur nicht hinaus. Die Umsetzung liegt in der
Abfrage, nicht in der Anzeige.

---

## 5. Zulässigkeit

Geprüft wird **live bei Discord**, nicht in der eigenen Akte: die Akte sagt, was
SwissHub getan hat; Discord sagt, was gilt.

| Befund | Antwort an den Antragsteller |
| --- | --- |
| kein Bann | «Für dein Discord-Konto besteht aktuell kein aktiver SwissHub-Ban.» |
| Antrag läuft | «Für dich läuft bereits ein Antrag.» |
| Sperrfrist | «Du kannst aktuell keinen weiteren Antrag stellen.» + Datum |
| endgültig abgelehnt | «Über deinen Fall wurde abschliessend entschieden.» |
| Discord antwortet nicht | «Dein Status lässt sich gerade nicht prüfen.» |

Der Befund trägt **zwei getrennte Felder**: `grund` geht hinaus,
`internerGrund`/`moderationsEintrag` bleiben. `fuerAntragsteller()` ist die eine
Stelle, an der aus dem internen Befund die äussere Auskunft wird, und sie reicht
ausdrücklich drei Felder weiter — ein neues Feld am Befund landet damit nicht
versehentlich im Browser.

Bei einem Discord-Ausfall wird **nicht** «du darfst nicht» geantwortet. Das wäre
eine Behauptung, die niemand geprüft hat.

---

## 6. Eine Korrektur an der Aufgabenstellung

Die Spezifikation sieht Verhalten für ablaufende **temporäre Bans** vor.

**SwissHub hat keine temporären Discord-Bans.** `banMember()` nimmt keine Dauer
entgegen, und Discords Ban-API kennt keine. Befristet sind hier Jail und
Timeout, nicht der Bann.

Das wurde nicht weggeraten, sondern umgesetzt, was tatsächlich möglich ist:

- Gegenstand eines Antrags ist der **Discord-Bann**.
- Statt «Mindestrestdauer bei temporären Bans» gibt es eine **Wartefrist nach
  dem Bann** — dieselbe Absicht, aus `ModerationAction.createdAt` wirklich
  berechenbar. Bei einem Bann von ausserhalb entfällt sie, weil kein Zeitpunkt
  bekannt ist; eine Frist auf ein erfundenes Datum wäre schlechter als keine.
- §28 (extern entfernter Bann) ist vollständig umgesetzt — der Fall kommt real
  vor.

---

## 7. Ban-Snapshot

Beim Einreichen wird eine unveränderliche Momentaufnahme gespeichert. Eine
**Kopie und keine Verknüpfung**: die Moderationsakte darf sich ändern, ohne dass
sich rückwirkend ändert, worüber entschieden wurde.

```
quelle              swisshub | discord
discordGrund        der Grund, wie er bei Discord steht
verhaengtAm         aus der Akte; null bei einem Bann von ausserhalb
moderationActionId  Verweis, falls vorhanden
internerGrund       nur für das Team
moderatorUsername   nur für das Team
erfasstAm           wann die Momentaufnahme entstand
```

**Nicht alles wird kopiert.** Die interne Notiz des Moderators bleibt in der
Akte. `snapshotFuerAntragsteller()` reicht genau zwei Felder weiter.

---

## 8. Statusworkflow

```
DRAFT ──► SUBMITTED ──► UNDER_REVIEW ──┬─► APPROVED ──► CLOSED
                             ▲          ├─► REJECTED ──► CLOSED
                             │          └─► DECISION_PENDING ──► APPROVED
                             │                                   REJECTED
              WAITING_FOR_APPLICANT ◄──┘
                             │
                             ├─► WAITING_FOR_STAFF ──► UNDER_REVIEW
                             └─► EXPIRED ──► CLOSED

jeder offene Zustand ──► WITHDRAWN            (nur der Antragsteller)
jeder offene Zustand ──► RESOLVED_EXTERNALLY  (Bann von Hand aufgehoben)
```

Zwei Regeln durchziehen die Tabelle:

1. **Aus einem Endzustand führt kein Weg zurück.** `APPROVED`, `REJECTED`,
   `WITHDRAWN`, `EXPIRED` und `RESOLVED_EXTERNALLY` gehen ausschliesslich nach
   `CLOSED`. Eine Entscheidung ist eine Entscheidung.
2. **`SUBMITTED → APPROVED` gibt es nicht.** Erst wird geprüft, dann
   entschieden. Ein Sprung darüber hinweg wäre eine Entscheidung ohne Prüfung.

Die Tabelle ist die **einzige Quelle**. `darfZurueckziehen()` wird daraus
abgeleitet und nicht zweitgeschrieben — eine eigene Liste stand genau einmal im
Widerspruch dazu, und der Rückzug galt als erlaubt und scheiterte dann am
Übergang.

---

## 9. Entscheidung und Entbannung

### Genau eine gewinnt (§58)

Der Zuschlag wird unter Bedingung geholt:

```sql
UPDATE "Appeal" SET "decidedAt" = now()
WHERE id = ? AND "decidedAt" IS NULL AND status = ?
```

Zwei Moderatoren, die gleichzeitig genehmigen und ablehnen, führen zu genau
einer Entscheidung. Der zweite ändert null Zeilen und bekommt eine Meldung.

### Die Entbannung geht durch die Moderation (§25, §41)

Kein eigener Discord-Aufruf. `moderation.unbanMember()` prüft:

- die Berechtigung `moderation.unban` — zusätzlich zu `appeals.unban`
- die Rangfolge und geschützte Konten
- und schreibt den Eintrag in die Moderationsakte

Dieses Modul kann daran nicht vorbei. Der Sicherheitstest belegt, dass nirgends
im Modul `gateway.bans.remove` aufgerufen wird.

### Entschieden ist nicht ausgeführt (§26)

| `unbanStatus` | Bedeutung |
| --- | --- |
| `COMPLETED` | Bann aufgehoben |
| `PARTIAL` | Entscheidung steht, Discord hat nicht geantwortet — wiederholbar |
| `FAILED` | Nicht ausgeführt, etwa weil die Moderationsberechtigung fehlte |

Die Oberfläche sagt es deutlich: «Entscheidung genehmigt, die Entbannung konnte
noch nicht durchgeführt werden.» Ein roter Balken oben im Fall, mit einem Knopf
zum Wiederholen — nicht ein Eintrag in einem Protokoll, das niemand liest.

### Idempotenz (§59)

Besteht kein Bann mehr, wirft `unbanMember` `NOT_FOUND`. Hier wird daraus ein
`NO_OP`: der gewünschte Zustand besteht bereits. Andersherum erzeugte ein
zweiter Klick eine Fehlermeldung, obwohl alles stimmt.

### Vier-Augen (§24)

Konfigurierbar: `NIE` (Vorgabe), `GENEHMIGUNG`, `IMMER`.

Bei `GENEHMIGUNG` geht eine Genehmigung zuerst nach `DECISION_PENDING`; erst
eine **andere** Person bestätigt sie. Wer den eigenen Vorschlag bestätigen
könnte, hätte kein Vier-Augen-Prinzip, sondern zwei Klicks.

`GENEHMIGUNG` ist der Mittelweg: eine Ablehnung ändert am Zustand nichts, eine
Genehmigung holt jemanden zurück.

---

## 10. Berechtigungen

| Berechtigung | Was sie erlaubt |
| --- | --- |
| `appeals.view` | Übersicht, eigene und unzugewiesene Fälle |
| `appeals.view.all` | Auch fremd zugewiesene Fälle |
| `appeals.review` | Übernehmen, prüfen, Zustand fortschreiben |
| `appeals.assign` | Zuweisen und freigeben |
| `appeals.comment.internal` | Interne Notizen |
| `appeals.message` | Nachrichten an den Antragsteller |
| `appeals.priority` | Dringlichkeit ändern |
| `appeals.decide` | Entscheidung vorschlagen (Vier-Augen) |
| `appeals.approve` | **Genehmigen** (kritisch) |
| `appeals.reject` | **Ablehnen** (kritisch) |
| `appeals.unban` | **Entbannung auslösen** (kritisch) |
| `appeals.settings` | Fristen und Regeln (kritisch) |
| `members.view.appeals.all` | Anträge im Member Center |

Drei Trennungen tragen die Sicherheit:

1. **`review` ≠ `decide`.** Wer Rückfragen stellt, muss nicht entbannen dürfen.
2. **`decide` ≠ `unban`.** Und `unban` verlangt zusätzlich `moderation.unban`.
3. **`comment.internal` ≠ `message`.** Eine Notiz bleibt drin, eine Nachricht
   geht hinaus.

---

## 11. Automation Engine (§36)

Appeals melden Ereignisse über den **bestehenden** Bus. Es gibt keine zweite
Engine.

```
appeal.submitted        appeal.assigned      appeal.status_changed
appeal.message_received appeal.escalated     appeal.approved
appeal.rejected         appeal.unban_failed  appeal.closed
```

Eine Automation kann darauf reagieren: melden, zuweisen, erinnern.

**Was sie nicht kann: genehmigen, ablehnen, entbannen.** Diese Aktionen sind bei
der Engine nicht angemeldet, und der Sicherheitstest belegt, dass das Modul
überhaupt kein `registerAction` aufruft. Eine Entbannung durch eine Bedingung,
die versehentlich immer zutrifft, wäre der teuerste Fehler, den dieses Modul
machen könnte.

Die Ereignisnutzdaten tragen **keine internen Angaben** — sie landen im
Automationsverlauf und in Vorschauen.

---

## 12. Es gibt keine Team Inbox

Die Aufgabenstellung sieht eine Integration vor, **falls** eine zentrale Inbox
existiert. Sie existiert in SwissHub nicht — die Suche danach ergab nichts.

Ein zweites Posteingangs-Datenmodell zu bauen wäre genau die Parallelarchitektur,
die hier nicht entstehen soll. Stattdessen dasselbe, was Verifikation, Level und
Automationen tun:

- ein **Meldekanal** aus den Moduleinstellungen
- die **Übersichtsseite** mit genau zwei Reitern, «Offen» und «Entschieden»
- die **Automation Engine** für alles Weitere

Ebenso gibt es **keinen zentralen Notification-Service**. Jedes Modul meldet über
Discord-Kanäle; dieses auch.

### Die Fallliste: zwei Reiter

Das Team hat genau zwei Fragen an die Liste — woran muss ich arbeiten, und was
ist erledigt. Vorher standen dort sieben Reiter («Mir zugewiesen»,
«Unzugewiesen», «Wartet auf Antragsteller», «Eskaliert» …). Jeder einzelne war
nachvollziehbar; zusammen waren sie eine Sortieraufgabe vor der eigentlichen
Arbeit, und mehrere zeigten dieselben Fälle noch einmal.

Welche Status wohin gehören, entscheidet `statusFuerAnsicht()` im Modul —
nicht die Seite. Die Statusliste stand vorher an drei Stellen ausgeschrieben,
und eine Zahl, die anders zählt als die Liste darunter, ist schlimmer als
keine Zahl. Die Zahl am Reiter kommt aus `zaehleAnsichten()` mit denselben
Filtern wie die Liste, Bearbeitereinschränkung eingeschlossen.

| Reiter | Status |
| --- | --- |
| **Offen** | `SUBMITTED`, `UNDER_REVIEW`, `WAITING_FOR_APPLICANT`, `WAITING_FOR_STAFF`, `ESCALATED`, `DECISION_PENDING` |
| **Entschieden** | `APPROVED`, `REJECTED`, `WITHDRAWN`, `EXPIRED`, `RESOLVED_EXTERNALLY`, `CLOSED` |

«Entschieden» heisst hier: nicht mehr offen. Das umfasst mehr als genehmigt
und abgelehnt — auch zurückgezogen, abgelaufen und anderweitig erledigt. Sie
eine »Entscheidung« zu nennen ist unsauber; sie aus beiden Reitern
herauszuhalten wäre schlimmer, denn dann verschwänden sie ganz aus der Liste.
Welcher Endzustand es war, steht an jeder Zeile.

`DRAFT` gehört in keinen der beiden: ein angefangener, nie eingereichter
Antrag ist für das Team noch nicht entstanden.

Suche und die Einschränkung auf eigene Fälle wirken innerhalb der Reiter
unverändert weiter — reduziert wurden nur die Status-Reiter selbst.

---

## 13. AI (§37)

Die AI fasst zusammen und extrahiert Kernaussagen. Sie bekommt den Antrag und
das Gespräch — **interne Kommentare werden für sie nicht einmal geladen**.

Sie darf nicht:

- genehmigen oder ablehnen
- entbannen
- eine Risikobewertung abgeben, aus der sich eine Entscheidung ableiten liesse.
  Ein «Risk Score» sieht aus wie eine Zahl und wirkt wie ein Urteil; genau
  deshalb gibt es hier keinen.

Der Systemtext sagt ihr das ausdrücklich, und ein Test hält die Formulierungen
fest. Über dem Ergebnis steht in der Oberfläche: «AI-generierte Zusammenfassung —
die Entscheidung trifft das Team.»

Der Antragstext ist fremder Text: er steht zwischen ausgewiesenen Markierungen,
das Modell bekommt keine Werkzeuge und ein erzwungenes Antwortformat — dasselbe
Verfahren wie bei der Verifikation.

---

## 14. Sicherheit

| Bereich | Massnahme |
| --- | --- |
| IDOR | Kennung aus der Sitzung in der Abfrage; `NOT_FOUND` statt `FORBIDDEN` |
| XSS | Inhalte als Text gerendert, nie als Markup; `sanitizeText` serverseitig |
| Doppelklick | Idempotenzschlüssel je geöffnetem Formular |
| Spam | `appealSubmit`: 3 je Stunde · `appealMessage`: 20 je 10 min |
| Uploads | Positivliste (PNG, JPG, WebP, PDF, TXT), Zufallsname, Grössen- und Anzahlgrenze |
| Download | Route mit Eigentums- **oder** Berechtigungsprüfung, `attachment` + `nosniff` |
| Dateinamen | Pfadtrenner und Steuerzeichen entfernt |
| Grosse Nutzdaten | Zod-Längengrenzen je Feld |
| Gefälschte Kennung | wird ignoriert — die Kennung kommt aus der Sitzung |

Anhänge liegen unter `SWISSHUB_UPLOAD_DIR/appeals`, **ausserhalb** des statisch
bedienten Bereichs. Ohne die Route kommt niemand an die Bytes, auch nicht mit
dem Speichernamen.

---

## 15. Scheduler (§28, §44)

Ein Bot-Job alle zehn Minuten, neustartsicher, weil der Zustand in der Datenbank
steht und nicht in einem Zeitgeber:

| Aufgabe | Wirkung |
| --- | --- |
| Externe Entbannung erkennen | Bann weg → `RESOLVED_EXTERNALLY`, der Antragsteller erfährt es |
| Ablauf ohne Antwort | `waitingUntil` überschritten → `EXPIRED` |
| Anhänge aufräumen | nach der Aufbewahrungsfrist geschlossener Anträge |

Antwortet Discord nicht, wird **nichts** geschlossen: «keine Antwort» ist nicht
«kein Bann».

---

## 16. Aufbewahrung (§46, §47)

- **Anträge werden nie hart gelöscht.** Auch ein zurückgezogener bleibt — er ist
  Teil der Moderationsspur.
- **Anhänge verschwinden** nach der eingestellten Frist (Vorgabe 180 Tage nach
  Abschluss). Der Eintrag bleibt mit `deletedAt`: «hier gab es eine Datei» ist
  eine Auskunft, die erhalten bleiben soll.

---

## 17. Audit

| Aktion | Ereignis |
| --- | --- |
| Eingereicht | `APPEAL_SUBMITTED` |
| Zugewiesen | `APPEAL_ASSIGNED` |
| Zustand geändert | `APPEAL_STATUS_CHANGED` |
| Priorität geändert | `APPEAL_PRIORITY_CHANGED` |
| Interne Notiz | `APPEAL_INTERNAL_COMMENT` |
| Rückfrage / Antwort | `APPEAL_STAFF_MESSAGE` / `APPEAL_APPLICANT_REPLIED` |
| Entscheidung vorgeschlagen | `APPEAL_DECISION_PROPOSED` |
| Genehmigt / Abgelehnt | `APPEAL_APPROVED` / `APPEAL_REJECTED` |
| Entbannung | `APPEAL_UNBAN_ATTEMPTED` / `_SUCCEEDED` / `_FAILED` |
| Zurückgezogen / Abgelaufen | `APPEAL_WITHDRAWN` / `APPEAL_EXPIRED` |
| Anhang geladen | `APPEAL_ATTACHMENT_DOWNLOADED` — nur bei fremden Dateien |

Der eigene Anhang des Antragstellers wird nicht protokolliert: das wäre eine
Bewegungsakte über jemanden, der ohnehin schon gebannt ist.

---

## 18. Datenbank

| Tabelle | Wofür |
| --- | --- |
| `Appeal` | der Antrag mit Momentaufnahme, Zustand und Entscheidung |
| `AppealCounter` | die Fallnummer, je Gilde und Jahr |
| `AppealMessage` | das Gespräch, beide Richtungen |
| `AppealInternalComment` | interne Notizen — eigene Tabelle, kein Feld an der Nachricht |
| `AppealAttachment` | Anhänge |
| `AppealEvent` | die Zeitleiste mit `PUBLIC`/`INTERNAL` |

Die Fallnummer entsteht über `INSERT … ON CONFLICT … RETURNING` — dasselbe
Verfahren wie bei den Tickets. `MAX(n) + 1` gäbe zwei gleichzeitigen
Einreichungen dieselbe Zahl.

Migration `20260830163608_appeals`: 29 Anweisungen, kein DROP, kein TRUNCATE.

---

## 19. Was bewusst fehlt

- **Kein Entwurf in der Datenbank.** Ein unfertiger Antrag liegt im Browser
  (`sessionStorage`). Ein Entwurf in der Datenbank wäre ein Datensatz über
  jemanden, der sich noch gar nicht entschieden hat. Er verschwindet mit dem
  Tab — das ist der Preis, und er ist klein.
- **Keine Knöpfe auf Discord.** Freigegeben wird im Dashboard, wo die
  Berechtigung geprüft und die Entscheidung protokolliert wird. Ein zweiter Weg
  zur selben Wirkung wäre der, den niemand prüft.
- **Keine Bearbeiter-Bestenliste.** Die Kennzahlen zeigen Median und
  Genehmigungsquote — keine Leistungsbewertung einzelner Personen. Ein Test
  hält fest, dass keine Kennzahl eine Moderatorkennung trägt.
- **Kein Appeal gegen Jail oder Timeout.** Beide laufen von selbst ab und der
  Betroffene ist weiterhin auf dem Server — für ihn gibt es andere Wege.

---

## 20. Fehlersuche

| Symptom | Wo nachsehen |
| --- | --- |
| Antragsteller sieht «kein Bann» | Besteht der Bann bei Discord wirklich noch? |
| Antrag nicht einreichbar | Sperrfrist oder laufender Antrag — beides steht im Befund |
| Entbannung ausstehend | Roter Balken im Fall; `unbanStatus` = `PARTIAL` |
| Antrag plötzlich geschlossen | `RESOLVED_EXTERNALLY` — jemand hat den Bann von Hand aufgehoben |
| Keine Meldungen im Team | Meldekanal in den Moduleinstellungen gesetzt? |
| Antrag läuft nicht ab | `ablaufTageOhneAntwort` auf 0? Läuft der Bot? |
