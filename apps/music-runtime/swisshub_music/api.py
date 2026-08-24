"""Interne Schnittstelle fuer Suche und Aufloesung.

Ausschliesslich im Docker-Netz erreichbar - nach aussen ist nichts offen. Der
gemeinsame Schluessel ist die zweite Linie: er verhindert, dass ein anderer
Dienst im selben Netz die Laufzeit ansprechen kann.

Steuerbefehle laufen bewusst NICHT hierueber, sondern ueber die Datenbank.
Ein HTTP-Endpunkt, der Bots fernsteuert, waere genau die Art offener Tuer,
die man spaeter bereut.
"""

from __future__ import annotations

import hashlib
import hmac
import logging

from aiohttp import web

from . import provider

log = logging.getLogger("swisshub.music.api")


def erstelle_app(api_key: str) -> web.Application:
    app = web.Application()

    # Uebertragen wird der SHA-256 des Schluessels, nicht der Schluessel.
    #
    # HTTP-Header sind nicht fuer Nicht-ASCII gemacht. Ein Schluessel mit
    # Umlaut oder Cedille ueberlebt die Uebertragung nicht: aiohttp liest die
    # Bytes mit Ersatzzeichen ein, und jeder weitere Umgang damit wirft
    # (UnicodeEncodeError: surrogates not allowed). Genau das ist passiert.
    #
    # Ein Hex-Digest ist immer reines ASCII - unabhaengig davon, welche
    # Zeichen jemand im Schluessel waehlt. Nebenbei verlaesst der Schluessel
    # selbst nie den Prozess.
    erwartet = hashlib.sha256(api_key.encode("utf-8")).hexdigest()

    @web.middleware
    async def pruefe_schluessel(anfrage: web.Request, handler):
        # Die Zustandspruefung kommt aus dem Container selbst und traegt
        # keinen Schluessel. Sie hinter die Pruefung zu haengen war falsch:
        # Docker sah dauerhaft 500 und hielt den Dienst fuer krank.
        if anfrage.path == "/health":
            return await handler(anfrage)

        gesendet = anfrage.headers.get("x-swisshub-music-key", "")

        # Sicherheitsnetz: kaeme wider Erwarten doch etwas Unkodierbares an,
        # soll die Pruefung ablehnen statt die Anfrage mit 500 abzubrechen.
        try:
            gesendet.encode("ascii")
        except UnicodeEncodeError:
            return web.json_response({"error": "unauthorized"}, status=401)

        # Zeitkonstanter Vergleich: ein einfaches == verriete den Schluessel
        # ueber die Antwortzeit.
        if not hmac.compare_digest(gesendet, erwartet):
            return web.json_response({"error": "unauthorized"}, status=401)
        return await handler(anfrage)

    app.middlewares.append(pruefe_schluessel)

    async def suche(anfrage: web.Request) -> web.Response:
        daten = await anfrage.json()
        begriff = str(daten.get("query", "")).strip()[:200]
        limit = max(1, min(int(daten.get("limit", 5)), 10))
        if not begriff:
            return web.json_response({"results": []})
        try:
            return web.json_response({"results": await provider.suche(begriff, limit)})
        except Exception as fehler:
            log.warning("Suche fehlgeschlagen: %s", type(fehler).__name__)
            return web.json_response({"error": "provider_unavailable"}, status=503)

    async def aufloesen(anfrage: web.Request) -> web.Response:
        daten = await anfrage.json()
        url = str(daten.get("url", "")).strip()[:2000]
        if not provider.ist_erlaubte_url(url):
            return web.json_response({"error": "unsupported_url"}, status=400)
        try:
            return web.json_response({"results": await provider.aufloesen(url)})
        except Exception as fehler:
            log.warning("Auflösung fehlgeschlagen: %s", type(fehler).__name__)
            return web.json_response({"error": "provider_unavailable"}, status=503)

    async def gesundheit(_anfrage: web.Request) -> web.Response:
        return web.json_response({"status": "ok"})

    app.router.add_post("/search", suche)
    app.router.add_post("/resolve", aufloesen)
    app.router.add_get("/health", gesundheit)
    return app
