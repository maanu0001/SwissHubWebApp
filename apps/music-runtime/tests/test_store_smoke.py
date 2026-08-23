"""Jede Abfrage der Laufzeit einmal ausfuehren.

Entstanden aus einem Betriebsfehler: `AmbiguousParameterError` fuer einen
Parameter, der einmal zugewiesen und einmal auf NULL geprueft wurde. Solche
Fehler zeigen sich erst, wenn Postgres die Anweisung vorbereitet - kein
Typcheck und keine Syntaxpruefung findet sie. Deshalb wird hier jede oeffentliche
Methode wenigstens einmal gegen eine echte Datenbank aufgerufen.

Der Test prueft bewusst nicht die Fachlichkeit; das tun die anderen. Er
prueft, dass die Anweisungen ueberhaupt ausfuehrbar sind.
"""

from __future__ import annotations

import inspect
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
    for tabelle in (
        '"MusicCommand"',
        '"MusicPlaybackHistory"',
        '"MusicQueueItem"',
        '"MusicSession"',
        '"MusicBotInstance"',
    ):
        await s.pool.execute(f"DELETE FROM {tabelle}")
    yield s
    await s.stop()


@pytest.mark.asyncio
async def test_jede_abfrage_ist_ausfuehrbar(store: Store) -> None:
    bot_id = await store.melde_identitaet("CONTROLLER", "Bot", "111", "abc")
    await store.gleiche_pool_ab([("CONTROLLER", "CONTROLLER", "111")])

    await store.heartbeat(bot_id, "FREE")
    assert await store.ist_aktiv(bot_id) is True
    assert isinstance(await store.einstellungen(), dict)

    session_id = await store.pool.fetchval(
        """
        INSERT INTO "MusicSession"
            ("id","guildId","voiceChannelId","botInstanceId","status",
             "activeChannelKey","activeBotKey","createdAt","updatedAt","lastActivityAt")
        VALUES (gen_random_uuid()::text,'1','2',$1,'ACTIVE','1:2',$1,now(),now(),now())
        RETURNING "id"
        """,
        bot_id,
    )

    assert await store.session(session_id) is not None
    assert await store.offene_sessions(bot_id)
    await store.markiere_aktiv(session_id)

    item_id = await store.pool.fetchval(
        """
        INSERT INTO "MusicQueueItem"
            ("id","sessionId","position","provider","title","webpageUrl","createdAt")
        VALUES (gen_random_uuid()::text,$1,10,'youtube','Titel',
                'https://www.youtube.com/watch?v=x',now())
        RETURNING "id"
        """,
        session_id,
    )

    titel = await store.naechster_titel(session_id)
    assert titel is not None

    # Der Fall, an dem es im Betrieb scheiterte: einmal mit Wert, einmal ohne.
    await store.setze_aktuellen_titel(session_id, item_id)
    await store.setze_aktuellen_titel(session_id, None)

    # Und der zweite Kandidat derselben Art.
    await store.aktualisiere_zuhoerer(session_id, 3, False)
    await store.aktualisiere_zuhoerer(session_id, 0, True)

    await store.schreibe_verlauf(session_id, "1", "2", titel, 42, False)
    await store.markiere_unspielbar(item_id, "Video entfernt")

    befehl_id = await store.pool.fetchval(
        """
        INSERT INTO "MusicCommand" ("id","sessionId","botInstanceId","kind","payload","createdAt")
        VALUES (gen_random_uuid()::text,$1,$2,'SKIP','{}',now())
        RETURNING "id"
        """,
        session_id,
        bot_id,
    )
    befehl = await store.hole_befehl(bot_id)
    assert befehl is not None and befehl.id == str(befehl_id)
    await store.schliesse_befehl(befehl.id)
    await store.schliesse_befehl(befehl.id, "ein Fehler")

    await store.entferne_titel(item_id)
    await store.beende_session(session_id, "MANUAL")
    await store.melde_offline(bot_id)


def test_keine_methode_wurde_vergessen() -> None:
    """Waechst der Store, muss der Rauchtest mitwachsen.

    Ohne diese Pruefung faende eine neue Abfrage erst im Betrieb ihren ersten
    Aufruf - genau das ist einmal passiert.
    """
    quelle = (
        open(os.path.join(os.path.dirname(__file__), "test_store_smoke.py"))
        .read()
    )
    oeffentlich = {
        name
        for name, _ in inspect.getmembers(Store, inspect.isfunction)
        if not name.startswith("_") and name not in {"start", "stop"}
    }
    fehlend = {name for name in oeffentlich if f"store.{name}(" not in quelle}
    assert not fehlend, f"Ohne Rauchtest: {sorted(fehlend)}"
