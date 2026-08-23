# Voice-Laufzeit fuer SwissHub Music.
#
# Bewusst ein eigenes Abbild: FFmpeg, Opus und yt-dlp gehoeren nicht in das
# Abbild der WebApp, und das Basis-Abbild ist Debian statt Alpine - die
# Audio-Bibliotheken sind dort deutlich zuverlaessiger.
FROM python:3.12-slim

# FFmpeg und Opus zur BAUZEIT, nicht zur Laufzeit: eine Installation beim
# Start macht jeden Neustart von einem Paketserver abhaengig.
RUN apt-get update \
 && apt-get install -y --no-install-recommends ffmpeg libopus0 tini ca-certificates \
 && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY apps/music-runtime/requirements.txt ./requirements.txt
RUN pip install --no-cache-dir -r requirements.txt

COPY apps/music-runtime/swisshub_music ./swisshub_music

# Nicht als root.
RUN useradd --system --create-home swisshub
USER swisshub

# tini raeumt FFmpeg-Kindprozesse ab - ohne Init-Prozess bleiben Zombies
# zurueck, sobald ein Titel uebersprungen wird.
ENTRYPOINT ["/usr/bin/tini", "--"]
CMD ["python", "-m", "swisshub_music"]
