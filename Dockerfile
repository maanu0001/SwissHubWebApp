# SwissHub Bot WebApp - Multi-Stage Build (WebApp + Bot)
#
#   docker build --target web -t swisshub-web .
#   docker build --target bot -t swisshub-bot .
#
# Secrets werden NIEMALS ins Image kopiert - sie kommen zur Laufzeit aus der
# Umgebung (siehe .env.example / docker-compose.prod.yml).

# --- Abhaengigkeiten ---------------------------------------------------------
FROM node:22-alpine AS deps
WORKDIR /app
RUN apk add --no-cache libc6-compat openssl

COPY package.json package-lock.json ./
COPY apps/web/package.json ./apps/web/
COPY apps/bot/package.json ./apps/bot/
COPY packages/auth/package.json ./packages/auth/
COPY packages/automation/package.json ./packages/automation/
COPY packages/config/package.json ./packages/config/
COPY packages/database/package.json ./packages/database/
COPY packages/discord/package.json ./packages/discord/
COPY packages/logger/package.json ./packages/logger/
COPY packages/modules/package.json ./packages/modules/
COPY packages/permissions/package.json ./packages/permissions/
COPY packages/secrets/package.json ./packages/secrets/
COPY packages/shared/package.json ./packages/shared/

RUN npm ci --no-audit --no-fund

# --- Build -------------------------------------------------------------------
FROM node:22-alpine AS builder
WORKDIR /app
RUN apk add --no-cache libc6-compat openssl
ENV NEXT_TELEMETRY_DISABLED=1

COPY --from=deps /app/node_modules ./node_modules
# Kann npm eine Abhaengigkeit nicht in den gemeinsamen Ordner hochziehen -
# etwa weil zwei Workspaces unvereinbare Versionen verlangen -, legt es sie
# unter `apps/<name>/node_modules` bzw. `packages/<name>/node_modules` ab.
# Diese Ordner muessen mit, sonst fehlt dem fertigen Abbild ein Paket, das
# beim Bauen noch da war. Genau so ist `sharp` schon einmal verlorengegangen:
# der Bot fand es zur Laufzeit nicht mehr und startete gar nicht erst.
# `.dockerignore` schliesst `**/node_modules` nur fuer den Build-Kontext aus,
# nicht fuer `COPY --from`.
COPY --from=deps /app/apps ./apps
COPY --from=deps /app/packages ./packages
COPY . .

# Prisma Client generieren (benoetigt keine laufende Datenbank).
RUN npx prisma generate --schema packages/database/prisma/schema.prisma

# Die WebApp validiert die Umgebung erst zur Laufzeit; fuer den Build genuegen
# Platzhalter, die niemals im Image landen (nur Build-Argumente).
ARG NEXT_PUBLIC_APP_URL=http://localhost:3000
ENV NEXT_PUBLIC_APP_URL=${NEXT_PUBLIC_APP_URL}

# Feste Obergrenze fuer den Heap des Builds.
#
# Ohne sie waehlt V8 die Grenze nach dem Arbeitsspeicher der Maschine. Auf
# einem knapp bemessenen Server heisst das: der Build waechst, bis das System
# auszulagern beginnt, und laeuft danach zwar weiter, aber um Groessenordnungen
# langsamer - er scheitert nicht, er steht. Genau so ist ein Deployment einmal
# ins 30-Minuten-Zeitlimit gelaufen.
#
# Mit einer Grenze raeumt V8 rechtzeitig auf, statt zu wachsen. Reicht der
# Platz wirklich nicht, bricht der Build mit «heap out of memory» ab - eine
# klare Meldung nach zwei Minuten ist besser als eine halbe Stunde Stillstand.
ENV NODE_OPTIONS=--max-old-space-size=1536

# Erst pruefen, dann bauen - und zwar in getrennten Prozessen.
#
# `next build` tat beides in einem: uebersetzen und anschliessend die Typen
# der ganzen Anwendung pruefen. Der Heap trug dadurch die Artefakte der
# Uebersetzung und das vollstaendige Typprogramm gleichzeitig und lief ueber
# die Grenze oben. Gescheitert ist das nicht beim Uebersetzen - das war nach
# 65 Sekunden durch - sondern erst bei «Linting and checking validity of
# types».
#
# Hier laufen dieselben Pruefungen, nur nacheinander und jede mit eigenem
# Heap. Ein Lint- oder Typfehler bricht das Abbild weiterhin ab; er tut es
# eine Stufe frueher und mit einer deutlicheren Meldung.
RUN npm run lint

# Die Typpruefung laeuft **nicht** hier, sondern in der Pipeline - beide.
#
# ## Wie es dazu kam
#
# In zwei Schritten, und beide waren dasselbe Scheitern.
#
# Zuerst die WebApp: sie braucht zwischen 1536 und 1700 MB Heap, passte damit
# nicht unter die Grenze oben und zog aus. Der Kommentar von damals sagte den
# Rest voraus - «das Programm waechst mit jedem Modul, beim naechsten stuenden
# wir wieder hier».
#
# Der naechste war «SwissHub fragt». Mit ihm scheiterte
# `npx tsc -p tsconfig.json --noEmit` an derselben Stelle: «Ineffective
# mark-compacts near heap limit», nach 50 Sekunden, im Bauschritt des Bots
# (Deploy-Laeufe 77 und 78). Der Validierungsjob derselben Commits war gruen -
# dort gibt es genug Speicher.
#
# ## Warum nicht die Grenze anheben
#
# Weil der Server 2 GB hat und waehrend des Baus Postgres, Web und Bot
# weiterlaufen. Ueber der Grenze scheitert der Build nicht, er **steht**: das
# System beginnt auszulagern, und ein Deployment ist so schon einmal ins
# 30-Minuten-Zeitlimit gelaufen. Eine klare Meldung nach zwei Minuten ist
# besser. Und beim naechsten Modul stuenden wir wieder hier.
#
# ## Was die Pruefung jetzt traegt
#
# `.github/workflows/deploy.yml`, Job «Validate»: `npm run typecheck` fuehrt
# beide Aufrufe aus - Monorepo und WebApp -, auf demselben Commit, auf einer
# Maschine mit genug Speicher. Der Deploy-Job haengt mit `needs: validate`
# daran: ohne gruene Typpruefung entsteht kein Abbild.
#
# Damit ist die Pruefung nicht schwaecher geworden, sondern nur woanders. Was
# sie schwaecher machen wuerde, ist das Weglassen an beiden Stellen - und genau
# dagegen steht `tests/unit/build-pruefungen.test.ts`.
#
# Sie braucht zwischen 1536 und 1700 MB Heap - gemessen, nicht geschaetzt -
# und passt damit nicht mehr unter die Grenze oben. Die Grenze anzuheben
# waere keine Loesung: der Server hat 2 GB, waehrend des Baus laufen
# Postgres, Web und Bot weiter, und das Programm waechst mit jedem Modul.
# Beim naechsten stuenden wir wieder hier.
#
# Geprueft wird sie trotzdem, und zwar vollstaendig: `.github/workflows/
# deploy.yml` fuehrt im Job «Validate» `npm run typecheck` aus - dieselben
# zwei Aufrufe, auf demselben Commit, auf einer Maschine mit genug
# Speicher. Der Deploy-Job haengt mit `needs: validate` daran; ohne gruene
# Typpruefung gibt es kein Abbild.
#
# `tests/unit/build-pruefungen.test.ts` haelt die drei Dateien zusammen:
# wer die Pruefung aus der Pipeline nimmt, bekommt einen roten Test und
# nicht ein stilles Loch.

# Sagt `next.config.ts`, dass die Pruefung schon gelaufen ist.
ENV SWISSHUB_SPLIT_BUILD_CHECKS=1
RUN npm run build --workspace @swisshub/web

# --- WebApp ------------------------------------------------------------------
FROM node:22-alpine AS web
WORKDIR /app
RUN apk add --no-cache libc6-compat openssl tini && addgroup -S swisshub && adduser -S swisshub -G swisshub
ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    TZ=Europe/Zurich \
    PORT=3000 \
    SWISSHUB_UPLOAD_DIR=/var/lib/swisshub/uploads

# Ablage fuer hochgeladene Dateien (Logo). Sie muss dem Dienstbenutzer gehoeren:
# ein Docker-Volume wird sonst als root angelegt und der Upload scheitert mit
# "permission denied". Die Rechte des Verzeichnisses bleiben beim Mounten eines
# leeren Volumes erhalten.
RUN mkdir -p /var/lib/swisshub/uploads && chown -R swisshub:swisshub /var/lib/swisshub

COPY --from=builder --chown=swisshub:swisshub /app/node_modules ./node_modules
COPY --from=builder --chown=swisshub:swisshub /app/package.json ./package.json
COPY --from=builder --chown=swisshub:swisshub /app/packages ./packages
COPY --from=builder --chown=swisshub:swisshub /app/apps/web ./apps/web

USER swisshub
EXPOSE 3000
ENTRYPOINT ["/sbin/tini", "--"]
CMD ["npm", "run", "start", "--workspace", "@swisshub/web"]

# --- Bot ---------------------------------------------------------------------
FROM node:22-alpine AS bot
WORKDIR /app
# font-dejavu und fontconfig werden fuer die Levelkarte gebraucht: sharp
# rastert dafuer ein SVG mit Text, und ohne installierte Schrift bliebe die
# Karte leer. DejaVu Sans ist dieselbe Schrift, die der alte Level-Bot nutzte.
RUN apk add --no-cache libc6-compat openssl tini font-dejavu fontconfig \
    && addgroup -S swisshub && adduser -S swisshub -G swisshub
ENV NODE_ENV=production \
    TZ=Europe/Zurich

COPY --from=builder --chown=swisshub:swisshub /app/node_modules ./node_modules
COPY --from=builder --chown=swisshub:swisshub /app/package.json ./package.json
COPY --from=builder --chown=swisshub:swisshub /app/packages ./packages
COPY --from=builder --chown=swisshub:swisshub /app/apps/bot ./apps/bot

USER swisshub
# tini leitet SIGTERM korrekt weiter -> sauberer Shutdown des Bots.
ENTRYPOINT ["/sbin/tini", "--"]
CMD ["npm", "run", "start", "--workspace", "@swisshub/bot"]
