# SwissHub Bot WebApp

Zentrale Administrations- und Moderationsoberflaeche fuer den SwissHub Discord-Server.
Die Anwendung besteht aus einer Next.js WebApp, einem discord.js Bot und einer PostgreSQL-Datenbank
in einem TypeScript-Monorepo. Das erste vollstaendig implementierte Modul ist das **Jail-System**;
die Architektur ist darauf ausgelegt, weitere Module (Warnings, Tickets, Giveaways, ...) ohne Umbau
zu ergaenzen.

```
Login mit Discord  ->  Guild-Check  ->  Permission Engine  ->  Moderation Policy  ->  Discord-Aktion  ->  Audit Log
```

- **Sicherheit zuerst:** jede Aktion wird serverseitig authentifiziert, autorisiert und protokolliert.
- **Datenbank als Source of Truth:** Jails ueberleben Neustart, Deployment und Crash.
- **Modular:** Navigation, Berechtigungen und Einstellungen entstehen aus der Module Registry.

---

## Inhalt

1. [Voraussetzungen](#1-voraussetzungen)
2. [Discord Developer Application erstellen](#2-discord-developer-application-erstellen)
3. [Discord Bot erstellen](#3-discord-bot-erstellen)
4. [OAuth Redirect URI konfigurieren](#4-oauth-redirect-uri-konfigurieren)
5. [Bot auf SwissHub hinzufuegen](#5-bot-auf-swisshub-hinzufuegen)
6. [Benoetigte Bot Permissions](#6-benoetigte-bot-permissions)
7. [.env konfigurieren](#7-env-konfigurieren)
8. [PostgreSQL starten](#8-postgresql-starten)
9. [Migration durchfuehren](#9-migration-durchfuehren)
10. [Development Server starten](#10-development-server-starten)
11. [Bot starten](#11-bot-starten)
12. [Production Build erstellen](#12-production-build-erstellen)
13. [Projektstruktur](#projektstruktur)
14. [Skripte](#skripte)
15. [Erste Schritte in der WebApp](#erste-schritte-in-der-webapp)
16. [Troubleshooting](#troubleshooting)

---

## 1. Voraussetzungen

| Werkzeug   | Version                 | Hinweis                     |
| ---------- | ----------------------- | --------------------------- |
| Node.js    | >= 20.11 (empfohlen 22) | `node -v`                   |
| npm        | >= 10                   | Workspaces werden verwendet |
| PostgreSQL | >= 14 (empfohlen 16)    | lokal via Docker moeglich   |
| Docker     | optional                | fuer die lokale Datenbank   |

Du benoetigst ausserdem **Administratorrechte auf dem SwissHub Discord-Server**, um den Bot
hinzuzufuegen und Rollen einzuordnen.

```bash
git clone https://github.com/maanu0001/SwissHub_Bot-WebApp.git
cd SwissHub_Bot-WebApp
npm install
```

---

## 2. Discord Developer Application erstellen

1. <https://discord.com/developers/applications> oeffnen.
2. **New Application** -> Name z.B. `SwissHub Bot` -> erstellen.
3. Im Reiter **OAuth2** findest du:
   - **Client ID** -> `DISCORD_CLIENT_ID`
   - **Client Secret** (Reset Secret) -> `DISCORD_CLIENT_SECRET`

> Das Client Secret gehoert ausschliesslich in die `.env` auf dem Server - niemals ins Repository.

---

## 3. Discord Bot erstellen

1. Reiter **Bot** -> **Add Bot**.
2. **Reset Token** -> Token kopieren -> `DISCORD_BOT_TOKEN`.
3. **Privileged Gateway Intents**:
   - **SERVER MEMBERS INTENT**: **aktivieren** (zwingend - ohne diesen Intent funktionieren
     Mitgliedersuche, Rollenabgleich und automatische Cache-Invalidierung nicht).
   - Message Content Intent: **nicht** noetig - bitte deaktiviert lassen (Least Privilege).
   - Presence Intent: **nicht** noetig.
4. **Public Bot** kann deaktiviert werden, damit niemand sonst den Bot einladen kann.

---

## 4. OAuth Redirect URI konfigurieren

Reiter **OAuth2 -> Redirects** -> **Add Redirect**:

```
http://localhost:3000/api/auth/callback/discord      # Entwicklung
https://deine-domain.tld/api/auth/callback/discord   # Production
```

Die Redirect URI wird aus `NEXT_PUBLIC_APP_URL` gebildet und muss exakt uebereinstimmen
(inklusive Protokoll, ohne abschliessenden Slash bei `NEXT_PUBLIC_APP_URL`).

Verwendeter Scope: **`identify`**. Mehr wird nicht angefragt - Guild-Mitgliedschaft und Rollen
liest der Bot mit seinem eigenen Token. Dadurch muss die WebApp keine Benutzer-Tokens speichern.

---

## 5. Bot auf SwissHub hinzufuegen

Einladungslink erzeugen (Client ID einsetzen):

```
https://discord.com/api/oauth2/authorize?client_id=DEINE_CLIENT_ID&scope=bot&permissions=268454912
```

Alternativ ueber **OAuth2 -> URL Generator**: Scope `bot`, Permissions wie unten.

### Wichtig: Rollenhierarchie

```
  Owner / geschuetzte Admin-Rollen      <- duerfen ueber dem Bot bleiben
  ------------------------------------
  SwissHub Bot                          <- Rolle des Bots
  ------------------------------------
  Moderator, Supporter, Member, Jail    <- alle Rollen, die der Bot verwalten soll
```

Die **Bot-Rolle muss oberhalb aller Rollen liegen, die der Bot verwalten soll** (insbesondere
oberhalb der Jail-Rolle und aller Rollen, die beim Jail entzogen und spaeter wiederhergestellt
werden). Discord erlaubt keinem Bot, Rollen zu vergeben, die auf oder ueber seiner eigenen
hoechsten Rolle liegen.

Geschuetzte Administrator-Rollen duerfen und sollen **oberhalb** der Bot-Rolle bleiben - ihre
Traeger sind dadurch technisch nicht moderierbar. Die Moderation Policy lehnt solche Aktionen
bereits vorher mit einer verstaendlichen Meldung ab (`BOT_ROLE_TOO_LOW`).

Rollen einordnen: **Servereinstellungen -> Rollen -> per Drag & Drop**.

---

## 6. Benoetigte Bot Permissions

Least Privilege - der Bot braucht **keine** Administratorrechte:

| Permission      | Bit         | Wofuer                                                 |
| --------------- | ----------- | ------------------------------------------------------ |
| `Manage Roles`  | `268435456` | Jail-Rolle vergeben/entziehen, Rollen wiederherstellen |
| `View Channels` | `1024`      | Log-/Jail-Channel aufloesen                            |
| `Send Messages` | `2048`      | Moderations-Embeds posten                              |
| `Embed Links`   | `16384`     | Embeds darstellen                                      |
| **Summe**       | `268454912` |                                                        |

Zusaetzlich benoetigt der Bot im Log-/Jail-Channel Lese- und Schreibrechte (Kanalrechte).

Gateway Intents: `GUILDS`, `GUILD_MEMBERS` (privilegiert, siehe Schritt 3).

---

## 7. `.env` konfigurieren

```bash
cp .env.example .env
```

Anschliessend ausfuellen:

| Variable                    | Pflicht   | Beschreibung                                                              |
| --------------------------- | --------- | ------------------------------------------------------------------------- |
| `DATABASE_URL`              | ja        | PostgreSQL Connection String                                              |
| `DISCORD_CLIENT_ID`         | ja        | Application -> OAuth2                                                     |
| `DISCORD_CLIENT_SECRET`     | ja        | Application -> OAuth2                                                     |
| `DISCORD_BOT_TOKEN`         | ja        | Application -> Bot                                                        |
| `DISCORD_GUILD_ID`          | ja        | ID des SwissHub Servers (Entwicklermodus -> Rechtsklick auf Server -> ID) |
| `AUTH_SECRET`               | ja        | >= 32 Zeichen, z.B. `openssl rand -base64 48`                             |
| `NEXT_PUBLIC_APP_URL`       | ja        | Basis-URL der WebApp, in Production zwingend `https://`                   |
| `DISCORD_ADMIN_ROLE_ID`     | empfohlen | erhaelt beim ersten Start automatisch `admin.full`                        |
| `DISCORD_JAIL_ROLE_ID`      | optional  | Startwert fuer die Jail-Rolle (spaeter im UI aenderbar)                   |
| `SWISSHUB_OWNER_DISCORD_ID` | optional  | Owner mit Sonderrechten fuer systemkritische Funktionen                   |
| `TRUST_PROXY`               | optional  | `true`, wenn hinter nginx/Traefik (fuer `X-Forwarded-For`)                |
| `DEV_MOCK_DISCORD`          | optional  | nur Entwicklung; in Production wird der Start hart abgebrochen            |

Die Konfiguration wird beim Start mit Zod validiert. Fehlt etwas, bricht der Start mit einer
konkreten Meldung ab (`packages/config/src/env.ts`).

> **Discord IDs finden:** Discord -> Einstellungen -> Erweitert -> _Entwicklermodus_ aktivieren.
> Danach Rechtsklick auf Server/Rolle/Channel -> _ID kopieren_.

---

## 8. PostgreSQL starten

Mit Docker (empfohlen fuer die Entwicklung):

```bash
docker compose up -d
```

Damit laeuft PostgreSQL 16 auf `localhost:5432` mit Benutzer/Passwort/Datenbank `swisshub`
(passend zum `DATABASE_URL` aus `.env.example`).

---

## 9. Migration durchfuehren

```bash
npm run db:deploy    # Migrationen anwenden (Production/CI)
npm run db:seed      # Grundkonfiguration + Administratorrolle anlegen
```

Waehrend der Entwicklung, wenn du das Schema aenderst:

```bash
npm run db:migrate   # prisma migrate dev
```

---

## 10. Development Server starten

```bash
npm run dev
```

WebApp: <http://localhost:3000>

Ohne Discord-Zugang kann die UI mit kontrollierten Mock-Daten entwickelt werden:

```env
DEV_MOCK_DISCORD=true
```

Dieser Modus liefert deterministische Testmitglieder und fuehrt **keine** echten Discord-Aktionen
aus. In Production wird er abgelehnt (Start bricht ab).

---

## 11. Bot starten

In einem zweiten Terminal:

```bash
npm run dev:bot
```

Der Bot uebernimmt:

- Heartbeat/Status fuer das Dashboard,
- automatische Freilassung abgelaufener Jails (Datenbank-Sweep, kein `setTimeout`),
- Wiederherstellung haengengebliebener Vorgaenge nach Absturz/Deployment,
- periodische Reconciliation (Discord vs. Datenbank),
- Invalidierung des Rollen-Caches bei Rollenaenderungen,
- Aufraeumen abgelaufener Sessions und Idempotenzschluessel.

---

## 12. Production Build erstellen

```bash
npm run check     # Format, Lint, Typecheck, Tests
npm run build     # Prisma Client + Next.js Build + Bot Typecheck
npm run start     # WebApp (Port 3000)
npm run start:bot # Bot
```

Mit Docker (WebApp + Bot + PostgreSQL):

```bash
cp .env.example .env      # ausfuellen (inkl. POSTGRES_PASSWORD)
docker compose -f docker-compose.prod.yml up -d --build
docker compose -f docker-compose.prod.yml exec web npm run db:deploy
docker compose -f docker-compose.prod.yml exec web npm run db:seed
```

Health Check: `GET /api/health` (liefert Status von WebApp, Datenbank und Bot ohne sensible Details).

---

## Projektstruktur

```
apps/
  web/                     Next.js 15 App Router (UI, Server Actions, Route Handler)
  bot/                     discord.js Bot (Gateway, Hintergrundjobs, Shutdown)

packages/
  config/                  ENV-Validierung (Zod), Branding, zentrale Konstanten
  shared/                  Fehlerobjekte, Zeit-/Textutilities, Pagination, Krypto
  logger/                  strukturiertes Logging mit Secret-Redaction
  database/                Prisma Schema, Migrationen, Audit Log, Rate Limit, Idempotenz
  discord/                 Discord-Abstraktion (REST, Rate Limits, Fehler, Mock-Gateway)
  permissions/             Permission Registry, Permission Engine, Moderation Policy
  modules/                 Module Registry, Kernbereiche, Jail-Modul, Mitglieder-Service
  auth/                    Discord OAuth2, Sessions, Identity-Refresh, CSRF

docs/
  ARCHITECTURE.md          Systemkomponenten und Request Flow
  SECURITY.md              Sicherheitsarchitektur und Annahmen
  MODULES.md               Anleitung: neues Modul entwickeln

tests/                     Unit- und Integrationstests (Vitest)
```

---

## Skripte

| Befehl               | Wirkung                                        |
| -------------------- | ---------------------------------------------- |
| `npm run dev`        | WebApp im Entwicklungsmodus                    |
| `npm run dev:bot`    | Bot im Entwicklungsmodus (Watch)               |
| `npm run build`      | Prisma Client, Next.js Build, Bot Typecheck    |
| `npm run start`      | WebApp (Production)                            |
| `npm run start:bot`  | Bot (Production)                               |
| `npm run lint`       | ESLint ueber das gesamte Monorepo              |
| `npm run typecheck`  | TypeScript strict ueber Pakete, Bot und WebApp |
| `npm run test`       | Vitest (Unit + Integration)                    |
| `npm run check`      | Format-Check, Lint, Typecheck, Tests           |
| `npm run db:migrate` | Migration erstellen/anwenden (Entwicklung)     |
| `npm run db:deploy`  | Migrationen anwenden (Production)              |
| `npm run db:seed`    | Grundkonfiguration anlegen                     |
| `npm run db:studio`  | Prisma Studio                                  |

---

## Erste Schritte in der WebApp

1. **Anmelden**: `Mit Discord anmelden`. Nur Mitglieder des konfigurierten Servers erhalten Zugriff.
2. **Berechtigungen vergeben**: _Einstellungen -> Rollen & Berechtigungen_. Ordne Discord-Rollen
   Permissions zu, z.B.:
   - Administrator -> `admin.full`, geschuetzt, Moderationsstufe 100
   - Moderator -> `jail.view`, `jail.create`, `jail.release`, `members.view`, Stufe 50
   - Supporter -> `members.view`, Stufe 10
3. **Jail konfigurieren**: _Einstellungen -> Jail_. Jail-Rolle, Channels und maximale Dauer setzen.
   Die Auswahl bietet nur Rollen an, die der Bot tatsaechlich verwalten kann.
4. **Testen**: _Mitglieder_ -> Mitglied oeffnen -> _Mitglied jailen_. Nach Ablauf gibt der Bot das
   Mitglied automatisch frei und stellt die Rollen wieder her.
5. **Nachvollziehen**: _Audit Log_ zeigt jede Aktion inklusive Integritaetspruefung der Hash-Chain.

---

## Troubleshooting

| Symptom                                                          | Ursache / Loesung                                                                          |
| ---------------------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| `Ungueltige oder fehlende Umgebungsvariablen`                    | `.env` unvollstaendig - die Meldung nennt die betroffenen Variablen.                       |
| `Der Bot besitzt moeglicherweise nicht genuegend Berechtigungen` | Bot-Rolle zu niedrig oder `Manage Roles` fehlt. Rollenreihenfolge pruefen.                 |
| Mitgliedersuche liefert nichts                                   | **SERVER MEMBERS INTENT** im Developer Portal aktivieren.                                  |
| `Bot derzeit nicht erreichbar`                                   | Bot-Prozess laeuft nicht oder Heartbeat ist aelter als 70 Sekunden.                        |
| Login endet auf `/access-denied`                                 | Discord-Konto ist (noch) kein Mitglied des konfigurierten Servers.                         |
| Login-Fehler `state`                                             | Cookies blockiert oder Redirect URI stimmt nicht exakt mit `NEXT_PUBLIC_APP_URL` ueberein. |
| Jail schlaegt mit `CONFIGURATION_MISSING` fehl                   | Es ist keine Jail-Rolle hinterlegt (_Einstellungen -> Jail_).                              |

---

## Weiterfuehrende Dokumentation

- [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) - Systemkomponenten, Datenfluss, Zustaende
- [docs/SECURITY.md](docs/SECURITY.md) - Authentifizierung, Autorisierung, Secrets, Annahmen
- [docs/MODULES.md](docs/MODULES.md) - Schritt-fuer-Schritt: neues Modul entwickeln
