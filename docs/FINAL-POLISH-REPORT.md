# FINAL POLISH REPORT

Durchgang zur Produktionsreife der SwissHub Bot WebApp.
Stand: 21. August 2026 · Branch `claude/swisshub-bot-webapp-rmljzl`

Die Legende gilt für den ganzen Bericht:

| Zeichen | Bedeutung                                                                    |
| ------- | ---------------------------------------------------------------------------- |
| ✓       | in dieser Umgebung tatsächlich ausgeführt und am Ergebnis überprüft           |
| ○       | nur statisch geprüft (Quelltext, Konfiguration, Abhängigkeiten)               |
| ⚠       | benötigt einen Test gegen echtes Discord oder die Production-Umgebung         |

---

## 1. Die gemeldeten Fehler

### Doppelte Seitentitel ✓

Die Kopfzeile leitet Titel und Beschreibung aus der Module Registry ab. Vier
Seiten schrieben denselben Text ein zweites Mal in den Seitenkörper:

| Seite            | Was doppelt stand                              |
| ---------------- | ---------------------------------------------- |
| `/level`         | «Level-System» (im Screenshot belegt)          |
| `/spielersuche`  | «Spielersuche» (im Screenshot belegt)          |
| `/jail/import`   | Überschrift und Erklärung des Imports          |
| `/xp-gluecksrad` | «XP-Glücksrad» – dort sogar als zweites `<h1>` |

Nicht nur die beiden gemeldeten Stellen wurden entfernt. `tests/unit/page-headers.test.ts`
prüft jede der 46 Seiten auf drei Regeln: höchstens ein `PageHeader`, kein
eigenes `<h1>` (das gehört der Kopfzeile), und kein Titel, der für diese Route
bereits in der Navigation steht. Die Prüfung wurde gegengetestet – ein wieder
eingefügter Titel lässt sie fehlschlagen.

Im Browser nachgemessen: auf allen 41 aufgerufenen Seiten genau ein `<h1>`.

---

## 2. Das SwissHub-Logo ✓

Das gelieferte Logo liegt als `apps/web/public/branding/swisshub-logo.png` im
Projekt, freigestellt (der schwarze Hintergrund des Uploads wurde zu
Transparenz zurückgerechnet, damit das Logo auf jedem Grund sitzt), dazu
Fassungen in 180px für den Startbildschirm und 32px für das Favicon. Keine
Upload-Adresse, kein temporärer Pfad.

Die beiden Platzhalter-SVGs (`logo.svg`, `logo-mark.svg`) sind entfernt.
`logo.svg` wurde ohnehin von keiner Stelle gelesen.

Den Rückfall auf das Standardlogo kennt jetzt nur noch `brandingLogoUrl()` –
entsprechend dem geforderten `customLogo ?? DEFAULT_SWISSHUB_LOGO`. Vorher
reichte jede Seite den Rückfall selbst durch, und zwei Stellen taten es nicht:
die Navigation auf Mobilgeräten und das Banner am Fuss des Dashboards zeigten
weiter das Platzhalterlogo, auch wenn ein eigenes hochgeladen war.

Im Browser geprüft: Seitenleiste, Kopfzeile, mobile Navigation, Login,
Kein-Zugriff, Einrichtung und Dashboard-Banner laden dasselbe Logo; Favicon und
Apple-Touch-Icon werden ausgeliefert.

---

## 3. Zwei echte Fehler im XP-Glücksrad ✓

Ein sporadisch fehlschlagender Test (`zieht nicht zweimal gleichzeitig`) führte
auf zwei Fehler, die beide Geld – beziehungsweise XP – kosten konnten.

### Fehlende Zeilensperre

`startDraw`, `redraw` und `confirmWinner` lasen die Verlosung mit einem
einfachen `findUnique`, prüften den Zustand und schrieben ihn dann um. Zwei
gleichzeitige Anfragen lasen denselben Zustand und führten beide aus.

Bei der Ziehung fing der eindeutige Schlüssel auf `(raffleId, version)` das nur
ab, solange beide dieselbe Version errechneten. Kam die zweite Anfrage erst
nach dem Festschreiben der ersten dazu, zählte sie hoch und zog ein zweites Mal.

Schwerer wog `confirmWinner`: dort wird der XP-Gewinn gutgeschrieben. **Zwei
gleichzeitige Bestätigungen zahlten zweimal aus.** Der neue Test dazu schlägt
ohne die Sperre reproduzierbar fehl – nachgewiesen, nicht vermutet.

`lockRaffle()` liest die Verlosung nun mit `FOR UPDATE`, nach demselben Muster,
das die Teilnahme bereits für das Level-Profil verwendet. `enterRaffle`
verwendet es ebenfalls: bisher konnte eine Teilnahme noch durchgehen, während
nebenan schon der Auszug für die Ziehung entstand – der Einsatz wurde
abgebucht, die Teilnahme zählte aber nicht mehr mit.

### `startDraw` zog aus `WINNER_PENDING` erneut

Der Zustandsautomat erlaubt `WINNER_PENDING → DRAWING`, damit `redraw`
arbeiten kann. `startDraw` teilte sich diese Prüfung und zog deshalb still
einen neuen Gewinner, statt auf «Neu ziehen» zu verweisen – das eine Begründung
verlangt und den bisherigen Gewinner protokolliert.

Drei Regressionstests in `tests/integration/raffle.test.ts` halten beides fest.
Der Verlosungsteil läuft seither sechsmal hintereinander grün.

---

## 4. Sicherheit

### Umgebungs-Schema im Browser-Bundle ✓ (behoben)

`raffle-wheel.tsx` importierte `getDiscordAvatarUrl` aus `@swisshub/discord`
statt aus dem client-sicheren `@swisshub/discord/cdn`. Über diesen einen Import
landete das vollständige Zod-Schema aus `@swisshub/config` in den
ausgelieferten Dateien: Namen und Validierungsregeln von `DISCORD_BOT_TOKEN`,
`DISCORD_CLIENT_SECRET`, `AUTH_SECRET` und `DATABASE_URL`.

**Werte waren keine dabei** – das Schema beschreibt nur, wie sie aussehen
müssen. Dort gehört trotzdem nichts davon hin.

`tests/unit/client-boundary.test.ts` prüft jetzt jede der 61 Client-Komponenten
darauf, dass sie als Wert nur aus client-sicheren Einstiegspunkten importiert
(reine Typ-Importe bleiben erlaubt, TypeScript entfernt sie). Gegengetestet.

### Weitere Prüfungen

| Prüfung                                                | Ergebnis                                                                                |
| ------------------------------------------------------ | --------------------------------------------------------------------------------------- |
| Secret-Werte im Client-Bundle ✓                        | keine – alle 27 ausgelieferten JavaScript-Dateien gegen die echten `.env`-Werte geprüft            |
| Variablennamen im Bundle ✓                             | nur `AUTH_SECRET`/`DATABASE_URL` als Fliesstext auf `/level/import` – die Erklärung, welche Zugangsdaten beim Import *nicht* gelesen werden |
| `.env` im Repository ✓                                 | nicht im Index, durch `.gitignore` abgedeckt                                             |
| `.env.example` ✓                                       | alle Secret-Felder leer                                                                  |
| Legacy-Bot-Token im Repository oder Git-Verlauf ✓      | nicht vorhanden                                                                          |
| Legacy-Rollen-IDs (`ALLOWED_ROLE_ID`, Ticket-Channel) ✓ | nicht vorhanden                                                                          |
| Berechtigung je Server Action ✓                        | alle 52 Actions – 48 mit fester `permission`, 4 mit ausdrücklicher Prüfung im Rumpf (dort steht die Berechtigung erst zur Laufzeit fest) |
| Eingabeprüfung je Server Action ✓                      | alle 52 mit Zod-Schema                                                                   |
| Rate Limit je Server Action ✓                          | alle 52                                                                                  |
| Exporte aus `'use server'`-Dateien ✓                   | ausschliesslich `defineAction` – kein ungeschützter Endpunkt                              |
| Redaction von Tokens und Cookies in Logs ✓             | durch die bestehende Testabdeckung belegt                                                |
| Content-Security-Policy ○                              | `script-src` an die Nonce gebunden, kein `unsafe-inline` für Skripte                     |
| Production-Start mit Entwicklungswerten ✓              | wird verweigert – `DEV_MOCK_DISCORD` und HTTP-Adresse brechen den Start ab               |

`tests/unit/action-authorization.test.ts` hält die vier Action-Regeln fest,
damit keine neue Action ohne Berechtigung, Schema oder Rate Limit dazukommt.

### Abhängigkeiten ✓

`npm audit` meldete 6 hohe Befunde, jetzt sind es 3:

- **`sharp` 0.34.5 → 0.35.3.** Vier libvips-CVEs. Das war der wichtigste
  Befund: `sharp` verarbeitet hochgeladene Bilder (Logo, Levelkarten-Banner),
  also Daten von aussen. Die Bildtests laufen mit der neuen Fassung durch.
  Diese Anhebung hat allerdings zunächst das Bot-Abbild zerlegt – siehe
  Abschnitt 13.
- **`postcss` → 8.5.26** über einen Override (die in Next gebündelte Fassung
  war verwundbar).
- **Offen: `deepmerge-ts` im Prisma-CLI** (3 Befunde, dieselbe Kette). Betrifft
  nur das CLI beim Lesen der eigenen Konfiguration, nicht die laufende
  Anwendung. Ein Override auf 8.x wurde versucht und wieder zurückgenommen:
  danach findet `@prisma/config` das Paket nicht mehr, und alle
  datenbankgestützten Tests fallen aus. `npm audit fix --force` würde Prisma
  auf 6.12.0 **zurückstufen**, was mit dem aktuellen Schema nicht zusammenpasst.
  Empfehlung: bei der nächsten Prisma-Aktualisierung erledigen.

Ebenfalls offen und bewusst nicht angefasst: `npm audit` möchte für die
PostCSS-Kette in Next auf **Next 16** wechseln. Ein Framework-Hauptversionssprung
gehört nicht in einen Politur-Durchgang. Der Override deckt die Fassung ab, die
tatsächlich verwendet wird.

---

## 5. Bedienelemente ohne Funktion

Gesucht, nichts gefunden – jedes Bedienelement tut etwas. Geprüft im Browser:

| Element                    | Ergebnis                                                                     |
| -------------------------- | ---------------------------------------------------------------------------- |
| Globale Suche ✓            | führt zu `/members?q=…`, liefert Treffer; `Strg`/`Cmd`+`K` setzt den Fokus    |
| Benutzermenü ✓             | öffnet; Profil zeigt auf das eigene Profil, Discord-Link und Abmelden greifen |
| Seitenleiste ein-/ausklappen ✓ | wechselt den Zustand                                                     |
| Premium-Karte ✓            | verlinkt auf den konfigurierten Discord-Server                                |
| Server-Karte ○             | reine Anzeige, kein Auswahlmenü – die Anwendung ist auf eine Guild ausgelegt  |
| Bot-Status ✓               | wechselte beim Start des Bots von «Offline» auf «Online», mit echtem Heartbeat |
| Alle 20 Navigationseinträge ✓ | laden mit Status 200                                                      |
| «Coming Soon»-Reste ✓      | keine im ganzen Quelltext                                                     |

Der Platzhaltertext der Suche lautete «Suche Mitglieder, ID, …» und versprach
mit den Auslassungspunkten mehr, als sie kann. Jetzt: «Mitglied oder
Discord-ID suchen».

---

## 6. Module

| Modul               | Geprüft                                                                                              |
| ------------------- | ---------------------------------------------------------------------------------------------------- |
| Kommunikation ✓     | Neuigkeit erstellt, Bestätigungsdialog, gesendet in 1,07 s ohne Hänger, erscheint im Verlauf und im Audit Log |
| Spielersuche ✓      | Spiel angelegt, Suche gestartet, erscheint unter «Aktive Suchen»                                     |
| Jail ✓              | zweistufiger Dialog, Jail erstellt, erscheint in der Liste                                            |
| XP-Glücksrad ✓      | Seite, Rad, vergangene Ziehungen; Doppelziehung und Doppelauszahlung geschlossen (Abschnitt 3)         |
| Level-System ✓      | Übersicht und alle zwölf aufgerufenen Unterseiten laden                                                               |
| Vote Jail ✓         | Seite lädt                                                                                            |
| ⚠ Alles auf Discord | Slash Commands, Knöpfe, Reaktionen, Sprachkanäle, echtes Senden – hier läuft nur ein Mock-Gateway     |

Nebenbefund: die Fehlermeldungen bei fehlender Konfiguration sind gut. Ohne
Spielersuche-Channel steht «Es ist kein Spielersuche-Channel konfiguriert.
Bitte in den Moduleinstellungen einen Channel wählen.», ohne Jail-Rolle der
entsprechende Hinweis. Beides nennt den Weg zur Abhilfe.

---

## 7. Darstellung

### Seitliches Scrollen auf dem Handy ✓

Auf dem Dashboard liess sich die Seite bei 390 px um 377 px ins Leere ziehen.
Ursache war nicht die breite Tabelle – die liegt korrekt in einem eigenen
Scroll-Bereich –, sondern die `sr-only`-Beschriftung der letzten Spalte: ein
absolut positioniertes Kind wird von einem Scroll-Container nur beschnitten,
wenn dieser selbst positioniert ist. Die gemeinsame Tabellen-Komponente macht
das richtig, zwei handgeschriebene Container nicht.

Im Verlauf der Kommunikation lief die Aktionszeile über, weil sie nicht
umbrechen durfte.

### Nachgemessen ✓

41 Seiten bei 1920×1080, 1440×900, iPad quer (1194×834), iPad hoch (834×1194)
und 390×844: überall Status 200, kein seitliches Scrollen, genau ein `<h1>`
je Seite.

Die Browserkonsole wurde in einem eigenen Durchgang bei 1440×900 über
dieselben 41 Seiten mitgelesen: keine JavaScript-Fehler, keine
Hydration-Warnungen. Die einzigen Meldungen betreffen Avatarbilder von
`cdn.discordapp.com`, das der Sandkasten hier nicht erreicht.

### Weitere Korrekturen

- **Leere Auswahlfelder** blieben leer. Wer die Rollenauswahl öffnete, bevor
  ein Discord-Abgleich gelaufen war, sah ein leeres Kästchen ohne Erklärung.
  Jetzt steht dort «Noch keine Rollen synchronisiert – unter System →
  Discord-Sync abgleichen». Ein allgemeiner Rückfalltext deckt alle übrigen
  Auswahlfelder ab. Gegengetestet.
- **Klickflächen unter 24 px** vergrössert (Zeilentitel in Listen,
  «Erledigen», «Zum Einrichtungsassistenten»). Links mitten im Fliesstext
  blieben unangetastet – dafür gilt die Ausnahme in den Richtlinien.
- **Kennzahlen-Raster** vereinheitlicht: vier Spalten erst ab `xl`, wie es
  Dashboard und die neueren Seiten schon hielten. Auf dem iPad standen die
  Level-Kennzahlen sonst in vier zu engen Spalten mit dreifach umbrechenden
  Beschriftungen.
- **Abgeschnittene Titel** in der Kopfzeile haben einen Tooltip mit dem
  vollen Text.
- **Ladezustände** zeigten einen Titel-Platzhalter samt Trennlinie – eine
  Überschrift also, die die fertige Seite gar nicht hat. Beim Laden erschien
  sie kurz und der Inhalt sprang danach nach oben. Auf dem Handy ragte der
  384px breite Platzhalter des Dashboards zudem seitlich aus dem Bild.
  Betraf alle fünf Ladezustände.

### Bannervorschau ✓

Die Content-Security-Policy liess nur Bilder von Discords CDN zu. Ein Banner
von einer anderen Adresse verschwand in der Vorschau kommentarlos – und der
Vorgänger-Bot verwendete selbst eine imgur-Adresse als Standardbanner. Die
Vorschau log damit über das, was nach dem Senden erscheint.

`img-src` erlaubt jetzt `https:`. Skripte bleiben unberührt: `script-src` ist
weiterhin an die Nonce gebunden. Zusätzlich sagt die Vorschau es jetzt, wenn
sich ein Banner nicht laden lässt, statt es stillschweigend auszublenden.

### Nicht angefasst

Farbpalette, Formensprache, Layout und Aufbau der Seitenleiste sind
unverändert. Es wurde kein Dashboard neu gebaut.

---

## 8. Sprache ✓

Kein Eszett im gesamten Repository – 361 Dateien geprüft, Quelltext wie
Dokumentation. `tests/unit/swiss-german.test.ts` hält das fest und wurde
gegengetestet. (Der Buchstabe steht in diesem Bericht deshalb nicht
ausgeschrieben: die Prüfung liest auch diese Datei – sie hat einen ersten
Entwurf davon prompt beanstandet.)

Die Anrede ist durchgehend «du». Die Fundstellen von «Sie» sind alle das
Personalpronomen am Satzanfang, keine Höflichkeitsform.

---

## 9. Toter Code ✓

- `apps/web/src/components/ui/separator.tsx` – von keiner Stelle verwendet
- sechs ungenutzte Abhängigkeiten (`react-hook-form`, `@hookform/resolvers`,
  vier Radix-Pakete)
- die beiden Platzhalter-Logos

Keine `console.log`-Aufrufe und keine auskommentierten Codeblöcke im
Produktionscode. Von 350 Quelldateien war genau eine verwaist.

---

## 10. Abschliessende Prüfläufe

| Prüfung                                    | Ergebnis                              |
| ------------------------------------------ | ------------------------------------- |
| `npm run lint` ✓                           | sauber                                |
| `npm run typecheck` ✓                      | sauber (beide Projekte)               |
| `npm run test` ✓                           | **806 Tests in 41 Dateien, alle grün** – gegen echtes PostgreSQL |
| `npm run build` ✓                          | WebApp und Bot erfolgreich            |
| `npm ci --dry-run` ✓                       | Lockfile stimmt mit `package.json` überein. **Das sagt nichts darüber aus, ob das fertige Abbild vollständig ist** – siehe Abschnitt 13 |
| ⚠ `docker compose -f docker-compose.prod.yml build` | in dieser Umgebung nicht ausführbar: kein Docker-Daemon |

Vier Testdateien sind neu hinzugekommen und decken Bereiche ab, die vorher nur
durch Hinsehen gesichert waren: Seitentitel (113 Prüfungen), Autorisierung der
Server Actions (106), Server/Browser-Grenze (63) und Schweizer Rechtschreibung
(2). Dazu drei Tests für die Verlosung. Jede der vier Regeln wurde
gegengetestet – der Fehler wieder eingebaut, das Fehlschlagen bestätigt,
zurückgenommen. Ohne diesen Schritt wäre eine bestandene Prüfung wertlos: sie
könnte schlicht nichts prüfen.

---

## 11. Was noch aussteht

**Vor dem Produktivgang zu erledigen:**

1. ⚠ **Docker-Production-Build** auf einer Maschine mit Docker-Daemon.
2. ⚠ **Alles gegen echtes Discord**: Slash Commands registrieren,
   `/post`, `/spielersuche`, XP-Glücksrad-Knopf, Reaktionen auf Umfragen,
   Sprachkanäle der Spielersuche, Levelkarten-Ausgabe.
3. ⚠ **Legacy-Bot-Token rotieren.** Der Token aus `kommunikation_bot.py` stand
   im Klartext in einer Datei, die geteilt wurde. Er ist nirgends im Projekt
   gelandet, muss aber trotzdem auf Discord neu erzeugt werden.
4. ⚠ **HTTPS und die Production-Variablen** setzen. Der Start bricht sonst
   bewusst ab – das ist so gewollt und wurde geprüft.

**Bei Gelegenheit:**

5. `deepmerge-ts` im Prisma-CLI (siehe Abschnitt 4).
6. Next 16 – eigener Vorgang, nicht Teil einer Politur.

---

## 12. Einschätzung

Für alles, was sich hier prüfen liess, ist der Stand tragfähig: 806 Tests
grün, beide Builds erfolgreich, keine Secrets im Bundle, jede Server Action
abgesichert, keine Seite mit seitlichem Scrollen, kein Bedienelement ohne
Funktion.

«Production ready» steht hier bewusst nicht. Zwei Dinge sind ungeprüft, und
beide sind gewichtig: der Docker-Build und das Verhalten gegen echtes Discord.
Der zweite Punkt ist der wesentliche – dieses Projekt ist eine
Discord-Anwendung, und in dieser Umgebung lief ausschliesslich ein
Mock-Gateway. Was der Bot auf einem echten Server tut, hat noch niemand
gesehen.

Bemerkenswert am Durchgang ist, dass die zwei schwersten Funde nicht aus der
Aufgabenliste stammten, sondern aus einem Test, der einmal von zehn Läufen
fehlschlug: eine Verlosung liess sich zweimal ziehen, und ein XP-Gewinn zweimal
gutschreiben.

---

## 13. Nachtrag: der Bot startete nicht mehr

Nach dem Durchgang fiel auf, dass der Bot offline war. Die Ursache lag in
diesem Durchgang selbst.

**Was passiert ist.** Next führt `sharp` als *optionale* Abhängigkeit in
Version `^0.34.3`. Solange der Bot dieselbe Spanne verlangte, legte npm eine
gemeinsame Kopie unter `node_modules/` ab. Mit der Anhebung des Bots auf
`^0.35.3` passte das nicht mehr zusammen, und weil Next's Variante optional
ist, entfernte npm den gemeinsamen Eintrag und legte die Kopie des Bots unter
`apps/bot/node_modules/sharp` ab.

Das Dockerfile reichte zwischen seinen Stufen aber nur den Ordner im
Projektwurzelverzeichnis weiter. Der verschachtelte Ordner blieb in der
Installationsstufe liegen und erreichte das Abbild nie. `level-card.ts`
importiert `sharp` gleich zu Beginn – der Bot brach also schon beim Laden ab,
lange vor der ersten Zeile eigener Logik, und der Container lief in eine
Neustartschleife. Die WebApp war davon nicht betroffen: sie benutzt `sharp`
nicht.

**Behoben in zwei Schritten.**

1. Die Overrides sauber neu auflösen. `sharp@0.35.3` liegt wieder im
   gemeinsamen Ordner und wird von Bot und Next geteilt – kein verschachtelter
   Ordner mehr im Lockfile.
2. Das Dockerfile reicht die `node_modules` der Workspaces jetzt mit weiter.
   Das ist der eigentliche Punkt: die stille Annahme, npm lege jedes Paket im
   Projektwurzelverzeichnis ab, hätte jede beliebige Versionsanhebung genauso
   zerlegt.

**Diesmal richtig geprüft.** Das Bot-Abbild wurde lokal nachgebaut – genau die
vier `COPY`-Zeilen der Bot-Stufe – und darin `sharp` geladen und ein Bild
gerendert. Zur Gegenprobe derselbe Aufbau ohne den gemeinsamen Ordner: dort
scheitert es reproduzierbar mit `Cannot find module 'sharp'`. Anschliessend
lief der Bot mit frischem Heartbeat.

`tests/unit/docker-image.test.ts` hält den Zusammenhang fest: legt npm ein
Paket unter einem Workspace ab, muss das Dockerfile diesen Ordner weiterreichen.
Gegengetestet.

**Was ich daraus mitnehme.** Im Bericht stand `npm ci --dry-run ✓ – der
npm ci-Schritt im Docker-Build wird durchlaufen`. Der Befehl prüft aber nur, ob
Lockfile und `package.json` zueinander passen. Ob die Docker-Stufen das
Ergebnis vollständig weiterreichen, sagt er nicht – und genau dort lag der
Fehler. Ein Häkchen für etwas, das ich nicht wirklich geprüft hatte.
