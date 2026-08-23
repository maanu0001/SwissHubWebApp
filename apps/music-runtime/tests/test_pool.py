"""Der Pool-Abgleich gegen eine echte Datenbank.

Diese Faelle sind aus einem echten Fehlerbericht entstanden: nach dem Tausch
der Tokens blieb der alte Controller sichtbar, und der neue konnte seine Rolle
nicht uebernehmen.

Start:  SWISSHUB_TEST_DATABASE_URL=... python -m pytest apps/music-runtime/tests
"""

from __future__ import annotations

import os
import sys

import pytest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from swisshub_music.store import Store  # noqa: E402

URL = os.environ.get("SWISSHUB_TEST_DATABASE_URL")
pytestmark = pytest.mark.skipif(not URL, reason="SWISSHUB_TEST_DATABASE_URL fehlt")


@pytest.fixture
async def store():
    s = Store(URL)
    await s.start()
    for tabelle in ('"MusicCommand"', '"MusicSession"', '"MusicBotInstance"'):
        await s.pool.execute(f"DELETE FROM {tabelle}")
    yield s
    await s.stop()


async def _schluessel(s: Store) -> dict[str, str]:
    zeilen = await s.pool.fetch('SELECT "key", "discordUserId" FROM "MusicBotInstance"')
    return {str(z["discordUserId"]): str(z["key"]) for z in zeilen}


@pytest.mark.asyncio
async def test_rollentausch(store: Store) -> None:
    """Ein Worker wird Controller - das darf nicht an der Eindeutigkeit scheitern."""
    await store.melde_identitaet("CONTROLLER", "Alt", "111", None)
    await store.melde_identitaet("WORKER", "Neu", "222", None)
    await store.gleiche_pool_ab([("CONTROLLER", "CONTROLLER", "111"), ("WORKER_1", "WORKER", "222")])
    assert (await _schluessel(store)) == {"111": "CONTROLLER", "222": "WORKER_1"}

    # Rollen tauschen.
    await store.gleiche_pool_ab([("CONTROLLER", "CONTROLLER", "222"), ("WORKER_1", "WORKER", "111")])
    assert (await _schluessel(store)) == {"222": "CONTROLLER", "111": "WORKER_1"}


@pytest.mark.asyncio
async def test_entfernt_nicht_mehr_konfigurierte_bots(store: Store) -> None:
    """Wer aus der Token-Liste faellt, verschwindet auch aus der Anzeige."""
    await store.melde_identitaet("CONTROLLER", "Bleibt", "111", None)
    await store.melde_identitaet("WORKER", "Faellt weg", "222", None)
    await store.gleiche_pool_ab([("CONTROLLER", "CONTROLLER", "111"), ("WORKER_1", "WORKER", "222")])

    entfernt = await store.gleiche_pool_ab([("CONTROLLER", "CONTROLLER", "111")])
    assert entfernt == ["Faellt weg"]
    assert (await _schluessel(store)) == {"111": "CONTROLLER"}


@pytest.mark.asyncio
async def test_beendet_sitzung_eines_entfernten_bots(store: Store) -> None:
    """Eine laufende Sitzung wird sauber beendet, nicht fallen gelassen."""
    await store.melde_identitaet("CONTROLLER", "Geht", "111", None)
    await store.gleiche_pool_ab([("CONTROLLER", "CONTROLLER", "111")])
    bot_id = await store.pool.fetchval(
        'SELECT "id" FROM "MusicBotInstance" WHERE "discordUserId" = \'111\''
    )
    await store.pool.execute(
        """
        INSERT INTO "MusicSession"
            ("id","guildId","voiceChannelId","botInstanceId","status",
             "activeChannelKey","activeBotKey","createdAt","updatedAt","lastActivityAt")
        VALUES (gen_random_uuid()::text,'1','2',$1,'ACTIVE','1:2',$1,now(),now(),now())
        """,
        bot_id,
    )

    await store.melde_identitaet("CONTROLLER", "Neu", "999", None)
    await store.gleiche_pool_ab([("CONTROLLER", "CONTROLLER", "999")])

    offen = await store.pool.fetchval(
        'SELECT COUNT(*) FROM "MusicSession" WHERE "endedAt" IS NULL'
    )
    assert offen == 0


@pytest.mark.asyncio
async def test_neustart_aendert_nichts(store: Store) -> None:
    """Derselbe Pool zweimal abgeglichen ergibt denselben Zustand."""
    eintraege = [("CONTROLLER", "CONTROLLER", "111"), ("WORKER_1", "WORKER", "222")]
    for typ, name, did in [("CONTROLLER", "A", "111"), ("WORKER", "B", "222")]:
        await store.melde_identitaet(typ, name, did, None)
    await store.gleiche_pool_ab(eintraege)
    vorher = await _schluessel(store)

    for typ, name, did in [("CONTROLLER", "A", "111"), ("WORKER", "B", "222")]:
        await store.melde_identitaet(typ, name, did, None)
    entfernt = await store.gleiche_pool_ab(eintraege)

    assert entfernt == []
    assert (await _schluessel(store)) == vorher


@pytest.mark.asyncio
async def test_abgeschalteter_bot_bleibt_abgeschaltet(store: Store) -> None:
    """Ein Neustart macht das Abschalten in der Verwaltung nicht rueckgaengig."""
    await store.melde_identitaet("WORKER", "Aus", "222", None)
    await store.gleiche_pool_ab([("WORKER_1", "WORKER", "222")])
    await store.pool.execute(
        'UPDATE "MusicBotInstance" SET "enabled" = false, "status" = \'DISABLED\' WHERE "discordUserId" = \'222\''
    )

    await store.melde_identitaet("WORKER", "Aus", "222", None)
    await store.gleiche_pool_ab([("WORKER_1", "WORKER", "222")])

    zeile = await store.pool.fetchrow(
        'SELECT "enabled", "status" FROM "MusicBotInstance" WHERE "discordUserId" = \'222\''
    )
    assert zeile["enabled"] is False
    assert zeile["status"] == "DISABLED"
