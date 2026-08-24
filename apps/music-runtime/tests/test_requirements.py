"""Regeln fuer die Abhaengigkeiten der Voice-Laufzeit.

Zwei Fehler aus dem Betrieb stehen dahinter: eine erfundene yt-dlp-Fassung,
die den Abbildbau abbrechen liess, und eine zu alte discord.py-Fassung, deren
Voice-Handschlag von Discord abgewiesen wurde.

Der Test braucht kein Netz - er prueft die Regeln, nicht die Verfuegbarkeit.
Ob eine Fassung existiert, zeigt der Probelauf `pip install --dry-run`.
"""

from __future__ import annotations

import os
import re

DATEI = os.path.join(os.path.dirname(__file__), "..", "requirements.txt")


def _zeilen() -> list[str]:
    with open(DATEI, encoding="utf-8") as datei:
        return [
            zeile.strip()
            for zeile in datei
            if zeile.strip() and not zeile.strip().startswith("#")
        ]


def _fassung(name: str) -> tuple[str, str] | None:
    """(Operator, Fassung) der genannten Abhaengigkeit."""
    for zeile in _zeilen():
        treffer = re.match(rf"^{re.escape(name)}(\[[a-z,]+\])?\s*(==|>=)\s*(\S+)$", zeile)
        if treffer:
            return treffer.group(2), treffer.group(3)
    return None


def test_discord_py_kann_aktuelle_voice_verschluesselung() -> None:
    """Unter 2.7 lehnt Discord den Voice-Handschlag ab (Schliesscode 4017)."""
    eintrag = _fassung("discord.py")
    assert eintrag is not None, "discord.py fehlt in requirements.txt"
    operator, fassung = eintrag
    assert operator == "==", "discord.py gehoert fest gepinnt"
    haupt, neben = (int(teil) for teil in fassung.split(".")[:2])
    assert (haupt, neben) >= (2, 7), (
        f"discord.py {fassung} bietet Discord nur die entfernten "
        "xsalsa20_poly1305-Verschluesselungen an - der Bot betritt keinen Kanal."
    )


def test_discord_py_bringt_das_voice_extra_mit() -> None:
    """Ohne das Extra fehlt PyNaCl und die Wiedergabe startet gar nicht."""
    assert any(
        zeile.startswith("discord.py[") and "voice" in zeile for zeile in _zeilen()
    ), "discord.py braucht das voice-Extra"


def test_youtube_bibliotheken_sind_nicht_festgenagelt() -> None:
    """YouTube aendert sich; eine feste Fassung liesse die Musik verrotten.

    Die Behebung ist praktisch immer eine neuere yt-dlp-Fassung. Mit einer
    Untergrenze genuegt dafuer ein Neubau des Abbilds statt einer
    Codeaenderung.
    """
    for name in ("yt-dlp", "ytmusicapi"):
        eintrag = _fassung(name)
        assert eintrag is not None, f"{name} fehlt in requirements.txt"
        assert eintrag[0] == ">=", (
            f"{name} ist fest gepinnt - damit bricht die Wiedergabe, sobald "
            "YouTube etwas aendert, und niemand kann es ohne Codeaenderung beheben."
        )


def test_keine_doppelte_pynacl_vorgabe() -> None:
    """Eine eigene PyNaCl-Zeile kollidiert frueher oder spaeter mit discord.py."""
    assert not any(
        zeile.lower().startswith("pynacl") for zeile in _zeilen()
    ), "PyNaCl kommt ueber discord.py[voice] - eine eigene Zeile fuehrt zu Konflikten"


def test_infrastruktur_ist_fest_gepinnt() -> None:
    """Bei Datenbank und HTTP-Schicht ist Vorhersagbarkeit wichtiger."""
    for name in ("asyncpg", "aiohttp"):
        eintrag = _fassung(name)
        assert eintrag is not None, f"{name} fehlt in requirements.txt"
        assert eintrag[0] == "==", f"{name} gehoert fest gepinnt"
