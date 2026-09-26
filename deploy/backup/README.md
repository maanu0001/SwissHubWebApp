# SwissHub – Backup & Recovery

Sicherung und Wiederherstellung von SwissHub: PostgreSQL-Export, hochgeladene
Dateien, Manifest mit Prüfsummen, automatische Prüfung und ein echter
Restore-Test in einer Wegwerf-Datenbank.

## Der Grundsatz

**SwissHub läuft weiter, egal was hier passiert.** Diese Sicherung ist kein Teil
der Anwendung. Sie ist ein Shell-Skript unter einem systemd-Timer. Sie
importiert nichts aus `packages/`, sie wird von nichts in `apps/` aufgerufen,
und sie läuft in keinem Container der Anwendung.

Das ist die Lehre aus dem Ausfall vom 25.09.2026. Damals bekam SwissHub eine
Backup-Implementierung in TypeScript, in `packages/modules`. Drei ihrer Dateien
begannen mit `import 'server-only'`. Über ein Barrel wurden sie Teil von
`@swisshub/modules` – und damit Teil dessen, was der Discord-Bot beim Start
lädt. `server-only` wirft in jedem Node-Prozess, der kein Next.js ist. Der Bot
kam nicht mehr hoch. Die Pipeline war grün, weil ein Typecheck keinen
Laufzeitimport sieht.

Deshalb die Aufteilung:

| Wo                                        | Was                                   | Läuft in             |
| ----------------------------------------- | ------------------------------------- | -------------------- |
| `deploy/backup/`                          | die Sicherung selbst                  | systemd, Bash        |
| `packages/modules/src/backup/manifest.ts` | Typen und Prüfung des Manifests, rein | überall, kann nichts |
| `apps/web/src/modules/backup/`            | den Zustand lesen und anzeigen        | nur Next.js          |

`tests/unit/backup-runtime.test.ts` hält das fest: kein `server-only` und kein
`node:fs` in `packages/modules/src/backup/`, und der Bot startet weiterhin
(`npm run bot:startup-test`).

## Einrichten

```bash
# 1. Konfiguration (jede Zeile optional – Vorgaben passen für eine
#    Standardinstallation)
sudo mkdir -p /etc/swisshub
sudo cp /opt/swisshub/deploy/backup/swisshub-backup.env.example /etc/swisshub/backup.env
sudo chmod 600 /etc/swisshub/backup.env

# 2. Timer
sudo cp /opt/swisshub/deploy/backup/systemd/* /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now swisshub-backup.timer
sudo systemctl enable --now swisshub-backup-verify.timer
sudo systemctl enable --now swisshub-restore-test.timer

# 3. Einmal von Hand, und zusehen
sudo systemctl start swisshub-backup.service
sudo journalctl -u swisshub-backup.service -f

# 4. Nachsehen
sudo /opt/swisshub/deploy/backup/bin/swisshub-recovery liste
```

Danach zeigt **System → Backup & Recovery** in der WebApp den Zustand. Ohne
Schritt 1–3 zeigt die Seite «noch nicht eingerichtet» und diese Anleitung – sie
erfindet keine Zahlen.

### Umstellen vom alten Cron-Eintrag

Das frühere `deploy/backup.sh` ist eine Weiterleitung. Wer es per Cron aufruft,
stellt um:

```bash
sudo crontab -l | grep -v swisshub-backup | sudo crontab -
```

Die alten Sicherungen (`swisshub_<datum>.sql.gz` und `uploads/` direkt im
Backup-Verzeichnis) bleiben liegen. Die neue Aufbewahrung sieht ausschliesslich
in `sicherungen/` nach und fasst sie nicht an; wer sie nicht mehr braucht,
entfernt sie selbst.

## Was gesichert wird

```
/var/backups/swisshub/                   0700 root
├── sicherungen/
│   └── 2026-09-26T030012Z/              eine Sicherung
│       ├── manifest.json                Kennung, Prüfsummen, Zustände
│       ├── pruefsummen.sha256           für `sha256sum -c`, ohne Werkzeug
│       ├── datenbank.sql.gz             pg_dump, komprimiert
│       ├── dateien.tar.gz               SWISSHUB_UPLOAD_DIR
│       ├── umgebung.txt                 Variablen*namen*, keine Werte
│       └── geheimnisse.tar.gz.age       nur wenn eingerichtet (siehe unten)
├── .arbeit/                             laufende Sicherung, wird weggeräumt
└── .sperre                              flock

/var/lib/swisshub/backup-status/         0755 – das Einzige, was die WebApp liest
├── zustand.json
└── sicherungen/<kennung>.json           Kopien der Manifeste
```

Die Trennung der beiden Verzeichnisse ist der Kern der Absicherung nach oben:
die WebApp sieht **nur** Manifeste. Sie kann keinen Datenbankexport ausliefern,
weil die Datei für sie nicht existiert – das ist eine Eigenschaft des
Dateisystems und nicht eine Regel in einer Route, die jemand übersehen kann.

### Die Datenbank

`pg_dump --no-owner --no-privileges --clean --if-exists`, durch `gzip -9`.
Im Compose-Betrieb läuft `pg_dump` **im Postgres-Container** – auf dem Host ist
kein PostgreSQL installiert, und das soll so bleiben.

Eine Sicherung gilt nur als gelungen, wenn sie es wirklich ist. Vier Prüfungen,
und jede fängt einen anderen Fehler:

1. `pipefail` – scheitert `pg_dump`, scheitert der Lauf. Ohne das schriebe
   `gzip` ein gültiges Archiv über einen halben Dump.
2. Die Datei muss grösser als 200 Bytes sein. `pg_dump` schreibt selbst für eine
   leere Datenbank über 1000 Bytes Kopf und Fuss.
3. Das gzip wird vollständig durchgelesen.
4. Die letzte Zeile, die `pg_dump` schreibt – `-- PostgreSQL database dump
complete` – muss da sein. **Das ist der eigentliche Vollständigkeitsbeweis:**
   ein Export, der mitten im Lauf abbrach, hat gültiges gzip und plausible
   Grösse, aber diese Zeile nicht.

### Die Dateien

Alles unter `SWISSHUB_UPLOAD_DIR`: Logo, Levelkarten-Hintergründe,
Profilbanner, Anhänge der Einsprüche, Momente von Wrapped und die hochgeladenen
Clips. Ohne sie ergibt eine Wiederherstellung eine Datenbank voller Clips, deren
Dateien fehlen – eine Hall of Fame aus schwarzen Flächen, ohne einen Fehler im
Log.

Ein Archiv je Sicherung, nicht ein gemeinsamer Spiegel. Ein Spiegel wäre
sparsamer, aber er wird von **jedem** Lauf verändert: ein abgebrochener Lauf
liesse ihn halb fertig zurück, und alle Manifeste zeigten darauf. Eine Sicherung
muss für sich allein stehen.

Wächst `SWISSHUB_UPLOAD_DIR` über `SWISSHUB_BACKUP_DATEIEN_MAX_MB` (Vorgabe
4 GB), bricht der Lauf **ab** statt die Dateien stillschweigend auszulassen. Wer
viele Gigabyte hat, soll das entscheiden und nicht eines Tages feststellen, dass
die Dateien seit Monaten fehlen.

### Nicht gesichert: die Geheimnisse

`.env` liegt **absichtlich** in keiner Sicherung. Der Grund ist unbequem und
einfach: läge der `MASTER_ENCRYPTION_KEY` neben dem Datenbankexport, hätte jeder,
der die Sicherung hat, beides. Die Verschlüsselung der Integrationen wäre dann
genau so viel wert wie der Zugriffsschutz des Backup-Verzeichnisses.

In der Sicherung steht deshalb nur:

- `umgebung.txt` – die **Namen** der Variablen. Nach einem Totalverlust die
  Antwort auf «was muss ich wieder beschaffen?».
- im Manifest ein **Fingerabdruck** des Hauptschlüssels: zwölf Hexzeichen aus
  SHA-256. Er beantwortet die einzige Frage, die im Ernstfall zählt – _habe ich
  den richtigen Schlüssel?_ – und gibt ihn nicht her.

## Schlüssel und Geheimnisse

### Die Offline-Sicherung (der empfohlene Weg)

Einmal, auf dem eigenen Rechner, nicht auf dem Server:

```bash
# Auf dem Server auslesen – und die Ausgabe nirgends speichern, wo sie bleibt:
sudo grep -E '^(MASTER_ENCRYPTION_KEY|AUTH_SECRET|SESSION_SECRET|DISCORD_BOT_TOKEN|DISCORD_CLIENT_SECRET|POSTGRES_PASSWORD|PAYMENT_API_KEY|PAYMENT_WEBHOOK_SECRET|MUSIC_RUNTIME_KEY)=' /opt/swisshub/.env
```

Diese Werte gehören an **zwei** Orte, die nicht dieser Server sind – ein
Passwortmanager und ein Ausdruck im Schrank, oder zwei verschlüsselte Sticks.
Ein einziger Ort ist kein Backup.

Den Fingerabdruck dazunotieren:

```bash
sudo /opt/swisshub/deploy/backup/bin/swisshub-recovery zeige | grep Schluessel
```

Stimmt er später mit der Offline-Kopie überein, passt der Schlüssel. Stimmt er
nicht, läuft SwissHub nach einer Wiederherstellung – aber die gespeicherten
Zugangsdaten der Integrationen bleiben unlesbar, und niemand sieht auf den
ersten Blick, warum.

**Was nicht behauptet wird:** dieses Skript sichert die Schlüssel nicht extern.
Es kann es nicht, und es tut nicht so. Die Offline-Kopie muss ein Mensch machen.

### Der optionale age-Weg

Wer trotzdem eine Kopie _im_ Backup will, hinterlegt öffentliche
age-Empfängerschlüssel:

```bash
# Auf dem eigenen Rechner – niemals auf dem Server:
age-keygen -o ~/swisshub-recovery.key
# Zeile "Public key: age1..." nach /etc/swisshub/backup.env:
#   SWISSHUB_BACKUP_AGE_RECIPIENTS=age1...
```

Der Server verschlüsselt dann `.env` und **kann sie danach selbst nicht mehr
lesen** – zum Verschlüsseln genügt age der öffentliche Teil. Wer den Server
übernimmt, bekommt die Pakete und mit ihnen nichts. Der private Schlüssel bleibt
offline.

Wiederherstellen:

```bash
age --decrypt -i ~/swisshub-recovery.key geheimnisse.tar.gz.age | tar -xzv
```

Ist `age` nicht installiert oder die Zeile leer, wird nichts verschlüsselt, und
das Manifest sagt «nicht gesichert». Es sagt nie, etwas sei gesichert, das es
nicht ist.

Keine automatische Schlüsselrotation. Kein Ändern der bestehenden
Verschlüsselung.

## Die drei Zustände

Sie werden **nicht** zu einem Haken zusammengefasst:

| Zustand                | Wer                      | Was er beweist                                                |
| ---------------------- | ------------------------ | ------------------------------------------------------------- |
| **BACKUP ERSTELLT**    | `swisshub-backup`        | Die Dateien liegen da, das Manifest ist geschrieben.          |
| **INTEGRITÄT GEPRÜFT** | `swisshub-backup-verify` | Prüfsummen stimmen, Archive lesbar, Abschlussmarke vorhanden. |
| **RESTORE GETESTET**   | `swisshub-restore-test`  | Der Export wurde eingespielt, Tabellen und Zeilen stimmen.    |

Eine richtige Prüfsumme über einen Dump, den PostgreSQL nicht annimmt, ist eine
richtige Prüfsumme. Nur der dritte Zustand sagt etwas über Wiederherstellbarkeit.

Der Restore-Test läuft in einem PostgreSQL-Container **ohne Netz**
(`--network none`, Gespräch über `docker exec`) beziehungsweise in einer
zufällig benannten Wegwerf-Datenbank. Er startet die Anwendung nicht: kein Bot,
kein Discord-Token, kein Hintergrundjob. Bestanden ist er nur, wenn die Zahl der
Tabellen **und** die Zahl der Datenzeilen dem entspricht, was im Export steht –
ein Restore, der das Schema aufbaut und die Daten verliert, läuft ohne
Fehlermeldung durch.

## Aufbewahrung

Vorgabe: 7 täglich, 4 wochenweise, 3 monatsweise. Behalten wird, was
**mindestens eine** der drei Regeln behält; eine Sicherung, die zwei Regeln
erfüllt, zählt nicht doppelt.

Zwei Bremsen:

1. Gelöscht wird **erst**, wenn die neueste behaltene Sicherung die Prüfung
   besteht. Ein defekter Lauf darf nicht dazu führen, dass die älteren, die noch
   gut waren, verschwinden.
2. Gelöscht wird nur, was auf `^\d{4}-\d{2}-\d{2}T\d{6}Z$` passt und ein
   Verzeichnis direkt unter `sicherungen/` ist. Der Pfad wird im Skript
   zusammengesetzt, nie von aussen übernommen.

Platzbedarf überschlagen: bis zu 14 Sicherungen. Bei 200 MB Datenbank
(komprimiert ~40 MB) und 3 GB Uploads sind das rund 43 GB – die Uploads sind der
Posten, der zählt. Passt das nicht, sind die Zahlen zu senken.

## Wiederherstellen

```bash
BIN=/opt/swisshub/deploy/backup/bin

sudo $BIN/swisshub-recovery liste        # was liegt da
sudo $BIN/swisshub-recovery zeige        # Einzelheiten der neuesten
sudo $BIN/swisshub-recovery plan         # was ein Restore täte, und was fehlt
sudo $BIN/swisshub-recovery test         # Probe in einer Wegwerf-Datenbank
```

Und im Ernstfall:

```bash
sudo $BIN/swisshub-recovery wiederherstellen <kennung> \
  --ziel produktion --bestaetigen <kennung>
```

`--bestaetigen` mit derselben Kennung ist kein Hindernis für den, der es will,
aber eines für den Tippfehler und für die kopierte Zeile aus einer Anleitung.

Vorher prüft das Programm die Integrität und legt **von sich aus eine
Sicherheitssicherung des jetzigen Zustands** an. Ohne diesen Rückweg wird nicht
wiederhergestellt. Die bestehenden Uploads werden nach
`<upload-dir>.vor-restore-<zeit>` verschoben, nicht gelöscht.

Danach von Hand:

1. `MASTER_ENCRYPTION_KEY` und die übrigen Geheimnisse aus der Offline-Kopie in
   die `.env` – Fingerabdruck vergleichen.
2. Rechte auf dem Upload-Verzeichnis: `chown -R <benutzer>:<gruppe>`.
3. **System → Integrationen** öffnen: lassen sich die Zugangsdaten lesen?

### Was ein Restore nicht tut

Er entfernt keine Tabelle, die der Export nicht kennt. `--clean` räumt genau
das ab, was im Dump steht. Für eine Wiederherstellung «auf Anfang» – nach einem
Serververlust, oder wenn seit der Sicherung Migrationen liefen, die man
loswerden will – gehört der Export in eine **leere** Datenbank.

## Exit-Codes

| Code | Bedeutung                                      |
| ---: | ---------------------------------------------- |
|    0 | in Ordnung                                     |
|    1 | unerwarteter Fehler                            |
|    2 | Konfiguration oder Aufruf falsch               |
|    3 | es läuft schon ein Backup-Vorgang              |
|    4 | zu wenig Platz                                 |
|    5 | der Datenbankexport ist gescheitert            |
|    6 | das Dateiarchiv ist gescheitert                |
|    7 | eine Prüfung ist gescheitert                   |
|    8 | eine Voraussetzung fehlt (Werkzeug, Container) |

## Externer Speicher

**Es ist keiner eingerichtet.** Das Dashboard zeigt «nicht eingerichtet», und
das ist die Wahrheit – nicht ein Platzhalter.

Vorbereitet ist die Schnittstelle: `SWISSHUB_BACKUP_EXTERN_BEFEHL` bekommt nach
jeder erfolgreichen Sicherung den Pfad des Sicherungsverzeichnisses als einziges
Argument. Ein Skript um `rclone copy`, `restic backup` oder `scp` passt dort
hinein. Scheitert es, bleibt die lokale Sicherung unversehrt und der Fehlschlag
steht im Status.

### Das verbleibende Risiko

**Lokale Sicherungen überleben den Verlust des Servers nicht.** Brennt das
Rechenzentrum, wird die Platte verschlüsselt oder löscht der Anbieter das Konto,
sind Anwendung _und_ Sicherungen weg. Daran ändert keine Prüfsumme und kein
Restore-Test etwas.

Solange kein externer Speicher eingerichtet ist, schützt diese Sicherung gegen:
ein versehentliches `DELETE`, eine misslungene Migration, einen
Festplattenfehler in einer einzelnen Datei, einen kaputten Upload. Sie schützt
**nicht** gegen den Verlust des Servers.

## Fehlersuche

| Meldung / Symptom                        | Ursache und Abhilfe                                                                       |
| ---------------------------------------- | ----------------------------------------------------------------------------------------- |
| `Es laeuft bereits ein Backup-Vorgang`   | Code 3. Normal, wenn ein Lauf noch läuft. `journalctl -u swisshub-backup` zeigt den.      |
| `Zu wenig Platz in ...`                  | Code 4. Aufbewahrung senken oder Platz schaffen. Es wurde nichts geschrieben.             |
| `pg_dump ist gescheitert`                | Code 5. Läuft der Postgres-Container? `docker compose ps postgres`                        |
| `ist ... MB gross, die Grenze liegt bei` | Code 6. `SWISSHUB_BACKUP_DATEIEN_MAX_MB` anheben – bewusst, mit Blick auf den Platz.      |
| `die Abschlussmarke von pg_dump fehlt`   | Der Export brach ab. Die Sicherung wird verworfen, die vorherige bleibt.                  |
| WebApp zeigt «noch nicht eingerichtet»   | Der Timer läuft nicht, oder `SWISSHUB_BACKUP_STATUS_DIR` zeigt anderswohin als der Mount. |
| `python3` fehlt                          | Code 8. Manifest, Prüfung und Aufbewahrung hängen daran: `apt install python3`.           |
