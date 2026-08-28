# Integrationen

Zentrale Verwaltung technischer Zugangsdaten: Discord, AI, Musik-Bots und
weitere Anbieter. Verschlüsselt in der Datenbank, im Dashboard pflegbar, ohne
Serverzugriff austauschbar.

---

## 1. Wozu

Vorher standen Bot-Token, OAuth-Zugangsdaten und AI-Schlüssel in der `.env` auf
dem Server. Ein Tokenwechsel hiess: SSH, Datei bearbeiten, Container neu bauen.
Jetzt: **System → Integrationen**, Wert eintragen, speichern. Der Bot verbindet
sich neu, die AI verwendet sofort den neuen Schlüssel.

Die `.env` behält genau die Rolle, die sie haben soll: **Bootstrap und
Infrastruktur**. Alles, was sich im Betrieb ändert, gehört in die Datenbank.

---

## 2. Architektur auf einer Seite

```
Dashboard  ──►  Server Action  ──►  @swisshub/secrets  ──►  IntegrationSecret
                (Permission,        (AES-256-GCM)           (nur Geheimtext)
                 CSRF, Rate,
                 Audit ohne Wert)
                                          │
                     ┌────────────────────┴────────────────────┐
                     ▼                                          ▼
          Ablage in @swisshub/config                  ConfigRevision +1
          (synchron lesbar:                           (andere Prozesse
           discordConfig.botToken)                     ziehen nach)
```

Vier Bausteine:

| Baustein                     | Wofür                                          |
| ---------------------------- | ---------------------------------------------- |
| `packages/secrets/crypto.ts` | Ver-/Entschlüsselung, Maskierung               |
| `packages/secrets/catalog.ts`| Welche Integrationen es gibt und welche Felder |
| `packages/secrets/store.ts`  | `getSecret` / `setSecret` / `deleteSecret`     |
| `packages/config/runtime.ts` | Die synchrone Ablage für bestehende Aufrufer   |

**Kein Redis, kein Event-Bus.** Dass ein anderer Prozess eine Änderung
mitbekommt, läuft über `ConfigRevision` — denselben Zähler, an dem auch Rollen,
Guild und Moduleinstellungen hängen. Bot und WebApp fragen ihn alle 15 Sekunden
(eine Zeile) und laden bei Änderung neu.

---

## 3. Verschlüsselung

**AES-256-GCM.** Nicht CBC: GCM authentifiziert den Geheimtext, ein verändertes
Byte fliegt auf.

Format in der Spalte `ciphertext`:

```
v1.<schlüsselKennung>.<iv>.<tag>.<geheimtext>       (Teile in base64url)
```

- `v1` — Fassung des Umschlags. Platzhalter für einen späteren
  Schlüsselwechsel: alte Umschläge blieben lesbar, während neue Werte bereits
  mit der neuen Fassung geschrieben würden.
- `<schlüsselKennung>` — die ersten acht Zeichen eines SHA-256 über den
  Hauptschlüssel. Genug, um einen falschen Schlüssel zu erkennen und eine
  verständliche Meldung zu geben; viel zu wenig, um vom Schlüssel etwas
  preiszugeben.

**Der Authentifizierungsanhang ist die Adresse des Geheimnisses:**
`scope`, `guildId`, `provider`, `key`, mit Nullbytes verbunden. Deshalb lässt
sich ein Geheimtext **nicht von einer Zeile in eine andere kopieren**: wer den
AI-Schlüssel in die Zeile des Bot-Tokens schriebe, bekäme beim Entschlüsseln
einen Fehler statt eines gültigen Werts. (Getrennt wird mit Nullbytes und nicht
mit Leerzeichen, damit `a` + `b c` und `a b` + `c` nicht denselben Anhang
ergeben.)

Jeder Schreibvorgang zieht einen neuen Zufallsvektor. Derselbe Wert ergibt nie
zweimal denselben Geheimtext — sonst liesse sich an gleichen Zeilen ablesen,
dass zwei Einträge denselben Wert tragen.

---

## 4. Der Hauptschlüssel

```
MASTER_ENCRYPTION_KEY=<32 Bytes, base64 oder hex>
```

Erzeugen:

```bash
openssl rand -base64 32
```

Er steht **ausschliesslich in der Serverumgebung**:

- nie im Dashboard,
- nie in der Datenbank,
- nie in einer API-Antwort,
- nie im Protokoll (die Logger-Schwärzung kennt ihn).

In Production ist er Pflicht — ohne ihn startet die Anwendung nicht. In der
Entwicklung ist er optional; dann gilt ausschliesslich, was in der `.env` steht.

**Wird er gewechselt, sind alle gespeicherten Werte unlesbar.** Es gibt keinen
Weg zurück, das ist der Zweck. Nach einem Wechsel müssen alle Zugangsdaten neu
hinterlegt werden; die Anwendung meldet das verständlich, statt still zu
scheitern.

---

## 5. Was noch in der `.env` bleibt

| Variable                 | Warum sie bleiben muss                              |
| ------------------------ | --------------------------------------------------- |
| `DATABASE_URL`           | Ohne sie gibt es keine Datenbank, aus der man liest |
| `MASTER_ENCRYPTION_KEY`  | Der Schlüssel zu allem Übrigen                      |
| `AUTH_SECRET`            | Sessions und CSRF — gebraucht, bevor eine Anfrage die Datenbank erreicht |
| `NEXT_PUBLIC_APP_URL`    | Bildet die OAuth-Redirect-URI; muss zur tatsächlichen Adresse passen |
| `SWISSHUB_OWNER_DISCORD_ID` | Notzugang. Bewusst nicht über die WebApp setzbar — sonst könnte man sich aussperren |
| `SWISSHUB_UPLOAD_DIR`, `LOG_*`, `TRUST_PROXY`, Intervalle | Betriebsparameter des Prozesses |
| `POSTGRES_*`             | Nur für `docker-compose.prod.yml`, legt den Datenbankcontainer an |

### Ersetzt (nur noch Rückfall)

| Variable                  | Jetzt unter                                    |
| ------------------------- | ---------------------------------------------- |
| `DISCORD_BOT_TOKEN`       | Integrationen → Discord                        |
| `DISCORD_CLIENT_ID`       | Integrationen → Discord                        |
| `DISCORD_CLIENT_SECRET`   | Integrationen → Discord                        |
| `ANTHROPIC_API_KEY`       | Integrationen → AI                             |
| `OPENAI_API_KEY`          | Integrationen → AI                             |
| `MUSIC_CONTROLLER_TOKEN`  | entfällt - der Controller ist der Systembot    |
| `MUSIC_WORKER_TOKENS`     | Integrationen → Discord-Bots                   |
| `MUSIC_RUNTIME_URL/KEY`   | Integrationen (Musik-Laufzeit)                 |
| `PAYMENT_API_KEY`, `PAYMENT_WEBHOOK_SECRET`, `PAYMENT_PROVIDER` | Integrationen (Zahlungsanbieter) |

**Reihenfolge:** Datenbank gewinnt. Die Umgebung wird nur gefragt, solange in
der Datenbank nichts steht. So lässt sich eine laufende Installation
umstellen, ohne sie vorher lahmzulegen.

### Warum die OAuth-Redirect-URI nicht konfigurierbar ist

Sie ergibt sich aus `NEXT_PUBLIC_APP_URL`. Sie im Dashboard einstellbar zu
machen wäre eine Einladung zum Aussperren: eine falsch eingetragene URI macht
die Anmeldung unmöglich — und korrigieren liesse sie sich nur über die
Anmeldung. Der Wert gehört dorthin, wo auch die Adresse selbst festgelegt wird.

---

## 6. Übernahme aus der `.env`

**System → Integrationen** listet, welche Variablen gesetzt sind. Je Eintrag
ein Knopf «Importieren».

Der Ablauf ist vollständig serverseitig: lesen → verschlüsseln → ablegen. **Der
Browser bekommt den Wert nie zu sehen** — die Liste enthält nur Namen und die
Auskunft «vorhanden».

- Mehrfaches Ausführen ist harmlos: was in der Datenbank steht, wird nicht
  überschrieben.
- Wer doch überschreiben will, bestätigt das ausdrücklich.
- Die Datei `.env` wird **nicht** verändert. Das Dashboard zeigt nur, was dort
  überflüssig geworden ist; entfernen ist eine Entscheidung des Betriebs.

---

## 7. Berechtigungen

| Berechtigung                   | Wofür                                     |
| ------------------------------ | ----------------------------------------- |
| `integrations.view`            | Zustände und Masken sehen                 |
| `integrations.manage`          | Nicht geheime Einstellungen, Tests        |
| `integrations.secrets.manage`  | Werte hinterlegen, ersetzen, entfernen    |
| `integrations.discord.manage`  | Bot-Token, OAuth, die hinterlegten Bots   |
| `integrations.ai.manage`       | Anbieter, Modell und Schlüssel der AI     |

Geprüft wird **zweimal**: einmal von `defineAction` gegen die deklarierte
Berechtigung, einmal im Rumpf gegen die anbieterbezogene. Wer nur die AI
verwalten darf, kommt über denselben Endpunkt nicht an den Bot-Token.

Alle schreibenden Aktionen laufen mit `freshness: 'critical'` — die
Discord-Rollen werden frisch geladen, ehe autorisiert wird. Ohne das könnte
jemand nach dem Entzug seiner Rolle noch minutenlang Tokens austauschen.

Keine dieser Berechtigungen steht in einer Mitglieder-Vorlage; ein Test hält
das fest.

---

## 8. Discord

**System → Integrationen → Discord**

| Feld            | Geheim | Prüfung vor der Übernahme         |
| --------------- | ------ | --------------------------------- |
| Bot Token       | ja     | `GET /users/@me` mit dem Token    |
| Client ID       | nein   | Discord-Snowflake (17–20 Ziffern) |
| Client Secret   | ja     | zusammen mit der Client ID beim Verbindungstest |

**Der Bot-Token wird geprüft, bevor er gespeichert wird.** Ein ungültiger Token
erreicht die Datenbank gar nicht — der bestehende bleibt unangetastet. Ein
Tippfehler nimmt den Bot also nicht vom Netz.

Die Prüfung weist auch ein Benutzer-Token ab: es käme sonst durch, wäre
nutzlos und ein Verstoss gegen die Discord-Regeln.

«Verbindung testen» prüft Bot-Token und OAuth-Zugangsdaten in einem Zug. Die
OAuth-Prüfung holt einmal Client Credentials und lässt den Token fallen.

---

## 9. Bot-Laufzeit und Reconnect

Beim Start:

```
Datenbank verbinden → Geheimnis laden → entschlüsseln → client.login()
```

Der Bot prüft danach alle 15 Sekunden die Konfigurations-Revision. Ändert sich
der Token:

1. **Prüfen.** Der neue Token geht an Discord. Wird er abgelehnt, passiert
   nichts weiter — die bestehende Verbindung bleibt, und der Fehler steht im
   Zustand der Integration.
2. **Trennen.** `client.destroy()`.
3. **Neu anmelden.** `client.login(neuerToken)` auf **derselben** Client-Instanz.
   discord.js erkennt den gewechselten Token, verwirft die alte
   Websocket-Verwaltung und baut eine neue auf. Die Ereignisbehandler hängen am
   `Client`, nicht an der Verbindung — sie bleiben genau einmal registriert.
   Ein zweiter `Client` hätte jeden Handler ein zweites Mal bekommen, und jedes
   Ereignis wäre doppelt verarbeitet worden.
4. **Rückweg.** Scheitert die Anmeldung trotz bestandener Prüfung, kehrt der
   Bot auf den vorherigen Token zurück. Mit dem alten Token online zu sein ist
   besser, als mit dem neuen offline zu sein.

Fehlt beim Start ein Bot-Token, bricht der Bot mit einer verständlichen Meldung
ab. Ein Prozess, der wortlos ohne Verbindung weiterläuft, wäre schlechter.

Die **WebApp** bricht in demselben Fall **nicht** ab: sie muss gerade dann
erreichbar sein, wenn etwas fehlt — dort trägt man es nach.

---

## 10. AI

**System → Integrationen → AI**

Ein Anbieter, ein Schlüssel, ein Modell — für alle Module.

| Feld       | Geheim | Bemerkung                                     |
| ---------- | ------ | --------------------------------------------- |
| Aktiviert  | nein   | Aus: kein Modul fragt ein Modell an           |
| Anbieter   | nein   | `anthropic` oder `openai`                     |
| API Key    | **ja** | Verschlüsselt, nie angezeigt                  |
| Modell     | nein   | Freitext mit Vorschlagsliste                  |
| Base URL   | nein   | Leer = Standardadresse. Nur https             |
| Zeitlimit  | nein   | 1 000 – 120 000 ms                            |
| Max Tokens | nein   | Obergrenze je Antwort — begrenzt die Kosten   |

Nicht geheime Werte stehen in `SystemConfig` unter `integration.ai` — demselben
Speicher wie Guild und Moduleinstellungen. Ein eigener Speicher nur für
«Modell» und «Zeitlimit» wäre ein zweiter Ort mit demselben Zweck.

Das Modell ist ein **Freitextfeld** mit Vorschlägen, keine Auswahlliste: eine
feste Liste veraltete beim ersten neuen Modell, und jedes andere wäre damit
nicht mehr wählbar.

**«Verbindung testen»** stellt eine winzige Anfrage mit erzwungenem
Antwortformat. Damit sind Schlüssel, Anbieter, Adresse **und** Modellzugriff in
einem Zug geprüft — ein Test, der nur den Schlüssel prüfte, ginge bei einem
falsch geschriebenen Modellnamen grün durch.

### Module, die die AI nutzen

Ein Modul bringt seine Frage mit und sonst nichts. Es hat **kein eigenes
Schlüsselfeld**. Die Verifikation etwa kennt nur drei Einstellungen: ob sie die
AI nutzt, ob diese selbst freischalten darf und ab welcher Sicherheit.

```ts
// So sieht ein Modul die AI - eine Anfrage, eine Antwort, ein Schema.
const antwort = await strukturierteAntwort({
  system: '...',
  user: '...',
  schema: OUTPUT_SCHEMA,
  schemaName: 'verifikation_einordnung',
});
```

Kein Werkzeuggebrauch, kein Gedächtnis, keine Zustandsführung. Ein Modell kann
über diesen Weg nichts auslösen — es kann nur antworten, und ob daraus etwas
folgt, entscheidet der Aufrufer.

---

## 11. Discord-Bots

**System → Integrationen → Discord-Bots**

Zwei Arten, und der Unterschied liegt beim Token.

### Der Systembot ist zugleich der Musik-Controller

Er ist die SwissHub-Anwendung selbst. Sein Token steht **nicht** in dieser
Liste, sondern unter Integrationen → Discord — es ist dasselbe, mit dem sich
der Bot am Gateway anmeldet. Ein zweites Feld dafür wäre derselbe Wert an zwei
Stellen, und zwei Stellen laufen auseinander. Seine Zeile hat deshalb kein
Eingabefeld und keinen Löschknopf; prüfen lässt er sich trotzdem.

Als Controller betritt er den Sprachkanal unter dem Namen, den alle ohnehin
kennen. Für den Musik-Controller braucht es damit **keine zweite
Discord-Anwendung** mehr.

**Was das technisch bedeutet.** Der Bot hat dann zwei Gateway-Verbindungen:
die des Node-Prozesses (`apps/bot`) und die der Voice-Laufzeit. Discord lässt
das zu — jede IDENTIFY erzeugt eine eigene Sitzung, und beide empfangen die
Ereignisse des Servers. Die Voice-Verbindung gehört eindeutig der Laufzeit,
weil nur sie Opcode 4 sendet; `apps/bot` betritt selbst nie einen Sprachkanal
und bindet `@discordjs/voice` nicht ein.

Die übrigen Module sehen den Controller im Sprachkanal als das, was er ist:
einen Bot. Voice-XP, Voice-Hub, Anwesenheit und Analytics filtern Bots bereits
— das galt schon, als der Controller eine eigene Anwendung war, und ändert
sich dadurch nicht.

**Eine Grenze bleibt:** ein Bot ist je Server immer nur in *einem*
Sprachkanal. Der Controller kann also eine Sitzung gleichzeitig bedienen —
genau wie zuvor. Wer mehr will, legt Worker an.

### Musik-Worker

Eigene Discord-Anwendungen mit eigenem Token, hier angelegt, geprüft und
ausgetauscht. «Music Worker 4» soll man hinzufügen können, ohne den Code
anzufassen — deshalb eine Liste statt fester Felder.

Ein Worker-Token steht nicht in der Bot-Zeile, sondern unter
`provider = "bot:<id>"`. So lässt sich ein einzelnes austauschen, ohne die
übrigen zu berühren.

**Jeder Worker braucht eine eigene Anwendung.** Zwei Bots mit demselben Token
können nicht gleichzeitig in verschiedenen Kanälen spielen.

### Woher die Laufzeit liest

Die Voice-Laufzeit (Python) liest beim Start aus derselben Datenbank und
entschlüsselt mit demselben Hauptschlüssel — dasselbe Format, zwei Sprachen:

| Rolle      | Adresse des Geheimnisses            |
| ---------- | ----------------------------------- |
| Controller | `provider = "discord"`, `key = "botToken"` |
| Worker     | `provider = "bot:<id>"`, `key = "token"`   |

Findet sie dort nichts, gilt die Umgebung: `DISCORD_BOT_TOKEN` für den
Controller, `MUSIC_WORKER_TOKENS` für die Worker.

`MUSIC_CONTROLLER_TOKEN` wird nur noch gelesen, wenn `DISCORD_BOT_TOKEN`
fehlt. Eine Installation, die es noch gesetzt hat, fällt dadurch nicht aus;
gebraucht wird es nicht mehr und kann entfernt werden.

---

## 12. Zustände

| Zustand           | Bedeutung                                        |
| ----------------- | ------------------------------------------------ |
| `CONNECTED`       | Hinterlegt, letzter Test erfolgreich             |
| `DEGRADED`        | Nutzbar, aber unvollständig oder nie geprüft     |
| `NOT_CONFIGURED`  | Nichts hinterlegt — kein Fehler                  |
| `ERROR`           | Hinterlegt, letzter Test gescheitert             |

Der Unterschied zwischen `NOT_CONFIGURED` und `ERROR` ist der wichtigste: eine
nicht eingerichtete AI ist ein bewusster Zustand und darf nichts rot färben;
ein abgelehnter Schlüssel dagegen ist ein Fehler, den jemand sehen muss.

Vollständig hinterlegt, aber nie getestet, ergibt `DEGRADED` und nicht
`CONNECTED` — eine Zusage, die niemand geprüft hat, wäre keine.

---

## 13. Sicherheit

**Kein Wert verlässt den Server.**

- Für die Anzeige gibt es `describe()`. Es liefert: gesetzt ja/nein, Herkunft,
  Maske (`••••••••3X7A`), Zeitpunkt. Nie einen Wert.
- Auf keiner Seite steht ein `getSecret()`. Eine Server Component rendert ihre
  Daten in das ausgelieferte HTML — ein Aufruf dort hiesse: das Token steht im
  Quelltext der Seite. Ein Test scannt die Seiten darauf.
- Keine Server Action gibt einen Wert zurück. Nach dem Speichern kommt die
  Maske zurück, nicht das Gespeicherte.

**Kein Wert landet im Protokoll.** Die Logger-Schwärzung kannte bisher nur
Umgebungsvariablen. Seit die Tokens in der Datenbank liegen, meldet der Speicher
jeden entschlüsselten Wert beim Logger an — von da an verschwindet er aus jeder
Logzeile, auch aus einer fremden Ausnahme, die ihn zufällig enthält.

**Kein Wert steht im Audit-Log.** Ein Eintrag nennt Integration, Feld,
Handelnden, Zeitpunkt und Aktion. Kein `oldValue`, kein `newValue`.

**Keine Anbieter-Rohantwort erreicht die Oberfläche.** Fehler werden
serverseitig übersetzt: «Der API-Schlüssel wurde abgelehnt», nicht die
Fehlermeldung des Anbieters — die kann die gesendeten Kopfzeilen
widerspiegeln.

**Eingabefelder.** `type="password"`, `autoComplete="off"`. Sonst böte der
Browser an, ein Bot-Token im Passwortspeicher abzulegen oder es beim nächsten
Formular einzusetzen. Ein bestehender Wert wird **nie** in das Feld
zurückgeladen: es startet leer, und leer absenden ändert nichts.

**Rate Limits.** Schreiben: 20 in 5 Minuten. Tests: 10 in 5 Minuten — jeder
Test kostet eine echte Anfrage, bei der AI auch Geld.

---

## 14. Sicherung und Wiederherstellung

Für eine vollständige Sicherung braucht es **beides**:

1. die Datenbank (`pg_dump`),
2. den `MASTER_ENCRYPTION_KEY`.

Eine Datenbanksicherung allein nützt nichts — die Zugangsdaten sind darin
absichtlich nicht lesbar. Das ist der Zweck der Verschlüsselung: ein
abhandengekommener Dump gibt keine Tokens preis.

Den Schlüssel **getrennt** von der Datenbanksicherung aufbewahren. Liegen beide
am selben Ort, ist die Verschlüsselung eine Formalität.

**Wiederherstellen:**

```bash
# 1. Datenbank einspielen
psql "$DATABASE_URL" < sicherung.sql

# 2. Denselben Hauptschlüssel in die .env eintragen
MASTER_ENCRYPTION_KEY=<der Schlüssel von damals>

# 3. Starten. Unter System → Integrationen sollten alle Einträge grün sein.
```

Steht dort «Die gespeicherten Zugangsdaten wurden mit einem anderen
MASTER_ENCRYPTION_KEY verschlüsselt», ist es der falsche Schlüssel. Die
Kennung im Umschlag hat das erkannt — die Werte sind unversehrt, es fehlt nur
der richtige Schlüssel.

---

## 15. Fehlersuche

**«MASTER_ENCRYPTION_KEY ist nicht gesetzt»**
Es lässt sich nichts speichern; es gilt ausschliesslich die Umgebung.
`openssl rand -base64 32` und in die `.env` eintragen.

**«Die gespeicherten Zugangsdaten wurden mit einem anderen
MASTER_ENCRYPTION_KEY verschlüsselt»**
Der Schlüssel wurde gewechselt oder stammt aus einer anderen Installation.
Entweder den alten Schlüssel zurückholen oder alle Werte neu hinterlegen.

**Bot startet nicht: «Pflichtangaben fehlen»**
Unter Integrationen → Discord Bot-Token, Client ID und Client Secret
hinterlegen — oder übergangsweise in der `.env`.

**Token gespeichert, aber der Bot ist noch mit dem alten verbunden**
Bis zu 15 Sekunden warten; so oft wird die Revision geprüft. Danach im
Bot-Protokoll nachsehen: «Bot-Token wurde geändert - Verbindung wird erneuert».
Steht dort «vom Discord abgelehnt», war der neue Token ungültig und der alte
gilt weiter — genau wie vorgesehen.

**AI-Test: «Dieses Modell gibt es beim gewählten Anbieter nicht»**
Modellname und Anbieter passen nicht zusammen. Die Vorschlagsliste im Feld
zeigt, was zum eingestellten Anbieter gehört.

**AI-Test: «Der Schlüssel hat keinen Zugriff auf dieses Modell»**
Der Schlüssel ist gültig, aber das Konto ist für dieses Modell nicht
freigeschaltet.

**Musik-Bots verbinden sich nicht**
Im Protokoll der Laufzeit nachsehen. «Token von WORKER_1 ist nicht lesbar»
heisst: falscher Hauptschlüssel oder der Eintrag stammt aus einer anderen
Installation. «Kein MASTER_ENCRYPTION_KEY gesetzt» heisst: die Laufzeit nimmt
die Umgebung, nicht die Datenbank.

---

## 16. Eine neue Integration hinzufügen

Ein Eintrag in `packages/secrets/src/catalog.ts`:

```ts
{
  id: 'mail',
  label: 'E-Mail',
  description: '...',
  icon: 'Mail',
  scope: 'GLOBAL',
  essential: false,
  testable: true,
  fields: [
    { key: 'apiKey', label: 'API Key', secret: true, required: true,
      type: 'password', schema: geheimnis(8, '...'), envKey: 'MAIL_API_KEY' },
  ],
}
```

Damit sind Speicherung, Verschlüsselung, Maskierung, Audit, ENV-Übernahme und
die Feldanzeige erledigt. Zu schreiben bleibt nur der Verbindungstest und —
falls die Integration eine eigene Seite bekommen soll — eine Seite nach dem
Muster von `system/integrationen/ai`.

Ein Feld als `secret: false` zu markieren ist eine Entscheidung, keine
Nachlässigkeit: ein solcher Wert wird im Klartext angezeigt. Die Client ID ist
das Beispiel — sie steht in jeder Einladungs-URL, sie zu verstecken hülfe
niemandem und machte die Fehlersuche schwerer.
