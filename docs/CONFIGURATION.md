# Konfiguration

Die SwissHub Bot WebApp trennt Konfiguration in zwei Bereiche:

| Bereich                   | Wo                                | Wer ändert es             | Beispiele                                                                   |
| ------------------------- | --------------------------------- | ------------------------- | --------------------------------------------------------------------------- |
| **Infrastruktur-Secrets** | `.env` auf dem Server             | Serveradministrator (SSH) | `DATABASE_URL`, `AUTH_SECRET`, `DISCORD_BOT_TOKEN`, `DISCORD_CLIENT_SECRET` |
| **Laufzeitkonfiguration** | PostgreSQL, gepflegt im Dashboard | Berechtigte im Dashboard  | Discord-Server, Rollen, Channels, Berechtigungen, Moduleinstellungen        |

Der Grundsatz: **Was ein Secret ist, bleibt in der Umgebung. Alles andere gehört ins Dashboard.**

---

## 1. Warum Secrets nicht in die WebApp gehören

Es wäre bequem, auch den Bot Token im Dashboard einzutragen. Genau davon rät
diese Anwendung bewusst ab:

- Ein Token, der über ein Formular bearbeitbar ist, muss irgendwann wieder
  angezeigt, geladen oder validiert werden - und taucht damit früher oder später
  in einer HTTP-Antwort, einem React-State, einem Fehlerbericht oder einem Log auf.
- Wer den Token wechseln kann, kann den Bot übernehmen. Diese Fähigkeit soll an
  den Serverzugang gebunden sein, nicht an eine Discord-Rolle.
- Ein Datenbank-Leak würde bei verschlüsselter Ablage zwar nicht sofort den
  Token preisgeben - der Master Key müsste aber trotzdem in der Umgebung liegen.
  Der Sicherheitsgewinn gegenüber "Token direkt in der Umgebung" ist damit gering,
  der Angriffsfläche-Zuwachs (UI, API, Audit, Cache) dagegen real.

Deshalb bleiben `DISCORD_BOT_TOKEN`, `DISCORD_CLIENT_SECRET`, `AUTH_SECRET` und
`DATABASE_URL` ausschliesslich Umgebungsvariablen. Sie werden nur serverseitig
gelesen, nie an Client Components übergeben, nie in API-Antworten zurückgegeben
und im Log durch die Redaction (`packages/logger/src/redact.ts`) entfernt.

Ein `CONFIG_ENCRYPTION_KEY` ist deshalb aktuell **nicht** nötig - in der
Datenbank liegen keine Secrets, sondern nur IDs, Namen und Einstellungen.
Sollte später ein Secret dazukommen (z.B. ein Webhook-Token eines Drittdienstes),
ist AES-256-GCM mit einem Master Key aus der Umgebung der vorgesehene Weg.

---

## 2. Umgebungsvariablen

### Erforderlich

| Variable                | Zweck                                                         |
| ----------------------- | ------------------------------------------------------------- |
| `DATABASE_URL`          | PostgreSQL-Verbindung (Prisma)                                |
| `DISCORD_BOT_TOKEN`     | Bot-Zugang zu Discord                                         |
| `DISCORD_CLIENT_ID`     | OAuth2-Anwendung                                              |
| `DISCORD_CLIENT_SECRET` | OAuth2-Anwendung                                              |
| `AUTH_SECRET`           | Session-Hashing, CSRF-Token, IP-Hashing (min. 32 Zeichen)     |
| `NEXT_PUBLIC_APP_URL`   | Öffentliche Basis-URL; daraus entsteht die OAuth Redirect URI |

### Optional

| Variable                      | Standard        | Zweck                                                  |
| ----------------------------- | --------------- | ------------------------------------------------------ |
| `SWISSHUB_OWNER_DISCORD_ID`   | –               | Notzugang mit permanentem Vollzugriff                  |
| `TRUST_PROXY`                 | `false`         | `X-Forwarded-For` hinter einem Reverse Proxy auswerten |
| `LOG_LEVEL` / `LOG_FORMAT`    | `info` / `json` | Logging                                                |
| `SESSION_ABSOLUTE_TTL_HOURS`  | `168`           | Maximale Sessiondauer                                  |
| `SESSION_IDLE_TTL_MINUTES`    | `720`           | Inaktivitätsablauf                                     |
| `ROLE_CACHE_TTL_SECONDS`      | `300`           | Wiederverwendung gecachter Discord-Rollen              |
| `ROLE_CRITICAL_TTL_SECONDS`   | `30`            | Maximales Alter für sicherheitskritische Aktionen      |
| `JAIL_SWEEP_INTERVAL_SECONDS` | `30`            | Freilassungs-Job des Bots                              |
| `RECONCILE_INTERVAL_MINUTES`  | `15`            | Abgleich Datenbank ↔ Discord                           |
| `DEV_MOCK_DISCORD`            | `false`         | Nur Entwicklung; in Production hart abgelehnt          |

### Abgelöst

Diese Variablen funktionieren weiterhin, dienen aber nur noch als einmaliger
Bootstrap. Beim Start werden sie in die Datenbank übernommen; danach können sie
aus der `.env` entfernt werden. Die Anwendung schreibt beim Start eine
entsprechende Warnung, und die Einstellungsseite zeigt sie an.

| Variable                | Ersetzt durch                                       |
| ----------------------- | --------------------------------------------------- |
| `DISCORD_GUILD_ID`      | Einrichtungsassistent `/setup` → `GuildConfig`      |
| `DISCORD_ADMIN_ROLE_ID` | Server → Berechtigungen (`RolePermission`)          |
| `DISCORD_JAIL_ROLE_ID`  | Module → Jail → Jail-Rolle (`ModuleState.settings`) |

---

## 3. Laufzeitkonfiguration in der Datenbank

| Tabelle               | Inhalt                                                                 |
| --------------------- | ---------------------------------------------------------------------- |
| `GuildConfig`         | Verbundener Discord-Server, Metadaten, Abschluss der Einrichtung       |
| `DiscordRoleCache`    | Gespiegelte Rollen (Name, Farbe, Position, `managed`, Permission-Bits) |
| `DiscordChannelCache` | Gespiegelte Channels (Name, Art, Kategorie, Position)                  |
| `ManagedRole`         | Bezeichnung, Schutzstatus, Moderationsstufe, „beim Jail behalten“      |
| `RolePermission`      | Zuordnung Discord-Rolle → Dashboard-Berechtigung                       |
| `ModuleState`         | Aktivierung, Einstellungen (JSON) und `configVersion` je Modul         |
| `SystemConfig`        | Anwendungsweite Einstellungen (Zeitzone, Moderations-Log, …)           |
| `ConfigRevision`      | Zähler, der jede Konfigurationsänderung markiert                       |
| `SyncRun`             | Protokoll der Discord-Abgleiche                                        |

Bewusst **nicht** gespiegelt werden Mitglieder. Sie werden bei Bedarf direkt bei
Discord gesucht - das hält den Datenbestand klein und aktuell.

---

## 4. Änderungen ohne Neustart

Jede schreibende Konfigurationsänderung erhöht `ConfigRevision.revision`.
Bot und WebApp lesen diesen Zähler günstig (eine Zeile, gepollt alle 5 Sekunden)
und verwerfen ihre lokalen Caches, sobald er sich ändert
(`packages/database/src/config-revision.ts`).

Dadurch gilt:

- Eine im Dashboard geänderte Jail-Rolle wirkt beim nächsten Jail - ohne Neustart.
- Neue Berechtigungen greifen sofort für neue Anfragen.
- Es braucht weder Redis noch Pub/Sub; PostgreSQL genügt.

Zusätzlich invalidiert der Bot seine Caches ereignisgesteuert, sobald Discord
Rollen- oder Channel-Änderungen meldet, und gleicht spätestens alle 15 Minuten ab.

---

## 5. Ablauf einer Einstellungsänderung

```
Browser (Formular)
  └─ Server Action  ──> defineAction()
       1. Authentifizierung (Session)
       2. Guild-Mitgliedschaft
       3. CSRF-Token
       4. Rate Limit
       5. Zod-Validierung
       6. Berechtigungsprüfung (frische Discord-Rollen)
       7. Prüfung gegen den echten Discord-Zustand
            - existiert die Rolle noch?
            - ist sie von Discord verwaltet?
            - liegt sie unterhalb der Bot-Rolle?
            - passt die Channel-Art?
       8. Speichern (ModuleState / SystemConfig / RolePermission)
       9. ConfigRevision erhöhen
      10. Audit Log mit Vorher/Nachher
```

Der Browser schreibt niemals direkt in Prisma. Fehlerhafte Eingaben führen dazu,
dass **nichts** gespeichert wird (Safe Save) - es entsteht kein halb
konfigurierter Zwischenzustand.

---

## 6. Einrichtung (`/setup`)

1. **Discord-Server verbinden** – die Auswahl enthält nur Server, auf denen der
   Bot tatsächlich Mitglied ist. Eine fremde Guild lässt sich auch über einen
   manipulierten Request nicht eintragen.
2. **Abgleich** – Rollen und Channels werden gespiegelt.
3. **Berechtigungen** – mindestens eine Discord-Rolle erhält Dashboard-Rechte.
4. **Module** – z.B. die Jail-Rolle wählen.

### Erstzugang

Berechtigungen werden im Dashboard vergeben - für das Dashboard braucht es aber
Berechtigungen. Damit daraus kein Henne-Ei-Problem wird, gilt: **solange die
Einrichtung nicht abgeschlossen ist, darf ein Discord-Administrator die
Konfigurationsbereiche verwenden** (`/setup`, `/server/*`, `/system/*`,
`/modules/*`) und dort die ersten Berechtigungen vergeben. Wer nach der
Anmeldung noch keine Dashboard-Berechtigung hat, landet direkt im Assistenten
statt auf einer 403-Seite.

Diese Ausnahme endet mit dem Abschluss der Einrichtung; danach zählen
ausschliesslich die Dashboard-Berechtigungen. Sie deckt nur Konfiguration ab -
Moderationsbereiche wie Jail oder Mitglieder bleiben gesperrt. Jede Nutzung wird
protokolliert.

Der Abschluss ist gesperrt, solange keine Rolle „Berechtigungen verwalten“ bzw.
„Vollzugriff“ besitzt und kein `SWISSHUB_OWNER_DISCORD_ID` gesetzt ist - sonst
würde der Abschluss den Erstzugang beenden und niemanden zurücklassen.

Discord-Serverownerschaft allein verleiht **keine** Rechte im Dashboard; sie
zählt nur als Discord-Administrator für diesen Erstzugang. Dauerhafte
Sonderrechte gibt es nur über `SWISSHUB_OWNER_DISCORD_ID`.

---

## 7. Aussperrschutz und Wiederherstellung

- Die letzte Rolle mit „Berechtigungen verwalten“ bzw. „Vollzugriff“ lässt sich
  nicht entwerten und nicht löschen (`packages/permissions/src/lockout.ts`).
- Ist `SWISSHUB_OWNER_DISCORD_ID` gesetzt, gilt dieses Konto als Notzugang und
  die Sperre entfällt - es kommt immer jemand hinein.
- Ist trotzdem niemand mehr berechtigt, zeigt `/server/permissions` einen
  Hinweis. Auf dem Server helfen:

  ```bash
  npm run doctor -- <DEINE_DISCORD_ID>   # Warum habe ich keine Rechte?
  npm run grant:admin -- <ROLLEN_ID>     # Rolle mit Vollzugriff anlegen
  ```

---

## 8. Gesundheitsprüfung

`/server` und `/settings` zeigen den Fertigstellungsgrad der Einrichtung. Jeder
offene Punkt nennt das konkrete Problem und verlinkt direkt auf die Stelle, an
der es sich beheben lässt:

- Server verbunden?
- Rollen und Channels synchronisiert?
- Besitzt der Bot alle Discord-Berechtigungen der aktivierten Module? (`/system/bot`)
- Steht die Bot-Rolle hoch genug? (`/server/roles`)
- Darf mindestens eine Rolle das Dashboard nutzen? (`/server/permissions`)
- Sind die aktivierten Module vollständig konfiguriert? (`/modules`)

Module liefern ihre eigenen Prüfungen über `healthChecks` (siehe `docs/MODULES.md`).

---

## 9. Neue Einstellungen hinzufügen

Ein Modul beschreibt seine Einstellungen einmal - Validierung und Oberfläche
entstehen daraus:

```ts
settingsSchema: z.object({ jailRoleId: optionalSnowflakeSchema }),
settingsFields: [
  {
    key: 'jailRoleId',
    type: 'discord-role',      // ergibt eine Rollenauswahl, kein ID-Feld
    label: 'Jail-Rolle',
    group: 'Discord',
    required: true,
    mustBeManageable: true,    // erzwingt die Hierarchieprüfung beim Speichern
  },
],
configVersion: 2,
requiredDiscordPermissions: ['MANAGE_ROLES'],
```

### Vote Jail

Die Abstimmung ist Teil des Jail-Moduls und wird unter **Module → Jail** konfiguriert:

| Einstellung           | Standard   | Bedeutung                                               |
| --------------------- | ---------- | ------------------------------------------------------- |
| Vote Jail aktiv       | aus        | Schalter für das gesamte Feature                        |
| Vote Jail Channel     | –          | Wo die Abstimmung erscheint (Channel-Auswahl, keine ID) |
| Benötigte Stimmen     | 5          | So viele Stimmen führen zum Jail                        |
| Voting-Dauer          | 5 Minuten  | Danach endet die Abstimmung ohne Ergebnis               |
| Jail-Dauer bei Erfolg | 30 Minuten | Wird über den regulären Jail-Service ausgeführt         |

| Sperrfrist nach Erfolg | 12 Stunden | Danach darf derselbe Initiator wieder starten (0 = aus) |

Berechtigungen: `jail.vote.start` zum Starten, `jail.vote.multivote` für
Mehrfachstimmen und `jail.vote.bypassCooldown` zum Überspringen der Sperrfrist
(typischerweise der Administratorrolle zugewiesen).

### Jail

Unter **Module → Jail**. Der frühere Jail-Bot hatte diese Werte als Konstanten
im Quelltext; hier sind es Einstellungen mit Rollen- und Channel-Auswahl.

| Einstellung                              | Standard | Bedeutung                                                        |
| ---------------------------------------- | -------- | ---------------------------------------------------------------- |
| Jail-Rolle                               | –        | Wird während des Jails vergeben; muss unter der Bot-Rolle liegen |
| Rollen behalten                          | –        | Bleiben zusätzlich erhalten                                      |
| Booster-Rolle / Booster-Rolle behalten   | – / an   | Server-Booster verlieren ihre Rolle während des Jails nicht      |
| Jail-Channel                             | –        | Hinweis an das Mitglied                                          |
| Moderations-Log                          | –        | Überschreibt den zentralen Log für dieses Modul                  |
| Ankündigungs-Channel                     | –        | Öffentliche Meldung bei Jail und Freilassung                     |
| Jail-Ping-Channel                        | –        | Hier wird das Mitglied direkt erwähnt                            |
| Maximale Jail-Dauer                      | 7 Tage   | Obergrenze für zeitlich begrenzte Jails                          |
| Aus Sprachkanal trennen                  | an       | Trennt das Mitglied beim Jail aus einem laufenden Sprachkanal    |
| Jail beim Wiedereintritt erneut anwenden | an       | Ein Jail überlebt Verlassen und erneutes Beitreten               |
| Neue Jails standardmässig still          | aus      | Vorbelegung der öffentlichen Meldung im Formular                 |
| Rolle „männlich“ / „weiblich“            | –        | Optional, ausschliesslich für die Anrede in den Textvorlagen     |

#### Textvorlagen

Die öffentlichen Meldungen sind Vorlagen mit Platzhaltern - sie ersetzen die
früher fest im Code stehenden Varianten:

| Platzhalter                              | Ergebnis                                        |
| ---------------------------------------- | ----------------------------------------------- |
| `{mention}`                              | Erwähnung des Mitglieds                         |
| `{user}`                                 | Anzeigename ohne Erwähnung                      |
| `{moderator}`                            | Name des Moderators                             |
| `{reason}`                               | Angegebener Grund                               |
| `{duration}`                             | z.B. „2 Std.“ oder „permanent“                  |
| `{end_time}` / `{end_relative}`          | Discord-Zeitstempel (Datum bzw. „in 2 Stunden“) |
| `{pronoun}`                              | er / sie / er/sie                               |
| `{gendered:männlich\|weiblich\|neutral}` | Eigene Variante je Geschlecht                   |

Unbekannte Platzhalter bleiben unverändert stehen, damit ein Tippfehler
sichtbar wird. Benutzertext wird escaped; die einzige mögliche Erwähnung ist
`{mention}` und wird beim Senden gezielt über `allowedMentions` freigegeben -
ein `@everyone` in der Vorlage bleibt wirkungslos.

Serverspezifische Emojis (`<:name:id>`) lassen sich direkt in die Vorlage
schreiben. In den Standardvorlagen steht bewusst keines, weil eine Emoji-ID
nur auf einem bestimmten Server gültig ist.

Übernahme der alten Jail-Datenbank: [JAIL_MIGRATION.md](JAIL_MIGRATION.md).

### Spielersuche

Unter **Spielersuche → Einstellungen**. Der frühere Bot hatte diese Werte teils
in `.env`, teils in seiner SQLite-Datenbank.

| Einstellung                                | Standard                | Bedeutung                                                   |
| ------------------------------------------ | ----------------------- | ----------------------------------------------------------- |
| Spielersuche-Channel                       | –                       | Hier werden die Suchen veröffentlicht                       |
| Voice-Kategorie                            | –                       | In dieser Kategorie entstehen die Sprachkanäle              |
| Automatisch schliessen nach                | 12 Stunden              | Ablaufzeit einer Suche (1–168)                              |
| Aktive Suchen pro Person                   | 1                       | Der Vorgänger erlaubte genau eine                           |
| Maximal gesuchte Spieler                   | 20                      | Gilt für Spiele ohne eigene Squad-Grösse                    |
| Spielrolle erwähnen                        | an                      | Rollen-Ping beim Start einer Suche                          |
| Ping-Sperrfrist je Spiel                   | 5 Minuten               | Unterdrückt nur den Ping, nie die Suche. 0 = aus            |
| Embed-Farbe                                | `#AFDBF5`               | Farbe der Suchen-Embeds                                     |
| Fusszeile                                  | SwissHub Spielersuche … | Fusszeile jedes Embeds                                      |
| Sprachkanal automatisch erstellen          | an                      | Je Suche ein eigener Kanal                                  |
| Name des Sprachkanals                      | `🎮・{game}・{creator}` | Platzhalter: `{game}`, `{creator}`, `{id}`                  |
| Leere Sprachkanäle löschen                 | an                      | Nur Kanäle, die dieses Modul erstellt hat                   |
| Teilnehmerlimit des Kanals                 | –                       | Squad-Grösse des Spiels, sonst gesuchte Spieler + Ersteller |
| Ersteller darf im eigenen Kanal moderieren | an                      | Stummschalten und verschieben - nie „Kanäle verwalten"      |
| Tägliche Hinweisnachricht                  | aus                     | Onboarding-Nachricht                                        |
| Uhrzeit                                    | 16:00                   | Zeitzone Europe/Zurich                                      |
| Titel / Text / Banner / Fusszeile          | Vorgabe des alten Bots  | Inhalt der Hinweisnachricht                                 |

Spiele werden nicht hier, sondern unter **Spielersuche → Spiele** gepflegt
(Name, Discord-Rolle, Banner, Squad-Grösse, aktiv). Änderungen wirken sofort -
auch für `/spielersuche` und dessen Autocomplete.

Übernahme der alten Datenbank:
[SPIELERSUCHE_MIGRATION.md](SPIELERSUCHE_MIGRATION.md).

### Level-System

Unter **Level-System → XP-Regeln**, **→ Voice XP** und **→ Inaktivität** - oder
gesammelt unter **Module → Level-System**. Der frühere Bot hatte diese Werte in
seiner `.env`; eine Änderung brauchte dort einen Neustart.

| Einstellung                    | Standard | Bedeutung                                                     |
| ------------------------------ | -------- | ------------------------------------------------------------- |
| XP pro Nachricht               | 10       | Vor Boost und Premium-Multiplikator                           |
| Cooldown                       | 60 s     | Innerhalb dieser Zeit gibt es nur einmal XP                   |
| Cooldown mit Premium-Rolle     | 60 s     | Eigener Wert für Mitglieder mit Premium-Rolle                 |
| Premium-Multiplikator          | 1.0      | Faktor auf XP von Mitgliedern mit Premium-Rolle               |
| Globaler XP-Boost              | 1.0      | Faktor auf jede XP-Vergabe aus Nachrichten und Voice          |
| Channels ohne XP               | –        | Text- und Sprachkanäle, in denen keine XP vergeben wird       |
| Rolle ohne XP                  | –        | Wer sie trägt, sammelt keine XP mehr                          |
| XP pro Voice-Minute            | 10       | Ein Durchgang je Minute; ausgefallene werden nicht nachgeholt |
| Sonder- / Bühnen-Multiplikator | 1.0      | Je Kanalgruppe                                                |
| Kein XP bei Stummschaltung     | an       | Mit Nachlauf und wählbarer Art (`sound`, `voice`, `beide`)    |
| XP auch alleine im Kanal       | an       | Abgeschaltet zählt nur Zeit mit anderen im Kanal              |
| Level-Up-Channel               | –        | Ohne Auswahl gibt es keine Meldung                            |
| Nur diese Level ankündigen     | –        | Leer = jeder Aufstieg                                         |
| XP für das Höchstlevel         | 32 500   | Verschiebt Levelstände - mit Bedacht anfassen                 |
| Inaktivitäts-Abzug             | an       | Schonfrist 7 Tage, dann 50 XP (Tag 1–4) bzw. 25 XP pro Tag    |
| XP-Spiele                      | an       | Auszahlung 95 %, Einsatz 1 bis 5000 XP                        |
| Hintergrund der Levelkarte     | –        | Bild-URL, eigener Hintergrund für Level 31 möglich            |

Die Hintergrundbilder der Levelkarte werden unter **Level-System →
Levelkarte** hochgeladen (900 × 225 für die normale Karte, 900 × 341 für das
Höchstlevel). Eine hochgeladene Datei hat Vorrang vor der Adresse. Die Dateien
liegen im Upload-Verzeichnis (`SWISSHUB_UPLOAD_DIR`); der Bot liest sie von
dort nur lesend mit - im Docker-Betrieb ist das Volume dafür auch am
Bot-Container eingehängt.

Meilenstein-Rollen werden nicht hier, sondern unter **Level-System → Level &
Rollen** gepflegt. Sie lösen `MILESTONE_ROLES="5:ROLEID,10:ROLEID"` aus der
alten `.env` ab.

Übernahme der alten Datenbank: [LEVEL_MIGRATION.md](LEVEL_MIGRATION.md).

### XP-Verlosungen

Verlosungen werden vollständig im Dashboard verwaltet
(**Level-System → XP-Glücksrad**). Es gibt dafür bewusst **keine** Werte in der
`.env`: Einsatz, Zeitraum, Channel und Gewinn gehören zur einzelnen Verlosung,
nicht zur Installation.

Zwei Berechtigungen müssen der Mitglieder-Rolle unter
**Server → Berechtigungen** ausdrücklich zugewiesen werden, sonst sieht
niemand die Seite `/xp-gluecksrad`:

- `level.raffle.view`
- `level.raffle.participate`

Einzelheiten zu Einsatzmodellen, Fairness und Ziehung:
[XP_RAFFLE.md](XP_RAFFLE.md).

### Kommunikation

Unter **Module → Kommunikation**:

| Einstellung                  | Standard                           | Bedeutung                                           |
| ---------------------------- | ---------------------------------- | --------------------------------------------------- |
| Standard-Channel             | –                                  | Vorauswahl im Formular                              |
| Fusszeile                    | `SwissHub • Zäme hock, zäme zocke` | Fusszeile jedes Embeds                              |
| Umfragen mit 👍/👎           | an                                 | Reaktionen automatisch setzen                       |
| @everyone und @here zulassen | aus                                | Zusätzlich zur Berechtigung `communication.mention` |

### Branding

Unter **System → Branding** lässt sich das WebApp-Logo hochladen
(`branding.manage`). In der Datenbank steht nur die Referenz
(`branding.logo` in `SystemConfig`), die Datei liegt in `SWISSHUB_UPLOAD_DIR`.
Details zur Absicherung: [SECURITY.md](SECURITY.md).

### Feldtypen

Verfügbare Feldtypen: `discord-role`, `discord-role-list`, `discord-channel`,
`discord-channel-list`, `boolean`, `number`, `duration`, `text`, `textarea`
(`packages/modules/src/settings/fields.ts`).

Die Seite `/modules/<id>` wird daraus automatisch erzeugt - es ist kein eigenes
Formular nötig.

---

## 10. Migration einer bestehenden Installation

1. Datenbank sichern (`deploy/backup.sh`).
2. Migrationen einspielen: `npm run db:deploy`.
3. Dienste neu starten. Beim Start übernimmt die Anwendung `DISCORD_GUILD_ID`
   und `DISCORD_ADMIN_ROLE_ID` einmalig in die Datenbank.
4. Im Dashboard unter **System → Discord-Sync** einmal synchronisieren.
5. Unter **Module → Jail** die Jail-Rolle prüfen (sie stammt bereits aus den
   Moduleinstellungen und bleibt erhalten).
6. Unter **Server → Berechtigungen** die Rollen prüfen.
7. `DISCORD_GUILD_ID`, `DISCORD_ADMIN_ROLE_ID` und `DISCORD_JAIL_ROLE_ID` aus
   der `.env` entfernen und Dienste erneut starten.

Bestehende Daten bleiben dabei erhalten: die Migration legt ausschliesslich neue
Tabellen an und ergänzt `ModuleState.configVersion`.
