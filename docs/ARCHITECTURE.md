# Architektur

## 1. Überblick

Die SwissHub Bot WebApp besteht aus drei Laufzeitkomponenten und einem gemeinsamen
Paket-Kern in einem npm-Workspace-Monorepo.

```
                        +---------------------------+
   Browser  --------->  |  Next.js WebApp (apps/web)|
   (Moderator)          |  RSC + Server Actions     |
                        +-------------+-------------+
                                      |
                        gemeinsame Pakete (packages/*)
                                      |
        +-----------------------------+-----------------------------+
        |                             |                             |
+-------v--------+          +---------v---------+         +---------v---------+
|  PostgreSQL    |          |  Discord REST API |         |  Discord Gateway  |
|  (Prisma)      |          |  (packages/discord)|        |  (apps/bot)       |
+-------^--------+          +---------+---------+         +---------+---------+
        |                             |                             |
        +-----------------------------+-----------------------------+
                                      |
                        +-------------v-------------+
                        |  Discord Bot (apps/bot)   |
                        |  Jobs: Sweep, Reconcile,  |
                        |  Heartbeat, Cleanup       |
                        +---------------------------+
```

- **WebApp** rendert die Oberfläche und führt Moderationsaktionen aus. Discord-Aufrufe laufen
  über die REST-Abstraktion, niemals direkt aus React-Komponenten.
- **Bot** hält die Gateway-Verbindung, schreibt den Heartbeat und erledigt zeitgesteuerte
  Aufgaben (automatische Freilassung, Reconciliation, Aufräumen).
- **PostgreSQL** ist Source of Truth für alles, was einen Neustart überleben muss.

WebApp und Bot kommunizieren **nicht** direkt miteinander - sie teilen sich Datenbank und
Servicecode. Dadurch gibt es keinen zusätzlichen RPC-Kanal, der abgesichert werden müsste,
und beide Prozesse können unabhängig neu gestartet werden.

## 2. Pakete

| Paket                   | Verantwortung                                                                 | Abhängig von           |
| ----------------------- | ----------------------------------------------------------------------------- | ---------------------- |
| `@swisshub/config`      | ENV-Validierung (Zod), Branding, Cookie-/Session-/Job-Konstanten              | -                      |
| `@swisshub/shared`      | Fehlerhierarchie, `ActionResult`, Zeit-/Textutilities, Pagination, Krypto     | -                      |
| `@swisshub/logger`      | strukturiertes Logging inkl. Secret-Redaction                                 | shared                 |
| `@swisshub/database`    | Prisma Client, Audit Log (Hash-Chain), Rate Limit, Idempotenz, Config-Store   | config, logger         |
| `@swisshub/discord`     | REST-Client mit Rate-Limit-Handling, Fehler-Mapping, Gateway-Interface, Mocks | config, logger, shared |
| `@swisshub/permissions` | Permission Registry, Permission Engine, Rollenhierarchie, Moderation Policy   | database, discord      |
| `@swisshub/modules`     | Module Registry, Kernbereiche, Jail-Modul, Mitglieder-Service, Bot-Status     | alle oberen            |
| `@swisshub/auth`        | Discord OAuth2 (PKCE), Sessions, Identity-Refresh, CSRF, AuthContext          | alle oberen            |

Die Abhängigkeiten zeigen strikt in eine Richtung. `packages/discord` kennt weder Datenbank
noch Berechtigungen; `packages/permissions` kennt keine UI.

## 3. Request Flow (Moderationsaktion)

```
UI (Client Component)
  |  Server Action Aufruf mit { csrfToken, ...payload }
  v
apps/web/src/server/action.ts        (defineAction)
  |  1. Session validieren                     -> UNAUTHENTICATED
  |  2. Guild-Mitgliedschaft (frisch)          -> NOT_A_MEMBER
  |  3. CSRF-Token prüfen                     -> FORBIDDEN + SecurityEvent
  |  4. Rate Limit (DB, serverseitig)          -> RATE_LIMITED
  |  5. Zod-Validierung                        -> VALIDATION_FAILED
  |  6. Permission Engine                      -> FORBIDDEN + Audit
  v
packages/modules/src/jail/service.ts
  |  7. Moderation Policy (Hierarchie/Schutz)  -> POLICY_VIOLATION + Audit
  |  8. Idempotenzschlüssel reservieren       -> CONFLICT (Duplikat)
  |  9. DB-Datensatz PENDING (Unique activeKey)-> CONFLICT (Race)
  | 10. Discord-Aktion (REST)                  -> FAILED + Audit
  | 11. Status COMPLETED/PARTIAL + Audit + ModerationAction
  | 12. Discord-Benachrichtigung (best effort)
  v
ActionResult<T>  ->  Toast im UI
```

Jeder Schritt kann abbrechen; ein Abbruch bedeutet immer **keine Discord-Aktion**
(Fail Closed).

## 4. Zustandsmodell einer Moderationsaktion

Discord-API und Datenbank lassen sich nicht in einer gemeinsamen Transaktion ausführen.
Deshalb trägt jeder Jail-Datensatz einen expliziten Status:

| Status      | Bedeutung                                                            |
| ----------- | -------------------------------------------------------------------- |
| `PENDING`   | Datensatz erstellt, Discord-Aktion noch nicht gestartet              |
| `EXECUTING` | Discord-Aktion läuft                                                 |
| `COMPLETED` | Discord-Aktion erfolgreich                                           |
| `PARTIAL`   | teilweise erfolgreich (z.B. einzelne Rollen nicht wiederherstellbar) |
| `FAILED`    | Discord-Aktion fehlgeschlagen - der Jail gilt als nicht aktiv        |

`recoverStuckJails()` setzt Vorgänge zurück, die länger als 5 Minuten in `PENDING`/`EXECUTING`
hängen (Absturz, Deployment). `reconcileJails()` vergleicht anschliessend den Discord-Zustand
mit der Datenbank und korrigiert Abweichungen.

## 5. Nebenläufigkeit

| Risiko                                               | Schutz                                                                                  |
| ---------------------------------------------------- | --------------------------------------------------------------------------------------- |
| Doppelklick / Retry / Refresh                        | Idempotenzschlüssel (`IdempotencyRecord`, Unique)                                       |
| Zwei Moderatoren jailen gleichzeitig dieselbe Person | `JailEntry.activeKey` ist `UNIQUE` und trägt die Discord-ID, solange der Jail aktiv ist |
| Gleichzeitige Freilassung (Moderator + Sweep-Job)    | `updateMany` mit Filter `releasedAt: null` beansprucht den Release atomar               |
| Parallele Audit-Schreibvorgänge                      | `pg_advisory_xact_lock` serialisiert die Hash-Chain                                     |
| Sweep-Job überlappt sich selbst                      | Job-Runner überspringt Ticks, solange ein Durchgang läuft                               |

## 6. Aktualität der Discord-Rollen

Rollen können sich jederzeit ändern, deshalb wird nie mit Daten aus einer alten Session
gearbeitet:

- `DiscordIdentityCache` speichert Mitgliedschaft und Rollen mit Zeitstempel.
- Normale Seitenaufrufe dürfen den Cache bis `ROLE_CACHE_TTL_SECONDS` (Standard 300 s) nutzen.
- **Schreibende Aktionen** laufen mit `freshness: 'critical'` und akzeptieren maximal
  `ROLE_CRITICAL_TTL_SECONDS` (Standard 30 s) alte Daten - sonst wird direkt bei Discord geladen.
- Der Bot invalidiert den Cache sofort bei `GuildMemberUpdate`/`GuildMemberRemove`.
- Fällt Discord aus, gilt der Benutzer als **nicht** berechtigt (Fail Closed).

## 7. Datenmodell (Auszug)

```
User ──1:n── Session
User ──1:1── DiscordIdentityCache

ManagedRole ──1:n── RolePermission        (Discord-Rolle -> Permission)

JailEntry     activeKey UNIQUE, idempotencyKey UNIQUE, roleSnapshot[]
ModerationAction                          modulunabhängige Historie
AuditLog      sequence, previousHash, hash (Hash-Chain)
SecurityEvent
SystemConfig  key/value (validiert per Zod)
ModuleState   moduleId, enabled, settings
RateLimitCounter, IdempotencyRecord, BotStatus, ReconciliationRun
```

Alle Zeitstempel werden in UTC gespeichert und erst im UI in `Europe/Zurich` dargestellt
(`formatDateTime` in `@swisshub/shared`).

## 8. Datensparsamkeit

Es wird bewusst **keine** vollständige Kopie der Discord-Mitgliederdatenbank geführt:

| Dauerhaft gespeichert                                                        | Nur temporär von Discord geladen          |
| ---------------------------------------------------------------------------- | ----------------------------------------- |
| Discord-ID, Username, Anzeigename, Avatar-Hash der **angemeldeten** Benutzer | Mitgliederlisten und Suchergebnisse       |
| Mitgliedschaft + Rollen-IDs (Cache mit TTL)                                  | Rollennamen und Farben                    |
| Moderationsvorgänge (Jail, Audit) inkl. Rollen-Snapshot                      | Channel-Listen                            |
| Pseudonymisierte IP (HMAC) und User-Agent im Audit Log                       | Profildaten nicht angemeldeter Mitglieder |

## 9. Beobachtbarkeit

- Strukturiertes JSON-Logging (Production) bzw. lesbare Zeilen (Entwicklung) mit Redaction.
- `/api/health` prüft WebApp, Datenbank und Bot-Heartbeat.
- `BotStatus` liefert Ping, letzten Heartbeat und letzte erfolgreiche Verbindung.
- `ReconciliationRun` protokolliert jeden Abgleich inklusive gefundener Abweichungen.
- Die Fehlerobjekte tragen stabile Codes (`AppErrorCode`), sodass sich später Sentry oder
  ein Metrik-Exporter ohne Umbau anschliessen lässt.

## 10. Erweiterbarkeit

Neue Funktionen entstehen als Module (`packages/modules/src/<modul>` + optionale UI unter
`apps/web/src/modules/<modul>`). Die Module Registry liefert Navigation, Berechtigungen und
Einstellungen automatisch. Details: [MODULES.md](MODULES.md).
