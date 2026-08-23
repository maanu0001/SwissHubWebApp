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

    async def melde_identitaet(
        self, typ: str, name: str, discord_user_id: str, avatar_hash: str | None
    ) -> str:
        """Die Identitaet eines Bots eintragen und seine ID liefern.

        Bewusst OHNE Rollenschluessel: der folgt im Pool-Abgleich, wenn alle
        Bots angemeldet sind. Wuerde jeder Bot seinen Schluessel sofort setzen,
        scheiterte jeder Rollentausch - zieht ein Worker zum Controller um,
        haelt seine alte Zeile den Schluessel noch, und die eindeutige
        Discord-ID laesst keine zweite Zeile zu.

        Die Identitaet ist die Discord-ID, nicht die Position in der
        Token-Liste. Wer an welcher Stelle steht, darf sich aendern; wer der
        Bot IST, nicht.
        """
        zeile = await self.pool.fetchrow(
            """
            INSERT INTO "MusicBotInstance"
                ("id", "type", "key", "name", "discordUserId", "avatarHash",
                 "status", "lastHeartbeatAt", "startedAt", "createdAt", "updatedAt")
            VALUES (gen_random_uuid()::text, $1::"MusicBotType",
                    'pending:' || gen_random_uuid()::text, $2, $3, $4,
                    'CONNECTING'::"MusicBotStatus", now(), now(), now(), now())
            ON CONFLICT ("discordUserId") DO UPDATE SET
                "name" = EXCLUDED."name",
                "avatarHash" = EXCLUDED."avatarHash",
                "lastHeartbeatAt" = now(),
                "startedAt" = now(),
                "lastError" = NULL,
                "updatedAt" = now()
            RETURNING "id"
            """,
            typ,
            name,
            discord_user_id,
            avatar_hash,
        )
        return str(zeile["id"])

    async def gleiche_pool_ab(self, eintraege: list[tuple[str, str, str]]) -> list[str]:
        """Den gesamten Pool abgleichen - (key, typ, discord_user_id).

        Laeuft in EINER Transaktion, sobald alle Bots angemeldet sind. Erst
        dadurch sind Rollentausche moeglich: die Schluessel werden zusammen
        freigegeben und zusammen neu vergeben, statt einzeln zu kollidieren.

        Bots, die nicht mehr konfiguriert sind, verschwinden. Vorher waren sie
        ewig sichtbar - mit altem Zustand und altem Sitzungseintrag, obwohl
        niemand sie mehr betreibt. Eine laufende Sitzung wird dabei sauber
        beendet, nicht einfach fallen gelassen.
        """
        ids = [d for _k, _t, d in eintraege]
        entfernt: list[str] = []

        async with self.pool.acquire() as verbindung:
            async with verbindung.transaction():
                # 1. Nicht mehr konfigurierte Bots: erst ihre Sitzungen
                #    schliessen, dann die Zeile entfernen.
                verwaist = await verbindung.fetch(
                    'SELECT "id", "name" FROM "MusicBotInstance" WHERE NOT ("discordUserId" = ANY($1::text[]))',
                    ids,
                )
                for zeile in verwaist:
                    await verbindung.execute(
                        """
                        UPDATE "MusicSession"
                           SET "status" = 'ENDED'::"MusicSessionStatus", "endedAt" = now(),
                               "endReason" = 'STALE_RECONCILED'::"MusicSessionEndReason",
                               "activeChannelKey" = NULL, "activeBotKey" = NULL,
                               "currentItemId" = NULL, "updatedAt" = now()
                         WHERE "botInstanceId" = $1 AND "endedAt" IS NULL
                        """,
                        zeile["id"],
                    )
                    entfernt.append(str(zeile["name"] or zeile["id"]))
                if verwaist:
                    await verbindung.execute(
                        'DELETE FROM "MusicBotInstance" WHERE NOT ("discordUserId" = ANY($1::text[]))',
                        ids,
                    )

                # 2. Schluessel gemeinsam freigeben - sonst blockiert der alte
                #    Platz eines Bots den neuen eines anderen.
                await verbindung.execute(
                    """
                    UPDATE "MusicBotInstance"
                       SET "key" = 'pending:' || gen_random_uuid()::text
                     WHERE "discordUserId" = ANY($1::text[])
                    """,
                    ids,
                )

                # 3. Rollen neu vergeben.
                for key, typ, discord_user_id in eintraege:
                    await verbindung.execute(
                        """
                        UPDATE "MusicBotInstance"
                           SET "key" = $1, "type" = $2::"MusicBotType", "updatedAt" = now()
                         WHERE "discordUserId" = $3
                        """,
                        key,
                        typ,
                        discord_user_id,
                    )

        return entfernt

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

    async def markiere_aktiv(self, session_id: str) -> None:
        """Die Sitzung laeuft - der Bot sitzt im Kanal.

        Ohne diesen Schritt bliebe sie auf STARTING stehen, und die Verwaltung
        saehe dauerhaft "startet", obwohl laengst gespielt wird. Zugleich
        beginnt hier die Leerlaufuhr: sie soll ab dem Beitritt zaehlen, nicht
        ab dem Moment, in dem jemand auf den Knopf gedrueckt hat.
        """
        await self.pool.execute(
            """
            UPDATE "MusicSession"
               SET "status" = 'ACTIVE'::"MusicSessionStatus",
                   "lastActivityAt" = now(), "aloneSince" = NULL, "updatedAt" = now()
             WHERE "id" = $1 AND "endedAt" IS NULL
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
