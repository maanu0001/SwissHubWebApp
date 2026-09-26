# Deployment: system.swisshub.gg

Schritt-für-Schritt-Anleitung, um WebApp, Bot und Datenbank auf einem eigenen
Linux-Server produktiv zu betreiben. Beispiel-Domain: **system.swisshub.gg**.

Zwei Varianten:

| Variante                           | Für wen                                        | Aufwand |
| ---------------------------------- | ---------------------------------------------- | ------- |
| **A - Docker Compose** (empfohlen) | Standardfall, alles in einem Stack             | gering  |
| **B - Node + systemd**             | Server mit bestehender PostgreSQL-Installation | mittel  |

Beide Varianten verwenden nginx als Reverse Proxy mit Let's-Encrypt-Zertifikat.

---

## 0. Überblick

```
        Internet
           │  https://system.swisshub.gg
           ▼
    ┌──────────────┐   443/80
    │    nginx     │  TLS, Reverse Proxy
    └──────┬───────┘
           │ http://127.0.0.1:3000
    ┌──────▼───────┐        ┌──────────────┐
    │   WebApp     │        │  Discord Bot │
    │  (Next.js)   │        │ (discord.js) │
    └──────┬───────┘        └──────┬───────┘
           │                       │
           └────────┬──────────────┘
                    ▼
             ┌─────────────┐
             │ PostgreSQL  │
             └─────────────┘
```

Die WebApp ist **nie** direkt aus dem Internet erreichbar - nur über nginx.
Der Bot braucht keine offenen Ports, er verbindet sich ausgehend zu Discord.

---

## 1. Voraussetzungen

- Linux-Server (Ubuntu 22.04/24.04 oder Debian 12), 2 vCPU / 2 GB RAM genügen
- Root- bzw. sudo-Zugriff
- Domain **system.swisshub.gg** zeigt auf den Server:

  | Typ  | Name     | Wert                                   |
  | ---- | -------- | -------------------------------------- |
  | A    | `system` | `<IPv4 des Servers>`                   |
  | AAAA | `system` | `<IPv6 des Servers>` (falls vorhanden) |

  Prüfen: `dig +short system.swisshub.gg`

- Ports **80** und **443** offen (für Let's Encrypt und die WebApp)
- Discord: Administratorrechte auf dem SwissHub-Server

---

## 2. Discord vorbereiten

Im [Discord Developer Portal](https://discord.com/developers/applications):

1. **OAuth2 → Redirects** ergänzen:

   ```
   https://system.swisshub.gg/api/auth/callback/discord
   ```

   Exakt so - ohne Slash am Ende. Die WebApp bildet diese URI aus
   `NEXT_PUBLIC_APP_URL`; weicht sie ab, schlägt der Login mit `error=state` fehl.

2. **Bot → Privileged Gateway Intents**: _SERVER MEMBERS INTENT_ aktivieren.
3. **Bot → Reset Token** und Token notieren (nur einmal sichtbar).
4. Bot einladen (Client ID einsetzen), falls noch nicht geschehen:

   ```
   https://discord.com/api/oauth2/authorize?client_id=DEINE_CLIENT_ID&scope=bot&permissions=268454912
   ```

5. **Rollenreihenfolge auf Discord prüfen**: Die Bot-Rolle muss **über** der
   Jail-Rolle und allen Rollen liegen, die beim Jail entzogen werden.
   Geschützte Admin-Rollen dürfen darüber bleiben.

IDs kopieren (Entwicklermodus in Discord aktivieren, dann Rechtsklick → ID kopieren):
Guild-ID, Administrator-Rollen-ID, Jail-Rollen-ID, eigene User-ID.

---

## 3. Server vorbereiten

```bash
sudo apt update && sudo apt upgrade -y
sudo apt install -y git nginx ufw

# Firewall: nur SSH und Web
sudo ufw allow OpenSSH
sudo ufw allow 'Nginx Full'
sudo ufw enable
```

### Variante A: Docker installieren

```bash
curl -fsSL https://get.docker.com | sudo sh
sudo systemctl enable --now docker
docker --version && docker compose version
```

### Variante B: Node.js und PostgreSQL installieren

```bash
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
sudo apt install -y nodejs postgresql
sudo -u postgres psql -c "CREATE USER swisshub WITH PASSWORD 'HIER_EIN_STARKES_PASSWORT';"
sudo -u postgres psql -c "CREATE DATABASE swisshub OWNER swisshub;"
```

---

## 4. Projekt einrichten

```bash
sudo useradd --system --create-home --home-dir /opt/swisshub --shell /bin/bash swisshub
sudo git clone https://github.com/maanu0001/SwissHub_Bot-WebApp.git /opt/swisshub
sudo chown -R swisshub:swisshub /opt/swisshub
cd /opt/swisshub
sudo -u swisshub git checkout main   # bzw. den gewuenschten Branch
```

### `.env` anlegen

```bash
sudo -u swisshub cp .env.example .env
sudo -u swisshub openssl rand -base64 48        # -> AUTH_SECRET
sudo -u swisshub openssl rand -base64 32        # -> POSTGRES_PASSWORD (nur Variante A)
sudo -u swisshub nano .env
```

Produktive Werte:

```env
NODE_ENV=production

# Variante A (Docker): Host ist der Servicename "postgres"
DATABASE_URL=postgresql://swisshub:DEIN_DB_PASSWORT@postgres:5432/swisshub?schema=public
POSTGRES_USER=swisshub
POSTGRES_PASSWORD=DEIN_DB_PASSWORT
POSTGRES_DB=swisshub

# Variante B (System-PostgreSQL):
# DATABASE_URL=postgresql://swisshub:DEIN_DB_PASSWORT@localhost:5432/swisshub?schema=public

DISCORD_CLIENT_ID=...
DISCORD_CLIENT_SECRET=...
DISCORD_BOT_TOKEN=...

# Notzugang: dieses Konto behält immer Vollzugriff.
SWISSHUB_OWNER_DISCORD_ID=...

# Discord-Server, Rollen, Channels und Moduleinstellungen gehören NICHT mehr
# in die .env - sie werden unter /setup im Dashboard konfiguriert.
# Siehe docs/CONFIGURATION.md.

AUTH_SECRET=<openssl rand -base64 48>

# Ablage fuer hochgeladene Dateien (WebApp-Logo). Muss dem Dienstbenutzer
# gehoeren - sonst schlaegt der Upload mit "permission denied" fehl.
SWISSHUB_UPLOAD_DIR=/var/lib/swisshub/uploads

NEXT_PUBLIC_APP_URL=https://system.swisshub.gg
TRUST_PROXY=true

LOG_LEVEL=info
LOG_FORMAT=json

# MUSS leer bzw. false sein - der Start bricht sonst ab.
DEV_MOCK_DISCORD=false
```

```bash
sudo chmod 600 /opt/swisshub/.env
```

> `DEV_MOCK_DISCORD=true` und ein `http://`-URL werden in Production hart
> abgelehnt: die Anwendung startet dann bewusst nicht.

---

## 5. Starten

### Variante A: Docker Compose

```bash
cd /opt/swisshub
sudo docker compose -f docker-compose.prod.yml up -d --build
```

Der Stack startet in dieser Reihenfolge: PostgreSQL → `migrate` (wendet die
Migrationen an) → WebApp und Bot.

Grundkonfiguration einmalig anlegen:

```bash
sudo docker compose -f docker-compose.prod.yml run --rm migrate npm run db:seed
```

Status prüfen:

```bash
sudo docker compose -f docker-compose.prod.yml ps
sudo docker compose -f docker-compose.prod.yml logs -f web bot
curl -s http://127.0.0.1:3000/api/health
```

### Variante B: Node + systemd

```bash
cd /opt/swisshub
sudo -u swisshub npm ci
sudo -u swisshub npm run db:deploy
sudo -u swisshub npm run db:seed
sudo -u swisshub npm run build

sudo cp deploy/systemd/swisshub-web.service /etc/systemd/system/
sudo cp deploy/systemd/swisshub-bot.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now swisshub-web swisshub-bot
sudo systemctl status swisshub-web swisshub-bot
```

---

## 6. nginx und TLS

```bash
sudo cp /opt/swisshub/deploy/nginx/system.swisshub.gg.conf /etc/nginx/sites-available/
sudo ln -s /etc/nginx/sites-available/system.swisshub.gg.conf /etc/nginx/sites-enabled/
sudo rm -f /etc/nginx/sites-enabled/default

# Zertifikat holen (legt die TLS-Zeilen selbst an bzw. bestaetigt sie)
sudo apt install -y certbot python3-certbot-nginx
sudo certbot --nginx -d system.swisshub.gg --agree-tos -m deine@mail.tld --redirect

sudo nginx -t && sudo systemctl reload nginx
```

Certbot richtet die automatische Verlängerung selbst ein
(`systemctl status certbot.timer`).

Test:

```bash
curl -I https://system.swisshub.gg/login
curl -s https://system.swisshub.gg/api/health
```

---

## 7. Erste Anmeldung und Konfiguration

1. <https://system.swisshub.gg> öffnen → **Mit Discord anmelden**.
2. Nur Mitglieder des konfigurierten Servers kommen hinein; ohne passende
   Rolle landest du auf der Access-Denied-Seite.
3. **Einrichtungsassistent** unter <https://system.swisshub.gg/setup>:
   1. **Discord-Server verbinden** - die Auswahl enthält nur Server, auf denen
      der Bot Mitglied ist.
   2. **Abgleich** - Rollen und Channels werden gespiegelt (läuft beim Verbinden
      automatisch, später auch bei jedem Botstart und alle 15 Minuten).
   3. **Berechtigungen** - unter _Server → Berechtigungen_ Discord-Rollen ihre
      Permissions zuweisen (per Vorlage oder einzeln), Administratorrollen als
      _geschützt_ markieren und Moderationsstufen vergeben.
   4. **Module** - unter _Module → Jail → Einstellungen_ Jail-Rolle,
      Jail-Channel, Moderations-Log-Channel und maximale Dauer setzen.
4. **Prüfen**: _Server_ zeigt den Fertigstellungsgrad; _System → Bot_ prüft,
   ob der Bot alle nötigen Discord-Berechtigungen besitzt und hoch genug
   einsortiert ist.
5. Einen Testjail über ein eigenes Zweitkonto ausführen und prüfen, dass
   Rollenentzug, Log-Embed und automatische Freilassung funktionieren.

> Änderungen im Dashboard wirken sofort - Bot und WebApp müssen dafür **nicht**
> neu gestartet werden (siehe `ConfigRevision` in docs/CONFIGURATION.md).

---

## 7a. Angemeldet, aber keine Rechte?

Der häufigste Stolperstein beim ersten Start: **Discord-Server-Owner zu sein
gibt in SwissHub noch keine Berechtigungen.** Die Permission Engine kennt nur
zwei Quellen:

1. `SWISSHUB_OWNER_DISCORD_ID` in der `.env` entspricht deiner **Discord-User-ID**
   (nicht der Server-ID) - dieses Konto hat sofort Vollzugriff, ganz ohne Rolle.
2. Eine deiner Discord-Rollen ist einer Berechtigung zugeordnet (_Server →
   Berechtigungen_). Ist noch eine `DISCORD_ADMIN_ROLE_ID` gesetzt, legt die
   Anwendung diese Rolle beim Start automatisch mit `admin.full` an -
   vorausgesetzt, du **trägst diese Rolle auch selbst**.

Solange die Einrichtung nicht abgeschlossen ist, darf zusätzlich ein
**Discord-Administrator** den Assistenten unter `/setup` bedienen **und dort die
ersten Berechtigungen vergeben** (Server → Berechtigungen). Wer nach der
Anmeldung noch keine Dashboard-Berechtigung hat, wird automatisch dorthin
geleitet. Nach dem Abschluss der Einrichtung zählt ausschliesslich die
Dashboard-Berechtigung.

Bist du weder Discord-Administrator noch Owner des Servers, hilft der Notzugang
oder `npm run grant:admin` (siehe unten).

Diagnose (zeigt Konfiguration, Rollen und die effektiven Berechtigungen):

```bash
# Docker
docker compose -f docker-compose.prod.yml exec web npm run doctor -- <DEINE_DISCORD_ID>

# systemd / bare metal
cd /opt/swisshub && npm run doctor -- <DEINE_DISCORD_ID>
```

Beheben - eine der beiden Varianten genügt:

```bash
# A) Owner-ID setzen (wirkt nach Neustart der Dienste)
nano .env          # SWISSHUB_OWNER_DISCORD_ID=123456789012345678
docker compose -f docker-compose.prod.yml up -d       # Container neu erzeugen
# bzw. systemctl restart swisshub-web swisshub-bot

# B) Einer Discord-Rolle Vollzugriff geben (wirkt sofort nach erneuter Anmeldung)
docker compose -f docker-compose.prod.yml exec web npm run grant:admin -- <ROLLEN_ID>
```

> Eine `.env`-Änderung greift bei Docker erst, wenn der Container **neu erzeugt**
> wird (`up -d`), nicht bei einem blossen `restart`.

Danach abmelden und erneut anmelden - die Rollen werden dabei frisch von Discord
geladen. Anschliessend unter _Server → Berechtigungen_ die weiteren Rollen
(Moderator, Supporter, ...) konfigurieren.

> Die letzte Rolle mit „Berechtigungen verwalten“ bzw. „Vollzugriff“ lässt sich
> im Dashboard nicht entwerten - dieser Aussperrschutz verhindert genau diese
> Situation für die Zukunft.

### Upload-Verzeichnis (Logo)

Das WebApp-Logo wird als Datei abgelegt, nicht in der Datenbank. Das Verzeichnis
muss dem Benutzer gehoeren, unter dem die WebApp laeuft:

```bash
# Variante A (Docker): das Image legt das Verzeichnis an und uebergibt es dem
# Dienstbenutzer. Ein bereits bestehendes Volume gehoert aber noch root -
# einmalig korrigieren:
sudo docker compose -f docker-compose.prod.yml run --rm --user root web \
  chown -R swisshub:swisshub /var/lib/swisshub/uploads

# Variante B (systemd / bare metal):
sudo mkdir -p /var/lib/swisshub/uploads
sudo chown -R swisshub:swisshub /var/lib/swisshub
```

Pruefen laesst sich das mit `npm run doctor` - der Abschnitt **Uploads** meldet,
ob das Verzeichnis wirklich beschreibbar ist.

> **Hinter einem Reverse Proxy:** `client_max_body_size` muss groesser sein als
> das groesste Upload-Limit der Anwendung. Das ist nicht das Bild-Limit, sondern
> der Level-Import mit **64 MB** (`level/import/reader.ts`); danach kommt der
> Jail-Import mit 32 MB. Die mitgelieferte nginx-Konfiguration setzt deshalb
> **72 MB** - die Reserve deckt den Multipart-Rahmen. Ist der Wert zu klein,
> lehnt nginx die Datei mit **413** ab, bevor die Anwendung sie sieht, und der
> Fehler sieht aus, als kaeme er von SwissHub.
>
> Der Deploy-Workflow fasst nginx **nicht** an. Wird
> `deploy/nginx/system.swisshub.gg.conf` geaendert, muss die Datei von Hand auf
> den Server und `nginx -s reload` laufen - sonst gilt weiter der alte Wert.

## 8. Betrieb

### Logs

```bash
# Docker
sudo docker compose -f docker-compose.prod.yml logs -f --tail=100 web
sudo docker compose -f docker-compose.prod.yml logs -f --tail=100 bot

# systemd
sudo journalctl -u swisshub-web -f
sudo journalctl -u swisshub-bot -f
```

Die Logs sind strukturiertes JSON (`LOG_FORMAT=json`) und enthalten niemals
Tokens, Cookies oder Secrets.

### Updates einspielen

Auf dem Server ist dafür **kein Befehl** nötig. Ein Push auf den Branch
`production` startet `.github/workflows/deploy.yml`, und der Workflow erledigt
beides - Prüfung und Ausrollen:

```bash
git checkout production
git merge --ff-only claude/swisshub-bot-webapp-rmljzl
git push origin production
```

Der Workflow läuft in zwei Schritten, der zweite nur nach dem ersten
(`needs: validate`):

| Job        | Inhalt                                                          |
| ---------- | --------------------------------------------------------------- |
| `validate` | `npm ci`, `db:generate`, Lint, Typecheck, **alle** Tests, Build |
| `deploy`   | Baut die Abbilder auf dem Server, startet neu und prüft nach    |

Die Tests laufen gegen ein echtes PostgreSQL 16 als Service-Container. Ohne
`SWISSHUB_TEST_DATABASE_URL` überspringen sich die datenbankgestützten Tests
selbst - sie wären grün, ohne je gelaufen zu sein. Deshalb setzt der Job diese
Variable; die übrigen Werte im Job sind Wegwerfwerte, `DEV_MOCK_DISCORD=true`
hält das Gateway bei der Attrappe.

Nach `docker compose build` und `up -d` prüft der Deploy-Job für `web`, `bot`
und `music-runtime` einzeln, ob der laufende Container wirklich die ID des
frisch gebauten Abbilds trägt, und ersetzt gezielt nur die Abweichler
(`up -d --force-recreate --no-deps <dienst>`). Damit das überhaupt prüfbar ist,
tragen die Dienste in `docker-compose.prod.yml` feste `image:`-Namen
(`swisshub-web:latest` usw.) statt von Compose abgeleiteter. Genau hier lag die
Ursache dafür, dass der Bot nach einem Deployment weiter auf dem alten Abbild
lief.

Anschliessend verifiziert der Job:

- der `migrate`-Container ist mit Exit-Code `0` beendet,
- `web`, `bot` und `music-runtime` sind `running` **und** `healthy`
  (bis zu 300 Sekunden Wartezeit, danach Fehler samt Logauszug),
- `https://system.swisshub.gg` antwortet mit einem Erfolgsstatus.

Scheitert einer dieser Punkte, bricht das Skript mit `exit 1` ab und der
GitHub-Actions-Run ist rot. Ein fehlerhafter Stand wird nicht als erfolgreich
gemeldet.

Der Bot hat keine Schnittstelle, die man anfragen könnte - «Prozess läuft»
wäre auch dann wahr, wenn die Verbindung zu Discord abgerissen ist. Er schreibt
deshalb in jedem Herzschlag-Durchgang (alle 20 Sekunden) nach
`/tmp/swisshub-bot-alive`; der Healthcheck prüft, ob diese Datei jünger als
zwei Minuten ist. Über `SWISSHUB_BOT_LIVENESS_FILE` lässt sich der Pfad ändern.

Migrationen laufen automatisch über den `migrate`-Dienst; `web`, `bot` und
`music-runtime` starten erst nach dessen erfolgreichem Ende
(`service_completed_successfully`). Bot und WebApp fahren bei einem Neustart
kontrolliert herunter; laufende Jails bleiben in der Datenbank und werden
danach normal weiterverarbeitet.

Ein Deployment von Hand bleibt möglich, ist aber der Ausnahmefall (etwa wenn
GitHub nicht erreichbar ist):

```bash
cd /opt/swisshub
sudo -u swisshub git pull
sudo docker compose -f docker-compose.prod.yml up -d --build
```

#### Benötigte Repository-Secrets

`DEPLOY_HOST`, `DEPLOY_USER`, `DEPLOY_SSH_KEY`, `DEPLOY_PORT`. Der Workflow
gibt sie niemals aus; `script_stop: true` bricht beim ersten Fehler ab, und
`concurrency: swisshub-production` verhindert zwei gleichzeitige Deployments.

### Backups

Vollständig beschrieben in **[deploy/backup/README.md](../deploy/backup/README.md)**
– hier nur die Einrichtung und das, was man wissen muss, ohne dort zu lesen.

```bash
sudo mkdir -p /etc/swisshub
sudo cp /opt/swisshub/deploy/backup/swisshub-backup.env.example /etc/swisshub/backup.env
sudo chmod 600 /etc/swisshub/backup.env

sudo cp /opt/swisshub/deploy/backup/systemd/* /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now swisshub-backup.timer          # taeglich 03:00
sudo systemctl enable --now swisshub-backup-verify.timer   # taeglich 04:00
sudo systemctl enable --now swisshub-restore-test.timer    # sonntags 05:00

# Einmal von Hand und zusehen:
sudo systemctl start swisshub-backup.service
sudo journalctl -u swisshub-backup.service -f
sudo /opt/swisshub/deploy/backup/bin/swisshub-recovery liste
```

Eine Sicherung enthält den PostgreSQL-Export, ein Archiv des
Upload-Verzeichnisses, die **Namen** der Umgebungsvariablen und ein Manifest mit
Prüfsummen. Aufbewahrt werden 7 tägliche, 4 wochenweise und 3 monatsweise
Sicherungen.

Drei Zustände, die nicht dasselbe sind:

| Zustand            | Wer                      | Was er beweist                                           |
| ------------------ | ------------------------ | -------------------------------------------------------- |
| BACKUP ERSTELLT    | `swisshub-backup`        | Die Dateien liegen da.                                   |
| INTEGRITÄT GEPRÜFT | `swisshub-backup-verify` | Prüfsummen stimmen, Archive lesbar, Dump vollständig.    |
| RESTORE GETESTET   | `swisshub-restore-test`  | Eingespielt in eine isolierte Datenbank, Zeilen stimmen. |

Der Zustand steht in der WebApp unter **System → Backup & Recovery**
(Berechtigung `backup.view`). Die Seite zeigt nur an – gesichert und
wiederhergestellt wird über die CLI auf dem Server. Der WebApp-Container hat
absichtlich keinen Docker-Socket und keinen Zugang zum Backup-Verzeichnis; er
liest ausschliesslich `/var/lib/swisshub/backup-status` (nur Manifeste, nur
lesbar).

Wiederherstellen:

```bash
BIN=/opt/swisshub/deploy/backup/bin
sudo $BIN/swisshub-recovery plan                  # was ein Restore täte
sudo $BIN/swisshub-recovery test                  # Probe, ohne die Produktion zu berühren
sudo $BIN/swisshub-recovery wiederherstellen <kennung> \
  --ziel produktion --bestaetigen <kennung>       # legt vorher eine Sicherheitssicherung an
```

#### Zwei Dinge, die keine Sicherung mitbringt

**Die Geheimnisse.** `MASTER_ENCRYPTION_KEY`, `AUTH_SECRET`, Discord-Tokens und
Zahlungsschlüssel liegen absichtlich in keiner Sicherung – neben dem
Datenbankexport wären sie der Schlüssel zum Schloss am selben Bund. Sie brauchen
eine Offline-Kopie an zwei Orten, die nicht dieser Server sind. Die Anleitung
dazu steht in [deploy/backup/README.md](../deploy/backup/README.md), Abschnitt
«Schlüssel und Geheimnisse». Das Manifest trägt einen Fingerabdruck des
Hauptschlüssels: er sagt, ob die Offline-Kopie die richtige ist, und gibt den
Wert nicht her.

**Schutz vor dem Verlust des Servers.** Lokale Sicherungen liegen auf derselben
Maschine. Brennt sie, sind Anwendung und Sicherungen weg. Die Schnittstelle für
einen externen Speicher ist vorbereitet
(`SWISSHUB_BACKUP_EXTERN_BEFEHL`), eingerichtet ist keiner – und das Dashboard
sagt das so.

#### Umstellen vom früheren Cron-Eintrag

`deploy/backup.sh` ist eine Weiterleitung auf das neue Skript. Wer es per Cron
aufruft, entfernt den Eintrag:

```bash
sudo crontab -l | grep -v swisshub-backup | sudo crontab -
```

Die alten Sicherungen (`swisshub_<datum>.sql.gz` und `uploads/` direkt im
Backup-Verzeichnis) bleiben unangetastet: die neue Aufbewahrung sieht
ausschliesslich in `sicherungen/` nach.

#### Warum die Dateien dazugehören

Hier stand früher, ein Dump genüge als vollständige Sicherung. Das war schon
damals nicht richtig: Logo, Levelkarten-Hintergründe, Profilbanner, die Anhänge
der Einsprüche und die Momente von Wrapped liegen als Dateien in
`SWISSHUB_UPLOAD_DIR`, nicht in der Datenbank.

Mit den **hochgeladenen Clips** ist der Unterschied nicht mehr kosmetisch: eine
Wiederherstellung aus einem reinen Dump ergibt eine Datenbank voller Clips,
deren Dateien fehlen. Die Ausliefer-Route `/api/clips/datei/<name>` antwortet
dann für jeden einzelnen mit `404` - eine Hall of Fame aus schwarzen Flächen,
und im Log steht kein Fehler.

Der Spiegel ist ein Abbild, kein Archiv: die Dateinamen entstehen serverseitig
aus Zufall und werden nie überschrieben, ein tägliches `tar` wäre also jeden Tag
dieselben Gigabyte mit einem anderen Datum davor. Was der Spiegel nicht kann:
eine Datei zurückholen, die seit dem letzten Lauf gelöscht wurde. Das trifft
genau die von der Moderation abgelehnten Clips - und die soll nach einer
Wiederherstellung niemand mehr sehen.

#### Wie hochgeladene Dateien geschützt sind

| Frage                        | Antwort                                                                                                           |
| ---------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| Wo liegen sie?               | In `SWISSHUB_UPLOAD_DIR`, **ausserhalb** von `public/` - nie statisch bedient.                                    |
| Wie heissen sie?             | `clip-<32 Hex>.mp4` bzw. `.webm`, serverseitig erzeugt. Der Name aus dem Browser wird verworfen.                  |
| Rechte?                      | `0640` - lesbar für den Dienst, für niemanden ausführbar.                                                         |
| Wie werden sie ausgeliefert? | Route Handler mit festem `Content-Type`, `nosniff`, `Range`-Unterstützung und Anmeldepflicht.                     |
| Wer darf hochladen?          | Angemeldete Mitglieder mit `clips.submit`, 5 Uploads je 10 Minuten, nur bei offener Runde und freiem Kontingent.  |
| Wann werden sie gelöscht?    | Wenn die Moderation den Clip ablehnt. Dateien ohne Clip (abgebrochener Upload) räumt der Clip-Takt stündlich weg. |
| Und der Container-Neubau?    | `SWISSHUB_UPLOAD_DIR` muss auf ein persistentes Volume zeigen - siehe `docker-compose.prod.yml`.                  |

### Überwachung

- `https://system.swisshub.gg/api/health` liefert `200` bzw. `503` und die
  Teilzustände von WebApp, Datenbank und Bot - ideal für Uptime-Kuma o.ä.
- Das Dashboard zeigt Bot-Status, letzten Heartbeat und Ping.
- **Audit Log** zeigt zusätzlich den Zustand der Hash-Chain.

---

## 9. Checkliste vor dem Livegang

- [ ] DNS zeigt auf den Server, HTTPS-Zertifikat gültig
- [ ] `NEXT_PUBLIC_APP_URL=https://system.swisshub.gg`, Redirect URI identisch
- [ ] `AUTH_SECRET` frisch erzeugt, `.env` mit `chmod 600`, nicht im Git
- [ ] `DEV_MOCK_DISCORD=false`, `TRUST_PROXY=true`
- [ ] Bot-Rolle über Jail-Rolle, Admin-Rollen als _geschützt_ markiert
- [ ] Jail-Rolle und Log-Channel konfiguriert, Testjail erfolgreich
- [ ] `swisshub-backup.timer` aktiv und einmal von Hand gelaufen
- [ ] `swisshub-recovery liste` zeigt eine Sicherung mit Integrität «bestanden»
- [ ] `swisshub-recovery test` einmal durchgelaufen – Restore-Test «bestanden»
- [ ] `MASTER_ENCRYPTION_KEY` und die übrigen Geheimnisse offline gesichert,
      Fingerabdruck notiert und mit dem Manifest verglichen
- [ ] Entschieden, ob ein externer Speicher eingerichtet wird – lokale
      Sicherungen überleben den Verlust des Servers nicht
- [ ] Firewall aktiv, PostgreSQL nicht öffentlich erreichbar
- [ ] `curl -s https://system.swisshub.gg/api/health` meldet `"status":"ok"`

---

## 10. Troubleshooting

| Symptom                                                        | Ursache / Lösung                                                                                                                           |
| -------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| Container startet nicht, Log nennt Variablen                   | `.env` unvollständig - die Meldung listet die fehlenden Werte                                                                              |
| `DEV_MOCK_DISCORD: darf in Production niemals aktiviert sein`  | In `.env` auf `false` setzen                                                                                                               |
| `NEXT_PUBLIC_APP_URL: muss in Production HTTPS verwenden`      | `https://system.swisshub.gg` eintragen                                                                                                     |
| Login endet mit `?error=state`                                 | Redirect URI im Developer Portal weicht ab, oder Cookies werden blockiert                                                                  |
| Login endet auf `/access-denied`                               | Konto ist kein Mitglied der konfigurierten Guild                                                                                           |
| Angemeldet, aber "Keine Berechtigung"                          | Weder `SWISSHUB_OWNER_DISCORD_ID` gesetzt noch eine Rollen-Zuordnung vorhanden - siehe Abschnitt 7a, Diagnose mit `npm run doctor -- <ID>` |
| 502 Bad Gateway                                                | WebApp läuft nicht: `docker compose ps` bzw. `systemctl status swisshub-web`                                                               |
| Bot offline im Dashboard                                       | Bot-Prozess prüfen; Heartbeat älter als 70 Sekunden gilt als offline                                                                       |
| Mitgliedersuche leer                                           | _SERVER MEMBERS INTENT_ im Developer Portal aktivieren                                                                                     |
| `Der Bot besitzt möglicherweise nicht genügend Berechtigungen` | Bot-Rolle auf Discord über die betroffenen Rollen ziehen                                                                                   |
| Rate-Limit-Meldungen trotz weniger Zugriffe                    | `TRUST_PROXY=true` fehlt - alle Anfragen zählen sonst auf dieselbe IP                                                                      |

Weitere Hintergründe: [ARCHITECTURE.md](ARCHITECTURE.md) und
[SECURITY.md](SECURITY.md) (inkl. Sicherheitsannahmen und Checkliste).
