"""Die Voice-Laufzeit liest denselben Umschlag wie die WebApp.

Zwei Sprachen, ein Format. Was hier schiefgeht, faellt im Betrieb erst auf,
wenn ein Bot sich nicht mehr anmeldet - deshalb steht der Umschlag unten als
fester Wert und nicht als etwas, das dieser Test sich selbst erzeugt. Er
stammt aus `packages/secrets/src/crypto.ts`; wuerde dort das Format geaendert,
faellt genau dieser Test.
"""

from __future__ import annotations

import base64

import pytest

from swisshub_music.secrets import (
    SecretError,
    entschluessele,
    lade_hauptschluessel,
    schluessel_kennung,
)

# 32 Bytes, jedes davon 0x09 - dasselbe wie beim Erzeugen des Umschlags.
KEY = base64.b64encode(bytes([9] * 32)).decode("ascii")

# Von `encryptSecret` in TypeScript erzeugt, Adresse:
#   scope=GLOBAL, guildId='', provider='bot:abc123', key='token'
UMSCHLAG = (
    "v1.8c0cc17a.CwONXd7Yrz1E4rQy."
    "NFhubzc1TrbvQBTcJHJcYA.Y2MbrrjSX1Y49-lXh0L08k7i7u2eWAZ9P28hs-WzqRtTyKU"
)
KLARTEXT = "kein-echtes-token-musik-worker-0003"

ADRESSE = dict(scope="GLOBAL", guild_id="", provider="bot:abc123", feld="token")


@pytest.fixture()
def key(monkeypatch: pytest.MonkeyPatch) -> bytes:
    monkeypatch.setenv("MASTER_ENCRYPTION_KEY", KEY)
    geladen = lade_hauptschluessel()
    assert geladen is not None
    return geladen


def test_liest_einen_umschlag_aus_der_webapp(key: bytes) -> None:
    assert entschluessele(UMSCHLAG, key=key, **ADRESSE) == KLARTEXT


def test_kennung_stimmt_mit_der_webapp_ueberein(key: bytes) -> None:
    # Die Kennung steht im Umschlag; passt sie nicht, war es ein anderer
    # Hauptschluessel - und das soll eine verstaendliche Meldung geben.
    assert UMSCHLAG.split(".")[1] == schluessel_kennung(key)


def test_verweigert_einen_anderen_hauptschluessel(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("MASTER_ENCRYPTION_KEY", base64.b64encode(bytes([1] * 32)).decode())
    anderer = lade_hauptschluessel()
    assert anderer is not None
    with pytest.raises(SecretError, match="anderen MASTER_ENCRYPTION_KEY"):
        entschluessele(UMSCHLAG, key=anderer, **ADRESSE)


@pytest.mark.parametrize(
    "abweichung",
    [
        {"provider": "bot:einanderer"},
        {"feld": "clientSecret"},
        {"scope": "GUILD", "guild_id": "1"},
        {"guild_id": "999"},
    ],
)
def test_gilt_nur_an_seiner_adresse(key: bytes, abweichung: dict[str, str]) -> None:
    # Dieselbe Zusage wie in der WebApp: ein Geheimtext laesst sich nicht von
    # einer Zeile in eine andere kopieren.
    with pytest.raises(SecretError):
        entschluessele(UMSCHLAG, key=key, **{**ADRESSE, **abweichung})


def test_erkennt_einen_veraenderten_geheimtext(key: bytes) -> None:
    teile = UMSCHLAG.split(".")
    teile[4] = ("B" if teile[4][0] == "A" else "A") + teile[4][1:]
    with pytest.raises(SecretError):
        entschluessele(".".join(teile), key=key, **ADRESSE)


def test_ohne_hauptschluessel_kein_fehler(monkeypatch: pytest.MonkeyPatch) -> None:
    # Die Laufzeit soll dann auf die Umgebung zurueckfallen, nicht abbrechen.
    monkeypatch.delenv("MASTER_ENCRYPTION_KEY", raising=False)
    assert lade_hauptschluessel() is None


def test_weist_einen_zu_kurzen_hauptschluessel_ab(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("MASTER_ENCRYPTION_KEY", base64.b64encode(bytes(16)).decode())
    with pytest.raises(SecretError, match="32 Bytes"):
        lade_hauptschluessel()


def test_akzeptiert_hex(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("MASTER_ENCRYPTION_KEY", bytes([9] * 32).hex())
    geladen = lade_hauptschluessel()
    assert geladen is not None
    assert entschluessele(UMSCHLAG, key=geladen, **ADRESSE) == KLARTEXT
