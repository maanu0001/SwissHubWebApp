# Discord-Log-Kanäle

SwissHub führt seine Logs in der Datenbank. Diese Erweiterung gibt sie
zusätzlich in Discord aus — als Embed in einem Kanal, den das Team selbst
wählt.

**Discord ist dabei die Darstellung, nicht die Wahrheit.** Wer eine
Log-Nachricht in Discord löscht, löscht kein Log. Wer sie bearbeitet, ändert
nichts. Und wenn Discord ausfällt, bleibt die Aktion, die das Log ausgelöst
hat, unverändert erfolgreich.

## 1. Der Weg

```
Aktion (WebApp · Bot · direkt in Discord · Zeitsteuerung)
        ↓
SwissHub-Logeintrag        ModerationAction  oder  DiscordEvent
        ↓
zentraler Anknüpfpunkt     meldeMassnahme()  oder  recordEvent()
        ↓
Dispatcher                 Kategorie → Ziel → Embed → Zustellung einreihen
        ↓
Zusteller (im Bot)         claim → senden → Erfolg oder Retry
        ↓
Discord-Kanal
```

## 2. Zwei Anknüpfpunkte, nicht zwanzig

Der Kern der Architektur ist eine Entscheidung darüber, was **nicht** gebaut
wurde: kein `sendeLog(...)` in jedem Event-Handler. Beim nächsten neuen
Ereignis vergisst es jemand, und ein fehlendes Log sieht aus wie ein Ereignis,
das nicht stattgefunden hat.

Stattdessen genau zwei Stellen:

| Anknüpfpunkt       | Datei                                       | speist                                  |
| ------------------ | ------------------------------------------- | --------------------------------------- |
| `meldeMassnahme()` | `packages/modules/src/moderation/events.ts` | `MODERATION`                            |
| `recordEvent()`    | `packages/modules/src/analytics/events.ts`  | `MESSAGES`, `VOICE`, `MEMBERS`, `ADMIN` |

Beide schrieben ihren Logeintrag ohnehin schon. Sie melden ihn jetzt zusätzlich
weiter — und tun das für **alle** Quellen gleichermassen: eine Massnahme aus
dem Dashboard, aus einem Slash-Befehl, direkt in Discord erkannt oder von der
Zeitsteuerung ausgelöst nimmt denselben Weg.

## 3. Kategorien

Fünf, und jede hat eine tatsächliche Quelle im System. Eine Kategorie ohne
Quelle wäre ein Auswahlfeld, das nie etwas sendet — schlimmer als ein
fehlendes Feld, weil jemand darauf vertraut.

| Kategorie    | Quelle                                 | Beispiele                             |
| ------------ | -------------------------------------- | ------------------------------------- |
| `MODERATION` | `ModerationAction`                     | Bann, Kick, Timeout, Aufhebung        |
| `MESSAGES`   | `DiscordEvent` / MESSAGE               | gelöscht, bearbeitet                  |
| `VOICE`      | `DiscordEvent` / VOICE                 | beigetreten, verlassen, gewechselt    |
| `MEMBERS`    | `DiscordEvent` / MEMBER                | Beitritt, Austritt, Rollen, Spitzname |
| `ADMIN`      | `DiscordEvent` / ROLE, CHANNEL, SERVER | Kanal gelöscht, Rolle bearbeitet      |

**Verifikation und Tickets fehlen bewusst.** Ihre Spuren liegen im Audit Log
und — wenn die Automation Engine läuft — als Automationsereignis. Einen von
der Modulaktivierung unabhängigen zentralen Punkt haben sie nicht, und ihn zu
erfinden hiesse, ein zweites Logsystem zu bauen. Wie sie nachgerüstet werden,
steht in Abschnitt 12.

## 4. Was einmal gemeldet wird und was zweimal nicht

Ein Bann erzeugt **beides**: einen Akteneintrag und ein Statistikereignis.
Beides zu senden hiesse, dieselbe Sache zweimal zu melden. Die Akte gewinnt —
sie kennt Grund, Quelle und Handelnden.

Zwei Regeln setzen das um (`registry.ts`):

- **`AUS_DER_AKTE`** — `MEMBER_BAN`, `MEMBER_UNBAN`, `MEMBER_TIMEOUT`,
  `MEMBER_TIMEOUT_END` gehen über den Statistikpfad nie hinaus.
- **`moderationActionId` gesetzt** — ein Ereignis, das der bestehende Abgleich
  einer Massnahme zugeordnet hat, schweigt ebenfalls.

Ein **Austritt** steht bewusst nicht in dieser Liste: er ist auch dann eine
Mitgliederbewegung, wenn er ein Kick war. Beides sind verschiedene Aussagen
über denselben Moment und gehen standardmässig in verschiedene Kanäle.

Nicht ausgegeben werden ausserdem (`NICHT_NACH_DISCORD`):

- **`NOTE`** — eine interne Notiz zur Akte. Sie in einen Kanal zu schreiben,
  den das halbe Team liest, ist genau das, wogegen es sie gibt.
- **`JAIL_*`** — das Jail-Modul postet bereits selbst, mit einer eigenen,
  ausführlicheren Darstellung und einem eigenen Kanal in seinen Einstellungen.

## 5. Schleifensicherung

Ein Embed im Log-Kanal ist eine Nachricht. Die Nachricht wäre ein Ereignis.
Das Ereignis wieder ein Embed.

Zwei Riegel, und der zweite ist der verlässliche:

1. Der Bot zeichnet Nachrichten von Bots ohnehin nicht auf — das galt schon
   vorher.
2. Der Dispatcher gibt **kein Ereignis aus einem eingerichteten Log-Kanal**
   aus. Eine Zusage, die an einer einzigen `if`-Zeile in einem anderen Paket
   hängt, ist keine.

## 6. Nichts zweimal

`DiscordLogDelivery.dedupeKey` ist eindeutig und lautet
`<quelle>:<logId>:<channelId>`. Derselbe Eintrag in denselben Kanal ergibt
denselben Schlüssel — **die Datenbank** weist die zweite Zustellung ab, nicht
der Anwendungscode. Das gilt damit auch über einen Neustart hinweg und für
zwei gleichzeitige Läufe.

Dass der Kanal Teil des Schlüssels ist, hat einen Grund: zwei Kategorien
dürfen denselben Kanal verwenden, und dann sind es zwei Einträge, nicht einer.

## 7. Zustellung, Retry, Reihenfolge

Der Dispatcher **sendet nicht**. Er reiht ein. Gesendet wird alle fünf
Sekunden vom Job `logs-zustellung` im Bot — sonst wartete die Person, die
gerade jemanden gebannt hat, darauf, dass Discord den Embed annimmt.

- **Reihenfolge:** je Zielkanal nacheinander, in der Reihenfolge des
  Entstehens. Sonst erschiene die Aufhebung vor dem Bann. Verschiedene Kanäle
  laufen parallel (höchstens vier).
- **Gegendruck:** höchstens 40 Zustellungen je Lauf. Hundert Voice-Ereignisse
  ergeben dadurch mehrere Läufe statt hundert gleichzeitiger Anfragen.
- **Retry:** drei Versuche, dazwischen 30 s und 2 min. Dann `FAILED`.
- **Dauerhafte Fehler** (`Unknown Channel`, `Missing Access`,
  `Missing Permissions`, 403/404) beenden sofort und setzen das Ziel auf
  `INVALID`. Ein gelöschter Kanal wird nicht dadurch wieder da, dass man es
  noch dreimal probiert.
- **Steckengeblieben:** wer beansprucht und nie beendet hat (Absturz), wird
  nach fünf Minuten zurückgeholt.

## 8. Konfiguration und Prüfung

Eine Zeile je Kategorie in `DiscordLogChannel`. Kein Kanal in `.env`, keiner im
Quelltext. **Derselbe Kanal darf mehrfach vorkommen** — ein eindeutiger Index
auf die Kanalkennung wäre eine künstliche Grenze.

Geprüft wird **vor** dem Speichern: gibt es den Kanal, ist er ein Textkanal,
sieht der Bot ihn, darf er senden und einbetten. Eine Konfiguration, die von
vornherein nicht funktioniert, gehört nicht in die Datenbank.

Benötigte Bot-Rechte im Zielkanal — genau drei:

| Recht           | warum                                          |
| --------------- | ---------------------------------------------- |
| `VIEW_CHANNEL`  | sonst existiert der Kanal für den Bot nicht    |
| `SEND_MESSAGES` | das eigentliche Anliegen                       |
| `EMBED_LINKS`   | ohne dieses Recht käme eine leere Nachricht an |

`ATTACH_FILES` steht bewusst nicht dabei: kein Formatter hängt etwas an. Ein
Recht zu verlangen, das nie gebraucht wird, ist keine Vorsicht.

## 9. Health

Vier Zustände je Ziel: `HEALTHY`, `DEGRADED` (letzte Zustellung gescheitert),
`INVALID` (Kanal weg oder Rechte fehlen), `DISABLED`.

Geprüft wird alle 15 Minuten im Job `logs-kanalpruefung`, **nicht** beim
Seitenaufruf: eine Übersichtsseite darf kein Dutzend Discord-Anfragen
auslösen. Die Seite liest den gespeicherten Zustand.

Ein einzelner Fehlschlag macht `DEGRADED`, nicht `INVALID` — ein kurzer
Aussetzer bei Discord ist kein kaputter Kanal.

## 10. Was nie nach Discord geht

Die Formatter verwenden eine **ausdrückliche Feld-Allowlist**. Kein
`JSON.stringify(metadata)`, kein Durchreichen ganzer Datensätze. Jedes Feld
steht einzeln im Code, weil jemand entschieden hat, dass es hinausdarf.

Der Unterschied ist nicht theoretisch: `ModerationAction.metadata` trägt bei
einem Jail interne Vermerke. Ein Formatter, der «einfach alles» ausgibt, trägt
beim nächsten neuen Feld etwas nach Discord, das niemand dorthin gestellt hat.
Diese Bauart kann das nicht.

Ebenfalls: **nichts wird erfunden.** Wo Discord den Verursacher nicht nennt
(`actorSource === 'UNKNOWN'`), steht kein Name. «Gelöscht von X» ohne Beleg
wäre eine Behauptung über einen Menschen — in einem Kanal, den der halbe
Server liest.

## 11. Erwähnungen und Grenzen

- **Keine Pings.** Gesendet wird immer mit `allowedMentions: { parse: [] }`.
  Geloggte Inhalte enthalten regelmässig `@everyone` — im Zweifel genau
  deshalb, weil sie gelöscht wurden. Personen erscheinen als Name plus
  Kennung, nicht als Mention.
- **Embed-Grenzen** zentral in `embed.ts`: Titel 256, Beschreibung 4096,
  Feldwert 1024, 25 Felder, **6000 gesamt**. Die letzte ist die tückische — ein
  Embed kann jede Einzelgrenze einhalten und trotzdem zu gross sein. Reicht das
  Kürzen nicht, fallen Felder von hinten weg; die vorderen tragen die
  wichtigere Aussage.
- Gekürzt wird sichtbar (`… (gekürzt)`). Ein stillschweigend abgeschnittener
  Satz liest sich wie ein vollständiger.
- **Zeitpunkte** in Discords Schreibweise `<t:…:F>`, damit jeder seine eigene
  Zone sieht. Eine fest eingebrannte Schweizer Zeit wäre für alle anderen
  falsch.

## 12. Eine neue Kategorie oder ein neuer Logtyp

**Neuer Ereignistyp in einer bestehenden Kategorie** — eine Stelle:

1. Eintrag in `EREIGNIS` in `formatters.ts` (Titel, Farbe, Bereich).

Mehr nicht. Ohne Eintrag greift eine neutrale Ersatzdarstellung, es wird also
nichts verschluckt.

**Neue Kategorie** — vier Stellen:

1. Wert im Enum `DiscordLogCategory` (additive Migration).
2. Eintrag in `LOG_KATEGORIEN` in `registry.ts` — der Test
   «kennt für jede Kategorie eine Beschreibung» fällt sonst.
3. Formatter für die neuen Logtypen.
4. **Einen zentralen Anknüpfpunkt benennen**: die Stelle, an der das Modul
   seinen Logeintrag ohnehin schreibt, ruft `dispatchX(...)` auf. Kein Aufruf
   in einzelnen Event-Handlern.

Der Dispatcher selbst wird dabei nicht angefasst.

**Verifikation und Tickets** nachzurüsten hiesse konkret: einen zentralen
Punkt schaffen, der unabhängig von der Automation Engine läuft — analog zu
`meldeMassnahme()` in der Moderation. Danach folgen sie den vier Schritten
oben.

**Jail zusammenführen** wäre der zweite offene Punkt: heute postet das Modul
selbst. Zusammenlegen hiesse, seinen eigenen Versand abzuschalten, sobald
`MODERATION` eingerichtet ist, und seine ausführlichere Darstellung in einen
Formatter zu überführen.

## 13. Berechtigungen

| Berechtigung          | erlaubt                            |
| --------------------- | ---------------------------------- |
| `logs.discord.view`   | ansehen, wohin Logs gehen          |
| `logs.discord.manage` | Kategorien zuweisen und abschalten |
| `logs.discord.test`   | Testnachricht senden               |

Eigener Namensraum statt `analytics.*`: die Kategorien reichen über das
Analytics-Modul hinaus — Moderation gibt es auch, wenn das Protokoll der
Nachrichten abgeschaltet ist. Eine Berechtigung, die an einem abschaltbaren
Modul hängt, wäre für die Moderation die falsche.

`test` ist von `manage` getrennt, weil die Testnachricht in einem Kanal
sichtbar wird, den andere lesen.

## 14. Audit

Auditiert wird die **Konfiguration**, nicht jede Zustellung:
`LOG_CHANNEL_CONFIG_CHANGED`, `LOG_CHANNEL_DISABLED`, `LOG_CHANNEL_TEST_SENT`.
Wohin Logs gehen, ist eine Entscheidung; dass eine einzelne Nachricht ankam,
ist ein technischer Vorgang und steht in `DiscordLogDelivery`.

## 15. Testnachricht

Der Knopf je eingerichteter Kategorie sendet unmittelbar — nicht über den
Zusteller, denn die Person am Dashboard wartet auf genau diese Antwort.

Sie ist **kein Logeintrag**: keine Zeile in der Zustelltabelle, kein
Akteneintrag, kein Statistikereignis. Eine Statistik, die Testnachrichten
mitzählt, ist ab dem ersten Test falsch.

## 16. Grenzen

- **Analytics muss laufen** für `MESSAGES`, `VOICE`, `MEMBERS` und `ADMIN`.
  Ist das Modul aus, entsteht gar kein Logeintrag — und es gibt nichts zu
  spiegeln. `MODERATION` hängt an nichts davon.
- **Kein Batching.** Jedes Ereignis ist eine Nachricht. Bei sehr
  hochfrequenten Kategorien wächst dadurch der Rückstand, statt dass Discord
  überlastet wird; die Stapelgrenze fängt das ab. Zusammenfassen wäre ein
  Ausbau, kein Nachbessern.
- **Kein Nachsenden gelöschter Log-Nachrichten.** Wird eine vom Bot erzeugte
  Nachricht in Discord gelöscht, bleibt die Zustellung `SENT`. Die Datenbank
  ist die Wahrheit.
