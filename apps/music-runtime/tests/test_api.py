"""Die interne Schnittstelle.

Aus einem Betriebsfehler entstanden: ein Schluessel mit Nicht-ASCII-Zeichen
liess `hmac.compare_digest` werfen, und damit war jede Anfrage - auch die
Zustandspruefung des Containers - eine 500.
"""

from __future__ import annotations

import os
import sys

import pytest
from aiohttp.test_utils import TestClient, TestServer

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from swisshub_music.api import erstelle_app  # noqa: E402

# Genau der Fall aus dem Betrieb: Umlaute und Sonderzeichen im Schluessel.
# Genau der Fall aus dem Betrieb: eine Cedille im Schluessel.
SCHLUESSEL = "geheim-mit-üäöç-und-€-zeichen"


def _nachweis(schluessel: str) -> str:
    """Was die WebApp im Header sendet - der SHA-256 als Hex."""
    import hashlib

    return hashlib.sha256(schluessel.encode("utf-8")).hexdigest()


@pytest.fixture
async def client():
    server = TestServer(erstelle_app(SCHLUESSEL))
    async with TestClient(server) as c:
        yield c


@pytest.mark.asyncio
async def test_zustandspruefung_braucht_keinen_schluessel(client: TestClient) -> None:
    """Docker prueft aus dem Container heraus und traegt keinen Schluessel."""
    antwort = await client.get("/health")
    assert antwort.status == 200
    assert (await antwort.json())["status"] == "ok"


@pytest.mark.asyncio
async def test_schluessel_mit_sonderzeichen_wird_akzeptiert(client: TestClient) -> None:
    """Ein Schluessel mit Nicht-ASCII darf die Schnittstelle nicht lahmlegen.

    Uebertragen wird sein Hex-Digest - reines ASCII, das den HTTP-Header
    unbeschadet uebersteht. Der Rohschluessel tat das nicht.
    """
    antwort = await client.post(
        "/search",
        json={"query": "", "limit": 1},
        headers={"x-swisshub-music-key": _nachweis(SCHLUESSEL)},
    )
    # Leere Suche liefert eine leere Trefferliste - entscheidend ist, dass die
    # Pruefung nicht mit 500 abbricht.
    assert antwort.status == 200


@pytest.mark.asyncio
async def test_falscher_schluessel_wird_abgewiesen(client: TestClient) -> None:
    antwort = await client.post(
        "/search", json={"query": "abc"}, headers={"x-swisshub-music-key": "falsch"}
    )
    assert antwort.status == 401


@pytest.mark.asyncio
async def test_fehlender_schluessel_wird_abgewiesen(client: TestClient) -> None:
    antwort = await client.post("/search", json={"query": "abc"})
    assert antwort.status == 401


@pytest.mark.asyncio
async def test_fremde_adresse_wird_abgewiesen(client: TestClient) -> None:
    """SSRF-Schutz: nur bekannte Hosts werden aufgeloest."""
    antwort = await client.post(
        "/resolve",
        json={"url": "http://169.254.169.254/latest/meta-data/"},
        headers={"x-swisshub-music-key": _nachweis(SCHLUESSEL)},
    )
    assert antwort.status == 400


@pytest.mark.asyncio
async def test_roher_schluessel_wird_nicht_mehr_akzeptiert(client: TestClient) -> None:
    """Der Schluessel selbst gehoert nicht in den Header.

    Zuvor wurde er roh gesendet - und ein Nicht-ASCII-Zeichen liess jede
    Anfrage mit UnicodeEncodeError abbrechen. Jetzt zaehlt nur der Digest.
    """
    antwort = await client.post(
        "/search",
        json={"query": "abc"},
        headers={"x-swisshub-music-key": "ascii-teil-des-schluessels"},
    )
    assert antwort.status == 401


@pytest.mark.asyncio
async def test_nicht_ascii_im_header_wird_abgewiesen_statt_zu_werfen(
    client: TestClient,
) -> None:
    """Kaeme wider Erwarten etwas Unkodierbares an, gibt es eine 401.

    Frueher endete das in einer 500 - der Server brach ab, statt die Anfrage
    schlicht abzulehnen.
    """
    server = client.server
    async with client.session.post(
        server.make_url("/search"),
        json={"query": "abc"},
        # latin-1-Bytes, die kein gueltiges UTF-8 ergeben.
        headers={"x-swisshub-music-key": "abc\udce7def"},
    ) as antwort:
        assert antwort.status == 401
