# Verifikation

Eintrittsschleuse für neue Mitglieder: Wer dem Server beitritt, schreibt einen
Satz auf Schweizerdeutsch, und ein Mensch – wahlweise unterstützt von einer
AI-Einordnung – schaltet ihn frei.

---

## 1. Wozu

Spam- und Bot-Accounts kommen nicht am Beitritt vorbei, echte Mitglieder mit
möglichst wenig Reibung hinein. Das Modul vergibt beim Beitritt eine Rolle,
die nur den Verifikationskanal sieht, begrüsst dort, nimmt die erste
Nachricht entgegen und legt sie der Moderation vor.

Das Modul ist standardmässig **aus**. Einschalten unter **Module →
Verifikation**; ohne die drei Pflichtangaben (Rollen, Verifikationskanal,
Moderations-Kanal) meldet die Einrichtungsprüfung, was noch fehlt.

---

## 2. Die eine Regel

> **Die AI darf ausschliesslich verifizieren oder an einen Menschen abgeben.
> Sie darf niemals bannen, kicken, timeouten, jailen oder ablehnen.**

Das ist keine Einstellung, die man umlegen könnte, sondern der Bauplan des
Moduls. In `packages/modules/src/verification/` gibt es **keinen Pfad** von
einem AI-Ergebnis zu einer Sanktion:

- `service.ts` trennt `verify()` (der einzige Weg nach `VERIFIED`) von
  `entscheide()` mit negativem Ausgang.
- `review.ts` ist asymmetrisch: `humanVerify()` und `humanReject()` verlangen
  einen `HumanActor` mit Discord-Kennung und geprüfter Berechtigung;
  `aiPipeline()` nimmt keinen Handelnden entgegen und ruft ausschliesslich
  `verify()` auf.
- `humanReject()` führt den Bann nicht selbst aus, sondern delegiert an
  `moderation.banMember` – dieselbe Prüfung wie jeder andere Bann.
- Jeder Fehler im AI-Pfad endet in `WAITING_FOR_REVIEW`, nie in einer
  Sanktion (§51 Fail-Safe).

Drei Tests in `tests/integration/verifikation-ai.test.ts` schlagen fehl,
sobald jemand diese Trennung aufweicht.

---

## 3. Berechtigungen

| Berechtigung                    | Wofür                                       |
| ------------------------------- | ------------------------------------------- |
| `verification.view`             | Übersicht und Kennzahlen                    |
| `verification.review`           | Warteschlange öffnen, Fälle ansehen         |
| `verification.approve`          | Freischalten                                |
| `verification.reject`           | Ablehnen – das heisst bannen (kritisch)     |
| `verification.history.view`     | Verlauf und der Block im Member Center      |
| `verification.ai.manage`        | AI-Einordnung erneut anstossen (kritisch)   |
| `verification.settings.manage`  | Einstellungen des Moduls (kritisch)         |

`approve` und `reject` sind bewusst getrennt: freischalten ist eine
Gefälligkeit, ablehnen ist ein Bann. Wer das eine darf, darf deshalb nicht
automatisch das andere.

Es gibt keine Prüfung auf Rollennamen. Was jemand darf, steht unter **Server →
Berechtigungen**. Der Discord-Knopf unter der Moderationsmeldung löst dieselbe
Prüfung aus wie die Webseite: `apps/bot/src/verification.ts` liest die echten
Rollen des Drückenden, löst sie über `resolvePermissions` auf und prüft mit
`hasPermission`. Ein Knopf, den man sieht, ist kein Recht, ihn zu drücken.

---

## 4. Ablauf

1. **Beitritt** – der Bot vergibt die Rolle «Noch nicht verifiziert» und
   begrüsst im Verifikationskanal. Status: `WAITING_FOR_MESSAGE`.
2. **Nachricht** – die erste Nachricht im Verifikationskanal wird
   gespeichert. Absender ist immer der Autor der Nachricht, nie ein Inhalt
   der Nachricht.
3. **Einordnung** – ist die AI aktiv, klassifiziert sie
   (`AI_ANALYZING`). Sonst geht es direkt weiter.
4. **Entscheidung** – entweder schaltet die AI frei (nur bei aktivem
   «AI darf selbst freischalten» und erreichter Sicherheit) oder ein Mensch
   entscheidet in der Warteschlange bzw. per Discord-Knopf
   (`WAITING_FOR_REVIEW`).
5. **Freischaltung** – Rollen werden in einem Zug getauscht, die
   Willkommensnachricht geht raus, der Vorgang wird protokolliert.

### Status

| Status                | Bedeutung                                          |
| --------------------- | -------------------------------------------------- |
| `WAITING_FOR_MESSAGE` | Beigetreten, hat noch nichts geschrieben           |
| `AI_ANALYZING`        | Nachricht da, die AI ordnet gerade ein             |
| `WAITING_FOR_REVIEW`  | Wartet auf einen Menschen                          |
| `VERIFIED`            | Freigeschaltet                                     |
| `REJECTED`            | Abgelehnt und gebannt – ausschliesslich durch einen Menschen |
| `LEFT_SERVER`         | Hat den Server während des Vorgangs verlassen      |
| `EXPIRED`             | Frist ohne Nachricht verstrichen                   |
| `ERROR`               | Der Vorgang selbst ist gescheitert (Rolle, Rechte) |

`WAITING_FOR_MESSAGE`, `AI_ANALYZING` und `WAITING_FOR_REVIEW` gelten als
offen; die letzten beiden warten auf einen Menschen und ergeben die Zahl auf
der Dashboard-Karte.

---

## 5. Nur eine Entscheidung je Vorgang

Warteschlange, Discord-Knopf und AI greifen auf denselben Fall zu. Damit
niemand zweimal entscheidet, gibt es genau einen Engpass in `service.ts`:

```ts
const ergebnis = await prisma.verificationRequest.updateMany({
  where: { id: requestId, decidedAt: null, status: { in: [...OFFENE_STATUS] } },
  data: { status, decidedAt: now, decidedBy, ... },
});
if (ergebnis.count === 0) return null;   // jemand war schneller
```

Wer das Rennen verliert, bekommt eine verständliche Meldung statt eines
zweiten Banns. Die Rollen werden erst getauscht, **nachdem** der Anspruch
gewonnen ist – nicht davor.

Ablehnen ist zweistufig: der Discord-Knopf öffnet eine Rückfrage mit
Pflichtgrund, erst deren Bestätigung führt zum Bann.

---

## 6. Die AI

Aktiv nur, wenn `aiEnabled` gesetzt **und** `ANTHROPIC_API_KEY` in der
Server-Umgebung hinterlegt ist. Der Schlüssel steht ausschliesslich
serverseitig, taucht nirgends im Dashboard auf und wird nicht protokolliert.

**Die Nachricht ist nicht vertrauenswürdiger Eingabewert.** Sie steht im
Prompt zwischen ausgewiesenen Markierungen und wird als Datum behandelt, nicht
als Anweisung. Das Modell bekommt:

- **keine Werkzeuge**, keine Aktionsrechte,
- ein erzwungenes Ausgabeschema (`classification`, `confidence`,
  `reasonCode`),
- ein enges Token-Budget.

Was zurückkommt, wird gegen ein Zod-Schema geprüft. Passt es nicht, gilt der
Fall als ungeklärt und geht an die Moderation.

Die Einordnung ist **ausdrücklich tolerant**: ein ungewöhnlicher Dialekt, eine
Mischung mit Hochdeutsch oder ein kurzer Satz sind kein negatives Ergebnis,
sondern ein Fall für einen Menschen (§54).

Freischalten darf die AI nur, wenn **alle** drei Bedingungen zutreffen:

```ts
if (!settings.aiAutoVerify) return false;
if (ergebnis.classification !== 'LIKELY_SWISS_GERMAN') return false;
return ergebnis.confidence >= settings.aiThreshold;
```

`aiEnabled` und `aiAutoVerify` sind getrennt, damit man die Einordnung erst
eine Weile mitlaufen lassen und nur den Vorschlag anzeigen kann, ehe man ihr
das Freischalten überlässt. `aiMaxAttempts` begrenzt die Anfragen je Vorgang
und damit die Kosten.

---

## 7. Einstellungen

Unter **Module → Verifikation → Einstellungen**, Gruppen «Rollen & Kanäle»,
«Texte», «AI», «Ablauf», «Benachrichtigungen», «Datenschutz».

| Schlüssel               | Vorgabe | Bedeutung                                          |
| ----------------------- | ------- | -------------------------------------------------- |
| `unverifiedRoleId`      | –       | Rolle für neue Mitglieder (Pflicht)                |
| `memberRoleId`          | –       | Rolle nach Freischaltung (Pflicht)                 |
| `verificationChannelId` | –       | Wo begrüsst und geschrieben wird (Pflicht)         |
| `moderatorChannelId`    | –       | Wohin die Meldung geht (Pflicht)                   |
| `moderatorPingRoleId`   | –       | Wird bei einem neuen Fall erwähnt                  |
| `logChannelId`          | –       | Zusätzlicher Protokollkanal                        |
| `greetingMessage`       | Text    | `{user}` wird durch die Erwähnung ersetzt          |
| `welcomeMessage`        | Text    | Leer = keine Nachricht nach der Freischaltung      |
| `aiEnabled`             | `false` | Einordnung überhaupt anfragen                      |
| `aiAutoVerify`          | `false` | Darf ein sicheres Ergebnis selbst freischalten     |
| `aiThreshold`           | `0.95`  | Darunter entscheidet immer ein Mensch              |
| `aiModel`               | `claude-opus-5` | Modell der Einordnung                      |
| `aiMaxAttempts`         | `2`     | Anfragen je Vorgang – Kostenbremse                 |
| `expireEnabled`         | `true`  | Frist überhaupt anwenden                           |
| `expireAfterHours`      | `48`    | Frist ohne Nachricht                               |
| `kickOnExpire`          | `false` | Nach Ablauf vom Server werfen – **niemals** bannen |
| `trustReturningMembers` | `true`  | Früher Verifizierte beim Wiedereintritt durchwinken |
| `notifyOnMessage`       | `true`  | Meldung bei neuer Nachricht                        |
| `notifyOnAiVerify`      | `true`  | Meldung bei AI-Freischaltung                       |
| `notifyOnReject`        | `true`  | Meldung bei Ablehnung                              |
| `retentionDays`         | `90`    | Aufbewahrung der Verifikationsnachricht            |

Rollen und Kanäle werden ausgewählt, nicht eingetippt – im Code steht keine
einzige Rollen- oder Kanalkennung.

---

## 8. Discord-Rechte des Bots

Die Rolle des Bots muss **über** der Rolle «Noch nicht verifiziert» und über
der Mitgliederrolle stehen, sonst kann er sie nicht vergeben. Im
Verifikationskanal und im Moderations-Kanal braucht er «Kanal ansehen» und
«Nachrichten senden»; für Ablehnungen «Mitglieder bannen».

Die **Message Content**-Absicht muss im Discord-Entwicklerportal aktiv sein –
ohne sie sieht der Bot keine Nachrichten und der Vorgang bleibt bei
`WAITING_FOR_MESSAGE` stehen.

Die Seite **Verifikation → Einrichtung prüfen** prüft genau das: Modulstatus,
Rollenhierarchie gegen die tatsächliche Position der Bot-Rolle, Existenz und
Rechte in beiden Kanälen, die Absicht und das Vorhandensein des API-Schlüssels.
Die Prüfung ändert nichts und rührt kein Mitglied an.

---

## 9. Zeitsteuerung

Der Job `verification-sweep` läuft alle fünf Minuten im Bot und erledigt drei
Dinge:

1. **Ablauf** – nur Vorgänge in `WAITING_FOR_MESSAGE`, deren Frist
   verstrichen ist, werden auf `EXPIRED` gesetzt. Wer geschrieben hat und auf
   Prüfung wartet, läuft nie ab.
2. **Kick** – nur wenn `kickOnExpire` an ist, und nur ein Kick. Nie ein Bann.
3. **Aufbewahrung** – Nachrichten, die älter als `retentionDays` sind, werden
   gelöscht. Der Vorgang selbst bleibt als Verlaufseintrag erhalten, ohne den
   Text.

---

## 10. Datenschutz

Gespeichert wird, was für die Entscheidung nötig ist: Discord-Kennung,
Anzeigename, Beitrittszeitpunkt, Kontoalter, die Verifikationsnachricht und
das Ergebnis.

Die Nachricht verfällt nach `retentionDays` (7–365 Tage, Vorgabe 90). Der
Block im Member Center zeigt bewusst **nur** Ergebnis und Weg – nie die
Nachricht selbst, denn die unterliegt genau dieser Aufbewahrungsfrist.

Jeder Schritt landet im Audit-Log: `VERIFICATION_STARTED`,
`VERIFICATION_MESSAGE_RECEIVED`, `VERIFICATION_AI_STARTED`,
`VERIFICATION_AI_VERIFIED`, `VERIFICATION_HUMAN_VERIFIED`,
`VERIFICATION_REJECTED`, `VERIFICATION_EXPIRED`,
`VERIFICATION_LEFT_SERVER`, `VERIFICATION_ERROR`.

---

## 11. Oberfläche

| Seite                          | Braucht                     |
| ------------------------------ | --------------------------- |
| `/verifikation`                | `verification.view`         |
| `/verifikation/warteschlange`  | `verification.review`       |
| `/verifikation/verlauf`        | `verification.history.view` |

Die Warteschlange aktualisiert sich über Server-Sent Events
(`/api/verifikation/live`) – dieselbe Technik wie die Turnier-Liveansicht,
kein zweiter Mechanismus. Auf dem Dashboard erscheint für Staff mit
`verification.review` die Kennzahl «Verifikationen offen» und eine
Schnellaktion in die Warteschlange; normale Mitglieder sehen weder das eine
noch das andere.

---

## 12. Fehlerfall

Scheitert das Modul selbst – Discord nicht erreichbar, Rolle nicht vergebbar,
AI-Antwort unbrauchbar –, ist der sichere Ausgang immer derselbe: der Vorgang
bleibt offen und wartet auf einen Menschen. Es gibt keinen Fehlerpfad, der
jemanden bannt, kickt oder ablehnt.
