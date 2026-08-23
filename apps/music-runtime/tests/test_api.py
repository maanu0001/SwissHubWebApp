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
SCHLUESSEL = "geheim-mit-üäö-und-€-zeichen"


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
    """Ein Schluessel mit Nicht-ASCII darf die Schnittstelle nicht lahmlegen."""
    antwort = await client.post(
        "/search",
        json={"query": "", "limit": 1},
        headers={"x-swisshub-music-key": SCHLUESSEL},
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
        headers={"x-swisshub-music-key": SCHLUESSEL},
    )
    assert antwort.status == 400
