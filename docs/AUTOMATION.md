# Automation Engine

Wenn etwas geschieht, geschieht etwas anderes. Ereignisse aus allen Modulen,
Bedingungen mit Klammern, Schritte mit Wartezeiten - mit Probelauf, Verlauf und
menschlicher Freigabe für alles, was sich nicht zurücknehmen lässt.

---

## 1. Wozu

Vorher war jede Automatisierung ein Stück Code: die Willkommensnachricht im
Verifikationsmodul, die Erinnerung im Kalender, die Rolle beim Levelaufstieg.
Jede für sich richtig - und jede eine Änderung am Quelltext, ein Deployment und
eine Stelle mehr, an der etwas kaputtgehen kann.

Jetzt: **Automationen** im Dashboard. Auslöser wählen, Bedingung setzen,
Schritte bauen, Probelauf machen, einschalten.

Was dabei ausdrücklich **nicht** entsteht: eine Plattform, auf der sich Code
ausführen lässt. Dazu gleich mehr - es ist die wichtigste Entscheidung dieses
Moduls.

---

## 2. Architektur auf einer Seite

```
Ein Modul meldet etwas          Der Bot verteilt es            Etwas geschieht
──────────────────────          ───────────────────            ───────────────

verification.verify()           alle 5 Sekunden:               nachricht.kanal
  │                             offene Ereignisse holen,         │
  ▼                             beanspruchen, passende           ▼
meldeEreignis(...)              Automationen starten          Discord
  │                                    │
  ▼                                    ▼
AutomationEvent  ──────────────►  AutomationRun ──► AutomationStepRun
(Ausgangstabelle)                 (Stellung + Kontext)
                                       │
                                       │ warten / Freigabe
                                       ▼
                                  AutomationJob
                                  (der Wecker)
```

Die Abhängigkeit zeigt in genau eine Richtung:

```
@swisshub/automation      Kern: Vertrag, Registries, Bus, Zeitplaner, Ausführer
        ▲                 kennt KEIN Modul
@swisshub/modules         Fähigkeiten: jedes Modul meldet Ereignisse an und
        ▲                 trägt Trigger, Bedingungen und Aktionen ein
apps/web, apps/bot        Oberfläche und Takt
```

Steht im Kern je ein `switch` über Modulnamen, ist etwas falsch gelaufen.

| Baustein | Wofür |
| --- | --- |
| `contract.ts` | Ereignisvertrag, Registry der Ereignisse, harte Grenzen |
| `registry.ts` | Trigger, Bedingungen, Aktionen - alles anmeldbar |
| `bus.ts` | Veröffentlichen, holen, beanspruchen, aufräumen |
| `scheduler.ts` | Die Job-Tabelle: Zeitpläne, Wartezeiten, Wiederholungen |
| `executor.ts` | Ein Lauf: Bedingungen, Schritte, Stellung, Freigaben |
| `dispatcher.ts` | Ereignis → passende Automationen; die drei Takte |
| `limits.ts` | Rate, Gleichzeitigkeit, Schleifenschutz |
| `context.ts` | Platzhalter - und was sie erreichen dürfen |
| `webhook.ts` | Ausgehende Aufrufe mit Schutz vor dem inneren Netz |
| `validate.ts` | Die Prüfung vor dem Einschalten |
| `store.ts` / `runs.ts` | Automationen und ihr Verlauf |

---

## 3. Warum eine Tabelle und kein Bus im Speicher

Drei Gründe, und jeder allein genügte:

1. **Zwei Prozesse.** Die WebApp erzeugt Ereignisse (jemand schaltet ein
   Mitglied frei), verarbeitet werden sie im Bot - er hat die
   Discord-Verbindung. Ein Bus im Arbeitsspeicher erreichte den anderen Prozess
   nie.
2. **Neustart.** Was zwischen Veröffentlichung und Verarbeitung liegt, überlebt
   einen Neustart nur, wenn es geschrieben wurde.
3. **Genau einmal.** Erst die Zeile in der Datenbank lässt festhalten, dass
   dieses Ereignis bereits verteilt wurde.

Dasselbe gilt für Wartezeiten. Ein `setTimeout` über sieben Tage wäre nach dem
ersten Deployment weg - und niemand merkte es, weil im Verlauf nichts stünde.

**Kein Redis.** Wie überall im Projekt ist die Datenbank die Wahrheit.

---

## 4. Genau einmal - das Verfahren

Überall dasselbe Muster, weil ein zweites niemand geprüft hätte:

```sql
UPDATE ... SET ... WHERE id = ? AND <noch-nicht-Bedingung>
```

Wer null Zeilen ändert, war zu spät und lässt die Finger davon.

| Was | Die Bedingung |
| --- | --- |
| Ereignis verteilen | `processedAt IS NULL` |
| Job beanspruchen | `status = 'PENDING'` |
| Wartenden Lauf fortsetzen | `status = 'WAITING'` |
| Freigabe entscheiden | `status = 'PENDING'` |

Dazu ein eindeutiger Index auf `AutomationRun.idempotencyKey`: dasselbe
Ereignis erzeugt für dieselbe Automation genau einen Lauf, auch wenn Discord es
doppelt liefert oder ein Verteiler nach einem Absturz erneut darauf stösst.

Stirbt ein Prozess mit einem Job in der Hand, holt ihn `holeVerwaisteZurueck()`
nach der Pachtfrist von fünf Minuten zurück - lieber spät wiederholen als
doppelt ausführen, während der erste noch läuft.

---

## 5. Was die Engine nicht ist (§44)

Eine Automation wird von jemandem gebaut, der Schreibrecht auf Automationen
hat - nicht von jemandem mit Serverzugriff. Deshalb gibt es hier:

- **kein `eval`**, kein `new Function`, kein beliebiges JavaScript
- **keine Shell**, keine Docker- oder Serverbefehle
- **keine freie SQL-Abfrage**
- **keinen Zugriff auf Umgebungsvariablen**
- **keinen Zugriff auf Geheimnisse** aus der Integrationsverwaltung
- **keine Dateisystemoperationen**

Ein Platzhalter ist ein Pfad in eine **Freigabeliste**:

```
payload.*   event.*   steps.*   guildId   now   runId
```

und sonst nichts. `{{process.env.DATABASE_URL}}` wird zur leeren Zeichenkette
und als fehlender Pfad gemeldet. Der Discord-Zugang liegt im Kontext, ist über
einen Platzhalter aber nicht erreichbar: die Auflösung liest aus einer
ausdrücklichen Projektion, in der er nicht vorkommt.

`tests/unit/automation-security.test.ts` liest den Quelltext der Engine und
schlägt fehl, sobald eine dieser Zusagen bricht. Ein Kommentar hielte niemanden
auf; ein roter Test schon.

---

## 6. Was die Engine nicht tut (§7, §33)

**Kein Bannen, Kicken, Timeout, Jail und kein Ablehnen einer Verifikation.**
Auch nicht über die AI.

Das ist keine Lücke, sondern die wichtigste Entscheidung dieses Moduls. Eine
Sanktion trifft einen Menschen, ist von aussen kaum von einer Fehlfunktion zu
unterscheiden und lässt sich nicht zurücknehmen - ein fälschlich gebanntes
Mitglied ist weg, auch wenn der Bann eine Minute später fällt. Eine Bedingung,
die versehentlich immer zutrifft, wäre damit kein Ärgernis, sondern ein Schaden
am Server.

Automationen dürfen **melden und vorbereiten**: eine Nachricht an den
Moderationskanal, eine Markierungsrolle, ein Eintrag im Verlauf. Die
Entscheidung trifft ein Mensch über die dafür vorgesehene Oberfläche, wo sie
geprüft und protokolliert wird.

Die AI-Aktion liefert eine Einschätzung als Wert - was daraus folgt, steht als
Bedingung in der Automation und ist damit sichtbar und prüfbar. Eine AI, die
selbst sanktioniert, wäre eine Blackbox mit Banngewalt.

Wer eine solche Aktion künftig doch anmeldet, **muss** `requiresApproval: true`
setzen; die Engine hält den Lauf dann an und wartet auf einen Menschen. Der
Sicherheitstest verlangt genau das.

---

## 7. Berechtigungen

Fein geschnitten, weil die Unterschiede zählen:

| Berechtigung | Was sie erlaubt |
| --- | --- |
| `automations.view` | Übersicht, Vorlagen, Zustand |
| `automations.create` | Entwürfe anlegen |
| `automations.edit` | Auslöser, Bedingungen, Schritte ändern |
| `automations.delete` | Archivieren |
| `automations.enable` | **Ein- und Ausschalten** |
| `automations.execute` | Von Hand starten, Probelauf |
| `automations.history.view` | Verlauf und Fehler |
| `automations.approve` | Angehaltene Aktionen freigeben |
| `automations.system.manage` | Systemautomationen |
| `automations.webhooks.manage` | Nach aussen senden |

Wer eine Automation **anlegen** darf, darf sie damit noch nicht
**einschalten**: erst das Einschalten macht aus einem Entwurf etwas, das nachts
von selbst Rollen vergibt.

Dazu kommt eine Prüfung, die sich aus dem *Inhalt* ergibt: eine Aktion darf
eine eigene Berechtigung verlangen. `level.xp` verlangt `level.members.manage` -
dieselbe wie der Griff von Hand. Ohne diese Prüfung wäre die Engine ein Weg,
jede Berechtigung des Systems zu umgehen. Sie greift an drei Stellen: beim
Speichern, beim Einschalten und beim Starten von Hand.

**Backend-Durchsetzung ist Pflicht (§21).** Die Oberfläche kennzeichnet eine
Aktion, für die die Berechtigung fehlt - abgewiesen wird sie serverseitig.

---

## 8. Schleifenschutz (§17)

Zwei Mauern, weil eine nicht genügt:

1. **Tiefe.** Jedes Ereignis trägt `correlationId`, `causationId` und `depth`.
   Über `LIMITS.maxDepth` (5) hinaus wird nicht mehr veröffentlicht.
2. **Der Kreis.** Dieselbe Automation ein zweites Mal in derselben
   Ursachenkette wird sofort abgewiesen - unabhängig von der Tiefe. Ohne diese
   zweite Prüfung bräuchten zwei Automationen, die sich gegenseitig auslösen,
   fünf Ebenen bis zur Tiefengrenze: fünf ausgeführte Runden mit echten
   Wirkungen auf Discord.

Eine neue Kette wird nicht gebremst: jeder Beitritt beginnt eine eigene, und
eine Automation auf «Mitglied beigetreten» soll nicht nach dem ersten Mal
verstummen.

Dazu je Lauf höchstens `maxEmittedEvents` (5) selbst ausgelöste Ereignisse und
je Automation eine Ratengrenze pro Minute, gezählt in der Datenbank - ein
Zähler im Arbeitsspeicher wäre je Prozess einer und nach einem Neustart weg.

---

## 9. Webhooks (§30)

Eine Automation darf eine Adresse aufrufen, die jemand mit Schreibrecht
eingetragen hat. Ohne Schranken wäre das eine Anfrage aus dem Inneren des
Servers heraus. Deshalb, der Reihe nach:

1. **Nur HTTPS**, nur Port 443.
2. **Keine Zugangsdaten in der Adresse** - `https://user:pass@…` wäre ein Weg,
   ein Geheimnis in eine Automation zu schreiben.
3. **Namen werden aufgelöst und jede Adresse geprüft.** `intern.example.com`
   kann auf `10.0.0.5` zeigen; nur die aufgelöste Adresse verrät das. Zeigt
   *eine* der Adressen nach innen, wird abgelehnt.
4. **Keine Weiterleitungen** - sonst wäre Schritt 3 wertlos.
5. **Frist** (10 s) und **Grössengrenze** (2 000 Zeichen der Antwort).

Gesperrt sind Schleife, private Netze, verbindungslokal (samt der
Metadatenadresse `169.254.169.254` der Cloud-Anbieter), Anbieter-NAT,
Mehrfachziel und Reserviertes - in IPv4 wie in IPv6, eingebettete
IPv4-Adressen eingerechnet.

Die Zieladresse steht **nicht** im Protokoll: sie kann einen Token im Pfad
tragen, wie es bei Discord- und Slack-Webhooks üblich ist.

Wer eine Gegenstelle mit Anmeldung ansprechen will, baut dafür eine Integration -
dort gehören Geheimnisse hin (§20).

---

## 10. Der Probelauf (§23)

Bedingungen werden **echt** geprüft, Aktionen **beschrieben**. Das ist die
einzige Möglichkeit, eine Automation gefahrlos anzusehen - und deshalb darf er
nichts auslassen, was die Antwort verfälschen würde.

```
✓ Mitglied ist kein Bot                 erfüllt
✗ Kontoalter < 7 Tage                   nicht erfüllt
→ Es wäre nichts geschehen.
```

Bedingungen sind darum **lesend**. Eine Bedingung mit Nebenwirkung machte den
Probelauf gefährlich statt hilfreich.

Ein Probelauf bekommt einen eigenen, immer neuen Idempotenzschlüssel: er soll
sich beliebig oft wiederholen lassen.

---

## 11. Versionierung (§12)

Jede Änderung erhöht `version` und schreibt eine Fassung. Ein Lauf zeigt auf
die Fassung, mit der er begonnen hat.

Der Grund steht in einem Test: ändert jemand eine Automation, während ein Lauf
zwischen zwei Schritten wartet, macht der Lauf nach dem Aufwachen trotzdem das,
was beim Start dastand. Andernfalls täte eine Automation etwas, das niemand
ausgelöst hat.

**Löschen ist ein Archivieren.** Die Zeile bleibt, verschwindet aus allen
Listen und wird von keinem Verteiler mehr berücksichtigt - wer wissen will,
warum vor drei Wochen tausend Nachrichten hinausgingen, fände sie sonst nicht
mehr.

---

## 12. Fehler verschwinden nicht (§26)

Ein gescheiterter Lauf bleibt als `FAILED` liegen und steht im
Fehler-Posteingang unter **Automationen → Fehler**. Eine Automation, die still
scheitert, ist schlimmer als gar keine: man verlässt sich auf sie.

Im Verlauf steht die **bereinigte** Meldung (`error.userMessage`), nie die
interne. Ein Schritt kann `Bei Fehler: weitermachen` tragen - dann geht der
Lauf weiter und der Schritt bleibt trotzdem als gescheitert vermerkt.

Wiederholt wird nur, was sich lohnt: eine Ratengrenze oder ein Ausfall der
Gegenstelle ja, eine fehlende Berechtigung oder ein gelöschter Kanal nein - das
wird beim dritten Mal nicht anders und kostet nur.

---

## 13. Aufbewahrung (§34)

Stündlich, mit den Fristen aus den Moduleinstellungen:

| Was | Vorgabe | Ausnahme |
| --- | --- | --- |
| Läufe | 30 Tage | wartende, auf Freigabe hoffende und gescheiterte bleiben |
| Ereignisse | 7 Tage | nur verarbeitete |
| Jobs | 7 Tage | nur erledigte und tote |

Ein Lauf, der seit acht Tagen auf einen Menschen wartet, verschwände sonst
genau dann, wenn dieser Mensch aus den Ferien zurückkommt.

---

## 14. Der Takt im Bot

Vier Jobs in `apps/bot/src/jobs.ts`, überlappungsfrei wie alle anderen:

| Job | Abstand | Wofür |
| --- | --- | --- |
| `automation-dispatch` | 5 s | offene Ereignisse verteilen |
| `automation-jobs` | 10 s | fällige Wecker; zuerst verwaiste zurückholen |
| `automation-schedule` | 5 min | kommende Termine sichern |
| `automation-retention` | 60 min | aufräumen |

Der Zustand steht unter **System → Gesundheit**: offene, beanspruchte und tote
Aufgaben sowie die Verzögerung der ältesten fälligen. Die Verzögerung ist die
aussagekräftigste Zahl - steht sie bei Stunden, läuft der Takt nicht mehr, und
das sieht man an keiner anderen.

---

## 15. Ein neues Modul anschliessen

Drei Schritte. An der Engine ändert sich dabei **nichts**.

### 15.1 Ein Ereignis anmelden

In `packages/modules/src/automation/events.ts`:

```ts
registerEvent({
  type: 'turnier.gestartet',          // <modul>.<sache>, klein, mit Punkten
  label: 'Turnier hat begonnen',
  description: 'Ein Turnier ist in die erste Runde gegangen.',
  module: 'tournaments',
  payloadSchema: z.object({
    tournamentId: z.string(),
    titel: z.string(),
    teilnehmer: z.number().int(),
  }),
  variables: [
    { path: 'payload.titel', label: 'Titel', type: 'string' },
    { path: 'payload.teilnehmer', label: 'Teilnehmerzahl', type: 'number' },
  ],
});
```

Drei Regeln:

1. **Der Name bleibt.** Ändert sich die Bedeutung der Nutzdaten, steigt
   `schemaVersion` - der Name wird nicht umgedeutet.
2. **`variables` ist das Versprechen.** Was dort steht, ist zugesagt und darf
   nicht verschwinden: eine Automation zeigt darauf.
3. **Keine Geheimnisse, keine Rohdaten.** Nutzdaten landen im Verlauf und in
   Vorschauen.

### 15.2 Das Ereignis melden

Dort, wo es geschieht - nach der Prüfspur, nie davor:

```ts
const { meldeEreignis } = await import('../automation/emit');
await meldeEreignis(
  'turnier.gestartet',
  { tournamentId: turnier.id, titel: turnier.name, teilnehmer: anzahl },
  { guildId: turnier.guildId, actorId: actor.discordId, entityId: turnier.id },
);
```

`meldeEreignis` **wirft nie**. Das Melden ist die Nebensache; was das Modul
getan hat, ist die Hauptsache und bereits getan. Ist das Automation-Modul
ausgeschaltet, wird nichts geschrieben.

### 15.3 Eine Aktion beisteuern (optional)

In `packages/modules/src/automation/actions.ts`:

```ts
registerAction({
  id: 'turnier.ankuendigen',
  label: 'Turnier ankündigen',
  description: 'Schreibt die Ankündigung in den Turnierkanal.',
  group: 'Turniere',
  requiredPermission: 'tournaments.manage',   // dieselbe wie von Hand
  configSchema: z.object({ tournamentId: z.string() }),
  fields: [{ key: 'tournamentId', label: 'Turnier', type: 'text', required: true }],
  async execute(config, context) {
    // ... und bei bereits bestehender Wirkung: status 'NO_OP'
    return { status: 'SUCCESS', detail: 'Angekündigt.' };
  },
  async preview(config) {
    return 'Würde das Turnier ankündigen.';   // für den Probelauf
  },
  async validate(config, umgebung) {
    return [];                                 // vor dem Einschalten
  },
});
```

Vier Dinge, die eine Aktion einhalten muss:

- **`NO_OP`, wenn die Wirkung bereits bestand.** Eine Rolle, die schon vergeben
  ist, ist kein Fehler - sie ist der gewünschte Zustand. Ein Fehler daraus zu
  machen hiesse, dass jede Wiederholung scheitert, obwohl alles stimmt.
- **`requiredPermission`**, wenn dieselbe Wirkung von Hand eine Berechtigung
  verlangt.
- **`preview`**, sonst steht im Probelauf nur der Name der Aktion und die
  eigentliche Frage bleibt unbeantwortet: *was genau* würde geschehen.
- **`requiresApproval: true`**, wenn sie sich nicht zurücknehmen lässt.

Der Builder zeigt die neue Aktion, sobald sie angemeldet ist. Keine Datei in
`apps/web` und keine im Kern muss dafür angefasst werden.

---

## 16. Datenbank

Sieben Tabellen, alle additiv hinzugekommen:

| Tabelle | Wofür |
| --- | --- |
| `AutomationEvent` | die Ausgangstabelle - was geschehen ist |
| `Automation` | die Automation selbst |
| `AutomationVersion` | die Fassungen |
| `AutomationRun` | ein Lauf: Stellung, Kontext, Ausgang |
| `AutomationStepRun` | jeder Schritt mit seinem Ergebnis |
| `AutomationJob` | die Wecker |
| `AutomationApproval` | angehaltene Aktionen |

Migrationen: `20260828223009_automation_engine` (36 CREATE, kein DROP) und
`20260828234500_automation_concurrency_key` (zwei nullbare Spalten). Keine
bestehende Zeile wird verändert.

---

## 17. Was bewusst fehlt (§53)

- **Kein Graph-Editor.** Die Schrittfolge ist ein Baum aus Aktion, Warten und
  Verzweigung. Ein vollständiger Graph brächte Zyklen, unerreichbare Zweige und
  Zusammenführungen, die jede Fehlersuche zur Archäologie machen. SwissHub
  braucht zuerst eine Engine, die man versteht und der man traut.
- **Keine Schleife.** Verzweigungen tragen ihre Zweige in sich, statt auf
  Stellungen zu zeigen - damit ist ein Zyklus nicht formulierbar.
- **Keine Sanktionen.** Siehe Abschnitt 6.
- **Keine freien Kopfzeilen im Webhook.** Mehr Freiheit wäre mehr
  Angriffsfläche ohne erkennbaren Gewinn.

---

## 18. Fehlersuche

| Symptom | Wo nachsehen |
| --- | --- |
| Automation läuft nicht | Ist sie eingeschaltet? Prüfen im Builder |
| Läuft, tut aber nichts | Verlauf: `SKIPPED` heisst, die Bedingungen trafen nicht zu |
| Alles wartet | System → Gesundheit: Verzögerung des Zeitplaners |
| Schritt scheitert immer | Automationen → Fehler; die Meldung nennt den Grund |
| Wait kehrt nicht zurück | `AutomationJob` mit `kind = 'RESUME'` und `status` |
| Nichts kommt an | Läuft der Bot? Der Verteiler ist ein Bot-Job |
