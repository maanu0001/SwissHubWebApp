#!/usr/bin/env python3
"""Das Rechenwerk der SwissHub-Sicherung.

## Warum Python und nicht Bash

Vier Aufgaben dieser Sicherung sind in einer Shell nur mit Zaehneknirschen zu
loesen, und jede davon ist eine, bei der ein Fehler still bleibt:

1. **JSON schreiben.** Ein Manifest, das die WebApp liest, muss korrekt
   maskiert sein. Ein Dateiname mit einem Anfuehrungszeichen wuerde von
   `printf` erzeugtes JSON zerlegen - und die Uebersicht zeigte danach
   "kein Backup vorhanden", obwohl eines daliegt.
2. **Pruefsummen.** `sha256sum` kann das, aber nicht in einem Durchgang
   zusammen mit Groessen und JSON.
3. **Einen gzip-Datenbankexport von innen ansehen.** Genau das unterscheidet
   "die Datei ist unbeschaedigt" von "die Datei ist ein vollstaendiger Dump".
4. **Aufbewahrung ausrechnen.** Datumsarithmetik mit ISO-Wochen in Bash ist
   eine Folge von `date`-Aufrufen, die auf zwei Systemen zwei Ergebnisse
   liefern.

Nur die Standardbibliothek. Kein pip, keine virtuelle Umgebung, kein
zusaetzliches Paket auf dem Server.

## Die Arbeitsteilung

Dieses Programm **entscheidet und prueft**, es **loescht nie**. Welche
Sicherungen wegkoennen, sagt `aufbewahrung` - entfernt werden sie von
`swisshub-backup`, das jeden Pfad noch einmal gegen das Backup-Verzeichnis
prueft. Ein Rechenfehler hier kann damit keine Datei kosten.
"""

from __future__ import annotations

import gzip
import hashlib
import json
import os
import re
import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path

# Die Kennung einer Sicherung. Sortierbar, dateinamentauglich, UTC.
KENNUNG = re.compile(r"^\d{4}-\d{2}-\d{2}T\d{6}Z$")

# Dateien, die nicht in ihre eigene Pruefsumme eingehen koennen.
OHNE_PRUEFSUMME = {"manifest.json", "pruefsummen.sha256"}

# Die letzte Zeile, die `pg_dump` schreibt.
#
# Der beste Vollstaendigkeitsbeweis, den ein Dump ueber sich selbst abgibt:
# pg_dump schreibt sie erst, wenn alles andere draussen ist. Ein Export, der
# mitten im Lauf abgebrochen ist - Platte voll, Verbindung weg, Prozess
# getoetet -, hat gueltiges gzip und plausible Groesse, aber diese Zeile nicht.
ABSCHLUSS_MARKE = "-- PostgreSQL database dump complete"

# Woran die Serverversion im Dump steht: «-- Dumped from database version 16.13».
VERSION_MUSTER = re.compile(r"^-- Dumped from database version (.+)$")


def fehler(text: str) -> None:
    sys.stderr.write(f"{text}\n")
    raise SystemExit(1)


def sha256_der_datei(pfad: Path) -> str:
    """Pruefsumme haeppchenweise - ein Dump passt nicht in den Arbeitsspeicher."""
    streu = hashlib.sha256()
    with pfad.open("rb") as strom:
        for stueck in iter(lambda: strom.read(1024 * 1024), b""):
            streu.update(stueck)
    return streu.hexdigest()


def dateien_der_sicherung(verzeichnis: Path) -> list[Path]:
    """Die Nutzdateien einer Sicherung.

    Ohne das Manifest und seine Seitendatei - die koennen ihre eigene
    Pruefsumme nicht enthalten -, und ohne Dateien, deren Name mit einem Punkt
    beginnt: das sind Arbeitsdateien (`.angaben`, `.manifest.json.neu`), die
    den Lauf nicht ueberleben. Eine davon im Manifest waere ein Eintrag, der
    beim naechsten Pruefen als "fehlt" auffaellt - genau das ist beim ersten
    Probelauf passiert.
    """
    return sorted(
        eintrag
        for eintrag in verzeichnis.iterdir()
        if eintrag.is_file()
        and eintrag.name not in OHNE_PRUEFSUMME
        and not eintrag.name.startswith(".")
    )


# --- Datenbankexport pruefen -------------------------------------------------


def pruefe_datenbankexport(pfad: Path) -> dict[str, object]:
    """Ist das ein vollstaendiger PostgreSQL-Export?

    Beantwortet drei Fragen, und die dritte ist die, auf die es ankommt:

    - Ist das gzip lesbar bis zum Ende? (Eine abgeschnittene Datei wirft hier.)
    - Enthaelt es ueberhaupt Tabellen?
    - Steht die Abschlussmarke von `pg_dump` darin?

    Was diese Pruefung **nicht** beantwortet: ob sich der Export
    wiedereinspielen laesst. Das beantwortet nur ein Restore-Test, und deshalb
    ist er ein eigener Zustand.
    """
    tabellen = 0
    abgeschlossen = False
    version: str | None = None
    zeilen = 0
    try:
        with gzip.open(pfad, "rt", encoding="utf-8", errors="replace") as strom:
            for zeile in strom:
                zeilen += 1
                if zeile.startswith("CREATE TABLE "):
                    tabellen += 1
                elif zeile.startswith(ABSCHLUSS_MARKE):
                    abgeschlossen = True
                elif version is None:
                    treffer = VERSION_MUSTER.match(zeile.rstrip("\n"))
                    if treffer:
                        version = treffer.group(1)
    except Exception as ursache:  # noqa: BLE001 - siehe unten
        """Jede Ausnahme ist hier eine Beanstandung, keine Ausnahme.

        Absichtlich breit gefangen. Beim ersten Lauf des Integrationstests war
        es `zlib.error` - ein einzelnes gekipptes Byte im Rumpf des gzip, nicht
        im Kopf, wirft das und nicht `BadGzipFile`. Das Programm brach mit einem
        Traceback ab, **bevor** es die schon gesammelten Beanstandungen
        ausgeben konnte: `swisshub-backup-verify` meldete zwar korrekt einen
        Fehlschlag, aber ohne Meldung im Manifest - im Dashboard stand
        «gescheitert» ohne ein Wort dazu.

        Ein Pruefprogramm, das abstuerzt, sagt nichts. Es soll stattdessen
        sagen, was es nicht lesen konnte - und zwar mit dem Namen der Ausnahme,
        damit die naechste unbekannte Sorte gleich benannt ist.
        """
        return {
            "lesbar": False,
            "grund": f"gzip nicht lesbar: {type(ursache).__name__}: {ursache}",
            "tabellen": 0,
            "abgeschlossen": False,
            "serverVersion": None,
        }

    return {
        "lesbar": True,
        "grund": None,
        "zeilen": zeilen,
        "tabellen": tabellen,
        "abgeschlossen": abgeschlossen,
        "serverVersion": version,
    }


def pruefe_dateiarchiv(pfad: Path) -> dict[str, object]:
    """Ist das Dateiarchiv lesbar, und wie viele Eintraege hat es?

    `tarfile` liest das Archiv wirklich durch - ein abgeschnittenes tar.gz
    faellt hier auf, nicht erst bei der Wiederherstellung.
    """
    import tarfile

    try:
        with tarfile.open(pfad, "r:gz") as archiv:
            eintraege = sum(1 for mitglied in archiv if mitglied.isfile())
    except Exception as ursache:  # noqa: BLE001 - wie oben: eine Beanstandung
        return {
            "lesbar": False,
            "grund": f"tar nicht lesbar: {type(ursache).__name__}: {ursache}",
            "dateien": 0,
        }
    return {"lesbar": True, "grund": None, "dateien": eintraege}


# --- Manifest schreiben ------------------------------------------------------


def lies_angaben(pfad: Path) -> dict[str, str]:
    """Die Angaben des Backup-Skripts, eine je Zeile als `schluessel=wert`.

    Bewusst kein `source`: ein Wert aus dieser Datei wird nie von einer Shell
    ausgewertet, und damit kann auch ein Dateiname mit Sonderzeichen nichts
    ausloesen.
    """
    angaben: dict[str, str] = {}
    for zeile in pfad.read_text(encoding="utf-8").splitlines():
        if not zeile.strip() or zeile.lstrip().startswith("#"):
            continue
        schluessel, trenner, wert = zeile.partition("=")
        if not trenner:
            continue
        angaben[schluessel.strip()] = wert.strip()
    return angaben


def befehl_schreibe(argumente: list[str]) -> None:
    if len(argumente) != 2:
        fehler("schreibe <verzeichnis> <angaben-datei>")
    verzeichnis = Path(argumente[0])
    angaben = lies_angaben(Path(argumente[1]))

    kennung = angaben.get("id", "")
    if not KENNUNG.match(kennung):
        fehler(f"Keine gueltige Backup-Kennung: {kennung!r}")

    dateien: list[dict[str, object]] = []
    pruefzeilen: list[str] = []
    for pfad in dateien_der_sicherung(verzeichnis):
        summe = sha256_der_datei(pfad)
        dateien.append(
            {
                "name": pfad.name,
                "bytes": pfad.stat().st_size,
                "sha256": summe,
            }
        )
        # Genau das Format, das `sha256sum -c` erwartet: Summe, zwei
        # Leerzeichen, Name. Damit laesst sich eine Sicherung auch ohne dieses
        # Programm pruefen - nur mit coreutils.
        pruefzeilen.append(f"{summe}  {pfad.name}")

    manifest: dict[str, object] = {
        # Die Fassung des Manifestformats. Ein Leser, der sie nicht kennt,
        # soll nichts raten, sondern die Sicherung als unlesbar melden.
        "version": 1,
        "id": kennung,
        "erstelltAm": angaben.get("erstelltAm", ""),
        "typ": angaben.get("typ", "vollstaendig"),
        "status": angaben.get("status", "abgeschlossen"),
        "host": angaben.get("host", ""),
        "komponenten": [
            teil for teil in angaben.get("komponenten", "").split(",") if teil
        ],
        "dateien": dateien,
        "bytesGesamt": sum(int(eintrag["bytes"]) for eintrag in dateien),
        "postgresVersion": angaben.get("postgresVersion") or None,
        "gitCommit": angaben.get("gitCommit") or None,
        "datenbank": angaben.get("datenbank") or None,
        "uploadVerzeichnis": angaben.get("uploadVerzeichnis") or None,
        # Fingerabdruck des Hauptschluessels - nie der Schluessel selbst.
        # Er beantwortet nach einer Wiederherstellung genau eine Frage: ist
        # die Offline-Kopie, die ich hier habe, dieselbe, mit der diese
        # Sicherung verschluesselt war?
        "schluesselFingerabdruck": angaben.get("schluesselFingerabdruck") or None,
        "geheimnisse": angaben.get("geheimnisse", "nicht gesichert"),
        # Die Zustaende bleiben getrennt (siehe README): erstellt zu sein
        # heisst nicht geprueft, und geprueft heisst nicht wiederherstellbar.
        "integritaet": {"status": "ungeprueft", "am": None, "meldung": None},
        "restoreTest": {"status": "ungeprueft", "am": None, "meldung": None},
    }

    # Das Manifest zuletzt - solange es fehlt, gilt die Sicherung als
    # unvollstaendig. Das ist die eine Datei, an der jeder Leser erkennt, dass
    # hier nichts mehr nachkommt.
    (verzeichnis / "pruefsummen.sha256").write_text(
        "".join(f"{zeile}\n" for zeile in pruefzeilen), encoding="utf-8"
    )
    schreibe_json(verzeichnis / "manifest.json", manifest)
    sys.stdout.write(f"{manifest['bytesGesamt']}\n")


def schreibe_json(pfad: Path, inhalt: object) -> None:
    """JSON atomar schreiben.

    Erst daneben, dann darueber: ein Absturz mitten im Schreiben hinterlaesst
    sonst ein halbes Manifest, und das ist schlimmer als keines - es sieht
    gueltig aus, bis jemand es liest.
    """
    vorlaeufig = pfad.with_name(f".{pfad.name}.neu")
    vorlaeufig.write_text(
        json.dumps(inhalt, indent=2, ensure_ascii=False, sort_keys=False) + "\n",
        encoding="utf-8",
    )
    os.replace(vorlaeufig, pfad)


def lies_manifest(verzeichnis: Path) -> dict[str, object]:
    pfad = verzeichnis / "manifest.json"
    if not pfad.is_file():
        fehler(f"Kein Manifest in {verzeichnis}")
    try:
        inhalt = json.loads(pfad.read_text(encoding="utf-8"))
    except json.JSONDecodeError as ursache:
        fehler(f"Manifest ist kein gueltiges JSON: {ursache}")
    if not isinstance(inhalt, dict) or inhalt.get("version") != 1:
        fehler("Manifest hat eine unbekannte Fassung.")
    return inhalt


# --- Manifest pruefen --------------------------------------------------------


def befehl_pruefe(argumente: list[str]) -> None:
    """Die Integritaetspruefung einer Sicherung.

    Sie beantwortet: liegt alles da, was das Manifest nennt, ist es
    unveraendert, und sind die Archive von innen lesbar. Sie beantwortet
    **nicht**, ob sich daraus eine Datenbank aufbauen laesst.
    """
    if len(argumente) != 1:
        fehler("pruefe <verzeichnis>")
    verzeichnis = Path(argumente[0])
    manifest = lies_manifest(verzeichnis)

    beanstandungen: list[str] = []
    genannt = {
        str(eintrag["name"]): eintrag
        for eintrag in manifest.get("dateien", [])  # type: ignore[union-attr]
        if isinstance(eintrag, dict)
    }

    if not genannt:
        beanstandungen.append("Das Manifest nennt keine einzige Datei.")

    for name, eintrag in sorted(genannt.items()):
        pfad = verzeichnis / name
        if not pfad.is_file():
            beanstandungen.append(f"{name}: fehlt")
            continue
        groesse = pfad.stat().st_size
        if groesse != eintrag.get("bytes"):
            beanstandungen.append(
                f"{name}: {groesse} Bytes, das Manifest nennt {eintrag.get('bytes')}"
            )
            continue
        if groesse == 0:
            beanstandungen.append(f"{name}: leer")
            continue
        if sha256_der_datei(pfad) != eintrag.get("sha256"):
            beanstandungen.append(f"{name}: Pruefsumme weicht ab")

    # Liegt noch etwas da, das das Manifest nicht kennt? Kein Fehler, aber
    # es gehoert gesagt - so faellt eine halb aufgeraeumte Sicherung auf.
    zusaetzlich = [
        pfad.name for pfad in dateien_der_sicherung(verzeichnis) if pfad.name not in genannt
    ]

    # Die Seitendatei gegen das Manifest halten. Sie wurde im gleichen Durchgang
    # geschrieben - weichen sie voneinander ab, hat jemand an einer der beiden
    # gedreht.
    seitendatei = verzeichnis / "pruefsummen.sha256"
    if not seitendatei.is_file():
        beanstandungen.append("pruefsummen.sha256 fehlt")
    else:
        aus_seitendatei: dict[str, str] = {}
        for zeile in seitendatei.read_text(encoding="utf-8").splitlines():
            summe, _, name = zeile.partition("  ")
            if name:
                aus_seitendatei[name.strip()] = summe.strip()
        for name, eintrag in genannt.items():
            if aus_seitendatei.get(name) != eintrag.get("sha256"):
                beanstandungen.append(f"{name}: pruefsummen.sha256 weicht vom Manifest ab")

    # Die Archive von innen.
    befunde: dict[str, object] = {}
    export = verzeichnis / "datenbank.sql.gz"
    if "datenbank" in manifest.get("komponenten", []):  # type: ignore[operator]
        if not export.is_file():
            beanstandungen.append("datenbank.sql.gz fehlt, obwohl das Manifest sie nennt")
        else:
            befund = pruefe_datenbankexport(export)
            befunde["datenbank"] = befund
            if not befund["lesbar"]:
                beanstandungen.append(f"datenbank.sql.gz: {befund['grund']}")
            elif not befund["abgeschlossen"]:
                beanstandungen.append(
                    "datenbank.sql.gz: die Abschlussmarke von pg_dump fehlt - "
                    "der Export ist abgebrochen"
                )
            elif int(befund["tabellen"]) == 0:  # type: ignore[arg-type]
                beanstandungen.append("datenbank.sql.gz: enthaelt keine einzige Tabelle")

    archiv = verzeichnis / "dateien.tar.gz"
    if "dateien" in manifest.get("komponenten", []) and archiv.is_file():  # type: ignore[operator]
        befund = pruefe_dateiarchiv(archiv)
        befunde["dateien"] = befund
        if not befund["lesbar"]:
            beanstandungen.append(f"dateien.tar.gz: {befund['grund']}")

    for zeile in beanstandungen:
        sys.stdout.write(f"FEHLER {zeile}\n")
    for name in zusaetzlich:
        sys.stdout.write(f"HINWEIS {name}: liegt da, steht aber nicht im Manifest\n")
    # Die Zusammenfassung nur fuer das, was wirklich lesbar war. Eine Zeile mit
    # «OK datenbank.sql.gz: 0 Tabellen» unter einer Fehlermeldung ueber dieselbe
    # Datei ist der Satz, der um drei Uhr nachts in die falsche Richtung fuehrt.
    befund_db = befunde.get("datenbank")
    if isinstance(befund_db, dict) and befund_db.get("lesbar"):
        sys.stdout.write(
            f"OK datenbank.sql.gz: {befund_db['tabellen']} Tabellen, "
            f"PostgreSQL {befund_db['serverVersion']}\n"
        )
    befund_dateien = befunde.get("dateien")
    if isinstance(befund_dateien, dict) and befund_dateien.get("lesbar"):
        sys.stdout.write(f"OK dateien.tar.gz: {befund_dateien['dateien']} Dateien\n")

    raise SystemExit(1 if beanstandungen else 0)


def befehl_vermerke(argumente: list[str]) -> None:
    """Ein Pruefergebnis im Manifest vermerken.

    `vermerke <verzeichnis> integritaet|restoreTest <status> [meldung]`

    Die drei Zustaende bleiben getrennt - eine Sicherung, die geprueft ist,
    behauptet damit nicht, wiederherstellbar zu sein.
    """
    if len(argumente) < 3:
        fehler("vermerke <verzeichnis> <feld> <status> [meldung]")
    verzeichnis = Path(argumente[0])
    feld = argumente[1]
    if feld not in ("integritaet", "restoreTest"):
        fehler(f"Unbekanntes Feld: {feld}")
    status = argumente[2]
    if status not in ("ungeprueft", "bestanden", "gescheitert"):
        fehler(f"Unbekannter Status: {status}")

    manifest = lies_manifest(verzeichnis)
    manifest[feld] = {
        "status": status,
        "am": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "meldung": " ".join(argumente[3:]) or None,
    }
    schreibe_json(verzeichnis / "manifest.json", manifest)


# --- Aufbewahrung ------------------------------------------------------------


def kennung_zu_datum(kennung: str) -> datetime:
    return datetime.strptime(kennung, "%Y-%m-%dT%H%M%SZ").replace(tzinfo=timezone.utc)


def befehl_aufbewahrung(argumente: list[str]) -> None:
    """Welche Sicherungen wegkoennen - eine Kennung je Zeile.

    ## Die Regel

    Behalten wird, was **mindestens eine** der drei Regeln behaelt: die
    letzten N taeglichen, je die neueste Sicherung der letzten N ISO-Wochen,
    je die neueste der letzten N Monate. Eine Sicherung, die zwei Regeln
    erfuellt, zaehlt nicht doppelt - sie wird einmal behalten.

    ## Was hier nicht passiert

    Geloescht wird nicht. Dieses Programm nennt Kennungen; die Entscheidung,
    ob ueberhaupt geloescht werden darf, faellt im Backup-Skript und haengt
    daran, dass eine geprueft gueltige Sicherung uebrigbleibt.
    """
    if len(argumente) < 1:
        fehler("aufbewahrung <sicherungen-verzeichnis> [taeglich] [wochen] [monate]")
    wurzel = Path(argumente[0])
    taeglich = int(argumente[1]) if len(argumente) > 1 else 7
    wochen = int(argumente[2]) if len(argumente) > 2 else 4
    monate = int(argumente[3]) if len(argumente) > 3 else 3

    vorhanden = sorted(
        eintrag.name
        for eintrag in wurzel.iterdir()
        if eintrag.is_dir() and KENNUNG.match(eintrag.name) and (eintrag / "manifest.json").is_file()
    )
    if not vorhanden:
        return

    # Absteigend: die neuesten zuerst, denn alle drei Regeln fragen nach
    # "der neuesten in diesem Zeitraum".
    absteigend = list(reversed(vorhanden))
    behalten: set[str] = set(absteigend[:taeglich])

    def neueste_je_gruppe(schluessel, grenze: int) -> None:
        gesehen: dict[str, str] = {}
        for kennung in absteigend:
            gruppe = schluessel(kennung_zu_datum(kennung))
            if gruppe not in gesehen:
                gesehen[gruppe] = kennung
            if len(gesehen) >= grenze:
                break
        behalten.update(gesehen.values())

    # ISO-Woche, damit eine Woche ueber den Monatswechsel hinweg eine bleibt.
    neueste_je_gruppe(lambda datum: "%04d-W%02d" % datum.isocalendar()[:2], wochen)
    neueste_je_gruppe(lambda datum: datum.strftime("%Y-%m"), monate)

    for kennung in vorhanden:
        if kennung not in behalten:
            sys.stdout.write(f"{kennung}\n")


# --- Zustand fuer die WebApp -------------------------------------------------


def befehl_zustand(argumente: list[str]) -> None:
    """Den Zustand fuer die WebApp fortschreiben.

    `zustand <status-verzeichnis> <schluessel=wert> ...`

    Die WebApp liest ausschliesslich dieses Verzeichnis - niemals das
    Backup-Verzeichnis selbst. Damit kann sie strukturell keinen Dump und kein
    Geheimnis ausliefern, auch nicht bei einem Fehler in einer Route.
    """
    if len(argumente) < 1:
        fehler("zustand <status-verzeichnis> [schluessel=wert ...]")
    verzeichnis = Path(argumente[0])
    verzeichnis.mkdir(parents=True, exist_ok=True)
    pfad = verzeichnis / "zustand.json"

    zustand: dict[str, object] = {"version": 1}
    if pfad.is_file():
        try:
            vorher = json.loads(pfad.read_text(encoding="utf-8"))
            if isinstance(vorher, dict):
                zustand = vorher
                zustand["version"] = 1
        except json.JSONDecodeError:
            # Eine kaputte Zustandsdatei ist kein Grund, den Lauf zu
            # beenden - sie wird neu aufgebaut. Die Sicherungen selbst
            # haengen nicht an ihr.
            pass

    for eintrag in argumente[1:]:
        schluessel, trenner, wert = eintrag.partition("=")
        if not trenner:
            continue
        zustand[schluessel] = None if wert == "" else wert

    schreibe_json(pfad, zustand)
    try:
        pfad.chmod(0o644)
    except OSError:
        pass


def befehl_spiegle(argumente: list[str]) -> None:
    """Die Manifeste in das Statusverzeichnis spiegeln.

    Kopiert wird nur das Manifest, nie eine Nutzdatei. Und es wird
    aufgeraeumt: ein Manifest zu einer Sicherung, die die Aufbewahrung
    entfernt hat, wuerde im Dashboard sonst ewig weiterstehen.
    """
    if len(argumente) != 2:
        fehler("spiegle <sicherungen-verzeichnis> <status-verzeichnis>")
    quelle = Path(argumente[0])
    ziel = Path(argumente[1]) / "sicherungen"
    ziel.mkdir(parents=True, exist_ok=True)

    aktuell: set[str] = set()
    gesamt = 0
    for eintrag in sorted(quelle.iterdir()) if quelle.is_dir() else []:
        if not (eintrag.is_dir() and KENNUNG.match(eintrag.name)):
            continue
        manifest = eintrag / "manifest.json"
        if not manifest.is_file():
            continue
        aktuell.add(f"{eintrag.name}.json")
        kopie = ziel / f"{eintrag.name}.json"
        kopie.write_text(manifest.read_text(encoding="utf-8"), encoding="utf-8")
        kopie.chmod(0o644)
        gesamt += sum(datei.stat().st_size for datei in eintrag.iterdir() if datei.is_file())

    for eintrag in ziel.iterdir():
        if eintrag.is_file() and eintrag.name.endswith(".json") and eintrag.name not in aktuell:
            eintrag.unlink()

    try:
        ziel.chmod(0o755)
        Path(argumente[1]).chmod(0o755)
    except OSError:
        pass
    sys.stdout.write(f"{len(aktuell)} {gesamt}\n")


# --- Fingerabdruck -----------------------------------------------------------


def befehl_fingerabdruck(argumente: list[str]) -> None:
    """Der Fingerabdruck einer Variable aus einer Env-Datei.

    Gibt zwoelf Hexzeichen aus, nie den Wert. Der Wert wird aus einem
    32-Byte-Zufall gebildet; ein SHA-256 davon laesst sich nicht zuruecklesen,
    beantwortet aber die einzige Frage, die im Ernstfall zaehlt: habe ich den
    richtigen Schluessel?
    """
    if len(argumente) != 2:
        fehler("fingerabdruck <env-datei> <variable>")
    pfad = Path(argumente[0])
    name = argumente[1]
    if not pfad.is_file():
        return
    for zeile in pfad.read_text(encoding="utf-8", errors="replace").splitlines():
        if not zeile.startswith(f"{name}="):
            continue
        wert = zeile[len(name) + 1 :].strip().strip("'\"")
        if not wert:
            return
        sys.stdout.write(hashlib.sha256(wert.encode("utf-8")).hexdigest()[:12] + "\n")
        return


def befehl_variablennamen(argumente: list[str]) -> None:
    """Die Namen der Variablen einer Env-Datei - ohne einen einzigen Wert.

    Das ist, was von der Konfiguration in eine Sicherung gehoert: eine Liste,
    an der nach einem Totalverlust ablesbar ist, **was** wieder beschafft
    werden muss. Die Werte selbst haetten neben dem verschluesselten
    Datenbankexport nichts verloren - wer die Sicherung hat, haette damit
    beides.
    """
    if len(argumente) != 1:
        fehler("variablennamen <env-datei>")
    pfad = Path(argumente[0])
    if not pfad.is_file():
        return
    namen = []
    for zeile in pfad.read_text(encoding="utf-8", errors="replace").splitlines():
        blank = zeile.strip()
        if not blank or blank.startswith("#") or "=" not in blank:
            continue
        namen.append(blank.split("=", 1)[0].strip())
    for name in sorted(set(namen)):
        sys.stdout.write(f"{name}\n")


# --- Was ein Restore ergeben muss --------------------------------------------


def befehl_erwartung(argumente: list[str]) -> None:
    """Was nach dem Einspielen dieses Exports in der Datenbank stehen muss.

    Gibt zwei Zahlen aus: `tabellen` und `zeilen`.

    ## Warum das den Restore-Test erst zu einem macht

    Ein Restore, der das Schema aufbaut und die Daten verliert, laeuft ohne
    Fehler durch: `psql` meldet Erfolg, die Tabellen sind da, sie sind leer.
    Ohne eine Erwartung waere das ein bestandener Test.

    Gezaehlt wird, was `pg_dump` im Textformat schreibt: `CREATE TABLE` fuer
    die Struktur, und die Datenzeilen innerhalb der `COPY ... FROM stdin;`
    -Bloecke bis zur abschliessenden Zeile mit nur `\.`.
    """
    if len(argumente) != 1:
        fehler("erwartung <dump.sql.gz>")
    pfad = Path(argumente[0])
    tabellen = 0
    zeilen = 0
    im_copy = False
    with gzip.open(pfad, "rt", encoding="utf-8", errors="replace") as strom:
        for zeile in strom:
            if im_copy:
                if zeile.startswith("\\."):
                    im_copy = False
                else:
                    zeilen += 1
                continue
            if zeile.startswith("CREATE TABLE "):
                tabellen += 1
            elif zeile.startswith("COPY ") and zeile.rstrip().endswith("FROM stdin;"):
                im_copy = True
    sys.stdout.write(f"tabellen={tabellen}\nzeilen={zeilen}\n")


BEFEHLE = {
    "schreibe": befehl_schreibe,
    "pruefe": befehl_pruefe,
    "erwartung": befehl_erwartung,
    "vermerke": befehl_vermerke,
    "aufbewahrung": befehl_aufbewahrung,
    "zustand": befehl_zustand,
    "spiegle": befehl_spiegle,
    "fingerabdruck": befehl_fingerabdruck,
    "variablennamen": befehl_variablennamen,
}


def main() -> None:
    if len(sys.argv) < 2 or sys.argv[1] not in BEFEHLE:
        fehler(f"Bekannte Befehle: {', '.join(sorted(BEFEHLE))}")
    BEFEHLE[sys.argv[1]](sys.argv[2:])


if __name__ == "__main__":
    main()
