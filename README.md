# SwissHub Bot WebApp

Zentrale Administrations- und Moderationsoberfläche für den SwissHub Discord-Server.
Die Anwendung besteht aus einer Next.js WebApp, einem discord.js Bot und einer PostgreSQL-Datenbank
in einem TypeScript-Monorepo. Umgesetzt sind die Module **Jail**, **Kommunikation**,
**Spielersuche** und **Level-System**; die Architektur ist darauf ausgelegt, weitere Module ohne
Umbau zu ergänzen (siehe [docs/MODULES.md](docs/MODULES.md)).

```
Login mit Discord  ->  Guild-Check  ->  Permission Engine  ->  Moderation Policy  ->  Discord-Aktion  ->  Audit Log
```

- **Sicherheit zuerst:** jede Aktion wird serverseitig authentifiziert, autorisiert und protokolliert.
- **Datenbank als Source of Truth:** Jails überleben Neustart, Deployment und Crash.
- **Modular:** Navigation, Berechtigungen und Einstellungen entstehen aus der Module Registry.
- **Jail:** zeitlich begrenzt oder permanent, mit Rollen-Snapshot und automatischer Freilassung.
- **Vote Jail:** Community-Abstimmung, die bei Erfolg über dieselbe Jail-Engine ausgeführt wird.
- **Slash Commands:** `/jail`, `/silent_jail`, `/jail_free`, `/jail_list` und `/vote_jail` als
  Adapter auf genau dieselben Dienste wie das Dashboard - kein zweites Jail-System.
  Dazu `/spielersuche`, `/spielersuche-hilf`, `/spielersuche-stats` und `/spielersucheadmin`.
- **Spielersuche:** Mitspieler finden - `/spielersuche` und Dashboard nutzen dieselbe Engine,
  inklusive automatischem Sprachkanal, Rollen-Ping mit Sperrfrist und Statistik.
- **Voice Hub:** Wer einen Hub-Channel betritt, bekommt seinen eigenen Talk - mit Bedienfeld
  im Textchat des Kanals und derselben Verwaltung im Dashboard. Die Spielersuche legt ihre
  Sprachkanäle über dieselbe Engine an - kein zweites Temp-Voice-System.
- **Kommunikation:** Neuigkeiten, Events und Umfragen als Discord-Embeds mit Live-Vorschau –
  auch über den Slash Command `/post`.
- **Level-System:** XP für Nachrichten und Zeit im Voice, Level-Rollen, Inaktivitäts-Abzug und
  XP-Spiele. Jede Änderung steht als Zeile im XP-Journal - der Punktestand ist die Summe daraus.
  Dazu `/level`, `/leaderboard`, `/level_stats`, `/global_stats`, `/check_user`,
  `/game_leaderboard`, die XP-Spiele und die verwaltenden Befehle des alten Level-Bots.

---

## Inhalt

1. [Voraussetzungen](#1-voraussetzungen)
2. [Discord Developer Application erstellen](#2-discord-developer-application-erstellen)
3. [Discord Bot erstellen](#3-discord-bot-erstellen)
4. [OAuth Redirect URI konfigurieren](#4-oauth-redirect-uri-konfigurieren)
5. [Bot auf SwissHub hinzufügen](#5-bot-auf-swisshub-hinzufügen)
6. [Benötigte Bot Permissions](#6-benötigte-bot-permissions)
7. [.env konfigurieren](#7-env-konfigurieren)
8. [PostgreSQL starten](#8-postgresql-starten)
9. [Migration durchführen](#9-migration-durchführen)
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
| PostgreSQL | >= 14 (empfohlen 16)    | lokal via Docker möglich    |
| Docker     | optional                | für die lokale Datenbank    |

Du benötigst ausserdem **Administratorrechte auf dem SwissHub Discord-Server**, um den Bot
hinzuzufügen und Rollen einzuordnen.

```bash
git clone https://github.com/maanu0001/SwissHub_Bot-WebApp.git
cd SwissHub_Bot-WebApp
npm install
```

---

## 2. Discord Developer Application erstellen

1. <https://discord.com/developers/applications> öffnen.
2. **New Application** -> Name z.B. `SwissHub Bot` -> erstellen.
3. Im Reiter **OAuth2** findest du:
   - **Client ID** -> `DISCORD_CLIENT_ID`
   - **Client Secret** (Reset Secret) -> `DISCORD_CLIENT_SECRET`

> Das Client Secret gehört ausschliesslich in die `.env` auf dem Server - niemals ins Repository.

---

## 3. Discord Bot erstellen

1. Reiter **Bot** -> **Add Bot**.
2. **Reset Token** -> Token kopieren -> `DISCORD_BOT_TOKEN`.
3. **Privileged Gateway Intents**:
   - **SERVER MEMBERS INTENT**: **aktivieren** (zwingend - ohne diesen Intent funktionieren
     Mitgliedersuche, Rollenabgleich und automatische Cache-Invalidierung nicht).
   - Message Content Intent: **nicht** nötig - bitte deaktiviert lassen (Least Privilege).
   - Presence Intent: **nicht** nötig.
4. **Public Bot** kann deaktiviert werden, damit niemand sonst den Bot einladen kann.

---

## 4. OAuth Redirect URI konfigurieren

Reiter **OAuth2 -> Redirects** -> **Add Redirect**:

```
http://localhost:3000/api/auth/callback/discord      # Entwicklung
https://deine-domain.tld/api/auth/callback/discord   # Production
```

Die Redirect URI wird aus `NEXT_PUBLIC_APP_URL` gebildet und muss exakt übereinstimmen
(inklusive Protokoll, ohne abschliessenden Slash bei `NEXT_PUBLIC_APP_URL`).

Verwendeter Scope: **`identify`**. Mehr wird nicht angefragt - Guild-Mitgliedschaft und Rollen
liest der Bot mit seinem eigenen Token. Dadurch muss die WebApp keine Benutzer-Tokens speichern.

---

## 5. Bot auf SwissHub hinzufügen

Einladungslink erzeugen (Client ID einsetzen):

```
https://discord.com/api/oauth2/authorize?client_id=DEINE_CLIENT_ID&scope=bot&permissions=268454912
```

Alternativ über **OAuth2 -> URL Generator**: Scope `bot`, Permissions wie unten.

### Wichtig: Rollenhierarchie

```
  Owner / geschützte Admin-Rollen      <- dürfen über dem Bot bleiben
  ------------------------------------
  SwissHub Bot                          <- Rolle des Bots
  ------------------------------------
  Moderator, Supporter, Member, Jail    <- alle Rollen, die der Bot verwalten soll
```

Die **Bot-Rolle muss oberhalb aller Rollen liegen, die der Bot verwalten soll** (insbesondere
oberhalb der Jail-Rolle und aller Rollen, die beim Jail entzogen und später wiederhergestellt
werden). Discord erlaubt keinem Bot, Rollen zu vergeben, die auf oder über seiner eigenen
höchsten Rolle liegen.

Geschützte Administrator-Rollen dürfen und sollen **oberhalb** der Bot-Rolle bleiben - ihre
Träger sind dadurch technisch nicht moderierbar. Die Moderation Policy lehnt solche Aktionen
bereits vorher mit einer verständlichen Meldung ab (`BOT_ROLE_TOO_LOW`).

Rollen einordnen: **Servereinstellungen -> Rollen -> per Drag & Drop**.

---

## 6. Benötigte Bot Permissions

Least Privilege - der Bot braucht **keine** Administratorrechte:

| Permission      | Bit         | Wofür                                                  |
| --------------- | ----------- | ------------------------------------------------------ |
| `Manage Roles`  | `268435456` | Jail-Rolle vergeben/entziehen, Rollen wiederherstellen |
| `View Channels` | `1024`      | Log-/Jail-Channel auflösen                             |
| `Send Messages` | `2048`      | Moderations-Embeds posten                              |
| `Embed Links`   | `16384`     | Embeds darstellen                                      |
| **Summe**       | `268454912` |                                                        |

Zusätzlich benötigt der Bot im Log-/Jail-Channel Lese- und Schreibrechte (Kanalrechte).

Gateway Intents: `GUILDS`, `GUILD_MEMBERS` (privilegiert, siehe Schritt 3), `GUILD_MESSAGES`
und `GUILD_VOICE_STATES`. Die beiden letzten sind **nicht** privilegiert und werden für XP aus
Nachrichten und Voice sowie für die Sprachkanäle der Spielersuche gebraucht. Der Inhalt von
Nachrichten wird nicht gelesen - `MESSAGE_CONTENT` bleibt deshalb aus.

---

## 7. `.env` konfigurieren

```bash
cp .env.example .env
```

Anschliessend ausfüllen:

| Variable                    | Pflicht   | Beschreibung                                                            |
| --------------------------- | --------- | ----------------------------------------------------------------------- |
| `DATABASE_URL`              | ja        | PostgreSQL Connection String                                            |
| `DISCORD_CLIENT_ID`         | ja        | Application -> OAuth2                                                   |
| `DISCORD_CLIENT_SECRET`     | ja        | Application -> OAuth2                                                   |
| `DISCORD_BOT_TOKEN`         | ja        | Application -> Bot                                                      |
| `AUTH_SECRET`               | ja        | >= 32 Zeichen, z.B. `openssl rand -base64 48`                           |
| `NEXT_PUBLIC_APP_URL`       | ja        | Basis-URL der WebApp, in Production zwingend `https://`                 |
| `SWISSHUB_OWNER_DISCORD_ID` | empfohlen | Notzugang mit permanentem Vollzugriff (nicht über die WebApp vergebbar) |
| `TRUST_PROXY`               | optional  | `true`, wenn hinter nginx/Traefik (für `X-Forwarded-For`)               |
| `DEV_MOCK_DISCORD`          | optional  | nur Entwicklung; in Production wird der Start hart abgebrochen          |

In der `.env` stehen ausschliesslich Infrastruktur-Secrets. **Discord-Server,
Rollen, Channels, Berechtigungen und alle Moduleinstellungen werden im Dashboard
konfiguriert** und liegen in der Datenbank - siehe
[docs/CONFIGURATION.md](docs/CONFIGURATION.md).

Die Konfiguration wird beim Start mit Zod validiert. Fehlt etwas, bricht der Start mit einer
konkreten Meldung ab (`packages/config/src/env.ts`).

> **Bestehende Installation?** `DISCORD_GUILD_ID`, `DISCORD_ADMIN_ROLE_ID` und
> `DISCORD_JAIL_ROLE_ID` funktionieren weiterhin, werden beim Start einmalig in
> die Datenbank übernommen und können danach entfernt werden.

---

## 8. PostgreSQL starten

Mit Docker (empfohlen für die Entwicklung):

```bash
docker compose up -d
```

Damit läuft PostgreSQL 16 auf `localhost:5432` mit Benutzer/Passwort/Datenbank `swisshub`
(passend zum `DATABASE_URL` aus `.env.example`).

---

## 9. Migration durchführen

```bash
npm run db:deploy    # Migrationen anwenden (Production/CI)
npm run db:seed      # Grundkonfiguration + Administratorrolle anlegen
```

Während der Entwicklung, wenn du das Schema änderst:

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

Dieser Modus liefert deterministische Testmitglieder und führt **keine** echten Discord-Aktionen
aus. In Production wird er abgelehnt (Start bricht ab).

---

## 11. Bot starten

In einem zweiten Terminal:

```bash
npm run dev:bot
```

Der Bot übernimmt:

- Heartbeat/Status für das Dashboard,
- automatische Freilassung abgelaufener Jails (Datenbank-Sweep, kein `setTimeout`),
- Wiederherstellung hängengebliebener Vorgänge nach Absturz/Deployment,
- periodische Reconciliation (Discord vs. Datenbank),
- Invalidierung des Rollen-Caches bei Rollenänderungen,
- Aufräumen abgelaufener Sessions und Idempotenzschlüssel.

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
cp .env.example .env      # ausfüllen (inkl. POSTGRES_PASSWORD)
docker compose -f docker-compose.prod.yml up -d --build
docker compose -f docker-compose.prod.yml run --rm migrate npm run db:seed
```

Migrationen wendet der `migrate`-Dienst beim Start automatisch an.
Health Check: `GET /api/health` (liefert Status von WebApp, Datenbank und Bot ohne sensible Details).

> **Vollständige Server-Anleitung** (eigene Domain, nginx, TLS, Backups,
> systemd-Variante): [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md)

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
  modules/                 Module Registry, Kernbereiche, Feature-Module, Mitglieder-Service
  auth/                    Discord OAuth2, Sessions, Identity-Refresh, CSRF

docs/
  ARCHITECTURE.md          Systemkomponenten und Request Flow
  SECURITY.md              Sicherheitsarchitektur und Annahmen
  MODULES.md               Anleitung: neues Modul entwickeln
  CONFIGURATION.md         Was in die .env gehört und was ins Dashboard
  DEPLOYMENT.md            Produktivbetrieb auf einem eigenen Server
  JAIL_MIGRATION.md        Übernahme des alten Jail-Bots (bot.py / jail_data.db)
  SPIELERSUCHE_MIGRATION.md Übernahme des Spielersuche-Bots (matchmaking.db)
  LEVEL_MIGRATION.md       Übernahme des Level-/XP-Bots (levels.db)
  XP_RAFFLE.md             XP-Verlosungen: Einsatzmodelle, Fairness, Ziehung
  COMMUNICATION.md         Neuigkeiten, Events, Umfragen, /post, Erwähnungen
  VOICE_HUB.md             Join-to-Create, Bedienfeld, Besitz, Abgleich

tests/                     Unit- und Integrationstests (Vitest)
```

---

## Skripte

| Befehl                              | Wirkung                                                            |
| ----------------------------------- | ------------------------------------------------------------------ |
| `npm run dev`                       | WebApp im Entwicklungsmodus                                        |
| `npm run dev:bot`                   | Bot im Entwicklungsmodus (Watch)                                   |
| `npm run build`                     | Prisma Client, Next.js Build, Bot Typecheck                        |
| `npm run start`                     | WebApp (Production)                                                |
| `npm run start:bot`                 | Bot (Production)                                                   |
| `npm run lint`                      | ESLint über das gesamte Monorepo                                   |
| `npm run typecheck`                 | TypeScript strict über Pakete, Bot und WebApp                      |
| `npm run test`                      | Vitest (Unit + Integration)                                        |
| `npm run check`                     | Format-Check, Lint, Typecheck, Tests                               |
| `npm run db:migrate`                | Migration erstellen/anwenden (Entwicklung)                         |
| `npm run db:deploy`                 | Migrationen anwenden (Production)                                  |
| `npm run db:seed`                   | Grundkonfiguration anlegen                                         |
| `npm run db:studio`                 | Prisma Studio                                                      |
| `npm run doctor -- <DiscordID>`     | Diagnose: Konfiguration, Discord, Bot und effektive Berechtigungen |
| `npm run grant:admin -- <RollenID>` | Notfallzugang: einer Discord-Rolle `admin.full` geben              |

---

## Branding anpassen

Alle Marken-Elemente liegen zentral in `packages/config/src/client.ts` (`branding`):

| Wert                                                | Wirkung                                                                                       |
| --------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| `logo.mark` / `logo.favicon` / `logo.appleTouch`    | Pfade zu den Logodateien (`apps/web/public/branding/`) - einfach ersetzen                     |
| `banner.title` / `banner.subtitle` / `banner.image` | Banner am Fuss des Dashboards                                                                 |
| `promo`                                             | Hinweiskarte in der Seitenleiste (`enabled`, `title`, `description`, `cta`, `href`)           |
| `accent` / `accentBright`                           | Markenfarben (die Farbtöne selbst stehen als CSS-Variablen in `apps/web/src/app/globals.css`) |
| `locale` / `timezone`                               | Zahlen- und Datumsformat (Standard `de-CH` / `Europe/Zurich`)                                 |

Das mitgelieferte SwissHub-Logo liegt als
`apps/web/public/branding/swisshub-logo.png` im Projekt. Es ist das
Standardlogo (`DEFAULT_SWISSHUB_LOGO`) und wird überall dort verwendet, wo im
Dashboard unter *Branding* kein eigenes Logo hochgeladen wurde - der Fallback
steht ausschliesslich in `brandingLogoUrl()`, damit ihn keine Seite selbst
wählen muss. Ein Austausch der Datei genügt zum Rebranding; Codeänderungen sind
dafür nicht nötig. Ist bei `promo.href` nichts gesetzt, verlinkt die Karte auf
den konfigurierten Discord-Server; mit `enabled: false` verschwindet sie ganz.

## SwissHub Premium

Monatliche Abonnements mit automatischen Discord-Vorteilen. Premium ist ein
Modul der bestehenden WebApp - kein zweites Projekt, keine zweite Anmeldung,
keine zweite Datenbank.

Die öffentliche Shop-Seite liegt unter `/premium` und ist **ohne Anmeldung**
erreichbar. Alles andere - eigenes Abo, Verwaltung - liegt im geschützten
Bereich mit Seitenleiste.

### Premium aktivieren

1. **Modul einschalten**: *Module → Premium*. Es ist bewusst standardmässig
   aus, weil es Discord-Rechte braucht und Geld bewegt.
2. **Discord zuordnen**: *Module → Premium → Einstellungen*. Rollen und
   Kategorie werden als Auswahlliste aus den echten Discord-Daten angeboten -
   IDs muss niemand abtippen.
3. **Zahlungsanbieter einrichten**: siehe *TWINT/Payment Provider* unten.
4. **Preis-IDs eintragen**: *Premium → Angebote*. Ohne die Preis-ID des
   Anbieters lässt sich für ein Angebot kein Checkout starten.

### Produkte

Drei Angebote werden beim ersten Start angelegt und liegen danach in der
Datenbank - Preise und Texte lassen sich ohne Deployment ändern.

| Angebot         | Preis         | Ansprüche                                            |
| --------------- | ------------- | ---------------------------------------------------- |
| Premium         | CHF 5.– / Mt. | `PREMIUM_ROLE`                                        |
| Premium-Stübli  | CHF 8.– / Mt. | `PREMIUM_STUEBLI_ROLE`, `PRIVATE_VOICE`               |
| Premium-Bundle  | CHF 10.– / Mt.| `PREMIUM_ROLE`, `PREMIUM_STUEBLI_ROLE`, `PRIVATE_VOICE` |

Beträge stehen als ganze Zahl in Rappen (CHF 5.00 = `500`). Gleitkomma kommt
bei Geld nirgends vor.

### Discord-Rollen

Die Discord-Logik fragt nie, welches Angebot jemand gebucht hat, sondern
ausschliesslich, welchen **Anspruch** er hat. Ein viertes Angebot braucht
deshalb keine einzige neue Verzweigung im Code - nur einen Datenbankeintrag.

### Premium-Stübli Kategorie

Wer `PRIVATE_VOICE` hat, bekommt genau **einen** persönlichen Sprachkanal in
der konfigurierten Kategorie. Der Kanal bleibt bestehen, solange der Anspruch
besteht - er wird nicht gelöscht, wenn das Mitglied offline ist, der Kanal leer
ist oder Bot und WebApp neu starten.

Die Rechte des Besitzers gelten ausschliesslich als Ausnahme auf genau diesem
Kanal: ansehen, betreten, sprechen, streamen, Mitglieder stummschalten, taub
schalten und verschieben sowie den Kanal verwalten. `Administrator`,
`Manage Guild`, serverweites `Manage Roles`, `Kick` und `Ban` sind nicht dabei
und dürfen es nie werden.

`Manage Permissions` im eigenen Kanal ist eine eigene Einstellung und
standardmässig **aus**: damit liessen sich Ausnahmen für beliebige Rollen
setzen, was über das Moderieren im eigenen Kanal hinausgeht.

### TWINT/Payment Provider

**TWINT allein kennt keine Abonnements.** Wiederkehrende Zahlungen brauchen
einen Zahlungsdienstleister, der TWINT für Folgezahlungen unterstützt.

Verwendet wird **Stripe**. Bis Mai 2026 liess sich TWINT dort nur für
Einzelzahlungen einsetzen; seit dem 27. Mai 2026 unterstützt Stripe TWINT auch
für Abonnements, Folgezahlungen und Zahlungen ohne anwesenden Kunden.

Eine Eigenheit von TWINT prägt die Architektur: es gibt **höchstens ein aktives
Mandat je Händler und Kunde**. Ein zweites anzulegen beantwortet Stripe mit
einem Fehler. Das passt zur Regel dieses Moduls, dass ein Mitglied genau ein
laufendes Abonnement hat - beides muss zusammenpassen, sonst läuft der Checkout
beim Anbieter auf.

Was SwissHub dafür braucht:

1. Ein **Stripe-Konto** für die Schweiz (Währung CHF).
2. TWINT unter *Settings → Payment methods* aktivieren. Stripe schaltet TWINT
   nach einer Prüfung frei; das ist kein Selbstbedienungsschalter.
3. Je Angebot ein **wiederkehrender Preis** (monatlich, CHF). Dessen ID
   (`price_...`) kommt in *Premium → Angebote*.
4. Einen **Webhook** auf `https://system.swisshub.gg/api/premium/webhook` mit
   den Ereignissen `checkout.session.completed`,
   `customer.subscription.updated`, `customer.subscription.deleted`,
   `invoice.paid` und `invoice.payment_failed`.
5. Zwei Umgebungsvariablen:

   ```
   PAYMENT_PROVIDER=stripe
   PAYMENT_API_KEY=sk_live_...
   PAYMENT_WEBHOOK_SECRET=whsec_...
   ```

Testen lässt sich alles vorher mit Stripes Testmodus (`sk_test_...`) und der
Stripe CLI (`stripe listen --forward-to localhost:3000/api/premium/webhook`).

In der Entwicklung genügt `PAYMENT_PROVIDER=mock`. Der Mock geht denselben Weg
wie der echte Anbieter - signiertes Ereignis durch dieselbe
Webhook-Verarbeitung - schaltet aber nie direkt frei. **In Production ist er
verboten**: der Start bricht ab, wenn `PAYMENT_PROVIDER=mock` gesetzt ist.

### Webhooks

Der Endpunkt prüft zuerst die Signatur über den **unveränderten** Rohkörper.
Schon das Umformen in ein Objekt und zurück machte die Prüfsumme wertlos.

Ohne gültige Signatur wird nichts gespeichert und nichts verändert. Mit
gültiger Signatur entscheidet der eindeutige Schlüssel `(provider, eventId)`
über die Idempotenz - in der Datenbank, nicht in der Anwendung: Anbieter
stellen dasselbe Ereignis mehrfach zu, und es laufen mehrere Instanzen.

Ein bereits verarbeitetes Ereignis wird mit 200 quittiert, sonst wiederholte
der Anbieter endlos. Nur eine ungültige Signatur (400) und ein echter
Verarbeitungsfehler (500) antworten mit einem Fehlercode.

### Subscription Lifecycle

```
PENDING ── Zahlung bestätigt ──▶ ACTIVE ──┬── Kündigung ──▶ CANCEL_AT_PERIOD_END
                                          │                        │
                                          │                   Periodenende
                                          ├── Zahlung fehlt ──▶ PAYMENT_FAILED
                                          │                        │
                                          │                   Schonfrist vorbei
                                          └────────────────────────┴──▶ EXPIRED
```

Ansprüche bestehen in `ACTIVE`, `PAST_DUE`, `PAYMENT_FAILED` und
`CANCEL_AT_PERIOD_END`. In `PENDING` bewusst noch nicht: erst die bestätigte
Zahlung schaltet frei.

### Discord Reconciliation

`syncDiscordEntitlements(userId)` vergleicht den tatsächlichen Discord-Zustand
mit dem gewünschten und gleicht die Differenz aus - Rolle fehlt, Kanal
gelöscht, Kanal in der falschen Kategorie, Rechte verstellt.

Die Funktion ist idempotent und läuft beliebig oft: nach der Zahlung, von Hand
aus der Verwaltung und alle fünf Minuten im Bot. Dass dabei nie ein zweites
Stübli entsteht, hängt an drei Dingen zusammen - dem eindeutigen Schlüssel
`(userId, resourceType)`, der Zeilensperre auf dem Benutzer und der Prüfung, ob
der eingetragene Kanal auf Discord überhaupt noch existiert.

**Ein Discord-Fehler nimmt niemals eine Zahlung zurück.** Er hinterlässt
`discordSyncStatus = FAILED`; der nächste Durchgang holt es nach.

### Grace Period

Schlägt eine Folgezahlung fehl, bleiben die Vorteile zunächst bestehen -
Standard sind drei Tage, einstellbar in den Moduleinstellungen. Eine bereits
laufende Schonfrist wird nicht verlängert, sonst liesse sich mit wiederholt
fehlschlagenden Zahlungen unbegrenzt weiternutzen.

### Adminverwaltung

*Premium* in der Seitenleiste, darunter Übersicht, Abonnements, Angebote,
Zahlungen, Stübli und Einstellungen. Berechtigungen (`premium.view`,
`premium.manage`, `premium.products.manage`, `premium.payments.view`,
`premium.subscriptions.manage`, `premium.discord.sync`,
`premium.stuebli.manage`, `premium.settings`) werden wie überall über
Discord-Rollen vergeben.

### Troubleshooting

| Beobachtung                                   | Ursache und Abhilfe                                                                                     |
| --------------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| Checkout bricht mit „keine Preis-ID" ab       | In *Premium → Angebote* die `price_...` des Anbieters eintragen                                          |
| Zahlung bestätigt, aber keine Rolle           | *Premium → Abonnements*, Spalte Discord. Bei „Fehler" die Meldung lesen - meist steht die Rolle über der Bot-Rolle |
| Stübli fehlt                                  | *Premium → Stübli → Abgleichen*. Der Abgleich legt an, was fehlt                                          |
| Stübli doppelt                                | Kann nicht entstehen - der eindeutige Schlüssel verhindert es. Ein von Hand angelegter Kanal gehört nicht dazu |
| Start bricht mit `PAYMENT_PROVIDER=mock` ab   | So gewollt. In Production einen echten Anbieter konfigurieren                                            |
| Webhook antwortet 400                         | Signatur stimmt nicht: falsches `PAYMENT_WEBHOOK_SECRET` oder ein Proxy verändert den Rohkörper           |

## Erste Schritte in der WebApp

1. **Anmelden**: `Mit Discord anmelden`. Nur Mitglieder des verbundenen Servers erhalten Zugriff.
2. **Einrichten**: `/setup` führt in vier Schritten durch die Ersteinrichtung. Solange sie nicht
   abgeschlossen ist, darf ein Discord-Administrator den Assistenten bedienen und dort die ersten
   Berechtigungen vergeben - ohne Dashboard-Berechtigung landest du automatisch dort.
   1. Discord-Server verbinden (Auswahl aus den Servern, auf denen der Bot Mitglied ist)
   2. Rollen und Channels abgleichen
   3. Berechtigungen vergeben
   4. Module konfigurieren
3. **Berechtigungen vergeben**: _Server -> Berechtigungen_. Ordne Discord-Rollen Permissions zu -
   per Vorlage oder einzeln. Beispiele:
   - Administrator -> `admin.full`, geschützt, Moderationsstufe 100
   - Moderator -> `jail.view`, `jail.create`, `jail.release`, `members.view`, Stufe 50
   - Supporter -> `members.view`, Stufe 10

   Die letzte verwaltende Rolle lässt sich nicht entwerten (Aussperrschutz).

4. **Jail konfigurieren**: _Module -> Jail -> Einstellungen_. Jail-Rolle, Channels und maximale
   Dauer setzen. Die Auswahl bietet nur Rollen an, die der Bot tatsächlich verwalten kann.
   Im selben Bereich lässt sich **Vote Jail** aktivieren (Channel, benötigte Stimmen, Laufzeit,
   Jail-Dauer bei Erfolg - Standard: 5 Stimmen in 5 Minuten ergeben 30 Minuten Jail).
5. **Spielersuche einrichten**: _Spielersuche -> Einstellungen_ (Channel und Voice-Kategorie),
   danach _Spielersuche -> Spiele_. Einen bestehenden Spielersuche-Bot löst
   _Spielersuche -> Import_ ab: [docs/SPIELERSUCHE_MIGRATION.md](docs/SPIELERSUCHE_MIGRATION.md).
6. **Voice Hub einrichten**: _Voice Hub -> Presets_ (drei Vorlagen entstehen beim Einschalten
   von selbst), danach _Voice Hub -> Hub-Channels_: ein leerer Sprachkanal zum Betreten und die
   Kategorie, in der die Talks entstehen. Ohne eine Rolle mit `voiceHub.use` kann niemand einen
   Talk öffnen. Vollständige Anleitung: [docs/VOICE_HUB.md](docs/VOICE_HUB.md).
7. **Level-System einrichten**: _Level-System -> XP-Regeln_ und _-> Voice XP_ (XP pro Nachricht,
   Cooldowns, Channels ohne XP), danach _-> Level & Rollen_ für die Meilenstein-Rollen. Einen
   bestehenden Level-Bot löst _Level-System -> Import_ ab:
   [docs/LEVEL_MIGRATION.md](docs/LEVEL_MIGRATION.md).
8. **Alten Jail-Bot ablösen** (nur bei einer bestehenden Installation): _Module -> Jail-Import_.
   Der Assistent liest `jail_data.db`, zeigt für jede Zeile, was mit ihr geschieht, und übernimmt
   sie erst nach ausdrücklicher Bestätigung. Vollständige Anleitung:
   [docs/JAIL_MIGRATION.md](docs/JAIL_MIGRATION.md).
9. **Testen**: _Mitglieder_ -> Mitglied öffnen -> _Mitglied jailen_. Nach Ablauf gibt der Bot das
   Mitglied automatisch frei und stellt die Rollen wieder her. Dasselbe über Discord: `/jail`.
10. **Nachvollziehen**: _Audit Log_ zeigt jede Aktion inklusive Integritätsprüfung der Hash-Chain.

---

## Troubleshooting

| Symptom                                                        | Ursache / Lösung                                                                                                                                                                                                 |
| -------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `Ungültige oder fehlende Umgebungsvariablen`                   | `.env` unvollständig - die Meldung nennt die betroffenen Variablen.                                                                                                                                              |
| `Der Bot besitzt möglicherweise nicht genügend Berechtigungen` | Bot-Rolle zu niedrig oder `Manage Roles` fehlt. Rollenreihenfolge prüfen.                                                                                                                                        |
| Mitgliedersuche liefert nichts                                 | **SERVER MEMBERS INTENT** im Developer Portal aktivieren.                                                                                                                                                        |
| `Bot derzeit nicht erreichbar`                                 | Bot-Prozess läuft nicht oder Heartbeat ist älter als 70 Sekunden.                                                                                                                                                |
| Login endet auf `/access-denied`                               | Discord-Konto ist (noch) kein Mitglied des konfigurierten Servers.                                                                                                                                               |
| Angemeldet, aber "Keine Berechtigung"                          | Server-Ownerschaft allein gibt keine Rechte. Als Discord-Administrator führt dich `/setup` zur Vergabe; sonst `npm run doctor -- <DeineDiscordID>`, dann `SWISSHUB_OWNER_DISCORD_ID` oder `npm run grant:admin`. |
| Login-Fehler `state`                                           | Cookies blockiert oder Redirect URI stimmt nicht exakt mit `NEXT_PUBLIC_APP_URL` überein.                                                                                                                        |
| Jail schlägt mit `CONFIGURATION_MISSING` fehl                  | Es ist keine Jail-Rolle hinterlegt (_Module -> Jail -> Einstellungen_).                                                                                                                                          |
| `Es ist noch kein Discord-Server verbunden`                    | Einrichtungsassistent unter `/setup` abschliessen.                                                                                                                                                               |
| Rollen-/Channel-Auswahl ist leer                               | Noch kein Abgleich gelaufen: _System -> Discord-Sync -> Jetzt synchronisieren_ (der Bot muss laufen).                                                                                                            |
| Vote Jail lässt sich nicht starten                             | Vote Jail deaktiviert oder kein Channel gewählt (_Module -> Jail_); zum Starten wird `jail.vote.start` benötigt.                                                                                                 |
| Nachricht wird nicht gesendet                                  | Der Bot darf im Zielchannel nicht schreiben - _System -> Bot_ zeigt die fehlenden Rechte. Channels ohne Berechtigung sind in der Auswahl deaktiviert.                                                            |
| Logo-Upload schlägt fehl                                       | `npm run doctor` prüft im Abschnitt _Uploads_, ob das Verzeichnis beschreibbar ist. Hinter nginx zusätzlich `client_max_body_size` (mindestens 8m) kontrollieren.                                                |
| `/spielersuche` findet keine Spiele                            | Unter _Spielersuche -> Spiele_ ist kein aktives Spiel hinterlegt.                                                                                                                                                |
| Spielersuche erstellt keinen Sprachkanal                       | Voice-Kategorie fehlt (_Spielersuche -> Einstellungen_) oder dem Bot fehlt dort `Kanäle verwalten`.                                                                                                              |
| Betreten des Hub-Channels erzeugt keinen Talk                  | Modul aus, Wartungsmodus an, oder der Rolle fehlt `voiceHub.use`. _Module -> Voice Hub_ nennt im Gesundheitsbereich, was fehlt.                                                                                   |
| Talk entsteht, aber niemand landet darin                       | Dem Bot fehlt `Mitglieder verschieben` in der Zielkategorie.                                                                                                                                                     |
| Im Talk fehlt das Bedienfeld                                   | Dem Bot fehlt `Nachrichten senden` oder `Links einbetten` im Kanal. Der Talk bleibt bedienbar - im Dashboard unter _Voice Hub -> Talks_, oder über **Mehr -> Bedienfeld erneuern**.                               |
| Spielrolle wird nicht gepingt                                  | Sperrfrist je Spiel (Standard 5 Minuten). Die Suche entsteht trotzdem; die Rückmeldung nennt die verbleibende Zeit.                                                                                              |
| Slash Commands erscheinen nicht auf Discord                    | Der Bot muss mit dem Scope `applications.commands` eingeladen sein; die Befehle werden beim Start pro Server registriert (Bot-Log prüfen).                                                                       |
| `/jail` meldet "kei Berächtigung"                              | Die Berechtigungen sind dieselben wie im Dashboard: _Server -> Berechtigungen_, Rolle mit `jail.create` bzw. `jail.release` versehen.                                                                            |
| Import meldet "Das ist keine SQLite-Datenbank"                 | Es wurde eine andere Datei gewählt - erwartet wird `jail_data.db`. `bot.py` wird nicht hochgeladen (sie enthält den alten Bot-Token im Klartext).                                                                |
| Import zeigt viele Zeilen als "Konflikt"                       | Für diese Mitglieder läuft hier bereits ein Jail. Bestehende Einträge werden nie überschrieben.                                                                                                                  |
| Hochgeladenes Logo verschwindet nach einem Rebuild             | `SWISSHUB_UPLOAD_DIR` zeigt nicht auf ein persistentes Volume (siehe `docker-compose.prod.yml`).                                                                                                                 |

---

## Weiterführende Dokumentation

- [docs/CONFIGURATION.md](docs/CONFIGURATION.md) - Was in die `.env` gehört und was ins Dashboard
- [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) - Systemkomponenten, Datenfluss, Zustände
- [docs/SECURITY.md](docs/SECURITY.md) - Authentifizierung, Autorisierung, Secrets, Annahmen
- [docs/MODULES.md](docs/MODULES.md) - Schritt-für-Schritt: neues Modul entwickeln
- [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md) - Produktivbetrieb auf einem eigenen Server
- [docs/XP_RAFFLE.md](docs/XP_RAFFLE.md) - XP-Verlosungen: Einsatzmodelle, Fairness, Ziehung, Rückzahlungen
- [docs/COMMUNICATION.md](docs/COMMUNICATION.md) - Kommunikation: Events, `/post`, Erwähnungen, Fehlerbehandlung
