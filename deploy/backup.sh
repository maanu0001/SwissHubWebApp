#!/usr/bin/env bash
#
# SwissHub - Sicherung (Weiterleitung).
#
# ## Was mit diesem Skript passiert ist
#
# Es war die erste Sicherung von SwissHub: ein `pg_dump`, ein Spiegel der
# Uploads, ein Cron-Eintrag. Beides hat funktioniert, und beides fehlte das,
# was eine Sicherung erst verlaesslich macht - eine Pruefung, ein Manifest, ein
# Restore-Test, eine Aufbewahrung, die nicht loescht, wenn nichts Gutes
# uebrigbleibt.
#
# Das steht jetzt in `deploy/backup/`. Dieses Skript bleibt als Weiterleitung,
# damit ein bestehender Cron-Eintrag auf `deploy/backup.sh` nicht ins Leere
# faellt.
#
# ## Umstellen
#
#   sudo crontab -l | grep -v swisshub-backup | sudo crontab -   # alten Eintrag weg
#   sudo cp /opt/swisshub/deploy/backup/systemd/* /etc/systemd/system/
#   sudo systemctl daemon-reload
#   sudo systemctl enable --now swisshub-backup.timer
#
# Die Sicherungen des alten Skripts - `swisshub_<datum>.sql.gz` und `uploads/`
# direkt im Backup-Verzeichnis - bleiben, wo sie sind. Die neue Aufbewahrung
# sieht nur in `sicherungen/` nach und ruehrt sie nicht an. Wer sie nicht mehr
# braucht, entfernt sie selbst; automatisch geloescht wird hier nichts, was
# jemand anders angelegt hat.

set -euo pipefail

VERZEICHNIS="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
NEU="${VERZEICHNIS}/backup/bin/swisshub-backup"

if [[ ! -x "${NEU}" ]]; then
  printf 'FEHLER: %s fehlt oder ist nicht ausfuehrbar.\n' "${NEU}" >&2
  exit 1
fi

printf 'Hinweis: deploy/backup.sh ist eine Weiterleitung auf deploy/backup/bin/swisshub-backup.\n' >&2
printf '         Umstellung auf den systemd-Timer: deploy/backup/README.md\n\n' >&2

exec "${NEU}" "$@"
