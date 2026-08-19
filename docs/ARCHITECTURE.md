# Architektur

## 1. Ueberblick

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

- **WebApp** rendert die Oberflaeche und fuehrt Moderationsaktionen aus. Discord-Aufrufe laufen
  ueber die REST-Abstraktion, niemals direkt aus React-Komponenten.
- **Bot** haelt die Gateway-Verbindung, schreibt den Heartbeat und erledigt zeitgesteuerte
  Aufgaben (automatische Freilassung, Reconciliation, Aufraeumen).
- **PostgreSQL** ist Source of Truth fuer alles, was einen Neustart ueberleben muss.

WebApp und Bot kommunizieren **nicht** direkt miteinander - sie teilen sich Datenbank und
Servicecode. Dadurch gibt es keinen zusaetzlichen RPC-Kanal, der abgesichert werden muesste,
und beide Prozesse koennen unabhaengig neu gestartet werden.

## 2. Pakete

| Paket                   | Verantwortung                                                                 | Abhaengig von          |
| ----------------------- | ----------------------------------------------------------------------------- | ---------------------- |
| `@swisshub/config`      | ENV-Validierung (Zod), Branding, Cookie-/Session-/Job-Konstanten              | -                      |
| `@swisshub/shared`      | Fehlerhierarchie, `ActionResult`, Zeit-/Textutilities, Pagination, Krypto     | -                      |
| `@swisshub/logger`      | strukturiertes Logging inkl. Secret-Redaction                                 | shared                 |
| `@swisshub/database`    | Prisma Client, Audit Log (Hash-Chain), Rate Limit, Idempotenz, Config-Store   | config, logger         |
| `@swisshub/discord`     | REST-Client mit Rate-Limit-Handling, Fehler-Mapping, Gateway-Interface, Mocks | config, logger, shared |
| `@swisshub/permissions` | Permission Registry, Permission Engine, Rollenhierarchie, Moderation Policy   | database, discord      |
| `@swisshub/modules`     | Module Registry, Kernbereiche, Jail-Modul, Mitglieder-Service, Bot-Status     | alle oberen            |
| `@swisshub/auth`        | Discord OAuth2 (PKCE), Sessions, Identity-Refresh, CSRF, AuthContext          | alle oberen            |

Die Abhaengigkeiten zeigen strikt in eine Richtung. `packages/discord` kennt weder Datenbank
noch Berechtigungen; `packages/permissions` kennt keine UI.

## 3. Request Flow (Moderationsaktion)

```
UI (Client Component)
  |  Server Action Aufruf mit { csrfToken, ...payload }
  v
apps/web/src/server/action.ts        (defineAction)
  |  1. Session validieren                     -> UNAUTHENTICATED
  |  2. Guild-Mitgliedschaft (frisch)          -> NOT_A_MEMBER
  |  3. CSRF-Token pruefen                     -> FORBIDDEN + SecurityEvent
  |  4. Rate Limit (DB, serverseitig)          -> RATE_LIMITED
  |  5. Zod-Validierung                        -> VALIDATION_FAILED
  |  6. Permission Engine                      -> FORBIDDEN + Audit
  v
packages/modules/src/jail/service.ts
  |  7. Moderation Policy (Hierarchie/Schutz)  -> POLICY_VIOLATION + Audit
  |  8. Idempotenzschluessel reservieren       -> CONFLICT (Duplikat)
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

Discord-API und Datenbank lassen sich nicht in einer gemeinsamen Transaktion ausfuehren.
Deshalb traegt jeder Jail-Datensatz einen expliziten Status:

| Status      | Bedeutung                                                            |
| ----------- | -------------------------------------------------------------------- |
| `PENDING`   | Datensatz erstellt, Discord-Aktion noch nicht gestartet              |
| `EXECUTING` | Discord-Aktion laeuft                                                |
| `COMPLETED` | Discord-Aktion erfolgreich                                           |
| `PARTIAL`   | teilweise erfolgreich (z.B. einzelne Rollen nicht wiederherstellbar) |
| `FAILED`    | Discord-Aktion fehlgeschlagen - der Jail gilt als nicht aktiv        |

`recoverStuckJails()` setzt Vorgaenge zurueck, die laenger als 5 Minuten in `PENDING`/`EXECUTING`
haengen (Absturz, Deployment). `reconcileJails()` vergleicht anschliessend den Discord-Zustand
mit der Datenbank und korrigiert Abweichungen.

## 5. Nebenlaeufigkeit

| Risiko                                               | Schutz                                                                                   |
| ---------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| Doppelklick / Retry / Refresh                        | Idempotenzschluessel (`IdempotencyRecord`, Unique)                                       |
| Zwei Moderatoren jailen gleichzeitig dieselbe Person | `JailEntry.activeKey` ist `UNIQUE` und traegt die Discord-ID, solange der Jail aktiv ist |
| Gleichzeitige Freilassung (Moderator + Sweep-Job)    | `updateMany` mit Filter `releasedAt: null` beansprucht den Release atomar                |
| Parallele Audit-Schreibvorgaenge                     | `pg_advisory_xact_lock` serialisiert die Hash-Chain                                      |
| Sweep-Job ueberlappt sich selbst                     | Job-Runner ueberspringt Ticks, solange ein Durchgang laeuft                              |

## 6. Aktualitaet der Discord-Rollen

Rollen koennen sich jederzeit aendern, deshalb wird nie mit Daten aus einer alten Session
gearbeitet:

- `DiscordIdentityCache` speichert Mitgliedschaft und Rollen mit Zeitstempel.
- Normale Seitenaufrufe duerfen den Cache bis `ROLE_CACHE_TTL_SECONDS` (Standard 300 s) nutzen.
- **Schreibende Aktionen** laufen mit `freshness: 'critical'` und akzeptieren maximal
  `ROLE_CRITICAL_TTL_SECONDS` (Standard 30 s) alte Daten - sonst wird direkt bei Discord geladen.
- Der Bot invalidiert den Cache sofort bei `GuildMemberUpdate`/`GuildMemberRemove`.
- Faellt Discord aus, gilt der Benutzer als **nicht** berechtigt (Fail Closed).

## 7. Datenmodell (Auszug)

```
User ──1:n── Session
User ──1:1── DiscordIdentityCache

ManagedRole ──1:n── RolePermission        (Discord-Rolle -> Permission)

JailEntry     activeKey UNIQUE, idempotencyKey UNIQUE, roleSnapshot[]
ModerationAction                          modulunabhaengige Historie
AuditLog      sequence, previousHash, hash (Hash-Chain)
SecurityEvent
SystemConfig  key/value (validiert per Zod)
ModuleState   moduleId, enabled, settings
RateLimitCounter, IdempotencyRecord, BotStatus, ReconciliationRun
```

Alle Zeitstempel werden in UTC gespeichert und erst im UI in `Europe/Zurich` dargestellt
(`formatDateTime` in `@swisshub/shared`).

## 8. Datensparsamkeit

Es wird bewusst **keine** vollstaendige Kopie der Discord-Mitgliederdatenbank gefuehrt:

| Dauerhaft gespeichert                                                        | Nur temporaer von Discord geladen         |
| ---------------------------------------------------------------------------- | ----------------------------------------- |
| Discord-ID, Username, Anzeigename, Avatar-Hash der **angemeldeten** Benutzer | Mitgliederlisten und Suchergebnisse       |
| Mitgliedschaft + Rollen-IDs (Cache mit TTL)                                  | Rollennamen und Farben                    |
| Moderationsvorgaenge (Jail, Audit) inkl. Rollen-Snapshot                     | Channel-Listen                            |
| Pseudonymisierte IP (HMAC) und User-Agent im Audit Log                       | Profildaten nicht angemeldeter Mitglieder |

## 9. Beobachtbarkeit

- Strukturiertes JSON-Logging (Production) bzw. lesbare Zeilen (Entwicklung) mit Redaction.
- `/api/health` prueft WebApp, Datenbank und Bot-Heartbeat.
- `BotStatus` liefert Ping, letzten Heartbeat und letzte erfolgreiche Verbindung.
- `ReconciliationRun` protokolliert jeden Abgleich inklusive gefundener Abweichungen.
- Die Fehlerobjekte tragen stabile Codes (`AppErrorCode`), sodass sich spaeter Sentry oder
  ein Metrik-Exporter ohne Umbau anschliessen laesst.

## 10. Erweiterbarkeit

Neue Funktionen entstehen als Module (`packages/modules/src/<modul>` + optionale UI unter
`apps/web/src/modules/<modul>`). Die Module Registry liefert Navigation, Berechtigungen und
Einstellungen automatisch. Details: [MODULES.md](MODULES.md).
