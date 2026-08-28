"""Einstiegspunkt der Voice-Laufzeit.

Startet alle Bots des Pools in einem Prozess - wie der Legacy-Bot, der
Controller und Worker ebenfalls per asyncio.gather betrieb. Ein Prozess je Bot
brauchte sechs Container fuer sechs Tokens, ohne dass etwas gewonnen waere.
"""

from __future__ import annotations

import asyncio
import logging
import signal
import sys

from aiohttp import web

from .api import erstelle_app
from .bot import MusicBot
from .config import ConfigError, lade_bots_aus_datenbank, lade_settings
from .store import Store

logging.basicConfig(
    level=logging.INFO,
    format='{"level":"%(levelname)s","logger":"%(name)s","msg":"%(message)s"}',
)
log = logging.getLogger("swisshub.music")


async def main() -> int:
    try:
        settings = lade_settings()
        # Die zentrale Verwaltung gewinnt; die Umgebung bleibt der Rueckfall.
        settings = await lade_bots_aus_datenbank(settings)
    except ConfigError as fehler:
        log.error("%s", fehler)
        return 1

    if not settings.bots:
        log.error(
            "Kein Bot-Token vorhanden. Sie werden im Dashboard unter "
            "System -> Integrationen -> Discord-Bots gepflegt."
        )
        return 1

    log.info("Starte Voice-Laufzeit mit %d Bots", len(settings.bots))

    store = Store(settings.database_url)
    await store.start()

    bots = [MusicBot(spec, settings, store) for spec in settings.bots]

    laeufer = web.AppRunner(erstelle_app(settings.api_key))
    await laeufer.setup()
    seite = web.TCPSite(laeufer, settings.api_host, settings.api_port)
    await seite.start()
    log.info("Interne Schnittstelle auf %s:%d", settings.api_host, settings.api_port)

    stopp = asyncio.Event()

    def _beenden() -> None:
        log.info("Signal erhalten - fahre geordnet herunter")
        stopp.set()

    schleife = asyncio.get_running_loop()
    for zeichen in (signal.SIGTERM, signal.SIGINT):
        try:
            schleife.add_signal_handler(zeichen, _beenden)
        except NotImplementedError:  # pragma: no cover
            pass

    aufgaben = [asyncio.create_task(bot.start(bot.spec.token)) for bot in bots]

    # Rollen erst vergeben, wenn alle Bots ihre Identitaet gemeldet haben.
    # Einzeln waere jeder Rollentausch unmoeglich: die alte Zeile eines Bots
    # haelt den Schluessel noch, waehrend die neue ihn schon braucht.
    asyncio.create_task(_gleiche_pool_ab(bots, store))

    await stopp.wait()

    # Geordnet: erst die Bots trennen (Voice sauber verlassen, FFmpeg beenden,
    # Status melden), dann die Infrastruktur.
    for bot in bots:
        try:
            await bot.close()
        except Exception:
            log.warning("Bot konnte nicht sauber geschlossen werden")
    for aufgabe in aufgaben:
        aufgabe.cancel()
    await laeufer.cleanup()
    await store.stop()
    log.info("Beendet")
    return 0


async def _gleiche_pool_ab(bots: list[MusicBot], store: Store) -> None:
    """Wartet auf alle Anmeldungen und gleicht dann den Pool ab."""
    try:
        await asyncio.wait_for(
            asyncio.gather(*(bot.bereit.wait() for bot in bots)), timeout=120
        )
    except asyncio.TimeoutError:
        angemeldet = [b for b in bots if b.bereit.is_set()]
        log.warning(
            "Nur %d von %d Bots haben sich angemeldet - gleiche mit diesen ab",
            len(angemeldet),
            len(bots),
        )
        bots = angemeldet

    eintraege = [
        (bot.spec.key, bot.spec.typ, bot.discord_user_id)
        for bot in bots
        if bot.discord_user_id is not None
    ]
    if not eintraege:
        log.error("Kein Bot konnte sich anmelden - der Pool bleibt unveraendert")
        return

    try:
        entfernt = await store.gleiche_pool_ab(eintraege)
    except Exception:
        log.exception("Pool-Abgleich fehlgeschlagen")
        return

    for bot in bots:
        if bot.bot_id is not None:
            await store.heartbeat(bot.bot_id, "FREE")

    log.info("Pool abgeglichen: %d Bots aktiv", len(eintraege))
    for name in entfernt:
        log.info("Nicht mehr konfiguriert, entfernt: %s", name)


if __name__ == "__main__":
    sys.exit(asyncio.run(main()))
