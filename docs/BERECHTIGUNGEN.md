# Berechtigungen

Wer im Dashboard und auf Discord was darf, entscheidet **eine** Stelle: die
Permission Engine in `packages/permissions`. Es gibt keine zweite Rechteauskunft

- weder im Bot, noch in einer Server Action, noch im Browser.

## Die drei Bausteine

| Baustein   | Wo                                     | Bedeutung                                                                 |
| ---------- | -------------------------------------- | ------------------------------------------------------------------------- |
| Permission | `packages/permissions/src/registry.ts` | Ein Schlüssel wie `jail.create`. Module registrieren ihre eigenen.        |
| Zuordnung  | `RolePermission`                       | Verbindet eine Discord-Rolle mit einem Schlüssel - **und einer Wirkung**. |
| Auflösung  | `resolvePermissions` / `hasPermission` | Macht aus den Rollen einer Person eine Ja/Nein-Antwort.                   |

## Wirkung: ALLOW und DENY

Jede Zuordnung hat eine Wirkung (`PermissionEffect`):

- **`ALLOW`** - die Berechtigung ist erteilt. Vorgabe, und der Zustand jeder
  Zeile, die es vor dieser Erweiterung schon gab.
- **`DENY`** - die Berechtigung ist **ausdrücklich verweigert**.

`DENY` ist nicht dasselbe wie «keine Zeile». Keine Zeile heisst «nie erteilt»;
`DENY` heisst «erteilt gewesen oder eingeschlossen, und bewusst weggenommen».
Genau dieser Unterschied macht Vollzugriff mit Ausnahmen möglich.

Die Wirkung steht als eigene Spalte in der Datenbank und nicht als Sonderzeichen
im Schlüssel. Ein `!migration.execute` in einem Permission-String wäre in der
Registry nicht auffindbar, in der Oberfläche nicht erklärbar und in jeder
Abfrage ein Sonderfall.

## Rangfolge

Von oben nach unten - die erste zutreffende Regel entscheidet:

1. **System-Owner** → erlaubt. Immer.
2. **`DENY`** (wortgleich oder als `<präfix>.*`) → verweigert.
3. **`ALLOW admin.full`** → erlaubt.
4. **`ALLOW` wortgleich oder als `<präfix>.*`** → erlaubt.
5. sonst → verweigert.

Daraus folgt das, was die Verwaltung braucht:

```
ALLOW admin.full
DENY  migration.execute
DENY  integrations.secrets.manage
```

→ alles erlaubt **ausser** diesen beiden.

Eine Verweigerung gilt über alle Rollen hinweg: trägt jemand zwei Rollen und
verweigert die eine, was die andere erlaubt, gewinnt die Verweigerung. Eine
Ausnahme, die sich durch das Hinzufügen einer beliebigen weiteren Rolle
aushebeln liesse, wäre keine.

## System Owner vs. rollenbasierter Vollzugriff

Das sind zwei verschiedene Dinge, und sie werden bewusst nicht vermischt.

|                                   | System Owner                           | Vollzugriff (`admin.full`)      |
| --------------------------------- | -------------------------------------- | ------------------------------- |
| Herkunft                          | `SWISSHUB_OWNER_DISCORD_ID` (Umgebung) | Zuordnung an eine Discord-Rolle |
| Gilt für                          | genau eine Discord-ID                  | jeden, der die Rolle trägt      |
| Änderbar im Dashboard             | **nein**                               | ja                              |
| Von `DENY` erreichbar             | **nein**                               | ja                              |
| Umgeht die Moderations-Hierarchie | ja                                     | nein                            |

**Warum der Owner nicht entziehbar ist:** er ist der Notzugang. Liesse er sich
über die Oberfläche einschränken, könnte ein Fehlgriff genau die Person
aussperren, die ihn zurücknehmen müsste - und niemand käme mehr an die Seite,
auf der das ginge. `hasPermission` prüft `isOwner` deshalb **vor** allem
anderen, `DENY` eingeschlossen.

**Warum Vollzugriff das nicht tut:** er hängt an einer Rolle, die sich jederzeit
vergeben und wieder abnehmen lässt. Genau darum darf und soll er einschränkbar
sein - sonst gäbe es keinen Weg, einer Administratorenrolle eine einzelne
gefährliche Aktion zu entziehen.

`isOwner` bedeutet im ganzen Code ausschliesslich «System Owner». Wo früher
`permissionKeys.includes('admin.full')` als Owner durchging (Verifikation),
steht jetzt `ctx.user.isOwner`. Wer Vollzugriff hat, kommt weiterhin durch jede
`can`-Prüfung - er umgeht nur nicht mehr die Rangfolge der Moderation.

## Aussperrschutz

`checkLockout` verhindert, dass nach einer Änderung niemand mehr
`permissions.manage` hat. Es zählt dabei **effektiv** ab: eine Rolle mit
Vollzugriff, der `permissions.manage` ausdrücklich verweigert wurde, verwaltet
nichts mehr und zählt nicht als verbleibender Verwalter. Ist
`SWISSHUB_OWNER_DISCORD_ID` gesetzt, gilt der Notzugang als ausreichend.

Der Wiederherstellungshinweis auf `/server/permissions` (`isRecoveryNeeded`)
rechnet nach derselben Regel.

## Oberfläche

Die Berechtigungsmatrix zeigt vier Zustände, und jeder nennt seinen Grund:

| Zustand                                         | Aussehen                             | Klick bewirkt                  |
| ----------------------------------------------- | ------------------------------------ | ------------------------------ |
| einzeln erteilt                                 | Häkchen, blau                        | nimmt die Erteilung zurück     |
| durch Vollzugriff / `<präfix>.*` eingeschlossen | Häkchen, blass, Merkzeichen          | macht daraus eine **Ausnahme** |
| ausdrücklich verweigert                         | Verbotszeichen, rot, durchgestrichen | hebt die Ausnahme wieder auf   |
| nicht erteilt                                   | leer                                 | erteilt sie einzeln            |

Die Begründung steht an jeder Zeile - auch an den unauffälligen. Sonst bliebe
offen, ob ein leeres Kästchen «nie erteilt» oder «erteilt und wieder gesperrt»
heisst.

Bewertet wird im Browser von derselben Funktion wie im Server
(`explainPermission` aus `@swisshub/permissions/engine`). Eine zweite Regel im
Browser liefe irgendwann auseinander, und dann zeigte die Oberfläche etwas
anderes an, als tatsächlich gilt.

## Serverseitig

Die Oberfläche ist Darstellung. Massgeblich ist ausschliesslich:

- `defineAction({ permission })` - prüft vor jedem Handler.
- `requirePagePermission` - prüft vor jedem Seitenaufruf.
- `setRolePermissionsAction` - weist unbekannte Schlüssel ab und lehnt ab, wenn
  derselbe Schlüssel gleichzeitig erlaubt und verweigert werden soll.

Wer die Aktion direkt aufruft, kommt an keiner dieser Prüfungen vorbei.

## Übertragung (Migrate)

Das Migrationspaket führt Erlaubnisse und Ausnahmen getrennt
(`permissions` / `deniedPermissions`). Pakete aus einer älteren Fassung kennen
das zweite Feld nicht; ein fehlendes Feld heisst «keine Ausnahmen». Ohne diese
Trennung würde eine Übertragung eine Ausnahme stillschweigend in ein Recht
verwandeln - und eine Übertragung, die unbemerkt erweitert, ist schlimmer als
eine, die abbricht.
