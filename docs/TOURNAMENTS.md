# Turniere

Turnierbetrieb von der Ausschreibung bis zum Preis – im Dashboard geführt, auf
Discord begleitet, auf einer öffentlichen Seite sichtbar.

Es gibt **ein** Turniersystem. Der Knopf auf Discord und das Formular im
Dashboard rufen dieselben Funktionen auf – dieselbe Anmeldung, dieselbe
Zugriffsprüfung, dasselbe Bracket, derselbe Verlauf.

```
Öffentliche Seite (Web) ─┐
Discord-Knopf            ─┼─► Turnierdienste ─► Datensatz + Verlauf + Audit
Verwaltung (Web)         ─┘                   └─► Discord: Ankündigung, Kanäle
```

Ein Turnier lebt an zwei Orten: als Datensatz und als Discord-Server voller
Kanäle, Rollen und Nachrichten. Der Datensatz ist die Wahrheit. Deshalb trägt
kein Modell eine Discord-Kennung als Pflichtfeld, und das Archiv kommt ohne
Discord aus: ein Turnier von letztem Jahr lässt sich nachschlagen, auch wenn
die Kanäle längst weg sind.

---

## 1. Einrichtung

Reihenfolge, weil jeder Schritt den vorherigen braucht:

1. **Modul einschalten** (`/modules`)
2. **Berechtigung «An Turnieren teilnehmen» vergeben** (`/server/permissions`)

   Ohne sie lässt sich alles einrichten, veröffentlichen und ankündigen – nur
   anmelden kann sich niemand. Die Modulprüfung meldet das als Fehler; sie
   steht auf der Modulseite.

3. **Moduleinstellungen** (`/modules/tournaments`)
   - _Ankündigungs-Channel_: wohin Turnier-Ankündigungen gehen, wenn ein
     Turnier nichts eigenes setzt.
   - _Kategorie für Match-Channels_: nötig, solange Match-Kanäle eingeschaltet
     sind.
   - _Standard-Leitungsrollen_: wer ohne eigene Zuordnung jedes Turnier
     betreuen darf.
   - _Erwähnbare Rollen_: nur diese dürfen in Ankündigungen erwähnt werden.

4. **Turnier anlegen** (`/turniere/neu`)

---

## 2. Der Ablauf

Ein Turnier durchläuft feste Zustände. Der Leitstand (`/turniere/verwalten/<id>`)
bietet je Zustand genau einen Weg vorwärts – die vollständige Übergangstabelle
steht in `service.ts` und entscheidet.

```
DRAFT ─► REGISTRATION_OPEN ─► REGISTRATION_CLOSED ─► CHECKIN_OPEN
      ─► CHECKIN_CLOSED ─► READY ─► RUNNING ─► COMPLETED ─► ARCHIVED
                                      └► PAUSED ─┘
```

Aus fast jedem Zustand führt zusätzlich `CANCELLED` heraus. Eine Absage
benachrichtigt die Angemeldeten auf Discord – eine Absage, die nur im
Dashboard steht, erreicht niemanden.

**Startcheck.** Vor dem Veröffentlichen, vor dem Check-in-Ende und vor dem
Start prüft das System, was der jeweilige Schritt braucht. Ein Fehler
blockiert, eine Warnung nicht.

---

## 3. Anmeldung, Warteliste, Check-in

- **Offen / Mit Freigabe / Nur auf Einladung** – wer sich wie anmeldet.
- **Warteliste.** Ist die Obergrenze erreicht, geht es auf die Warteliste. Der
  entscheidende Teil läuft in einer Transaktion, die zuerst die Turnierzeile
  sperrt: ohne diese Sperre entscheiden zwei gleichzeitige Anmeldungen beide,
  dass noch ein Platz frei ist. Zieht jemand zurück, rückt die Warteliste nach.
- **Check-in.** Nur wer eincheckt, tritt an. Ob Nicht-Eingecheckte auch aus
  dem Turnier fallen, entscheidet die Einstellung – und die Voreinstellung ist
  bewusst «nein»: jemanden automatisch hinauszuwerfen, weil er drei Minuten zu
  spät war, ist eine Entscheidung, die ein Mensch treffen soll.
- **Eignung.** Rolle, Level, Premium, Turniersperre. Geprüft wird
  serverseitig bei jeder Anmeldung; die Anzeige auf der Turnierseite ist
  Bequemlichkeit, nicht die Entscheidung.

## 4. Teams

Bei Teamturnieren meldet der Captain das Team an, nicht die einzelnen Spieler.
Er lädt ein, weist Rollen zu, übergibt die Führung. Niemand spielt in zwei
Teams desselben Turniers – abgewiesen wird schon die Einladung, nicht erst das
Annehmen.

Nach dem Roster Lock ändert nur noch die Turnierleitung etwas. Sie kann ein
Roster ausdrücklich wieder öffnen: wessen Spieler kurzfristig ausfällt, soll
nicht deswegen aus dem Turnier fallen.

## 5. Bracket

Fünf Formate: K.-o., Doppel-K.-o., jeder gegen jeden, Schweizer System, Gruppen
mit anschliessender Endrunde.

Die Bracket-Engine (`bracket.ts`) rechnet ohne Datenbank – sie bekommt
Teilnehmer und liefert Paarungen. Das macht sie prüfbar, und die 28 Tests dazu
laufen in Millisekunden.

Gezogen wird mit `crypto.randomInt`, nicht mit `Math.random`: an einer
Turnierauslosung hängen Preise. Die Setzliste entsteht einmal und wird
gespeichert – eine Auslosung, die sich beim nächsten Seitenaufruf anders
ergibt, ist keine.

Jedes Match trägt, wohin Sieger und Verlierer gehen. Ohne diese Verweise
müsste das Weiterkommen die Bracket-Form jedes Mal neu ausrechnen – und zwei
Stellen, die dasselbe ausrechnen, sind irgendwann uneinig.

## 6. Resultate

Ein Resultat zählt, wenn **beide Seiten dasselbe melden**. Melden sie
Verschiedenes, wird das Match strittig und die Leitung entscheidet.

- Melden, bestätigen, bestreiten, Einspruch erheben – für die Captains.
- Ansetzen, korrigieren, Einspruch entscheiden – für die Leitung.

Eine Korrektur verlangt eine Begründung und nimmt ein bereits erfolgtes
Weiterkommen zurück. Ist das Folgematch schon gespielt, lehnt der Server ab.

## 7. Zugriff

Zwei Ebenen, und **beide** müssen zutreffen:

1. Die zentrale Berechtigung (`tournaments.*`) sagt, was jemand grundsätzlich
   darf.
2. Die Rolle im Turnier (OWNER, ADMIN, REFEREE, CASTER, OBSERVER) sagt, für
   welche Turniere.

Die Rolle allein vergibt keine Rechte: ein Schiedsrichter ohne die
Berechtigung «Resultate korrigieren» kann auch in seinem Turnier keine
korrigieren. Deshalb ist die Leitungsliste eine Zuständigkeit, keine
Rechtevergabe.

Wer weder zuständig noch beteiligt ist, bekommt dieselbe Antwort wie bei einem
Turnier, das es nicht gibt – sonst liesse sich an der Antwort ablesen, welche
Turniere existieren.

**Slot statt Vertrauen.** Für welche Seite eines Matches jemand sprechen darf,
entscheidet der Server aus der Teamzugehörigkeit. Eine Team- oder Match-Kennung
aus dem Browser ist keine Berechtigung.

## 8. Discord

- **Ankündigungen** laufen über das bestehende Kommunikationsmodul. Erwähnt
  wird eine Rolle nur, wenn sie in der Erlaubnisliste des Turniers **und** der
  des Moduls steht.
- **Match-Kanäle** bekommen Mitglieder-Ausnahmen, keine temporären Teamrollen.
  Rollen wären bequemer zu lesen, kosten aber einen zweiten Lebenszyklus.
  Discord erlaubt 500 Ausnahmen je Kanal.
- **Aufbewahrung:** Match-Kanäle bleiben nach dem Match für die eingestellte
  Zahl Stunden; 0 bedeutet «bis zum Turnierende». Sofort zu löschen nimmt
  beiden Teams die Möglichkeit, das Gespräch nochmals zu lesen.

## 9. Die öffentliche Seite

`/turniere` und `/turniere/<kennung>` liegen ausserhalb der geschützten
Routengruppe: ein Turnierlink, der zum Login führt, taugt nicht zum Teilen.
Dieselbe Anwendung, dieselbe Marke, nur ohne Seitenleiste.

Entwürfe erscheinen dort nicht. Die Turnierleitung kann ihr Turnier trotzdem
als Vorschau öffnen – entschieden wird am Zugriff, nicht am Zustand.

Discord-Kennungen erscheinen in der öffentlichen Teilnehmerliste bewusst
nicht: der Name genügt, um zu zeigen, wer mitspielt.

Die Verwaltung liegt unter `/turniere/uebersicht` und `/turniere/verwalten/<id>`.
Diese Wörter sind als Turnierkennung gesperrt – ein Turnier namens «matches»
wäre unter seiner eigenen Adresse sonst nicht erreichbar.

## 10. Live

Der Leitstand bezieht seinen Stand über Server-Sent Events
(`/api/tournaments/<id>/live`). Während eines laufenden Turniers ist eine
Seite, die man von Hand neu laden muss, keine Hilfe.

Der Strom prüft die Zuständigkeit beim Verbinden und endet nach fünfzehn
Minuten von selbst; der Browser verbindet neu und wird dabei erneut geprüft.
Wer die Zuständigkeit verliert, ist spätestens dann draussen.

## 11. Was das System nicht tut

- Es erfindet keine Zahlen. Wo nichts gemessen wurde, steht ein Strich – eine
  erfundene Quote wäre schlimmer als keine, weil man sich auf sie verliesse.
- Es wirft niemanden aus einem laufenden Turnier, nur weil er eine Frist
  verpasst hat – ausser die Leitung hat das ausdrücklich eingestellt.
- Es begründet eine Turniersperre nicht öffentlich. Der Grund steht im
  Protokoll der Verwaltung; eine Sperrbegründung auf einer öffentlichen Seite
  ist eine Blossstellung.
