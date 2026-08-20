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
> das Upload-Limit der Anwendung (5 MB). Die mitgelieferte nginx-Konfiguration
> setzt 8 MB. Ist der Wert zu klein, lehnt nginx die Datei mit **413** ab, bevor
> die Anwendung sie sieht.

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

```bash
cd /opt/swisshub
sudo -u swisshub git pull

# Variante A
sudo docker compose -f docker-compose.prod.yml up -d --build

# Variante B
sudo -u swisshub npm ci
sudo -u swisshub npm run db:deploy
sudo -u swisshub npm run build
sudo systemctl restart swisshub-web swisshub-bot
```

Migrationen laufen bei Variante A automatisch über den `migrate`-Dienst.
Bot und WebApp fahren bei einem Neustart kontrolliert herunter; laufende Jails
bleiben in der Datenbank und werden danach normal weiterverarbeitet.

### Backups

```bash
sudo cp /opt/swisshub/deploy/backup.sh /usr/local/bin/swisshub-backup
sudo chmod +x /usr/local/bin/swisshub-backup
sudo crontab -e
# taeglich um 03:30 Uhr:
30 3 * * * /usr/local/bin/swisshub-backup
```

Wiederherstellen:

```bash
gunzip -c /var/backups/swisshub/swisshub_2026-08-19_03-30.sql.gz \
  | sudo docker compose -f /opt/swisshub/docker-compose.prod.yml exec -T postgres \
    psql -U swisshub -d swisshub
```

Es liegt kein Zustand ausschliesslich im Arbeitsspeicher - ein PostgreSQL-Dump
genügt als vollständige Sicherung.

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
- [ ] Backup-Cron eingerichtet und einmal manuell getestet
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
