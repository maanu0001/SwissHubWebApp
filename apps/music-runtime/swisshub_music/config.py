"""Konfiguration der Voice-Laufzeit.

Alles kommt aus der Umgebung - es gibt bewusst keine config.json mehr. Die
Legacy-Datei trug sechs Bot-Tokens im Klartext und wurde herumgereicht; genau
das soll sich nicht wiederholen. Die Tokens stehen hier ausschliesslich im
Speicher des Prozesses, der sie braucht, und werden nie protokolliert.
"""

from __future__ import annotations

import os
from dataclasses import dataclass


class ConfigError(RuntimeError):
    """Die Laufzeit startet nicht ohne vollstaendige Konfiguration."""


def _pflicht(name: str) -> str:
    wert = os.environ.get(name, "").strip()
    if not wert:
        raise ConfigError(
            f"{name} fehlt. Die Voice-Laufzeit startet ohne diese Angabe nicht."
        )
    return wert


def _zahl(name: str, standard: int) -> int:
    roh = os.environ.get(name, "").strip()
    if not roh:
        return standard
    try:
        return int(roh)
    except ValueError as fehler:
        raise ConfigError(f"{name} muss eine ganze Zahl sein.") from fehler


@dataclass(frozen=True)
class BotToken:
    """Ein Bot des Pools. `key` ist stabil, das Token bleibt im Prozess."""

    key: str
    typ: str
    token: str

    def __repr__(self) -> str:  # pragma: no cover - reine Schutzmassnahme
        # Ohne dieses Ueberschreiben landete das Token in jedem Traceback und
        # in jedem versehentlichen print(). Genau so entstehen Leaks.
        return f"BotToken(key={self.key!r}, typ={self.typ!r}, token=<verborgen>)"


@dataclass(frozen=True)
class Settings:
    database_url: str
    guild_id: int
    bots: tuple[BotToken, ...]
    api_key: str
    api_host: str
    api_port: int
    heartbeat_seconds: int
    poll_seconds: int


def lade_settings() -> Settings:
    controller = _pflicht("MUSIC_CONTROLLER_TOKEN")

    # Worker als eine kommagetrennte Liste: die Anzahl ist damit frei und
    # nicht auf fuenf festgeschrieben.
    roh_worker = os.environ.get("MUSIC_WORKER_TOKENS", "")
    worker = [t.strip() for t in roh_worker.split(",") if t.strip()]

    bots = [BotToken(key="CONTROLLER", typ="CONTROLLER", token=controller)]
    for nummer, token in enumerate(worker, start=1):
        bots.append(BotToken(key=f"WORKER_{nummer}", typ="WORKER", token=token))

    if len({b.token for b in bots}) != len(bots):
        raise ConfigError(
            "Zwei Bots teilen sich dasselbe Token. Jeder Bot braucht eine eigene "
            "Discord-Anwendung, sonst kann nur einer gleichzeitig verbunden sein."
        )

    return Settings(
        database_url=_pflicht("DATABASE_URL"),
        guild_id=int(_pflicht("DISCORD_GUILD_ID")),
        bots=tuple(bots),
        api_key=_pflicht("MUSIC_RUNTIME_KEY"),
        api_host=os.environ.get("MUSIC_RUNTIME_HOST", "0.0.0.0"),
        api_port=_zahl("MUSIC_RUNTIME_PORT", 7700),
        heartbeat_seconds=_zahl("MUSIC_HEARTBEAT_SECONDS", 30),
        poll_seconds=_zahl("MUSIC_POLL_SECONDS", 1),
    )
