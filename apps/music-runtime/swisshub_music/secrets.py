"""Zugangsdaten aus der zentralen Verwaltung.

Die Bot-Tokens der Voice-Laufzeit standen bisher ausschliesslich in der
Umgebung. Seit sie sich im Dashboard verwalten lassen, liegen sie
verschluesselt in derselben Datenbank, mit der diese Laufzeit ohnehin schon
spricht - ein zweiter Speicher waere ein zweiter Ort, an dem sie veralten
koennen.

Gelesen wird derselbe Umschlag, den `@swisshub/secrets` schreibt:

    v1.<schluesselKennung>.<iv>.<tag>.<geheimtext>       (Teile in base64url)

AES-256-GCM, und der Authentifizierungsanhang ist die Adresse des
Geheimnisses (Bereich, Guild, Anbieter, Feld), mit Nullbytes verbunden. Passt
sie nicht, scheitert die Entschluesselung - ein Geheimtext laesst sich also
nicht von einer Zeile in eine andere kopieren.

Der Hauptschluessel steht in ``MASTER_ENCRYPTION_KEY`` und nirgends sonst.
Ohne ihn faellt diese Datei auf die Umgebung zurueck, statt zu scheitern: eine
Laufzeit, die wegen einer noch nicht abgeschlossenen Umstellung nicht mehr
startet, waere schlechter als eine, die den bisherigen Weg nimmt.
"""

from __future__ import annotations

import base64
import binascii
import hashlib
import os

from cryptography.hazmat.primitives.ciphers.aead import AESGCM

ENVELOPE_VERSION = "v1"
KEY_LENGTH = 32


class SecretError(RuntimeError):
    """Ein gespeichertes Geheimnis liess sich nicht lesen."""


def _b64url(teil: str) -> bytes:
    # base64url ohne Fuellzeichen - Node schreibt es so.
    fehlend = (-len(teil)) % 4
    return base64.urlsafe_b64decode(teil + "=" * fehlend)


def lade_hauptschluessel() -> bytes | None:
    """Der Hauptschluessel als 32 Bytes, oder ``None``."""
    roh = os.environ.get("MASTER_ENCRYPTION_KEY", "").strip()
    if not roh:
        return None

    kandidaten: list[bytes] = []
    if len(roh) == 64:
        try:
            kandidaten.append(bytes.fromhex(roh))
        except ValueError:
            pass
    try:
        kandidaten.append(base64.b64decode(roh, validate=False))
    except (binascii.Error, ValueError):
        pass

    for kandidat in kandidaten:
        if len(kandidat) == KEY_LENGTH:
            return kandidat
    raise SecretError(
        "MASTER_ENCRYPTION_KEY muss 32 Bytes ergeben (openssl rand -base64 32)."
    )


def schluessel_kennung(key: bytes) -> str:
    """Dieselbe Kennung wie in `@swisshub/secrets`: acht Hex-Zeichen."""
    return hashlib.sha256(key).hexdigest()[:8]


def _aad(scope: str, guild_id: str, provider: str, feld: str) -> bytes:
    return "\x00".join([scope, guild_id, provider, feld]).encode("utf-8")


def entschluessele(
    umschlag: str,
    *,
    scope: str,
    guild_id: str,
    provider: str,
    feld: str,
    key: bytes,
) -> str:
    teile = umschlag.split(".")
    if len(teile) != 5:
        raise SecretError("Der Umschlag ist beschaedigt.")

    version, kennung, iv_roh, tag_roh, text_roh = teile
    if version != ENVELOPE_VERSION:
        raise SecretError(f"Unbekannte Umschlag-Fassung «{version}».")
    if kennung != schluessel_kennung(key):
        raise SecretError(
            "Das Geheimnis wurde mit einem anderen MASTER_ENCRYPTION_KEY verschluesselt."
        )

    iv = _b64url(iv_roh)
    tag = _b64url(tag_roh)
    geheimtext = _b64url(text_roh)

    try:
        klartext = AESGCM(key).decrypt(
            iv, geheimtext + tag, _aad(scope, guild_id, provider, feld)
        )
    except Exception as fehler:  # noqa: BLE001 - jeder Fehlschlag ist derselbe Fall
        raise SecretError("Die Entschluesselung ist fehlgeschlagen.") from fehler
    return klartext.decode("utf-8")
