# Member Center

Die Mitgliederakte des SwissHub Systems. Ein Staff-Mitglied sucht eine Person
und sieht an einem Ort, was sonst über ein Dutzend Seiten verteilt liegt –
Level, Tickets, Turniere, Premium, Spielersuche, Moderation.

Und zwar genau so viel, wie seine über Discord-Rollen konfigurierten
Berechtigungen erlauben. Keinen Datensatz mehr.

```
                    ┌─ Discord ......... Identität, Rollen, Beitritt
                    ├─ Level .......... XP, Rang, Nachrichten, Voice-Minuten
Mitglied suchen ──► ├─ Spielersuche ... Suchen, Voice-Zeit
      │             ├─ Turniere ....... Teilnahmen, Team, Platzierung
      ▼             ├─ Tickets ........ über den Sichtbarkeitsfilter des Moduls
Mitgliedsakte ─────►├─ Premium ........ Plan, Laufzeit (ohne Zahlungsdaten)
                    ├─ Moderation ..... Jail-Verlauf, Massnahmen
                    └─ Notizen ........ das Einzige, was hier selbst entsteht
```

---

## 1. Was das Member Center ist – und was nicht

Es ist ein **Aggregator**. Es liest zusammen und besitzt nichts.

| Daten                               | Eigentümer bleibt |
| ----------------------------------- | ----------------- |
| Identität, Avatar, Rollen, Beitritt | Discord           |
| XP, Level, Rang                     | Level-Modul       |
| Tickets                             | Ticket-Modul      |
| Turnierteilnahmen                   | Turnier-Modul     |
| Abonnements                         | Premium-Modul     |
| Jail, Massnahmen                    | Jail / Moderation |
| **Interne Notizen**                 | **Member Center** |

Eine Kopie dieser Daten wäre eine zweite Wahrheit, die irgendwann von der
ersten abweicht – und dann weiss niemand mehr, welche gilt. Deshalb gibt es
genau ein neues Datenbankmodell: `MemberNote`.

---

## 2. Erst fragen, dann laden

Das ist die eigentliche Sicherheitsentscheidung dieses Moduls.

```ts
// So arbeitet der Aggregator:
if (darfSehen(viewer, 'moderation', ziel)) {
  aufgaben.push(ladeModeration(ziel)); // wird geladen
}
// Kein `else`. Kein `null`. Der Schlüssel existiert einfach nicht.
```

Der bequeme Weg wäre andersherum – alles laden, das Verbotene in der
Oberfläche weglassen:

```tsx
const profil = await ladeAlles(id);
{
  darfModeration && <Moderation />;
} // ← das ist keine Sicherheit
```

Das ist eine Kulisse. Die Daten wären trotzdem abgefragt, lägen in der Antwort
und stünden im Fehlerfall im Log. Wer die Antwort direkt abruft, sähe sie.

**Ein verbotener Abschnitt fehlt in der Antwort vollständig** – er ist nicht
`null` und nicht `[]`. Auch eine Null verrät etwas: «0 Jails» ist eine Aussage
über die Moderationsakte. Deshalb zeigt auch die Übersicht keine Kachel zu
einem Bereich, den der Betrachter nicht sehen darf.

---

## 3. Berechtigungen

`members.view` bleibt unverändert und öffnet weiterhin Bereich und Suche.
Daneben stehen granulare Berechtigungen je Abschnitt.

### Geltungsbereiche als Schlüssel-Endung

Ein Geltungsbereich steht als Endung im Schlüssel – nicht als zusätzliche
Spalte an der Rolle-Berechtigung-Zuordnung:

```
members.view.level.own      members.view.level.all
members.view.tickets.own    members.view.tickets.assigned    members.view.tickets.all
```

Das ist Absicht. Eine Spalte hätte Zuordnungstabelle, Permission Engine,
Vorlagen und Berechtigungsoberfläche gleichzeitig geändert – also faktisch
eine zweite Engine neben der bestehenden. Als Schlüssel funktioniert alles
Vorhandene unverändert: `hasPermission`, die Präfix-Platzhalter (`members.*`),
`admin.full`, die Speicherung und die Rollenkonfiguration.

`NONE` braucht keinen Schlüssel – es ist die Abwesenheit aller anderen.
Sensible Bereiche sind dadurch **von sich aus gesperrt**.

`ALL` schlägt `ASSIGNED` schlägt `OWN`.

### Die Abschnitte

| Abschnitt      | Bereiche             | Anmerkung                                                  |
| -------------- | -------------------- | ---------------------------------------------------------- |
| `basic`        | own · all            |                                                            |
| `roles`        | own · all            |                                                            |
| `activity`     | own · all            |                                                            |
| `level`        | own · all            |                                                            |
| `spielersuche` | own · all            |                                                            |
| `tournaments`  | own · all            |                                                            |
| `tickets`      | own · assigned · all | `assigned`, weil das Ticketmodul echte Zuständigkeit führt |
| `premium`      | own · all            | ohne Zahlungsdaten                                         |
| `moderation`   | **nur all**          | siehe unten                                                |
| `notes`        | **nur all**          | siehe unten                                                |

**Moderation kennt kein `own`.** Die eigene Moderationsakte einsehen zu dürfen
klingt harmlos, verrät aber, was intern vermerkt ist, und beeinflusst, wie
sich jemand verhält.

**Notizen kennen kein `own` und kein `assigned`.** Sie sind für das betroffene
Mitglied nicht sichtbar, auch nicht im eigenen Profil. Ein Zuweisungssystem
für Notizen gibt es nicht – und eines zu erfinden, nur damit die Tabelle
symmetrisch aussieht, hätte niemandem geholfen.

### Aktionen

| Handlung            | Berechtigung                                   |
| ------------------- | ---------------------------------------------- |
| Rollen verwalten    | `members.roles.manage`                         |
| Notiz schreiben     | `members.notes.create`                         |
| Fremde Notiz ändern | `members.notes.edit`                           |
| Notiz löschen       | `members.notes.delete`                         |
| XP ändern           | `level.members.manage` ← **bestehend**         |
| Moderieren          | `moderation.execute` ← **bestehend**           |
| Jailen / freilassen | `jail.create` / `jail.release` ← **bestehend** |
| Ticket für jemanden | `tickets.admin.createForUser` ← **bestehend**  |
| Premium verwalten   | `premium.subscriptions.manage` ← **bestehend** |

Für Handlungen, die es im System längst gibt, entstehen **keine neuen
Schlüssel**. Ein zweiter Schlüssel für dieselbe Handlung wäre eine zweite
Wahrheit – und irgendwann widersprechen sie sich.

---

## 4. Migration der bestehenden `members.view`

`members.view` wird **nicht** entfernt und **nicht** umgedeutet. Sie öffnet
weiterhin Bereich und Suche.

Aus ihr wird **keine** sensible Berechtigung abgeleitet. Wer heute
`members.view` hat, bekommt durch dieses Update keinen neuen Zugang.

### Eine bewusste Verschärfung

Bisher zeigte die Profilseite den **Jail-Verlauf** jedem, der `members.view`
hatte – ohne weitere Prüfung. Das ist jetzt an `members.view.moderation.all`
gebunden.

Damit niemand am Deploy-Tag Zugang verliert, den er heute hat, gilt eine
Brücke: **`moderation.view` oder `jail.view` öffnen den Moderationsabschnitt
weiterhin.** Die Brücke wirkt nur in die Richtung «war schon erlaubt» – sie
vergibt nichts, was die Rolle nicht ohnehin an anderer Stelle sehen darf.

Betroffen ist damit praktisch nur die Vorlage **Support-Team**: sie hat
`members.view`, aber weder `moderation.view` noch `jail.view`. Sie sieht den
Jail-Verlauf künftig nicht mehr. Das ist die beabsichtigte Wirkung – Support
braucht ihn nicht.

### Neue Vorlagen

- **Mitglied** – die gewöhnliche Mitgliederrolle.
- **Moderator** – zusätzlich `basic/roles/activity/moderation/notes = ALL`
  und `members.notes.create`. Ausdrücklich **ohne** Premium- und
  XP-Verwaltung.

#### Warum «Mitglied» mehr enthält als das Member Center

**Eine Vorlage ersetzt die Berechtigungen einer Rolle vollständig** – das sagt
auch die Oberfläche: «Vorlagen werden sofort gespeichert und ersetzen die
bisherige Auswahl.»

Deshalb steht in «Mitglied» alles, was ein gewöhnliches Mitglied täglich
braucht, und nicht nur der Member-Center-Teil: Dashboard, Spielersuche
(eröffnen, beitreten, eigene schliessen), eigene Tickets, Level und
XP-Spiele, Turnierteilnahme, eigener Talk im Voice Hub, eigene Musik-Session
– dazu die acht `members.view.*.own`.

Eine Vorlage, die nur einen Ausschnitt enthielte, nähme der Rolle beim
Anwenden alles Übrige weg. Das fiele erst auf, wenn jemand etwas nicht mehr
kann, das er gestern noch konnte.

Nicht enthalten ist alles Verwaltende: keine fremden Profile, keine
Moderation, keine internen Notizen, keine Rollen-, XP- oder
Premium-Verwaltung, keine Support-Sicht auf fremde Tickets. Ein Test hält das
fest – die Vorlage landet auf einer Rolle, die jeder auf dem Server trägt.

> **Beim Auflösen fällt nichts mehr stillschweigend weg.** Löst sich eine
> Vorlage gegen _keine_ bekannte Berechtigung auf, wirft `resolvePreset` –
> sonst hätte der Aufrufer der Rolle sämtliche Berechtigungen gelöscht und
> keine neue vergeben. Ein weiterer Test prüft, dass jede Vorlage vollständig
> auflöst; er hat dabei einen Altbestand gefunden: die Vorlage
> **Senior Moderator** führte `jail.extend`, eine Berechtigung, die es nicht
> gibt. Sie verschwand beim Auflösen, und die Vorlage hielt ihr eigenes
> Versprechen («Verlängerung laufender Massnahmen») nie ein. Der richtige
> Schlüssel ist `jail.edit`.

---

## 5. Eigenes Profil

`/profile` leitet auf `/members/<eigene ID>` weiter. Es gibt eine
Mitgliederakte, und die eigene ist keine andere – eine zweite Seite mit
denselben Abschnitten wäre ein zweiter Ort, an dem Berechtigungen richtig
stehen müssten.

Die Profilseite verlangt **nicht** `members.view`. Wer nur sein eigenes Level
sehen darf, soll dafür nicht die Mitgliedersuche bekommen. Wer gar nichts
sehen darf, bekommt dieselbe Antwort wie bei einem unbekannten Mitglied –
sonst liesse sich an der Antwort ablesen, wer auf dem Server ist.

---

## 6. Rollen verwalten

Drei Sperren, und jede für sich genügt zum Nein:

1. **`members.roles.manage`** – sonst gar nicht.
2. **Die eigene Rollenhöhe.** Niemand vergibt eine Rolle über seiner eigenen.
   Ohne diese Sperre wäre jede Rollen-Berechtigung faktisch eine
   Administrator-Berechtigung.
3. **Die Rollenhöhe des Bots.** Was über ihm liegt, kann er ohnehin nicht
   setzen.

Dazu zwei harte Riegel:

- **Gefährliche Rollen** (`ADMINISTRATOR`, `MANAGE_ROLES`) fasst das Member
  Center nicht an. Solche Rollen über eine Mitgliederakte zu vergeben ist der
  kürzeste Weg zur Rechteausweitung – dafür gibt es Discords eigene
  Rollenverwaltung, wo die Tragweite sichtbar ist.
- **Die eigene Person** ist ausgenommen.

Gesperrte Rollen erscheinen in der Liste **mit dem Grund**. Eine Rolle
stillschweigend wegzulassen liesse den Verwalter raten, ob sie fehlt oder ob
er sie nicht darf.

---

## 7. Interne Notizen

Das Einzige, was das Member Center selbst speichert – und das Empfindlichste,
das es anzeigt. Eine Notiz ist eine Einschätzung von Menschen über Menschen.

- **Der Autor kommt aus der Sitzung**, niemals aus der Eingabe.
- **Höchstens 2000 Zeichen**, Steuerzeichen fallen weg, Absätze bleiben.
- **Die eigene Notiz** darf ändern, wer Notizen schreiben darf. **Fremde** nur
  mit `members.notes.edit`. Wer etwas notiert hat, soll einen Tippfehler
  beheben können, ohne Rechte über die Notizen anderer zu bekommen.
- **`editedAt`** wird nur gesetzt, wenn sich der _Text_ geändert hat –
  Anheften ist keine Bearbeitung.
- **Das Audit Log hält fest, dass** jemand etwas notiert hat, **nicht was**.
  Es ist für mehr Augen sichtbar als die Notiz selbst.

---

## 8. Aktivität

Gezeigt wird, was ohnehin gespeichert ist:

- **Gesamtzahlen** aus dem Level-Profil: Nachrichten, Voice-Minuten, letzte
  Aktivität.
- **Zeitfenster** (7 / 30 / 90 Tage) für alles, was Zeitstempel hat:
  XP-Buchungen, Spielersuchen, eröffnete Talks, Turnieranmeldungen.

Für Nachrichten und Voice-Zeit führt das Level-Modul **nur Gesamtzahlen**.
Dafür eine Erfassung einzuführen, nur damit hier ein Balken mehr steht, wäre
neue Überwachung für eine Anzeige. Das steht auch so in der Oberfläche.

---

## 9. Wenn etwas ausfällt

Die Abschnitte laden nebeneinander, und jeder darf einzeln scheitern. Fällt
das Premium-Modul aus, zeigt sein Abschnitt «Daten momentan nicht verfügbar» –
die Akte steht trotzdem. Eine Fehlerseite für das ganze Profil, weil eine
Zahlungsschnittstelle klemmt, wäre die schlechtere Antwort.

Fällt **Discord** aus, kommen die historischen Daten weiterhin aus der
Datenbank; der Kopf sagt, dass die Discord-Daten fehlen.

Hat das Mitglied den **Server verlassen**, steht das im Kopf und die
historischen Daten bleiben. Die Discord-User-ID bleibt die Identität – wer
zurückkommt, bekommt keine zweite Akte.

---

## 10. Sicherheit

| Angriff                                 | Abwehr                                                                                                    |
| --------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| **IDOR** – fremde ID in der Adresszeile | Bei `OWN` prüft der Server, ob Ziel = Betrachter. Getestet.                                               |
| **Direkter Aufruf** einer Server Action | Jede Aktion geht durch `defineAction`: Session → Mitgliedschaft → CSRF → Rate Limit → Zod → Berechtigung. |
| **Mass Assignment**                     | Zod-Schemata mit festen Feldern; kein Spread aus der Eingabe in Prisma.                                   |
| **Rechteausweitung**                    | Rollenhöhe des Betrachters + des Bots + gefährliche Rollen + keine Selbstvergabe.                         |
| **Guild-übergreifender Zugriff**        | Alle eigenen Abfragen sind auf `guildId` eingegrenzt. Getestet.                                           |
| **Notiz unter fremdem Namen**           | Autor kommt aus der Sitzung.                                                                              |
| **Verbotene Daten in der Antwort**      | Abschnitt wird gar nicht erst geladen. Getestet.                                                          |

Die Rollen kommen aus dem geprüften Sitzungskontext, nicht aus der Anfrage.
Schreibende Aktionen laufen mit `freshness: 'critical'` – die Discord-Rollen
werden vorher frisch geladen, damit eine gerade entzogene Rolle nicht noch
eine letzte Änderung durchbekommt.

---

## 11. Audit

Protokolliert werden **Eingriffe**, nicht das Lesen:

`MEMBER_ROLE_GRANTED`, `MEMBER_ROLE_REVOKED`, `MEMBER_NOTE_CREATED`,
`MEMBER_NOTE_UPDATED`, `MEMBER_NOTE_DELETED` – dazu die bestehenden Einträge
für Jail, Moderation, XP und Premium, weil diese Handlungen über die
bestehenden Dienste laufen.

Das Öffnen eines Profils erzeugt **keinen** Eintrag. Ein Protokoll jedes
geöffneten Profils wäre eine Bewegungsakte über die Mitarbeiter und keine
Sicherheitsspur.

---

## 12. Fehlersuche

| Symptom                                              | Ursache                                                                                                               |
| ---------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| «Mitglied wurde nicht gefunden», obwohl es existiert | Der Betrachter darf nicht einmal die Basisdaten sehen. Absicht – die Antwort verrät nicht, wer auf dem Server ist.    |
| Ein Reiter fehlt                                     | Die zugehörige Berechtigung fehlt. `/server/permissions` → Rolle → Member Center.                                     |
| «Mein Profil» fehlt in der Navigation                | Der Rolle fehlt `members.view.basic.own`.                                                                             |
| Jail-Verlauf verschwunden                            | Neu an `members.view.moderation.all`, `moderation.view` oder `jail.view` gebunden. Siehe Abschnitt 4.                 |
| Rolle nicht vergebbar                                | Der Grund steht daneben: über der eigenen Rolle, über dem Bot, von Discord verwaltet oder mit Administrationsrechten. |
| Ein Abschnitt sagt «Daten momentan nicht verfügbar»  | Die Quelle antwortet nicht. Das Bot-Log nennt den Grund; die übrige Akte bleibt nutzbar.                              |
