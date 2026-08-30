# Moderationsaktionen aus Discord

Bis zu dieser Änderung kannte die Moderationsakte nur, was über das SwissHub
Dashboard lief. Bannte eine Moderatorin direkt in der Discord-App, geschah
nichts: kein Eintrag, kein Audit-Log, keine Zahl in der Statistik. Wer die Akte
eines Mitglieds las, sah einen Ausschnitt und hielt ihn für das Ganze — und das
ist schlimmer als eine sichtbar leere Akte.

Seither erkennt SwissHub Massnahmen, die ausserhalb ausgelöst wurden, und
schreibt sie in **dieselbe** Historie.

## 1. Der Weg eines externen Vorgangs

```
Discord Gateway-Ereignis     → DASS etwas geschah
Discord Audit Log            → WER es tat und WARUM
Abgleich gegen eigene Zeilen → war es womöglich SwissHub selbst?
ModerationAction             → dieselbe Tabelle wie alles andere
```

Die Trennung der ersten beiden Zeilen ist der Kern. Ein `guildBanAdd` sagt, dass
jemand gebannt wurde — nicht, wer ihn gebannt hat. Diese Angabe steht
ausschliesslich in Discords Audit Log, und sie ist das Wertvollste an der ganzen
Auskunft.

## 2. Was bewusst *nicht* gebaut wurde

Keine zweite Moderationshistorie. Extern erkannte Massnahmen landen in
`ModerationAction`, derselben Tabelle, die das Moderation Center und das
Jail-Modul füllen. Sie erscheinen dadurch ohne weiteres Zutun im
Moderationsverlauf, im Mitgliederprofil, in den Kennzahlen und in der
Automation Engine — es gibt keine Discord-eigene Ansicht und kein
Discord-eigenes Ereignis.

Wiederverwendet statt nachgebaut wurden ausserdem: das bestehende `AuditLog`,
der Scheduler des Bots, die Ereignisregistrierung der Automation Engine, der
`BotStatus`-Heartbeat und `sanitizeText` aus `@swisshub/shared`.

## 3. Datenmodell

Vier additive Spalten an `ModerationAction`:

| Spalte | Bedeutung |
|---|---|
| `source` | `WEBAPP` \| `BOT` \| `DISCORD` \| `SYSTEM` |
| `actorType` | `HUMAN` \| `BOT` \| `SYSTEM` \| `UNKNOWN` |
| `discordAuditLogEntryId` | eindeutig — dieselbe Kennung nie zweimal |
| `detectedAt` | wann SwissHub es bemerkt hat, nicht wann es geschah |

Dazu der Typ `TIMEOUT_UPDATE` (eine geänderte Frist ist kein zweiter Timeout)
und drei Spalten an `BotStatus`: `auditLogAccess`, `auditLogCheckedAt`,
`lastAuditEntryId`.

`source` ersetzt die bisherige Angabe im Metadaten-JSON nicht, sondern tritt
neben sie: das JSON trug den Schlüssel schon, und bestehende Auswertungen lesen
ihn weiter.

## 4. Die drei Zusagen

### 4.1 Kein Doppel

Ein Bann über das Dashboard erzeugt eine Zeile. Sekundenbruchteile später kommt
das Gateway-Ereignis für denselben Vorgang. Ohne Abgleich stünde derselbe Bann
zweimal in der Akte — einmal mit Grund und Verantwortlicher, einmal ohne.

Zwei Mechanismen greifen:

1. **Der Abgleich.** Vor dem Schreiben wird gesucht, ob es zu Typ, Ziel und
   Zeitpunkt bereits eine SwissHub-Zeile gibt (±30 Sekunden). Gibt es sie, wird
   der Audit-Eintrag an sie **angehängt** statt eine neue anzulegen — er belegt
   dann, dass Discord die Massnahme tatsächlich vollzogen hat.
2. **Der eigene Bot.** Ist der Handelnde die eigene Bot-Kennung und findet sich
   trotzdem keine Zeile, wird *nichts* angelegt. Sie wird gerade geschrieben:
   jeder Weg, der den Bot handeln lässt, schreibt sie unmittelbar danach.

Die zweite Regel hat einen Preis, und er steht hier, statt verschwiegen zu
werden: handelte der eigene Bot tatsächlich ohne zugehörige Zeile, ginge die
Massnahme verloren. Das ist die konservative Wahl — ein Doppel in der Akte ist
schlimmer als eine Lücke, weil es aussieht wie zwei Vorgänge.

### 4.2 Kein erfundener Kick

Discord sendet für ein freiwilliges Verlassen **dasselbe** Ereignis wie für
einen Kick: `guildMemberRemove`. Nur ein passender `MEMBER_KICK`-Audit-Eintrag
unterscheidet beides.

Deshalb gilt für Kicks die strengste Regel: **ohne Beleg kein Eintrag.** Nicht
einmal ein Eintrag mit unbekanntem Handelnden — denn ohne Beleg steht nicht
fest, dass überhaupt etwas geschah.

Bei Bann, Entbannung und Timeout ist es umgekehrt: das Gateway-Ereignis sagt
selbst, was geschah, und ohne Audit-Eintrag fehlt nur der Handelnde. Diese
Massnahmen werden mit `actorType = UNKNOWN` erfasst. Die Massnahme zu
verschweigen, weil der Handelnde unbekannt ist, wäre der grössere Verlust.

Ebenso wird unterschieden zwischen «nichts gefunden» und «nicht abrufbar». Nur
das erste heisst «freiwillig gegangen». Fehlt dem Bot das Leserecht, wissen wir
es schlicht nicht, und daraus darf nie ein Kick werden.

### 4.3 Kein zweimal verarbeiteter Audit-Eintrag

`discordAuditLogEntryId` ist eindeutig. Das entscheidet die **Datenbank**, nicht
der Anwendungscode — also auch über Neustarts hinweg und bei zwei gleichzeitigen
Läufen. Ein Zwischenspeicher im Arbeitsspeicher wäre nach einem Neustart leer.

Die Vorabprüfung im Code ist nur eine Abkürzung, die eine Ausnahme spart. Sie
liesse sich entfernen, ohne dass sich das Verhalten änderte — geprüft.

## 5. Timeouts

`guildMemberUpdate` kommt bei jeder Änderung am Mitglied: Rollen, Spitzname,
Avatar. Reagiert wird nur, wenn sich `communicationDisabledUntil` tatsächlich
geändert hat.

| vorher | nachher | Ergebnis |
|---|---|---|
| — | 22:00 | `TIMEOUT` |
| 22:00 | 23:00 | `TIMEOUT_UPDATE` |
| 22:00 (künftig) | — | `TIMEOUT_REMOVE` |
| 22:00 (vergangen) | — | **nichts** |

Die letzte Zeile ist der Fall, den man leicht übersieht: ein **abgelaufener**
Timeout sieht aus wie eine Aufhebung — das Feld verschwindet in beiden Fällen.
Es hat aber niemand gehandelt, und in der Akte stünde sonst eine Massnahme, die
nie jemand ergriffen hat.

## 6. Wiederholungen und Rate Limits

Discord schreibt das Audit Log nicht synchron zum Gateway. Drei Versuche —
sofort, nach 700 ms, nach 2500 ms — und danach ist Schluss. Jeder Versuch fragt
gezielt nach *einem* Ereignistyp mit `limit: 10`; kein Vollabzug, kein
Dauerpolling.

Das Zeitfenster für eine Zuordnung beträgt zehn Sekunden. Es ist bewusst weiter
als die fünf der Analytics-Zuordnung, weil hier bis zu drei Sekunden lang
nachgefasst wird — enger gefasst verlöre der letzte Versuch genau den Eintrag,
auf den er gewartet hat.

## 7. Der Abgleichlauf

Gateway-Ereignisse kommen zuverlässig, solange die Verbindung steht. Während
eines Neustarts kommen sie nicht, und Discord liefert sie nicht nach. Alle 15
Minuten liest deshalb ein Lauf die neuen Audit-Einträge ab der zuletzt
verarbeiteten Kennung (`after`) und verarbeitet sie durch dieselbe Kette.

Zwei bewusste Grenzen:

- **Beim ersten Lauf wird nichts nachgetragen**, nur der Zeiger gesetzt. Die
  gesamte erreichbare Vergangenheit eines Servers nachträglich in die Akte zu
  schreiben wäre etwas anderes als das Schliessen einer Lücke.
- **Keine Timeouts.** Discord führt einen Timeout als `MEMBER_UPDATE`, und
  dieser Typ deckt auch Spitznamen ab. Welche Änderung es war, steht in einem
  Feld, das SwissHub aus dem Audit Log nicht ausliest — eine Zuordnung wäre
  geraten. Timeouts erkennt deshalb nur das Gateway-Ereignis, das alte und neue
  Frist mitbringt.

## 8. Discord-Einstellungen

**Intents:** keine Änderung nötig. `GuildMembers` und `GuildModeration` sind
bereits gesetzt und decken alle vier verwendeten Ereignisse ab. Kein zusätzliches
privilegiertes Intent.

**Bot-Berechtigung:** `VIEW_AUDIT_LOG` («Audit-Log anzeigen»). Der Bot braucht
für das *Lesen* einer fremden Massnahme nicht die Rechte, mit denen sie
ausgeführt wurde — kein Administrator.

Fehlt das Recht, läuft alles weiter: Banns und Timeouts landen ohne Handelnden
und ohne Grund in der Akte, Kicks gar nicht. Der Systemstatus sagt das
ausdrücklich, statt es unbemerkt zu lassen.

## 9. Gesundheitsprüfung

Alle zehn Minuten probiert der Bot einen minimalen Abruf (`limit: 1`) und
vermerkt das Ergebnis in `BotStatus`. Eine Probe statt einer Rechteabfrage, weil
sie die richtige Frage stellt: die berechnete Rechtemaske sagt, was Discord uns
zuschreibt — die Probe sagt, ob der Abruf funktioniert.

Drei Zustände, nicht zwei: `null` heisst «noch nicht geprüft» und ist keine
Beanstandung. Eine vorübergehende Störung überschreibt den bekannten Zustand
nicht — sonst flöge die Anzeige bei jedem Aussetzer hin und her, und niemand
traute ihr mehr.

## 10. Sicherheit

Audit-Log-Daten sind Systemkontext, aber sie kommen von aussen und landen in der
Oberfläche. Deshalb: Grund über `sanitizeText` auf 400 Zeichen, Namen auf 100,
Metadaten knapp und mit fester Struktur, Discord-Kennungen als Identität statt
Namen, keine Zugangsdaten in technischen Logs.

## 11. Was diese Änderung nicht leisten kann

- **Keine Rekonstruktion der Vergangenheit.** Erkannt wird, was geschieht,
  während der Bot läuft — plus die Lücke einer Trennung. Ein Bann aus der Zeit
  vor dieser Änderung bleibt Discord bekannt und uns nicht. Genau deshalb bleibt
  die Bannliste eine Abfrage bei Discord und keine Datenbankabfrage.
- **Keine Mute-Rollen.** SwissHub arbeitet mit Discord-Timeouts und dem
  Jail-Modul; eine separate «Muted»-Rolle gibt es nicht. `MEMBER_ROLE_UPDATE`
  als Moderationsvorgang zu deuten hiesse, jede Rollenvergabe zu bewerten.
- **Keine Guild-Spalte.** `ModerationAction` führt keine `guildId`; die
  Guild-Isolation greift eine Ebene höher, im `isActiveGuild`-Filter der
  Handler und im guild-gebundenen Gateway. Das ist der bestehende Zuschnitt und
  wurde hier nicht geändert.

## 12. Technische Logs

`moderation.discord.detected`, `.audit_matched`, `.audit_retry`,
`.audit_unmatched`, `.deduplicated`, `.persisted` — ohne Nutzerdaten über die
Kennungen hinaus, ohne Zugangsdaten.
