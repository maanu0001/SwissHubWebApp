# shellcheck shell=bash
#
# Gemeinsame Grundlage der SwissHub-Backup-Werkzeuge.
#
# Wird von den Skripten unter `deploy/backup/bin/` eingelesen. Enthaelt
# Konfiguration, Protokollierung, Sperre, Platzpruefung und den Zugang zur
# Datenbank - nichts davon ist SwissHub-spezifisch genug, um es viermal zu
# schreiben, und alles davon ist die Art Code, bei der die vierte Kopie
# irgendwann anders ist als die erste.
#
# ## Was hier absichtlich nicht steht
#
# Keine eigene Backup-Engine. Der Datenbankexport ist `pg_dump`, das
# Dateiarchiv ist `tar`, die Pruefsummen sind `sha256`, die Sperre ist
# `flock`. Alles vier ist in Millionen Installationen taeglich im Einsatz -
# eine selbstgebaute Alternative koennte man unmoeglich so gruendlich pruefen.

# --- Exit-Codes --------------------------------------------------------------
#
# Eindeutig, damit ein systemd-Timer und ein Mensch dieselbe Auskunft
# bekommen. `1` bleibt der Sammelfall fuer alles Unerwartete.
readonly CODE_FEHLER=1
readonly CODE_KONFIGURATION=2
readonly CODE_LAEUFT_SCHON=3
readonly CODE_KEIN_PLATZ=4
readonly CODE_DATENBANK=5
readonly CODE_DATEIEN=6
readonly CODE_PRUEFUNG=7
readonly CODE_VORAUSSETZUNG=8

# --- Protokoll ---------------------------------------------------------------
#
# Zeitstempel in UTC, Bereich in Klammern - dasselbe Muster wie im Logger der
# Anwendung, damit `journalctl` und Anwendungslog nebeneinander lesbar sind.
protokoll() { printf '%s [backup] %s\n' "$(date -u '+%Y-%m-%dT%H:%M:%SZ')" "$*"; }
warnung() { printf '%s [backup] WARNUNG %s\n' "$(date -u '+%Y-%m-%dT%H:%M:%SZ')" "$*" >&2; }

# Beenden mit Grund und Code. Der Code ist das erste Argument.
abbruch() {
  local code="$1"
  shift
  printf '%s [backup] FEHLER %s\n' "$(date -u '+%Y-%m-%dT%H:%M:%SZ')" "$*" >&2
  exit "${code}"
}

# --- Konfiguration -----------------------------------------------------------
#
# Drei Quellen, in dieser Reihenfolge:
#
# 1. Die Umgebung des Aufrufs - damit laesst sich jeder Lauf einmalig
#    umlenken, und genau davon leben die Tests.
# 2. `/etc/swisshub/backup.env` - die Konfiguration des Servers.
# 3. Die Vorgaben hier.
#
# Die `.env` der Anwendung wird **nicht** eingelesen. Sie enthaelt Geheimnisse,
# und dieses Skript soll sie nicht in seiner Umgebung tragen; gelesen wird
# daraus nur gezielt und nur das, was gebraucht wird (siehe
# `master_fingerabdruck`).
lade_konfiguration() {
  local env_datei="${SWISSHUB_BACKUP_ENV_FILE:-/etc/swisshub/backup.env}"
  if [[ -f "${env_datei}" ]]; then
    # `set -a` exportiert, was die Datei setzt; bereits gesetzte Werte aus der
    # Umgebung gewinnen, weil sie danach wieder eingesetzt werden.
    local -a vorher=()
    local name
    for name in SWISSHUB_BACKUP_DIR SWISSHUB_BACKUP_STATUS_DIR SWISSHUB_UPLOAD_DIR \
      SWISSHUB_PROJECT_DIR SWISSHUB_BACKUP_KEEP_DAILY SWISSHUB_BACKUP_KEEP_WEEKLY \
      SWISSHUB_BACKUP_KEEP_MONTHLY SWISSHUB_BACKUP_MIN_FREE_MB SWISSHUB_BACKUP_DATEIEN_MAX_MB \
      SWISSHUB_BACKUP_AGE_RECIPIENTS SWISSHUB_BACKUP_APP_ENV SWISSHUB_BACKUP_EXTERN_BEFEHL; do
      if [[ -n "${!name:-}" ]]; then
        vorher+=("${name}=${!name}")
      fi
    done
    set -a
    # shellcheck disable=SC1090
    source "${env_datei}"
    set +a
    local eintrag
    for eintrag in "${vorher[@]}"; do
      export "${eintrag?}"
    done
  fi

  # Wo die Sicherungen liegen. Ausserhalb des Repositories - ein Backup im
  # Arbeitsbaum waere beim naechsten `git reset --hard` des Deployments weg.
  BACKUP_DIR="${SWISSHUB_BACKUP_DIR:-/var/backups/swisshub}"
  SICHERUNGEN_DIR="${BACKUP_DIR}/sicherungen"
  ARBEIT_DIR="${BACKUP_DIR}/.arbeit"
  SPERRE="${BACKUP_DIR}/.sperre"

  # Das Statusverzeichnis: das Einzige, was die WebApp liest.
  #
  # Getrennt vom Backup-Verzeichnis, und das ist der Kern der Absicherung
  # nach oben: die Sicherungen bleiben `0700` und gehoeren root, das
  # Statusverzeichnis ist lesbar und enthaelt ausschliesslich Manifeste.
  # Damit kann die WebApp keinen Dump ausliefern - nicht, weil eine Route es
  # verbietet, sondern weil die Datei fuer sie nicht existiert.
  STATUS_DIR="${SWISSHUB_BACKUP_STATUS_DIR:-/var/lib/swisshub/backup-status}"

  UPLOAD_DIR="${SWISSHUB_UPLOAD_DIR:-/var/lib/swisshub/uploads}"
  PROJECT_DIR="${SWISSHUB_PROJECT_DIR:-/opt/swisshub}"
  APP_ENV="${SWISSHUB_BACKUP_APP_ENV:-${PROJECT_DIR}/.env}"

  KEEP_DAILY="${SWISSHUB_BACKUP_KEEP_DAILY:-7}"
  KEEP_WEEKLY="${SWISSHUB_BACKUP_KEEP_WEEKLY:-4}"
  KEEP_MONTHLY="${SWISSHUB_BACKUP_KEEP_MONTHLY:-3}"

  # Was nach dem Lauf noch frei sein muss. Eine Sicherung, die die Platte
  # fuellt, nimmt PostgreSQL den Platz fuer sein WAL - und dann steht nicht
  # das Backup, sondern der Server.
  MIN_FREE_MB="${SWISSHUB_BACKUP_MIN_FREE_MB:-512}"

  # Obergrenze fuer das Dateiarchiv. Absichtlich ein harter Abbruch und keine
  # stille Auslassung: wer 20 GB Uploads hat, soll das entscheiden und nicht
  # eines Tages feststellen, dass die Dateien seit Monaten fehlen.
  DATEIEN_MAX_MB="${SWISSHUB_BACKUP_DATEIEN_MAX_MB:-4096}"

  AGE_RECIPIENTS="${SWISSHUB_BACKUP_AGE_RECIPIENTS:-}"
  EXTERN_BEFEHL="${SWISSHUB_BACKUP_EXTERN_BEFEHL:-}"

  MANIFEST_PY="${BACKUP_LIB_DIR}/manifest.py"
  [[ -f "${MANIFEST_PY}" ]] || abbruch "${CODE_VORAUSSETZUNG}" "manifest.py fehlt neben ${BACKUP_LIB_DIR}."
}

# --- Voraussetzungen ---------------------------------------------------------
#
# Vorher pruefen, nicht auf halbem Weg scheitern. Ein Backup, das nach dem
# Datenbankexport an einem fehlenden `tar` abbricht, hat schon Platz belegt und
# eine halbe Sicherung hinterlassen.
pruefe_werkzeuge() {
  local fehlend=()
  local werkzeug
  for werkzeug in "$@"; do
    command -v "${werkzeug}" >/dev/null 2>&1 || fehlend+=("${werkzeug}")
  done
  if ((${#fehlend[@]} > 0)); then
    abbruch "${CODE_VORAUSSETZUNG}" "Diese Werkzeuge fehlen: ${fehlend[*]}"
  fi
}

# `python3` traegt Manifest, Pruefung und Aufbewahrung. Ohne es laeuft nichts,
# und das soll sofort und deutlich gesagt werden.
pruefe_python() {
  pruefe_werkzeuge python3
  python3 -c 'import gzip, hashlib, json, tarfile' 2>/dev/null ||
    abbruch "${CODE_VORAUSSETZUNG}" "python3 ist ohne Standardbibliothek gebaut."
}

# --- Sperre ------------------------------------------------------------------
#
# Zwei Backups gleichzeitig schreiben in dasselbe Verzeichnis, raeumen nach
# derselben Regel auf und koennen sich die Datei unter den Fuessen wegloeschen.
# Deshalb: genau einer.
#
# `flock` und nicht eine selbstgebaute PID-Datei. Eine PID-Datei ueberlebt
# einen `kill -9` und sperrt danach fuer immer; eine Dateisperre gibt der Kernel
# frei, wenn der Prozess endet - egal wie.
nimm_sperre() {
  exec {SPERR_FD}>"${SPERRE}"
  if ! flock -n "${SPERR_FD}"; then
    abbruch "${CODE_LAEUFT_SCHON}" "Es laeuft bereits ein Backup-Vorgang (${SPERRE})."
  fi
}

# --- Platz -------------------------------------------------------------------

# Freie Megabyte auf dem Dateisystem eines Pfades.
freie_mb() {
  df -Pm "$1" | awk 'NR == 2 { print $4 }'
}

# Belegte Megabyte eines Verzeichnisses, 0 wenn es nicht existiert.
belegte_mb() {
  [[ -d "$1" ]] || { printf '0\n'; return 0; }
  du -sm "$1" 2>/dev/null | awk '{ print $1 }'
}

# Reicht der Platz fuer diesen Lauf?
#
# Geschaetzt wird bewusst grosszuegig: der Dump wird komprimiert kleiner als
# die Datenbank, aber um wie viel, weiss man vorher nicht. Lieber einmal zu
# frueh abbrechen als eine volle Platte.
pruefe_platz() {
  local geschaetzt_mb="$1"
  local frei
  frei="$(freie_mb "${BACKUP_DIR}")"
  local gebraucht=$((geschaetzt_mb + MIN_FREE_MB))
  protokoll "Platz: ${frei} MB frei, geschaetzter Bedarf ${geschaetzt_mb} MB plus ${MIN_FREE_MB} MB Reserve."
  if ((frei < gebraucht)); then
    abbruch "${CODE_KEIN_PLATZ}" \
      "Zu wenig Platz in ${BACKUP_DIR}: ${frei} MB frei, ${gebraucht} MB gebraucht. Alte Sicherungen entfernen oder SWISSHUB_BACKUP_MIN_FREE_MB senken."
  fi
}

# --- Datenbank ---------------------------------------------------------------
#
# Zwei Betriebsarten, und die Wahl faellt an der Umgebung:
#
# - `DATABASE_URL` gesetzt: PostgreSQL ist direkt erreichbar, `pg_dump` auf dem
#   Host. So laufen die Tests.
# - sonst: PostgreSQL laeuft im Compose-Stack, und `pg_dump` kommt aus dem
#   Postgres-Container. So laeuft es auf dem SwissHub-Server - dort ist kein
#   PostgreSQL auf dem Host installiert, und das soll auch so bleiben.
#
# Beide Wege nutzen dasselbe `pg_dump` derselben Hauptversion wie der Server.
datenbank_modus() {
  if [[ -n "${DATABASE_URL:-}" ]]; then
    printf 'direkt\n'
  else
    printf 'compose\n'
  fi
}

compose() {
  docker compose -f "${PROJECT_DIR}/docker-compose.prod.yml" "$@"
}

# Der Datenbankexport nach stdout.
#
# `--clean --if-exists` macht den Export auch in eine bestehende Datenbank
# einspielbar; ohne das muesste im Ernstfall zuerst jemand von Hand
# aufraeumen, und zwar unter Zeitdruck.
#
# Kein `--data-only`, kein `--schema-only`: eine Sicherung, aus der sich die
# Anwendung nicht allein aufbauen laesst, ist keine.
datenbank_export() {
  case "$(datenbank_modus)" in
    direkt)
      pg_dump --no-owner --no-privileges --clean --if-exists "${DATABASE_URL}"
      ;;
    compose)
      compose exec -T postgres pg_dump \
        --no-owner --no-privileges --clean --if-exists \
        -U "${POSTGRES_USER:-swisshub}" "${POSTGRES_DB:-swisshub}"
      ;;
  esac
}

# Die geschaetzte Groesse der Datenbank in Megabyte, 0 wenn nicht zu ermitteln.
datenbank_mb() {
  local ausgabe=''
  case "$(datenbank_modus)" in
    direkt)
      ausgabe="$(psql -tAX -c 'SELECT pg_database_size(current_database()) / 1048576;' "${DATABASE_URL}" 2>/dev/null || true)"
      ;;
    compose)
      ausgabe="$(compose exec -T postgres psql -tAX -U "${POSTGRES_USER:-swisshub}" \
        -d "${POSTGRES_DB:-swisshub}" -c 'SELECT pg_database_size(current_database()) / 1048576;' 2>/dev/null || true)"
      ;;
  esac
  ausgabe="${ausgabe//[^0-9]/}"
  printf '%s\n' "${ausgabe:-0}"
}

# --- Schluessel --------------------------------------------------------------

# Der Fingerabdruck des Hauptschluessels - zwoelf Hexzeichen, nie der Wert.
#
# Warum ueberhaupt: nach einem Totalverlust hat jemand eine Offline-Kopie des
# `MASTER_ENCRYPTION_KEY` in der Hand und muss wissen, ob es die richtige ist.
# Ohne diesen Abdruck ist die einzige Probe der Versuch, die Integrationen zu
# entschluesseln - im Ernstfall, unter Zeitdruck, mit unklarem Ergebnis.
master_fingerabdruck() {
  [[ -f "${APP_ENV}" ]] || return 0
  python3 "${MANIFEST_PY}" fingerabdruck "${APP_ENV}" MASTER_ENCRYPTION_KEY 2>/dev/null || true
}

# --- Kennungen ---------------------------------------------------------------

# Die Kennung einer Sicherung: UTC, sortierbar, dateinamentauglich.
#
# UTC und nicht Ortszeit: sonst gibt es im Oktober eine Stunde, in der zwei
# Sicherungen dieselbe Kennung tragen wuerden.
neue_kennung() { date -u '+%Y-%m-%dT%H%M%SZ'; }

# Ist das eine Kennung, und gehoert sie zu einer Sicherung in diesem
# Verzeichnis?
#
# Jeder loeschende oder lesende Zugriff geht hierdurch. Damit kann kein
# Argument von der Kommandozeile zu einem Pfad ausserhalb von
# `${SICHERUNGEN_DIR}` werden - `../` passt nicht auf das Muster.
pfad_der_sicherung() {
  local kennung="$1"
  if [[ ! "${kennung}" =~ ^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{6}Z$ ]]; then
    return 1
  fi
  local pfad="${SICHERUNGEN_DIR}/${kennung}"
  [[ -d "${pfad}" ]] || return 1
  printf '%s\n' "${pfad}"
}

# Alle vorhandenen Sicherungen, aelteste zuerst.
#
# Nur solche mit Manifest: ein Verzeichnis ohne Manifest ist eine Sicherung,
# die es nicht bis zum Ende geschafft hat, und die soll nirgends mitgezaehlt
# werden.
liste_sicherungen() {
  [[ -d "${SICHERUNGEN_DIR}" ]] || return 0
  local pfad
  for pfad in "${SICHERUNGEN_DIR}"/*; do
    [[ -d "${pfad}" && -f "${pfad}/manifest.json" ]] || continue
    basename "${pfad}"
  done
}

# Die neueste Sicherung, oder nichts.
neueste_sicherung() { liste_sicherungen | tail -n 1; }

# --- Statusverzeichnis -------------------------------------------------------

# Das Statusverzeichnis fortschreiben: Manifeste spiegeln, Kennzahlen setzen.
schreibe_status() {
  python3 "${MANIFEST_PY}" zustand "${STATUS_DIR}" "$@"
}

spiegle_manifeste() {
  local ausgabe
  ausgabe="$(python3 "${MANIFEST_PY}" spiegle "${SICHERUNGEN_DIR}" "${STATUS_DIR}")" || return 1
  local anzahl bytes
  anzahl="$(printf '%s' "${ausgabe}" | awk '{ print $1 }')"
  bytes="$(printf '%s' "${ausgabe}" | awk '{ print $2 }')"
  schreibe_status "anzahl=${anzahl}" "bytesGesamt=${bytes}"
}

# --- Verzeichnisse -----------------------------------------------------------

# Die Verzeichnisse anlegen, ohne bestehende Rechte zu senken.
#
# `mkdir -p` laesst ein vorhandenes Verzeichnis unberuehrt - das ist hier
# Absicht: wer `/var/backups/swisshub` bewusst anders eingerichtet hat, soll
# das behalten. Gesetzt werden die Rechte nur bei einem Verzeichnis, das
# dieses Skript selbst anlegt.
richte_verzeichnisse_ein() {
  local neu=0
  [[ -d "${BACKUP_DIR}" ]] || neu=1
  mkdir -p "${SICHERUNGEN_DIR}" "${ARBEIT_DIR}" || abbruch "${CODE_FEHLER}" "Kann ${BACKUP_DIR} nicht anlegen."
  if ((neu == 1)); then
    chmod 700 "${BACKUP_DIR}"
  fi
  chmod 700 "${SICHERUNGEN_DIR}" "${ARBEIT_DIR}" 2>/dev/null || true

  # Das Statusverzeichnis ist bewusst lesbar: die WebApp laeuft als
  # unprivilegierter Benutzer im Container und muss die Manifeste lesen
  # koennen. Es enthaelt nichts als Manifeste - keine Dumps, keine
  # Geheimnisse.
  mkdir -p "${STATUS_DIR}/sicherungen" 2>/dev/null ||
    warnung "Kann ${STATUS_DIR} nicht anlegen - die WebApp zeigt dann keinen Status."
  chmod 755 "${STATUS_DIR}" "${STATUS_DIR}/sicherungen" 2>/dev/null || true
}
