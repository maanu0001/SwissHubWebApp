# Migrate — Konfiguration auf eine andere Guild übertragen

Ein Admin-Modul, um eine bestehende SwissHub-Installation kontrolliert auf
eine neue Discord-Guild zu bringen. Testserver → öffentlicher Server, alte
Guild → neue Guild.

## Was es nicht ist

Kein Deployment-Werkzeug. Es führt keine Shell-Befehle aus, richtet keinen
Server ein, klont keine Datenbank und exportiert keine Zugangsdaten. Es
überträgt die **Konfiguration der Anwendung** und sonst nichts.

## Der Kern: Übersetzen statt kopieren

Eine Rolle der einen Guild gibt es in der anderen nicht. Jede Rollen- und
Kanal-ID muss deshalb übersetzt werden, bevor eine Einstellung im Ziel
irgendeinen Sinn ergibt.

Welche Einstellung auf eine Rolle zeigt und welche auf einen Kanal, steht
bereits im System: jedes Modul beschreibt seine Einstellungen mit
`settingsFields`, und dort trägt jedes Feld seine Art (`discord-role`,
`discord-channel-list`, …). Aus derselben Beschreibung, aus der die
Einstellungsmaske ihre Auswahllisten baut, entsteht die Zuordnung —
`referenzen.ts`.

Eine eigene Liste je Modul wäre die zweite Antwort auf dieselbe Frage
gewesen. Sie verwaiste beim ersten neuen Feld, ohne dass es jemandem
auffiele.

### Vorschläge

Nach Namen, **exakt**. «Moderator» auf «Moderator» ist eine Zuordnung,
«Moderator» auf «Moderatoren-Chat» wäre eine Vermutung — und Vermutungen
gehören nicht in einen Vorgang, der Rechte verteilt. Gross-/Kleinschreibung,
führendes `#` und Unterstriche werden dabei ignoriert.

Was nicht eindeutig passt, bleibt offen und wartet auf einen Menschen.

### Offene Verweise

Eine Referenz ohne Zuordnung wird **geleert**, nicht durchgereicht. Eine
fremde Rollen-ID ist im Ziel keine Rolle, sondern eine Zahl, auf die niemand
zeigt; sie stehenzulassen hiesse, eine Einstellung zu übertragen, die
schweigend nicht wirkt. Der Probelauf zählt auf, was dabei wegfällt.

## Zugangsdaten

Stehen nirgends. Nicht, weil sie herausgefiltert werden, sondern weil das
Paket aus **benannten Feldern** entsteht und nicht aus einem Abzug der
Tabellen. `IntegrationSecret` wird nicht einmal gelesen — nur
`IntegrationStatus`, und daraus nur, ob etwas eingerichtet ist.

Zwei Sperren prüfen es trotzdem, an Schlüsselnamen und nicht an Werten:

- vor dem Export — schlägt sie an, ist der Aufbau falsch, nicht der Filter
  zu streng;
- vor dem Import — ein Paket mit einem Token darin wird abgewiesen, und die
  Meldung nennt die Fundstelle, nie den Wert.

`MASTER_ENCRYPTION_KEY`, `AUTH_SECRET` und alles Vergleichbare gehören zur
Infrastruktur des Zielsystems und werden dort neu gesetzt.

## Das Paket

Versioniert (`schemaVersion`), durchgehend `strict`. Ein Feld, das niemand
erwartet hat, führt zur Ablehnung — ignorierte Felder wandern sonst
irgendwann doch in ein `...spread`.

Es gibt **keinen generischen Weg**, Datenbankzeilen zu beschreiben. Kein
`tables`, kein `models`. Was nicht einzeln benannt ist, lässt sich nicht
importieren.

| Enthalten                            | Nicht enthalten               |
| ------------------------------------ | ----------------------------- |
| Modulzustände und -einstellungen     | Tickets, Jails, Anträge       |
| Berechtigungen je Rolle              | Audit- und Analytics-Historie |
| Moderationsstufen, geschützte Rollen | Automation-Läufe              |
| Automationen (Definition)            | Discord-Nachrichten-IDs       |
| Integrationen (nur Zustand)          | Zugangsdaten jeder Art        |

Vier Hürden beim Einlesen: Grösse (2 MB), Fassung, Schema,
Geheimnissuche.

Geschrieben wird am Ende über `setModuleSettings` — dort läuft das
Zod-Schema des Moduls. Damit kommt nur an, was das Modul selbst als
Einstellung kennt, ohne dass die Übertragung wissen müsste, welche Felder es
gibt.

## Ablauf

```
Paket (eigene Konfiguration oder Upload)
  → Ziel-Guild wählen
  → Rollen zuordnen
  → Kanäle zuordnen
  → Probelauf
  → bestätigen
  → anwenden
```

Der Zustand steht in `MigrationRun`, nicht im Browser. Eine Übertragung zieht
sich über mehrere Sitzungen; ein Assistent, der das in React hält, verliert
beim ersten Neuladen den Überblick.

### Probelauf

Rechnet und schreibt nichts — weder in die Datenbank noch nach Discord. Er
zeigt je Modul `NO_CHANGE` / `UPDATE` / `CREATE` / `SKIP` mit den betroffenen
Feldern, die Rollenzuordnung, die Automationen mit Befund und die offenen
Verweise.

Ändert sich die Zuordnung, wird der Probelauf **verworfen**. Ein falscher
Probelauf ist schlimmer als keiner.

### Anwenden

In Phasen, nicht in einer Transaktion:

```
PREPARE → SNAPSHOT → APPLY_PERMISSIONS → APPLY_MODULES → IMPORT_AUTOMATIONS → VERIFY
```

Der Grund ist nicht Bequemlichkeit: eine Übertragung berührt Discord, und
Discord kennt keine Rücknahme. Eine Transaktion über beides täuschte eine
Geschlossenheit vor, die es nicht gibt.

Jede Phase ist idempotent, der Fortschritt steht nach jeder Phase in der
Datenbank. Bricht es ab, ist der Zustand `PARTIAL` — ein Ergebnis und kein
Zwischenstand.

### Automationen

Kommen **immer ausgeschaltet** an. Ohne Schalter dafür. Eine Automation des
Testservers, die nach dem Import sofort läuft, schreibt in Kanäle eines
öffentlichen Servers, bevor irgendwer sie gelesen hat.

Der Befund steht daneben:

|           |                                       |
| --------- | ------------------------------------- |
| `VALID`   | alle Verweise aufgelöst               |
| `WARNING` | etwas fehlt, aber nichts Verweisendes |
| `INVALID` | mindestens ein Verweis ohne Zuordnung |

Auch `INVALID` wird importiert — ausgeschaltet und mit dem Befund. Sie
wegzulassen wäre schlimmer: dann fehlt sie, und niemand weiss davon.

### Rücknahme

Vor dem Anwenden entsteht ein Snapshot der Ziel-Konfiguration. Die Rücknahme
dreht Moduleinstellungen und Berechtigungen darauf zurück.

Sie löscht dabei **nichts**, was der Snapshot nicht kennt. Eine Rolle, die es
vorher nicht gab, könnte von der Übertragung stammen — aber ebenso von
jemandem, der inzwischen gearbeitet hat. Löschen wäre die Vermutung, dass
niemand sonst etwas getan hat. Discord-Objekte bleiben aus demselben Grund
unangetastet.

## Berechtigungen

| Schlüssel            | Wofür                               |
| -------------------- | ----------------------------------- |
| `migration.view`     | Übertragungen einsehen              |
| `migration.export`   | Paket erzeugen                      |
| `migration.import`   | Paket einlesen, Übertragung anlegen |
| `migration.dry_run`  | Zuordnen und Probelauf              |
| `migration.execute`  | **kritisch** — anwenden             |
| `migration.rollback` | **kritisch** — zurückdrehen         |

Keine mitgelieferte Vorlage enthält eine davon — auch nicht die für
Moderation oder Support. Das Modul ist zudem `defaultEnabled: false`: ein
Werkzeug dieser Reichweite soll nicht von selbst in jeder Installation
dastehen.

Die Quell-Guild kommt immer aus der Sitzung, nie aus der Eingabe — eine
Kennung ist keine Berechtigung.

## Audit

Jeder Schritt: angelegt, exportiert, eingelesen, zugeordnet, Probelauf,
gestartet, angewendet, abgeschlossen, gescheitert, zurückgenommen. Ohne
Zugangsdaten, weil keine im Paket stehen.

## Bekannte Grenze

Der Bot spricht in einer Installation mit **genau einer** Guild. Eine
Ziel-Guild, auf der er nicht verbunden ist, lässt sich von hier aus nicht
prüfen — und was sich nicht prüfen lässt, wird nicht angenommen. Der Weg für
einen echten Umzug ist deshalb: Bot auf den Zielserver einladen, die Guild in
den Einstellungen verbinden, dann übertragen.
