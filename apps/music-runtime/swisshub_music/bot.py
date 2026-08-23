"""Ein Bot des Pools.

Controller und Worker sind hier dasselbe: beide melden sich an, halten einen
Heartbeat und arbeiten Befehle ab. Der Unterschied liegt ausschliesslich in
der Zuweisungspolitik, und die entscheidet die WebApp - nicht dieser Prozess.

Slash-Befehle registriert diese Laufzeit bewusst nicht: das erledigt der
bestehende SwissHub-Bot zentral. Zwei Registrierungen ergaeben doppelte
Befehle in Discord.
"""

from __future__ import annotations

import asyncio
import logging
from typing import Optional

import discord

from . import provider
from .config import BotToken, Settings
from .player import SessionPlayer
from .store import Store

log = logging.getLogger("swisshub.music.bot")

INTENTS = discord.Intents(guilds=True, voice_states=True, members=True)


class MusicBot(discord.Client):
    def __init__(self, spec: BotToken, settings: Settings, store: Store) -> None:
        super().__init__(intents=INTENTS)
        self.spec = spec
        self.settings = settings
        self.store = store
        self.bot_id: Optional[str] = None
        self.player: Optional[SessionPlayer] = None
        self._aufgaben: list[asyncio.Task] = []

    async def on_ready(self) -> None:
        assert self.user is not None
        self.bot_id = await self.store.registriere_bot(
            key=self.spec.key,
            typ=self.spec.typ,
            name=self.user.display_name,
            discord_user_id=str(self.user.id),
            avatar_hash=self.user.avatar.key if self.user.avatar else None,
        )
        log.info("Angemeldet: %s (%s)", self.spec.key, self.user)

        await self._raeume_alte_sessions_auf()

        self._aufgaben = [
            asyncio.create_task(self._heartbeat()),
            asyncio.create_task(self._befehle()),
            asyncio.create_task(self._aufsicht()),
        ]

    async def _raeume_alte_sessions_auf(self) -> None:
        """Nach einem Neustart ist keine Voice-Verbindung mehr da.

        Der Ton laeuft ueber einen Prozess und einen FFmpeg-Kindprozess - beide
        sind weg. Eine Session, die die Datenbank noch als aktiv fuehrt, waere
        eine Luege: die Oberflaeche zeigte "spielt", und der Bot sitzt in
        keinem Kanal. Deshalb werden sie sauber beendet, statt sie so zu
        lassen, als liefe die Wiedergabe weiter.
        """
        assert self.bot_id is not None
        for zeile in await self.store.offene_sessions(self.bot_id):
            await self.store.beende_session(str(zeile["id"]), "STALE_RECONCILED")
            log.info("Verwaiste Session beendet: %s", zeile["id"])

    async def _heartbeat(self) -> None:
        while not self.is_closed():
            try:
                assert self.bot_id is not None
                belegt = self.player is not None and self.player.voice is not None
                await self.store.heartbeat(self.bot_id, "BUSY" if belegt else "FREE")
            except Exception:
                log.exception("Heartbeat fehlgeschlagen")
            await asyncio.sleep(self.settings.heartbeat_seconds)

    async def _befehle(self) -> None:
        while not self.is_closed():
            try:
                assert self.bot_id is not None
                befehl = await self.store.hole_befehl(self.bot_id)
                if befehl is None:
                    await asyncio.sleep(self.settings.poll_seconds)
                    continue
                try:
                    await self._fuehre_aus(befehl.kind, befehl.session_id, befehl.payload)
                    await self.store.schliesse_befehl(befehl.id)
                except Exception as fehler:
                    log.warning("Befehl %s fehlgeschlagen: %s", befehl.kind, type(fehler).__name__)
                    # Der Wortlaut geht an die WebApp, nicht der Traceback:
                    # yt-dlp-Meldungen enthalten ganze URLs.
                    await self.store.schliesse_befehl(
                        befehl.id, _verstaendlich(befehl.kind, fehler)
                    )
            except Exception:
                log.exception("Befehlsschleife gestoert")
                await asyncio.sleep(2)

    async def _fuehre_aus(self, art: str, session_id: str, nutzlast: dict) -> None:
        if art in ("JOIN", "QUEUE_ADD", "PLAY"):
            await self._sicherstellen(session_id)
            if self.player is not None:
                self.player.starte()
            return

        if self.player is None:
            raise RuntimeError("Für diese Session läuft keine Wiedergabe.")

        if art == "PAUSE":
            self.player.pausiere()
        elif art == "RESUME":
            self.player.fortsetzen()
        elif art == "SKIP":
            self.player.ueberspringe()
        elif art == "STOP":
            self.player.stoppe()
        elif art == "SET_VOLUME":
            self.player.setze_lautstaerke(int(nutzlast.get("volume", 50)))
        elif art == "LEAVE":
            await self.player.verlasse()
            self.player = None
            await self.store.beende_session(session_id, "MANUAL")
        elif art in ("SET_LOOP", "QUEUE_REMOVE", "QUEUE_MOVE", "QUEUE_SHUFFLE"):
            # Der Zustand steht bereits in der Datenbank; die Schleife liest
            # ihn beim naechsten Titel. Nichts weiter zu tun.
            pass

    async def _sicherstellen(self, session_id: str) -> None:
        """Mit dem Sprachkanal der Session verbunden sein."""
        session = await self.store.session(session_id)
        if session is None or session["endedAt"] is not None:
            raise RuntimeError("Diese Session läuft nicht mehr.")

        kanal = self.get_channel(int(session["voiceChannelId"]))
        if kanal is None:
            kanal = await self.fetch_channel(int(session["voiceChannelId"]))
        if not isinstance(kanal, discord.VoiceChannel):
            raise RuntimeError("Der Sprachkanal wurde nicht gefunden.")

        if self.player is None or self.player.session_id != session_id:
            if self.player is not None:
                await self.player.verlasse()
            self.player = SessionPlayer(self, self.store, session_id)

        self.player.setze_lautstaerke(int(session["volume"]))
        await self.player.verbinde(kanal)

    async def _aufsicht(self) -> None:
        """Leerlauf und leerer Kanal - beide Legacy-Regeln, alle 30 Sekunden."""
        while not self.is_closed():
            await asyncio.sleep(30)
            try:
                if self.player is None or self.player.voice is None:
                    continue

                einstellungen = await self.store.einstellungen()
                leerlauf = int(einstellungen.get("idleDisconnectSeconds", 600))
                allein = int(einstellungen.get("aloneDisconnectSeconds", 120))

                zuhoerer = self.player.zuhoerer()
                await self.store.aktualisiere_zuhoerer(
                    self.player.session_id, zuhoerer, zuhoerer == 0
                )

                session = await self.store.session(self.player.session_id)
                if session is None or session["endedAt"] is not None:
                    await self.player.verlasse()
                    self.player = None
                    continue

                zeile = await self.store.pool.fetchrow(
                    """
                    SELECT "aloneSince", "lastActivityAt",
                           (SELECT COUNT(*) FROM "MusicQueueItem" WHERE "sessionId" = $1) AS "offen"
                      FROM "MusicSession" WHERE "id" = $1
                    """,
                    self.player.session_id,
                )
                if zeile is None:
                    continue

                import datetime as _dt

                jetzt = _dt.datetime.now(_dt.timezone.utc)

                if zeile["aloneSince"] is not None:
                    if (jetzt - zeile["aloneSince"]).total_seconds() >= allein:
                        await self._trenne("ALONE_TIMEOUT")
                        continue

                untaetig = (jetzt - zeile["lastActivityAt"]).total_seconds()
                if (
                    not self.player.laeuft()
                    and int(zeile["offen"] or 0) == 0
                    and session["loopMode"] == "OFF"
                    and untaetig >= leerlauf
                ):
                    await self._trenne("IDLE_TIMEOUT")
            except Exception:
                log.exception("Aufsicht gestört")

    async def _trenne(self, grund: str) -> None:
        if self.player is None:
            return
        session_id = self.player.session_id
        await self.player.verlasse()
        self.player = None
        await self.store.beende_session(session_id, grund)
        log.info("Session beendet (%s): %s", grund, session_id)

    async def close(self) -> None:
        """Geordnetes Herunterfahren: kein Zombie-FFmpeg, kein falscher Status."""
        for aufgabe in self._aufgaben:
            aufgabe.cancel()
        if self.player is not None:
            await self.player.verlasse()
            self.player = None
        if self.bot_id is not None:
            try:
                await self.store.melde_offline(self.bot_id)
            except Exception:
                log.warning("Offline-Meldung fehlgeschlagen")
        await super().close()


def _verstaendlich(art: str, fehler: Exception) -> str:
    """Fehlermeldungen ohne technische Innereien."""
    if isinstance(fehler, asyncio.TimeoutError):
        return "Die Musikquelle hat zu lange gebraucht."
    if isinstance(fehler, discord.Forbidden):
        return "Dem Musik-Bot fehlen die Rechte für diesen Sprachkanal."
    if isinstance(fehler, ValueError):
        return str(fehler)
    return f"Der Befehl {art} konnte nicht ausgeführt werden."
