# Voice Hub

Eigene Sprachkanäle auf Zuruf: Wer einen Hub-Channel betritt, bekommt seinen
eigenen Talk – mit Bedienfeld direkt im Kanal und derselben Verwaltung im
Dashboard.

Es gibt **eine** Temp-Voice-Engine. Der Knopf im Talk und der Knopf im
Dashboard rufen dieselben Funktionen auf – dieselbe Zugriffsprüfung, dieselbe
Rechtevergabe auf Discord, derselbe Verlauf. Und die Spielersuche legt ihre
Sprachkanäle über dieselbe Engine an.

```
Hub betreten (Discord) ─┐
Bedienfeld im Talk     ─┼─► voiceHub-Aktionen ─► TemporaryVoiceService ─► Discord-Kanal
Dashboard (Web)        ─┘        (Zugriff)                              └─► Zeile + Verlauf + Audit
                                                                         ▲
Spielersuche ────────────────────────────────────────────────────────────┘
```

Ein Talk lebt an zwei Orten gleichzeitig: als Discord-Kanal und als Zeile.
Der Kanal ist verletzlich – jemand löscht ihn von Hand, Discord ist kurz weg,
der Bot startet neu. Deshalb ist **die Zeile die Wahrheit und der Kanal die
Darstellung**. Was auseinanderläuft, bringt der Abgleich wieder zusammen.

---

## 1. Einrichtung

Reihenfolge, weil jeder Schritt den vorherigen braucht:

1. **Presets** (`/voice/presets`)
   Beim Einschalten des Moduls entstehen drei Vorlagen – _Standard Talk_,
   _Duo_, _Privat_. Sie lassen sich ändern; wer sie nicht mag, legt eigene an.
2. **Hub-Channels** (`/voice/hubs`)
   Ein leerer Sprachkanal zum Betreten, eine Zielkategorie für die neuen
   Talks, ein Preset. Optional eine Ausweichkategorie: Discord erlaubt 50
   Kanäle je Kategorie.
3. **Berechtigungen** (`/server/permissions`)
   Ohne eine Rolle mit `voiceHub.use` kann niemand einen Talk öffnen. Das ist
   kein Fehler, sondern die Voreinstellung dieses Rechtesystems.
4. **Moduleinstellungen** (`/modules/voiceHub`)
   Talks je Person, Schonfrist, Bedienfeld, Voreinstellungen, Bitrate.
5. **Modul einschalten** (`/modules`)
   Das Modul ist standardmässig **aus**: es legt Discord-Kanäle an, und das
   soll erst geschehen, wenn Hub und Kategorie stehen.

Die Gesundheitsprüfung auf `/modules/voiceHub` meldet jeden dieser Schritte,
der noch fehlt – auch, dass keine Rolle «Eigenen Talk erstellen» hat.

### Discord-Rechte des Bots

`MANAGE_CHANNELS`, `VIEW_CHANNEL`, `MOVE_MEMBERS`, `CONNECT`,
`SEND_MESSAGES`, `EMBED_LINKS`, `READ_MESSAGE_HISTORY`.

Ohne `MOVE_MEMBERS` entsteht der Talk zwar, aber niemand landet darin. Ohne
`SEND_MESSAGES`/`EMBED_LINKS` fehlt das Bedienfeld – der Talk funktioniert
trotzdem, bedient wird er dann im Dashboard.

### Intents

Der Bot muss sehen, wer in welchem Kanal sitzt – sonst entsteht kein Talk, und
ein leer gewordener fiele niemandem auf. Dafür sorgt `GuildVoiceStates`; das
ist kein privilegiertes Intent und im Bot fest gesetzt, es gibt dazu nichts
einzuschalten.

`GuildMembers` ist privilegiert und wird ebenfalls gebraucht – für Anzeigenamen
und um zu erkennen, dass ein Übergabeziel ein Bot ist. Der Bot setzt es fest;
fehlt die Freigabe, kommt er gar nicht erst hoch:

> Discord Developer Portal → Applications → SwissHub Bot → Bot →
> Privileged Gateway Intents → **Server Members Intent** einschalten

### Wer im Kanal sitzt

Das Dashboard ist ein eigener Prozess und sieht kein Gateway. Wer gerade in
welchem Sprachkanal sitzt, schreibt deshalb der Bot in `VoicePresence`, und
alles andere liest von dort. Läuft der Bot nicht, weiss das Dashboard nichts
über Anwesenheit – die Talks bleiben trotzdem bedienbar.

---

## 2. Join-to-Create

Betritt jemand den Hub-Channel:

1. Modul an? Wartungsmodus aus? Hub aktiv?
2. Darf diese Person diesen Hub nutzen (`voiceHub.use`, Rollen des Hubs und
   des Presets)?
3. Hat sie hier schon einen Talk? Dann **kein zweiter**, sondern zurück in den
   eigenen. Das ist fast immer, was gemeint war.
4. Sonst: Zeile anlegen → Kanal auf Discord → Person hineinschieben →
   Bedienfeld posten.

### Ein Beitritt, ein Talk

Discord schickt `VoiceStateUpdate` durchaus mehrfach. Zwei Ereignisse
Millisekunden auseinander würden zwei Kanäle erzeugen, wenn die Prüfung aus
Schritt 3 zwischen Lesen und Schreiben überholt werden kann – und das kann
sie.

Deshalb entscheidet die Datenbank: `TemporaryVoiceChannel.activeOwnerKey` ist
gefüllt, solange ein Talk aus einem Hub offen ist, und
`@@unique([guildId, hubId, activeOwnerKey])` lässt davon genau einen zu. Der
zweite Versuch scheitert an der Eindeutigkeit statt an einer Prüfung.

Der Schlüssel **folgt dem Besitz** und wandert bei einer Übergabe mit. Bliebe
er beim Erzeuger, widerspräche die Datenbank dem Beitritt: der prüft auf
Besitz, und wer längst übergeben hat, bekäme «Du hast hier bereits einen
Talk» zu lesen, obwohl er keinen besitzt. Die Kehrseite ist eine Übergabe an
jemanden, der im selben Hub schon einen Talk hat – die schlägt fehl, und das
ist die Wahrheit und keine Falschmeldung.

Kanäle der Spielersuche haben keinen Hub und lassen den Schlüssel leer: dort
entscheidet die Spielersuche, wie viele Suchen jemand gleichzeitig hat.

### Reihenfolge: erst die Zeile, dann Discord

Erst die Reservierung (eine Zeile ohne `discordChannelId`), dann der Kanal.
Andersherum gäbe es im Fehlerfall einen Kanal, von dem die Anwendung nichts
weiss – und den folglich auch kein Abgleich je wiederfände.

Der Discord-Aufruf liegt ausdrücklich **nicht** in der Transaktion: er dauert
je nach Laune der API hunderte Millisekunden, und solange soll niemand eine
Sperre halten. Scheitert er, verschwindet der eben angelegte Kanal wieder und
die Reservierung mit ihm.

---

## 3. Das Bedienfeld

Das Bedienfeld steht im **integrierten Textchat des Talks selbst** – nicht in
einem `#voice-control`, nicht im Bot-Kanal, nicht per DM. Wer im Talk ist,
sieht es; wer nicht, sieht es nicht. Discord erledigt damit die halbe
Zugriffsfrage von selbst.

| Knopf                      | Wirkung                                     |
| -------------------------- | ------------------------------------------- |
| ✏️ Umbenennen              | Modal, gegen die Abkühlzeit des Presets     |
| 👥 Limit                   | Modal, höchstens `maxUserLimit` des Presets |
| 🔒 Sperren / 🔓 Entsperren | `CONNECT` für `@everyone`                   |
| 👁 Verstecken / Zeigen      | `VIEW_CHANNEL` für `@everyone`              |
| 👤 Zugriff                 | Mitglied zulassen, sperren, entfernen       |
| 👑 Übergeben               | Auswahl des neuen Besitzers                 |
| ⚙️ Mehr                    | Bitrate, Thema, Bedienfeld erneuern         |
| 🗑️ Löschen                 | mit Rückfrage                               |

Der Klick prüft **jedes Mal neu**, wem der Talk gerade gehört. Wer das
Bedienfeld ursprünglich bekommen hat, sagt nichts darüber aus, wer es jetzt
bedienen darf: der Talk kann inzwischen übergeben worden sein, und die alte
Nachricht steht trotzdem noch im Kanal.

Hat jemand die Nachricht gelöscht, legt **⚙️ Mehr → Bedienfeld erneuern** sie
neu an – auch aus dem Dashboard.

---

## 4. Besitz

- **Der Besitzer verlässt den Talk.** Nicht sofort übergeben: wer kurz die
  Verbindung verliert oder in einen anderen Kanal wechselt und zurückkommt,
  soll seinen Talk nicht verlieren. `ownerLeftAt` merkt sich den Zeitpunkt;
  erst wenn die Schonfrist verstreicht, übernimmt der Nächste.
- **Nachfolge**: wer am längsten dabei ist, unter den Anwesenden, ohne Bots.
- **Übergabe von Hand** geht nie an einen Bot und nie an den bisherigen
  Besitzer. Anwesenheit verlangt sie ausdrücklich nicht – aus dem Dashboard
  soll sich ein Talk auch dann übergeben lassen, wenn der Empfänger gerade
  nachlädt. Sitzt der neue Besitzer nicht im Kanal, merkt das der Abgleich und
  lässt die Schonfrist anlaufen wie bei jedem anderen abwesenden Besitzer.
- Zwei gleichzeitige Übergaben können nicht beide gewinnen: die Zeile ändert
  sich nur, wenn der Besitzer noch der erwartete ist.
- Der bisherige Besitzer bleibt gewöhnlicher Teilnehmer – ihn hinauszuwerfen
  wäre eine Strafe für etwas, das er selbst entschieden hat.

Der Besitzer bekommt **keine** `MANAGE_CHANNELS`. Der alte Bot vergab sie;
damit liesse sich der Kanal umbenennen, verschieben oder dauerhaft
umkonfigurieren, vorbei an jeder Abkühlzeit und jedem Höchstwert. Er bekommt,
was eine Session braucht: sprechen, streamen und – wenn das Preset es erlaubt
– stummschalten und verschieben.

---

## 5. Aufräumen

Zwei Dinge müssen einen Neustart des Bots überleben: der Löschauftrag eines
leeren Kanals und die Schonfrist eines verwaisten Talks. Beides steht als
**Zeitpunkt in der Datenbank**, nicht als `setTimeout` im Arbeitsspeicher –
ein Zeitgeber, der beim Neustart verschwindet, lässt leere Kanäle für immer
stehen.

Der Abgleich läuft periodisch und holt nach, was liegen geblieben ist:

| Fall                                  | Was geschieht                             |
| ------------------------------------- | ----------------------------------------- |
| Kanal auf Discord weg                 | Zeile schliessen                          |
| Reservierung nie fertig geworden      | Zeile schliessen                          |
| Leer und Frist abgelaufen             | Kanal löschen                             |
| Leer, noch keine Frist                | Frist setzen                              |
| Wieder besetzt                        | Frist aufheben                            |
| Besitzer sitzt nicht drin, ohne Frist | Frist anlaufen lassen                     |
| Besitzer weg, Frist abgelaufen        | an den Nächsten übergeben                 |
| Besitzer hat den Server verlassen     | sofort übergeben, sonst löschen einplanen |

Er ist damit zugleich die Rettung nach einem Absturz und das Netz gegen
Ereignisse, die Discord nie geschickt hat.

**Fremde Quellen fasst er nicht an.** Ein Kanal der Spielersuche wird gezählt,
aber weder gelöscht noch neu vergeben: wann eine Suche endet, weiss nur die
Spielersuche – sie schliesst dabei auch die Suche –, und niemand erbt eine
Suche, nur weil er länger im Kanal sitzt.

---

## 6. Spielersuche

Die Spielersuche legte ihre Sprachkanäle schon vor dem Voice Hub an. Sie tut
es weiterhin, aber über dieselbe Engine – ein zweites Temp-Voice-System neben
dem ersten wäre genau das, was hier nicht entstehen soll.

Was dabei ausdrücklich gleich geblieben ist:

- Der Kanal ist **für alle offen**, unabhängig von der Kategorie – damit
  spontan jemand dazustossen kann. Genau so hielt es der alte Bot.
- Das Teilnehmerlimit folgt der Squad-Grösse des Spiels.
- Der Zugang (`gateway`) wird durchgereicht, nicht global genommen.
- Wann der Kanal verschwindet, entscheidet weiterhin die Spielersuche.

Was sie dazugewonnen hat: eine Zeile, einen Eintrag im Abgleich und dieselbe
Aufräumlogik nach einem Neustart.

---

## 7. Berechtigungen

Getrennt nach dem, was jemand mit dem **eigenen** Talk tut, und dem, was
jemand mit **fremden** tut.

| Recht                        | Bedeutung                                           |
| ---------------------------- | --------------------------------------------------- |
| `voiceHub.view`              | Den Bereich im Dashboard öffnen                     |
| `voiceHub.use`               | Über einen Hub einen Talk öffnen                    |
| `voiceHub.manageOwn`         | Name, Limit, Sperre, Sichtbarkeit des eigenen Talks |
| `voiceHub.manageUsers`       | Zugriff im eigenen Talk steuern                     |
| `voiceHub.transferOwnership` | Den eigenen Talk abgeben                            |
| `voiceHub.admin.view`        | Alle laufenden Talks sehen                          |
| `voiceHub.admin.manage`      | Fremde Talks verwalten                              |
| `voiceHub.admin.delete`      | Einen laufenden Talk beenden                        |
| `voiceHub.hubs.manage`       | Hub-Channels verwalten                              |
| `voiceHub.presets.manage`    | Vorlagen verwalten                                  |
| `voiceHub.settings`          | Moduleinstellungen ändern                           |
| `voiceHub.stats.view`        | Auswertungen ansehen                                |

Wer beides hat, bekommt die Vereinigung: ein Administrator soll seinen eigenen
Talk nicht schlechter verwalten können als einen fremden.

Nicht vorhanden und nicht zugänglich antworten **gleich** (`NOT_FOUND`) –
sonst liesse sich an der Antwort ablesen, welche Talks es gibt und wem sie
gehören.

---

## 8. Namensvorlagen

`{username}`, `{displayName}`, `{game}`, `{number}`.

Alles, was kein Buchstabe, keine Ziffer, kein Leerzeichen, kein Emoji und
keine gewöhnliche Zeichensetzung ist, fällt weg – auch `@`, `#` und `<`. Ein
Kanalname erzeugt zwar keine Erwähnung, aber `@everyone` im Namen einer
Kanalliste ist ein Trick, den niemand braucht.

Unbekannte Platzhalter bleiben stehen. Sie als Fehler zu behandeln hiesse,
dass ein Tippfehler in den Einstellungen das Erstellen von Talks verhindert;
ein sichtbarer Platzhalter im Kanalnamen fällt auf und lässt sich beheben.

---

## 9. Rechte auf Discord

Der Voice Hub setzt **nur die Bits, die er selbst verwaltet**, und lässt alles
andere in einer Ausnahme unangetastet. Wer im Talk von Hand eine Ausnahme
gesetzt hat, verliert sie nicht, weil jemand das Limit ändert.

Sperren und Verstecken arbeiten auf `@everyone`:

- gesperrt → `CONNECT` verweigert
- versteckt → `VIEW_CHANNEL` und `CONNECT` verweigert
- keins von beidem → **keine** Ausnahme für `@everyone`, der Kanal erbt die
  Kategorie

Der letzte Punkt ist der Grund, warum ein Talk in einer nur für Mitglieder
sichtbaren Kategorie auch nur für Mitglieder sichtbar ist – ohne dass der Hub
davon wissen muss.

---

## 10. Statistik

Geschlossene Talks bleiben als Zeile stehen: Dauer, Höchststand an
Teilnehmern, Quelle, Hub. `historyRetentionDays` sagt, wie lange – `0`
bedeutet unbegrenzt.

Der Verlauf (`VoiceHubEvent`) hält fest, wer was getan hat. Er ist wichtig,
aber nicht wichtiger als die Aktion selbst: scheitert das Schreiben, wird es
protokolliert und die Aktion gilt trotzdem.
