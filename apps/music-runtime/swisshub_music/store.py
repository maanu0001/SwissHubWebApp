"""Datenbankzugriff der Voice-Laufzeit.

Bewusst rohes SQL ueber asyncpg statt eines zweiten ORM: das Schema gehoert
Prisma, und ein zweiter Schemabesitzer waere eine Quelle stiller Abweichungen.
Die Laufzeit liest und schreibt nur die wenigen Spalten, die sie wirklich
braucht.
"""

from __future__ import annotations

import json
from dataclasses import dataclass
from typing import Any, Optional

import asyncpg


def _pg_url(prisma_url: str) -> str:
    """Prisma haengt `?schema=` an - asyncpg kennt das nicht."""
    return prisma_url.split("?")[0]


@dataclass
class Befehl:
    id: str
    session_id: str
    kind: str
    payload: dict[str, Any]


class Store:
    def __init__(self, database_url: str) -> None:
        self._url = _pg_url(database_url)
        self._pool: Optional[asyncpg.Pool] = None

    async def start(self) -> None:
        self._pool = await asyncpg.create_pool(self._url, min_size=1, max_size=8)

    async def stop(self) -> None:
        if self._pool is not None:
            await self._pool.close()

    @property
    def pool(self) -> asyncpg.Pool:
        if self._pool is None:
            raise RuntimeError("Der Datenbankzugriff wurde nicht gestartet.")
        return self._pool

    # -- Bot-Anmeldung ----------------------------------------------------

    async def registriere_bot(
        self, key: str, typ: str, name: str, discord_user_id: str, avatar_hash: str | None
    ) -> str:
        """Den Bot anmelden und seine ID liefern.

        Der Schluessel ist stabil: ein Neustart legt keinen zweiten Eintrag an,
        sondern aktualisiert den bestehenden. `enabled` wird dabei bewusst NICHT
        angefasst - hat die Verwaltung einen Bot abgeschaltet, soll ein Neustart
        das nicht rueckgaengig machen.
        """
        zeile = await self.pool.fetchrow(
            """
            INSERT INTO "MusicBotInstance"
                ("id", "type", "key", "name", "discordUserId", "avatarHash",
                 "status", "lastHeartbeatAt", "startedAt", "createdAt", "updatedAt")
            VALUES (gen_random_uuid()::text, $1::"MusicBotType", $2, $3, $4, $5,
                    'FREE'::"MusicBotStatus", now(), now(), now(), now())
            ON CONFLICT ("key") DO UPDATE SET
                "type" = EXCLUDED."type",
                "name" = EXCLUDED."name",
                "discordUserId" = EXCLUDED."discordUserId",
                "avatarHash" = EXCLUDED."avatarHash",
                "lastHeartbeatAt" = now(),
                "startedAt" = now(),
                "lastError" = NULL,
                "updatedAt" = now()
            RETURNING "id"
            """,
            typ,
            key,
            name,
            discord_user_id,
            avatar_hash,
        )
        return str(zeile["id"])

    async def heartbeat(self, bot_id: str, status: str) -> None:
        """Lebenszeichen.

        Ohne dieses Signal gilt der Bot nach kurzer Zeit als nicht erreichbar.
        Der Legacy-Bot kannte nur "Token vorhanden = online" - eine Behauptung,
        die auch dann galt, wenn der Prozess laengst tot war.
        """
        await self.pool.execute(
            """
            UPDATE "MusicBotInstance"
               SET "lastHeartbeatAt" = now(),
                   "status" = CASE WHEN "status" IN ('DISABLED','DRAINING')
                                   THEN "status"
                                   ELSE $2::"MusicBotStatus" END,
                   "updatedAt" = now()
             WHERE "id" = $1
            """,
            bot_id,
            status,
        )

    async def melde_offline(self, bot_id: str) -> None:
        await self.pool.execute(
            """
            UPDATE "MusicBotInstance"
               SET "status" = 'OFFLINE'::"MusicBotStatus", "updatedAt" = now()
             WHERE "id" = $1
            """,
            bot_id,
        )

    async def ist_aktiv(self, bot_id: str) -> bool:
        """Darf dieser Bot neue Sessions annehmen?"""
        zeile = await self.pool.fetchrow(
            'SELECT "enabled", "status" FROM "MusicBotInstance" WHERE "id" = $1', bot_id
        )
        if zeile is None:
            return False
        return bool(zeile["enabled"]) and zeile["status"] not in ("DISABLED", "DRAINING")

    # -- Befehle ----------------------------------------------------------

    async def hole_befehl(self, bot_id: str) -> Befehl | None:
        """Den naechsten offenen Befehl uebernehmen.

        `FOR UPDATE SKIP LOCKED` sorgt dafuer, dass zwei Laufzeiten - etwa
        waehrend eines rollenden Neustarts - denselben Befehl nicht doppelt
        ausfuehren. Ein zweiter Skip waere sonst genau der Fehler, den niemand
        reproduzieren kann.
        """
        async with self.pool.acquire() as verbindung:
            async with verbindung.transaction():
                zeile = await verbindung.fetchrow(
                    """
                    SELECT "id", "sessionId", "kind", "payload"
                      FROM "MusicCommand"
                     WHERE "botInstanceId" = $1 AND "status" = 'PENDING'
                     ORDER BY "createdAt" ASC
                     LIMIT 1
                       FOR UPDATE SKIP LOCKED
                    """,
                    bot_id,
                )
                if zeile is None:
                    return None
                await verbindung.execute(
                    """
                    UPDATE "MusicCommand"
                       SET "status" = 'RUNNING'::"MusicCommandStatus", "claimedAt" = now()
                     WHERE "id" = $1
                    """,
                    zeile["id"],
                )

        roh = zeile["payload"]
        return Befehl(
            id=str(zeile["id"]),
            session_id=str(zeile["sessionId"]),
            kind=str(zeile["kind"]),
            payload=json.loads(roh) if isinstance(roh, str) else dict(roh or {}),
        )

    async def schliesse_befehl(self, command_id: str, fehler: str | None = None) -> None:
        await self.pool.execute(
            """
            UPDATE "MusicCommand"
               SET "status" = CASE WHEN $2::text IS NULL
                                   THEN 'DONE'::"MusicCommandStatus"
                                   ELSE 'FAILED'::"MusicCommandStatus" END,
                   "error" = $2,
                   "finishedAt" = now()
             WHERE "id" = $1
            """,
            command_id,
            fehler,
        )

    # -- Session und Warteschlange ---------------------------------------

    async def session(self, session_id: str) -> asyncpg.Record | None:
        return await self.pool.fetchrow(
            """
            SELECT "id", "guildId", "voiceChannelId", "volume", "loopMode",
                   "currentItemId", "status", "endedAt"
              FROM "MusicSession" WHERE "id" = $1
            """,
            session_id,
        )

    async def naechster_titel(self, session_id: str) -> asyncpg.Record | None:
        """Das erste Element der Warteschlange, das noch spielbar ist."""
        return await self.pool.fetchrow(
            """
            SELECT "id", "title", "webpageUrl", "durationSeconds"
              FROM "MusicQueueItem"
             WHERE "sessionId" = $1 AND "unavailable" = false
             ORDER BY "position" ASC
             LIMIT 1
            """,
            session_id,
        )

    async def setze_aktuellen_titel(self, session_id: str, item_id: str | None) -> None:
        await self.pool.execute(
            """
            UPDATE "MusicSession"
               SET "currentItemId" = $2,
                   "trackStartedAt" = CASE WHEN $2 IS NULL THEN NULL ELSE now() END,
                   "pausedAt" = NULL, "pausedMs" = 0, "updatedAt" = now()
             WHERE "id" = $1
            """,
            session_id,
            item_id,
        )

    async def entferne_titel(self, item_id: str) -> None:
        await self.pool.execute('DELETE FROM "MusicQueueItem" WHERE "id" = $1', item_id)

    async def markiere_unspielbar(self, item_id: str, grund: str) -> None:
        await self.pool.execute(
            """
            UPDATE "MusicQueueItem"
               SET "unavailable" = true, "unavailableError" = $2
             WHERE "id" = $1
            """,
            item_id,
            grund[:300],
        )

    async def schreibe_verlauf(
        self,
        session_id: str,
        guild_id: str,
        voice_channel_id: str,
        titel: asyncpg.Record,
        gespielte_sekunden: int,
        uebersprungen: bool,
    ) -> None:
        await self.pool.execute(
            """
            INSERT INTO "MusicPlaybackHistory"
                ("id", "sessionId", "guildId", "voiceChannelId", "title",
                 "artist", "webpageUrl", "durationSeconds", "thumbnailUrl",
                 "requestedByDiscordUserId", "requestedByUsername",
                 "playedAt", "playedSeconds", "skipped")
            SELECT gen_random_uuid()::text, $1, $2, $3, q."title", q."artist",
                   q."webpageUrl", q."durationSeconds", q."thumbnailUrl",
                   q."requestedByDiscordUserId", q."requestedByUsername",
                   now(), $5, $6
              FROM "MusicQueueItem" q WHERE q."id" = $4
            """,
            session_id,
            guild_id,
            voice_channel_id,
            titel["id"],
            gespielte_sekunden,
            uebersprungen,
        )

    async def beende_session(self, session_id: str, grund: str) -> None:
        """Session schliessen und die beiden Schluessel freigeben."""
        async with self.pool.acquire() as verbindung:
            async with verbindung.transaction():
                zeile = await verbindung.fetchrow(
                    'SELECT "botInstanceId" FROM "MusicSession" WHERE "id" = $1', session_id
                )
                await verbindung.execute(
                    """
                    UPDATE "MusicSession"
                       SET "status" = 'ENDED'::"MusicSessionStatus", "endedAt" = now(),
                           "endReason" = $2::"MusicSessionEndReason",
                           "activeChannelKey" = NULL, "activeBotKey" = NULL,
                           "currentItemId" = NULL, "updatedAt" = now()
                     WHERE "id" = $1 AND "endedAt" IS NULL
                    """,
                    session_id,
                    grund,
                )
                if zeile and zeile["botInstanceId"]:
                    await verbindung.execute(
                        """
                        UPDATE "MusicBotInstance"
                           SET "status" = 'FREE'::"MusicBotStatus", "updatedAt" = now()
                         WHERE "id" = $1
                        """,
                        zeile["botInstanceId"],
                    )

    async def offene_sessions(self, bot_id: str) -> list[asyncpg.Record]:
        return list(
            await self.pool.fetch(
                """
                SELECT "id", "voiceChannelId" FROM "MusicSession"
                 WHERE "botInstanceId" = $1 AND "endedAt" IS NULL
                """,
                bot_id,
            )
        )

    async def einstellungen(self) -> dict[str, Any]:
        """Die Moduleinstellungen - dieselbe Quelle wie das Dashboard."""
        zeile = await self.pool.fetchrow(
            'SELECT "settings", "enabled" FROM "ModuleState" WHERE "moduleId" = \'music\''
        )
        if zeile is None:
            return {"enabled": False}
        roh = zeile["settings"]
        werte = json.loads(roh) if isinstance(roh, str) else dict(roh or {})
        werte["enabled"] = bool(zeile["enabled"])
        return werte

    async def aktualisiere_zuhoerer(self, session_id: str, anzahl: int, allein_seit: bool) -> None:
        await self.pool.execute(
            """
            UPDATE "MusicSession"
               SET "listenerCount" = $2,
                   "aloneSince" = CASE WHEN $3 THEN COALESCE("aloneSince", now()) ELSE NULL END,
                   "updatedAt" = now()
             WHERE "id" = $1
            """,
            session_id,
            anzahl,
            allein_seit,
        )
