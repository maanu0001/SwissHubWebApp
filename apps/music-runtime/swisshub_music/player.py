"""Wiedergabe je Bot und Voice-Kanal.

Der Unterschied zum Legacy-Bot ist nicht die Tonwiedergabe - die ist
uebernommen - sondern woher die Warteschlange kommt. Frueher lag sie in einer
asyncio.Queue im Speicher; jetzt steht sie in der Datenbank, wo Webplayer und
Slash-Befehle dieselbe sehen. Der Player liest sie, statt sie zu besitzen.
"""

from __future__ import annotations

import asyncio
import logging
import time
from typing import Optional

import discord

from . import provider
from .store import Store

log = logging.getLogger("swisshub.music.player")


class SessionPlayer:
    def __init__(self, client: discord.Client, store: Store, session_id: str) -> None:
        self.client = client
        self.store = store
        self.session_id = session_id
        self.voice: Optional[discord.VoiceClient] = None
        self.volume = 0.5
        self._weiter = asyncio.Event()
        self._aufgabe: Optional[asyncio.Task] = None
        self._quelle: Optional[discord.PCMVolumeTransformer] = None
        self._begonnen_um = 0.0
        self._uebersprungen = False

    async def verbinde(self, kanal: discord.VoiceChannel) -> None:
        if self.voice and self.voice.is_connected():
            if self.voice.channel and self.voice.channel.id != kanal.id:
                await self.voice.move_to(kanal)
            return
        # self_deaf wie im Legacy-Bot: der Bot muss nichts hoeren.
        self.voice = await kanal.connect(self_deaf=True)

    def starte(self) -> None:
        if self._aufgabe is None or self._aufgabe.done():
            self._aufgabe = asyncio.create_task(self._schleife())

    async def _schleife(self) -> None:
        while True:
            try:
                await self._naechster_titel()
            except asyncio.CancelledError:
                return
            except Exception:
                # Ein Fehler an einem Titel darf die Schleife nicht beenden -
                # sonst steht die Session still und niemand weiss warum.
                log.exception("Fehler in der Wiedergabeschleife", extra={"session": self.session_id})
                await asyncio.sleep(1)

    async def _naechster_titel(self) -> None:
        session = await self.store.session(self.session_id)
        if session is None or session["endedAt"] is not None:
            raise asyncio.CancelledError

        loop_mode = session["loopMode"]
        aktuell_id = session["currentItemId"]

        if loop_mode == "TRACK" and aktuell_id:
            eintrag = await self.store.pool.fetchrow(
                'SELECT "id","title","webpageUrl","durationSeconds" FROM "MusicQueueItem" WHERE "id" = $1',
                aktuell_id,
            )
        else:
            eintrag = await self.store.naechster_titel(self.session_id)

        if eintrag is None:
            await self.store.setze_aktuellen_titel(self.session_id, None)
            await asyncio.sleep(2)
            return

        await self.store.setze_aktuellen_titel(self.session_id, str(eintrag["id"]))

        try:
            # Immer frisch aufloesen - abgelaufene Signaturen sind der
            # haeufigste Grund fuer stumme Wiedergabe.
            adresse = await provider.stream_url(str(eintrag["webpageUrl"]))
        except Exception as fehler:
            log.warning("Titel nicht abspielbar: %s", type(fehler).__name__)
            await self.store.markiere_unspielbar(str(eintrag["id"]), str(fehler))
            return

        self._weiter.clear()
        self._uebersprungen = False
        self._begonnen_um = time.monotonic()

        quelle = discord.PCMVolumeTransformer(
            discord.FFmpegPCMAudio(adresse, **provider.FFMPEG_OPTS), volume=self.volume
        )
        self._quelle = quelle

        if self.voice is None or not self.voice.is_connected():
            raise asyncio.CancelledError

        self.voice.play(
            quelle,
            after=lambda _f: self.client.loop.call_soon_threadsafe(self._weiter.set),
        )
        await self._weiter.wait()

        gespielt = int(time.monotonic() - self._begonnen_um)
        session = await self.store.session(self.session_id)
        if session is not None:
            await self.store.schreibe_verlauf(
                self.session_id,
                str(session["guildId"]),
                str(session["voiceChannelId"]),
                eintrag,
                gespielt,
                self._uebersprungen,
            )

        # Bei Titelwiederholung bleibt der Eintrag stehen. Bei
        # Warteschlangenwiederholung wandert er ans Ende, statt geloescht zu
        # werden - so gibt es weder Trackverlust noch wachsende Duplikate.
        if loop_mode == "TRACK":
            return
        if loop_mode == "QUEUE":
            await self.store.pool.execute(
                """
                UPDATE "MusicQueueItem"
                   SET "position" = COALESCE(
                         (SELECT MAX("position") FROM "MusicQueueItem" WHERE "sessionId" = $2), 0
                       ) + 10
                 WHERE "id" = $1
                """,
                str(eintrag["id"]),
                self.session_id,
            )
        else:
            await self.store.entferne_titel(str(eintrag["id"]))

    # -- Steuerung --------------------------------------------------------

    def pausiere(self) -> None:
        if self.voice and self.voice.is_playing():
            self.voice.pause()

    def fortsetzen(self) -> None:
        if self.voice and self.voice.is_paused():
            self.voice.resume()

    def ueberspringe(self) -> None:
        self._uebersprungen = True
        if self.voice and (self.voice.is_playing() or self.voice.is_paused()):
            self.voice.stop()

    def setze_lautstaerke(self, prozent: int) -> None:
        self.volume = max(0.0, min(prozent, 150)) / 100.0
        if self._quelle is not None:
            self._quelle.volume = self.volume

    def stoppe(self) -> None:
        """Wiedergabe anhalten - der Kanal wird dabei nicht verlassen."""
        if self.voice and (self.voice.is_playing() or self.voice.is_paused()):
            self.voice.stop()

    async def verlasse(self) -> None:
        if self._aufgabe is not None:
            self._aufgabe.cancel()
        self.stoppe()
        if self.voice and self.voice.is_connected():
            await self.voice.disconnect()
        self.voice = None

    def laeuft(self) -> bool:
        return bool(self.voice and self.voice.is_connected() and self.voice.is_playing())

    def zuhoerer(self) -> int:
        """Echte Zuhoerer - Bots zaehlen nicht, wie im Legacy-Bot."""
        if not self.voice or not self.voice.channel:
            return 0
        return len([m for m in self.voice.channel.members if not m.bot])
