"""Suche und Aufloesung.

Uebernommen aus dem Legacy-Bot, weil es dort nachweislich funktioniert:
ytmusicapi liefert die schnelle Suche, yt-dlp folgt den YouTube-Aenderungen.
Die Optionen sind bewusst identisch zum Original - `noplaylist`, kurze
Timeouts, wenige Wiederholungen.
"""

from __future__ import annotations

import asyncio
import re
from typing import Any
from urllib.parse import urlparse

import yt_dlp
from ytmusicapi import YTMusic

YTDLP_OPTS = {
    "format": "bestaudio/best",
    "quiet": True,
    "no_warnings": True,
    "default_search": "ytsearch",
    "source_address": "0.0.0.0",
    "socket_timeout": 10,
    "noplaylist": True,
    "extractor_retries": 2,
}

FFMPEG_OPTS = {
    "before_options": "-reconnect 1 -reconnect_streamed 1 -reconnect_delay_max 5",
    "options": "-vn",
}

# Nur diese Hosts. Dieselbe Liste wie in der WebApp - der Schutz gegen
# SSRF darf nicht davon abhaengen, welche Seite gerade prueft.
ERLAUBTE_HOSTS = {
    "youtube.com",
    "www.youtube.com",
    "m.youtube.com",
    "music.youtube.com",
    "youtu.be",
    "www.youtu.be",
}

_ytdl = yt_dlp.YoutubeDL(YTDLP_OPTS)
_ytmusic = YTMusic()


def ist_erlaubte_url(url: str) -> bool:
    try:
        zerlegt = urlparse(url)
    except ValueError:
        return False
    if zerlegt.scheme != "https":
        return False
    return (zerlegt.hostname or "").lower() in ERLAUBTE_HOSTS


def _dauer(text: str | None) -> int:
    """'3:45' -> 225. Wie im Legacy-Bot."""
    if not text:
        return 0
    try:
        teile = [int(t) for t in text.split(":")]
    except ValueError:
        return 0
    if len(teile) == 3:
        return teile[0] * 3600 + teile[1] * 60 + teile[2]
    if len(teile) == 2:
        return teile[0] * 60 + teile[1]
    return teile[0] if teile else 0


async def suche(query: str, limit: int) -> list[dict[str, Any]]:
    """YouTube-Music-Suche. Laeuft im Threadpool - ytmusicapi ist synchron."""
    schleife = asyncio.get_running_loop()
    treffer = await asyncio.wait_for(
        schleife.run_in_executor(
            None, lambda: _ytmusic.search(query, filter="songs", limit=limit)
        ),
        timeout=8,
    )

    ergebnis: list[dict[str, Any]] = []
    for eintrag in treffer or []:
        video_id = eintrag.get("videoId")
        if not video_id:
            continue
        kuenstler = ", ".join(
            a.get("name", "") for a in eintrag.get("artists", []) if a.get("name")
        )
        bilder = eintrag.get("thumbnails") or []
        ergebnis.append(
            {
                "providerTrackId": video_id,
                "title": eintrag.get("title", "Unbekannt"),
                "artist": kuenstler or None,
                "webpageUrl": f"https://www.youtube.com/watch?v={video_id}",
                "durationSeconds": _dauer(eintrag.get("duration")),
                "thumbnailUrl": bilder[-1].get("url") if bilder else None,
            }
        )
    return ergebnis


async def aufloesen(url: str) -> list[dict[str, Any]]:
    """Eine konkrete Adresse zu genau einem Titel aufloesen."""
    if not ist_erlaubte_url(url):
        raise ValueError("Nicht unterstuetzte Adresse.")

    schleife = asyncio.get_running_loop()
    info = await asyncio.wait_for(
        schleife.run_in_executor(None, lambda: _ytdl.extract_info(url, download=False)),
        timeout=12,
    )
    if isinstance(info, dict) and info.get("entries"):
        info = info["entries"][0]
    if not isinstance(info, dict):
        return []

    seite = info.get("webpage_url") or url
    bilder = info.get("thumbnails") or []
    return [
        {
            "providerTrackId": info.get("id") or seite,
            "title": info.get("title", "Unbekannt"),
            "artist": info.get("uploader") or info.get("artist"),
            "webpageUrl": seite,
            "durationSeconds": int(info.get("duration") or 0),
            "thumbnailUrl": bilder[-1].get("url") if bilder else None,
        }
    ]


async def stream_url(webpage_url: str) -> str:
    """Eine frische Stream-Adresse holen.

    Das ist der Grund, warum die Warteschlange die Seiten-URL speichert und
    nicht die Stream-URL: YouTube-Signaturen laufen ab. Der Legacy-Bot holte
    sie unmittelbar vor dem Abspielen neu - dieses Verhalten bleibt, sonst
    bricht ein lange wartender Titel beim Start ab.
    """
    if not ist_erlaubte_url(webpage_url):
        raise ValueError("Nicht unterstuetzte Adresse.")

    schleife = asyncio.get_running_loop()
    info = await asyncio.wait_for(
        schleife.run_in_executor(
            None, lambda: _ytdl.extract_info(webpage_url, download=False)
        ),
        timeout=15,
    )
    if isinstance(info, dict) and info.get("entries"):
        info = info["entries"][0]
    adresse = (info or {}).get("url")
    if not adresse:
        raise RuntimeError("Keine abspielbare Adresse erhalten.")
    return str(adresse)
