"""Konfiguration der Voice-Laufzeit.

Die Bot-Tokens kommen aus der zentralen Verwaltung des Dashboards: sie liegen
verschluesselt in derselben Datenbank, mit der diese Laufzeit ohnehin spricht,
und werden hier mit dem ``MASTER_ENCRYPTION_KEY`` gelesen. Steht dort nichts -
oder fehlt der Hauptschluessel -, gilt weiterhin die Umgebung; so laesst sich
umstellen, ohne die Musik abzuschalten.

Es gibt bewusst keine config.json mehr. Die Legacy-Datei trug sechs Bot-Tokens
im Klartext und wurde herumgereicht; genau das soll sich nicht wiederholen.
Die Tokens stehen ausschliesslich im Speicher des Prozesses, der sie braucht,
und werden nie protokolliert.
"""

from __future__ import annotations

import logging
import os
from dataclasses import dataclass, replace

import asyncpg

from .secrets import SecretError, entschluessele, lade_hauptschluessel

log = logging.getLogger("swisshub.music.config")


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
    # Rueckfall aus der Umgebung. Ob er gebraucht wird, entscheidet sich erst
    # nach `lade_bots_aus_datenbank` - deshalb hier keine Pflicht mehr.
    #
    # Der Controller ist der Systembot, also DISCORD_BOT_TOKEN. Das frueher
    # dafuer gedachte MUSIC_CONTROLLER_TOKEN wird noch gelesen, aber nur, wenn
    # das erste fehlt: eine Installation, die es noch gesetzt hat, faellt
    # dadurch nicht aus, und wer nichts tut, bekommt den Systembot.
    controller = (
        os.environ.get("DISCORD_BOT_TOKEN", "").strip()
        or os.environ.get("MUSIC_CONTROLLER_TOKEN", "").strip()
    )

    # Worker als eine kommagetrennte Liste: die Anzahl ist damit frei und
    # nicht auf fuenf festgeschrieben.
    roh_worker = os.environ.get("MUSIC_WORKER_TOKENS", "")
    worker = [t.strip() for t in roh_worker.split(",") if t.strip()]

    bots = (
        [BotToken(key="CONTROLLER", typ="CONTROLLER", token=controller)]
        if controller
        else []
    )
    for nummer, token in enumerate(worker, start=1):
        bots.append(BotToken(key=f"WORKER_{nummer}", typ="WORKER", token=token))

    if bots and len({b.token for b in bots}) != len(bots):
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


async def lade_bots_aus_datenbank(settings: Settings) -> Settings:
    """Die Bot-Tokens aus der zentralen Verwaltung uebernehmen.

    **Controller ist der Systembot.** Er benutzt dasselbe Token wie die
    SwissHub-Anwendung - es steht unter ``discord.botToken`` und nicht als
    eigener Eintrag. Damit braucht der Musik-Controller keine zweite
    Discord-Anwendung mehr; er erscheint im Sprachkanal als der Bot, den alle
    ohnehin kennen.

    Der Bot hat dadurch zwei Gateway-Verbindungen: die des Node-Prozesses und
    diese hier. Discord laesst das zu, und die Voice-Verbindung gehoert
    eindeutig dieser Sitzung, weil nur sie Opcode 4 sendet. Der Node-Prozess
    betritt selbst nie einen Sprachkanal.

    **Worker sind eigene Anwendungen** mit eigenem Token, angelegt im
    Dashboard.

    Rueckwaertskompatibel und ausfallsicher: findet sich nichts, bleibt es bei
    dem, was aus der Umgebung kam. Eine Laufzeit, die wegen einer halb
    abgeschlossenen Umstellung nicht mehr startet, waere die schlechtere
    Antwort auf ein fehlendes Token.
    """
    key = lade_hauptschluessel()
    if key is None:
        log.info(
            "Kein MASTER_ENCRYPTION_KEY gesetzt - die Bot-Tokens kommen aus der Umgebung"
        )
        return settings

    try:
        verbindung = await asyncpg.connect(settings.database_url)
    except Exception:
        log.warning("Datenbank nicht erreichbar - die Bot-Tokens kommen aus der Umgebung")
        return settings

    try:
        # Der Controller: das Token der Anwendung selbst.
        controller_zeile = await verbindung.fetchrow(
            """
            SELECT ciphertext, scope, "guildId"
              FROM "IntegrationSecret"
             WHERE provider = 'discord' AND key = 'botToken'
             LIMIT 1
            """
        )
        # Die Worker: je eine eigene Anwendung mit eigenem Token.
        worker_zeilen = await verbindung.fetch(
            """
            SELECT b.id, b.slug, s.ciphertext, s.scope, s."guildId"
              FROM "IntegrationBot" b
              JOIN "IntegrationSecret" s
                ON s.provider = 'bot:' || b.id AND s.key = 'token'
             WHERE b.enabled = true
               AND b.kind = 'MUSIC_WORKER'
             ORDER BY b.position ASC, b.label ASC
            """
        )
    except Exception:
        log.warning("Bot-Tokens konnten nicht gelesen werden - es gilt die Umgebung")
        return settings
    finally:
        await verbindung.close()

    if controller_zeile is None and not worker_zeilen:
        return settings

    def lies(zeile, provider: str, feld: str, name: str) -> str | None:
        try:
            return entschluessele(
                zeile["ciphertext"],
                scope=zeile["scope"],
                guild_id=zeile["guildId"],
                provider=provider,
                feld=feld,
                key=key,
            )
        except SecretError as fehler:
            # Ohne Token laeuft dieser eine Bot nicht - die uebrigen schon.
            # Der Grund wird genannt, das Token niemals.
            log.error("Token von %s ist nicht lesbar: %s", name, fehler)
            return None

    bots: list[BotToken] = []

    if controller_zeile is not None:
        token = lies(controller_zeile, "discord", "botToken", "CONTROLLER")
        if token:
            bots.append(BotToken(key="CONTROLLER", typ="CONTROLLER", token=token))

    for zeile in worker_zeilen:
        token = lies(zeile, f"bot:{zeile['id']}", "token", zeile["slug"])
        if token:
            bots.append(BotToken(key=zeile["slug"], typ="WORKER", token=token))

    if not bots:
        log.warning("Kein lesbares Token in der Verwaltung - es gilt die Umgebung")
        return settings

    if len({bot.token for bot in bots}) != len(bots):
        raise ConfigError(
            "Zwei Bots teilen sich dasselbe Token. Jeder Bot braucht eine eigene "
            "Discord-Anwendung, sonst kann nur einer gleichzeitig verbunden sein."
        )

    log.info("%d Bot-Tokens aus der zentralen Verwaltung uebernommen", len(bots))
    return replace(settings, bots=tuple(bots))
